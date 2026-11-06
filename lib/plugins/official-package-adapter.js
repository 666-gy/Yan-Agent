'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse } = require('yaml');
const { atomicJson } = require('./store');
const { readManifest, inventory, packageFile, manifestSchema } = require('./manifest');
const { presentation } = require('./presentation');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function relativeDirectory(value) {
  const normalized = String(value).trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || normalized.startsWith('-') || /[:\x00-\x1f]/.test(normalized) || normalized.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('稀疏路径必须是仓库内的相对目录');
  return normalized;
}
function readJson(root, file) { return JSON.parse(fs.readFileSync(packageFile(root, file), 'utf8')); }
// Shared converter for the official catalog and explicit compatibility imports.
// Importing Skill/MCP declarations does not guarantee upstream host features.
function adaptOfficialPackage(root) {
  if (fs.existsSync(path.join(root, 'yan-plugin.json'))) return { manifest: readManifest(root), presentation: {} };
  const file = ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json'].find(file => fs.existsSync(path.join(root, file)));
  if (!file) throw new Error('未找到插件清单');
  const upstream = readJson(root, file);
  const pack = inventory(root);
  const prefixes = (Array.isArray(upstream.skills) ? upstream.skills : [upstream.skills || 'skills']).map(relativeDirectory);
  const skills = pack.files.filter(file => /(^|\/)SKILL\.md$/.test(file.path) && prefixes.some(prefix => file.path === prefix || file.path.startsWith(prefix + '/'))).map(file => {
    const front = fs.readFileSync(packageFile(root, file.path), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const metadata = front ? parse(front[1]) || {} : {};
    const id = path.posix.basename(path.posix.dirname(file.path));
    return { id, name: String(metadata.name || id), description: String(metadata.description || upstream.description || id).slice(0, 2000), path: file.path };
  });
  let servers = upstream.mcpServers;
  if (!servers && fs.existsSync(path.join(root, '.mcp.json'))) servers = '.mcp.json';
  if (typeof servers === 'string') servers = readJson(root, servers.replace(/^\.\//, ''));
  servers = servers?.mcpServers || servers || {};
  const mcpServers = Object.entries(servers).map(([id, server]) => {
    const replaceRoot = value => String(value).replaceAll('${CLAUDE_PLUGIN_ROOT}', '${pluginRoot}').replaceAll('${CODEX_PLUGIN_ROOT}', '${pluginRoot}');
    if (server.url) return { id, type: 'remote', url: server.url, headers: server.headers || {}, ...(server.auth === 'oauth' ? { auth: 'oauth' } : {}) };
    if (!server.command) throw new Error(`MCP ${id} 缺少 URL 或命令`);
    return { id, type: 'local', command: replaceRoot(server.command), args: (server.args || []).map(replaceRoot), env: Object.fromEntries(Object.entries(server.env || {}).map(([key, value]) => [key, replaceRoot(value)])) };
  });
  if (!skills.length && !mcpServers.length) throw new Error(`${upstream.name || '插件'} 未声明可加载的 Skill 或 MCP`);
  const skillFiles = new Set(skills.map(skill => skill.path));
  const resources = pack.files.filter(file => !skillFiles.has(file.path)).map(file => ({ id: 'file-' + hash(file.path).slice(0, 16), name: file.path, path: file.path }));
  const manifest = manifestSchema.parse({ schemaVersion: 1, id: upstream.name, name: upstream.interface?.displayName || upstream.name,
    version: upstream.version || '0.0.0', description: upstream.description || upstream.name,
    author: typeof upstream.author === 'string' ? upstream.author : upstream.author?.name || '', license: upstream.license || '',
    skills, resources, mcpServers });
  atomicJson(path.join(root, 'yan-plugin.json'), manifest);
  return { manifest: readManifest(root), presentation: presentation(upstream) };
}

module.exports = { adaptOfficialPackage };
