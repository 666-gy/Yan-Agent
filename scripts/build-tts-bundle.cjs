'use strict';

const path = require('node:path');
const { buildSync } = require('esbuild');

const appRoot = path.resolve(__dirname, '..');
const outfile = path.join(appRoot, 'lib', 'tts-msedge.bundle.cjs');

buildSync({
  entryPoints: [path.join(appRoot, 'node_modules', 'msedge-tts', 'dist', 'index.js')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node20'],
  legalComments: 'none',
  sourcemap: false,
  minify: false,
  external: ['bufferutil', 'utf-8-validate']
});

console.log(`Built ${path.relative(appRoot, outfile)}`);
