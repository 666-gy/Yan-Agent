'use strict';

// Skills runtime (plan T5.4): the skill-directory watcher, custom skill
// management, post-run learning review, bundled skill installation and the
// per-run skill selection. Moved verbatim from main.js.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { createPluginStore } = require('../plugins/store');

function registerSkillsRuntime(ctx, deps) {
  const { ipcMain, shell } = ctx;
  const {
    appRoot,
    dataDir,
    skillsDir,
    skillRegistry,
    configStore,
    getMergedSkills,
    skillEvolution,
    continualHarness,
    DEFAULT_SKILLS,
    mcpRuntimeConfig,
    getMainWindow,
    invalidateSidecar
  } = deps;

  function notifySkillsChanged(detail = {}) {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('skills:changed', detail);
    }
  }

  let yanSkillWatcher = null;
  let yanSkillRefreshTimer = null;

  function refreshYanSkillRegistry(detail = {}) {
    skillRegistry.invalidateInstalledSkillsCache(dataDir);
    const cfg = configStore.loadConfig();
    const storeResult = skillRegistry.syncSkillStore(cfg, appRoot, dataDir);
    if (!storeResult.ok) console.warn(`[SkillStore] ${storeResult.error}`);
    invalidateSidecar();
    notifySkillsChanged({ root: skillsDir, ...detail });
    return storeResult;
  }

  function startYanSkillWatcher() {
    if (yanSkillWatcher) return;
    fs.mkdirSync(skillsDir, { recursive: true });
    try {
      yanSkillWatcher = fs.watch(skillsDir, { recursive: true }, () => {
        clearTimeout(yanSkillRefreshTimer);
        yanSkillRefreshTimer = setTimeout(() => refreshYanSkillRegistry({ reason: 'filesystem' }), 250);
      });
      yanSkillWatcher.on('error', error => console.warn(`[skills] watcher failed: ${error.message}`));
    } catch (error) {
      console.warn(`[skills] watcher unavailable: ${error.message}`);
    }
  }

  function stopYanSkillWatcher() {
    clearTimeout(yanSkillRefreshTimer);
    yanSkillRefreshTimer = null;
    yanSkillWatcher?.close();
    yanSkillWatcher = null;
  }

  ipcMain.handle('skills:list', () => getMergedSkills(configStore.loadConfig()));
  ipcMain.handle('skills:catalog', () => skillRegistry.getAllSkillsForCatalog(configStore.loadConfig(), appRoot, dataDir));
  ipcMain.handle('skills:set-enabled', (_e, { id, enabled } = {}) => {
    if (typeof enabled !== 'boolean') return { ok: false, error: '技能开关状态无效。' };
    const cfg = configStore.loadConfig();
    const skill = skillRegistry.getInstalledSkills(cfg, appRoot, dataDir)
      .find(item => skillRegistry.normalizeId(item.id) === skillRegistry.normalizeId(id));
    if (!skill) return { ok: false, error: '未找到已安装的 Skill。' };
    if (skill.pluginId) {
      createPluginStore(dataDir).update(skill.pluginId, { skill: { id: skill.pluginSkillId, enabled } });
      skillRegistry.invalidateInstalledSkillsCache(dataDir);
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('plugins:changed');
      notifySkillsChanged({ reason: 'enabled', id: skill.id });
      return { ok: true, enabled: skillRegistry.isSkillEnabled(skill.id, cfg, appRoot, dataDir) };
    }
    const disabled = new Set((Array.isArray(cfg.disabledSkills) ? cfg.disabledSkills : []).map(skillRegistry.normalizeId));
    if (enabled) disabled.delete(skillRegistry.normalizeId(skill.id));
    else disabled.add(skillRegistry.normalizeId(skill.id));
    cfg.disabledSkills = [...disabled];
    configStore.saveConfig(cfg);
    // Reads consult the persisted policy on each call. Do not restart an
    // active kernel or repaint its detail page just to change visibility.
    notifySkillsChanged({ reason: 'enabled', id: skill.id });
    return { ok: true, enabled: skillRegistry.isSkillEnabled(skill.id, cfg, appRoot, dataDir) };
  });
  ipcMain.handle('skills:open-directory', async (_e, skillId) => {
    const id = String(skillId || '').trim().toLowerCase();
    if (!id) return { ok: false, error: 'Skill ID 为空。' };
    const cfg = configStore.loadConfig();
    const skill = skillRegistry.getInstalledSkills(cfg, appRoot, dataDir)
      .find(item => String(item?.id || '').trim().toLowerCase() === id);
    if (!skill) return { ok: false, error: '未找到已安装的 Skill。' };
    try {
      let directory = skill.runtimeDirectory || skillRegistry.resolveBundledSkillPackage(appRoot, skill.id);
      if (!directory) {
        const store = skillRegistry.syncSkillStore(cfg, appRoot, dataDir);
        const entry = store.index?.entries?.find(item => item.id === skill.id);
        if (!store.ok || !entry?.storePath) return { ok: false, error: 'Skill 目录不可用。' };
        directory = path.join(skillRegistry.getSkillStoreInfo(dataDir).root, entry.storePath);
      }
      const unpacked = directory.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
      if (unpacked !== directory && fs.existsSync(unpacked)) directory = unpacked;
      directory = path.resolve(directory);
      const stat = await fsp.stat(directory);
      if (!stat.isDirectory()) return { ok: false, error: 'Skill 目录不可用。' };
      const error = await shell.openPath(directory);
      return error ? { ok: false, error } : { ok: true, path: directory };
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  });

  function upsertCustomSkill(skill = {}) {
    const cfg = configStore.loadConfig();
    if (!cfg.customSkills) cfg.customSkills = [];
    // Ids are compared through normalizeId so a case-variant of an existing
    // custom Skill updates that entry instead of being appended as a second
    // copy that remove/list can never match again.
    const wantedId = skillRegistry.normalizeId(skill.id);
    if (!wantedId) return { error: 'id 和 prompt 为必填项' };
    const idx = cfg.customSkills.findIndex(s => skillRegistry.normalizeId(s?.id) === wantedId);
    const previous = idx >= 0 ? cfg.customSkills[idx] : null;
    const item = {
      id: String(skill.id || '').trim(),
      name: String(skill.name || skill.id || 'Custom Skill').trim(),
      desc: String(skill.desc || '').trim(),
      prompt: String(skill.prompt || '').trim(),
      source: skill.source || 'custom',
      repo: String(skill.repo || '').trim() || undefined,
      stars: String(skill.stars || '').trim() || undefined,
      aliases: Array.isArray(skill.aliases) ? skill.aliases.map(alias => String(alias || '').trim()).filter(Boolean) : [],
      tags: Array.isArray(skill.tags) ? skill.tags.map(tag => String(tag || '').trim()).filter(Boolean) : [],
      triggers: Array.isArray(skill.triggers) ? skill.triggers.map(trigger => String(trigger || '').trim()).filter(Boolean) : [],
      requires: Array.isArray(skill.requires) ? skill.requires : [],
      version: Number.isFinite(Number(skill.version)) ? Number(skill.version) : 1,
      logo: skillRegistry.resolveSkillLogo(skill),
      createdBy: String(skill.createdBy || previous?.createdBy || '').trim() || undefined,
      evidenceCount: Number.isFinite(Number(skill.evidenceCount)) ? Number(skill.evidenceCount) : previous?.evidenceCount,
      installedAt: previous?.installedAt || Date.now(),
      updatedAt: Number.isFinite(Number(skill.updatedAt)) ? Number(skill.updatedAt) : Date.now()
    };
    if (!item.id || !item.prompt) return { error: 'id 和 prompt 为必填项' };
    if (DEFAULT_SKILLS.find(s => skillRegistry.normalizeId(s.id) === wantedId)) return { error: '与内置 Skill 冲突' };
    const installResult = skillRegistry.installYanUserSkill(dataDir, item);
    if (!installResult.ok) return { error: installResult.error };
    const storedItem = configStore.skillConfigMetadata(item);
    if (idx >= 0) cfg.customSkills[idx] = storedItem;
    else cfg.customSkills.push(storedItem);
    configStore.saveConfig(cfg);
    const storeResult = refreshYanSkillRegistry({ reason: 'install', id: item.id });
    if (!storeResult.ok) return { error: storeResult.error };
    return { ...storedItem, runtimeDirectory: installResult.directory };
  }

  ipcMain.handle('skills:add-custom', (_e, skill) => upsertCustomSkill(skill));

  ipcMain.handle('skills:remove-custom', (_e, id) => {
    const cfg = configStore.loadConfig();
    const removeResult = skillRegistry.removeYanUserSkill(dataDir, id);
    if (!removeResult.ok) return { error: removeResult.error };
    const wantedId = skillRegistry.normalizeId(id);
    cfg.customSkills = (cfg.customSkills || []).filter(s => skillRegistry.normalizeId(s?.id) !== wantedId);
    configStore.saveConfig(cfg);
    const storeResult = refreshYanSkillRegistry({ reason: 'remove', id });
    if (!storeResult.ok) return { error: storeResult.error };
    return true;
  });

  async function recordLearningReview(payload = {}) {
    if (!payload.skillCandidate) return { ok: true, candidate: null, promotedSkill: null };
    const recorded = skillEvolution.record(payload.skillCandidate, {
      verified: !!payload.verified,
      toolCallCount: payload.toolCallCount,
      runId: payload.runId,
      sessionId: payload.sessionId,
      workspace: payload.workspace
    });
    if (!recorded.ok) return { ...recorded, promotedSkill: null };

    const candidate = recorded.candidate;
    const learnedId = `yan-learned-${candidate.id.replace(/^yan-(?:learned-)?/, '')}`;
    const scope = payload.workspace ? 'workspace' : 'global';
    const state = continualHarness.load({ scope, workspace: payload.workspace });
    const existingHarnessSkill = state.entries.skill[learnedId];
    const harnessEdit = {
      action: existingHarnessSkill ? 'update' : 'create',
      kind: 'skill',
      id: learnedId,
      title: candidate.name,
      content: candidate.prompt,
      path: 'learned',
      scope,
      metadata: {
        status: recorded.ready ? 'active' : 'observing',
        description: candidate.description,
        triggers: candidate.triggers || [],
        successfulRuns: candidate.successfulRuns,
        evidenceCount: candidate.successfulRuns.length
      },
      reason: candidate.evidence
    };
    const harnessResult = await continualHarness.apply({
      trigger: `Learn reusable Skill ${candidate.name}`,
      evidence: candidate.evidence,
      expectedOutcome: recorded.ready
        ? 'Make the repeatedly verified procedure available as a Yan Skill.'
        : 'Observe the same procedure in another independent verified run before activation.',
      edits: [harnessEdit]
    }, {
      scope,
      workspace: payload.workspace,
      expectedRevision: payload.harnessBaseline?.revision,
      baselineState: payload.harnessBaseline,
      runId: payload.runId,
      sessionId: payload.sessionId,
      source: 'background_review'
    });
    if (!harnessResult.ok || !harnessResult.refinement?.appliedEdits?.some(edit => edit.applied)) {
      return { ...recorded, harnessResult, promotedSkill: null };
    }
    if (!recorded.ready) {
      await continualHarness.recordOutcome(harnessResult.refinement.id, {
        status: 'partial',
        evidence: 'Candidate retained in observing state pending independent reinforcement.'
      }, { scope, workspace: payload.workspace });
      return { ...recorded, harnessResult, promotedSkill: null };
    }

    const promotionGate = skillEvolution.canPromote(candidate.id, { requireValidation: Boolean(candidate.verification?.postconditions?.length) });
    if (!promotionGate.ok) {
      await continualHarness.rollback(harnessResult.refinement.id, {
        scope,
        workspace: payload.workspace,
        source: 'validation_gate',
        evidence: promotionGate.reason
      });
      return { ...recorded, harnessResult, error: promotionGate.reason, promotedSkill: null };
    }
    const existingSkill = (configStore.loadConfig().customSkills || []).find(skill => skill.id === learnedId);
    if (existingSkill && existingSkill.createdBy !== 'yan-skill-creator') {
      await continualHarness.rollback(harnessResult.refinement.id, {
        scope,
        workspace: payload.workspace,
        source: 'projection_failed',
        evidence: `A user or external Skill already owns ${learnedId}.`
      });
      return {
        ...recorded,
        error: `同名 Skill「${learnedId}」已由用户或外部来源安装，Yan Skill Creator 不会覆盖它。`,
        promotedSkill: null
      };
    }
    const promotedSkill = upsertCustomSkill({
      id: learnedId,
      name: candidate.name,
      desc: candidate.description,
      prompt: candidate.prompt,
      source: 'yan-self-evolution',
      aliases: [],
      tags: ['learned'],
      triggers: candidate.triggers || [],
      requires: [],
      version: 1,
      createdBy: 'yan-skill-creator',
      evidenceCount: candidate.successfulRuns.length,
      updatedAt: Date.now()
    });
    if (promotedSkill?.error) {
      await continualHarness.rollback(harnessResult.refinement.id, {
        scope,
        workspace: payload.workspace,
        source: 'projection_failed',
        evidence: promotedSkill.error
      });
      return { ...recorded, error: promotedSkill.error, harnessResult, promotedSkill: null };
    }
    skillEvolution.markPromoted(candidate.id, promotedSkill.id, { refinementId: harnessResult.refinement.id });
    await continualHarness.recordOutcome(harnessResult.refinement.id, {
      status: 'verified',
      evidence: `${candidate.successfulRuns.length} distinct verified runs reinforced this procedure and the Skill projection succeeded.`
    }, { scope, workspace: payload.workspace });
    return { ...recorded, harnessResult, promotedSkill };
  }

  ipcMain.handle('skills:market', () => skillRegistry.getMarketSkills(appRoot, dataDir));

  ipcMain.handle('skills:read', async (_e, payload) => {
    const { id, taskContext } = payload || {};
    const cfg = configStore.loadConfig();
    if (payload?.documentOnly === true) {
      // Detail preview reads installed instructions without injecting task
      // context, expanding runtime prompts or attempting an installation.
      try {
        const skill = skillRegistry.getInstalledSkills(cfg, appRoot, dataDir)
          .find(item => skillRegistry.normalizeId(item.id) === skillRegistry.normalizeId(id));
        if (!skill) return { ok: false, error: '未找到已安装的 Skill。' };
        const directory = skill.runtimeDirectory || skillRegistry.resolveBundledSkillPackage(appRoot, skill.id);
        const file = directory ? path.join(directory, 'SKILL.md') : '';
        const document = file ? await fsp.readFile(file, 'utf8') : String(skill.prompt || '');
        return { ok: true, id: skill.id, markdown: skillRegistry.parseSkillDocument(document).prompt, document };
      } catch (error) {
        return { ok: false, error: `无法读取 Skill.md：${error.message || error}` };
      }
    }
    return skillRegistry.readSkillWithRetry(id, taskContext, cfg, appRoot, dataDir, configStore.saveConfig, {
      allowUserOnly: true,
      maxAttempts: 3
    });
  });
  // ---------------------------------------------------------------------------
  // Bundled agent skills (OfficeCLI and Yan-local integrations)
  // ---------------------------------------------------------------------------
  let bundledAgentSkillsReady = false;

  function ensureBundledAgentSkills(cfg) {
    if (bundledAgentSkillsReady) return false;
    const bundledDir = path.join(appRoot, 'lib', 'skills', 'bundled');
    if (!fs.existsSync(bundledDir)) return false;
    if (!cfg.customSkills) cfg.customSkills = [];
    const files = fs.readdirSync(bundledDir).filter(f => f.endsWith('.json'));
    const manifests = files.flatMap(file => {
      const manifestPath = path.join(bundledDir, file);
      try {
        return [JSON.parse(fs.readFileSync(manifestPath, 'utf8'))];
      } catch (error) {
        // Distinguish "not valid JSON" from "valid JSON, wrong shape": both used
        // to drop the bundled Skill without leaving any trace of which file.
        const detail = error instanceof SyntaxError ? `invalid JSON: ${error.message}` : error.message;
        console.warn(`[skills] bundled manifest unusable (${manifestPath}): ${detail}`);
        return [];
      }
    });
    const availableAppManagedIds = new Set(manifests.map(meta => String(meta?.id || '')).filter(Boolean));
    const migratedShadows = skillRegistry.migrateBundledSkillShadows(dataDir, appRoot, availableAppManagedIds);
    const retiredSkillIds = skillRegistry.getRetiredSkillIds(appRoot);
    const retiredResult = skillRegistry.pruneRetiredSkills(cfg, appRoot, dataDir);
    const beforePrune = cfg.customSkills.length;
    cfg.customSkills = cfg.customSkills.filter(skill => (
      !retiredSkillIds.has(String(skill?.id || '').trim().toLowerCase())
      && (!['Yan Agent', 'bundled'].includes(skill?.source) || availableAppManagedIds.has(String(skill.id || '')))
    ));
    let changed = migratedShadows.changed || retiredResult.changed || cfg.customSkills.length !== beforePrune;
    for (const meta of manifests) {
      if (!meta?.id) continue;
      let prompt = String(meta.prompt || '').trim();
      if (meta.promptFile) {
        const promptPath = path.join(bundledDir, meta.promptFile);
        if (fs.existsSync(promptPath)) {
          prompt = fs.readFileSync(promptPath, 'utf8');
        }
      }
      if (!prompt) continue;
      const existing = cfg.customSkills.find(skill => skill.id === meta.id);
      const installedAt = Number(existing?.installedAt || meta.installedAt) || Date.now();
      const item = {
        id: meta.id,
        name: meta.name || meta.id,
        desc: meta.desc || '',
        version: Number(meta.version || 1),
        prompt,
        aliases: Array.isArray(meta.aliases) ? meta.aliases : [],
        tags: meta.tags || [],
        triggers: meta.triggers || [],
        requires: Array.isArray(meta.requires) ? meta.requires : [],
        source: meta.source || 'bundled',
        repo: meta.repo || '',
        hidden: meta.hidden === true,
        userOnly: meta.userOnly === true,
        parentSkillId: meta.parentSkillId || '',
        logo: skillRegistry.resolveSkillLogo(meta),
        installedAt,
        updatedAt: Number(meta.updatedAt || existing?.updatedAt) || installedAt
      };
      if (!skillRegistry.resolveBundledSkillPackage(appRoot, item.id)) {
        const installResult = skillRegistry.installYanUserSkill(dataDir, item);
        if (!installResult.ok) console.warn(`[skills] bundled prompt install failed (${item.id}): ${installResult.error}`);
      }
      const idx = cfg.customSkills.findIndex(s => s.id === item.id);
      const metadata = configStore.skillConfigMetadata(item);
      if (idx < 0) {
        cfg.customSkills.push(metadata);
        changed = true;
      } else {
        const next = { ...cfg.customSkills[idx], ...metadata, installedAt };
        delete next.prompt;
        if (JSON.stringify(next) !== JSON.stringify(cfg.customSkills[idx])) {
          cfg.customSkills[idx] = next;
          changed = true;
        }
      }
    }
    const compact = configStore.skillConfigMetadataList(cfg.customSkills);
    if (JSON.stringify(compact) !== JSON.stringify(cfg.customSkills)) {
      cfg.customSkills = compact;
      changed = true;
    }
    bundledAgentSkillsReady = true;
    if (changed) {
      skillRegistry.invalidateInstalledSkillsCache(dataDir);
    }
    return changed;
  }

  // ---------------------------------------------------------------------------
  // IPC: OpenCode runtime (the only Agent execution authority)
  // ---------------------------------------------------------------------------
  function getNoWorkspaceAgentDirectory(sessionId) {
    const key = crypto.createHash('sha256')
      .update(String(sessionId || 'anonymous'))
      .digest('hex');
    return require('../blank-workspace').resolveBlankDirectory(dataDir, configStore.loadConfig().general?.blankWorkspace, key);
  }

  async function selectedRunSkills(requestedSkills, cfg, { workspace, workMode } = {}) {
    cfg = { ...cfg, workspace: workspace ?? cfg.workspace };
    const enabled = id => skillRegistry.isSkillEnabled(id, cfg, appRoot, dataDir);
    const requested = (Array.isArray(requestedSkills) ? requestedSkills : [])
      .filter(skill => enabled(skill?.id || skill));
    const requestedIds = mcpRuntimeConfig.selectedSkillIds(requested);
    if (requestedIds.has('yan-serena') && !workspace) {
      return {
        error: 'Serena 需要当前任务工作区。请先选择工作区后，再使用 Serena 进行代码定位或符号级修改。'
      };
    }
    const skills = [];
    const skippedSkills = [];
    // `requires` used to be decoration: the catalog rendered it into the prompt
    // and nothing checked it, so a Skill whose MCP was disabled or uninstalled
    // still loaded and then failed at tool-call time. Judge it against the
    // configured server list while the Skill is still being resolved, so an
    // unmet requirement becomes a visible skip the model can report.
    const configuredServers = Array.isArray(cfg.mcpServers) ? cfg.mcpServers : [];
    for (const requestedSkill of requested) {
      const id = String(requestedSkill?.id || requestedSkill || '').trim();
      if (!id) continue;
      const loaded = await skillRegistry.readSkillWithRetry(
        id, '', cfg, appRoot, dataDir, configStore.saveConfig, { allowUserOnly: true, maxAttempts: 3 }
      );
      if (!loaded?.ok) {
        skippedSkills.push({
          id: String(loaded?.id || id),
          name: String(loaded?.name || requestedSkill?.name || id),
          attempts: Number(loaded?.attempts) || 1,
          error: String(loaded?.error || 'Skill 无法加载。'),
          skipNotice: String(loaded?.skipNotice || `Skill「${id}」本轮已跳过。`)
        });
        continue;
      }
      const unmet = mcpRuntimeConfig.unmetSkillRequirements(loaded, configuredServers);
      if (unmet.length) {
        const missing = unmet.map(requirement => requirement.match).join('、');
        skippedSkills.push({
          id: String(loaded.id || id),
          name: String(loaded.name || requestedSkill?.name || id),
          attempts: 1,
          error: `缺少依赖 MCP：${missing}`,
          skipNotice: `Skill「${loaded.name || id}」本轮已跳过：需要 MCP「${missing}」，但它未安装或已禁用。`
        });
        continue;
      }
      skills.push({
        ...(typeof requestedSkill === 'object' ? requestedSkill : {}),
        id: String(loaded.id || id),
        name: String(loaded.name || requestedSkill?.name || id),
        desc: String(loaded.desc || requestedSkill?.desc || ''),
        aliases: Array.isArray(loaded.aliases) ? loaded.aliases : (requestedSkill?.aliases || []),
        prompt: String(loaded.prompt || ''),
        requires: Array.isArray(loaded.requires) ? loaded.requires : (requestedSkill?.requires || []),
        runtimeDirectory: String(loaded.runtimeDirectory || requestedSkill?.runtimeDirectory || '')
      });
    }
    const userSelectedSerena = mcpRuntimeConfig.selectedSkillIds(skills).has('yan-serena');
    if (workMode !== 'goal' || !workspace || userSelectedSerena || !enabled('yan-serena')) return { skills, skippedSkills };

    const serena = await skillRegistry.readSkillWithRetry('yan-serena', '', cfg, appRoot, dataDir, configStore.saveConfig, { maxAttempts: 3 });
    if (!serena?.ok) {
      skippedSkills.push({
        id: 'yan-serena', name: 'Serena', attempts: Number(serena?.attempts) || 1,
        error: String(serena?.error || '内置 Skill 不可用'),
        skipNotice: String(serena?.skipNotice || 'Serena 本轮已跳过。')
      });
      return { skills, skippedSkills };
    }
    skills.push({
      id: String(serena.id || 'yan-serena'),
      name: String(serena.name || 'Serena'),
      desc: String(serena.desc || ''),
      aliases: Array.isArray(serena.aliases) ? serena.aliases : [],
      prompt: String(serena.prompt || ''),
      requires: Array.isArray(serena.requires) ? serena.requires : []
    });
    return { skills, skippedSkills };
  }

  return {
    notifySkillsChanged,
    yanSkillWatcher,
    yanSkillRefreshTimer,
    refreshYanSkillRegistry,
    startYanSkillWatcher,
    stopYanSkillWatcher,
    upsertCustomSkill,
    recordLearningReview,
    bundledAgentSkillsReady,
    ensureBundledAgentSkills,
    getNoWorkspaceAgentDirectory,
    selectedRunSkills,
  };
}

module.exports = { registerSkillsRuntime };
