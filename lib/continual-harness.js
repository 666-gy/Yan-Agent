const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  containsSensitiveMemoryText,
  containsUnsafeMemoryText,
  tokenize
} = require('./long-term-memory');
const {
  derivePolicyControls,
  isPolicyEntry,
  normalizePolicies,
  policyContext: renderPolicyContext,
  policyId
} = require('./behavior-policy');

const HARNESS_VERSION = 1;
const HARNESS_KINDS = Object.freeze(['prompt', 'memory', 'skill', 'subagent']);
const HARNESS_KIND_LABELS = Object.freeze({
  prompt: '策略',
  memory: '记忆',
  skill: '技能',
  subagent: '子代理'
});
const HARNESS_SCOPES = Object.freeze(['global', 'workspace']);
const MAX_REFINEMENTS = 500;
const MAX_ENTRIES_PER_KIND = 500;
const USAGE_HISTORY_LIMIT = 20;
const DEMOTE_AFTER_CONSECUTIVE_FAILURES = 3;
const CONTENT_LIMITS = Object.freeze({
  prompt: 6_000,
  memory: 2_000,
  skill: 12_000,
  subagent: 8_000
});

function now() {
  return Date.now();
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clip(value, max) {
  return String(value || '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function normalizeId(value, fallback = '') {
  const id = String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return id || fallback;
}

function normalizeScope(value) {
  return value === 'workspace' ? 'workspace' : 'global';
}

function normalizeWorkspace(workspace) {
  const value = String(workspace || '').trim();
  if (!value) return '';
  try { return path.resolve(value); } catch { return value; }
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function emptyEntries() {
  return { prompt: {}, memory: {}, skill: {}, subagent: {} };
}

function emptyState(scope = 'global') {
  return {
    schema: HARNESS_VERSION,
    scope: normalizeScope(scope),
    revision: 0,
    entries: emptyEntries(),
    refinements: [],
    updatedAt: 0,
    // Direct-write preservation: entry kinds outside HARNESS_KINDS and
    // unknown top-level keys survive load→save untouched (see normalizeState).
    externalEntries: {},
    preserved: {}
  };
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try { return JSON.parse(JSON.stringify(value)); } catch { return {}; }
}

function normalizeEntry(raw, kind, id, scope) {
  if (raw == null) return null;
  // Direct-write tolerance: the model may hand-edit harness-state.json
  // without the exact schema. A scalar becomes the content verbatim and an
  // object without usable content keeps its whole shape as JSON — marked
  // source 'direct-write' so audits can tell hand-edits from tool writes.
  // Nothing the model wrote may silently disappear in normalization.
  if (typeof raw !== 'object') {
    return {
      id, kind,
      title: clip(id, 160),
      content: clip(String(raw), CONTENT_LIMITS[kind]),
      path: 'direct-write', scope, metadata: {}, source: 'direct-write',
      createdAt: now(), updatedAt: now(), version: 1
    };
  }
  const rawContent = typeof raw.content === 'string'
    ? raw.content
    : (raw.content == null ? '' : JSON.stringify(raw.content));
  const directWrite = !rawContent.trim();
  const content = clip(directWrite ? JSON.stringify(raw) : rawContent, CONTENT_LIMITS[kind]);
  if (!content) return null;
  const entry = {
    id,
    kind,
    title: clip(raw.title || id, 160),
    content,
    path: clip(raw.path || (directWrite ? 'direct-write' : 'general'), 160),
    scope,
    metadata: plainObject(raw.metadata),
    source: clip(raw.source || (directWrite ? 'direct-write' : 'migration'), 80),
    createdAt: Number(raw.createdAt || raw.created_at) || now(),
    updatedAt: Number(raw.updatedAt || raw.updated_at) || now(),
    version: Math.max(1, Number(raw.version) || 1)
  };
  // Direct-write extras: unknown scalar fields survive the round-trip.
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in entry) && typeof value !== 'object') entry[key] = value;
  }
  return entry;
}

