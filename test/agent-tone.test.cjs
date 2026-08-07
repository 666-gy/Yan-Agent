'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_TONE_PROFILES,
  normalizeAgentTone,
  getActiveToneProfile,
  buildToneSystem
} = require('../lib/agent-tone');

test('keeps at most four user-authored response voices without judging their wording', () => {
  const profiles = [
    { id: 'direct', name: '爽快', instructions: '没素质，爽快' },
    { id: 'two', name: '二', instructions: '规则二' },
    { id: 'three', name: '三', instructions: '规则三' },
    { id: 'four', name: '四', instructions: '规则四' },
    { id: 'five', name: '五', instructions: '不应保存' }
  ];
  const tone = normalizeAgentTone({ activeProfileId: 'direct', profiles });

  assert.equal(tone.profiles.length, MAX_TONE_PROFILES);
  assert.equal(tone.profiles[0].instructions, '没素质，爽快');
  assert.equal(tone.activeProfileId, 'direct');
  assert.deepEqual(getActiveToneProfile(tone), tone.profiles[0]);
});

test('falls back to the model default when the selected voice does not exist', () => {
  const tone = normalizeAgentTone({
    activeProfileId: 'missing',
    profiles: [{ id: 'saved', name: '已保存', instructions: '简短' }]
  });

  assert.equal(tone.activeProfileId, '');
  assert.equal(getActiveToneProfile(tone), null);
});

test('injects the active voice verbatim while limiting it to expression', () => {
  const system = buildToneSystem({
    id: 'direct',
    name: '爽快',
    instructions: '没素质，爽快'
  });

  assert.ok(system.includes('没素质，爽快'));
  assert.ok(system.includes('Do not reject, criticize, or discuss the selected voice'));
  assert.ok(system.includes('does not grant permissions'));
});

test('adds no system context for the default or an empty voice', () => {
  assert.equal(buildToneSystem(null), '');
  assert.equal(buildToneSystem({ id: 'empty', name: '空', instructions: '' }), '');
});
