'use strict';
// Reuse the actual desktop quick-model handler with an in-memory config copy.
const { createRuntimeDefaults } = require('../lib/main/runtime-defaults');
const { createProviderConfig } = require('../lib/main/provider-config');
const { createModelState } = require('../lib/main/model-state');
const { registerProviderIpc } = require('../lib/main/provider-ipc');
function readComposerModels(config, dataDir) {
  const defaults = createRuntimeDefaults({ dataDir });
  const roles = require('../lib/model-roles');
  const presets = require('../lib/connection-presets');
  const providerConfig = createProviderConfig({ ...defaults, ...roles, ...presets,
    appRoot: require('node:path').resolve(__dirname, '..'),
    normalizeRemoteModels: require('../lib/model-catalog').normalizeRemoteModels,
    buildSelectableModelCatalog: require('../lib/provider-model-catalog').buildSelectableModelCatalog,
    decorateModels: require('../lib/model-capabilities').decorateModels,
    updateImageGenerationConfig: () => {} });
  const configStore = { loadConfig: () => config };
  providerConfig.syncConnectionProviders(config);
  const modelState = createModelState({ ...defaults, providerConfig, configStore });
  const handlers = new Map();
  registerProviderIpc({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) } }, { ...defaults, providerConfig, configStore, modelState });
  const payload = handlers.get('models:quick-list')();
  const selection = modelState.normalizeAgentModelSelection(config);
  const key = model => JSON.stringify([model.providerId, model.supplierId, model.modelId || model.id]);
  return { models: payload.models.filter(model => model.modelType === 'text').map(model => ({
    key: key(model), modelId: model.id, name: model.name || model.id,
    providerId: model.providerId, supplierId: model.supplierId, providerName: model.providerName, supplierName: model.supplierName
  })), selected: key(selection), reasoningMode: config.api?.reasoningSpeed || 'medium' };
}
module.exports = { readComposerModels };
