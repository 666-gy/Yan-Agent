'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-review-output-e2e-'));

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
    await page.waitForFunction(() => (
      typeof appendMessage === 'function'
      && typeof createRightSidebarTab === 'function'
      && typeof setBrowserAgentControl === 'function'
    ));

    const initial = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      clearMessages();
      state.currentSession.workspace = 'C:\\yan-review-test';
      state.currentSession.messages = [];
      const agentRun = {
        runId: 'single-line-review-run',
        status: 'done',
        summaryStarted: true,
        durationMs: 1000,
        timeline: [{ type: 'text', stage: 'summary', content: '已修复一行代码。' }],
        changeSummary: {
          source: 'opencode',
          count: 1,
          additions: 1,
          deletions: 1,
          files: [{
            path: 'src/app.js',
            status: 'modified',
            additions: 1,
            deletions: 1,
            diff: {
              rows: [
                { type: 'del', oldLine: 7, newLine: null, text: 'const ready = false;' },
                { type: 'add', oldLine: null, newLine: 7, text: 'const ready = true;' }
              ]
            }
          }]
        }
      };
      state.currentSession.messages.push({
        role: 'assistant',
        content: '已修复一行代码。',
        ts: Date.now(),
        agentRun
      });
      appendMessage('assistant', '已修复一行代码。', [], false, 0, Date.now(), 1000, agentRun);
      const button = document.querySelector('[data-run-change-file-index="0"]');
      button?.click();
      return {
        buttonCount: document.querySelectorAll('[data-run-change-file-index]').length,
        buttonTag: button?.tagName || '',
        sidebarOpen: !document.querySelector('#app').classList.contains('rs-hidden')
      };
    });

    await page.waitForFunction(() => (
      document.querySelector('#rs-review')?.classList.contains('active')
      && document.querySelector('#reviewDiffHeader .review-diff-path')?.textContent === 'src/app.js'
    ));
    const review = await page.evaluate(() => ({
      selectedPath: rsReviewState.selectedPath,
      diffText: document.querySelector('#reviewDiffRows')?.textContent || ''
    }));

    const backendFilter = await page.evaluate(async () => {
      const textFile = {
        path: 'src/app.js',
        status: 'modified',
        additions: 1,
        deletions: 1,
        diff: { rows: [{ type: 'add', text: 'const ready = true;' }] }
      };
      const persisted = await api.saveSession({
        id: `binary-review-${Date.now()}`,
        title: 'Binary review filter fixture',
        workspace: 'C:\\yan-review-test',
        messages: [{
          role: 'assistant',
          content: '旧审阅记录',
          agentRun: {
            status: 'done',
            changeCount: 2,
            changeSummary: {
              source: 'opencode',
              count: 2,
              additions: 1,
              deletions: 1290,
              files: [{
                path: 'race1.png',
                status: 'deleted',
                additions: 0,
                deletions: 1289,
                diff: { rows: [{ type: 'del', text: '\u0000IHDR' }] }
              }, textFile]
            }
          }
        }]
      });
      const sanitized = await api.getSession(persisted.id);
      const summary = sanitized.messages[0].agentRun.changeSummary;
      return { count: summary.count, paths: summary.files.map(file => file.path) };
    });

    const browserWidths = await page.evaluate(() => {
      document.documentElement.style.setProperty('--rs-w', '360px');
      const tab = createRightSidebarTab('browser', { agentRunId: 'browser-width-run' });
      const controller = getBrowserTabController(tab.id);
      setBrowserAgentControl(controller, true, { runId: 'browser-width-run' });
      const expanded = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rs-w'));
      setBrowserAgentControl(controller, false, { runId: 'browser-width-run' });
      const released = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rs-w'));
      return { expanded, released };
    });

    assert.deepEqual(initial, { buttonCount: 1, buttonTag: 'BUTTON', sidebarOpen: true });
    assert.equal(review.selectedPath, 'src/app.js');
    assert.equal(review.diffText.includes('const ready = true;'), true);
    assert.deepEqual(backendFilter, { count: 1, paths: ['src/app.js'] });
    assert.ok(browserWidths.expanded > 360, JSON.stringify(browserWidths));
    assert.equal(browserWidths.released, browserWidths.expanded);
    console.log(JSON.stringify({ ok: true, initial, review, backendFilter, browserWidths }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
