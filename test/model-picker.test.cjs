'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildOpenCodeConfig } = require('../lib/opencode-sidecar');
const {
  REASONING_SPEED_LEVELS,
  normalizeReasoningSpeed,
  reasoningSpeedEnablesThinking
} = require('../lib/reasoning-effort');

test('normalizes five reasoning levels and migrates legacy values', () => {
  for (const level of REASONING_SPEED_LEVELS) assert.equal(normalizeReasoningSpeed(level), level);
  assert.equal(normalizeReasoningSpeed('fast'), 'low');
  assert.equal(normalizeReasoningSpeed('balanced'), 'medium');
  assert.equal(normalizeReasoningSpeed('smart'), 'high');
  assert.equal(normalizeReasoningSpeed('', { thinking: false }), 'medium');
  assert.equal(normalizeReasoningSpeed('', { thinking: true }), 'high');
  assert.equal(reasoningSpeedEnablesThinking('medium'), false);
  assert.equal(reasoningSpeedEnablesThinking('high'), true);
  assert.equal(reasoningSpeedEnablesThinking('xhigh'), true);
  assert.equal(reasoningSpeedEnablesThinking('max'), true);
});

test('passes every reasoning level into the OpenCode model options', () => {
  for (const level of REASONING_SPEED_LEVELS) {
    const config = buildOpenCodeConfig({
      providerId: 'test-provider',
      modelId: 'test-model',
      reasoningSpeed: level
    });
    assert.equal(config.provider['test-provider'].models['test-model'].options.reasoningEffort, level);
  }
});

test('composer picker reuses the connection wizard and exposes five pill choices', () => {
  const rendererRoot = path.join(__dirname, '..', 'renderer');
  const html = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(rendererRoot, 'styles.css'), 'utf8');
  assert.match(html, /id="modelPickerDialog" class="provider-config-dialog conn-wizard-dialog model-picker-dialog"/);
  assert.match(html, /class="conn-wizard-stage model-picker-stage"/);
  assert.match(html, /class="conn-wizard-foot model-picker-foot"/);
  for (const level of REASONING_SPEED_LEVELS) {
    assert.match(html, new RegExp(`data-reasoning-mode="${level}"`));
  }
  assert.doesNotMatch(html, /id="modelQuickMenu"|id="reasoningSpeedSlider"/);
  assert.match(css, /\.composer-toolbar-controls \.model-pill\s*\{[^}]*border-color:\s*transparent/s);
});
