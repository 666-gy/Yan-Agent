'use strict';

const test = require('node:test');

const assert = require('node:assert/strict');
const { buildOpenCodeConfig, contextAnchorSystem } = require('../lib/kernel-policy');

const {
  normalizeContextSettings,
  contextKToTokens,
  contextTokensToK
} = require('../lib/context-settings');

function requestWithContext(contextWindow = 128_000, compactionThreshold = Math.floor(contextWindow * 0.75)) {
  return {
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    openCodeConfig: {
      provider: {
        deepseek: {
          models: {
            'deepseek-chat': { limit: { context: contextWindow } }
          }
        }
      },
      compaction: { reserved: 24_000, threshold: compactionThreshold }
    }
  };
}

function assistantMessage(id, tokens) {
  return {
    info: {
      id,
      role: 'assistant',
      tokens: { input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
    },
    parts: [{ type: 'text', text: 'done' }]
  };
}

// The kernel's auto-compaction line is `limit.input - reserved` when input is
// declared, else `limit.context - limit.output`. Without `input`, a 384k
// output budget on a 1000k window would compact at ~616k, well before the
// user's 800k threshold.
test('large output budget does not pull compaction ahead of the user threshold', () => {
  const config = buildOpenCodeConfig({
    providerId: 'custom',
    providerName: 'Custom',
    modelId: 'ds-v4.1',
    modelName: 'ds-v4.1',
    contextWindow: 1_000_000,
    compactionThreshold: 800_000,
    capabilities: {
      contextWindow: 1_000_000,
      maxOutputTokens: 384_000,
      userMaxOutputTokens: 384_000
    }
  });
  const limit = config.provider.custom.models['ds-v4.1'].limit;
  assert.equal(limit.output, 384_000);
  assert.equal(limit.input, 1_000_000);
  const kernelTrigger = limit.input - config.compaction.reserved;
  assert.ok(kernelTrigger >= 800_000, `kernel compacts at ${kernelTrigger}, before the 800k threshold`);
  assert.equal(config.compaction.threshold, 800_000);
});

test('converts decimal k values and normalizes invalid persisted thresholds', () => {
  assert.equal(contextKToTokens('128.5'), 128_500);
  assert.equal(contextTokensToK(128_500), '128.5');
  assert.equal(contextKToTokens('1e3'), 0);
  assert.deepEqual(normalizeContextSettings({
    maxTokens: 64_000,
    compactionThreshold: 80_000
  }), {
    maxTokens: 64_000,
    compactionThreshold: 63_999
  });
});
