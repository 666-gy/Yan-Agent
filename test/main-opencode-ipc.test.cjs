'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerOpenCodeIpc } = require('../lib/main/ipc-opencode');
const { permissionAudit } = require('../lib/permission-audit');

function register(deps) {
  const handlers = new Map();
  registerOpenCodeIpc({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) } }, deps);
  return (channel, payload, event = {}) => handlers.get(channel)(event, payload);
}

test('manual compression passes the full runtime config and holds its reservation until completion', async () => {
  const config = { api: {} };
  const runtime = { relay: false, provider: { test: {} } };
  const reservations = new Set();
  const starts = [];
  let release;
  const result = new Promise(resolve => { release = resolve; });
  const invoke = register({
    manualContextCompressions: reservations,
    sessionStore: { isSessionRunActive: () => false, readSessionRecord: async () => ({ openCodeSessionId: 'kernel-session' }) },
    withOpenCodeBackgroundLease: fn => fn(),
    configStore: { loadConfig: () => config },
    modelState: { normalizeAgentModelSelection: () => ({ modelType: 'text', providerId: 'test', modelId: 'model' }) },
    skillsRuntime: { getNoWorkspaceAgentDirectory: () => 'C:/isolated-workspace' },
    mcpRuntimeConfig: { getOpenCodeRuntimeConfig: cfg => { assert.equal(cfg, config); return runtime; } },
    ensureOpenCodeSidecar: async cfg => {
      starts.push(cfg);
      return { compressSession: request => { assert.equal(request.openCodeConfig, runtime); return result; } };
    }
  });
  const pending = invoke('opencode:compress-session', { yanSessionId: 'sess_test1' });
  assert.equal(reservations.has('sess_test1'), true);
  assert.equal((await invoke('opencode:compress-session', { yanSessionId: 'sess_test1' })).ok, false);
  release({ compacted: true, beforeTokens: 100, afterTokens: 20 });
  assert.equal((await pending).ok, true);
  assert.deepEqual(starts, [runtime]);
  assert.equal(reservations.size, 0);
});

test('session review starts the sidecar with the full runtime config', async () => {
  const runtime = { provider: { test: {} } };
  const starts = [];
  const invoke = register({
    sessionStore: { readSessionRecord: async () => ({ workspace: 'C:/workspace', messages: [
      { role: 'assistant', agentRun: { runId: 'run-1', openCodeSessionId: 'kernel-session' } }
    ] }) },
    withOpenCodeBackgroundLease: fn => fn(),
    configStore: { loadConfig: () => ({ api: { reasoningSpeed: 'medium' } }) },
    mcpRuntimeConfig: { getOpenCodeRuntimeConfig: cfg => { assert.equal(cfg.api.reasoningSpeed, 'medium'); return runtime; } },
    ensureOpenCodeSidecar: async cfg => { starts.push(cfg); throw new Error('test startup failure'); }
  });
  const result = await invoke('opencode:session-changes', { yanSessionId: 'sess_test1', runId: 'run-1' });
  assert.deepEqual(starts, [runtime]);
  assert.equal(result.error, 'test startup failure');
});

test('permission replies read the current sidecar and preserve its result', async () => {
  let sidecar = null;
  const invoke = register({ getCurrentSidecar: () => sidecar });
  assert.equal((await invoke('opencode:permission-reply', {})).ok, false);
  const payload = { requestId: 'permission-1', reply: 'once' };
  sidecar = { replyPermission: async request => { assert.equal(request, payload); return { ok: true }; } };
  assert.deepEqual(await invoke('opencode:permission-reply', payload), { ok: true });
});

