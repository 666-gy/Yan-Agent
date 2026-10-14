'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicJson, createPluginStore } = require('./store');
const { packageFile } = require('./manifest');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function sessionKeyFor(directory, sessionId) {
  // 工作区在会话期间可能已经被删除(临时目录、被清理的测试工作区)。这种情况下
  // realpath 解析不了,但调用方只是要一个稳定的键:退回解析后的字面路径即可。
  // 目录不存在时任何插件都必然处于未激活状态,键的具体取值不影响授权判断。
  let canonical;
  try { canonical = fs.realpathSync(directory); } catch { canonical = path.resolve(directory); }
  return hash(`${process.platform === 'win32' ? canonical.toLowerCase() : canonical}\0${sessionId}`);
}
function pluginSessionAction(rules) {
  let action = 'deny';
  for (const rule of rules || []) if (['*', 'plugins_execute'].includes(rule.permission) && rule.pattern === '*') action = rule.action;
  return action;
}
// The two rules that scope plugin tools to one session. The kernel matches the
// last rule that applies, so these only have to sit at the end of the array to
// override anything named `yanp_*` before them.
function pluginSessionRules(directory, sessionId, action) {
  return [
    { permission: 'yanp_*', pattern: '*', action: 'deny' },
    { permission: `yanp_${sessionKeyFor(directory, sessionId).slice(0, 16)}_*`, pattern: '*', action }
  ];
}
function hasPluginSessionPermissions(rules, tail) {
  const current = Array.isArray(rules) ? rules : [];
  if (!tail.length || current.length < tail.length) return false;
  const start = current.length - tail.length;
  return tail.every((rule, offset) => {
    const found = current[start + offset];
    return !!found && found.permission === rule.permission
      && found.pattern === rule.pattern && found.action === rule.action;
  });
}
// Keeps only the last rule for each permission/pattern pair, in place. The
// kernel answers with the last matching rule, and that rule is always the last
// of its pair, so every lookup resolves exactly as before.
function compactPermissionRules(rules) {
  const last = new Map();
  (rules || []).forEach((rule, index) => last.set(`${String(rule?.permission)}\u0000${String(rule?.pattern)}`, index));
  return (rules || []).filter((rule, index) => last.get(`${String(rule?.permission)}\u0000${String(rule?.pattern)}`) === index);
}
function withPluginSessionPermissions(directory, sessionId, rules) {
  return [...compactPermissionRules((rules || []).filter(rule => !String(rule.permission).startsWith('yanp_'))),
    ...pluginSessionRules(directory, sessionId, pluginSessionAction(rules))];
}
function createPluginSessions(dataDir, directory, sessionId) {
  if (!sessionId || !directory) throw new Error('插件需要有效会话');
  const store = createPluginStore(dataDir);
  const sessionKey = sessionKeyFor(directory, sessionId);
  const folder = path.join(store.root, 'sessions', sessionKey);
  function all() {
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => {
      try { return JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')); } catch { return null; }
    }).filter(Boolean);
  }
  function file(id) { return path.join(folder, `${hash(id)}.json`); }
  function get(id) { return all().find(item => item.id === id) || null; }
  function authorize(binding) {
    const current = store.get(binding?.id);
    if (!binding || binding.sessionId !== sessionId || path.resolve(binding.directory) !== path.resolve(directory)) throw new Error('插件不属于当前会话');
    if (!current?.enabled || current.epoch !== binding.epoch || !store.visible(current, directory)) throw new Error('插件已禁用、卸载或改变技能/作用范围，请重新激活');
    const saved = get(binding.id);
    if (saved?.token !== binding.token) throw new Error('插件激活已撤销');
    return binding;
  }
  function activate(id) {
    const current = store.get(id);
    if (!current?.enabled || !store.visible(current, directory)) throw new Error('插件未启用或不属于当前工作区');
    const previous = get(id);
    if (previous && previous.epoch === current.epoch) { authorize(previous); return previous; }
    const status = store.prepare(current);
    if (!status.ready) throw new Error(status.issues.join('；'));
    const binding = { ...current, sessionId, directory: path.resolve(directory),
      name: `yanp_${sessionKey.slice(0, 16)}_${hash(id).slice(0, 10)}`,
      token: crypto.randomUUID(), activatedAt: Date.now() };
    atomicJson(file(id), binding); return binding;
  }
  function remove(id) { const target = file(id); if (fs.existsSync(target)) fs.unlinkSync(target); }
  function resource(binding, resourceId, offset = 0) {
    authorize(binding);
    const manifest = store.contributions(binding);
    const item = resourceId === 'instructions'
      ? { path: manifest.instructions }
      : [...manifest.skills.map(s => ({ ...s, id: `skill:${s.id}` })), ...manifest.resources.map(r => ({ ...r, id: `resource:${r.id}` }))].find(r => r.id === resourceId);
    if (!item?.path) throw new Error('插件资源不存在');
    const target = packageFile(store.packageRoot(binding), item.path);
    if (fs.statSync(target).size > 2 * 1024 * 1024) return { resourceId, path: target, binary: true, note: '资源大于 2 MB，请使用适当的文件工具读取。' };
    const bytes = fs.readFileSync(target);
    if (bytes.includes(0)) return { resourceId, path: target, binary: true, bytes: bytes.length };
    const text = bytes.toString('utf8').replaceAll('${pluginRoot}', store.packageRoot(binding));
    if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw new Error('无效资源偏移量');
    const end = Math.min(text.length, offset + 24000);
    return { resourceId, path: target, offset, text: text.slice(offset, end), nextOffset: end < text.length ? end : null, totalCharacters: text.length };
  }
  return { all, get, file, authorize, activate, remove, resource, store };
}
module.exports = { createPluginSessions, withPluginSessionPermissions, pluginSessionAction, pluginSessionRules, hasPluginSessionPermissions, compactPermissionRules };
