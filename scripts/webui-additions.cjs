'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { skillAvailability } = require('../lib/skill-availability');
const { readProjects } = require('./webui-projects.cjs');
async function readSkills(dataDir) {
  const [config, index] = await Promise.all([
    fs.readFile(path.join(dataDir, 'config.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(dataDir, 'SkillStore/index.json'), 'utf8').then(JSON.parse)
  ]);
  const available = skillAvailability(config, index.entries || []);
  return (index.entries || []).filter(skill => !skill.hidden && available(skill)).map(skill => ({ id: skill.id, name: skill.name, aliases: skill.aliases || [] }));
}
function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}
async function readProjectFiles(dataDir, workspace, relative = '') {
  const projects = await readProjects(dataDir);
  if (workspace == null) {
    const config = JSON.parse(await fs.readFile(path.join(dataDir, 'config.json'), 'utf8'));
    workspace = config.workspace || '';
  }
  if (!workspace || !projects.some(project => project.workspace && path.resolve(project.workspace).toLowerCase() === path.resolve(workspace).toLowerCase())) return { entries: [], workspace: '', noWorkspace: true };
  if (path.isAbsolute(relative) || relative.includes('\0')) throw Object.assign(new Error('Invalid directory'), { status: 400 });
  const root = await fs.realpath(workspace);
  const resolved = path.resolve(root, relative);
  if (!within(root, resolved)) throw Object.assign(new Error('Outside project'), { status: 403 });
  const directory = await fs.realpath(resolved);
  if (!within(root, directory)) throw Object.assign(new Error('Outside project'), { status: 403 });
  const dirents = await fs.readdir(directory, { withFileTypes: true });
  const visible = dirents.filter(entry => !entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile()) && !['.git', 'node_modules'].includes(entry.name));
  const entries = visible.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
    .slice(0, 1000).map(entry => ({ name: entry.name, directory: entry.isDirectory(), path: path.join(relative, entry.name).replace(/\\/g, '/') }));
  return { workspace, entries, truncated: visible.length > 1000 };
}
module.exports = { readSkills, readProjectFiles };
