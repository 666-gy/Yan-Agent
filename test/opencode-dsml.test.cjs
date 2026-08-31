'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const {
  containsDsmlToolCallMarkup,
  recoverDsmlToolCalls
} = require('../lib/dsml-tool-call');
const {
  DEFAULT_PROVIDER_CHUNK_TIMEOUT_MS,
  DEFAULT_PROVIDER_HEADER_TIMEOUT_MS,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  buildOpenCodeConfig,
  permissionRulesForRun,
  sessionPermissionForRun,
  openCodeMessageContextTokens,
  openCodeErrorDetail,
  stageDeepSeekProviderModule,
  buildPromptParts
} = require('../lib/opencode-sidecar');
const { resolveModelCapabilities } = require('../lib/model-capabilities');

const providerModule = import('../lib/opencode-dsml-provider.mjs');

function sseBlock(payload) {
  return `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`;
}

function fragmentedSseResponse(source, chunkBytes = 19) {
  const bytes = new TextEncoder().encode(source);
  return new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
        controller.enqueue(bytes.slice(offset, offset + chunkBytes));
      }
      controller.close();
    }
  }), {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'content-length': String(bytes.length)
    }
  });
}

function parseSseOutput(source) {
  return String(source).split(/\r?\n\r?\n/gu).filter(Boolean).map(block => {
    const data = block.split(/\r?\n/gu)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /u, ''))
      .join('\n');
    return data === '[DONE]' ? data : JSON.parse(data);
  });
}

const dsml = [
  '<｜｜DSML｜｜tool_calls>',
  '<｜｜DSML｜｜invoke name="bash">',
  '<｜｜DSML｜｜parameter name="command" string="true">Get-ChildItem -Force</｜｜DSML｜｜parameter>',
  '</｜｜DSML｜｜invoke>',
  '</｜｜DSML｜｜tool_calls>'
].join('\n');

test('recovers the DeepSeek full-width DSML seen in the real OpenCode session', () => {
  assert.equal(containsDsmlToolCallMarkup(dsml), true);
  const result = recoverDsmlToolCalls(dsml, new Set(['bash']));
  assert.equal(result.detected, true);
  assert.equal(result.error, null);
  assert.deepEqual(result.calls, [{
    toolId: 'bash',
    args: { command: 'Get-ChildItem -Force' }
  }]);
});

test('recovers a DSML call when DeepSeek includes normal progress text', () => {
  const result = recoverDsmlToolCalls(`I will inspect it.\n${dsml}`, new Set(['bash']));
  assert.equal(result.detected, true);
  assert.equal(result.error, null);
  assert.equal(result.content, 'I will inspect it.');
  assert.deepEqual(result.calls, [{
    toolId: 'bash',
    args: { command: 'Get-ChildItem -Force' }
  }]);
});

test('rejects a DSML tool outside the OpenCode catalog', () => {
  const result = recoverDsmlToolCalls(dsml, new Set(['read']));
  assert.equal(result.detected, true);
  assert.match(result.error, /unavailable Tool bash/i);
  assert.deepEqual(result.calls, []);
});

test('preserves OpenCode argument names and defers unknown tools to OpenCode', () => {
  const readDsml = [
    '<｜｜DSML｜｜tool_calls>',
    '<｜｜DSML｜｜invoke name="read">',
    '<｜｜DSML｜｜parameter name="filePath" string="true">C:\\workspace\\index.html</｜｜DSML｜｜parameter>',
    '<｜｜DSML｜｜parameter name="offset">20</｜｜DSML｜｜parameter>',
    '</｜｜DSML｜｜invoke>',
    '<｜｜DSML｜｜invoke name="future_mcp_tool">',
    '<｜｜DSML｜｜parameter name="taskContext" string="true">inspect</｜｜DSML｜｜parameter>',
    '</｜｜DSML｜｜invoke>',
    '</｜｜DSML｜｜tool_calls>'
  ].join('\n');
  const result = recoverDsmlToolCalls(readDsml);
  assert.equal(result.error, null);
  assert.deepEqual(result.calls, [{
    toolId: 'read',
    args: { filePath: 'C:\\workspace\\index.html', offset: 20 }
  }, {
    toolId: 'future_mcp_tool',
    args: { taskContext: 'inspect' }
  }]);
});

