'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  containsDsmlToolCallMarkup,
  recoverDsmlToolCalls
} = require('../lib/dsml-tool-call');
const {
  buildOpenCodeConfig,
  permissionRulesForRun,
  sessionPermissionForRun,
  openCodeMessageContextTokens,
  buildPromptParts
} = require('../lib/opencode-sidecar');

const providerModule = import('../lib/opencode-dsml-provider.mjs');

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

test('selects the local DSML provider only for DeepSeek models', () => {
  const deepseek = buildOpenCodeConfig({
    providerId: 'deepseek',
    providerName: 'DeepSeek',
    modelId: 'deepseek-v4-flash'
  });
  const qwen = buildOpenCodeConfig({
    providerId: 'qwen',
    providerName: 'Qwen',
    modelId: 'qwen3.5-plus'
  });
  assert.match(deepseek.provider.deepseek.npm, /^file:\/\//);
  assert.match(deepseek.provider.deepseek.npm, /opencode-dsml-provider\.mjs$/);
  assert.equal(qwen.provider.qwen.npm, '@ai-sdk/openai-compatible');
});
