'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { combineSystem } = require('../lib/opencode-sidecar');

test('media policy does not make a successful image generation trigger a visual read-back', () => {
  const system = combineSystem({
    providerId: 'deepseek',
    modelId: 'deepseek-test',
    availableMcpServers: [{ id: 'yan_media', name: 'Yan Media' }],
    mediaModels: [{
      role: 'image',
      providerId: 'agnes',
      providerName: 'Agnes',
      modelId: 'image-test',
      modelName: 'Image Test'
    }]
  });

  assert.equal(system.includes('Do not call yan_media_read_image merely to inspect, describe, or validate an image immediately after generating it'), true);
  assert.equal(system.includes('Do not add a visual relay read-back as a default validation step'), true);
  assert.equal(system.includes('explicit request to analyze or verify image contents'), true);
  assert.equal(system.includes('pass the prior generatedImageId directly as source_asset_id without reading it first'), true);
});
