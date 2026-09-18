'use strict';

const assert = require('node:assert/strict');
const { resolveReasoningForModel, normalizeReasoningSpeed } = require('../lib/reasoning-effort');

(async () => {
  // 基线行为不回归。
  assert.equal(normalizeReasoningSpeed('FAST'), 'low');
  assert.equal(normalizeReasoningSpeed(undefined, { thinking: true }), 'high');

  // GLM-5.3-Flash 只支持 low/high/max；未知值官方按 max 处理——
  // 必须显式映射到最近支持档（平局向下，偏向速度）并标记 adjusted。
  assert.deepEqual(resolveReasoningForModel('glm-5.3-flash', 'low'), { effort: 'low', adjusted: false });
  assert.deepEqual(resolveReasoningForModel('glm-5.3-flash', 'high'), { effort: 'high', adjusted: false });
  assert.deepEqual(resolveReasoningForModel('glm-5.3-flash', 'max'), { effort: 'max', adjusted: false });
  const medium = resolveReasoningForModel('glm-5.3-flash', 'medium');
  assert.equal(medium.effort, 'high', 'medium maps to nearest supported (tie rounds up: quality-preserving)');
  assert.equal(medium.adjusted, true);
  assert.equal(medium.requested, 'medium');
  assert.notEqual(medium.effort, 'max', 'must never silently become the max tier');
  const xhigh = resolveReasoningForModel('glm-5.3-flash', 'xhigh');
  assert.equal(xhigh.effort, 'max', 'xhigh maps up to max');
  assert.equal(xhigh.adjusted, true);

  // 用户显式 max 不被自动降档。
  assert.equal(resolveReasoningForModel('glm-5.3-flash', 'max').effort, 'max');

  // 无映射的模型行为不变。
  assert.deepEqual(resolveReasoningForModel('deepseek-chat', 'medium'), { effort: 'medium', adjusted: false });
  assert.deepEqual(resolveReasoningForModel('', 'high'), { effort: 'high', adjusted: false });

  // Provider-declared capabilities generalize the mapping to any model.
  assert.deepEqual(resolveReasoningForModel('vendor-model-x', 'medium', {
    supported: ['low', 'high', 'max']
  }), { effort: 'high', adjusted: true, requested: 'medium', model: 'vendor-model-x' });

  console.log('reasoning-effort model mapping tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
