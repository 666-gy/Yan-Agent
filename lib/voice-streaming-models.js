'use strict';
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// Same zipformer release used by dsh-voice-mode; pin the revision as well as
// each digest so a repository update cannot change a resumed download.
const REPO = 'csukuangfj/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30';
const REVISION = 'ad658fa0201659a09ea3c176129a191c77ecae8f';
const ASSETS = [
  { name: 'encoder.int8.onnx', bytes: 161141793, sha256: '5ac51e27981bb4dab01bb9be4958453ba50c3b61c063ddda0eab23fd3671aa4f' },
  { name: 'decoder.onnx', bytes: 5165083, sha256: '06522ad63cec0fdf6809f4e1db9bb4f7d710c34582e3b35db62ac60eccafac7e' },
  { name: 'joiner.int8.onnx', bytes: 1033416, sha256: 'b34584dc6f561089e1d747fedebb3765f2caa72c927ef54d7ca55e5ae40a814b' },
  { name: 'tokens.txt', bytes: 20628, sha256: '6193c7ea1c96d0d9a1e9652789b40d13a8a913b434a5451e93158f5a09fd6652' },
];
const MODEL_BYTES = ASSETS.reduce((sum, file) => sum + file.bytes, 0);
const modelDirectory = dataDir => path.join(dataDir, 'voice', 'streaming', REPO);
function allowedUrl(url) {
  const { protocol, hostname } = new URL(url);
  return protocol === 'https:' && ['huggingface.co', 'hf.co', 'hf-mirror.com', 'xethub.hf.co'].some(host => hostname === host || hostname.endsWith(`.${host}`));
}
async function matchesAsset(target, asset, signal) {
  signal?.throwIfAborted();
  try {
    const info = await fsp.stat(target);
    if (!info.isFile() || info.size !== asset.bytes) return false;
    const digest = createHash('sha256');
    for await (const chunk of fs.createReadStream(target, { signal })) digest.update(chunk);
    return digest.digest('hex') === asset.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
async function inspectStreamingModels(dataDir, signal) {
  for (const asset of ASSETS) if (!await matchesAsset(path.join(modelDirectory(dataDir), asset.name), asset, signal)) return false;
  return true;
}
function describeError(error) {
  return [error.message || String(error), error.cause?.code].filter(Boolean).join(' ');
}
async function fetchAsset(url, headers, signal, fetchImpl) {
  for (let redirects = 0; redirects < 8; redirects++) {
    if (!allowedUrl(url)) throw new Error(`不允许的模型下载地址：${new URL(url).hostname}`);
    const response = await fetchImpl(url, { headers, signal, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('下载源重定向缺少目标地址');
    url = new URL(location, url).href;
  }
  throw new Error('模型下载重定向次数过多');
}
async function downloadStreamingAsset(asset, root, { signal, sources, report = () => {}, fetchImpl = fetch, headerTimeoutMs = 15000, idleTimeoutMs = 30000 } = {}) {
  signal ||= new AbortController().signal;
  signal.throwIfAborted();
  await fsp.mkdir(root, { recursive: true });
  const target = path.join(root, asset.name), partial = `${target}.part`;
  if (await matchesAsset(target, asset, signal)) { report(asset.bytes); return target; }
  const failures = [];
  for (const source of sources) {
    // Retry a failed transfer on the same source once, keeping received bytes.
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      const transfer = new AbortController();
      const combined = AbortSignal.any([signal, transfer.signal]);
      let timeout, response;
      const armTimeout = ms => {
        clearTimeout(timeout);
        timeout = setTimeout(() => transfer.abort(new Error('下载连接超时')), ms);
      };
      try {
        let offset = 0;
        try { offset = (await fsp.stat(partial)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (offset === asset.bytes && await matchesAsset(partial, asset, signal)) {
          await fsp.rename(partial, target); report(asset.bytes); return target;
        }
        if (offset >= asset.bytes) { await fsp.rm(partial, { force: true }); offset = 0; }
        armTimeout(headerTimeoutMs);
        // REPO already includes its owner. Do not prefix csukuangfj again.
        response = await fetchAsset(`${source}/${REPO}/resolve/${REVISION}/${asset.name}?download=true`, offset ? { Range: `bytes=${offset}-` } : {}, combined, fetchImpl);
        if (![200, 206].includes(response.status) || !response.body) throw new Error(`HTTP ${response.status}`);
        if (response.status === 206) {
          const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
          if (!range || Number(range[1]) !== offset || Number(range[3]) !== asset.bytes) throw new Error('断点续传范围无效');
        } else offset = 0; // A server without Range support restarts cleanly.
        let completed = offset, lastPublish = 0;
        report(completed);
        armTimeout(idleTimeoutMs);
        const meter = new Transform({ transform(chunk, _encoding, callback) {
          completed += chunk.length;
          if (completed > asset.bytes) { callback(new Error('模型文件大小超出预期')); return; }
          armTimeout(idleTimeoutMs);
          if (Date.now() - lastPublish > 150) { lastPublish = Date.now(); report(completed); }
          callback(null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(partial, { flags: offset ? 'a' : 'w' }), { signal: combined });
        clearTimeout(timeout);
        if (!await matchesAsset(partial, asset, signal)) {
          await fsp.rm(partial, { force: true });
          throw new Error('模型文件大小或 SHA256 校验失败');
        }
        signal.throwIfAborted();
        await fsp.rename(partial, target); report(asset.bytes); return target;
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        const reason = transfer.signal.aborted ? transfer.signal.reason : error;
        failures.push(`${new URL(source).hostname}：${describeError(reason)}`);
        if (['ENOSPC', 'EACCES', 'EPERM'].includes(error.code)) throw new Error(`无法写入 ${asset.name}：${describeError(error)}`);
      } finally {
        clearTimeout(timeout);
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      }
    }
  }
  throw new Error(`流式模型下载失败（${asset.name}）：${[...new Set(failures)].join('；')}。请检查网络或更换下载源后重试。`);
}
async function prepareStreamingModels(dataDir, source, signal, report = () => {}) {
  const sources = source === 'mirror' ? ['https://hf-mirror.com', 'https://huggingface.co'] : ['https://huggingface.co', 'https://hf-mirror.com'];
  const root = modelDirectory(dataDir);
  let previousBytes = 0;
  for (const asset of ASSETS) {
    await downloadStreamingAsset(asset, root, { signal, sources,
      report: completed => report({ resource: asset.name, completedBytes: previousBytes + completed, totalBytes: MODEL_BYTES }) });
    previousBytes += asset.bytes;
  }
  return root;
}
module.exports = { ASSETS, MODEL_BYTES, modelDirectory, matchesAsset, inspectStreamingModels, prepareStreamingModels, downloadStreamingAsset };
