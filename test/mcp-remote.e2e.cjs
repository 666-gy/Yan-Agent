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

// Electron can keep temp files open for a moment after close() on Windows, so
// retry the cleanup instead of letting an EPERM mask the real test result.
async function removeDirWithRetry(dir, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  console.warn(`[e2e] could not remove temp dir: ${dir}`);
}

const TOOLS = [
  { name: 'remote_ping', description: 'Ping the remote MCP', inputSchema: { type: 'object', properties: {} } },
  { name: 'remote_echo', description: 'Echo text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }
];
let toolListRequests = 0;

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
      toolListRequests++;
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

    await page.locator('.app-rail-button[data-nav="plugins"]').click();
    await page.locator('#pluginsMcpTab').click();
    await page.locator('#pageMcp:not(.hidden)').waitFor();
    await page.locator('#mcpPageList [data-id="e2e-remote-mcp"] .mcp-open-btn').click();
    await page.locator('#mcpDetailView:not(.hidden)').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#mcpDetailTools .mcp-tool-row').length === 2);
    assert.equal(await page.locator('#mcpDetailTitle').textContent(), 'E2E 远程 MCP');
    assert.equal(await page.locator('#mcpDetailContent .mcp-detail-url').textContent(), serverUrl);
    assert.equal(await page.locator('#mcpPageList [data-id="e2e-remote-mcp"] .mcp-card-transport').count(), 1);
    const toggle = page.locator('#mcpDetailContent [data-mcp-detail-action="toggle"]');
    const idle = () => page.waitForFunction(() => !document.querySelector('[data-mcp-detail-action="toggle"]').hasAttribute('aria-busy'));
    await page.evaluate(() => {
      window.__mcpDetailToggle = document.querySelector('[data-mcp-detail-action="toggle"]');
      window.__mcpDetailTools = document.getElementById('mcpDetailTools').firstElementChild;
    });
    const probeCount = toolListRequests;
    assert.equal(await toggle.isChecked(), true);
    await toggle.uncheck(); await idle();
    assert.equal(await page.evaluate(async () => (await window.yan.mcpList()).find(s => s.id === 'e2e-remote-mcp').enabled), false);
    await toggle.check(); await idle();
    assert.equal(await page.evaluate(async () => (await window.yan.mcpList()).find(s => s.id === 'e2e-remote-mcp').enabled), true);
    assert.equal(toolListRequests, probeCount, 'switch updates must not start another connection probe');
    assert.equal(await page.evaluate(() => window.__mcpDetailToggle === document.querySelector('[data-mcp-detail-action="toggle"]') && window.__mcpDetailTools === document.getElementById('mcpDetailTools').firstElementChild), true, 'switch updates preserve the detail DOM');
    await application.evaluate(({ ipcMain }) => {
      global.__mcpOriginalUpdate = ipcMain._invokeHandlers.get('mcp:update');
      ipcMain.removeHandler('mcp:update');
      ipcMain.handle('mcp:update', () => { throw new Error('测试配置保存失败'); });
    });
    await toggle.click(); await idle();
    assert.equal(await toggle.isChecked(), true, 'failed saves restore the persisted switch state');
    assert.match(await page.locator('#toast').textContent(), /测试配置保存失败/);
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('mcp:update');
      ipcMain.handle('mcp:update', global.__mcpOriginalUpdate);
    });
    await page.locator('[data-mcp-detail-action="test"]').click();
    await page.waitForFunction(() => document.querySelector('[data-mcp-detail-action="test"]').dataset.state === 'success');
    assert.ok(toolListRequests > probeCount, 'explicit connection testing still probes');
    await toggle.uncheck(); await idle();
    await page.locator('[data-mcp-detail-action="back"]').click();
    await page.locator('#mcpPageList [data-id="e2e-remote-mcp"] .mcp-open-btn').click();
    await page.waitForFunction(() => document.querySelectorAll('#mcpDetailTools .mcp-tool-row').length === 2);
    assert.equal(await toggle.isChecked(), false, 'disabled state survives reopening the detail');
    await page.screenshot({ path: detailScreenshotPath, fullPage: false });
    await page.locator('#mcpDetailView [data-mcp-detail-action="back"]').click();
    await page.locator('#mcpMarketOverview:not(.hidden)').waitFor();

    // The header plus button hands the request to a fresh agent session with the
    // MCP-install skill attached; that mount is the only way to add a server in
    // the UI now, so the manual form is no longer part of the product surface.
    await page.locator('#mcpOpenCreateBtn').click();
    await page.waitForFunction(() => (state.selectedSkills || []).some(skill => skill.id === 'mcp-puller'));
    assert.equal(await page.locator('.composer-skill-token').count(), 1, 'MCP install skill is mounted in the composer');
    assert.match(await page.evaluate(() => getComposerText()), /^Install an MCP server with/);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    // Test-before-create stays covered at the API layer the form used to drive.
    const testResult = await page.evaluate(
      url => window.yan.mcpTest({ type: 'remote', url, headers: { Authorization: 'Bearer e2e-token' } }),
      serverUrl
    );
    assert.equal(testResult?.ok, true, testResult?.error || 'remote mcpTest failed');
    assert.equal(testResult.tools.length, 2);

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
    await removeDirWithRetry(userDataDir);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
