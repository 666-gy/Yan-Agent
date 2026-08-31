'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { splitTaggedThinkingText } = require('../lib/thinking-text');

test('leaves ordinary model text unchanged', () => {
  assert.deepEqual(splitTaggedThinkingText('正在写入文件。'), {
    text: '正在写入文件。',
    thinking: '',
    incomplete: false
  });
});

test('separates tagged thinking from user-facing progress', () => {
  assert.deepEqual(splitTaggedThinkingText('<thinking>Reviewing files</thinking>\n现在开始修改。'), {
    text: '\n现在开始修改。',
    thinking: 'Reviewing files',
    incomplete: false
  });
});

test('supports multiple case-insensitive thinking tags', () => {
  const result = splitTaggedThinkingText(
    '前文<THINKING>First</THINKING>中间<thinking>Second</thinking>结尾'
  );
  assert.equal(result.text, '前文中间结尾');
  assert.equal(result.thinking, 'First\n\nSecond');
  assert.equal(result.incomplete, false);
});

test('holds incomplete streaming tags instead of exposing raw XML', () => {
  assert.deepEqual(splitTaggedThinkingText('<thi'), {
    text: '', thinking: '', incomplete: true
  });
  assert.deepEqual(splitTaggedThinkingText('<thinking>Reviewing</thi'), {
    text: '', thinking: 'Reviewing', incomplete: true
  });
});