test('recognizes a truncated DSML marker instead of leaking it as final text', () => {
  const result = recoverDsmlToolCalls('<｜｜DSML｜｜tool_c', new Set(['bash']));
  assert.equal(result.detected, true);
  assert.match(result.error, /incomplete DSML/i);
  assert.deepEqual(result.calls, []);
});

test('context usage includes cached input and generated output', () => {
  assert.equal(openCodeMessageContextTokens({
    tokens: {
      input: 172,
      output: 106,
      reasoning: 252,
      cache: { read: 36_992, write: 128 }
    }
  }), 37_650);
});

test('workspace runs overwrite stale tool overrides with explicit active permissions', () => {
  const workspacePermission = sessionPermissionForRun({
    hasUserWorkspace: true,
    accessMode: 'full',
    permissions: { allowFileRead: true, allowFileWrite: true, allowNetwork: true }
  });
  assert.equal(workspacePermission.length > 0, true);
  assert.equal(workspacePermission.some(rule => (
    rule.permission === 'read' && rule.pattern === '*' && rule.action === 'allow'
  )), true);
  assert.equal(workspacePermission.some(rule => (
    rule.permission === 'write' && rule.pattern === '*' && rule.action === 'allow'
  )), true);
  assert.equal(workspacePermission.some(rule => (
    rule.permission === 'apply_patch' && rule.pattern === '*' && rule.action === 'allow'
  )), true);
  assert.equal(workspacePermission.some(rule => rule.permission === '*' && rule.action === 'deny'), false);

  const blankPermission = sessionPermissionForRun({
    hasUserWorkspace: false,
    accessMode: 'full',
    permissions: { allowFileRead: true, allowFileWrite: true, allowNetwork: true }
  });
  assert.equal(blankPermission.some(rule => rule.permission === 'yan_skills_*' && rule.action === 'allow'), true);
  assert.equal(blankPermission.some(rule => rule.permission === 'edit' && rule.action === 'ask'), true);
});

test('session permission rules preserve patterned policies and plan restrictions', () => {
  const skillDirectory = 'C:/YanData/skills';
  const rules = permissionRulesForRun({
    hasUserWorkspace: true,
    accessMode: 'delegate',
    workMode: 'plan',
    yanSkillDirectory: skillDirectory,
    permissions: { allowFileRead: true, allowFileWrite: true, allowNetwork: true }
  });
  assert.equal(rules.some(rule => (
    rule.permission === 'external_directory'
      && rule.pattern === skillDirectory
      && rule.action === 'allow'
  )), true);
  assert.equal(rules.some(rule => (
    rule.permission === 'bash'
      && rule.pattern === 'git status*'
      && rule.action === 'allow'
  )), true);
  assert.equal(rules.some(rule => (
    rule.permission === 'edit' && rule.pattern === '*' && rule.action === 'deny'
  )), true);
  assert.equal(rules.some(rule => (
    rule.permission === 'write' && rule.pattern === '*' && rule.action === 'deny'
  )), true);
  assert.equal(rules.some(rule => (
    rule.permission === 'apply_patch' && rule.pattern === '*' && rule.action === 'deny'
  )), true);
});

