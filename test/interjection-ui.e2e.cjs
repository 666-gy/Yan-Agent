'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-interjection-e2e-'));
const screenshotDir = path.join(appRoot, 'output', 'playwright');
fs.mkdirSync(screenshotDir, { recursive: true });
const launcherScreenshotPath = path.join(screenshotDir, `yan-right-sidebar-launcher-${Date.now()}.png`);
const screenshotPath = path.join(screenshotDir, `yan-auxiliary-dialogue-${Date.now()}.png`);
const lightScreenshotPath = path.join(screenshotDir, `yan-auxiliary-dialogue-light-${Date.now()}.png`);

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: {
        ...process.env,
        YAN_E2E_MODE: '1',
        YAN_E2E_USER_DATA_DIR: userDataDir
      }
    });
    const page = await application.firstWindow();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForFunction(() => document.querySelector('#interjectionForm')?.dataset.bound === 'true'
      && typeof createRunCtx === 'function'
      && typeof syncInterjectionUi === 'function'
      && typeof openRightSidebarTool === 'function'
      && quickInputHandlerReady === true);
    assert.equal(await page.locator('[data-rs-open-tool="interjection"]').count(), 2);
    assert.equal(await page.locator('#rightSidebarLauncher .rs-launcher-heading strong').textContent(), '打开标签页');
    assert.equal(await page.locator('#rightSidebarLauncher .rs-launcher-heading span').textContent(), '选择要在侧边面板中打开的标签。');

    const messageCount = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      const runCtx = createRunCtx(state.currentSession.id, true, state.currentSession.workspace || '');
      runCtx.openCodeSessionId = 'e2e-opencode-session';
      runCtx.openCodePhase = 'work';
      runCtx.activeAgentRun = {
        runId: runCtx.runId,
        status: 'working',
        startedAt: runCtx.startedAt,
        timeline: [{
          type: 'tool_call',
          callId: 'tool-1',
          name: 'bash',
          args: { command: 'npm install' },
          startedAt: Date.now()
        }]
      };
      state.activeRuns.set(state.currentSession.id, { sessionRef: state.currentSession, runCtx, assistantEl: null });
      interjectionThreadFor(runCtx, true);
      syncInterjectionUi();
      return state.currentSession.messages.length;
    });

    await page.evaluate(() => setRightSidebarOpen(true));
    await page.waitForFunction(() => !document.querySelector('#app')?.classList.contains('rs-hidden'));
    await page.screenshot({ path: launcherScreenshotPath });
    const launcherButton = page.locator('#rightSidebarLauncher [data-rs-open-tool="interjection"]');
    await launcherButton.click();
    await page.locator('#rs-interjection.active').waitFor();
    assert.equal(await page.locator('[data-rs-tab="interjection"] .rs-work-tab-label').textContent(), '辅助对话');
    assert.equal(await page.locator('#interjectionInput').isEnabled(), true);
    assert.equal(await page.locator('#interjectionTranscript .auxiliary-dialogue-empty span').textContent(), 'Yan Agent工作期间，提问以辅助工作');
    const geometry = await page.locator('#rs-interjection').evaluate(node => {
      const panel = node.getBoundingClientRect();
      const composer = node.querySelector('.auxiliary-dialogue-composer').getBoundingClientRect();
      const transcript = node.querySelector('.auxiliary-dialogue-scroll').getBoundingClientRect();
      const empty = node.querySelector('.auxiliary-dialogue-empty').getBoundingClientRect();
      const emptyLabelStyle = getComputedStyle(node.querySelector('.auxiliary-dialogue-empty span'));
      return {
        width: panel.width,
        height: panel.height,
        composerTopGap: Math.abs(panel.top - composer.top),
        composerWidth: composer.width,
        transcriptBelowComposer: transcript.top >= composer.bottom - 1,
        emptyCenterOffset: Math.abs((empty.top + empty.height / 2) - (transcript.top + transcript.height / 2)),
        emptyLabelFontSize: parseFloat(emptyLabelStyle.fontSize),
        emptyLabelFontWeight: Number(emptyLabelStyle.fontWeight),
        usesMainChatUi: !!node.querySelector('.chat-scroll .messages') && !!node.querySelector('.auxiliary-dialogue-input') && !!node.querySelector('.send-btn')
      };
    });
    assert.ok(geometry.width >= 280, JSON.stringify(geometry));
    assert.ok(geometry.height >= 300, JSON.stringify(geometry));
    assert.ok(geometry.composerTopGap <= 13, JSON.stringify(geometry));
    assert.ok(geometry.composerWidth <= 337, JSON.stringify(geometry));
    assert.equal(geometry.transcriptBelowComposer, true, JSON.stringify(geometry));
    assert.ok(geometry.emptyCenterOffset <= 24, JSON.stringify(geometry));
    assert.ok(geometry.emptyLabelFontSize >= 15, JSON.stringify(geometry));
    assert.ok(geometry.emptyLabelFontWeight >= 600, JSON.stringify(geometry));
    assert.equal(geometry.usesMainChatUi, true, JSON.stringify(geometry));
    const expandedComposerWidth = await page.evaluate(async () => {
      document.documentElement.style.setProperty('--rs-w', '640px');
      await new Promise(resolve => requestAnimationFrame(resolve));
      return document.querySelector('.auxiliary-dialogue-composer').getBoundingClientRect().width;
    });
    assert.ok(expandedComposerWidth <= 337, JSON.stringify({ expandedComposerWidth }));

    const streamedUi = await page.evaluate(() => {
      const runCtx = currentInterjectionRun();
      const thread = interjectionThreadFor(runCtx);
      const requestId = 'e2e-stream-request';
      const requestToken = Symbol(requestId);
      const item = {
        role: 'agent',
        text: '',
        status: '辅助 Agent 正在整理回复',
        streaming: true,
        requestId,
        startedAt: Date.now() - 2_000
      };
      thread.pending = true;
      thread.stopping = false;
      thread.requestId = requestId;
      thread.requestToken = requestToken;
      thread.items = [{ role: 'user', text: '请简短说明进度。' }, item];
      interjectionRequests.set(requestId, { runCtx, thread, item, requestToken });
      renderInterjectionTranscript(runCtx);
      syncInterjectionUi();
      const headerBefore = item.ui.body.querySelector('.auxiliary-dialogue-agent-header')?.textContent || '';
      const stopMode = {
        className: document.querySelector('#interjectionSend')?.className,
        disabled: document.querySelector('#interjectionSend')?.disabled,
        icon: document.querySelector('#interjectionSend svg rect')?.tagName || ''
      };
      handleInterjectionStreamEvent({ runId: runCtx.runId, requestId, event: { type: 'text.delta', data: { delta: '正在生成' } } });
      const firstRound = item.ui.content.querySelector('.msg-round.agent-streaming');
      const firstText = firstRound?.textContent;
      firstRound.dataset.e2eStableNode = 'yes';
      handleInterjectionStreamEvent({ runId: runCtx.runId, requestId, event: { type: 'text.delta', data: { delta: '图片。' } } });
      const secondRound = item.ui.content.querySelector('.msg-round.agent-streaming');
      const messageBeforeComplete = item.ui.message;
      handleInterjectionStreamEvent({ runId: runCtx.runId, requestId, event: { type: 'completed', data: {} } });
      const messageAfterComplete = item.ui.message;
      const finalRound = item.ui.content.querySelector('.msg-round');
      thread.stopping = true;
      syncInterjectionUi();
      const stoppingMode = {
        className: document.querySelector('#interjectionSend')?.className,
        disabled: document.querySelector('#interjectionSend')?.disabled,
        icon: document.querySelector('#interjectionSend svg path')?.tagName || ''
      };
      finalizeInterjectionItem(item);
      interjectionRequests.delete(requestId);
      thread.pending = false;
      thread.stopping = false;
      thread.requestId = null;
      thread.requestToken = null;
      thread.items = [];
      renderInterjectionTranscript(runCtx);
      syncInterjectionUi();
      return {
        headerBefore,
        firstText,
        secondText: secondRound?.textContent,
        sameNode: firstRound === secondRound,
        stableMarker: secondRound?.dataset.e2eStableNode,
        sameMessageAfterComplete: messageBeforeComplete === messageAfterComplete,
        finalText: finalRound?.textContent,
        stopMode,
        stoppingMode
      };
    });
    assert.match(streamedUi.headerBefore, /已处理\s+[1-9]/, JSON.stringify(streamedUi));
    assert.equal(streamedUi.firstText, '正在生成', JSON.stringify(streamedUi));
    assert.equal(streamedUi.secondText, '正在生成图片。', JSON.stringify(streamedUi));
    assert.equal(streamedUi.sameNode, true, JSON.stringify(streamedUi));
    assert.equal(streamedUi.stableMarker, 'yes', JSON.stringify(streamedUi));
    assert.equal(streamedUi.sameMessageAfterComplete, true, JSON.stringify(streamedUi));
    assert.equal(streamedUi.finalText, '正在生成图片。', JSON.stringify(streamedUi));
    assert.match(streamedUi.stopMode.className, /stop-mode/, JSON.stringify(streamedUi));
    assert.equal(streamedUi.stopMode.disabled, false, JSON.stringify(streamedUi));
    assert.equal(streamedUi.stopMode.icon, 'rect', JSON.stringify(streamedUi));
    assert.match(streamedUi.stoppingMode.className, /stopping-mode/, JSON.stringify(streamedUi));
    assert.equal(streamedUi.stoppingMode.disabled, true, JSON.stringify(streamedUi));
    assert.equal(streamedUi.stoppingMode.icon, 'path', JSON.stringify(streamedUi));

    await page.locator('#interjectionInput').fill('现在安装到哪一步了？');
    const sendState = await page.evaluate(() => ({
      runActive: !!currentInterjectionRun(),
      inputValue: document.querySelector('#interjectionInput')?.value,
      sendDisabled: document.querySelector('#interjectionSend')?.disabled
    }));
    assert.equal(sendState.sendDisabled, false, JSON.stringify(sendState));
    await page.locator('#interjectionInput').press('Enter');
    try {
      await page.waitForFunction(() => document.querySelectorAll('#interjectionTranscript .msg').length >= 2, null, { timeout: 10_000 });
    } catch (error) {
      const debug = await page.evaluate(() => ({
        messageCount: document.querySelectorAll('#interjectionTranscript .msg').length,
        threadItems: interjectionThreadFor(currentInterjectionRun())?.items || [],
        sendDisabled: document.querySelector('#interjectionSend')?.disabled,
        runActive: !!currentInterjectionRun()
      }));
      throw new Error(`辅助对话没有完成回显：${JSON.stringify({ debug, pageErrors, cause: error.message })}`);
    }
    const stateAfterSend = await page.evaluate(() => ({
      active: state.activeRuns.has(state.currentSession.id),
      messageCount: state.currentSession.messages.length
    }));
    assert.equal(stateAfterSend.active, true);
    assert.equal(stateAfterSend.messageCount, messageCount);

    await page.screenshot({ path: screenshotPath });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.screenshot({ path: lightScreenshotPath });
    await page.evaluate(() => {
      const runCtx = getRunCtx(state.currentSession.id);
      if (runCtx) runCtx.agentState.status = 'done';
      state.activeRuns.delete(state.currentSession.id);
      syncInterjectionUi();
    });
    assert.equal(await page.locator('#interjectionInput').isDisabled(), true);
    assert.ok(await page.locator('#interjectionTranscript .msg').count() >= 2);
    console.log(JSON.stringify({ ok: true, launcherScreenshotPath, screenshotPath, lightScreenshotPath, geometry }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
