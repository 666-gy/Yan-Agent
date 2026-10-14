'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-deliverable-links-'));

(async () => {
  let app;
  try {
    const env = { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile, YAN_DISABLE_SINGLE_INSTANCE: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ === true, null, { timeout: 60000 });
    // Observe real click routing without launching the user's default apps.
    await app.evaluate(({ ipcMain }) => {
      global.__deliverableLinkCalls = [];
      ipcMain.removeHandler('browser:open-link');
      ipcMain.handle('browser:open-link', (_event, url) => {
        global.__deliverableLinkCalls.push({ kind: 'browser', url });
        return { target: 'external' };
      });
      ipcMain.removeHandler('vscode:launch');
      ipcMain.handle('vscode:launch', (_event, payload) => {
        global.__deliverableLinkCalls.push({ kind: 'file', ...payload });
        return { ok: true };
      });
      ipcMain.removeHandler('file:reveal');
      ipcMain.handle('file:reveal', (_event, filePath) => {
        global.__deliverableLinkCalls.push({ kind: 'reveal', path: filePath });
        return true;
      });
    });
    await page.evaluate(() => {
      const body = document.createElement('article');
      body.id = 'deliverableLinkFixture';
      body.className = 'msg-body agent-output';
      body.style.cssText = 'position:fixed;top:100px;left:300px;z-index:99999;background:white;padding:20px';
      body.innerHTML = renderMarkdown([
        '已完成，写入 [`index.html`](<C:/My Project/index.html>)。',
        '主要产物：[报告.pdf](<C:/My Project/报告 (终稿).pdf>)',
        '[脚本.py](<C:/My Project/run.py>)',
        '[文档.docx](<C:/My Project/文档.docx>)',
        '[程序.exe](<C:/My Project/app.exe>)'
      ].join('\n\n'));
      document.body.appendChild(body);
    });
    const links = page.locator('#deliverableLinkFixture a');
    assert.equal(await links.count(), 5);
    assert.deepEqual(await links.allTextContents(), ['index.html', '报告.pdf', '脚本.py', '文档.docx', '程序.exe']);
    for (let index = 0; index < 5; index++) await links.nth(index).click();
    await page.waitForTimeout(100);
    assert.deepEqual(await app.evaluate(() => global.__deliverableLinkCalls), [
      { kind: 'browser', url: 'file:///C:/My%20Project/index.html' },
      { kind: 'browser', url: 'file:///C:/My%20Project/%E6%8A%A5%E5%91%8A%20(%E7%BB%88%E7%A8%BF).pdf' },
      { kind: 'file', workspace: 'file:///C:/My%20Project/run.py', useDefault: true },
      { kind: 'file', workspace: 'file:///C:/My%20Project/%E6%96%87%E6%A1%A3.docx', useDefault: true },
      { kind: 'reveal', path: 'C:\\My Project\\app.exe' }
    ]);
    await page.evaluate(() => {
      document.querySelector('#deliverableLinkFixture').innerHTML = renderMarkdown('这次只是回答问题。');
    });
    assert.equal(await links.count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: web deliverables open in the built-in browser, other files use the default program, executables are only revealed');
  } finally {
    await app?.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
