'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugin-source-'));
const output = path.join(root, 'output/playwright/plugin-source-tabs');
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(() => window.YanStartupHello?.skip());
    fs.mkdirSync(output, { recursive: true });
    const openPlugins = async () => {
      await page.evaluate(() => switchSidebarNav('packages'));
      await page.waitForFunction(() => document.querySelectorAll('#pluginMarketGrid .skill-card').length > 0);
    };
    await openPlugins();
    await page.waitForTimeout(450);
    assert.equal(await page.locator('#pluginSourceSwitch [data-plugin-source="market"]').getAttribute('aria-selected'), 'true');
    const names = await page.locator('#pluginMarketGrid .skill-card-name').allTextContents();
    assert.ok(names.includes('Office') && names.includes('Remotion'), 'market tab lists catalog plugins');
    assert.ok(names.includes('Yan Computer Use'), 'market tab also shows installed plugins');
    const layout = await page.evaluate(() => {
      const box = s => document.querySelector(s).getBoundingClientRect();
      const header = box('#pagePluginPackages .capability-page-header'), grid = box('#pluginMarketGrid');
      const row = box('#pagePluginPackages .skill-source-row'), pill = box('#pluginSourceSwitch');
      return {
        aligned: Math.abs(header.left - grid.left) <= 1 && Math.abs(header.right - grid.right) <= 1,
        centered: Math.abs((row.left + row.right) / 2 - (pill.left + pill.right) / 2) <= 1,
        lowered: box('#pagePluginPackages .capability-page-header h2').top > 60,
        cardRadius: getComputedStyle(document.querySelector('#pluginMarketGrid .skill-card')).borderRadius,
        cardBg: getComputedStyle(document.querySelector('#pluginMarketGrid .skill-card')).backgroundColor,
        cardBorder: getComputedStyle(document.querySelector('#pluginMarketGrid .skill-card')).borderTopWidth,
        logoRadius: getComputedStyle(document.querySelector('#pluginMarketGrid .skill-card-logo')).borderRadius,
        columns: getComputedStyle(document.querySelector('#pluginMarketGrid .skill-installed-list')).gridTemplateColumns.split(' ').length,
        buttonSize: getComputedStyle(document.querySelector('#pluginMarketGrid .skill-card .capability-circle-btn')).width
      };
    });
    assert.deepEqual({ aligned: layout.aligned, centered: layout.centered, lowered: layout.lowered },
      { aligned: true, centered: true, lowered: true });
    assert.equal(layout.cardRadius, '0px', 'plugin card hover fill is rectangular');
    assert.equal(layout.cardBg, 'rgba(0, 0, 0, 0)', 'plugin card has no background');
    assert.equal(layout.cardBorder, '0px', 'plugin card has no border');
    assert.equal(layout.logoRadius, '50%', 'plugin logo is circular');
    assert.equal(layout.columns, 2, 'plugin cards fill two columns per row');
    assert.equal(layout.buttonSize, '32px', 'card action buttons keep their size');
    assert.equal(await page.locator('#pagePluginPackages .capability-page-header').evaluate(el => getComputedStyle(el).borderBottomWidth), '0px');
    assert.equal(await page.locator('#pluginPagination').isVisible(), false, 'single-page catalog hides pagination');
    assert.equal(await page.locator('#pluginPagination').evaluate(el => el.classList.contains('hidden')), true);
    for (const width of [1600, 900, 720]) {
      await page.setViewportSize({ width, height: 900 });
      const fit = await page.evaluate(() => {
        const box = s => document.querySelector(s).getBoundingClientRect();
        const header = box('#pagePluginPackages .capability-page-header'), grid = box('#pluginMarketGrid');
        const row = box('#pagePluginPackages .skill-source-row'), pill = box('#pluginSourceSwitch');
        return Math.abs(header.left - grid.left) <= 1 && Math.abs(header.right - grid.right) <= 1
          && Math.abs((row.left + row.right) / 2 - (pill.left + pill.right) / 2) <= 1;
      });
      assert.equal(fit, true, `${width}px layout`);
    }
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, 'market.png') });
    await page.waitForTimeout(500);
    const firstCard = page.locator('#pluginMarketGrid .skill-card').first();
    await firstCard.hover();
    await page.waitForTimeout(250);
    assert.notEqual(await firstCard.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'hover fill is visible');
    await page.screenshot({ path: path.join(output, 'market-hover.png') });
    const installBtn = page.locator('#pluginInstallBtn');
    const createBtn = page.locator('#pluginImportBtn');
    assert.equal(await installBtn.isVisible(), true);
    assert.ok((await installBtn.boundingBox()).x < (await createBtn.boundingBox()).x, 'install sits left of create');
    await installBtn.click();
    await page.locator('#pluginInstallDialog[open]').waitFor();
    assert.equal(await page.locator('#pluginInstallTitle').textContent(), '安装 Yan Agent 官方社区插件');
    assert.equal(await page.locator('#pluginInstallInput').getAttribute('placeholder'), '输入插件包名，YanPlugin-开头，如YanPlugin-Ramol');
    assert.match(await page.locator('.plugin-install-warning').textContent(), /请再次核查你安装的插件没有安全问题/);
    assert.match(await page.locator('.plugin-install-warning').textContent(), /泄露你的本机数据/);
    const inputStyle = await page.locator('#pluginInstallInput').evaluate(el => {
      el.focus();
      const cs = getComputedStyle(el);
      return { outline: cs.outlineStyle, shadow: cs.boxShadow, radius: cs.borderRadius };
    });
    assert.deepEqual(inputStyle, { outline: 'none', shadow: 'none', radius: '999px' });
    assert.equal(await page.locator('#pluginInstallConfirm').isDisabled(), true);
    await page.locator('#pluginInstallInput').fill('Ramol');
    assert.equal(await page.locator('#pluginInstallConfirm').isEnabled(), true);
    assert.equal(await page.locator('#pluginInstallConfirm').evaluate(el => getComputedStyle(el).borderRadius), '999px');
    await page.screenshot({ path: path.join(output, 'install-dialog.png') });
    await page.locator('#pluginInstallCloseBtn').click();
    assert.equal(await page.locator('#pluginInstallDialog').isVisible(), false);
    await page.locator('[data-plugin-open="remotion"]').click();
    await page.locator('#pluginDetailTitle').waitFor();
    assert.equal(await page.locator('#pagePluginPackages .skill-source-row').isVisible(), false);
    assert.equal(await page.locator('#pluginDetailContent').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.setViewportSize({ width: 760, height: 760 });
    assert.equal(await page.locator('#pluginDetailContent').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: path.join(output, 'detail-760.png') });
    await page.locator('#pluginDetailContent [data-plugin-action="back"]').click();
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.waitForFunction(() => document.querySelectorAll('#pluginMarketGrid .skill-card').length > 0);
    await page.locator('#pluginSourceSwitch [data-plugin-source="installed"]').click();
    await page.waitForFunction(() => document.querySelector('#pluginSourceSwitch [data-plugin-source="installed"]')?.getAttribute('aria-selected') === 'true'
      && document.querySelectorAll('#pluginMarketGrid .skill-card').length === 1);
    const installedNames = await page.locator('#pluginMarketGrid .skill-card-name').allTextContents();
    assert.deepEqual(installedNames, ['Yan Computer Use']);
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(output, 'installed.png') });
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(() => switchSidebarNav('packages'));
    await page.waitForFunction(() => document.querySelector('#pluginSourceSwitch [data-plugin-source="installed"]')?.getAttribute('aria-selected') === 'true'
      && document.querySelectorAll('#pluginMarketGrid .skill-card').length === 1);
    assert.deepEqual(await page.locator('#pluginMarketGrid .skill-card-name').allTextContents(), ['Yan Computer Use']);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, marketCount: names.length, installed: installedNames, layout }));
  } finally {
    await app?.close();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
