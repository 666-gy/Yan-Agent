'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-theme-compat-'));
const output = path.join(root, 'output', 'theme-compat');

// Computed colors arrive as rgba(...) for theme tokens and as color(srgb … / a)
// for the color-mix materials, so read the alpha from either serialization.
const alphaOf = value => {
  const text = String(value || '').trim();
  const rgba = text.match(/^rgba\([^)]*,\s*([0-9.]+)\)$/);
  if (rgba) return Number(rgba[1]);
  const slash = text.match(/\/\s*([0-9.]+)\s*\)\s*$/);
  if (slash) return Number(slash[1]);
  return text === 'transparent' ? 0 : 1;
};

(async () => {
  let app;
  try {
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData }
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    fs.mkdirSync(output, { recursive: true });

    await page.evaluate(() => {
      appendMessage('user', '帮我把这个页面的主题和壁纸搭得更协调一点。', [], false, 0, Date.now() - 60000, 0, null, [], null);
      appendMessage('assistant', '已经为壁纸接入了材质分层：侧栏与标题栏是玻璃，内容面保持可读，浮层维持实底。', [], false, 0, Date.now(), 1200, null, [], null);
    });

    const metrics = await page.evaluate(async () => {
      const out = {};
      for (const [id, entry] of Object.entries(WALLPAPER_LIBRARY)) {
        out[id] = await yan.wallpaperAnalyze(`assets/wallpapers/${encodeURIComponent(entry.file)}`);
      }
      return out;
    });
    for (const [id, value] of Object.entries(metrics)) {
      assert.equal(value?.ok, true, `${id} analysis ok`);
      assert.ok(Number.isFinite(value.luma), `${id} luma`);
    }

    const setWallpaper = async id => {
      await page.evaluate(async wallpaperId => {
        state.config = await yan.setConfig({
          wallpaper: { id: wallpaperId, path: '', name: '', custom: [], removed: [], opacity: 0.85 }
        });
        applyWallpaperConfig(state.config);
      }, id);
      if (!id) {
        await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('wallpaper-compat'));
        return;
      }
      const file = await page.evaluate(wallpaperId => WALLPAPER_LIBRARY[wallpaperId].file, id);
      await page.waitForFunction(source => document.documentElement.dataset.wallCompatSource === source, `assets/wallpapers/${encodeURIComponent(file)}`);
      await page.waitForTimeout(80);
    };

    const readCompat = () => page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const sidebar = getComputedStyle(document.querySelector('.sidebar'));
      const main = getComputedStyle(document.querySelector('.main'));
      const composer = getComputedStyle(document.querySelector('.composer'));
      const switcher = getComputedStyle(document.querySelector('.window-view-switcher'));
      const activePill = getComputedStyle(document.querySelector('.window-view-option.active'));
      const taskBar = getComputedStyle(document.querySelector('.task-bar'));
      const actionsMenu = getComputedStyle(document.querySelector('.task-actions-menu'));
      return {
        classOn: document.getElementById('app').classList.contains('wallpaper-compat'),
        scrim: rootStyle.getPropertyValue('--wall-scrim').trim(),
        matChrome: rootStyle.getPropertyValue('--mat-chrome').trim(),
        matPanel: rootStyle.getPropertyValue('--mat-panel').trim(),
        matFloat: rootStyle.getPropertyValue('--mat-float').trim(),
        blur: rootStyle.getPropertyValue('--mat-blur').trim(),
        accentInline: document.documentElement.style.getPropertyValue('--accent').trim(),
        sidebarBg: sidebar.backgroundColor,
        sidebarBlur: sidebar.backdropFilter,
        mainBg: main.backgroundColor,
        composerBg: composer.backgroundColor,
        switcherBg: switcher.backgroundColor,
        switcherBlur: switcher.backdropFilter,
        activePillBg: activePill.backgroundColor,
        taskBarBg: taskBar.backgroundColor,
        actionsMenuBg: actionsMenu.backgroundColor
      };
    });

    const setTheme = theme => page.evaluate(async nextTheme => {
      state.config = await yan.setConfig({ theme: nextTheme });
      applyTheme(nextTheme);
    }, theme);

    // --- dark theme + dark wallpaper ---
    await setTheme('dark');
    await setWallpaper('deep-cave');
    let compat = await readCompat();
    assert.equal(compat.classOn, true, 'compat class engages with a wallpaper');
    assert.ok(compat.scrim.startsWith('rgba(10, 10, 11'), `dark scrim color: ${compat.scrim}`);
    assert.ok(alphaOf(compat.scrim) > 0.04 && alphaOf(compat.scrim) < 0.6, `scrim alpha: ${compat.scrim}`);
    assert.ok(compat.sidebarBg.startsWith('rgba(') && alphaOf(compat.sidebarBg) < 1, `chrome material: ${compat.sidebarBg}`);
    assert.ok(compat.sidebarBlur.includes('blur('), `chrome blur: ${compat.sidebarBlur}`);
    assert.ok(compat.mainBg.startsWith('rgba(') && alphaOf(compat.mainBg) < 1, `panel material: ${compat.mainBg}`);
    assert.ok(alphaOf(compat.matFloat) > alphaOf(compat.matPanel), 'floating material is more opaque than panels');
    // The task bar and the view pills must not stay opaque islands on the photo.
    assert.equal(alphaOf(compat.taskBarBg), 0, `task bar dissolves into the panel: ${compat.taskBarBg}`);
    assert.ok(alphaOf(compat.switcherBg) > 0 && alphaOf(compat.switcherBg) < 0.4, `view pill group is an ink wash: ${compat.switcherBg}`);
    assert.ok(compat.switcherBlur.includes('blur('), `view pill group keeps the frost: ${compat.switcherBlur}`);
    assert.ok(alphaOf(compat.activePillBg) < 0.5, `active view pill stays translucent: ${compat.activePillBg}`);
    // Floating menus inside the task bar keep their own opaque surface.
    assert.equal(alphaOf(compat.actionsMenuBg), 1, `task menu stays opaque: ${compat.actionsMenuBg}`);
    await page.screenshot({ path: path.join(output, 'dark-deep-cave.png') });

    // --- light theme + dark wallpaper (the hard case) ---
    await setTheme('light');
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--wall-scrim').startsWith('rgba(252'));
    compat = await readCompat();
    assert.ok(compat.scrim.startsWith('rgba(252, 251, 248'), `light scrim color: ${compat.scrim}`);
    await page.screenshot({ path: path.join(output, 'light-deep-cave.png') });

    // --- light theme + colorful wallpaper (accent follow) ---
    await setWallpaper('sword-and-sakura');
    compat = await readCompat();
    assert.ok(compat.accentInline.startsWith('hsl('), `accent follows wallpaper: ${compat.accentInline}`);
    await page.screenshot({ path: path.join(output, 'light-sword-and-sakura.png') });

    const derived = await page.evaluate(() => ({
      light: deriveWallpaperCompat({
        metrics: { luma: 0.5, hue: 200, sat: 0.5 },
        theme: 'light',
        autoAdapt: true,
        materialStrength: 0.6,
        accentFollow: true
      }),
      darkBright: deriveWallpaperCompat({
        metrics: { luma: 0.85, hue: -1, sat: 0 },
        theme: 'dark',
        autoAdapt: true,
        materialStrength: 0.6,
        accentFollow: true
      }),
      darkDim: deriveWallpaperCompat({
        metrics: { luma: 0.05, hue: -1, sat: 0 },
        theme: 'dark',
        autoAdapt: true,
        materialStrength: 0.6,
        accentFollow: true
      })
    }));
    assert.ok(derived.light.vars['--accent'].startsWith('hsl(200'), `derived accent hue: ${derived.light.vars['--accent']}`);
    assert.ok(
      alphaOf(derived.darkBright.vars['--wall-scrim']) > alphaOf(derived.darkDim.vars['--wall-scrim']) + 0.2,
      `auto-adapt scrims: bright=${derived.darkBright.vars['--wall-scrim']} dim=${derived.darkDim.vars['--wall-scrim']}`
    );

    // --- settings surface materials + the new controls ---
    await page.evaluate(() => openSettings('general'));
    await page.waitForSelector('#wallpaperMarketGrid', { timeout: 5000 });
    await page.evaluate(() => document.querySelector('.wallpaper-market-section')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    const settingsCompat = await page.evaluate(() => {
      const layer = document.querySelector('.settings-page-layer');
      const style = getComputedStyle(layer);
      const strength = document.querySelector('#wallpaperMaterialStrength');
      return {
        layerBg: style.backgroundColor,
        strength: strength ? strength.value : null,
        legacyOpacity: !!document.querySelector('#wallpaperOpacity'),
        autoToggle: !!document.querySelector('#wallpaperAutoAdapt'),
        accentToggle: !!document.querySelector('#wallpaperAccentFollow'),
        legacyAdaptBar: !!document.querySelector('.wallpaper-adapt-bar')
      };
    });
    assert.ok(settingsCompat.layerBg.startsWith('rgba(') && alphaOf(settingsCompat.layerBg) < 1, `settings material: ${settingsCompat.layerBg}`);
    assert.equal(settingsCompat.strength, '0.45');
    assert.equal(settingsCompat.legacyOpacity, false, 'opacity slider removed');
    assert.equal(settingsCompat.autoToggle, false, 'auto-adapt toggle removed');
    assert.equal(settingsCompat.accentToggle, false, 'accent toggle removed');
    assert.equal(settingsCompat.legacyAdaptBar, false, 'adapt bar removed');
    await page.screenshot({ path: path.join(output, 'settings-light-sword-and-sakura.png') });

    // --- the real settings controls drive the system ---
    const strengthSlider = page.locator('#wallpaperMaterialStrength');
    await strengthSlider.focus();
    await page.keyboard.press('End');
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--mat-blur').trim() === '26px');
    await page.keyboard.press('Home');
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--mat-blur').trim() === '0px');
    for (let step = 0; step < 9; step += 1) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--mat-blur').trim() === '12px');
    await page.waitForFunction(async () => (await yan.getConfig()).themeCompat.materialStrength === 0.45);
    assert.equal(
      await page.evaluate(() => document.querySelector('#wallpaperMaterialStrengthValue')?.textContent),
      '45%'
    );

    // opacity is locked at 100% and the toggles are gone: stored values are forced back
    await page.evaluate(async () => {
      state.config = await yan.setConfig({
        wallpaper: { opacity: 0.15 },
        themeCompat: { autoAdapt: false, accentFollow: false }
      });
      applyWallpaperConfig(state.config);
    });
    await page.waitForFunction(() => document.querySelector('#wallpaperLayer')?.style.getPropertyValue('--wallpaper-opacity') === '1');
    const locked = await page.evaluate(async () => yan.getConfig());
    assert.equal(locked.wallpaper.opacity, 1, 'wallpaper opacity locked at 100%');
    assert.equal(locked.themeCompat.autoAdapt, true, 'auto-adapt permanently on');
    assert.equal(locked.themeCompat.accentFollow, true, 'accent-follow permanently on');
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--accent').startsWith('hsl('));
    await page.evaluate(() => closeSettings());

    // --- user-case comparison: light theme + misty garden at two strengths ---
    await setWallpaper('chinese-garden');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(output, 'light-chinese-garden-45.png') });
    await page.evaluate(async () => {
      state.config = await yan.setConfig({ themeCompat: { materialStrength: 0.1 } });
      applyWallpaperConfig(state.config);
    });
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--mat-blur').trim() === '3px');
    await page.screenshot({ path: path.join(output, 'light-chinese-garden-10.png') });
    await page.evaluate(async () => {
      state.config = await yan.setConfig({ themeCompat: { materialStrength: 0.45 } });
      applyWallpaperConfig(state.config);
    });

    // --- no wallpaper: compat clears and surfaces return to the theme's opaque tokens ---
    await setWallpaper('');
    compat = await readCompat();
    assert.equal(compat.classOn, false);
    assert.equal(compat.scrim, '');
    assert.equal(alphaOf(compat.sidebarBg), 1, `sidebar opaque again: ${compat.sidebarBg}`);
    assert.equal(alphaOf(compat.taskBarBg), 1, `task bar opaque again: ${compat.taskBarBg}`);
    assert.equal(alphaOf(compat.switcherBg), 1, `view pills opaque again: ${compat.switcherBg}`);
    await setTheme('dark');
    await page.screenshot({ path: path.join(output, 'no-wallpaper-dark.png') });

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      ok: true,
      metrics,
      darkScrim: 'rgba(10, 10, 11)',
      lightScrim: 'rgba(252, 251, 248)',
      strengthRange: ['0px', '12px', '26px'],
      controlsDriven: true,
      opacityLocked: true,
      togglesRemoved: true,
      noWallpaperOpaque: true,
      errors
    }));
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
