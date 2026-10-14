'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-mcp-market-e2e-'));
const dataDir = path.join(userDataDir, 'YanData');
const outputDir = path.join(appRoot, 'output', 'playwright');
const screenshotPath = path.join(outputDir, 'mcp-market.png');
const detailScreenshotPath = path.join(outputDir, 'mcp-detail.png');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

// Electron can keep temp files open for a moment after close() on Windows, so
// retry the cleanup instead of letting an EPERM mask the real test result.
async function removeDirWithRetry(dir, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  console.warn(`[e2e] could not remove temp dir: ${dir}`);
}
fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
  mcpServers: [{
    id: 'e2e-local-mcp',
    name: '本地演示服务',
    description: '用于验证 MCP 市场卡片与筛选的本地服务。',
    command: 'node',
    args: ['demo-server.js'],
    enabled: false,
    builtin: false
  }]
}, null, 2));

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForFunction(() => document.readyState === 'complete' && typeof switchSidebarNav === 'function');
    const servers = await page.evaluate(() => window.yan.mcpList());
    assert.ok(servers.length >= 1);

    await page.locator('.app-rail-button[data-nav="plugins"]').click();
    await page.locator('#pluginsMcpTab').click();
    await page.locator('#pageMcp:not(.hidden)').waitFor();
    await page.waitForFunction(count => document.querySelectorAll('#mcpPageList .mcp-market-card').length === count, servers.length);
    assert.equal(await page.locator('#mcpPageList .mgmt-row').count(), 0);
    assert.equal(await page.locator('#mcpPageList .mcp-market-card').count(), servers.length);
    assert.equal(await page.locator('#mcpFilterMenu, #mcpFilterToggle, #mcpSearchToggle, #mcpMarketSearch').count(), 0);
    assert.equal(await page.locator('#mcpOpenCreateBtn').count(), 1);
    assert.equal(await page.locator('#mcpPageList .mcp-test-btn, #mcpPageList .mcp-switch, #mcpPageList [data-mcp-act="delete"]').count(), 0);
    assert.equal(await page.locator('#mcpPageList .skill-market-group').count(), 3);
    assert.equal(await page.locator('#mcpPageList .mcp-open-btn').count(), servers.length);
    assert.equal(await page.locator('#mcpPageList .mcp-card-state').count(), 0, 'no cards show enable/disable status');

    await page.locator('#mcpPageList [data-id="yan_analysis"] .skill-card-desc').click();
    await page.locator('#mcpDetailView:not(.hidden)').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#mcpDetailTools .mcp-tool-row').length > 0);
    assert.equal(await page.locator('#mcpDetailTitle').textContent(), 'Yan Analysis');
    await application.evaluate(({ shell }) => { shell.openPath = async value => { global.__mcpOpened = value; return ''; }; });
    await page.locator('[data-mcp-detail-action="open-directory"]').click();
    assert.equal(await application.evaluate(() => global.__mcpOpened), path.join(appRoot, 'lib'));
    const remoteDirectory = await page.evaluate(async () => {
      const server = await window.yan.mcpAdd({ name: 'Explorer remote fixture', type: 'remote', url: 'https://example.com/mcp', enabled: false });
      const result = await window.yan.openMcpDirectory(server.id);
      await window.yan.mcpRemove(server.id);
      return result;
    });
    assert.equal(remoteDirectory.ok, true);
    assert.equal(remoteDirectory.path, dataDir, 'remote MCP opens the local configuration directory');
    assert.equal((await page.evaluate(() => window.yan.openMcpDirectory('../../missing'))).ok, false);
    assert.equal(await page.locator('#mcpDetailContent .plugin-detail-header').count(), 1);
    assert.equal(await page.locator('#mcpDetailContent .plugin-info-section, #mcpDetailContent .plugin-examples').count(), 0);
    assert.equal(await page.locator('#mcpDetailContent [data-mcp-detail-action="delete"]').count(), 0, 'native MCP stays non-removable');
    assert.equal(await page.locator('#mcpDetailContent [data-mcp-detail-action="test"]').textContent(), '测试连接');
    assert.equal(await page.locator('#mcpDetailContent [data-mcp-detail-action="toggle"]').getAttribute('role'), 'switch');
    assert.equal(await page.locator('#mcpDetailContent [data-mcp-detail-action="toggle"]').isChecked(), true);
    assert.equal(await page.locator('#mcpDetailContent [data-mcp-detail-action="toggle"]').isDisabled(), true);
    assert.ok(await page.locator('#mcpDetailTools .mcp-tool-row').count() >= 10);
    assert.ok(await page.locator('#mcpDetailTools .mcp-tool-logo[data-icon]').evaluateAll(items => new Set(items.map(item => item.dataset.icon)).size >= 5));
    assert.ok(await page.locator('#mcpDetailTools .plugin-skill-copy p').first().textContent().then(text => /[\u3400-\u9fff]/u.test(text)));
    assert.equal(Number(await page.locator('#mcpDetailToolCount').textContent()), await page.locator('#mcpDetailTools .mcp-tool-row').count());
    const close = page.locator('#mcpDetailContent [data-mcp-detail-action="back"]');
    assert.equal(await close.evaluate(el => el.className === document.getElementById('skillImportCloseBtn').className && el.innerHTML === document.getElementById('skillImportCloseBtn').innerHTML), true, 'reuse the existing X button');
    const bounds = await page.locator('#mcpDetailView').boundingBox(), parent = await page.locator('#pageMcp').boundingBox();
    assert.ok(bounds.width <= 880 && bounds.width < parent.width);
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - parent.x - parent.width / 2) < 10, 'center the detail content');
    assert.equal(await page.locator('#mcpDetailContent .plugin-detail-logo').evaluate(el => el.getBoundingClientRect().bottom < document.getElementById('mcpDetailTitle').getBoundingClientRect().top), true);
    const detailLayout = await page.locator('#mcpDetailTools .mcp-tool-row').first().evaluate(row => {
      const copy = row.querySelector('.plugin-skill-copy');
      const description = row.querySelector('.plugin-skill-copy p');
      return {
        rowWidth: row.getBoundingClientRect().width,
        copyWidth: copy.getBoundingClientRect().width,
        descriptionWidth: description.getBoundingClientRect().width,
        maxWidth: getComputedStyle(description).maxWidth
      };
    });
    assert.ok(detailLayout.rowWidth > 0 && detailLayout.copyWidth > detailLayout.rowWidth * 0.7);
    assert.equal(detailLayout.descriptionWidth, detailLayout.copyWidth);
    assert.equal(detailLayout.maxWidth, 'none');
    await page.screenshot({ path: detailScreenshotPath, fullPage: false });
    await page.locator('#sidebarToggle').click();
    await page.setViewportSize({ width: 375, height: 900 });
    assert.equal(await page.locator('#mcpDetailContent').evaluate(el => el.scrollWidth > el.clientWidth), false, 'narrow detail must not overflow');
    await page.screenshot({ path: path.join(outputDir, 'mcp-detail-narrow.png') });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.locator('#sidebarToggle').click();
    await page.locator('#mcpDetailView [data-mcp-detail-action="back"]').click();
    await page.locator('#mcpMarketOverview:not(.hidden)').waitFor();
    // A user-installed server exposes uninstall in its detail view.
    await page.locator('#mcpPageList [data-id="e2e-local-mcp"] .mcp-open-btn').click();
    await page.locator('#mcpDetailView:not(.hidden)').waitFor();
    assert.equal(await page.locator('#mcpDetailContent [data-mcp-detail-action="delete"]').count(), 1, 'user MCP exposes uninstall');
    await page.locator('#mcpDetailView [data-mcp-detail-action="back"]').click();
    await page.locator('#mcpMarketOverview:not(.hidden)').waitFor();
    for (const key of ['Enter', 'Space']) {
      const card = page.locator('#mcpPageList [data-id="yan_analysis"]');
      await card.focus();
      await card.press(key);
      await page.locator('#mcpDetailView:not(.hidden)').waitFor();
      assert.equal(await page.locator('#mcpDetailTitle').textContent(), 'Yan Analysis');
      await page.locator('#mcpDetailView [data-mcp-detail-action="back"]').click();
      await page.locator('#mcpMarketOverview:not(.hidden)').waitFor();
    }
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(JSON.stringify({ ok: true, screenshotPath, detailScreenshotPath, servers: servers.map(server => server.id) }));
  } finally {
    await application?.close().catch(() => {});
    await removeDirWithRetry(userDataDir);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
