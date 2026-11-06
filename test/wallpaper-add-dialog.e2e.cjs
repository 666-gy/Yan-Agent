const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-wallpaper-dialog-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
fs.writeFileSync(path.join(temp, 'preview.png'), png);
execFileSync('ffmpeg', ['-y','-f','lavfi','-i','color=c=darkgreen:s=320x180:r=10','-t','1','-c:v','libx264','-pix_fmt','yuv420p',path.join(temp,'preview.mp4')], {windowsHide:true,stdio:'ignore'});
(async () => {
 let app;
 try {
  app = await electron.launch({executablePath:require('electron'),args:[root],cwd:root,env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:path.join(temp,'data')}});
  const page = await app.firstWindow(); await page.waitForFunction(() => window.__YAN_APP_READY__);
  await page.locator('#settingsBtn').click(); await page.locator('#settings-tab-wallpaper').click(); await page.locator('#customWallpaperCard').click();
  await page.locator('#wallpaperAddFile').setInputFiles(path.join(temp,'preview.png'));
  await page.waitForFunction(() => document.querySelector('#wallpaperAddMedia img')?.naturalWidth > 0);
  await page.locator('#wallpaperAddCancel').click();
  assert.equal(await page.locator('#wallpaperAddMedia img').count(),0);
  await page.locator('#customWallpaperCard').click();
  await page.locator('#wallpaperAddPreview').evaluate((node, bytes) => {
   const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], 'dropped.png', {type:'image/png'}));
   node.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
  }, [...png]);
  await page.waitForFunction(() => document.querySelector('#wallpaperAddMedia img')?.naturalWidth > 0);
  await page.locator('#wallpaperAddFile').setInputFiles(path.join(temp,'preview.mp4'));
  await page.waitForFunction(() => document.querySelector('#wallpaperAddMedia video')?.currentTime > 0);
  assert.equal(await page.locator('#wallpaperAddMedia video').evaluate(video=>video.muted),true);
  await page.locator('#wallpaperAddName').fill('预览壁纸');
  const centered = await page.locator('#wallpaperAddDialog').evaluate(node => { const r = node.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2; });
  assert.equal(centered, true);
  await page.screenshot({path:path.join(temp,'wallpaper-dialog.png')});
  await page.locator('#wallpaperAddNext').click();
  await page.waitForFunction(() => !document.querySelector('#wallpaperAddDialog').open && state.config.wallpaper.name === '预览壁纸');
  assert.equal(await page.locator('#wallpaperAddMedia video').count(),0);
  console.log('PASS image/video preview, drag/drop, cancel cleanup, confirm save; '+path.join(temp,'wallpaper-dialog.png'));
 } finally {await app?.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
