'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-app-snapshot-'));
const output = path.join(root, 'output/playwright/app-snapshot');
(async () => {
  let app;
  try {
    const packaged = process.env.YAN_PACKAGED_APP_DIR;
    app = await _electron.launch({ executablePath: packaged ? path.join(packaged, 'Yan Agent.exe') : require('electron'), args: packaged ? [] : [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    if (!packaged && process.platform === 'win32') {
      const text = await app.evaluate(async ({ BrowserWindow }, scriptPath) => {
        const fixture = new BrowserWindow({ show: false, title: 'Snapshot Text Fixture', webPreferences: { sandbox: true } });
        try {
          await fixture.loadURL('data:text/html,<title>Snapshot Text Fixture</title><p>Window text capture fixture</p>');
          const handle = fixture.getNativeWindowHandle();
          const id = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
          const load = process.getBuiltinModule('module').createRequire(scriptPath);
          return await load(scriptPath).captureSnapshotText(id);
        } finally { fixture.destroy(); }
      }, path.join(root, 'lib/main/snapshot-text.js'));
      assert.match(text, /Snapshot Text Fixture/);
      assert.match(text, /0 窗口/);
      assert.match(text, /^窗口: /);
      assert.doesNotMatch(text, /ControlType\.|\b(?:Value|Text|ID|Window):/);
    }
    if (packaged) {
      // Exercise the real PowerShell/C# monitor before installing UI fixtures.
      await page.waitForFunction(async () => (await window.yan.getAppSnapshotSettings()).registered === true,
        null, { timeout: 30000 });
      assert.equal((await page.evaluate(() => window.yan.getAppSnapshotSettings())).error, '');
    }
    // Deterministic capture adapter lets UI races and closed/empty windows be
    // tested without depending on desktop session visibility or private content.
    await app.evaluate(async ({ desktopCapturer, nativeImage, app, ipcMain, BrowserWindow }, registration) => {
      const SHORTCUTS = ['Alt+Alt', 'Shift+Shift'];
      const normalize = value => ({ shortcut: SHORTCUTS.includes(value?.shortcut) ? value.shortcut : 'Alt+Alt', destination: ['auto','new','current'].includes(value?.destination) ? value.destination : 'auto', sound: value?.sound !== false });
      const registerAppSnapshotIpc = new Function('normalize', 'SHORTCUTS', 'createSnapshotMonitor', 'return ' + registration)(normalize, SHORTCUTS, null);
      for (const key of ['target','capture','settings','update']) ipcMain.removeHandler('app-snapshot:' + key);
      const main = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/renderer/index.html'));
      let cfg = { appSnapshot: { shortcut: 'Alt+Alt', destination: 'auto', sound: true } };
      global.__snapshotTestCallbacks = null;
      registerAppSnapshotIpc({ ipcMain, app, BrowserWindow,
        windows: { getMainWindow: () => main }, config: { load: () => structuredClone(cfg), save: v => { cfg = v; } }
      }, desktopCapturer, { captureText: async () => '窗口: "Snapshot Test"\n0 窗口 Snapshot Test\n  1 文本 <safe>\n' + '  2 文本 Snapshot content\n'.repeat(80), createMonitor: cb => { global.__snapshotTestCallbacks = cb; return { start() { cb.onState(true); }, stop() {} }; } });
      global.__snapshotTest = { closed: false, empty: false, fail: false, green: false, delay: 0, calls: [] };
      desktopCapturer.getSources = async options => {
        const test = global.__snapshotTest;
        test.calls.push(options.thumbnailSize.width);
        if (test.delay) await new Promise(resolve => setTimeout(resolve, test.delay));
        if (test.fail) throw new Error('Test capture unavailable');
        if (test.closed) return [];
        const width = options.thumbnailSize.width <= 360 ? 320 : 640;
        const height = width * 5 / 8;
        const pixel = test.green ? [80, 180, 23, 255] : [211, 92, 23, 255];
        const bitmap = Buffer.alloc(width * height * 4);
        for (let i = 0; i < bitmap.length; i += 4) bitmap.set(pixel, i);
        return [{ id: 'window:123456789:0', name: 'Snapshot Test', appIcon: null,
          thumbnail: test.empty ? nativeImage.createEmpty() : nativeImage.createFromBitmap(bitmap, { width, height }) }];
      };
    }, require('../lib/main/app-snapshot').registerAppSnapshotIpc.toString());
    await app.evaluate(() => global.__snapshotTestCallbacks.onTargets([{handle:'123456789',name:'Snapshot Test',pid:999999}]));
    const open = async () => {
      await page.locator('#attachBtn').click(); await page.waitForFunction(() => !document.querySelector('#appSnapshotAction').disabled);
      assert.equal(await page.locator('#appSnapshotAction').innerText(), '附加Snapshot Test');
    };
    await open();
    fs.mkdirSync(output, { recursive: true });
    await app.evaluate(() => { global.__snapshotTest.green = true; });
    await page.locator('#appSnapshotAction').click();
    await page.waitForFunction(() => state.attachments.length === 1);
    assert.equal(await page.locator('#appSnapshotDialog').count(), 0);
    const attachments = await page.evaluate(() => state.attachments);
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0].kind, 'image');
    assert.equal(attachments[0].mimeType, 'image/png');
    const pixel = await app.evaluate(({ nativeImage }, filePath) => {
      const image = nativeImage.createFromPath(filePath);
      return { ...image.getSize(), bgra: [...image.toBitmap().subarray(0, 4)] };
    }, attachments[0].path);
    assert.equal(pixel.width, 640);
    assert.deepEqual(pixel.bgra, [80, 180, 23, 255], 'Capture must fetch fresh full-size pixels, not the list preview');
    assert.equal(await page.locator('#attachments .attachment-chip.image').count(), 0);
    assert.equal(await page.locator('#composer .composer-snapshot').count(), 1);
    await page.evaluate(() => {
      state.attachments.unshift({ name: 'notes.txt', path: 'C:/snapshot-test/notes.txt', kind: 'file', size: 1 });
      renderAttachments();
    });
    assert.equal(await page.locator('#attachments .attachment-chip').count(), 1);
    assert.equal(await page.locator('#composer .composer-snapshot').count(), 1);
    await page.locator('#attachments .remove').click();
    await page.waitForFunction(() => document.querySelector('.composer-snapshot-image')?.naturalWidth > 0);
    await page.locator('#composerInput').focus(); await page.mouse.move(1,1);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.composer-snapshot-remove')).opacity === '0');
    assert.equal(await page.locator('.composer-snapshot').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    await page.locator('.composer-snapshot').hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.composer-snapshot-remove')).opacity === '1');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.locator('#composer').screenshot({ path: path.join(output, `composer-${theme}.png`), animations: 'disabled' });
    }
    // Match the supported desktop window sizes (minimum width: 880px).
    for (const width of [880, 1024, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      const fit = await page.locator('#composer').evaluate(el => {
        const card = el.querySelector('.composer-snapshot').getBoundingClientRect();
        const editor = el.querySelector('#composerInput').getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return card.right <= box.right + 1 && card.bottom <= editor.top + 1 && editor.height > 0;
      });
      assert.ok(fit, `${width}px snapshot must stay inside composer and above the editor`);
    }
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.locator('.composer-snapshot-open').click();
    await page.waitForFunction(() => document.querySelector('.image-overlay[open] .image-overlay-image')?.naturalWidth === 640);
    const textButton = page.locator('.image-overlay [data-action="text"]');
    assert.equal(await textButton.innerText(), '查看文本');
    await textButton.click();
    assert.equal(await page.locator('.image-overlay-stage').isVisible(), false);
    assert.equal(await page.locator('.image-overlay-text').isVisible(), true);
    assert.match(await page.locator('.image-overlay-text pre').innerText(), /  1 文本 <safe>/);
    assert.equal(await page.locator('.image-overlay-text pre safe').count(), 0);
    assert.equal(await page.locator('.image-overlay-zoom').isVisible(), false);
    await page.screenshot({ path: path.join(output, 'snapshot-text.png') });
    await textButton.click();
    assert.equal(await page.locator('.image-overlay-stage').isVisible(), true);
    assert.equal(await page.locator('.image-overlay-text').isVisible(), false);
    await page.locator('.image-overlay [data-action="close"]').click();
    await page.evaluate(() => appendMessage('user', 'Snapshot preview fixture', [state.attachments[0]]));
    await page.locator('.msg-attachment.is-previewable').last().click();
    await textButton.click();
    assert.match(await page.locator('.image-overlay-text pre').innerText(), /Snapshot content/);
    await page.locator('.image-overlay [data-action="close"]').click();
    await page.locator('.composer-snapshot').hover(); await page.locator('.composer-snapshot-remove').click();
    assert.equal(await page.evaluate(() => state.attachments.length), 0);
    await app.evaluate(() => global.__snapshotTestCallbacks.onTargets([]));
    await page.locator('#attachBtn').click();
    await page.waitForFunction(() => document.querySelector('#appSnapshotAction').disabled);
    assert.equal(await page.locator('#appSnapshotAction').innerText(), '应用快照');
    await page.locator('#attachBtn').click();
    await app.evaluate(() => global.__snapshotTestCallbacks.onTargets([{handle:'123456789',name:'Snapshot Test',pid:999999}]));
    await open();
    await app.evaluate(() => { global.__snapshotTest.empty = true; });
    await page.locator('#appSnapshotAction').click();
    await page.waitForFunction(() => document.querySelector('#appSnapshotAction').getAttribute('aria-busy') === 'false');
    assert.equal(await page.evaluate(() => state.attachments.length), 0);
    await app.evaluate(() => { global.__snapshotTest.empty = false; });
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-app-snapshot').click();
    await page.locator('#snapshotShortcut-trigger').click();
    assert.deepEqual(await page.locator('.appearance-picker-panel:popover-open .appearance-picker-option .settings-picker-label').allTextContents(), ['Alt + Alt','Shift + Shift']);
    assert.ok((await page.locator('.appearance-picker-panel:popover-open').boundingBox()).width >= 239);
    await page.locator('.appearance-picker-option').filter({ hasText: 'Shift + Shift' }).click();
    await page.waitForFunction(async () => (await window.yan.getAppSnapshotSettings()).settings.shortcut === 'Shift+Shift');
    await page.locator('#snapshotSound').uncheck();
    await page.waitForFunction(async () => (await window.yan.getAppSnapshotSettings()).settings.sound === false);
    await page.locator('#snapshotDestination-trigger').click();
    await page.locator('.appearance-picker-option').filter({ hasText: '新聊天' }).click();
    await page.waitForFunction(async () => (await window.yan.getAppSnapshotSettings()).settings.destination === 'new');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.screenshot({ path: path.join(output, `settings-${theme}.png`), animations: 'disabled' });
    }
    for (const width of [880, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.locator('.sheet-content').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `${width}px settings overflow`);
    }
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.locator('#settingsBtn').click(); await page.locator('#settings-tab-app-snapshot').click();
    await page.waitForFunction(() => document.querySelector('#snapshotDestination').value === 'new');
    assert.equal(await page.locator('#snapshotSound').isChecked(), false);
    await page.evaluate(() => closeSettings());
    await page.evaluate(() => { window.__snapshotAudioCount = 0; window.Audio = class { play() { window.__snapshotAudioCount++; return Promise.resolve(); } }; });
    const beforeSession = await page.evaluate(() => state.currentSession?.id);
    const deliver = settings => app.evaluate(({ BrowserWindow, nativeImage }, settings) => {
      const main = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/renderer/index.html'));
      const image = nativeImage.createFromBitmap(Buffer.alloc(640 * 400 * 4, 180), { width: 640, height: 400 });
      main.webContents.send('app-snapshot:received', { name: 'fixture.png', data: image.toPNG().toString('base64'),
        snapshot: { name: 'Snapshot Test', icon: '', preview: image.toDataURL() }, settings });
    }, settings);
    await deliver({ destination: 'new', sound: false });
    await page.waitForFunction(() => state.attachments.length === 1);
    assert.notEqual(await page.evaluate(() => state.currentSession?.id), beforeSession);
    assert.equal(await page.evaluate(() => window.__snapshotAudioCount), 0);
    const currentSession = await page.evaluate(() => state.currentSession.id);
    await deliver({ destination: 'current', sound: true });
    await page.waitForFunction(() => state.attachments.length === 2);
    assert.equal(await page.evaluate(() => state.currentSession.id), currentSession);
    assert.equal(await page.evaluate(() => window.__snapshotAudioCount), 1);
    await page.evaluate(async () => { await newSession({ standalone: true, forceNew: true }); });
    assert.equal(await page.locator('.composer-snapshot').count(), 0);
    await page.evaluate(async id => loadSession(id), currentSession);
    assert.equal(await page.locator('.composer-snapshot').count(), 2, 'Snapshot cards restore with the draft');
    // Visual evidence uses our own test settings page, never another app's content.
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.evaluate(() => { applyTheme('light'); openSettings('app-snapshot'); });
    const ownWindowImage = (await page.screenshot({ animations: 'disabled' })).toString('base64');
    await page.evaluate(() => { closeSettings(); state.attachments = []; renderAttachments(); });
    await app.evaluate(({ BrowserWindow, nativeImage }, { data, iconPath }) => {
      const main = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/renderer/index.html'));
      const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
      const icon = nativeImage.createFromPath(iconPath);
      main.webContents.send('app-snapshot:received', { name: 'Yan Agent.png', data,
        snapshot: { name: 'Yan Agent', icon: icon.isEmpty() ? '' : icon.toDataURL(), preview: image.resize({ width: 560 }).toDataURL() },
        settings: { destination: 'current', sound: false } });
    }, { data: ownWindowImage, iconPath: path.join(root, 'renderer/assets/logo-light.png') });
    await page.waitForFunction(() => state.attachments.length === 1);
    await page.waitForFunction(() => document.querySelector('.composer-snapshot-image')?.complete);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.locator('#composer').screenshot({ path: path.join(output, `composer-${theme}.png`), animations: 'disabled' });
      await page.locator('.composer-snapshot').screenshot({ path: path.join(output, `card-${theme}.png`), animations: 'disabled' });
    }
    assert.deepEqual(errors, []);
    console.log('Direct external-app attachment, unavailable state, hover card, two shortcuts, widened picker, destination, sound and responsive settings passed.');
  } finally {
    await app?.close();
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
