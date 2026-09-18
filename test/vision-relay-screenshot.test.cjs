'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildScreenshotRelayInput } = require('../lib/vision-relay');

test('screenshot relay input carries a directed question without a previous frame', () => {
  const input = buildScreenshotRelayInput({
    basePrompt: '基础观察：按实际产物检查。',
    question: '双皮带是否可见',
    compare: true,
    previous: null,
    current: { data: 'BBBB', mimeType: 'image/png' }
  });
  assert.match(input.userPrompt, /基础观察/);
  assert.match(input.userPrompt, /定向问题：双皮带是否可见/);
  assert.equal(input.withPrevious, false);
  assert.doesNotMatch(input.userPrompt, /对比任务/);
  assert.equal(input.attachments.length, 1);
  assert.equal(input.attachments[0].name, 'yan-browser-screenshot.png');
  assert.equal(input.attachments[0].data, 'BBBB');
});

test('screenshot relay input switches to a before/after comparison when a previous frame exists', () => {
  const input = buildScreenshotRelayInput({
    basePrompt: '基础观察',
    question: '',
    compare: true,
    previous: { data: 'AAAA', mimeType: 'image/png' },
    current: { data: 'BBBB', mimeType: 'image/png' }
  });
  assert.equal(input.withPrevious, true);
  assert.match(input.userPrompt, /图片 1 是上一帧/);
  assert.match(input.userPrompt, /图片 2 是当前帧/);
  assert.deepEqual(input.attachments.map(attachment => [attachment.name, attachment.data]), [
    ['yan-browser-screenshot-previous.png', 'AAAA'],
    ['yan-browser-screenshot-current.png', 'BBBB']
  ]);
});

test('comparison stays off when it was not requested even if a previous frame exists', () => {
  const input = buildScreenshotRelayInput({
    basePrompt: '基础观察',
    compare: false,
    previous: { data: 'AAAA', mimeType: 'image/png' },
    current: { data: 'BBBB', mimeType: 'image/png' }
  });
  assert.equal(input.withPrevious, false);
  assert.doesNotMatch(input.userPrompt, /对比任务/);
  assert.equal(input.attachments.length, 1);
});