test('converts non-streaming DSML into native AI SDK tool calls', async () => {
  const { transformDsmlGenerateResult } = await providerModule;
  const result = transformDsmlGenerateResult({
    content: [{ type: 'text', text: `I will inspect it.\n${dsml}` }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: { inputTokens: 10, outputTokens: 20 }
  });

  assert.equal(result.content[0].type, 'text');
  assert.equal(result.content[0].text, 'I will inspect it.\n');
  assert.equal(result.content[1].type, 'tool-call');
  assert.equal(result.content[1].toolName, 'bash');
  assert.deepEqual(JSON.parse(result.content[1].input), { command: 'Get-ChildItem -Force' });
  assert.deepEqual(result.finishReason, { unified: 'tool-calls', raw: 'tool_calls' });
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 20 });
});

test('normalizes octet-stream file parts before OpenAI-compatible conversion', async () => {
  const { normalizeDsmlPrompt } = await providerModule;
  const prompt = [{
    role: 'user',
    content: [
      {
        type: 'file',
        mediaType: 'application/octet-stream',
        filename: 'broken.cpp',
        data: Uint8Array.from(Buffer.from('int main() { return 0; }', 'utf8'))
      },
      {
        type: 'file',
        mediaType: 'application/octet-stream',
        filename: 'diagram.png',
        data: new Uint8Array([137, 80, 78, 71])
      },
      {
        type: 'file',
        mediaType: 'application/octet-stream',
        filename: 'archive.bin',
        data: new Uint8Array([0, 1, 2, 3])
      }
    ]
  }];
  const normalized = normalizeDsmlPrompt(prompt);
  assert.equal(normalized[0].content[0].type, 'text');
  assert.equal(normalized[0].content[0].text.includes('int main'), true);
  assert.equal(normalized[0].content[1].type, 'file');
  assert.equal(normalized[0].content[1].mediaType, 'image/png');
  assert.equal(normalized[0].content[2].type, 'text');
  assert.equal(normalized[0].content[2].text.includes('archive.bin'), true);
});

test('turns source attachments into text before creating OpenCode file parts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-attachment-'));
  try {
    const source = path.join(root, 'broken.cpp');
    const image = path.join(root, 'diagram.png');
    fs.writeFileSync(source, 'int main() { return 0; }\n', 'utf8');
    fs.writeFileSync(image, Buffer.from([137, 80, 78, 71]));
    const parts = buildPromptParts({
      prompt: '编译并修复附件',
      attachments: [
        { path: source, name: 'broken.cpp', mimeType: 'application/octet-stream' },
        { path: image, name: 'diagram.png', mimeType: 'application/octet-stream' }
      ]
    });
    assert.equal(parts[1].type, 'text');
    assert.equal(parts[1].text.includes('int main'), true);
    assert.equal(parts[2].type, 'file');
    assert.equal(parts[2].mime, 'image/png');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('turns a selected directory attachment into a bounded path reference', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-directory-attachment-'));
  try {
    const parts = buildPromptParts({
      prompt: '检查这个文件夹',
      attachments: [{ path: root, name: '作业文件夹', kind: 'directory' }]
    });
    assert.equal(parts[1].type, 'text');
    assert.equal(parts[1].text.includes('[Attached directory: 作业文件夹]'), true);
    assert.equal(parts[1].text.includes(`Path: ${root}`), true);
    assert.equal(parts[1].text.includes('contents are not embedded'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('converts DSML split across stream chunks and preserves normal text', async () => {
  const { transformDsmlStream } = await providerModule;
  const readBlock = [
    '<｜｜DSML｜｜tool_calls>',
    '<｜｜DSML｜｜invoke name="read">',
    '<｜｜DSML｜｜parameter name="filePath" string="true">C:\\workspace\\index.html</｜｜DSML｜｜parameter>',
    '</｜｜DSML｜｜invoke>',
    '<｜｜DSML｜｜invoke name="bash">',
    '<｜｜DSML｜｜parameter name="command" string="true">npm start</｜｜DSML｜｜parameter>',
    '</｜｜DSML｜｜invoke>',
    '</｜｜DSML｜｜tool_calls>'
  ].join('\n');
  const splitAt = readBlock.indexOf('tool_calls') + 4;
  const input = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'txt-0' },
    { type: 'text-delta', id: 'txt-0', delta: `Inspecting now.\n${readBlock.slice(0, splitAt)}` },
    { type: 'text-delta', id: 'txt-0', delta: readBlock.slice(splitAt) },
    { type: 'text-end', id: 'txt-0' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {} }
  ];
  const source = new ReadableStream({
    start(controller) {
      for (const part of input) controller.enqueue(part);
      controller.close();
    }
  });
  const output = [];
  for await (const part of transformDsmlStream(source)) output.push(part);

  assert.equal(output.filter(part => part.type === 'text-delta').map(part => part.delta).join(''), 'Inspecting now.\n');
  const calls = output.filter(part => part.type === 'tool-call');
  assert.deepEqual(calls.map(call => call.toolName), ['read', 'bash']);
  assert.deepEqual(JSON.parse(calls[0].input), { filePath: 'C:\\workspace\\index.html' });
  assert.deepEqual(JSON.parse(calls[1].input), { command: 'npm start' });
  assert.deepEqual(output.at(-1).finishReason, { unified: 'tool-calls', raw: 'tool_calls' });
});

test('leaves an ordinary text stream unchanged in content and finish reason', async () => {
  const { transformDsmlStream } = await providerModule;
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'text-start', id: 'answer' });
      controller.enqueue({ type: 'text-delta', id: 'answer', delta: 'ordinary answer' });
      controller.enqueue({ type: 'text-end', id: 'answer' });
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {} });
      controller.close();
    }
  });
  const output = [];
  for await (const part of transformDsmlStream(source)) output.push(part);

  assert.equal(output.filter(part => part.type === 'text-delta').map(part => part.delta).join(''), 'ordinary answer');
  assert.equal(output.some(part => part.type === 'tool-call'), false);
  assert.deepEqual(output.at(-1).finishReason, { unified: 'stop', raw: 'stop' });
});

