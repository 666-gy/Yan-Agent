'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeExperienceMarkdown } = require('../lib/experience-markdown');
test('repairs heading spacing and unmatched fences without inventing content', () => {
  const result = normalizeExperienceMarkdown('##经验\r\n\r\n```text\n真实观察');
  assert.match(result.markdown, /^## 经验/);
  assert.ok(result.markdown.endsWith('```\n'));
  assert.equal(result.corrected, true);
});
test('unwraps Markdown and gives plain experience a heading', () => {
  assert.equal(normalizeExperienceMarkdown('```md\n## 经验\n\n已验收\n```').markdown, '## 经验\n\n已验收\n');
  assert.equal(normalizeExperienceMarkdown('以暂停图标验收', { title: '波点音乐' }).markdown, '## 波点音乐\n\n以暂停图标验收\n');
});
test('refuses copied review prompts, raw receipts, dead templates and truncation', () => {
  for (const text of ['动作序列：click → end_session', '关键回执：{"delivery":{}}', '流程已完成并记录', '请基于下面的真实执行轨迹复盘']) {
    assert.throws(() => normalizeExperienceMarkdown(text));
  }
  assert.throws(() => normalizeExperienceMarkdown('abcdef', { maxLength: 3 }), /不会截断/);
});
