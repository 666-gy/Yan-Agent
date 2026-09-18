'use strict';

// Yan Web MCP: direct HTTP fetch/download for static resources (icons, images,
// SVG, fonts, archives) without opening the built-in browser. Every call is
// authorized by the parent task_id and confined to that task's workspace.
// list_page_assets parses an authorized HTML page and lists its image/icon/link URLs.
// stdio JSON-RPC, same shape as yan-analysis-mcp / yan-harness-mcp.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONTEXT_DIR = String(process.env.YAN_WEB_CONTEXT_DIR || '').trim();
const NETWORK_ALLOWED = process.env.YAN_WEB_ALLOW_NETWORK !== 'false';
const DEFAULT_DOWNLOAD_LIMIT = 64 * 1024 * 1024;
const MAX_DOWNLOAD_LIMIT = 256 * 1024 * 1024;
const DEFAULT_TEXT_LIMIT = 2 * 1024 * 1024;
const MAX_TEXT_LIMIT = 8 * 1024 * 1024;
const DEFAULT_ASSET_LIMIT = 4 * 1024 * 1024;
const MAX_ASSET_LIMIT = 8 * 1024 * 1024;
const MAX_ASSET_ITEMS = 200;
const ASSET_KINDS = new Set(['images', 'icons', 'links']);
const DEFAULT_ASSET_KINDS = ['images', 'icons'];
const ICON_LINK_REL = /(?:^|\s)(?:icon|shortcut|apple-touch-icon|mask-icon)(?:\s|$)/i;
const ICON_META_KEYS = new Set(['og:image', 'twitter:image']);
const ASSET_TAG_RE = /<(img|source|link|meta|a)\b([^>]*)>/gi;
const ASSET_ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const REQUEST_TIMEOUT_MS = 60_000;
const TEXT_CONTENT_TYPE = /^(?:text\/|application\/(?:json|xml|javascript|ecmascript|x-javascript|x-www-form-urlencoded|x-yaml|yaml|graphql)|image\/svg\+xml)/i;

function authorize(params = {}) {
  const taskId = String(params.task_id || '').trim();
  if (!CONTEXT_DIR || !taskId) throw new Error('Active task_id and Yan Web context are required.');
  const key = crypto.createHash('sha256').update(taskId).digest('hex');
  let context;
  try {
    context = JSON.parse(fs.readFileSync(path.join(CONTEXT_DIR, `${key}.json`), 'utf8'));
  } catch {
    throw new Error('No run context is registered for this task_id.');
  }
  if (context.runId !== taskId || !context.workspace) {
    throw new Error('The task workspace is not authorized.');
  }
  if (!NETWORK_ALLOWED || context.allowNetwork === false) {
    throw new Error('Network access is disabled for this task.');
  }
  return {
    workspace: fs.realpathSync(context.workspace),
    allowFileWrite: context.allowFileWrite !== false
  };
}

function normalizeUrl(value) {
  const url = String(value || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('url must start with http:// or https://');
  return url;
}

function clampBytes(value, fallback, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1024, Math.min(maximum, Math.floor(numeric)));
}

function resolveTargetPath(workspace, value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('path is required.');
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(workspace, raw);
  const relative = path.relative(workspace, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('path is outside the authorized workspace.');
  }
  return resolved;
}

async function requestBuffer(url, maxBytes) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'user-agent': 'YanAgent/1.6 (static-resource fetch)',
      accept: '*/*'
    }
  });
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw new Error(`Resource is ${declared} bytes, above the ${maxBytes} byte limit.`);
  }
  const chunks = [];
  let total = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch {}
          throw new Error(`Resource exceeded the ${maxBytes} byte limit.`);
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }
  return { response, buffer: Buffer.concat(chunks) };
}