function normalizeState(raw, scope) {
  const state = emptyState(scope);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return state;
  state.revision = Math.max(0, Number(raw.revision) || 0);
  for (const kind of HARNESS_KINDS) {
    const records = raw.entries?.[kind];
    if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
    for (const [rawId, rawEntry] of Object.entries(records)) {
      const id = normalizeId(rawId);
      const entry = id ? normalizeEntry(rawEntry, kind, id, state.scope) : null;
      if (entry) state.entries[kind][id] = entry;
    }
  }
  // Direct-write preservation: entry kinds outside the known set (the model
  // hand-edited its own bucket) and unknown top-level keys are kept verbatim
  // so a load→save round-trip never deletes what the model wrote. Known-kinds
  // entries are normalized; anything dropped by a failed normalize is still
  // recoverable from the refinement snapshots.
  for (const [kind, records] of Object.entries(raw.entries || {})) {
    if (HARNESS_KINDS.includes(kind) || !records || typeof records !== 'object' || Array.isArray(records)) continue;
    if (!state.externalEntries) state.externalEntries = {};
    state.externalEntries[kind] = records;
  }
  const knownKeys = new Set(['schema', 'version', 'revision', 'scope', 'entries', 'refinements', 'updatedAt', 'externalEntries', 'preserved']);
  for (const [key, value] of Object.entries(raw)) {
    if (!knownKeys.has(key) && value !== undefined) {
      if (!state.preserved) state.preserved = {};
      state.preserved[key] = value;
    }
  }
  state.refinements = (Array.isArray(raw.refinements) ? raw.refinements : [])
    .filter(item => item && typeof item === 'object')
    .slice(-MAX_REFINEMENTS);
  state.updatedAt = Number(raw.updatedAt) || 0;
  return state;
}

function readState(filePath, scope) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return emptyState(scope);
    return normalizeState(JSON.parse(fs.readFileSync(filePath, 'utf8')), scope);
  } catch {
    return emptyState(scope);
  }
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function withStateLockAsync(statePath, callback, { timeoutMs = 5_000, staleMs = 30_000 } = {}) {
  const lockPath = `${statePath}.lock`;
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const deadline = Date.now() + Math.max(250, Number(timeoutMs) || 5_000);
  let descriptor = null;
  while (descriptor === null) {
    try {
      descriptor = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${process.pid}\n${Date.now()}\n`, 'utf8');
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {}
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for Harness state lock: ${statePath}`);
      // 等待必须让出事件循环:主进程里 Atomics.wait 自旋会冻结全部 IPC/渲染/定时器
      await sleep(10);
    }
  }
  try {
    return await callback();
  } finally {
    try { fs.closeSync(descriptor); } catch {}
    try { fs.rmSync(lockPath, { force: true }); } catch {}
  }
}

// Usage bookkeeping (attribution counters and the timestamp that goes with
// them) is telemetry, not a semantic edit: it must not make an entry look
// changed to the revision-conflict check or block a rollback that restores it.
// Version/content changes from real refinements still change the fingerprint.
function entryFingerprint(entry) {
  if (!entry || typeof entry !== 'object') return stableHash(JSON.stringify(entry || null));
  const comparable = { ...entry };
  delete comparable.updatedAt;
  if (comparable.metadata && typeof comparable.metadata === 'object') {
    comparable.metadata = { ...comparable.metadata };
    delete comparable.metadata.usage;
  }
  return stableHash(JSON.stringify(comparable));
}

function stateFileForWorkspace(workspace, yanagentDir) {
  const root = normalizeWorkspace(workspace);
  return root ? path.join(root, yanagentDir, 'harness', 'harness-state.json') : '';
}

function snapshotPathFor(statePath, refinementId) {
  return path.join(path.dirname(statePath), 'snapshots', `${normalizeId(refinementId, 'refinement')}.json`);
}

function normalizeEdit(edit = {}, fallbackScope = 'global') {
  const kind = HARNESS_KINDS.includes(edit.kind) ? edit.kind : '';
  const action = ['create', 'update', 'delete'].includes(edit.action) ? edit.action : '';
  const id = normalizeId(edit.id || (action === 'create' ? edit.title : ''), kind || 'entry');
  return {
    action,
    kind,
    id,
    title: clip(edit.title, 160),
    content: kind ? clip(edit.content, CONTENT_LIMITS[kind]) : '',
    path: clip(edit.path || 'general', 160),
    scope: normalizeScope(edit.scope || fallbackScope),
    metadata: plainObject(edit.metadata),
    reason: clip(edit.reason, 800)
  };
}

