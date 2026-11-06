'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
(async () => {
  const executable = process.env.YAN_SHELL_TEST_EXE;
  if (!executable) throw new Error('YAN_SHELL_TEST_EXE is required');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-release-no-dots-'));
  const env = { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: executable, args: [], env });
  try {
    const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    const state = await page.evaluate(() => {
      showMainPage('chat');
      return { dots: !!document.querySelector('#yanxiNavBtn, #pageYanxi, #yanxiComposerBar, [src*="qq-emoji"], [src*="yanxi"]'),
        loaded: !!window.YanxiPage || !!window.YanQQEmoji, api: !!window.yan.yanxiList, page: currentMainPage,
        composer: !!document.querySelector('#composerInput'), body: document.body.innerText.slice(0, 300) };
    });
    assert.equal(state.dots, false); assert.equal(state.loaded, false); assert.equal(state.api, false);
    assert.equal(state.page, 'chat'); assert.equal(state.composer, true); assert.deepEqual(errors, []);
    const about = await page.evaluate(() => ({ version: window.YanAboutContent.versionLabel, notes: window.YanAboutContent.releaseNotes }));
    assert.equal(about.version, 'Yan Agent v' + require('../package.json').displayVersion);
    const expectedNotes = fs.readFileSync(path.join(__dirname, '../renderer/about-content.js'), 'utf8');
    const vmContext = { window: {} }; require('node:vm').runInNewContext(expectedNotes, vmContext);
    assert.equal(about.notes, vmContext.window.YanAboutContent.releaseNotes);
    const unpacked = path.join(path.dirname(executable), 'resources/app.asar.unpacked/lib');
    assert.equal(fs.existsSync(path.join(unpacked, 'yanxi')), false);
    assert.equal(fs.existsSync(path.join(unpacked, 'main/ipc-yanxi.js')), false);
    console.log('PASS packaged release: no Dots UI, APIs, modules, or emoji; stale navigation returns to chat');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
