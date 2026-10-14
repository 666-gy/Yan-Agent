'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { createPluginStore } = require('../lib/plugins/store');
const { createPluginAccounts } = require('../lib/plugins/accounts');
const { createPluginSessions } = require('../lib/plugins/sessions');
const { createGateway } = require('../lib/plugins/gateway');
const { registerPluginsRuntime } = require('../lib/main/plugins-runtime');

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-oauth-test-'));
  const dataDir = path.join(root, 'data'), source = path.join(root, 'source'); fs.mkdirSync(source);
  const browsers = [], clients = [], tokenRequests = [];
  let base, serial = 0, expired = false;
  const server = http.createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    response.setHeader('Content-Type', 'application/json');
    if (request.url.startsWith('/.well-known/oauth-protected-resource')) return response.end(JSON.stringify({ resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['design:read'] }));
    if (request.url === '/.well-known/oauth-authorization-server') return response.end(JSON.stringify({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] }));
    if (request.url === '/register') { const metadata = JSON.parse(raw); clients.push(metadata); response.writeHead(201); return response.end(JSON.stringify({ ...metadata, client_id: `yan-client-${clients.length}` })); }
    if (request.url === '/token') {
      const form = new URLSearchParams(raw); tokenRequests.push(form);
      if (form.get('grant_type') === 'authorization_code') {
        const last = new URL(browsers.at(-1));
        assert.equal(crypto.createHash('sha256').update(form.get('code_verifier')).digest('base64url'), last.searchParams.get('code_challenge'));
        assert.equal(form.get('redirect_uri'), last.searchParams.get('redirect_uri'));
      }
      serial++; expired = false;
      return response.end(JSON.stringify({ access_token: `secret-access-${serial}`, token_type: 'Bearer', refresh_token: 'secret-refresh', expires_in: 3600 }));
    }
    if (request.url === '/mcp') {
      if (expired || request.headers.authorization !== `Bearer secret-access-${serial}`) { response.writeHead(401); return response.end('{}'); }
      const message = JSON.parse(raw); let result;
      if (message.id === undefined) { response.writeHead(202); return response.end(); }
      if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mock-official-service', version: '1' } };
      else if (message.method === 'tools/list') result = { tools: [{ name: 'read_design', description: 'Read the authenticated design', inputSchema: { type: 'object', properties: {} } }] };
      else result = { content: [{ type: 'text', text: 'design-content' }] };
      return response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    }
    response.writeHead(404); response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
  const key = crypto.randomBytes(32);
  const safeStorage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'test',
    encryptString(text) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]); },
    decryptString(bytes) { const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(); } };
  const manifest = { schemaVersion: 1, id: 'canva', version: '1.0.0', name: 'Account test', description: 'Account test', mcpServers: [{ id: 'canva', type: 'remote', url: `${base}/mcp`, auth: 'oauth' }] };
  fs.writeFileSync(path.join(source, 'yan-plugin.json'), JSON.stringify(manifest));
  const store = createPluginStore(dataDir); store.install(source, store.preview(source).digest);
  const accounts = createPluginAccounts({ dataDir, store, safeStorage, openExternal: async url => { browsers.push(url); }, allowHttp: true });
  const cleanups = [];
  t.after(async () => { for (const cleanup of cleanups) await cleanup(); accounts.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  async function callback(state) { const authorization = new URL(browsers.at(-1)); const redirect = new URL(authorization.searchParams.get('redirect_uri')); redirect.searchParams.set('code', 'test-code'); redirect.searchParams.set('state', state || authorization.searchParams.get('state')); redirect.searchParams.set('iss', base); return fetch(redirect); }
  return { root, dataDir, store, accounts, browsers, clients, tokenRequests, callback, cleanups, expire: () => { expired = true; } };
}
test('official OAuth flow uses browser, PKCE and state; gateway receives actual tools, refreshes, and revokes access', async t => {
  const f = await setup(t);
  assert.equal(f.store.list()[0].ready, false);
  const connected = await f.accounts.connect('canva'); assert.equal(connected.browserOpened, true);
  assert.equal(f.clients.length, 1); assert.equal(f.clients[0].client_name, 'Yan Agent');
  assert.equal((await f.callback('wrong-state')).status, 400);
  assert.equal(f.store.list()[0].ready, false);
  assert.equal((await f.callback()).status, 200);
  assert.equal(f.store.list()[0].ready, true);
  const statusText = JSON.stringify(f.store.list()); assert.ok(!statusText.includes('secret-access'));
  for (const file of fs.readdirSync(path.join(f.dataDir, 'plugins/accounts'))) assert.ok(!fs.readFileSync(path.join(f.dataDir, 'plugins/accounts', file), 'utf8').includes('secret-refresh'));
  f.store.update('canva', { enabled: true });
  const sessions = createPluginSessions(f.dataDir, f.root, 'oauth-owner'), binding = sessions.activate('canva');
  const gateway = createGateway({ dataDir: f.dataDir, directory: f.root, sessionId: 'oauth-owner', pluginId: 'canva', token: binding.token }); f.cleanups.push(() => gateway.close());
  const tools = await gateway.start(); assert.equal(tools.length, 1); assert.match(tools[0].description, /read_design/);
  assert.equal((await gateway.call(tools[0].name, {})).content[0].text, 'design-content');
  f.expire(); await gateway.call(tools[0].name, {});
  assert.equal(f.tokenRequests.at(-1).get('grant_type'), 'refresh_token');
  assert.equal(f.browsers.length, 1, 'refresh must not open a browser');
  f.accounts.disconnect('canva'); f.store.update('canva', { enabled: false });
  await assert.rejects(gateway.call(tools[0].name, {}));
  assert.equal(f.store.list()[0].ready, false);
});
test('cancelled or removed installs do not accept late callbacks and broker rejects foreign requests', async t => {
  const f = await setup(t); await f.accounts.connect('canva');
  const broker = JSON.parse(fs.readFileSync(path.join(f.dataDir, 'plugins/account-broker.json')));
  const denied = await fetch(`${broker.url}/token`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: '{}' });
  assert.equal(denied.status, 404);
  f.accounts.disconnect('canva'); f.store.remove('canva');
  assert.equal((await f.callback()).status, 404);
  assert.equal(fs.readdirSync(path.join(f.dataDir, 'plugins/accounts')).length, 0);
});
test('management opens official signup/login as fallback without pretending authorization succeeded', async t => {
  const f = await setup(t), opened = [], handlers = new Map();
  const runtime = registerPluginsRuntime({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, shell: { openExternal: async url => opened.push(url) }, windows: { getMainWindow: () => ({ isDestroyed: () => false, webContents: { id: 4, send() {} } }) } }, { dataDir: f.dataDir, safeStorage: { isEncryptionAvailable: () => false } });
  f.cleanups.push(() => runtime.accounts.close());
  const result = await handlers.get('plugins:connect-account')({ sender: { id: 4 } }, { id: 'canva' });
  assert.equal(result.ok, true); assert.equal(result.account.state, 'needs-auth'); assert.equal(result.account.browserOpened, true);
  assert.equal(opened[0], 'https://www.canva.com/login/'); assert.equal(f.store.list()[0].ready, false);
});
