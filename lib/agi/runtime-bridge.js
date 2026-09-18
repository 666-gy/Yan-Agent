'use strict';

// Runtime bridge for the AGI capability modules: cross-module orchestration
// that the Electron main process calls at run-completion / run-start /
// memory-read / memory-write time. Keeping it here (instead of in main.js)
// makes every decision unit-testable with the real modules.

const { readJson, writeJsonAtomic } = require('./contracts');
const { createEscalationTracker, raiseEffort } = require('./adaptive-compute');
const { mineSequences, proposeCandidate } = require('./workflow-mining');
const { planDecay, applyDecay } = require('./memory-consolidation');
const { selectVariant: selectTopology, loadHistory: loadTopologyHistory, recordRun: recordTopologyRun, TOPOLOGY_VARIANTS } = require('./topology');

const ESCALATION_DEFAULT_TTL_MS = 30 * 60 * 1000;
const VERIFIED_INDEX_DEFAULT_TTL_MS = 60 * 1000;
const WRITE_TOOLS = Object.freeze(['edit', 'write', 'apply_patch', 'bash', 'task']);
const EDGE_CONTEXT_LIMIT = 3;
const EDGE_CONTEXT_CHARS = 900;

function callSucceeded(call) {
  return call?.ok === true || call?.status === 'completed';
}

function callKey(call) {
  return `${String(call?.tool || call?.name || '')}:${String(call?.file || call?.path || call?.target || '')}`;
}

// Derive the escalation signals a finished run actually proved. Only trailing
// tool failures and explicit acceptance failures count; neutral runs stay neutral.
function runSignals(result) {
  const calls = Array.isArray(result?.toolCalls) ? result.toolCalls : [];
  let consecutiveToolFailures = 0;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    if (callSucceeded(calls[index])) break;
    consecutiveToolFailures += 1;
  }
  let loopRepeats = 0;
  let lastKey = '';
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const key = callKey(calls[index]);
    if (!key || key.endsWith(':')) break;
    if (!lastKey) {
      lastKey = key;
      continue;
    }
    if (key === lastKey) loopRepeats += 1;
    else break;
  }
  const acceptanceFailed = Boolean(
    result?.delivery?.review?.verdict === 'fail'
    || (result?.goal && result.goal.verified === false && result.goal.failure)
    // A review block the model wrote but the runtime dropped (truncated JSON,
    // wrong contractId, missing criteria) is an acceptance signal too: the
    // pelican audit showed silent drops look exactly like "no review".
    || (result?.delivery?.reviewIssues?.blockSeen === true)
  );
  return { consecutiveToolFailures, acceptanceFailed, loopRepeats };
}

// One-shot escalation hint: a run that showed uncertainty raises the effort of
// exactly the next run in the same workspace, then the hint expires.
function createEscalationMemo({ filePath, ttlMs = ESCALATION_DEFAULT_TTL_MS } = {}) {
  return {
    noteRun({ workspace = '', result, now = Date.now() } = {}) {
      const signals = runSignals(result);
      const tracker = createEscalationTracker();
      for (let index = 0; index < signals.consecutiveToolFailures; index += 1) {
        tracker.observe({ type: 'tool', ok: false });
      }
      if (signals.acceptanceFailed) tracker.observe({ type: 'acceptance', ok: false });
      for (let index = 0; index < signals.loopRepeats; index += 1) {
        tracker.observe({ type: 'loop', key: 'repeat' });
      }
      const decision = tracker.decide();
      if (!decision.escalate) return { escalated: false, signals };
      const steps = decision.tier >= 2 ? 2 : 1;
      writeJsonAtomic(filePath, {
        version: 1,
        pending: {
          workspace: String(workspace || ''),
          steps,
          bestOfN: decision.bestOfN,
          reason: decision.reason,
          at: now
        }
      });
      return { escalated: true, steps, bestOfN: decision.bestOfN, reason: decision.reason, signals };
    },

    consume({ workspace = '', now = Date.now() } = {}) {
      const state = readJson(filePath, null);
      const pending = state?.pending;
      if (!pending) return null;
      if (now - (Number(pending.at) || 0) > ttlMs) {
        writeJsonAtomic(filePath, { version: 1, pending: null });
        return null;
      }
      if (pending.workspace && workspace && pending.workspace !== String(workspace)) return null;
      writeJsonAtomic(filePath, { version: 1, pending: null });
      return {
        steps: Number(pending.steps) || 1,
        bestOfN: Math.max(1, Number(pending.bestOfN) || 1),
        reason: String(pending.reason || '')
      };
    }
  };
}

function raiseReasoningSpeed(base, steps = 1) {
  return raiseEffort(base, steps);
}

// Cached index of runIds whose recorded trajectory passed delivery verification;
// used to up-rank memories that were later confirmed by real use.
function createVerifiedRunIndex({ store, ttlMs = VERIFIED_INDEX_DEFAULT_TTL_MS } = {}) {
  let cachedAt = 0;
  let ids = new Set();
  const refresh = now => {
    cachedAt = now;
    ids = new Set((store.list({ limit: 500 }) || [])
      .filter(record => record?.verificationVerdict === 'pass')
      .map(record => String(record.runId || ''))
      .filter(Boolean));
  };
  return {
    ids({ now = Date.now() } = {}) {
      if (now - cachedAt > ttlMs) refresh(now);
      return ids;
    },
    has(runId, { now = Date.now() } = {}) {
      if (now - cachedAt > ttlMs) refresh(now);
      return ids.has(String(runId || ''));
    }
  };
}

