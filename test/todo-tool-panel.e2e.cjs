'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-todo-panel-e2e-'));
const output = path.join(appRoot, 'output', 'playwright');
fs.mkdirSync(output, { recursive: true });

// The todowrite tool result echoes the list carried by the tool arguments; the
// panel must render the checklist once instead of repeating it.
(async () => {
  let application;
  const errors = [];
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => (
      typeof createRunCtx === 'function'
      && typeof appendMessage === 'function'
      && typeof renderAgentRunBody === 'function'
    ));

    const result = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      const todos = [
        { content: '编写 index.html：连续轮廓鹈鹕 + 双骨 IK 骑行动画', status: 'in_progress', priority: 'high' },
        { content: '内置浏览器冻结帧放大验收（逐层比对）并迭代修正', status: 'pending', priority: 'high' },
        { content: '动态双帧 + 整页最终证据验收', status: 'pending', priority: 'medium' },
        { content: 'Harness 自进化：固化已验证的动画验收/建模战术', status: 'pending', priority: 'low' }
      ];
      const echo = todos.map(todo => todo.content).join('\n');
      const el = appendMessage('assistant', '');
      const body = el.querySelector('.msg-body');
      renderAgentRunBody(body, {
        runId: 'todo-panel-e2e',
        status: 'completed',
        timeline: [
          { type: 'tool_call', stage: 'work', callId: 'todo-1', name: 'todowrite', args: { todos } },
          { type: 'tool_result', stage: 'work', callId: 'todo-1', name: 'todowrite', output: echo, ok: true }
        ]
      });
      el.querySelectorAll('.tool-activity-group, .tool-parallel-group, .tool-step')
        .forEach(row => { row.open = true; });
      await new Promise(resolve => setTimeout(resolve, 0));
      const panel = body.querySelector('.tool-result-panel');
      const input = panel?.querySelector('.tool-result-input')?.textContent || '';
      const outputText = panel?.querySelector('.tool-result-output')?.textContent || '';
      const count = text => {
        const pattern = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu');
        return (String(input).match(pattern) || []).length + (String(outputText).match(pattern) || []).length;
      };
      return {
        panelFound: !!panel,
        preview: el.querySelector('.tool-step .tc-preview')?.textContent || '',
        input,
        output: outputText,
        outputBlockPresent: !!panel?.querySelector('.tool-result-output-block'),
        counts: todos.map(todo => count(todo.content))
      };
    });

    await page.screenshot({ path: path.join(output, 'todo-tool-panel.png') });
    assert.equal(result.panelFound, true, JSON.stringify(result));
    assert.deepEqual(result.counts, [1, 1, 1, 1], JSON.stringify(result));
    assert.equal(result.outputBlockPresent, false, JSON.stringify(result));
    assert.match(result.preview, /4 项/u, JSON.stringify(result));
    assert.equal(result.preview.includes('[object Object]'), false, JSON.stringify(result));
    assert.equal(errors.length, 0, errors.join('; '));
    console.log(JSON.stringify({
      ok: true,
      screenshot: path.join(output, 'todo-tool-panel.png'),
      counts: result.counts,
      input: result.input
    }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
