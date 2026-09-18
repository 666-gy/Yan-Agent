'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-subagent-storm-'));

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
      clearMessages();
      state.currentSession.messages = [];
      const ctx = createRunCtx(state.currentSession.id, true, state.currentSession.workspace || '');
      ctx.modelId = 'deepseek-v4-flash';
      initOpenCodeRunState(ctx);
      const assistantEl = appendMessage('assistant', '');
      state.activeRuns.set(state.currentSession.id, { sessionRef: state.currentSession, runCtx: ctx, assistantEl });
      for (let index = 0; index < 24; index++) {
        upsertOpenCodeTimeline(ctx, `seed-${index}`, {
          type: 'tool_call', stage: 'work', callId: `seed-call-${index}`, name: 'read', args: { path: `src/${index}.js` }
        });
        upsertOpenCodeTimeline(ctx, `seed-result-${index}`, {
          type: 'tool_result', stage: 'work', callId: `seed-call-${index}`, name: 'read', ok: true, output: `seed output ${index}`
        });
      }

      const originalRender = window.renderAgentRunBody;
      const originalRunNow = window.renderOpenCodeRunNow;
      let fullRenders = 0;
      let runNowCalls = 0;
      window.renderAgentRunBody = (...args) => {
        fullRenders += 1;
        return originalRender(...args);
      };
      window.renderOpenCodeRunNow = (...args) => {
        runNowCalls += 1;
        return originalRunNow(...args);
      };
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      // A real Task part legitimately updates the parent row once.
      applyOpenCodeEvent(ctx, { type: 'message.part.updated', data: { part: {
        type: 'tool', tool: 'task', id: 'part-task-1', callID: 'task-1',
        state: { status: 'running', input: { subagent_type: 'builder', description: 'Build feature', prompt: 'Implement it' } }
      } } });
      await frames();
      const runNowAfterCreate = runNowCalls;
      const fullRendersAfterCreate = fullRenders;

      // Child-session storm: token deltas and running tool events. These belong
      // to the subagent panel and must not reconcile the parent message.
      const childEvent = (event) => ({ type: 'yan.subagent.event', data: {
        callId: 'task-1', childSessionID: 'child-session-1', subagentType: 'builder', event
      } });
      for (let batch = 0; batch < 6; batch++) {
        const events = [];
        for (let index = 0; index < 20; index++) {
          const id = batch * 20 + index;
          events.push(childEvent({ type: 'message.part.delta', data: { partID: `text-${id}`, field: 'text', delta: `chunk ${id} ` } }));
        }
        events.push(childEvent({ type: 'message.part.updated', properties: { part: { id: `tool-${batch}`, callID: `tool-${batch}`, type: 'tool', tool: 'read', state: { status: 'running', input: { filePath: `src/${batch}.js` } } } } }));
        applyOpenCodeEventBatch(ctx, events);
      }
      await frames();
      const runNowDuringStorm = runNowCalls - runNowAfterCreate;
      const fullRendersDuringStorm = fullRenders - fullRendersAfterCreate;

      // A completed child milestone is a real parent-row change and must render.
      const runNowBeforeMilestone = runNowCalls;
      const fullBeforeMilestone = fullRenders;
      applyOpenCodeEventBatch(ctx, [childEvent({ type: 'message.part.updated', properties: { part: {
        id: 'tool-done', callID: 'tool-done', type: 'tool', tool: 'read',
        state: { status: 'completed', input: { filePath: 'src/done.js' }, output: 'done' }
      } } })]);
      // Subagent-only batches render on the 100ms subagent cadence, not rAF.
      await new Promise(resolve => setTimeout(resolve, 200));
      await frames();
      const runNowAfterMilestone = runNowCalls - runNowBeforeMilestone;
      const fullRendersAfterMilestone = fullRenders - fullBeforeMilestone;

      window.renderAgentRunBody = originalRender;
      window.renderOpenCodeRunNow = originalRunNow;
      state.activeRuns.delete(state.currentSession.id);
      return {
        runNowAfterCreate,
        runNowDuringStorm,
        fullRendersDuringStorm,
        runNowAfterMilestone,
        fullRendersAfterMilestone,
        subagentCount: ctx.activeAgentRun.subagents.length
      };
    });

    assert.equal(probe.subagentCount, 1);
    assert.ok(probe.runNowAfterCreate >= 1, 'the task part must render the parent row once');
    assert.equal(probe.runNowDuringStorm, 0, 'child-session storms must not schedule a parent render');
    assert.equal(probe.fullRendersDuringStorm, 0, JSON.stringify(probe));
    assert.ok(probe.runNowAfterMilestone >= 1, 'a completed child milestone must still update the parent row');
    assert.equal(probe.fullRendersAfterMilestone, 0, 'the milestone must patch incrementally, not rebuild the message');
    console.log(JSON.stringify({ ok: true, probe }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
