'use strict';

// Generated media card layout: a compact thumbnail with one quiet caption row
// (「原图」/「完整提示词」) instead of the old bordered block.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-media-card-'));
const evidenceDir = path.join(appRoot, '.yanagent', 'evidence');
// A real 3:4 sample so the thumbnail's size and radius are observable.
const sampleFile = path.join(appRoot, 'renderer', 'assets', 'nested-sessions-current-window.png');
const pngBase64 = fs.readFileSync(sampleFile).toString('base64');

(async () => {
  let app;
  try {
    fs.mkdirSync(evidenceDir, { recursive: true });
    app = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile }
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ === true);
    await page.evaluate(() => window.YanStartupHello?.skip());
    await page.locator('#yanStartupHello').waitFor({ state: 'detached' });

    // Stub the asset read so the card renders without a real generation.
    await app.evaluate(({ ipcMain }, dataUrl) => {
      ipcMain.removeHandler('image:generated-read');
      ipcMain.handle('image:generated-read', () => ({ dataUrl }));
    }, `data:image/png;base64,${pngBase64}`);
    await page.evaluate(async dataUrl => {
      const session = await api.createSession(true, '');
      await loadSession(session.id);
      renderMessages([{ role: 'assistant', content: '出图了。', ts: Date.now() }]);
      setEmptyState(false);
      showMainPage('chat');
      const body = document.querySelector('#messages .msg:last-child .msg-body');
      globalThis.__mediaBody = body;
      renderGeneratedImagePreview(body, JSON.stringify({
        ok: true,
        meta: { generatedImageId: 'a'.repeat(32), name: '生成的图片' }
      }));
    }, `data:image/png;base64,${pngBase64}`);
    await page.waitForFunction(() => document.querySelector('.generated-image-preview'));

    const card = await page.evaluate(() => {
      const root = document.querySelector('.generated-image-result');
      const thumb = root.querySelector('.generated-media-thumb');
      const img = root.querySelector('.generated-image-preview');
      const rootRect = root.getBoundingClientRect();
      const imgRect = img.getBoundingClientRect();
      const thumbStyle = getComputedStyle(thumb);
      return {
        thumbIsButton: thumb.tagName,
        thumbRadius: thumbStyle.borderTopLeftRadius,
        thumbBorderWidth: thumbStyle.borderTopWidth,
        imgRadius: getComputedStyle(img).borderTopLeftRadius,
        imgBorderWidth: getComputedStyle(img).borderTopWidth,
        cardWidth: Math.round(rootRect.width),
        imgWidth: Math.round(imgRect.width),
        imgHeight: Math.round(imgRect.height),
        cardMaxWidth: getComputedStyle(root).maxWidth,
        role: root.getAttribute('role'),
        text: root.textContent.replace(/s+/g, ' ').trim(),
        footerCount: root.querySelectorAll('.generated-media-footer').length,
        linkCount: root.querySelectorAll('.generated-media-link, [data-media-action]').length,
        promptCount: root.querySelectorAll('.generated-media-prompt').length
      };
    });

    assert.equal(card.thumbIsButton, 'BUTTON');
    assert.equal(card.thumbRadius, '12px');
    assert.equal(card.thumbBorderWidth, '0px', 'the thumbnail carries no frame');
    assert.equal(card.imgRadius, '12px');
    assert.equal(card.imgBorderWidth, '0px');
    assert.match(card.cardMaxWidth, /360px/, 'the card stays compact');
    assert.ok(card.imgWidth <= 360);
    assert.ok(card.imgHeight > 40, 'the thumbnail is actually rendered');
    assert.equal(card.role, null, 'the card is not one big button');
    // The caption row in the reference screenshot is model prose, not card chrome.
    assert.equal(card.footerCount, 0, 'no caption row inside the card');
    assert.equal(card.linkCount, 0, 'no 原图 / 完整提示词 links inside the card');
    assert.equal(card.promptCount, 0, 'no prompt block inside the card');
    assert.equal(card.text, '', 'the card renders no text of its own');
    await page.screenshot({ path: path.join(evidenceDir, 'generated-media-card.png') });

    // Clicking the thumbnail still opens the viewer.
    await page.click('.generated-media-thumb');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.generated-media-thumb').length), 1);
    await page.keyboard.press('Escape');

    assert.deepEqual(errors, [], `no page errors: ${errors.join('; ')}`);
    console.log('generated-media-card.e2e: OK');
  } finally {
    try { await app?.close(); } catch { /* already closed */ }
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('generated-media-card.e2e: FAILED');
  console.error(error);
  process.exitCode = 1;
});
