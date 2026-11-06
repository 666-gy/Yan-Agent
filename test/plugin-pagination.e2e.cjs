'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugin-pagination-'));
const output = path.join(root, 'output/playwright/plugin-pagination');
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    await app.evaluate(({ ipcMain }) => {
      const plugins = Array.from({ length: 20 }, (_, index) => ({
        id: `mock-plugin-${index + 1}`,
        name: `Mock Plugin ${String(index + 1).padStart(2, '0')}`,
        description: '分页验收用插件，验证每页固定 8 行。',
        logo: 'assets/skill-logos/office.svg',
        installed: false
      }));
      ipcMain.removeHandler('plugins:catalog');
      ipcMain.handle('plugins:catalog', () => ({ ok: true, plugins }));
    });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(() => window.YanStartupHello?.skip());
    fs.mkdirSync(output, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.evaluate(() => switchSidebarNav('packages'));
    await page.waitForFunction(() => document.querySelectorAll('#pluginMarketGrid .skill-card').length === 16);
    const rowCount = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#pluginMarketGrid .skill-card')];
      return new Set(cards.map(card => Math.round(card.getBoundingClientRect().top))).size;
    });
    assert.equal(rowCount, 8, '16 cards form eight rows at desktop width');
    const footer = await page.evaluate(() => {
      const controls = document.querySelector('#pluginPagination .plugin-pagination-controls').getBoundingClientRect();
      const panel = document.querySelector('#pagePluginPackages').getBoundingClientRect();
      const body = document.querySelector('#pagePluginPackages .page-body');
      return { gap: Math.round(panel.bottom - controls.bottom), noScroll: body.scrollHeight <= body.clientHeight + 1 };
    });
    assert.ok(footer.gap >= 8 && footer.gap <= 24, 'pager is locked to the page bottom');
    assert.equal(footer.noScroll, true, 'eight rows and footer fit without scrolling');
    assert.equal(await page.locator('#pluginPagerPages .pager-page').count(), 2, '20 plugins create two pages');
    assert.equal(await page.locator('#pluginPagerPages .pager-page.is-active').textContent(), '1');
    assert.equal(await page.locator('[data-plugin-pager="prev"]').isDisabled(), true);
    assert.equal(await page.locator('[data-plugin-pager="next"]').isEnabled(), true);
    assert.equal(await page.locator('[data-plugin-pager="go"]').isEnabled(), true);
    const centered = await page.evaluate(() => {
      const controls = document.querySelector('#pluginPagination .plugin-pagination-controls').getBoundingClientRect();
      const grid = document.querySelector('#pluginMarketGrid').getBoundingClientRect();
      return Math.abs((controls.left + controls.right) / 2 - (grid.left + grid.right) / 2) <= 1;
    });
    assert.equal(centered, true, 'pagination is centered');
    await page.screenshot({ path: path.join(output, 'market-1280.png') });
    await page.locator('[data-plugin-pager="next"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#pluginMarketGrid .skill-card').length === 4);
    assert.equal(await page.locator('#pluginPagerPages .pager-page.is-active').textContent(), '2');
    assert.equal(await page.locator('[data-plugin-pager="prev"]').isEnabled(), true);
    assert.equal(await page.locator('[data-plugin-pager="next"]').isDisabled(), true);
    const footer2 = await page.evaluate(() => {
      const controls = document.querySelector('#pluginPagination .plugin-pagination-controls').getBoundingClientRect();
      const panel = document.querySelector('#pagePluginPackages').getBoundingClientRect();
      const body = document.querySelector('#pagePluginPackages .page-body');
      return { gap: Math.round(panel.bottom - controls.bottom), noScroll: body.scrollHeight <= body.clientHeight + 1 };
    });
    assert.ok(footer2.gap >= 8 && footer2.gap <= 24, 'pager stays at the page bottom on the short page');
    assert.equal(footer2.noScroll, true, 'short page does not scroll');
    await page.locator('[data-plugin-pager="go"]').click();
    await page.locator('#pluginPageJumpDialog[open]').waitFor();
    assert.equal(await page.locator('#pluginPageJumpTitle').textContent(), '前往具体页码');
    assert.equal(await page.locator('#pluginPageJumpInput').getAttribute('placeholder'), '输入具体页码');
    await page.screenshot({ path: path.join(output, 'go-dialog.png') });
    await page.locator('#pluginPageJumpInput').fill('1');
    await page.locator('#pluginPageJumpForm .page-jump-submit').click();
    await page.waitForFunction(() => document.querySelectorAll('#pluginMarketGrid .skill-card').length === 16);
    assert.equal(await page.locator('#pluginPageJumpDialog').isVisible(), false);
    assert.equal(await page.locator('#pluginPagerPages .pager-page.is-active').textContent(), '1');
    await page.setViewportSize({ width: 720, height: 900 });
    await page.waitForFunction(() => document.querySelectorAll('#pluginMarketGrid .skill-card').length === 8);
    const footer3 = await page.evaluate(() => {
      const controls = document.querySelector('#pluginPagination .plugin-pagination-controls').getBoundingClientRect();
      const panel = document.querySelector('#pagePluginPackages').getBoundingClientRect();
      const body = document.querySelector('#pagePluginPackages .page-body');
      return { gap: Math.round(panel.bottom - controls.bottom), noScroll: body.scrollHeight <= body.clientHeight + 1 };
    });
    assert.ok(footer3.gap >= 8 && footer3.gap <= 24, 'narrow pager is locked to the page bottom');
    assert.equal(footer3.noScroll, true, 'narrow eight rows and footer fit without scrolling');
    assert.equal(await page.locator('#pluginPagerPages .pager-page').count(), 3, '20 plugins create three narrow pages');
    assert.equal(await page.locator('#pluginPagerPages .pager-page.is-active').textContent(), '1');
    assert.equal(await page.locator('#pluginPagerCurrent').textContent(), '第 1 / 3 页');
    assert.equal(await page.locator('#pluginPagerPages').evaluate(el => getComputedStyle(el).display), 'flex');
    assert.equal(await page.locator('#pluginPagerCurrent').evaluate(el => getComputedStyle(el).display), 'none');
    assert.equal(await page.locator('[data-plugin-pager="prev"]').isDisabled(), true);
    assert.equal(await page.locator('[data-plugin-pager="next"]').isEnabled(), true);
    await page.screenshot({ path: path.join(output, 'market-720.png') });
    await page.locator('[data-plugin-pager="next"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#pluginMarketGrid .skill-card').length === 8
      && document.querySelector('#pluginPagerPages .pager-page.is-active')?.textContent === '2');
    assert.equal(await page.locator('#pluginMarketGrid .skill-card-name').first().textContent(), 'Mock Plugin 09');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, desktopCards: 16, desktopRows: rowCount, narrowCards: 8, narrowPages: 3, footerGap: footer.gap, shortPageGap: footer2.gap, narrowFooterGap: footer3.gap }));
  } finally {
    await app?.close();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
