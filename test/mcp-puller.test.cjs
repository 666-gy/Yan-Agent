'use strict';

// MCP-Puller: the backend half of natural-language MCP installation.
//
// Covers the real paths:
//   - install rules + config round trip (encrypted fields preserved)
//   - official-source verification (npm/PyPI registry over a stubbed fetch)
//   - the yan_mcp stdio server itself, driven over real JSON-RPC
//   - main.js merged skills exposing the bundled MCP-Puller Skill
//   - skills-runtime loading MCP-Puller only when selected

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Module = require('node:module');

const appRoot = path.resolve(__dirname, '..');
const {
  normalizeMcpInstallRequest,
  planMcpInstall,
  addMcpServerToConfig,
  listMcpServersFromConfig,
  removeMcpServerFromConfig,
  readMcpConfig,
  readMcpMirror
} = require(path.join(appRoot, 'lib', 'mcp-installer.js'));
const { createRuntimeDefaults } = require(path.join(appRoot, 'lib', 'main', 'runtime-defaults.js'));
const {
  packageSpecFromCommand,
  registryCheck,
  verifyMcpSource,
  officialDescription
} = require(path.join(appRoot, 'lib', 'mcp-source-verify.js'));

function tempDir(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeConfig(directory, config) {
  const configPath = path.join(directory, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return configPath;
}

test('install rules reject a request without a usable target', () => {
  assert.equal(normalizeMcpInstallRequest({}).ok, false);
  assert.match(normalizeMcpInstallRequest({ name: 'x' }).error, /启动命令/);
  assert.match(normalizeMcpInstallRequest({ name: 'x', type: 'remote', url: 'ftp://a' }).error, /http/);
  const local = normalizeMcpInstallRequest({ name: ' Demo ', command: 'npx', args: ['-y', 'pkg', 42, 'bad\nvalue'] });
  assert.equal(local.ok, true);
  assert.deepEqual(local.server.args, ['-y', 'pkg', '42']);
  assert.equal(local.server.command, 'npx');
  const remote = normalizeMcpInstallRequest({
    name: 'Remote',
    type: 'remote',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer t', 'X-Bad': 'a\nb' }
  });
  assert.equal(remote.ok, true);
  assert.equal(remote.server.type, 'remote');
  assert.deepEqual(remote.server.headers, { Authorization: 'Bearer t' });
});

test('install writes config.json and preserves unrelated and encrypted fields', (t) => {
  const directory = tempDir(t, 'yan-mcp-config-');
  const configPath = writeConfig(directory, {
    api: { apiKey: 'enc:v1:KEEP-ME' },
    theme: 'dark',
    mcpServers: [
      { id: 'mcp_default_codegraph', name: 'CodeGraph', builtin: true, command: 'codegraph', args: ['serve', '--mcp'], enabled: true }
    ]
  });

  const added = addMcpServerToConfig(configPath, { name: 'Demo MCP', command: 'npx', args: ['-y', 'demo'] }, { now: 1700000000000 });
  assert.equal(added.ok, true);
  assert.equal(added.installed, true);
  assert.equal(added.server.id, 'mcp_1700000000000');

  const roundTrip = readMcpConfig(configPath);
  assert.equal(roundTrip.config.api.apiKey, 'enc:v1:KEEP-ME');
  assert.equal(roundTrip.config.theme, 'dark');
  assert.equal(roundTrip.config.mcpServers.length, 2);
  assert.equal(roundTrip.config.mcpServers[0].id, 'mcp_default_codegraph');

  const again = addMcpServerToConfig(configPath, { name: 'Demo MCP', command: 'npx', args: ['-y', 'demo'] });
  assert.equal(again.ok, true);
  assert.equal(again.installed, false);
  assert.equal(again.action, 'exists');
  assert.equal(readMcpConfig(configPath).config.mcpServers.length, 2);

  const list = listMcpServersFromConfig(configPath);
  assert.equal(list.ok, true);
  assert.deepEqual(list.servers.map(server => server.id).sort(), ['mcp_1700000000000', 'mcp_default_codegraph']);
  assert.equal(list.servers.find(server => server.id === 'mcp_default_codegraph').builtin, true);

  const removeBuiltin = removeMcpServerFromConfig(configPath, { id: 'mcp_default_codegraph' });
  assert.equal(removeBuiltin.ok, false);
  const removed = removeMcpServerFromConfig(configPath, { name: 'Demo MCP' });
  assert.equal(removed.ok, true);
  assert.equal(removed.removed, true);
  assert.equal(readMcpConfig(configPath).config.mcpServers.length, 1);
});

test('install refuses to overwrite a built-in server name', () => {
  const planned = planMcpInstall({
    mcpServers: [{ id: 'mcp_default_codegraph', name: 'CodeGraph', builtin: true, command: 'codegraph' }]
  }, { name: 'CodeGraph', command: 'npx', args: ['-y', 'x'] });
  assert.equal(planned.ok, false);
  assert.match(planned.error, /内置/);
});

test('an unrelated config save cannot silently drop a just-installed MCP server', (t) => {
  const directory = tempDir(t, 'yan-mcp-mirror-');
  const configPath = writeConfig(directory, { mcpServers: [] });
  addMcpServerToConfig(configPath, { name: 'Mirrored MCP', command: 'npx', args: ['-y', 'demo'] }, { now: 1700000000001 });
  assert.deepEqual(readMcpMirror(configPath).map(server => server.name), ['Mirrored MCP']);

  // The app persists a whole config object; a stale one would lose the entry.
  const { ensureDefaultMcp } = createRuntimeDefaults({ dataDir: directory });
  assert.ok(ensureDefaultMcp([]).some(server => server.name === 'Mirrored MCP'));

  // The same stale save also keeps the old entry but drops its introduction.
  addMcpServerToConfig(configPath, { name: 'Mirrored MCP', command: 'npx', args: ['-y', 'demo'], description: '镜像说明' });
  const staleEntry = readMcpConfig(configPath).config.mcpServers.find(server => server.name === 'Mirrored MCP');
  assert.equal(staleEntry.description, '镜像说明');
  const merged = ensureDefaultMcp([{ ...staleEntry, description: '' }]);
  assert.equal(merged.find(server => server.name === 'Mirrored MCP').description, '镜像说明');

  // Removing through the installer clears the mirror, so it stays removed.
  removeMcpServerFromConfig(configPath, { name: 'Mirrored MCP' });
  assert.deepEqual(readMcpMirror(configPath), []);
  assert.deepEqual(ensureDefaultMcp([]).filter(server => server.name === 'Mirrored MCP'), []);
});

test('install keeps a short introduction and backfills a missing one', (t) => {
  const directory = tempDir(t, 'yan-mcp-desc-');
  const configPath = writeConfig(directory, {
    mcpServers: [
      { id: 'mcp_1', name: 'No Intro', command: 'node', args: ['a'], enabled: true },
      { id: 'mcp_2', name: 'Has Intro', command: 'node', args: ['b'], enabled: true, description: '原有说明' }
    ]
  });

  const sanitized = normalizeMcpInstallRequest({
    name: 'Multi',
    command: 'npx',
    args: ['-y', 'p'],
    description: '第一行\n第二行  多空格\u0001'
  });
  assert.equal(sanitized.server.description, '第一行 第二行 多空格');

  const enriched = addMcpServerToConfig(configPath, { name: 'No Intro', command: 'node', args: ['a'], description: '补齐说明' });
  assert.equal(enriched.action, 'enrich');
  assert.equal(enriched.installed, false);
  assert.equal(enriched.server.description, '补齐说明');

  const kept = addMcpServerToConfig(configPath, { name: 'Has Intro', command: 'node', args: ['b'], description: '新说明' });
  assert.equal(kept.action, 'exists');
  assert.equal(readMcpConfig(configPath).config.mcpServers.find(server => server.name === 'Has Intro').description, '原有说明');

  const listed = listMcpServersFromConfig(configPath);
  assert.equal(listed.servers.find(server => server.name === 'No Intro').description, '补齐说明');
});

test('official source text is the fallback introduction', () => {
  assert.equal(
    officialDescription({ evidence: { checks: [{ kind: 'registry', ok: true, description: 'Demo server for X' }] } }),
    'Demo server for X'
  );
  assert.match(
    officialDescription({ evidence: { checks: [{ kind: 'handshake', ok: true, tools: ['a', 'b'] }] } }),
    /提供 2 个工具/
  );
  assert.equal(officialDescription({ evidence: { checks: [] } }), '');
});

test('package spec is read from the official launcher arguments', () => {
  assert.deepEqual(
    packageSpecFromCommand({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] }),
    { ok: true, registry: 'npm', name: '@modelcontextprotocol/server-filesystem', spec: '@modelcontextprotocol/server-filesystem' }
  );
  assert.equal(packageSpecFromCommand({ command: 'npx', args: ['pkg@1.2.3'] }).name, 'pkg');
  assert.equal(packageSpecFromCommand({ command: 'uvx', args: ['mcp-server-fetch'] }).registry, 'pypi');
  assert.equal(packageSpecFromCommand({ command: 'npx', args: ['-y', 'git+https://github.com/a/b'] }).ok, false);
  assert.equal(packageSpecFromCommand({ command: '/usr/local/bin/my-server' }).ok, false);
});

test('official registry checks use registry.npmjs.org and pypi.org', async () => {
  const calls = [];
  const npmFetch = async (url) => {
    calls.push(url);
    return {
      status: 200,
      ok: true,
      json: async () => ({
        'dist-tags': { latest: '1.2.3' },
        versions: { '1.2.3': { mcpName: 'io.github.demo/server', description: 'demo server' } }
      })
    };
  };
  const npm = await registryCheck(packageSpecFromCommand({ command: 'npx', args: ['-y', '@demo/mcp-server'] }), { fetchImpl: npmFetch });
  assert.equal(calls[0], 'https://registry.npmjs.org/%40demo%2Fmcp-server');
  assert.equal(npm.ok, true);
  assert.equal(npm.latestVersion, '1.2.3');
  assert.equal(npm.mcpName, 'io.github.demo/server');

  const pypi = await registryCheck(packageSpecFromCommand({ command: 'uvx', args: ['mcp-server-fetch'] }), {
    fetchImpl: async (url) => {
      calls.push(url);
      return { status: 200, ok: true, json: async () => ({ info: { version: '2025.4.1', summary: 'fetch server' } }) };
    }
  });
  assert.equal(calls[1], 'https://pypi.org/pypi/mcp-server-fetch/json');
  assert.equal(pypi.latestVersion, '2025.4.1');

  const missing = await registryCheck(packageSpecFromCommand({ command: 'npx', args: ['-y', 'definitely-not-a-real-pkg-xyz'] }), {
    fetchImpl: async () => ({ status: 404, ok: false })
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.blocked, true);
  assert.match(missing.error, /没有包/);
});

test('verification reports unavailable instead of blocking when nothing can be checked', async () => {
  const remote = await verifyMcpSource({ name: 'R', type: 'remote', url: 'https://example.com/mcp' }, { allowNetwork: false });
  assert.equal(remote.blocked, false);
  assert.equal(remote.verified, false);

  const local = await verifyMcpSource({ name: 'L', command: '/opt/custom/server' }, { allowNetwork: false, live: false });
  assert.equal(local.blocked, false);
  assert.equal(local.verified, false);
});

test('verification is blocked when the official registry has no such package', async () => {
  const result = await verifyMcpSource(
    { name: 'L', command: 'npx', args: ['-y', 'missing-pkg-xyz'] },
    { allowNetwork: true, live: false, fetchImpl: async () => ({ status: 404, ok: false }) }
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.match(result.error, /没有包/);
});

// ---------------------------------------------------------------------------
// The yan_mcp stdio server, driven over real JSON-RPC
// ---------------------------------------------------------------------------

function startYanMcp(configPath, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(appRoot, 'lib', 'yan-mcp-mcp.js')], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      YAN_MCP_CONFIG_PATH: configPath,
      YAN_MCP_ALLOW_NETWORK: 'false',
      ...extraEnv
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  child.stdout.on('data', data => {
    buffer += data.toString();
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message?.id == null || !pending.has(message.id)) continue;
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve(message);
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout calling ${method}`));
    }, 20_000);
    pending.set(id, message => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return {
    request,
    notify: method => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`),
    stop: () => { try { child.kill(); } catch {} }
  };
}

test('yan_mcp installs, lists and removes a server over real JSON-RPC', async (t) => {
  const directory = tempDir(t, 'yan-mcp-rpc-');
  const configPath = writeConfig(directory, {
    api: { apiKey: 'enc:v1:KEEP-ME' },
    mcpServers: [{ id: 'mcp_default_playwright', name: 'Playwright', builtin: true, command: 'npx', enabled: true }]
  });
  const server = startYanMcp(configPath);
  t.after(() => server.stop());

  const initialized = await server.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(initialized.result.serverInfo.name, 'Yan MCP');
  server.notify('notifications/initialized');

  const listed = await server.request('tools/list', {});
  assert.deepEqual(
    listed.result.tools.map(tool => tool.name).sort(),
    ['activate_mcp_server', 'install_mcp_server', 'list_mcp_servers', 'remove_mcp_server', 'verify_mcp_server']
  );

  const installed = await server.request('tools/call', {
    name: 'install_mcp_server',
    arguments: { name: 'Demo MCP', command: 'node', args: ['-e', 'console.log(1)'], verify: false }
  });
  const installPayload = installed.result.structuredContent;
  assert.equal(installPayload.ok, true);
  assert.equal(installPayload.installed, true);
  assert.equal(installPayload.action, 'add');
  assert.equal(installPayload.effective, 'next-run');

  const afterInstall = readMcpConfig(configPath);
  assert.equal(afterInstall.config.api.apiKey, 'enc:v1:KEEP-ME');
  assert.equal(afterInstall.config.mcpServers.length, 2);
  const stored = afterInstall.config.mcpServers.find(entry => entry.name === 'Demo MCP');
  assert.equal(stored.command, 'node');
  assert.equal(stored.enabled, true);
  assert.ok(String(stored.id).startsWith('mcp_'));

  const enrich = await server.request('tools/call', {
    name: 'install_mcp_server',
    arguments: { name: 'Demo MCP', command: 'node', args: ['-e', 'console.log(1)'], verify: false, description: '本地演示用 MCP：提供一个 echo 工具' }
  });
  assert.equal(enrich.result.structuredContent.installed, false);
  assert.equal(enrich.result.structuredContent.action, 'enrich');
  assert.equal(enrich.result.structuredContent.server.description, '本地演示用 MCP：提供一个 echo 工具');
  assert.equal(
    readMcpConfig(configPath).config.mcpServers.find(entry => entry.name === 'Demo MCP').description,
    '本地演示用 MCP：提供一个 echo 工具'
  );

  const duplicate = await server.request('tools/call', {
    name: 'install_mcp_server',
    arguments: { name: 'Demo MCP', command: 'node', args: ['-e', 'console.log(1)'], verify: false, description: '不应覆盖' }
  });
  assert.equal(duplicate.result.structuredContent.installed, false);
  assert.equal(duplicate.result.structuredContent.action, 'exists');
  assert.equal(
    readMcpConfig(configPath).config.mcpServers.find(entry => entry.name === 'Demo MCP').description,
    '本地演示用 MCP：提供一个 echo 工具'
  );

  const builtinClash = await server.request('tools/call', {
    name: 'install_mcp_server',
    arguments: { name: 'Playwright', command: 'node', args: ['-e', '1'], verify: false }
  });
  assert.equal(builtinClash.result.structuredContent.ok, false);

  const removedBuiltin = await server.request('tools/call', {
    name: 'remove_mcp_server',
    arguments: { id: 'mcp_default_playwright' }
  });
  assert.equal(removedBuiltin.result.structuredContent.ok, false);

  const removed = await server.request('tools/call', {
    name: 'remove_mcp_server',
    arguments: { name: 'Demo MCP' }
  });
  assert.equal(removed.result.structuredContent.removed, true);
  assert.equal(readMcpConfig(configPath).config.mcpServers.length, 1);

  const finalList = await server.request('tools/call', { name: 'list_mcp_servers', arguments: {} });
  assert.equal(finalList.result.structuredContent.servers.length, 1);
  assert.equal(
    finalList.result.structuredContent.servers.find(entry => entry.builtin === true).description,
    ''
  );
});

// ---------------------------------------------------------------------------
// Product wiring: bundled Skill + per-run auto-load
// ---------------------------------------------------------------------------

test('bundled MCP-Puller Skill is installed and listed by the real load path', async (t) => {
  const stubDataDir = tempDir(t, 'yan-main-stub-');
  // A real installation always has a config file; its presence is what makes
  // loadConfig run ensureBundledAgentSkills and seed bundled Skills.
  const yanDataDir = path.join(stubDataDir, 'YanData');
  fs.mkdirSync(yanDataDir, { recursive: true });
  fs.writeFileSync(path.join(yanDataDir, 'config.json'), JSON.stringify({ api: {}, agent: {}, mcpServers: [] }, null, 2), 'utf8');
  const electronStub = {
    app: {
      getPath: () => stubDataDir,
      getName: () => 'yan-agent',
      getVersion: () => '1.7.0',
      getLocale: () => 'zh',
      getPreferredSystemLanguages: () => ['zh-CN'],
      isReady: () => false,
      requestSingleInstanceLock: () => true,
      setAppUserModelId: () => {},
      on: () => {},
      once: () => {},
      whenReady: () => new Promise(() => {}),
      commandLine: { appendSwitch: () => {}, appendArgument: () => {}, hasSwitch: () => false },
      isPackaged: false,
      getAppPath: () => stubDataDir,
      getLoginItemSettings: () => ({}),
      setLoginItemSettings: () => {}
    },
    BrowserWindow: class StubWindow {},
    Tray: class StubTray {},
    ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {} },
    ipcRenderer: {},
    dialog: {},
    shell: {},
    Menu: { buildFromTemplate: () => null, setApplicationMenu: () => {} },
    nativeImage: { createFromPath: () => ({}), createEmpty: () => ({}) },
    nativeTheme: { on: () => {}, removeListener: () => {}, shouldUseDarkColors: false, shouldUseDarkColorsForSystemIntegratedUI: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.from(''), decryptString: () => '' },
    desktopCapturer: { getSources: async () => [] },
    webContents: { fromId: () => null },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } })
    },
    session: { defaultSession: { setSpellCheckerEnabled: () => {} } },
    clipboard: {},
    globalShortcut: { register: () => false, isRegistered: () => false, unregister: () => {}, unregisterAll: () => {} },
    net: {}
  };
  const originalLoad = Module._load;
  Module._load = function stubbedLoad(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  let main;
  try {
    process.env.YAN_MAIN_TEST_EXPORTS = '1';
    main = require(path.join(appRoot, 'main.js'));
  } finally {
    Module._load = originalLoad;
  }

  assert.ok(main?.__test, 'main.js test exports missing');
  const cfg = main.__test.configStore.loadConfig();
  const skills = main.__test.getMergedSkills(cfg);
  const puller = skills.find(skill => skill.id === 'mcp-puller');
  assert.ok(puller, 'bundled MCP-Puller Skill is missing from the merged skill list');
  assert.equal(puller.source, 'bundled');

  const servers = main.__test.getOpenCodeMcpServers({}, { workspace: '', workMode: 'normal' });
  const yanMcp = servers.find(server => server.id === 'yan_mcp');
  assert.ok(yanMcp, 'yan_mcp server is missing from the per-run MCP list');
  assert.equal(yanMcp.builtin, true);
  assert.ok(yanMcp.command);

  // Configured MCPs are external and heavy: every one is deferred so the kernel
  // never connects it at boot, while the entry stays registered for activation.
  const configuredCfg = {
    mcpServers: [
      { id: 'mcp_1790004857986', name: 'ReactBits MCP', command: 'npx', args: ['-y', 'react-bits-mcp-server'], enabled: true },
      { id: 'mcp_default_codegraph', name: 'CodeGraph', command: 'codegraph', runtime: 'codegraph', enabled: true }
    ]
  };
  const configured = main.__test.getOpenCodeMcpServers(configuredCfg, { workspace: '', workMode: 'normal' });
  for (const id of ['mcp_1790004857986', 'mcp_default_codegraph']) {
    const server = configured.find(item => item.id === id);
    assert.equal(server?.deferred, true, `${id} must be deferred (never connected at kernel boot)`);
  }
  const { buildOpenCodeConfig } = require(path.join(appRoot, 'lib', 'opencode-sidecar.js'));
  const kernelConfig = buildOpenCodeConfig({ providerId: 'p', modelId: 'm', mcpServers: configured });
  assert.equal(kernelConfig.mcp.mcp_1790004857986.enabled, false);
  assert.equal(kernelConfig.mcp.mcp_default_codegraph.enabled, false);
  assert.equal(kernelConfig.mcp.yan_mcp.enabled, true);
});

