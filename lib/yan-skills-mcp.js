'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { stripVTControlCharacters } = require('util');
const { readTaskScopedConfig } = require('./mcp-run-context');
const { refreshProxy } = require('./shell-network');
const { officialSkillsCliEnvironment } = require('./skills-cli-environment');
// Skill registry parsing and CLI integration are not needed for MCP handshake
// or tools/list. Defer this relatively heavy module until a Skill tool runs.
let skillRegistry;
function getSkillRegistry() {
  return skillRegistry ||= require('./skill-registry');
}

const skillsRoot = path.resolve(String(process.env.YAN_SKILLS_ROOT || ''));
const dataDir = path.resolve(String(process.env.YAN_SKILLS_DATA_DIR || path.dirname(skillsRoot)));
const configPath = path.resolve(String(process.env.YAN_SKILLS_CONFIG_PATH || path.join(dataDir, 'config.json')));
const skillsCli = path.resolve(String(process.env.YAN_SKILLS_CLI || ''));
const appRoot = path.resolve(String(process.env.YAN_SKILLS_APP_ROOT || path.join(__dirname, '..')));
const networkAllowed = process.env.YAN_SKILLS_ALLOW_NETWORK !== 'false';
const contextDir = String(process.env.YAN_SKILLS_CONTEXT_DIR || '').trim();
const stagingRoot = path.join(dataDir, 'SkillStore', 'staging', 'skills-cli');
const quarantineRoot = path.join(dataDir, 'SkillStore', 'quarantine');
const activeCalls = new Map();
const skillLoadState = new Map();
const loadedSkillState = new Map();
const { assertSkillAvailable, listInstalledSkills } = require('./skill-model-access').createSkillModelAccess({
  readConfig: taskId => readTaskScopedConfig(configPath, contextDir, taskId),
  getRegistry: getSkillRegistry, appRoot, dataDir, skillsRoot, loadedSkillState, skillLoadState
});
let mutationQueue = Promise.resolve();

const MAX_SKILL_FILES = 5_000;
const MAX_SKILL_BYTES = 256 * 1024 * 1024;
const MAX_TOOL_OUTPUT = 4 * 1024 * 1024;
const INLINE_SKILL_BYTES = 24 * 1024;
const SKILL_CHUNK_BYTES = 24 * 1024;
const SLOW_SKILL_CHUNK_BYTES = 16 * 1024;
const MID_SKILL_CHUNK_BYTES = 48 * 1024;
const MAX_SKILL_CHUNK_BYTES = 64 * 1024;
const MAX_SKILL_RESOURCE_BYTES = 8 * 1024 * 1024;
const MAX_CACHED_SKILL_TASKS = 128;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan Skills MCP error') } });
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

const { assertInside, assertDirectChild, cleanText } = require('./skill-path-guards');

