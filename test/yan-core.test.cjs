'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  InvalidTurnTransitionError,
  OpenCodeProviderAdapter,
  ProviderAdapter,
  ResourceLockManager,
  YanCore,
  YanCoreStore,
  YanEventProjector,
  canTransition,
  classifyToolCapabilities,
  createEvent,
  mapProviderEvent,
  transitionTurn
} = require('../lib/yan-core');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yan-core-'));
}

function createTestCore() {
  const rootDir = tempDir();
  let timestamp = 1_700_000_000_000;
  const core = new YanCore({
    rootDir,
    clock: () => timestamp++,
    idFactory: prefix => `${prefix}_generated`
  });
  return { core, rootDir };
}

test('Yan Protocol events preserve empty references for thread-level events', () => {
  const event = createEvent({ type: 'thread.created', threadId: 'thread-1', payload: {} }, {
    sequence: 1,
    clock: () => 1
  });
  assert.equal(event.threadId, 'thread-1');
  assert.equal(event.turnId, '');
  assert.equal(event.protocolVersion, 1);
});

test('turn state machine accepts the supported lifecycle and rejects terminal reuse', () => {
  assert.equal(canTransition('running', 'waiting_for_tool'), true);
  assert.equal(canTransition('waiting_for_tool', 'running'), true);
  assert.equal(canTransition('completed', 'running'), false);
  assert.throws(
    () => transitionTurn({ id: 'turn-1', status: 'completed' }, 'running'),
    error => error instanceof InvalidTurnTransitionError && error.code === 'YAN_INVALID_TURN_TRANSITION'
  );
});

test('core creates a thread and a configuration-frozen turn with ordered events', () => {
  const { core, rootDir } = createTestCore();
  const turn = core.startTurn({
    threadId: 'thread-a',
    turnId: 'turn-a',
    workspace: 'C:/work',
    configSnapshot: { providerId: 'deepseek', modelId: 'deepseek-v4-flash', workMode: 'plan', nested: { value: 1 } },
    intent: { prompt: 'build it', workMode: 'plan', attachments: [{ name: 'brief.md', mimeType: 'text/markdown', size: 10 }] }
  });
  assert.equal(turn.status, 'running');
  assert.equal(turn.threadId, 'thread-a');
  assert.equal(turn.configSnapshot.workMode, 'plan');
  assert.equal(turn.intent.workMode, 'plan');
  assert.equal(turn.configSnapshotId, 'snapshot_generated');
  assert.equal(core.getThread('thread-a').activeTurnId, 'turn-a');
  const events = new YanCoreStore({ rootDir }).readEvents();
  assert.deepEqual(events.map(event => event.type), ['thread.created', 'turn.created', 'turn.started']);
  assert.deepEqual(events.map(event => event.sequence), [1, 2, 3]);
  assert.equal(events[0].turnId, '');
  assert.equal(events[1].payload.configSnapshotId, 'snapshot_generated');
  assert.equal(events[2].payload.configSnapshotId, 'snapshot_generated');
});

test('provider events are normalized and tool lifecycle updates the turn state', () => {
  const { core } = createTestCore();
  core.startTurn({ threadId: 'thread-a', turnId: 'turn-a' });
  const started = core.ingestProviderEvent('turn-a', {
    type: 'session.next.tool.called',
    data: { callID: 'call-1', tool: 'read' }
  });
  assert.equal(started.type, 'tool.started');
  assert.equal(started.payload.configSnapshotId, core.getTurn('turn-a').configSnapshotId);
  assert.equal(core.getTurn('turn-a').status, 'waiting_for_tool');
  const progress = core.ingestProviderEvent('turn-a', {
    type: 'message.part.updated',
    properties: { part: { type: 'tool', callID: 'call-1', tool: 'read', state: { status: 'running' } } }
  });
  assert.equal(progress.type, 'tool.progress');
  const completed = core.ingestProviderEvent('turn-a', {
    type: 'session.next.tool.success',
    data: { callID: 'call-1', tool: 'read' }
  });
  assert.equal(completed.type, 'tool.completed');
  assert.equal(core.getTurn('turn-a').status, 'running');
  assert.equal(mapProviderEvent({ type: 'message.part.delta', data: { field: 'reasoning', delta: 'thinking' } }).type, 'reasoning.delta');
  assert.equal(mapProviderEvent({ type: 'session.next.text.delta', data: { delta: 'text' } }).type, 'message.delta');
  assert.equal(mapProviderEvent({ type: 'session.next.reasoning.delta', data: { delta: 'thinking' } }).type, 'reasoning.delta');
  assert.equal(mapProviderEvent({ type: 'yan.opencode.started' }).type, 'provider.event');
  assert.equal(mapProviderEvent({ type: 'yan.delivery.acceptance.started', data: { round: 1 } }).type, 'delivery.acceptance.started');
});

