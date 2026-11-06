'use strict';

// Task-cumulative usage must be computed from the complete session, not from
// the newest tail that session:get sends to the renderer. Otherwise reopening
// a long task makes the composer capsule jump backwards.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createSessionStore } = require('../lib/session-store.js');

function fixture(t) {
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-session-usage-'));
  t.after(() => fs.rmSync(sessionsDir, { recursive: true, force: true }));
  const store = createSessionStore({
    sessionsDir,
    ensureDirs: () => fs.mkdirSync(sessionsDir, { recursive: true }),
    mainWindow: { get: () => null },
    yanagent: { migrateMemoryToWorkspace() {}, ensureYanagent() {} },
    activateWorkspace() {},
    activeRuns: new Map(),
    runAdmissions: new Map(),
    deleteCoreThread: () => ({ ok: true })
  });
  return { store, sessionsDir };
}

test('tail reads keep the complete task usage aggregate', async t => {
  const { store, sessionsDir } = fixture(t);
  const session = await store.createFreshSessionRecord({ title: '长任务用量' });
  session.messages = Array.from({ length: 50 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `消息 ${index}`,
    ts: index + 1
  }));
  session.messages[1].agentRun = {
    runId: 'old-head-run',
    usage: { input: 1000, cacheRead: 9000, cacheWrite: 100, output: 500, reasoning: 200 }
  };
  session.messages.push({
    role: 'assistant',
    content: '最新回复',
    ts: 100,
    agentRun: {
      runId: 'new-tail-run',
      usage: { input: 2000, cacheRead: 8000, cacheWrite: 0, output: 1000, reasoning: 0 }
    }
  });
  await store.saveSession(session);

  const tail = await store.readSessionRecord(session.id, { messageLimit: 40, includeUsageStats: true });
  assert.equal(tail.messagesTruncated, true);
  assert.equal(tail.messages.length, 40);
  assert.equal(tail.messages.some(message => message.agentRun?.runId === 'old-head-run'), false);
  assert.deepEqual(tail.usageStats, {
    runs: 2,
    input: 3000,
    cacheRead: 17000,
    cacheWrite: 100,
    output: 1700,
    uncached: 3100,
    total: 21800,
    rate: 17000 / 20100
  });

  const full = await store.readSessionRecord(session.id, { includeUsageStats: true });
  assert.equal(full.usageStats.total, 21800);

  // The projection is read-only and must never be written into the session.
  const projected = { ...tail, usageStats: tail.usageStats };
  await store.saveSession(projected);
  const disk = JSON.parse(fs.readFileSync(path.join(sessionsDir, `${session.id}.json`), 'utf8'));
  assert.equal(Object.hasOwn(disk, 'usageStats'), false);
  assert.equal(disk.messages.length, 51);
});

test('size-capped history pages end at the requested cursor', async t => {
  const { store } = fixture(t);
  const session = await store.createFreshSessionRecord({ title: '大消息分页' });
  session.messages = [
    { role: 'user', content: '最早的小消息', ts: 1 },
    { role: 'assistant', content: '超大消息'.repeat(1_750_000), ts: 2 },
    { role: 'user', content: '后面的小消息', ts: 3 },
    { role: 'assistant', content: '最新回复', ts: 4 }
  ];
  await store.saveSession(session);

  // The requested range [0, 2) cannot fit its 7 MB message plus the small one.
  // It must return the newest message of that range, ending exactly at 2.
  const page = await store.getSessionMessages({ id: session.id, offset: 0, limit: 2 });
  assert.equal(page.ok, true);
  assert.equal(page.offset, 1);
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].ts, 2);
  assert.equal(page.offset + page.messages.length, 2);

  const oldest = await store.getSessionMessages({ id: session.id, offset: 0, limit: 1 });
  assert.equal(oldest.offset, 0);
  assert.equal(oldest.messages.length, 1);
  assert.equal(oldest.messages[0].ts, 1);
});
