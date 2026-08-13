const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  containsSensitiveMemoryText,
  containsUnsafeMemoryText,
  tokenize
} = require('./long-term-memory');

const HARNESS_VERSION = 1;
const HARNESS_KINDS = Object.freeze(['prompt', 'memory', 'skill', 'subagent']);
const HARNESS_SCOPES = Object.freeze(['global', 'workspace']);
const MAX_REFINEMENTS = 500;
const MAX_ENTRIES_PER_KIND = 500;
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
    updatedAt: 0
  };
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try { return JSON.parse(JSON.stringify(value)); } catch { return {}; }
}

function normalizeEntry(raw, kind, id, scope) {
  if (!raw || typeof raw !== 'object') return null;
  const content = clip(raw.content, CONTENT_LIMITS[kind]);
  if (!content) return null;
  return {
    id,
    kind,
    title: clip(raw.title || id, 160),
    content,
    path: clip(raw.path || 'general', 160),
    scope,
    metadata: plainObject(raw.metadata),
    source: clip(raw.source || 'migration', 80),
    createdAt: Number(raw.createdAt || raw.created_at) || now(),
    updatedAt: Number(raw.updatedAt || raw.updated_at) || now(),
    version: Math.max(1, Number(raw.version) || 1)
  };
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

function entryFingerprint(entry) {
  return stableHash(JSON.stringify(entry || null));
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

  get(kind, id, { scope = 'global', workspace = '' } = {}) {
    if (!HARNESS_KINDS.includes(kind)) return null;
    return this.load({ scope, workspace }).entries[kind][normalizeId(id)] || null;
  }

  apply(proposal = {}, options = {}) {
    const scope = normalizeScope(options.scope || proposal.scope);
    const workspace = normalizeWorkspace(options.workspace);
    const statePath = this.statePath({ scope, workspace });
    if (!statePath) return { ok: false, conflict: false, error: 'Workspace harness requires a workspace.' };
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
        if (!keep.has(entryId)) delete state.entries[kind][entryId];
      }
    }
    state.revision += 1;
    state.updatedAt = timestamp;
    atomicWrite(snapshotPathFor(statePath, id), beforeState);
    atomicWrite(statePath, state);
    return { ok: true, conflict: false, refinement: event, revision: state.revision, statePath };
  }

  recordOutcome(refinementIdValue, outcome = {}, options = {}) {
    const scope = normalizeScope(options.scope);
    const statePath = this.statePath({ scope, workspace: options.workspace });
    if (!statePath) return { ok: false, error: 'Workspace harness requires a workspace.' };
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

  rollback(targetId, options = {}) {
    const scope = normalizeScope(options.scope);
    const statePath = this.statePath({ scope, workspace: options.workspace });
    if (!statePath) return { ok: false, error: 'Workspace harness requires a workspace.' };
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
