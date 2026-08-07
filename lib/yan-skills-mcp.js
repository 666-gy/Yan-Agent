'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { stripVTControlCharacters } = require('util');
const skillRegistry = require('./skill-registry');

const skillsRoot = path.resolve(String(process.env.YAN_SKILLS_ROOT || ''));
const dataDir = path.resolve(String(process.env.YAN_SKILLS_DATA_DIR || path.dirname(skillsRoot)));
const configPath = path.resolve(String(process.env.YAN_SKILLS_CONFIG_PATH || path.join(dataDir, 'config.json')));
const skillsCli = path.resolve(String(process.env.YAN_SKILLS_CLI || ''));
const appRoot = path.resolve(String(process.env.YAN_SKILLS_APP_ROOT || path.join(__dirname, '..')));
const networkAllowed = process.env.YAN_SKILLS_ALLOW_NETWORK !== 'false';
const designReferenceRoot = path.join(appRoot, 'lib', 'skills', 'awesome-design-md', 'design-md');
const stagingRoot = path.join(dataDir, 'SkillStore', 'staging', 'skills-cli');
const quarantineRoot = path.join(dataDir, 'SkillStore', 'quarantine');
const activeCalls = new Map();
let mutationQueue = Promise.resolve();

const MAX_SKILL_FILES = 5_000;
const MAX_SKILL_BYTES = 256 * 1024 * 1024;
const MAX_TOOL_OUTPUT = 4 * 1024 * 1024;
const MAX_DESIGN_REFERENCE_BYTES = 512 * 1024;

function selectedSkillIdsForRun() {
  try {
    const encoded = String(process.env.YAN_SKILLS_SELECTED_IDS || '');
    if (!encoded) return new Set();
    const values = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (!Array.isArray(values)) return new Set();
    return new Set(values.map(value => String(value || '').trim().toLowerCase()).filter(Boolean));
  } catch {
    return new Set();
  }
}

const userSelectedSkillIds = selectedSkillIdsForRun();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan Skills MCP error') } });
}

