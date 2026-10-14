'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-image-annotate-'));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && state.currentSession && window.YanImageEditor);
    const filePath = path.join(profile, 'annotation.png'), savedPath = path.join(profile, 'saved.png');
    const base64 = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 600;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#edf2f8'; ctx.fillRect(0, 0, 900, 600);
      return c.toDataURL().split(',')[1];
    });
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, savedPath);
    await page.evaluate(file => window.YanImageEditor.open({ filePath: file }), filePath);
    const editor = page.locator('#rs-image-editor'), surface = editor.locator('.image-editor-annotations');
    const button = name => editor.locator(`[data-annotation="${name}"]`);
    const paths = editor.locator('.image-annotation-art path');
    const exportPixels = async points => {
      await editor.locator('[data-action=download]').click();
      await page.waitForFunction(() => !document.querySelector('#rs-image-editor [data-action=download]').disabled && document.querySelector('#toast')?.textContent === '图片已保存');
      return page.evaluate(async ({ file, points }) => {
        const result = await api.readImageFile(file), img = new Image(); img.src = result.dataUrl; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
        return points.map(([x,y]) => [...ctx.getImageData(x,y,1,1).data]);
      }, { file: savedPath, points });
    };
    const background = [237, 242, 248, 255];
    const drag = async (from, to, steps = 10) => {
      const box = await surface.boundingBox();
      const xy = point => [box.x + point[0] * box.width / 900, box.y + point[1] * box.height / 600];
      await page.mouse.move(...xy(from)); await page.mouse.down(); await page.mouse.move(...xy(to), { steps }); await page.mouse.up();
    };
    const at = async p => {
      const box = await surface.boundingBox(); await page.mouse.click(box.x + p[0] * box.width / 900, box.y + p[1] * box.height / 600);
    };
    const chooseShape = async type => { await button('shapes').click(); await editor.locator(`[data-shape="${type}"]`).click(); };
    const color = async value => {
      await button('colors').click();
      await editor.locator('.image-annotation-custom input').evaluate((input, value) => {
        input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
      await button('colors').click();
    };
    await editor.locator('[data-action=annotate]').click();
    assert.equal(await button('text').isDisabled(), false);
    assert.equal(await editor.locator('.image-editor-tools').isVisible(), false);
    assert.equal(await editor.locator('.image-editor-brush-control').isVisible(), true);
    await button('colors').click();
    assert.equal(await editor.locator('.image-annotation-palette [data-color]').count(), 13);
    await editor.locator('[data-color="#2563eb"]').click();
    await editor.locator('.image-editor-brush-size').fill('8');
    await drag([100, 180], [330, 210]);
    assert.equal(await paths.count(), 1);
    assert.equal(await paths.first().getAttribute('stroke'), '#2563eb');
    const penBefore = await paths.first().getAttribute('d');
    await button('undo').click(); assert.equal(await paths.count(), 0);
    await button('redo').click(); assert.equal(await paths.count(), 1);
    await at([420, 450]);
    assert.equal(await button('select').getAttribute('aria-pressed'), 'true');
    assert.equal(await paths.count(), 1, 'blank click must not add a dot');
    await drag([200, 193], [250, 243]);
    assert.notEqual(await paths.first().getAttribute('d'), penBefore, 'freehand mark should move');
    await color('#12ab34');
    assert.equal(await paths.first().getAttribute('stroke'), '#12ab34');
    await button('undo').click(); assert.equal(await paths.first().getAttribute('stroke'), '#2563eb');
    await button('redo').click(); assert.equal(await paths.first().getAttribute('stroke'), '#12ab34');
    await button('eraser').click();
    await drag([250, 200], [250, 280]);
    assert.equal(await paths.count(), 1, 'eraser must retain the untouched parts of a stroke');
    const erasedPixels = await exportPixels([[200,237],[250,243],[330,253]]);
    assert.notDeepEqual(erasedPixels[0], background); assert.deepEqual(erasedPixels[1], background); assert.notDeepEqual(erasedPixels[2], background);
    await button('undo').click();
    assert.notDeepEqual((await exportPixels([[250,243]]))[0], background);
    await button('redo').click();
    assert.deepEqual((await exportPixels([[250,243]]))[0], background);
    // Later drawing must not inherit an older eraser mask.
    await button('pen').click(); await drag([220,243],[280,243]);
    assert.notDeepEqual((await exportPixels([[250,243]]))[0], background);
    await button('undo').click(); await button('undo').click();
    await button('select').click(); await at([420, 450]);
    await color('#dc2626');
    for (const [index, shape] of ['line', 'arrow', 'rectangle', 'ellipse', 'triangle', 'diamond', 'star', 'heart'].entries()) {
      await chooseShape(shape);
      assert.equal(await editor.locator('.image-annotation-shapes').isVisible(), false);
      const x = 70 + (index % 4) * 180, y = index < 4 ? 320 : 470;
      await drag([x, y], [x + 100, y + 80]);
      assert.equal(await paths.last().getAttribute('data-type'), shape);
      assert.equal(await paths.last().getAttribute('stroke'), '#dc2626');
    }
    assert.equal(await paths.count(), 9);
    // A circular erase cuts only part of a shape edge and follows move/resize.
    await button('eraser').click(); await at([480,320]);
    const cutShape = await exportPixels([[450,320],[480,320],[510,320]]);
    assert.notDeepEqual(cutShape[0], background); assert.deepEqual(cutShape[1], background); assert.notDeepEqual(cutShape[2], background);
    await button('select').click(); await drag([470,350],[490,360]);
    const movedCut = await exportPixels([[470,330],[500,330],[530,330]]);
    assert.notDeepEqual(movedCut[0], background); assert.deepEqual(movedCut[1], background); assert.notDeepEqual(movedCut[2], background);
    const shapeCorner = await editor.locator('[data-handle="se"]').boundingBox();
    const surfaceBox = await surface.boundingBox();
    await page.mouse.move(shapeCorner.x + shapeCorner.width/2, shapeCorner.y + shapeCorner.height/2); await page.mouse.down();
    await page.mouse.move(shapeCorner.x + shapeCorner.width/2 + surfaceBox.width*100/900, shapeCorner.y + shapeCorner.height/2 + surfaceBox.height*80/600); await page.mouse.up();
    const resizedCut = await exportPixels([[480,330],[550,330],[620,330]]);
    assert.notDeepEqual(resizedCut[0], background); assert.deepEqual(resizedCut[1], background); assert.notDeepEqual(resizedCut[2], background);
    await button('undo').click(); await button('undo').click(); await button('undo').click();
    // Drag a selected shape and its corner independently; each action is undoable.
    const heart = paths.last(), heartBefore = await heart.getAttribute('d');
    await drag([660, 500], [690, 480]);
    const heartMoved = await heart.getAttribute('d'); assert.notEqual(heartMoved, heartBefore);
    const corner = editor.locator('[data-handle="se"]');
    const cb = await corner.boundingBox();
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2); await page.mouse.down();
    await page.mouse.move(cb.x + cb.width / 2 + 35, cb.y + cb.height / 2 - 30); await page.mouse.up();
    assert.notEqual(await heart.getAttribute('d'), heartMoved);
    await button('undo').click(); assert.equal(await heart.getAttribute('d'), heartMoved);
    // Line endpoint editing survives a zoom change, and moving does not mutate its length.
    await at([110, 352]);
    assert.equal(await editor.locator('[data-handle="end"]').count(), 1);
    const line = editor.locator('.image-annotation-art [data-type="line"]'), lineBefore = await line.getAttribute('d');
    await editor.locator('[data-action=zoom]').click(); await editor.locator('[data-menu-action="zoom:0.5"]').click();
    await editor.locator('[data-handle="end"]').waitFor({ state: 'visible' });
    const end = await editor.locator('[data-handle="end"]').boundingBox();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2); await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2 + 30, end.y + end.height / 2 - 20); await page.mouse.up();
    assert.notEqual(await line.getAttribute('d'), lineBefore);
    await button('undo').click(); assert.equal(await line.getAttribute('d'), lineBefore);
    await button('redo').click();
    await editor.locator('[data-action=zoom]').click(); await editor.locator('[data-menu-action="zoom:fit"]').click();
    const snapshot = await paths.evaluateAll(nodes => nodes.map(n => n.getAttribute('d')));
    await button('close').click();
    const dialog = editor.locator('.image-editor-discard');
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await dialog.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return Math.abs(rect.left + rect.width/2 - innerWidth/2) < 2 && Math.abs(rect.top + rect.height/2 - innerHeight/2) < 2;
    }), true, 'discard dialog must be centered');
    assert.equal(await dialog.locator('h2').textContent(), '放弃更改?');
    await dialog.locator('.image-discard-continue').click();
    assert.equal(await editor.locator('.image-annotation-tools').isVisible(), true);
    assert.equal(await paths.count(), 9, 'continue editing must retain annotations');
    await button('close').click(); await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false); assert.equal(await paths.count(), 9);
    await editor.locator('[data-action=download]').click();
    await page.waitForFunction(() => !document.querySelector('#rs-image-editor [data-action=download]').disabled && document.querySelector('#toast')?.textContent === '图片已保存');
    const saved = await page.evaluate(async file => {
      const result = await api.readImageFile(file), img = new Image(); img.src = result.dataUrl; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      return { width: img.width, height: img.height, unmarked: [...ctx.getImageData(0, 0, 1, 1).data], marked: [...ctx.getImageData(300, 360, 1, 1).data] };
    }, savedPath);
    assert.deepEqual([saved.width, saved.height], [900, 600]);
    assert.deepEqual(saved.unmarked, [237, 242, 248, 255]);
    assert.notDeepEqual(saved.marked, saved.unmarked, 'export must contain drawn pixels');
    assert.equal(fs.readFileSync(filePath).toString('base64'), base64, 'original file must remain unchanged');
    await button('comment').click();
    await page.waitForFunction(() => state.attachments.some(item => item.imageEdit === 'annotation'));
    const annotated = await page.evaluate(() => {
      captureComposerDraftForSession();
      const file = state.attachments.find(item => item.imageEdit === 'annotation');
      return { file, draft: state.composerDrafts.get(state.currentSession.id).attachments,
        guidance: window.YanImageEditContext(state.attachments, state.currentSession.workspace) };
    });
    assert.match(annotated.file.path, /\.png$/);
    assert.notEqual(annotated.file.path, filePath);
    assert.ok(fs.existsSync(annotated.file.path));
    assert.equal(annotated.draft[0].imageEdit, 'annotation');
    assert.match(annotated.guidance, /yan_media_generate_image/);
    assert.match(annotated.guidance, /Do not substitute Python/);
    await page.evaluate(() => setBrowserFocusMode(false));
    await page.waitForTimeout(100);
    const visibleActions = await editor.locator('.image-editor-toolbar button').evaluateAll(buttons => buttons.filter(b => b.getClientRects().length).map(b => b.dataset.action));
    assert.deepEqual(visibleActions, ['reveal','default','download','zoom']);
    assert.equal(await editor.locator('.image-editor-brush-control').isVisible(), false);
    assert.equal(await surface.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    if (process.env.YAN_ANNOTATION_SCREENSHOT) await page.screenshot({ path: process.env.YAN_ANNOTATION_SCREENSHOT.replace('.png','-compact.png') });
    await page.evaluate(() => setBrowserFocusMode(true));
    await page.waitForTimeout(80);
    assert.deepEqual(await paths.evaluateAll(nodes => nodes.map(n => n.getAttribute('d'))), snapshot);
    await button('close').click();
    if (process.env.YAN_ANNOTATION_SCREENSHOT) {
      await page.evaluate(() => applyTheme('light')); await page.waitForTimeout(150);
      await page.screenshot({ path: process.env.YAN_ANNOTATION_SCREENSHOT.replace('.png','-discard.png') });
    }
    await dialog.locator('.image-discard-confirm').click();
    await page.waitForFunction(() => !document.querySelector('#rs-image-editor').classList.contains('is-annotating'));
    assert.equal(await paths.count(), 0);
    await editor.locator('[data-action=annotate]').click(); assert.equal(await button('undo').isDisabled(), true);
    await button('close').click(); assert.equal(await dialog.isVisible(), false, 'empty annotation mode can close directly');
    await editor.locator('[data-action=erase]').click();
    assert.equal(await editor.locator('.image-editor-brush-size').getAttribute('max'), '240');
    assert.equal(await paths.count(), 0);
    await editor.locator('[data-action=erase-cancel]').click();
    await editor.locator('[data-action=annotate]').click();
    await drag([200,240],[320,260]);
    await page.locator('[data-rs-close-tab=image-editor]').click();
    assert.equal(await dialog.isVisible(), true);
    await dialog.locator('.image-discard-continue').click();
    assert.equal(await page.locator('[data-rs-close-tab=image-editor]').count(), 1); assert.equal(await paths.count(), 1);
    await page.locator('[data-rs-close-tab=image-editor]').click(); await dialog.locator('.image-discard-confirm').click();
    await page.waitForFunction(() => !document.querySelector('[data-rs-close-tab=image-editor]'));
    await page.evaluate(file => window.YanImageEditor.open({ filePath: file }), filePath);
    await editor.locator('[data-action=annotate]').click();
    // Responsive toolbar and floating menus must fit narrow sidebars.
    for (const width of [320, 414, 768]) {
      await editor.evaluate((el, width) => { el.style.width = `${width}px`; }, width);
      await page.waitForTimeout(70);
      await button('colors').click();
      assert.equal(await editor.evaluate(el => {
        const root = el.getBoundingClientRect();
        return [...el.querySelectorAll('.image-annotation-tools button, .image-annotation-palette')].every(node => {
          if (!node.getClientRects().length) return true;
          const b = node.getBoundingClientRect(); return b.left >= root.left && b.right <= root.right + 1;
        });
      }), true, `annotation toolbar overflow at ${width}px`);
      await button('colors').click();
    }
    await editor.evaluate(el => { el.style.removeProperty('width'); });
    // Visual QA with the user's reference image when supplied.
    if (process.env.YAN_ANNOTATION_SCREENSHOT) {
      await page.evaluate(file => window.YanImageEditor.open({ filePath: file }), process.env.YAN_EDITOR_IMAGE || filePath);
      await editor.locator('[data-action=annotate]').click();
      await page.evaluate(() => applyTheme('light')); await page.waitForTimeout(200);
      await color('#dc2626'); await chooseShape('arrow');
      await drag([330, 170], [450, 350]); await at([700, 480]);
      await page.screenshot({ path: process.env.YAN_ANNOTATION_SCREENSHOT });
      await button('colors').click();
      await page.screenshot({ path: process.env.YAN_ANNOTATION_SCREENSHOT.replace('.png', '-colors.png') });
      await button('shapes').click();
      await page.screenshot({ path: process.env.YAN_ANNOTATION_SCREENSHOT.replace('.png', '-shapes.png') });
      await page.evaluate(() => applyTheme('dark')); await page.waitForTimeout(200);
      await page.screenshot({ path: process.env.YAN_ANNOTATION_SCREENSHOT.replace('.png', '-dark.png') });
    }
    await page.evaluate(file => window.YanImageEditor.open({ filePath: file }), filePath);
    assert.equal(await paths.count(), 0, 'switching images resets edit history');
    await editor.locator('[data-action=annotate]').click(); assert.equal(await button('undo').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('Image annotations: partial erasure pixels, erase undo/redo, move/resize masks, new strokes, close/continue/discard/tab guards, compact toolbar, eight shapes and export passed.');
  } finally {
    await app?.close();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
