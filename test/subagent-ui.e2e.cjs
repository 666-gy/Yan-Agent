'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-subagent-ui-'));
const output = path.join(appRoot, 'output', 'playwright');
fs.mkdirSync(output, { recursive: true });
const launch = () => electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
  env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir } });

(async () => {
  let app;
  const errors = [];
  try {
    app = await launch();
    let page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof initOpenCodeRunState === 'function' && typeof subagentPanel !== 'undefined' && quickInputHandlerReady);
    const sessionId = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      const session = state.currentSession;
      session.title = '子代理工作流回归';
      session.messages = [{ role: 'user', content: '读取 taste skill 并核对实现', ts: Date.now() }];
      renderMessages(session.messages);
      setEmptyState(false);
      const ctx = createRunCtx(session.id, true, session.workspace || '');
      ctx.modelId = 'deepseek-v4-flash';
      initOpenCodeRunState(ctx);
      const assistantEl = appendMessage('assistant', '');
      state.activeRuns.set(session.id, { sessionRef: session, runCtx: ctx, assistantEl });
      window.subagentTestCtx = ctx;
      window.subagentTestTask = (call, status = 'running', result = '') => ({ type: 'message.part.updated', data: { part: {
        id: `task-${call}`, callID: call, type: 'tool', tool: 'task',
        state: { status, input: { subagent_type: 'explorer', description: call === 'a' ? '读取 taste skill 的设计规范' : '检查子代理 UI 事件与持久化', prompt: 'Inspect the assigned files.' },
          metadata: { sessionId: `child-${call}` }, output: result }
      } } });
      window.subagentTestChild = (call, event) => ({ type: 'yan.subagent.event', data: { callId: call, childSessionID: `child-${call}`, subagentType: 'explorer', event } });
      applyOpenCodeEvent(ctx, subagentTestTask('a'));
      renderOpenCodeRunNow(ctx);
      renderSubagentUi();
      return session.id;
    });
    await page.locator('#rs-subagents.active').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-subagent-ui-id]').count(), 1);
    assert.equal(await page.locator('[data-rs-tab="subagents"] .rs-work-tab-label').innerText(), '子智能体');
    assert.equal(await page.locator('[data-subagents-count]').innerText(), '已开启·1');
    assert.equal(await page.locator('#messages .agent-subagent-status').count(), 1);
    assert.equal(await page.locator('#messages .agent-subtask-details, #messages [data-tool="task"]').count(), 0);
    assert.equal(await page.locator('[data-rs-tab="subagents"] [data-agent-icon="bot-message-square"]').count(), 1);
    const initial = await page.locator('#messages .agent-subagent-status').innerText();
    assert.equal(initial, 'Explore子代理已开始工作');

    await page.evaluate(() => {
      const ctx = subagentTestCtx;
      applyOpenCodeEvent(ctx, subagentTestChild('a', { type: 'message.updated', properties: { info: { id: 'child-message', role: 'assistant', modelID: 'deepseek-v4-flash' } } }));
      applyOpenCodeEvent(ctx, subagentTestChild('a', { type: 'message.part.updated', properties: { part: { id: 'reason', messageID: 'child-message', type: 'reasoning', text: '先读取规范，再核对当前的设计约束。', time: { end: Date.now() } } } }));
      applyOpenCodeEvent(ctx, subagentTestChild('a', { type: 'message.part.updated', properties: { part: { id: 'read', callID: 'read', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'taste/SKILL.md' }, output: 'Use clear typography, spacing, and meaningful interaction states.' } } } }));
      applyOpenCodeEvent(ctx, subagentTestChild('a', { type: 'message.part.updated', properties: { part: { id: 'child-text', messageID: 'child-message', type: 'text', text: '已读取 taste skill，建议保持字体层级与留白一致。', time: { end: Date.now() } } } }));
      renderOpenCodeRunNow(ctx);
      renderSubagentUi();
    });
    assert.equal(await page.locator('#messages .agent-subagent-status').count(), 1);
    assert.equal(await page.locator('#messages .agent-subagent-status').innerText(), 'Explore子代理有了更新');
    assert.equal(await page.locator('.subagent-ui-row.is-running').count(), 1);
    await page.locator('[data-subagent-ui-id]').click({ timeout: 5000 });
    await page.locator('[data-subagents-view="detail"]:not(.hidden)').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-subagents-detail-body] .agent-run-header').count(), 1);
    assert.equal(await page.locator('[data-subagents-detail-body] .agent-work-toggle').innerText(), '隐藏工作过程');
    assert.equal(await page.locator('[data-subagents-detail-body] .tool-activity-group').count(), 1);
    await page.locator('[data-subagents-detail-body] .agent-work-toggle').click();
    assert.equal(await page.locator('[data-subagents-detail-body] .agent-work-toggle').innerText(), '查看工作过程');
    assert.equal(await page.locator('[data-subagents-detail-body] .tool-activity-group').count(), 1);
    await page.locator('[data-subagents-detail-body] .agent-work-toggle').click();
    assert.equal(await page.locator('[data-subagents-detail-body] .agent-work-toggle').innerText(), '隐藏工作过程');
    assert.ok((await page.locator('[data-subagents-detail-body]').innerText()).includes('思考'));
    await page.screenshot({ path: path.join(output, 'subagent-detail-dark.png') });
    await page.locator('[data-subagents-back]').click();

    const parallel = await page.evaluate(() => {
      const ctx = subagentTestCtx;
      applyOpenCodeEvent(ctx, subagentTestTask('b'));
      applyOpenCodeEvent(ctx, { type: 'message.part.updated', data: { part: { id: 'parent-text', type: 'text', text: '子代理读取规范期间，我继续检查主界面。', time: { end: Date.now() } } } });
      applyOpenCodeEvent(ctx, subagentTestChild('b', { type: 'message.part.updated', data: { part: { id: 'child-text', type: 'text', text: '已找到状态持久化入口。', time: { end: Date.now() } } } }));
      applyOpenCodeEvent(ctx, { type: 'message.part.updated', data: { part: { id: 'parent-text-2', type: 'text', text: '主界面的调用记录已经核对完毕。', time: { end: Date.now() } } } });
      applyOpenCodeEvent(ctx, subagentTestTask('b', 'completed', '已找到状态持久化入口。'));
      applyOpenCodeEvent(ctx, subagentTestTask('a', 'completed', '已读取 taste skill，建议保持字体层级与留白一致。'));
      renderOpenCodeRunNow(ctx);
      renderSubagentUi();
      return ctx.activeAgentRun.timeline.filter(item => item.callId === 'b').map(item => item.status);
    });
    assert.deepEqual(parallel, ['started', 'updated', 'completed']);
    assert.equal(await page.locator('.subagent-ui-row.is-completed').count(), 2);
    assert.equal(await page.locator('[data-rs-tab="subagents"] .rs-work-tab-label').innerText(), '子智能体');
    assert.equal(await page.locator('[data-subagents-count]').innerText(), '已开启·2');
    await page.screenshot({ path: path.join(output, 'subagent-root-dark.png') });

    await page.evaluate(async () => {
      const ctx = subagentTestCtx;
      const agentRun = openCodeResultToAgentRun({ status: 'done', text: '核对完成。', toolCalls: [], todos: [], changes: [] }, ctx);
      state.currentSession.messages.push({ role: 'assistant', content: '核对完成。', ts: Date.now(), agentRun });
      state.activeRuns.delete(state.currentSession.id);
      cancelScheduledOpenCodeRender(ctx);
      await saveCurrentSession();
      renderMessages(state.currentSession.messages);
      renderSubagentUi();
      setRightSidebarOpen(false);
    });
    assert.equal(
      await page.locator('#messages .agent-subagent-status').count(),
      0,
      'a collapsed summary keeps subagent status inside the work process'
    );
    await page.locator('#messages .agent-work-toggle').first().click();
    assert.ok(
      await page.locator('#messages .agent-subagent-status').count() >= 1,
      'expanding the work process reveals the subagent status'
    );
    await page.locator('#messages .agent-subagent-status').first().click();
    await page.locator('#rs-subagents.active').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#messages .agent-subtask-details, #messages [data-tool="task"]').count(), 0);
    assert.equal(await page.locator('[data-subagents-view="root"]:not(.hidden)').count(), 1);
    await page.evaluate(() => subagentPanel.open());
    await page.evaluate(async () => { await newSession(); subagentPanel.open(); });
    assert.equal(await page.locator('[data-subagent-ui-id]').count(), 0, 'different tasks must have empty independent lists');
    await page.evaluate(async id => { await loadSession(id); subagentPanel.open(); }, sessionId);
    assert.equal(await page.locator('[data-subagent-ui-id]').count(), 2);

    await app.close(); app = await launch();
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof subagentPanel !== 'undefined' && quickInputHandlerReady);
    await page.evaluate(async id => { await loadSession(id); subagentPanel.open(); }, sessionId);
    assert.equal(await page.locator('.subagent-ui-row.is-completed').count(), 2, 'records survive a full Electron restart');
    await page.locator('[data-subagent-ui-id]').first().click();
    assert.equal(await page.locator('[data-subagents-detail-body] .agent-work-toggle').innerText(), '查看工作过程');
    await page.locator('[data-subagents-detail-body] .agent-work-toggle').click();
    assert.equal(await page.locator('[data-subagents-detail-body] .tool-activity-group').count(), 1);
    assert.ok((await page.locator('[data-subagents-detail-body]').innerText()).includes('taste skill'));
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
      document.documentElement.style.setProperty('--rs-w', '340px');
      window.dispatchEvent(new Event('resize'));
    });
    await page.screenshot({ path: path.join(output, 'subagent-detail-light-narrow.png') });
    const overflow = await page.locator('[data-subagents-detail-body]').evaluate(el => el.scrollWidth > el.clientWidth + 1);
    assert.equal(overflow, false, 'native workflow should fit a narrow sidebar');
    const performanceCheck = await page.evaluate(async () => {
      const record = { id: 'perf-child', role: 'mapper', status: 'running', startedAt: Date.now(), timeline: [], revision: 0, outputRevision: 0 };
      const run = { subagents: [record], subagentWorkflowVersion: 1, timeline: [] };
      let renders = 0;
      const controller = YanSubagentPanel.create({ getSessionId: () => 'perf', getRuns: () => [run],
        renderNative: () => { renders++; }, renderActions: () => {}, openSidebar: () => {}, escapeHtml });
      controller.open('perf-child');
      const colors = {};
      for (const role of ['mapper', 'tracer', 'reverser']) {
        record.role = role;
        controller.render();
        colors[role] = getComputedStyle(document.querySelector('[data-subagents-detail-icon]')).color;
      }
      const unchanged = renders;
      for (let i = 0; i < 20; i++) controller.render();
      const idleRenders = renders - unchanged;
      const start = renders;
      for (let i = 0; i < 20; i++) {
        record.outputRevision++;
        controller.schedule();
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await new Promise(resolve => setTimeout(resolve, 150));
      const burstRenders = renders - start;
      setRightSidebarOpen(false);
      const hiddenStart = renders;
      record.outputRevision++;
      controller.render(); controller.schedule();
      return { colors, idleRenders, burstRenders, hiddenRenders: renders - hiddenStart };
    });
    assert.deepEqual(performanceCheck.colors, { mapper: 'rgb(133, 149, 47)', tracer: 'rgb(22, 159, 181)', reverser: 'rgb(212, 85, 152)' });
    assert.equal(performanceCheck.idleRenders, 0);
    assert.ok(performanceCheck.burstRenders > 0 && performanceCheck.burstRenders <= 5, JSON.stringify(performanceCheck));
    assert.equal(performanceCheck.hiddenRenders, 0);
    console.log(JSON.stringify({ performanceCheck }));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, sessionId, checks: ['auto-open', 'purple-only', 'native-detail', 'foreground-overwrite', 'parallel-append', 'task-isolation', 'disk-restart', 'narrow-sidebar'], screenshots: output }));
  } finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