function normalizeDocument(text) {
  return String(text || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function decodeFrontmatterValue(value) {
  const source = String(value || '').trim();
  if (source.length < 2) return source;
  const first = source[0];
  const last = source[source.length - 1];
  if (first === '"' && last === '"') {
    try { return JSON.parse(source); } catch { return source.slice(1, -1); }
  }
  if (first === "'" && last === "'") return source.slice(1, -1).replaceAll("''", "'");
  return source;
}

function parseSkillDocument(text) {
  const normalized = normalizeDocument(text);
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') throw new Error('SKILL.md 缺少 YAML frontmatter。');
  let closing = -1;
  for (let index = 1; index < lines.length; index++) {
    if (lines[index].trim() === '---') {
      closing = index;
      break;
    }
  }
  if (closing < 0) throw new Error('SKILL.md 的 YAML frontmatter 未闭合。');

  const metadata = {};
  for (let index = 1; index < closing; index++) {
    const line = lines[index];
    if (!line || line[0] === ' ' || line[0] === '\t') continue;
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const rawValue = line.slice(separator + 1).trim();
    if (!key) continue;
    if (rawValue === '|' || rawValue === '>') {
      const chunks = [];
      while (index + 1 < closing) {
        const continuation = lines[index + 1];
        if (continuation && continuation[0] !== ' ' && continuation[0] !== '\t') break;
        index++;
        chunks.push(continuation.trim());
      }
      metadata[key] = chunks.join(rawValue === '>' ? ' ' : '\n').trim();
    } else {
      metadata[key] = decodeFrontmatterValue(rawValue);
    }
  }
  const name = String(metadata.name || '').trim();
  const description = String(metadata.description || '').trim();
  const prompt = lines.slice(closing + 1).join('\n').trim();
  if (!name) throw new Error('SKILL.md frontmatter 缺少 name。');
  if (!description) throw new Error('SKILL.md frontmatter 缺少 description。');
  if (!prompt) throw new Error('SKILL.md 没有可调用的正文。');
  return { metadata, name, description, prompt, document: normalized };
}

function safeDirectoryName(value) {
  const source = String(value || '').trim().toLowerCase();
  let output = '';
  for (const character of source) {
    const code = character.charCodeAt(0);
    const allowed = (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
      || character === '.'
      || character === '_'
      || character === '-';
    output += allowed ? character : '-';
  }
  while (output.includes('--')) output = output.replaceAll('--', '-');
  while (output.startsWith('-') || output.startsWith('.')) output = output.slice(1);
  while (output.endsWith('-') || output.endsWith('.')) output = output.slice(0, -1);
  return output.slice(0, 96) || 'skill';
}

function assertConfiguredPaths() {
  if (!skillsRoot || skillsRoot === path.parse(skillsRoot).root) throw new Error('Yan Skill 根目录未配置。');
  if (!dataDir || dataDir === path.parse(dataDir).root) throw new Error('Yan 数据目录未配置。');
  if (!skillsRoot.startsWith(`${dataDir}${path.sep}`)) throw new Error('Yan Skill 根目录必须位于 YanData 内。');
  if (path.dirname(configPath) !== dataDir) throw new Error('Yan 配置文件必须位于 YanData 根目录。');
}

function assertInside(root, target, allowRoot = false) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if ((allowRoot && resolvedTarget === resolvedRoot) || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    return resolvedTarget;
  }
  throw new Error('路径超出 Yan Skill 管理器允许的范围。');
}

function assertDirectChild(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (path.dirname(resolvedTarget) !== resolvedRoot) throw new Error('Skill 必须是 Yan Skill 根目录的直接子目录。');
  return resolvedTarget;
}

function cleanText(value, label, maxLength) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label}不能为空。`);
  if (text.length > maxLength) throw new Error(`${label}过长。`);
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 32 && character !== '\n' && character !== '\t') throw new Error(`${label}包含无效控制字符。`);
  }
  return text;
}

function remoteSkillSource(value) {
  const source = cleanText(value, 'Skill 来源', 2_048);
  const lower = source.toLowerCase();
  const remotePrefix = lower.startsWith('https://')
    || lower.startsWith('ssh://')
    || lower.startsWith('git@');
  if (remotePrefix) return source;
  if (lower.startsWith('http://') || lower.startsWith('file:')) {
    throw new Error('Yan 仅允许通过 HTTPS 或受认证的 Git 地址安装远程 Skill。');
  }
  if (source.includes('\\') || source.startsWith('.') || path.isAbsolute(source)) {
    throw new Error('Yan Skill 安装器不接受本地路径；请提供 GitHub/GitLab 仓库或远程 Skill URL。');
  }
  const slash = source.indexOf('/');
  if (slash <= 0 || slash === source.length - 1) {
    throw new Error('请提供 owner/repo、远程仓库 URL 或具体 Skill URL。');
  }
  return source;
}

function normalizeRequestedSkills(values) {
  if (!Array.isArray(values)) return [];
  if (values.length > 20) throw new Error('一次最多安装 20 个 Skill。');
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const name = cleanText(value, 'Skill 名称', 160);
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(name);
    }
  }
  return result;
}

function appendBounded(current, chunk) {
  const next = `${current}${String(chunk || '')}`;
  return next.length <= MAX_TOOL_OUTPUT ? next : next.slice(next.length - MAX_TOOL_OUTPUT);
}

async function runOfficialSkillsCli(args, cwd, signal, timeoutMs) {
  if (!fs.existsSync(skillsCli)) throw new Error('Yan 安装包缺少官方 skills CLI。');
  const runtimeHome = path.join(cwd, '.yan-cli-home');
  const runtimeTemp = path.join(cwd, '.yan-cli-temp');
  await Promise.all([
    fsp.mkdir(runtimeHome, { recursive: true }),
    fsp.mkdir(runtimeTemp, { recursive: true })
  ]);
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const environment = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOME: runtimeHome,
      USERPROFILE: runtimeHome,
      XDG_CONFIG_HOME: path.join(runtimeHome, 'config'),
      XDG_DATA_HOME: path.join(runtimeHome, 'data'),
      XDG_CACHE_HOME: path.join(runtimeHome, 'cache'),
      TEMP: runtimeTemp,
      TMP: runtimeTemp,
      CI: '1',
      DISABLE_TELEMETRY: '1',
      DO_NOT_TRACK: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0'
    };
    const child = spawn(process.execPath, [skillsCli, ...args], {
      cwd,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(result);
    };
    const onAbort = () => {
      try { child.kill(); } catch {}
      finish(new Error('Yan Skill 操作已取消。'));
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(new Error('官方 skills CLI 执行超时。'));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', chunk => { stdout = appendBounded(stdout, chunk); });
    child.stderr?.on('data', chunk => { stderr = appendBounded(stderr, chunk); });
    child.once('error', error => finish(error));
    child.once('exit', code => {
      const output = stripVTControlCharacters(`${stdout}${stderr ? `\n${stderr}` : ''}`).trim();
      if (code !== 0) {
        finish(new Error(output || `官方 skills CLI 退出，代码 ${code}`));
        return;
      }
      finish(null, { output, exitCode: Number(code) || 0 });
    });
    if (signal?.aborted) onAbort();
  });
}

async function removeStagingDirectory(target) {
  const resolved = assertInside(stagingRoot, target);
  await fsp.rm(resolved, { recursive: true, force: true });
}

async function readDirectSkills(root) {
  await fsp.mkdir(root, { recursive: true });
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = assertDirectChild(root, path.join(root, entry.name));
    const skillFile = path.join(directory, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    try {
      const parsed = parseSkillDocument(await fsp.readFile(skillFile, 'utf8'));
      skills.push({
        id: parsed.name.toLowerCase(),
        name: parsed.name,
        description: parsed.description,
        directory,
        folder: entry.name
      });
    } catch {}
  }
  return skills;
}

async function copySkillTree(source, destination) {
  const state = { files: 0, bytes: 0 };
  async function copyEntry(from, to) {
    const info = await fsp.lstat(from);
    if (info.isSymbolicLink()) throw new Error(`Skill 包含不允许的符号链接：${path.basename(from)}`);
    if (info.isDirectory()) {
      await fsp.mkdir(to, { recursive: true });
      const entries = await fsp.readdir(from, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        await copyEntry(path.join(from, entry.name), path.join(to, entry.name));
      }
      return;
    }
    if (!info.isFile()) throw new Error(`Skill 包含不支持的文件类型：${path.basename(from)}`);
    state.files++;
    state.bytes += info.size;
    if (state.files > MAX_SKILL_FILES) throw new Error(`Skill 文件数量超过 ${MAX_SKILL_FILES} 个。`);
    if (state.bytes > MAX_SKILL_BYTES) throw new Error('Skill 总大小超过 256 MiB。');
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
  }
  await copyEntry(source, destination);
  return state;
}

async function installedCliSkills(projectDir) {
  const canonicalRoot = path.join(projectDir, '.agents', 'skills');
  return readDirectSkills(canonicalRoot);
}

async function installOneCliSkill(candidate, source, replaceExisting) {
  const folder = safeDirectoryName(candidate.name);
  const destination = assertDirectChild(skillsRoot, path.join(skillsRoot, folder));
  const packageRoot = await fsp.mkdtemp(path.join(stagingRoot, 'package-'));
  const prepared = assertInside(packageRoot, path.join(packageRoot, folder));
  let backup = '';
  try {
    const stats = await copySkillTree(candidate.directory, prepared);
    const parsed = parseSkillDocument(await fsp.readFile(path.join(prepared, 'SKILL.md'), 'utf8'));
    const installed = await readDirectSkills(skillsRoot);
    const conflict = installed.find(item => item.id === parsed.name.toLowerCase() || item.folder === folder);
    if (conflict && !replaceExisting) {
      throw new Error(`Skill「${parsed.name}」已经安装；如需更新，请将 replace_existing 设为 true。`);
    }
    const now = Date.now();
    await fsp.writeFile(path.join(prepared, '.yan-skill.json'), `${JSON.stringify({
      schema: 1,
      id: parsed.name.toLowerCase(),
      name: parsed.name,
      desc: parsed.description,
      source: 'skills-cli',
      repo: source,
      installedAt: now,
      updatedAt: now,
      files: stats.files,
      bytes: stats.bytes
    }, null, 2)}\n`, 'utf8');

    if (conflict) {
      await fsp.mkdir(quarantineRoot, { recursive: true });
      backup = assertInside(quarantineRoot, path.join(
        quarantineRoot,
        `${conflict.folder}-${now}-${crypto.randomBytes(4).toString('hex')}`
      ));
      await fsp.rename(conflict.directory, backup);
    }
    await fsp.rename(prepared, destination);
    return {
      id: parsed.name.toLowerCase(),
      name: parsed.name,
      description: parsed.description,
      directory: destination,
      files: stats.files,
      bytes: stats.bytes,
      replaced: !!conflict,
      previousVersionQuarantinedAt: backup || null
    };
  } catch (error) {
    if (backup && !fs.existsSync(destination) && fs.existsSync(backup)) {
      try { await fsp.rename(backup, destination); } catch {}
    }
    throw error;
  } finally {
    await removeStagingDirectory(packageRoot).catch(() => {});
  }
}

async function installSkills(input, signal) {
  if (!networkAllowed) throw new Error('Yan 的网络权限已关闭，无法查找或安装远程 Skill。');
  const source = remoteSkillSource(input.source);
  const requested = normalizeRequestedSkills(input.skills);
  const installAll = input.install_all === true;
  if (installAll && requested.length) throw new Error('install_all 与 skills 不能同时使用。');
  await Promise.all([
    fsp.mkdir(skillsRoot, { recursive: true }),
    fsp.mkdir(stagingRoot, { recursive: true }),
    fsp.mkdir(quarantineRoot, { recursive: true })
  ]);
  const projectDir = await fsp.mkdtemp(path.join(stagingRoot, 'project-'));
  try {
    const args = ['add', source, '--agent', 'opencode', '--copy', '--yes'];
    if (installAll) args.push('--skill', '*');
    for (const skill of requested) args.push('--skill', skill);
    const cli = await runOfficialSkillsCli(args, projectDir, signal, 10 * 60 * 1000);
    const candidates = await installedCliSkills(projectDir);
    if (!candidates.length) {
      throw new Error(`官方 skills CLI 没有产生可安装的 SKILL.md。${cli.output ? `\n${cli.output}` : ''}`);
    }
    const installed = [];
    for (const candidate of candidates) {
      installed.push(await installOneCliSkill(candidate, source, input.replace_existing === true));
    }
    return {
      ok: true,
      message: `已通过官方 skills CLI 安装 ${installed.length} 个完整 Skill。`,
      root: skillsRoot,
      installed,
      cliOutput: cli.output
    };
  } finally {
    await removeStagingDirectory(projectDir).catch(() => {});
  }
}

async function findSkills(input, signal) {
  if (!networkAllowed) throw new Error('Yan 的网络权限已关闭，无法查找远程 Skill。');
  const query = cleanText(input.query, '搜索词', 300);
  await fsp.mkdir(stagingRoot, { recursive: true });
  const projectDir = await fsp.mkdtemp(path.join(stagingRoot, 'find-'));
  try {
    const args = ['find', query];
    const owner = String(input.owner || '').trim();
    if (owner) args.push('--owner', cleanText(owner, '仓库所有者', 120));
    const cli = await runOfficialSkillsCli(args, projectDir, signal, 90_000);
    return { ok: true, query, results: cli.output };
  } finally {
    await removeStagingDirectory(projectDir).catch(() => {});
  }
}

async function listInstalledSkills() {
  let config = {};
  try { config = JSON.parse(await fsp.readFile(configPath, 'utf8')); } catch {}
  const installed = skillRegistry.getMergedSkillsForList(config, appRoot, dataDir)
    .filter(skill => !skill.userOnly);
  return {
    ok: true,
    root: skillsRoot,
    count: installed.length,
    skills: installed.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.desc || '',
      aliases: Array.isArray(skill.aliases) ? skill.aliases : [],
      tags: Array.isArray(skill.tags) ? skill.tags : [],
      requires: Array.isArray(skill.requires) ? skill.requires : [],
      source: skill.source || 'installed'
    }))
  };
}

async function listSkillFiles(directory, limit = 250) {
  const result = [];
  async function walk(current, relative) {
    if (result.length >= limit) return;
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (result.length >= limit) break;
      const nextRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), nextRelative);
      else if (entry.isFile()) result.push(nextRelative.replaceAll('\\', '/'));
    }
  }
  await walk(directory, '');
  return result;
}

async function resolveInstalledSkill(value) {
  const query = cleanText(value, 'Skill id', 160).toLowerCase();
  const installed = await readDirectSkills(skillsRoot);
  const match = installed.find(item => item.id === query || item.folder.toLowerCase() === query || item.name.toLowerCase() === query);
  if (!match) throw new Error(`Yan Skill 目录中未找到「${value}」。`);
  return match;
}

async function readInstalledSkill(input) {
  let config = {};
  try { config = JSON.parse(await fsp.readFile(configPath, 'utf8')); } catch {}
  const requestedId = String(input.id || '').trim().toLowerCase();
  const resolved = skillRegistry.readSkill(
    input.id,
    '',
    config,
    appRoot,
    dataDir,
    () => {},
    { allowUserOnly: userSelectedSkillIds.has(requestedId) }
  );
  if (!resolved?.ok) throw new Error(resolved?.error || `Yan Skill 中未找到「${input.id}」。`);
  const directory = String(resolved.runtimeDirectory || '');
  const skillFile = directory ? path.join(directory, 'SKILL.md') : '';
  const document = skillFile && fs.existsSync(skillFile)
    ? await fsp.readFile(skillFile, 'utf8')
    : String(resolved.prompt || '');
  return {
    ok: true,
    id: resolved.id,
    name: resolved.name,
    description: resolved.desc || '',
    directory,
    files: directory ? await listSkillFiles(directory) : [],
    skillDocument: document,
    instructions: String(resolved.prompt || document),
    executionContext: directory
      ? `Apply the complete instructions above. Resolve every relative script, template, asset, and <skill_dir> reference against this Yan-owned directory: ${directory}`
      : 'Apply the complete Yan built-in Skill instructions above directly.'
  };
}

function normalizeDesignReferenceId(value) {
  const id = cleanText(value, '设计参考 id', 96).toLowerCase();
  if (id === '.' || id === '..') throw new Error('设计参考 id 无效。');
  for (const character of id) {
    const code = character.charCodeAt(0);
    const allowed = (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
      || character === '-'
      || character === '.';
    if (!allowed) throw new Error('设计参考 id 只能包含小写字母、数字、短横线和点。');
  }
  return id;
}

async function listDesignReferences() {
  const entries = await fsp.readdir(designReferenceRoot, { withFileTypes: true });
  const references = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = assertDirectChild(designReferenceRoot, path.join(designReferenceRoot, entry.name));
    if (!fs.existsSync(path.join(directory, 'DESIGN.md'))) continue;
    references.push(entry.name);
  }
  references.sort((left, right) => left.localeCompare(right));
  return {
    ok: true,
    count: references.length,
    references
  };
}

async function readDesignReference(input) {
  const id = normalizeDesignReferenceId(input.id);
  const directory = assertDirectChild(designReferenceRoot, path.join(designReferenceRoot, id));
  const file = path.join(directory, 'DESIGN.md');
  const info = await fsp.stat(file).catch(() => null);
  if (!info?.isFile()) throw new Error(`未找到设计参考「${id}」。请先调用 list_design_references。`);
  if (info.size > MAX_DESIGN_REFERENCE_BYTES) throw new Error(`设计参考「${id}」超过读取上限。`);
  return {
    ok: true,
    id,
    source: 'VoltAgent/awesome-design-md',
    content: await fsp.readFile(file, 'utf8')
  };
}

async function removeInstalledSkill(input) {
  const skill = await resolveInstalledSkill(input.id);
  const direct = assertDirectChild(skillsRoot, skill.directory);
  await fsp.mkdir(quarantineRoot, { recursive: true });
  const quarantine = assertInside(quarantineRoot, path.join(
    quarantineRoot,
    `${skill.folder}-removed-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  ));
  await fsp.rename(direct, quarantine);
  try {
    const config = JSON.parse(await fsp.readFile(configPath, 'utf8'));
    if (Array.isArray(config.customSkills)) {
      const remaining = config.customSkills.filter(item => String(item?.id || '').trim().toLowerCase() !== skill.id);
      if (remaining.length !== config.customSkills.length) {
        config.customSkills = remaining;
        await fsp.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      try { await fsp.rename(quarantine, direct); } catch {}
      throw new Error(`Skill 已移动但 Yan 配置同步失败，已尝试恢复：${error?.message || error}`);
    }
  }
  return {
    ok: true,
    removed: true,
    id: skill.id,
    name: skill.name,
    root: skillsRoot,
    recoverableFrom: quarantine
  };
}

