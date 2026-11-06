'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readManifest, inventory, inside, packageFile } = require('./manifest');

// A single native contract for authored packages and future installation sources.
// Structural compatibility is distinct from dependency readiness and runtime QA.
function inspectPackage(source) {
  const pack = inventory(source);
  const manifest = readManifest(source);
  if (!manifest.instructions && !manifest.skills.length && !manifest.resources.length && !manifest.mcpServers.length) {
    throw new Error('插件必须至少声明说明、技能、资源或 MCP 服务之一。');
  }
  if (manifest.platforms && !manifest.platforms.includes(process.platform)) throw new Error('插件不支持当前平台。');
  const config = new Set(Object.keys(manifest.configuration));
  const env = new Set(manifest.environment.map(item => item.name));
  for (const server of manifest.mcpServers) {
    if (server.type === 'local' && /\.(?:cmd|bat|ps1)$/i.test(server.command)) throw new Error('本地 MCP 不支持 cmd/bat/ps1 入口。');
    if (/\$\{/.test(server.command || '') && !server.command.startsWith('${pluginRoot}/')) throw new Error('MCP command 仅支持 pluginRoot 路径占位符。');
    for (const value of [server.command, server.url, ...server.args, ...Object.values(server.env), ...Object.values(server.headers)]) {
      for (const match of String(value || '').matchAll(/\$\{([^}]+)\}/g)) {
        const key = match[1];
        if (key === 'pluginRoot' || key === 'workspace') continue;
        if (key.startsWith('config.') && config.has(key.slice(7))) continue;
        if (key.startsWith('env.') && env.has(key.slice(4))) continue;
        throw new Error(`未声明或不支持的占位符：${key}`);
      }
      if (String(value || '').startsWith('${pluginRoot}/')) {
        const relative = value.slice(14);
        if (!pack.files.some(file => file.path === relative || file.path.startsWith(relative + '/'))) {
          throw new Error(`包内引用不存在或被打包排除：${relative}`);
        }
      }
    }
  }
  return { format: 'yan-plugin', schemaVersion: 1, compatible: true, runtimeVerified: false,
    manifest, digest: pack.digest, fileCount: pack.files.length, bytes: pack.bytes,
    requirements: { commands: manifest.requiredCommands, configuration: manifest.configuration,
      environment: manifest.environment, services: manifest.mcpServers.map(server => ({ id: server.id, type: server.type })) } };
}

function createPackage(input, context) {
  if (!context?.workspace || context.allowFileRead === false || context.allowFileWrite === false) {
    throw new Error('创建插件需要有效 task_id 及当前任务目录的读写权限。');
  }
  const workspace = fs.realpathSync(context.workspace);
  const source = fs.realpathSync(path.resolve(workspace, String(input.source_directory || '')));
  if (!inside(workspace, source)) throw new Error('插件制作目录必须位于当前任务目录内。');
  const report = inspectPackage(source);
  const output = path.join(workspace, `${report.manifest.id}-${report.manifest.version}-${report.digest.slice(0, 12)}.yan-plugin`);
  if (inside(source, output)) throw new Error('请在任务目录的独立子目录中制作插件。');
  // Exclusive creation prevents overwriting user files or following an existing link.
  fs.mkdirSync(output);
  try {
    for (const file of inventory(source).files) {
      const target = path.join(output, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(packageFile(source, file.path), target, fs.constants.COPYFILE_EXCL);
    }
    const copied = inspectPackage(output);
    if (copied.digest !== report.digest) throw new Error('制作目录在打包期间发生变化，请重试。');
    return { ok: true, created: true, installed: false, enabled: false, path: output, ...copied,
      note: 'Yan 插件包已生成并通过格式校验；未运行插件。' };
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }
}
async function installPackage(input, context, store) {
  if (!context?.workspace || context.allowFileRead === false || context.allowFileWrite === false) {
    throw new Error('安装插件需要有效 task_id 及当前任务目录的读写权限。');
  }
  const workspace = fs.realpathSync(context.workspace);
  const source = fs.realpathSync(path.resolve(workspace, String(input.source_directory || '')));
  if (!inside(workspace, source)) throw new Error('插件目录必须位于当前任务目录内。');
  return require('./compatibility').installExternal(source, store, { allowCompatibility: input.allow_compatibility === true });
}
module.exports = { inspectPackage, createPackage, installPackage };
