'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-work-process-incremental-'));

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
      const pct = (values, percentile) => {
        const sorted = [...values].sort((left, right) => left - right);
        if (!sorted.length) return 0;
        return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(percentile * sorted.length))] * 100) / 100;
      };
      const summarize = values => ({
        count: values.length,
        p50: pct(values, 0.5),
        p95: pct(values, 0.95),
        max: Math.round(Math.max(0, ...values) * 100) / 100
      });

      if (!state.currentSession) await newSession();
      clearMessages();
      state.currentSession.messages = [];
      const baseTs = Date.now() - 40 * 60_000;
      for (let index = 0; index < 30; index++) {
        appendMessage('user', `历史问题 ${index}`, [], false, 0, baseTs + index * 60_000);
        appendMessage('assistant', `历史回答 ${index} ${'内容'.repeat(80)}`, [], false, 0, baseTs + index * 60_000 + 1000);
      }
      state.currentSession.messages = [];
      setEmptyState(false);

      const ctx = createRunCtx(state.currentSession.id, true, state.currentSession.workspace || '');
      ctx.modelId = 'deepseek-v4-flash';
      initOpenCodeRunState(ctx);
      const assistantEl = appendMessage('assistant', '');
      state.activeRuns.set(state.currentSession.id, { sessionRef: state.currentSession, runCtx: ctx, assistantEl });
      for (let index = 0; index < 240; index++) {
        const callId = `probe-${index}`;
        upsertOpenCodeTimeline(ctx, `call-${index}`, {
          type: 'tool_call', stage: 'work', callId, name: 'read', args: { path: `src/${index}.js` }
        });
        upsertOpenCodeTimeline(ctx, `result-${index}`, {
          type: 'tool_result', stage: 'work', callId, name: 'read', ok: true, output: `output ${index} ${'x'.repeat(400)}`
        });
      }
      upsertOpenCodeTimeline(ctx, 'text:stream', {
        type: 'text', stage: 'work', content: '流式输出片段。'.repeat(4_000), streaming: true, openCodeKey: 'text:stream'
      });
      renderOpenCodeRunNow(ctx);

      const composer = document.querySelector('#composerInput');
      composer.focus();
      const longTasks = [];
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
      try { observer.observe({ entryTypes: ['longtask'] }); } catch {}

      const syncLatencies = [];
      const frameLatencies = [];
      let ticks = 0;
      await new Promise(resolve => {
        const timer = setInterval(() => {
          const streamItem = ctx.activeAgentRun.timeline.find(entry => entry.openCodeKey === 'text:stream');
          upsertOpenCodeTimeline(ctx, 'text:stream', {
            ...streamItem,
            content: String(streamItem?.content || '') + '流式输出片段。',
            streaming: true,
            openCodeKey: 'text:stream'
          });
          if (ticks % 4 === 0) {
            const toolIndex = 1000 + ticks;
            upsertOpenCodeTimeline(ctx, `call-${toolIndex}`, {
              type: 'tool_call', stage: 'work', callId: `late-${toolIndex}`, name: 'read', args: { path: 'src/late.js' }
            });
          }
          scheduleOpenCodeRender(ctx);
          if (ticks % 4 === 0) {
            const started = performance.now();
            composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
            syncLatencies.push(performance.now() - started);
            const frameStarted = performance.now();
            requestAnimationFrame(() => frameLatencies.push(performance.now() - frameStarted));
          }
          if (++ticks >= 40) {
            clearInterval(timer);
            resolve();
          }
        }, 16);
      });
      observer.disconnect();
      // Let the last scheduled render frame flush before comparing DOM state.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const activityEl = assistantEl.querySelector('.agent-activity-body');
      const snapshotDom = () => Array.from(activityEl.children).map(child => ({
        key: child.dataset.agentPartKey || '',
        type: child.dataset.agentPartType || '',
        rows: child.querySelectorAll('.tool-step').length,
        len: child.innerHTML.length
      }));
      const incrementalDom = snapshotDom();
      const incrementalHtml = activityEl.innerHTML;
      renderAgentRunBody(assistantEl.querySelector('.msg-body'), {
        ...ctx.activeAgentRun,
        status: 'working',
        uiTimelineRevision: ctx.openCodeTimelineRevision,
        providerId: ctx.providerId,
        modelId: ctx.modelId,
        presentationMode: ctx.presentationMode,
        todos: ctx.agentState.todos || [],
        todosFromTool: true,
        toolCallCount: ctx.agentState.toolCallCount || 0
      }, ctx.partialContent || '');
      const fullDom = snapshotDom();
      const fullHtml = activityEl.innerHTML;
      let firstDiff = null;
      if (incrementalHtml !== fullHtml) {
        let index = 0;
        while (index < incrementalHtml.length
          && index < fullHtml.length
          && incrementalHtml[index] === fullHtml[index]) index++;
        firstDiff = {
          index,
          incremental: incrementalHtml.slice(Math.max(0, index - 100), index + 160),
          full: fullHtml.slice(Math.max(0, index - 100), index + 160)
        };
      }
      state.activeRuns.delete(state.currentSession.id);

      return {
        incrementalMatchesFull: incrementalHtml === fullHtml,
        incrementalDom,
        fullDom,
        firstDiff,
        syncLatency: summarize(syncLatencies),
        frameLatency: summarize(frameLatencies),
        longTasks: summarize(longTasks)
      };
    });

    assert.equal(probe.incrementalMatchesFull, true, JSON.stringify({
      incrementalDom: probe.incrementalDom,
      fullDom: probe.fullDom,
      firstDiff: probe.firstDiff
    }));
    console.log(JSON.stringify({ ok: true, probe }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
