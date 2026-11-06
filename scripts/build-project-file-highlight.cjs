'use strict';
require('esbuild').buildSync({
  entryPoints: [require('node:path').resolve(__dirname, '../renderer/project-file-highlight.mjs')],
  outfile: require('node:path').resolve(__dirname, '../renderer/vendor/project-file-highlight.js'),
  bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'chrome140'
});