function normalizeKinds(value) {
  if (!Array.isArray(value)) return DEFAULT_ASSET_KINDS.slice();
  const kinds = [];
  for (const entry of value) {
    const kind = String(entry || '').trim().toLowerCase();
    if (ASSET_KINDS.has(kind) && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds.length ? kinds : DEFAULT_ASSET_KINDS.slice();
}

function parseAttributes(text) {
  const attributes = {};
  ASSET_ATTR_RE.lastIndex = 0;
  let match;
  while ((match = ASSET_ATTR_RE.exec(text))) {
    const key = match[1].toLowerCase();
    if (!(key in attributes)) attributes[key] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

function parseSrcset(value) {
  return String(value || '')
    .split(',')
    .map(part => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function isSkippableAssetValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();
  return lower.startsWith('data:') || lower.startsWith('javascript:') || lower.startsWith('mailto:') || lower.startsWith('#');
}

function resolveAssetUrl(value, baseUrl) {
  if (isSkippableAssetValue(value)) return '';
  try {
    const resolved = new URL(String(value).trim(), baseUrl);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : '';
  } catch {
    return '';
  }
}

function collectPageAssets(html, baseUrl, kinds) {
  const wantImages = kinds.includes('images');
  const wantIcons = kinds.includes('icons');
  const wantLinks = kinds.includes('links');
  const candidates = [];
  ASSET_TAG_RE.lastIndex = 0;
  let match;
  while ((match = ASSET_TAG_RE.exec(String(html || '')))) {
    const tag = match[1].toLowerCase();
    const attrs = parseAttributes(match[2]);
    if (tag === 'img' && wantImages) {
      for (const key of ['src', 'data-src', 'data-lazy-src']) {
        if (attrs[key]) candidates.push({ value: attrs[key], kind: 'image', tag: 'img' });
      }
      if (attrs.srcset) {
        for (const value of parseSrcset(attrs.srcset)) candidates.push({ value, kind: 'image', tag: 'img' });
      }
    } else if (tag === 'source' && wantImages) {
      if (attrs.src) candidates.push({ value: attrs.src, kind: 'image', tag: 'source' });
      if (attrs.srcset) {
        for (const value of parseSrcset(attrs.srcset)) candidates.push({ value, kind: 'image', tag: 'source' });
      }
    } else if (tag === 'link' && wantIcons) {
      if (attrs.href && ICON_LINK_REL.test(String(attrs.rel || ''))) {
        candidates.push({ value: attrs.href, kind: 'icon', tag: 'link' });
      }
    } else if (tag === 'meta' && wantIcons) {
      const key = String(attrs.property || attrs.name || '').trim().toLowerCase();
      if (attrs.content && ICON_META_KEYS.has(key)) {
        candidates.push({ value: attrs.content, kind: 'icon', tag: 'meta' });
      }
    } else if (tag === 'a' && wantLinks) {
      if (attrs.href) candidates.push({ value: attrs.href, kind: 'link', tag: 'a' });
    }
  }
  const seen = new Set();
  const items = [];
  let truncated = false;
  for (const candidate of candidates) {
    const url = resolveAssetUrl(candidate.value, baseUrl);
    if (!url || seen.has(url)) continue;
    if (items.length >= MAX_ASSET_ITEMS) {
      truncated = true;
      break;
    }
    seen.add(url);
    items.push({ url, kind: candidate.kind, tag: candidate.tag });
  }
  return { items, truncated };
}

async function fetchText(params = {}) {
  authorize(params);
  const url = normalizeUrl(params.url);
  const limit = clampBytes(params.max_bytes, DEFAULT_TEXT_LIMIT, MAX_TEXT_LIMIT);
  const { response, buffer } = await requestBuffer(url, limit);
  const contentType = String(response.headers.get('content-type') || '').trim();
  if (response.status >= 400) throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
  if (contentType && !TEXT_CONTENT_TYPE.test(contentType)) {
    return {
      ok: false,
      error: `Content type ${contentType} is not text; use download_file to save it.`,
      url,
      finalUrl: response.url || url,
      status: response.status,
      contentType,
      bytes: buffer.length
    };
  }
  return {
    ok: true,
    url,
    finalUrl: response.url || url,
    status: response.status,
    contentType: contentType || 'text/plain',
    bytes: buffer.length,
    text: buffer.toString('utf8')
  };
}

async function downloadFile(params = {}) {
  const { workspace, allowFileWrite } = authorize(params);
  if (!allowFileWrite) throw new Error('File writing is disabled for this task.');
  const url = normalizeUrl(params.url);
  const target = resolveTargetPath(workspace, params.path);
  const limit = clampBytes(params.max_bytes, DEFAULT_DOWNLOAD_LIMIT, MAX_DOWNLOAD_LIMIT);
  if (fs.existsSync(target) && params.overwrite !== true) {
    return { ok: false, error: `File already exists: ${target}. Pass overwrite: true to replace it.`, path: target };
  }
  const { response, buffer } = await requestBuffer(url, limit);
  if (response.status >= 400) throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.yan-web-${process.pid}-${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, buffer, { flag: 'wx' });
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
  return {
    ok: true,
    url,
    finalUrl: response.url || url,
    path: target,
    bytes: buffer.length,
    contentType: String(response.headers.get('content-type') || ''),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex')
  };
}

async function listPageAssets(params = {}) {
  authorize(params);
  const url = normalizeUrl(params.url);
  const kinds = normalizeKinds(params.kinds);
  const limit = clampBytes(params.max_bytes, DEFAULT_ASSET_LIMIT, MAX_ASSET_LIMIT);
  const { response, buffer } = await requestBuffer(url, limit);
  const contentType = String(response.headers.get('content-type') || '').trim();
  if (response.status >= 400) throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
  const finalUrl = response.url || url;
  if (contentType && !TEXT_CONTENT_TYPE.test(contentType)) {
    return {
      ok: false,
      error: `Content type ${contentType} is not text/HTML; use fetch_text to inspect it or download_file to save it.`,
      url,
      finalUrl,
      status: response.status,
      contentType,
      bytes: buffer.length
    };
  }
  const { items, truncated } = collectPageAssets(buffer.toString('utf8'), finalUrl, kinds);
  return {
    ok: true,
    url,
    finalUrl,
    status: response.status,
    contentType: contentType || 'text/html',
    count: items.length,
    items,
    truncated
  };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan Web MCP error') } });
}

function toolResult(id, result) {
  success(id, {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
    isError: false
  });
}

function toolDefinitions() {
  return [
    {
      name: 'fetch_text',
      description: 'Fetch a known URL directly over HTTP and return its text (HTML source, JSON, XML, SVG, Markdown, CSS/JS) plus status, final URL, content type and byte size. Works without the built-in browser. Prefer AnySearch first when you still need to find the source; use this once the URL is known, and use download_file for binary assets.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Complete http(s) URL.' },
          max_bytes: { type: 'number', description: 'Optional size limit in bytes (default 2 MiB, max 8 MiB).' },
          task_id: { type: 'string', description: 'Parent task_id from the yan-turn-context block.' }
        },
        required: ['url', 'task_id'],
        additionalProperties: false
      }
    },
    {
      name: 'download_file',
      description: 'Download any static resource (icon, image, SVG, font, archive) directly over HTTP into the authorized task workspace and return its saved path, byte size, sha256 and content type. Use this instead of the built-in browser when the asset URL is already known; the built-in browser stays for pages that need rendering or interaction.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Complete http(s) URL.' },
          path: { type: 'string', description: 'Workspace-relative or absolute in-workspace target file path.' },
          overwrite: { type: 'boolean', default: false, description: 'Replace an existing file; without it the call is refused.' },
          max_bytes: { type: 'number', description: 'Optional size limit in bytes (default 64 MiB, max 256 MiB).' },
          task_id: { type: 'string', description: 'Parent task_id from the yan-turn-context block.' }
        },
        required: ['url', 'path', 'task_id'],
        additionalProperties: false
      }
    },
    {
      name: 'list_page_assets',
      description: 'List the static asset URLs (images, icons, links) referenced by an HTML page without opening the built-in browser. Fetches the page over HTTP, follows redirects, resolves relative URLs against the final URL and deduplicates results; returns up to 200 items with their url, kind and source tag. Use it before download_file when scraping page icons or images so you know which URLs exist.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Complete http(s) URL of the page that should be scanned.' },
          kinds: {
            type: 'array',
            items: { type: 'string', enum: ['images', 'icons', 'links'] },
            description: "Optional asset kinds to collect (default ['images', 'icons']). 'links' also returns <a href> targets."
          },
          max_bytes: { type: 'number', description: 'Optional page size limit in bytes (default 4 MiB, max 8 MiB).' },
          task_id: { type: 'string', description: 'Parent task_id from the yan-turn-context block.' }
        },
        required: ['url', 'task_id'],
        additionalProperties: false
      }
    }
  ];
}

async function callTool(message) {
  const params = message.params?.arguments || {};
  const name = String(message.params?.name || '').trim();
  if (name === 'fetch_text') return toolResult(message.id, await fetchText(params));
  if (name === 'download_file') return toolResult(message.id, await downloadFile(params));
  if (name === 'list_page_assets') return toolResult(message.id, await listPageAssets(params));
  throw new Error(`Unknown tool: ${name}`);
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return;
  if (message.method === 'initialize') {
    success(message.id, {
      protocolVersion: String(message.params?.protocolVersion || '2025-03-26'),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Yan Web', version: '1.0.0' }
    });
    return;
  }
  if (message.method === 'ping') {
    success(message.id, {});
    return;
  }
  if (message.method === 'tools/list') {
    success(message.id, { tools: toolDefinitions() });
    return;
  }
  if (message.method === 'tools/call') {
    try { await callTool(message); }
    catch (error) {
      toolResult(message.id, { ok: false, error: error?.message || String(error) });
    }
    return;
  }
  if (message.id !== undefined) failure(message.id, -32601, `Unsupported method: ${message.method}`);
}

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
    try { handle(JSON.parse(line)); }
    catch (error) { failure(null, -32700, error?.message || String(error)); }
  }
});
