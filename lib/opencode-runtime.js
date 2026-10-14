'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const patch = require('../vendor/opencode/runtime-patch.json');

const pending = new Map();

// The OpenCode executable is ~166 MB. Every kernel (re)start used to re-hash
// both the source binary and the staged target, which is pure first-turn boot
// tax. Cache the verified identity (size + mtime) per path so the full digest
// is computed once per file version instead of once per start.
const verifiedSources = new Map(); // source path -> { size, mtimeMs, sha256 }
const verifiedTargets = new Map(); // target path -> { size, mtimeMs, sha256 }

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function statIdentity(file) {
  try {
    const stat = await fs.promises.stat(file);
    return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function verifiedSourceHash(file) {
  const identity = await statIdentity(file);
  if (!identity) throw new Error(`OpenCode 内核文件不存在：${file}`);
  const cached = verifiedSources.get(file);
  if (cached && cached.size === identity.size && cached.mtimeMs === identity.mtimeMs) {
    return cached.sha256;
  }
  const digest = await sha256(file);
  verifiedSources.set(file, { ...identity, sha256: digest });
  return digest;
}

async function matchesBinary(file, spec) {
  const identity = await statIdentity(file);
  if (!identity || identity.size !== spec.size) return false;
  const cached = verifiedTargets.get(file);
  if (cached
    && cached.size === identity.size
    && cached.mtimeMs === identity.mtimeMs
    && cached.sha256 === spec.patchedSha256) {
    return true;
  }
  if (await sha256(file) !== spec.patchedSha256) return false;
  verifiedTargets.set(file, { ...identity, sha256: spec.patchedSha256 });
  return true;
}

async function stageRuntime(executable, dataDir) {
  const sourceHash = await verifiedSourceHash(executable);
  const spec = patch.binaries.find(binary => binary.sourceSha256 === sourceHash);
  if (!spec) {
    throw new Error(`Yan 的三文件工具补丁仅支持已校验的 OpenCode ${patch.upstreamVersion} 内核；当前可执行文件不匹配，请更新内核补丁清单。SHA-256: ${sourceHash}`);
  }

  const directory = path.join(dataDir, 'opencode-runtime', 'bin', `${patch.revision}-${spec.patchedSha256.slice(0, 16)}`);
  const target = path.join(directory, path.basename(executable));
  if (await matchesBinary(target, spec)) return target;

  const bytes = await fs.promises.readFile(executable);
  // Recheck the buffer we actually patch in case npm replaced the source
  // between the initial fingerprint and this read.
  if (bytes.length !== spec.size || crypto.createHash('sha256').update(bytes).digest('hex') !== spec.sourceSha256) {
    throw new Error('OpenCode 内核在准备补丁时发生变化，请重试。');
  }
  const filter = Buffer.from(patch.filter, 'utf8');
  const offset = bytes.indexOf(filter);
  if (offset < 0 || bytes.indexOf(filter, offset + filter.length) !== -1) {
    throw new Error('OpenCode 模型工具过滤器不是唯一匹配，拒绝应用内核补丁。');
  }
  // The official Bun executable embeds JavaScript source. Equal-length
  // spaces remove only the model filter without moving bundled offsets.
  // The native tool implementations and permission checks stay intact.
  bytes.fill(0x20, offset, offset + filter.length);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== spec.patchedSha256) {
    throw new Error('OpenCode 三文件工具补丁校验失败。');
  }

  await fs.promises.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `${path.basename(executable)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.promises.writeFile(temporary, bytes, { flag: 'wx', mode: 0o700 });
    if (!await matchesBinary(temporary, spec)) throw new Error('OpenCode 补丁文件写入校验失败。');
    // A second app process may have staged and started the same executable.
    if (await matchesBinary(target, spec)) return target;
    try {
      await fs.promises.rename(temporary, target);
    } catch (error) {
      if (!await matchesBinary(target, spec)) throw error;
    }
    return target;
  } finally {
    await fs.promises.unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

function stageOpenCodeRuntime({ executable, dataDir }) {
  const source = path.resolve(executable);
  const root = path.resolve(dataDir);
  const key = JSON.stringify([source, root]);
  if (!pending.has(key)) {
    pending.set(key, stageRuntime(source, root).finally(() => pending.delete(key)));
  }
  return pending.get(key);
}

module.exports = { stageOpenCodeRuntime };
