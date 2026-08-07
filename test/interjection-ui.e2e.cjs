'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-interjection-e2e-'));
const screenshotPath = path.join(os.tmpdir(), `yan-interjection-${Date.now()}.png`);
const lightScreenshotPath = path.join(os.tmpdir(), `yan-interjection-light-${Date.now()}.png`);

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
    await page.waitForFunction(() => typeof createRunCtx === 'function' && typeof syncInterjectionUi === 'function');
    assert.equal(await page.locator('#interjectionToggle').isDisabled(), true);

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

    assert.equal(await page.locator('#interjectionToggle').isEnabled(), true);
    const placement = await page.evaluate(() => ({
      afterTaskTools: document.querySelector('#taskToolsWrap')?.nextElementSibling?.id === 'interjectionToggle',
      insideTitlebar: !!document.querySelector('.titlebar-left #interjectionToggle')
    }));
    assert.deepEqual(placement, { afterTaskTools: true, insideTitlebar: false });
    await page.locator('#interjectionToggle').click();
    await page.locator('#interjectionPopover:popover-open').waitFor();
    assert.equal(await page.locator('#interjectionPopover .interjection-heading strong').textContent(), 'Yan Agent Interrupt');
    assert.equal(await page.locator('#interjectionPopover .interjection-status-lamp').count(), 1);
    const geometry = await page.locator('#interjectionPopover').evaluate(node => {
      const panel = node.getBoundingClientRect();
      const composer = node.querySelector('.interjection-composer').getBoundingClientRect();
      return {
        width: panel.width,
        height: panel.height,
        composerBottomGap: Math.abs(panel.bottom - composer.bottom)
      };
    });
    assert.ok(geometry.width >= 440 && geometry.width <= 510, JSON.stringify(geometry));
    assert.ok(Math.abs((geometry.width / geometry.height) - (16 / 9)) < 0.12, JSON.stringify(geometry));
    assert.ok(geometry.composerBottomGap < 2, JSON.stringify(geometry));

    await page.locator('#interjectionInput').fill('现在安装到哪一步了？');
    await page.locator('#interjectionInput').press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#interjectionTranscript .interjection-line').length >= 2);
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
    assert.equal(await page.locator('#interjectionToggle').isDisabled(), true);
    assert.ok(await page.locator('#interjectionTranscript .interjection-line').count() >= 2);
    console.log(JSON.stringify({ ok: true, screenshotPath, lightScreenshotPath, geometry }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
