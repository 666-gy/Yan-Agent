'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRuntimeDefaults } = require('../lib/main/runtime-defaults');
const runtime = require('../lib/playwright-runtime');

test('Playwright is absent from the defaults until its plugin is installed', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-playwright-defaults-'));
  try {
    const { ensureDefaultMcp } = createRuntimeDefaults({ dataDir: temp });
    assert.equal(ensureDefaultMcp([]).some(server => server.id === 'mcp_default_playwright'), false);
    // The descriptor retired from an older build must not survive the load.
    const retired = ensureDefaultMcp([{ id: 'mcp_default_playwright', name: 'Playwright', builtin: true, enabled: true, command: 'npx', args: [] }]);
    assert.equal(retired.some(server => server.id === 'mcp_default_playwright'), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Playwright defaults appear once the browser runtime is installed', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-playwright-defaults-'));
  const browsers = path.join(temp, 'runtimes', 'playwright', 'browsers');
  const executable = path.join(browsers, 'chromium-1247', 'chrome-win64', 'chrome.exe');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, 'fixture');
  fs.writeFileSync(path.join(temp, 'runtimes', 'playwright', 'installed.json'), JSON.stringify({
    mcpVersion: runtime.MCP_VERSION, browserExecutable: 'chromium-1247/chrome-win64/chrome.exe'
  }));
  try {
    const { ensureDefaultMcp } = createRuntimeDefaults({ dataDir: temp });
    const old = { id: 'mcp_default_playwright', name: 'Playwright', builtin: true, enabled: false, command: 'npx', args: ['-y', '@playwright/mcp@latest'] };
    const result = ensureDefaultMcp([old]).find(server => server.id === old.id);
    // A user who switched the server off keeps it off across the migration.
    assert.equal(result.enabled, false);
    assert.equal(result.runtime, 'playwright');
    assert.equal(result.command, 'yan-playwright');
    assert.equal(result.sourceVersion, require('../vendor/playwright/package.json').dependencies['@playwright/mcp']);
    assert.deepEqual(result.args, runtime.DEFAULT_ARGS);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Playwright resolves the bundled MCP service against the downloaded browser', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-playwright-unit-'));
  const resources = path.join(temp, 'resources'), appRoot = path.join(resources, 'app.asar');
  const runtimeRoot = path.join(resources, 'playwright-runtime');
  const dataDir = path.join(temp, 'data');
  const executable = path.join(dataDir, 'runtimes', 'playwright', 'browsers', 'chromium-1247', 'chrome-win64', 'chrome.exe');
  const entry = path.join(runtimeRoot, 'node_modules/@playwright/mcp/cli.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, 'fixture');
  fs.writeFileSync(path.join(runtimeRoot, 'runtime.json'), JSON.stringify({
    mcpVersion: runtime.MCP_VERSION, platform: process.platform, arch: process.arch,
    browserExecutable: 'chromium-1247/chrome-win64/chrome.exe'
  }));
  try {
    // The browser is downloaded at plugin-install time, so without the marker
    // the runtime is unavailable even though the MCP service is present.
    const uninstalled = runtime.resolveRuntime(appRoot, dataDir);
    assert.equal(uninstalled.ok, false);
    assert.match(uninstalled.error, /尚未安装 Chromium/);
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, 'fixture');
    fs.writeFileSync(path.join(dataDir, 'runtimes', 'playwright', 'installed.json'), JSON.stringify({
      mcpVersion: runtime.MCP_VERSION, browserExecutable: 'chromium-1247/chrome-win64/chrome.exe'
    }));
    const result = runtime.resolveServer(runtime.createPlaywrightServer(), appRoot, dataDir);
    assert.equal(result.ok, true, result.error);
    // Playwright runs on the Node built into Yan itself, not on another
    // bundle's node.exe and not on whatever `npx` happens to be on PATH.
    assert.equal(result.server.command, process.execPath);
    assert.equal(result.server.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(result.server.env.PLAYWRIGHT_BROWSERS_PATH, path.dirname(path.dirname(path.dirname(executable))));
    assert.deepEqual(result.server.args.slice(0, 3), [entry, '--executable-path', executable]);
    // A second pass over an already-resolved server must not double the prefix.
    assert.deepEqual(runtime.resolveServer(result.server, path.join(resources, 'app.asar.unpacked'), dataDir), result);
    assert.ok(result.server.args.every(value => !value.includes('@latest')));
    // Deleting the browser after installation is reported as a broken install
    // rather than as a working runtime.
    fs.unlinkSync(executable);
    const missing = runtime.resolveRuntime(appRoot, dataDir);
    assert.equal(missing.ok, false);
    assert.match(missing.error, /Chromium 浏览器文件缺失/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
