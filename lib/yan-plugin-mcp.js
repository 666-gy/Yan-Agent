'use strict';
const { createPluginStore } = require('./plugins/store');
const { createPluginCatalog } = require('./plugins/catalog');
const { installPackage } = require('./plugins/creation');
const { readRunContext } = require('./mcp-run-context');
function send(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
function success(id, result) { send({ jsonrpc: '2.0', id, result }); }
function failure(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }
function store() {
  const root = String(process.env.YAN_PLUGIN_DATA_DIR || '').trim();
  if (!root) throw new Error('缺少插件数据目录。');
  return createPluginStore(root);
}
function listPlugins() { return { ok: true, plugins: createPluginCatalog(store()).list(), installationAvailable: true }; }
function removePlugin(input = {}) { return createPluginCatalog(store()).remove(String(input.id || '')); }
async function installPlugin(input = {}) {
  const target = store();
  try {
    if (input.source_directory) {
      const context = readRunContext(String(process.env.YAN_PLUGIN_CONTEXT_DIR || ''), input.task_id);
      return await installPackage(input, context, target);
    }
    if (input.id) return { ok: true, installed: true, plugin: await createPluginCatalog(target, { fetcher: fetch }).install(String(input.id)) };
    throw new Error('请提供 Yan 插件目录的 source_directory 和 task_id，或内置插件 id。');
  } catch (error) {
    if (input.source_directory) return { ok: false, compatible: false, reason: error.message, migration: '此次失败来自格式、资源或权限检查，不是非官方来源限制。可检查并修复兼容副本后重试；不可跳过路径和资源校验。' };
    throw error;
  }
}
function toolDefinitions() { return [
  { name: 'list_plugins', description: '列出内置目录和当前已安装的 Yan 插件；返回 id、版本和状态，安装前先调用。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'install_plugin', description: '安装官方或第三方插件，不按作者拒绝。提供任务目录内的 source_directory 和 task_id。原生 Yan 包直接校验安装；Codex/Claude 包首次返回未适配说明及 compatibilityAvailable，告知用户兼容范围并获得同意后用 allow_compatibility=true 导入 Skill/MCP 副本。用户已明确要求硬兼容时说明范围后直接尝试，无需重复确认。未知格式应检查源码、制作兼容副本后重试，不得一概拒绝。hooks/UI/Agent 定义不会自动执行。也可用目录 id 安装。', inputSchema: { type: 'object', properties: { id: { type: 'string' }, source_directory: { type: 'string' }, task_id: { type: 'string' }, allow_compatibility: { type: 'boolean', description: '告知用户未适配及兼容范围后，用户同意尝试兼容时设为 true。' } }, additionalProperties: false } },
  { name: 'remove_plugin', description: '卸载已安装的 Yan 插件。', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } }
]; }
async function callTool(request) {
  let result;
  try {
    if (!['list_plugins', 'install_plugin', 'remove_plugin'].includes(request.params?.name)) throw new Error('未知 Yan Plugin 工具。');
    result = request.params.name === 'list_plugins' ? listPlugins()
      : request.params.name === 'install_plugin' ? await installPlugin(request.params.arguments)
        : { ok: true, ...await removePlugin(request.params.arguments) };
  } catch (error) { result = { ok: false, error: error.message }; }
  success(request.id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: result.ok === false });
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

if (process.env.YAN_MCP_CATALOG_ONLY === '1') require('./mcp-tool-catalog').emitCatalog(toolDefinitions);
if (require.main === module) serve();

module.exports = { toolDefinitions, handle, listPlugins };
