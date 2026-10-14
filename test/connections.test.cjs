'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  API_FORMATS,
  CONNECTION_PRESETS,
  apiFormatForPreset,
  applyConnectionModelFlags,
  inferConnectionPreset,
  inferPresetFromModel,
  normalizeApiFormat,
  normalizeConnectionStore,
  normalizeModelFlags,
  resolveConnectionApiFormat,
  resolveConnectionPreset
} = require('../lib/connection-presets');
const { decorateModels } = require('../lib/model-capabilities');

test('preset inference maps names and URLs to adapter shapes', () => {
  assert.equal(inferConnectionPreset('DeepSeek 官方', 'https://api.deepseek.com'), 'deepseek');
  assert.equal(inferConnectionPreset('我的中转', 'https://api.deepseek.com/v1'), 'deepseek');
  assert.equal(inferConnectionPreset('Claude 中转', 'https://relay.example.com'), 'anthropic');
  assert.equal(inferConnectionPreset('通义', 'https://dashscope.aliyuncs.com/compatible-mode/v1'), 'qwen');
  assert.equal(inferConnectionPreset('智谱', 'https://open.bigmodel.cn/api/paas/v4'), 'glm');
  assert.equal(inferConnectionPreset('豆包', 'https://ark.cn-beijing.volces.com/api/v3'), 'doubao');
  assert.equal(inferConnectionPreset('MiniMax', 'https://api.minimax.chat/v1'), 'minimax');
  assert.equal(inferConnectionPreset('硅基', 'https://api.siliconflow.cn/v1'), 'siliconflow');
  assert.equal(inferConnectionPreset('Grok', 'https://api.x.ai/v1'), 'grok');
  assert.equal(inferConnectionPreset('Agnes', 'https://apihub.agnes-ai.com/v1'), 'agnes');
  assert.equal(inferConnectionPreset('Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'), 'gemini');
  assert.equal(inferConnectionPreset('Kimi 官方', 'https://api.moonshot.cn/v1'), 'kimi');
  assert.equal(inferConnectionPreset('混元', 'https://api.hunyuan.cloud.tencent.com/v1'), 'hunyuan');
  assert.equal(inferConnectionPreset('OpenCode Zen', 'https://opencode.ai/zen/v1'), 'opencode');
  assert.equal(inferConnectionPreset('日日新', 'https://api.sensenova.cn/v1'), 'sensenova');
  assert.equal(inferConnectionPreset('随便一个网关', 'https://api.example.com/v1'), 'openai');
  assert.equal(inferConnectionPreset('', ''), 'openai');
});

test('a manual preset overrides inference; auto defers to it', () => {
  assert.equal(resolveConnectionPreset({ preset: 'glm' }, 'OpenAI 官方', 'https://api.openai.com/v1'), 'glm');
  assert.equal(resolveConnectionPreset({ preset: 'auto' }, 'DeepSeek', 'https://x'), 'deepseek');
  assert.equal(resolveConnectionPreset({}, '中转', 'https://api.example.com'), 'openai');
  assert.equal(resolveConnectionPreset({ preset: 'not-a-preset' }, 'DeepSeek', ''), 'deepseek');
  assert.equal(apiFormatForPreset('anthropic'), 'anthropic');
  assert.equal(apiFormatForPreset('deepseek'), 'openai');
  assert.equal(apiFormatForPreset(''), 'openai');
});

