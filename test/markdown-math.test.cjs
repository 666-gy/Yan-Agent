'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function renderer(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const start = source.indexOf('function renderMarkdown(text');
  const end = source.indexOf('\nfunction ', start + 1);
  const context = vm.createContext({
    window: {}, ICONS: { copy: '' },
    escapeHtml: s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    renderMarkdownTables: s => s,
    AGENT_MARKDOWN_IMAGE_PATTERN: /(?!) /g, AGENT_MARKDOWN_LINK_PATTERN: /(?!) /g, AGENT_URL_PATTERN: /(?!) /g
  });
  // Execute the shipped browser bundle rather than the development dependency.
  vm.runInContext(fs.readFileSync(path.join(root, 'renderer/vendor/katex/katex.min.js'), 'utf8'), context);
  context.window.katex = context.katex;
  vm.runInContext(fs.readFileSync(path.join(root, 'renderer/markdown-math.js'), 'utf8'), context);
  vm.runInContext(source.slice(start, end), context);
  return context.renderMarkdown;
}

for (const file of ['renderer/renderer.js', 'renderer/webui/desktop-messages.js']) {
  test(`${file}: renders inline, block, matrices and multiline formulas`, () => {
    const render = renderer(file);
    for (const formula of [String.raw`$x^2$`, String.raw`\(\frac{1}{2}\)`, '$$x^2$$', String.raw`\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\]`, '$$\na_b + c_d\n$$']) {
      const html = render(formula);
      assert.match(html, /class="katex"/);
      assert.match(html, /<math /);
      assert.doesNotMatch(html, /\u0000|yan-math-error/);
    }
    assert.match(render('$$x$$'), /yan-math-display/);
    assert.doesNotMatch(render('$x$'), /yan-math-display/);
  });
  test(`${file}: preserves code, currency and malformed formula text`, () => {
    const render = renderer(file);
    for (const text of ['`$x$`', '```latex\n$$x$$\n```', String.raw`\$x$`, '价格 $5 和 $10', '$unfinished']) {
      assert.doesNotMatch(render(text), /class="katex"/);
    }
    assert.match(render(String.raw`$\unknowncommand{x}$`), /yan-math-error/);
    assert.doesNotMatch(render(String.raw`$\href{javascript:alert(1)}{click}$`), /href="javascript:/);
    assert.doesNotMatch(render('$<img src=x onerror=alert(1)>$'), /<img /);
  });
}

test('all font URLs in the bundled KaTeX CSS resolve locally', () => {
  const directory = path.join(root, 'renderer/vendor/katex');
  const css = fs.readFileSync(path.join(directory, 'katex.min.css'), 'utf8');
  const fonts = [...css.matchAll(/url\((fonts\/[^)]+)\)/g)];
  assert.ok(fonts.length > 0);
  for (const [, font] of fonts) assert.ok(fs.existsSync(path.join(directory, font)), font);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('renderer/**/*'));
  for (const command of ['prebuild', 'prebuild:release', 'prebuild:portable']) assert.equal(pkg.scripts[command], 'npm run bundle:katex');
});