test('forwards ordinary text immediately instead of retaining a fixed tail', async () => {
  const { transformDsmlStream } = await providerModule;
  let input;
  const source = new ReadableStream({ start(controller) { input = controller; } });
  const reader = transformDsmlStream(source).getReader();
  input.enqueue({ type: 'text-start', id: 'answer' });
  input.enqueue({ type: 'text-delta', id: 'answer', delta: 'Hi' });

  const first = await Promise.race([
    reader.read(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('ordinary text was buffered')), 100))
  ]);
  const second = await reader.read();
  assert.equal(first.value.type, 'text-start');
  assert.equal(second.value.type, 'text-delta');
  assert.equal(second.value.delta, 'Hi');

  input.enqueue({ type: 'text-end', id: 'answer' });
  input.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {} });
  input.close();
  await reader.cancel();
});

test('converts DSML emitted through the DeepSeek reasoning channel', async () => {
  const { transformDsmlStream } = await providerModule;
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'reasoning-start', id: 'reasoning-0' });
      controller.enqueue({ type: 'reasoning-delta', id: 'reasoning-0', delta: dsml });
      controller.enqueue({ type: 'reasoning-end', id: 'reasoning-0' });
      controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: {} });
      controller.close();
    }
  });
  const output = [];
  for await (const part of transformDsmlStream(source)) output.push(part);

  assert.equal(output.some(part => part.type === 'reasoning-delta'), false);
  assert.equal(output.find(part => part.type === 'tool-call').toolName, 'bash');
  assert.equal(output.at(-1).finishReason.unified, 'tool-calls');
});

test('factory wraps callable and named language-model entry points', async () => {
  const { createYanDsmlProvider } = await providerModule;
  const provider = createYanDsmlProvider({
    name: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    apiKey: 'not-used'
  });
  const callableModel = provider('deepseek-v4-flash');
  const namedModel = provider.languageModel('deepseek-v4-flash');
  assert.equal(typeof callableModel.doStream, 'function');
  assert.equal(typeof callableModel.doGenerate, 'function');
  assert.equal(typeof namedModel.doStream, 'function');
  assert.equal(callableModel.modelId, 'deepseek-v4-flash');
});

