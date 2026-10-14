'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-wallpaper-settings-'));
const output = path.join(root, 'output/playwright/wallpaper-settings');
const launch = () => _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
  env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
(async () => {
  let app;
  try {
    for (const audible of [true, false]) {
      execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=darkgreen:s=320x180:r=10',
        ...(audible ? ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100'] : []),
        '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(audible ? ['-c:a', 'aac'] : ['-an']),
        path.join(userData, `${audible}.mp4`)], { windowsHide: true, stdio: 'ignore' });
    }
    app = await launch();
    let page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(async () => { state.config = await api.setConfig({ theme: 'light' }); applyTheme('light'); });
    await page.locator('#settingsBtn').click();
    assert.equal(await page.locator('#tab-general #wallpaperMarketGrid').count(), 0);
    await page.locator('#settings-tab-wallpaper').click();
    await page.locator('#tab-wallpaper #wallpaperMarketGrid').waitFor();
    await page.locator('[data-wallpaper-id="night-sky"]').click();
    await page.waitForFunction(() => state.config.wallpaper.id === 'night-sky' && document.documentElement.dataset.theme === 'dark');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'wallpaper-tab.png') });
    await page.locator('#settings-tab-logo').click();
    assert.equal(await page.locator('[data-theme-choice="dark"]').getAttribute('aria-checked'), 'true');
    await page.locator('[data-theme-choice="light"]').click();
    await page.waitForFunction(() => state.config.theme === 'light' && document.documentElement.dataset.theme === 'light');
    assert.equal(await page.locator('[data-theme-choice="light"]').getAttribute('aria-checked'), 'true');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('[data-theme-choice="system"]').click();
    await page.waitForFunction(() => state.config.theme === 'system' && document.documentElement.dataset.theme === 'light');
    await page.locator('[data-theme-choice="light"]').click();
    await page.waitForFunction(() => state.config.theme === 'light');
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-wallpaper').click();
    await page.locator('[data-wallpaper-id="night-sky"]').click();
    await page.waitForFunction(() => !state.config.wallpaper.id && document.documentElement.dataset.theme === 'light');
    for (const audible of [true, false]) {
      await page.locator('#customWallpaperCard').click();
      await page.locator('#wallpaperAddFile').setInputFiles(path.join(userData, `${audible}.mp4`));
      await page.locator('#wallpaperAddNext').click();
      await page.locator('#wallpaperAddName').fill(audible ? '带音轨验证' : '无音轨验证');
      await page.locator('#wallpaperAddNext').click();
      await page.waitForFunction(() => document.querySelector('#wallpaperVideo').currentTime > 0);
      // Persisting a legacy nonzero volume must never enable wallpaper sound.
      const result = await page.evaluate(async () => {
        state.config = await api.setConfig({ wallpaper: { ...state.config.wallpaper, volume: 0.85 } });
        applyWallpaperConfig(state.config);
        const video = document.querySelector('#wallpaperVideo');
        return { saved: state.config.wallpaper.volume, muted: video.muted, volume: video.volume,
          theme: document.documentElement.dataset.theme, previewsMuted: [...document.querySelectorAll('.wallpaper-card-video')].every(v => v.muted) };
      });
      assert.deepEqual(result, { saved: 0, muted: true, volume: 0, theme: 'dark', previewsMuted: true });
      assert.equal(await page.locator('#wallpaperVolumeControl').count(), 0);
      await page.locator('#settings-tab-logo').click();
      assert.equal(await page.locator('[data-theme-choice="dark"]').getAttribute('aria-checked'), 'true');
      await page.locator('[data-theme-choice="light"]').click();
      await page.waitForFunction(() => state.config.theme === 'light' && document.documentElement.dataset.theme === 'light');
      await page.locator('#settings-tab-wallpaper').click();
    }
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__ && document.querySelector('#wallpaperVideo').currentTime > 0);
    assert.deepEqual(await page.evaluate(() => ({ theme: document.documentElement.dataset.theme,
      muted: document.querySelector('#wallpaperVideo').muted, volume: document.querySelector('#wallpaperVideo').volume })),
    { theme: 'light', muted: true, volume: 0 });
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-logo').click();
    assert.equal(await page.locator('[data-theme-choice="light"]').getAttribute('aria-checked'), 'true');
    await page.screenshot({ path: path.join(output, 'wallpaper-light-theme.png') });
    console.log('Wallpaper defaults to dark with synced selection; light/system override, reload/restart persistence and forced mute passed.');
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