test('persists bounded delivery evidence on the completed Turn', () => {
  const { core } = createTestCore();
  core.startTurn({ threadId: 'thread-delivery', turnId: 'turn-delivery' });
  const turn = core.completeTurn('turn-delivery', {
    status: 'done',
    text: '交付通过',
    delivery: {
      intent: 'delivery',
      artifact: 'backend',
      acceptanceRounds: 2,
      repairRounds: 1,
      verified: true,
      skipped: false,
      failure: ''
    }
  });
  assert.equal(turn.result.delivery.verified, true);
  assert.equal(turn.result.delivery.acceptanceRounds, 2);
  assert.equal(core.getTurn('turn-delivery').result.delivery.artifact, 'backend');
});

test('queued intents persist across reloads and remain idempotent through consume, requeue, and delete', () => {
  const first = createTestCore();
  const queued = first.core.enqueueIntent({
    threadId: 'thread-queue-a',
    intentId: 'intent-queue-a',
    intent: { prompt: 'persist me', workMode: 'plan', selectedSkills: [{ id: 'yan-serena' }] }
  });
  first.core.enqueueIntent({
    threadId: 'thread-queue-b',
    intentId: 'intent-queue-b',
    intent: { prompt: 'other thread' }
  });
  assert.equal(queued.status, 'queued');
  assert.equal(queued.intent.workMode, 'plan');

  const second = new YanCore({
    rootDir: first.rootDir,
    clock: () => 1_800_000_000_000,
    idFactory: prefix => `${prefix}_reloaded`
  });
  assert.deepEqual(second.listQueuedIntents('thread-queue-a').map(intent => intent.id), ['intent-queue-a']);
  assert.equal(second.listQueuedIntents('thread-queue-a')[0].intent.workMode, 'plan');
  assert.deepEqual(second.listQueuedIntents('thread-queue-b').map(intent => intent.id), ['intent-queue-b']);

  const duplicate = second.enqueueIntent({
    threadId: 'thread-queue-a',
    intentId: 'intent-queue-a',
    intent: { prompt: 'must not overwrite' }
  });
  assert.equal(duplicate.intent.prompt, 'persist me');
  assert.equal(second.listQueuedIntents('thread-queue-a').length, 1);

  const consumed = second.consumeIntent('intent-queue-a');
  assert.equal(consumed.status, 'consumed');
  assert.deepEqual(second.listQueuedIntents('thread-queue-a'), []);

  const requeued = second.requeueIntent('intent-queue-a');
  assert.equal(requeued.status, 'queued');
  assert.deepEqual(second.listQueuedIntents('thread-queue-a').map(intent => intent.id), ['intent-queue-a']);

  const deleted = second.deleteIntent('intent-queue-a', 'test_cleanup');
  assert.equal(deleted.ok, true);
  assert.equal(deleted.intent.status, 'deleted');
  assert.deepEqual(second.listQueuedIntents('thread-queue-a'), []);
  assert.equal(second.requeueIntent('intent-queue-a'), null);
  assert.deepEqual(second.listQueuedIntents('thread-queue-b').map(intent => intent.id), ['intent-queue-b']);
  const events = new YanCoreStore({ rootDir: first.rootDir }).readEvents();
  assert.deepEqual(events
    .filter(event => event.turnId === 'intent-queue-a')
    .map(event => event.type), ['turn.queued', 'turn.dequeued', 'turn.queued', 'turn.dequeued']);
});

test('consumed intents carry a dispatch claim and acknowledge only after submit succeeds', () => {
  const { core } = createTestCore();
  core.enqueueIntent({ threadId: 'thread-ack', intentId: 'intent-ack', intent: { prompt: 'ack me' } });
  const consumed = core.consumeIntent('intent-ack');
  assert.equal(consumed.status, 'consumed');
  assert.ok(consumed.dispatchingAt > 0);
  const acknowledged = core.ackIntent('intent-ack');
  assert.equal(acknowledged.status, 'dispatched');
  assert.equal(core.listQueuedIntents('thread-ack').length, 0);
  assert.equal(core.ackIntent('intent-ack').status, 'dispatched');
});

