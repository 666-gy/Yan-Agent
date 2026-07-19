const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const net = require('net');
const os = require('os');
const { URL } = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function getLanAddresses() {
  const addrs = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      addrs.push(iface.address);
    }
  }
  return addrs;
}

function findFreePort(start = 3847, host = '0.0.0.0') {
  return new Promise((resolve, reject) => {
    const probe = (port) => {
      const tester = net.createServer();
      tester.once('error', (err) => {
        if (err.code === 'EADDRINUSE') probe(port + 1);
        else reject(err);
      });
      tester.once('listening', () => tester.close(() => resolve(port)));
      tester.listen(port, host);
    };
    probe(start);
  });
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { return null; }
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  });
  res.end(body);
}

function sendImage(req, res, image) {
  const fileName = String(image.name || 'image.png').replace(/[\r\n"]/g, '_');
  res.writeHead(200, {
    'Content-Type': image.mimeType || 'application/octet-stream',
    'Content-Length': image.buffer.length,
    'Content-Disposition': `inline; filename="${fileName}"`,
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  return res.end(image.buffer);
}

function parseAuth(req, url) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return url.searchParams.get('password') || url.searchParams.get('token') || '';
}

class RemoteServer {
  constructor(options) {
    this.rootDir = options.rootDir;
    this.uiDir = options.uiDir;
    this.getToken = options.getToken;
    this.verifyPassword = options.verifyPassword || ((value) => value === this.getToken());
    this.deps = options.deps;
    this.server = null;
    this.port = null;
    this.sseClients = new Set();
  }

  async start(preferredPort = 0) {
    if (this.server) return this.getInfo();
    const port = preferredPort > 0 ? preferredPort : await findFreePort(3847);
    this.port = port;
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        console.error('[remote]', err.message);
        if (!res.headersSent) json(res, 500, { error: err.message || 'internal error' });
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '0.0.0.0', resolve);
    });
    console.log(`[remote] mobile control at http://0.0.0.0:${port}`);
    return this.getInfo();
  }

  stop() {
    for (const res of this.sseClients) {
      try { res.end(); } catch { /* ignore */ }
    }
    this.sseClients.clear();
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    this.port = null;
    return new Promise((resolve) => srv.close(() => resolve()));
  }

  getInfo() {
    const addrs = getLanAddresses();
    const port = this.port;
    const urls = port ? addrs.map((ip) => `http://${ip}:${port}`) : [];
    return {
      running: !!this.server,
      port,
      addresses: addrs,
      urls,
      primaryUrl: urls[0] || (port ? `http://127.0.0.1:${port}` : null),
    };
  }

  broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of [...this.sseClients]) {
      try { res.write(payload); } catch { this.sseClients.delete(res); }
    }
  }

  publishSessionUpdate(detail) {
    this.broadcast('session-updated', detail);
    this.deps.onSessionChanged?.(detail);
  }

  async handle(req, res) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      });
      res.end();
      return;
    }

    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/api/health') {
      const authState = this.deps.getAuthState?.() || {};
      return json(res, 200, {
        ok: true,
        ...this.getInfo(),
        passwordRequired: true,
        passwordSet: !!authState.passwordSet,
        authRequired: true,
      });
    }

    if (pathname === '/api/events' && req.method === 'GET') {
      const password = parseAuth(req, url);
      if (!this.verifyPassword(password)) return json(res, 401, { error: 'unauthorized' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(': connected\n\n');
      this.sseClients.add(res);
      req.on('close', () => this.sseClients.delete(res));
      return;
    }

    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/auth/verify' && req.method === 'POST') {
        return this.handleApi(req, res, pathname, url);
      }
      const password = parseAuth(req, url);
      if (!this.verifyPassword(password)) return json(res, 401, { error: 'unauthorized' });
      return this.handleApi(req, res, pathname, url);
    }

    if (pathname.startsWith('/assets/')) {
      return this.serveAsset(req, res, pathname);
    }

    return this.serveStatic(req, res, pathname);
  }

  async serveAsset(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(res, 405, { error: 'method not allowed' });
    }
    const relPath = pathname.replace(/^\/assets\//, '');
    const filePath = path.join(this.rootDir, 'renderer', 'assets', relPath);
    const assetsRoot = path.join(this.rootDir, 'renderer', 'assets');
    if (!filePath.startsWith(assetsRoot)) return json(res, 403, { error: 'forbidden' });
    let stat;
    try { stat = await fsp.stat(filePath); } catch { return json(res, 404, { error: 'not found' }); }
    if (!stat.isFile()) return json(res, 404, { error: 'not found' });
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  }

  async handleApi(req, res, pathname, url) {
    const { deps } = this;

    if (pathname === '/api/info' && req.method === 'GET') {
      const cfg = deps.getPublicConfig();
      return json(res, 200, { app: 'Yan Agent', ...this.getInfo(), config: cfg });
    }

    if (pathname === '/api/auth/verify' && req.method === 'POST') {
      const raw = await readBody(req);
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'invalid json' }); }
      const password = String(body.password || '');
      if (!this.verifyPassword(password)) return json(res, 401, { error: 'unauthorized' });
      return json(res, 200, { ok: true });
    }

    if (pathname === '/api/models' && req.method === 'GET') {
      const modelState = await deps.getModelState?.();
      return json(res, 200, modelState || { provider: '', model: '', capabilities: {}, models: [] });
    }

    if (pathname === '/api/model' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (body === null) return json(res, 400, { error: 'invalid json' });
      const result = await deps.setModel?.(body.model);
      if (!result || result.error) return json(res, 400, result || { error: '模型切换失败' });
      const modelState = await deps.getModelState?.();
      return json(res, 200, modelState || { provider: '', model: '', capabilities: {}, models: [] });
    }

    const generatedImageMatch = pathname.match(/^\/api\/generated-images\/([a-f0-9]{32})$/);
    if (generatedImageMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const image = await deps.readGeneratedImage?.(generatedImageMatch[1]);
      if (!image?.buffer) return json(res, 404, { error: 'image not found' });
      return sendImage(req, res, image);
    }

    const uploadedImageMatch = pathname.match(/^\/api\/uploaded-images\/([a-f0-9]{32})$/);
    if (uploadedImageMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const image = await deps.readUploadedImage?.(uploadedImageMatch[1]);
      if (!image?.buffer) return json(res, 404, { error: 'image not found' });
      return sendImage(req, res, image);
    }

    if (pathname === '/api/uploads/images' && req.method === 'POST') {
      let body;
      try {
        const raw = await readBody(req, 28 * 1024 * 1024);
        body = raw ? JSON.parse(raw) : {};
      } catch (error) {
        return json(res, error.message === 'payload too large' ? 413 : 400, {
          error: error.message === 'payload too large' ? '图片不能超过 20MB' : 'invalid json'
        });
      }
      const result = await deps.uploadImage?.(body);
      if (!result || result.error) return json(res, 400, result || { error: 'upload failed' });
      return json(res, 201, result);
    }

    if (pathname === '/api/sessions' && req.method === 'GET') {
      const sessions = await deps.listSessions();
      const running = await deps.getRunningSessions();
      const runningSet = new Set(running);
      return json(res, 200, {
        sessions: sessions.map((s) => ({ ...s, running: runningSet.has(s.id) })),
      });
    }

    if (pathname === '/api/sessions' && req.method === 'POST') {
      const result = await deps.createSession();
      const session = result?.session || result;
      const reused = !!result?.reused;
      if (!reused) this.publishSessionUpdate({ type: 'created', id: session.id });
      return json(res, reused ? 200 : 201, { session, reused });
    }

    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(.*))?$/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      const action = sessionMatch[2] || '';

      if (!action && req.method === 'GET') {
        const session = await deps.getSession(sessionId);
        if (!session) return json(res, 404, { error: 'session not found' });
        const status = await deps.getSessionStatus(sessionId);
        return json(res, 200, { session, status });
      }

      if (!action && req.method === 'DELETE') {
        const body = await readJsonBody(req);
        if (body === null) return json(res, 400, { error: 'invalid json' });
        const result = await deps.deleteSession(sessionId, { confirmed: !!body.confirmed });
        if (!result?.ok) {
          const status = result?.code === 'not-found' ? 404 : 409;
          return json(res, status, result || { error: 'delete failed' });
        }
        this.publishSessionUpdate({ type: 'deleted', id: sessionId });
        return json(res, 200, result);
      }

      if (action === 'rename' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body === null) return json(res, 400, { error: 'invalid json' });
        const session = await deps.renameSession(sessionId, body.title);
        if (!session) return json(res, 400, { error: '请输入任务名称' });
        this.publishSessionUpdate({ type: 'renamed', id: sessionId });
        return json(res, 200, { ok: true, session });
      }

      if (action === 'pin' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body === null) return json(res, 400, { error: 'invalid json' });
        const session = await deps.setSessionPinned(sessionId, !!body.pinned);
        if (!session) return json(res, 404, { error: 'session not found' });
        this.publishSessionUpdate({ type: 'pinned', id: sessionId, pinned: !!body.pinned });
        return json(res, 200, { ok: true, session });
      }

      if (action === 'messages' && req.method === 'GET') {
        const session = await deps.getSession(sessionId);
        if (!session) return json(res, 404, { error: 'session not found' });
        return json(res, 200, { messages: session.messages || [] });
      }

      if (action === 'messages' && req.method === 'POST') {
        const raw = await readBody(req);
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'invalid json' }); }
        const text = String(body.text || '').trim();
        const requestedAttachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 4) : [];
        const modelState = requestedAttachments.length ? await deps.getModelState?.() : null;
        if (requestedAttachments.length && modelState && !modelState.capabilities?.imageInput) {
          return json(res, 409, { error: '当前模型不支持图像输入，请切换模型或移除图片' });
        }
        const attachments = requestedAttachments.length
          ? await deps.resolveUploadedImages?.(requestedAttachments) || []
          : [];
        if (requestedAttachments.length !== attachments.length) return json(res, 400, { error: '图片附件已失效，请重新上传' });
        if (!text && !attachments.length) return json(res, 400, { error: 'text or image required' });
        const result = await deps.sendMessage(sessionId, text, attachments);
        if (result?.error && !result?.ok) return json(res, result.error === 'busy' ? 409 : 400, result);
        const session = await deps.getSession(sessionId);
        this.broadcast('message-added', { sessionId });
        this.broadcast('session-updated', { type: 'updated', id: sessionId });
        return json(res, 200, { ...result, session });
      }

      if (action === 'abort' && req.method === 'POST') {
        const result = await deps.abortSession(sessionId);
        this.broadcast('run-status', { sessionId, running: false });
        return json(res, 200, result);
      }

      if (action === 'status' && req.method === 'GET') {
        const status = await deps.getSessionStatus(sessionId);
        return json(res, 200, status);
      }
    }

    return json(res, 404, { error: 'not found' });
  }

  async serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(res, 405, { error: 'method not allowed' });
    }
    let rel = pathname;
    if (rel === '/' || rel === '') rel = 'index.html';
    const relPath = rel.replace(/^\/+/, '');
    const filePath = path.join(this.uiDir, relPath);
    if (!filePath.startsWith(this.uiDir)) return json(res, 403, { error: 'forbidden' });
    let stat;
    try { stat = await fsp.stat(filePath); } catch { return json(res, 404, { error: 'not found' }); }
    if (stat.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      try {
        await fsp.stat(indexPath);
        return this.serveStatic(req, res, `${relPath.replace(/\\/g, '/')}/index.html`);
      } catch {
        return json(res, 404, { error: 'not found' });
      }
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  }
}

module.exports = {
  RemoteServer,
  findFreePort,
  getLanAddresses,
};