test('selectedRunSkills leaves MCP-Puller on demand and honors explicit selection', async (t) => {
  const directory = tempDir(t, 'yan-skills-runtime-');
  const { registerSkillsRuntime } = require(path.join(appRoot, 'lib', 'main', 'skills-runtime.js'));
  const cfg = { customSkills: [], workspace: '' };
  const reads = [];
  const runtime = registerSkillsRuntime(
    { ipcMain: { handle: () => {} }, shell: {} },
    {
      appRoot,
      dataDir: directory,
      skillsDir: path.join(directory, 'skills'),
      skillRegistry: {
        isSkillEnabled: () => true,
        readSkillWithRetry: async id => { reads.push(id); return (id === 'mcp-puller'
          ? { ok: true, id: 'mcp-puller', name: 'MCP-Puller', desc: 'policy', prompt: 'POLICY BODY', aliases: ['安装 MCP'], requires: [] }
          : { ok: false, id, error: 'not installed' }); },
        invalidateInstalledSkillsCache: () => {},
        syncSkillStore: () => ({ ok: true })
      },
      configStore: { loadConfig: () => cfg, saveConfig: () => {} },
      getMergedSkills: () => [],
      skillEvolution: {},
      continualHarness: {},
      harnessPolicy: {},
      DEFAULT_SKILLS: [],
      mcpRuntimeConfig: {
        selectedSkillIds: skills => new Set((skills || []).map(skill => String(skill?.id || skill).trim().toLowerCase())),
        // selectedRunSkills now enforces `requires` against the configured MCP
        // list. These ids carry no mcp requirement, so the stub only needs to
        // answer "nothing is unmet".
        unmetSkillRequirements: () => []
      },
      getMainWindow: () => null,
      invalidateSidecar: () => {}
    }
  );

  const result = await runtime.selectedRunSkills([], cfg, { workspace: '', workMode: 'normal' });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.skippedSkills, []);
  assert.deepEqual(reads, [], 'An ordinary run must not even read the MCP-Puller body');
  const goal = await runtime.selectedRunSkills([], cfg, { workspace: directory, workMode: 'goal' });
  assert.equal(goal.skills.some(skill => skill.id === 'mcp-puller'), false);
  assert.equal(reads.includes('mcp-puller'), false);

  const requested = await runtime.selectedRunSkills([{ id: 'mcp-puller' }], cfg, { workspace: '', workMode: 'normal' });
  assert.equal(requested.skills.filter(skill => skill.id === 'mcp-puller').length, 1);
  assert.equal(requested.skills[0].prompt, 'POLICY BODY');
  assert.notEqual(requested.skills[0].autoLoaded, true);
});

