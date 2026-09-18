'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { buildOpenCodeConfig, stageGlmmProviderModule } = require('../lib/opencode-sidecar');
const { inferConnectionPreset, resolveConnectionApiFormat } = require('../lib/connection-presets');
const { resolveReasoningForModel } = require('../lib/reasoning-effort');
const providerModule = import('../lib/opencode-glmm-provider.mjs');
const parserModule = import('../lib/glmm-tool-call.mjs');
const shapingModule = import('../lib/glmm-request-shaping.mjs');
const schema = { type: 'object', properties: {
  filePath: { type: 'string' }, content: { type: 'string' }, count: { type: 'integer' },
  enabled: { type: 'boolean' }, items: { type: 'array' }, data: { type: 'object' }, nil: { type: 'null' }
} };
const options = { tools: [{ type: 'function', name: 'write', inputSchema: schema }] };
const call = (args, name = 'write') => '<tool_call>' + name + Object.entries(args).map(([key, value]) =>
  '<arg_key>' + key + '</arg_key><arg_value>' + (typeof value === 'string' ? value : JSON.stringify(value))
    + '</arg_value>').join('') + '</tool_call>';
const result = text => ({ content: [{ type: 'text', text }], finishReason: 'stop' });

async function streamText(text, width = 1, extra = []) {
  const { transformGlmmStream } = await providerModule;
  const events = [{ type: 'text-start', id: 'answer' }];
  for (let i = 0; i < text.length; i += width) events.push({ type: 'text-delta', id: 'answer', delta: text.slice(i, i + width) });
  events.push({ type: 'text-end', id: 'answer' }, ...extra,
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 2 } });
  return Array.fromAsync(transformGlmmStream(ReadableStream.from(events), options));
}

test('GLMM uses schema types and preserves raw strings from the official template', async () => {
  const { transformGlmmGenerateResult } = await providerModule;
  const args = { filePath: 'C:\\work\\new.txt', content: '  true\n{"a": 1} &amp; <div>\n',
    count: 12, enabled: false, items: ['a', 2], data: { nested: true }, nil: null };
  const converted = transformGlmmGenerateResult(result('Before\n' + call(args) + '\nAfter'), options);
  assert.deepEqual(JSON.parse(converted.content.find(p => p.type === 'tool-call').input), args);
  assert.equal(converted.finishReason, 'tool-calls');
  assert.equal(converted.content.filter(p => p.type === 'text').map(p => p.text).join(''), 'Before\n\nAfter');
});

test('GLMM never treats JSON-looking string arguments as numbers or objects', async () => {
  const { transformGlmmGenerateResult } = await providerModule;
  for (const content of ['123', 'true', 'null', '{"x":1}', '"quoted"', '', '  padded  ']) {
    const converted = transformGlmmGenerateResult(result(call({ content })), options);
    assert.equal(JSON.parse(converted.content[0].input).content, content);
  }
});

