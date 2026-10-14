'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { z } = require('zod');

const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const text = z.string().min(1).max(2000);
const relative = z.string().min(1).max(240).refine(value =>
  !path.isAbsolute(value) && !/[\\:\x00]/.test(value)
  && value.split('/').every(part => part && part !== '..' && part !== '.'), 'Expected a package-relative path');
const envKey = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value), 'Reserved configuration key');
const fields = z.record(envKey, z.object({
  label: text, description: z.string().max(2000).optional(), required: z.boolean().default(false),
  default: z.string().max(8192).optional()
}).strict());
const server = z.object({
  id, type: z.enum(['local', 'remote']), command: z.string().min(1).max(2048).optional(),
  args: z.array(z.string().max(8192)).max(80).default([]),
  url: z.string().url().optional(), headers: z.record(z.string(), z.string()).default({}),
  env: z.record(envKey, z.string().max(8192)).default({}),
  auth: z.enum(['oauth']).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000)
}).strict().superRefine((value, ctx) => {
  if (value.type === 'local' && !value.command) ctx.addIssue({ code: 'custom', message: 'Local MCP needs command' });
  if (value.type === 'remote' && !/^https?:\/\//.test(value.url || '')) ctx.addIssue({ code: 'custom', message: 'Remote MCP needs HTTP(S) URL' });
  if (value.auth && value.type !== 'remote') ctx.addIssue({ code: 'custom', message: 'OAuth requires a remote service' });
});
const manifestSchema = z.object({
  schemaVersion: z.literal(1), id,
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
  name: z.string().min(1).max(100), description: text,
  author: z.string().max(200).optional(), license: z.string().max(100).optional(),
  instructions: relative.optional(),
  skills: z.array(z.object({ id, name: text, description: text, path: relative }).strict()).max(80).default([]),
  resources: z.array(z.object({ id, name: text, path: relative }).strict()).max(150).default([]),
  mcpServers: z.array(server).max(12).default([]),
  configuration: fields.default({}),
  environment: z.array(z.object({ name: envKey, description: text, required: z.boolean().default(true) }).strict()).max(30).default([]),
  platforms: z.array(z.enum(['win32', 'darwin', 'linux'])).optional(),
  requiredCommands: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/)).max(20).default([])
}).strict();

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
function packageFile(root, relativePath) {
  relative.parse(relativePath);
  const base = fs.realpathSync(root);
  const target = fs.realpathSync(path.join(base, relativePath));
  if (!inside(base, target) || !fs.statSync(target).isFile()) throw new Error('插件资源必须位于插件包内');
  return target;
}
function readManifest(root) {
  const file = packageFile(root, 'yan-plugin.json');
  if (fs.statSync(file).size > 256 * 1024) throw new Error('插件清单超过 256 KB');
  const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  for (const group of [manifest.skills, manifest.resources, manifest.mcpServers]) {
    if (new Set(group.map(item => item.id)).size !== group.length) throw new Error('插件包含重复的能力 ID');
  }
  for (const item of [...manifest.skills, ...manifest.resources]) packageFile(root, item.path);
  if (manifest.instructions) packageFile(root, manifest.instructions);
  return manifest;
}
// Immutable copied packages: reject links, special files, ambiguous Windows names,
// and oversized bundles before copying. Hash paths AND bytes, not just the manifest.
function inventory(root) {
  const files = []; let bytes = 0; let entries = 0;
  function walk(directory, prefix = '', depth = 0) {
    if (depth > 32) throw new Error('插件目录层级超过 32 层');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (['.git', 'node_modules', '__pycache__'].includes(entry.name)) continue;
      if (++entries > 5000) throw new Error('插件文件及目录总数超过 5000');
      if (/[\\:\x00]/.test(entry.name) || /[. ]$/.test(entry.name)) throw new Error('插件包含不安全的文件名');
      const full = path.join(directory, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error('插件包不允许符号链接或目录联接');
      const name = prefix + entry.name;
      if (stat.isDirectory()) walk(full, `${name}/`, depth + 1);
      else if (stat.isFile()) {
        bytes += stat.size;
        if (files.length >= 4000 || bytes > 64 * 1024 * 1024) throw new Error('插件包超过 4000 个文件或 64 MB');
        files.push({ path: name, bytes: stat.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') });
      } else throw new Error('插件包仅支持普通文件');
    }
  }
  walk(fs.realpathSync(root));
  return { files, bytes, digest: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex') };
}
module.exports = { manifestSchema, readManifest, packageFile, inventory, inside };
