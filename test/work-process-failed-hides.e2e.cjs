'use strict';

// A run that errored or was aborted must hide its work log by default, exactly
// like a finished run that produced a summary. A live run stays expanded.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-work-process-failed-'));

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => typeof appendMessage === 'function' && typeof state === 'object');
    await page.locator('#taskBar:not(.hidden)').waitFor();

    const probe = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      const results = [];
      const cases = [
        { status: 'working', summaryStarted: false, expectCollapsed: false },
        { status: 'interrupted', summaryStarted: false, expectCollapsed: true },
        { status: 'error', summaryStarted: false, expectCollapsed: true },
        { status: 'done', summaryStarted: true, expectCollapsed: true },
        { status: 'done', summaryStarted: false, expectCollapsed: false }
      ];
      for (const testCase of cases) {
        clearMessages();
        setEmptyState(false);
        state.currentSession.messages = [];
        const assistantEl = appendMessage('assistant', '');
        const body = assistantEl.querySelector('.msg-body');
        renderAgentRunBody(body, {
          status: testCase.status,
          summaryStarted: testCase.summaryStarted,
          timeline: [{ type: 'tool_call', stage: 'work', callId: 'c1', name: 'read', args: { path: 'src/a.js' }, content: 'read src/a.js' }],
          startedAt: Date.now() - 5_000,
          completedAt: Date.now(),
          durationMs: 5_000,
          iteration: 1,
          toolCallCount: 1,
          todos: [],
          uiTimelineRevision: 1
        }, '');
        const header = assistantEl.querySelector('.agent-run-header');
        const toggle = assistantEl.querySelector('.msg-actions .agent-work-toggle');
        results.push({
          case: `${testCase.status}/summary=${testCase.summaryStarted}`,
          expectCollapsed: testCase.expectCollapsed,
          collapsed: !!header?.classList.contains('agent-work-collapsed'),
          expanded: header?.dataset.workExpanded,
          toggleHidden: toggle ? toggle.hidden : null,
          toggleText: toggle?.textContent || ''
        });
      }
      state.currentSession.messages = [];
      return results;
    });

    for (const result of probe) {
      assert.equal(result.collapsed, result.expectCollapsed, `${result.case}: work log collapsed=${result.collapsed} (expected ${result.expectCollapsed})`);
      assert.equal(result.toggleHidden, false, `${result.case}: work toggle must stay available`);
      assert.equal(result.toggleText, result.expectCollapsed ? '查看工作过程' : '隐藏工作过程', `${result.case}: unexpected toggle label`);
    }
    console.log(JSON.stringify({ ok: true, probe }, null, 2));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
