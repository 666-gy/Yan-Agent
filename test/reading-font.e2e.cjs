'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-reading-font-e2e-'));

async function launch() {
  return electron.launch({
    executablePath: require('electron'),
    args: [appRoot],
    cwd: appRoot,
    env: {
      ...process.env,
      YAN_E2E_MODE: '1',
      YAN_E2E_USER_DATA_DIR: userDataDir
    }
  });
}

async function waitForRendererReady(page) {
  await page.waitForFunction(() => (
    document.readyState === 'complete'
      && typeof yan !== 'undefined'
      && document.documentElement.dataset.readingFont
  ));
}

const readBrandFont = page => page.evaluate(() => (
  getComputedStyle(document.querySelector('.sidebar-brand-name')).fontFamily
));

(async () => {
  let application;
  try {
    application = await launch();
    let page = await application.firstWindow();
    await waitForRendererReady(page);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.readingFont), 'serif');
    const serifStack = await readBrandFont(page);
    assert.match(serifStack, /Yan Reading Serif/);
    const fonts = await page.evaluate(async () => {
      const report=[];
      for (const weight of [400,600,700]) {
        const faces=await document.fonts.load(`${weight} 15px "Yan Reading Serif"`, '找到了：你的桌面被重定向缓存命中');
        report.push({weight,count:faces.length,status:faces[0]?.status});
      }
      const sample=document.createElement('div');sample.className='msg assistant';sample.id='reading-font-proof';
      sample.style.cssText='position:fixed;top:100px;left:80px;right:80px;z-index:99999;padding:28px;background:#fafafa;color:#222';
      sample.innerHTML='<div class="msg-body"><div class="msg-round" style="color:#222"><p>找到了：你的桌面被重定向到了 E:\\Desktop。缓存命中，输入速度。</p><p><strong>已不存在——是死快捷方式。先删掉它，再对全系统做一次重新彻查。</strong></p><p>新建一个 <code>mcp-installer</code> Skill，复用已有的工具。</p></div></div>';
      document.body.append(sample);
      return report;
    });
    for(const font of fonts){assert.ok(font.count>0);assert.equal(font.status,'loaded');}
    const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
    const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#reading-font-proof strong'});
    const platformFonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
    assert.ok(platformFonts.fonts.some(f=>f.isCustomFont&&f.glyphCount>0),'Chinese glyphs must come from bundled font');
    assert.ok(platformFonts.fonts.every(f=>f.isCustomFont),'sample must not fall back to installed fonts');
    fs.mkdirSync(path.join(appRoot,'output/font'),{recursive:true});
    await page.locator('#reading-font-proof').screenshot({path:path.join(appRoot,'output/font/bundled-serif.png')});
    await page.evaluate(()=>document.getElementById('reading-font-proof').remove());
    assert.match(serifStack, /Charter|Georgia|serif/i, `default reading stack must stay serif, saw ${serifStack}`);

    await page.locator('#settingsBtn').click();
    await page.locator('[data-tab="general"]').click();
    await page.locator('#readingFontSegmented [data-reading-font="sans"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.readingFont === 'sans');
    const sansStack = await readBrandFont(page);
    assert.match(sansStack, /Segoe UI|Microsoft YaHei|system-ui/i, `sans option must swap to the UI stack, saw ${sansStack}`);
    const saved = await page.evaluate(() => yan.getConfig());
    assert.equal(saved.readingFont, 'sans');

    await page.reload();
    await waitForRendererReady(page);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.readingFont), 'sans');
    assert.match(await readBrandFont(page), /Segoe UI|Microsoft YaHei|system-ui/i);
    await page.locator('#settingsBtn').click();
    await page.locator('[data-tab="general"]').click();
    assert.equal(await page.locator('#readingFontSegmented [data-reading-font="sans"]').getAttribute('aria-checked'), 'true');

    await application.close();
    application = null;

    application = await launch();
    page = await application.firstWindow();
    await waitForRendererReady(page);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.readingFont), 'sans');
    console.log(JSON.stringify({ ok: true, readingFont: 'sans', persistedAcrossRestart: true, serifStack, sansStack }));
  } finally {
    await application?.close().catch(() => {});
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
