'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CATALOG_WRAPPER_KEYS,
  fetchRemoteModelCatalog,
  normalizeRemoteModels,
  parseRemoteModelCatalog
} = require('../lib/model-catalog');

test('accepts standard arrays and every allowlisted catalog wrapper', () => {
  const expected = [{ id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' }];
  assert.deepEqual(parseRemoteModelCatalog(expected), expected);

  for (const key of CATALOG_WRAPPER_KEYS) {
    assert.deepEqual(
      parseRemoteModelCatalog({ [key]: expected }),
      expected,
      `wrapper ${key}`
    );
  }
});

test('accepts bounded nested wrappers and JSON-string encoded catalogs', () => {
  const payload = {
    response: JSON.stringify({
      body: {
        payload: JSON.stringify({ models: [{ model_id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash' }] })
      }
    })
  };
  assert.deepEqual(parseRemoteModelCatalog(payload), [
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }
  ]);
});

test('normalizes common model ID and display-name aliases', () => {
  const models = normalizeRemoteModels([
    { model: 'model-a', title: 'Model A' },
    { model_id: 'model-b', label: 'Model B' },
    { modelId: 'model-c', displayName: 'Model C' },
    { slug: 'model-d', display_name: 'Model D' },
    { name: 'model-e' },
    { id: 'model-a', name: 'Duplicate' }
  ]);
  assert.deepEqual(models.map(model => [model.id, model.name]), [
    ['model-a', 'Model A'],
    ['model-b', 'Model B'],
    ['model-c', 'Model C'],
    ['model-d', 'Model D'],
    ['model-e', 'model-e']
  ]);
});

test('converts explicit object maps without scanning arbitrary properties', () => {
  const wrapped = parseRemoteModelCatalog({
    models: {
      object: 'list',
      total: 3,
      'gpt-5.6-sol': { display_name: 'GPT 5.6 Sol' },
      'qwen3.8-max-preview': 'Qwen 3.8 Max Preview',
      'deepseek-v4-flash': null
    }
  });
  assert.deepEqual(wrapped, [
    { id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' },
    { id: 'qwen3.8-max-preview', name: 'Qwen 3.8 Max Preview' },
    { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' }
  ]);

  assert.deepEqual(parseRemoteModelCatalog({
    'glm-5.2': { title: 'GLM 5.2' },
    'kimi-k3': { displayName: 'Kimi K3' }
  }), [
    { id: 'glm-5.2', name: 'GLM 5.2' },
    { id: 'kimi-k3', name: 'Kimi K3' }
  ]);
});

test('accepts a single structured model object without splitting its metadata', () => {
  assert.deepEqual(parseRemoteModelCatalog({
    data: {
      id: 'single-model',
      name: 'Single Model',
      object: 'model',
      owned_by: 'relay',
      created: 123
    }
  }), [{ id: 'single-model', name: 'Single Model' }]);
});

test('preserves modalities and explicit model capabilities', () => {
  assert.deepEqual(parseRemoteModelCatalog({ data: [{
    id: 'vision-model',
    input_modalities: ['text', 'image'],
    output_modalities: ['image'],
    capabilities: { vision: true }
  }] }), [{
    id: 'vision-model',
    name: 'vision-model',
    inputModalities: ['text', 'image'],
    outputModalities: ['image'],
    modelType: 'image',
    capabilities: { vision: true }
  }]);
});

test('keeps an explicit empty catalog valid', () => {
  assert.deepEqual(parseRemoteModelCatalog({ data: [] }), []);
  assert.deepEqual(parseRemoteModelCatalog({ models: {} }), []);
});

test('prefers a non-empty allowlisted catalog over an empty sibling wrapper', () => {
  assert.deepEqual(parseRemoteModelCatalog({
    data: {},
    models: [{ id: 'available-model' }]
  }), [{ id: 'available-model', name: 'available-model' }]);
});

test('rejects errors, unrelated arrays, invalid entries, and excessive wrapper depth', () => {
  assert.throws(
    () => parseRemoteModelCatalog({ error: { message: 'upstream unavailable' } }),
    /模型接口返回错误：upstream unavailable/
  );
  assert.throws(
    () => parseRemoteModelCatalog({ metrics: [1, 2, 3] }),
    /未返回可识别的模型列表/
  );
  assert.throws(
    () => parseRemoteModelCatalog({}),
    /未返回可识别的模型列表/
  );
  assert.throws(
    () => parseRemoteModelCatalog({ status: 'ok', message: 'no catalog here' }),
    /未返回可识别的模型列表/
  );
  assert.throws(
    () => parseRemoteModelCatalog({ data: [], response: { error: { message: 'relay failed' } } }),
    /模型接口返回错误：relay failed/
  );
  assert.throws(
    () => parseRemoteModelCatalog({ data: [{ created: 123 }, { owned_by: 'relay' }] }),
    /没有可识别的模型 ID/
  );
  assert.throws(
    () => parseRemoteModelCatalog({ data: [1, 2, 3] }),
    /没有可识别的模型 ID/
  );
  assert.throws(
    () => parseRemoteModelCatalog({ data: { result: { response: { body: { payload: { data: { models: [] } } } } } } }),
    /未返回可识别的模型列表/
  );
});

test('fetchRemoteModelCatalog accepts a double-encoded successful response', async () => {
  let request = null;
  const models = await fetchRemoteModelCatalog({
    baseUrl: 'https://relay.example/v1/',
    apiKey: 'secret-key',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(JSON.stringify({ result: [{ slug: 'relay-model' }] }))
      };
    }
  });
  assert.deepEqual(models, [{ id: 'relay-model', name: 'relay-model' }]);
  assert.equal(request.url, 'https://relay.example/v1/models');
  assert.equal(request.options.headers.Authorization, 'Bearer secret-key');
});

test('fetchRemoteModelCatalog uses Anthropic gateway URL and authentication headers', async () => {
  let request = null;
  const models = await fetchRemoteModelCatalog({
    baseUrl: 'https://ark.example.com',
    apiKey: 'anthropic-key',
    apiFormat: 'anthropic',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ id: 'kimi-k2.7-code' }] })
      };
    }
  });
  assert.deepEqual(models, [{ id: 'kimi-k2.7-code', name: 'kimi-k2.7-code' }]);
  assert.equal(request.url, 'https://ark.example.com/v1/models');
  assert.equal(request.options.headers.Authorization, 'Bearer anthropic-key');
  assert.equal(request.options.headers['x-api-key'], 'anthropic-key');
  assert.equal(request.options.headers['anthropic-version'], '2023-06-01');
});

test('remote model catalogs omit models marked unavailable by the provider', () => {
  assert.deepEqual(normalizeRemoteModels([
    { id: 'available', status: 'active' },
    { id: 'shutdown-model', status: 'shutdown' },
    { id: 'deprecated-model', status: 'deprecated' }
  ]), [{ id: 'available', name: 'available' }]);
});