function serializeMutation(operation) {
  const next = mutationQueue.then(operation, operation);
  mutationQueue = next.catch(() => {});
  return next;
}

function toolDefinitions() {
  return [
    {
      name: 'find_skills',
      description: 'Search the official open Agent Skills ecosystem through the bundled official skills CLI. This is allowed without a user workspace because it does not create user deliverables. Use this before recommending or installing an unknown Yan Agent Skill.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Skill search keywords.' },
          owner: { type: 'string', description: 'Optional GitHub owner or organization filter.' }
        },
        required: ['query'],
        additionalProperties: false
      }
    },
    {
      name: 'install_skill',
      description: 'Install one or more real, complete Yan Agent Skills through the bundled official skills CLI. Works in Blank without general write or shell permission. The destination is fixed internally to YanData/skills; never use write/edit/bash to create or summarize SKILL.md yourself. After the tool returns, continue the same turn and report the exact installed Skill ids in the final answer.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'owner/repo, a remote repository URL, or a direct remote Skill URL.' },
          skills: { type: 'array', items: { type: 'string' }, description: 'Optional exact Skill names for a multi-Skill repository.' },
          install_all: { type: 'boolean', description: 'Install every discovered Skill from the source.' },
          replace_existing: { type: 'boolean', description: 'Replace an already installed Yan Skill while quarantining the previous version.' }
        },
        required: ['source'],
        additionalProperties: false
      }
    },
    {
      name: 'list_installed_skills',
      description: 'List every Skill available to Yan Agent: Yan bundled Skills plus user Skills installed in Yan own Skill directory. Never scans .agents, .claude, .opencode, Codex, Cursor, or another application.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'read_skill',
      description: 'Load the complete instructions for any available Yan Agent Skill, including bundled and user-installed Skills. Use it before specialized work when the Skill catalog matches the task, and use it immediately after installing a Skill when the native skill tool has not refreshed yet.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Installed Yan Skill id or name.' } },
        required: ['id'],
        additionalProperties: false
      }
    },
    {
      name: 'list_design_references',
      description: 'List the exact brand ids available in Yan bundled Awesome DESIGN.md library. Returns names only and does not load any DESIGN.md content.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'read_design_reference',
      description: 'Read one exact brand DESIGN.md reference from Yan bundled Awesome DESIGN.md library. Read only the brand needed for the current task; never use this tool to load the entire library.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Exact brand id returned by list_design_references.' } },
        required: ['id'],
        additionalProperties: false
      }
    },
    {
      name: 'remove_skill',
      description: 'Remove an installed Yan Agent Skill in Blank without general write permission. Only a direct child of YanData/skills can be removed; it is moved to Yan quarantine for recovery. After the tool returns, continue the same turn and report the deletion result in the final answer.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Installed Yan Skill id or name.' } },
        required: ['id'],
        additionalProperties: false
      }
    }
  ];
}