test('uses the optimized local provider for OpenAI-compatible models', () => {
  const deepseek = buildOpenCodeConfig({
    providerId: 'deepseek',
    providerName: 'DeepSeek',
    modelId: 'deepseek-v4-flash',
    deepSeekProviderModule: 'file:///staged/yan-provider.mjs'
  });
  const qwen = buildOpenCodeConfig({
    providerId: 'qwen',
    providerName: 'Qwen',
    modelId: 'qwen3.5-plus',
    deepSeekProviderModule: 'file:///staged/yan-provider.mjs'
  });
  assert.equal(deepseek.provider.deepseek.npm, 'file:///staged/yan-provider.mjs');
  assert.equal(qwen.provider.qwen.npm, 'file:///staged/yan-provider.mjs');
  assert.equal(deepseek.provider.deepseek.options.yanDsmlCompatibility, true);
  assert.equal(qwen.provider.qwen.options.yanDsmlCompatibility, false);
});

test('keeps provider requests alive for slow first-token and streaming models', () => {
  const config = buildOpenCodeConfig({
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash-vision-exp'
  });
  const options = config.provider.deepseek.options;
  assert.equal(options.timeout, DEFAULT_PROVIDER_TIMEOUT_MS);
  assert.equal(options.headerTimeout, DEFAULT_PROVIDER_HEADER_TIMEOUT_MS);
  assert.equal(options.chunkTimeout, DEFAULT_PROVIDER_CHUNK_TIMEOUT_MS);
  assert.ok(options.timeout > 30_000);
  assert.ok(options.headerTimeout > 10_000);
  assert.ok(options.chunkTimeout > 15_000);
  assert.equal('yan' in config, false);
});