test('MiMo and OpenCode Go/Zen presets survive saving and use existing protocol selection', () => {
  const { resolveProviderAdapter } = require('../lib/provider-adapter-routing');
  for (const preset of ['mimo', 'opencode-go', 'opencode-zen']) {
    const [connection] = normalizeConnectionStore([{ id: 'conn-test', providerId: 'conn-test', preset }]);
    assert.equal(connection.preset, preset);
    assert.equal(resolveConnectionPreset(connection, 'DeepSeek relay', 'https://relay.example/v1', 'glm-4.6'), preset);
    assert.equal(resolveConnectionApiFormat(connection, '', 'https://relay.example/v1'), 'openai');
    assert.equal(resolveConnectionApiFormat({ ...connection, apiFormat: 'anthropic' }, '', ''), 'anthropic');
    assert.equal(resolveConnectionApiFormat({ ...connection, apiFormat: 'responses' }, '', ''), 'responses');
    assert.equal(resolveProviderAdapter({}, { providerID: 'conn-test', providerName: preset, modelID: 'custom-model', baseURL: 'https://relay.example/v1' }), '');
  }
  assert.equal(normalizeConnectionStore([{ id: 'old', providerId: 'conn-old', preset: 'opencode' }])[0].preset, 'opencode');
});

test('an explicit api format overrides preset inference, including responses', () => {
  assert.equal(normalizeApiFormat('Responses'), 'responses');
  assert.equal(normalizeApiFormat('ANTHROPIC'), 'anthropic');
  assert.equal(normalizeApiFormat('weird'), 'auto');
  assert.ok(API_FORMATS.includes('responses'));
  assert.equal(
    resolveConnectionApiFormat({ preset: 'anthropic', apiFormat: 'responses' }, '中转', 'https://x'),
    'responses'
  );
  assert.equal(
    resolveConnectionApiFormat({ preset: 'anthropic' }, '中转', 'https://x'),
    'anthropic'
  );
  assert.equal(
    resolveConnectionApiFormat({ preset: 'auto', apiFormat: 'auto' }, 'Claude 中转', 'https://relay.example.com'),
    'anthropic'
  );
  assert.equal(
    resolveConnectionApiFormat({ preset: 'openai' }, '普通中转', 'https://x'),
    'openai'
  );
});

test('normalizeConnectionStore drops junk, dedupes ids, and keeps fields tight', () => {
  const cleaned = normalizeConnectionStore([
    null,
    'nope',
    { id: 'conn-a', providerId: 'deepseek', supplierId: 'official', preset: 'deepseek', manualModelId: '  ', createdAt: 123 },
    { id: 'conn-a', providerId: 'duplicate', supplierId: 'official' },
    { id: '', providerId: 'no-id' },
    { providerId: 'no-conn-id' },
    { id: 'conn-b', providerId: 'conn-b', preset: 'weird', apiFormat: 'responses', manualModelId: 'm1', createdAt: 'x' }
  ]);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[0].id, 'conn-a');
  assert.equal(cleaned[0].preset, 'deepseek');
  assert.equal(cleaned[0].manualModelId, '');
  assert.equal(cleaned[0].supplierId, 'official');
  assert.equal(cleaned[0].apiFormat, 'auto');
  assert.equal(cleaned[1].id, 'conn-b');
  assert.equal(cleaned[1].preset, 'auto');
  assert.equal(cleaned[1].apiFormat, 'responses');
  assert.equal(cleaned[1].manualModelId, 'm1');
  assert.equal(cleaned[1].createdAt, 0);
  assert.deepEqual(normalizeConnectionStore('junk'), []);
  assert.ok(CONNECTION_PRESETS.includes('auto'));
  assert.ok(CONNECTION_PRESETS.includes('grok'));
  assert.ok(CONNECTION_PRESETS.includes('agnes'));
  for (const preset of ['gemini', 'kimi', 'hunyuan', 'opencode', 'sensenova', 'jiyuan']) {
    assert.ok(CONNECTION_PRESETS.includes(preset));
  }
  assert.equal(inferConnectionPreset('基元律动', 'https://api.example.com/v1'), 'jiyuan');
});

// ---------------------------------------------------------------------------
// 自动识别 must follow the model the user selected, not the connection alone.
// A relay (中转站) fronts several vendors behind one base URL, and its name is
// arbitrary, so "auto" has to answer per model.
// ---------------------------------------------------------------------------