// These guards are this module's path and input validation, mirroring the Skill
// management rules rather than the MCP runtime's.
function assertConfiguredPaths() {
  if (!skillsRoot || skillsRoot === path.parse(skillsRoot).root) throw new Error('Yan Skill 根目录未配置。');
  if (!dataDir || dataDir === path.parse(dataDir).root) throw new Error('Yan 数据目录未配置。');
  if (!skillsRoot.startsWith(`${dataDir}${path.sep}`)) throw new Error('Yan Skill 根目录必须位于 YanData 内。');
  if (path.dirname(configPath) !== dataDir) throw new Error('Yan 配置文件必须位于 YanData 根目录。');
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
  // The CLI's private HOME hides the user's global git config, so carry the
  // Windows proxy into the child environment explicitly. Without this, Git
  // reaches GitHub directly and the install times out.
  await refreshProxy();
  const environment = officialSkillsCliEnvironment({ runtimeHome, runtimeTemp });
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
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
      const parsed = getSkillRegistry().parseSkillDocument(await fsp.readFile(skillFile, 'utf8'), {
        requireFrontmatter: true,
        requireName: true,
        requireDescription: true,
        requirePrompt: true
      });
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
      const parsed = getSkillRegistry().parseSkillDocument(await fsp.readFile(path.join(prepared, 'SKILL.md'), 'utf8'), {
      requireFrontmatter: true,
      requireName: true,
      requireDescription: true,
      requirePrompt: true
    });
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

async function createSkill(input) {
  assertConfiguredPaths();
  let source = '';
  let document;
  if (input.source_directory) {
    const context = require('./mcp-run-context').readRunContext(contextDir, input.task_id);
    if (!context?.workspace || context.allowFileRead === false) throw new Error('导入 Skill 目录需要当前任务的工作区读取权限和 task_id。');
    const workspace = await fsp.realpath(context.workspace);
    source = await fsp.realpath(assertInside(workspace, path.resolve(workspace, input.source_directory)));
    assertInside(workspace, source);
    const relativeStore = path.relative(source, stagingRoot);
    if (!relativeStore || (!relativeStore.startsWith('..' + path.sep) && relativeStore !== '..' && !path.isAbsolute(relativeStore))) {
      throw new Error('Skill 源目录不能包含安装暂存目录。');
    }
    if (!(await fsp.lstat(source)).isDirectory()) throw new Error('source_directory 必须是目录。');
    document = getSkillRegistry().parseSkillDocument(await fsp.readFile(path.join(source, 'SKILL.md'), 'utf8'), {
      requireFrontmatter: true, requireName: true, requireDescription: true, requirePrompt: true
    });
    input = { ...input, name: input.name || document.name, description: input.description || document.description, prompt: document.prompt };
  }
  const id = safeDirectoryName(cleanText(input.id || input.name, 'Skill ID', 96));
  const name = cleanText(input.name || input.id, 'Skill 名称', 160);
  const description = cleanText(input.description || input.desc, 'Skill 描述', 1_000);
  const prompt = cleanText(input.prompt, 'Skill 指令', 200_000);
  if (!prompt) throw new Error('Skill 指令不能为空。');
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(id)) throw new Error('Skill ID 只能包含小写字母、数字、点、下划线和短横线。');
  const destination = assertDirectChild(skillsRoot, path.join(skillsRoot, id));
  const existing = await readDirectSkills(skillsRoot);
  const conflict = existing.find(item => item.id === id || item.folder === id);
  if (conflict && input.replace_existing !== true) throw new Error(`Skill「${name}」已经存在；如需更新，请将 replace_existing 设为 true。`);
  await fsp.mkdir(stagingRoot, { recursive: true });
  const staging = await fsp.mkdtemp(path.join(stagingRoot, 'created-'));
  const prepared = assertInside(staging, path.join(staging, id));
  const now = Date.now();
  let backup = '';
  let published = false;
  try {
    const stats = source ? await copySkillTree(source, prepared) : { files: 1, bytes: Buffer.byteLength(prompt) };
    await fsp.mkdir(prepared, { recursive: true });
    const frontmatter = `---\nname: ${JSON.stringify(name.replace(/[\r\n]/gu, ' '))}\ndescription: ${JSON.stringify(description.replace(/[\r\n]/gu, ' '))}\n---\n\n`;
    if (!source || input.name !== document.name || input.description !== document.description) {
      await fsp.writeFile(path.join(prepared, 'SKILL.md'), `${frontmatter}${prompt.trim()}\n`, 'utf8');
    }
    getSkillRegistry().parseSkillDocument(await fsp.readFile(path.join(prepared, 'SKILL.md'), 'utf8'), {
      requireFrontmatter: true, requireName: true, requireDescription: true, requirePrompt: true
    });
    await fsp.writeFile(path.join(prepared, '.yan-skill.json'), `${JSON.stringify({ schema: 1, id, name, desc: description, source: 'yan-skill-creator', createdBy: 'yan-skill-creator', installedAt: now, updatedAt: now }, null, 2)}\n`, 'utf8');
    if (conflict) {
      await fsp.mkdir(quarantineRoot, { recursive: true });
      backup = assertInside(quarantineRoot, path.join(quarantineRoot, `${conflict.folder}-${now}-${crypto.randomBytes(4).toString('hex')}`));
      await fsp.rename(conflict.directory, backup);
    }
    await fsp.rename(prepared, destination);
    published = true;
    try {
      const config = JSON.parse(await fsp.readFile(configPath, 'utf8'));
      const customSkills = Array.isArray(config.customSkills) ? config.customSkills.filter(item => String(item?.id || '').toLowerCase() !== id) : [];
      customSkills.push({ id, name, desc: description, prompt, source: 'yan-skill-creator', createdBy: 'yan-skill-creator', installedAt: now, updatedAt: now });
      config.customSkills = customSkills;
      const temporaryConfig = `${configPath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      try {
        await fsp.writeFile(temporaryConfig, JSON.stringify(config, null, 2), 'utf8');
        await fsp.rename(temporaryConfig, configPath);
      } finally { await fsp.rm(temporaryConfig, { force: true }).catch(() => {}); }
    } catch (error) { throw new Error(`Skill 配置同步失败：${error.message}`); }
    return { ok: true, id, name, description, root: skillsRoot, directory: destination, files: stats.files, bytes: stats.bytes, replaced: !!conflict, previousVersionQuarantinedAt: backup || null };
  } catch (error) {
    if (published) await fsp.rm(assertDirectChild(skillsRoot, destination), { recursive: true, force: true });
    if (backup) await fsp.rename(backup, conflict.directory);
    throw error;
  } finally { await fsp.rm(staging, { recursive: true, force: true }).catch(() => {}); }
}

async function findSkills(input) {
  const query = String(input.query || '').trim().slice(0, 300);
  const catalog = await listInstalledSkills(input.task_id);
  const terms = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const skills = catalog.skills.filter(skill => {
    const text = [skill.id, skill.name, skill.description, ...skill.aliases, ...skill.tags, ...(skill.triggers || [])].join(' ').toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
  return { ...catalog, query, count: skills.length, skills };
}



function utf8Chunks(value, maxBytes = SKILL_CHUNK_BYTES) {
  const source = String(value || '');
  if (!source) return [''];
  const encoded = Buffer.from(source, 'utf8');
  const chunks = [];
  let start = 0;
  while (start < encoded.length) {
    let end = Math.min(encoded.length, start + maxBytes);
    while (end < encoded.length && end > start && (encoded[end] & 0xc0) === 0x80) end--;
    if (end === start) throw new Error('Skill chunk size is too small for a UTF-8 character.');
    chunks.push(encoded.subarray(start, end).toString('utf8'));
    start = end;
  }
  return chunks;
}

function normalizeInputSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed <= 0) return 10_000;
  return Math.min(100_000, Math.max(500, Math.round(speed)));
}

// Real throughput tiers: the learned (provider, model) measurement decides the
// chunk size, so a slow model gets smaller chunks and a fast one gets the max.
// No model is special-cased — the number itself carries the difference.
function skillChunkBytesForInputSpeed(value) {
  const speed = normalizeInputSpeed(value);
  if (speed >= 8_000) return MAX_SKILL_CHUNK_BYTES;
  if (speed >= 4_000) return MID_SKILL_CHUNK_BYTES;
  if (speed >= 2_000) return SKILL_CHUNK_BYTES;
  return SLOW_SKILL_CHUNK_BYTES;
}

function textSha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function lineCount(value) {
  const source = String(value || '');
  return source ? source.split('\n').length : 0;
}

function referencedSkillFiles(document, directory) {
  if (!directory) return [];
  const result = [];
  const seen = new Set();
  const linkPattern = /\[[^\]]*\]\(([^)\n]+)\)/gu;
  for (const match of String(document || '').matchAll(linkPattern)) {
    const raw = String(match[1] || '').trim().replace(/^<|>$/gu, '').split('#')[0].trim();
    if (!raw || /^[a-z][a-z0-9+.-]*:/iu.test(raw) || path.isAbsolute(raw)) continue;
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch {}
    const target = path.resolve(directory, decoded);
    try { assertInside(directory, target); } catch { continue; }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
    const relative = path.relative(directory, target).replaceAll('\\', '/');
    if (!seen.has(relative)) {
      seen.add(relative);
      result.push(relative);
    }
  }
  return result;
}

function rememberLoadedSkill(stateKey, loaded) {
  if (!stateKey) return;
  loadedSkillState.set(stateKey, loaded);
  while (loadedSkillState.size > MAX_CACHED_SKILL_TASKS) {
    loadedSkillState.delete(loadedSkillState.keys().next().value);
  }
}

function skillDeliveryResult(loaded, loadMs, cacheHit = false, inputTokensPerSecond = 10_000) {
  const { resolved, directory, document, instructions } = loaded;
  const normalizedSpeed = normalizeInputSpeed(inputTokensPerSecond);
  const chunkBytes = skillChunkBytesForInputSpeed(normalizedSpeed);
  const instructionChunks = utf8Chunks(instructions, chunkBytes);
  const bytes = Buffer.byteLength(instructions, 'utf8');
  // A 10k+ model can consume one bounded Hallmark-sized payload directly.
  // Keeping it inline avoids an otherwise unnecessary second model/tool round.
  const inlineBytes = Math.min(80 * 1024, Math.max(INLINE_SKILL_BYTES, chunkBytes + (8 * 1024)));
  const base = {
    ok: true,
    id: resolved.id,
    name: resolved.name,
    description: resolved.desc || '',
    directory,
    executionContext: directory
      ? `Resolve every relative script, template, asset, and <skill_dir> reference against this Yan-owned directory: ${directory}`
      : 'Apply the complete Yan built-in Skill instructions directly.',
    referencedFiles: referencedSkillFiles(document, directory),
    instructionBytes: bytes,
    instructionLines: lineCount(instructions),
    instructionSha256: textSha256(instructions),
    inputTokensPerSecond: normalizedSpeed,
    loadMs,
    cacheHit
  };
  if (bytes <= inlineBytes) {
    return {
      ...base,
      delivery: 'inline',
      complete: true,
      instructions
    };
  }
  return {
    ...base,
    delivery: 'chunked',
    complete: false,
    chunkBytes,
    chunkCount: instructionChunks.length,
    chunkPlan: instructionChunks.map((_, chunkIndex) => ({
      path: '$instructions',
      chunk_index: chunkIndex,
      chunk_bytes: chunkBytes
    })),
    nextAction: 'Before acting, call Yan Skills read_skill_resource for every chunkPlan entry, preferably as one parallel tool batch. Concatenate content by chunk_index and verify instructionSha256. No instruction text may be skipped or summarized.'
  };
}

async function resolveInstalledSkill(value) {
  const query = cleanText(value, 'Skill id', 160).toLowerCase();
  const installed = await readDirectSkills(skillsRoot);
  // `id` is lowercased at read time but folder/name are not, so normalize both
  // sides -- a folder like `My-Skill` otherwise never matches the query.
  const match = installed.find(item => item.id === query
    || String(item.folder || '').toLowerCase() === query
    || String(item.name || '').toLowerCase() === query);
  if (!match) throw new Error(`Yan Skill 目录中未找到「${value}」。`);
  return match;
}


async function readInstalledSkill(input) {
  const startedAt = performance.now();
  const requestedId = String(input.id || '').trim().toLowerCase();
  const taskId = String(input.task_id || '').trim();
  const config = await readTaskScopedConfig(configPath, contextDir, taskId);
  await assertSkillAvailable(requestedId, taskId, config);
  // No 10k floor here on purpose: an explicit measured value (even below the
  // declared baseline) selects smaller real chunks so delivery matches the
  // model's actual prefill throughput.
  const inputTokensPerSecond = normalizeInputSpeed(
    input.input_tokens_per_second || process.env.YAN_INPUT_TOKENS_PER_SECOND
  );
  const stateKey = taskId ? `${taskId}:${requestedId}` : '';
  const loaded = stateKey ? loadedSkillState.get(stateKey) : null;
  if (loaded) {
    await assertSkillAvailable(loaded.resolved.id, taskId);
    return skillDeliveryResult(loaded, Number((performance.now() - startedAt).toFixed(3)), true, inputTokensPerSecond);
  }
  const previous = stateKey ? skillLoadState.get(stateKey) : null;
  if (previous?.skipped) return previous;
  if (previous?.promise) return previous.promise;
  const loadPromise = getSkillRegistry().readSkillWithRetry(
    input.id, '', config, appRoot, dataDir, () => {}, {
      allowUserOnly: false,
      maxAttempts: 3
    }
  ).then(async resolved => {
    if (resolved?.code === 'SKILL_REQUIRES_USER_SELECTION') {
      return { ...resolved, skipped: false };
    }
    if (!resolved?.ok) {
      const notFound = resolved?.code === 'SKILL_NOT_FOUND';
      const redirect = notFound
        ? ' 提示：read_skill 只加载 Yan 已安装的 Skill。如果用户本轮明确要求使用其他 Agent 或本地自写的 Skill，请改用 read/glob/grep 直接读取其原始 SKILL.md 及资源，不要因本工具未找到而拒绝。'
        : '';
      const skipped = {
        ok: false,
        skipped: true,
        id: resolved?.id || requestedId,
        name: resolved?.name || requestedId,
        attempts: resolved?.attempts || 1,
        error: `${resolved?.error || `Yan Skill 中未找到「${input.id}」。`}${redirect}`,
        skipNotice: `${resolved?.skipNotice || `Skill「${requestedId}」本轮已跳过。`}${redirect}`
      };
      if (stateKey) {
        skillLoadState.set(stateKey, skipped);
        while (skillLoadState.size > 128) skillLoadState.delete(skillLoadState.keys().next().value);
      }
      return skipped;
    }
    const directory = String(resolved.runtimeDirectory || '');
    const skillFile = directory ? path.join(directory, 'SKILL.md') : '';
    const document = skillFile && fs.existsSync(skillFile)
      ? await fsp.readFile(skillFile, 'utf8')
      : String(resolved.prompt || '');
    const instructions = String(resolved.prompt || document);
    const loadedSkill = {
      resolved,
      directory,
      document,
      instructions,
      instructionChunks: utf8Chunks(instructions),
      resources: new Map()
    };
    await assertSkillAvailable(resolved.id, taskId);
    rememberLoadedSkill(stateKey, loadedSkill);
    const result = skillDeliveryResult(
      loadedSkill,
      Number((performance.now() - startedAt).toFixed(3)),
      false,
      inputTokensPerSecond
    );
    if (stateKey) skillLoadState.delete(stateKey);
    return result;
  }).catch(error => {
    if (stateKey) skillLoadState.delete(stateKey);
    throw error;
  });
  if (stateKey) skillLoadState.set(stateKey, { promise: loadPromise });
  return loadPromise;
}

async function readSkillResource(input) {
  const requestedId = cleanText(input.id, 'Skill id', 160).toLowerCase();
  const taskId = cleanText(input.task_id, 'task_id', 240);
  await assertSkillAvailable(requestedId, taskId);
  const inputTokensPerSecond = normalizeInputSpeed(
    input.input_tokens_per_second || process.env.YAN_INPUT_TOKENS_PER_SECOND
  );
  const chunkBytes = Math.max(
    SLOW_SKILL_CHUNK_BYTES,
    Math.min(MAX_SKILL_CHUNK_BYTES, Number(input.chunk_bytes) || skillChunkBytesForInputSpeed(inputTokensPerSecond))
  );
  const stateKey = `${taskId}:${requestedId}`;
  const loaded = loadedSkillState.get(stateKey);
  if (!loaded) throw new Error(`请先在当前任务调用 read_skill 加载「${requestedId}」。`);
  await assertSkillAvailable(loaded.resolved.id, taskId);

  const requestedPath = String(input.path || '$instructions').trim() || '$instructions';
  let text;
  let resourcePath = requestedPath;
  if (requestedPath === '$instructions') {
    text = loaded.instructions;
  } else {
    if (!loaded.directory) throw new Error('该内置 Skill 没有可读取的资源目录。');
    if (path.isAbsolute(requestedPath)) throw new Error('Skill 资源路径必须相对于 Skill 目录。');
    const target = assertInside(loaded.directory, path.resolve(loaded.directory, requestedPath));
    const info = await fsp.lstat(target).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`未找到安全的 Skill 资源文件：${requestedPath}`);
    if (info.size > MAX_SKILL_RESOURCE_BYTES) throw new Error('Skill 文本资源超过 8 MiB 读取上限。');
    resourcePath = path.relative(loaded.directory, target).replaceAll('\\', '/');
    const cached = loaded.resources.get(resourcePath);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      text = cached.text;
    } else {
      text = await fsp.readFile(target, 'utf8');
      if (text.includes('\0')) throw new Error(`Skill 资源不是文本文件：${requestedPath}`);
      loaded.resources.set(resourcePath, { text, mtimeMs: info.mtimeMs, size: info.size });
    }
  }

  await assertSkillAvailable(loaded.resolved.id, taskId);
  const chunks = utf8Chunks(text, chunkBytes);
  const chunkIndex = Number(input.chunk_index ?? 0);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunks.length) {
    throw new Error(`chunk_index 超出范围；有效范围为 0-${chunks.length - 1}。`);
  }
  const content = chunks[chunkIndex];
  return {
    ok: true,
    id: loaded.resolved.id,
    path: resourcePath,
    chunkIndex,
    chunkCount: chunks.length,
    chunkBytes,
    inputTokensPerSecond,
    complete: chunks.length === 1,
    content,
    contentBytes: Buffer.byteLength(content, 'utf8'),
    chunkSha256: textSha256(content),
    resourceSha256: textSha256(text)
  };
}

async function readSkillResources(input) {
  const id = cleanText(input.id, 'Skill id', 160).toLowerCase();
  const taskId = cleanText(input.task_id, 'task_id', 240);
  const chunks = Array.isArray(input.chunks) ? input.chunks : [];
  if (!chunks.length) throw new Error('chunks 不能为空。');
  if (chunks.length > 512) throw new Error('单次批量 Skill 读取最多 512 个 chunk。');
  const inputTokensPerSecond = normalizeInputSpeed(
    input.input_tokens_per_second || process.env.YAN_INPUT_TOKENS_PER_SECOND
  );
  const results = await Promise.all(chunks.map((chunk, index) => readSkillResource({
    id,
    task_id: taskId,
    path: String(chunk?.path || '$instructions'),
    chunk_index: chunk?.chunk_index ?? chunk?.chunkIndex,
    chunk_bytes: chunk?.chunk_bytes ?? chunk?.chunkBytes,
    input_tokens_per_second: inputTokensPerSecond
  }).then(result => ({ ...result, batchIndex: index }))));
  results.sort((left, right) => {
    const pathOrder = String(left.path).localeCompare(String(right.path));
    return pathOrder || left.chunkIndex - right.chunkIndex;
  });
  return {
    ok: true,
    id,
    taskId,
    inputTokensPerSecond,
    count: results.length,
    complete: results.every(result => result.complete || result.chunkIndex === result.chunkCount - 1),
    chunks: results
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

async function listAgentProfiles() {
  let config = {};
  try { config = JSON.parse(await fsp.readFile(configPath, 'utf8')); } catch {}
  return (Array.isArray(config.customAgents) ? config.customAgents : []).map(agent => ({
    id: agent.id, name: agent.name, description: agent.description,
    systemPrompt: agent.systemPrompt, tools: Array.isArray(agent.tools) ? agent.tools : []
  }));
}

async function saveAgentProfile(input = {}) {
  const { normalizeCustomAgent } = require('./custom-agents');
  const agent = normalizeCustomAgent(input);
  let config;
  try { config = JSON.parse(await fsp.readFile(configPath, 'utf8')); }
  catch { throw new Error('Yan 配置文件不可读，Agent 未保存。'); }
  const customAgents = Array.isArray(config.customAgents) ? config.customAgents : [];
  const index = customAgents.findIndex(item => String(item?.id || '').toLowerCase() === agent.id);
  if (index >= 0 && input.replace_existing !== true) {
    throw new Error(`Agent「${customAgents[index].name || agent.name}」已存在；修改时请传 replace_existing=true。`);
  }
  if (index >= 0) customAgents[index] = { ...agent, createdAt: customAgents[index].createdAt || Date.now(), updatedAt: Date.now() };
  else customAgents.push({ ...agent, createdAt: Date.now(), updatedAt: Date.now() });
  config.customAgents = customAgents;
  const temporary = `${configPath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await fsp.rename(temporary, configPath);
  } finally { await fsp.rm(temporary, { force: true }).catch(() => {}); }
  return { ok: true, ...agent, updated: index >= 0 };
}

function toolDefinitions() {
  return [
    {
      name: 'create_plugin',
      description: '将当前任务内制作好的原生 Yan 插件目录校验并生成为独立插件包。先读取 plugin-creator 技能。只创建，不安装、不启用、不运行；不接受 Codex/Claude 格式的静默转换。',
      inputSchema: { type: 'object', properties: {
        source_directory: { type: 'string', description: '当前任务目录内的插件制作子目录，必须含 yan-plugin.json。' },
        task_id: { type: 'string', description: '当前 task_id。' }
      }, required: ['source_directory', 'task_id'], additionalProperties: false }
    },
    {
      name: 'list_agents',
      description: '列出用户创建的自定义 Agent，包括系统提示词和工具白名单。只读。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'create_agent',
      description: '在 Yan 配置中创建或更新一个可供 Agent 菜单选择的自定义 Agent。根据用户的自然语言偏好整理名称、描述、完整系统提示词和精确工具 ID 白名单。修改时复用相同 id 并传 replace_existing=true。此工具只保存 Agent 配置，不代表已经创建技能或宠物。',
      inputSchema: { type: 'object', properties: {
        id: { type: 'string', description: '稳定的小写 ID，格式 custom-<slug>。' },
        name: { type: 'string', maxLength: 64 },
        description: { type: 'string', maxLength: 240 },
        systemPrompt: { type: 'string', maxLength: 40000 },
        tools: { type: 'array', items: { type: 'string' }, maxItems: 200, description: '要暴露给 Agent 的精确工具 ID 白名单。' },
        replace_existing: { type: 'boolean' }
      }, required: ['id', 'name', 'description', 'systemPrompt', 'tools'], additionalProperties: false }
    },
    {
      name: 'install_pet',
      description: 'Install a Domml desktop companion into Yan-owned storage, including in Blank. Functional widget layout needs no artwork. Any layout can bind a live HTTPS JSON data_source for balances, counters or status; networking runs in the host, and connection_id references an existing same-origin account key without exposing it to the pet. Verify the endpoint and value_path using provider documentation; do not guess balance APIs. Sprite layout uses 8 columns by 9 rows; static uses one PNG. The pet page refreshes automatically.',
      inputSchema: { type: 'object', properties: {
        name: { type: 'string' }, description: { type: 'string' },
        layout: { type: 'string', enum: ['sprite', 'static', 'widget', 'web'] },
        frontend: { type: 'object', description: 'For web layout: own HTML document or fragment, CSS and JavaScript. No artwork needed. Inline SVG/data images supported. Sandbox exposes window.yanPet.onData(callback), onConfig(callback), onState(callback), refreshData(), startDrag(), stopDrag(), openTask(), close(). onData receives {value,text,status,updatedAt,error}; use numeric value for thresholds. Credentials stay in host data_source. Bundle code/styles in these fields; no external script imports.', properties: {
          html: { type: 'string' }, css: { type: 'string' }, js: { type: 'string' },
          width: { type: 'integer', minimum: 100, maximum: 800 }, height: { type: 'integer', minimum: 100, maximum: 800 }
        }, required: ['html'], additionalProperties: false },
        source_asset_id: { type: 'string' }, png_base64: { type: 'string' },
        data_source: { type: 'object', properties: {
          url: { type: 'string', description: 'Verified HTTPS JSON GET endpoint. Never embed a key.' },
          value_path: { type: 'array', items: { type: 'string' }, description: 'Field path, e.g. ["data", "balance"].' },
          connection_id: { type: 'string', description: 'Existing Yan connection ID for same-origin Bearer authentication; omit for public data.' },
          label: { type: 'string' }, prefix: { type: 'string' }, suffix: { type: 'string' },
          decimals: { type: 'integer', minimum: 0, maximum: 8 },
          multiplier: { type: 'number', description: 'Multiply a numeric field for unit conversion; default 1.' },
          subtract_source: { type: 'object', properties: {
            url: { type: 'string' }, value_path: { type: 'array', items: { type: 'string' } },
            multiplier: { type: 'number' }
          }, required: ['url', 'value_path'], additionalProperties: false,
          description: 'Optional second JSON GET value to subtract, after its multiplier. Uses the same connection authentication.' },
          interval_seconds: { type: 'integer', minimum: 15, maximum: 86400 }
        }, required: ['url', 'value_path'], additionalProperties: false }
      }, required: ['name', 'layout'], additionalProperties: false }
    },
    {
      name: 'list_pets', description: 'List installed Domml pets. Available in Blank without a workspace.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'find_skills',
      description: 'Search enabled Skills already available in Yan by name, description, aliases, tags and triggers. Omit query to list all available Skills. This tool is local and never searches the internet. Use web search/fetch tools to discover new Skills online.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional local Skill keywords. Omit or leave empty to list all available Skills.' },
          task_id: { type: 'string', description: 'Exact parent task_id from the latest yan-turn-context.' }
        },
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
      name: 'create_skill',
      description: '在 Yan 官方 Skill 目录创建或更新一个完整 Skill。提供 id 和完整 Skill 的 source_directory/task_id，或提供 id、name、description、prompt。完整目录连同脚本、参考资料和素材一起写入 YanData/skills 并立即进入技能目录。需要更新已有 Skill 时传 replace_existing=true。',
      inputSchema: { type: 'object', properties: {
        id: { type: 'string', description: '小写 Skill ID。' },
        name: { type: 'string' },
        description: { type: 'string' },
        prompt: { type: 'string', description: '完整的 SKILL.md 正文。不传 source_directory 时必填。' },
        source_directory: { type: 'string', description: '当前任务工作区内的完整 Skill 目录，包含 SKILL.md 及 scripts/references/assets 等；原样复制全部资源。提供此项时 name/description/prompt 可从文档读取。' },
        task_id: { type: 'string', description: '导入目录时必须提供当前 task_id。' },
        replace_existing: { type: 'boolean' }
      }, required: ['id'], additionalProperties: false }
    },
    {
      name: 'read_skill',
      description: 'Load a Yan installed catalog Skill without truncation. This tool cannot load external or other-Agent Skills (for example .claude, .codex, .agents, or a local SKILL.md); read those with native read/glob/grep file tools. A not-found result is not a refusal. The runtime uses input_tokens_per_second (the learned per-model prefill rate) to size chunks: >=8000 gets 64KB, >=4000 gets 48KB, >=2000 gets 24KB, slower gets 16KB; default 10000 when not provided. Small Skills return complete inline instructions. Large Skills return a deterministic chunkPlan; call read_skill_resource for every chunk in one parallel batch before acting.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Installed Yan Skill id or name.' },
          task_id: { type: 'string', description: 'Current Yan run id supplied in the system instructions. It scopes retry and skip state to this task.' },
          input_tokens_per_second: { type: 'number', minimum: 500, maximum: 100000, description: 'Learned or expected model input throughput for this provider+model. Pass the value stated in the system instructions; default 10000.' }
        },
        required: ['id', 'task_id'],
        additionalProperties: false
      }
    },
    {
      name: 'read_skill_resource',
      description: 'Read one exact, bounded chunk of a Skill instruction document or referenced text resource. Reuse chunk_bytes from chunkPlan. Call read_skill first in the same task. Fetch every chunkPlan index in one parallel batch and concatenate in numeric order; do not skip or summarize chunks.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact Skill id previously loaded by read_skill.' },
          task_id: { type: 'string', description: 'Current Yan run id used for the matching read_skill call.' },
          path: { type: 'string', description: 'Use $instructions for the runtime instruction document, or a relative text-resource path inside the Skill directory.' },
          chunk_index: { type: 'integer', minimum: 0, description: 'Zero-based chunk index.' },
          chunk_bytes: { type: 'integer', minimum: 16384, maximum: 65536, description: 'Exact chunk size from read_skill.chunkPlan; omit only when reading a default-speed resource.' },
          input_tokens_per_second: { type: 'number', minimum: 500, maximum: 100000, description: 'Learned or expected model input throughput. Pass the value stated in the system instructions; default 10000.' }
        },
        required: ['id', 'task_id', 'path', 'chunk_index'],
        additionalProperties: false
      }
    },
    {
      name: 'read_skill_resources',
      description: 'Read multiple exact Skill chunks concurrently. Pass every chunkPlan entry in one call; results are returned in deterministic path/chunk order with per-chunk hashes.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact Skill id previously loaded by read_skill.' },
          task_id: { type: 'string', description: 'Current Yan run id used for the matching read_skill call.' },
          chunks: {
            type: 'array',
            minItems: 1,
            maxItems: 512,
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                chunk_index: { type: 'integer', minimum: 0 },
                chunk_bytes: { type: 'integer', minimum: 16384, maximum: 65536 }
              },
              required: ['path', 'chunk_index'],
              additionalProperties: false
            }
          },
          input_tokens_per_second: { type: 'number', minimum: 500, maximum: 100000, description: 'Learned or expected model input throughput. Pass the value stated in the system instructions; default 10000.' }
        },
        required: ['id', 'task_id', 'chunks'],
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
  if (name === 'read_skill' || name === 'read_skill_resource' || name === 'read_skill_resources') {
    input.input_tokens_per_second ||= process.env.YAN_INPUT_TOKENS_PER_SECOND || 10_000;
  }
  const controller = new AbortController();
  activeCalls.set(request.id, controller);
  try {
    let result;
    if (name === 'create_plugin') result = await serializeMutation(() => require('./plugins/creation').createPackage(input, require('./mcp-run-context').readRunContext(contextDir, input.task_id)));
    else if (name === 'list_agents') result = { agents: await listAgentProfiles() };
    else if (name === 'create_agent') result = await serializeMutation(() => saveAgentProfile(input));
    else if (name === 'install_pet') result = await serializeMutation(() => require('./pet-store').installPet(dataDir, input));
    else if (name === 'list_pets') result = { pets: require('./pet-store').listPets(dataDir) };
    else if (name === 'find_skills') result = await findSkills(input, controller.signal);
    else if (name === 'install_skill') result = await serializeMutation(() => installSkills(input, controller.signal));
    else if (name === 'create_skill') result = await serializeMutation(() => createSkill(input));
    else if (name === 'read_skill') result = await readInstalledSkill(input);
    else if (name === 'read_skill_resource') result = await readSkillResource(input);
    else if (name === 'read_skill_resources') result = await readSkillResources(input);
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
if (process.env.YAN_MCP_CATALOG_ONLY === '1') require('./mcp-tool-catalog').emitCatalog(toolDefinitions);
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