test('every chunk boundary retains arguments and one consistent tool lifecycle', async () => {
  const args = { filePath: 'demo.txt', content: 'literal </tool_call> and </arg_value> in source\nend' };
  const text = 'Start\n' + call(args) + '\nFinish';
  for (const width of [1, 2, 7, 19, text.length]) {
    const events = await streamText(text, width);
    const starts = events.filter(p => p.type === 'tool-input-start');
    const calls = events.filter(p => p.type === 'tool-call');
    assert.equal(starts.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(starts[0].id, calls[0].toolCallId);
    assert.equal(events.filter(p => p.type === 'tool-input-end')[0].id, starts[0].id);
    assert.deepEqual(JSON.parse(calls[0].input), args);
    assert.equal(events.filter(p => p.type === 'text-delta').map(p => p.delta).join(''), 'Start\n\nFinish');
    assert.equal(events.at(-1).finishReason.unified, 'tool-calls');
    assert.deepEqual(events.at(-1).usage, { inputTokens: 2 });
  }
});

test('tool card starts before the argument or closing call is generated', async () => {
  const { GlmmTextDecoder, glmmToolCatalog } = await parserModule;
  const decoder = new GlmmTextDecoder(glmmToolCatalog(options));
  const events = decoder.push('<tool_call>write<arg_key>content</arg_key><arg_value>');
  assert.equal(events.filter(p => p.type === 'tool-input-start').length, 1);
  assert.equal(events.some(p => p.type === 'calls'), false);
});

test('quoted examples remain visible and only the unquoted call executes', async () => {
  const quoted = 'Use `<tool_call>` or ``<tool_call>write``.\n```xml\n' + call({ content: 'example' })
    + '\n```\n~~~xml\n<tool_call>\n~~~\n';
  const events = await streamText(quoted + call({ content: 'actual' }));
  assert.equal(events.filter(p => p.type === 'tool-call').length, 1);
  assert.equal(events.filter(p => p.type === 'text-delta').map(p => p.delta).join(''), quoted);
});

test('reasoning is never interpreted as a command and is preserved verbatim', async () => {
  const { transformGlmmGenerateResult, transformGlmmStream } = await providerModule;
  const reasoning = '<tool_call>write<arg_key>content</arg_key><arg_value>considering this';
  const part = { type: 'reasoning', text: reasoning, providerMetadata: { test: {} } };
  assert.deepEqual(transformGlmmGenerateResult({ content: [part] }, options).content, [part]);
  const events = [ { type: 'reasoning-start', id: 'r' }, ...Array.from(reasoning, delta =>
    ({ type: 'reasoning-delta', id: 'r', delta })), { type: 'reasoning-end', id: 'r' } ];
  assert.deepEqual(await Array.fromAsync(transformGlmmStream(ReadableStream.from(events), options)), events);
});

test('multiple calls support no arguments and preserve names exactly, including MCP tools', async () => {
  const { transformGlmmGenerateResult } = await providerModule;
  const names = ['ping', 'yan_skills_read_skill', 'mcp.tools.read'];
  const converted = transformGlmmGenerateResult(result(names.map(name => call({}, name)).join('\n')),
    { tools: names.map(name => ({ name, inputSchema: {} })) });
  assert.deepEqual(converted.content.filter(p => p.type === 'tool-call').map(p => p.toolName), names);
});

test('malformed, incomplete, disabled and over-budget calls fail explicitly', async () => {
  const { transformGlmmGenerateResult } = await providerModule;
  const { MAX_GLMM_BYTES } = await parserModule;
  for (const text of ['<tool_call>', '<tool_call', '<tool_call>write',
    '<tool_call>write<arg_key>x</arg_key></tool_call>',
    '<tool_call>write<arg_key>x</arg_key><arg_value>unfinished',
    call({ count: 'oops' }), call({}, 'unknown'), call({}, 'write').repeat(65),
    call({ content: 'x'.repeat(MAX_GLMM_BYTES) }),
    '<tool_call>write<arg_key>content</arg_key><arg_value>a</arg_value><arg_key>content</arg_key><arg_value>b</arg_value></tool_call>']) {
    assert.throws(() => transformGlmmGenerateResult(result(text), options), /GLMM compatibility failed/);
  }
  assert.throws(() => transformGlmmGenerateResult(result(call({})), { tools: [] }), /disabled tool/);
  assert.throws(() => transformGlmmGenerateResult(result(call({})), { ...options, toolChoice: { type: 'none' } }), /disabled tool/);
  const failed = await streamText('<tool_call>write<arg_key>content</arg_key><arg_value>x');
  assert.match(failed.find(part => part.type === 'error').error.message, /Incomplete Tool Call/);
  assert.equal(failed.some(part => part.type === 'finish'), false);
});

test('unknown child catalog defers names to the kernel; $ref schema preserves strings', async () => {
  const { transformGlmmGenerateResult } = await providerModule;
  assert.equal(transformGlmmGenerateResult(result(call({}, 'dynamic_child_tool'))).content[0].toolName, 'dynamic_child_tool');
  const inputSchema = { properties: { content: { $ref: '#/$defs/text' } }, $defs: { text: { type: 'string' } } };
  const converted = transformGlmmGenerateResult(result(call({ content: '123' })), { tools: [{ name: 'write', inputSchema }] });
  assert.equal(JSON.parse(converted.content[0].input).content, '123');
});

test('native tool calls pass through without duplicate events', async () => {
  const native = { type: 'tool-call', toolCallId: 'native-1', toolName: 'write', input: '{}' };
  const events = await streamText('Ready', 1, [native]);
  assert.deepEqual(events.filter(p => p.type === 'tool-call'), [native]);
});

test('cancelling an incomplete streamed call propagates without inventing a protocol error', async () => {
  const { transformGlmmStream } = await providerModule;
  let onCancel;
  const cancelled = new Promise(resolve => { onCancel = resolve; });
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'text-delta', id: 't', delta: '<tool_call>write<arg_key>content</arg_key><arg_value>' });
    },
    cancel(reason) { onCancel(reason); }
  });
  const reader = transformGlmmStream(source, options).getReader();
  assert.equal((await reader.read()).value.type, 'tool-input-start');
  const pending = reader.read();
  await reader.cancel('user cancelled');
  assert.equal((await pending).done, true);
  assert.equal(await cancelled, 'user cancelled');
});

