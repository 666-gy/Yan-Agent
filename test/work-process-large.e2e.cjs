'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const outputDir = path.join(appRoot, 'output', 'playwright');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-work-process-large-e2e-'));

(async () => {
  let application;
  const pageErrors = [];
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
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    await page.locator('#taskBar:not(.hidden)').waitFor();

    const state = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      clearMessages();
      const timeline = [{ type: 'progress', stage: 'work', content: '正在准备大量工作过程。' }];
      for (let index = 0; index < 360; index++) {
        const callId = `large-${index}`;
        timeline.push({
          type: 'tool_call',
          stage: 'work',
          callId,
          name: index % 3 === 0 ? 'write' : 'read',
          args: { path: `src/file-${index}.js`, content: 'x'.repeat(2_000) },
          startedAt: Date.now() - 20_000 + index
        });
        timeline.push({
          type: 'tool_result',
          stage: 'work',
          callId,
          name: index % 3 === 0 ? 'write' : 'read',
          output: index === 359
            ? '200\r\n'
            : JSON.stringify({ ok: true, output: 'tool output '.repeat(4_000) }),
          ok: true,
          completedAt: Date.now() - 10_000 + index
        });
      }
      timeline.push({ type: 'text', stage: 'summary', content: '大流量工作过程已完成。' });
      const agentRun = {
        runId: 'large-work-process-run',
        status: 'done',
        summaryStarted: true,
        startedAt: Date.now() - 30_000,
        completedAt: Date.now(),
        durationMs: 30_000,
        timeline
      };
      state.currentSession.messages = [];
      const ts = Date.now();
      state.currentSession.messages.push({ role: 'assistant', content: agentRun.timeline.at(-1).content, ts, agentRun });
      appendMessage('assistant', agentRun.timeline.at(-1).content, [], false, 0, ts, agentRun.durationMs, agentRun);
      setEmptyState(false);
      const message = document.querySelector('#messages .msg.assistant');
      const toggle = message.querySelector('.msg-actions .agent-work-toggle');
      toggle.click();
      const closedPanels = message.querySelectorAll('.tool-result-panel').length;
      const firstTool = message.querySelector('.tool-step');
      firstTool.closest('.tool-activity-group').open = true;
      firstTool.querySelector('summary').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      return {
        closedPanels,
        toggleLabel: toggle.textContent,
        renderedParts: message.querySelectorAll('.agent-activity-body > [data-agent-part-key]').length,
        hasTrimNotice: message.textContent.includes('早期工作过程已折叠'),
        hasOutputLimitNotice: message.textContent.includes('工具输出已截断'),
        primitiveOutputOk: parseToolOutputOk('200\r\n')
      };
    });

    assert.equal(state.toggleLabel, '隐藏工作过程');
    assert.equal(state.closedPanels, 0, 'closed tools should defer their output panels');
    assert.ok(state.renderedParts <= 241, `rendered parts: ${state.renderedParts}`);
    assert.equal(state.hasTrimNotice, true);
    assert.equal(state.hasOutputLimitNotice, true);
    assert.equal(state.primitiveOutputOk, true);
    assert.deepEqual(pageErrors, []);

    fs.mkdirSync(outputDir, { recursive: true });
    await page.screenshot({
      path: path.join(outputDir, 'work-process-large-expanded.png'),
      fullPage: false
    });
    const dedupe = await page.evaluate(async () => {
      await newSession();
      const session = state.currentSession;
      const runCtx = createRunCtx(session.id, false, '');
      runCtx.runId = 'recovered-run-dedupe';
      initOpenCodeRunState(runCtx);
      state.activeRuns.set(session.id, { sessionRef: session, runCtx, assistantEl: null });
      const result = { runId: runCtx.runId, status: 'done', text: '恢复任务已完成。', toolCalls: [], todos: [] };
      await Promise.all([
        persistResumedOpenCodeRun(session, runCtx, result),
        persistResumedOpenCodeRun(session, runCtx, result)
      ]);
      return {
        assistantMessages: session.messages.filter(message => message.agentRun?.runId === runCtx.runId).length,
        activeAfter: state.activeRuns.has(session.id)
      };
    });
    assert.deepEqual(dedupe, { assistantMessages: 1, activeAfter: false });
    console.log(JSON.stringify({ ok: true, state, dedupe, screenshot: path.join(outputDir, 'work-process-large-expanded.png') }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
