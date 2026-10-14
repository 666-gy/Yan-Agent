'use strict';

const { applyConnectionModelFlags, connectionModelFlagsFor, normalizeCustomModelIds } = require('../connection-presets');

// Provider configuration (plan T4.3): default provider/supplier/connection
// shapes, legacy connection migration, supplier catalogs and role rebinding.
// Moved verbatim from main.js; the provider registry and the shared catalog
// helpers stay owned by main.js and arrive through explicit dependencies.

function createProviderConfig(deps) {
  const {
    MODEL_PROVIDERS,
    STATIC_PROVIDER_SUPPLEMENTAL_MODELS,
    DEFAULT_MODEL_ROLES,
    appRoot,
    normalizeRemoteModels,
    buildSelectableModelCatalog,
    decorateModels,
    getModelType,
    resolveConnectionPreset,
    resolveConnectionApiFormat,
    updateImageGenerationConfig
  } = deps;

  function buildDefaultApiKeys() {
    const keys = {};
    for (const id of Object.keys(MODEL_PROVIDERS)) {
      keys[id] = '';
    }
    return keys;
  }

  function buildDefaultProviderConfigs() {
    const configs = {};
    for (const [id, provider] of Object.entries(MODEL_PROVIDERS)) {
      configs[id] = {
        baseUrl: provider.baseUrl,
        apiKey: '',
        imageGenerationUrl: '',
        imageEditUrl: '',
        workspaceId: ''
      };
    }
    return configs;
  }

  function normalizeProviderSupplier(raw, provider, fallbackId = 'official', fallbackName = '官方') {
    const value = raw && typeof raw === 'object' ? raw : {};
    const id = String(value.id || fallbackId).trim() || fallbackId;
    const name = String(value.name || fallbackName).trim() || fallbackName;
    return {
      id,
      name,
      kind: String(value.kind || (id === 'official' ? 'official' : 'custom')).trim() || 'custom',
      baseUrl: String(value.baseUrl || provider?.baseUrl || '').trim().replace(/\/$/, ''),
      apiKey: String(value.apiKey || '').trim(),
      imageGenerationUrl: String(value.imageGenerationUrl || '').trim(),
      imageEditUrl: String(value.imageEditUrl || '').trim(),
      videoGenerationUrl: String(value.videoGenerationUrl || '').trim(),
      workspaceId: String(value.workspaceId || '').trim(),
      models: normalizeRemoteModels(value.models || [])
    };
  }

  function buildDefaultProviderSuppliers() {
    const suppliers = {};
    for (const [id, provider] of Object.entries(MODEL_PROVIDERS)) {
      suppliers[id] = [normalizeProviderSupplier({
        id: 'official',
        name: '官方',
        kind: 'official',
        baseUrl: provider.baseUrl,
        models: provider.dynamicModels ? [] : provider.models
      }, provider)];
    }
    return suppliers;
  }

  function normalizeProviderConfig(raw, provider) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      baseUrl: String(value.baseUrl || provider.baseUrl || '').trim().replace(/\/$/, ''),
      apiKey: String(value.apiKey || '').trim(),
      imageGenerationUrl: String(value.imageGenerationUrl || '').trim(),
      imageEditUrl: String(value.imageEditUrl || '').trim(),
      videoGenerationUrl: String(value.videoGenerationUrl || '').trim(),
      workspaceId: String(value.workspaceId || '').trim()
    };
  }

  function normalizeCustomModelEntry(raw = {}, legacy = {}) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const legacyValue = legacy && typeof legacy === 'object' ? legacy : {};
    const rawModels = Array.isArray(value.models) && value.models.length
      ? value.models
      : (Array.isArray(legacyValue.models) ? legacyValue.models : []);
    const firstModel = rawModels.find(model => model && typeof model === 'object' && model.id)
      || rawModels.find(model => typeof model === 'string');
    const modelId = String(value.modelId || firstModel?.id || firstModel || legacyValue.modelId || '').trim();
    const modelName = String(value.modelName || firstModel?.name || modelId || '自定义模型').trim() || '自定义模型';
    const model = modelId
      ? { id: modelId, name: modelName, modelType: 'text', source: 'custom' }
      : null;
    return {
      id: 'custom-model',
      name: '自定义模型',
      modelName,
      modelId,
      baseUrl: String(value.baseUrl || legacyValue.baseUrl || '').trim().replace(/\/$/u, ''),
      apiKey: String(value.apiKey || legacyValue.apiKey || '').trim(),
      apiFormat: String(value.apiFormat || legacyValue.apiFormat || 'openai').trim().toLowerCase() === 'anthropic'
        ? 'anthropic'
        : 'openai',
      models: model ? [model] : []
    };
  }

  // ---------------------------------------------------------------------------
  // User-defined connections. The UI no longer exposes vendor cards: every API
  // endpoint the user talks to is a "connection" — a flat list of named
  // endpoints with their own key and POST URLs. Internally each connection
  // points at a supplier entry; connections created from scratch get a dynamic
  // `conn-*` provider registered below, while migrated ones keep pointing at
  // the built-in provider they came from so every existing role binding,
  // catalog cache, and media adapter keeps working unchanged.
  // ---------------------------------------------------------------------------
  function newConnectionId() {
    return `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  function findConnection(cfg, connectionId) {
    const id = String(connectionId || '').trim();
    if (!id) return null;
    return (cfg?.api?.connections || []).find(item => item.id === id) || null;
  }

  // The adapter shape a provider talks: built-in providers use their own id;
  // connection providers resolve through their stored/auto preset. The selected
  // model participates because one relay can front several vendors — the same
  // connection must answer DSML for a deepseek model and GLMM for a glm model.
  function providerAdapterPreset(cfg, providerId, modelId = '') {
    const id = String(providerId || '');
    const provider = MODEL_PROVIDERS[id];
    if (provider?.connection) {
      const connection = (cfg?.api?.connections || []).find(item => item.providerId === id);
      return resolveConnectionPreset(connection, provider.name, provider.baseUrl, modelId);
    }
    return id;
  }

  // Registry-level preset (baked at registration) for media adapters and static
  // media-model merges that do not carry a cfg handle.
  function providerMediaPresetId(provider) {
    return provider?.connection ? (provider.preset || 'openai') : (provider?.id || '');
  }

  function providerCapabilityPresetId(provider) {
    return provider?.connection ? (provider.preset || 'openai') : (provider?.id || '');
  }

  function registerConnectionProvider(cfg, connection) {
    const providerId = String(connection?.providerId || '');
    if (!providerId.startsWith('conn-')) return;
    const supplier = (cfg.api?.providerSuppliers?.[providerId] || [])[0] || {};
    const name = String(supplier.name || connection.name || '新连接').trim() || '新连接';
    const preset = resolveConnectionPreset(connection, name, supplier.baseUrl);
    // Custom model ids are additive: they ride on top of whatever the API
    // reports, so they never hide the detected catalog.
    const customModels = normalizeCustomModelIds(connection.customModels);
    MODEL_PROVIDERS[providerId] = {
      id: providerId,
      name,
      baseUrl: String(supplier.baseUrl || '').trim(),
      apiKeyPlaceholder: 'sk-...',
      dynamicModels: true,
      models: customModels.map(id => ({ id, name: id, modelType: 'text', source: 'custom' })),
      connection: true,
      custom: false,
      preset,
      apiFormat: resolveConnectionApiFormat(connection, name, supplier.baseUrl)
    };
  }

  function syncConnectionProviders(cfg) {
    for (const key of Object.keys(MODEL_PROVIDERS)) {
      if (key.startsWith('custom-') || key.startsWith('conn-')) delete MODEL_PROVIDERS[key];
    }
    for (const connection of cfg?.api?.connections || []) {
      registerConnectionProvider(cfg, connection);
    }
  }

  // One-time migration: turn every configured supplier (and the legacy
  // custom-model card) into a flat connection entry. Idempotent and additive —
  // the underlying supplier data is never moved or rewritten.
  function migrateLegacyConnections(cfg) {
    if (!cfg.api || typeof cfg.api !== 'object') cfg.api = {};
    if (cfg.api.connectionsMigrated === true) return;
    const connections = Array.isArray(cfg.api.connections) ? cfg.api.connections : [];
    for (const [providerId, suppliers] of Object.entries(cfg.api.providerSuppliers || {})) {
      if (providerId === 'custom-model' || providerId.startsWith('conn-')) continue;
      const activeId = String(cfg.api.providerActiveSupplierIds?.[providerId] || 'official');
      for (const supplier of Array.isArray(suppliers) ? suppliers : []) {
        // Older builds kept the active supplier's key only in the legacy
        // providerConfigs/apiKeys mirrors; honor those during migration.
        const mirroredKey = supplier.id === activeId
          ? (cfg.api.providerConfigs?.[providerId]?.apiKey || cfg.api.apiKeys?.[providerId])
          : '';
        if (!supplier?.apiKey && !mirroredKey) continue;
        connections.push({
          id: newConnectionId(),
          providerId,
          supplierId: String(supplier?.id || 'official'),
          preset: providerId,
          manualModelId: '',
          createdAt: Date.now()
        });
      }
    }
    const custom = cfg.customModel && (
      cfg.customModel.modelId || cfg.customModel.baseUrl || cfg.customModel.apiKey || cfg.customModel.models?.length
    )
      ? normalizeCustomModelEntry(cfg.customModel, {})
      : null;
    if (custom) {
      const providerId = newConnectionId();
      if (!cfg.api.providerSuppliers || typeof cfg.api.providerSuppliers !== 'object') cfg.api.providerSuppliers = {};
      cfg.api.providerSuppliers[providerId] = [{
        id: 'official',
        name: custom.modelName || custom.modelId || '自定义连接',
        kind: 'official',
        baseUrl: custom.baseUrl || '',
        apiKey: custom.apiKey || '',
        imageGenerationUrl: '',
        imageEditUrl: '',
        videoGenerationUrl: '',
        workspaceId: '',
        models: custom.models || []
      }];
      if (!cfg.api.providerActiveSupplierIds || typeof cfg.api.providerActiveSupplierIds !== 'object') {
        cfg.api.providerActiveSupplierIds = {};
      }
      cfg.api.providerActiveSupplierIds[providerId] = 'official';
      if (!cfg.providerModels || typeof cfg.providerModels !== 'object') cfg.providerModels = {};
      cfg.providerModels[providerId] = custom.models || [];
      connections.push({
        id: providerId,
        providerId,
        supplierId: 'official',
        preset: custom.apiFormat === 'anthropic' ? 'anthropic' : 'auto',
        manualModelId: custom.modelId || '',
        createdAt: Date.now()
      });
      if (cfg.agentModel?.providerId === 'custom-model') {
        cfg.agentModel = {
          ...cfg.agentModel,
          providerId,
          modelId: custom.modelId || cfg.agentModel.modelId,
          name: custom.modelName || custom.modelId || cfg.agentModel.name
        };
      }
      for (const role of ['image', 'video']) {
        if (cfg.media?.[`${role}Provider`] === 'custom-model') {
          cfg.media[`${role}Provider`] = providerId;
        }
      }
      if (cfg.api.provider === 'custom-model') cfg.api.provider = providerId;
      delete cfg.api.providerSuppliers['custom-model'];
      delete cfg.api.providerActiveSupplierIds?.['custom-model'];
      delete cfg.api.providerConfigs?.['custom-model'];
      delete cfg.api.apiKeys?.['custom-model'];
      delete cfg.providerModels?.['custom-model'];
      delete MODEL_PROVIDERS['custom-model'];
      cfg.customModel = null;
      cfg.customProviders = [];
    }
    cfg.api.connections = connections;
    cfg.api.connectionsMigrated = true;
  }

  function ensureProviderConfigs(cfg) {
    if (!cfg.api || typeof cfg.api !== 'object') cfg.api = {};
    if (!cfg.api.providerSuppliers || typeof cfg.api.providerSuppliers !== 'object') {
      cfg.api.providerSuppliers = buildDefaultProviderSuppliers();
    }
    if (!cfg.api.providerActiveSupplierIds || typeof cfg.api.providerActiveSupplierIds !== 'object') {
      cfg.api.providerActiveSupplierIds = {};
    }
    if (!cfg.api.providerConfigs || typeof cfg.api.providerConfigs !== 'object') {
      cfg.api.providerConfigs = buildDefaultProviderConfigs();
    }
    if (!cfg.api.apiKeys) cfg.api.apiKeys = buildDefaultApiKeys();
    for (const [id, provider] of Object.entries(MODEL_PROVIDERS)) {
      const legacy = normalizeProviderConfig(cfg.api.providerConfigs[id], provider);
      let suppliers = Array.isArray(cfg.api.providerSuppliers[id])
        ? cfg.api.providerSuppliers[id].map(item => normalizeProviderSupplier(item, provider))
        : [];
      if (!suppliers.length) {
        suppliers = [normalizeProviderSupplier({
          id: 'official',
          name: provider.custom ? '自定义模型' : '官方',
          kind: 'official',
          ...legacy,
          models: cfg.providerModels?.[id] || (provider.dynamicModels ? [] : provider.models)
        }, provider)];
      }
      let activeId = String(cfg.api.providerActiveSupplierIds[id] || '').trim();
      if (!activeId || !suppliers.some(item => item.id === activeId)) {
        activeId = suppliers.find(item => item.id === 'official')?.id || suppliers[0].id;
      }
      const active = suppliers.find(item => item.id === activeId) || suppliers[0];
      const legacyKey = cfg.api.apiKeys[id];
      if (!active.apiKey && legacy.apiKey) active.apiKey = legacy.apiKey;
      if (!active.apiKey && legacyKey) active.apiKey = String(legacyKey).trim();
      if (!active.baseUrl && legacy.baseUrl) active.baseUrl = legacy.baseUrl;
      cfg.api.providerSuppliers[id] = suppliers;
      cfg.api.providerActiveSupplierIds[id] = activeId;
      const current = normalizeProviderConfig(active, provider);
      cfg.api.providerConfigs[id] = current;
      cfg.api.apiKeys[id] = current.apiKey;
      if (!cfg.providerModels || typeof cfg.providerModels !== 'object') cfg.providerModels = {};
      cfg.providerModels[id] = active.models.length
        ? active.models
        : (cfg.providerModels[id] || (provider.dynamicModels ? [] : provider.models));
      active.models = normalizeRemoteModels(cfg.providerModels[id] || []);
    }
    const providerIds = new Set(Object.keys(MODEL_PROVIDERS));
    for (const key of Object.keys(cfg.api.providerConfigs)) {
      if (!providerIds.has(key)) delete cfg.api.providerConfigs[key];
    }
    for (const key of Object.keys(cfg.api.apiKeys)) {
      if (!providerIds.has(key)) delete cfg.api.apiKeys[key];
    }
    if (cfg.providerModels && typeof cfg.providerModels === 'object') {
      for (const key of Object.keys(cfg.providerModels)) {
        if (!providerIds.has(key)) delete cfg.providerModels[key];
      }
    }
    return cfg.api.providerConfigs;
  }

  function getProviderConnection(cfg, providerId) {
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider) return {
      baseUrl: '',
      apiKey: '',
      imageGenerationUrl: '',
      imageEditUrl: '',
      videoGenerationUrl: '',
      workspaceId: ''
    };
    ensureProviderConfigs(cfg);
    return normalizeProviderConfig(cfg.api.providerConfigs[providerId], provider);
  }

  /**
   * Resolve a supplier without changing the provider-wide UI cursor.  The
   * provider-wide active supplier is retained for the settings dialog and for
   * backwards compatibility, while runtime roles carry their own supplierId.
   */
  function getProviderSupplier(cfg, providerId, supplierId = '') {
    const suppliers = getProviderSuppliers(cfg, providerId);
    const requested = String(supplierId || '').trim();
    const activeId = requested || String(cfg.api.providerActiveSupplierIds?.[providerId] || '').trim();
    return suppliers.find(item => item.id === activeId)
      || suppliers.find(item => item.id === 'official')
      || suppliers[0]
      || null;
  }

  function getProviderConnectionForSupplier(cfg, providerId, supplierId = '') {
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider) return normalizeProviderConfig({}, { baseUrl: '' });
    const supplier = getProviderSupplier(cfg, providerId, supplierId);
    return normalizeProviderConfig(supplier || cfg.api?.providerConfigs?.[providerId], provider);
  }

  function getProviderSuppliers(cfg, providerId) {
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider) return [];
    ensureProviderConfigs(cfg);
    const raw = Array.isArray(cfg.api.providerSuppliers?.[providerId])
      ? cfg.api.providerSuppliers[providerId]
      : [];
    cfg.api.providerSuppliers[providerId] = raw.map(item => normalizeProviderSupplier(item, provider));
    return cfg.api.providerSuppliers[providerId];
  }

  // After the connection migration, the flat connection list is the source of
  // truth for which supplier is enabled. Credentials and cached catalogs can be
  // intentionally retained for a later re-enable, but they must not contribute
  // models while their connection card is absent.
  function isSupplierListedAsConnection(cfg, providerId, supplierId) {
    if (cfg?.api?.connectionsMigrated !== true) return true;
    const id = String(providerId || '').trim();
    const supplier = String(supplierId || '').trim();
    return Array.isArray(cfg?.api?.connections)
      && cfg.api.connections.some(connection => (
        String(connection?.providerId || '').trim() === id
        && String(connection?.supplierId || '').trim() === supplier
      ));
  }

  function isConfiguredSupplier(cfg, providerId, supplier) {
    return !!supplier
      && !!String(supplier.apiKey || '').trim()
      && isSupplierListedAsConnection(cfg, providerId, supplier.id);
  }

  function pruneUnlistedSupplierState(cfg) {
    if (cfg?.api?.connectionsMigrated !== true) return false;
    const connections = Array.isArray(cfg.api.connections) ? cfg.api.connections : [];
    let changed = false;
    for (const providerId of Object.keys(MODEL_PROVIDERS)) {
      const provider = MODEL_PROVIDERS[providerId];
      const suppliers = Array.isArray(cfg.api.providerSuppliers?.[providerId])
        ? cfg.api.providerSuppliers[providerId]
        : [];
      const listedIds = new Set(connections
        .filter(connection => String(connection?.providerId || '').trim() === providerId)
        .map(connection => String(connection?.supplierId || '').trim())
        .filter(Boolean));
      for (const supplier of suppliers) {
        if (listedIds.has(String(supplier.id || '').trim())) continue;
        const clearCatalog = !!provider?.dynamicModels || !!String(supplier.apiKey || '').trim();
        if (supplier.apiKey || (clearCatalog && supplier.models?.length) || supplier.imageGenerationUrl
          || supplier.imageEditUrl || supplier.videoGenerationUrl || supplier.workspaceId) {
          supplier.apiKey = '';
          if (clearCatalog) supplier.models = [];
          supplier.imageGenerationUrl = '';
          supplier.imageEditUrl = '';
          supplier.videoGenerationUrl = '';
          supplier.workspaceId = '';
          changed = true;
        }
      }
      const hasEnabledSupplier = suppliers.some(supplier => (
        listedIds.has(String(supplier.id || '').trim())
        && !!String(supplier.apiKey || '').trim()
      ));
      if (!hasEnabledSupplier) {
        if (provider?.dynamicModels && Array.isArray(cfg.providerModels?.[providerId]) && cfg.providerModels[providerId].length) {
          cfg.providerModels[providerId] = [];
          changed = true;
        }
        if (cfg.api.apiKeys?.[providerId]) {
          cfg.api.apiKeys[providerId] = '';
          changed = true;
        }
        if (cfg.api.providerConfigs?.[providerId]?.apiKey) {
          cfg.api.providerConfigs[providerId].apiKey = '';
          changed = true;
        }
      }
    }
    return changed;
  }

  function getConfiguredSupplierEntries(cfg) {
    const entries = [];
    for (const [providerId, suppliers] of Object.entries(cfg?.api?.providerSuppliers || {})) {
      if (!MODEL_PROVIDERS[providerId] || !Array.isArray(suppliers)) continue;
      for (const supplier of suppliers) {
        if (!isConfiguredSupplier(cfg, providerId, supplier)) continue;
        entries.push({ providerId, supplierId: String(supplier.id || ''), supplier });
      }
    }
    return entries.filter(entry => entry.supplierId);
  }

  // ---------------------------------------------------------------------------
  // Simultaneously enabled connections. `cfg.api.enabledConnections` holds the
  // ids of every connection the user switched on; several providers can stay
  // enabled at once. The legacy single `cfg.api.provider` cursor is left as the
  // "current main model" pointer only.
  // ---------------------------------------------------------------------------
  function ensureEnabledConnections(cfg, { seed = false } = {}) {
    if (!cfg.api || typeof cfg.api !== 'object') cfg.api = {};
    if (!Array.isArray(cfg.api.enabledConnections)) cfg.api.enabledConnections = [];
    const connections = Array.isArray(cfg.api.connections) ? cfg.api.connections : [];
    const valid = new Set(connections.map(connection => String(connection?.id || '')).filter(Boolean));
    const before = cfg.api.enabledConnections.length;
    cfg.api.enabledConnections = [...new Set(cfg.api.enabledConnections
      .map(id => String(id || ''))
      .filter(id => valid.has(id)))];
    let changed = cfg.api.enabledConnections.length !== before;
    if (seed && !cfg.api.enabledConnections.length && connections.length) {
      const activeProviderId = String(cfg.agentModel?.providerId || cfg.api.provider || '');
      const activeSupplierId = String(cfg.agentModel?.supplierId
        || cfg.api.providerActiveSupplierIds?.[activeProviderId] || '');
      const active = connections.find(connection => (
        String(connection?.providerId || '') === activeProviderId
        && String(connection?.supplierId || '') === activeSupplierId
      )) || connections.find(connection => String(connection?.providerId || '') === activeProviderId)
        || connections[0];
      if (active) {
        cfg.api.enabledConnections = [active.id];
        changed = true;
      }
    }
    return changed;
  }

  function isConnectionEnabled(cfg, connection) {
    if (!connection) return false;
    const ids = Array.isArray(cfg?.api?.enabledConnections) ? cfg.api.enabledConnections : [];
    if (!ids.includes(connection.id)) return false;
    const supplier = getProviderSupplier(cfg, connection.providerId, connection.supplierId);
    return !!supplier
      && !!String(supplier.apiKey || '').trim()
      && isSupplierListedAsConnection(cfg, connection.providerId, supplier.id);
  }

  function setConnectionEnabled(cfg, connectionId, enabled) {
    ensureEnabledConnections(cfg);
    const connection = findConnection(cfg, connectionId);
    if (!connection) return { error: '连接不存在' };
    const supplier = getProviderSupplier(cfg, connection.providerId, connection.supplierId);
    if (enabled && (!supplier || !String(supplier.apiKey || '').trim())) {
      return { error: '请先配置 API Key，再启用此连接' };
    }
    const ids = new Set(cfg.api.enabledConnections);
    if (enabled) ids.add(connection.id); else ids.delete(connection.id);
    cfg.api.enabledConnections = [...ids];
    return { ok: true };
  }

  function getEnabledConnections(cfg) {
    ensureEnabledConnections(cfg);
    return (Array.isArray(cfg.api.connections) ? cfg.api.connections : [])
      .filter(connection => isConnectionEnabled(cfg, connection));
  }

  function getActiveProviderSupplier(cfg, providerId) {
    const suppliers = getProviderSuppliers(cfg, providerId);
    const activeId = String(cfg.api.providerActiveSupplierIds?.[providerId] || '').trim();
    return suppliers.find(item => item.id === activeId) || suppliers[0] || null;
  }

  function syncActiveProviderSupplier(cfg, providerId, supplier) {
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider || !supplier) return;
    const normalized = normalizeProviderSupplier(supplier, provider);
    cfg.api.providerActiveSupplierIds[providerId] = normalized.id;
    cfg.api.providerConfigs[providerId] = normalizeProviderConfig(normalized, provider);
    cfg.api.apiKeys[providerId] = normalized.apiKey;
    if (!cfg.providerModels) cfg.providerModels = {};
    cfg.providerModels[providerId] = normalized.models || [];
  }

  function rebindRolesAfterSupplierRemoval(cfg, providerId, supplierId) {
    const removed = String(supplierId || '').trim();
    if (!removed) return;
    const providerOrder = [providerId, ...Object.keys(MODEL_PROVIDERS).filter(id => id !== providerId)];
    const pick = (role, currentModelId) => {
      let first = null;
      for (const candidateProviderId of providerOrder) {
        for (const supplier of getProviderSuppliers(cfg, candidateProviderId)) {
          if (!supplier.apiKey || (candidateProviderId === providerId && supplier.id === removed)) continue;
          const models = getProviderSupplierCatalog(candidateProviderId, supplier);
          const exact = models.find(model => model.id === currentModelId && getModelType(candidateProviderId, model) === role);
          if (exact) return { providerId: candidateProviderId, supplier, model: exact };
          const model = models.find(item => getModelType(candidateProviderId, item) === role);
          if (!first && model) first = { providerId: candidateProviderId, supplier, model };
        }
      }
      return first;
    };

    if (cfg.agentModel?.providerId === providerId && cfg.agentModel?.supplierId === removed) {
      const replacement = pick('text', cfg.agentModel.modelId);
      if (replacement) {
        cfg.agentModel.providerId = replacement.providerId;
        cfg.agentModel.supplierId = replacement.supplier.id;
        cfg.agentModel.modelId = replacement.model.id;
        cfg.agentModel.name = replacement.model.name || replacement.model.id;
        cfg.agentModel.capabilities = replacement.model.capabilities || {};
        const connection = getProviderConnectionForSupplier(cfg, replacement.providerId, replacement.supplier.id);
        cfg.api.provider = replacement.providerId;
        cfg.api.baseUrl = connection.baseUrl;
        cfg.api.apiKey = connection.apiKey;
        cfg.api.model = replacement.model.id;
        cfg.models = getProviderModels(cfg, replacement.providerId, replacement.supplier.id);
      } else {
        cfg.agentModel.supplierId = '';
        cfg.agentModel.modelId = '';
      }
    }

    for (const role of ['image', 'video']) {
      if (cfg.media?.[`${role}Provider`] !== providerId || cfg.media?.[`${role}SupplierId`] !== removed) continue;
      const replacement = pick(role, cfg.media[`${role}Model`]);
      if (replacement) {
        cfg.media[`${role}Provider`] = replacement.providerId;
        cfg.media[`${role}SupplierId`] = replacement.supplier.id;
        cfg.media[`${role}Model`] = replacement.model.id;
        cfg.media[`${role}Name`] = replacement.model.name || replacement.model.id;
      } else {
        cfg.media[`${role}Provider`] = '';
        cfg.media[`${role}Model`] = '';
        cfg.media[`${role}SupplierId`] = '';
        cfg.media[`${role}Name`] = '';
      }
    }
  }

  function mergeProviderModelCatalog(...groups) {
    const models = new Map();
    for (const group of groups) {
      for (const model of Array.isArray(group) ? group : []) {
        const id = String(model?.id || '').trim();
        if (!id) continue;
        models.set(id, { ...(models.get(id) || {}), ...model, id });
      }
    }
    return [...models.values()];
  }

  function getProviderModels(cfg, providerId, supplierId = '') {
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider) return [];
    const mediaPresetId = providerMediaPresetId(provider);
    const activeSupplier = getProviderSupplier(cfg, providerId, supplierId);
    const detected = provider.dynamicModels
      ? normalizeRemoteModels(activeSupplier?.models || cfg?.providerModels?.[providerId] || [])
      : (activeSupplier?.models || []);
    // Connection providers keep custom models in provider.models; merge them on
    // top of the detected catalog so both stay selectable.
    const apiModels = mergeProviderModelCatalog(provider.models, detected);
    const models = buildSelectableModelCatalog(
      apiModels,
      STATIC_PROVIDER_SUPPLEMENTAL_MODELS[mediaPresetId] || []
    );
    const decorated = decorateModels(providerCapabilityPresetId(provider), models);
    // Connection models carry the user's per-model marks (type, vision, context).
    return applyConnectionModelFlags(connectionModelFlagsFor(cfg, providerId), decorated, providerCapabilityPresetId(provider));
  }

  function getRoleSupplierId(cfg, role, providerId) {
    const id = String(providerId || '').trim();
    if (!id) return '';
    if (role === 'text') {
      if (cfg.agentModel?.providerId === id && cfg.agentModel?.supplierId) {
        return String(cfg.agentModel.supplierId).trim();
      }
    } else if (role === 'image' || role === 'video') {
      if (cfg.media?.[`${role}Provider`] === id && cfg.media?.[`${role}SupplierId`]) {
        return String(cfg.media[`${role}SupplierId`]).trim();
      }
    }
    return String(cfg.api?.providerActiveSupplierIds?.[id] || '').trim();
  }

  function getProviderSupplierApiCatalog(providerId, supplier) {
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider || !supplier) return [];
    const models = provider.dynamicModels
      ? mergeProviderModelCatalog(provider.models, normalizeRemoteModels(supplier.models || []))
      : mergeProviderModelCatalog(
          provider.models,
          supplier.models || []
        );
    return decorateModels(providerCapabilityPresetId(provider), models);
  }

  function getProviderSupplierCatalog(providerId, supplier) {
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider || !supplier) return [];
    const models = buildSelectableModelCatalog(
      getProviderSupplierApiCatalog(providerId, supplier),
      STATIC_PROVIDER_SUPPLEMENTAL_MODELS[providerMediaPresetId(provider)] || []
    );
    return decorateModels(providerCapabilityPresetId(provider), models);
  }

  function getChildReadableAppRoot() {
    return appRoot.endsWith('app.asar') ? `${appRoot}.unpacked` : appRoot;
  }

  function getConfiguredMediaModels(cfg) {
    updateImageGenerationConfig(cfg);
    const media = cfg.media || {};
    return ['image', 'video'].flatMap(role => {
      const providerId = String(media[`${role}Provider`] || '');
      const modelId = String(media[`${role}Model`] || '');
      const supplierId = String(media[`${role}SupplierId`] || getRoleSupplierId(cfg, role, providerId) || '');
      if (!providerId || !modelId) return [];
      const model = getProviderModels(cfg, providerId, supplierId).find(item => item.id === modelId);
      return model ? [{
        role,
        providerId,
        supplierId,
        providerName: MODEL_PROVIDERS[providerId]?.name || providerId,
        modelId,
        modelName: model.name || modelId
      }] : [];
    });
  }

  return {
    buildDefaultApiKeys,
    buildDefaultProviderConfigs,
    normalizeProviderSupplier,
    buildDefaultProviderSuppliers,
    normalizeProviderConfig,
    normalizeCustomModelEntry,
    newConnectionId,
    findConnection,
    providerAdapterPreset,
    providerMediaPresetId,
    providerCapabilityPresetId,
    registerConnectionProvider,
    syncConnectionProviders,
    migrateLegacyConnections,
    ensureProviderConfigs,
    getProviderConnection,
    getProviderSupplier,
    getProviderConnectionForSupplier,
    getProviderSuppliers,
    isSupplierListedAsConnection,
    isConfiguredSupplier,
    pruneUnlistedSupplierState,
    getConfiguredSupplierEntries,
    ensureEnabledConnections,
    isConnectionEnabled,
    setConnectionEnabled,
    getEnabledConnections,
    getActiveProviderSupplier,
    syncActiveProviderSupplier,
    rebindRolesAfterSupplierRemoval,
    mergeProviderModelCatalog,
    getProviderModels,
    getRoleSupplierId,
    getProviderSupplierApiCatalog,
    getProviderSupplierCatalog,
    getChildReadableAppRoot,
    getConfiguredMediaModels,
  };
}

module.exports = { createProviderConfig };
