'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, '.yanagent'), { recursive: true });
const profile = fs.mkdtempSync(path.join(root, '.yanagent', 'question-segments-'));
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__ && state.currentSession);
    await page.evaluate(() => window.YanStartupHello?.skip?.());
    await page.evaluate(() => document.querySelectorAll('[inert]').forEach(el => { el.inert = false; }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const result = await page.evaluate(async () => {
      clearMessages();
      setEmptyState(false);
      const owner = appendMessage('assistant', '');
      const body = owner.querySelector('.msg-body');
      const run = { runId: 'question-test', status: 'working', startedAt: Date.now() - 1000,
        timeline: [{ type: 'text', stage: 'work', content: 'Before answer', openCodeKey: 'before' }],
        questionTurns: [{ requestId: 'one', ts: Date.now(), beforeKeys: ['before'], beforeLength: 1,
          entries: [{ question: 'A long question '.repeat(70), answer: '<answer>\nSecond line' }] }] };
      renderAgentRunBody(body, run);
      const first = document.querySelector('.question-completed-segment');
      const user = document.querySelector('.question-answer-message');
      const prompt = user.querySelector('.question-answer-prompt');
      const answer = user.querySelector('.question-answer-content');
      const immediate = first.textContent.includes('Before answer') && user.textContent.includes('<answer>');
      const contrast = getComputedStyle(prompt).color !== getComputedStyle(answer).color;
      const ellipsis = getComputedStyle(prompt).textOverflow === 'ellipsis' && prompt.scrollWidth > prompt.clientWidth;
      const geometry = { scroll: prompt.scrollWidth, client: prompt.clientWidth, overflow: getComputedStyle(prompt).textOverflow };
      const settled = first.querySelector('.agent-run-header').dataset.status === 'done'
        && !first.querySelector('.agent-work-collapsed') && !first.querySelector('.agent-run-error');
      const observer = new MutationObserver(() => {});
      observer.observe(document.querySelector('#messages'), { childList: true });
      const frozen = first.innerHTML;
      for (let i = 0; i < 20; i++) {
        run.textContent = 'Later streaming answer ' + i;
        renderAgentRunBody(body, run);
      }
      const stable = observer.takeRecords().length === 0 && first.innerHTML === frozen;
      observer.disconnect();
      const noToggle = !first.querySelector('.agent-work-toggle');
      run.timeline.push({ type: 'text', stage: 'work', content: 'After first answer', openCodeKey: 'middle' });
      run.questionTurns.push({ requestId: 'two', ts: Date.now(), beforeKeys: ['before', 'middle'],
        entries: [{ question: 'Second question?', answer: 'Yes' }] });
      run.timeline.push({ type: 'text', stage: 'summary', content: 'Final answer', openCodeKey: 'final' });
      run.status = 'done'; run.summaryStarted = true;
      run.textContent = 'Final answer';
      renderAgentRunBody(body, run, 'Final answer');
      renderAgentRunBody(body, run, 'Final answer');
      renderAssistantMessageActions(owner, run, 1000, Date.now());
      const tailToggle = !owner.querySelector('.agent-work-toggle');
      // Completion may append a late result to the tail without any new work.
      run.timeline.push({ type: 'tool_result', stage: 'work', callId: 'question', ok: true, output: 'Yes' });
      const directActions = document.createElement('div');
      directActions.innerHTML = buildAssistantActionsHtml(run, 1000, Date.now());
      const initialActions = !directActions.querySelector('.agent-work-toggle')
        && !!directActions.querySelector('[data-act="copy"]') && !!directActions.querySelector('time');
      const count = document.querySelectorAll('.question-answer-message').length;
      const order = [...document.querySelectorAll('#messages > .msg')].map(el => el.textContent);
      const tailOnly = body.textContent.includes('Final answer') && !body.textContent.includes('Before answer');
      const session = state.currentSession;
      session.messages = [{ role: 'assistant', content: 'Final answer', agentRun: run }];
      await saveCurrentSession(session);
      const saved = await api.getSession(session.id);
      renderMessages(saved.messages);
      return { immediate, contrast, ellipsis, geometry, settled, stable, noToggle, tailToggle, initialActions, count, order, tailOnly,
        restoredClean: !document.querySelector('.question-completed-segment').textContent.includes('Final answer'),
        restored: document.querySelectorAll('.question-answer-message').length,
        persisted: saved.messages[0].agentRun.questionTurns.length };
    });
    for (const key of ['immediate', 'contrast', 'ellipsis', 'settled', 'tailOnly', 'stable', 'noToggle', 'tailToggle', 'initialActions', 'restoredClean']) assert.equal(result[key], true, `${key}: ${JSON.stringify(result.geometry)}`);
    assert.equal(result.count, 2);
    assert.equal(result.restored, 2);
    assert.equal(result.persisted, 2);
    assert.equal(result.order.length, 5);
    assert.match(result.order[0], /Before answer/);
    assert.match(result.order[2], /After first answer/);
    assert.match(result.order[4], /Final answer/);
    assert.deepEqual(errors, []);
    fs.mkdirSync(path.join(root, '.yanagent', 'evidence'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.yanagent', 'evidence', 'question-turn-segments.png') });
    console.log('PASS question answers: immediate bubbles, contrast, ellipsis, two splits, settled visibility and saved restoration');
  } finally {
    await app?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
