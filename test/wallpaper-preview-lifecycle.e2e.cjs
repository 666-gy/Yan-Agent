'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-wallpaper-lifecycle-'));
const video = process.env.YAN_MEMORY_VIDEO || path.join(temp, 'preview.mp4');
if (!process.env.YAN_MEMORY_VIDEO) {
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=darkgreen:s=320x180:r=10',
    '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { windowsHide: true, stdio: 'ignore' });
}
const data = path.join(temp, 'data');
fs.mkdirSync(path.join(data, 'YanData'), { recursive: true });
fs.writeFileSync(path.join(data, 'YanData', 'config.json'), JSON.stringify({
  wallpaper: { id: '', path: '', custom: [{ id: 'custom-lifecycle', name: '预览测试', path: video }] }
}));

(async () => {
  let app;
  try {
    const env = { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: data };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    const previewState = () => page.evaluate(() => {
      const v = settingsOverlay.querySelector('.wallpaper-card-video');
      return { source: v.hasAttribute('src'), ready: v.readyState, width: v.videoWidth };
    });
    assert.deepEqual(await previewState(), { source: false, ready: 0, width: 0 });
    if (process.env.YAN_MEMORY_VIDEO) {
      await new Promise(resolve => setTimeout(resolve, 22000));
      assert.deepEqual(await previewState(), { source: false, ready: 0, width: 0 });
      const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map(p => ({ pid: p.pid, type: p.type })));
      const ids = metrics.map(p => p.pid).join(',');
      const command = `Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.IDProcess -in @(${ids}) } | Select-Object IDProcess,@{n='privateWSMiB';e={[math]::Round($_.WorkingSetPrivate/1MB,1)}} | ConvertTo-Json -Compress`;
      console.log(JSON.stringify({ metrics, memory: JSON.parse(execFileSync('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true })) }));
    }
    await page.locator('#settingsBtn').click();
    assert.equal((await previewState()).source, false);
    await page.locator('#settings-tab-wallpaper').click();
    await page.waitForFunction(() => settingsOverlay.querySelector('.wallpaper-card-video').readyState >= 2);
    assert.ok((await previewState()).width > 0);
    // Leaving the page unloads the decoder; reopening loads a new preview.
    await page.locator('#settings-tab-general').click();
    assert.deepEqual(await previewState(), { source: false, ready: 0, width: 0 });
    await page.locator('#settings-tab-wallpaper').click();
    await page.waitForFunction(() => settingsOverlay.querySelector('.wallpaper-card-video').readyState >= 2);
    await page.keyboard.press('Escape');
    assert.deepEqual(await previewState(), { source: false, ready: 0, width: 0 });
    // Selecting a video wallpaper must still play after its preview is released.
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-wallpaper').click();
    await page.locator('[data-wallpaper-id="custom-lifecycle"]').click();
    await page.waitForFunction(() => state.config.wallpaper.id === 'custom-lifecycle'
      && document.querySelector('#wallpaperVideo').readyState >= 2);
    await page.keyboard.press('Escape');
    assert.deepEqual(await previewState(), { source: false, ready: 0, width: 0 });
    await page.waitForFunction(() => !document.querySelector('#wallpaperVideo').paused);
    assert.deepEqual(errors, []);
    console.log('PASS startup/general unloaded; wallpaper preview loads, releases, reopens; selected wallpaper keeps playing');
  } finally {
    await app?.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
