'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-image-text-'));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && state.currentSession && window.YanImageEditor);
    const filePath = path.join(profile, 'text.png'), savedPath = path.join(profile, 'saved.png');
    const base64 = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 600;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#f3f5f8'; ctx.fillRect(0,0,900,600);
      return c.toDataURL().split(',')[1];
    });
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, savedPath);
    await page.evaluate(file => window.YanImageEditor.open({ filePath: file }), filePath);
    const editor = page.locator('#rs-image-editor'), surface = editor.locator('.image-editor-annotations');
    const button = name => editor.locator(`[data-annotation="${name}"]`);
    const input = editor.locator('.image-annotation-text-input'), texts = editor.locator('.image-annotation-art [data-type="text"]');
    const coord = async (x,y) => { const b = await surface.boundingBox(); return { x:b.x+x*b.width/900, y:b.y+y*b.height/600 }; };
    const click = async (x,y) => { const p = await coord(x,y); await page.mouse.click(p.x,p.y); };
    const drag = async (x,y,dx,dy) => { const p = await coord(x,y), q = await coord(x+dx,y+dy); await page.mouse.move(p.x,p.y); await page.mouse.down(); await page.mouse.move(q.x,q.y,{steps:5}); await page.mouse.up(); };
    const resize = async (name,dx,dy) => {
      const h = await editor.locator(`circle[data-handle="${name}"]`).boundingBox();
      await page.mouse.move(h.x+h.width/2,h.y+h.height/2); await page.mouse.down(); await page.mouse.move(h.x+h.width/2+dx,h.y+h.height/2+dy,{steps:4}); await page.mouse.up();
    };
    await editor.locator('[data-action=annotate]').click(); await button('text').click(); await click(150,160);
    assert.equal(await input.isVisible(), true); assert.equal(await input.evaluate(el=>document.activeElement===el), true);
    assert.equal(await editor.locator('circle[data-handle]').count(), 8);
    const emptyBefore = await input.boundingBox();
    await resize('e',45,0);
    assert.equal(await input.isVisible(), true);
    assert.ok((await input.boundingBox()).width > emptyBefore.width+30);
    await click(700,500);
    assert.equal(await input.count(),0); assert.equal(await texts.count(),0);
    assert.equal(await button('select').getAttribute('aria-pressed'),'true');
    assert.equal(await button('undo').isDisabled(),true,'empty text must not create a history entry');
    await button('text').click(); await click(170,160);
    await input.fill('标注文字\nHello Yan');
    for (const [name,dx,dy] of [['n',0,-12],['e',20,0],['s',0,14],['w',-18,0],['nw',-10,-10],['ne',10,-10],['se',10,10],['sw',-10,10]]) {
      const before = await input.boundingBox();
      await resize(name,dx,dy);
      const after = await input.boundingBox();
      assert.equal(await input.isVisible(),true,`${name} must retain the editing input`);
      assert.ok(after.width>before.width+4 || after.height>before.height+4,`${name} must resize the box`);
      assert.equal(await input.inputValue(),'标注文字\nHello Yan');
    }
    // Resizing also works between the midpoint handles along the border.
    const edge = await editor.locator('line[data-handle="s"]').boundingBox();
    await page.mouse.move(edge.x+edge.width*.3,edge.y+edge.height/2); await page.mouse.down();
    await page.mouse.move(edge.x+edge.width*.3,edge.y+edge.height/2+20); await page.mouse.up();
    assert.equal(await input.isVisible(),true);
    await input.press('End'); await input.press('!');
    assert.equal(await input.inputValue(),'标注文字\nHello Yan!');
    if (process.env.YAN_TEXT_SCREENSHOT) await page.screenshot({path:process.env.YAN_TEXT_SCREENSHOT});
    await click(750,480);
    assert.equal(await input.count(),0); assert.equal(await texts.count(),1);
    assert.equal(await button('select').getAttribute('aria-pressed'),'true');
    assert.equal(await texts.first().textContent(),'标注文字Hello Yan!');
    await button('undo').click(); assert.equal(await texts.count(),0);
    await button('redo').click(); assert.equal(await texts.count(),1);
    // Select and drag the completed object, then resize it again.
    await drag(210,190,55,20);
    assert.equal(await editor.locator('circle[data-handle]').count(),8);
    const beforeScale = await texts.first().locator('g').getAttribute('transform');
    await resize('se',40,25);
    assert.notEqual(await texts.first().locator('g').getAttribute('transform'),beforeScale);
    assert.equal(await input.count(),0,'completed text should remain a movable object');
    // Double-click supports correcting text. Literal markup stays plain text.
    const loc = await coord(290,220); await page.mouse.dblclick(loc.x,loc.y);
    assert.equal(await input.isVisible(),true);
    await input.fill('第二次编辑 <svg>\n🙂 Hello Yan');
    await input.press('Control+Enter');
    assert.equal(await input.count(),0);
    assert.ok((await texts.first().textContent()).includes('<svg>'));
    assert.equal(await texts.first().locator('svg').count(),0);
    // Clear an existing text object and click away: it is actually removed.
    await page.mouse.dblclick(loc.x,loc.y); await input.fill('   \n'); await click(750,480);
    assert.equal(await texts.count(),0);
    await button('undo').click(); assert.equal(await texts.count(),1);
    // Export while typing must commit and draw the text into the saved PNG.
    await page.mouse.dblclick(loc.x,loc.y); await input.fill('保存文字\nExported text');
    await editor.locator('[data-action=download]').click();
    await page.waitForFunction(()=>!document.querySelector('#rs-image-editor [data-action=download]').disabled && document.querySelector('#toast')?.textContent==='图片已保存');
    assert.equal(await input.count(),0);
    const pixels = await page.evaluate(async file => {
      const result = await api.readImageFile(file), image = new Image(); image.src=result.dataUrl; await image.decode();
      const c=document.createElement('canvas'); c.width=image.width; c.height=image.height;
      const ctx=c.getContext('2d'); ctx.drawImage(image,0,0);
      const data=ctx.getImageData(0,0,c.width,c.height).data; let marked=0;
      for(let i=0;i<data.length;i+=4) if(data[i]!==243 || data[i+1]!==245 || data[i+2]!==248) marked++;
      return {width:c.width,height:c.height,marked};
    },savedPath);
    assert.equal(pixels.width,900); assert.equal(pixels.height,600); assert.ok(pixels.marked>500);
    assert.equal(fs.readFileSync(filePath).toString('base64'),base64);
    // Zoom preserves text and hit targets; compact preview commits the active input.
    await editor.locator('[data-action=zoom]').click(); await editor.locator('[data-menu-action="zoom:0.5"]').click();
    const zoomLoc=await coord(290,220); await page.mouse.dblclick(zoomLoc.x,zoomLoc.y);
    assert.equal(await input.isVisible(),true);
    await input.fill('缩放后继续输入');
    await page.evaluate(()=>setBrowserFocusMode(false)); await page.waitForTimeout(100);
    assert.equal(await input.count(),0); assert.equal(await texts.first().textContent(),'缩放后继续输入');
    await page.evaluate(()=>setBrowserFocusMode(true)); await page.waitForTimeout(100);
    await button('close').click();
    const dialog=editor.locator('.image-editor-discard'); assert.equal(await dialog.isVisible(),true);
    await dialog.locator('.image-discard-continue').click(); assert.equal(await texts.count(),1);
    if (process.env.YAN_TEXT_SCREENSHOT) {
      await page.evaluate(()=>applyTheme('light')); await page.waitForTimeout(150);
      await page.screenshot({path:process.env.YAN_TEXT_SCREENSHOT.replace('.png','-finished.png')});
    }
    await button('close').click(); await dialog.locator('.image-discard-confirm').click();
    await page.waitForFunction(()=>!document.querySelector('#rs-image-editor').classList.contains('is-annotating'));
    assert.equal(await texts.count(),0);
    assert.deepEqual(errors,[]);
    console.log('Image text: placement/focus, eight resize handles and edges, empty dismissal, commit/move/resize, re-edit, Unicode/literal text, undo/redo, export, zoom and discard passed.');
  } finally {
    await app?.close();
    try { fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}); } catch {}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
