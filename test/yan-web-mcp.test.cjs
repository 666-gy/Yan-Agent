'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SERVER = process.env.YAN_TEST_WEB_SERVER || path.resolve(__dirname, '..', 'lib', 'yan-web-mcp.js');

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function contextPath(contextDir, taskId) {
  return path.join(contextDir, `${crypto.createHash('sha256').update(taskId).digest('hex')}.json`);
}

function startServer(env = {}, defaultTaskId = 'web-test-task') {
  const child = spawn(process.env.YAN_TEST_WEB_NODE || process.execPath, [SERVER], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  const pending = new Map();
  let buffer = '';
  let nextId = 1;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const resolver = pending.get(message.id);
      if (resolver) {
        pending.delete(message.id);
        resolver(message);
      }
    }
  });
  const request = (method, params) => new Promise(resolve => {
    if (method === 'tools/call') {
      params = { ...params, arguments: { task_id: defaultTaskId, ...params.arguments } };
    }
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return { child, request, async stop() { child.kill(); } };
}

async function startHttpServer(handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('unified fetch supports formats and blank tasks download into the task directory', async t => {
  const contextDir = makeTempRoot('yan-web-formats-');
  const executionDirectory = makeTempRoot('yan-web-blank-');
  t.after(() => {
    fs.rmSync(contextDir, { recursive: true, force: true });
    fs.rmSync(executionDirectory, { recursive: true, force: true });
  });
  write(contextPath(contextDir, 'web-test-task'), JSON.stringify({ runId: 'web-test-task', workspace: '', executionDirectory, allowNetwork: true }));
  const html = '<html><head><style>.hidden{}</style></head><body><h1>Hello &amp; world</h1><p>A <a href="https://example.test/">link</a>.</p><script>SECRET_SCRIPT</script></body></html>';
  const server = await startHttpServer((req, res) => {
    assert.equal(req.headers.cookie, undefined);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
  });
  t.after(() => server.close());
  const mcp = startServer({ YAN_WEB_CONTEXT_DIR: contextDir });
  t.after(() => mcp.stop());
  const url = `http://127.0.0.1:${server.address().port}/`;
  for (const format of ['markdown', 'text', 'html', 'raw']) {
    const result = (await mcp.request('tools/call', { name: 'fetch', arguments: { url, format } })).result.structuredContent;
    assert.equal(result.ok, true);
    assert.equal(result.format, format);
    assert.equal(result.bytes, Buffer.byteLength(html));
    if (['raw', 'html'].includes(format)) assert.equal(result.text, html);
    else {
      assert.match(result.text, /Hello & world/);
      assert.ok(!result.text.includes('SECRET_SCRIPT'));
      if (format === 'markdown') assert.match(result.text, /\[link\]\(https:\/\/example.test\/\)/);
      else assert.ok(!result.text.includes('<h1>'));
    }
  }
  const download = await mcp.request('tools/call', { name: 'download_file', arguments: { url, path: 'page.html' } });
  assert.equal(download.result.structuredContent.ok, true);
  assert.equal(fs.readFileSync(path.join(executionDirectory, 'page.html'), 'utf8'), html);
  for (const args of [{ format: 'invalid' }, { timeout: 121 }]) {
    const result = await mcp.request('tools/call', { name: 'fetch', arguments: { url, ...args } });
    assert.equal(result.result.isError, true);
  }
});

test('large fetch results are truncated before they reach the stdio transport', async t => {
  const contextDir = makeTempRoot('yan-web-large-');
  t.after(() => fs.rmSync(contextDir, { recursive: true, force: true }));
  write(contextPath(contextDir, 'web-test-task'), JSON.stringify({ runId: 'web-test-task', workspace: '', allowNetwork: true }));
  const body = '<html><body>' + 'A'.repeat(5 * 1024 * 1024) + '</body></html>';
  const server = await startHttpServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  t.after(() => server.close());
  const mcp = startServer({ YAN_WEB_CONTEXT_DIR: contextDir });
  t.after(() => mcp.stop());
  const url = `http://127.0.0.1:${server.address().port}/`;
  const result = (await mcp.request('tools/call', {
    name: 'fetch',
    arguments: { url, format: 'raw', max_bytes: 8 * 1024 * 1024 }
  })).result.structuredContent;
  assert.equal(result.ok, true);
  assert.equal(result.bytes, Buffer.byteLength(body));
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.text) <= 512 * 1024 + 16);
  assert.match(result.note, /truncated to 524288 bytes/);
  // A huge result must not take the server down: it still answers.
  const listed = await mcp.request('tools/list', {});
  assert.ok(Array.isArray(listed.result.tools));
});