test('GLM 5.3 constraints do not guess the protocol of future/older versions', async () => {
  const { shapeGlmmRequestBody } = await shapingModule;
  for (const model of ['glm-5.3', 'glm-5.3-flash', 'zai-org/GLM-5.3-BF16', 'glm-5.3[1m]']) {
    const body = shapeGlmmRequestBody({ model, thinking: { type: 'disabled', clear_thinking: false }, reasoning_effort: 'medium' });
    assert.deepEqual(body.thinking, { type: 'enabled', clear_thinking: false });
    assert.equal(body.reasoning_effort, 'high');
    assert.equal(shapeGlmmRequestBody({ model, reasoning_effort: 'xhigh' }).reasoning_effort, 'max');
    assert.equal(shapeGlmmRequestBody({ model, thinking: { type: 'disabled' } }).reasoning_effort, 'low');
    assert.equal(resolveReasoningForModel(model, 'medium').effort, 'high');
  }
  for (const model of ['glm-4.7', 'glm-5.4', 'glm-6', 'glm-5.30', 'custom-alias']) {
    const body = { model, thinking: { type: 'disabled' }, reasoning_effort: 'medium', future_option: true };
    assert.deepEqual(shapeGlmmRequestBody(body), body);
  }
  const streaming = shapeGlmmRequestBody({ model: 'glm-5.3-flash', stream: true, tools: [{}] });
  assert.equal(streaming.tool_stream, true);
  assert.equal(streaming.thinking.clear_thinking, false);
  const explicit = shapeGlmmRequestBody({ model: 'glm-5.3', stream: true, tools: [{}],
    tool_stream: false, thinking: { clear_thinking: true } });
  assert.equal(explicit.tool_stream, false);
  assert.equal(explicit.thinking.clear_thinking, true);
  const disabled = shapeGlmmRequestBody({ model: 'glm-5.3', tools: [{}], stream: true, tool_choice: 'none' });
  assert.equal(disabled.tools, undefined);
  assert.equal(disabled.tool_choice, undefined);
  assert.equal(disabled.tool_stream, undefined);
});

test('GLM 5.3 Flash forwards normalized image attachments to the native API', async () => {
  const { createYanGlmmProvider } = await providerModule;
  let body;
  const provider = createYanGlmmProvider({ name: 'glm', baseURL: 'https://gateway.invalid/v1', fetch: async (_, init) => {
    body = JSON.parse(init.body);
    return Response.json({ id: 'image-test', created: 1, model: 'glm-5.3-flash', choices: [{ index: 0,
      finish_reason: 'stop', message: { role: 'assistant', content: 'image received' } }] });
  } });
  await provider('glm-5.3-flash').doGenerate({ prompt: [{ role: 'user', content: [
    { type: 'text', text: 'Inspect the image' },
    { type: 'file', filename: 'screen.png', mediaType: 'application/octet-stream', data: new Uint8Array([1, 2, 3]) }
  ] }] });
  assert.deepEqual(body.messages[0].content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } });
});

