'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(root, '.yanagent', 'work-stability-'));
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root],
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    const result = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      clearMessages(); setEmptyState(false);
      const body = appendMessage('assistant', '').querySelector('.msg-body');
      const run = { status: 'working', timeline: Array.from({ length: 250 }, (_, i) =>
        ({ type: 'thinking', content: '历史思考 ' + i, openCodeKey: 'stable:' + i })) };
      const render = () => { run.uiTimelineRevision = (run.uiTimelineRevision || 0) + 1; renderAgentRunBody(body, run); };
      render(); body.querySelector('.agent-work-status').click();
      const history = body.querySelector('.agent-work-history');
      const first = history.querySelector('.thinking-block');
      first.open = true;
      const observer = new MutationObserver(() => {});
      observer.observe(history, { childList: true });
      const movedThinking = () => observer.takeRecords().flatMap(r => [...r.removedNodes])
        .filter(n => n.classList?.contains('thinking-block')).length;
      render();
      const unchangedMoves = movedThinking();
      run.timeline[249] = { ...run.timeline[249], content: '当前思考增量' };
      render();
      const deltaMoves = movedThinking();
      const row = body.querySelector('.agent-work-status');
      const span = row.firstElementChild;
      run.timeline[249] = { ...run.timeline[249], content: '当前思考增量继续' };
      render(); movedThinking();
      const previewReused = row.firstElementChild === span;
      run.timeline.push({ type: 'tool_call', name: 'read', callId: 'read-next', args: { path: 'a.js' }, openCodeKey: 'read-next' });
      render();
      const toolMoves = movedThinking();
      observer.disconnect();
      const acceptance = { purpose: 'frontend_acceptance', acceptance: { target: 'local-preview', check: 'layout' } };
      run.timeline.push({ type: 'tool_call', name: 'browser_screenshot', callId: 'browser', args: acceptance });
      render(); const browserShown = row.textContent.includes('操控内置浏览器');
      run.timeline.push({ type: 'tool_result', callId: 'browser', ok: true, output: 'ok' },
        { type: 'thinking', content: '验收后继续检查', openCodeKey: 'after-browser' });
      render(); const thinkingShown = row.textContent.includes('验收后继续检查') && !row.textContent.includes('操控内置浏览器');
      run.timeline.push({ type: 'tool_call', name: 'bash', callId: 'next-bash', args: { command: 'echo after-browser' } });
      render(); const toolShown = row.textContent.includes('after-browser') && !row.textContent.includes('操控内置浏览器');
      run.timeline.push({ type: 'tool_call', name: 'browser_click', callId: 'browser-2', args: acceptance });
      render(); const browserAgain = row.textContent.includes('操控内置浏览器');
      run.timeline.push({ type: 'tool_result', callId: 'browser-2', ok: true, output: 'ok' },
        { type: 'text', stage: 'work', content: '验收完成后整理结论', openCodeKey: 'after-narration' });
      render(); const narrationClears = !row.textContent.includes('操控内置浏览器');
      return { unchangedMoves, deltaMoves, toolMoves, previewReused, browserShown, thinkingShown, toolShown, browserAgain, narrationClears,
        expanded: body.querySelector('.agent-run-header').dataset.workExpanded === 'true',
        trimFirst: history.firstElementChild.classList.contains('agent-work-trim'),
        disclosurePreserved: first.open };
    });
    console.log(JSON.stringify(result, null, 2));
    assert.deepEqual(errors, []);
    assert.equal(result.unchangedMoves, 0, 'Unchanged long history must not detach thinking nodes');
    assert.equal(result.deltaMoves, 0, 'A reasoning delta must not move old thinking nodes');
    assert.ok(result.toolMoves <= 1, 'Window sliding may remove only the oldest thinking node');
    for (const key of ['previewReused', 'browserShown', 'thinkingShown', 'toolShown', 'browserAgain', 'narrationClears', 'expanded', 'trimFirst', 'disclosurePreserved']) assert.equal(result[key], true, key);
  } finally { await app?.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