test('cancellation is three-phase: requested, still live, settled by completion', () => {
  const { core, rootDir } = createTestCore();
  core.startTurn({ threadId: 'thread-a', turnId: 'turn-a' });
  const cancelled = core.requestCancel('turn-a', 'user_cancelled');
  assert.equal(cancelled.cancelled, true);
  const turn = core.getTurn('turn-a');
  assert.equal(turn.status, 'running');
  assert.equal(turn.cancelRequested, true);
  // The kernel keeps streaming while it winds down after the cancel.
  assert.ok(core.ingestProviderEvent('turn-a', { type: 'message.part.delta', data: { field: 'text', delta: 'tail' } }));
  const settled = core.completeTurn('turn-a', { status: 'interrupted', text: 'partial text' });
  assert.equal(settled.status, 'aborted');
  assert.equal(settled.result.text, 'partial text');
  const repeated = core.requestCancel('turn-a');
  assert.equal(repeated.alreadySettled, true);
  assert.equal(core.ingestProviderEvent('turn-a', { type: 'message.part.delta', data: { delta: 'ignored' } }), null);
  const events = new YanCoreStore({ rootDir }).readEvents();
  assert.deepEqual(events.filter(event => event.turnId === 'turn-a').map(event => event.type), [
    'turn.created',
    'turn.started',
    'turn.cancel.requested',
    'message.delta',
    'item.created',
    'turn.aborted'
  ]);
});

test('cancel ack timeout force-settles a turn that never completes', async () => {
  const rootDir = tempDir();
  let tick = 2_100_000_000_000;
  let idCounter = 0;
  const core = new YanCore({
    rootDir,
    clock: () => tick++,
    idFactory: prefix => `${prefix}_${++idCounter}`,
    cancelTimeoutMs: 20
  });
  core.startTurn({ threadId: 'thread-a', turnId: 'turn-a' });
  core.requestCancel('turn-a', 'user_cancelled');
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(core.getTurn('turn-a').status, 'aborted');
  const events = new YanCoreStore({ rootDir }).readEvents();
  const types = events.map(event => event.type);
  assert.ok(types.includes('turn.cancel.requested'));
  assert.equal(types.at(-1), 'turn.aborted');
});

test('recovery marks non-terminal turns and persists a replayable event', () => {
  const first = createTestCore();
  first.core.startTurn({ threadId: 'thread-a', turnId: 'turn-a' });
  const second = new YanCore({
    rootDir: first.rootDir,
    clock: () => 1_800_000_000_000,
    idFactory: prefix => `${prefix}_recovered`
  });
  const recovered = second.recoverInterruptedTurns();
  assert.equal(recovered.length, 1);
  assert.equal(second.getTurn('turn-a').status, 'recovering');
  assert.equal(second.getTurn('turn-a').recovery.previousStatus, 'running');
  const events = new YanCoreStore({ rootDir: first.rootDir }).readEvents();
  assert.equal(events.at(-1).type, 'thread.recovered');
  assert.equal(events.at(-1).turnId, 'turn-a');
});

test('event projector ignores duplicate and out-of-order events', () => {
  const projector = new YanEventProjector();
  const base = { protocolVersion: 1, eventId: 'evt-1', sequence: 1, type: 'turn.started', threadId: 'thread-a', turnId: 'turn-a', payload: { turn: { id: 'turn-a', status: 'running' } } };
  assert.equal(projector.apply(base).applied, true);
  assert.equal(projector.apply(base).reason, 'duplicate');
  assert.equal(projector.apply({ ...base, eventId: 'evt-0', sequence: 0 }).reason, 'out_of_order');
  assert.equal(projector.snapshot().turns['turn-a'].status, 'running');
});

test('event projector tracks queued intent lifecycle separately from turns', () => {
  const projector = new YanEventProjector();
  projector.apply({
    protocolVersion: 1,
    eventId: 'evt-queue-1',
    sequence: 1,
    type: 'turn.queued',
    threadId: 'thread-a',
    turnId: 'intent-a',
    payload: { intent: { id: 'intent-a', threadId: 'thread-a', status: 'queued', intent: { prompt: 'hello' } } }
  });
  projector.apply({
    protocolVersion: 1,
    eventId: 'evt-queue-2',
    sequence: 2,
    type: 'turn.dequeued',
    threadId: 'thread-a',
    turnId: 'intent-a',
    payload: { intent: { id: 'intent-a', threadId: 'thread-a', status: 'consumed' } }
  });
  const snapshot = projector.snapshot();
  assert.equal(snapshot.intents['intent-a'].status, 'consumed');
  assert.equal(snapshot.turns['intent-a'], undefined);
});

test('event store tolerates an incomplete trailing JSONL record', () => {
  const rootDir = tempDir();
  const store = new YanCoreStore({ rootDir });
  store.appendEvent({ sequence: 1, eventId: 'evt-1', type: 'provider.event' });
  fs.appendFileSync(store.eventsPath, '{"sequence":2', 'utf8');
  assert.deepEqual(store.readEvents(), [{ sequence: 1, eventId: 'evt-1', type: 'provider.event' }]);
});

