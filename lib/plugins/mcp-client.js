'use strict';
const { spawn } = require('node:child_process');
const { rpc } = require('../mcp-remote');
const PROTOCOL = '2025-03-26';
class PluginMcpClient {
  constructor(config) { this.config = config; this.pending = new Map(); this.id = 0; this.closed = false; this.controllers = new Set(); }
  async start() {
    if (this.config.type === 'local') {
      this.process = spawn(this.config.command, this.config.args, { cwd: this.config.cwd, env: this.config.env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.process.stdin.on('error', () => this.close());
      this.process.once('error', () => this.close()); this.process.once('exit', () => this.close());
      // Avoid leaking credentials from arbitrary server logs into model output.
      this.process.stderr.resume(); this.process.stdout.setEncoding('utf8');
      let buffer = '';
      this.process.stdout.on('data', chunk => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > (this.config.maxResponseBytes || 4 * 1024 * 1024)) { this.close(); return; }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          let message; try { message = JSON.parse(line); } catch { continue; }
          if (message.method && message.id !== undefined) {
            this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Client requests are not supported' } }) + '\n');
          } else if (this.pending.has(message.id)) {
            const p = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(p.timer);
            if (message.error) p.reject(new Error(`MCP ${this.config.id} 请求失败 (${message.error.code})`));
            else p.resolve(message.result);
          }
        }
      });
    }
    try {
      const init = await this.request('initialize', { protocolVersion: this.config.protocolVersion || PROTOCOL, capabilities: {}, clientInfo: { name: 'Yan Plugins', version: '1.0.0' } });
      this.protocolVersion = init.protocolVersion || PROTOCOL;
      await this.notify('notifications/initialized', {});
      const tools = []; const seenCursors = new Set(); let cursor;
      do {
        const page = await this.request('tools/list', cursor ? { cursor } : {});
        if (!Array.isArray(page.tools)) throw new Error('MCP tools/list 返回无效');
        tools.push(...page.tools);
        if (tools.length > 200) throw new Error('单个服务超过 200 个工具');
        cursor = page.nextCursor;
        if (cursor && seenCursors.has(cursor)) throw new Error('MCP 分页游标循环');
        if (cursor) seenCursors.add(cursor);
      } while (cursor);
      return tools;
    } catch (error) { this.close(); throw error; }
  }
  async remote(payload, expectResponse) {
    if (this.closed) throw new Error('插件连接已关闭');
    const controller = new AbortController(); this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const headers = this.config.getHeaders ? await this.config.getHeaders(false) : this.config.headers;
      let result = await rpc(this.config.url, payload, { headers, signal: controller.signal,
        sessionId: this.remoteSessionId, protocolVersion: this.protocolVersion, expectResponse });
      if (result.status === 401 && this.config.getHeaders) {
        result = await rpc(this.config.url, payload, { headers: await this.config.getHeaders(true), signal: controller.signal,
          sessionId: this.remoteSessionId, protocolVersion: this.protocolVersion, expectResponse });
      }
      this.remoteSessionId = result.sessionId || this.remoteSessionId;
      if (result.error || result.message?.error) throw new Error(`远程 MCP ${this.config.id} 请求失败，请检查连接和认证`);
      if (expectResponse && (!result.message || result.message.id !== payload.id)) throw new Error('远程 MCP 响应 ID 不匹配');
      return result.message?.result;
    } finally { clearTimeout(timer); this.controllers.delete(controller); }
  }
  request(method, params) {
    if (this.closed) return Promise.reject(new Error('插件连接已关闭'));
    const id = ++this.id; const payload = { jsonrpc: '2.0', id, method, params };
    if (this.config.type === 'remote') return this.remote(payload, true);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP ${this.config.id} 请求超时`)); this.close(); }, this.config.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify(payload) + '\n', error => { if (error) this.close(); });
    });
  }
  notify(method, params) {
    if (this.config.type === 'remote') return this.remote({ jsonrpc: '2.0', method, params }, false);
    this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  close() {
    if (this.closed) return this.closing || Promise.resolve(); this.closed = true;
    for (const controller of this.controllers) controller.abort();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('插件连接已关闭或被撤销')); }
    this.pending.clear();
    this.closing = new Promise(resolve => {
      const child = this.process;
      let timer;
      const done = () => { clearTimeout(timer); child?.stdin?.destroy(); child?.stdout?.destroy(); child?.stderr?.destroy(); resolve(); };
      if (!child || child.exitCode !== null || !child.pid) { done(); return; }
      child.once('exit', done);
      timer = setTimeout(() => { child.kill(); done(); }, 3000);
      if (process.platform === 'win32' && this.process.pid) {
        // CUA-launched applications belong to the user, not to the input worker.
        const args = ['/pid', String(this.process.pid), ...(this.config.killTree === false ? [] : ['/t']), '/f'];
        const killer = spawn('taskkill.exe', args, { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => this.process.kill());
      } else this.process.kill();
    });
    return this.closing;
  }
}
module.exports = { PluginMcpClient };
