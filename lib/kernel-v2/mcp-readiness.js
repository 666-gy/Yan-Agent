'use strict';
const { setTimeout: delay } = require('node:timers/promises');

const DEFAULT_RECONNECT_DELAYS = [250, 500, 1000];

// V2 starts connections asynchronously. Server readiness is distinct from the
// HTTP server being up; never admit a turn with a silently incomplete catalog.
// A crashed server used to stay `failed` until the whole app restarted. Every
// turn passes through this gate, so reconnect here: try the kernel's MCP
// connect endpoint, keep polling, and only fail closed after bounded attempts.
async function waitForMcp(client, config, directory, cancelled = () => false, options = {}) {
  const servers = config.mcp?.servers || {};
  const expected = Object.entries(servers).filter(([, server]) => !server.disabled);
  if (!expected.length) return;
  const budget = options.timeoutMs ?? Math.max(30000, ...expected.map(([, server]) => Number(server.timeout?.startup) || 0));
  const deadline = Date.now() + budget;
  const reconnect = options.reconnect !== false;
  const maxReconnects = Math.max(1, Number(options.maxReconnects) || 3);
  const reconnectDelays = Array.isArray(options.reconnectDelays) && options.reconnectDelays.length
    ? options.reconnectDelays
    : DEFAULT_RECONNECT_DELAYS;
  const reconnectState = new Map();
  let pending = expected.map(([name]) => name);
  const signal = options.signal;
  const wait = ms => delay(ms, undefined, signal ? { signal } : undefined);
  const notExecuted = options.forTool ? '工具调用尚未执行。' : '尚未提交模型请求。';

  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (cancelled()) return;
    let result;
    try {
      const timeout = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
      result = await client.mcp.list({ location: { directory } }, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (error) {
      signal?.throwIfAborted();
      if (Date.now() >= deadline) throw error;
      await wait(Math.min(100, Math.max(1, deadline - Date.now())));
      continue;
    }
    const actual = new Map(result.data.map(server => [server.name || server.id, server.status]));
    pending = [];
    for (const [name] of expected) {
      const status = actual.get(name)?.status;
      if (status === 'connected') {
        reconnectState.delete(name);
        continue;
      }
      if (status === 'needs_auth' || status === 'disabled') {
        throw new Error(`MCP ${name} 未就绪（${status}），${notExecuted}请检查该服务连接后重试。`);
      }
      if (status === 'failed') {
        if (!reconnect) {
          throw new Error(`MCP ${name} 未就绪（failed），${notExecuted}请检查该服务连接后重试。`);
        }
        const state = reconnectState.get(name) || { attempts: 0, nextAt: 0, error: '' };
        if (state.attempts >= maxReconnects) {
          throw new Error(`MCP ${name} 未就绪（failed），已自动重连 ${maxReconnects} 次仍失败${state.error ? `：${state.error}` : ''}。${notExecuted}请检查该服务连接后重试。`);
        }
        if (Date.now() >= state.nextAt) {
          state.attempts += 1;
          state.nextAt = Date.now() + (Number(reconnectDelays[state.attempts - 1]) || 1000);
          reconnectState.set(name, state);
          console.warn(`[MCP] ${name} failed; reconnecting (${state.attempts}/${maxReconnects})`);
          try {
            // A crashed local server can keep a stale failed handle. Drop it
            // first so connect() starts a fresh process instead of no-oping.
            await client.mcp.disconnect?.({ server: name, location: { directory } }, { signal });
          } catch { /* a dead server may already be disconnected */ }
          try {
            await client.mcp.connect({ server: name, location: { directory } }, { signal });
          } catch (error) {
            state.error = error?.message || String(error);
            reconnectState.set(name, state);
          }
        }
        pending.push(name);
        continue;
      }
      pending.push(name);
    }
    // Pinned V2 debounces MCP -> tool registry reload by 100 ms. Allow it to
    // settle; the context hook independently checks the actual built-in tools
    // and fails closed if a busy runtime has not published them yet.
    if (!pending.length) { await wait(250); return; }
    await wait(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`MCP 启动超时：${pending.join(', ')}。${notExecuted}避免工具缺失时错误执行。`);
}

module.exports = { waitForMcp };