test('cancellation stays pending while the main process still tracks a run', async () => {
  const active = new Map([['run', { visionAbortController: new AbortController() }]]);
  const controller = active.get('run').visionAbortController;
  const releases = [];
  const invoke = register({
    getYanCore: () => ({ requestCancel: () => ({ cancelled: true, turn: { id: 'run' } }) }),
    getCurrentSidecar: () => null, openCodeActiveRuns: active, openCodeRunAdmissions: new Map(),
    bridges: { notifyBrowserAgentRelease: (...args) => releases.push(args) }
  });
  const result = await invoke('opencode:cancel-run', 'run');
  assert.equal(controller.signal.aborted, true);
  assert.equal(result.ok, true);
  assert.equal(result.cancelRequested, true);
  assert.equal(result.settled, false);
  assert.equal(result.cancelled, false);
  assert.deepEqual(releases, [['run', 'run_cancelled']]);
});

test('background utility cancellation is not attributed to a user action', async () => {
  for (const utility of [true, false]) {
    const reasons = [];
    const invoke = register({
      getYanCore: () => ({ requestCancel: (id, reason) => {
        reasons.push({ id, reason }); return { cancelled: true, turn: { id } };
      } }),
      getCurrentSidecar: () => null,
      openCodeActiveRuns: new Map([['run', { utility }]]),
      openCodeRunAdmissions: new Map(),
      bridges: { notifyBrowserAgentRelease: () => {} }
    });
    await invoke('opencode:cancel-run', 'run');
    assert.deepEqual(reasons, [{ id: 'run', reason: utility ? 'utility_cancelled' : 'user_cancelled' }]);
  }
});

test('core intent handlers use the live core and return existing error shapes', async () => {
  let core = null;
  const invoke = register({ getYanCore: () => core });
  assert.equal((await invoke('yan:core-settle-recovered-run', { runId: 'run' })).ok, false);
  const payload = { threadId: 'thread' };
  core = { enqueueIntent: value => ({ id: 'intent', ...value }), ackIntent: () => null };
  assert.deepEqual(invoke('yan:core-enqueue-intent', payload), { ok: true, intent: { id: 'intent', threadId: 'thread' } });
  assert.equal(invoke('yan:core-ack-intent', 'missing').ok, false);
});

test('recovery is marked replayed only after a timeline has been persisted', async () => {
  let session = { messages: [{ role: 'assistant', yanSynthetic: true, agentRun: { runId: 'run', timeline: [] } }] };
  let turn = { id: 'run', threadId: 'thread', status: 'recovering', recovery: { recoveredAt: 1 } };
  let marked = 0, completed = 0;
  const invoke = register({
    getYanCore: () => ({
      getTurn: () => turn,
      completeTurn: (_id, result) => { completed++; turn = { ...turn, status: 'aborted', result }; return turn; },
      markRecoveryReplayed: () => { marked++; return turn; }
    }),
    sessionStore: { readSessionRecord: async id => { assert.equal(id, 'thread'); return session; } }
  });
  assert.equal((await invoke('yan:core-settle-recovered-run', { runId: 'run' })).ok, true);
  assert.equal(marked, 0, 'an empty crash placeholder is not a completed replay');
  session.messages[0].agentRun.timeline = [{ type: 'tool_call', callId: 'c1' }];
  assert.equal((await invoke('yan:core-settle-recovered-run', { runId: 'run' })).ok, true);
  assert.equal(marked, 1);
  assert.equal(completed, 1, 'an aborted turn is not completed again');
  turn = { ...turn, status: 'running', recovery: null };
  assert.equal((await invoke('yan:core-settle-recovered-run', { runId: 'run' })).ok, false);
  assert.equal(completed, 1, 'live turns must not be settled by recovery');
});

// ---------------------------------------------------------------------------
// Permission visibility (P0/P3/P4)
// ---------------------------------------------------------------------------

function fakeConfigStore(initial = {}) {
  let config = { permissions: { ...initial } };
  return {
    loadConfig: () => config,
    saveConfig: next => { config = next; },
    current: () => config
  };
}

