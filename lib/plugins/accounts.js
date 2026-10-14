'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { auth } = require('@modelcontextprotocol/sdk/client/auth.js');
const { atomicJson } = require('./store');
const { accountKey, accountStatus } = require('./auth-state');
const { createPluginSessions } = require('./sessions');

function createPluginAccounts({ dataDir, store, safeStorage, openExternal, changed = () => {}, fetcher = fetch, allowHttp = false }) {
  const folder = path.join(dataDir, 'plugins');
  const statusFile = path.join(folder, 'account-status.json');
  const callbacks = new Map(), locks = new Map(), generations = new Map();
  let server, listening, baseUrl, closed = false;
  function validateUrl(value) {
    const url = new URL(value);
    if (url.username || url.password || (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:' && url.hostname === '127.0.0.1'))) throw new Error('账号服务必须使用 HTTPS');
    return url;
  }
  async function authFetch(url, options = {}) {
    validateUrl(String(url));
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
    // Do not forward authorization headers to redirect targets.
    return fetcher(url, { ...options, signal, redirect: 'error' });
  }
  function status(id, service, state, message = '') {
    let all = {};
    try { all = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch {}
    all[accountKey(id, service)] = { state, message, updatedAt: Date.now() };
    atomicJson(statusFile, all); changed();
  }
  function secureStorage() {
    if (!safeStorage?.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('系统加密存储不可用，无法保存账号授权。');
  }
  function credentialsFile(key) { return path.join(folder, 'accounts', `${key}.json`); }
  function read(key) {
    secureStorage(); const file = credentialsFile(key);
    if (!fs.existsSync(file)) return {};
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
    return JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64')));
  }
  function write(key, data) { secureStorage(); atomicJson(credentialsFile(key), { version: 1, encrypted: safeStorage.encryptString(JSON.stringify(data)).toString('base64') }); }
  function serviceFor(id, serviceId) {
    const record = store.get(id); if (!record) throw new Error('插件未安装');
    const service = store.manifest(record).mcpServers.find(service => service.auth === 'oauth' && (!serviceId || service.id === serviceId));
    if (!service) throw new Error('插件没有需要连接的账号服务');
    return service;
  }
  function locked(key, work) {
    const previous = locks.get(key) || Promise.resolve();
    const promise = previous.catch(() => {}).then(work).finally(() => { if (locks.get(key) === promise) locks.delete(key); });
    locks.set(key, promise); return promise;
  }
  function provider(id, service, record, key, flow) {
    const generation = generations.get(key) || 0;
    const active = () => { if (closed || !store.get(id) || flow?.cancelled || generation !== (generations.get(key) || 0)) throw new Error('授权已取消'); };
    const save = () => { active(); write(key, record); };
    return {
      get redirectUrl() { return flow?.redirectUrl || record.redirectUrl; },
      get clientMetadata() { return { client_name: 'Yan Agent', redirect_uris: [flow?.redirectUrl || record.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: service.id === 'figma' ? 'client_secret_basic' : 'none' }; },
      state: () => flow?.state,
      clientInformation: () => record.client,
      saveClientInformation: client => { record.client = client; record.redirectUrl = flow?.redirectUrl || record.redirectUrl; save(); },
      tokens: () => record.tokens,
      saveTokens: tokens => {
        record.tokens = { ...tokens, refresh_token: tokens.refresh_token || record.tokens?.refresh_token };
        record.expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;
        save(); status(id, service, 'connected', '账号已连接。');
      },
      saveCodeVerifier: value => { if (flow) flow.verifier = value; },
      codeVerifier: () => { if (!flow?.verifier) throw new Error('授权校验已过期'); return flow.verifier; },
      discoveryState: () => record.discovery,
      saveDiscoveryState: discovery => { record.discovery = discovery; save(); },
      invalidateCredentials: scope => {
        if (scope === 'all' || scope === 'client') delete record.client;
        if (scope === 'all' || scope === 'tokens') { delete record.tokens; delete record.expiresAt; }
        if (scope === 'all' || scope === 'discovery') delete record.discovery;
        save();
      },
      redirectToAuthorization: async url => {
        active();
        if (!flow) throw new Error('账号授权已过期，请在插件页重新连接。');
        validateUrl(String(url)); flow.authorizationUrl = String(url); await openExternal(String(url)); flow.browserOpened = true;
        status(id, service, 'connecting', '已在系统浏览器打开授权页，请完成登录或注册。');
      }
    };
  }
  function finish(flow) { clearTimeout(flow.timer); callbacks.delete(flow.path); flow.cancelled = true; }
  async function ensureServer() {
    if (closed) throw new Error('账号服务已关闭');
    if (listening) return listening;
    listening = new Promise((resolve, reject) => {
      server = http.createServer((request, response) => void handle(request, response));
      server.requestTimeout = 10000; server.headersTimeout = 10000;
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        atomicJson(path.join(folder, 'account-broker.json'), { url: baseUrl }); server.unref(); resolve();
      });
    }).catch(error => { listening = null; throw error; });
    return listening;
  }
  async function connect(id) {
    const service = serviceFor(id); const key = accountKey(id, service);
    return locked(key, async () => {
      for (const flow of callbacks.values()) if (flow.key === key && !flow.cancelled) {
        if (flow.authorizationUrl) await openExternal(flow.authorizationUrl);
        return { state: 'connecting', browserOpened: flow.browserOpened };
      }
      await ensureServer();
      let record;
      try { record = read(key); }
      catch { status(id, service, 'needs-auth', '系统加密存储不可用，请重试连接账号。'); throw new Error('系统加密存储不可用，请重试连接账号。'); }
      if (record.tokens?.access_token && record.expiresAt > Date.now() + 60000) { status(id, service, 'connected', '账号已连接。'); return { state: 'connected' }; }
      const token = crypto.randomBytes(24).toString('hex');
      const flow = { id, key, service, state: crypto.randomBytes(32).toString('hex'), path: `/callback/${token}`, browserOpened: false, cancelled: false };
      flow.redirectUrl = `${baseUrl}${flow.path}`;
      // Each interactive flow registers its exact loopback redirect URI.
      delete record.client; delete record.tokens; delete record.expiresAt;
      flow.provider = provider(id, service, record, key, flow);
      callbacks.set(flow.path, flow);
      flow.timer = setTimeout(() => { finish(flow); status(id, service, 'needs-auth', '授权已超时，请重新连接账号。'); }, 10 * 60 * 1000); flow.timer.unref();
      try {
        status(id, service, 'connecting', '正在打开官方授权页面…');
        await auth(flow.provider, { serverUrl: service.url, fetchFn: authFetch });
        return { state: 'connecting', browserOpened: flow.browserOpened };
      } catch {
        finish(flow); status(id, service, 'needs-auth', '暂时无法发起授权，请重试连接账号。');
        throw new Error('暂时无法发起官方授权，请检查网络后重试连接账号。');
      }
    });
  }
  async function accessToken(id, service, forceRefresh = false) {
    const key = accountKey(id, service);
    return locked(key, async () => {
      const record = read(key);
      if (!forceRefresh && record.tokens?.access_token && record.expiresAt > Date.now() + 60000) return record.tokens.access_token;
      if (!record.tokens?.refresh_token) { status(id, service, 'needs-auth', '请连接账号。'); throw new Error('请在插件页连接账号。'); }
      try {
        const result = await auth(provider(id, service, record, key), { serverUrl: service.url, fetchFn: authFetch });
        if (result !== 'AUTHORIZED' || !record.tokens?.access_token) throw new Error('Not authorized');
        return record.tokens.access_token;
      } catch { status(id, service, 'needs-auth', '账号授权已过期，请重新连接。'); throw new Error('账号授权已过期，请在插件页重新连接。'); }
    });
  }
  async function handle(request, response) {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    const url = new URL(request.url, baseUrl);
    try {
      if (request.method === 'GET' && callbacks.has(url.pathname)) {
        const flow = callbacks.get(url.pathname);
        if (url.searchParams.get('state') !== flow.state || flow.exchanging) { response.writeHead(400); response.end('Invalid authorization state'); return; }
        if (url.searchParams.has('error')) { finish(flow); status(flow.id, flow.service, 'needs-auth', '授权未完成，可以重新连接。'); response.end('Authorization cancelled. Return to Yan Agent.'); return; }
        const code = url.searchParams.get('code'); if (!code || code.length > 8192) throw new Error('Missing code');
        const issuer = url.searchParams.get('iss'); const expected = flow.provider.discoveryState()?.authorizationServerMetadata?.issuer;
        if (issuer && issuer !== expected) throw new Error('Issuer mismatch');
        flow.exchanging = true;
        try {
          await auth(flow.provider, { serverUrl: flow.service.url, authorizationCode: code, fetchFn: authFetch });
          response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.end('账号已连接，可以返回 Yan Agent。');
        } catch { status(flow.id, flow.service, 'needs-auth', '授权未完成，请重新连接。'); response.writeHead(400); response.end('Authorization failed. Return to Yan Agent and reconnect.'); }
        finally { finish(flow); }
        return;
      }
      if (request.method !== 'POST' || url.pathname !== '/token' || request.headers.origin || request.headers['content-type'] !== 'application/json') { response.writeHead(404); response.end(); return; }
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 16384) throw new Error('Request too large'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const sessions = createPluginSessions(dataDir, body.directory, body.sessionId);
      const binding = sessions.get(body.pluginId);
      if (!binding || request.headers.authorization !== `Bearer ${binding.token}`) throw new Error('Invalid binding');
      sessions.authorize(binding);
      const service = sessions.store.manifest(binding).mcpServers.find(item => item.id === body.serverId && item.auth === 'oauth');
      if (!service) throw new Error('Unknown account');
      const token = await accessToken(binding.id, service, body.forceRefresh === true);
      sessions.authorize(binding);
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ accessToken: token }));
    } catch { if (!response.headersSent) response.writeHead(403); response.end('Account access denied'); }
  }
  function disconnect(id) {
    const record = store.get(id); if (!record) return;
    let services;
    try { services = store.manifest(record).mcpServers; }
    catch { return; } // A damaged package must remain uninstallable.
    for (const service of services.filter(item => item.auth === 'oauth')) {
      const key = accountKey(id, service);
      generations.set(key, (generations.get(key) || 0) + 1);
      for (const flow of callbacks.values()) if (flow.key === key) finish(flow);
      const file = credentialsFile(key); if (fs.existsSync(file)) fs.unlinkSync(file);
      status(id, service, 'needs-auth', '账号已断开。');
    }
  }
  function close() { closed = true; for (const flow of callbacks.values()) finish(flow); server?.closeAllConnections(); server?.close(); }
  return { connect, disconnect, close, ensureServer, status: (id, service) => accountStatus(dataDir, id, service) };
}
module.exports = { createPluginAccounts };