test('the selected model identifies the vendor family', () => {
  assert.equal(inferPresetFromModel('glm-4.6'), 'glm');
  assert.equal(inferPresetFromModel('glm-4.5-air'), 'glm');
  assert.equal(inferPresetFromModel('chatglm3-6b'), 'glm');
  assert.equal(inferPresetFromModel('deepseek-chat'), 'deepseek');
  assert.equal(inferPresetFromModel('deepseek-v3.1'), 'deepseek');
  assert.equal(inferPresetFromModel('qwen3-max'), 'qwen');
  assert.equal(inferPresetFromModel('qwq-32b'), 'qwen');
  assert.equal(inferPresetFromModel('kimi-k2-0905-preview'), 'kimi');
  assert.equal(inferPresetFromModel('moonshot-v1-128k'), 'kimi');
  assert.equal(inferPresetFromModel('gemini-2.5-pro'), 'gemini');
  assert.equal(inferPresetFromModel('grok-4'), 'grok');
  assert.equal(inferPresetFromModel('agnes-v2'), 'agnes');
  assert.equal(inferPresetFromModel('MiniMax-M2'), 'minimax');
  assert.equal(inferPresetFromModel('doubao-seed-1.6'), 'doubao');
  assert.equal(inferPresetFromModel('step-3'), 'stepfun');
  assert.equal(inferPresetFromModel('claude-sonnet-4'), 'anthropic');
  // Aliased ids carry the family in the tail.
  assert.equal(inferPresetFromModel('volcengine/glm-4.6'), 'glm');
  // The generic family is named too, so a vendor-ish connection name cannot
  // talk the resolver out of it.
  assert.equal(inferPresetFromModel('gpt-5'), 'openai');
  assert.equal(inferPresetFromModel('o3'), 'openai');
  assert.equal(inferPresetFromModel('my-finetune-v2'), undefined);
  assert.equal(inferPresetFromModel(''), undefined);
  assert.equal(inferPresetFromModel(null), undefined);
});

test('auto resolves per model on a multi-vendor relay', () => {
  const relay = { preset: 'auto', apiFormat: 'auto' };
  const name = '云雾API';
  const base = 'https://yunwu.ai/v1';
  assert.equal(resolveConnectionPreset(relay, name, base, 'glm-4.6'), 'glm');
  assert.equal(resolveConnectionPreset(relay, name, base, 'deepseek-chat'), 'deepseek');
  assert.equal(resolveConnectionPreset(relay, name, base, 'qwen3-max'), 'qwen');
  assert.equal(resolveConnectionPreset(relay, name, base, 'kimi-k2-0905-preview'), 'kimi');
  assert.equal(resolveConnectionPreset(relay, name, base, 'grok-4'), 'grok');
  assert.equal(resolveConnectionPreset(relay, name, base, 'gemini-2.5-pro'), 'gemini');
  // Model switches are live: the same connection answers differently per call.
  assert.notEqual(
    resolveConnectionPreset(relay, name, base, 'glm-4.6'),
    resolveConnectionPreset(relay, name, base, 'deepseek-chat')
  );
});

test('a vendor-flavoured connection name no longer hijacks another vendor model', () => {
  const relay = { preset: 'auto', apiFormat: 'auto' };
  assert.equal(resolveConnectionPreset(relay, 'DeepSeek 中转', 'https://api.deepseek.com/v1', 'glm-4.6'), 'glm');
  assert.equal(resolveConnectionPreset(relay, 'DeepSeek 中转', 'https://api.deepseek.com/v1', 'gpt-5'), 'openai');
  assert.equal(resolveConnectionPreset(relay, 'Claude 中转', 'https://relay.example.com', 'kimi-k2-0905'), 'kimi');
  // Without a model the name/URL inference is unchanged.
  assert.equal(resolveConnectionPreset(relay, 'DeepSeek 中转', 'https://api.deepseek.com/v1'), 'deepseek');
});

