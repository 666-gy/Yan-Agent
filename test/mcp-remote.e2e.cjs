'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-mcp-remote-e2e-'));
const dataDir = path.join(userDataDir, 'YanData');
const outputDir = path.join(appRoot, 'output', 'playwright');
const screenshotPath = path.join(outputDir, 'mcp-remote.png');
const detailScreenshotPath = path.join(outputDir, 'mcp-remote-detail.png');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const TOOLS = [
  { name: 'remote_ping', description: 'Ping the remote MCP', inputSchema: { type: 'object', properties: {} } },
  { name: 'remote_echo', description: 'Echo text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }
];

const mcpServer = http.createServer((request, response) => {
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    let message = {};
    try { message = JSON.parse(body || '{}'); } catch {}
    if (message.method === 'initialize') {
      response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'e2e-session' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'e2e-remote', version: '1.0.0' }
        }
      }));
      return;
    }
    if (message.method === 'notifications/initialized') {
      response.writeHead(202);
      response.end();
      return;
    }
    if (message.method === 'tools/list') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
});

(async () => {
  await new Promise(resolve => mcpServer.listen(0, '127.0.0.1', resolve));
  const serverUrl = `http://127.0.0.1:${mcpServer.address().port}/mcp`;
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    mcpServers: [{
      id: 'e2e-remote-mcp',
      name: 'E2E 远程 MCP',
      description: '用于验证 HTTPS/远程 MCP 安装与探测。',
      type: 'remote',
      url: serverUrl,
      headers: { Authorization: 'Bearer e2e-token' },
      enabled: true,
      builtin: false
    }]
  }, null, 2));

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
    const remoteEntry = servers.find(server => server.id === 'e2e-remote-mcp');
    assert.ok(remoteEntry, 'remote server missing from mcpList');
    assert.equal(remoteEntry.type, 'remote');
    assert.equal(remoteEntry.url, serverUrl);
    assert.equal(remoteEntry.headerCount, 1);

    const probe = await page.evaluate(() => window.yan.mcpStart('e2e-remote-mcp'));
    assert.equal(probe.ok, true, probe.error || 'remote probe failed');
    assert.equal(probe.tools.length, 2);

    await page.locator('.sidebar-nav-item[data-nav="mcp"]').click();
    await page.locator('#pageMcp:not(.hidden)').waitFor();
    await page.locator('#mcpPageList [data-id="e2e-remote-mcp"] .mcp-open-btn').click();
    await page.locator('#mcpDetailView:not(.hidden)').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#mcpDetailTools .mcp-tool-row').length === 2);
    assert.equal(await page.locator('#mcpDetailTitle').textContent(), 'E2E 远程 MCP');
    assert.equal(await page.locator('#mcpDetailContent .mcp-detail-url').textContent(), serverUrl);
    assert.equal(await page.locator('#mcpPageList [data-id="e2e-remote-mcp"] .mcp-card-transport').count(), 1);
    await page.screenshot({ path: detailScreenshotPath, fullPage: false });
    await page.locator('#mcpDetailView [data-mcp-detail-action="back"]').click();
    await page.locator('#mcpMarketOverview:not(.hidden)').waitFor();

    // Install wizard: remote transport exposes URL/headers and can test the endpoint.
    await page.locator('#mcpOpenCreateBtn').click();
    await page.locator('#mcpNewName').waitFor();
    await page.locator('#mcpNewName').fill('向导远程服务');
    await page.locator('#mcpCreateDialog [data-mcp-transport="remote"]').click();
    await page.locator('#mcpWizardNextBtn').click();
    await page.locator('#mcpNewUrl').waitFor();
    assert.equal(await page.locator('#mcpNewCmd').isVisible(), false);
    await page.locator('#mcpNewUrl').fill(serverUrl);
    await page.locator('#mcpWizardNextBtn').click();
    await page.locator('#mcpNewHeaders').waitFor();
    await page.locator('#mcpNewHeaders').fill('Authorization: Bearer wizard-token');
    assert.equal(await page.locator('#mcpWizardNextBtn').isHidden(), true);
    await page.locator('#mcpTestCreateBtn').click();
    await page.waitForFunction(() => {
      const status = document.querySelector('#mcpCreateStatus');
      return status && status.textContent.includes('连接成功');
    });
    assert.match(await page.locator('#mcpCreateStatus').textContent(), /连接成功，2 个工具/);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await page.locator('#mcpCloseCreateBtn').click();

    console.log(JSON.stringify({
      ok: true,
      serverUrl,
      screenshotPath,
      detailScreenshotPath,
      servers: servers.map(server => server.id)
    }));
  } finally {
    await application?.close().catch(() => {});
    await new Promise(resolve => mcpServer.close(resolve));
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
