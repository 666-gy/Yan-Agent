'use strict';

/**
 * Yan Agent — project Skill load source (main process, Electron-free)
 *
 * The official Yan store (YanData/skills) remains the default load source. When
 * the user explicitly picks an external Agent Skill folder for one workspace,
 * this module materializes it into <workspace>/.yanagent/skills:
 *
 *   - symlink: a directory junction pointing at the external Skill folder, so
 *     Yan follows later changes there while that path stays available.
 *   - copy: a complete Yan-owned copy; later external changes are ignored.
 *
 * Only Yan-created entries recorded in the workspace manifest are ever removed,
 * so an unrelated directory inside .yanagent/skills is never deleted.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const skillRegistry = require('./skill-registry');

const IMPORT_MODES = Object.freeze(['symlink', 'copy']);
const MAX_SOURCE_SKILLS = 200;
const MAX_COPY_FILES = 5_000;
const MAX_COPY_BYTES = 256 * 1024 * 1024;
const COPY_SKIP_ENTRIES = new Set(['.git', 'node_modules', '.DS_Store']);

function normalizeImportMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return IMPORT_MODES.includes(mode) ? mode : '';
}

function sourceIdForPath(sourcePath) {
  return path.resolve(String(sourcePath || '')).toLowerCase();
}

function pathExists(target) {
  try { fs.lstatSync(target); return true; } catch { return false; }
}

function safeFolderName(value) {
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
  output = output.replaceAll('..', '.');
  while (output.startsWith('-') || output.startsWith('.')) output = output.slice(1);
  while (output.endsWith('-') || output.endsWith('.')) output = output.slice(0, -1);
  return output.slice(0, 96) || 'skill';
}

function resolveSourceDirectory(sourcePath) {
  const raw = String(sourcePath || '').trim();
  if (!raw) throw new Error('未选择 Skills 文件夹。');
  const resolved = path.resolve(raw);
  let stat = null;
  try { stat = fs.statSync(resolved); } catch { throw new Error(`找不到文件夹：${resolved}`); }
  if (!stat.isDirectory()) throw new Error('请选择 Skills 文件夹，而不是文件。');
  return resolved;
}

// Reads the direct child Skill folders of an external source. Nothing is
// written here: the external folder belongs to another application.
function scanSourceSkills(sourcePath) {
  const root = resolveSourceDirectory(sourcePath);
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { entries = []; }
  const skills = [];
  for (const entry of entries) {
    if (skills.length >= MAX_SOURCE_SKILLS) break;
    if (String(entry.name || '').startsWith('.')) continue;
    const directory = path.join(root, entry.name);
    let isDirectory = false;
    try { isDirectory = fs.statSync(directory).isDirectory(); } catch { isDirectory = false; }
    if (!isDirectory) continue;
    const skillFile = path.join(directory, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    try {
      const parsed = skillRegistry.parseSkillDocument(fs.readFileSync(skillFile, 'utf8'), {
        requireFrontmatter: true,
        requireName: true,
        requireDescription: true,
        requirePrompt: true
      });
      const id = String(parsed.metadata.name || entry.name).trim().toLowerCase();
      if (!id) continue;
      skills.push({
        id,
        name: String(parsed.metadata.display_name || parsed.metadata.name || entry.name).trim(),
        description: String(parsed.metadata.description || '').trim(),
        folder: entry.name,
        directory
      });
    } catch { /* Skip folders that are not valid SKILL.md packages. */ }
  }
  return { root, skills };
}

