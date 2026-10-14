'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { z } = require('zod');
const { createPluginSessions } = require('./sessions');
const { PluginMcpClient } = require('./mcp-client');
const computerUse = require('./computer-use');

function resolvedConfig(store, binding, server, nodeExecutable) {
  const manifest = store.manifest(binding);
  const configuration = Object.fromEntries(Object.entries(manifest.configuration).map(([key, field]) => [key, binding.configuration?.[key] ?? field.default ?? '']));
  const allowedEnv = new Set(manifest.environment.map(item => item.name));
  function expand(value) {
    return String(value).replace(/\$\{([^}]+)\}/g, (_, key) => {
      if (key === 'pluginRoot') return store.packageRoot(binding);
      if (key === 'yanAppRoot' && computerUse.trusted(binding)) return computerUse.appRoot;
      if (key === 'workspace') return binding.directory;
      if (key.startsWith('config.') && Object.hasOwn(configuration, key.slice(7))) return configuration[key.slice(7)];
      if (key.startsWith('env.') && allowedEnv.has(key.slice(4))) return Object.hasOwn(process.env, key.slice(4)) ? process.env[key.slice(4)] : '';
      throw new Error(`未声明的插件变量：${key}`);
    });
  }
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', ...allowedEnv]) if (Object.hasOwn(process.env, key) && process.env[key]) env[key] = process.env[key];
  Object.assign(env, Object.fromEntries(Object.entries(server.env).map(([key, value]) => [key, expand(value)])));
  if (server.command === '$node') env.ELECTRON_RUN_AS_NODE = '1';
  return { ...server, command: server.command === '$node' ? nodeExecutable : expand(server.command || ''),
    args: server.args.map(expand), url: expand(server.url || ''), cwd: store.packageRoot(binding), env,
    headers: Object.fromEntries(Object.entries(server.headers).map(([key, value]) => [key, expand(value)])) };
}

function createGateway({ dataDir, directory, sessionId, pluginId, token, nodeExecutable = process.execPath,
  imageInput = process.env.YAN_COMPUTER_IMAGE_INPUT === 'true' }) {
  const sessions = createPluginSessions(dataDir, directory, sessionId);
  const binding = sessions.get(pluginId);
  if (!binding || binding.token !== token) throw new Error('无效插件激活令牌');
  const clients = []; const routes = new Map(); let started;
  function assertActive() { sessions.authorize(binding); }
  async function start() {
    assertActive();
    if (!started) started = (async () => {
      try {
        const manifest = sessions.store.manifest(binding);
        for (const server of manifest.mcpServers) {
          const config = computerUse.resolveConfig(binding,
            resolvedConfig(sessions.store, binding, server, nodeExecutable), { dataDir, imageInput });
          if (server.auth === 'oauth') config.getHeaders = async forceRefresh => {
            assertActive();
            const broker = JSON.parse(fs.readFileSync(path.join(dataDir, 'plugins', 'account-broker.json'), 'utf8'));
            const url = new URL(broker.url);
            if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) throw new Error('账号连接不可用');
            const response = await fetch(`${url.origin}/token`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${binding.token}` },
              body: JSON.stringify({ directory, sessionId, pluginId, serverId: server.id, forceRefresh }), signal: AbortSignal.timeout(25000) });
            if (!response.ok) throw new Error('请在插件页重新连接账号');
            const data = await response.json();
            if (typeof data.accessToken !== 'string' || !data.accessToken || /[\r\n]/.test(data.accessToken)) throw new Error('无效账号授权');
            assertActive(); return { ...config.headers, Authorization: `Bearer ${data.accessToken}` };
          };
          const client = new PluginMcpClient(config); clients.push(client);
          const tools = await client.start();
          for (const tool of tools) {
            if (routes.size >= 200) throw new Error('单个插件超过 200 个工具，请拆分插件');
            if (typeof tool.name !== 'string' || !tool.name || tool.inputSchema?.type !== 'object') throw new Error('插件工具 schema 无效');
            const name = computerUse.trusted(binding) ? `computer_${tool.name}`
              : `t_${crypto.createHash('sha256').update(`${server.id}\0${tool.name}`).digest('hex').slice(0, 20)}`;
            if (routes.has(name)) throw new Error('插件返回重复工具');
            const validator = z.fromJSONSchema(tool.inputSchema);
            routes.set(name, { client, original: tool.name, validator,
              definition: { name, description: `[${manifest.name} / ${server.id} / ${tool.name}] ${String(tool.description || '').slice(0, 3000)}`, inputSchema: tool.inputSchema } });
          }
        }
        assertActive(); return [...routes.values()].map(item => item.definition);
      } catch (error) { close(); throw error; }
    })();
    return started;
  }
  async function call(name, args) {
    assertActive(); await start();
    const route = routes.get(name); if (!route) throw new Error('插件工具未注册');
    const checked = route.validator.safeParse(args);
    if (!checked.success) throw new Error('插件工具参数不符合 schema');
    const result = await route.client.request('tools/call', { name: route.original, arguments: args });
    assertActive(); return result;
  }
  function close() { return Promise.all(clients.map(client => client.close())); }
  return { start, call, close, assertActive };
}

if (require.main === module) {
  let gateway;
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  try {
    gateway = createGateway({ dataDir: process.env.YAN_PLUGIN_DATA_DIR, directory: process.env.YAN_PLUGIN_DIRECTORY,
      sessionId: process.env.YAN_PLUGIN_SESSION_ID, pluginId: process.env.YAN_PLUGIN_ID,
      token: process.env.YAN_PLUGIN_TOKEN, nodeExecutable: process.env.YAN_PLUGIN_NODE });
  } catch { process.exitCode = 1; }
  if (gateway) {
    const timer = setInterval(() => { try { gateway.assertActive(); } catch { clearInterval(timer); void gateway.close().finally(() => process.exit(0)); } }, 500);
    async function handle(message) {
      if (message.id === undefined) return;
      try {
        gateway.assertActive(); let result;
        if (message.method === 'initialize') {
          await gateway.start(); result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Yan Plugin Gateway', version: '1.0.0' } };
        } else if (message.method === 'tools/list') result = { tools: await gateway.start() };
        else if (message.method === 'tools/call') result = await gateway.call(message.params?.name, message.params?.arguments || {});
        else if (message.method === 'ping') result = {};
        else throw new Error('不支持的插件操作');
        send({ jsonrpc: '2.0', id: message.id, result });
      } catch (error) { send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } }); }
    }
    let buffer = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) { gateway.close(); process.exit(1); }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try { void handle(JSON.parse(line)); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }); }
      }
    });
    const shutdown = () => { clearInterval(timer); void gateway.close().finally(() => process.exit(0)); };
    process.stdin.on('end', shutdown); process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  }
}
module.exports = { createGateway, resolvedConfig };
