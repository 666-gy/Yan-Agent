'use strict';

const path = require('node:path');
const { buildSync } = require('esbuild');

const appRoot = path.resolve(__dirname, '..');
const entries = [
  ['coding-environment-plugin.mjs', 'coding-environment-plugin.bundle.mjs'],
  ['opencode-dsml-provider.mjs', 'opencode-dsml-provider.bundle.mjs'],
  ['opencode-glmm-provider.mjs', 'opencode-glmm-provider.bundle.mjs'],
  ['opencode-openai-responses-provider.mjs', 'opencode-openai-responses-provider.bundle.mjs'],
  ['opencode-gptl-provider.mjs', 'opencode-gptl-provider.bundle.mjs'],
  ['opencode-qwem-provider.mjs', 'opencode-qwem-provider.bundle.mjs'],
  ['opencode-kiml-provider.mjs', 'opencode-kiml-provider.bundle.mjs']
];

for (const [source, target] of entries) {
  const outfile = path.join(appRoot, 'lib', target);
  buildSync({
    entryPoints: [path.join(appRoot, 'lib', source)],
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
}
