'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-live-layout-'));
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '..')],
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    const result = await page.evaluate(async () => {
      window.YanStartupHello?.skip();
      if (!state.currentSession) await newSession();
      clearMessages(); setEmptyState(false);
      const body = appendMessage('assistant', '').querySelector('.msg-body');
      const thought = { type: 'thinking', content: '检查布局并确认工作目录。\n\n'.repeat(6000), streaming: true, openCodeKey: 'thought' };
      const run = { status: 'working', timeline: [thought] };
      const render = () => { run.uiTimelineRevision = (run.uiTimelineRevision || 0) + 1; renderAgentRunBody(body, run); };
      const settle = () => new Promise(resolve => setTimeout(resolve, 350));
      const toggle = () => body.closest('.msg').querySelector('.agent-work-toggle');
      render(); await settle();
      const noLiveToggle = !toggle();
      const thinking = body.querySelector('.thinking-block');
      const noNestedThought = thinking.parentElement.classList.contains('agent-activity-body');
      if (!thinking.open) thinking.querySelector('summary').click();
      await settle();
      thought.content += '继续检查'; render(); await settle();
      const openSurvivesStream = thinking.open;
      thought.streaming = false;
      run.timeline.push({ type: 'text', content: '我先检查目录。', streaming: true, openCodeKey: 'intro' });
      render(); await settle();
      if (thinking.open) thinking.querySelector('summary').click();
      await settle();
      const narration = body.querySelector('.agent-work-narration');
      const gap = narration.getBoundingClientRect().top - thinking.getBoundingClientRect().bottom;
      const thoughtHeight = thinking.getBoundingClientRect().height;
      const pureThoughtNoBatch = !body.querySelector('.agent-work-batch');
      run.timeline.push({ type: 'tool_call', name: 'bash', callId: 'one', args: { command: 'ls' } },
        { type: 'tool_result', callId: 'one', ok: true, output: 'ok' },
        { type: 'text', content: '目录为空，继续实现。', openCodeKey: 'finding' });
      render(); await settle();
      const toolBatch = body.querySelector('.agent-work-batch');
      const initiallyClosed = !toolBatch.open;
      toolBatch.querySelector('summary').click(); await settle();
      render(); await settle();
      const independent = toolBatch.open && !thinking.open && toolBatch.innerText.includes('ls');
      run.summaryStarted = true;
      run.timeline.push({ type: 'text', stage: 'summary', content: '完成。', streaming: true, openCodeKey: 'final' });
      render(); await settle();
      const finalStreamingNoToggle = !toggle();
      run.status = 'done'; render(); await settle();
      const completedToggle = !!toggle();
      toggle().click(); await settle();
      const historyVisible = !!body.querySelector('.thinking-block');
      toggle().click(); await settle();
      const finalOnly = body.querySelector('.agent-activity-body').innerText === '完成。';
      return { noLiveToggle, noNestedThought, openSurvivesStream, gap, thoughtHeight, pureThoughtNoBatch,
        initiallyClosed, independent, finalStreamingNoToggle, completedToggle, historyVisible, finalOnly };
    });
    if (process.env.YAN_LAYOUT_SCREENSHOT) await page.screenshot({ path: process.env.YAN_LAYOUT_SCREENSHOT });
    console.log(JSON.stringify(result, null, 2));
    for (const [key,value] of Object.entries(result)) {
      if (key === 'gap') assert.ok(value >= 0 && value < 25, key);
      else if (key === 'thoughtHeight') assert.ok(value < 40, key);
      else assert.equal(value, true, key);
    }
  } finally {
    await app?.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