test('an auto-loaded Skill never turns an ordinary run into a Skill read-only run', () => {
  const { isSelectedSkillReadOnlyRequest } = require(path.join(appRoot, 'lib', 'opencode-sidecar.js'));
  const prompt = '读取这个 skill，不要做其他';
  assert.equal(
    isSelectedSkillReadOnlyRequest({ prompt, selectedSkills: [{ id: 'mcp-puller', prompt: 'POLICY', autoLoaded: true }] }),
    false
  );
  assert.equal(
    isSelectedSkillReadOnlyRequest({ prompt, selectedSkills: [{ id: 'some-skill', prompt: 'BODY' }] }),
    true
  );
});

test('Blank runs may install an MCP server without a workspace', () => {
  const sidecar = require(path.join(appRoot, 'lib', 'opencode-sidecar.js'));
  const blankSystem = sidecar.workspaceSystem({ hasUserWorkspace: false });
  assert.match(blankSystem, /yan_mcp_install_mcp_server/);
  assert.match(blankSystem, /never ask the user for a workspace just to install an MCP server/);

  const config = {
    accessMode: 'request',
    workMode: 'normal',
    permissions: {},
    mcpServers: [{ id: 'yan_mcp', name: 'Yan MCP', enabled: true, command: process.execPath, args: ['yan-mcp-mcp.js'], runtime: 'yan-mcp' }]
  };
  const blankRules = sidecar.sessionPermissionForRun({ ...config, hasUserWorkspace: false });
  const blankRule = blankRules.find(rule => rule.permission === 'yan_mcp_*');
  assert.ok(blankRule, 'yan_mcp_* permission rule is missing in Blank');
  assert.notEqual(blankRule.action, 'deny');

  const workspaceRules = sidecar.sessionPermissionForRun({ ...config, hasUserWorkspace: true });
  assert.deepEqual(
    workspaceRules.find(rule => rule.permission === 'yan_mcp_*'),
    blankRule
  );
});