test('yan web mcp fetches text and downloads assets into the authorized workspace', async t => {
  const workspace = makeTempRoot('yan-web-ws-');
  const contextDir = makeTempRoot('yan-web-ctx-');
  const taskId = 'web-test-task';
  write(contextPath(contextDir, taskId), JSON.stringify({
    runId: taskId,
    workspace,
    allowFileRead: true,
    allowNetwork: true,
    allowFileWrite: true
  }));
  t.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(contextDir, { recursive: true, force: true });
  });

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6"/></svg>';
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const server = await startHttpServer((request, response) => {
    if (request.url === '/page') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><body>ok</body></html>');
      return;
    }
    if (request.url === '/gallery') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end([
        '<html><head>',
        '<link rel="icon" href="/favicon.ico">',
        '<link rel="apple-touch-icon" href="icons/apple.png">',
        `<meta property="og:image" content="${base}/social.png">`,
        '</head><body>',
        '<img src="/img/a.png">',
        '<img src="/img/a.png">',
        '<img src="img/b.png" data-src="/img/b-lazy.png">',
        '<img srcset="/img/c-1x.png 1x, /img/c-2x.png 2x" src="/img/c.png">',
        '<source srcset="/img/d-1x.png 1x, /img/d-2x.png 2x">',
        '<img src="data:image/png;base64,AAAA">',
        '<a href="/page">page</a>',
        '<a href="#top">top</a>',
        '</body></html>'
      ].join(''));
      return;
    }
    if (request.url === '/many') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<html><body>${Array.from({ length: 205 }, (_, index) => `<img src="/m/${index}.png">`).join('')}</body></html>`);
      return;
    }
    if (request.url === '/icon.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end(svg);
      return;
    }
    if (request.url === '/icon.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(png);
      return;
    }
    if (request.url === '/missing') {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('nope');
      return;
    }
    if (request.url === '/big') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(Buffer.alloc(8192));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const mcp = startServer({ YAN_WEB_CONTEXT_DIR: contextDir });
  t.after(() => mcp.stop());

  const init = await mcp.request('initialize', { protocolVersion: '2025-03-26' });
  assert.equal(init.result.serverInfo.name, 'Yan Web');

  const list = await mcp.request('tools/list', {});
  assert.deepEqual(list.result.tools.map(tool => tool.name).sort(), ['download_file', 'fetch', 'list_page_assets']);

  const page = await mcp.request('tools/call', { name: 'fetch', arguments: { url: `${base}/page`, format: 'raw' } });
  assert.equal(page.result.structuredContent.ok, true);
  assert.match(page.result.structuredContent.text, /<body>ok<\/body>/u);
  assert.equal(page.result.structuredContent.contentType, 'text/html');

  const svgText = await mcp.request('tools/call', { name: 'fetch', arguments: { url: `${base}/icon.svg` } });
  assert.equal(svgText.result.structuredContent.ok, true);
  assert.match(svgText.result.structuredContent.text, /<svg/u);

  const binaryText = await mcp.request('tools/call', { name: 'fetch', arguments: { url: `${base}/icon.png` } });
  assert.equal(binaryText.result.structuredContent.ok, false);
  assert.match(binaryText.result.structuredContent.error, /download_file/u);

  const missing = await mcp.request('tools/call', { name: 'fetch', arguments: { url: `${base}/missing` } });
  assert.equal(missing.result.structuredContent.ok, false);
  assert.match(missing.result.structuredContent.error, /404/u);

  const download = await mcp.request('tools/call', {
    name: 'download_file',
    arguments: { url: `${base}/icon.png`, path: 'assets/icons/icon.png' }
  });
  const downloaded = download.result.structuredContent;
  assert.equal(downloaded.ok, true);
  assert.equal(downloaded.bytes, png.length);
  assert.equal(downloaded.sha256, crypto.createHash('sha256').update(png).digest('hex'));
  assert.equal(downloaded.contentType, 'image/png');
  assert.equal(fs.readFileSync(path.join(workspace, 'assets', 'icons', 'icon.png')).equals(png), true);

  const again = await mcp.request('tools/call', {
    name: 'download_file',
    arguments: { url: `${base}/icon.png`, path: 'assets/icons/icon.png' }
  });
  assert.equal(again.result.structuredContent.ok, false);
  assert.match(again.result.structuredContent.error, /already exists/u);

  const replaced = await mcp.request('tools/call', {
    name: 'download_file',
    arguments: { url: `${base}/icon.svg`, path: 'assets/icons/icon.png', overwrite: true }
  });
  assert.equal(replaced.result.structuredContent.ok, true);
  assert.equal(fs.readFileSync(path.join(workspace, 'assets', 'icons', 'icon.png'), 'utf8'), svg);

  const tooBig = await mcp.request('tools/call', {
    name: 'download_file',
    arguments: { url: `${base}/big`, path: 'big.bin', max_bytes: 1024 }
  });
  assert.equal(tooBig.result.structuredContent.ok, false);
  assert.match(tooBig.result.structuredContent.error, /byte limit/u);

  const gallery = await mcp.request('tools/call', { name: 'list_page_assets', arguments: { url: `${base}/gallery` } });
  const assets = gallery.result.structuredContent;
  assert.equal(assets.ok, true);
  assert.equal(assets.url, `${base}/gallery`);
  assert.equal(assets.finalUrl, `${base}/gallery`);
  assert.equal(assets.status, 200);
  assert.match(assets.contentType, /text\/html/u);
  assert.equal(typeof assets.count, 'number');
  assert.equal(typeof assets.truncated, 'boolean');
  assert.equal(assets.truncated, false);
  assert.equal(assets.count, assets.items.length);
  const assetUrls = assets.items.map(item => item.url);
  assert.equal(new Set(assetUrls).size, assetUrls.length);
  for (const expected of [
    `${base}/img/a.png`,
    `${base}/img/b.png`,
    `${base}/img/b-lazy.png`,
    `${base}/img/c.png`,
    `${base}/img/c-1x.png`,
    `${base}/img/c-2x.png`,
    `${base}/img/d-1x.png`,
    `${base}/img/d-2x.png`,
    `${base}/favicon.ico`,
    `${base}/icons/apple.png`,
    `${base}/social.png`
  ]) {
    assert.ok(assetUrls.includes(expected), `missing asset ${expected}`);
  }
  assert.equal(assetUrls.filter(value => value === `${base}/img/a.png`).length, 1);
  assert.equal(assetUrls.some(value => value.startsWith('data:')), false);
  assert.equal(assets.items.some(item => item.kind === 'link'), false);
  assert.deepEqual(
    assets.items.find(item => item.url === `${base}/favicon.ico`),
    { url: `${base}/favicon.ico`, kind: 'icon', tag: 'link' }
  );
  assert.deepEqual(
    assets.items.find(item => item.url === `${base}/social.png`),
    { url: `${base}/social.png`, kind: 'icon', tag: 'meta' }
  );
  assert.equal(assets.items.find(item => item.url === `${base}/img/a.png`).kind, 'image');
  assert.equal(assets.items.find(item => item.url === `${base}/img/d-2x.png`).tag, 'source');

  const iconsOnly = await mcp.request('tools/call', { name: 'list_page_assets', arguments: { url: `${base}/gallery`, kinds: ['icons'] } });
  assert.equal(iconsOnly.result.structuredContent.ok, true);
  assert.ok(iconsOnly.result.structuredContent.items.length > 0);
  assert.ok(iconsOnly.result.structuredContent.items.every(item => item.kind === 'icon'));
  assert.equal(iconsOnly.result.structuredContent.items.some(item => item.url.endsWith('/img/a.png')), false);

  const linksOnly = await mcp.request('tools/call', { name: 'list_page_assets', arguments: { url: `${base}/gallery`, kinds: ['links'] } });
  assert.equal(linksOnly.result.structuredContent.ok, true);
  assert.deepEqual(linksOnly.result.structuredContent.items, [{ url: `${base}/page`, kind: 'link', tag: 'a' }]);

  const binaryAssets = await mcp.request('tools/call', { name: 'list_page_assets', arguments: { url: `${base}/icon.png` } });
  assert.equal(binaryAssets.result.structuredContent.ok, false);
  assert.match(binaryAssets.result.structuredContent.error, /not text/iu);

  const many = await mcp.request('tools/call', { name: 'list_page_assets', arguments: { url: `${base}/many` } });
  assert.equal(many.result.structuredContent.ok, true);
  assert.equal(many.result.structuredContent.count, 200);
  assert.equal(many.result.structuredContent.items.length, 200);
  assert.equal(many.result.structuredContent.truncated, true);
});

test('yan web mcp rejects escapes, missing authorization and disabled permissions', async t => {
  const workspace = makeTempRoot('yan-web-guard-');
  const outside = makeTempRoot('yan-web-outside-');
  const contextDir = makeTempRoot('yan-web-guard-ctx-');
  const served = await startHttpServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('guarded');
  });
  t.after(() => {
    served.close();
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(contextDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${served.address().port}`;

  write(contextPath(contextDir, 'guard-task'), JSON.stringify({
    runId: 'guard-task',
    workspace,
    allowNetwork: true,
    allowFileWrite: true
  }));
  write(contextPath(contextDir, 'offline-task'), JSON.stringify({
    runId: 'offline-task',
    workspace,
    allowNetwork: false,
    allowFileWrite: true
  }));
  write(contextPath(contextDir, 'readonly-task'), JSON.stringify({
    runId: 'readonly-task',
    workspace,
    allowNetwork: true,
    allowFileWrite: false
  }));

  const mcp = startServer({ YAN_WEB_CONTEXT_DIR: contextDir }, 'guard-task');
  t.after(() => mcp.stop());

  const escape = await mcp.request('tools/call', {
    name: 'download_file',
    arguments: { url: `${base}/file.txt`, path: path.join('..', '..', path.basename(outside), 'escape.txt') }
  });
  assert.equal(escape.result.structuredContent.ok, false);
  assert.match(escape.result.structuredContent.error, /outside the authorized workspace/u);

  const absolute = await mcp.request('tools/call', {
    name: 'download_file',
    arguments: { url: `${base}/file.txt`, path: path.join(outside, 'absolute.txt') }
  });
  assert.equal(absolute.result.structuredContent.ok, false);
  assert.match(absolute.result.structuredContent.error, /outside the authorized workspace/u);

  const unauthorized = await mcp.request('tools/call', {
    name: 'fetch',
    arguments: { url: `${base}/file.txt`, task_id: 'unknown-task' }
  });
  assert.equal(unauthorized.result.structuredContent.ok, false);
  assert.match(unauthorized.result.structuredContent.error, /run context/u);

  const offline = await mcp.request('tools/call', {
    name: 'fetch',
    arguments: { url: `${base}/file.txt`, task_id: 'offline-task' }
  });
  assert.equal(offline.result.structuredContent.ok, false);
  assert.match(offline.result.structuredContent.error, /Network access is disabled/u);

  const readonly = await mcp.request('tools/call', {
    name: 'download_file',
    arguments: { url: `${base}/file.txt`, path: 'readonly.txt', task_id: 'readonly-task' }
  });
  assert.equal(readonly.result.structuredContent.ok, false);
  assert.match(readonly.result.structuredContent.error, /File writing is disabled/u);

  const readonlyFetch = await mcp.request('tools/call', {
    name: 'fetch',
    arguments: { url: `${base}/file.txt`, task_id: 'readonly-task' }
  });
  assert.equal(readonlyFetch.result.structuredContent.ok, true);
  assert.equal(readonlyFetch.result.structuredContent.text, 'guarded');
});