test('always stages the bundled provider outside the application directory', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-provider-stage-'));
  try {
    const moduleUrl = stageDeepSeekProviderModule({
      appRoot: path.resolve(__dirname, '..'),
      dataDir
    });
    const stagedPath = fileURLToPath(moduleUrl);
    assert.equal(stagedPath.startsWith(path.join(dataDir, 'opencode-runtime', 'providers')), true);
    assert.equal(fs.readFileSync(stagedPath).equals(
      fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'opencode-dsml-provider.bundle.mjs'))
    ), true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('stages an installed app.asar provider into the user runtime', () => {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-provider-asar-'));
  const packedRoot = path.join(packageRoot, 'resources', 'app.asar');
  const unpackedProvider = path.join(`${packedRoot}.unpacked`, 'lib', 'opencode-dsml-provider.bundle.mjs');
  const dataDir = path.join(packageRoot, 'data');
  try {
    fs.mkdirSync(path.dirname(unpackedProvider), { recursive: true });
    fs.writeFileSync(unpackedProvider, 'export default function provider() {}\n');
    const moduleUrl = stageDeepSeekProviderModule({ appRoot: packedRoot, dataDir });
    const stagedPath = fileURLToPath(moduleUrl);
    assert.equal(stagedPath.startsWith(path.join(dataDir, 'opencode-runtime', 'providers')), true);
    assert.doesNotMatch(moduleUrl, /app\.asar(?:\.unpacked)?/u);
    assert.equal(fs.readFileSync(stagedPath, 'utf8'), 'export default function provider() {}\n');
  } finally {
    fs.rmSync(packageRoot, { recursive: true, force: true });
  }
});

test('repairs a corrupted provider in the content-addressed runtime cache', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-provider-repair-'));
  try {
    const options = { appRoot: path.resolve(__dirname, '..'), dataDir };
    const moduleUrl = stageDeepSeekProviderModule(options);
    const stagedPath = fileURLToPath(moduleUrl);
    fs.writeFileSync(stagedPath, 'corrupted provider');
    assert.equal(stageDeepSeekProviderModule(options), moduleUrl);
    assert.equal(fs.readFileSync(stagedPath).equals(
      fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'opencode-dsml-provider.bundle.mjs'))
    ), true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('recognizes the DeepSeek experimental vision model as image-capable', () => {
  const capabilities = resolveModelCapabilities('deepseek', {
    id: 'deepseek-v4-flash-vision-exp'
  });
  assert.equal(capabilities.vision, true);
  assert.equal(capabilities.imageInput, true);
  assert.equal(capabilities.modelType, 'text');
  assert.deepEqual(capabilities.imageMimeTypes, ['image/png', 'image/jpeg']);
});

test('configures Anthropic-compatible gateways with the native provider', () => {
  const config = buildOpenCodeConfig({
    providerId: 'custom-ark',
    providerName: '火山方舟',
    modelId: 'kimi-k2.7-code',
    apiFormat: 'anthropic',
    baseUrl: 'https://ark.example.com',
    apiKey: 'secret-key'
  });
  assert.equal(config.provider['custom-ark'].npm, '@ai-sdk/anthropic');
  assert.equal(config.provider['custom-ark'].options.baseURL, 'https://ark.example.com/v1');
  assert.equal(config.provider['custom-ark'].options.headers.Authorization, 'Bearer secret-key');
  assert.equal('yanDsmlCompatibility' in config.provider['custom-ark'].options, false);
});

test('provider fetch leaves non-stream responses untouched', async () => {
  const { createYanProviderFetch } = await providerModule;
  const original = new Response('{"ok":true}', {
    status: 201,
    headers: { 'content-type': 'application/json' }
  });
  const optimizedFetch = createYanProviderFetch(async () => original);
  const result = await optimizedFetch('https://example.test');
  assert.equal(result, original);
  assert.equal(await result.text(), '{"ok":true}');
});

test('provider fetch normalizes non-stream native tool-call ids', async () => {
  const { createYanProviderFetch } = await providerModule;
  const original = new Response(JSON.stringify({
    choices: [{
      message: {
        role: 'assistant',
        tool_calls: [
          { id: 7, function: { name: 'generate_image', arguments: '{}' } },
          { function: { name: 'read', arguments: '{}' } }
        ]
      }
    }]
  }), {
    headers: { 'content-type': 'application/json' }
  });
  const result = await createYanProviderFetch(async () => original)('https://example.test');
  const payload = await result.json();
  const ids = payload.choices[0].message.tool_calls.map(call => call.id);
  assert.equal(ids[0], '7');
  assert.equal(typeof ids[1], 'string');
  assert.ok(ids[1].length > 0);
});

test('provider fetch preserves ordinary fragmented SSE streams', async () => {
  const { createYanProviderFetch } = await providerModule;
  const chunks = [
    { id: 'chat-plain', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '你' }, finish_reason: null }] },
    { id: 'chat-plain', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '好' }, finish_reason: null }] },
    { id: 'chat-plain', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
  ];
  const source = `${chunks.map(sseBlock).join('')}data: [DONE]\n\n`;
  const optimizedFetch = createYanProviderFetch(async () => fragmentedSseResponse(source, 1));
  const response = await optimizedFetch('https://example.test');
  const output = parseSseOutput(await response.text());
  assert.deepEqual(output, [...chunks, '[DONE]']);
  assert.equal(response.headers.has('content-length'), false);
});

