'use strict';

/**
 * Yan Agent — Skill load source runtime (main process)
 *
 * IPC surface behind the market's "选择 Skill 加载源" pill:
 *   - pick a Skills folder of another Agent and preview what it contains
 *   - import it into the current project as a junction or a copy
 *   - switch the project between the official Yan store and a remembered source
 *
 * The official Yan store stays the default; only an explicit user change makes
 * a workspace load project-level Skills. Remembered sources are persisted so
 * switching back never requires browsing the file system again.
 */

const fs = require('fs');
const path = require('path');

const skillSource = require('../skill-source');
const skillRegistry = require('../skill-registry');

function registerSkillSourceRuntime(ctx, deps = {}) {
  const { ipcMain, dialog, config, state } = ctx;
  const loadConfig = config.load;
  const saveConfig = config.save;
  const { skillsDir, refreshYanSkillRegistry = () => {} } = deps;
  let mutation = Promise.resolve();
  function serialize(handler) {
    return (...args) => {
      const result = mutation.then(() => handler(...args));
      mutation = result.catch(() => {});
      return result;
    };
  }

  function isDirectory(target) {
    try { return fs.statSync(target).isDirectory(); } catch { return false; }
  }

  function writeSourceConfig(cfg, source) {
    cfg.skillSource = source;
    saveConfig(cfg);
  }

  function buildState() {
    const cfg = loadConfig();
    const workspace = String(cfg.workspace || '').trim();
    const key = skillRegistry.workspaceSkillSourceKey(workspace);
    const { known, active } = skillRegistry.normalizeSkillSourceConfig(cfg);
    const activeSourceId = key
      ? String(active[key] || skillRegistry.OFFICIAL_SKILL_SOURCE)
      : skillRegistry.OFFICIAL_SKILL_SOURCE;
    const project = skillSource.describeProjectSource(workspace);
    const sources = known
      .map(item => ({
        id: item.id,
        name: item.name || path.basename(item.path),
        path: item.path,
        mode: project?.source?.id === item.id ? project.source.mode : item.mode,
        addedAt: item.addedAt,
        lastUsedAt: item.lastUsedAt,
        available: isDirectory(item.path) || (project?.source?.id === item.id
          && project.source.mode === 'copy' && project.entries.length > 0
          && project.entries.every(entry => entry.available)),
        active: item.id === activeSourceId
      }))
      .sort((left, right) => Number(right.active) - Number(left.active)
        || right.lastUsedAt - left.lastUsedAt
        || left.name.localeCompare(right.name));
    return {
      ok: true,
      workspace,
      officialRoot: String(skillsDir || ''),
      officialActive: activeSourceId === skillRegistry.OFFICIAL_SKILL_SOURCE,
      activeSourceId,
      activeSourcePath: activeSourceId === skillRegistry.OFFICIAL_SKILL_SOURCE
        ? ''
        : String(sources.find(item => item.active)?.path || project?.source?.path || ''),
      importMode: activeSourceId === skillRegistry.OFFICIAL_SKILL_SOURCE
        ? ''
        : String(sources.find(item => item.active)?.mode || project?.source?.mode || ''),
      project,
      sources
    };
  }

  function previewSource(sourcePath) {
    try {
      const { root, skills } = skillSource.scanSourceSkills(sourcePath);
      return {
        ok: true,
        id: skillSource.sourceIdForPath(root),
        path: root,
        name: path.basename(root) || root,
        count: skills.length,
        skills: skills.slice(0, 60).map(skill => ({
          id: skill.id,
          name: skill.name,
          description: skill.description
        }))
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  function refresh(reason) {
    try { refreshYanSkillRegistry({ reason }); } catch { /* registry refresh is best-effort */ }
  }

  ipcMain.handle('skills:source-state', () => buildState());

  ipcMain.handle('skills:source-preview', (_e, sourcePath) => previewSource(sourcePath));

  ipcMain.handle('skills:source-pick', async () => {
    const owner = state?.mainWindow?.get?.();
    const result = await dialog.showOpenDialog(
      owner && !owner.isDestroyed() ? owner : undefined,
      {
        title: '选择其他 Agent 的 Skills 文件夹',
        buttonLabel: '使用此文件夹',
        properties: ['openDirectory']
      }
    ).catch(error => ({ canceled: true, error }));
    if (result?.error) return { ok: false, error: String(result.error?.message || result.error) };
    if (result?.canceled || !result?.filePaths?.length) return { ok: false, canceled: true };
    return previewSource(result.filePaths[0]);
  });

  ipcMain.handle('skills:source-apply', serialize(async (_e, payload = {}) => {
    const cfg = loadConfig();
    const workspace = String(cfg.workspace || '').trim();
    const key = skillRegistry.workspaceSkillSourceKey(workspace);
    const sourceConfig = skillRegistry.normalizeSkillSourceConfig(cfg);
    const requestedMode = String(payload?.mode || '').trim().toLowerCase();

    // Switching back to the official store only stops loading project Skills;
    // everything already imported stays on disk for an instant switch back.
    if (requestedMode === skillRegistry.OFFICIAL_SKILL_SOURCE) {
      if (key) {
        sourceConfig.active[key] = skillRegistry.OFFICIAL_SKILL_SOURCE;
        writeSourceConfig(cfg, sourceConfig);
        refresh('skill-source-official');
      }
      return { ok: true, official: true, filesKept: true, state: buildState() };
    }

    if (!workspace) {
      return { ok: false, error: '请先选择一个工作区。Blank 下只使用 Yan 官方 Skill 目录。' };
    }

    let entry = null;
    const requestedId = String(payload?.sourceId || '').trim().toLowerCase();
    if (requestedId) {
      entry = sourceConfig.known.find(item => item.id === requestedId) || null;
      if (!entry) return { ok: false, error: '这个来源已不在记忆列表中，请重新选择文件夹。' };
      const project = skillSource.describeProjectSource(workspace);
      if (project?.source?.id === entry.id) entry.mode = project.source.mode;
    } else {
      const mode = skillSource.normalizeImportMode(payload?.mode);
      if (!mode) return { ok: false, error: '请选择导入方式：软链或复制。' };
      const preview = previewSource(payload?.path);
      if (!preview.ok) return preview;
      if (!preview.count) return { ok: false, error: '该文件夹里没有找到包含 SKILL.md 的 Skill。' };
      entry = sourceConfig.known.find(item => item.id === preview.id) || null;
      if (entry) {
        entry.mode = mode;
        entry.name = entry.name || preview.name;
      } else {
        entry = {
          id: preview.id,
          path: preview.path,
          name: preview.name,
          mode,
          addedAt: Date.now(),
          lastUsedAt: 0
        };
        sourceConfig.known.push(entry);
      }
    }

    let applied = null;
    try {
      applied = await skillSource.applyProjectSkillSource({
        workspace,
        sourcePath: entry.path,
        mode: entry.mode
      });
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }

    entry.mode = applied.mode;
    entry.lastUsedAt = Date.now();
    sourceConfig.active[key] = entry.id;
    const latest = loadConfig();
    const latestSource = skillRegistry.normalizeSkillSourceConfig(latest);
    latestSource.known = latestSource.known.filter(item => item.id !== entry.id).concat(entry);
    latestSource.active[key] = entry.id;
    writeSourceConfig(latest, latestSource);
    refresh('skill-source-apply');
    return {
      ok: true,
      applied: {
        count: applied.entries.length,
        skipped: applied.skipped || [],
        directory: applied.directory,
        mode: applied.mode,
        path: applied.sourcePath
      },
      state: buildState()
    };
  }));

  ipcMain.handle('skills:source-forget', serialize((_e, sourceId) => {
    const cfg = loadConfig();
    const sourceConfig = skillRegistry.normalizeSkillSourceConfig(cfg);
    const wanted = String(sourceId || '').trim().toLowerCase();
    const before = sourceConfig.known.length;
    sourceConfig.known = sourceConfig.known.filter(item => item.id !== wanted);
    if (sourceConfig.known.length === before) {
      return { ok: false, error: '这个来源不在记忆列表中。' };
    }
    for (const key of Object.keys(sourceConfig.active)) {
      if (sourceConfig.active[key] === wanted) sourceConfig.active[key] = skillRegistry.OFFICIAL_SKILL_SOURCE;
    }
    writeSourceConfig(cfg, sourceConfig);
    refresh('skill-source-forget');
    return { ok: true, state: buildState() };
  }));

  return { buildState, previewSource };
}

module.exports = { registerSkillSourceRuntime };