test('lastEventSequence recovers the durable cursor from the log tail', () => {
  const rootDir = tempDir();
  const store = new YanCoreStore({ rootDir });
  assert.equal(store.lastEventSequence(), 0);
  store.appendEvent({ sequence: 7, eventId: 'evt-7', type: 'provider.event' });
  fs.appendFileSync(store.eventsPath, '{"sequence":8', 'utf8');
  assert.equal(store.lastEventSequence(), 7);
});

test('delta events append to the log without rewriting state on every chunk', async () => {
  const { core, rootDir } = createTestCore();
  let saves = 0;
  const originalSave = core.store.save.bind(core.store);
  core.store.save = snapshot => {
    saves += 1;
    return originalSave(snapshot);
  };
  core.startTurn({ threadId: 'thread-a', turnId: 'turn-a' });
  const savesAfterStart = saves;
  assert.ok(savesAfterStart >= 3);
  for (let index = 0; index < 50; index += 1) {
    core.ingestProviderEvent('turn-a', { type: 'message.part.delta', data: { field: 'text', delta: 'x' } });
  }
  for (let index = 0; index < 10; index += 1) {
    core.ingestProviderEvent('turn-a', { type: 'session.next.text.delta', data: { delta: 'y' } });
  }
  assert.equal(saves, savesAfterStart);
  const store = new YanCoreStore({ rootDir });
  assert.equal(store.countEvents(), 63);
  assert.equal(store.lastEventSequence(), 63);

  // A restart before the trailing persist must still continue the sequence.
  const reloaded = new YanCore({
    rootDir,
    clock: () => 1_900_000_000_000,
    idFactory: prefix => `${prefix}_reloaded`
  });
  assert.equal(reloaded.state.nextEventSequence, 63);
  const next = reloaded.emitEvent('turn.completed', 'thread-a', 'turn-a', {});
  assert.equal(next.sequence, 64);
});

test('event log compaction keeps the tail without blocking the append path', async () => {
  const rootDir = tempDir();
  // maxEvents is clamped to a 100-event floor by the store constructor.
  // Use a long quiet-period delay so this test controls compaction explicitly.
  const store = new YanCoreStore({ rootDir, maxEvents: 100, compactionDelayMs: 60_000 });
  for (let sequence = 1; sequence <= 103; sequence += 1) {
    store.appendEvent({ sequence, eventId: `evt-${sequence}`, type: 'provider.event' });
  }
  // Crossing maxEvents must not synchronously reread and rewrite the log.
  assert.equal(store.readEvents().length, 103);
  await store.flushCompaction({ force: true });
  const compacted = store.readEvents();
  assert.equal(compacted.length, 100);
  assert.equal(compacted[0].sequence, 4);
  assert.equal(compacted.at(-1).sequence, 103);
  assert.equal(store.eventCount, 100);
  store.appendEvent({ sequence: 104, eventId: 'evt-104', type: 'provider.event' });
  await store.flushCompaction({ force: true });
  const afterAppend = store.readEvents();
  assert.equal(afterAppend.length, 100);
  assert.equal(afterAppend[0].sequence, 5);
  assert.equal(afterAppend.at(-1).sequence, 104);
});

test('event log compaction does not repeat for every streamed event', async () => {
  const rootDir = tempDir();
  const store = new YanCoreStore({
    rootDir,
    maxEvents: 100,
    compactionOverflow: 1_000,
    compactionDelayMs: 60_000
  });
  for (let sequence = 1; sequence <= 500; sequence += 1) {
    store.appendEvent({
      sequence,
      eventId: `evt-${sequence}`,
      type: 'message.delta',
      payload: { delta: 'x'.repeat(2_000) }
    });
  }
  // The old implementation performed a full-file rewrite on every append
  // after the limit. The new path only requests one idle compaction.
  assert.equal(store.compactionCount, 0);
  assert.equal(store.countEvents(), 500);
  await store.flushCompaction({ force: true });
  assert.equal(store.compactionCount, 1);
  assert.equal(store.countEvents(), 100);
  assert.equal(store.readEvents()[0].sequence, 401);
});

