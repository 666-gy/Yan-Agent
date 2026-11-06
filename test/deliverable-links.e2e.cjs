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
    // Deliverable links are handled in the renderer's capture-phase file-link
    // router: web-viewable files open in Yan's browser, everything else goes
    // through the project-files panel.
    await page.evaluate(() => {
      globalThis.__deliverableLinkCalls = [];
      window.YanProjectFiles.openLocal = (filePath, options) => {
        globalThis.__deliverableLinkCalls.push({ kind: 'openLocal', filePath, ...(options ? { options } : {}) });
        return Promise.resolve({ ok: true });
      };
      window.openBrowserUrlInNewTab = url => {
        globalThis.__deliverableLinkCalls.push({ kind: 'browser', url });
        return true;
      };
    });
    await page.evaluate(() => {
      const body = document.createElement('article');
      body.id = 'deliverableLinkFixture';
      body.className = 'msg-body agent-output';
      body.style.cssText = 'position:fixed;top:100px;left:300px;z-index:99999;background:white;padding:20px';
      body.innerHTML = renderMarkdown([
        '已完成，写入 [鹈鹕骑自行车](<C:/My Project/index.html>)。',
        '主要产物：[逆向流程方案（报告 (终稿).pdf）](<C:/My Project/报告 (终稿).pdf>)',
        '[自动化脚本（run.py）](<C:/My Project/run.py>)',
        '[需求文档（文档.docx）](<C:/My Project/文档.docx>)',
        '[安装程序（app.exe）](<C:/My Project/app.exe>)'
      ].join('\n\n'));
      document.body.appendChild(body);
    });
    const links = page.locator('#deliverableLinkFixture a');
    assert.equal(await links.count(), 5);
    const labels = await links.allTextContents();
    assert.deepEqual(labels, [
      '鹈鹕骑自行车',
      '逆向流程方案（报告 (终稿).pdf）',
      '自动化脚本（run.py）',
      '需求文档（文档.docx）',
      '安装程序（app.exe）'
    ]);
    // Semantic labels describe the deliverable; none may collapse back to the
    // bare filename the policy now discourages.
    assert.ok(labels.every(label => !/^[\w.-]+\.(?:html?|pdf|py|docx|exe)$/i.test(label)),
      'deliverable labels must be semantic names, not bare filenames');
    for (let index = 0; index < 5; index++) await links.nth(index).click();
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => globalThis.__deliverableLinkCalls), [
      { kind: 'browser', url: 'file:///C:/My%20Project/index.html' },
      { kind: 'browser', url: 'file:///C:/My%20Project/%E6%8A%A5%E5%91%8A%20(%E7%BB%88%E7%A8%BF).pdf' },
      { kind: 'openLocal', filePath: 'file:///C:/My%20Project/run.py' },
      { kind: 'openLocal', filePath: 'file:///C:/My%20Project/%E6%96%87%E6%A1%A3.docx' },
      { kind: 'openLocal', filePath: 'file:///C:/My%20Project/app.exe' }
    ]);
    await page.evaluate(() => {
      document.querySelector('#deliverableLinkFixture').innerHTML = renderMarkdown('这次只是回答问题。');
    });
    assert.equal(await links.count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: semantic deliverable labels, web deliverables open in the built-in browser, other files open in the project-files panel');
  } finally {
    await app?.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
