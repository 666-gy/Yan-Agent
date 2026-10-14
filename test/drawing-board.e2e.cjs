'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-drawing-board-'));
const output = path.join(root, 'output/playwright/drawing-board');
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(async () => { if (!state.currentSession) await newSession(); setComposerText('按照这张草图调整前端布局'); });
    await page.setViewportSize({ width: 1280, height: 900 });
    fs.mkdirSync(output, { recursive: true });
    await page.locator('#attachBtn').click();
    assert.equal(await page.locator('#drawingAction').innerText(), '绘图\n绘制草图');
    await page.locator('#drawingAction').click();
    const board = page.locator('#drawingBoard');
    const button = name => board.locator(`[data-annotation="${name}"]`);
    await page.waitForFunction(() => document.querySelector('#drawingBoard .image-editor-annotations')?.getAttribute('viewBox'));
    assert.equal(await board.isVisible(), true);
    assert.equal(await button('select').getAttribute('aria-pressed'), 'true');
    assert.equal(await board.locator('.drawing-confirm').isDisabled(), true);
    assert.equal(await board.locator('.image-annotation-palette').isVisible(), true);
    await page.screenshot({ path: path.join(output, 'blank-desktop.png') });
    const point = async (x, y) => {
      const box = await board.locator('.image-editor-annotations').boundingBox();
      return { x: box.x + x, y: box.y + y };
    };
    const drag = async (x1, y1, x2, y2) => {
      const start = await point(x1, y1), end = await point(x2, y2);
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 12 }); await page.mouse.up();
    };
    await button('pen').click(); await drag(180, 180, 380, 280);
    assert.equal(await board.locator('[data-type="pen"]').count(), 1);
    await button('undo').click(); assert.equal(await board.locator('[data-type="pen"]').count(), 0);
    await button('redo').click(); assert.equal(await board.locator('[data-type="pen"]').count(), 1);
    await button('eraser').click(); await drag(220, 200, 280, 230);
    assert.ok(await board.locator('defs mask path').count() > 0);
    await button('undo').click(); assert.equal(await board.locator('defs mask path').count(), 0);
    await board.locator('[data-color="#2563eb"]').click();
    await button('shapes').click(); await board.locator('[data-shape="rectangle"]').click();
    await drag(470, 160, 800, 400);
    await button('text').click();
    const textPoint = await point(490, 190); await page.mouse.click(textPoint.x, textPoint.y);
    await board.locator('.image-annotation-text-input').fill('导航栏\nYan Agent');
    await button('pen').click();
    assert.equal(await board.locator('[data-type="text"]').count(), 1);
    await button('shapes').click(); await board.locator('[data-shape="arrow"]').click();
    await drag(220, 420, 500, 450);
    assert.equal(await board.locator('[data-type="arrow"]').count(), 1);
    await button('select').click(); await drag(600, 300, 650, 350);
    assert.equal(await board.locator('.drawing-confirm').isEnabled(), true);
    await page.screenshot({ path: path.join(output, 'drawing-desktop.png') });
    for (const width of [880, 390]) {
      await page.setViewportSize({ width, height: 820 });
      const fit = await board.evaluate(el => {
        const box = el.getBoundingClientRect();
        const nodes = [...el.querySelectorAll('.drawing-tools, .drawing-history, .drawing-close, .drawing-confirm, .image-annotation-palette')];
        return nodes.every(node => { const b = node.getBoundingClientRect(); return b.left >= box.left && b.right <= box.right && b.top >= box.top && b.bottom <= box.bottom; });
      });
      assert.equal(fit, true, `${width}px controls must stay within the board`);
      await page.screenshot({ path: path.join(output, `drawing-${width}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.evaluate(({ ipcMain }) => {
      const upload = ipcMain._invokeHandlers.get('file:upload');
      let failOnce = true;
      ipcMain.removeHandler('file:upload');
      ipcMain.handle('file:upload', (event, payload) => {
        if (failOnce) { failOnce = false; return { error: 'drawing save fixture failure' }; }
        return upload(event, payload);
      });
    });
    await board.locator('.drawing-confirm').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(el => el.textContent.includes('drawing save fixture failure')));
    assert.equal(await board.isVisible(), true);
    assert.equal(await page.evaluate(() => state.attachments.length), 0);
    assert.equal(await board.locator('[data-type="text"]').count(), 1);
    assert.equal(await board.locator('.drawing-confirm').isEnabled(), true);
    await board.locator('.drawing-confirm').click();
    await board.waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => ({ attachment: state.attachments.at(-1), text: getComposerText() }));
    assert.equal(saved.text, '按照这张草图调整前端布局');
    assert.equal(saved.attachment.mimeType, 'image/png');
    assert.equal(saved.attachment.kind, 'image');
    assert.match(saved.attachment.name, /^绘图-/);
    const pixels = await app.evaluate(({ nativeImage }, filePath) => {
      const img = nativeImage.createFromPath(filePath), bitmap = img.toBitmap();
      let ink = 0; for (let i = 0; i < bitmap.length; i += 4) if (bitmap[i] < 200 || bitmap[i + 1] < 200 || bitmap[i + 2] < 200) ink++;
      return { ...img.getSize(), ink, corner: [...bitmap.subarray(0, 4)] };
    }, saved.attachment.path);
    assert.ok(pixels.ink > 500);
    assert.deepEqual(pixels.corner, [255, 255, 255, 255]);
    await page.locator('#attachments .attachment-chip.image').last().click();
    await page.waitForFunction(() => document.querySelector('.image-overlay[open] img')?.naturalWidth > 0);
    await page.locator('.image-overlay [data-action="close"]').click();
    await page.locator('#attachBtn').click(); await page.locator('#drawingAction').click();
    await page.waitForFunction(() => document.querySelector('#drawingBoard .image-editor-annotations')?.getAttribute('viewBox'));
    assert.equal(await board.locator('.image-annotation-art > *').count(), 0);
    await button('pen').click(); await drag(200, 200, 350, 220);
    await board.locator('.drawing-close').click();
    await board.locator('.image-discard-continue').click(); assert.equal(await board.isVisible(), true);
    await board.locator('.drawing-close').click(); await board.locator('.image-discard-confirm').click();
    assert.equal(await board.isVisible(), false);
    assert.equal(await page.evaluate(() => state.attachments.length), 1);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, tools: 'pen, text, shapes, select, eraser, undo, redo', widths: [1280, 880, 390], pixels }));
  } finally {
    await app?.close();
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('yan-drawing-board-'));
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
