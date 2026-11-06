'use strict';

// User-defined API connections: the flat configuration surface shared by the
// settings IPC, the natural-language provider tool and its local bridge.
//
// Extracted from provider-ipc.js to keep that legacy module inside its line
// budget. Behaviour is unchanged: the same save/test/delete path the settings
// page uses is the one the yan_provider MCP reaches.

const crypto = require('crypto');
const net = require('net');
const { fetchRemoteModelCatalog, normalizeRemoteModels } = require('../model-catalog');
const { getModelType } = require('../model-roles');
const { summarizeModelCatalog } = require('../provider-model-catalog');
const {
  CONNECTION_PRESETS,
  inferConnectionPreset,
  normalizeApiFormat,
  normalizeCustomModelIds,
  normalizeModelFlags,
  applyConnectionModelFlags,
  resolveConnectionApiFormat,
  resolveConnectionPreset
} = require('../connection-presets');
const {
  classifyModelRole,
  normalizeModelSpecs,
  buildConnectionModelFlags,
  pinModelRole,
  maskSecret
} = require('../provider-setup');

function createProviderConnections(deps) {
  const {
    MODEL_PROVIDERS,
    providerConfig,
    configStore,
    modelState,
    applyProviderConfiguration,
    STATIC_PROVIDER_SUPPLEMENTAL_MODELS
  } = deps;

  function connectionSummary(cfg, connection) {
    const supplier = providerConfig.getProviderSupplier(cfg, connection.providerId, connection.supplierId);
    if (!supplier) return null;
    const name = String(supplier.name || '连接').trim() || '连接';
    const preset = connection.providerId.startsWith('conn-')
      ? resolveConnectionPreset(connection, name, supplier.baseUrl)
      : connection.providerId;
    const provider = MODEL_PROVIDERS[connection.providerId];
    const catalog = summarizeModelCatalog(
      providerConfig.getProviderSupplierApiCatalog(connection.providerId, supplier),
      STATIC_PROVIDER_SUPPLEMENTAL_MODELS[providerConfig.providerMediaPresetId(provider)] || []
    );
    return {
      id: connection.id,
      providerId: connection.providerId,
      supplierId: supplier.id,
      name,
      baseUrl: supplier.baseUrl || '',
      apiKeyConfigured: !!String(supplier.apiKey || '').trim(),
      imageGenerationUrl: supplier.imageGenerationUrl || '',
      imageEditUrl: supplier.imageEditUrl || '',
      videoGenerationUrl: supplier.videoGenerationUrl || '',
      preset,
      presetManual: connection.preset && connection.preset !== 'auto',
      apiFormat: resolveConnectionApiFormat(connection, name, supplier.baseUrl),
      manualModelId: String(connection.manualModelId || '').trim(),
      customModels: normalizeCustomModelIds(connection.customModels),
      modelCount: catalog.modelCount,
      supplementalModelCount: catalog.supplementalModelCount,
      supplementalModelLabel: preset === 'glm' ? 'GLM 官方补充' : '官方补充',
      totalModelCount: catalog.totalModelCount,
      models: applyConnectionModelFlags(
        connection.modelFlags,
        catalog.apiModels,
        providerConfig.providerCapabilityPresetId(provider)
      ).map(model => ({
        id: model.id,
        name: model.name || model.id,
        modelType: getModelType(connection.providerId, model),
        source: model.source === 'custom' ? 'custom' : ''
      })),
      modelFlags: connection.modelFlags && typeof connection.modelFlags === 'object' ? connection.modelFlags : {},
      isCurrentText: cfg.agentModel?.providerId === connection.providerId
        && cfg.agentModel?.supplierId === supplier.id,
      isEnabled: providerConfig.isConnectionEnabled(cfg, connection),
      logoProviderId: connection.providerId.startsWith('conn-') ? '' : connection.providerId,
      createdAt: Number(connection.createdAt) || 0
    };
  }

  function listConnections() {
    const cfg = configStore.loadConfig();
    return (cfg.api.connections || [])
      .map(connection => connectionSummary(cfg, connection))
      .filter(Boolean)
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  }

  async function testConnection({ baseUrl, apiKey, preset, apiFormat: requestedFormat } = {}) {
    const url = String(baseUrl || '').trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Base URL 必须以 http:// 或 https:// 开头' };
    const key = String(apiKey || '').trim();
    if (!key) return { ok: false, error: '请填写 API Key 后再测试' };
    const requestedPreset = String(preset || 'auto').trim().toLowerCase();
    const capabilityPreset = requestedPreset === 'auto'
      ? inferConnectionPreset('', url)
      : (CONNECTION_PRESETS.includes(requestedPreset) ? requestedPreset : 'openai');
    const explicitFormat = normalizeApiFormat(requestedFormat);
    const apiFormat = resolveConnectionApiFormat({ preset: capabilityPreset, apiFormat: explicitFormat }, '', url);
    const catalogApiFormat = apiFormat === 'anthropic' ? 'anthropic' : 'openai';
    try {
      const catalog = await fetchRemoteModelCatalog({ baseUrl: url, apiKey: key, apiFormat: catalogApiFormat });
      const models = normalizeRemoteModels(catalog);
      return {
        ok: true,
        modelCount: models.length,
        models: models.map(model => ({
          id: model.id,
          name: model.name || model.id,
          modelType: getModelType(capabilityPreset, model)
        }))
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function saveConnection(payload = {}) {
    const name = String(payload.name || '').trim() || '新连接';
    const preset = CONNECTION_PRESETS.includes(String(payload.preset || 'auto'))
      ? String(payload.preset)
      : 'auto';
    const manualModelId = String(payload.manualModelId || '').trim();
    const customModels = normalizeCustomModelIds([
      ...(Array.isArray(payload.customModels) ? payload.customModels : []),
      ...(manualModelId ? [manualModelId] : [])
    ]);
    const modelFlags = normalizeModelFlags(payload.modelFlags);
    const apiFormat = normalizeApiFormat(payload.apiFormat);
    const existingId = String(payload.id || '').trim();
    let cfg = configStore.loadConfig();
    if (!Array.isArray(cfg.api.connections)) cfg.api.connections = [];
    let connection = providerConfig.findConnection(cfg, existingId);
    let created = false;
    if (!connection) {
      const providerId = providerConfig.newConnectionId();
      connection = {
        id: providerId,
        providerId,
        supplierId: 'official',
        preset,
        apiFormat,
        manualModelId,
        customModels,
        modelFlags,
        createdAt: Date.now()
      };
      cfg.api.connections.push(connection);
      cfg.api.providerSuppliers[providerId] = [{
        id: 'official',
        name,
        kind: 'official',
        baseUrl: '',
        apiKey: '',
        imageGenerationUrl: '',
        imageEditUrl: '',
        videoGenerationUrl: '',
        workspaceId: '',
        models: []
      }];
      cfg.api.providerActiveSupplierIds[providerId] = 'official';
      created = true;
    }
    connection.preset = preset;
    connection.apiFormat = apiFormat;
    connection.manualModelId = customModels[0] || '';
    connection.customModels = customModels;
    connection.modelFlags = modelFlags;
    const supplier = cfg.api.providerSuppliers[connection.providerId]?.find(item => item.id === connection.supplierId);
    if (supplier) supplier.name = name;
    providerConfig.syncConnectionProviders(cfg);
    configStore.saveConfig(cfg);

    const result = await applyProviderConfiguration({
      providerId: connection.providerId,
      supplierId: connection.supplierId,
      supplierName: name,
      apiKey: payload.apiKey,
      baseUrl: payload.baseUrl,
      imageGenerationUrl: payload.imageGenerationUrl,
      imageEditUrl: payload.imageEditUrl,
      videoGenerationUrl: payload.videoGenerationUrl,
      providerName: name,
      modelId: manualModelId || undefined,
      modelName: manualModelId || undefined,
      apiFormat: resolveConnectionApiFormat(connection, name, String(payload.baseUrl || ''))
    });
    if (!result?.ok && created) {
      // A brand-new connection that cannot be validated is rolled back so the
      // list never shows a half-configured ghost entry.
      const rollback = configStore.loadConfig();
      rollback.api.connections = (rollback.api.connections || []).filter(item => item.id !== connection.id);
      delete rollback.api.providerSuppliers[connection.providerId];
      delete rollback.api.providerActiveSupplierIds?.[connection.providerId];
      delete rollback.api.providerConfigs?.[connection.providerId];
      delete rollback.api.apiKeys?.[connection.providerId];
      delete rollback.providerModels?.[connection.providerId];
      delete MODEL_PROVIDERS[connection.providerId];
      configStore.saveConfig(rollback);
      return result;
    }
    if (!result?.ok) return result;
    const finalConfig = result.config;
    const summary = connectionSummary(finalConfig, connection);
    return {
      ok: true,
      modelCount: summary?.modelCount || 0,
      supplementalModelCount: summary?.supplementalModelCount || 0,
      totalModelCount: summary?.totalModelCount || 0,
      connection: summary
    };
  }

  function deleteConnection({ id } = {}) {
    const cfg = configStore.loadConfig();
    const connection = providerConfig.findConnection(cfg, id);
    if (!connection) return { error: '连接不存在' };
    const { providerId, supplierId } = connection;
    cfg.api.connections = cfg.api.connections.filter(item => item.id !== connection.id);
    if (providerId.startsWith('conn-')) {
      delete cfg.api.providerSuppliers[providerId];
      delete cfg.api.providerActiveSupplierIds?.[providerId];
      delete cfg.api.providerConfigs?.[providerId];
      delete cfg.api.apiKeys?.[providerId];
      delete cfg.providerModels?.[providerId];
      delete MODEL_PROVIDERS[providerId];
      if (cfg.agentModel?.providerId === providerId) {
        cfg.agentModel = { ...cfg.agentModel, providerId: '', supplierId: '', modelId: '', name: '' };
      }
      for (const role of ['image', 'video']) {
        if (cfg.media?.[`${role}Provider`] === providerId) {
          cfg.media[`${role}Provider`] = '';
          cfg.media[`${role}SupplierId`] = '';
          cfg.media[`${role}Model`] = '';
          cfg.media[`${role}Name`] = '';
        }
      }
    } else if (supplierId === 'official') {
      const supplier = providerConfig.getProviderSupplier(cfg, providerId, supplierId);
      if (supplier) {
        supplier.apiKey = '';
        supplier.models = [];
        supplier.imageGenerationUrl = '';
        supplier.imageEditUrl = '';
        supplier.videoGenerationUrl = '';
        providerConfig.syncActiveProviderSupplier(cfg, providerId, supplier);
        providerConfig.rebindRolesAfterSupplierRemoval(cfg, providerId, supplierId);
      }
    } else {
      cfg.api.providerSuppliers[providerId] = (cfg.api.providerSuppliers[providerId] || [])
        .filter(item => item.id !== supplierId);
      if (cfg.api.providerActiveSupplierIds?.[providerId] === supplierId) {
        cfg.api.providerActiveSupplierIds[providerId] = 'official';
      }
      providerConfig.rebindRolesAfterSupplierRemoval(cfg, providerId, supplierId);
    }
    if (cfg.agentModel?.providerId && cfg.agentModel?.modelId) {
      const agentConnection = providerConfig.getProviderConnectionForSupplier(cfg, cfg.agentModel.providerId, cfg.agentModel.supplierId);
      cfg.api.provider = cfg.agentModel.providerId;
      cfg.api.baseUrl = agentConnection.baseUrl;
      cfg.api.apiKey = agentConnection.apiKey;
      cfg.api.model = cfg.agentModel.modelId;
      cfg.models = providerConfig.getProviderModels(cfg, cfg.agentModel.providerId, cfg.agentModel.supplierId);
    }
    modelState.normalizeAgentModelSelection(cfg);
    modelState.updateImageGenerationConfig(cfg);
    configStore.saveConfig(cfg);
    modelState.publishModelState(cfg);
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Natural-language provider setup (yan_provider MCP over the local bridge).
  // One call probes the catalog, creates/updates the connection, marks the
  // image/video models and binds the requested roles.
  // -------------------------------------------------------------------------
  function findReusableConnection(cfg, id, name, baseUrl) {
    if (id) return providerConfig.findConnection(cfg, id);
    const wantedName = String(name || '').trim().toLowerCase();
    if (!wantedName) return null;
    const normalizedUrl = String(baseUrl || '').replace(/\/+$/, '').toLowerCase();
    return (cfg.api.connections || []).find(connection => {
      const supplier = providerConfig.getProviderSupplier(cfg, connection.providerId, connection.supplierId);
      if (!supplier) return false;
      return String(supplier.name || '').trim().toLowerCase() === wantedName
        && String(supplier.baseUrl || '').replace(/\/+$/, '').toLowerCase() === normalizedUrl;
    }) || null;
  }

  async function configureProvider(payload = {}) {
    const baseUrl = String(payload.base_url ?? payload.baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(baseUrl)) {
      return { ok: false, error: 'Base URL 必须以 http:// 或 https:// 开头' };
    }
    let fallbackName = '新连接';
    try { fallbackName = new URL(baseUrl).hostname || fallbackName; } catch { /* validated above */ }
    const name = String(payload.name || '').trim() || fallbackName;
    const presetInput = String(payload.preset || 'auto').trim().toLowerCase();
    const preset = CONNECTION_PRESETS.includes(presetInput) ? presetInput : 'auto';
    const apiFormat = normalizeApiFormat(payload.api_format ?? payload.apiFormat);
    const requestedId = String(payload.id || '').trim();

    const cfgBefore = configStore.loadConfig();
    providerConfig.ensureProviderConfigs(cfgBefore);
    const existing = findReusableConnection(cfgBefore, requestedId, name, baseUrl);
    const existingSupplier = existing
      ? providerConfig.getProviderSupplier(cfgBefore, existing.providerId, existing.supplierId)
      : null;
    // An empty key on an existing connection means "keep the stored secret",
    // matching the settings form. A new connection always needs one.
    const apiKey = String(payload.api_key ?? payload.apiKey ?? '').trim()
      || String(existingSupplier?.apiKey || '').trim();
    if (!apiKey) {
      return { ok: false, error: '缺少 API Key：请让用户提供该服务商的密钥；更新已有连接时可以省略以沿用已保存的密钥。' };
    }

    const specs = normalizeModelSpecs(payload);
    const probe = await testConnection({ baseUrl, apiKey, preset, apiFormat });
    const catalog = probe.ok && Array.isArray(probe.models) ? probe.models : [];
    if (!probe.ok && !specs.length) {
      return {
        ok: false,
        error: `无法从该地址读取模型列表（${probe.error}）。请让用户提供模型名称后重试，或确认 Base URL 是否需要包含 /v1。`,
        probe: { ok: false, error: probe.error }
      };
    }
    const models = catalog.length
      ? catalog
      : specs.map(spec => ({ id: spec.id, name: spec.id, modelType: spec.role || '' }));
    const knownIds = new Set(models.map(model => model.id));
    const missingModels = specs.filter(spec => !knownIds.has(spec.id)).map(spec => spec.id);

    const hasTextModel = !!(cfgBefore.agentModel?.providerId && cfgBefore.agentModel?.modelId);
    const requestedMain = String(payload.main_model ?? payload.mainModel ?? '').trim();
    const requestedImage = String(payload.image_model ?? payload.imageModel ?? '').trim();
    const requestedVideo = String(payload.video_model ?? payload.videoModel ?? '').trim();
    const firstRoleModel = role => {
      const fromSpec = specs.find(spec => spec.role === role);
      if (fromSpec) return fromSpec.id;
      return models.find(model => classifyModelRole(model.id, model.name).role === role)?.id || '';
    };
    const mainModel = requestedMain || (hasTextModel ? '' : firstRoleModel('text'));
    const imageModel = requestedImage || firstRoleModel('image');
    const videoModel = requestedVideo || firstRoleModel('video');

    const flags = buildConnectionModelFlags({ models, specs, enableAll: payload.enable_all_models === true });
    if (mainModel) pinModelRole(flags, mainModel, 'text');
    if (imageModel) pinModelRole(flags, imageModel, 'image');
    if (videoModel) pinModelRole(flags, videoModel, 'video');
    const mergedFlags = { ...(existing?.modelFlags || {}), ...flags };
    const customModels = [...new Set([
      ...(Array.isArray(existing?.customModels) ? existing.customModels : []),
      ...specs.map(spec => spec.id)
    ])];

    const saved = await saveConnection({
      id: existing?.id || '',
      name,
      baseUrl,
      apiKey,
      preset,
      apiFormat,
      customModels,
      modelFlags: mergedFlags,
      manualModelId: customModels[0] || '',
      imageGenerationUrl: payload.image_generation_url ?? payload.imageGenerationUrl,
      imageEditUrl: payload.image_edit_url ?? payload.imageEditUrl,
      videoGenerationUrl: payload.video_generation_url ?? payload.videoGenerationUrl
    });
    if (!saved?.ok) {
      return {
        ok: false,
        ...saved,
        probe: probe.ok
          ? { ok: true, modelCount: catalog.length }
          : { ok: false, error: probe.error }
      };
    }

    const finalCfg = configStore.loadConfig();
    const record = providerConfig.findConnection(finalCfg, saved.connection?.id || existing?.id);
    const summary = record ? connectionSummary(finalCfg, record) : saved.connection;
    const summaryModels = Array.isArray(summary?.models) ? summary.models : [];

    const roles = {};
    const applyRole = (role, modelId) => {
      if (!summary?.providerId || !modelId) return;
      const model = summaryModels.find(item => item.id === modelId && item.modelType === role);
      if (!model) return;
      const applied = modelState.setActiveModelRole(summary.providerId, model.id, role, summary.supplierId);
      if (!applied?.error) roles[role] = model.id;
    };

    // Text: only when the user named one or no chat model exists yet, so adding
    // an image provider never hijacks the conversation model.
    if (requestedMain || !finalCfg.agentModel?.providerId) {
      applyRole('text', requestedMain || summaryModels.find(model => model.modelType === 'text')?.id || '');
    }
    // Media: an explicit pick always wins; otherwise only fill an empty role.
    const currentMedia = finalCfg.media || {};
    if (requestedImage || payload.set_image_model === true || !currentMedia.imageModel) {
      applyRole('image', requestedImage || summaryModels.find(model => model.modelType === 'image')?.id || '');
    }
    if (requestedVideo || payload.set_video_model === true || !currentMedia.videoModel) {
      applyRole('video', requestedVideo || summaryModels.find(model => model.modelType === 'video')?.id || '');
    }

    const after = configStore.loadConfig();
    const media = after.media || {};
    return {
      ok: true,
      verified: probe.ok === true,
      connection: {
        id: summary.id,
        providerId: summary.providerId,
        supplierId: summary.supplierId,
        name: summary.name,
        baseUrl: summary.baseUrl,
        preset: summary.preset,
        apiFormat: summary.apiFormat,
        apiKeyConfigured: !!apiKey,
        apiKeyMasked: maskSecret(apiKey),
        modelCount: summaryModels.length
      },
      models: summaryModels.map(model => ({
        id: model.id,
        name: model.name,
        modelType: model.modelType
      })),
      missingModels,
      roles: {
        text: after.agentModel?.providerId === summary.providerId ? after.agentModel.modelId : '',
        image: media.imageProvider === summary.providerId ? media.imageModel : '',
        video: media.videoProvider === summary.providerId ? media.videoModel : ''
      },
      imageGeneration: after.imageGeneration || null,
      videoGeneration: after.videoGeneration || null,
      probe: probe.ok
        ? { ok: true, modelCount: catalog.length }
        : { ok: false, error: probe.error, note: '已按提供的模型名写入连接，但该地址没有返回可读的模型目录。' },
      effective: 'next-run',
      note: '连接已写入并加密保存。生图/生视频能力在下一个任务的内核启动后生效；当前任务仍使用启动时的模型配置。'
    };
  }

  // -------------------------------------------------------------------------
  // Local bridge for the yan_provider MCP server. The MCP process is a child of
  // the kernel, not the main process: it cannot reach configStore/modelState or
  // safeStorage, so configuration writes go through this authenticated local
  // socket instead of touching config.json directly.
  // -------------------------------------------------------------------------
  const bridgeToken = crypto.randomBytes(32).toString('hex');
  const BRIDGE_MAX_BYTES = 256 * 1024;
  const bridgeActions = Object.freeze({
    'provider.list': () => {
      const cfg = configStore.loadConfig();
      const agentModel = modelState.normalizeAgentModelSelection(cfg);
      return {
        connections: listConnections(),
        media: modelState.normalizeMediaConfig(cfg),
        text: {
          providerId: agentModel.providerId || '',
          supplierId: agentModel.supplierId || '',
          modelId: agentModel.modelId || ''
        },
        imageGeneration: cfg.imageGeneration || null,
        videoGeneration: cfg.videoGeneration || null
      };
    },
    'provider.test': payload => testConnection(payload),
    'provider.configure': payload => configureProvider(payload),
    'provider.remove': payload => deleteConnection(payload)
  });
  let bridgeServer = null;
  let bridgePort = 0;

  function writeBridgeResponse(socket, payload) {
    if (socket.destroyed) return;
    socket.end(`${JSON.stringify(payload)}\n`);
  }

  function handleBridgeSocket(socket) {
    socket.setEncoding('utf8');
    let input = '';
    let handled = false;
    socket.on('data', chunk => {
      if (handled) return;
      input += String(chunk || '');
      if (Buffer.byteLength(input, 'utf8') > BRIDGE_MAX_BYTES) {
        handled = true;
        writeBridgeResponse(socket, { ok: false, error: '服务商桥接请求过大。', code: 'YAN_PROVIDER_REQUEST_TOO_LARGE' });
        return;
      }
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      handled = true;
      let request;
      try {
        request = JSON.parse(input.slice(0, newline).trim());
      } catch (error) {
        writeBridgeResponse(socket, { ok: false, error: error?.message || '服务商桥接请求不是有效 JSON。', code: 'YAN_PROVIDER_BAD_JSON' });
        return;
      }
      if (request?.token !== bridgeToken) {
        writeBridgeResponse(socket, { ok: false, error: '服务商桥接认证失败。', code: 'YAN_PROVIDER_AUTH_FAILED' });
        return;
      }
      const action = String(request?.action || '');
      const handler = bridgeActions[action];
      if (!handler) {
        writeBridgeResponse(socket, { ok: false, error: `未知的服务商桥接操作：${action}`, code: 'YAN_PROVIDER_UNKNOWN_ACTION' });
        return;
      }
      const params = request?.params && typeof request.params === 'object' && !Array.isArray(request.params)
        ? request.params
        : {};
      Promise.resolve()
        .then(() => handler(params))
        .then(result => writeBridgeResponse(socket, { ok: true, result }))
        .catch(error => writeBridgeResponse(socket, {
          ok: false,
          error: error?.message || String(error),
          code: error?.code || 'YAN_PROVIDER_BRIDGE_FAILED'
        }));
    });
    socket.on('error', () => {});
  }

  function startProviderBridge() {
    if (bridgeServer && bridgePort) {
      return Promise.resolve({ port: bridgePort, token: bridgeToken });
    }
    return new Promise((resolve, reject) => {
      const server = net.createServer(handleBridgeSocket);
      const fail = error => {
        server.close(() => {});
        reject(error);
      };
      server.once('error', fail);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', fail);
        server.on('error', error => console.warn('[provider bridge]', error.message));
        const address = server.address();
        bridgeServer = server;
        bridgePort = typeof address === 'object' && address ? Number(address.port) : 0;
        resolve({ port: bridgePort, token: bridgeToken });
      });
    });
  }

  function stopProviderBridge() {
    bridgePort = 0;
    bridgeServer?.close(() => {});
    bridgeServer = null;
  }

  return {
    connectionSummary,
    listConnections,
    testConnection,
    saveConnection,
    deleteConnection,
    configureProvider,
    bridgeToken,
    bridgePort: () => bridgePort,
    startProviderBridge,
    stopProviderBridge
  };
}

module.exports = { createProviderConnections };
