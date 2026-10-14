'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-local-settings-e2e-'));
const sessionDir = path.join(userData, 'YanData', 'sessions');
fs.mkdirSync(sessionDir, { recursive: true });
const record = { id: 'sess_compression_test', title: '旧聊天压缩验证', createdAt: 1, updatedAt: 1,
  messages: [{ role: 'assistant', content: '无损保存历史聊天内容。'.repeat(10000) }] };
const file = path.join(sessionDir, `${record.id}.json`);
fs.writeFileSync(file, JSON.stringify(record));
fs.utimesSync(file, new Date(1), new Date(1));
let app;
async function launch() {
  app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
    env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
  await page.locator('#settingsBtn').click();
  await page.locator('#generalHistoryCompression').waitFor();
  await page.waitForFunction(() => !document.querySelector('#generalHistoryCompression').disabled);
  return page;
}
(async () => {
  try {
    let page = await launch();
    await page.locator('#generalHistoryCompression').check();
    await page.waitForFunction(async () => {
      const result = await window.yan.getLocalHistorySettings();
      return result.compressLocalHistory && !result.compression.running && result.compression.processed === 1;
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), record);
    await page.screenshot({ path: path.join(root, 'test', 'local-history-settings-preview.png') });
    // Use a unique, temporary Run value; never alter the user's actual startup preference.
    const login = await app.evaluate(async ({ app, shell }, root) => {
      const require = process.getBuiltinModule('module').createRequire(`${root}/package.json`);
      const { createLocalHistorySettings } = require(require('node:path').join(root, 'lib/main/local-history-settings'));
      app.setAppUserModelId(`Yan Startup Test ${process.pid}`);
      const service = createLocalHistorySettings({ app, shell,
        configStore: { loadConfig: () => ({ general: {} }) }, sessionsDir: '', isSessionRunActive: () => false });
      try {
        let enabled;
        try { enabled = service.update('launchAtLogin', true); }
        catch (error) { throw new Error(`${error.message}: ${JSON.stringify({ explicit: app.getLoginItemSettings({ path: process.execPath, args: [app.getAppPath()] }), default: app.getLoginItemSettings(), quoted: app.getLoginItemSettings({ path: '"' + process.execPath + '"', args: [app.getAppPath()] }) })}`); }
        const disabled = service.update('launchAtLogin', false);
        return { enabled, disabled };
      } finally { service.update('launchAtLogin', false); }
    }, root);
    assert.equal(login.enabled.launchAtLogin, true);
    assert.equal(login.disabled.launchAtLogin, false);
    await app.close(); app = null;
    page = await launch();
    assert.equal(await page.locator('#generalHistoryCompression').isChecked(), true);
    await page.locator('#generalHistoryCompression').uncheck();
    await page.waitForFunction(async () => !(await window.yan.getLocalHistorySettings()).compressLocalHistory);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), record);
    console.log('PASS: real startup registration/removal, compression UI, persistence across restart, original history intact.');
  } finally {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
