'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { combineSystem } = require('../lib/opencode-sidecar');

test('English runs carry a user-facing English response contract', () => {
  const system = combineSystem({ language: 'en', providerId: 'test', modelId: 'test' });
  assert.match(system, /interface language is English/i);
  assert.match(system, /every user-facing response[\s\S]*in English/i);
  assert.match(system, /Do not output Chinese/i);
});

test('Chinese runs do not add the English-only response contract', () => {
  const system = combineSystem({ language: 'zh-CN', providerId: 'test', modelId: 'test' });
  assert.doesNotMatch(system, /interface language is English/i);
});
