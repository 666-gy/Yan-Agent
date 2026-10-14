'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

// The release mirror is intentionally configurable: production can point this
// at a Cloudflare R2 public bucket/custom domain without rebuilding the app.
// GitHub Releases remains the immutable fallback when the mirror is slow or
// unavailable in a user's network.
const UPDATE_BASE_URL = String(process.env.YAN_UPDATE_MIRROR_URL || '').trim().replace(/\/+$/, '');
const UPDATE_FALLBACK_URL = String(process.env.YAN_UPDATE_GITHUB_URL || 'https://github.com/ViaTumLab/Yan-Agent/releases/latest/download').trim().replace(/\/+$/, '');
const UPDATE_FEED_NAME = 'latest.json';
const LEGACY_UPDATE_FEED_NAME = 'latest.yml';
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 5;
const MAX_FEED_BYTES = 512 * 1024;

// Electron's network stack follows Windows system/PAC proxies. Node's HTTPS
// client connects directly and can hit a blocked local DNS answer instead.
function requestClient(protocol) {
  if (!process.versions.electron || process.type !== 'browser') return protocol === 'http:' ? http : https;
  const { net } = require('electron');
  return {
    get(url, options, onResponse) {
      const request = net.request({ url: url.toString(), redirect: 'follow' });
      const handle = new EventEmitter();
      let timer;
      let stopped = false;
      const clearTimer = () => clearTimeout(timer);
      for (const [name, value] of Object.entries(options.headers || {})) request.setHeader(name, value);
      request.on('response', response => {
        // Electron exposes multi-value headers; the shared redirect/size
        // handling below expects Node's single-value representation.
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) response.headers[name] = value.join(', ');
        }
        response.once('end', clearTimer);
        response.once('error', clearTimer);
        onResponse(response);
      });
      request.on('error', error => {
        clearTimer();
        if (!stopped) { stopped = true; handle.emit('error', error); }
      });
      // ClientRequest can close before the response finishes; keep the
      // deadline active until response end/error or explicit cancellation.
      handle.setTimeout = (ms, callback) => { clearTimer(); timer = setTimeout(callback, ms); return handle; };
      // Keep Electron's native destroy/abort methods intact: abort internally
      // calls destroy, so overriding destroy to call abort causes recursion.
      handle.destroy = error => {
        if (stopped) return handle;
        stopped = true;
        clearTimer();
        request.abort();
        if (error) handle.emit('error', error);
        return handle;
      };
      request.end();
      return handle;
    }
  };
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function stripQuotes(value) {
  const text = String(value ?? '').trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function resolveFileUrl(baseUrl, fileName) {
  const name = String(fileName || '').trim();
  if (!name) return '';
  if (/^https?:\/\//i.test(name)) return name;
  const encoded = name.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `${normalizeBaseUrl(baseUrl)}/${encoded}`;
}

function parseLatestYml(text) {
  const feed = {
    version: '',
    path: '',
    releaseDate: '',
    buildId: '',
    fileName: '',
    fileUrl: '',
    sha512: '',
    size: 0
  };
  const files = [];
  let currentFile = null;
  let inFiles = false;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    if (!rawLine.trim()) continue;

    if (/^files\s*:/.test(rawLine)) {
      inFiles = true;
      continue;
    }

    const itemMatch = rawLine.match(/^\s*-\s*url:\s*(.*)$/);
    if (inFiles && itemMatch) {
      currentFile = { url: stripQuotes(itemMatch[1]), sha512: '', size: 0 };
      files.push(currentFile);
      continue;
    }

    const kvMatch = rawLine.match(/^(\s*)([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!kvMatch) continue;
    const indent = kvMatch[1].length;
    const key = kvMatch[2];
    const value = stripQuotes(kvMatch[3]);

    if (indent > 0 && currentFile) {
      if (key === 'url') currentFile.url = value;
      else if (key === 'sha512') currentFile.sha512 = value;
      else if (key === 'size') currentFile.size = Number.parseInt(value, 10) || 0;
      continue;
    }

    if (key === 'version') feed.version = value;
    else if (key === 'path') feed.path = value;
    else if (key === 'sha512') feed.sha512 = value;
    else if (key === 'releaseDate') feed.releaseDate = value;
    else if (key === 'buildId') feed.buildId = value;
  }

  const first = files[0] || null;
  feed.fileName = feed.path || (first && first.url) || '';
  feed.fileUrl = (first && first.url) || '';
  if (first) {
    if (!feed.sha512) feed.sha512 = first.sha512 || '';
    feed.size = first.size || 0;
  }
  return feed;
}

function parseUpdateManifest(value) {
  const manifest = typeof value === 'string' ? JSON.parse(value) : value;
  if (!manifest || typeof manifest !== 'object') throw new Error('invalid-manifest');
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const first = files.find((file) => file && (file.url || file.name)) || {};
  const fileName = String(first.name || first.path || first.url || manifest.path || '').split('/').pop();
  const fileUrl = String(first.url || manifest.fileUrl || '').trim();
  if (!manifest.version || !fileName || !fileUrl) throw new Error('invalid-manifest');
  return {
    version: String(manifest.version),
    path: fileName,
    releaseDate: String(manifest.releaseDate || manifest.pubDate || ''),
    buildId: String(manifest.buildId || ''),
    fileName,
    fileUrl,
    fallbackFileUrl: String(first.fallbackUrl || manifest.fallbackFileUrl || '').trim(),
    sha512: String(first.sha512 || manifest.sha512 || ''),
    sha256: String(first.sha256 || manifest.sha256 || ''),
    size: Number(first.size || manifest.size || 0) || 0,
    files
  };
}

function parseVersion(value) {
  const text = String(value || '').trim().replace(/^v/i, '').split('+')[0];
  const dash = text.indexOf('-');
  const core = dash >= 0 ? text.slice(0, dash) : text;
  const pre = dash >= 0 ? text.slice(dash + 1) : '';
  const nums = core.split('.').map((part) => Number.parseInt(part, 10) || 0);
  while (nums.length < 3) nums.push(0);
  return { nums: nums.slice(0, 3), pre: pre ? pre.split('.') : [] };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i += 1) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] > b.nums[i] ? 1 : -1;
  }
  if (!a.pre.length && !b.pre.length) return 0;
  if (!a.pre.length) return 1;
  if (!b.pre.length) return -1;
  const length = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < length; i += 1) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const delta = Number(x) - Number(y);
      if (delta) return delta > 0 ? 1 : -1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x > y ? 1 : -1;
    }
  }
  return 0;
}

