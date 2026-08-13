'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-composer-todo-e2e-'));

(async () => {
  let application;
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
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForFunction(() => (
      typeof createRunCtx === 'function'
      && typeof applyOpenCodeEvent === 'function'
      && typeof renderTodos === 'function'
      && document.querySelector('#composerInput')?.isContentEditable
    ));

    const pasteResult = await page.evaluate(() => {
      input.value = 'ab';
      composerLastCaretTextOffset = 1;
      window.getSelection()?.removeAllRanges();
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', 'C:\\Pictures\\sample.png');
      const event = new ClipboardEvent('paste', {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true
      });
      input.dispatchEvent(event);
      return {
        value: input.value,
        prevented: event.defaultPrevented,
        focused: document.activeElement === input
      };
    });
    assert.deepEqual(pasteResult, {
      value: 'aC:\\Pictures\\sample.pngb',
      prevented: true,
      focused: true
    });

    const todoResult = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      const runCtx = createRunCtx(state.currentSession.id, true, state.currentSession.workspace || '');
      runCtx.activeAgentRun = { runId: runCtx.runId, status: 'working', timeline: [] };
      state.activeRuns.set(state.currentSession.id, {
        sessionRef: state.currentSession,
        runCtx,
        assistantEl: null
      });
      applyOpenCodeEvent(runCtx, {
        type: 'todo.updated',
        properties: {
          sessionID: 'e2e-session',
          todos: [
            { content: '检查输入', status: 'completed' },
            { content: '修复渲染', status: 'in_progress' },
            { content: '完成验证', status: 'pending' }
          ]
        }
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const host = document.querySelector('#todoProgressHost');
      const active = {
        hidden: host.classList.contains('hidden'),
        count: document.querySelector('#todoProgressCount')?.textContent,
        items: Array.from(document.querySelectorAll('#todoList .todo-item')).map(item => item.textContent.trim())
      };

      runCtx.agentState.status = 'done';
      runCtx.agentState.todos = runCtx.agentState.todos.map(todo => ({
        ...todo,
        done: true,
        inProgress: false
      }));
      state.activeRuns.delete(state.currentSession.id);
      renderTodos(runCtx.agentState);
      const completed = {
        hidden: host.classList.contains('hidden'),
        state: host.dataset.state,
        count: document.querySelector('#todoProgressCount')?.textContent
      };
      return { active, completed };
    });

    assert.equal(todoResult.active.hidden, false, JSON.stringify(todoResult));
    assert.equal(todoResult.active.count, '1/3', JSON.stringify(todoResult));
    assert.equal(todoResult.active.items.length, 3, JSON.stringify(todoResult));
    assert.equal(todoResult.completed.hidden, false, JSON.stringify(todoResult));
    assert.equal(todoResult.completed.state, 'success', JSON.stringify(todoResult));
    assert.equal(todoResult.completed.count, '3/3', JSON.stringify(todoResult));
    assert.deepEqual(pageErrors, []);

    console.log(JSON.stringify({ ok: true, pasteResult, todoResult }));
  } finally {
    if (application) await application.close().catch(() => {});
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedUserData = path.resolve(userDataDir);
    if (resolvedUserData.startsWith(tempRoot + path.sep)) {
      fs.rmSync(resolvedUserData, { recursive: true, force: true });
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
