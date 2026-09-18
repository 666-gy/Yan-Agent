'use strict';

// Additive utility ledger for AGI capability runs. It accumulates delivery
// evidence per harness entry so later promotion/retirement passes can score
// entries. It never mutates lib/continual-harness.js, which keeps its own
// decay weights; this ledger is a separate, append-style record.

const { clip, normalizeId, readJson, writeJsonAtomic } = require('./contracts');

const OUTCOME_VALUES = Object.freeze(['success', 'failure']);
const VERDICT_VALUES = Object.freeze(['pass', 'fail', 'unobserved']);
const RECENT_RUN_LIMIT = 50;
const KIND_PATTERN = /^[a-z_]+$/;

function utilityOutcomeFromVerification(verdict) {
  if (verdict === 'pass') return 'success';
  if (verdict === 'fail') return 'failure';
  return '';
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function scoreOf(record) {
  return round3(
    record.verifiedPass * 2 + record.success * 0.5 -
    record.verifiedFail * 2 - record.failure * 0.5
  );
}

function emptyRecord(kind, id, timestamp) {
  return {
    key: `${kind}:${id}`,
    kind,
    id,
    success: 0,
    failure: 0,
    verifiedPass: 0,
    verifiedFail: 0,
    unobserved: 0,
    score: 0,
    recentRunIds: [],
    updatedAt: Number(timestamp) || 0
  };
}

function cloneRecord(record) {
  return { ...record, recentRunIds: record.recentRunIds.slice() };
}

function validEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const kind = String(entry.kind || '').trim().toLowerCase();
  if (!KIND_PATTERN.test(kind)) return null;
  const id = normalizeId(entry.id);
  if (!id) return null;
  return { kind, id, key: `${kind}:${id}` };
}

function createUtilityLedger(options = {}) {
  const filePath = options.filePath ? String(options.filePath) : '';
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const records = new Map();

  const stored = filePath ? readJson(filePath, null) : null;
  if (stored && stored.version === 1 && stored.entries && typeof stored.entries === 'object') {
    for (const value of Object.values(stored.entries)) {
      if (!value || typeof value !== 'object') continue;
      const kind = String(value.kind || '');
      const id = String(value.id || '');
      if (!KIND_PATTERN.test(kind) || !id) continue;
      const record = emptyRecord(kind, id, value.updatedAt);
      for (const field of ['success', 'failure', 'verifiedPass', 'verifiedFail', 'unobserved']) {
        record[field] = Math.max(0, Math.floor(Number(value[field]) || 0));
      }
      record.recentRunIds = Array.isArray(value.recentRunIds)
        ? value.recentRunIds.map(item => clip(item, 120)).filter(Boolean).slice(-RECENT_RUN_LIMIT)
        : [];
      record.score = scoreOf(record);
      records.set(record.key, record);
    }
  }

  function persist(timestamp) {
    if (!filePath) return true;
    const entries = {};
    for (const [key, record] of records) entries[key] = cloneRecord(record);
    try {
      writeJsonAtomic(filePath, { version: 1, entries, updatedAt: timestamp });
      return true;
    } catch {
      return false;
    }
  }

  function attribute(input = {}) {
    const runId = normalizeId(input.runId, 120);
    if (!runId) return { ok: false, error: 'runId is required' };

    const unique = new Map();
    for (const entry of Array.isArray(input.entries) ? input.entries : []) {
      const valid = validEntry(entry);
      if (valid && !unique.has(valid.key)) unique.set(valid.key, valid);
    }
    if (!unique.size) return { ok: false, error: 'at least one valid entry is required' };

    const rawOutcome = typeof input.outcome === 'string' ? input.outcome.trim().toLowerCase() : '';
    const outcome = OUTCOME_VALUES.includes(rawOutcome) ? rawOutcome : '';
    const verification = input.verification && typeof input.verification === 'object' ? input.verification : null;
    const rawVerdict = verification ? String(verification.verdict || '').trim().toLowerCase() : '';
    const verdict = VERDICT_VALUES.includes(rawVerdict) ? rawVerdict : '';

    const timestamp = Number(now());
    const updates = new Map();
    const attributed = [];
    const skipped = [];
    for (const entry of unique.values()) {
      const base = updates.get(entry.key) || records.get(entry.key) || emptyRecord(entry.kind, entry.id, timestamp);
      if (base.recentRunIds.includes(runId)) {
        skipped.push(entry.key);
        continue;
      }
      const next = cloneRecord(base);
      if (outcome === 'success') next.success += 1;
      if (outcome === 'failure') next.failure += 1;
      if (verdict === 'pass') next.verifiedPass += 1;
      if (verdict === 'fail') next.verifiedFail += 1;
      if (verdict === 'unobserved') next.unobserved += 1;
      next.recentRunIds = [...next.recentRunIds, runId].slice(-RECENT_RUN_LIMIT);
      next.updatedAt = Number.isFinite(timestamp) ? timestamp : Date.now();
      next.score = scoreOf(next);
      updates.set(entry.key, next);
      attributed.push(entry.key);
    }
    if (!attributed.length) {
      return { ok: false, error: 'duplicate run attribution', runId, skipped };
    }

    const previous = new Map();
    for (const [key, next] of updates) {
      previous.set(key, records.get(key) || null);
      records.set(key, next);
    }
    if (!persist(Number.isFinite(timestamp) ? timestamp : Date.now())) {
      for (const [key, before] of previous) {
        if (before) records.set(key, before);
        else records.delete(key);
      }
      return { ok: false, error: 'failed to persist utility ledger', runId, attributed, skipped };
    }
    return { ok: true, runId, attributed, skipped };
  }

  function report() {
    return [...records.values()]
      .map(cloneRecord)
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  }

  function get(kind, id) {
    const key = `${String(kind || '').trim().toLowerCase()}:${normalizeId(id)}`;
    const record = records.get(key);
    return record ? cloneRecord(record) : null;
  }

  return { attribute, report, get };
}

module.exports = { createUtilityLedger, utilityOutcomeFromVerification };
