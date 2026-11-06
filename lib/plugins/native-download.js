'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectPackage } = require('./creation');
async function readLimited(response, limit) {
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > limit) throw new Error('下载内容超过大小限制');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}
async function installNative(store, input, { fetcher = fetch } = {}) {
  const entry = require('./official-market').validateEntries([input])[0];
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-native-plugin-'));
  try {
    for (const file of entry.files) {
      const url = `https://raw.githubusercontent.com/${entry.repository}/${entry.revision}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
      const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`插件下载失败：HTTP ${response.status}`); }
      const bytes = await readLimited(response, file.bytes);
      if (bytes.length !== file.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`插件文件完整性校验失败：${file.path}`);
      const target = path.join(stage, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' });
    }
    const report = inspectPackage(stage);
    if (report.digest !== entry.digest || JSON.stringify(report.manifest) !== JSON.stringify(entry.manifest)) throw new Error('插件包摘要或清单与官方索引不一致');
    return store.install(stage, report.digest);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
module.exports = { installNative, readLimited };
