'use strict';

// Trainable-data accumulation: verified run trajectories land in a bounded
// NDJSON file so a future test-time-training / fine-tuning pass can replay
// them. Anything that looks like a secret or a destructive command is dropped
// before it ever reaches disk.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { clip, normalizeId, appendTextAtomic, containsUnsafeText } = require('./contracts');

const MAX_STEPS = 60;
const STEP_TOOL_MAX = 60;
const STEP_TARGET_MAX = 200;
const SUMMARY_MAX = 600;
const WORKSPACE_MAX = 240;

function writeLinesAtomic(filePath, lines) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
    try {
      fs.renameSync(temporary, filePath);
    } catch {
      // Same Windows rename fallback the contracts writer uses.
      fs.copyFileSync(temporary, filePath);
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return filePath;
}

function createTrajectoryStore(options = {}) {
  const dir = options.dir ? String(options.dir) : '';
  if (!dir) throw new Error('createTrajectoryStore requires a dir');
  const maxRecords = Math.max(1, Math.floor(Number(options.maxRecords) || 2000));
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const filePath = path.join(dir, 'trajectories.ndjson');

  function readLines() {
    try {
      if (!fs.existsSync(filePath)) return [];
      return fs.readFileSync(filePath, 'utf8').split('\n').map(line => line.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  function readRecords() {
    const records = [];
    for (const line of readLines()) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object') records.push(parsed);
      } catch {
        // Skip a corrupt line instead of failing the whole store.
      }
    }
    return records;
  }

  function prune() {
    const lines = readLines();
    if (lines.length <= maxRecords) return false;
    writeLinesAtomic(filePath, lines.slice(-maxRecords));
    return true;
  }

  function record(input = {}) {
    const runId = normalizeId(input.runId, 120);
    if (!runId) return { ok: false, error: 'runId is required' };

    const steps = (Array.isArray(input.steps) ? input.steps.slice(0, MAX_STEPS) : []).map(step => ({
      tool: clip(step && step.tool, STEP_TOOL_MAX),
      ok: Boolean(step && step.ok),
      target: clip(step && step.target, STEP_TARGET_MAX)
    }));
    const rawOutcome = typeof input.outcome === 'string' ? input.outcome.trim().toLowerCase() : '';
    const outcome = rawOutcome === 'success' || rawOutcome === 'failure' ? rawOutcome : '';
    const verification = input.verification && typeof input.verification === 'object' ? input.verification : null;
    const rawVerdict = verification ? String(verification.verdict || '').trim().toLowerCase() : '';
    const verificationVerdict = ['pass', 'fail', 'unobserved'].includes(rawVerdict) ? rawVerdict : '';
    const timestamp = Number(now());

    const entry = {
      v: 1,
      runId,
      ts: Number.isFinite(timestamp) ? timestamp : Date.now(),
      workspace: clip(input.workspace, WORKSPACE_MAX),
      outcome,
      verificationVerdict,
      stepCount: steps.length,
      summary: clip(input.summary, SUMMARY_MAX),
      redacted: false,
      steps
    };
    if (containsUnsafeText(JSON.stringify(entry))) {
      entry.redacted = true;
      entry.summary = '';
      for (const step of entry.steps) step.target = '';
    }

    try {
      appendTextAtomic(filePath, `${JSON.stringify(entry)}\n`);
    } catch {
      return { ok: false, error: 'failed to append trajectory' };
    }
    const pruned = prune();
    return { ok: true, record: entry, pruned };
  }

  function list(listOptions = {}) {
    const requested = Number(listOptions.limit);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 20;
    return readRecords().slice(-limit).reverse();
  }

  function summarize() {
    const records = readRecords();
    const byOutcome = { success: 0, failure: 0, neutral: 0 };
    let lastAt = 0;
    for (const item of records) {
      if (item.outcome === 'success') byOutcome.success += 1;
      else if (item.outcome === 'failure') byOutcome.failure += 1;
      else byOutcome.neutral += 1;
      const ts = Number(item.ts);
      if (Number.isFinite(ts) && ts > lastAt) lastAt = ts;
    }
    return { total: records.length, byOutcome, lastAt };
  }

  return { record, list, summarize };
}

module.exports = { createTrajectoryStore };
