'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { createTwoFilesPatch } = require('diff');
const { summarizeOpenCodeDiffs, summarizeOpenCodeToolChanges } = require('../lib/run-change-summary');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-file-pill-e2e-'));

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
      typeof renderTodos === 'function'
      && quickInputHandlerReady === true
      && !!state.currentSession
    ));

    // Exactly the shape the V2 edit tool reports: per-file diffs live in
    // metadata.files, not in metadata.filediff.
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-v2-file-pill-'));
    const cssBefore = '.icon { border: 1px solid; }\n';
    const cssAfter = '.icon { border: 0; }\n.icon:hover { opacity: .7; }\n';
    const jsBefore = 'const ready = false;\n';
    const jsAfter = 'const ready = true;\n';
    fs.writeFileSync(path.join(workspace, 'styles.css'), cssAfter);
    fs.writeFileSync(path.join(workspace, 'app.js'), jsAfter);
    const diffs = await summarizeOpenCodeToolChanges(workspace, [{
      info: { id: 'assistant-v2', role: 'assistant', time: { created: 500 } },
      parts: [{
        type: 'tool', tool: 'edit', state: {
          status: 'completed',
          input: { path: path.join(workspace, 'styles.css') },
          metadata: {
            files: [
              {
                file: 'styles.css',
                patch: createTwoFilesPatch('styles.css', 'styles.css', cssBefore, cssAfter),
                additions: 2, deletions: 1, status: 'modified'
              },
              {
                file: 'app.js',
                patch: createTwoFilesPatch('app.js', 'app.js', jsBefore, jsAfter),
                additions: 1, deletions: 1, status: 'modified'
              }
            ],
            yanEnvironment: { mutation: true }
          }
        }
      }]
    }], { includeDiff: true });
    const summary = summarizeOpenCodeDiffs(workspace, diffs, { includeDiff: true });
    fs.rmSync(workspace, { recursive: true, force: true });

    assert.deepEqual({
      count: summary.count,
      additions: summary.additions,
      deletions: summary.deletions
    }, { count: 2, additions: 3, deletions: 2 });

    const pill = await page.evaluate(changeSummary => {
      const host = document.querySelector('#todoProgressHost');
      renderTodos({ status: 'done', todos: [], changeSummary });
      setTodoProgressOpen(true);
      const result = {
        hidden: host.classList.contains('hidden'),
        mode: host.dataset.mode,
        text: document.querySelector('#todoProgressCount')?.textContent,
        files: Array.from(document.querySelectorAll('#todoList .todo-change-file')).map(item => ({
          name: item.querySelector('.todo-change-file-name')?.textContent,
          stats: item.querySelector('.todo-change-file-stats')?.textContent || ''
        }))
      };
      return result;
    }, summary);

    const evidenceDir = path.join(appRoot, '.yanagent', 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, 'file-change-pill.png') });
    const panelStyles = await page.evaluate(() => {
      const panel = document.querySelector('#todoProgressPanel');
      const row = panel.querySelector('.todo-change-file');
      return {
        panelWidth: panel.getBoundingClientRect().width,
        panelRadius: getComputedStyle(panel).borderRadius,
        rowRadius: getComputedStyle(row).borderRadius,
        rowPadding: getComputedStyle(row).padding,
        listPadding: getComputedStyle(panel.querySelector('.todo-list')).padding
      };
    });
    await page.evaluate(() => setTodoProgressOpen(false));

    assert.equal(pill.hidden, false, JSON.stringify(pill));
    assert.equal(pill.mode, 'files', JSON.stringify(pill));
    assert.equal(pill.text, '编辑了2个文件 +3 -2', JSON.stringify(pill));
    assert.deepEqual(pill.files, [
      { name: 'styles.css', stats: '+2 -1' },
      { name: 'app.js', stats: '+1 -1' }
    ], JSON.stringify(pill));
    assert.ok(panelStyles.panelWidth > 200 && panelStyles.panelWidth < 380,
      `edited-files panel should size to its content, got ${panelStyles.panelWidth}`);
    assert.notEqual(panelStyles.panelRadius, '0px', 'the panel keeps rounded corners');
    assert.equal(panelStyles.rowRadius, '0px', 'file rows use a strict rectangular flash');
    assert.equal(panelStyles.rowPadding, '9px 14px', 'file rows are flush with the panel edges');
    assert.equal(panelStyles.listPadding, '0px', 'the list adds no inset around the rectangles');
    assert.deepEqual(pageErrors, []);
    console.log('V2 metadata.files reached the edited-files pill as +3 -2 with per-file stats.');
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
