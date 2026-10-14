'use strict';

// MCP server lifecycle management (plan T5.2): process start/stop, the
// management config surface and the mcp:* IPC channels. Moved verbatim from
// main.js; the running-server map and the runtime config arrive as deps.

const crypto = require('crypto');
const path = require('path');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
const codeGraphRuntime = require('../codegraph-runtime');
const playwrightRuntime = require('../playwright-runtime');
const { isRemoteMcpServer, normalizeRemoteHeaders, probeRemoteServer } = require('../mcp-remote');
const { removeMcpServerFromMirror, allocateMcpServerId } = require('../mcp-installer');

function registerMcpManagement(ctx, deps) {
  const { ipcMain, shell } = ctx;
  const {
    app,
    appRoot,
    configPath,
    mcpServers,
    configStore,
    mcpRuntimeConfig,
    harnessBridge,
    getMainWindow,
    invalidateSidecar
  } = deps;
  const { mcpSend, mcpRequest, killProcessTree } = harnessBridge;
  const { getMcpManagementServers, getMcpServerConfig } = mcpRuntimeConfig;

  async function mcpStart(serverCfg) {
    const { id, command, args = [] } = serverCfg;
    if (mcpServers.has(id)) return { error: '已在运行' };

    // Windows 上 npx/node 需要通过 cmd /c 调用，且不能用 shell:true
    // 否则 shell 的额外输出会污染 JSON-RPC stdio 流
    // 对含空格的参数加双引号保护，避免 cmd 再次拆分
    let finalCommand = command;
    let finalArgs = args;
    let finalEnv = { ...process.env, ...(serverCfg.env || {}) };
    let finalCwd;
    if (serverCfg.runtime === 'playwright' || id === 'mcp_default_playwright') {
      // Chromium lives in user data next to config.json (installed by the plugin).
      const resolved = playwrightRuntime.resolveServer(serverCfg, appRoot, path.dirname(configPath));
      if (!resolved.ok) return { error: resolved.error };
      finalCommand = resolved.server.command;
      finalArgs = resolved.server.args;
      finalEnv = { ...finalEnv, ...resolved.server.env };
      // The installer can be launched from System32. A connection test has no
      // task workspace, so it must use writable app data rather than that cwd.
      finalCwd = path.join(app.getPath('userData'), 'YanData', 'mcp', 'playwright');
      try { await fsp.mkdir(finalCwd, { recursive: true }); }
      catch (error) { return { error: `无法创建 Playwright 测试目录：${error.message}` }; }
    }
    if (serverCfg.runtime === 'codegraph') {
      const runtime = codeGraphRuntime.resolveRuntime(appRoot);
      if (!runtime.ok) return { error: runtime.error };
      finalCommand = runtime.command;
      const alreadyResolved = runtime.args.every((value, index) => args[index] === value);
      finalArgs = alreadyResolved ? args : [...runtime.args, ...args];
      finalEnv = { ...finalEnv, ...runtime.env };
      finalCwd = app.getPath('home');
    }
    if (!finalCwd && process.platform === 'win32' && (command === 'npx' || command === 'node' || command === 'uvx' || command === 'uv')) {
      finalCommand = process.env.ComSpec || 'cmd.exe';
      // 仅对含空格的参数加双引号，防止 cmd.exe 按空格拆分
      // 不含空格的参数不加引号，否则 npm/npx 会把引号当作包名的一部分
      const quotedArgs = args.map(a => a.includes(' ') ? `"${a}"` : a);
      finalArgs = ['/c', command, ...quotedArgs];
    }

    try {
      const proc = spawn(finalCommand, finalArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: finalEnv,
        cwd: finalCwd,
        windowsHide: true,
        shell: false
      });

      // spawn 错误（如命令不存在）通过 error 事件触发，不是 try/catch
      // 使用可移除的监听器避免 Promise 泄漏
      let errHandler;
      const spawnError = new Promise((_, reject) => {
        errHandler = (err) => reject(err);
        proc.on('error', errHandler);
      });

      // stdin 的 EPIPE 等 IO 错误只会在 socket 上发 error 事件,没有监听器会直接抛
      // 未捕获异常击穿主进程,这里挂常驻兜底
      proc.stdin.on('error', (err) => {
        console.error(`[MCP ${id}] stdin 错误:`, err.message);
      });

      const server = {
        process: proc,
        stopping: false,
        tools: [],
        pending: new Map(),
        buffer: '',
        nextId: 1,
        decoder: new TextDecoder('utf-8'),
        stderr: '',
        requestTimeoutMs: (serverCfg.runtime === 'codegraph' || serverCfg.runtime === 'serena') ? 240000 : 30000
      };
      mcpServers.set(id, server);

      proc.stdout.on('data', (data) => {
        // 使用 TextDecoder 流式解码，避免多字节 UTF-8 字符在 data 边界被截断
        server.buffer += server.decoder.decode(data, { stream: true });
        // 防御无换行的超大输出:残留缓冲超过 32MB 时截断,避免字符串无上限增长拖垮主进程
        if (server.buffer.length > 32 * 1024 * 1024) {
          console.warn(`[MCP ${id}] stdout 缓冲超过 32MB,已截断`);
          server.buffer = server.buffer.slice(-1024 * 1024);
        }
        let idx;
        while ((idx = server.buffer.indexOf('\n')) >= 0) {
          const line = server.buffer.slice(0, idx).trim();
          server.buffer = server.buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id != null && server.pending.has(msg.id)) {
              const { resolve, reject, timer } = server.pending.get(msg.id);
              server.pending.delete(msg.id);
              if (timer) clearTimeout(timer);
              if (msg.error) reject(new Error(msg.error.message || 'MCP 错误'));
              else resolve(msg.result);
            } else if (msg.method) {
              // 处理通知消息（无 id），至少记录日志
              console.log(`[MCP ${id}] 通知:`, msg.method);
            }
          } catch (e) {
            console.log(`[MCP ${id}] 非 JSON 行:`, line.slice(0, 200));
          }
        }
      });

      proc.stderr.on('data', (data) => {
        const message = data.toString().trim();
        if (!message) return;
        server.stderr = (server.stderr + '\n' + message).slice(-4096);
        console.log(`[MCP ${id}] stderr:`, message);
      });

      proc.on('exit', (code) => {
        console.log(`[MCP ${id}] 进程退出，代码 ${code}`);
        // 通知渲染进程服务器已崩溃
        const win = getMainWindow();
        if (!server.stopping && mcpServers.get(id) === server && win && !win.isDestroyed()) {
          win.webContents.send('mcp:status', { id, status: 'crashed', code });
        }
        // 拒绝所有 pending 请求
        for (const [pid, { reject, timer }] of server.pending) {
          if (timer) clearTimeout(timer);
          const detail = server.stderr.trim();
          reject(new Error(`进程退出 (code ${code})${detail ? `\n${detail}` : ''}`));
        }
        server.pending.clear();
        if (mcpServers.get(id) === server) mcpServers.delete(id);
      });

      // 初始化握手（与 spawn 错误竞争，先到先处理）
      const initPromise = harnessBridge.mcpRequest(server, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'Yan Agent', version: app.getVersion() }
      });

      await Promise.race([initPromise, spawnError]);
      // race 结束后把一次性 spawn 监听器换成常驻兜底监听器:
      // 直接 off 会让后续 error 事件无监听器而抛异常;保留 errHandler 又会让
      // spawnError 在 race 之后 reject 形成未处理 rejection,两种都会击穿主进程
      proc.off('error', errHandler);
      proc.on('error', (err) => {
        console.error(`[MCP ${id}] 进程错误:`, err.message);
      });

      // 发送 initialized 通知
      harnessBridge.mcpSend(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });

      // 列出工具
      const toolsResult = await harnessBridge.mcpRequest(server, 'tools/list', {});
      server.tools = toolsResult.tools || [];

      return { ok: true, tools: server.tools };
    } catch (e) {
      // 握手/列工具失败时子进程可能仍在运行,必须杀掉整棵树,否则每次重试都泄漏一个孤儿
      const failed = mcpServers.get(id);
      mcpServers.delete(id);
      harnessBridge.killProcessTree(failed && failed.process);
      return { error: e.message };
    }
  }

  function mcpStop(id) {
    const server = mcpServers.get(id);
    if (!server) return;
    server.stopping = true;
    harnessBridge.killProcessTree(server.process);
    // 拒绝所有 pending 请求，清理 timer
    for (const [pid, { reject, timer }] of server.pending) {
      if (timer) clearTimeout(timer);
      reject(new Error('服务器已停止'));
    }
    server.pending.clear();
    mcpServers.delete(id);
  }

  // MCP 配置管理

  ipcMain.handle('mcp:list', () => mcpRuntimeConfig.getMcpManagementServers(configStore.loadConfig()));
  ipcMain.handle('mcp:open-directory', async (_e, id) => {
    const cfg = configStore.loadConfig();
    const server = getMcpServerConfig(cfg, id) || getMcpManagementServers(cfg).find(item => item.id === id);
    if (!server) return { ok: false, error: '未找到 MCP 服务。' };
    try {
      // Local servers may point to a script or working directory. Remote and
      // package-runner servers have a local configuration, not an install folder.
      const candidates = isRemoteMcpServer(server) ? [] : [server.cwd,
        ...(Array.isArray(server.args) ? server.args.filter(arg => /\.(?:[cm]?js|py|exe)$/i.test(String(arg))) : []),
        server.command];
      let directory = path.dirname(configPath);
      for (const candidate of candidates) {
        if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) continue;
        const nativePath = candidate.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
        const stat = await fsp.stat(nativePath).catch(() => null);
        if (!stat) continue;
        directory = stat.isDirectory() ? nativePath : path.dirname(nativePath);
        break;
      }
      const error = await shell.openPath(directory);
      return error ? { ok: false, error } : { ok: true, path: directory };
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  });
  function buildUserMcpServer(input = {}, options = {}) {
    const name = String(input.name || '').trim();
    if (!name) return { error: '请输入 MCP 名称。' };
    // Allocation runs against the *whole* saved list, so the id stays unique even
    // when two servers are created in the same millisecond. `existing` lets the
    // caller pass the config it already loaded instead of re-reading it.
    const existing = Array.isArray(options.existing) ? options.existing : configStore.loadConfig()?.mcpServers;
    const id = allocateMcpServerId(existing);
    if (String(input.type || '').trim().toLowerCase() === 'remote') {
      const url = String(input.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return { error: '远程 MCP 地址必须以 http:// 或 https:// 开头。' };
      const headers = normalizeRemoteHeaders(input.headers);
      return {
        id,
        name,
        type: 'remote',
        url,
        ...(Object.keys(headers).length ? { headers } : {}),
        enabled: true
      };
    }
    const command = String(input.command || '').trim();
    if (!command) return { error: '请输入启动命令。' };
    return {
      id,
      name,
      command,
      args: Array.isArray(input.args) ? input.args.map(String) : [],
      enabled: true
    };
  }

  // A running kernel is keyed by its config signature, so any edit to
  // cfg.mcpServers produces a *different* signature -- but the kernels already
  // serving the old signature keep their old MCP clients (and therefore their
  // old tool set) until they are invalidated or happen to be evicted. Without
  // this, removing a server leaves its tools callable for the rest of the
  // session. invalidate() only marks idle kernels; an in-flight run is left
  // alone and picks up the new config on its next kernel acquisition.
  function invalidateMcpRuntime() {
    try {
      invalidateSidecar?.();
    } catch (error) {
      console.warn(`[MCP] sidecar invalidation failed: ${error.message}`);
    }
  }

  ipcMain.handle('mcp:add', (_e, input = {}) => {
    const cfg = configStore.loadConfig();
    if (!cfg.mcpServers) cfg.mcpServers = [];
    const server = buildUserMcpServer(input, { existing: cfg.mcpServers });
    if (server.error) return { error: server.error };
    cfg.mcpServers.push(server);
    configStore.saveConfig(cfg);
    invalidateMcpRuntime();
    return server;
  });
  ipcMain.handle('mcp:remove', (_e, id) => {
    const cfg = configStore.loadConfig();
    const target = (cfg.mcpServers || []).find(s => s.id === id);
    if (target?.builtin) return { error: '预装 MCP 服务器不可删除' };
    mcpStop(id);
    // Clearing the mirror too keeps ensureDefaultMcp from merging an
    // agent-installed server back after the user removed it here.
    removeMcpServerFromMirror(configPath, id);
    cfg.mcpServers = (cfg.mcpServers || []).filter(s => s.id !== id);
    configStore.saveConfig(cfg);
    invalidateMcpRuntime();
    return true;
  });
  ipcMain.handle('mcp:update', (_e, { id, ...changes }) => {
    const cfg = configStore.loadConfig();
    const servers = cfg.mcpServers || [];
    const idx = servers.findIndex(s => s.id === id);
    if (idx >= 0) {
      servers[idx] = { ...servers[idx], ...changes };
      configStore.saveConfig(cfg);
      // A disabled/enabled flip or a command change must not keep serving the
      // previous tool set from a warm kernel.
      mcpStop(id);
      invalidateMcpRuntime();
      return servers[idx];
    }
    return null;
  });

  ipcMain.handle('mcp:test', async (_e, form = {}) => {
    if (isRemoteMcpServer(form)) {
      return probeRemoteServer(form, { clientVersion: app.getVersion() });
    }
    const id = `mcp_test_${crypto.randomUUID()}`;
    try {
      return await mcpStart({
        id,
        name: String(form?.name || ''),
        command: String(form?.command || ''),
        args: Array.isArray(form?.args) ? form.args : [],
        ...(form.runtime === 'playwright' || form.id === 'mcp_default_playwright' ? { runtime: 'playwright' } : {}),
        enabled: true
      });
    } finally {
      mcpStop(id);
    }
  });

  // MCP 运行时
  ipcMain.handle('mcp:start', async (_e, id) => {
    const cfg = configStore.loadConfig();
    const serverCfg = mcpRuntimeConfig.getMcpServerConfig(cfg, id);
    if (!serverCfg) return { error: '未找到服务器配置' };
    if (isRemoteMcpServer(serverCfg)) {
      return probeRemoteServer(serverCfg, { clientVersion: app.getVersion() });
    }
    return mcpStart(serverCfg);
  });
  ipcMain.handle('mcp:tools', async (_e, id) => {
    const running = mcpServers.get(id);
    if (running) return { ok: true, tools: running.tools || [] };
    const cfg = configStore.loadConfig();
    const serverCfg = mcpRuntimeConfig.getMcpServerConfig(cfg, id);
    if (!serverCfg) return { error: '未找到服务器配置' };
    if (isRemoteMcpServer(serverCfg)) {
      return probeRemoteServer(serverCfg, { clientVersion: app.getVersion() });
    }
    return mcpStart(serverCfg);
  });
  ipcMain.handle('mcp:stop', (_e, id) => {
    mcpStop(id);
    return { ok: true };
  });

  return {
    mcpStart,
    mcpStop,
    buildUserMcpServer,
  };
}

module.exports = { registerMcpManagement };