function validateEdit(edit, stateScope) {
  if (!edit.action) return 'unsupported action';
  if (!edit.kind) return 'unsupported kind';
  if (!edit.id) return 'missing id';
  if (edit.scope !== stateScope) return `scope ${edit.scope} does not match ${stateScope}`;
  if (edit.kind === 'prompt' && edit.id === 'base-system-prompt') return 'base system prompt is immutable';
  if (edit.action !== 'delete' && (!edit.title || !edit.content)) return `${edit.action} requires title and content`;
  if (edit.action !== 'delete' && (
    containsUnsafeMemoryText(edit.content)
    || containsSensitiveMemoryText(edit.content)
  )) return 'content failed the harness safety policy';
  return '';
}

function refinementId() {
  return `refine_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 17)}_${crypto.randomBytes(2).toString('hex')}`;
}

function scoreEntry(entry, queryTokens) {
  if (!queryTokens.length) return Number(entry.updatedAt) || 0;
  const entryTokens = new Set(tokenize(`${entry.title} ${entry.path} ${entry.content}`));
  let score = 0;
  for (const token of queryTokens) {
    if (entryTokens.has(token)) score += token.length >= 4 ? 3 : 1;
  }
  if (entry.metadata?.status === 'active') score += 1;
  score += Math.min(0.99, (Number(entry.updatedAt) || 0) / 1e16);
  return score;
}

function usageBookkeeping(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const runs = value => (Array.isArray(value) ? value.map(item => clip(item, 120)).filter(Boolean) : []);
  return {
    injectedRuns: runs(source.injectedRuns).slice(-USAGE_HISTORY_LIMIT),
    successes: runs(source.successes).slice(-USAGE_HISTORY_LIMIT),
    failures: runs(source.failures).slice(-USAGE_HISTORY_LIMIT),
    consecutiveFailures: Math.max(0, Number(source.consecutiveFailures) || 0),
    lastInjectedAt: Number(source.lastInjectedAt) || 0,
    lastOutcomeAt: Number(source.lastOutcomeAt) || 0
  };
}

// Explicit user/agent instructions are the evidence for their own activation;
// repeated bad outcomes cannot silently revoke them - only the user (or a
// rollback) can. Mined, advisory entries stay fully demotable.
function isDemotionProtected(entry) {
  return entry?.metadata?.enforcement === 'mandatory'
    || entry?.metadata?.basis === 'explicit_user_statement';
}

// Normal mode may USE experience that already proved itself (at least one
// successful attributed run, not losing on failures, and not protected-but-
// demoted content). Creating, promoting and demoting experience stays inside
// evolution mode.
function isVerifiedExperience(entry) {
  if (entry?.metadata?.status !== 'active') return false;
  if (isDemotionProtected(entry)) return true;
  const usage = entry.metadata?.usage || {};
  const successes = Array.isArray(usage.successes) ? usage.successes.length : 0;
  const failures = Array.isArray(usage.failures) ? usage.failures.length : 0;
  const consecutiveFailures = Number(usage.consecutiveFailures) || 0;
  if (consecutiveFailures >= 2) return false;
  return successes >= 1 && successes >= failures;
}

class ContinualHarnessStore {
  constructor({ globalPath, yanagentDir = '.yanagent' }) {
    this.globalPath = globalPath;
    this.yanagentDir = yanagentDir;
  }

  statePath({ scope = 'global', workspace = '' } = {}) {
    return normalizeScope(scope) === 'workspace'
      ? stateFileForWorkspace(workspace, this.yanagentDir)
      : this.globalPath;
  }

  load({ scope = 'global', workspace = '' } = {}) {
    const normalizedScope = normalizeScope(scope);
    const statePath = this.statePath({ scope: normalizedScope, workspace });
    if (!statePath) return emptyState(normalizedScope);
    return readState(statePath, normalizedScope);
  }

  revision(options = {}) {
    return this.load(options).revision;
  }

  list({ workspace = '', kind = '', includeInactive = true } = {}) {
    const states = [this.load({ scope: 'global' })];
    if (workspace) states.push(this.load({ scope: 'workspace', workspace }));
    const kinds = HARNESS_KINDS.includes(kind) ? [kind] : HARNESS_KINDS;
    return states.flatMap(state => kinds.flatMap(currentKind => Object.values(state.entries[currentKind])))
      .filter(entry => includeInactive || entry.metadata?.status === 'active')
      .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
  }

