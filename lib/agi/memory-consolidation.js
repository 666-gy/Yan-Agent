'use strict';

// Memory consolidation and retrieval upgrades for AGI runs:
//  - distill a finished turn into a reusable long-term memory (rule / failure_solution);
//  - plan and apply soft decay for stale low-frequency low-confidence memories;
//  - A-MEM style link weighting for retrieval, without embeddings or network calls;
//  - persist branch -> action -> failure -> repair experience edges.
// Additive only: records are shaped exactly as LongTermMemoryStore.upsert expects.

const { clip, containsUnsafeText, readJson, stableHash, writeJsonAtomic } = require('./contracts');
const {
  containsSensitiveMemoryText,
  containsUnsafeMemoryText,
  normalizeWorkspace,
  scoreMemory,
  tokenize
} = require('../long-term-memory');

const OUTCOMES = Object.freeze(['success', 'failure']);
const SUCCESS_CONFIDENCE = 0.8;
const FAILURE_CONFIDENCE = 0.72;
const DEFAULT_MAX_AGE_DAYS = 45;
const DEFAULT_MIN_CONFIDENCE = 0.55;
const DEFAULT_MAX_OCCURRENCES = 1;
const DEFAULT_PROTECT_TYPES = Object.freeze(['preference', 'work_state']);
const CONFIDENCE_FLOOR = 0.05;
const DEFAULT_DECAY_FACTOR = 0.85;
const DEFAULT_MAX_LINKS = 8;
const UTILITY_BONUS = 0.4;
const EDGE_FIELD_CHARS = 300;
const EDGE_RUN_ID_CHARS = 120;
const GRAPH_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