test('replaying a full event stream produces an identical projection', () => {
  const rootDir = tempDir();
  let tick = 1_700_000_000_000;
  let idCounter = 0;
  // Unique event IDs, like production makeId(); a shared ID would trip the
  // projector's duplicate filter and skip every event after the first.
  const core = new YanCore({
    rootDir,
    clock: () => tick++,
    idFactory: prefix => `${prefix}_${++idCounter}`
  });
  core.startTurn({ threadId: 'thread-a', turnId: 'turn-a', configSnapshot: { modelId: 'm1' } });
  core.enqueueIntent({ threadId: 'thread-a', intentId: 'intent-a', intent: { prompt: 'queued prompt' } });
  core.ingestProviderEvent('turn-a', { type: 'session.next.tool.called', data: { callID: 'c1', tool: 'bash' } });
  core.ingestProviderEvent('turn-a', { type: 'session.next.tool.success', data: { callID: 'c1', tool: 'bash' } });
  core.completeTurn('turn-a', { status: 'done', text: 'ok' });

  const events = new YanCoreStore({ rootDir }).readEvents();
  const once = new YanEventProjector();
  once.applyAll(events);
  const twice = new YanEventProjector();
  twice.applyAll(events);
  twice.applyAll(events);
  assert.deepEqual(twice.snapshot(), once.snapshot());
  assert.equal(twice.snapshot().turns['turn-a'].status, 'completed');
  assert.equal(twice.snapshot().intents['intent-a'].status, 'queued');
});

test('a crash loses no task state and never reuses event sequences', () => {
  const first = createTestCore();
  first.core.startTurn({ threadId: 'thread-a', turnId: 'turn-a' });
  first.core.completeTurn('turn-a', { status: 'done', text: 'done text' });
  first.core.startTurn({ threadId: 'thread-b', turnId: 'turn-b' });
  first.core.enqueueIntent({ threadId: 'thread-b', intentId: 'intent-b', intent: { prompt: 'queued work' } });
  for (let index = 0; index < 50; index += 1) {
    first.core.ingestProviderEvent('turn-b', { type: 'message.part.delta', data: { field: 'text', delta: 'x' } });
  }

  const reloaded = new YanCore({
    rootDir: first.rootDir,
    clock: () => 2_000_000_000_000,
    idFactory: prefix => `${prefix}_recovered`
  });
  assert.equal(reloaded.getTurn('turn-a').status, 'completed');
  assert.deepEqual(reloaded.listQueuedIntents('thread-b').map(intent => intent.id), ['intent-b']);
  assert.deepEqual(reloaded.recoverInterruptedTurns().map(turn => turn.id), ['turn-b']);

  const next = reloaded.emitEvent('provider.event', 'thread-b', 'turn-b', {});
  const events = new YanCoreStore({ rootDir: first.rootDir }).readEvents();
  // 9 lifecycle events (incl. the message item.created from completeTurn)
  // + 50 deltas + 1 thread.recovered, then the new event.
  assert.equal(next.sequence, 61);
  const sequences = events.map(event => event.sequence);
  assert.equal(new Set(sequences).size, sequences.length);
  assert.equal(Math.max(...sequences), 61);
});

// Items / context / tools / adapter use unique generated IDs so projector
// replay is not tripped by the shared-ID duplicate filter.
function createUniqueTestCore() {
  const rootDir = tempDir();
  let tick = 2_200_000_000_000;
  let idCounter = 0;
  const core = new YanCore({
    rootDir,
    clock: () => tick++,
    idFactory: prefix => `${prefix}_${++idCounter}`
  });
  return { core, rootDir };
}

test('tool calls and final results converge into persisted Items', () => {
  const { core, rootDir } = createUniqueTestCore();
  core.startTurn({ threadId: 'thread-a', turnId: 'turn-a' });
  core.ingestProviderEvent('turn-a', { type: 'session.next.tool.called', data: { callID: 'c1', tool: 'bash' } });
  const running = core.listItems('turn-a');
  assert.equal(running.length, 1);
  assert.equal(running[0].type, 'tool_call');
  assert.equal(running[0].status, 'running');
  core.ingestProviderEvent('turn-a', { type: 'session.next.tool.success', data: { callID: 'c1', tool: 'bash' } });
  core.completeTurn('turn-a', {
    status: 'done',
    text: 'finished',
    toolCalls: [{ callId: 'c1', name: 'bash', ok: true, output: 'ok' }],
    usage: { input: 100, output: 10, cacheRead: 5, cacheWrite: 0, cost: 0.01 }
  });
  const items = core.listItems('turn-a');
  const byId = new Map(items.map(item => [item.id, item]));
  assert.equal(byId.get('turn-a:tool:c1').status, 'completed');
  assert.equal(byId.get('turn-a:message').payload.text, 'finished');
  assert.equal(byId.get('turn-a:context').payload.input, 100);

  const reloaded = new YanCore({ rootDir, clock: () => 2_300_000_000_000, idFactory: prefix => `${prefix}_r` });
  assert.equal(reloaded.listItems('turn-a').length, items.length);

  const events = new YanCoreStore({ rootDir }).readEvents();
  const projector = new YanEventProjector();
  projector.applyAll(events);
  assert.equal(projector.snapshot().items['turn-a:tool:c1'].status, 'completed');
  assert.equal(projector.snapshot().items['turn-a:message'].payload.text, 'finished');
});

