'use strict';

// Yan Plugin: the agent-facing backend for natural-language plugin
// installation and marketplace management.
//
// stdio JSON-RPC, same shape as the other yan-* MCP servers. It operates on the
// real YanData/plugins registry and marketplace registry that the plugin page
// also uses, so the management view and the Agent see the same state:
//
//   list_plugins             — installable catalog + added marketplaces + installed
//   add_plugin_marketplace   — add a marketplace from a Git source or local folder
//   install_plugin           — install one catalog/marketplace plugin by id
//   remove_plugin            — uninstall an installed plugin
//   remove_plugin_marketplace— remove a marketplace source the user added
//
// Installing copies a validated package; no install scripts or hooks run.
// Large runtime plugins (for example the Playwright Chromium bundle) are
// deliberately refused here and must be installed from the plugin page, which
// also registers their managed MCP server and frees the browser files.
//
// No prompt text is ever pattern-matched here: the tools are described well
// enough for the model to decide.

const path = require('path');
const { createPluginStore } = require('./plugins/store');
const { createPluginCatalog } = require('./plugins/catalog');

// Read from the environment at call time so an embedding test can point the
// handlers at a temporary data directory without reloading the module.
function dataDir() { return String(process.env.YAN_PLUGIN_DATA_DIR || '').trim(); }
function allowNetwork() { return process.env.YAN_PLUGIN_ALLOW_NETWORK !== 'false'; }

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan Plugin error') } });
}

function toolResult(id, result) {
  success(id, {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
    isError: result && result.ok === false
  });
}

function store() {
  if (!dataDir()) throw new Error('Yan Plugin 缺少插件数据目录（YAN_PLUGIN_DATA_DIR）。');
  return createPluginStore(dataDir());
}

function catalog() {
  // `fetcher` defaults to the global fetch inside installUpstream; the runtime
  // map stays empty so runtime entries are refused before they can half-install.
  return createPluginCatalog(store(), { fetcher: fetch, runtimes: {} });
}

function summarizeEntry(item) {
  return {
    id: String(item.id || ''),
    name: String(item.name || item.id || ''),
    description: String(item.description || ''),
    category: String(item.category || ''),
    installed: item.installed === true,
    source: item.marketId ? 'marketplace' : item.download ? 'download' : item.runtime ? 'runtime' : 'bundled',
    publisher: String(item.author || '')
  };
}

function listPlugins(input = {}) {
  const query = String(input.query || '').trim().toLowerCase();
  const offset = Math.max(0, Number(input.offset) || 0);
  const items = catalog().list().map(summarizeEntry)
    .filter(item => !query || JSON.stringify(item).toLowerCase().includes(query));
  return {
    ok: true,
    plugins: items.slice(offset, offset + 30),
    total: items.length,
    nextOffset: offset + 30 < items.length ? offset + 30 : null,
    marketplaces: catalog().markets(),
    note: '使用 install_plugin 安装（按 id）；某个 id 不在列表中时，可先用 add_plugin_marketplace 从 GitHub 仓库、Git URL 或本地文件夹添加来源。'
  };
}

async function addMarketplace(input = {}) {
  const source = String(input.source || '').trim();
  if (!source) return { ok: false, error: '缺少来源：需要 GitHub 仓库（owner/repo）、HTTPS/SSH Git URL 或本地文件夹路径。' };
  if (!allowNetwork() && !require('node:fs').existsSync(source)) return { ok: false, error: '当前会话不允许联网，无法从远端添加插件市场。' };
  const sparsePaths = Array.isArray(input.sparsePaths) ? input.sparsePaths.map(String)
    : String(input.sparsePaths || '').split(/\r?\n/);
  const result = await catalog().addMarketplace({ source, ref: String(input.ref || '').trim(), sparsePaths });
  return {
    ok: true,
    count: result.count,
    skipped: result.skipped || [],
    marketplaces: catalog().markets(),
    note: `已添加市场，共 ${result.count} 个插件。用 list_plugins 查看后，再按 id 调用 install_plugin 安装。`
  };
}

async function installPlugin(input = {}) {
  const id = String(input.id || '').trim();
  if (!id) return { ok: false, error: '缺少插件 id。' };
  const item = catalog().entry(id);
  if (item.runtime) {
    return { ok: false, error: `「${item.name || id}」包含大型运行时，请在 Yan 的“插件”页面安装；该页面会一并准备运行时并登记其托管 MCP 服务。` };
  }
  if (item.download && !allowNetwork()) return { ok: false, error: '当前会话不允许联网，无法下载该插件文件。' };
  const plugin = await catalog().install(id);
  return { ok: true, installed: true, id: plugin.id, name: plugin.name, version: plugin.version, enabled: plugin.enabled, ready: plugin.ready, issues: plugin.issues || [], note: '安装完成，默认关闭；在插件页启用后，Agent 可按任务需要加载该插件的能力。' };
}

async function removePlugin(input = {}) {
  const id = String(input.id || '').trim();
  if (!id) return { ok: false, error: '缺少插件 id。' };
  const result = await catalog().remove(id);
  return { ok: true, id: result.id, removed: result.removed === true, note: '已卸载。已下载的版本文件保留，会话不会因卸载而丢失已固定版本。' };
}

