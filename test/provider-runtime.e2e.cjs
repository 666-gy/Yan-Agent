'use strict';

// Start the packaged Node V2 runtime against a local HTTP provider. No V1 exe.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');
const { resolveProviderAdapter } = require('../lib/provider-adapter-routing');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { runtimePaths } = require('../lib/kernel-v2/runtime');
const appRoot = path.resolve(process.env.YAN_PACKAGED_APP_ROOT || path.join(__dirname, '..'));
const providerId = String(process.env.YAN_TEST_PROVIDER_ID || 'deepseek');
const modelId = process.env.YAN_TEST_MODEL_ID || `${providerId}-packaged-test`;
const rendererSource = appRoot.endsWith('app.asar') ? require('@electron/asar').extractFile(appRoot, path.join('renderer', 'renderer.js')).toString('utf8') : fs.readFileSync(path.join(appRoot, 'renderer', 'renderer.js'), 'utf8');
const cacheUi = vm.createContext({});
for (const name of ['getAgentRunCacheStats', 'formatCacheHitRate']) {
  const start = rendererSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing renderer function ${name}`);
  const end = rendererSource.indexOf('\nfunction ', start + 1);
  assert.ok(end > start);
  vm.runInContext(rendererSource.slice(start, end), cacheUi);
}
const families = { glm: ['glmm', 'Glmm'], qwen: ['qwem', 'Qwem'], kimi: ['kiml', 'Kiml'],
  gptl: ['gptl', 'Gptl'], agnes: ['agnl', 'Agnl'], gemini: ['geml', 'Geml'], grok: ['grol', 'Grol'],
  anthropic: ['antl', 'Antl'] };

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-provider-v2-'));
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push({ url: request.url, body: JSON.parse(body || '{}') });
      if (request.url.endsWith('/chat/completions')) {
        const allowed = new Set(['model', 'messages', 'stream', 'stream_options', 'tools', 'tool_choice',
          'max_tokens', 'max_completion_tokens', 'temperature', 'top_p', 'top_k', 'stop', 'seed',
          'frequency_penalty', 'presence_penalty', 'response_format', 'reasoning_effort', 'thinking',
          'tool_stream', 'parallel_tool_calls', 'user', 'verbosity', 'enable_thinking']);
        const unknown = Object.keys(requests.at(-1).body).find(key => !allowed.has(key));
        if (unknown) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: { message: `UNKNOWN_FIELD: ${unknown}` } }));
          return;
        }
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const send = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
      if (request.url.endsWith('/responses')) {
        const result = { id: 'resp_probe', object: 'response', status: 'completed', model: modelId,
          created_at: Math.floor(Date.now() / 1000),
          output: [{ id: 'msg_probe', type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: 'PACKAGED_PROVIDER_OK', annotations: [] }] }],
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120,
            input_tokens_details: { cached_tokens: 60 }, output_tokens_details: { reasoning_tokens: 5 } } };
        send({ type: 'response.created', response: { ...result, status: 'in_progress', output: [] } });
        send({ type: 'response.output_item.added', output_index: 0, item: { ...result.output[0], content: [] } });
        send({ type: 'response.content_part.added', item_id: 'msg_probe', output_index: 0, content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] } });
        send({ type: 'response.output_text.delta', item_id: 'msg_probe', output_index: 0, content_index: 0, delta: 'PACKAGED_PROVIDER_OK' });
        send({ type: 'response.completed', response: result });
        response.end();
      } else {
        const common = { id: 'yan-provider-test', object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: modelId };
        send({ ...common, choices: [{ index: 0, delta: { role: 'assistant', content: 'PACKAGED_PROVIDER_OK' }, finish_reason: null }] });
        send({ ...common, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
        send({ ...common, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20,
          total_tokens: 120, prompt_cache_hit_tokens: 60, prompt_cache_miss_tokens: 40,
          completion_tokens_details: { reasoning_tokens: 5 } } });
        response.end('data: [DONE]\n\n');
      }
    });
  });
  const adapter = new OpenCodeV2Adapter({ appRoot, dataDir });
  const start = adapter.start.bind(adapter);
  adapter.start = async config => {
    const status = await start(config);
    adapter.transport.child.stderr.on('data', chunk => process.stderr.write(chunk));
    return status;
  };
  async function run(config, id, model) {
    const runId = `provider-${id}`;
    const timeout = setTimeout(() => {
      console.error('Provider timeout; requested URLs:', requests.map(item => item.url));
      adapter.cancel(runId).catch(() => {});
    }, 30000);
    try {
      const result = await adapter.run({ runId, workspace: dataDir, hasUserWorkspace: true,
        prompt: 'Reply with the supplied test response.', providerId: id, modelId: model,
        openCodeConfig: config, accessMode: 'full', permissions: { allowFileRead: true, allowFileWrite: true, allowNetwork: true } });
      assert.equal(result.status, 'done', JSON.stringify(result));
      assert.ok(JSON.stringify(result).includes('PACKAGED_PROVIDER_OK'), JSON.stringify(result));
      assert.deepEqual(result.usage, { input: 40, output: 15, reasoning: 5, cacheRead: 60, cacheWrite: 0, total: 120 });
      const stats = cacheUi.getAgentRunCacheStats({ usage: result.usage });
      assert.equal(stats.promptTokens, 100);
      assert.equal(cacheUi.formatCacheHitRate(stats.rate), '60%');
    } finally { clearTimeout(timeout); }
  }
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const providerName = process.env.YAN_TEST_PROVIDER_NAME || providerId;
    const family = providerId === 'jiyuan' ? ['jiyuan', 'Jiyuan'] : families[resolveProviderAdapter({}, { providerID: providerId, providerName,
      modelID: modelId, baseURL: baseUrl })];
    const specifier = staging[`stage${family?.[1] || 'DeepSeek'}ProviderModule`]({ appRoot, dataDir });
    const options = { providerId, providerName, modelId,
      apiKey: 'local-test-key', baseUrl, deepSeekProviderModule: specifier,
      ...(family ? { [family[0]]: true, [`${family[0]}ProviderModule`]: specifier } : {}),
      capabilities: { contextWindow: 32768, maxOutputTokens: 8192 }, accessMode: 'full' };
    const config = buildOpenCodeConfig(options);
    assert.equal(config.provider[providerId].npm, specifier);
    await run(config, providerId, modelId);
    if (['deepseek-v4.1-flash-1017', 'glm-5.3-flash'].includes(modelId)) {
      assert.equal(requests.at(-1).body.reasoning_effort, 'high');
    }
    if (providerId === 'deepseek') {
      assert.equal(config.provider[providerId].options.yanDsmlCompatibility, true);
      const standard = buildOpenCodeConfig({ ...options, dsml: false });
      assert.equal(standard.provider[providerId].options.yanDsmlCompatibility, false);
      await run(standard, providerId, modelId);
    }
    assert.ok(requests.some(({ body }) => (body.tools || []).some(tool => tool.function?.name === 'edit')),
      'The V2 runtime must expose its native edit tool to the provider');
    // V2 has one native edit action; V1 write/edit/apply_patch trio is retired.
    const before = requests.length;
    const responsesId = 'conn-responses-test', responsesModel = 'responses-packaged-test';
    const responsesProviderModule = staging.stageResponsesProviderModule({ appRoot, dataDir });
    await run(buildOpenCodeConfig({ ...options, providerId: responsesId, modelId: responsesModel,
      jiyuan: false, apiFormat: 'responses', responsesProviderModule }), responsesId, responsesModel);
    const responsesRequests = requests.slice(before);
    assert.ok(responsesRequests.some(request => request.url.endsWith('/responses')), JSON.stringify(responsesRequests));
    assert.equal(responsesRequests.some(request => request.url.includes('/chat/completions')), false);
    console.log(JSON.stringify({ ok: true, runtime: 'node-v2', executable: runtimePaths(appRoot, dataDir).executable,
      providerId, requestedUrls: requests.map(request => request.url) }));
  } finally {
    await adapter.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert.match(path.basename(dataDir), /^yan-provider-v2-/);
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
