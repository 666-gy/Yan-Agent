'use strict';

const path = require('node:path');
const { buildSync } = require('esbuild');

const appRoot = path.resolve(__dirname, '..');
const outfile = path.join(appRoot, 'lib', 'opencode-dsml-provider.bundle.mjs');

buildSync({
  entryPoints: [path.join(appRoot, 'lib', 'opencode-dsml-provider.mjs')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node20'],
  legalComments: 'none',
  sourcemap: false,
  minify: false
});

console.log(`Built ${path.relative(appRoot, outfile)}`);