test('deferred MCP is registered disabled so the kernel never connects it at boot', () => {
  const { buildOpenCodeConfig } = require(path.join(appRoot, 'lib', 'opencode-sidecar.js'));
  const config = buildOpenCodeConfig({
    providerId: 'yan-provider',
    modelId: 'test-model',
    mcpServers: [
      { id: 'mcp_default_playwright', name: 'Playwright', command: 'npx', args: ['-y', '@playwright/mcp@latest'], enabled: true, deferred: true },
      { id: 'yan_web', name: 'Yan Web Fetch', command: process.execPath, args: ['yan-web-mcp.js'], enabled: true }
    ]
  });
  assert.equal(config.mcp.mcp_default_playwright.enabled, false);
  assert.equal(config.mcp.yan_web.enabled, true);
});

test('activate_mcp_server connects a deferred MCP to the running kernel', async (t) => {
  const directory = tempDir(t, 'yan-mcp-activate-');
  const configPath = writeConfig(directory, {
    mcpServers: [{ id: 'mcp_default_playwright', name: 'Playwright', builtin: true, command: 'npx', args: ['-y', '@playwright/mcp@latest'], enabled: true, deferred: true }]
  });
  // Activation resolves Playwright against the browser its plugin installed
  // beside config.json, so the fixture seeds an installed runtime there.
  const executable = path.join(directory, 'runtimes', 'playwright', 'browsers', 'chromium-1247', 'chrome-win64', 'chrome.exe');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, 'fixture');
  fs.writeFileSync(path.join(directory, 'runtimes', 'playwright', 'installed.json'), JSON.stringify({
    mcpVersion: require(path.join(appRoot, 'lib', 'playwright-runtime.js')).MCP_VERSION,
    browserExecutable: 'chromium-1247/chrome-win64/chrome.exe'
  }));
  const http = require('node:http');
  const calls = [];
  const kernel = http.createServer((req, res) => {
    calls.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.method === 'POST' ? true : { mcp_default_playwright: { status: 'connected' } }));
  });
  await new Promise(resolve => kernel.listen(0, '127.0.0.1', resolve));
  t.after(() => kernel.close());
  const kernelPort = kernel.address().port;
  const endpointsDir = path.join(directory, 'endpoints');
  fs.mkdirSync(endpointsDir, { recursive: true });
  fs.writeFileSync(path.join(endpointsDir, `${kernelPort}.json`), JSON.stringify({
    url: `http://127.0.0.1:${kernelPort}`,
    username: 'opencode',
    password: 'secret'
  }), 'utf8');

  const server = startYanMcp(configPath, { YAN_MCP_KERNEL_ENDPOINTS_DIR: endpointsDir });
  t.after(() => server.stop());
  await server.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  server.notify('notifications/initialized');

  const activated = await server.request('tools/call', {
    name: 'activate_mcp_server',
    arguments: { id: 'mcp_default_playwright' }
  });
  const payload = activated.result.structuredContent;
  assert.equal(payload.ok, true);
  assert.equal(payload.connected, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'POST');
  const connectUrl = new URL(calls[0].url, 'http://localhost');
  assert.equal(connectUrl.pathname, '/mcp/mcp_default_playwright/connect');
  assert.equal(connectUrl.searchParams.get('directory'), appRoot);
  assert.match(calls[0].auth, /^Basic /);
  assert.equal(calls[1].method, 'GET');
  const statusUrl = new URL(calls[1].url, 'http://localhost');
  assert.equal(statusUrl.pathname, '/mcp');
  assert.equal(statusUrl.searchParams.get('directory'), appRoot);
});

