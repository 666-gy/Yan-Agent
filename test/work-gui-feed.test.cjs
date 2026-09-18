'use strict';

// Work GUI feed: normalization, coalescing, subagent tracking, home
// persistence and snapshot shape. These tests drive the feed exactly like the
// main process does — one Yan Core event at a time.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { WorkGuiFeed, zoneForTool } = require('../lib/work-gui/feed');
const { WorkGuiHomeStore } = require('../lib/work-gui/home-store');

function makeFeed(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-work-gui-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const batches = [];
  const core = {
    getThread: id => ({ id, title: '测试任务' }),
    getTurn: () => ({ contextStats: { lastObservedTokens: 12_000, softThreshold: 60_000 } })
  };
  const feed = new WorkGuiFeed({
    dataDir: dir,
    core: () => core,
    emit: batch => batches.push(batch),
    listSessions: async () => [{ id: 'sess_1', title: '测试任务', updatedAt: Date.now() }],
    listSkills: () => [{ id: 'code-simplifier', name: 'Code Simplifier' }],
    listMcp: () => [{ id: 'mcp_default_codegraph', name: 'CodeGraph', enabled: true }],
    listMemory: () => ({ count: 7, recent: [{ title: '记住的事项' }] }),
    logger: { warn: () => {} },
    ...overrides
  });
  t.after(() => feed.dispose());
  return { feed, batches, dir };
}

function coreEvent(type, payload, turnId = 'run_1', threadId = 'sess_1') {
  return { type, turnId, threadId, timestamp: Date.now(), payload };
}

function turnRecord(patch = {}) {
  return {
    id: 'run_1',
    threadId: 'sess_1',
    status: 'created',
    configSnapshot: { modelId: 'm', modelName: 'M 模型' },
    intent: { prompt: '请修复这个 bug', selectedSkills: [{ id: 'code-simplifier' }] },
    ...patch
  };
}

function allEvents(batches) {
  return batches.flatMap(batch => batch.events);
}

test('tool calls map to stations and text deltas are coalesced per flush', async t => {
  const { feed, batches } = makeFeed(t);
  feed.handleCoreEvent(coreEvent('turn.created', { turn: turnRecord() }));
  feed.handleCoreEvent(coreEvent('turn.started', { turn: turnRecord({ status: 'running' }) }));
  feed.handleCoreEvent(coreEvent('tool.started', {
    callId: 'c1',
    tool: 'bash',
    status: 'running',
    rawType: 'session.next.tool.called',
    data: { part: { state: { input: { command: 'npm test' } } } }
  }));
  feed.handleCoreEvent(coreEvent('message.delta', { delta: '第一段' }));
  feed.handleCoreEvent(coreEvent('message.delta', { delta: '第二段' }));
  feed.flush();

  const events = allEvents(batches);
  const started = events.find(event => event.kind === 'run.started');
  assert.ok(started, 'run.started must be emitted');
  assert.equal(started.payload.title, '测试任务');
  assert.equal(started.payload.model, 'M 模型');

  const tool = events.find(event => event.kind === 'tool.started');
  assert.equal(tool.payload.zone, 'forge');
  assert.equal(tool.payload.zoneName, '熔炉');
  assert.equal(tool.payload.tool, 'bash');
  assert.equal(tool.payload.input, 'npm test');

  const textEvents = events.filter(event => event.kind === 'message.delta');
  assert.equal(textEvents.length, 1, 'deltas inside one flush window collapse into one event');
  assert.equal(textEvents[0].payload.delta, '第一段第二段');
});

test('zone mapping covers read, browser, media and planning tools', () => {
  assert.equal(zoneForTool('read'), 'library');
  assert.equal(zoneForTool('yan_analysis_code_search'), 'library');
  assert.equal(zoneForTool('edit'), 'workshop');
  assert.equal(zoneForTool('browser_click'), 'tower');
  assert.equal(zoneForTool('yan_media_generate_image'), 'studio');
  assert.equal(zoneForTool('todo_write'), 'hall');
  assert.equal(zoneForTool('task'), 'hall');
  assert.equal(zoneForTool('mystery_tool'), 'workshop');
});

test('finished turns persist the home island and unlock achievements', async t => {
  const { feed, batches, dir } = makeFeed(t);
  feed.handleCoreEvent(coreEvent('turn.created', { turn: turnRecord() }));
  feed.handleCoreEvent(coreEvent('turn.started', { turn: turnRecord({ status: 'running' }) }));
  feed.handleCoreEvent(coreEvent('turn.completed', {
    status: 'completed',
    text: '完成',
    delivery: { verified: true }
  }));
  feed.flush();

  const finished = allEvents(batches).find(event => event.kind === 'run.finished');
  assert.ok(finished);
  assert.equal(finished.payload.status, 'completed');

  const homePath = path.join(dir, 'work-gui', 'home.json');
  assert.equal(fs.existsSync(homePath), true, 'home.json must be persisted');
  const stored = JSON.parse(fs.readFileSync(homePath, 'utf8'));
  assert.equal(stored.totals.completed, 1);
  assert.equal(stored.totals.deliveries, 1);
  assert.equal(stored.skills['code-simplifier'].uses, 1);
  assert.deepEqual(stored.achievements.map(item => item.id).sort(), ['first-delivery', 'first-voyage']);

  const snapshot = await feed.snapshot();
  assert.equal(snapshot.home.totals.completed, 1);
  assert.equal(snapshot.home.buildings.length, 2, 'skill building + MCP harbor');
  assert.equal(snapshot.home.memory.count, 7);
  assert.equal(snapshot.home.dayPhase, 'day');
  assert.equal(snapshot.sessions.length, 1);
});