test('context statistics and compaction events are tracked per turn', () => {
  const { core } = createUniqueTestCore();
  core.startTurn({ threadId: 'thread-a', turnId: 'turn-a' });
  core.ingestProviderEvent('turn-a', { type: 'yan.context.budget', data: { contextWindow: 100_000, softThreshold: 80_000 } });
  core.ingestProviderEvent('turn-a', {
    type: 'message.updated',
    properties: { info: { id: 'm1', role: 'assistant', tokens: { input: 900, output: 50, cache: { read: 100, write: 20 } } } }
  });
  let state = core.getContextState('thread-a');
  assert.equal(state.contextStats.window, 100_000);
  assert.equal(state.contextStats.softThreshold, 80_000);
  assert.equal(state.contextStats.lastObservedTokens, 1_070);
  core.ingestProviderEvent('turn-a', { type: 'yan.context.compression.completed', data: { beforeTokens: 1_070, afterTokens: 300 } });
  state = core.getContextState('thread-a');
  assert.equal(state.contextStats.contextTokens, 300);
  assert.equal(state.contextStats.compactionCount, 1);
  const compactionItems = core.listItems('turn-a').filter(item => item.type === 'compaction');
  assert.equal(compactionItems.length, 1);
  assert.equal(compactionItems[0].status, 'completed');
});

test('resource locks allow shared readers, exclusive writers, and fair FIFO waits', async () => {
  const locks = new ResourceLockManager();
  const reader1 = await locks.acquire('file:a', 'read', { owner: 'r1', timeoutMs: 100 });
  const reader2 = await locks.acquire('file:a', 'read', { owner: 'r2', timeoutMs: 100 });
  assert.equal(locks.status().resources['file:a'].holders, 2);
  let writerAcquired = false;
  const writerPromise = locks.acquire('file:a', 'write', { owner: 'w1', timeoutMs: 1_000 })
    .then(handle => {
      writerAcquired = true;
      return handle;
    });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(writerAcquired, false);
  locks.release(reader1);
  locks.release(reader2);
  const writer = await writerPromise;
  assert.equal(writerAcquired, true);
  await assert.rejects(
    locks.acquire('file:a', 'read', { timeoutMs: 30 }),
    error => error.code === 'YAN_LOCK_TIMEOUT'
  );
  locks.release(writer);
  const next = await locks.acquire('file:a', 'read', { timeoutMs: 100 });
  assert.ok(next);
});

test('tool capability classification treats unknown tools as mutating', () => {
  assert.equal(classifyToolCapabilities('read').mutating, false);
  assert.equal(classifyToolCapabilities('yan_skills_read_skill').mutating, false);
  const bash = classifyToolCapabilities('bash');
  assert.equal(bash.shell, true);
  assert.equal(bash.network, true);
  assert.equal(bash.mutating, true);
  assert.equal(classifyToolCapabilities('git_commit').git, true);
  assert.equal(classifyToolCapabilities('git_commit').mutating, true);
  assert.equal(classifyToolCapabilities('some_new_mcp_tool').mutating, true);
});

test('provider adapter normalizes usage/finish reasons and delegates to the sidecar', async () => {
  const calls = [];
  const fakeSidecar = {
    run: async (request, onEvent) => {
      calls.push(['run', request]);
      onEvent?.({ type: 'session.error', data: {} });
      return { status: 'done' };
    },
    cancel: async runId => {
      calls.push(['cancel', runId]);
      return { ok: true };
    }
  };
  const adapter = new OpenCodeProviderAdapter(fakeSidecar);
  assert.equal(adapter.name, 'opencode');
  assert.equal(adapter.supportsResume, true);
  const result = await adapter.startTurn({ prompt: 'hi' });
  assert.deepEqual(result, { status: 'done' });
  await adapter.cancel('turn-1');
  assert.deepEqual(calls[1], ['cancel', 'turn-1']);
  assert.deepEqual(
    adapter.normalizeUsage({ input: 3, cache: { read: 4, write: 5 } }),
    { input: 3, output: 0, reasoning: 0, cacheRead: 4, cacheWrite: 5, cost: 0 }
  );
  assert.equal(adapter.isSettledFinishReason('stop'), true);
  assert.equal(adapter.isSettledFinishReason('tool-calls'), false);
  assert.equal(adapter.isSettledFinishReason(''), false);
  assert.deepEqual(await adapter.healthCheck(), { ok: false, reason: 'kernel_not_started' });
  await assert.rejects(new ProviderAdapter('minimal').startTurn({}));
});