test('provider preserves reasoning history, native tool ids and GLM aliases on the wire', async () => {
  const { createYanGlmmProvider } = await providerModule;
  const bodies = [];
  const provider = createYanGlmmProvider({ name: 'custom', baseURL: 'https://gateway.invalid/v1', fetch: async (_, init) => {
    bodies.push(JSON.parse(init.body));
    return Response.json({ id: 'test', created: 1, model: 'glm-5.3', choices: [{ index: 0, finish_reason: 'tool_calls',
      message: { role: 'assistant', reasoning_content: 'exact reasoning\n', content: null,
        tool_calls: [{ id: 123, type: 'function', function: { name: 'write', arguments: '{}' } }] } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } });
  } });
  const prompt = [{ role: 'assistant', content: [{ type: 'reasoning', text: '  Reason\n' },
    { type: 'reasoning', text: 'Then\n' }, { type: 'tool-call', toolCallId: 'old', toolName: 'write', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'old', toolName: 'write', output: { type: 'text', value: 'ok' } }] }];
  for (const model of ['glm-5.3', 'gpt-5-alias']) {
    const generated = await provider.languageModel(model).doGenerate({ ...options, prompt,
      providerOptions: { custom: { reasoningEffort: 'max', thinking: { type: 'enabled', clear_thinking: false } } },
      maxOutputTokens: 1234, temperature: 0.7 });
    assert.equal(generated.content.find(p => p.type === 'tool-call').toolCallId, '123');
    assert.equal(generated.content.find(p => p.type === 'reasoning').text, 'exact reasoning\n');
    const body = bodies.at(-1);
    assert.equal(body.messages[0].reasoning_content, '  Reason\nThen\n');
    assert.equal(body.messages[1].tool_call_id, 'old');
    assert.equal(body.max_tokens, 1234);
    assert.equal(body.temperature, 0.7);
    assert.equal(body.reasoning_effort, 'max');
  }
});

test('GLMM routes by preset, model and endpoint without a model allowlist', () => {
  for (const selection of [
    { providerId: 'glm', modelId: 'glm-5.3' },
    { providerId: 'conn-relay', modelId: 'glm-5.3-flash' },
    { providerId: 'relay', modelId: 'zai-org/GLM-6-future' },
    { providerId: 'conn', modelId: 'alias', glmm: true },
    { providerId: 'conn', modelId: 'alias', baseUrl: 'https://api.z.ai/api/coding/paas/v4' }
  ]) {
    const config = buildOpenCodeConfig(selection).provider[selection.providerId];
    assert.match(config.npm, /opencode-glmm-provider/);
    assert.equal(config.options.yanGlmmCompatibility, true);
    assert.deepEqual(config.models[selection.modelId].interleaved, { field: 'reasoning_content' });
  }
  const explicit = buildOpenCodeConfig({ providerId: 'glm', modelId: 'glm-5.3', glmm: false }).provider.glm;
  assert.equal(explicit.options.yanDsmlCompatibility, false);
  assert.match(explicit.npm, /dsml-provider/);
  for (const apiFormat of ['anthropic', 'responses']) {
    const provider = buildOpenCodeConfig({ providerId: 'glm', modelId: 'glm-5.3', apiFormat,
      responsesProviderModule: 'file:///responses.mjs' }).provider.glm;
    assert.equal(provider.npm, apiFormat === 'anthropic' ? '@ai-sdk/anthropic' : 'file:///responses.mjs');
    assert.equal(provider.options.yanGlmmCompatibility, undefined);
  }
  assert.equal(inferConnectionPreset('Z.AI', ''), 'glm');
  assert.equal(inferConnectionPreset('', 'https://open.bigmodel.cn/api/anthropic'), 'glm');
  assert.equal(resolveConnectionApiFormat({}, '', 'https://open.bigmodel.cn/api/anthropic'), 'anthropic');
});

test('staging GLMM is content-addressed, self-contained and repairs corrupt cache', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-glmm-stage-'));
  try {
    const location = stageGlmmProviderModule({ appRoot: path.resolve(__dirname, '..'), dataDir: directory });
    const staged = fileURLToPath(location);
    const source = fs.readFileSync(staged);
    const { createYanGlmmProvider } = await import(location);
    assert.equal(typeof createYanGlmmProvider, 'function');
    fs.writeFileSync(staged, 'corrupt');
    assert.equal(stageGlmmProviderModule({ appRoot: path.resolve(__dirname, '..'), dataDir: directory }), location);
    assert.deepEqual(fs.readFileSync(staged), source);
    const packedRoot = path.join(directory, 'resources', 'app.asar');
    const unpacked = path.join(packedRoot + '.unpacked', 'lib', 'opencode-glmm-provider.bundle.mjs');
    fs.mkdirSync(path.dirname(unpacked), { recursive: true });
    fs.writeFileSync(unpacked, source);
    const fromPackage = stageGlmmProviderModule({ appRoot: packedRoot, dataDir: path.join(directory, 'installed-data') });
    assert.doesNotMatch(fromPackage, /app\.asar/);
    assert.deepEqual(fs.readFileSync(fileURLToPath(fromPackage)), source);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('yan-glmm-stage-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
