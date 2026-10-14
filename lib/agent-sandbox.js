'use strict';
const fs = require('node:fs');
const path = require('node:path');
function sandboxMode(value) {
  return ['read-only', 'workspace-write'].includes(value) ? value : 'full';
}
function restrictPermissions(base, mode) {
  mode = sandboxMode(mode);
  if (mode === 'full') return base;
  const result = { '*': 'deny', ...base, bash: 'deny', shell: 'deny', task: 'deny', lsp: 'deny', external_directory: 'deny' };
  // Arbitrary commands and MCPs can mutate files without using file tools.
  // Until an OS process sandbox exists, do not let them bypass this boundary.
  for (const key of Object.keys(result)) if (key.endsWith('_*')) result[key] = 'deny';
  for (const key of ['yan_skills_read_skill', 'yan_skills_read_skill_resource', 'yan_skills_read_skill_resources', 'yan_skills_list_installed_skills', 'yan_skills_list_pets']) result[key] = 'allow';
  if (mode === 'read-only') for (const key of ['write', 'edit', 'apply_patch']) result[key] = 'deny';
  return result;
}
function canonicalTarget(file) {
  let cursor = path.resolve(file);
  const suffix = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error('无法解析写入路径');
    suffix.unshift(path.basename(cursor)); cursor = parent;
  }
  return path.resolve(fs.realpathSync(cursor), ...suffix);
}
function assertSandboxTool(mode, root, tool, args = {}) {
  mode = sandboxMode(mode);
  if (mode === 'full') return;
  if (['bash', 'shell', 'task', 'lsp'].includes(tool)) throw new Error('当前沙盒模式不允许未隔离的命令或子进程，请使用受限文件工具');
  const safeMcp = new Set(['yan_skills_read_skill', 'yan_skills_read_skill_resource', 'yan_skills_read_skill_resources', 'yan_skills_list_installed_skills', 'yan_skills_list_pets']);
  const safeNative = new Set(['yan_runtime_log', 'read', 'glob', 'grep', 'list', 'write', 'edit', 'apply_patch', 'question', 'todowrite', 'todoread', 'webfetch', 'websearch', 'skill', 'plugins_list', 'plugins_inspect', 'plugins_activate', 'plugins_read_resource', 'plugins_deactivate']);
  if (!safeNative.has(tool) && !safeMcp.has(tool)) throw new Error('当前沙盒模式不允许此工具操作');
  if (!['write', 'edit', 'apply_patch'].includes(tool)) return;
  if (mode === 'read-only') throw new Error('只读沙盒不允许编辑文件');
  const targets = [args.filePath, args.path].filter(value => typeof value === 'string' && value);
  if (tool === 'apply_patch') {
    for (const match of String(args.patchText || args.patch || '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)) targets.push((match[1] || match[2]).trim());
  }
  if (!targets.length) throw new Error('无法验证写入目标，已拒绝操作');
  const workspace = fs.realpathSync(root);
  for (const target of targets) {
    const resolved = canonicalTarget(path.resolve(workspace, target));
    const relative = path.relative(workspace, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('工作空间写入沙盒不允许编辑工作空间之外的文件');
  }
}
module.exports = { sandboxMode, restrictPermissions, assertSandboxTool };
