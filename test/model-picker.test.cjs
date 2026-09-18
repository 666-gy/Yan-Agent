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

test('composer picker exposes a Codex-style inline model/reasoning panel', () => {
  const rendererRoot = path.join(__dirname, '..', 'renderer');
  const html = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(rendererRoot, 'styles.css'), 'utf8');
  const js = fs.readFileSync(path.join(rendererRoot, 'renderer.js'), 'utf8');
  // The composer has one outer pill.  It opens the compact, upward-facing
  // panel; model selection is an inline view inside that panel rather than a
  // second dialog or a separate reasoning control.
  const modelPillTag = html.match(/<button\b[^>]*\bid="modelPill"[^>]*>/)?.[0] || '';
  assert.ok(modelPillTag, 'the composer model pill should exist');
  assert.match(modelPillTag, /aria-haspopup="dialog"/);
  assert.match(modelPillTag, /aria-controls="modelQuickMenu"/);
  assert.match(html, /class="model-control-icon"/);
  const assertElementClass = (id, className, { hidden = false } = {}) => {
    const tag = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] || '';
    assert.ok(tag, `#${id} should exist`);
    assert.match(tag, new RegExp(`class="[^"]*\\b${className}\\b`));
    if (hidden) assert.match(tag, /class="[^"]*\bhidden\b/);
  };
  assertElementClass('modelQuickMenu', 'model-quick-menu', { hidden: true });
  assertElementClass('modelQuickDefaultView', 'model-quick-view');
  assertElementClass('modelQuickModelRoute', 'model-quick-route');
  assertElementClass('reasoningSpeedSliderShell', 'reasoning-speed-slider-shell');
  const sliderTag = html.match(/<input\b[^>]*\bid="reasoningSpeedSlider"[^>]*>/)?.[0] || '';
  assert.ok(sliderTag, '#reasoningSpeedSlider should exist');
  assert.match(sliderTag, /type="range"/);
  assertElementClass('modelQuickModelsView', 'model-quick-view', { hidden: true });
  assertElementClass('modelQuickList', 'model-quick-list');
  for (const level of REASONING_SPEED_LEVELS) {
    assert.match(html, new RegExp(`data-reasoning-mode="${level}"`));
  }
  assert.match(css, /\.model-quick-menu\s*\{/);
  assert.match(css, /\.reasoning-speed-slider-shell\s*\{/);
  assert.match(css, /\.composer-toolbar-controls \.model-pill\s*\{/);
  assert.match(css, /#modelQuickMenu\s*\{[\s\S]*?width:\s*min\(226px,/);
  assert.match(css, /--model-reasoning-blue:\s*#[0-9a-f]{6}/i);
  assert.match(css, /--model-reasoning-violet:\s*#[0-9a-f]{6}/i);
  assert.match(css, /#modelQuickMenu\[data-reasoning-mode="max"\][\s\S]*?--model-reasoning-active:\s*var\(--model-reasoning-violet\)/);
  assert.match(css, /#reasoningSpeedSliderShell\[data-mode="max"\][\s\S]*?--model-reasoning-fill-mid:\s*var\(--model-reasoning-lilac\)/);
  assert.match(css, /#modelQuickDefaultView \.reasoning-speed-fluid::after\s*\{/);
  assert.match(css, /@keyframes modelReasoningNebulaFlow\s*\{/);
  assert.match(css, /@keyframes modelReasoningStardust\s*\{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.reasoning-speed-fluid::after[\s\S]*?animation:\s*none/);
  assert.match(css, /#modelQuickList \.model-quick-item\s*\{[\s\S]*?flex:\s*0 0 34px/);
  assert.match(js, /quickMenu\.dataset\.reasoningMode\s*=\s*mode/);
  assert.match(js, /routeReasoning\.dataset\.reasoningMode\s*=\s*mode/);
  assert.match(js, /function isModelPickerBusy\(\)/);
  assert.match(js, /closeModelPicker\(\{ restoreFocus: modelPickerOpen && !isModelPickerBusy\(\) \}\)/);
});
