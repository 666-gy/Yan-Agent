const fs = require('fs');
const path = require('path');
const { containsUnsafeMemoryText, tokenize } = require('./long-term-memory');

const VERSION = 1;
const MIN_DISTINCT_SUCCESS_RUNS = 2;
const MAX_CANDIDATES = 500;

function clip(value, max) {
  return String(value || '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function normalizeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
}

function emptyStore() {
  return { version: VERSION, candidates: [], updatedAt: 0 };
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return emptyStore();
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      version: VERSION,
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      updatedAt: Number(parsed.updatedAt) || 0
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(filePath, store) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const next = { ...store, version: VERSION, updatedAt: Date.now() };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function unsafeSkillPrompt(prompt) {
  if (containsUnsafeMemoryText(prompt)) return true;
  const text = String(prompt || '').toLowerCase();
  return [
    /\brm\s+-rf\b/,
    /\bformat\s+[a-z]:/,
    /\bdel\s+\/s\s+\/q\b/,
    /remove-item[^\n]{0,80}-recurse[^\n]{0,40}-force/i,
    /(?:api[_ -]?key|access[_ -]?token|password)\s*[:=]\s*\S{8,}/i
  ].some(pattern => pattern.test(text));
}

function normalizeCandidate(input = {}) {
  const id = normalizeId(input.id || input.name);
  const name = clip(input.name || id, 80);
  const description = clip(input.description || input.desc, 300);
  const prompt = clip(input.prompt, 6000);
  const evidence = clip(input.evidence, 600);
  if (!id || id.length < 3 || !name || prompt.length < 80 || !evidence || unsafeSkillPrompt(prompt)) return null;
  const triggers = [...new Set((Array.isArray(input.triggers) ? input.triggers : [])
    .map(trigger => clip(trigger, 80))
    .filter(Boolean))].slice(0, 12);
  return { id, name, description, prompt, triggers, evidence };
}

function contentSimilarity(left, right) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

class SkillEvolutionStore {
  constructor({ filePath, minDistinctRuns = MIN_DISTINCT_SUCCESS_RUNS }) {
    this.filePath = filePath;
    this.minDistinctRuns = Math.max(2, Number(minDistinctRuns) || MIN_DISTINCT_SUCCESS_RUNS);
  }

  list() {
    return readStore(this.filePath).candidates
      .slice()
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }

  record(input, meta = {}) {
    const candidate = normalizeCandidate(input);
    if (!candidate) return { ok: false, error: 'Skill candidate was incomplete or failed the safety policy.' };
    if (!meta.verified || Number(meta.toolCallCount || 0) < 4) {
      return { ok: false, error: 'Skill candidates require a completed, verified run with at least four tool calls.' };
    }
    const runId = clip(meta.runId, 120);
    if (!runId) return { ok: false, error: 'A source run id is required.' };

    const store = readStore(this.filePath);
    const now = Date.now();
    let record = store.candidates.find(item => item.id === candidate.id);
    if (!record) {
      record = {
        ...candidate,
        status: 'observing',
        successfulRuns: [],
        observations: [],
        createdAt: now,
        updatedAt: now
      };
      store.candidates.push(record);
    } else if (contentSimilarity(record.prompt, candidate.prompt) < 0.55 && record.status === 'promoted') {
      return { ok: false, error: 'A conflicting candidate cannot replace an already promoted Skill.' };
    } else if (contentSimilarity(record.prompt, candidate.prompt) < 0.55) {
      record.status = 'observing';
      record.successfulRuns = [];
      record.observations = [];
      delete record.promotedSkillId;
      delete record.promotedAt;
      delete record.refinementId;
    }

    if (!record.successfulRuns.includes(runId)) {
      record.successfulRuns.push(runId);
      record.observations.push({
        runId,
        sessionId: clip(meta.sessionId, 120),
        workspace: clip(meta.workspace, 500),
        evidence: candidate.evidence,
        ts: now
      });
    }
    if (record.status === 'rejected') record.status = 'observing';
    record.successfulRuns = record.successfulRuns.slice(-20);
    record.observations = record.observations.slice(-20);
    record.name = candidate.name;
    record.description = candidate.description;
    record.prompt = candidate.prompt;
    record.triggers = candidate.triggers;
    record.evidence = candidate.evidence;
    record.updatedAt = now;
    if (record.status !== 'promoted' && record.successfulRuns.length >= this.minDistinctRuns) {
      record.status = 'ready';
    }

    if (store.candidates.length > MAX_CANDIDATES) {
      store.candidates = store.candidates
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .slice(0, MAX_CANDIDATES);
    }
    writeStore(this.filePath, store);
    return { ok: true, candidate: record, ready: record.status === 'ready' };
  }

  markPromoted(candidateId, skillId, meta = {}) {
    const store = readStore(this.filePath);
    const record = store.candidates.find(item => item.id === normalizeId(candidateId));
    if (!record) return null;
    record.status = 'promoted';
    record.promotedSkillId = clip(skillId, 120);
    record.promotedAt = Date.now();
    record.refinementId = clip(meta.refinementId, 120) || record.refinementId;
    record.updatedAt = record.promotedAt;
    writeStore(this.filePath, store);
    return record;
  }

  markRolledBack(skillId, refinementId = '') {
    const store = readStore(this.filePath);
    const record = store.candidates.find(item => (
      item.promotedSkillId === clip(skillId, 120)
      || (refinementId && item.refinementId === clip(refinementId, 120))
    ));
    if (!record) return null;
    record.status = 'rejected';
    record.successfulRuns = [];
    record.observations = [];
    record.rollbackAt = Date.now();
    record.updatedAt = record.rollbackAt;
    delete record.promotedSkillId;
    delete record.promotedAt;
    delete record.refinementId;
    writeStore(this.filePath, store);
    return record;
  }
}

module.exports = {
  MIN_DISTINCT_SUCCESS_RUNS,
  SkillEvolutionStore,
  normalizeCandidate,
  normalizeId,
  contentSimilarity,
  unsafeSkillPrompt
};