test('provider fetch coalesces large native tool arguments before SDK parsing', async () => {
  const { createYanProviderFetch } = await providerModule;
  const writeArguments = JSON.stringify({
    filePath: 'C:\\workspace\\large.js',
    content: 'const value = "测试🚀";\n'.repeat(2_048)
  });
  const bashArguments = JSON.stringify({ command: 'node --check C:\\workspace\\large.js' });
  const argumentFragments = writeArguments.match(/[\s\S]{1,47}/gu);
  const chunks = [
    { id: 'chat-tools', object: 'chat.completion.chunk', created: 7, model: 'test-model', choices: [{ index: 0, delta: { content: 'Writing now.' }, finish_reason: null }] },
    ...argumentFragments.map((fragment, index) => ({
      id: 'chat-tools',
      object: 'chat.completion.chunk',
      created: 7,
      model: 'test-model',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            ...(index === 0 ? { id: 'call-write', type: 'function' } : {}),
            function: {
              ...(index === 0 ? { name: 'write' } : {}),
              arguments: fragment
            }
          }]
        },
        finish_reason: null
      }]
    })),
    {
      id: 'chat-tools',
      object: 'chat.completion.chunk',
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 1, id: 'call-bash', type: 'function', function: { name: 'bash', arguments: bashArguments } }] },
        finish_reason: null
      }]
    },
    { id: 'chat-tools', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    { id: 'chat-tools', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }
  ];
  const source = `${chunks.map(sseBlock).join('')}data: [DONE]\n\n`;
  const optimizedFetch = createYanProviderFetch(async () => fragmentedSseResponse(source, 13));
  const output = parseSseOutput(await (await optimizedFetch('https://example.test')).text());
  const toolChunks = output.filter(item => item !== '[DONE]' && item.choices?.some(choice => choice.delta?.tool_calls));
  assert.equal(toolChunks.length, 1);
  const calls = toolChunks[0].choices[0].delta.tool_calls;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].function.name, 'write');
  assert.equal(calls[0].function.arguments, writeArguments);
  assert.deepEqual(JSON.parse(calls[0].function.arguments), JSON.parse(writeArguments));
  assert.equal(calls[1].function.name, 'bash');
  assert.equal(calls[1].function.arguments, bashArguments);
  assert.equal(output.filter(item => item !== '[DONE]' && item.choices?.[0]?.delta?.content).length, 1);
  const toolIndex = output.indexOf(toolChunks[0]);
  const finishIndex = output.findIndex(item => item !== '[DONE]' && item.choices?.some(choice => choice.finish_reason === 'tool_calls'));
  const usageIndex = output.findIndex(item => item !== '[DONE]' && item.usage);
  assert.ok(toolIndex < finishIndex);
  assert.ok(finishIndex < usageIndex);
  assert.equal(output.at(-1), '[DONE]');
});

test('provider fetch repairs missing and non-string native tool-call ids', async () => {
  const { createYanProviderFetch } = await providerModule;
  const chunks = [
    {
      id: 'chat-image-follow-up',
      object: 'chat.completion.chunk',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            function: { name: 'generate_image', arguments: '{"prompt":"狐狸"}' }
          }]
        },
        finish_reason: null
      }]
    },
    {
      id: 'chat-image-follow-up',
      object: 'chat.completion.chunk',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 1,
            id: 42,
            function: { name: 'read', arguments: '{"path":"image.png"}' }
          }]
        },
        finish_reason: null
      }]
    },
    {
      id: 'chat-image-follow-up',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
    }
  ];
  const source = `${chunks.map(sseBlock).join('')}data: [DONE]\n\n`;
  const response = await createYanProviderFetch(async () => fragmentedSseResponse(source, 5))('https://example.test');
  const output = parseSseOutput(await response.text());
  const toolChunk = output.find(item => item !== '[DONE]' && item.choices?.some(choice => choice.delta?.tool_calls));
  assert.ok(toolChunk);
  const calls = toolChunk.choices[0].delta.tool_calls;
  assert.equal(calls.length, 2);
  assert.equal(typeof calls[0].id, 'string');
  assert.ok(calls[0].id.length > 0);
  assert.equal(calls[1].id, '42');
  assert.equal(output.at(-1), '[DONE]');
});

