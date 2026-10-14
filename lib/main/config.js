'use strict';

// Config store (plan T4.1): loadConfig with its migrations and normalization,
// encrypted persistence, and the renderer-facing public projection. Moved
// verbatim from main.js; every cross-domain helper arrives through explicit
// dependencies so the store stays independently testable.

const fs = require('fs');
const path = require('path');
const { DEFAULT_MODEL_ROLES, getModelType, normalizeVisionRelayModels } = require('../model-roles');
const { DEFAULT_CONTEXT_SETTINGS, normalizeContextSettings } = require('../context-settings');
const { normalizeMeasurementStore } = require('../input-throughput');
const { normalizeConnectionStore } = require('../connection-presets');
const { normalizeSubagentModels } = require('../subagent');
const {
  DEFAULT_INPUT_TOKENS_PER_SECOND,
  OPENCODE_VERSION,
  normalizeInputTokensPerSecond,
  normalizeSubagentRoles
} = require('../opencode-sidecar');

function createConfigStore(deps) {
  const {
    app,
    safeStorage,
    configPath,
    MODEL_PROVIDERS,
    providerConfig,
    PET_IDS,
    DEFAULT_MODELS,
    DEFAULT_SKILLS,
    DEFAULT_QUICK_INPUT_SHORTCUT,
    ensureDefaultMcp,
    normalizeAgentModelSelection,
    updateImageGenerationConfig,
    normalizeQuickLaunchConfig,
    getFirstTextModel,
    ensureBundledAgentSkills,
    getMergedSkills,
    deepMerge,
    ensureDirs,
    writeAtomic,
    normalizeReasoningSpeed,
    reasoningSpeedEnablesThinking,
    normalizeVoice,
    normalizeRate
  } = deps;

  function loadConfig() {
    let cfg = null;
    let shouldPersistNormalizedState = false;
    try {
      if (fs.existsSync(configPath)) {
        cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (cfg && typeof cfg === 'object') transformConfigSecrets(cfg, decryptConfigSecret);
      }
    } catch (e) {
      console.error('loadConfig error:', e);
    }

    const defaults = {
      api: {
        provider: DEFAULT_MODEL_ROLES.text.providerId,
        baseUrl: MODEL_PROVIDERS.agnes.baseUrl,
        apiKey: '',
        apiKeys: providerConfig.buildDefaultApiKeys(),
        providerConfigs: providerConfig.buildDefaultProviderConfigs(),
        providerSuppliers: providerConfig.buildDefaultProviderSuppliers(),
        providerActiveSupplierIds: {},
        model: DEFAULT_MODEL_ROLES.text.model,
        thinking: false,
        reasoningSpeed: 'medium',
        visionRelayModels: [],
        inputTokensPerSecond: DEFAULT_INPUT_TOKENS_PER_SECOND,
        connections: [],
        enabledConnections: [],
        connectionsMigrated: false
      },
      agentModel: {
        providerId: DEFAULT_MODEL_ROLES.text.providerId,
        supplierId: 'official',
        modelId: DEFAULT_MODEL_ROLES.text.model,
        modelType: 'text',
        name: 'Agnes 2.0 Flash',
        capabilities: DEFAULT_MODELS.find(model => model.id === DEFAULT_MODEL_ROLES.text.model)?.capabilities || {}
      },
      agent: {
        workMode: 'normal',
        accessMode: 'request',
        // Fast write path is the default: the kernel no longer pays a formatter
        // process after every edit; finalization normalizes authored files once.
        disableAutoFormatter: true,
        enableSubagents: true,
        subagentRoles: {
          explorer: true,
          reviewer: true,
          researcher: true,
          tester: true,
          builder: true
        },
        subagentMaxChildren: 10,
        responseTimeoutMinutes: 2
      },
      workspace: path.join(app.getPath('home'), 'YanWorkspace'),
      theme: 'dark',
      readingFont: 'serif',
      appearance: require('../appearance').normalize(),
      wallpaper: {
        id: '',
        path: '',
        name: '',
        custom: [],
        removed: [],
        opacity: 1,
        volume: 0
      },
      themeCompat: {
        autoAdapt: true,
        materialStrength: 0.45,
        accentFollow: true
      },
      language: 'zh-CN',
      browser: require('../browser-preferences').normalizeBrowserPreferences(),
      worktrees: require('../worktree-preferences').normalizeWorktreePreferences(),
      git: require('../git-preferences').normalizeGitPreferences(),
      general: require('../general-preferences').normalizeGeneralPreferences(),
      experiments: require('../intelligent-ui').normalizeExperiments(),
      appSnapshot: require('../app-snapshot-settings').normalize(),
      memory: require('../memory-settings').normalizeMemorySettings(),
      voice: require('../voice-preferences').normalize(),
      externalAgents: require('../external-agents/preferences').normalize(),
      permissions: {
        allowFileRead: true,
        allowFileWrite: true,
        allowShell: true,
        allowNetwork: true,
        // P0: persisted shell grant scope. A grant covers one command prefix
        // ("pnpm run lint"), never the whole `bash` permission.
        shellAllowPrefixes: []
      },
      context: { ...DEFAULT_CONTEXT_SETTINGS },
      models: DEFAULT_MODELS,
      providerModels: { openai: [], grok: [], agnes: [], glm: [], siliconflow: [], 'custom-model': [] },
      media: {
        imageProvider: '',
        imageSupplierId: '',
        imageModel: '',
        imageName: '',
        videoProvider: '',
        videoSupplierId: '',
        videoModel: '',
        videoName: ''
      },
      imageGeneration: {
        available: false,
        strategy: '',
        providerId: '',
        model: ''
      },
      videoGeneration: {
        available: false,
        providerId: '',
        model: ''
      },
      quickLaunch: {
        enabled: true,
        shortcut: DEFAULT_QUICK_INPUT_SHORTCUT
      },
      pet: {
        enabled: false,
        selected: 'orb'
      },
      tts: {
        voice: 'zh-CN-XiaoxiaoNeural',
        rate: 0
      },
      mcpServers: ensureDefaultMcp([]),
      skills: DEFAULT_SKILLS,
      customSkills: [],
      // Skill load source. `known` remembers every external Skill folder the
      // user ever configured (path + symlink/copy mode) so switching back never
      // requires browsing the file system again; `active` maps a workspace key
      // to a known source id, or 'official' for the default Yan store.
      skillSource: {
        known: [],
        active: {}
      },
      customModel: {
        id: 'custom-model',
        name: '自定义模型',
        modelName: '',
        modelId: '',
        baseUrl: '',
        apiKey: '',
        apiFormat: 'openai',
        models: []
      },
      customProviders: [{
        id: 'custom-model',
        name: '自定义模型',
        modelName: '',
        modelId: '',
        baseUrl: '',
        apiKey: '',
        apiFormat: 'openai',
        models: []
      }],
      executionKernel: {
        id: 'yan-kernel',
        name: 'Yan Kernel',
        version: app.getVersion(),
        engine: 'opencode',
        engineVersion: OPENCODE_VERSION
      }
    };

    if (!cfg) {
      providerConfig.migrateLegacyConnections(defaults);
      providerConfig.syncConnectionProviders(defaults);
      providerConfig.ensureProviderConfigs(defaults);
      normalizeAgentModelSelection(defaults);
      updateImageGenerationConfig(defaults);
      return defaults;
    }
    const storedProviderId = String(cfg.api?.provider || defaults.api.provider);
    const storedProviderConfig = cfg.api?.providerConfigs?.[storedProviderId];
    const hasStoredProviderSuppliers = !!cfg.api?.providerSuppliers
      && typeof cfg.api.providerSuppliers === 'object';
    const hasStoredEnabledConnections = Array.isArray(cfg.api?.enabledConnections);
    const hasStoredProviderBaseUrl = !!storedProviderConfig
      && Object.prototype.hasOwnProperty.call(storedProviderConfig, 'baseUrl');
    const legacyBaseUrl = String(cfg.api?.baseUrl || '').trim().replace(/\/$/, '');
    const storedReasoningSpeed = normalizeReasoningSpeed(cfg.api?.reasoningSpeed, {
      thinking: cfg.api?.thinking === true
    });
    const merged = deepMerge(defaults, cfg);
    delete merged.codeMap;
    providerConfig.migrateLegacyConnections(merged);
    providerConfig.syncConnectionProviders(merged);
    merged.api.reasoningSpeed = storedReasoningSpeed;
    merged.api.visionRelayModels = normalizeVisionRelayModels(merged.api.visionRelayModels);
    merged.api.inputTokensPerSecond = Math.max(DEFAULT_INPUT_TOKENS_PER_SECOND, normalizeInputTokensPerSecond(
      merged.api.inputTokensPerSecond || merged.agent?.inputTokensPerSecond
    ));
    merged.api.inputThroughput = normalizeMeasurementStore(merged.api.inputThroughput);
    merged.api.thinking = reasoningSpeedEnablesThinking(storedReasoningSpeed);
    merged.agent = normalizeAgentConfig(merged.agent);
    if (cfg.agent?.workMode != null && cfg.agent.workMode !== merged.agent.workMode) {
      shouldPersistNormalizedState = true;
    }
    merged.context = normalizeContextSettings(merged.context);
    merged.quickLaunch = normalizeQuickLaunchConfig(merged.quickLaunch);
    merged.pet = normalizePetConfig(merged.pet);
    merged.tts = normalizeTtsConfig(merged.tts);
    merged.wallpaper = normalizeWallpaperConfig(merged.wallpaper);
    merged.themeCompat = normalizeThemeCompatConfig(merged.themeCompat);
    merged.language = normalizeLanguage(merged.language);
    merged.worktrees = require('../worktree-preferences').normalizeWorktreePreferences(merged.worktrees);
    merged.git = require('../git-preferences').normalizeGitPreferences(merged.git);
    merged.general = require('../general-preferences').normalizeGeneralPreferences(merged.general);
    merged.experiments = require('../intelligent-ui').normalizeExperiments(merged.experiments);
    if (!merged.general.blankWorkspace) merged.general.blankWorkspace = path.join(path.dirname(configPath), 'opencode-runtime', 'no-workspace');
    merged.appSnapshot = require('../app-snapshot-settings').normalize(merged.appSnapshot);
    merged.memory = require('../memory-settings').normalizeMemorySettings(merged.memory);
    merged.voice = require('../voice-preferences').normalize(merged.voice);
    merged.externalAgents = require('../external-agents/preferences').normalize(merged.externalAgents);
    merged.browser = require('../browser-preferences').normalizeBrowserPreferences(merged.browser);
    if (merged.agent?.workMode === 'evolution') merged.agent.workMode = 'normal';
    for (const key of ['allowFileRead', 'allowFileWrite', 'allowShell', 'allowNetwork']) merged.permissions[key] = true;
    merged.readingFont = normalizeReadingFont(merged.readingFont);
    merged.appearance = normalizeAppearance(merged.appearance);

    // Migrate the former one-connection-per-provider layout into a supplier
    // registry. Existing credentials, endpoints, and cached models become the
    // provider's official supplier and remain mirrored to legacy fields.
    if (!merged.api.providerSuppliers || typeof merged.api.providerSuppliers !== 'object') {
      merged.api.providerSuppliers = {};
    }
    if (!hasStoredProviderSuppliers) {
      // Force ensureProviderConfigs to seed each official supplier from the
      // legacy providerConfigs/providerModels values instead of the defaults.
      merged.api.providerSuppliers = {};
    }
    if (!merged.api.providerActiveSupplierIds || typeof merged.api.providerActiveSupplierIds !== 'object') {
      merged.api.providerActiveSupplierIds = {};
    }

    // One-time migration for configurations created before providerConfigs.
    // Never repeat this inside ensureProviderConfigs: doing so overwrites an
    // explicit attempt to restore a provider's default Base URL.
    if (!hasStoredProviderBaseUrl && MODEL_PROVIDERS[storedProviderId] && legacyBaseUrl) {
      merged.api.providerConfigs[storedProviderId].baseUrl = legacyBaseUrl;
    }

    // 迁移旧配置：旧的单 apiKey 迁移到 apiKeys.deepseek
    if (merged.api?.apiKey && !merged.api.apiKeys?.deepseek) {
      if (!merged.api.apiKeys) merged.api.apiKeys = providerConfig.buildDefaultApiKeys();
      merged.api.apiKeys.deepseek = merged.api.apiKey;
    }

    // 确保 apiKeys 包含所有已知厂商
    if (!merged.api.apiKeys) merged.api.apiKeys = providerConfig.buildDefaultApiKeys();
    for (const id of Object.keys(MODEL_PROVIDERS)) {
      if (merged.api.apiKeys[id] === undefined) merged.api.apiKeys[id] = '';
    }
    providerConfig.ensureProviderConfigs(merged);
    // Normalize the connection store and drop entries whose origin supplier
    // disappeared (deleted via an older build or an external edit).
    if (Array.isArray(merged.api.connections)) {
      merged.api.connections = normalizeConnectionStore(merged.api.connections).filter(connection => {
        const suppliers = merged.api.providerSuppliers?.[connection.providerId];
        return Array.isArray(suppliers) && suppliers.some(item => item.id === connection.supplierId);
      });
    }
    shouldPersistNormalizedState = providerConfig.ensureEnabledConnections(merged, { seed: !hasStoredEnabledConnections }) || shouldPersistNormalizedState;
    shouldPersistNormalizedState = providerConfig.pruneUnlistedSupplierState(merged) || shouldPersistNormalizedState;
    const legacySharedGateway = 'https://ai8.my/v1';
    for (const providerId of ['openai', 'grok']) {
      if (String(merged.api.providerConfigs?.[providerId]?.baseUrl || '').trim() === legacySharedGateway) {
        merged.api.providerConfigs[providerId].baseUrl = MODEL_PROVIDERS[providerId].baseUrl;
      }
    }
    if (String(merged.api.providerConfigs?.deepseek?.baseUrl || '').replace(/\/$/, '') === 'https://api.deepseek.com/v1') {
      merged.api.providerConfigs.deepseek.baseUrl = 'https://api.deepseek.com';
    }

    // 确保 provider 有效
    if (!merged.api.provider || !MODEL_PROVIDERS[merged.api.provider]) {
      merged.api.provider = defaults.api.provider;
    }

    const provider = MODEL_PROVIDERS[merged.api.provider];
    const connection = providerConfig.getProviderConnection(merged, merged.api.provider);
    merged.api.baseUrl = connection.baseUrl;
    merged.api.apiKey = connection.apiKey;

    // 动态厂商使用服务端返回并持久化的模型目录，静态厂商使用内置目录。
    merged.models = providerConfig.getProviderModels(merged, provider.id);

    // 确保当前选中的模型属于当前 provider
    if (!merged.models.find(m => m.id === merged.api.model && getModelType(provider.id, m) === 'text')) {
      merged.api.model = getFirstTextModel(provider.id, merged.models)?.id || '';
    }
    updateImageGenerationConfig(merged);
    normalizeAgentModelSelection(merged);

    shouldPersistNormalizedState = ensureBundledAgentSkills(merged) || shouldPersistNormalizedState;
    merged.skills = getMergedSkills(merged);
    merged.mcpServers = ensureDefaultMcp(merged.mcpServers || []);
    // Strip legacy mobile-remote config (may contain a plaintext password).
    delete merged.remoteControl;
    // Legacy scheduled-automation feature was removed; drop stale config.
    delete merged.automations;
    delete merged.computerUseV3;
    merged.executionKernel = {
      id: 'yan-kernel',
      name: 'Yan Kernel',
      version: app.getVersion(),
      engine: 'opencode',
      engineVersion: OPENCODE_VERSION
    };
    if (shouldPersistNormalizedState) saveConfig(merged);
    return merged;
  }

  function normalizeAgentConfig(agent = {}) {
    const next = { ...(agent || {}) };
    next.workMode = ['normal', 'plan', 'goal', 'evolution'].includes(String(next.workMode || ''))
      ? next.workMode
      : 'normal';
    next.accessMode = ['request', 'delegate', 'full'].includes(String(next.accessMode || ''))
      ? next.accessMode
      : 'request';
    next.replyVerbosity = ['default', 'low', 'medium', 'high'].includes(next.replyVerbosity) ? next.replyVerbosity : 'default';
    next.sandboxMode = ['read-only', 'workspace-write', 'full'].includes(next.sandboxMode) ? next.sandboxMode : 'full';
    next.reasoningSummary = ['auto', 'concise', 'detailed', 'none'].includes(next.reasoningSummary) ? next.reasoningSummary : 'auto';
    const responseTimeout = Number(next.responseTimeoutMinutes);
    next.responseTimeoutMinutes = Number.isFinite(responseTimeout)
      ? Math.max(1, Math.min(1440, Math.round(responseTimeout)))
      : 2;
    // Always use fast writes with one finalization formatting pass.
    next.disableAutoFormatter = true;
    // Role switches are the source of truth. Existing configurations without
    // the new map migrate to all built-in roles enabled.
    const hasRoleMap = next.subagentRoles && typeof next.subagentRoles === 'object';
    next.subagentRoles = normalizeSubagentRoles(hasRoleMap ? next.subagentRoles : {});
    next.subagentModels = normalizeSubagentModels(next.subagentModels);
    next.enableSubagents = true;
    const maxChildren = Number(next.subagentMaxChildren);
    next.subagentMaxChildren = Number.isFinite(maxChildren)
      ? Math.max(1, Math.min(10, Math.floor(maxChildren)))
      : 10;
    return next;
  }

  function normalizePetConfig(pet = {}) {
    const next = pet && typeof pet === 'object' ? { ...pet } : {};
    const selected = String(next.selected || '').trim().toLowerCase();
    return {
      enabled: next.enabled === true,
      selected: PET_IDS.includes(selected) || require('../pet-store').readPet(path.dirname(configPath), selected) ? selected : 'orb',
      scale: next.scale != null && Number.isFinite(Number(next.scale)) ? Math.max(0.5, Math.min(1.5, Math.round(Number(next.scale) * 100) / 100)) : 1
    };
  }

  function normalizeTtsConfig(tts = {}) {
    const next = tts && typeof tts === 'object' ? { ...tts } : {};
    return {
      voice: normalizeVoice(next.voice),
      rate: normalizeRate(next.rate)
    };
  }

  const BUILTIN_WALLPAPER_IDS = new Set(['night-sky', 'rainy-architecture']);

  function normalizeWallpaperConfig(wallpaper = {}) {
    const next = wallpaper && typeof wallpaper === 'object' ? wallpaper : {};
    const id = String(next.id || '').trim();
    const removed = [...new Set((Array.isArray(next.removed) ? next.removed : [])
      .map(value => String(value || '').trim())
      .filter(value => BUILTIN_WALLPAPER_IDS.has(value)))].slice(0, BUILTIN_WALLPAPER_IDS.size);
    const removedIds = new Set(removed);
    const custom = [];
    const seenIds = new Set();
    const sourceCustom = Array.isArray(next.custom) ? next.custom : [];
    for (const entry of sourceCustom) {
      if (!entry || typeof entry !== 'object') continue;
      const entryId = String(entry.id || '').trim().slice(0, 96);
      const entryPath = String(entry.path || '').trim().slice(0, 1024);
      const entryName = String(entry.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
      if (!entryId || !entryPath || !entryName || seenIds.has(entryId)) continue;
      seenIds.add(entryId);
      custom.push({ id: entryId, path: entryPath, name: entryName });
      if (custom.length >= 48) break;
    }
    const validId = !id || id === 'custom' || (BUILTIN_WALLPAPER_IDS.has(id) && !removedIds.has(id)) || seenIds.has(id) ? id : '';
    // Preserve a legacy one-off custom wallpaper while migrating it into the
    // persistent library used by the settings market.
    const legacyPath = String(next.path || '').trim().slice(0, 1024);
    const legacyName = String(next.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
    if (validId === 'custom' && legacyPath && legacyName && !custom.some(entry => entry.path === legacyPath)) {
      const legacyId = 'custom-legacy';
      if (!seenIds.has(legacyId)) custom.unshift({ id: legacyId, path: legacyPath, name: legacyName });
    }
    const selectedCustom = custom.find(entry => entry.id === validId);
    // Wallpaper opacity is locked at 100%; the field stays for config
    // compatibility and always normalizes back to 1.
    const opacity = 1;
    // Wallpaper audio is always disabled, including legacy saved volume.
    const volume = 0;
    return {
      id: selectedCustom ? selectedCustom.id : (validId === 'custom' ? 'custom' : validId),
      path: selectedCustom?.path || (validId === 'custom' ? legacyPath : ''),
      name: selectedCustom?.name || (validId === 'custom' ? legacyName : ''),
      custom,
      removed,
      opacity,
      volume
    };
  }

  function normalizeThemeCompatConfig(value = {}) {
    const next = value && typeof value === 'object' ? value : {};
    const strengthValue = Number(next.materialStrength);
    return {
      autoAdapt: true,
      materialStrength: Number.isFinite(strengthValue)
        ? Math.max(0, Math.min(1, Math.round(strengthValue * 20) / 20))
        : 0.45,
      accentFollow: true
    };
  }

  function normalizeLanguage() {
    return 'zh-CN';
  }

  function normalizeReadingFont(value) {
    return String(value || '').trim().toLowerCase() === 'sans' ? 'sans' : 'serif';
  }

  const normalizeAppearance = require('../appearance').normalize;

  function saveConfig(cfg) {
    ensureDirs();
    // Shallow spread shares the nested secret containers with the live config;
    // clone them so at-rest encryption never leaks cipher text into memory.
    const persisted = cloneConfigForPersist(cfg);
    transformConfigSecrets(persisted, encryptConfigSecret);
    writeAtomic(configPath, persisted);
  }

  const SECRET_CIPHER_PREFIX = 'enc:v1:';

  function encryptConfigSecret(value) {
    const text = String(value ?? '');
    if (!text || text.startsWith(SECRET_CIPHER_PREFIX)) return text;
    try {
      if (!safeStorage.isEncryptionAvailable()) return text;
      return SECRET_CIPHER_PREFIX + safeStorage.encryptString(text).toString('base64');
    } catch {
      // Before the ready event (or on unsupported platforms) secrets stay
      // plaintext, matching the historical behavior.
      return text;
    }
  }

  function decryptConfigSecret(value) {
    const text = String(value ?? '');
    if (!text.startsWith(SECRET_CIPHER_PREFIX)) return text;
    try {
      if (!safeStorage.isEncryptionAvailable()) return text;
      return safeStorage.decryptString(Buffer.from(text.slice(SECRET_CIPHER_PREFIX.length), 'base64'));
    } catch (error) {
      console.warn('[config] stored secret could not be decrypted (system user changed?); re-enter the connection key.', error?.message || error);
      return '';
    }
  }

  // Encrypt-on-save / decrypt-on-load for every credential field in the config.
  // In memory the config is always plaintext; only the file on disk is ciphered.
  function transformConfigSecrets(source, transform) {
    const api = source?.api && typeof source.api === 'object' ? source.api : null;
    if (api) {
      if (typeof api.apiKey === 'string') api.apiKey = transform(api.apiKey);
      if (api.apiKeys && typeof api.apiKeys === 'object') {
        for (const id of Object.keys(api.apiKeys)) {
          if (typeof api.apiKeys[id] === 'string') api.apiKeys[id] = transform(api.apiKeys[id]);
        }
      }
      if (api.providerConfigs && typeof api.providerConfigs === 'object') {
        for (const config of Object.values(api.providerConfigs)) {
          if (config && typeof config === 'object' && typeof config.apiKey === 'string') {
            config.apiKey = transform(config.apiKey);
          }
        }
      }
      if (api.providerSuppliers && typeof api.providerSuppliers === 'object') {
        for (const suppliers of Object.values(api.providerSuppliers)) {
          for (const supplier of Array.isArray(suppliers) ? suppliers : []) {
            if (supplier && typeof supplier === 'object' && typeof supplier.apiKey === 'string') {
              supplier.apiKey = transform(supplier.apiKey);
            }
          }
        }
      }
      for (const connection of Array.isArray(api.connections) ? api.connections : []) {
        if (connection && typeof connection === 'object' && typeof connection.apiKey === 'string') {
          connection.apiKey = transform(connection.apiKey);
        }
      }
    }
    if (source?.customModel && typeof source.customModel === 'object' && typeof source.customModel.apiKey === 'string') {
      source.customModel.apiKey = transform(source.customModel.apiKey);
    }
    for (const provider of Array.isArray(source?.customProviders) ? source.customProviders : []) {
      if (provider && typeof provider === 'object' && typeof provider.apiKey === 'string') {
        provider.apiKey = transform(provider.apiKey);
      }
    }
    return source;
  }

  // A blanked secret (as returned by publicConfig) means "unchanged". deepMerge
  // overwrites scalars unconditionally, so blank fields must never reach it —
  // otherwise a config round-trip would erase the stored credentials.
  function stripBlankConfigSecrets(source) {
    const api = source?.api && typeof source.api === 'object' ? source.api : null;
    if (api) {
      if (api.apiKey === '') delete api.apiKey;
      if (api.apiKeys && typeof api.apiKeys === 'object') {
        for (const id of Object.keys(api.apiKeys)) {
          if (api.apiKeys[id] === '') delete api.apiKeys[id];
        }
      }
      if (api.providerConfigs && typeof api.providerConfigs === 'object') {
        for (const config of Object.values(api.providerConfigs)) {
          if (config && typeof config === 'object' && config.apiKey === '') delete config.apiKey;
        }
      }
      if (api.providerSuppliers && typeof api.providerSuppliers === 'object') {
        for (const suppliers of Object.values(api.providerSuppliers)) {
          for (const supplier of Array.isArray(suppliers) ? suppliers : []) {
            if (supplier && typeof supplier === 'object' && supplier.apiKey === '') delete supplier.apiKey;
          }
        }
      }
      for (const connection of Array.isArray(api.connections) ? api.connections : []) {
        if (connection && typeof connection === 'object' && connection.apiKey === '') delete connection.apiKey;
      }
    }
    if (source?.customModel && typeof source.customModel === 'object' && source.customModel.apiKey === '') {
      delete source.customModel.apiKey;
    }
    for (const provider of Array.isArray(source?.customProviders) ? source.customProviders : []) {
      if (provider && typeof provider === 'object' && provider.apiKey === '') delete provider.apiKey;
    }
    return source;
  }

  function cloneConfigForPersist(cfg) {
    const persisted = { ...cfg };
    delete persisted.skills;
    persisted.customSkills = skillConfigMetadataList(cfg.customSkills);
    if (persisted.api && typeof persisted.api === 'object') {
      const api = { ...persisted.api };
      if (api.apiKeys && typeof api.apiKeys === 'object') api.apiKeys = { ...api.apiKeys };
      if (api.providerConfigs && typeof api.providerConfigs === 'object') {
        api.providerConfigs = Object.fromEntries(Object.entries(api.providerConfigs)
          .map(([id, value]) => [id, value && typeof value === 'object' ? { ...value } : value]));
      }
      if (api.providerSuppliers && typeof api.providerSuppliers === 'object') {
        api.providerSuppliers = Object.fromEntries(Object.entries(api.providerSuppliers)
          .map(([id, list]) => [id, Array.isArray(list)
            ? list.map(item => item && typeof item === 'object' ? { ...item } : item)
            : list]));
      }
      if (Array.isArray(api.connections)) {
        api.connections = api.connections.map(item => item && typeof item === 'object' ? { ...item } : item);
      }
      persisted.api = api;
    }
    if (persisted.customModel && typeof persisted.customModel === 'object') {
      persisted.customModel = { ...persisted.customModel };
    }
    if (Array.isArray(persisted.customProviders)) {
      persisted.customProviders = persisted.customProviders.map(item => item && typeof item === 'object' ? { ...item } : item);
    }
    return persisted;
  }

  function skillConfigMetadata(skill = {}) {
    const { prompt: _prompt, runtimeDirectory: _runtimeDirectory, storeDirectory: _storeDirectory, ...metadata } = skill;
    return metadata;
  }

  function skillConfigMetadataList(skills) {
    return (Array.isArray(skills) ? skills : []).map(skillConfigMetadata);
  }

  function publicConfig(cfg) {
    // The renderer works against apiKeyConfigured flags plus explicit
    // provider:get-secret calls; raw credentials never cross the IPC boundary.
    const safe = cloneConfigForPersist(cfg);
    transformConfigSecrets(safe, () => '');
    return {
      ...safe,
      customSkills: skillConfigMetadataList(cfg?.customSkills),
      skills: skillConfigMetadataList(cfg?.skills)
    };
  }

  return {
    loadConfig,
    normalizeAgentConfig,
    normalizePetConfig,
    normalizeTtsConfig,
    BUILTIN_WALLPAPER_IDS,
    normalizeWallpaperConfig,
    normalizeThemeCompatConfig,
    normalizeLanguage,
    normalizeReadingFont,
    normalizeAppearance,
    saveConfig,
    SECRET_CIPHER_PREFIX,
    encryptConfigSecret,
    decryptConfigSecret,
    transformConfigSecrets,
    stripBlankConfigSecrets,
    cloneConfigForPersist,
    skillConfigMetadata,
    skillConfigMetadataList,
    publicConfig,
  };
}

module.exports = { createConfigStore };
