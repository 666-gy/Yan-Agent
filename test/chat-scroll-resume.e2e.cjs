'use strict';

// Chat scroll / "回到最新" button acceptance, verified in the real window:
//   1. the chat scroller reaches its true bottom (delta ~ 0), so "at the bottom"
//      is a real state and not a permanently-unreachable threshold;
//   2. a downward wheel while already at the bottom must NOT park the resume
//      button (it used to stay on screen even though the view was at the end);
//   3. an upward wheel mid-history parks it, and returning to the bottom by any
//      means (here: scrolling back) clears the park on its own.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-chat-scroll-resume-'));

async function seedConversation() {
  await newSession();
  if (!state.currentSession) state.currentSession = { id: 'e2e-scroll-session', messages: [] };
  if (!state.currentSession.id) state.currentSession.id = 'e2e-scroll-session';
  const msgs = [];
  for (let i = 0; i < 28; i += 1) {
    msgs.push({ id: 'u' + i, role: 'user', content: 'QUESTION ' + i + ' ' + 'lorem ipsum dolor sit amet '.repeat(6), ts: i * 2 });
    msgs.push({ id: 'a' + i, role: 'assistant', content: 'ANSWER ' + i + ' ' + 'consectetur adipiscing elit sed do eiusmod '.repeat(10), ts: i * 2 + 1 });
  }
  state.currentSession.messages = msgs;
  setEmptyState(false);
  renderMessages(state.currentSession.messages);
  const sid = String(state.currentSession.id || '');
  // state.activeRuns is a Map (sessionId -> run entry); an empty entry is
  // enough to make the session count as "running" for the follow UI.
  if (sid) state.activeRuns.set(sid, { sessionRef: state.currentSession, runCtx: null, assistantEl: null });
  return sid;
}