async function callTool(request) {
  const name = String(request.params?.name || '');
  const input = request.params?.arguments && typeof request.params.arguments === 'object'
    ? request.params.arguments
    : {};
  const controller = new AbortController();
  activeCalls.set(request.id, controller);
  try {
    let result;
    if (name === 'find_skills') result = await findSkills(input, controller.signal);
    else if (name === 'install_skill') result = await serializeMutation(() => installSkills(input, controller.signal));
    else if (name === 'list_installed_skills') result = await listInstalledSkills();
    else if (name === 'read_skill') result = await readInstalledSkill(input);
    else if (name === 'list_design_references') result = await listDesignReferences();
    else if (name === 'read_design_reference') result = await readDesignReference(input);
    else if (name === 'remove_skill') result = await serializeMutation(() => removeInstalledSkill(input));
    else throw new Error(`未知 Yan Skill 工具：${name}`);
    success(request.id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: false
    });
  } catch (error) {
    const result = { ok: false, error: error?.message || String(error) };
    success(request.id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: true
    });
  } finally {
    activeCalls.delete(request.id);
  }
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/cancelled') {
    activeCalls.get(message.params?.requestId)?.abort();
    return;
  }
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'initialize') {
    assertConfiguredPaths();
    success(message.id, {
      protocolVersion: String(message.params?.protocolVersion || '2025-03-26'),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Yan Skills', version: '1.0.0' }
    });
    return;
  }
  if (message.method === 'ping') {
    success(message.id, {});
    return;
  }
  if (message.method === 'tools/list') {
    success(message.id, { tools: toolDefinitions() });
    return;
  }
  if (message.method === 'tools/call') {
    await callTool(message);
    return;
  }
  if (message.id !== undefined) failure(message.id, -32601, `不支持的方法：${message.method}`);
}

let inputBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  inputBuffer += chunk;
  let newline = inputBuffer.indexOf('\n');
  while (newline >= 0) {
    const line = inputBuffer.slice(0, newline).trim();
    inputBuffer = inputBuffer.slice(newline + 1);
    if (line) {
      try { void handle(JSON.parse(line)); }
      catch (error) { process.stderr.write(`[yan-skills-mcp] ${error.message}\n`); }
    }
    newline = inputBuffer.indexOf('\n');
  }
});
process.stdin.resume();