test('a manual preset still beats the selected model', () => {
  const manual = { preset: 'kimi', apiFormat: 'auto' };
  for (const model of ['glm-4.6', 'deepseek-chat', 'gpt-5', '']) {
    assert.equal(resolveConnectionPreset(manual, '云雾API', 'https://yunwu.ai/v1', model), 'kimi');
  }
  // The forced API format keeps its existing precedence.
  assert.equal(resolveConnectionPreset({ apiFormat: 'gptl' }, '云雾API', 'https://x', 'glm-4.6'), 'gptl');
});

// The "支持多模态" mark decides whether a model accepts images. Every field
// derived from that answer has to move with it: the vision-relay gate reads
// `imageInput` alone, so a mark that set only `vision` left these models
// refusing images even though the user had declared them image-capable.
test('marking a model multimodal recomputes the derived image capabilities', () => {
  for (const modelId of ['claude-opus-5-5', 'gpt-5.2', 'glm-4.6v-flash', 'relay-model-a']) {
    const preset = resolveConnectionPreset({ preset: 'auto', apiFormat: 'auto' }, '我的中转', 'https://relay.example.com/v1', modelId);
    const decorated = decorateModels(preset, [{ id: modelId, name: modelId, modelType: 'text' }]);
    const [model] = applyConnectionModelFlags({ [modelId]: { multimodal: true } }, decorated, preset);
    assert.equal(model.capabilities.vision, true, `${modelId} vision`);
    assert.equal(model.capabilities.imageInput, true, `${modelId} imageInput`);
    assert.ok(model.capabilities.imageMimeTypes.length > 0, `${modelId} imageMimeTypes`);
    assert.ok(model.capabilities.maxImageBytes > 0, `${modelId} maxImageBytes`);
  }
});

test('recomputed capabilities keep the caller-supplied context overrides', () => {
  const preset = 'openai';
  const decorated = decorateModels(preset, [{ id: 'gpt-5.2', name: 'gpt-5.2', modelType: 'text' }]);
  const [model] = applyConnectionModelFlags(
    { 'gpt-5.2': { multimodal: true, contextWindow: 200000, compactionThreshold: 150000 } },
    decorated,
    preset
  );
  assert.equal(model.capabilities.imageInput, true);
  assert.equal(model.capabilities.contextWindow, 200000);
  assert.equal(model.capabilities.compactionThreshold, 150000);
});

test('user-set output budget marks as userMaxOutputTokens', () => {
  const preset = 'openai';
  const decorated = decorateModels(preset, [{ id: 'gpt-5.6', name: 'gpt-5.6', modelType: 'text' }]);
  const [model] = applyConnectionModelFlags({ 'gpt-5.6': { maxOutputTokens: 65536 } }, decorated, preset);
  assert.equal(model.capabilities.maxOutputTokens, 65536);
  assert.equal(model.capabilities.userMaxOutputTokens, 65536);
});

test('family maxOutputTokens remains unmarked', () => {
  const preset = 'openai';
  const decorated = decorateModels(preset, [{ id: 'gpt-5.6', name: 'gpt-5.6', modelType: 'text' }]);
  assert.equal(decorated[0].capabilities.maxOutputTokens, 128_000);
  assert.equal(decorated[0].capabilities.userMaxOutputTokens, undefined);
});


test('per-model output budget survives the multimodal recompute and normalization', () => {
  const preset = 'openai';
  const decorated = decorateModels(preset, [{ id: 'gpt-5.2', name: 'gpt-5.2', modelType: 'text' }]);
  const flags = normalizeModelFlags({ 'gpt-5.2': { multimodal: true, maxOutputTokens: '16000' } });
  assert.equal(flags['gpt-5.2'].maxOutputTokens, 16000);
  const [model] = applyConnectionModelFlags(flags, decorated, preset);
  assert.equal(model.capabilities.imageInput, true);
  assert.equal(model.capabilities.maxOutputTokens, 16000);
  assert.equal(model.maxOutputTokens, 16000);
});