function requestText(url, { timeoutMs = DEFAULT_TIMEOUT_MS, redirects = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error('invalid-url'));
      return;
    }
    const client = requestClient(parsed.protocol);
    const request = client.get(parsed, { headers: { 'user-agent': 'YanAgent-Updater', accept: '*/*' } }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects <= 0) {
          reject(new Error('too-many-redirects'));
          return;
        }
        const next = new URL(response.headers.location, parsed).toString();
        resolve(requestText(next, { timeoutMs, redirects: redirects - 1 }));
        return;
      }
      if (status !== 200) {
        response.resume();
        const error = new Error(`http-${status}`);
        error.status = status;
        reject(error);
        return;
      }
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        data += chunk;
        if (data.length > MAX_FEED_BYTES) {
          request.destroy(new Error('feed-too-large'));
        }
      });
      response.on('end', () => resolve(data));
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

function requestToFile(url, targetPath, { expectedSha512 = '', expectedSize = 0, onProgress = null, timeoutMs = 120000, redirects = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    let responseFailure = reject;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error('invalid-url'));
      return;
    }
    const client = requestClient(parsed.protocol);
    const request = client.get(parsed, { headers: { 'user-agent': 'YanAgent-Updater', accept: '*/*' } }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects <= 0) {
          reject(new Error('too-many-redirects'));
          return;
        }
        const next = new URL(response.headers.location, parsed).toString();
        resolve(requestToFile(next, targetPath, { expectedSha512, expectedSize, onProgress, timeoutMs, redirects: redirects - 1 }));
        return;
      }
      if (status !== 200) {
        response.resume();
        const error = new Error(`http-${status}`);
        error.status = status;
        reject(error);
        return;
      }

      const declaredSize = Number.parseInt(response.headers['content-length'] || '', 10) || 0;
      const total = declaredSize || expectedSize || 0;
      const hash = crypto.createHash('sha512');
      let received = 0;
      let settled = false;
      const file = fs.createWriteStream(targetPath);

      const fail = (error) => {
        if (settled) return;
        settled = true;
        file.destroy();
        fs.promises.rm(targetPath, { force: true })
          .catch(() => {})
          .finally(() => reject(error));
      };
      responseFailure = fail;

      response.on('data', (chunk) => {
        received += chunk.length;
        hash.update(chunk);
        if (onProgress && total > 0) {
          onProgress({ received, total, percent: Math.min(100, Math.round((received / total) * 100)) });
        }
      });
      response.on('error', fail);
      file.on('error', fail);
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          if (settled) return;
          if (expectedSize && received !== expectedSize) {
            fail(new Error('size-mismatch'));
            return;
          }
          const sha512 = hash.digest('base64');
          if (expectedSha512 && sha512 !== expectedSha512) {
            fail(new Error('sha512-mismatch'));
            return;
          }
          settled = true;
          if (onProgress) onProgress({ received, total: total || received, percent: 100 });
          resolve({ path: targetPath, sha512, size: received });
        });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')));
    request.on('error', error => responseFailure(error));
  });
}

