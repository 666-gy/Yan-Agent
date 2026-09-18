'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  API_FORMATS,
  CONNECTION_PRESETS,
  apiFormatForPreset,
  inferConnectionPreset,
  normalizeApiFormat,
  normalizeConnectionStore,
  resolveConnectionApiFormat,
  resolveConnectionPreset
} = require('../lib/connection-presets');

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