test('transient provider errors do not fail a Turn before a retry succeeds', () => {
  const { core } = createUniqueTestCore();
  core.startTurn({ threadId: 'thread-retry', turnId: 'turn-retry' });
  const errorEvent = core.ingestProviderEvent('turn-retry', { type: 'session.error', data: { message: 'temporary stream reset' } });
  assert.equal(errorEvent.type, 'provider.error');
  assert.equal(core.getTurn('turn-retry').status, 'running');
  core.ingestProviderEvent('turn-retry', { type: 'yan.model.retrying', data: { attempt: 2 } });
  const completed = core.completeTurn('turn-retry', { status: 'done', text: 'retry succeeded' });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.telemetry.retries, 1);
});

test('projector reconstructs lifecycle state, Items, and context statistics', () => {
  const { core, rootDir } = createUniqueTestCore();
  core.startTurn({ threadId: 'thread-projection', turnId: 'turn-projection' });
  core.ingestProviderEvent('turn-projection', { type: 'yan.context.budget', data: { contextWindow: 20_000, softThreshold: 16_000 } });
  core.ingestProviderEvent('turn-projection', { type: 'session.next.tool.called', data: { callID: 'call-1', tool: 'bash' } });
  core.ingestProviderEvent('turn-projection', { type: 'session.next.tool.success', data: { callID: 'call-1', tool: 'bash' } });
  core.completeTurn('turn-projection', { status: 'done', text: 'ok', changes: [{ path: 'src/a.js', additions: 1 }] });
  const projector = new YanEventProjector();
  projector.applyAll(new YanCoreStore({ rootDir }).readEvents());
  const projection = projector.snapshot();
  assert.equal(projection.threads['thread-projection'].status, 'idle');
  assert.deepEqual(projection.threads['thread-projection'].turnIds, ['turn-projection']);
  assert.equal(projection.turns['turn-projection'].status, 'completed');
  assert.ok(projection.turns['turn-projection'].itemIds.includes('turn-projection:message'));
  assert.equal(projection.items['turn-projection:tool:call-1'].status, 'completed');
  assert.equal(projection.items['turn-projection:file:src/a.js'].type, 'file_change');
});

test('corrupt state snapshots are backed up and recovered from events', () => {
  const first = createUniqueTestCore();
  first.core.startTurn({ threadId: 'thread-corrupt', turnId: 'turn-corrupt' });
  first.core.completeTurn('turn-corrupt', { status: 'done', text: 'recovered' });
  fs.writeFileSync(path.join(first.rootDir, 'state.json'), '{broken', 'utf8');
  const recovered = new YanCore({ rootDir: first.rootDir });
  assert.equal(recovered.getTurn('turn-corrupt').status, 'completed');
  assert.ok(fs.readdirSync(first.rootDir).some(name => name.startsWith('state.json.corrupt-')));
});

test('a Thread rejects a second non-terminal Turn even when activeTurnId is stale', () => {
  const { core } = createUniqueTestCore();
  core.startTurn({ threadId: 'thread-busy', turnId: 'turn-busy-a' });
  core.state.threads['thread-busy'].activeTurnId = '';
  assert.throws(() => core.startTurn({ threadId: 'thread-busy', turnId: 'turn-busy-b' }), error => error.code === 'YAN_THREAD_BUSY');
});

test('late success after cancellation settles as aborted without a final message', () => {
  const { core } = createUniqueTestCore();
  core.startTurn({ threadId: 'thread-late', turnId: 'turn-late' });
  core.requestCancel('turn-late');
  const settled = core.completeTurn('turn-late', { status: 'done', text: 'late provider success' });
  assert.equal(settled.status, 'aborted');
  assert.equal(settled.result.status, 'interrupted');
  assert.equal(core.listItems('turn-late').some(item => item.type === 'message'), false);
});

test('backpressure and Thread deletion are persisted as authoritative Core state', () => {
  const { core, rootDir } = createUniqueTestCore();
  core.startTurn({ threadId: 'thread-delete', turnId: 'turn-delete' });
  core.recordBackpressure('turn-delete', { dropped: 3, pending: 4, cap: 5 });
  assert.equal(core.getTurn('turn-delete').telemetry.backpressureDrops, 3);
  core.completeTurn('turn-delete', { status: 'done', text: 'done' });
  const deleted = core.deleteThread('thread-delete');
  assert.equal(deleted.ok, true);
  assert.equal(core.getThread('thread-delete'), null);
  assert.equal(core.getTurn('turn-delete'), null);
  const events = new YanCoreStore({ rootDir }).readEvents();
  assert.equal(events.at(-1).type, 'thread.deleted');
});