function scrollMetrics() {
  const sc = document.querySelector('#chatScroll');
  const host = document.querySelector('#chatScrollResumeHost');
  return {
    max: sc.scrollHeight - sc.clientHeight,
    delta: Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight),
    resumeHidden: host.classList.contains('hidden'),
    runState: host.dataset.runState,
    near: typeof isChatNearBottom === 'function' ? isChatNearBottom(80) : null,
    follow: typeof isChatAutoFollowEnabled === 'function' ? isChatAutoFollowEnabled() : null,
    seeded: document.querySelectorAll('#messages .msg').length,
    scrollBottom: sc.getBoundingClientRect().bottom,
    viewportBottom: window.innerHeight,
    lastMessageBottom: document.querySelector('#messages .msg:last-child')?.getBoundingClientRect().bottom,
    composerTop: document.querySelector('#composerStage').getBoundingClientRect().top
  };
}

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
      typeof renderMessages === 'function'
      && typeof newSession === 'function'
      && typeof isChatNearBottom === 'function'
    ));

    // --- 1. the scroller reaches its real bottom -----------------------------
    const seeded = await page.evaluate(seedConversation);
    assert.ok(seeded, 'a session id must exist for the follow toggle');
    await page.evaluate(() => { const sc = document.querySelector('#chatScroll'); sc.scrollTop = sc.scrollHeight; });
    const bottom = await page.evaluate(scrollMetrics);
    assert.ok(bottom.seeded > 0, 'the seeded conversation must render messages');
    assert.ok(bottom.max > 200, `the conversation must actually overflow (max=${bottom.max})`);
    assert.ok(bottom.delta <= 1, `scrolling to the end must reach the bottom (delta=${bottom.delta})`);
    assert.equal(bottom.near, true, 'the bottom must count as near-bottom');
    assert.equal(bottom.resumeHidden, true, 'no resume button while pinned to the bottom');

    // --- 2. a downward wheel at the bottom must not park the button ----------
    await page.evaluate(() => {
      const sc = document.querySelector('#chatScroll');
      sc.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    });
    await page.waitForTimeout(120);
    const afterDownWheel = await page.evaluate(scrollMetrics);
    assert.equal(afterDownWheel.resumeHidden, true, 'a downward wheel at the bottom keeps the button hidden');
    assert.equal(afterDownWheel.follow, true, 'a downward wheel at the bottom keeps auto-follow on');

    // --- 3. an upward wheel parks it; scrolling back clears the park ---------
    await page.evaluate(() => {
      const sc = document.querySelector('#chatScroll');
      sc.scrollTop = Math.max(0, sc.scrollHeight - sc.clientHeight - 900);
      sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    });
    await page.waitForTimeout(120);
    const parked = await page.evaluate(scrollMetrics);
    assert.equal(parked.resumeHidden, false, 'an upward wheel mid-history must reveal the resume button');
    assert.equal(parked.runState, 'working', 'an active run shows the working variant');
    assert.equal(parked.follow, false, 'an upward wheel mid-history parks auto-follow');

    await page.evaluate(() => { const sc = document.querySelector('#chatScroll'); sc.scrollTop = sc.scrollHeight; });
    await page.waitForTimeout(160);
    const returned = await page.evaluate(scrollMetrics);
    assert.equal(returned.delta <= 1, true, 'the scroller is back at the bottom');
    assert.equal(returned.follow, true, 'returning to the bottom resumes auto-follow');
    assert.equal(returned.resumeHidden, true, 'returning to the bottom hides the resume button');

    const assertFullHeight = metrics => {
      assert.ok(Math.abs(metrics.scrollBottom - metrics.viewportBottom) <= 1,
        `the scrollbar must extend to the window bottom: ${JSON.stringify(metrics)}`);
      assert.ok(metrics.lastMessageBottom <= metrics.composerTop - 20,
        `the final reply must clear the fixed composer: ${JSON.stringify(metrics)}`);
    };
    assertFullHeight(returned);

    // The input grows independently; a reader at the end stays at the end.
    await page.evaluate(() => {
      stopSessionEntryFollow?.();
      setComposerText(Array.from({ length: 15 }, (_, i) => `Input line ${i}`).join('\n'));
      syncComposerAfterInput();
    });
    await page.waitForTimeout(350);
    const expanded = await page.evaluate(scrollMetrics);
    assert.ok(expanded.composerTop < returned.composerTop - 50, 'the input must actually grow');
    assert.ok(expanded.delta <= 1, 'growing the input must preserve the bottom position');
    assertFullHeight(expanded);

    // Real scrollbar dragging must work in the track beside the fixed input.
    const track = await page.locator('#chatScroll').boundingBox();
    await page.mouse.move(track.x + track.width - 5, track.y + track.height - 8);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width - 5, track.y + 30, { steps: 12 });
    await page.waitForTimeout(120);
    const draggedUp = await page.evaluate(scrollMetrics);
    assert.ok(draggedUp.delta > 200, 'the native thumb must be draggable from below the input top');
    await page.mouse.move(track.x + track.width - 5, track.y + track.height - 1, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(160);
    const draggedDown = await page.evaluate(scrollMetrics);
    assert.ok(draggedDown.delta <= 1, `dragging to the window bottom must reach the final reply: ${JSON.stringify(draggedDown)}`);
    assertFullHeight(draggedDown);

    // Resizing the composer while reading history must not jump to the end.
    await page.evaluate(() => {
      const sc = document.querySelector('#chatScroll');
      sc.scrollTop = Math.max(0, sc.scrollHeight - sc.clientHeight - 900);
      sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
    });
    const historyTop = await page.locator('#chatScroll').evaluate(sc => sc.scrollTop);
    await page.evaluate(() => { setComposerText('short'); syncComposerAfterInput(); });
    await page.waitForTimeout(350);
    assert.ok(Math.abs(await page.locator('#chatScroll').evaluate(sc => sc.scrollTop) - historyTop) <= 1,
      'shrinking the input must preserve the history reading position');
    await page.evaluate(() => resumeChatAutoFollow());
    await page.waitForTimeout(120);
    assertFullHeight(await page.evaluate(scrollMetrics));

    await page.evaluate(() => {
      createRightSidebarTab('interjection');
      setRightSidebarOpen(true);
    });
    await page.waitForTimeout(350);
    await page.evaluate(() => resumeChatAutoFollow());
    await page.waitForTimeout(120);
    assert.ok(await page.locator('#rightSidebar').evaluate(el => el.getBoundingClientRect().width > 100),
      'the side panel must be open for split-view coverage');
    assertFullHeight(await page.evaluate(scrollMetrics));

    await page.evaluate(() => setBrowserFocusMode(true));
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#chatScroll').evaluate(sc => getComputedStyle(sc).paddingBottom), '0px',
      'the fullscreen panel preview must not inherit the normal chat inset');
    await page.evaluate(() => setBrowserFocusMode(false));
    await page.waitForTimeout(250);
    await page.evaluate(() => resumeChatAutoFollow());
    await page.waitForTimeout(120);
    assertFullHeight(await page.evaluate(scrollMetrics));

    // Use an actual new task, not the unsaved fixture's cached blank session.
    await page.evaluate(async () => {
      state.activeRuns.clear();
      state.sessions = state.sessions.filter(session => session.id !== state.currentSession.id);
      await newSession();
    });
    await page.waitForTimeout(250);
    const empty = await page.evaluate(() => ({
      position: getComputedStyle(document.querySelector('#composerStage')).position,
      greetingHeight: document.querySelector('#emptyHeader').getBoundingClientRect().height
    }));
    assert.equal(empty.position, 'static', 'the empty task must retain its centered input');
    assert.ok(empty.greetingHeight > 0, 'the empty task greeting must remain visible');
    assert.equal(await page.locator('#chatScrollResumeHost').evaluate(el => el.classList.contains('hidden')), true,
      'a new task must hide the previous task\'s resume button');

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, max: bottom.max, deltaAtBottom: bottom.delta, parkedState: parked.runState }));
  } finally {
    await application?.close().catch(() => {});
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    } catch (cleanupError) {
      console.warn(`cleanup skipped: ${cleanupError?.message || cleanupError}`);
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
