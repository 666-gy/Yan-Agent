'use strict';
const assert = require('node:assert/strict');

module.exports = async function checkBundledWallpapers(page, screenshotPath) {
  assert.deepEqual(await page.evaluate(() => Object.keys(WALLPAPER_LIBRARY)), ['night-sky', 'rainy-architecture']);
  await page.locator('#settings-tab-wallpaper').click();
  assert.equal(await page.locator('#wallpaperMarketGrid [data-wallpaper-id]').count(), 2);
  await page.waitForFunction(() => [...document.querySelectorAll('#wallpaperMarketGrid img')].every(img => img.complete && img.naturalWidth > 0));
  const migrated = await page.evaluate(async () => {
    const custom = [{ id: 'custom-preserved', path: 'C:/wallpapers/user-image.jpg', name: 'User image' }];
    const out = [];
    for (const id of ['sword-and-sakura', 'chinese-garden', 'dark-side-of-moon', 'side-glance', 'deep-cave']) {
      const config = await yan.setConfig({ wallpaper: { id, removed: [id], custom } });
      out.push({ id: config.wallpaper.id, removed: config.wallpaper.removed, custom: config.wallpaper.custom });
    }
    state.config = await yan.setConfig({ wallpaper: { id: '', removed: [], custom: [] } });
    applyWallpaperConfig(state.config);
    return out;
  });
  for (const entry of migrated) {
    assert.equal(entry.id, '');
    assert.deepEqual(entry.removed, []);
    assert.equal(entry.custom[0].id, 'custom-preserved');
  }
  await page.locator('[data-wallpaper-id="night-sky"]').click();
  await page.waitForFunction(() => state.config.wallpaper.id === 'night-sky');
  const imageSize = await page.evaluate(async () => {
    const img = new Image();
    img.src = wallpaperSource(state.config.wallpaper);
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight, background: document.querySelector('#wallpaperLayer').style.backgroundImage };
  });
  assert.equal(imageSize.width, 6000);
  assert.equal(imageSize.height, 3376);
  assert.match(imageSize.background, /url\(/);
  await page.locator('[data-wallpaper-id="rainy-architecture"]').click();
  await page.waitForFunction(() => {
    const v = document.querySelector('#wallpaperVideo');
    return state.config.wallpaper.id === 'rainy-architecture' && v.readyState >= 2 && v.currentTime > 0.2 && !v.paused;
  }, null, { timeout: 30000 });
  const readVideo = () => page.evaluate(() => {
    const v = document.querySelector('#wallpaperVideo');
    return { width: v.videoWidth, height: v.videoHeight, duration: v.duration, muted: v.muted, volume: v.volume, loop: v.loop, error: v.error?.code || null };
  });
  const video = await readVideo();
  assert.deepEqual(video, { width: 3840, height: 2160, duration: 10, muted: true, volume: 0, loop: true, error: null });
  await page.screenshot({ path: screenshotPath });
  await page.reload();
  await page.waitForFunction(() => window.__YAN_APP_READY__ && state.config.wallpaper.id === 'rainy-architecture' && document.querySelector('#wallpaperVideo').currentTime > 0.2);
  assert.deepEqual(await readVideo(), video);
  await page.locator('#settingsBtn').click();
  await page.locator('#settings-tab-wallpaper').click();
  await page.locator('[data-wallpaper-id="rainy-architecture"]').click();
  await page.waitForFunction(() => !state.config.wallpaper.id && !document.querySelector('#wallpaperVideo').getAttribute('src'));
  return { builtIns: ['night-sky', 'rainy-architecture'], imageSize, video, reloadPersistence: true, retiredSelectionsCleared: 5, customEntriesPreserved: true };
};