  activePolicies({ workspace = '', query = '', maxChars = 12_000, maxEntries = 64 } = {}) {
    return normalizePolicies(this.list({ workspace, includeInactive: false }), {
      query,
      maxChars,
      maxEntries
    });
  }

  // Self-evolution mode injection: only the entries relevant to the current
  // task, never the whole store. Policy-shaped entries come back separately
  // (they drive behavior controls and render in the authoritative-policy
  // block); every other kind is rendered as a kind-labelled experience list.
  evolutionContext({ workspace = '', query = '', maxChars = 6_000, maxEntries = 6, perEntryChars = 1_800, requireVerified = false } = {}) {
    const queryTokens = tokenize(query);
    const candidates = this.list({ workspace, includeInactive: false })
      .filter(entry => !requireVerified || isVerifiedExperience(entry))
      .map(entry => ({ entry, score: scoreEntry(entry, queryTokens) }))
      .sort((left, right) => (
      right.score - left.score
        || (Number(right.entry.updatedAt) || 0) - (Number(left.entry.updatedAt) || 0)
        || String(left.entry.id).localeCompare(String(right.entry.id))
      ));
    const budget = Math.max(480, Number(maxChars) || 6_000);
    const entryLimit = Math.max(1, Number(maxEntries) || 6);
    const perEntry = Math.max(240, Number(perEntryChars) || 1_800);
    const selected = [];
    let used = 0;
    for (const candidate of candidates) {
      if (selected.length >= entryLimit) break;
      const remaining = budget - used;
      if (remaining < 400) break;
      const content = clip(candidate.entry.content, Math.min(perEntry, Math.max(240, remaining - 160)));
      if (!content) continue;
      selected.push({ entry: candidate.entry, content });
      used += content.length + 160;
    }
    const policies = selected
      .filter(item => isPolicyEntry(item.entry))
      .map(item => ({ ...item.entry, content: item.content }));
    const text = selected
      .filter(item => !isPolicyEntry(item.entry))
      .map(item => `- [${HARNESS_KIND_LABELS[item.entry.kind] || item.entry.kind}; ${item.entry.scope}:${item.entry.id}] ${item.content}`)
      .join('\n');
    return { entries: selected.map(item => item.entry), policies, text };
  }

  policyContext(options = {}) {
    return renderPolicyContext(this.list({
      workspace: options.workspace || '',
      includeInactive: false
    }), options);
  }

  // Older versions recorded an explicit user refinement as a rejected empty
  // event when the isolated reviewer failed to return JSON. Recover those
  // user-authored policies once so an upgrade does not discard the user's
  // durable instruction.
  async recoverRejectedAgentRefinements({ scope = 'global', workspace = '', maxItems = 64 } = {}) {
    const normalizedScope = normalizeScope(scope);
    const state = this.load({ scope: normalizedScope, workspace });
    const recovered = [];
    for (const event of state.refinements
      .filter(item => item?.source === 'agent_refine')
      .filter(item => item?.outcomeStatus === 'rejected')
      .filter(item => !Array.isArray(item?.appliedEdits) || item.appliedEdits.length === 0)
      .slice(-Math.max(1, Number(maxItems) || 64))) {
      const instructions = String(event.trigger || '')
        .replace(/^Agent-requested refinement:\s*/iu, '')
        .trim();
      if (!instructions) continue;
      const id = `prompt-${policyId(instructions).replace(/^user-policy-/u, '')}`.slice(0, 100);
      const current = this.load({ scope: normalizedScope, workspace });
      const existing = current.entries.prompt[id];
      if (['active', 'deleted'].includes(existing?.metadata?.status)) continue;
      const result = await this.apply({
        id: `recover-${event.id}`,
        trigger: `Recovered explicit user policy from ${event.id}`,
        evidence: 'The policy was explicitly requested by the user in a prior agent refinement.',
        expectedOutcome: 'Make the explicit user policy active for future relevant tasks.',
        edits: [{
          action: existing ? 'update' : 'create',
          kind: 'prompt',
          id,
          title: 'Explicit user policy',
          content: instructions,
          path: 'user-policy',
          scope: normalizedScope,
          metadata: {
            status: 'active',
            enforcement: 'mandatory',
            basis: 'explicit_user_statement',
            controls: derivePolicyControls(instructions),
            recoveredFrom: event.id
          },
          reason: 'Explicit user instruction recovered during Harness migration.'
        }]
      }, {
        scope: normalizedScope,
        workspace,
        expectedRevision: current.revision,
        baselineState: current,
        source: 'policy_recovery',
        runId: event.sourceRunId,
        sessionId: event.sourceSessionId
      });
      const applied = result.ok && (result.refinement?.appliedEdits || [])
        .some(edit => edit.applied === true && edit.kind === 'prompt' && edit.id === id);
      if (!applied) continue;
      await this.recordOutcome(result.refinement.id, {
        status: 'partial',
        evidence: `Recovered and activated explicit policy from rejected refinement ${event.id}.`
      }, { scope: normalizedScope, workspace });
      recovered.push(result.refinement.id);
    }
    return recovered;
  }

