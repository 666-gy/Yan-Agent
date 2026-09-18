'use strict';

// Regression: opening the detail view of a server that crashes on every
// tools/list probe must not re-render forever. The crash status event used to
// re-enter renderMcpPage -> renderMcpDetail -> mcpTools -> crash -> event,
// which the user sees as an endlessly refreshing detail page.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-mcp-loop-e2e-'));
const dataDir = path.join(userDataDir, 'YanData');
const evidenceDir = path.join(appRoot, '.yanagent', 'evidence');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
  mcpServers: [{
    id: 'e2e-broken-mcp',
    name: 'E2E Broken MCP',
    description: 'Exits immediately so every tools/list probe crashes.',
    command: 'node',
    args: ['-e', 'process.exit(1)'],
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

    await page.locator('.sidebar-nav-item[data-nav="mcp"]').click();
    await page.locator('#pageMcp:not(.hidden)').waitFor();
    await page.locator('#mcpPageList [data-id="e2e-broken-mcp"] .mcp-open-btn').click();
    await page.locator('#mcpDetailView:not(.hidden)').waitFor();
    await page.waitForFunction(() => document.querySelector('#mcpDetailTools .mcp-tool-error'));

    await page.evaluate(() => {
      window.__mcpDetailMutations = 0;
      const target = document.querySelector('#mcpDetailContent');
      const observer = new MutationObserver((records) => {
        window.__mcpDetailMutations += records.length;
      });
      observer.observe(target, { childList: true, subtree: true });
    });
    await page.waitForTimeout(4000);

    const snapshot = await page.evaluate(() => ({
      mutations: window.__mcpDetailMutations,
      errorText: document.querySelector('#mcpDetailTools .mcp-tool-error')?.textContent || ''
    }));
    assert.ok(snapshot.mutations <= 1, `detail view re-rendered ${snapshot.mutations} times after the failure; probes must not loop`);
    assert.ok(/code 1|exit|退出/i.test(snapshot.errorText), `unexpected error text: ${snapshot.errorText}`);
    const screenshotPath = path.join(evidenceDir, 'mcp-crash-loop-detail.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(JSON.stringify({ ok: true, ...snapshot, screenshotPath }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