test('a stale Turn from a previous process settles instead of bricking the thread', () => {
  const first = createTestCore();
  first.core.startTurn({ threadId: 'thread-crash', turnId: 'run-1' });
  // --- the app restarts; the kernel died together with run-1 ---
  const second = new YanCore({
    rootDir: first.rootDir,
    clock: () => 2_400_000_000_000,
    idFactory: prefix => `${prefix}_next`
  });
  second.recoverInterruptedTurns();
  assert.equal(second.getTurn('run-1').status, 'recovering');

  // The user sends a new message in the same session: the stale Turn must be
  // settled, not refused.
  const next = second.startTurn({ threadId: 'thread-crash', turnId: 'run-2' });
  assert.equal(next.status, 'running');
  assert.equal(second.getTurn('run-1').status, 'aborted');

  // Genuine same-process concurrency is still refused.
  assert.throws(
    () => second.startTurn({ threadId: 'thread-crash', turnId: 'run-3' }),
    error => error.code === 'YAN_THREAD_BUSY'
  );

  second.completeTurn('run-2', { status: 'done', text: 'ok' });
  assert.equal(second.startTurn({ threadId: 'thread-crash', turnId: 'run-4' }).status, 'running');
});

test('a late provider result merges into an already settled turn without a second terminal event', () => {
  const { core, rootDir } = createTestCore();
  core.startTurn({ threadId: 'thread-a', turnId: 'turn-a' });
  core.completeTurn('turn-a', { status: 'error', error: 'first failure' });
  const countTerminalEvents = () => new YanCoreStore({ rootDir }).readEvents()
    .filter(event => event.type === 'turn.failed').length;
  const before = countTerminalEvents();

  const late = core.completeTurn('turn-a', { status: 'error', error: 'late detail', text: 'recovered text' });
  assert.equal(late.status, 'failed');
  assert.equal(late.result.error, 'late detail');
  assert.equal(late.result.text, 'recovered text');
  assert.equal(late.result.status, 'error');
  assert.equal(countTerminalEvents(), before);
});

test('tool bursts defer the state snapshot and one terminal write covers the whole burst', async () => {
  const { core, rootDir } = createUniqueTestCore();
  core.startTurn({ threadId: 'thread-burst', turnId: 'turn-burst' });
  let saves = 0;
  const originalSave = core.store.save.bind(core.store);
  core.store.save = snapshot => {
    saves += 1;
    return originalSave(snapshot);
  };
  for (let index = 0; index < 12; index += 1) {
    core.ingestProviderEvent('turn-burst', {
      type: 'session.next.tool.called',
      data: { callID: `call-${index}`, tool: 'read' }
    });
    core.ingestProviderEvent('turn-burst', {
      type: 'session.next.tool.success',
      data: { callID: `call-${index}`, tool: 'read' }
    });
  }
  assert.equal(saves, 0);
  core.completeTurn('turn-burst', {
    status: 'done',
    text: 'done',
    toolCalls: [{ callId: 'call-11', name: 'read', ok: true, output: 'ok' }]
  });
  assert.equal(saves, 1);
  // persist() must cancel the pending debounce instead of writing twice.
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal(saves, 1);
  const reloaded = new YanCore({ rootDir, clock: () => 2_500_000_000_000, idFactory: prefix => `${prefix}_r` });
  assert.equal(reloaded.getTurn('turn-burst').status, 'completed');
  assert.ok(reloaded.listItems('turn-burst').some(item => item.id === 'turn-burst:tool:call-11'));
});

test('a quiet gap after deferred events still flushes the state snapshot', async () => {
  const { core, rootDir } = createUniqueTestCore();
  core.startTurn({ threadId: 'thread-quiet', turnId: 'turn-quiet' });
  core.ingestProviderEvent('turn-quiet', {
    type: 'session.next.tool.called',
    data: { callID: 'call-quiet', tool: 'read' }
  });
  const reloaded = new YanCore({ rootDir, clock: () => 2_500_000_000_000, idFactory: prefix => `${prefix}_r` });
  assert.equal(reloaded.listItems('turn-quiet').some(item => item.id === 'turn-quiet:tool:call-quiet'), false);
  await new Promise(resolve => setTimeout(resolve, 650));
  const flushed = new YanCore({ rootDir, clock: () => 2_500_000_000_000, idFactory: prefix => `${prefix}_r` });
  assert.ok(flushed.listItems('turn-quiet').some(item => item.id === 'turn-quiet:tool:call-quiet'));
});
