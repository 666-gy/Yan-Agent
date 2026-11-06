'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerBackgroundBash } = require('../lib/main/background-bash');

test('child completion waits for persistence, starts exactly one fresh desktop run, and respects cancellation', async t => {
  const modulePath = require.resolve('../lib/run-orchestrator');
  const previous = require.cache[modulePath];
  const starts = [], notifications = [];
  require.cache[modulePath] = { exports: { startRun: async (_ctx, request) => { starts.push(request); return { ok: true, runId: request.runId }; } } };
  let saved = false, beforeRead;
  const session = { openCodeSessionId: 'native-parent', messages: [{ role: 'assistant', content: 'finished', agentRun: { runId: 'parent' } }] };
  const env = [process.env.YAN_BASH_BRIDGE_URL, process.env.YAN_BASH_BRIDGE_TOKEN];
  const service = registerBackgroundBash({ ipcMain: { handle() {} },
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (name, data) => notifications.push({ name, data }) } }),
    runContext: { openCodeActiveRuns: new Map(), openCodeRunAdmissions: new Map(),
      sessionStore: { readSessionRecord: async () => { await beforeRead?.(); return { ...session, messages: saved ? session.messages : [] }; } } } });
  clearInterval(service.timer);
  t.after(() => {
    service.close();
    if (previous) require.cache[modulePath] = previous; else delete require.cache[modulePath];
    ['YAN_BASH_BRIDGE_URL', 'YAN_BASH_BRIDGE_TOKEN'].forEach((key, i) => { if (env[i] === undefined) delete process.env[key]; else process.env[key] = env[i]; });
  });
  await service.ready;
  service.register('parent', { yanSessionId: 'chat', agentPreset: 'uncensored', accessMode: 'full' });
  service.continueTask('parent', [{ id: 'child', status: 'completed', result: 'verified' }]);
  await service.flush(); assert.equal(starts.length, 0, 'active parent cannot be reused');
  service.runs.get('parent').settled = true;
  await service.flush(); assert.equal(starts.length, 0, 'wait until preceding reply is saved');
  saved = true; service.continuations.get('parent').nextAt = 0;
  await Promise.all([service.flush(), service.flush()]);
  await service.flush();
  assert.equal(starts.length, 1);
  assert.notEqual(starts[0].runId, 'parent');
  assert.equal(starts[0].openCodeSessionId, 'native-parent', 'keep conversation history like background Bash');
  assert.equal(starts[0].agentPreset, 'uncensored');
  assert.equal(starts[0].accessMode, 'full');
  assert.match(starts[0].prompt, /YAN SUBAGENT COMPLETION/);
  assert.deepEqual(starts[0].history, session.messages);
  assert.equal(notifications.filter(item => item.name === 'bash:wake').length, 1);
  assert.equal(service.continuations.size, 0);
  service.register('race', { yanSessionId: 'chat' });
  session.messages = [{ role: 'assistant', content: 'done', agentRun: { runId: 'race' } }];
  service.continueTask('race', [{ activationId: 'consumed-during-wake' }]);
  service.runs.get('race').settled = true;
  beforeRead = async () => service.observe('race', { type: 'yan.subagent.delivered', data: { activationIds: ['consumed-during-wake'] } });
  await service.flush();
  assert.equal(starts.length, 1, 'delivery during asynchronous wake admission invalidates the queued continuation');
  assert.equal(service.continuations.size, 0);
  beforeRead = undefined;
  service.register('cancelled', { yanSessionId: 'chat' });
  service.continueTask('cancelled', [{ id: 'late' }]);
  service.cancelSession('chat'); service.settled('cancelled'); await service.flush();
  assert.equal(starts.length, 1);
  service.register('old', { yanSessionId: 'chat' });
  service.continueTask('old', [{ id: 'already-in-user-context' }]);
  service.register('user-turn', { yanSessionId: 'chat' });
  assert.equal(service.continuations.size, 0);
});
