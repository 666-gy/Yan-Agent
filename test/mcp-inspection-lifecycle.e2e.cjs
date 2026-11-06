'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const executable = process.env.YAN_MCP_TEST_EXE;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-mcp-inspect-'));
  let app;
  try {
    app = await _electron.launch({
      executablePath: executable || require('electron'), args: executable ? [] : [root],
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile }
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    const mainPid = await app.evaluate(({ app }) => app.getAppMetrics().find(m => m.type === 'Browser').pid);
    const children = () => execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${mainPid}' | ForEach-Object { if ($_.CommandLine -match '(yan-[a-z-]+-mcp[.]js)') { $Matches[1] } }`
    ], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).filter(Boolean);
    assert.deepEqual(children(), [], 'startup must not launch management MCP children');
    const results = await page.evaluate(async () => {
      window.YanStartupHello?.skip?.();
      const servers = (await api.mcpList()).filter(s => /^yan_/.test(s.id));
      const results = [];
      for (const server of servers) {
        const replies = await Promise.all([api.mcpTools(server.id), api.mcpTools(server.id)]);
        for (const reply of replies) results.push({ id: server.id, tools: reply.tools?.length, error: reply.error });
      }
      return results;
    });
    assert.ok(results.length >= 18);
    for (const result of results) assert.ok(result.tools > 0, `${result.id}: ${result.error}`);
    assert.deepEqual(children(), [], 'viewing tool catalogs must not leave MCP children');
    // An explicitly started management connection belongs to its caller.
    const started = await page.evaluate(() => api.mcpStart('yan_plugin'));
    assert.ok(started.ok, started.error);
    const before = children();
    assert.deepEqual(before, ['yan-plugin-mcp.js']);
    const inspected = await page.evaluate(() => api.mcpTools('yan_plugin'));
    assert.ok(inspected.tools.length > 0);
    assert.deepEqual(children(), before, 'inspection must preserve an existing connection');
    await page.evaluate(() => api.mcpStop('yan_plugin'));
    assert.deepEqual(children(), []);
    console.log(`PASS ${executable ? 'packaged' : 'development'} MCP lifecycle: ${results.length} concurrent catalog reads leave zero children; existing connection preserved`);
  } finally {
    await app?.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
