'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ContinualHarnessStore, HARNESS_KINDS } = require('./continual-harness');
const {
  derivePolicyControls,
  isDurableDirective,
  policyId
} = require('./behavior-policy');

const legacyRequestPath = path.resolve(String(process.env.YAN_HARNESS_REQUEST_PATH || ''));
const legacyRunId = String(process.env.YAN_HARNESS_RUN_ID || '');
const legacySessionId = String(process.env.YAN_HARNESS_SESSION_ID || '');
const legacyWorkspace = String(process.env.YAN_HARNESS_WORKSPACE || '');
const globalStatePath = path.resolve(String(process.env.YAN_HARNESS_GLOBAL_STATE_PATH || ''));
const legacyWorkspaceStatePath = path.resolve(String(process.env.YAN_HARNESS_WORKSPACE_STATE_PATH || ''));
const contextDir = path.resolve(String(process.env.YAN_HARNESS_CONTEXT_DIR || ''));
const usesRuntimeContext = !!String(process.env.YAN_HARNESS_CONTEXT_DIR || '').trim();
let writeQueue = Promise.resolve();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan Harness MCP error') } });
}

function cleanText(value, max) {
  return String(value || '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function contextPath(taskId) {
  const key = crypto.createHash('sha256').update(String(taskId || '')).digest('hex');
  return path.join(contextDir, `${key}.json`);
}

function readTaskContext(taskId) {
  try {
    const context = JSON.parse(fs.readFileSync(contextPath(taskId), 'utf8'));
    return context && String(context.runId || '') === String(taskId) ? context : null;
  } catch {
    return null;
  }
}

function levenshteinDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

// The model transcribes task_id from the turn-context block by hand, so a
// one-character slip must not kill an otherwise valid refinement. Fall back
// to a UNIQUE near-match across live contexts; ambiguity or no match still
// refuses, because queueing into the wrong task's context is worse than
// failing the call.
function findNearMatchTaskContext(taskId) {
  let entries = [];
  try {
    entries = fs.readdirSync(contextDir).filter(name => name.endsWith('.json')).slice(0, 200);
  } catch {
    return null;
  }
  const matches = [];
  for (const name of entries) {
    let context;
    try { context = JSON.parse(fs.readFileSync(path.join(contextDir, name), 'utf8')); } catch { continue; }
    const runId = String(context?.runId || '');
    if (!runId) continue;
    if (Math.abs(runId.length - taskId.length) > 4) continue;
    if (runId.toLowerCase() === taskId.toLowerCase() || levenshteinDistance(runId, taskId) <= 2) matches.push(context);
  }
  return matches.length === 1 ? matches[0] : null;
}

function runtimeContext(input = {}) {
  if (!usesRuntimeContext) {
  return {
    runId: legacyRunId,
    sessionId: legacySessionId,
    workspace: legacyWorkspace,
    requestPath: legacyRequestPath,
    workspaceStatePath: legacyWorkspaceStatePath,
    globalStatePath
    };
  }
  const taskId = cleanText(input.task_id, 240);
  if (!taskId) throw new Error('task_id from the latest yan-turn-context is required.');
  let context = readTaskContext(taskId);
  if (!context) context = findNearMatchTaskContext(taskId);
  if (!context) {
    throw new Error('No live Yan Harness task context matches this task_id. Re-copy task_id exactly (every character) from the latest <yan-turn-context> block; the context is also removed once its task finishes, so a finished task can no longer schedule refinements.');
  }
  return {
    runId: String(context.runId || taskId),
    sessionId: String(context.sessionId || ''),
    workspace: String(context.workspace || ''),
    requestPath: path.resolve(String(context.requestPath || '')),
    workspaceStatePath: path.resolve(String(context.workspaceStatePath || '')),
    globalStatePath
  };
}

function immediatePolicyId(instructions) {
  return `prompt-${policyId(instructions).replace(/^user-policy-/u, '')}`
    .replace(/[^a-z0-9._-]+/giu, '-')
    .slice(0, 100);
}

// A durable rule must become visible before the current task releases its
// turn. The old queue-only path left a race: task A wrote pending.json, task B
// started, and B constructed its policy context before A's background review
// had activated the rule. Only rule-shaped instructions take this fast path;
// ordinary mined tactics remain queued for the existing reviewer/evidence gate.
async function activateImmediatePolicy(context, instructions, scope) {
  if (!isDurableDirective(instructions)) return { ok: false, skipped: true };
  const normalizedScope = scope === 'workspace' && context.workspace ? 'workspace' : 'global';
  const globalPath = String(context.globalStatePath || '').trim();
  if (!globalPath) return { ok: false, skipped: true, error: 'Harness global state path is unavailable.' };
  const store = new ContinualHarnessStore({ globalPath });
  const state = store.load({ scope: normalizedScope, workspace: context.workspace });
  const id = immediatePolicyId(instructions);
  const existing = state.entries.prompt[id];
  if (existing?.metadata?.status === 'active' && existing.content === instructions) {
    return { ok: true, skipped: true, active: true };
  }
  const result = await store.apply({
    id: `immediate-policy-${crypto.createHash('sha256').update(`${normalizedScope}:${instructions}`).digest('hex').slice(0, 16)}`,
    trigger: `Explicit durable policy: ${instructions}`,
    evidence: 'The agent explicitly scheduled a durable behavior rule during the task.',
    expectedOutcome: 'Make the durable behavior rule active before any subsequent task starts.',
    edits: [{
      action: existing ? 'update' : 'create',
      kind: 'prompt',
      id,
      title: 'Explicit durable behavior policy',
      content: instructions,
      path: 'user-policy',
      scope: normalizedScope,
      metadata: {
        status: 'active',
        enforcement: 'mandatory',
        basis: 'explicit_user_statement',
        controls: derivePolicyControls(instructions),
        immediate: true
      },
      reason: 'The rule-shaped instruction was explicitly requested for future behavior.'
    }]
  }, {
    scope: normalizedScope,
    workspace: context.workspace,
    expectedRevision: state.revision,
    baselineState: state,
    runId: context.runId,
    sessionId: context.sessionId,
    source: 'agent_refine_immediate'
  });
  const applied = result.ok && (result.refinement?.appliedEdits || [])
    .some(edit => edit.applied === true && edit.kind === 'prompt' && edit.id === id);
  if (applied && result.refinement?.id) {
    await store.recordOutcome(result.refinement.id, {
      status: 'partial',
      evidence: 'The explicit durable policy was activated before the current task released its turn.'
    }, { scope: normalizedScope, workspace: context.workspace });
  }
  return applied ? { ok: true, active: true } : { ok: false, error: result.error || 'Immediate policy activation failed.' };
}

function readRequest(requestPath) {
  try {
    if (!requestPath || !fs.existsSync(requestPath)) return null;
    const value = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function atomicWrite(requestPath, value) {
  if (!requestPath || requestPath === path.parse(requestPath).root) throw new Error('Yan Harness request path is not configured.');
  fs.mkdirSync(path.dirname(requestPath), { recursive: true });
  const temporary = `${requestPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, requestPath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

async function schedule(context, input = {}) {
  const instructions = cleanText(input.instructions, 2_000);
  const scope = input.scope === 'global' ? 'global' : 'workspace';
  if (!instructions) throw new Error('Refinement instructions are required.');
  if (scope === 'workspace' && !context.workspace) throw new Error('Workspace refinement requires an active workspace.');
  const previous = readRequest(context.requestPath);
  const request = {
    schema: 1,
    action: 'refine',
    runId: context.runId,
    sessionId: context.sessionId,
    workspace: context.workspace,
    scope,
    instructions: previous?.instructions
      ? `${cleanText(previous.instructions, 1_000)}\n${instructions}`.slice(0, 2_000)
      : instructions,
    requestedAt: Date.now()
  };
  atomicWrite(context.requestPath, request);
  const activation = await activateImmediatePolicy(context, instructions, scope);
  return {
    ok: true,
    scheduled: true,
    scope,
    activated: activation.active === true,
    activationError: activation.ok ? '' : String(activation.error || ''),
    message: activation.active === true
      ? 'Durable policy is active immediately; the queued refinement will still be reviewed after the current turn completes.'
      : 'Refinement is queued and will run only after the current turn completes.'
  };
}

function scheduleRollback(context, input = {}) {
  const targetId = cleanText(input.refinement_id, 120);
  const scope = input.scope === 'global' ? 'global' : 'workspace';
  if (!targetId) throw new Error('A refinement id is required.');
  if (scope === 'workspace' && !context.workspace) throw new Error('Workspace rollback requires an active workspace.');
  const request = {
    schema: 1,
    action: 'rollback',
    runId: context.runId,
    sessionId: context.sessionId,
    workspace: context.workspace,
    scope,
    rollbackId: targetId,
    instructions: cleanText(input.reason || 'Explicit user rollback request.', 2_000),
    requestedAt: Date.now()
  };
  atomicWrite(context.requestPath, request);
  return {
    ok: true,
    scheduled: true,
    scope,
    rollbackId: targetId,
    message: 'Rollback is queued and will run only after the current turn completes.'
  };
}

function requireHarnessKind(value, { optional = false } = {}) {
  const kind = cleanText(value, 40);
  if (!kind && optional) return '';
  if (!HARNESS_KINDS.includes(kind)) {
    throw new Error(`Unsupported harness kind: ${kind || '(empty)'}. Use one of ${HARNESS_KINDS.join(', ')}.`);
  }
  return kind;
}

function optionalReadScope(value) {
  const scope = cleanText(value, 40);
  if (!scope) return '';
  if (scope !== 'global' && scope !== 'workspace') throw new Error('scope must be "workspace" or "global".');
  return scope;
}

function entryReadSummary(entry) {
  const usage = entry.metadata?.usage && typeof entry.metadata.usage === 'object' ? entry.metadata.usage : {};
  return {
    id: entry.id,
    kind: entry.kind,
    scope: entry.scope,
    title: entry.title,
    path: entry.path,
    status: cleanText(entry.metadata?.status || 'active', 40),
    enforcement: cleanText(entry.metadata?.enforcement || '', 40),
    version: Number(entry.version) || 1,
    updatedAt: Number(entry.updatedAt) || 0,
    source: cleanText(entry.source, 80),
    usage: {
      injectedRuns: Array.isArray(usage.injectedRuns) ? usage.injectedRuns.length : 0,
      successes: Array.isArray(usage.successes) ? usage.successes.length : 0,
      failures: Array.isArray(usage.failures) ? usage.failures.length : 0,
      consecutiveFailures: Math.max(0, Number(usage.consecutiveFailures) || 0)
    },
    preview: cleanText(entry.content, 280)
  };
}

function listEntries(context, input = {}) {
  const kind = requireHarnessKind(input.kind, { optional: true });
  const scope = optionalReadScope(input.scope);
  const workspace = String(context.workspace || '');
  if (scope === 'workspace' && !workspace) throw new Error('Workspace scope requires an active workspace.');
  const query = cleanText(input.query, 200).toLowerCase();
  const limit = Math.min(50, Math.max(1, Number(input.limit) || 20));
  const store = new ContinualHarnessStore({ globalPath: globalStatePath });
  const entries = store.list({
    workspace,
    kind,
    includeInactive: input.include_inactive === true
  })
    .filter(entry => !scope || entry.scope === scope)
    .filter(entry => !query || `${entry.id} ${entry.title} ${entry.content}`.toLowerCase().includes(query))
    .slice(0, limit)
    .map(entryReadSummary);
  return {
    ok: true,
    scope: scope || (workspace ? 'workspace+global' : 'global'),
    count: entries.length,
    entries
  };
}

// Read-only: lets the model reuse or update an existing entry instead of
// creating a near-duplicate candidate from the same recurring observation.
// Workspace scope wins when both scopes carry the same id.
function getEntry(context, input = {}) {
  const kind = requireHarnessKind(input.kind);
  const id = cleanText(input.id, 100);
  if (!id) throw new Error('An entry id is required.');
  const scope = optionalReadScope(input.scope);
  const workspace = String(context.workspace || '');
  if (scope === 'workspace' && !workspace) throw new Error('Workspace scope requires an active workspace.');
  const store = new ContinualHarnessStore({ globalPath: globalStatePath });
  const scopes = scope ? [scope] : (workspace ? ['workspace', 'global'] : ['global']);
  for (const current of scopes) {
    const entry = store.get(kind, id, { scope: current, workspace });
    if (!entry) continue;
    return {
      ok: true,
      entry: { ...entryReadSummary(entry), content: entry.content, metadata: entry.metadata }
    };
  }
  return { ok: true, entry: null, message: `No ${kind} entry named ${id} exists in the searched scope.` };
}

async function deleteEntry(context, input = {}) {
  const kind = requireHarnessKind(input.kind);
  const id = cleanText(input.id, 100);
  if (!id) throw new Error('An entry id is required.');
  const scope = optionalReadScope(input.scope);
  if (!scope) throw new Error('An explicit scope is required for deletion.');
  if (scope === 'workspace' && !context.workspace) throw new Error('Workspace scope requires an active workspace.');
  const store = new ContinualHarnessStore({ globalPath: globalStatePath });
  const options = { scope, workspace: context.workspace };
  const state = store.load(options);
  const entry = store.get(kind, id, options);
  if (!entry || entry.metadata?.status === 'deleted') return { ok: true, deleted: true, id, scope, unchanged: true };
  const result = await store.apply({
    trigger: `User requested deletion of ${kind}:${id}`,
    evidence: cleanText(input.reason, 1000) || 'Explicit user deletion request',
    edits: [{ ...entry, action: 'update', metadata: { ...entry.metadata, status: 'deleted' } }]
  }, { ...options, expectedRevision: state.revision, baselineState: state,
    source: 'user_delete', runId: context.runId, sessionId: context.sessionId });
  const deleted = result.ok && result.refinement?.appliedEdits.some(edit => edit.applied);
  return { ok: Boolean(deleted), deleted: Boolean(deleted), id, scope,
    refinementId: result.refinement?.id, error: deleted ? undefined : (result.error || 'Entry changed or could not be deleted.'),
    message: deleted ? 'Removed from future injections. Audit history is retained; existing conversation context is unchanged.' : undefined };
}

function readStateSummary(filePath, scope) {
  try {
    if (!filePath || filePath === path.parse(filePath).root || !fs.existsSync(filePath)) {
      return { scope, revision: 0, entries: 0, refinements: [] };
    }
    const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const entries = Object.values(state?.entries || {}).reduce((sum, records) => (
      sum + (records && typeof records === 'object' ? Object.keys(records).length : 0)
    ), 0);
    const refinements = (Array.isArray(state?.refinements) ? state.refinements : []).slice(-8).reverse().map(item => ({
      id: cleanText(item?.id, 120),
      trigger: cleanText(item?.trigger, 240),
      outcomeStatus: cleanText(item?.outcomeStatus || 'pending', 40),
      rollbackOf: cleanText(item?.rollbackOf, 120),
      updatedAt: Number(item?.updatedAt) || 0
    }));
    return { scope, revision: Number(state?.revision) || 0, entries, refinements };
  } catch (error) {
    return { scope, revision: 0, entries: 0, refinements: [], error: error?.message || String(error) };
  }
}

function status(context) {
  return {
    ok: true,
    pending: readRequest(context.requestPath),
    stores: [
      readStateSummary(globalStatePath, 'global'),
      ...(context.workspace ? [readStateSummary(context.workspaceStatePath, 'workspace')] : [])
    ]
  };
}

function taskIdProperty() {
  return usesRuntimeContext
    ? { task_id: { type: 'string', description: 'Exact task_id from the latest yan-turn-context block.' } }
    : {};
}

function requiredWithTaskId(required = []) {
  return usesRuntimeContext ? [...required, 'task_id'] : required;
}

function toolDefinitions() {
  return [{
    name: 'schedule_refinement',
    description: 'Queue a focused Continual Harness refinement after the current turn. Use only after observing a repeated failure, reusable verified tactic, recurring delegation role, or narrow behavior policy worth persisting. This returns immediately and never changes the current turn mid-run. Do not use for temporary progress, ordinary facts, one-off errors, or broad prompt rewrites.',
    inputSchema: {
      type: 'object',
      properties: {
        ...taskIdProperty(),
        instructions: { type: 'string', description: 'Concise observation and what reusable behavior should be reviewed.' },
        scope: { type: 'string', enum: ['workspace', 'global'], default: 'workspace', description: 'Use global only for stable cross-session behavior.' }
      },
      required: requiredWithTaskId(['instructions']),
      additionalProperties: false
    }
  }, {
    name: 'list_entries',
    description: 'Read Continual Harness entries (prompt / memory / skill / subagent) that can be injected into future turns. Read-only. Check it before scheduling a refinement so an existing entry is updated or referenced instead of duplicated. Returns status, usage attribution counters, and a short preview; use get_entry for full content.',
    inputSchema: {
      type: 'object',
      properties: {
        ...taskIdProperty(),
        kind: { type: 'string', enum: [...HARNESS_KINDS], description: 'Optional kind filter.' },
        scope: { type: 'string', enum: ['workspace', 'global'], description: 'Optional scope filter; defaults to the workspace and global stores.' },
        query: { type: 'string', description: 'Optional case-insensitive substring filter over id, title, and content.' },
        include_inactive: { type: 'boolean', default: false, description: 'Include observing/rejected entries. Defaults to active entries only.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 }
      },
      required: requiredWithTaskId([]),
      additionalProperties: false
    }
  }, {
    name: 'get_entry',
    description: 'Read one Continual Harness entry in full, including metadata and usage counters. Read-only. Searches the workspace scope first, then global, unless scope is given.',
    inputSchema: {
      type: 'object',
      properties: {
        ...taskIdProperty(),
        kind: { type: 'string', enum: [...HARNESS_KINDS] },
        id: { type: 'string', description: 'Entry id as returned by list_entries or get_refinement_status.' },
        scope: { type: 'string', enum: ['workspace', 'global'], description: 'Optional; defaults to workspace first, then global.' }
      },
      required: requiredWithTaskId(['kind', 'id']),
      additionalProperties: false
    }
  }, {
    name: 'delete_entry',
    description: 'Delete one historical injection from future turns immediately, only when the user explicitly requests deletion. First use list_entries/get_entry to identify its exact kind, id and scope. Retains audit history and prevents automatic recovery; cannot erase context already sent in an existing conversation. Use schedule_rollback on the returned refinementId only if the user asks to restore it.',
    inputSchema: {
      type: 'object',
      properties: {
        ...taskIdProperty(),
        kind: { type: 'string', enum: [...HARNESS_KINDS] },
        id: { type: 'string' },
        scope: { type: 'string', enum: ['workspace', 'global'] },
        reason: { type: 'string' }
      },
      required: requiredWithTaskId(['kind', 'id', 'scope']),
      additionalProperties: false
    }
  }, {
    name: 'get_refinement_status',
    description: 'Read the queued request and recent Continual Harness refinement ids/statuses. This is read-only and useful before an explicitly requested rollback.',
    inputSchema: {
      type: 'object',
      properties: taskIdProperty(),
      required: requiredWithTaskId([]),
      additionalProperties: false
    }
  }, {
    name: 'schedule_rollback',
    description: 'Queue rollback of one recorded refinement after this turn. Use only when the user explicitly asks to undo that refinement. Newer changes to the same entries are preserved instead of overwritten.',
    inputSchema: {
      type: 'object',
      properties: {
        ...taskIdProperty(),
        refinement_id: { type: 'string' },
        scope: { type: 'string', enum: ['workspace', 'global'], default: 'workspace' },
        reason: { type: 'string' }
      },
      required: requiredWithTaskId(['refinement_id']),
      additionalProperties: false
    }
  }];
}

async function callTool(request) {
  const name = String(request.params?.name || '');
  const input = request.params?.arguments && typeof request.params.arguments === 'object'
    ? request.params.arguments
    : {};
  let result;
  const context = runtimeContext(input);
  if (name === 'get_refinement_status') result = status(context);
  else if (name === 'list_entries') result = listEntries(context, input);
  else if (name === 'get_entry') result = getEntry(context, input);
  else if (name === 'delete_entry') result = await (writeQueue = writeQueue.catch(() => {}).then(() => deleteEntry(context, input)));
  else if (name === 'schedule_refinement') result = await (writeQueue = writeQueue.catch(() => {}).then(() => schedule(context, input)));
  else if (name === 'schedule_rollback') result = await (writeQueue = writeQueue.catch(() => {}).then(() => scheduleRollback(context, input)));
  else throw new Error(`Unknown Yan Harness tool: ${name}`);
  success(request.id, {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
    isError: false
  });
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return;
  if (message.method === 'initialize') {
    success(message.id, {
      protocolVersion: String(message.params?.protocolVersion || '2025-03-26'),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Yan Continual Harness', version: '1.0.0' }
    });
    return;
  }
  if (message.method === 'ping') {
    success(message.id, {});
    return;
  }
  if (message.method === 'tools/list') {
    success(message.id, { tools: toolDefinitions() });
    return;
  }
  if (message.method === 'tools/call') {
    try { await callTool(message); }
    catch (error) {
      const result = { ok: false, error: error?.message || String(error) };
      success(message.id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: true
      });
    }
    return;
  }
  if (message.id !== undefined) failure(message.id, -32601, `Unsupported method: ${message.method}`);
}

if (process.env.YAN_HARNESS_TEST_EXPORTS === '1') {
  // Test-only surface: the stdio server is never started in this mode.
  module.exports = { deleteEntry, getEntry, listEntries, toolDefinitions };
} else {
  let buffered = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffered += String(chunk || '');
    while (true) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) break;
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      try { void handle(JSON.parse(line)); }
      catch (error) { failure(null, -32700, error?.message || String(error)); }
    }
  });
}