// P0-5 simplified forgetting: decay only stale low-frequency memories, never
// delete and never touch protected types. Writes only when something changed.
function maintainMemoryStore({ longTermMemory, memoryPath, workspace = '', now = Date.now() } = {}) {
  if (!longTermMemory || !memoryPath) return { updated: 0 };
  const stores = longTermMemory.getStores(workspace);
  const targets = [[stores.global, memoryPath]];
  if (stores.localPath) targets.push([stores.local, stores.localPath]);
  let updated = 0;
  for (const [store, file] of targets) {
    if (!Array.isArray(store?.memories) || !store.memories.length) continue;
    const plan = planDecay(store.memories, { now });
    if (!plan.items.length) continue;
    const result = applyDecay(store, plan, { now });
    if (result.updated > 0) {
      store.updatedAt = now;
      writeJsonAtomic(file, store);
      updated += result.updated;
    }
  }
  return { updated };
}

// P1-1: mine tool sequences that recur across multiple runs of the same
// workspace and turn them into structured Skill candidates (drafts that still
// need P0-1 validation before promotion).
function collectWorkflowProposals({ runs = [], minRuns = 2, minLength = 4, maxProposals = 3 } = {}) {
  const byChain = new Map();
  for (const run of Array.isArray(runs) ? runs.slice(0, 100) : []) {
    const steps = Array.isArray(run?.steps) ? run.steps.slice(0, 60) : [];
    if (steps.length < minLength) continue;
    const sequences = mineSequences(steps, { minLength, minOccurrences: 1, maxSequences: 40 });
    for (const sequence of sequences) {
      if (!sequence.tools.some(tool => WRITE_TOOLS.includes(String(tool || '').toLowerCase()))) continue;
      const key = sequence.tools.join('>');
      const entry = byChain.get(key) || { sequence, runIds: new Set(), allOk: true };
      entry.runIds.add(String(run.runId || ''));
      entry.allOk = entry.allOk && steps.every(step => step?.ok !== false);
      byChain.set(key, entry);
    }
  }
  const proposals = [];
  const seen = new Set();
  for (const entry of [...byChain.values()]
    .filter(item => item.runIds.size >= minRuns)
    .sort((left, right) => right.runIds.size - left.runIds.size || right.sequence.length - left.sequence.length)) {
    if (proposals.length >= maxProposals) break;
    const candidate = proposeCandidate(entry.sequence, {
      postconditions: entry.allOk ? ['序列内全部工具调用成功完成'] : [],
      evidence: `同一工作流在 ${entry.runIds.size} 个已验证运行中重复出现：${entry.sequence.tools.join(' -> ')}`
    });
    if (!candidate || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    proposals.push(candidate);
  }
  return proposals;
}

// Only trajectory records whose run actually passed delivery verification
// count as "已验证运行" for workflow mining. Before this filter, any run that
// merely finished without a fail verdict (including runs with no review at
// all) was treated as verified and fed skill candidates.
function verifiedRunsFromTrajectories(records, workspace = '') {
  return (Array.isArray(records) ? records : [])
    .filter(record => String(record?.workspace || '') === String(workspace))
    .filter(record => record?.verificationVerdict === 'pass')
    .map(record => ({ runId: String(record?.runId || ''), steps: Array.isArray(record?.steps) ? record.steps : [] }))
    .filter(record => record.runId);
}

// Renders recent failure→repair edges as a bounded, data-only prompt block.
function collectExperienceEdgeContext(graph, query, { limit = EDGE_CONTEXT_LIMIT, maxChars = EDGE_CONTEXT_CHARS } = {}) {
  if (!graph || typeof graph.find !== 'function') return '';
  const edges = graph.find({ query: String(query || ''), limit: Math.max(1, Math.min(5, limit)) }) || [];
  const lines = edges
    .filter(edge => edge.failure || edge.repair)
    .map(edge => {
      const parts = [];
      if (edge.action) parts.push(`场景：${edge.action}`);
      if (edge.failure) parts.push(`失败：${edge.failure}`);
      if (edge.repair) parts.push(`修复：${edge.repair}`);
      return `- ${parts.join('；')}`;
    })
    .filter(Boolean);
  if (!lines.length) return '';
  return lines.join('\n').slice(0, Math.max(80, maxChars));
}

// Topology selection for a run: only a passing, persisted eval evidence record
// plus enough paired history can move the run off the baseline role order.
// Roles are advisory role-id preferences for the subagent system prompt —
// the scheduler keeps its own concurrency rules.
function selectTopologyForRun({ historyFile, evidenceFile } = {}) {
  const stored = readJson(evidenceFile, null);
  const evidence = stored && stored.ok === true ? stored : null;
  const selection = selectTopology({ history: loadTopologyHistory(historyFile), evidence });
  if (!selection?.active) return selection;
  const variant = TOPOLOGY_VARIANTS.find(entry => entry.id === selection.variantId) || null;
  return {
    ...selection,
    roles: variant ? variant.roles.map(role => role.role) : [],
    concurrency: variant?.concurrency || 1
  };
}

function recordTopologyOutcome({ historyFile, variantId = '', runId = '', ok = false, cost = 1 } = {}) {
  return recordTopologyRun(historyFile, {
    variantId: variantId || 'baseline',
    runId,
    ok: ok === true,
    cost
  });
}

module.exports = {
  collectExperienceEdgeContext,
  collectWorkflowProposals,
  createEscalationMemo,
  createVerifiedRunIndex,
  maintainMemoryStore,
  raiseReasoningSpeed,
  recordTopologyOutcome,
  runSignals,
  selectTopologyForRun,
  verifiedRunsFromTrajectories
};