function resolveNow(now) {
  const value = typeof now === 'function' ? Number(now()) : Number(now);
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compareText(left, right) {
  const a = String(left === undefined || left === null ? '' : left);
  const b = String(right === undefined || right === null ? '' : right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function scopeGroupKey(memory) {
  const scope = String(memory.scope || 'global').trim().toLowerCase();
  if (scope !== 'workspace') return 'global';
  const workspace = normalizeWorkspace(memory.workspace);
  return workspace ? `workspace:${workspace}` : 'workspace:';
}

function isUnsafeText(value) {
  return containsUnsafeText(value)
    || containsUnsafeMemoryText(value)
    || containsSensitiveMemoryText(value);
}

// ---- P0-5 distillation ----------------------------------------------------

function distillOutcome(input = {}) {
  const outcome = String(input.outcome || '').trim().toLowerCase();
  if (!OUTCOMES.includes(outcome)) return { ok: false, error: 'outcome must be success or failure' };

  const summary = clip(input.summary, 400);
  if (!summary) return { ok: false, error: 'summary is required' };

  const failure = clip(input.failure, 300);
  const solution = clip(input.solution, 300);
  // containsUnsafeMemoryText('') is true by design, so only check filled fields.
  const texts = [summary, failure, solution].filter(Boolean);
  if (texts.some(containsUnsafeText)) return { ok: false, error: 'outcome contains unsafe text' };
  if (texts.some(containsUnsafeMemoryText)) return { ok: false, error: 'outcome contains prompt-injection text' };
  if (texts.some(containsSensitiveMemoryText)) return { ok: false, error: 'outcome contains sensitive text' };

  const workspace = String(input.workspace || '').trim();
  const requestedScope = String(input.scope || (workspace ? 'workspace' : 'global')).trim().toLowerCase();
  if (requestedScope === 'workspace' && !workspace) {
    return { ok: false, error: 'workspace scope requires a workspace' };
  }
  const scope = requestedScope === 'workspace' ? 'workspace' : 'global';
  const runId = clip(input.runId, 120);
  const sessionId = clip(input.sessionId, 120);
  const refinementId = clip(input.refinementId, 120);
  const timestamp = resolveNow(input.now);

  const keywords = [...new Set([
    ...tokenize(summary),
    ...tokenize(failure),
    ...tokenize(solution)
  ].filter(token => token.length >= 2))].slice(0, 12);

  const content = outcome === 'success'
    ? clip(`规则：以后遇到同类任务，复用以下成功做法——${summary}`, 800)
    : clip(`失败：${failure || summary}；修复：${solution || '先规避该做法，再尝试替代方案并验证。'}`, 800);

  const evidence = clip(
    `outcome=${outcome}; run=${runId || 'n/a'}; session=${sessionId || 'n/a'}; `
    + `distilledAt=${new Date(timestamp).toISOString()}`,
    500
  );

  return {
    ok: true,
    record: {
      key: `agi-${outcome}-${stableHash(`${scope}|${normalizeWorkspace(workspace)}|${summary}`).slice(0, 16)}`,
      type: outcome === 'success' ? 'procedure' : 'failure_solution',
      scope,
      workspace: scope === 'workspace' ? workspace : '',
      content,
      keywords,
      evidence,
      confidence: outcome === 'success' ? SUCCESS_CONFIDENCE : FAILURE_CONFIDENCE,
      basis: 'agi_memory_consolidation',
      // Field names line up with sameSourceReference (refinementId, then runId).
      source: { kind: 'agi_memory_consolidation', runId, sessionId, refinementId }
    }
  };
}

// ---- P0-5 simplified forgetting (never deletes) ---------------------------

function planDecay(memories, options = {}) {
  const now = resolveNow(options.now);
  const maxAgeDays = Math.max(1, finiteNumber(options.maxAgeDays, DEFAULT_MAX_AGE_DAYS));
  const minConfidence = finiteNumber(options.minConfidence, DEFAULT_MIN_CONFIDENCE);
  const maxOccurrences = Math.max(1, finiteNumber(options.maxOccurrences, DEFAULT_MAX_OCCURRENCES));
  const protectTypes = new Set(
    (Array.isArray(options.protectTypes) ? options.protectTypes : DEFAULT_PROTECT_TYPES)
      .map(type => String(type || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const cutoff = now - maxAgeDays * DAY_MS;

  const items = [];
  for (const memory of Array.isArray(memories) ? memories : []) {
    if (!memory || typeof memory !== 'object') continue;
    if (memory.status === 'superseded') continue;
    const id = String(memory.id || '').trim();
    if (!id) continue;
    if (protectTypes.has(String(memory.type || '').trim().toLowerCase())) continue;
    if (finiteNumber(memory.confidence, 0.4) >= minConfidence) continue;
    if (finiteNumber(memory.occurrences, 1) > maxOccurrences) continue;
    const updatedAt = finiteNumber(memory.updatedAt, finiteNumber(memory.createdAt, 0));
    // Unknown age is not proven stale; exactly maxAgeDays old is stale enough.
    if (updatedAt <= 0 || updatedAt > cutoff) continue;
    const ageDays = Math.floor((now - updatedAt) / DAY_MS);
    items.push({
      id,
      reason: `stale>${maxAgeDays}d (age=${ageDays}d); confidence<${minConfidence}; occurrences<=${maxOccurrences}`
    });
  }
  items.sort((a, b) => compareText(a.id, b.id));
  return { items };
}

function applyDecay(store, plan, options = {}) {
  const now = resolveNow(options.now);
  const requested = finiteNumber(options.factor, DEFAULT_DECAY_FACTOR);
  const factor = requested > 0 && requested < 1 ? requested : DEFAULT_DECAY_FACTOR;

  const reasons = new Map();
  for (const item of Array.isArray(plan?.items) ? plan.items : []) {
    if (!item || !item.id) continue;
    reasons.set(String(item.id), String(item.reason || 'decayed'));
  }
  if (!store || !Array.isArray(store.memories) || !reasons.size) return { updated: 0 };

  let updated = 0;
  for (const memory of store.memories) {
    if (!memory || typeof memory !== 'object') continue;
    const id = String(memory.id || '');
    if (!reasons.has(id)) continue;
    if (memory.status === 'superseded') continue;
    memory.confidence = Math.max(CONFIDENCE_FLOOR, finiteNumber(memory.confidence, 0.5) * factor);
    const metadata = memory.metadata && typeof memory.metadata === 'object' ? memory.metadata : {};
    metadata.decayedAt = now;
    metadata.decayReason = reasons.get(id);
    memory.metadata = metadata;
    updated += 1;
  }
  return { updated };
}

// ---- P1-3 link weighting --------------------------------------------------

function memoryTokens(memory) {
  const tokens = new Set();
  for (const keyword of Array.isArray(memory.keywords) ? memory.keywords : []) {
    for (const token of tokenize(keyword)) tokens.add(token);
  }
  for (const token of tokenize(memory.content)) tokens.add(token);
  return tokens;
}

function buildLinks(memories, options = {}) {
  const minSharedKeywords = Math.max(1, Math.floor(finiteNumber(options.minSharedKeywords, 2)));
  const maxLinks = Math.max(1, Math.floor(finiteNumber(options.maxLinks, DEFAULT_MAX_LINKS)));

  const candidates = [];
  const seen = new Set();
  for (const memory of Array.isArray(memories) ? memories : []) {
    if (!memory || typeof memory !== 'object') continue;
    if (memory.status === 'superseded') continue;
    const id = String(memory.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    candidates.push({ id, group: scopeGroupKey(memory), tokens: memoryTokens(memory) });
  }

  const pairs = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = candidates[i];
      const right = candidates[j];
      if (left.group !== right.group) continue;
      let shared = 0;
      for (const token of left.tokens) if (right.tokens.has(token)) shared += 1;
      if (shared < minSharedKeywords) continue;
      const ordered = compareText(left.id, right.id) <= 0;
      pairs.push(ordered ? { a: left.id, b: right.id, shared } : { a: right.id, b: left.id, shared });
    }
  }
  pairs.sort((x, y) => y.shared - x.shared || compareText(x.a, y.a) || compareText(x.b, y.b));

  // Greedy deterministic selection, each memory keeps at most maxLinks neighbours.
  const degree = new Map();
  const links = [];
  for (const pair of pairs) {
    const degreeA = degree.get(pair.a) || 0;
    const degreeB = degree.get(pair.b) || 0;
    if (degreeA >= maxLinks || degreeB >= maxLinks) continue;
    degree.set(pair.a, degreeA + 1);
    degree.set(pair.b, degreeB + 1);
    links.push(pair);
  }
  return links;
}

function applyLinks(store, links, options = {}) {
  const maxLinks = Math.max(1, Math.floor(finiteNumber(options.maxLinks, DEFAULT_MAX_LINKS)));
  const byId = new Map();
  for (const memory of Array.isArray(store?.memories) ? store.memories : []) {
    if (memory && typeof memory === 'object' && memory.id) byId.set(String(memory.id), memory);
  }

  const desired = new Map();
  const addPeer = (id, peer) => {
    if (!desired.has(id)) desired.set(id, []);
    const peers = desired.get(id);
    if (!peers.includes(peer)) peers.push(peer);
  };
  for (const link of Array.isArray(links) ? links : []) {
    const a = String(link?.a || '').trim();
    const b = String(link?.b || '').trim();
    if (!a || !b || a === b || !byId.has(a) || !byId.has(b)) continue;
    if (byId.get(a).status === 'superseded' || byId.get(b).status === 'superseded') continue;
    addPeer(a, b);
    addPeer(b, a);
  }

  let updated = 0;
  for (const [id, peers] of desired) {
    const memory = byId.get(id);
    const metadata = memory.metadata && typeof memory.metadata === 'object' ? memory.metadata : {};
    const existing = Array.isArray(metadata.links)
      ? metadata.links.map(item => String(item)).filter(Boolean)
      : [];
    const merged = [...new Set([...existing, ...peers])].slice(0, maxLinks);
    const changed = merged.length !== existing.length || merged.some((item, index) => item !== existing[index]);
    if (!changed) continue;
    metadata.links = merged;
    memory.metadata = metadata;
    updated += 1;
  }
  return { updated };
}

function hybridRank(memories, queryTokens, options = {}) {
  const tokens = (Array.isArray(queryTokens) ? queryTokens : tokenize(queryTokens))
    .map(token => String(token || '').trim().toLowerCase())
    .filter(Boolean);
  const links = Array.isArray(options.links) ? options.links : [];
  const utility = options.utility && typeof options.utility.get === 'function' ? options.utility : null;

  const linkCounts = new Map();
  for (const link of links) {
    const a = String(link?.a || '').trim();
    const b = String(link?.b || '').trim();
    if (a) linkCounts.set(a, (linkCounts.get(a) || 0) + 1);
    if (b && b !== a) linkCounts.set(b, (linkCounts.get(b) || 0) + 1);
  }

  const baseScore = typeof options.baseScore === 'function'
    ? options.baseScore
    : memory => (typeof scoreMemory === 'function'
      ? scoreMemory(memory, tokens, tokens.join(' '), memory.scope === 'workspace' ? memory.workspace : '')
      : 0);

  const utilityBonus = memory => {
    if (!utility) return 0;
    const kind = String(memory.type || '').trim().toLowerCase();
    if (!kind) return 0;
    for (const id of [memory.id, memory.key]) {
      const key = String(id || '').trim();
      if (!key) continue;
      let record = null;
      try { record = utility.get(kind, key); } catch { record = null; }
      if (!record || typeof record !== 'object') continue;
      return finiteNumber(record.verifiedPass, 0) > 0 && finiteNumber(record.verifiedFail, 0) <= 0
        ? UTILITY_BONUS
        : 0;
    }
    return 0;
  };

  const ranked = [];
  for (const memory of Array.isArray(memories) ? memories : []) {
    if (!memory || typeof memory !== 'object') continue;
    if (memory.status === 'superseded') continue;
    if (isUnsafeText(memory.content)) continue;
    if (memory.evidence && isUnsafeText(memory.evidence)) continue;
    const base = Number(baseScore(memory));
    const linkBonus = Math.min(9, (linkCounts.get(String(memory.id || '')) || 0) * 3) / 10;
    ranked.push({
      memory,
      score: round3((Number.isFinite(base) ? base : 0) + linkBonus + utilityBonus(memory))
    });
  }
  ranked.sort((a, b) => (
    b.score - a.score
    || finiteNumber(b.memory.updatedAt, 0) - finiteNumber(a.memory.updatedAt, 0)
    || compareText(a.memory.id, b.memory.id)
  ));
  return ranked;
}

// ---- P2-2 experience graph ------------------------------------------------

function edgeId({ runId, branch, action, failure, repair, timestamp }) {
  return `edge_${stableHash(`${runId}|${branch}|${action}|${failure}|${repair}|${timestamp}`).slice(0, 20)}`;
}

function normalizeEdge(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const branch = clip(raw.branch, EDGE_FIELD_CHARS);
  const action = clip(raw.action, EDGE_FIELD_CHARS);
  const failure = clip(raw.failure, EDGE_FIELD_CHARS);
  const repair = clip(raw.repair, EDGE_FIELD_CHARS);
  if (!branch && !action && !failure && !repair) return null;
  const runId = clip(raw.runId, EDGE_RUN_ID_CHARS);
  const createdAt = finiteNumber(raw.createdAt, 0);
  const id = clip(raw.id, 80) || edgeId({ runId, branch, action, failure, repair, timestamp: createdAt });
  return { id, branch, action, failure, repair, runId, createdAt };
}

function createExperienceGraph(options = {}) {
  const filePath = options.filePath ? String(options.filePath) : '';
  const maxEdges = Math.max(1, Math.min(5000, Math.floor(finiteNumber(options.maxEdges, 500))));

  const edges = [];
  const stored = filePath ? readJson(filePath, null) : null;
  if (stored && Array.isArray(stored.edges)) {
    for (const raw of stored.edges) {
      const edge = normalizeEdge(raw);
      if (edge) edges.push(edge);
    }
  }
  edges.sort((a, b) => b.createdAt - a.createdAt || compareText(a.id, b.id));
  if (edges.length > maxEdges) edges.length = maxEdges;

  function persist(timestamp) {
    if (!filePath) return true;
    try {
      writeJsonAtomic(filePath, { version: GRAPH_VERSION, edges, updatedAt: timestamp });
      return true;
    } catch {
      return false;
    }
  }

  function record(input = {}) {
    const data = input && typeof input === 'object' ? input : {};
    const branch = clip(data.branch, EDGE_FIELD_CHARS);
    const action = clip(data.action, EDGE_FIELD_CHARS);
    const failure = clip(data.failure, EDGE_FIELD_CHARS);
    const repair = clip(data.repair, EDGE_FIELD_CHARS);
    const fields = [branch, action, failure, repair];
    if (!fields.some(Boolean)) return { ok: false, error: 'edge requires at least one non-empty field' };
    if (fields.some(field => containsUnsafeText(field))) return { ok: false, error: 'edge contains unsafe text' };

    const runId = clip(data.runId, EDGE_RUN_ID_CHARS);
    const timestamp = resolveNow(data.now);
    const id = edgeId({ runId, branch, action, failure, repair, timestamp });
    const existing = edges.find(edge => edge.id === id);
    if (existing) return { ok: true, edge: { ...existing }, duplicate: true };

    edges.unshift({ id, branch, action, failure, repair, runId, createdAt: timestamp });
    if (edges.length > maxEdges) edges.length = maxEdges;
    if (!persist(timestamp)) {
      const index = edges.findIndex(edge => edge.id === id);
      if (index >= 0) edges.splice(index, 1);
      return { ok: false, error: 'failed to persist experience graph' };
    }
    return { ok: true, edge: { ...edges[0] } };
  }

  function find(input = {}) {
    const data = input && typeof input === 'object' ? input : {};
    const limit = Math.max(1, Math.min(50, Math.floor(finiteNumber(data.limit, 5))));
    const queryTokens = [...new Set(tokenize(clip(data.query, 200)).filter(token => token.length >= 2))];
    if (!queryTokens.length) return edges.slice(0, limit).map(edge => ({ ...edge }));
    return edges
      .map(edge => {
        const haystack = new Set(tokenize(`${edge.branch} ${edge.action} ${edge.failure} ${edge.repair}`));
        let score = 0;
        for (const token of queryTokens) {
          if (haystack.has(token)) score += token.length >= 4 ? 2 : 1;
        }
        return { edge, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => (
        b.score - a.score
        || b.edge.createdAt - a.edge.createdAt
        || compareText(a.edge.id, b.edge.id)
      ))
      .slice(0, limit)
      .map(item => ({ ...item.edge, score: item.score }));
  }

  function list() {
    return edges.map(edge => ({ ...edge }));
  }

  return { record, find, list };
}

module.exports = {
  distillOutcome,
  planDecay,
  applyDecay,
  buildLinks,
  applyLinks,
  hybridRank,
  createExperienceGraph
};
