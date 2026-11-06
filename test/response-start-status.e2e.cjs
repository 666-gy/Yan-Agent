'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require('playwright');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-response-status-'));
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '..')], env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: root } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    const checks = await page.evaluate(() => {
      const responseChecks = ['reasoning', 'tool', 'subagent'].map(kind => {
        const ctx = createRunCtx(`response-${kind}`, false, 'C:\\yan-review-test');
        initOpenCodeRunState(ctx);
        const host = document.createElement('div');
        document.body.append(host);
        renderAgentRunHeader(host, ctx.activeAgentRun);
        const before = host.querySelector('.run-status-label')?.textContent;
        applyOpenCodeEvent(ctx, kind === 'reasoning'
          ? { type: 'message.part.delta', properties: { partID: 'thought', field: 'reasoning', delta: 'Thinking' } }
          : { type: 'message.part.updated', properties: { part: { id: 'tool', callID: 'tool', type: 'tool', tool: kind === 'subagent' ? 'task' : 'grep', state: { status: 'running', input: { subagent_type: 'explorer' } } } } },
          { deferEffects: true });
        renderAgentRunHeader(host, ctx.activeAgentRun);
        const after = host.querySelector('.run-status-label')?.textContent;
        const completed = openCodeResultToAgentRun({ status: 'done', text: 'Done' }, ctx);
        applyOpenCodeEvent(ctx, { type: 'yan.model.request.started', data: { requestIndex: 1 } }, { deferEffects: true });
        renderAgentRunHeader(host, completed);
        const terminal = host.querySelector('.run-status-label')?.textContent;
        const lateWait = !!openCodeTimelineItem(ctx, 'model-wait');
        host.remove();
        return { before, after, terminal, lateWait };
      });
      const childState = { runId: 'child-parent', timeline: [] };
      window.YanSubagentWorkflow.consume(childState, { type: 'yan.subagent.event', data: {
        callId: 'child-call', childSessionID: 'child-session', subagentType: 'explorer',
        event: { type: 'yan.model.request.started', data: {} }
      } });
      const host = document.createElement('div');
      document.body.append(host);
      const typing = document.querySelector('#typingIndicator');
      typing?.classList.remove('hidden');
      const typingBefore = typing?.className;
      renderAgentRunHeader(host, window.YanSubagentWorkflow.nativeRun(childState.subagents[0]));
      if (typing?.className !== typingBefore) throw new Error('child rendering changed main typing indicator');
      if (host.querySelector('.run-status-label')?.textContent !== '用时') throw new Error('child request still appears to be starting up');
      window.YanSubagentWorkflow.consume(childState, { type: 'yan.subagent.waiting', data: { count: 1 } });
      renderAgentRunHeader(host, { ...childState, status: 'working', summaryStarted: true });
      if (!host.querySelector('[data-delegation-waiting]')?.textContent.includes('等待 1 个')) throw new Error('waiting is invisible after summary');
      host.remove();
      return responseChecks;
    });
    for (const check of checks) assert.deepEqual(check, { before: 'Yan Agent is starting up', after: '用时', terminal: '用时', lateWait: false });
    console.log('PASS reasoning/tool first response clears startup status; late events cannot resurrect it');
  } finally { await app?.close(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
