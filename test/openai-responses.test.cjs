'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { buildOpenCodeConfig, stageResponsesProviderModule } = require('../lib/opencode-sidecar');

const appRoot = path.resolve(__dirname, '..');
const bundlePath = path.join(appRoot, 'lib', 'opencode-openai-responses-provider.bundle.mjs');

test('responses format selects the staged responses provider module', () => {
  const moduleUrl = pathToFileURL(bundlePath).href;
  const config = buildOpenCodeConfig({
    providerId: 'conn-responses',
    providerName: 'Responses 中转',
    modelId: 'gpt-5.3',
    apiFormat: 'responses',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    responsesProviderModule: moduleUrl
  });
  const provider = config.provider['conn-responses'];
  assert.equal(provider.npm, moduleUrl);
  assert.equal(provider.options.baseURL, 'https://api.example.com/v1');
  assert.equal(provider.options.apiKey, 'test-key');
  assert.equal('yanDsmlCompatibility' in provider.options, false);
});

test('responses format requires a staged module instead of silently reusing chat completions', () => {
  assert.throws(() => buildOpenCodeConfig({
    providerId: 'conn-responses',
    modelId: 'gpt-5.3',
    apiFormat: 'responses',
    baseUrl: 'https://api.example.com/v1'
  }), /Responses provider module is missing/u);
});

test('stages the responses bundle outside the application directory', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-responses-stage-'));
  try {
    const moduleUrl = stageResponsesProviderModule({ appRoot, dataDir });
    const stagedPath = fileURLToPath(moduleUrl);
    assert.equal(stagedPath.startsWith(path.join(dataDir, 'opencode-runtime', 'providers')), true);
    assert.equal(fs.readFileSync(stagedPath).equals(fs.readFileSync(bundlePath)), true);
    assert.equal(stageResponsesProviderModule({ appRoot, dataDir }), moduleUrl);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('responses provider routes model calls to POST /responses and remaps reasoning options', async () => {
  const { createYanOpenAIResponsesProvider } = await import(pathToFileURL(bundlePath).href);
  let captured = null;
  const fakeFetch = async (input, init) => {
    captured = {
      url: String(input),
      method: init?.method || 'GET',
      body: init?.body ? String(init.body) : ''
    };
    return new Response(JSON.stringify({ error: { message: 'stop', type: 'invalid_request_error' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  };
  const provider = createYanOpenAIResponsesProvider({
    name: 'conn-responses',
    apiKey: 'test-key',
    baseURL: 'https://api.example.com/v1',
    fetch: fakeFetch
  });
  const model = provider('gpt-5.3');
  assert.equal(model.modelId, 'gpt-5.3');
  assert.equal(typeof model.doGenerate, 'function');
  await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    providerOptions: { 'conn-responses': { reasoningEffort: 'high' } }
  }).catch(() => {});
  assert.equal(captured.method, 'POST');
  assert.match(captured.url, /\/v1\/responses$/u);
  assert.match(captured.body, /"reasoning"/u);
  assert.match(captured.body, /"effort"\s*:\s*"high"/u);
});
