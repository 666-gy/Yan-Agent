'use strict';

const fs = require('fs');
const path = require('path');

const requestPath = path.resolve(String(process.env.YAN_HARNESS_REQUEST_PATH || ''));
const runId = String(process.env.YAN_HARNESS_RUN_ID || '');
const sessionId = String(process.env.YAN_HARNESS_SESSION_ID || '');
const workspace = String(process.env.YAN_HARNESS_WORKSPACE || '');
const globalStatePath = path.resolve(String(process.env.YAN_HARNESS_GLOBAL_STATE_PATH || ''));
const workspaceStatePath = path.resolve(String(process.env.YAN_HARNESS_WORKSPACE_STATE_PATH || ''));
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

function readRequest() {
  try {
    if (!requestPath || !fs.existsSync(requestPath)) return null;
    const value = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function atomicWrite(value) {
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

function schedule(input = {}) {
  const instructions = cleanText(input.instructions, 2_000);
  const scope = input.scope === 'global' ? 'global' : 'workspace';
  if (!instructions) throw new Error('Refinement instructions are required.');
  if (scope === 'workspace' && !workspace) throw new Error('Workspace refinement requires an active workspace.');
  const previous = readRequest();
  const request = {
    schema: 1,
    action: 'refine',
    runId,
    sessionId,
    workspace,
    scope,
    instructions: previous?.instructions
      ? `${cleanText(previous.instructions, 1_000)}\n${instructions}`.slice(0, 2_000)
      : instructions,
    requestedAt: Date.now()
  };
  atomicWrite(request);
  return {
    ok: true,
    scheduled: true,
    scope,
    message: 'Refinement is queued and will run only after the current turn completes.'
  };
}

function scheduleRollback(input = {}) {
  const targetId = cleanText(input.refinement_id, 120);
  const scope = input.scope === 'global' ? 'global' : 'workspace';
  if (!targetId) throw new Error('A refinement id is required.');
  if (scope === 'workspace' && !workspace) throw new Error('Workspace rollback requires an active workspace.');
  const request = {
    schema: 1,
    action: 'rollback',
    runId,
    sessionId,
    workspace,
    scope,
    rollbackId: targetId,
    instructions: cleanText(input.reason || 'Explicit user rollback request.', 2_000),
    requestedAt: Date.now()
  };
  atomicWrite(request);
  return {
    ok: true,
    scheduled: true,
    scope,
    rollbackId: targetId,
    message: 'Rollback is queued and will run only after the current turn completes.'
  };
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

function status() {
  return {
    ok: true,
    pending: readRequest(),
    stores: [
      readStateSummary(globalStatePath, 'global'),
      ...(workspace ? [readStateSummary(workspaceStatePath, 'workspace')] : [])
    ]
  };
}

function toolDefinitions() {
  return [{
    name: 'schedule_refinement',
    description: 'Queue a focused Continual Harness refinement after the current turn. Use only after observing a repeated failure, reusable verified tactic, recurring delegation role, or narrow behavior policy worth persisting. This returns immediately and never changes the current turn mid-run. Do not use for temporary progress, ordinary facts, one-off errors, or broad prompt rewrites.',
    inputSchema: {
      type: 'object',
      properties: {
        instructions: { type: 'string', description: 'Concise observation and what reusable behavior should be reviewed.' },
        scope: { type: 'string', enum: ['workspace', 'global'], default: 'workspace', description: 'Use global only for stable cross-session behavior.' }
      },
      required: ['instructions'],
      additionalProperties: false
    }
  }, {
    name: 'get_refinement_status',
    description: 'Read the queued request and recent Continual Harness refinement ids/statuses. This is read-only and useful before an explicitly requested rollback.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }, {
    name: 'schedule_rollback',
    description: 'Queue rollback of one recorded refinement after this turn. Use only when the user explicitly asks to undo that refinement. Newer changes to the same entries are preserved instead of overwritten.',
    inputSchema: {
      type: 'object',
      properties: {
        refinement_id: { type: 'string' },
        scope: { type: 'string', enum: ['workspace', 'global'], default: 'workspace' },
        reason: { type: 'string' }
      },
      required: ['refinement_id'],
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
  if (name === 'get_refinement_status') result = status();
  else if (name === 'schedule_refinement') result = await (writeQueue = writeQueue.then(() => schedule(input)));
  else if (name === 'schedule_rollback') result = await (writeQueue = writeQueue.then(() => scheduleRollback(input)));
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
