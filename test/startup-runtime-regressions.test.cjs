'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { YanCore } = require('../lib/yan-core');
const { startRun } = require('../lib/run-orchestrator');
const { createRunContext } = require('./helpers/run-context.cjs');

test('slow suggestion cannot occupy the foreground session lock, Core thread or capacity', async t => {
  const f = createRunContext(t);
  f.ctx.MAX_CONCURRENT_AGENT_RUNS = 1;
  const session = { id: 'sess_suggestionowner', memoryEnabled: false };
  f.ctx.sessionStore.readSessionRecord = async () => session;
  const core = new YanCore({ rootDir: path.join(f.ctx.STABLE_DATA_DIR, 'core') });
  f.ctx.getYanCore = () => core;
  const finish = new Map();
  f.ctx.getOpenCodeProviderAdapter = () => ({ startTurn: request => new Promise(resolve => finish.set(request.runId, resolve)) });
  assert.equal((await startRun(f.ctx, { runId: 'hint', yanSessionId: session.id, utility: true, utilityKind: 'prompt-suggestion', prompt: 'Suggest a follow-up' })).ok, true);
  const foreground = await startRun(f.ctx, { runId: 'real-task', yanSessionId: session.id, prompt: '提醒我玩游戏' });
  assert.equal(foreground.ok, true, foreground.error);
  assert.equal(core.getTurn('hint').threadId, 'suggestion_hint');
  assert.equal(core.getTurn('real-task').threadId, session.id);
  assert.equal((await startRun(f.ctx, { runId: 'duplicate', yanSessionId: session.id, prompt: 'again' })).code, 'SESSION_BUSY');
  finish.get('real-task')({ status: 'done', text: '该玩游戏了！' });
  finish.get('hint')({ status: 'done', text: 'KEEP_DEFAULT' });
  await f.idle;
  assert.equal(core.getTurn('real-task').status, 'completed');
});

test('startup state excludes historical payloads while retaining queued and interrupted work', t => {
  const f = createRunContext(t);
  const core = new YanCore({ rootDir: path.join(f.ctx.STABLE_DATA_DIR, 'core') });
  core.startTurn({ threadId: 'completed', turnId: 'old' });
  core.completeTurn('old', { status: 'done', text: 'large old result' });
  core.startTurn({ threadId: 'interrupted', turnId: 'recover' });
  core.recoverInterruptedTurns();
  core.state.items.large = { id: 'large', threadId: 'completed', content: 'x'.repeat(100000) };
  core.state.intents = {
    queued: { id: 'queued', threadId: 'interrupted', status: 'queued', intent: { prompt: 'pending' } },
    claimed: { id: 'claimed', status: 'consumed', dispatchingAt: 1 },
    done: { id: 'done', status: 'dispatched' }
  };
  const state = core.getState({ startup: true });
  assert.deepEqual(Object.keys(state.turns), ['recover']);
  assert.deepEqual(Object.keys(state.intents), ['queued', 'claimed']);
  assert.deepEqual(state.items, {});
  assert.ok(JSON.stringify(state).length < 10000);
  state.turns.recover.status = 'tampered';
  assert.equal(core.getTurn('recover').status, 'recovering');
  assert.ok(core.getState().items.large);
  assert.deepEqual(core.getState({ startup: true, threadId: 'completed' }).turns, {});
});

test('kernel pool reserves foreground capacity independently of one slow suggestion', async t => {
  const f = createRunContext(t);
  const { OpenCodeV2Pool } = require('../lib/kernel-v2/pool');
  const pool = new OpenCodeV2Pool({ dataDir: f.ctx.STABLE_DATA_DIR, maxKernels: 1 });
  const finish = new Map();
  pool.entry = () => ({ resources: { use: fn => fn() },
    run: request => new Promise(resolve => finish.set(request.runId, resolve)) });
  pool.migrate = async () => {};
  const hint = pool.run({ runId: 'hint', yanSessionId: 'owner', utility: true, utilityKind: 'prompt-suggestion' });
  const work = pool.run({ runId: 'work', yanSessionId: 'owner' });
  await new Promise(setImmediate);
  assert.equal(finish.size, 2);
  await assert.rejects(pool.run({ runId: 'extra', yanSessionId: 'other' }), /最多同时运行/);
  await assert.rejects(pool.run({ runId: 'extra-hint', yanSessionId: 'other', utility: true, utilityKind: 'prompt-suggestion' }), /建议正在生成/);
  finish.get('hint')({ status: 'done' }); finish.get('work')({ status: 'done' });
  await Promise.all([hint, work]);
  assert.equal(pool.active.size, 0);
});

test('snapshot deletion checks scale with threads and recheck durable fences on each operation', t => {
  const f = createRunContext(t);
  const core = new YanCore({ rootDir: path.join(f.ctx.STABLE_DATA_DIR, 'core') });
  let checks = 0;
  const has = core.store.deletionFence.has;
  core.store.deletionFence.has = id => { checks++; return has(id); };
  const snapshot = () => ({ threads: { owner: {} }, turns: {}, intents: {},
    items: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [i, { threadId: 'owner' }])) });
  assert.equal(Object.keys(core.store.withoutDeletedThreads(snapshot()).items).length, 1000);
  assert.equal(checks, 1);
  core.store.deletionFence.mark('owner');
  assert.equal(Object.keys(core.store.withoutDeletedThreads(snapshot()).items).length, 0);
  assert.equal(checks, 2);
});

test('targeted recovery journal retains exact matching events without checking unrelated thread fences', t => {
  const f = createRunContext(t);
  const core = new YanCore({ rootDir: path.join(f.ctx.STABLE_DATA_DIR, 'core') });
  core.startTurn({ threadId: 'a', turnId: 'wanted' });
  core.startTurn({ threadId: 'b', turnId: 'unrelated' });
  core.ingestProviderEvent('wanted', { type: 'message.part.delta', data: { delta: 'keep' } });
  core.ingestProviderEvent('unrelated', { type: 'message.part.delta', data: { delta: 'drop' } });
  const expected = core.readJournalEvents().filter(e => e.turnId === 'wanted');
  const checked = [];
  const has = core.store.deletionFence.has;
  core.store.deletionFence.has = id => { checked.push(id); return has(id); };
  assert.deepEqual(core.readJournalEvents(['wanted']), expected);
  assert.ok(checked.length > 0);
  assert.ok(checked.every(id => id === 'a'));
});
