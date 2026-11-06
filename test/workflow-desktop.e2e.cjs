'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-workflow-desktop-'));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof initOpenCodeRunState === 'function' && quickInputHandlerReady);
    await page.evaluate(() => window.YanStartupHello?.skip());
    await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      const session = state.currentSession;
      session.messages = [{ role: 'user', content: '组织团队编写并验收网页', ts: Date.now() }];
      renderMessages(session.messages); setEmptyState(false);
      const ctx = createRunCtx(session.id, true, session.workspace || '');
      initOpenCodeRunState(ctx);
      state.activeRuns.set(session.id, { sessionRef: session, runCtx: ctx, assistantEl: appendMessage('assistant', '') });
      window.workflowTestCtx = ctx;
      window.workflowTestState = { id: 'workflow-test', revision: 1, status: 'running', members: [{ id: 'builder', name: 'Builder', agentID: 'agent-builder' }], stages: [{ id: 'build', title: '并行编写网页前端' }], tasks: [{ id: 'hero', memberId: 'builder', stageId: 'build', title: '编写 hero 元素样式', status: 'running', acceptance: '响应式布局通过检查', attempts: [{ number: 1 }] }] };
      applyOpenCodeEvent(ctx, { type: 'yan.workflow.updated', data: { workflow: structuredClone(workflowTestState) } });
      applyOpenCodeEvent(ctx, { type: 'message.part.updated', data: { part: { type: 'tool', tool: 'task', id: 'task-one', callID: 'task-one', state: { status: 'running', input: { description: 'Builder', prompt: 'Build hero', subagent_type: 'builder' }, metadata: { sessionID: 'child-one', agentID: 'agent-builder', workflow: { workflowId: 'workflow-test', taskId: 'hero', attempt: 1 } } } } } });
      renderOpenCodeRunNow(ctx);
    });
    const component = page.locator('#messages .workflow-orchestration');
    await component.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#messages .agent-subagent-status').count(), 0, 'Managed children render inside workflow');
    await component.locator('.workflow-root-row').click();
    await component.locator('.workflow-stage-row').click();
    assert.match(await component.locator('.workflow-agent').innerText(), /Builder.*编写 hero 元素样式/s);
    await page.evaluate(() => {
      workflowTestState.revision = 2; workflowTestState.tasks[0].status = 'awaiting_review'; workflowTestState.status = 'awaiting_review';
      applyOpenCodeEvent(workflowTestCtx, { type: 'yan.workflow.updated', data: { workflow: structuredClone(workflowTestState) } });
      renderOpenCodeRunNow(workflowTestCtx);
    });
    assert.equal(await component.getAttribute('open'), '');
    assert.equal(await component.locator('.workflow-stage details').getAttribute('open'), '');
    assert.equal(await component.locator('.workflow-agent-status').innerText(), '待验收');
    await component.locator('button.workflow-agent').click();
    await page.locator('[data-subagents-view="detail"]:not(.hidden)').waitFor({ state: 'visible' });
    const saved = await page.evaluate(() => JSON.parse(JSON.stringify(workflowTestCtx.activeAgentRun)));
    assert.equal(saved.timeline.find(item => item.type === 'workflow_orchestration').workflow.revision, 2);
    await page.evaluate(run => {
      state.activeRuns.delete(state.currentSession.id);
      state.currentSession.messages.push({ role: 'assistant', content: '等待验收', ts: Date.now(), agentRun: { ...run, status: 'done' } });
      renderMessages(state.currentSession.messages);
    }, saved);
    await page.locator('#messages .agent-work-toggle').last().click();
    await page.locator('#messages .workflow-orchestration').waitFor({ state: 'visible' });
    await page.locator('#messages .workflow-root-row').click();
    await page.locator('#messages .workflow-stage-row').click();
    assert.equal(await page.locator('#messages .workflow-agent-status').innerText(), '待验收');
    await page.screenshot({ path: path.join(root, 'output', 'workflow-desktop.png') });
    assert.deepEqual(errors, []);
    console.log('Workflow desktop: live events, nested expansion, updates, child detail and saved history passed.');
  } finally {
    await app?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