async function copySkillTree(source, destination) {
  const state = { files: 0, bytes: 0 };
  async function copyEntry(from, to) {
    const info = await fsp.lstat(from);
    if (info.isSymbolicLink()) throw new Error(`Skill 包含不允许的符号链接：${path.basename(from)}`);
    if (info.isDirectory()) {
      await fsp.mkdir(to, { recursive: true });
      for (const entry of await fsp.readdir(from, { withFileTypes: true })) {
        if (COPY_SKIP_ENTRIES.has(entry.name)) continue;
        await copyEntry(path.join(from, entry.name), path.join(to, entry.name));
      }
      return;
    }
    if (!info.isFile()) throw new Error(`Skill 包含不支持的文件类型：${path.basename(from)}`);
    state.files++;
    state.bytes += info.size;
    if (state.files > MAX_COPY_FILES) throw new Error(`Skill 文件数量超过 ${MAX_COPY_FILES} 个。`);
    if (state.bytes > MAX_COPY_BYTES) throw new Error('Skill 总大小超过 256 MiB。');
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
  }
  await copyEntry(source, destination);
  return state;
}

function describeProjectSource(workspace) {
  const directory = skillRegistry.getProjectSkillDirectory(workspace);
  if (!directory) return null;
  const manifest = skillRegistry.readProjectSourceManifest(directory);
  const entries = (Array.isArray(manifest.entries) ? manifest.entries : [])
    .filter(record => record && String(record.folder || '').trim())
    .map(record => {
      const target = path.join(directory, String(record.folder));
      return {
        id: String(record.id || ''),
        name: String(record.name || record.folder || ''),
        folder: String(record.folder),
        mode: String(record.mode || 'symlink') === 'copy' ? 'copy' : 'symlink',
        linkedTo: String(record.linkedTo || ''),
        available: fs.existsSync(path.join(target, 'SKILL.md'))
      };
    });
  return {
    directory,
    source: {
      id: String(manifest.source?.id || ''),
      path: String(manifest.source?.path || ''),
      mode: String(manifest.source?.mode || '') === 'copy' ? 'copy' : 'symlink'
    },
    entries
  };
}

