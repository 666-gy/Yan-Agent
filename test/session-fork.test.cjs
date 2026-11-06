'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSessionStore, collectKernelSessionIds } = require('../lib/session-store');
const { combineTurnPrompt } = require('../lib/kernel-policy');

function fixture(t) {
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-session-fork-'));
  t.after(() => fsp.rm(sessionsDir, { recursive: true, force: true }));
  const activeRuns = new Map();
  const deps = { sessionsDir, activeRuns, runAdmissions: new Map(),
    ensureDirs: () => fs.mkdirSync(sessionsDir, { recursive: true }),
    mainWindow: { get: () => null }, activateWorkspace() {},
    yanagent: { migrateMemoryToWorkspace() {}, ensureYanagent() {} } };
  return { store: createSessionStore(deps), reopen: () => createSessionStore(deps), activeRuns };
}

test('fork persists a full independent snapshot with no source kernel ownership', async t => {
  const { store, reopen } = fixture(t);
  const source = await store.createFreshSessionRecord({ workspace: os.tmpdir(), title: 'Source' });
  source.openCodeSessionId = 'native-source';
  source.modelSelection = { modelId: 'chosen-model' };
  source.reasoningMode = 'high';
  source.messages = Array.from({ length: 85 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message-${i}`, ts: i + 1 }));
  source.messages[1].attachments = [{ name: 'ref.txt', path: path.join(os.tmpdir(), 'ref.txt') }];
  source.messages[1].agentRun = { openCodeSessionId: 'native-old', runId: 'source-run', status: 'completed',
    textContent: 'message-1', timeline: [{ type: 'text', content: 'message-1' }], changeSummary: { count: 1 } };
  source.nested = { parentId: 'another-task' };
  await store.saveSession(source);
  const child = await store.forkSession(source.id);
  assert.notEqual(child.id, source.id);
  assert.equal(child.workspace, source.workspace);
  assert.equal(child.messages.length, 85);
  assert.deepEqual(child.modelSelection, source.modelSelection);
  assert.equal(child.reasoningMode, 'high');
  assert.deepEqual(collectKernelSessionIds(child), []);
  assert.equal(child.nested, undefined);
  assert.equal(child.messages[1].agentRun.runId, undefined);
  assert.equal(child.messages[1].agentRun.changeSummary, undefined);
  assert.deepEqual(child.messages[1].attachments, source.messages[1].attachments);
  source.messages.push({ role: 'assistant', content: 'source-only' });
  await store.saveSession(source);
  child.messages.push({ role: 'assistant', content: 'child-only' });
  await store.saveSession(child);
  const restarted = reopen();
  const savedChild = await restarted.readSessionRecord(child.id);
  const savedSource = await restarted.readSessionRecord(source.id);
  assert.equal(savedChild.messages.at(-1).content, 'child-only');
  assert.equal(savedSource.messages.at(-1).content, 'source-only');
  assert.equal(savedChild.forkOrigin.messageCount, 85);
  assert.equal(savedChild.forkOrigin.sourceId, source.id);
  assert.equal((await restarted.listSessionSummaries()).length, 2);
  const stale = await restarted.readSessionRecord(child.id, { messageLimit: 10 });
  delete stale.forkOrigin;
  await restarted.saveSession(stale);
  assert.equal((await restarted.readSessionRecord(child.id)).forkOrigin.messageCount, 85);
});

test('fork rejects missing, invalid and running sources without creating a task', async t => {
  const { store, activeRuns } = fixture(t);
  assert.throws(() => store.forkSession('../outside'), /ID/);
  await assert.rejects(store.forkSession('sess_missing'), /不存在/);
  const source = await store.createFreshSessionRecord();
  activeRuns.set('run', { yanSessionId: source.id });
  await assert.rejects(store.forkSession(source.id), /完成或停止/);
  assert.equal((await store.listSessionSummaries()).length, 1);
});

test('fork first-turn context includes older messages and long text; normal recovery remains bounded', () => {
  const history = [{ role: 'user', content: 'ORIGINAL-BEGIN ' + 'a'.repeat(7000) + ' ORIGINAL-END',
    attachments: [{ name: 'ref.txt', path: '/workspace/ref.txt' }] },
    ...Array.from({ length: 30 }, (_, i) => ({ role: 'assistant', content: `later-${i}` }))];
  const fork = combineTurnPrompt({ history, forkHistory: true }, 'continue', true);
  assert.ok(fork.includes('ORIGINAL-BEGIN'));
  assert.ok(fork.includes('ORIGINAL-END'));
  assert.ok(fork.includes('/workspace/ref.txt'));
  assert.ok(!combineTurnPrompt({ history }, 'continue', true).includes('ORIGINAL-BEGIN'));
  assert.ok(!combineTurnPrompt({ history, forkHistory: true }, 'continue', false).includes('ORIGINAL-BEGIN'));
});
