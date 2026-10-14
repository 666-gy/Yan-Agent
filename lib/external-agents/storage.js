'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'blocked', 'interrupted']);
function hash(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally { try { fs.unlinkSync(temp); } catch {} }
}
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
function canonical(workspace) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw new Error('必须绑定有效的绝对工作区路径');
  const resolved = fs.realpathSync(workspace);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('工作区不是目录');
  return resolved;
}
function workspaceKey(workspace) { return process.platform === 'win32' ? workspace.toLowerCase() : workspace; }
function jobDir(root, id) {
  if (!/^[a-f0-9-]{36}$/.test(String(id))) throw new Error('无效的外部任务编号');
  return path.join(root, id);
}
module.exports = { TERMINAL, hash, atomic, read, alive, canonical, workspaceKey, jobDir };