// Materializes one external Skill folder into the workspace's project Skill
// directory and records a manifest so later switches stay reversible.
async function applyProjectSkillSource({ workspace, sourcePath, mode } = {}) {
  const resolvedMode = normalizeImportMode(mode);
  if (!resolvedMode) throw new Error('请选择导入方式：软链或复制。');
  const workspaceRoot = String(workspace || '').trim();
  const projectRoot = skillRegistry.getProjectSkillDirectory(workspaceRoot);
  if (!projectRoot) {
    throw new Error('请先选择一个工作区。Blank 下只能使用 Yan 官方 Skill 目录。');
  }
  if (!String(sourcePath || '').trim()) throw new Error('未选择 Skills 文件夹。');
  const sourceRoot = path.resolve(String(sourcePath).trim());
  const resolvedProjectRoot = path.resolve(projectRoot);
  if (sourceRoot === resolvedProjectRoot || sourceRoot.startsWith(`${resolvedProjectRoot}${path.sep}`)) {
    throw new Error('来源文件夹不能是工作区内的 Yan 项目 Skill 目录。');
  }

  await fsp.mkdir(projectRoot, { recursive: true });
  const manifestPath = path.join(projectRoot, skillRegistry.PROJECT_SOURCE_MANIFEST);
  const previous = skillRegistry.readProjectSourceManifest(projectRoot);
  const previousEntries = (Array.isArray(previous.entries) ? previous.entries : [])
    .filter(record => record && String(record.folder || '').trim());

  // Switching back to a source that is already materialized and intact must not
  // churn the project directory: reuse the existing junctions/copies as-is.
  const desiredSourceId = sourceIdForPath(sourceRoot);
  const alreadyApplied = String(previous.source?.id || '') === desiredSourceId
    && String(previous.source?.mode || '') === resolvedMode
    && resolvedMode === 'copy'
    && previousEntries.length > 0
    && previousEntries.every(record => fs.existsSync(path.join(projectRoot, String(record.folder), 'SKILL.md')));
  if (alreadyApplied) {
    return {
      ok: true,
      reused: true,
      directory: projectRoot,
      sourcePath: sourceRoot,
      mode: resolvedMode,
      entries: previousEntries,
      skipped: []
    };
  }

  const { skills } = scanSourceSkills(sourceRoot);
  if (!skills.length) throw new Error('该文件夹里没有找到包含 SKILL.md 的 Skill。');
  // Compare real paths as well: a source alias must not point into our output.
  const realProject = fs.realpathSync(projectRoot);
  for (const candidate of skills) {
    const realSource = fs.realpathSync(candidate.directory);
    const relative = path.relative(realSource, realProject);
    const reverse = path.relative(realProject, realSource);
    const inside = value => value === '' || (value !== '..' && !value.startsWith(`..${path.sep}`) && !path.isAbsolute(value));
    if (inside(relative) || inside(reverse)) throw new Error('来源 Skill 与项目 Skill 目录不能互相包含。');
  }
  const ownedFolders = new Set(previousEntries.map(record => String(record.folder))
    .filter(folder => path.dirname(path.resolve(projectRoot, folder)) === resolvedProjectRoot));
  // Prepare everything before touching the active source. A failed copy or
  // junction creation leaves the previous manifest and all its packages intact.
  const transaction = await fsp.mkdtemp(path.join(projectRoot, '.import-'));
  const staged = path.join(transaction, 'staged');
  const backup = path.join(transaction, 'backup');
  await fsp.mkdir(staged);
  await fsp.mkdir(backup);
  const created = [];
  const moved = [];
  const installed = [];
  let preserveBackup = false;
  const usedFolders = new Set();
  try {
    for (const candidate of skills) {
      const base = safeFolderName(candidate.name || candidate.folder);
      let folder = base;
      let suffix = 1;
      while (usedFolders.has(folder) || (pathExists(path.join(projectRoot, folder)) && !ownedFolders.has(folder))) {
        folder = `${base}-${++suffix}`;
      }
      usedFolders.add(folder);
      const target = path.join(projectRoot, folder);
      const pending = path.join(staged, folder);
      if (resolvedMode === 'symlink') {
        await fsp.symlink(candidate.directory, pending, process.platform === 'win32' ? 'junction' : 'dir');
      } else {
        await copySkillTree(fs.realpathSync(candidate.directory), pending);
      }
      created.push({ id: candidate.id, name: candidate.name, folder, mode: resolvedMode,
        target, linkedTo: candidate.directory, addedAt: Date.now() });
    }
    for (const folder of ownedFolders) {
      const target = path.join(projectRoot, folder);
      if (!pathExists(target)) continue;
      await fsp.rename(target, path.join(backup, folder));
      moved.push(folder);
    }
    for (const record of created) {
      await fsp.rename(path.join(staged, record.folder), record.target);
      installed.push(record.target);
    }
    const nextManifest = path.join(transaction, `manifest-${crypto.randomUUID()}.json`);
    await fsp.writeFile(nextManifest, JSON.stringify({ schema: 1,
      source: { id: desiredSourceId, path: sourceRoot, mode: resolvedMode, appliedAt: Date.now() },
      entries: created }, null, 2) + '\n', 'utf8');
    await fsp.rename(nextManifest, manifestPath);
  } catch (error) {
    try {
      for (const target of installed) await fsp.rm(target, { recursive: true, force: true });
      for (const folder of moved) await fsp.rename(path.join(backup, folder), path.join(projectRoot, folder));
    } catch (rollbackError) {
      preserveBackup = true;
      throw new Error(`导入失败，旧文件已保留在 ${backup}：${rollbackError.message}`, { cause: error });
    }
    throw error;
  } finally {
    // Generated transaction path is a verified direct child of the project root.
    if (!preserveBackup && path.dirname(transaction) === resolvedProjectRoot) {
      await fsp.rm(transaction, { recursive: true, force: true }).catch(() => {});
    }
  }
  return { ok: true, directory: projectRoot, sourcePath: sourceRoot, mode: resolvedMode, entries: created, skipped: [] };

}

module.exports = {
  IMPORT_MODES,
  MAX_SOURCE_SKILLS,
  normalizeImportMode,
  sourceIdForPath,
  safeFolderName,
  resolveSourceDirectory,
  scanSourceSkills,
  copySkillTree,
  describeProjectSource,
  applyProjectSkillSource
};
