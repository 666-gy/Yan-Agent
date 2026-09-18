'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');

const UPDATE_BASE_URL = 'https://yan-agent-1440856872.cos.ap-guangzhou.myqcloud.com';
const UPDATE_FEED_NAME = 'latest.yml';
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 5;
const MAX_FEED_BYTES = 512 * 1024;

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
    const client = parsed.protocol === 'http:' ? http : https;
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
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error('invalid-url'));
      return;
    }
    const client = parsed.protocol === 'http:' ? http : https;
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
    request.on('error', reject);
  });
}

async function checkForUpdates({ baseUrl = UPDATE_BASE_URL, currentVersion = '', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  try {
    const feedUrl = `${base}/${UPDATE_FEED_NAME}`;
    const text = await requestText(feedUrl, { timeoutMs });
    const feed = parseLatestYml(text);
    if (!feed.version) {
      return { ok: false, error: 'invalid-feed', message: 'latest.yml 缺少 version 字段', baseUrl: base };
    }
    const current = String(currentVersion || '').trim().replace(/^v/i, '');
    const hasUpdate = compareVersions(feed.version, current) > 0;
    return {
      ok: true,
      baseUrl: base,
      currentVersion: current,
      latestVersion: feed.version,
      hasUpdate,
      fileName: feed.fileName,
      fileUrl: resolveFileUrl(base, feed.fileUrl || feed.fileName),
      sha512: feed.sha512 || '',
      size: feed.size || 0,
      releaseDate: feed.releaseDate || ''
    };
  } catch (error) {
    const status = Number(error && error.status);
    return {
      ok: false,
      error: status ? `http-${status}` : String((error && error.message) || error),
      message: String((error && error.message) || error),
      baseUrl: base
    };
  }
}

async function downloadUpdate({ url, targetPath, expectedSha512 = '', expectedSize = 0, onProgress = null, timeoutMs = 120000 } = {}) {
  if (!url) throw new Error('missing-url');
  if (!targetPath) throw new Error('missing-target');
  return requestToFile(url, targetPath, { expectedSha512, expectedSize, onProgress, timeoutMs });
}

module.exports = {
  UPDATE_BASE_URL,
  UPDATE_FEED_NAME,
  checkForUpdates,
  compareVersions,
  downloadUpdate,
  parseLatestYml,
  parseVersion,
  resolveFileUrl
};