async function checkForUpdates({ baseUrl = UPDATE_BASE_URL, fallbackBaseUrl = UPDATE_FALLBACK_URL, currentVersion = '', currentBuild = '', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  // A caller-supplied test/enterprise endpoint is authoritative unless it
  // explicitly supplies a fallback. The built-in R2/GitHub pair is used only
  // for the normal production call with no custom base URL.
  const useFallback = !!fallbackBaseUrl && (!baseUrl || baseUrl === UPDATE_BASE_URL || fallbackBaseUrl !== UPDATE_FALLBACK_URL);
  const bases = [baseUrl, useFallback ? fallbackBaseUrl : ''].map(normalizeBaseUrl).filter((value, index, all) => value && all.indexOf(value) === index);
  let lastError = null;
  for (const base of bases) {
   try {
    let text;
    let feed;
    try {
      text = await requestText(`${base}/${UPDATE_FEED_NAME}`, { timeoutMs });
      feed = parseUpdateManifest(text);
    } catch (manifestError) {
      // Keep old COS feeds working during the migration window.
      text = await requestText(`${base}/${LEGACY_UPDATE_FEED_NAME}`, { timeoutMs });
      feed = parseLatestYml(text);
    }
    if (!feed.version) {
      throw new Error('invalid-feed');
    }
    const current = String(currentVersion || '').trim().replace(/^v/i, '');
    const currentBuildId = String(currentBuild || '').trim();
    const versionCmp = compareVersions(feed.version, current);
    // Same version string can still be a different build (hotfix re-release). When the feed
    // advertises a buildId and it differs from the installed one, treat it as an update.
    const sameVersionNewBuild =
      versionCmp === 0 && !!feed.buildId && !!currentBuildId && feed.buildId !== currentBuildId;
    const hasUpdate = versionCmp > 0 || sameVersionNewBuild;
    return {
      ok: true,
      baseUrl: base,
      currentVersion: current,
      latestVersion: feed.version,
      hasUpdate,
      versionCmp,
      sameVersionNewBuild,
      buildId: feed.buildId || '',
      fileName: feed.fileName,
      fileUrl: resolveFileUrl(base, feed.fileUrl || feed.fileName),
      fallbackFileUrl: feed.fallbackFileUrl || '',
      fileUrls: [resolveFileUrl(base, feed.fileUrl || feed.fileName), feed.fallbackFileUrl || ''].filter(Boolean),
      sha512: feed.sha512 || '',
      sha256: feed.sha256 || '',
      size: feed.size || 0,
      releaseDate: feed.releaseDate || ''
    };
   } catch (error) {
    lastError = error;
   }
  }
  {
    const error = lastError || new Error('no-update-source');
    const status = Number(error && error.status);
    return {
      ok: false,
      error: status ? `http-${status}` : String((error && error.message) || error),
      message: String((error && error.message) || error),
      baseUrl: normalizeBaseUrl(baseUrl),
      fallbackBaseUrl: normalizeBaseUrl(fallbackBaseUrl)
    };
  }
}

async function downloadUpdate({ url, urls = [], targetPath, expectedSha512 = '', expectedSize = 0, onProgress = null, timeoutMs = 120000 } = {}) {
  const candidates = [url, ...urls].filter(Boolean).filter((item, index, all) => all.indexOf(item) === index);
  if (!candidates.length) throw new Error('missing-url');
  if (!targetPath) throw new Error('missing-target');
  let lastError;
  for (const candidate of candidates) {
    try {
      return await requestToFile(candidate, targetPath, { expectedSha512, expectedSize, onProgress, timeoutMs });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('download-failed');
}

module.exports = {
  UPDATE_BASE_URL,
  UPDATE_FALLBACK_URL,
  UPDATE_FEED_NAME,
  checkForUpdates,
  compareVersions,
  downloadUpdate,
  parseLatestYml,
  parseUpdateManifest,
  parseVersion,
  resolveFileUrl
};
