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
    const image = document.getElementById('generatedImage');
    return !!image && image.hidden === false && image.naturalWidth > 0;
  }, null, { timeout: 15000 });
  return viewer.evaluate(() => ({
    title: document.title,
    statusHidden: document.getElementById('viewerStatus')?.hidden === true,
    naturalWidth: document.getElementById('generatedImage')?.naturalWidth || 0,
    downloadEnabled: document.getElementById('downloadBtn')?.disabled === false
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
      typeof appendMessage === 'function'
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
    const firstViewerEvent = application.waitForEvent('window');
    await page.locator('.msg-attachment.image.is-previewable').first().click();
    const firstViewer = await firstViewerEvent;
    const firstState = await waitForDecodedViewer(firstViewer);
    assert.equal(firstState.title, '图片预览', JSON.stringify(firstState));
    assert.equal(firstState.statusHidden, true, JSON.stringify(firstState));
    assert.equal(firstState.naturalWidth, 1, JSON.stringify(firstState));
    assert.equal(firstState.downloadEnabled, true, JSON.stringify(firstState));

    // Path 2: an image chip still in the composer.
    const secondViewerEvent = application.waitForEvent('window');
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
    const secondViewer = await secondViewerEvent;
    const secondState = await waitForDecodedViewer(secondViewer);
    assert.equal(secondState.naturalWidth, 1, JSON.stringify(secondState));

    // The pre-existing generated-image viewer path keeps its contract after the
    // shared-window refactor.
    const generated = await page.evaluate(() => api.openGeneratedImage('missing-asset'));
    assert.equal(generated?.error, '会话图片已失效，请重新生成', JSON.stringify(generated));

    assert.equal(errors.length, 0, errors.join('; '));
    console.log(JSON.stringify({ ok: true, firstState, secondState }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
