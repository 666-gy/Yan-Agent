'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeModelId,
  isGptActionProgressModel,
  presentationModeForModel
} = require('../lib/model-presentation');

test('normalizes namespaced model ids before presentation matching', () => {
  assert.equal(normalizeModelId(' OpenAI/GPT-5.3 '), 'gpt-5.3');
  assert.equal(normalizeModelId(''), '');
});

test('selects action progress for GPT and reasoning-family model ids', () => {
  for (const modelId of ['gpt-5.3', 'gpt4o', 'o3-mini', 'o4-mini', 'codex-1']) {
    assert.equal(isGptActionProgressModel(modelId), true, modelId);
    assert.equal(presentationModeForModel(modelId), 'gpt-action-progress', modelId);
  }
});

test('keeps unrelated model ids on the standard presentation', () => {
  for (const modelId of ['agnes-2.5-flash', 'deepseek-v4-flash', 'qwen3.5-plus', '']) {
    assert.equal(isGptActionProgressModel(modelId), false, modelId);
    assert.equal(presentationModeForModel(modelId), 'standard', modelId);
  }
});