function removeMarketplace(input = {}) {
  let id = String(input.id || '').trim();
  const source = String(input.source || '').trim();
  const markets = catalog().markets();
  if (!id && source) id = markets.find(market => market.source === source)?.id || '';
  if (!id) return { ok: false, error: '缺少市场 id 或 source。', marketplaces: markets };
  const target = markets.find(market => market.id === id);
  if (!target) return { ok: false, error: '插件市场不存在（可能已被移除）。', marketplaces: markets };
  const result = catalog().removeMarketplace(id);
  return { ok: true, id: result.id, removed: true, source: result.source, count: result.count, marketplaces: catalog().markets(), note: '已移除该市场来源。已安装的插件不受影响，仍可在插件页管理。' };
}

function toolDefinitions() {
  return [
    {
      name: 'list_plugins',
      description: 'List installable Yan plugins: the built-in catalog plus every marketplace the user added, with each entry id, name, description, category, source and installed state, and the current marketplace sources. Read-only. Search by keyword with query; use offset to page. Call it before installing so an already installed plugin is not installed twice.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional keyword filter over id, name and description.' },
          offset: { type: 'number', description: 'Pagination offset; the response returns nextOffset.' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'add_plugin_marketplace',
      description: 'Add one plugin marketplace from a source: a GitHub repo (owner/repo), an HTTPS/SSH Git URL, or a local folder path. Optional ref pins a branch/tag/commit; sparsePaths limits which subdirectories are scanned for plugin manifests. Yan copies and validates the discovered packages without running any install script. Use this only when a wanted plugin is not already in list_plugins.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'GitHub repo (owner/repo), HTTPS/SSH Git URL, or a local folder path.' },
          ref: { type: 'string', description: 'Optional Git ref (branch, tag or commit) to pin.' },
          sparsePaths: { type: 'array', items: { type: 'string' }, description: 'Optional subdirectories (inside the source) that contain plugin packages.' }
        },
        required: ['source'],
        additionalProperties: false
      }
    },
    {
      name: 'install_plugin',
      description: 'Install one Yan plugin by its catalog/marketplace id (from list_plugins). Yan copies and hash-verifies the package; no install scripts or hooks run, and nothing is enabled automatically. Plugins that carry a large runtime (for example the Chromium-based Playwright plugin) are refused here — tell the user to install those from the plugin page.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Plugin id from list_plugins.' } },
        required: ['id'],
        additionalProperties: false
      }
    },
    {
      name: 'remove_plugin',
      description: 'Uninstall one installed Yan plugin by id. Downloaded version files are retained; the plugin immediately stops being offered to Agent sessions. This does not remove marketplace sources.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Installed plugin id.' } },
        required: ['id'],
        additionalProperties: false
      }
    },
    {
      name: 'remove_plugin_marketplace',
      description: 'Remove one plugin marketplace source that the user added, by id or source string (from list_plugins). Installed plugins from that marketplace keep working; only the source entry is removed.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Marketplace id from list_plugins.' },
          source: { type: 'string', description: 'Marketplace source string, used when id is unknown.' }
        },
        additionalProperties: false
      }
    }
  ];
}

async function callTool(request) {
  const name = String(request.params?.name || '');
  const input = request.params?.arguments && typeof request.params.arguments === 'object' ? request.params.arguments : {};
  try {
    let result;
    switch (name) {
      case 'list_plugins': result = listPlugins(input); break;
      case 'add_plugin_marketplace': result = await addMarketplace(input); break;
      case 'install_plugin': result = await installPlugin(input); break;
      case 'remove_plugin': result = removePlugin(input); break;
      case 'remove_plugin_marketplace': result = removeMarketplace(input); break;
      default: throw new Error(`Unknown Yan Plugin tool: ${name}`);
    }
    toolResult(request.id, result);
  } catch (error) {
    toolResult(request.id, { ok: false, error: error?.message || String(error), code: error?.code || 'YAN_PLUGIN_TOOL_FAILED' });
  }
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'initialize') {
    success(message.id, {
      protocolVersion: String(message.params?.protocolVersion || '2025-03-26'),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Yan Plugin', version: '1.0.0' }
    });
    return;
  }
  if (message.method === 'ping') { success(message.id, {}); return; }
  if (message.method === 'tools/list') { success(message.id, { tools: toolDefinitions() }); return; }
  if (message.method === 'tools/call') { await callTool(message); return; }
  if (message.id !== undefined) failure(message.id, -32601, `Unsupported method: ${message.method}`);
}

function serve() {
  let buffered = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffered += String(chunk || '');
    while (true) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) break;
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      try { void handle(JSON.parse(line)); }
      catch (error) { failure(null, -32700, error?.message || String(error)); }
    }
  });
}

if (require.main === module) serve();

// Exported for the plugin management tests; the MCP process itself only ever
// uses `serve` through the stdio loop above.
module.exports = { toolDefinitions, handle, listPlugins, addMarketplace, installPlugin, removePlugin, removeMarketplace };
