'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyModelRole,
  normalizeModelSpecs,
  buildConnectionModelFlags,
  pinModelRole,
  maskSecret
} = require('../lib/provider-setup');

test('model ids are classified into text, image and video roles', () => {
  for (const id of ['gpt-image-1', 'dall-e-3', 'flux-1.1-pro', 'seedream-4.0', 'kolors-v1.5', 'qwen-image-edit', 'imagen-4']) {
    assert.equal(classifyModelRole(id).role, 'image', id);
  }
  for (const id of ['sora-2', 'veo-3.1', 'kling-v2-master', 'seedance-1.0-pro', 'cogvideo-x', 'wan-video-2', 'grok-imagine-video']) {
    assert.equal(classifyModelRole(id).role, 'video', id);
  }
  for (const id of ['gpt-4.1', 'deepseek-v4.1-flash', 'claude-sonnet-4', 'text-embedding-3-large', 'whisper-1', 'qwen3-max']) {
    assert.equal(classifyModelRole(id).role, 'text', id);
  }
});

test('an explicit role hint beats name inference', () => {
  assert.equal(classifyModelRole('relay-model-7', '', 'image').role, 'image');
  assert.equal(classifyModelRole('gpt-image-1', '', 'text').role, 'text');
  assert.equal(classifyModelRole('sora-2', '', '生图').role, 'image');
  assert.equal(classifyModelRole('sora-2', '', '生视频').role, 'video');
});

test('model specs accept ids, objects and role-specific lists', () => {
  const specs = normalizeModelSpecs({
    models: ['gpt-4.1', { id: 'gpt-image-1' }],
    image_models: ['flux-pro', 'gpt-image-1'],
    video_models: ['sora-2'],
    text_models: ['deepseek-v4.1-flash']
  });
  assert.deepEqual(specs, [
    { id: 'gpt-4.1', role: '' },
    { id: 'gpt-image-1', role: '' },
    { id: 'flux-pro', role: 'image' },
    { id: 'sora-2', role: 'video' },
    { id: 'deepseek-v4.1-flash', role: 'text' }
  ]);
  assert.deepEqual(normalizeModelSpecs({ models: 'a, b，c' }), [
    { id: 'a', role: '' },
    { id: 'b', role: '' },
    { id: 'c', role: '' }
  ]);
});

test('connection flags enable recognised media models and honour explicit pins', () => {
  const models = [
    { id: 'gpt-4.1' },
    { id: 'gpt-image-1' },
    { id: 'sora-2' },
    { id: 'text-embedding-3-large' }
  ];
  const flags = buildConnectionModelFlags({ models, specs: [{ id: 'gpt-4.1', role: 'text' }] });
  assert.deepEqual(flags['gpt-image-1'], { enabled: true, image: true });
  assert.deepEqual(flags['sora-2'], { enabled: true, video: true });
  assert.deepEqual(flags['gpt-4.1'], { enabled: true });
  assert.equal(flags['text-embedding-3-large'], undefined);

  pinModelRole(flags, 'gpt-4.1', 'text');
  assert.deepEqual(flags['gpt-4.1'], { enabled: true, image: false, video: false });
  pinModelRole(flags, 'custom-model', 'image');
  assert.deepEqual(flags['custom-model'], { enabled: true, image: true });
});

test('enable_all_models opts every catalog entry in without changing media roles', () => {
  const flags = buildConnectionModelFlags({
    models: [{ id: 'gpt-4.1' }, { id: 'gpt-image-1' }],
    enableAll: true
  });
  assert.deepEqual(flags['gpt-4.1'], { enabled: true });
  assert.deepEqual(flags['gpt-image-1'], { enabled: true, image: true });
});

test('secrets are only ever reported masked', () => {
  assert.equal(maskSecret('sk-test-1234567890'), 'sk-t…7890');
  assert.equal(maskSecret('short'), 'sh…');
  assert.equal(maskSecret(''), '');
});
