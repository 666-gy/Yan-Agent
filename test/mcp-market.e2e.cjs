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
    await page.waitForFunction(() => document.readyState === 'complete' && typeof switchSidebarNav === 'function');
    const servers = await page.evaluate(() => window.yan.mcpList());
    assert.ok(servers.length >= 1);

    await page.locator('.sidebar-nav-item[data-nav="mcp"]').click();
    await page.locator('#pageMcp:not(.hidden)').waitFor();
    await page.waitForFunction(count => document.querySelectorAll('#mcpPageList .mcp-market-card').length === count, servers.length);
    assert.equal(await page.locator('#mcpPageList .mgmt-row').count(), 0);
    assert.equal(await page.locator('#mcpPageList .mcp-market-card').count(), servers.length);
    assert.equal(await page.locator('#mcpFilterMenu').count(), 1);

    await page.locator('#mcpFilterToggle').click();
    assert.deepEqual(
      await page.locator('#mcpFilterMenu [data-mcp-filter]').evaluateAll(items => items.map(item => item.textContent.trim())),
      ['全部', '用户自行安装', '系统原生', '自带']
    );
    await page.locator('#mcpFilterMenu [data-mcp-filter="user"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#mcpPageList .mcp-market-card').length === 1);
    assert.equal(await page.locator('#mcpPageList .skill-card-name').count(), 1);
    assert.equal(await page.locator('#mcpPageList .mcp-open-btn').count(), 1);
    assert.equal(await page.locator('#mcpPageList .mcp-test-btn').count(), 0);
    assert.equal(await page.locator('#mcpPageList .mcp-switch').count(), 0);
    assert.equal(await page.locator('#mcpPageList [data-mcp-act="delete"]').count(), 0);

    await page.locator('#mcpSearchToggle').click();
    await page.locator('#mcpMarketSearch').fill('本地演示');
    await page.waitForFunction(() => document.querySelectorAll('#mcpPageList .mcp-market-card').length === 1);
    await page.locator('#mcpMarketSearch').fill('');
    await page.locator('#mcpSearchToggle').click();
    await page.locator('#mcpFilterToggle').click();
    await page.locator('#mcpFilterMenu [data-mcp-filter="all"]').click();
    await page.waitForFunction(count => document.querySelectorAll('#mcpPageList .mcp-market-card').length === count, servers.length);
    assert.equal(await page.locator('#mcpPageList .skill-market-group').count(), 3);
    assert.equal(await page.locator('#mcpPageList .mcp-open-btn').count(), servers.length);
    for (const nativeServer of servers.filter(server => server.systemManaged)) {
      assert.equal(await page.locator(`#mcpPageList [data-id="${nativeServer.id}"] .mcp-card-state`).count(), 0);
    }

    await page.locator('#mcpPageList [data-id="yan_analysis"] .mcp-open-btn').click();
    await page.locator('#mcpDetailView:not(.hidden)').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#mcpDetailTools .mcp-tool-row').length > 0);
    assert.equal(await page.locator('#mcpDetailTitle').textContent(), 'Yan Analysis');
    assert.equal(await page.locator('#mcpDetailContent .mcp-detail-control').count(), 2);
    assert.equal(await page.locator('#mcpDetailContent [data-mcp-detail-action="test"]').textContent(), '测试连接');
    assert.equal(await page.locator('#mcpDetailContent [data-mcp-detail-action="toggle"]').textContent(), '始终启用');
    assert.equal(await page.locator('#mcpDetailContent [data-mcp-detail-action="toggle"]').isDisabled(), true);
    assert.ok(await page.locator('#mcpDetailTools .mcp-tool-row').count() >= 10);
    assert.ok(await page.locator('#mcpDetailTools .mcp-tool-logo[data-icon]').evaluateAll(items => new Set(items.map(item => item.dataset.icon)).size >= 5));
    assert.ok(await page.locator('#mcpDetailTools .skill-detail-row-copy p').first().textContent().then(text => /[\u3400-\u9fff]/u.test(text)));
    const detailLayout = await page.locator('#mcpDetailTools .mcp-tool-row').first().evaluate(row => {
      const copy = row.querySelector('.skill-detail-row-copy');
      const description = row.querySelector('.skill-detail-row-copy p');
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
    await page.locator('#mcpDetailView [data-mcp-detail-action="back"]').click();
    await page.locator('#mcpMarketOverview:not(.hidden)').waitFor();
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(JSON.stringify({ ok: true, screenshotPath, detailScreenshotPath, servers: servers.map(server => server.id) }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