for (const state of [
  { status: 'failed', error: 'MCP initialization failed' },
  { status: 'needs_auth' },
  { status: 'disabled' },
  null
]) {
  test(`activate_mcp_server does not report HTTP success as connected (${state?.status || 'missing'})`, async t => {
    const directory = tempDir(t, 'yan-mcp-activate-status-');
    const configPath = writeConfig(directory, { mcpServers: [] });
    const kernel = require('node:http').createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.method === 'POST' ? true : (state ? { demo: state } : {})));
    });
    await new Promise(resolve => kernel.listen(0, '127.0.0.1', resolve));
    t.after(() => kernel.close());
    const endpointsDir = path.join(directory, 'endpoints');
    fs.mkdirSync(endpointsDir);
    fs.writeFileSync(path.join(endpointsDir, 'kernel.json'), JSON.stringify({
      url: `http://127.0.0.1:${kernel.address().port}`, username: 'test', password: 'test'
    }));
    const server = startYanMcp(configPath, { YAN_MCP_KERNEL_ENDPOINTS_DIR: endpointsDir });
    t.after(() => server.stop());
    const result = await server.request('tools/call', { name: 'activate_mcp_server', arguments: { id: 'demo' } });
    assert.equal(result.result.structuredContent.ok, false);
    assert.equal(result.result.structuredContent.connected, 0);
    assert.equal(result.result.isError, true);
    assert.match(result.result.structuredContent.results[0].detail, new RegExp(state?.error || state?.status || 'missing'));
  });
}

test('activate_mcp_server reports no running kernel when nothing is published', async (t) => {
  const directory = tempDir(t, 'yan-mcp-activate-none-');
  const configPath = writeConfig(directory, { mcpServers: [] });
  const endpointsDir = path.join(directory, 'endpoints');
  fs.mkdirSync(endpointsDir, { recursive: true });
  const server = startYanMcp(configPath, { YAN_MCP_KERNEL_ENDPOINTS_DIR: endpointsDir });
  t.after(() => server.stop());
  await server.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  server.notify('notifications/initialized');
  const activated = await server.request('tools/call', {
    name: 'activate_mcp_server',
    arguments: { id: 'mcp_default_playwright' }
  });
  const payload = activated.result.structuredContent;
  assert.equal(payload.ok, false);
  assert.match(payload.error, /内核/);
});