test('provider errors surface as storms and retries as repairs', async t => {
  const { feed, batches } = makeFeed(t);
  feed.handleCoreEvent(coreEvent('turn.created', { turn: turnRecord() }));
  feed.handleCoreEvent(coreEvent('turn.started', { turn: turnRecord({ status: 'running' }) }));
  feed.handleCoreEvent(coreEvent('provider.error', { data: { error: { message: '连接超时' } } }));
  feed.handleCoreEvent(coreEvent('turn.retrying', { reason: 'provider_retry' }));
  feed.flush();

  const events = allEvents(batches);
  assert.equal(events.find(event => event.kind === 'storm')?.payload.message, '连接超时');
  assert.ok(events.find(event => event.kind === 'repair'), 'retry must surface as a repair');
});

test('subagent task parts spawn helpers tracked with their own activity', async t => {
  const { feed, batches } = makeFeed(t);
  feed.handleCoreEvent(coreEvent('turn.created', { turn: turnRecord() }));
  feed.handleCoreEvent(coreEvent('turn.started', { turn: turnRecord({ status: 'running' }) }));
  feed.handleCoreEvent(coreEvent('tool.started', {
    callId: 't1',
    tool: 'task',
    status: 'running',
    rawType: 'session.next.tool.called',
    data: {
      part: {
        type: 'tool',
        tool: 'task',
        callID: 't1',
        state: { status: 'running', input: { description: '探索代码库', subagent_type: 'explore' }, metadata: { sessionID: 'child_1' } }
      }
    }
  }));
  feed.handleCoreEvent(coreEvent('provider.event', {
    rawType: 'yan.subagent.event',
    data: {
      sessionID: 'child_1',
      childSessionID: 'child_1',
      callId: 't1',
      event: { type: 'message.part.updated', data: { part: { type: 'tool', tool: 'grep', callID: 'g1', state: { status: 'running' } } } }
    }
  }));
  feed.flush();

  const events = allEvents(batches);
  const spawned = events.find(event => event.kind === 'agent.spawned');
  assert.ok(spawned, 'first helper activity must spawn a helper agent');
  assert.equal(spawned.agentId, 'sub:t1');
  assert.equal(spawned.payload.name, 'Explore Agent');
  assert.equal(spawned.payload.zone, 'hall', 'a freshly spawned helper starts at the task hall');

  const updated = events.filter(event => event.kind === 'agent.updated' && event.agentId === 'sub:t1').at(-1);
  assert.ok(updated, 'child tool activity must update the helper');
  assert.equal(updated.payload.tool, 'grep');
  assert.equal(updated.payload.zone, 'library', 'child grep maps to the library station');

  const snapshot = await feed.snapshot();
  const helper = snapshot.agents.find(agent => agent.id === 'sub:t1');
  assert.ok(helper);
  assert.equal(helper.kind, 'sub');
  assert.equal(helper.state, 'working');
  assert.equal(snapshot.agents.find(agent => agent.id === 'main').name, 'Yan Agent');
});

test('context events update run energy with throttling', async t => {
  const { feed, batches } = makeFeed(t);
  feed.handleCoreEvent(coreEvent('turn.created', { turn: turnRecord() }));
  feed.handleCoreEvent(coreEvent('turn.started', { turn: turnRecord({ status: 'running' }) }));
  feed.handleCoreEvent(coreEvent('context.updated', { data: { contextTokens: 30_000, softThreshold: 60_000 } }));
  feed.flush();
  const energy = allEvents(batches).find(event => event.kind === 'energy.changed');
  assert.ok(energy);
  assert.equal(energy.payload.ratio, 0.5);
  assert.equal(energy.payload.budget, 60_000);
});

test('home store unlocks milestones exactly once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-work-gui-home-'));
  try {
    const store = new WorkGuiHomeStore({ filePath: path.join(dir, 'home.json'), logger: { warn: () => {} } });
    const first = store.recordTurn({ sessionId: 's1', title: 'A', status: 'completed', skillIds: ['sk'], toolCalls: 60, at: 1000 });
    assert.deepEqual(first.map(item => item.id).sort(), ['first-voyage']);
    const second = store.recordTurn({ sessionId: 's1', title: 'A', status: 'completed', skillIds: ['sk'], toolCalls: 60, at: 2000 });
    assert.deepEqual(second.map(item => item.id), ['hundred-tools'], 'already unlocked achievements stay unlocked');
    const reloaded = new WorkGuiHomeStore({ filePath: path.join(dir, 'home.json'), logger: { warn: () => {} } });
    assert.equal(reloaded.snapshot().totals.completed, 2);
    assert.equal(reloaded.snapshot().skillUses.sk.uses, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