test('an "always" reply persists the command prefix instead of the whole permission', async () => {
  permissionAudit.clear();
  const configStore = fakeConfigStore();
  const invoke = register({
    configStore,
    getCurrentSidecar: () => ({
      replyPermission: async request => ({ ok: true, reply: request.reply })
    })
  });

  const result = await invoke('opencode:permission-reply', {
    requestId: 'per_1',
    reply: 'once',
    grantPrefix: 'pnpm run lint'
  });

  assert.equal(result.ok, true);
  assert.equal(result.reply, 'once');
  assert.deepEqual(configStore.current().permissions.shellAllowPrefixes, ['pnpm run lint']);

  // The same prefix is not appended twice, and a malformed one is dropped.
  await invoke('opencode:permission-reply', { requestId: 'per_2', reply: 'once', grantPrefix: 'pnpm run lint' });
  await invoke('opencode:permission-reply', { requestId: 'per_3', reply: 'once', grantPrefix: '   ' });
  assert.deepEqual(configStore.current().permissions.shellAllowPrefixes, ['pnpm run lint']);
});

test('a reply without a grant leaves the persisted scope untouched', async () => {
  permissionAudit.clear();
  const configStore = fakeConfigStore({ shellAllowPrefixes: ['git status'] });
  const invoke = register({
    configStore,
    getCurrentSidecar: () => ({ replyPermission: async () => ({ ok: true }) })
  });
  await invoke('opencode:permission-reply', { requestId: 'per_1', reply: 'reject' });
  assert.deepEqual(configStore.current().permissions.shellAllowPrefixes, ['git status']);
});

test('shell classification reports the prefix and whether it is already granted', () => {
  const configStore = fakeConfigStore({ shellAllowPrefixes: ['pnpm run lint'] });
  const invoke = register({ configStore });

  const granted = invoke('opencode:classify-shell-command', 'pnpm run lint --fix src/a.ts');
  assert.equal(granted.prefix, 'pnpm run lint');
  assert.equal(granted.granted, true);
  assert.equal(granted.level, 'normal');

  const fresh = invoke('opencode:classify-shell-command', 'npm test -- --watch=false');
  assert.equal(fresh.prefix, 'npm test');
  assert.equal(fresh.granted, false);

  // A command with no safe reusable shape is never reported as granted.
  const unshapeable = invoke('opencode:classify-shell-command', 'npm test && rm -rf /');
  assert.equal(unshapeable.prefix, undefined);
  assert.equal(unshapeable.granted, false);
  assert.equal(unshapeable.level, 'high');
});

test('the audit surface answers what Yan asked, why, and what it currently allows', async () => {
  permissionAudit.clear();
  const configStore = fakeConfigStore({ shellAllowPrefixes: ['pnpm run lint', 'git status'] });
  const invoke = register({ configStore });

  const empty = await invoke('opencode:permission-audit', {});
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.entries, []);
  assert.deepEqual(empty.shellAllowPrefixes, ['pnpm run lint', 'git status']);

  permissionAudit.recordRequested({
    requestId: 'per_1', permission: 'bash', subject: 'pnpm run lint --fix src/a.ts', source: 'session'
  });
  permissionAudit.recordResolved({
    requestId: 'per_1', decision: 'once', riskLevel: 'normal', riskCategory: 'normal',
    grantPrefix: 'pnpm run lint', source: 'renderer'
  });

  const listed = await invoke('opencode:permission-audit', { action: 'list' });
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0].requestId, 'per_1');
  assert.equal(listed.entries[0].riskCategory, 'normal');
  assert.equal(listed.entries[0].grantPrefix, 'pnpm run lint');

  const revoked = await invoke('opencode:permission-audit', { action: 'revoke-prefix', prefix: 'pnpm run lint' });
  assert.deepEqual(revoked.shellAllowPrefixes, ['git status']);

  const cleared = await invoke('opencode:permission-audit', { action: 'clear' });
  assert.deepEqual(cleared.entries, []);
  assert.equal(permissionAudit.size(), 0);
});
