'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const splash = path.join(root, 'renderer', 'splash');

fs.mkdirSync(path.join(splash, 'fonts'), { recursive: true });
const fontPackage = path.join(root, 'node_modules', '@fontsource', 'source-serif-4');
fs.copyFileSync(path.join(fontPackage, 'files', 'source-serif-4-latin-400-normal.woff2'),
  path.join(splash, 'fonts', 'source-serif-4-latin-400-normal.woff2'));
fs.copyFileSync(path.join(fontPackage, 'LICENSE'), path.join(splash, 'fonts', 'LICENSE'));
// OGL distributes its Unlicense text inside README rather than a LICENSE file.
const oglReadme = fs.readFileSync(path.join(root, 'node_modules', 'ogl', 'README.md'), 'utf8');
const oglLicenseOffset = oglReadme.indexOf('## Unlicense');
if (oglLicenseOffset < 0) throw new Error('OGL license notice not found');
fs.writeFileSync(path.join(splash, 'vendor', 'ogl-LICENSE'), oglReadme.slice(oglLicenseOffset));
for (const dependency of ['react', 'react-dom']) {
  fs.copyFileSync(path.join(root, 'node_modules', dependency, 'LICENSE'),
    path.join(splash, 'vendor', `${dependency}-LICENSE`));
}

buildSync({
  entryPoints: [path.join(splash, 'splash.jsx')],
  outfile: path.join(splash, 'splash.bundle.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome126'],
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  legalComments: 'eof'
});
console.log('Built offline Ghost Fibers splash');
