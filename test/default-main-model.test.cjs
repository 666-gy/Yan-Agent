'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelState } = require('../lib/main/model-state');

function fixture() {
  const connections = ['a', 'b'].map(providerId => ({ id: providerId, providerId, supplierId: 'official', modelFlags: {} }));
  const catalogs = { a: [{ id: 'a1' }, { id: 'a2' }], b: [{ id: 'b1' }, { id: 'b2' }] };
  const cfg = { api: { provider: 'a', model: 'a1', providerActiveSupplierIds: { a: 'official' }, enabledConnections: ['a', 'b'] },
    agentModel: { providerId: 'a', supplierId: 'official', modelId: 'a1' } };
  const state = createModelState({ MODEL_PROVIDERS: {}, providerConfig: {
    ensureProviderConfigs() {},
    getEnabledConnections: cfg => connections.filter(connection => cfg.api.enabledConnections.includes(connection.id)),
    getProviderSupplier: () => ({ id: 'official', apiKey: 'local', baseUrl: 'http://localhost' }),
    getProviderModels: (_cfg, providerId) => catalogs[providerId]
  } });
  return { cfg, connections, catalogs, select: () => state.normalizeAgentModelSelection(cfg) };
}

test('disabled first model falls back to the first enabled main model', () => {
  const f = fixture();
  f.connections[0].modelFlags.a1 = { enabled: false };
  assert.equal(f.select().modelId, 'a2');
  assert.equal(f.cfg.api.model, 'a2');
});
test('fallback searches later configurations and skips non-main models', () => {
  const f = fixture();
  f.catalogs.a = [{ id: 'a1', enabled: false }, { id: 'picture', modelType: 'image' }, { id: 'embedding' }];
  assert.equal(f.select().modelId, 'b1');
});
test('disabled configurations cannot supply the default', () => {
  const f = fixture();
  f.cfg.api.enabledConnections = ['b'];
  assert.equal(f.select().modelId, 'b1');
});
test('no enabled main model clears both current and legacy fallback fields', () => {
  const f = fixture();
  for (const models of Object.values(f.catalogs)) for (const model of models) model.enabled = false;
  assert.equal(f.select().modelId, '');
  assert.equal(f.cfg.api.model, '');
  assert.deepEqual(f.cfg.models, []);
  assert.equal(f.select().modelId, '', 'normalizing again must not resurrect a disabled model');
});
test('valid user selection is retained; missing selection uses configuration order', () => {
  const f = fixture();
  f.cfg.agentModel = { providerId: 'b', supplierId: 'official', modelId: 'b2' };
  assert.equal(f.select().modelId, 'b2');
  f.cfg.agentModel.modelId = 'removed';
  assert.equal(f.select().modelId, 'a1');
});
