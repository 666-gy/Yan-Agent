'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { parse } = require('yaml');
const { atomicJson } = require('./store');
const { readManifest, inventory, inside, packageFile, manifestSchema } = require('./manifest');
const { presentation } = require('./presentation');
const execute = promisify(execFile);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function relativeDirectory(value) {
  const normalized = String(value).trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || normalized.startsWith('-') || /[:\x00-\x1f]/.test(normalized) || normalized.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('稀疏路径必须是仓库内的相对目录');
  return normalized;
}
function readJson(root, file) { return JSON.parse(fs.readFileSync(packageFile(root, file), 'utf8')); }
function copyPackage(source, destination) {
  for (const file of inventory(source).files) {
    const target = path.join(destination, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(packageFile(source, file.path), target);
  }
}

// Adapt supported upstream contributions into the same validated manifest used
// by bundled plugins. Installation never executes scripts or hooks.
function adaptPackage(root) {
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

function createPluginMarketplaces(store, { reservedIds = [] } = {}) {
  const root = path.join(store.root, 'marketplaces');
  const registry = path.join(root, 'registry.json');
  const read = () => fs.existsSync(registry) ? JSON.parse(fs.readFileSync(registry, 'utf8')) : { markets: {} };
  const list = () => Object.values(read().markets).flatMap(market => market.plugins);
  let adding = false;
  async function add(payload = {}) {
    if (adding) throw new Error('正在添加插件市场，请稍候');
    const source = String(payload.source || '').trim();
    const ref = String(payload.ref || '').trim();
    const paths = [...new Set((Array.isArray(payload.sparsePaths) ? payload.sparsePaths : String(payload.sparsePaths || '').split(/\r?\n/)).filter(value => String(value).trim()).map(relativeDirectory))];
    if (!source || source.length > 2048 || /[\x00-\x1f]/.test(source)) throw new Error('请输入有效来源');
    if (ref.startsWith('-') || /[\x00-\x20]/.test(ref) || ref.length > 240) throw new Error('Git 引用无效');
    if (paths.length > 100) throw new Error('稀疏路径最多 100 条');
    adding = true;
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugin-market-'));
    try {
      let checkout;
      const local = fs.existsSync(source) ? fs.realpathSync(source) : '';
      const isGit = local && fs.existsSync(path.join(local, '.git'));
      if (local && !isGit) {
        if (!fs.statSync(local).isDirectory()) throw new Error('本地来源必须是文件夹');
        if (ref) throw new Error('普通本地目录不支持 Git 引用');
        checkout = local;
      } else {
        const remote = local || (/^[\w.-]+\/[\w.-]+$/.test(source) ? `https://github.com/${source}.git` : source);
        if (!local && !/^(https:\/\/[^\s]+|ssh:\/\/[^\s]+|git@[^\s:]+:[^\s]+)$/.test(remote)) throw new Error('来源需要是 GitHub 仓库、HTTPS/SSH Git URL 或本地目录');
        checkout = path.join(stage, 'checkout');
        fs.mkdirSync(checkout);
        const git = async args => {
          try { await execute('git', ['-c', 'core.hooksPath=' + path.join(stage, 'no-hooks'), '-c', 'core.symlinks=true', ...args], { cwd: checkout, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }); }
          catch { throw new Error('Git 获取失败，请检查仓库地址、访问权限和 Git 引用'); }
        };
        await git(['init', '--quiet']);
        await git(['fetch', '--depth=1', '--', remote, ref || 'HEAD']);
        if (paths.length) { await git(['sparse-checkout', 'init', '--cone']); await git(['sparse-checkout', 'set', '--cone', '--', ...paths]); }
        await git(['checkout', '--detach', 'FETCH_HEAD']);
      }
      const candidates = new Set();
      let visited = 0;
      function discover(directory, depth = 0) {
        if (++visited > 5000 || depth > 20) throw new Error('市场目录过大，请指定稀疏路径');
        if (['yan-plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json'].some(file => fs.existsSync(path.join(directory, file)))) { candidates.add(directory); return; }
        for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
          if (item.isDirectory() && !item.isSymbolicLink() && !['.git', 'node_modules', '__pycache__'].includes(item.name)) discover(path.join(directory, item.name), depth + 1);
        }
      }
      for (const relative of paths.length ? paths : ['']) {
        const target = fs.realpathSync(path.join(checkout, relative));
        if (!inside(checkout, target)) throw new Error('稀疏路径超出来源目录');
        discover(target);
      }
      if (!candidates.size) throw new Error('来源中未找到 yan-plugin.json 或 Codex/Claude 插件清单，请检查稀疏路径');
      if (candidates.size > 100) throw new Error('市场超过 100 个插件，请缩小稀疏路径范围');
      const id = hash(JSON.stringify({ source, ref, paths })).slice(0, 24);
      const state = read();
      const occupied = new Set(Object.values(state.markets).filter(market => market.id !== id).flatMap(market => market.plugins.map(plugin => plugin.id)));
      const plugins = [], skipped = [];
      for (const directory of candidates) {
        const target = path.join(stage, 'packages', String(plugins.length));
        copyPackage(directory, target);
        const { manifest, presentation: details } = adaptPackage(target);
        if (reservedIds.includes(manifest.id)) { skipped.push(manifest.id); fs.rmSync(target, { recursive: true, force: true }); continue; }
        if (occupied.has(manifest.id) || plugins.some(item => item.id === manifest.id)) throw new Error(`插件 ID 重复：${manifest.id}`);
        const pack = inventory(target);
        const destination = path.join(root, 'packages', pack.digest);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        if (!fs.existsSync(destination)) fs.renameSync(target, destination);
        else fs.rmSync(target, { recursive: true, force: true });
        plugins.push({ ...manifest, presentation: details, category: 'custom', marketId: id, source, revision: ref, digest: pack.digest });
      }
      if (!plugins.length) throw new Error('该来源中的插件已全部包含在内置市场中');
      state.markets[id] = { id, source, ref, sparsePaths: paths, plugins };
      atomicJson(registry, state);
      return { count: plugins.length, skipped };
    } finally { adding = false; fs.rmSync(stage, { recursive: true, force: true }); }
  }
  function install(id) {
    const item = list().find(item => item.id === id);
    if (!item || !/^[a-f0-9]{64}$/.test(item.digest)) throw new Error('市场插件不存在');
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-market-install-'));
    try { copyPackage(path.join(root, 'packages', item.digest), stage); return store.install(stage, item.digest); }
    finally { fs.rmSync(stage, { recursive: true, force: true }); }
  }
  // Marketplaces are shown as sources so a user (or the Agent) can remove one
  // they added; the built-in catalog is never a marketplace and cannot be
  // removed here. Installed plugins keep working: their packages are
  // content-addressed and their records live in the plugin registry, not here.
  function markets() {
    return Object.values(read().markets).map(market => ({
      id: market.id, source: market.source, ref: market.ref || '',
      sparsePaths: Array.isArray(market.sparsePaths) ? market.sparsePaths : [],
      count: market.plugins.length, plugins: market.plugins.map(plugin => ({ id: plugin.id, name: plugin.name }))
    })).sort((a, b) => a.source.localeCompare(b.source));
  }
  function remove(id) {
    const state = read();
    if (!Object.hasOwn(state.markets, id)) throw new Error('插件市场不存在');
    const market = state.markets[id];
    delete state.markets[id];
    atomicJson(registry, state);
    return { id, removed: true, source: market.source, count: market.plugins.length };
  }
  return { list, add, install, markets, remove };
}
module.exports = { createPluginMarketplaces, adaptPackage };
