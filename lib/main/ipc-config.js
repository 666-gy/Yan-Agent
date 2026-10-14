'use strict';

// P1 cleanup: existing IPC contracts, with main-owned state injected.
const { analyzeWallpaperSource } = require('../wallpaper-analysis');
const path = require('path');
const { normalizeReasoningSpeed, reasoningSpeedEnablesThinking } = require('../reasoning-effort');
const { normalizeContextSettings } = require('../context-settings');
const { DEFAULT_MODEL_ROLES, getModelType, normalizeVisionRelayModels } = require('../model-roles');
const { normalizeShellPrefixes } = require('../permission-audit');

function registerConfigIpc(ctx, deps) {
  const { ipcMain, shell } = ctx;
  const { configStore, appRoot, dataDir, visionRelay, deepMerge, normalizeQuickLaunchConfig, providerConfig, MODEL_PROVIDERS, modelState, getMergedSkills, ensureDefaultMcp, workspaceRuntime, petWindows } = deps;

  ipcMain.handle('config:get', () => configStore.publicConfig(configStore.loadConfig()));

  ipcMain.handle('wallpaper:analyze', (_e, { source } = {}) => {
    try {
      return analyzeWallpaperSource(source, {
        rendererRoot: path.join(appRoot, 'renderer'),
        roots: [
          path.join(appRoot, 'renderer', 'assets', 'wallpapers'),
          path.join(dataDir, 'uploads')
        ]
      });
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle('vision-relay:status', () => visionRelay.getVisionRelayStatus(configStore.loadConfig()));

  ipcMain.handle('vision-relay:open-guide-url', async (_e, { url = '' } = {}) => {
    let target;
    try {
      target = new URL(String(url || '').trim());
    } catch {
      throw new Error('教学网站地址无效。');
    }
    const allowedGuideUrls = new Set([
      'https://bigmodel.cn/glm-coding',
      'https://www.sensenova.cn/',
      'https://agnes-ai.com/',
      'https://www.siliconflow.cn/'
    ]);
    const normalized = `${target.origin}${target.pathname}`;
    if (target.protocol !== 'https:'
        || target.username
        || target.password
        || !allowedGuideUrls.has(normalized)) {
      throw new Error('仅允许打开视觉中继教学文档中的官方网站。');
    }
    if (process.env.YAN_E2E_MODE !== '1') await shell.openExternal(target.toString());
    return { url: target.toString() };
  });

  ipcMain.handle('config:set', (_e, partial) => {
    const cfg = configStore.loadConfig();
    configStore.stripBlankConfigSecrets(partial);
    const merged = deepMerge(cfg, partial);
    if (partial?.api
        && Object.prototype.hasOwnProperty.call(partial.api, 'thinking')
        && !Object.prototype.hasOwnProperty.call(partial.api, 'reasoningSpeed')) {
      merged.api.reasoningSpeed = partial.api.thinking ? 'high' : 'medium';
    }
    merged.api.reasoningSpeed = normalizeReasoningSpeed(merged.api.reasoningSpeed, {
      thinking: merged.api.thinking === true
    });
    merged.api.thinking = reasoningSpeedEnablesThinking(merged.api.reasoningSpeed);
    merged.agent = configStore.normalizeAgentConfig(merged.agent);
    merged.api.visionRelayModels = normalizeVisionRelayModels(merged.api.visionRelayModels);
    merged.memory = require('../memory-settings').normalizeMemorySettings(merged.memory);
    merged.voice = require('../voice-preferences').normalize(merged.voice);
    merged.externalAgents = require('../external-agents/preferences').normalize(merged.externalAgents);
    merged.browser = require('../browser-preferences').normalizeBrowserPreferences(merged.browser);
    merged.context = normalizeContextSettings(merged.context);
    merged.quickLaunch = normalizeQuickLaunchConfig(merged.quickLaunch);
    merged.pet = configStore.normalizePetConfig(merged.pet);
    merged.tts = configStore.normalizeTtsConfig(merged.tts);
    merged.wallpaper = configStore.normalizeWallpaperConfig(merged.wallpaper);
    merged.themeCompat = configStore.normalizeThemeCompatConfig(merged.themeCompat);
    merged.language = configStore.normalizeLanguage(merged.language);
    if (partial?.worktrees) require('../worktree-preferences').validateWorktreePreferences(partial.worktrees);
    merged.worktrees = require('../worktree-preferences').normalizeWorktreePreferences(merged.worktrees);
    merged.git = require('../git-preferences').normalizeGitPreferences(merged.git);
    require('../git-preferences').validateBranchPrefix(merged.git);
    merged.general = require('../general-preferences').normalizeGeneralPreferences(merged.general);
    merged.experiments = require('../intelligent-ui').normalizeExperiments(merged.experiments);
    for (const key of ['allowFileRead', 'allowFileWrite', 'allowShell', 'allowNetwork']) merged.permissions[key] = true;
    merged.readingFont = configStore.normalizeReadingFont(merged.readingFont);
    merged.appearance = configStore.normalizeAppearance(merged.appearance);
    delete merged.codeMap;

    // 确保 apiKeys 结构完整
    if (!merged.api.apiKeys) merged.api.apiKeys = providerConfig.buildDefaultApiKeys();
    for (const id of Object.keys(MODEL_PROVIDERS)) {
      if (merged.api.apiKeys[id] === undefined) merged.api.apiKeys[id] = '';
    }

    // 确保 provider 有效
    if (!merged.api.provider || !MODEL_PROVIDERS[merged.api.provider]) {
      merged.api.provider = DEFAULT_MODEL_ROLES.text.providerId;
    }

    const provider = MODEL_PROVIDERS[merged.api.provider];
    const connection = providerConfig.getProviderConnection(merged, merged.api.provider);
    merged.api.baseUrl = connection.baseUrl;
    merged.api.apiKey = connection.apiKey;
    merged.models = providerConfig.getProviderModels(merged, provider.id);

    // 确保当前选中的模型属于当前 provider
    if (!merged.models.find(m => m.id === merged.api.model && getModelType(provider.id, m) === 'text')) {
      merged.api.model = modelState.getFirstTextModel(provider.id, merged.models)?.id || '';
    }
    modelState.updateImageGenerationConfig(merged);

    merged.skills = getMergedSkills(merged);
    merged.mcpServers = ensureDefaultMcp(merged.mcpServers || []);
    delete merged.computerUseV3;
    if (partial && Object.prototype.hasOwnProperty.call(partial, 'workspace')) {
      workspaceRuntime.startWorkspaceWatcher(merged.workspace);
    }
    configStore.saveConfig(merged);
    if (partial?.pet) petWindows.applyPetConfigRuntime(merged.pet);
    if (partial && Object.prototype.hasOwnProperty.call(partial, 'disabledModels')) {
      modelState.publishModelState(merged);
    }
    return configStore.publicConfig(merged);
  });

  ipcMain.handle('permissions:get', () => configStore.loadConfig().permissions);

  ipcMain.handle('permissions:set', (_e, perms) => {
    const cfg = configStore.loadConfig();
    const next = { ...cfg.permissions, ...perms };
    for (const key of ['allowFileRead', 'allowFileWrite', 'allowShell', 'allowNetwork']) next[key] = true;
    // The shell grant scope is the one permission value that is a list, so it
    // is normalised here: the renderer may only persist a bounded, well-formed
    // set of prefixes.
    if (perms && Object.prototype.hasOwnProperty.call(perms, 'shellAllowPrefixes')) {
      next.shellAllowPrefixes = normalizeShellPrefixes(perms.shellAllowPrefixes);
    }
    cfg.permissions = next;
    configStore.saveConfig(cfg);
    return cfg.permissions;
  });
}

module.exports = { registerConfigIpc };
