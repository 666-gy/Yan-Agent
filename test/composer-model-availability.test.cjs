'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer/renderer.js'), 'utf8');
function fixture() {
  const stored = { providerId: 'deepseek', supplierId: 'official', modelId: 'ds', modelType: 'text', name: 'DeepSeek' };
  const config = { agentModel: { ...stored }, api: { connections: [{ id: 'ds-connection', providerId: 'deepseek', supplierId: 'official' }], enabledConnections: ['ds-connection'] } };
  const context = vm.createContext({ state: { config, currentSession: { modelSelection: stored } } });
  for (const name of ['getAgentModelConfigName', 'getStoredAgentModelSelection', 'getAgentModelSelection']) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf(String.fromCharCode(10) + '}', start) + 2), context);
  }
  return { context, config, stored, read: () => context.getAgentModelSelection() };
}
test('deleted connections do not resurrect the task model after restart', () => {
  const f = fixture();
  assert.equal(f.read().modelId, 'ds');
  f.config.api.connections = [];
  f.config.api.enabledConnections = [];
  f.config.agentModel = { modelId: '' };
  assert.equal(f.read().modelId, '');
  f.context.state = JSON.parse(JSON.stringify(f.context.state));
  assert.equal(f.read().name, '');
  assert.equal(f.context.state.currentSession.modelSelection.modelId, 'ds');
});
test('disabled connections and models suppress selection without deleting history', () => {
  const f = fixture();
  f.config.api.enabledConnections = [];
  assert.equal(f.read().modelId, '');
  f.config.api.enabledConnections = ['ds-connection'];
  f.config.api.connections[0].modelFlags = { ds: { enabled: false } };
  assert.equal(f.read().modelId, '');
  f.config.api.connections[0].modelFlags.ds.enabled = true;
  assert.equal(f.read().modelId, 'ds');
  assert.equal(f.stored.name, 'DeepSeek');
});
