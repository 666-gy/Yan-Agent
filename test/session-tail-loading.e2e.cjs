'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-session-tail-'));
const MESSAGE_LOAD_LIMIT = 40;
const TOTAL_MESSAGES = 60;

// Oversized sessions must not cross IPC whole on every task switch:
// session:get returns the newest tail plus truncation markers, older pages
// are served by session:messages, and a tail save merges back into the
// stored history instead of truncating it.
(async () => {
  let application;
  const errors = [];
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => (
      typeof newSession === 'function'
      && typeof loadSession === 'function'
      && typeof saveCurrentSession === 'function'
    ));

    const setup = await page.evaluate(async ({ total, limit }) => {
      await newSession();
      const session = state.currentSession;
      for (let i = 0; i < total; i++) {
        session.messages.push({ role: 'user', content: `消息${i + 1}`, ts: Date.now() + i });
      }
      session.messages.push({
        role: 'assistant',
        content: '最终回复',
        ts: Date.now(),
        agentRun: {
          runId: 'run-tail-test',
          status: 'done',
          timeline: [{ type: 'text', content: '最终回复' }],
          subagents: [{
            id: 'child-1', role: 'explorer', status: 'completed', result: '子代理完成',
            timeline: [{ type: 'text', content: '子代理完成', openCodeKey: 'text:1' }],
            seenEvents: { 'evt-1': true },
            milestones: { 'tool:1': 'completed:输出' },
            pendingDeltas: { p1: '增量' },
            nextStreams: { s1: true },
            partKinds: { p1: 'text' },
            messages: { m1: { role: 'user' } }
          }]
        }
      });
      await saveCurrentSession();
      return {
        sessionId: session.id,
        createdTotal: session.messages.length,
        firstContent: session.messages[0]?.content || '',
        tailFirstContent: session.messages[session.messages.length - limit]?.content || ''
      };
    }, { total: TOTAL_MESSAGES, limit: MESSAGE_LOAD_LIMIT });
    const { sessionId, createdTotal, firstContent, tailFirstContent } = setup;

    await page.evaluate(() => location.reload());
    await page.waitForFunction(() => typeof loadSession === 'function');

    const tailState = await page.evaluate(async ({ sessionId, limit }) => {
      await loadSession(sessionId);
      const session = state.currentSession;
      // History rendering is progressive (immediate tail + rAF chunks); wait
      // until the rendered DOM matches the loaded page before counting.
      await new Promise(resolve => {
        const deadline = Date.now() + 5000;
        const tick = () => {
          if (document.querySelectorAll('#messages .msg').length >= session.messages.length || Date.now() > deadline) resolve();
          else requestAnimationFrame(tick);
        };
        tick();
      });
      return {
        truncated: session.messagesTruncated === true,
        totalMessages: session.totalMessages,
        messagesStart: session.messagesStart,
        loadedCount: session.messages.length,
        domCount: document.querySelectorAll('#messages .msg').length,
        barPresent: !!document.querySelector('#messages .earlier-messages-bar'),
        newestVisible: document.querySelector('#messages')?.textContent.includes('最终回复') === true
      };
    }, { sessionId, limit: MESSAGE_LOAD_LIMIT });
    assert.equal(tailState.truncated, true, JSON.stringify(tailState));
    assert.equal(tailState.totalMessages, createdTotal, JSON.stringify(tailState));
    assert.equal(tailState.messagesStart, createdTotal - MESSAGE_LOAD_LIMIT, JSON.stringify(tailState));
    assert.equal(tailState.loadedCount, MESSAGE_LOAD_LIMIT, JSON.stringify(tailState));
    assert.equal(tailState.domCount, MESSAGE_LOAD_LIMIT, JSON.stringify(tailState));
    assert.equal(tailState.barPresent, true, JSON.stringify(tailState));
    assert.equal(tailState.newestVisible, true, JSON.stringify(tailState));
    assert.equal(tailFirstContent.length > 0, true, 'tail first content must exist');

    // A tail save must never truncate the stored history (main-side merge).
    await page.evaluate(async () => {
      state.currentSession.messages.push({ role: 'user', content: '截断期间的新消息', ts: Date.now() });
      await saveCurrentSession();
    });
    const storedAfterTailSave = JSON.parse(fs.readFileSync(
      path.join(userDataDir, 'YanData', 'sessions', `${sessionId}.json`), 'utf8'));
    assert.equal(storedAfterTailSave.messages.length, createdTotal + 1,
      `expected merged history, got ${storedAfterTailSave.messages.length} messages`);
    assert.equal(storedAfterTailSave.messages[0]?.content, firstContent, 'oldest message lost by tail save');
    assert.equal(storedAfterTailSave.messages.at(-1)?.content, '截断期间的新消息');
    // Terminal subagent runtime bookkeeping is pruned from the stored copy.
    const storedSubagent = storedAfterTailSave.messages.at(-2)?.agentRun?.subagents?.[0];
    assert.ok(storedSubagent, 'subagent record missing from stored session');
    assert.equal(storedSubagent.seenEvents, undefined, 'seenEvents should be pruned on save');
    assert.equal(storedSubagent.milestones, undefined, 'milestones should be pruned on save');
    assert.equal(storedSubagent.pendingDeltas, undefined, 'pendingDeltas should be pruned on save');
    assert.equal(storedSubagent.timeline.length, 1, 'timeline must survive pruning');

    // Scrolling back loads the remaining older pages and clears truncation.
    const loadedAll = await page.evaluate(async () => {
      await loadEarlierMessages();
      const session = state.currentSession;
      return {
        truncated: !!session.messagesTruncated,
        count: session.messages.length,
        domCount: document.querySelectorAll('#messages .msg').length,
        barGone: !document.querySelector('#messages .earlier-messages-bar'),
        firstContent: session.messages[0]?.content,
        lastIndex: Number(document.querySelector('#messages .msg:last-of-type')?.dataset?.msgIndex)
      };
    });
    assert.equal(loadedAll.truncated, false, JSON.stringify(loadedAll));
    assert.equal(loadedAll.count, createdTotal + 1, JSON.stringify(loadedAll));
    // The extra message pushed during the tail-save step exists in data only;
    // DOM shows the rendered conversation (createdTotal messages).
    assert.equal(loadedAll.domCount, createdTotal, JSON.stringify(loadedAll));
    assert.equal(loadedAll.barGone, true, JSON.stringify(loadedAll));
    assert.equal(loadedAll.firstContent, firstContent, JSON.stringify(loadedAll));
    assert.equal(loadedAll.lastIndex, createdTotal - 1, JSON.stringify(loadedAll));

    // Regression: a silent full load (submission path) must reconcile the
    // visible conversation instead of leaving an inert "load earlier" bar.
    const silentReconcile = await page.evaluate(async ({ sessionId }) => {
      await loadSession(sessionId);
      const session = state.currentSession;
      const before = {
        truncated: !!session.messagesTruncated,
        bar: !!document.querySelector('#messages .earlier-messages-bar')
      };
      await ensureFullSessionLoaded(session);
      await new Promise(resolve => {
        const deadline = Date.now() + 5000;
        const tick = () => {
          if (document.querySelectorAll('#messages .msg').length >= session.messages.length || Date.now() > deadline) resolve();
          else requestAnimationFrame(tick);
        };
        tick();
      });
      return {
        before,
        truncated: !!session.messagesTruncated,
        barGone: !document.querySelector('#messages .earlier-messages-bar'),
        count: session.messages.length,
        domCount: document.querySelectorAll('#messages .msg').length
      };
    }, { sessionId });
    assert.equal(silentReconcile.before.truncated, true, JSON.stringify(silentReconcile));
    assert.equal(silentReconcile.before.bar, true, JSON.stringify(silentReconcile));
    assert.equal(silentReconcile.truncated, false, JSON.stringify(silentReconcile));
    assert.equal(silentReconcile.barGone, true, JSON.stringify(silentReconcile));
    assert.ok(silentReconcile.domCount >= silentReconcile.count, JSON.stringify(silentReconcile));

    // Submission paths must always see the full history again.
    const ensureState = await page.evaluate(async ({ sessionId }) => {
      await loadSession(sessionId);
      const before = state.currentSession.messages.length;
      await ensureFullSessionLoaded(state.currentSession);
      return {
        before,
        after: state.currentSession.messages.length,
        truncated: !!state.currentSession.messagesTruncated
      };
    }, { sessionId });
    assert.equal(ensureState.before, MESSAGE_LOAD_LIMIT, JSON.stringify(ensureState));
    assert.equal(ensureState.after, TOTAL_MESSAGES + 2, JSON.stringify(ensureState));
    assert.equal(ensureState.truncated, false, JSON.stringify(ensureState));

    // Size budget: one multi-megabyte message must trigger truncation even
    // when the session has very few messages.
    const hugeSetup = await page.evaluate(async () => {
      await newSession();
      const session = state.currentSession;
      session.messages.push({ role: 'user', content: '小消息1', ts: Date.now() });
      session.messages.push({ role: 'user', content: '巨大输出'.repeat(1_200_000), ts: Date.now() });
      session.messages.push({ role: 'user', content: '小消息2', ts: Date.now() });
      await saveCurrentSession();
      return { sessionId: session.id, total: session.messages.length };
    });
    await page.evaluate(() => location.reload());
    await page.waitForFunction(() => typeof loadSession === 'function');
    const hugeState = await page.evaluate(async ({ sessionId }) => {
      await loadSession(sessionId);
      const session = state.currentSession;
      const truncated = !!session.messagesTruncated;
      const loadedCount = session.messages.length;
      const payloadChars = JSON.stringify(session.messages).length;
      await ensureFullSessionLoaded(session);
      return {
        truncated,
        loadedCount,
        payloadChars,
        fullCount: session.messages.length,
        hugePresent: session.messages.some(message => message.content?.startsWith('巨大输出')),
        smallPresent: session.messages.some(message => message.content === '小消息1')
      };
    }, { sessionId: hugeSetup.sessionId });
    assert.equal(hugeState.truncated, true, JSON.stringify(hugeState));
    assert.equal(hugeState.loadedCount < hugeSetup.total, true, JSON.stringify(hugeState));
    assert.ok(hugeState.payloadChars < 4_000_000, `tail payload too large: ${hugeState.payloadChars}`);
    assert.equal(hugeState.fullCount, hugeSetup.total, JSON.stringify(hugeState));
    assert.equal(hugeState.hugePresent, true, JSON.stringify(hugeState));
    assert.equal(hugeState.smallPresent, true, JSON.stringify(hugeState));

    assert.equal(errors.length, 0, errors.join('; '));
    console.log(JSON.stringify({ ok: true, tailState, loadedAll, ensureState }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
