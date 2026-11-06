'use strict';
const path = require('node:path');
require('esbuild').buildSync({
  entryPoints: [path.resolve(__dirname, '../renderer/vendor/bloub/adapter.ts')],
  outfile: path.resolve(__dirname, '../renderer/vendor/bloub/avatar.js'),
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', minify: true,
  banner: { js: '// Bloub by Jérémy Perret, MIT. See vendor/bloub/LICENSE and UPSTREAM.md.' }
});