test('provider fetch flushes a tool call when an SSE stream ends without DONE', async () => {
  const { createYanProviderFetch } = await providerModule;
  const args = '{"filePath":"a.js","content":"ok"}';
  const source = sseBlock({
    id: 'chat-no-done',
    object: 'chat.completion.chunk',
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'write', arguments: args } }] },
      finish_reason: 'tool_calls'
    }]
  });
  const optimizedFetch = createYanProviderFetch(async () => fragmentedSseResponse(source, 7));
  const output = parseSseOutput(await (await optimizedFetch('https://example.test')).text());
  assert.equal(output[0].choices[0].delta.tool_calls[0].function.arguments, args);
  assert.equal(output[1].choices[0].finish_reason, 'tool_calls');
});

test('optimized provider presents one complete tool call to the AI SDK', async () => {
  const { createYanDsmlProvider } = await providerModule;
  const args = JSON.stringify({
    filePath: 'C:\\workspace\\snake.js',
    content: 'const snake = "测试";\n'.repeat(256)
  });
  const fragments = args.match(/[\s\S]{1,23}/gu);
  const source = `${fragments.map((fragment, index) => sseBlock({
    id: 'chat-sdk',
    object: 'chat.completion.chunk',
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          ...(index === 0 ? { id: 'call-sdk', type: 'function' } : {}),
          function: {
            ...(index === 0 ? { name: 'write' } : {}),
            arguments: fragment
          }
        }]
      },
      finish_reason: null
    }]
  })).join('')}data: ${JSON.stringify({
    id: 'chat-sdk',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
  })}\n\ndata: [DONE]\n\n`;
  const provider = createYanDsmlProvider({
    baseURL: 'https://example.test/v1',
    apiKey: 'test',
    yanDsmlCompatibility: false,
    fetch: async () => fragmentedSseResponse(source, 5)
  });
  const result = await provider('test-model').doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'write a file' }] }],
    tools: [{
      type: 'function',
      name: 'write',
      description: 'Write a file',
      inputSchema: { type: 'object', properties: {}, additionalProperties: true }
    }]
  });
  const parts = [];
  for await (const part of result.stream) parts.push(part);
  const calls = parts.filter(part => part.type === 'tool-call');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolCallId, 'call-sdk');
  assert.equal(calls[0].toolName, 'write');
  assert.equal(calls[0].input, args);
  assert.deepEqual(JSON.parse(calls[0].input), JSON.parse(args));
  assert.equal(parts.at(-1).type, 'finish');
});

test('bounds provider reservation and tool output for stable multi-step prefill', () => {
  const config = buildOpenCodeConfig({
    providerId: 'openai',
    modelId: 'gpt-5.6-sol',
    capabilities: { contextWindow: 1_000_000, maxOutputTokens: 384_000 },
    mcpServers: [
      { id: 'zeta', command: 'zeta', enabled: true },
      { id: 'alpha', command: 'alpha', enabled: true }
    ]
  });
  assert.equal(config.provider.openai.models['gpt-5.6-sol'].limit.output, 32_768);
  assert.equal(config.provider.openai.models['gpt-5.6-sol'].limit.context, 1_000_000);
  assert.deepEqual(config.tool_output, { max_lines: 800, max_bytes: 98_304 });
  assert.equal(config.compaction.preserve_recent_tokens, 24_000);
  assert.deepEqual(Object.keys(config.mcp), ['alpha', 'zeta']);
  assert.equal('yan' in config, false);
  assert.equal('yanInputTokensPerSecond' in config.provider.openai.options, false);
  assert.equal('yanInputThroughputBaseline' in config.provider.openai.options, false);
});

test('preserves nested OpenCode validation details', () => {
  assert.equal(openCodeErrorDetail({
    error: {
      name: 'ConfigInvalidError',
      data: { message: 'Unrecognized key: yan' }
    }
  }), 'ConfigInvalidError: Unrecognized key: yan');
});
