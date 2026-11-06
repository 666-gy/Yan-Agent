'use strict';
// Regression: Agent Markdown screenshots must open the in-place image viewer,
// not the project-files panel. Plain local file links keep the files route.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-agent-image-preview-'));
const evidenceDir = path.join(appRoot, '.yanagent', 'evidence');
const pngPath = path.join(evidenceDir, 'agent-markdown-preview.png');
const png2Path = path.join(evidenceDir, 'agent-markdown-preview-2.png');
const txtPath = path.join(evidenceDir, 'agent-markdown-preview.txt');
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(pngPath, Buffer.from(pngBase64, 'base64'));
fs.writeFileSync(png2Path, Buffer.from(pngBase64, 'base64'));
fs.writeFileSync(txtPath, 'plain file link');

function fileUrl(filePath) {
  return 'file:///' + filePath.replace(/\\/g, '/').split('/')
    .map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part))
    .join('/');
}

(async () => {
  let app;
  try {
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
    await page.evaluate(async ({ appRoot, pngPath, png2Path, txtPath }) => {
      const session = await api.createSession(true, appRoot);
      await loadSession(session.id);
      state.currentSession.workspace = appRoot;
      const toFileUrl = filePath => 'file:///' + filePath.replace(/\\/g, '/').split('/')
        .map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part))
        .join('/');
      globalThis.__previewTextUrl = toFileUrl(txtPath);
      renderMessages([{ role: 'assistant', content: `![截图](${toFileUrl(pngPath)})

![截图2](${toFileUrl(png2Path)})`, ts: Date.now() }]);
      setEmptyState(false);
    }, { appRoot, pngPath, png2Path, txtPath });

    const imageLink = page.locator('.agent-markdown-image-link');
    assert.equal(await imageLink.count(), 2);
    await imageLink.first().click();
    await page.waitForFunction(() => {
      const overlay = document.querySelector('.image-overlay');
      const image = document.querySelector('.image-overlay-image');
      return overlay?.open === true && image?.hidden === false && image?.naturalWidth > 0;
    }, null, { timeout: 15000 });
    const imageState = await page.evaluate(() => ({
      overlay: document.querySelector('.image-overlay')?.open === true,
      filesActive: document.querySelector('.rs-panel.active')?.id === 'rs-files',
      width: document.querySelector('.image-overlay-image')?.naturalWidth || 0
    }));
    assert.equal(imageState.overlay, true);
    assert.equal(imageState.filesActive, false);
    assert.equal(imageState.width, 1);
    assert.equal(await page.locator('.image-overlay-nav').isVisible(), true);
    assert.equal(await page.locator('.image-overlay-counter').count(), 0);
    await page.locator('.image-overlay [data-action="next"]').click();
    await page.waitForFunction(() => document.querySelector('.image-overlay-image')?.alt.includes('agent-markdown-preview-2.png'));
    assert.equal(await page.locator('.image-overlay [data-action="next"]').isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.image-overlay')?.open);

    await page.evaluate(() => {
      globalThis.__fileLinkCalls = [];
      window.YanProjectFiles.openLocal = (filePath, options) => {
        globalThis.__fileLinkCalls.push({ filePath, ...(options ? { options } : {}) });
        return Promise.resolve({ ok: true });
      };
      renderMessages([{ role: 'assistant', content: `[普通文件](${globalThis.__previewTextUrl})`, ts: Date.now() }]);
    });
    await page.locator('.agent-output-link').first().click();
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => globalThis.__fileLinkCalls.map(call => call.filePath)), [fileUrl(txtPath)]);
    assert.deepEqual(errors, []);
    console.log('PASS: Agent Markdown screenshots open the image viewer; plain local files still open the files panel');
  } finally {
    await app?.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    fs.rmSync(pngPath, { force: true });
    fs.rmSync(png2Path, { force: true });
    fs.rmSync(txtPath, { force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
