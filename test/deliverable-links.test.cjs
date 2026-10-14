'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { combineSystem } = require('../lib/opencode-sidecar');

function renderer(file, workspace = 'C:/work/My Project') {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = source.indexOf('const AGENT_URL_PATTERN');
  const end = source.indexOf('\nfunction toast(', start);
  const context = vm.createContext({
    URL, window: {}, state: { currentSession: { workspace }, config: {} },
    ICONS: { copy: '' }, renderMarkdownTables: text => text,
    escapeHtml: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
  });
  context.escapeAttr = context.escapeHtml;
  if (file.includes('webui')) {
    vm.runInContext(source.slice(start, source.indexOf('function buildTextRoundElement')), context);
    return context.renderMarkdown;
  }
  vm.runInContext(source.slice(start, end), context);
  return context.renderMarkdown;
}

test('all provider system prompts request a verified primary deliverable link only when one exists', () => {
  for (const providerId of ['openai', 'anthropic', 'gemini', 'deepseek', 'conn-custom']) {
    const system = combineSystem({ providerId });
    assert.match(system, /include one clickable Markdown link.*final answer body/);
    assert.match(system, /actual verified absolute file path/);
    assert.match(system, /no primary deliverable, add nothing/);
    assert.match(system, /never invent a file or link/);
    assert.match(system, /Respect explicit user output-format constraints/);
  }
});

test('desktop Markdown supports file paths, spaces, parentheses, Chinese and code labels', () => {
  const render = renderer('renderer/renderer.js');
  for (const [input, expected] of [
    ['已完成，写入 [index.html](C:/work/index.html)。', 'file:///C:/work/index.html'],
    [String.raw`[index.html](C:\work\index.html)`, 'file:///C:/work/index.html'],
    ['[报告.docx](<C:/My Project/报告 (终稿).docx>)', 'file:///C:/My%20Project/%E6%8A%A5%E5%91%8A%20(%E7%BB%88%E7%A8%BF).docx'],
    ['[main](C:/work/main(1).js:12:4)', 'file:///C:/work/main(1).js'],
    ['[index.html](./output/index.html)', 'file:///C:/work/My%20Project/./output/index.html'],
    ['[report.pdf](/tmp/report.pdf)', 'file:///tmp/report.pdf'],
    ['[`index.html`](C:/work/index.html)', 'file:///C:/work/index.html'],
    ['[report](<C:/work/report#1%.pdf>)', 'file:///C:/work/report%231%25.pdf']
  ]) {
    const html = render(input);
    assert.match(html, /<a class="agent-output-link"/);
    assert.ok(html.includes(`data-yan-browser-link="${expected}"`), html);
    assert.doesNotMatch(html, /\u0000/);
  }
});

test('links preserve URL punctuation, reject unsafe schemes, and leave code and plain answers alone', () => {
  const render = renderer('renderer/renderer.js');
  assert.match(render('[site](https://example.com/page?q=1#test)'), /href="https:\/\/example.com\/page\?q=1#test"/);
  assert.ok(render('[file](file:///C:/work/report.pdf)').includes('href="file:///C:/work/report.pdf"'));
  for (const input of ['[bad](javascript:alert(1))', '[bad](data:text/html,test)', '`[x](C:/work/x.html)`', '```md\n[x](C:/work/x.html)\n```']) {
    assert.doesNotMatch(render(input), /<a /);
  }
  assert.equal(render('你好，今天有什么问题？'), '<p>你好，今天有什么问题？</p>');
  assert.doesNotMatch(renderer('renderer/renderer.js', '')('[x](index.html)'), /<a /);
});

test('WebUI retains web links and does not expose desktop file navigation', () => {
  const render = renderer('renderer/webui/desktop-messages.js');
  assert.match(render('[site](https://example.com)'), /<a /);
  assert.doesNotMatch(render('[local](C:/work/index.html)'), /<a /);
});
