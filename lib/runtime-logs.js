'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const MAX_TAIL_BYTES = 64 * 1024;
function redact(text) {
  return String(text)
    .replace(/\b(?:sk-|github_pat_|gh[pousr]_)[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/(Bearer\s+|Basic\s+)[A-Za-z0-9+/=._-]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|password|token|secret|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');
}
async function readRuntimeLogs(dataDir, { file = '', lines = 120 } = {}) {
  if (!dataDir) return { files: [], error: 'Desktop runtime log directory is unavailable.' };
  const root = path.resolve(dataDir);
  const files = ['main-crash.log', 'hang.log', 'hang.log.1', 'stability.log', 'stability.log.1', 'kernel.log', 'kernel.log.1'];
  const diagnostics = path.join(root, 'opencode-runtime', 'diagnostics');
  const names = await fs.readdir(diagnostics).catch(() => []);
  files.push(...names.filter(name => /^[a-z0-9-]+-\d+\.jsonl(?:\.1)?$/i.test(name)).sort().slice(-100)
    .map(name => `opencode-runtime/diagnostics/${name}`));
  const available = [];
  for (const name of files) {
    const stat = await fs.lstat(path.join(root, name)).catch(() => null);
    if (stat?.isFile() && !stat.isSymbolicLink()) available.push({ file: name, bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
  }
  if (!file) return { files: available };
  if (!available.some(entry => entry.file === file)) return { error: 'Log is unavailable; select a file returned by the log list.', files: available };
  // Check canonical containment as well: a linked diagnostics directory must
  // never turn this read-only diagnostics tool into an arbitrary file reader.
  const target = await fs.realpath(path.join(root, file));
  const canonicalRoot = await fs.realpath(root);
  const relative = path.relative(canonicalRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Log is outside the runtime directory.');
  const handle = await fs.open(target, 'r');
  try {
    const { size } = await handle.stat();
    const offset = Math.max(0, size - MAX_TAIL_BYTES);
    const buffer = Buffer.alloc(Math.min(size, MAX_TAIL_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const rows = text.split(/\r?\n/);
    if (offset) rows.shift();
    const count = Math.max(1, Math.min(400, Number(lines) || 120));
    return { file, text: redact(rows.filter(Boolean).slice(-count).join('\n')), truncated: offset > 0 || rows.length > count };
  } finally { await handle.close(); }
}
module.exports = { readRuntimeLogs, redact };