  get(kind, id, { scope = 'global', workspace = '' } = {}) {
    if (!HARNESS_KINDS.includes(kind)) return null;
    return this.load({ scope, workspace }).entries[kind][normalizeId(id)] || null;
  }

  async apply(proposal = {}, options = {}) {
    const scope = normalizeScope(options.scope || proposal.scope);
    const workspace = normalizeWorkspace(options.workspace);
    const statePath = this.statePath({ scope, workspace });
    if (!statePath) return { ok: false, conflict: false, error: 'Workspace harness requires a workspace.' };
    if (options._stateLockHeld !== true) {
      try {
        return await withStateLockAsync(statePath, () => this.apply(proposal, { ...options, _stateLockHeld: true }));
      } catch (error) {
        return { ok: false, conflict: false, error: error?.message || String(error) };
      }
    }
    const state = readState(statePath, scope);
    if (options.expectedRevision !== undefined && Number(options.expectedRevision) !== state.revision) {
      const baseline = options.baselineState;
      const touchedEntriesUnchanged = baseline && (Array.isArray(proposal.edits) ? proposal.edits : []).every(rawEdit => {
        const edit = normalizeEdit(rawEdit, scope);
        return entryFingerprint(state.entries[edit.kind]?.[edit.id])
          === entryFingerprint(baseline.entries?.[edit.kind]?.[edit.id]);
      });
      if (!touchedEntriesUnchanged) {
        return {
          ok: false,
          conflict: true,
          error: `Harness changed during refinement planning (${options.expectedRevision} -> ${state.revision}).`,
          revision: state.revision
        };
      }
    }

    const id = normalizeId(options.id || proposal.id, refinementId());
    const beforeState = clone(state);
    const appliedEdits = [];
    for (const rawEdit of Array.isArray(proposal.edits) ? proposal.edits : []) {
      const edit = normalizeEdit(rawEdit, scope);
      const error = validateEdit(edit, scope);
      const records = edit.kind ? state.entries[edit.kind] : null;
      const before = records ? clone(records[edit.id]) : undefined;
      // A user-deleted entry is a durable tombstone. Background reviewers
      // and stale runs must not reactivate it; explicit rollback can undo it.
      if (before?.metadata?.status === 'deleted') {
        appliedEdits.push({ ...edit, before, applied: false, error: 'entry was deleted by the user; explicitly roll back its deletion to restore it' });
        continue;
      }
      if (error) {
        appliedEdits.push({ ...edit, before, applied: false, error });
        continue;
      }
      if (edit.action === 'create' && before) {
        appliedEdits.push({ ...edit, before, applied: false, error: 'entry already exists' });
        continue;
      }
      if ((edit.action === 'update' || edit.action === 'delete') && !before) {
        appliedEdits.push({ ...edit, applied: false, error: 'entry not found' });
        continue;
      }
      if (edit.action === 'delete') {
        delete records[edit.id];
        appliedEdits.push({ ...edit, before, applied: true });
        continue;
      }
      const timestamp = now();
      const after = {
        id: edit.id,
        kind: edit.kind,
        title: edit.title,
        content: edit.content,
        path: edit.path,
        scope,
        metadata: {
          ...edit.metadata,
          // Usage bookkeeping is owned by result attribution; a later
          // refinement update must not silently reset it.
          ...(edit.metadata.usage === undefined && before?.metadata?.usage !== undefined
            ? { usage: before.metadata.usage }
            : {}),
          status: clip(edit.metadata.status || 'active', 40)
        },
        source: clip(options.source || proposal.source || 'refine', 80),
        createdAt: before?.createdAt || timestamp,
        updatedAt: timestamp,
        version: before ? before.version + 1 : 1
      };
      records[edit.id] = after;
      appliedEdits.push({ ...edit, before, after: clone(after), applied: true });
    }

    const timestamp = now();
    const event = {
      id,
      scope,
      trigger: clip(proposal.trigger || proposal.summary, 1_000),
      evidence: clip(proposal.evidence || proposal.rationale, 2_000),
      expectedOutcome: clip(proposal.expectedOutcome, 1_000),
      outcome: '',
      outcomeStatus: 'pending',
      source: clip(options.source || proposal.source || 'refine', 80),
      sourceRunId: clip(options.runId || proposal.runId, 120),
      sourceSessionId: clip(options.sessionId || proposal.sessionId, 120),
      appliedEdits,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    state.refinements.push(event);
    state.refinements = state.refinements.slice(-MAX_REFINEMENTS);
    for (const kind of HARNESS_KINDS) {
      const entries = Object.values(state.entries[kind]);
      if (entries.length <= MAX_ENTRIES_PER_KIND) continue;
      const keep = new Set(entries
        .sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt))
        .slice(0, MAX_ENTRIES_PER_KIND)
        .map(entry => entry.id));
      for (const entryId of Object.keys(state.entries[kind])) {
        if (!keep.has(entryId) && state.entries[kind][entryId].metadata?.status !== 'deleted') delete state.entries[kind][entryId];
      }
    }
    state.revision += 1;
    state.updatedAt = timestamp;
    atomicWrite(snapshotPathFor(statePath, id), beforeState);
    atomicWrite(statePath, state);
    return { ok: true, conflict: false, refinement: event, revision: state.revision, statePath };
  }

  async recordOutcome(refinementIdValue, outcome = {}, options = {}) {
    const scope = normalizeScope(options.scope);
    const statePath = this.statePath({ scope, workspace: options.workspace });
    if (!statePath) return { ok: false, error: 'Workspace harness requires a workspace.' };
    if (options._stateLockHeld !== true) {
      try {
        return await withStateLockAsync(statePath, () => this.recordOutcome(refinementIdValue, outcome, {
          ...options,
          _stateLockHeld: true
        }));
      } catch (error) {
        return { ok: false, error: error?.message || String(error) };
      }
    }
    const state = readState(statePath, scope);
    const event = state.refinements.find(item => item.id === refinementIdValue);
    if (!event) return { ok: false, error: 'Refinement not found.' };
    if (event.outcomeStatus === 'rolled_back') return { ok: false, error: 'Rolled-back refinement outcomes are immutable.' };
    event.outcomeStatus = ['verified', 'rejected', 'partial', 'rolled_back'].includes(outcome.status)
      ? outcome.status
      : 'pending';
    event.outcome = clip(outcome.evidence || outcome.outcome, 2_000);
    event.updatedAt = now();
    state.revision += 1;
    state.updatedAt = event.updatedAt;
    atomicWrite(statePath, state);
    return { ok: true, refinement: event, revision: state.revision };
  }

  // Result attribution for entries an earlier run actually injected. The
  // counters are bookkeeping; the only state change is demotion, and it
  // requires DEMOTE_AFTER_CONSECUTIVE_FAILURES consecutive verified failures
  // on an entry the user did not explicitly make mandatory. A demoted entry
  // must re-earn activation through the normal evidence gate.
  async recordUsage(usage = {}, options = {}) {
    const outcome = usage.outcome === 'success' || usage.outcome === 'failure' ? usage.outcome : '';
    const runId = clip(usage.runId, 120);
    if (!outcome || !runId) return { ok: false, error: 'Usage attribution requires an outcome and a runId.' };
    const injectedAt = Number(usage.injectedAt) || 0;
    const workspace = normalizeWorkspace(options.workspace);
    const groups = new Map();
    for (const item of Array.isArray(usage.entries) ? usage.entries : []) {
      const kind = HARNESS_KINDS.includes(item?.kind) ? item.kind : '';
      const id = normalizeId(item?.id);
      if (!kind || !id) continue;
      const scope = normalizeScope(item?.scope);
      if (scope === 'workspace' && !workspace) continue;
      if (!groups.has(scope)) groups.set(scope, []);
      groups.get(scope).push({ kind, id });
    }
    const updated = [];
    const demoted = [];
    for (const [scope, items] of groups) {
      const statePath = this.statePath({ scope, workspace });
      if (!statePath) continue;
      try {
        await withStateLockAsync(statePath, async () => {
          const state = readState(statePath, scope);
          const timestamp = now();
          const demotionEdits = [];
          let changed = false;
          for (const item of items) {
            const entry = state.entries[item.kind]?.[item.id];
            if (!entry || entry.metadata?.status === 'deleted') continue;
            const book = usageBookkeeping(entry.metadata?.usage);
            if (!book.injectedRuns.includes(runId)) book.injectedRuns.push(runId);
            book.injectedRuns = book.injectedRuns.slice(-USAGE_HISTORY_LIMIT);
            book.lastInjectedAt = injectedAt || book.lastInjectedAt || timestamp;
            if (outcome === 'success') {
              if (!book.successes.includes(runId)) book.successes.push(runId);
              book.successes = book.successes.slice(-USAGE_HISTORY_LIMIT);
              book.consecutiveFailures = 0;
            } else {
              if (!book.failures.includes(runId)) book.failures.push(runId);
              book.failures = book.failures.slice(-USAGE_HISTORY_LIMIT);
              book.consecutiveFailures += 1;
            }
            book.lastOutcomeAt = timestamp;
            const before = clone(entry);
            entry.metadata = { ...entry.metadata, usage: book };
            entry.updatedAt = timestamp;
            if (
              outcome === 'failure'
              && book.consecutiveFailures >= DEMOTE_AFTER_CONSECUTIVE_FAILURES
              && entry.metadata.status === 'active'
              && !isDemotionProtected(entry)
            ) {
              entry.metadata = {
                ...entry.metadata,
                status: 'observing',
                demotion: {
                  at: timestamp,
                  reason: 'consecutive_verified_failures',
                  consecutiveFailures: book.consecutiveFailures,
                  runId
                }
              };
              demotionEdits.push({
                action: 'update',
                kind: item.kind,
                id: item.id,
                title: entry.title,
                content: entry.content,
                path: entry.path,
                scope,
                before,
                after: clone(entry),
                applied: true,
                reason: `Injected during ${book.consecutiveFailures} consecutive runs that ended in a verified failure.`
              });
              demoted.push({ kind: item.kind, id: item.id, scope, consecutiveFailures: book.consecutiveFailures });
            }
            updated.push({ kind: item.kind, id: item.id, scope, status: entry.metadata.status });
            changed = true;
          }
          if (!changed) return;
          if (demotionEdits.length) {
            const event = {
              id: refinementId(),
              scope,
              trigger: `Usage attribution: ${demotionEdits.length} entry(ies) demoted after repeated failed use`,
              evidence: clip(demotionEdits.map(edit => edit.reason).join('\n'), 2_000),
              expectedOutcome: 'Stop injecting entries that keep coinciding with verified failures until fresh evidence re-activates them.',
              outcome: 'Entries returned to observing through result attribution.',
              outcomeStatus: 'verified',
              source: 'usage_attribution',
              sourceRunId: runId,
              sourceSessionId: clip(usage.sessionId, 120),
              appliedEdits: demotionEdits,
              createdAt: timestamp,
              updatedAt: timestamp
            };
            state.refinements.push(event);
            state.refinements = state.refinements.slice(-MAX_REFINEMENTS);
          }
          state.revision += 1;
          state.updatedAt = timestamp;
          atomicWrite(statePath, state);
        });
      } catch (error) {
        return { ok: false, error: error?.message || String(error), updated, demoted };
      }
    }
    return { ok: true, outcome, updated, demoted };
  }

  async rollback(targetId, options = {}) {
    const scope = normalizeScope(options.scope);
    const statePath = this.statePath({ scope, workspace: options.workspace });
    if (!statePath) return { ok: false, error: 'Workspace harness requires a workspace.' };
    if (options._stateLockHeld !== true) {
      try {
        return await withStateLockAsync(statePath, () => this.rollback(targetId, { ...options, _stateLockHeld: true }));
      } catch (error) {
        return { ok: false, error: error?.message || String(error) };
      }
    }
    const state = readState(statePath, scope);
    const beforeState = clone(state);
    const target = state.refinements.find(item => item.id === targetId);
    if (!target) return { ok: false, error: 'Refinement not found.' };
    const rollbackEdits = [];
    for (const edit of [...(target.appliedEdits || [])].reverse()) {
      if (!edit.applied || !HARNESS_KINDS.includes(edit.kind)) continue;
      const current = state.entries[edit.kind][edit.id];
      if (entryFingerprint(current) !== entryFingerprint(edit.after)) {
        rollbackEdits.push({ kind: edit.kind, id: edit.id, applied: false, error: 'entry changed after target refinement' });
        continue;
      }
      if (edit.before) state.entries[edit.kind][edit.id] = clone(edit.before);
      else delete state.entries[edit.kind][edit.id];
      rollbackEdits.push({ kind: edit.kind, id: edit.id, before: clone(current), after: clone(edit.before), applied: true });
    }
    const id = refinementId();
    const timestamp = now();
    const event = {
      id,
      scope,
      trigger: `Rollback ${targetId}`,
      evidence: clip(options.evidence || 'Explicit rollback request.', 2_000),
      expectedOutcome: 'Restore only entries that have not changed since the target refinement.',
      outcome: rollbackEdits.every(edit => edit.applied) ? 'Target edits restored.' : 'Some target edits had newer changes and were preserved.',
      outcomeStatus: rollbackEdits.every(edit => edit.applied) ? 'verified' : 'partial',
      source: clip(options.source || 'rollback', 80),
      sourceRunId: '',
      sourceSessionId: '',
      rollbackOf: targetId,
      appliedEdits: rollbackEdits,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    atomicWrite(snapshotPathFor(statePath, id), beforeState);
    target.outcomeStatus = 'rolled_back';
    target.updatedAt = timestamp;
    state.refinements.push(event);
    state.refinements = state.refinements.slice(-MAX_REFINEMENTS);
    state.revision += 1;
    state.updatedAt = timestamp;
    atomicWrite(statePath, state);
    return { ok: true, refinement: event, revision: state.revision };
  }

  overview({ workspace = '', query = '', maxEntriesPerKind = 12, maxRefinements = 8 } = {}) {
    const queryTokens = tokenize(query);
    const entries = this.list({ workspace });
    const lines = ['Yan Continual Harness (editable supplemental state; base system prompt is immutable)'];
    for (const kind of HARNESS_KINDS) {
      const records = entries.filter(entry => entry.kind === kind)
        .sort((left, right) => scoreEntry(right, queryTokens) - scoreEntry(left, queryTokens))
        .slice(0, Math.max(1, maxEntriesPerKind));
      lines.push(`${kind}: ${entries.filter(entry => entry.kind === kind).length}`);
      for (const entry of records) {
        lines.push(`- [${entry.scope}:${entry.id}; v${entry.version}; ${entry.metadata?.status || 'active'}] ${entry.title}: ${clip(entry.content.replace(/\s+/g, ' '), 240)}`);
      }
    }
    const refinements = [
      ...this.load({ scope: 'global' }).refinements,
      ...(workspace ? this.load({ scope: 'workspace', workspace }).refinements : [])
    ].sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt)).slice(0, maxRefinements);
    lines.push(`recent refinements: ${refinements.length}`);
    for (const event of refinements) {
      lines.push(`- [${event.id}; ${event.outcomeStatus || 'pending'}] ${clip(event.trigger, 200)}${event.outcome ? `; outcome=${clip(event.outcome, 200)}` : ''}`);
    }
    return lines.join('\n');
  }

  promptContext({ workspace = '', query = '', maxChars = 3_000 } = {}) {
    const queryTokens = tokenize(query);
    const prompts = this.list({ workspace, includeInactive: false })
      .filter(entry => entry.kind === 'prompt' || entry.kind === 'subagent')
      .filter(entry => entry.metadata?.status !== 'rejected')
      .sort((left, right) => scoreEntry(right, queryTokens) - scoreEntry(left, queryTokens));
    const lines = [];
    let used = 0;
    for (const prompt of prompts) {
      const line = `- [${prompt.kind}; ${prompt.scope}:${prompt.id}; v${prompt.version}] ${prompt.content}`;
      if (used + line.length + 1 > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    return lines.join('\n');
  }
}

module.exports = {
  CONTENT_LIMITS,
  HARNESS_KIND_LABELS,
  HARNESS_KINDS,
  HARNESS_SCOPES,
  HARNESS_VERSION,
  ContinualHarnessStore,
  emptyState,
  normalizeEdit,
  normalizeId,
  normalizeState,
  readState,
  stateFileForWorkspace
};
