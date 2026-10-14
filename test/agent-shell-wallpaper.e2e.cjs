'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-shell-wallpaper-'));
const output = path.join(root, 'output', 'playwright');

(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && !!state.currentSession);
    fs.mkdirSync(output, { recursive: true });
    const results = [];
    for (const theme of ['light', 'dark']) {
      for (const strength of [0.1, 0.6]) {
        await page.evaluate(async ({ theme, strength }) => {
          state.config = await yan.setConfig({ theme,
            wallpaper: { id: 'night-sky', path: '', custom: [], removed: [] },
            themeCompat: { materialStrength: strength } });
          applyTheme(theme);
          applyWallpaperConfig(state.config);
          await applyWallpaperCompat(state.config);
        }, { theme, strength });
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(output, `shell-wallpaper-${theme}-${strength}.png`) });

        // A flat diagnostic wallpaper exposes material seams without photo
        // texture hiding them. Capture actual painted pixels, including the
        // previously untreated resize gutter and the outside of the round corner.
        const diagnostic = await page.addStyleTag({ content: `
          #wallpaperLayer { background-image: linear-gradient(#629a88, #629a88) !important; }
          #app::after { background: var(--wall-scrim); }
        ` });
        await page.waitForTimeout(250);
        const geometry = await page.evaluate(() => {
          const side = document.querySelector('#sidebar').getBoundingClientRect();
          const main = document.querySelector('#pageChat').getBoundingClientRect();
          return { edge: side.right, canvas: main.left, top: main.top };
        });
        const png = await page.screenshot({ scale: 'css' });
        const pixels = await app.evaluate(({ nativeImage }, { png, geometry: g }) => {
          const image = nativeImage.createFromBuffer(Buffer.from(png, 'base64'));
          const { width } = image.getSize();
          const bytes = image.toBitmap();
          const at = (x, y) => {
            const offset = (Math.floor(y) * width + Math.floor(x)) * 4;
            return [...bytes.subarray(offset, offset + 3)];
          };
          return {
            sidebar: at(g.edge - 3, g.top + 130),
            gutter: at(g.edge + 2, g.top + 130),
            title: at(g.canvas + 2, g.top - 4),
            corner: at(g.canvas + 2, g.top + 2),
            content: at(g.canvas + 40, g.top + 130)
          };
        }, { png: png.toString('base64'), geometry });
        const delta = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));
        assert.ok(delta(pixels.sidebar, pixels.gutter) <= 1, `resize gutter seam: ${JSON.stringify(pixels)}`);
        assert.ok(delta(pixels.content, pixels.corner) <= 1, `flat content junction: ${JSON.stringify(pixels)}`);
        assert.ok(delta(pixels.content, pixels.sidebar) <= 1, `sidebar/content material mismatch: ${JSON.stringify(pixels)}`);
        results.push({ theme, strength, pixels });
        await diagnostic.evaluate(el => el.remove());
      }
    }

    // Keep the real resize affordance and verify layout changes still work.
    const before = await page.locator('#sidebar').boundingBox();
    const handle = await page.locator('#leftResizeHandle').boundingBox();
    await page.mouse.move(handle.x + 2, handle.y + 160);
    await page.mouse.down();
    await page.mouse.move(handle.x + 62, handle.y + 160, { steps: 8 });
    await page.mouse.up();
    assert.ok((await page.locator('#sidebar').boundingBox()).width > before.width + 40);
    await page.evaluate(() => setLeftSidebarOpen(false));
    assert.equal(await page.locator('#sidebar').isVisible(), false);
    await page.evaluate(() => setLeftSidebarOpen(true));
    await page.evaluate(() => openSettings('general'));
    assert.equal(await page.locator('#settingsOverlay').isVisible(), true);
    await page.locator('#appRail [data-nav="tasks"]').click();
    assert.equal(await page.locator('#settingsOverlay').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, results, resize: true, settings: true }));
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
    catch (error) { console.warn(`cleanup skipped: ${error.message}`); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
