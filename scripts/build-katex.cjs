'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(path.dirname(require.resolve('katex/package.json')), 'dist');
const target = path.join(root, 'renderer/vendor/katex');
fs.mkdirSync(target, { recursive: true });
for (const file of ['katex.min.js', 'katex.min.css']) {
  fs.copyFileSync(path.join(source, file), path.join(target, file));
}
fs.cpSync(path.join(source, 'fonts'), path.join(target, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(source, '../LICENSE'), path.join(target, 'LICENSE'));
console.log('Bundled local KaTeX runtime, stylesheet and fonts.');
