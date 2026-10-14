'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-attachment-preview-'));
// 1x1 PNG, enough to prove the file is read, decoded and measured by the viewer.
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const firstPng = path.join(userDataDir, 'attachment-preview-1.png');
const secondPng = path.join(userDataDir, 'attachment-preview-2.png');
fs.writeFileSync(firstPng, Buffer.from(pngBase64, 'base64'));
fs.writeFileSync(secondPng, Buffer.from(pngBase64, 'base64'));

async function waitForDecodedViewer(viewer) {
  await viewer.waitForFunction(() => {
    const image = document.querySelector('.image-overlay-image');
    return !!image && image.hidden === false && image.naturalWidth > 0;
  }, null, { timeout: 15000 });
  return viewer.evaluate(() => ({
    open: document.querySelector('.image-overlay')?.open,
    statusHidden: document.querySelector('.image-overlay-status')?.hidden === true,
    naturalWidth: document.querySelector('.image-overlay-image')?.naturalWidth || 0,
    downloadEnabled: document.querySelector('.image-overlay [data-action=download]')?.disabled === false
  }));
}

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
      window.__YAN_APP_READY__ && typeof appendMessage === 'function'
      && typeof renderAttachments === 'function'
      && typeof newSession === 'function'
    ));

    // Path 1: an image attachment inside a sent user message.
    await page.evaluate(async ({ filePath }) => {
      if (!state.currentSession) await newSession();
      appendMessage('user', '看一下这张图', [{
        name: 'attachment-preview-1.png',
        path: filePath,
        size: 68,
        kind: 'image',
        mimeType: 'image/png'
      }]);
    }, { filePath: firstPng });
    const windowCount = application.windows().length;
    await page.locator('.msg-attachment.image.is-previewable').first().click();
    const firstViewer = page;
    const firstState = await waitForDecodedViewer(firstViewer);
    assert.equal(firstState.open, true, JSON.stringify(firstState));
    assert.equal(application.windows().length, windowCount);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.image-overlay').open);
    assert.equal(firstState.statusHidden, true, JSON.stringify(firstState));
    assert.equal(firstState.naturalWidth, 1, JSON.stringify(firstState));
    assert.equal(firstState.downloadEnabled, true, JSON.stringify(firstState));

    // Path 2: an image chip still in the composer.

    await page.evaluate(async ({ filePath }) => {
      state.attachments = [{
        name: 'attachment-preview-2.png',
        path: filePath,
        size: 68,
        kind: 'image',
        mimeType: 'image/png'
      }];
      renderAttachments();
    }, { filePath: secondPng });
    await page.locator('.attachment-chip.image.is-previewable').click();
    const secondViewer = page;
    const secondState = await waitForDecodedViewer(secondViewer);
    assert.equal(secondState.naturalWidth, 1, JSON.stringify(secondState));

    await page.locator('[data-action=close]').click();

    // The pre-existing generated-image viewer path keeps its contract after the
    // shared-window refactor.
    const generated = await page.evaluate(() => api.openGeneratedImage('missing-asset'));
    assert.equal(generated?.error, '会话图片已失效，请重新生成', JSON.stringify(generated));

    // Large image exercises real overflow and scroll behavior at 100%.
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2400; canvas.height = 1800;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#8fa9c4'; ctx.fillRect(0, 0, 2400, 1800);
      ctx.fillStyle = '#fff'; ctx.font = '120px sans-serif'; ctx.fillText('Yan image preview', 220, 500);
      window.__previewFixture = canvas.toDataURL();
    });
    const largePng = path.join(userDataDir, 'large.png');
    fs.writeFileSync(largePng, Buffer.from(await page.evaluate(() => window.__previewFixture.split(',')[1]), 'base64'));
    await page.evaluate(filePath => window.yanImageOverlay.open({ filePath }), largePng);
    await waitForDecodedViewer(page);
    if (process.env.YAN_PREVIEW_SCREENSHOT) await page.screenshot({ path: process.env.YAN_PREVIEW_SCREENSHOT });
    const initialZoom = await page.locator('.image-overlay-zoom output').textContent();
    await page.locator('[data-action=in]').click({ clickCount: 6, delay: 50 });
    const zoomed = await page.locator('.image-overlay-zoom output').textContent();
    assert.notEqual(zoomed, initialZoom);
    const beforeScroll = await page.locator('.image-overlay-stage').evaluate(el => {
      el.scrollTop = 0; el.scrollLeft = 0;
      return { width: el.clientWidth, height: el.clientHeight, scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight };
    });
    assert.ok(beforeScroll.scrollWidth > beforeScroll.width);
    assert.ok(beforeScroll.scrollHeight > beforeScroll.height);
    await page.locator('.image-overlay-stage').hover();
    await page.mouse.wheel(0, 320);
    await page.waitForFunction(() => document.querySelector('.image-overlay-stage').scrollTop > 0);
    assert.equal(await page.locator('.image-overlay-zoom output').textContent(), zoomed);
    assert.equal(await page.locator('.image-overlay-stage').evaluate(el => el.scrollLeft), 0);
    assert.ok(await page.locator('.image-overlay-stage').evaluate(el => { el.scrollLeft = 300; return el.scrollLeft > 0; }));
    await page.locator('[data-action=out]').click();
    assert.notEqual(await page.locator('.image-overlay-zoom output').textContent(), zoomed);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.yanImageOverlay.open({ assetId: 'missing-asset' }));
    await page.waitForFunction(() => document.querySelector('.image-overlay-status').textContent.includes('已失效'));
    await page.locator('[data-action=close]').click();
    assert.equal(application.windows().length, windowCount);
    assert.equal(errors.length, 0, errors.join('; '));
    console.log(JSON.stringify({ ok: true, firstState, secondState }));
  } finally {
    await application?.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (error) { console.warn('Temporary profile cleanup:', error.message); }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
