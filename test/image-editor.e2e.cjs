'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-image-editor-'));
const prompt = '移除此图像的背景。保持所有前景主体不变且完整，边缘干净平滑。将背景设为透明。';
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && state.currentSession && window.YanImageEditor);
    const filePath = path.join(profile, 'sample.png');
    const base64 = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 800; c.height = 600;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#96adc4'; ctx.fillRect(0, 0, 800, 600);
      ctx.fillStyle = '#fff'; ctx.font = '48px sans-serif'; ctx.fillText('Yan image editor', 100, 300);
      return c.toDataURL().split(',')[1];
    });
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    // Keep native actions deterministic: exercise actual IPC handlers with only OS boundaries stubbed.
    await app.evaluate(({ shell, dialog }, output) => {
      global.__imageActions = [];
      shell.showItemInFolder = value => { global.__imageActions.push(['reveal', value]); };
      shell.openPath = async value => { global.__imageActions.push(['default', value]); return ''; };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
    }, path.join(profile, 'saved.png'));
    await page.evaluate(filePath => window.yanImageOverlay.open({ filePath }), filePath);
    await page.locator('.image-overlay [data-action=edit]').click();
    await page.waitForFunction(() => !document.querySelector('#rs-image-editor [data-action=resize]').disabled);
    assert.equal(await page.evaluate(() => browserFocusMode), true);
    assert.equal(await page.locator('[data-rs-tab-type=image-editor]').count(), 1);
    assert.equal(await page.locator('.image-overlay').evaluate(el => el.open), false);
    const editor = page.locator('#rs-image-editor');
    assert.equal(await editor.locator('[data-action=annotate]').isDisabled(), false);
    for (const action of ['comment', 'erase']) assert.equal(await editor.locator(`[data-action=${action}]`).isDisabled(), false);
    await editor.locator('[data-action=zoom]').click();
    assert.equal(await editor.locator('[data-menu-action^="zoom:"]').count(), 6);
    await editor.locator('[data-menu-action="zoom:2"]').click();
    assert.equal(await editor.locator('.image-editor-zoom-label').textContent(), '200%');
    await editor.locator('[data-action=zoom]').click();
    await editor.locator('[data-menu-action="zoom:fit"]').click();
    await editor.locator('[data-action=reveal]').click();
    await page.waitForFunction(() => !document.querySelector('#rs-image-editor [data-action=reveal]').disabled);
    assert.equal(await editor.locator('.image-editor-open button').count(), 2);
    await editor.locator('[data-action=default]').click();
    await page.waitForFunction(() => !document.querySelector('#rs-image-editor [data-action=default]').disabled);
    assert.deepEqual(await app.evaluate(() => global.__imageActions), [['reveal', filePath], ['default', filePath]]);
    // Stub execution only; all UI, attachment IPC and session routing remain real.
    await page.evaluate(() => {
      setComposerText('保留我的草稿');
      window.__sentImages = [];
      submitMessage = async (text, attachments, skills, options) => {
        window.__sentImages.push({ text, attachments, session: options.session.id }); return { ok: true };
      };
      getAgentModelSelection = () => ({ modelType: 'text', modelId: 'test' });
    });
    await editor.locator('[data-action=resize]').click();
    assert.equal(await editor.locator('[data-menu-action^="resize:"]').count(), 5);
    await editor.locator('[data-menu-action="resize:1:1"]').click();
    await page.waitForFunction(() => window.__sentImages.length === 1);
    assert.equal(await page.evaluate(() => window.__sentImages[0].text), '将宽高比设为 1:1');
    assert.equal(await page.evaluate(() => window.__sentImages[0].attachments[0].path), filePath);
    for (const ratio of ['3:4', '9:16', '4:3', '16:9']) {
      await editor.locator('[data-action=resize]').click();
      await editor.locator(`[data-menu-action="resize:${ratio}"]`).click();
      await page.waitForFunction(ratio => window.__sentImages.at(-1).text === `将宽高比设为 ${ratio}`, ratio);
    }
    assert.deepEqual(await editor.locator('img.image-editor-image').evaluate(img => {
      const c = document.createElement('canvas'); c.width = c.height = 800;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      return { width: img.naturalWidth, height: img.naturalHeight, alpha: ctx.getImageData(0, 0, 1, 1).data[3], centerAlpha: ctx.getImageData(400, 400, 1, 1).data[3] };
    }), { width: 800, height: 600, alpha: 255, centerAlpha: 255 });
    await editor.locator('[data-action=download]').click();
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent === '图片已保存');
    assert.ok(fs.existsSync(path.join(profile, 'saved.png')));
    // Stub model execution, keeping the button's attachment preparation and routing real.
    await page.evaluate(() => {
      setComposerText('保留我的草稿');
      window.__sentImages = [];
      submitMessage = async (text, attachments, skills, options) => {
        window.__sentImages.push({ text, attachments, session: options.session.id }); return { ok: true };
      };
      getAgentModelSelection = () => ({ modelType: 'text', modelId: 'test' });
    });
    await editor.locator('[data-action=background]').click();
    await page.waitForFunction(() => window.__sentImages.length === 1);
    const sent = await page.evaluate(() => ({ ...window.__sentImages[0], current: state.currentSession.id, draft: getComposerText() }));
    assert.equal(sent.text, prompt); assert.equal(sent.session, sent.current);
    assert.equal(sent.draft, '保留我的草稿'); assert.equal(sent.attachments.length, 1);
    assert.equal(sent.attachments[0].path, filePath);
    assert.deepEqual(fs.readFileSync(sent.attachments[0].path), fs.readFileSync(path.join(profile, 'saved.png')));
    await page.evaluate(() => {
      window.__originalExecutionActive = isCurrentSessionExecutionActive;
      state.activeRuns.set(state.currentSession.id, { runCtx: { runId: 'test-run', shouldAbort: false }, sessionRef: state.currentSession });
      isCurrentSessionExecutionActive = () => true;
    });
    await editor.locator('[data-action=background]').click();
    await page.waitForFunction(() => state.queuedTurns.has(state.currentSession.id));
    assert.equal(await page.evaluate(() => state.queuedTurns.get(state.currentSession.id).text), prompt);
    assert.equal(await page.evaluate(() => getComposerText()), '保留我的草稿');
    await page.evaluate(() => {
      state.activeRuns.clear(); state.queuedTurns.clear();
      isCurrentSessionExecutionActive = window.__originalExecutionActive;
      updateSendState();
    });
    await editor.locator('[data-action=comment]').click();
    await page.waitForFunction(() => getComposerText().startsWith('修改此图片：'));
    assert.equal(await page.evaluate(() => getComposerText()), '修改此图片：\n保留我的草稿');
    await editor.locator('[data-action=comment]').click();
    await page.waitForFunction(() => !document.querySelector('#rs-image-editor [data-action=comment]').disabled);
    assert.equal(await page.evaluate(() => state.attachments.length), 1);
    assert.equal(await page.evaluate(() => state.attachments[0].imageEdit), 'source');
    assert.equal(await page.evaluate(() => browserFocusMode && browserFocusComposerMode === 'expanded'), true);
    assert.equal(await page.evaluate(() => getComposerText()), '修改此图片：\n保留我的草稿');
    await page.evaluate(() => setBrowserFocusMode(true));
    await editor.locator('[data-action=erase]').click();
    assert.equal(await editor.locator('[data-action=erase-send]').isDisabled(), true);
    assert.equal(await editor.locator('.image-editor-erase-hint').isVisible(), true);
    const surface = editor.locator('.image-editor-selection');
    await surface.scrollIntoViewIfNeeded();
    const rect = await surface.boundingBox();
    await page.mouse.move(rect.x + rect.width * .25, rect.y + rect.height * .45);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * .7, rect.y + rect.height * .45, { steps: 12 });
    await page.mouse.up();
    assert.equal(await editor.locator('.image-editor-erase-hint').isVisible(), false);
    const selectedAlpha = () => surface.evaluate(c => c.getContext('2d').getImageData(400, 270, 1, 1).data[3]);
    assert.equal(await selectedAlpha(), 255);
    await editor.locator('[data-action=undo]').click();
    assert.equal(await selectedAlpha(), 0);
    assert.equal(await editor.locator('[data-action=erase-send]').isDisabled(), true);
    await editor.locator('[data-action=redo]').click();
    assert.equal(await selectedAlpha(), 255);
    // A failed dispatch must preserve selection so the user can retry.
    await page.evaluate(() => { window.__successfulImageSubmit = submitMessage; submitMessage = async () => ({ ok: false, error: 'test failure' }); });
    await editor.locator('[data-action=erase-send]').click();
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent === 'test failure');
    assert.equal(await selectedAlpha(), 255);
    assert.equal(await editor.locator('[data-action=erase-send]').isEnabled(), true);
    await page.evaluate(() => { submitMessage = window.__successfulImageSubmit; });
    // Selection coordinates survive zoom; original image remains untouched.
    await editor.locator('[data-action=zoom]').click();
    await editor.locator('[data-menu-action="zoom:2"]').click();
    assert.equal(await selectedAlpha(), 255);
    await editor.locator('[data-action=zoom]').click();
    await editor.locator('[data-menu-action="zoom:fit"]').click();
    if (process.env.YAN_EDITOR_SCREENSHOT) await page.screenshot({ path: process.env.YAN_EDITOR_SCREENSHOT.replace('.png', '-erase.png') });
    await editor.locator('[data-action=erase-send]').click();
    await page.waitForFunction(() => window.__sentImages.length === 2);
    const erased = await page.evaluate(() => window.__sentImages[1]);
    assert.equal(erased.text, '抹除此图像中的选定区域');
    assert.equal(erased.attachments.length, 2);
    assert.deepEqual(erased.attachments.map(item => item.imageEdit), ['source', 'selection']);
    assert.equal(erased.attachments[0].path, filePath);
    assert.ok(fs.existsSync(erased.attachments[1].path));
    const markedPixels = await page.evaluate(async path => {
      const result = await api.readImageFile(path), img = new Image(); img.src = result.dataUrl; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      return { width: img.width, height: img.height, outside: [...ctx.getImageData(0, 0, 1, 1).data], inside: [...ctx.getImageData(400, 270, 1, 1).data] };
    }, erased.attachments[1].path);
    assert.equal(markedPixels.width, 800); assert.equal(markedPixels.height, 600);
    assert.deepEqual(markedPixels.outside, [150, 173, 196, 255]);
    assert.notDeepEqual(markedPixels.inside, markedPixels.outside);
    assert.equal(await page.evaluate(() => getComposerText()), '修改此图片：\n保留我的草稿');
    await page.waitForFunction(() => !document.querySelector('#rs-image-editor').classList.contains('is-erasing'));
    await editor.locator('[data-action=erase]').click();
    assert.equal(await editor.locator('[data-action=erase-send]').isDisabled(), true);
    await editor.locator('.image-editor-brush-size').fill('32');
    const secondRect = await surface.boundingBox();
    await page.mouse.click(secondRect.x + secondRect.width * .5, secondRect.y + secondRect.height * .45);
    assert.equal(await selectedAlpha(), 255);
    assert.equal(await editor.locator('.image-editor-eraser-cursor').evaluate(el => el.style.width), '32px');
    await page.evaluate(() => {
      state.activeRuns.set(state.currentSession.id, { runCtx: { runId: 'test-erase-queue', shouldAbort: false }, sessionRef: state.currentSession });
      isCurrentSessionExecutionActive = () => true;
    });
    await editor.locator('[data-action=erase-send]').click();
    await page.waitForFunction(() => state.queuedTurns.has(state.currentSession.id));
    const queuedErase = await page.evaluate(() => {
      const queued = state.queuedTurns.get(state.currentSession.id);
      return { text: queued.text, attachments: queued.attachments };
    });
    assert.equal(queuedErase.text, '抹除此图像中的选定区域');
    assert.equal(queuedErase.attachments.length, 2);
    assert.deepEqual(queuedErase.attachments.map(item => item.imageEdit), ['source', 'selection']);
    assert.ok(fs.existsSync(queuedErase.attachments[1].path));
    await page.evaluate(() => {
      state.activeRuns.clear(); state.queuedTurns.clear();
      isCurrentSessionExecutionActive = window.__originalExecutionActive; updateSendState();
    });
    await editor.locator('[data-action=erase]').click();
    await editor.locator('[data-action=erase-cancel]').click();
    await page.locator('[data-rs-close-tab=image-editor]').click();
    assert.equal(await editor.locator('img.image-editor-image').getAttribute('src'), null);
    await app.evaluate(({ ipcMain }, fixture) => {
      ipcMain.removeHandler('image:generated-read');
      ipcMain.handle('image:generated-read', () => ({ path: fixture.path, name: 'generated.png', size: fixture.size,
        mimeType: 'image/png', dataUrl: `data:image/png;base64,${fixture.base64}` }));
    }, { path: filePath, size: fs.statSync(filePath).size, base64 });
    await page.evaluate(() => window.YanImageEditor.open({ assetId: 'test-generated' }));
    await page.waitForFunction(() => !document.querySelector('#rs-image-editor [data-action=reveal]').disabled);
    await editor.locator('[data-action=reveal]').click();
    await page.waitForFunction(() => !document.querySelector('#rs-image-editor [data-action=reveal]').disabled);
    assert.deepEqual((await app.evaluate(() => global.__imageActions)).at(-1), ['reveal', filePath]);
    for (const width of [320, 375, 414, 768]) {
      await editor.evaluate((el, width) => { el.style.width = `${width}px`; }, width);
      await page.waitForTimeout(40);
      const bounds = await editor.evaluate(el => {
        const root = el.getBoundingClientRect();
        return [...el.querySelectorAll('.image-editor-toolbar button')].every(button => {
          if (!button.getClientRects().length) return true;
          const r = button.getBoundingClientRect(); return r.left >= root.left && r.right <= root.right + 1;
        });
      });
      assert.equal(bounds, true, `toolbar overflow at ${width}px`);
    }
    await editor.evaluate(el => { el.style.removeProperty('width'); });
    await page.evaluate(filePath => window.YanImageEditor.open({ filePath }), process.env.YAN_EDITOR_IMAGE || filePath);
    await page.waitForFunction(() => !document.querySelector('#rs-image-editor [data-action=resize]').disabled);
    if (process.env.YAN_EDITOR_SCREENSHOT) {
      await page.evaluate(() => applyTheme('light'));
      await page.waitForTimeout(250);
      await page.screenshot({ path: process.env.YAN_EDITOR_SCREENSHOT });
      await editor.locator('[data-action=resize]').click();
      await page.screenshot({ path: process.env.YAN_EDITOR_SCREENSHOT.replace('.png', '-menu.png') });
      await page.keyboard.press('Escape');
      await page.evaluate(() => applyTheme('dark'));
      await page.waitForTimeout(250);
      await editor.locator('[data-action=zoom]').click();
      await page.screenshot({ path: process.env.YAN_EDITOR_SCREENSHOT.replace('.png', '-dark.png') });
      await page.keyboard.press('Escape');
      await editor.locator('[data-action=erase]').click();
      await page.evaluate(() => applyTheme('light'));
      await page.screenshot({ path: process.env.YAN_EDITOR_SCREENSHOT.replace('.png', '-erase-empty.png') });
      const box = await surface.boundingBox();
      await page.mouse.move(box.x + box.width * .35, box.y + box.height * .4);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .65, box.y + box.height * .25, { steps: 15 });
      await page.mouse.up();
      await page.screenshot({ path: process.env.YAN_EDITOR_SCREENSHOT.replace('.png', '-erase-light.png') });
      await page.evaluate(() => applyTheme('dark'));
      await page.screenshot({ path: process.env.YAN_EDITOR_SCREENSHOT.replace('.png', '-erase-dark.png') });
    }
    assert.equal(await page.locator('#yanFatalError').isVisible(), false);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Image editor: overlay, native actions, resize dispatch, comment deduplication, eraser drawing/undo/redo/zoom/send/reset, queue and draft preservation passed.');
  } finally {
    await app?.close();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
