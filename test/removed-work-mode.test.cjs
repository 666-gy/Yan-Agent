'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { combineSystem, combineTurnPrompt } = require('../lib/kernel-policy');

test('legacy session voice metadata cannot change the system or turn prompt', () => {
  const request = { providerId: 'deepseek', modelId: 'deepseek-v4-flash', prompt: 'Explain the result.' };
  const legacy = { ...request, workVoice: 'symbiotic' };
  assert.equal(combineSystem(legacy), combineSystem(request));
  assert.equal(combineTurnPrompt(legacy, request.prompt, false), combineTurnPrompt(request, request.prompt, false));
});

test('unsupported work modes use the normal system and turn prompts', () => {
  const request = { providerId: 'deepseek', modelId: 'deepseek-v4-flash', prompt: 'Explain the result.', workMode: 'normal' };
  for (const workMode of ['absolute', 'goal', 'unknown']) {
    const legacy = { ...request, workMode };
    assert.equal(combineSystem(legacy), combineSystem(request));
    assert.equal(combineTurnPrompt(legacy, request.prompt, false), combineTurnPrompt(request, request.prompt, false));
  }
});


test('retired goal metadata is not persisted in Core results', () => {
  const { normalizeResult } = require('../lib/yan-core/protocol');
  const result = normalizeResult({ status: 'done', text: 'Completed', goal: { verified: false, status: 'paused' } });
  assert.equal(result.status, 'done');
  assert.equal(result.text, 'Completed');
  assert.equal(Object.hasOwn(result, 'goal'), false);
});
