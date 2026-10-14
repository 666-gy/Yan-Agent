'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readManifest, packageFile, inventory, inside } = require('./manifest');
const { accountStatus } = require('./auth-state');

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function createPluginStore(dataDir) {
  if (!dataDir) throw new Error('Plugin data directory is required');
  const root = path.resolve(dataDir, 'plugins');
  const registryFile = path.join(root, 'registry.json');
  const read = () => {
    if (!fs.existsSync(registryFile)) return { schemaVersion: 1, plugins: {} };
    const data = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    if (data.schemaVersion !== 1 || !data.plugins || Array.isArray(data.plugins)) throw new Error('插件注册表损坏，请恢复备份');
    return data;
  };
  function packageRoot(record) {
    if (!/^[a-f0-9]{64}$/.test(record?.digest || '')) throw new Error('无效插件版本');
    return path.join(root, 'packages', record.digest);
  }
  function get(id) { const plugins = read().plugins; return Object.hasOwn(plugins, id) ? plugins[id] : null; }
  function manifest(record) { return readManifest(packageRoot(record)); }
  function contributions(record) {
    const m = manifest(record), disabled = new Set(record.disabledSkills || []);
    const owners = [...m.skills].sort((a, b) => b.path.length - a.path.length);
    const allowed = file => {
      const exact = m.skills.find(skill => skill.path === file);
      const owner = exact || owners.find(skill => file.startsWith(`${path.posix.dirname(skill.path)}/`));
      return !owner || !disabled.has(owner.id);
    };
    return { ...m, skills: m.skills.filter(skill => !disabled.has(skill.id)), resources: m.resources.filter(resource => allowed(resource.path)) };
  }
  function saveRecord(record) {
    const data = read(); data.plugins[record.id] = record; atomicJson(registryFile, data); return record;
  }
  function executable(command, env = process.env) {
    if (command === '$node') return process.execPath;
    if (path.isAbsolute(command)) return fs.existsSync(command) && fs.statSync(command).isFile() ? command : '';
    // Shell scripts (.cmd/.bat) are deliberately not launched through cmd.exe.
    // Authors can use $node plus a packaged JS entry for portable local servers.
    const suffixes = process.platform === 'win32' && !path.extname(command) ? ['.exe', '.com', ''] : [''];
    for (const dir of String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
      for (const suffix of suffixes) {
        const file = path.join(dir, command + suffix);
        if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
      }
    }
    return '';
  }
  function prepare(record, env = process.env) {
    const m = manifest(record); const issues = [];
    const supported = !m.platforms || m.platforms.includes(process.platform);
    const platformNames = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
    if (!supported) issues.push(`运行需要 ${m.platforms.map(platform => platformNames[platform]).join(' / ')}；当前为 ${platformNames[process.platform] || process.platform}，可查看插件内容`);
    if (supported) for (const command of m.requiredCommands) if (!executable(command, env)) issues.push(`缺少运行工具：${command}`);
    for (const [key, field] of Object.entries(m.configuration)) {
      if (field.required && !String(record.configuration?.[key] ?? field.default ?? '').trim()) issues.push(`缺少配置：${field.label}`);
    }
    for (const item of m.environment) if (item.required && (!Object.hasOwn(env, item.name) || !env[item.name])) issues.push(`缺少环境变量：${item.name}`);
    for (const server of m.mcpServers) {
      if (server.auth === 'oauth' && accountStatus(dataDir, record.id, server).state !== 'connected') issues.push(`请连接 ${server.id} 账号`);
      if (server.type !== 'local' || !supported) continue;
      const command = server.command.replaceAll('${pluginRoot}', packageRoot(record));
      if (/\$\{/.test(command) || /\.(cmd|bat|ps1)$/i.test(command) || !executable(command, env)) issues.push(`无法直接执行：${server.command}（可使用 $node 与插件内脚本）`);
    }
    return { ready: !issues.length, issues, checkedAt: Date.now() };
  }
  function visible(record, workspace = '') {
    return record.scope !== 'workspace' || (workspace && path.resolve(record.workspace) === path.resolve(workspace));
  }
  function describe(record) {
    const m = manifest(record); const status = prepare(record);
    return { id: record.id, name: m.name, version: m.version, description: m.description,
      author: m.author || '', license: m.license || '', enabled: record.enabled, scope: record.scope,
      workspace: record.workspace, digest: record.digest, installedAt: record.installedAt,
      source: record.source, configuration: record.configuration, configurationFields: m.configuration,
      environment: m.environment.map(item => ({ ...item, configured: Object.hasOwn(process.env, item.name) && !!process.env[item.name] })),
      disabledSkills: record.disabledSkills || [], skills: m.skills.map(skill => ({ ...skill, enabled: !(record.disabledSkills || []).includes(skill.id) })), resources: m.resources, servers: m.mcpServers.map(s => ({ id: s.id, type: s.type })),
      accounts: m.mcpServers.filter(s => s.auth === 'oauth').map(s => ({ id: s.id, ...accountStatus(dataDir, record.id, s) })),
      hasInstructions: !!m.instructions, ...status };
  }
  function list() {
    return Object.values(read().plugins).map(record => {
      try { return describe(record); }
      catch (error) { return { id: record.id, name: record.id, enabled: record.enabled, scope: record.scope, workspace: record.workspace, version: record.version, ready: false, issues: [error.message], broken: true }; }
    }).sort((a, b) => a.id.localeCompare(b.id));
  }
  function preview(source) {
    const resolved = fs.realpathSync(source);
    if (inside(root, resolved) || inside(resolved, root)) throw new Error('请从插件存储目录之外选择插件包');
    const m = readManifest(resolved); const pack = inventory(resolved);
    return { source: resolved, digest: pack.digest, bytes: pack.bytes, fileCount: pack.files.length, manifest: m,
      previousVersion: get(m.id)?.version || null };
  }
  function install(source, expectedDigest) {
    const candidate = preview(source);
    if (candidate.digest !== expectedDigest) throw new Error('插件文件已变化，请重新预览');
    const packages = path.join(root, 'packages'); fs.mkdirSync(packages, { recursive: true });
    const stage = path.join(packages, `.stage-${crypto.randomUUID()}`);
    fs.mkdirSync(stage);
    try {
      const pack = inventory(candidate.source);
      for (const file of pack.files) {
        const destination = path.join(stage, file.path); fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(packageFile(candidate.source, file.path), destination);
      }
      if (inventory(stage).digest !== expectedDigest) throw new Error('插件在复制期间发生变化');
      readManifest(stage);
      const destination = path.join(packages, expectedDigest);
      if (fs.existsSync(destination) && inventory(destination).digest !== expectedDigest) throw new Error('已安装的插件文件被修改，请先恢复原文件');
      if (!fs.existsSync(destination)) fs.renameSync(stage, destination);
      const previous = get(candidate.manifest.id);
      const record = { id: candidate.manifest.id, version: candidate.manifest.version, digest: expectedDigest,
        source: candidate.source, enabled: false, scope: previous?.scope || 'global', workspace: previous?.workspace || '',
        configuration: previous?.configuration || {}, disabledSkills: (previous?.disabledSkills || []).filter(id => candidate.manifest.skills.some(skill => skill.id === id)), epoch: crypto.randomUUID(), installedAt: Date.now() };
      // Upgrades keep the enable epoch for pinned sessions; reinstall after an
      // uninstall or disable has a new epoch and cannot revive old grants.
      if (previous) { record.enabled = previous.enabled; record.epoch = previous.epoch; }
      saveRecord(record); return describe(record);
    } finally { if (fs.existsSync(stage) && path.dirname(stage) === packages) fs.rmSync(stage, { recursive: true, force: true }); }
  }
  function update(id, changes) {
    const record = get(id); if (!record) throw new Error('插件未安装');
    if (changes.skill !== undefined) {
      const skill = changes.skill;
      if (!skill || typeof skill.id !== 'string' || typeof skill.enabled !== 'boolean' || !manifest(record).skills.some(item => item.id === skill.id)) throw new Error('无效技能开关');
      const disabled = new Set(record.disabledSkills || []);
      const wasEnabled = !disabled.has(skill.id);
      if (skill.enabled) disabled.delete(skill.id); else disabled.add(skill.id);
      record.disabledSkills = [...disabled];
      if (wasEnabled !== skill.enabled) record.epoch = crypto.randomUUID();
    }
    if (changes.configuration !== undefined) {
      const m = manifest(record);
      if (!changes.configuration || typeof changes.configuration !== 'object' || Array.isArray(changes.configuration)) throw new Error('无效配置');
      for (const [key, value] of Object.entries(changes.configuration)) {
        if (!Object.hasOwn(m.configuration, key) || typeof value !== 'string' || value.length > 8192) throw new Error(`无效配置项：${key}`);
      }
      record.configuration = { ...changes.configuration };
    }
    if (changes.scope !== undefined) {
      if (!['global', 'workspace'].includes(changes.scope)) throw new Error('无效作用范围');
      if (changes.scope === 'workspace' && (!changes.workspace || !path.isAbsolute(changes.workspace) || !fs.statSync(changes.workspace).isDirectory())) throw new Error('请选择有效工作区');
      record.scope = changes.scope; record.workspace = changes.scope === 'workspace' ? fs.realpathSync(changes.workspace) : '';
      record.epoch = crypto.randomUUID();
    }
    if (changes.enabled !== undefined) {
      if (typeof changes.enabled !== 'boolean') throw new Error('无效启用状态');
      record.enabled = changes.enabled;
      if (!record.enabled) record.epoch = crypto.randomUUID();
    }
    saveRecord(record); return list().find(item => item.id === id);
  }
  function remove(id) {
    const data = read(); if (!Object.hasOwn(data.plugins, id)) throw new Error('插件未安装');
    delete data.plugins[id]; atomicJson(registryFile, data);
    // Content-addressed packages are retained: active/pinned revisions are
    // never deleted underneath a session. Uninstall immediately revokes calls.
    return { id, removed: true };
  }
  return { root, get, manifest, contributions, packageRoot, list, describe, visible, prepare, preview, install, update, remove, executable };
}
module.exports = { createPluginStore, atomicJson };
