'use strict';
const path = require('node:path');
require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '../node_modules/msedge-tts/dist/index.js')], outfile: path.join(__dirname, '../lib/tts-msedge.bundle.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node20', legalComments: 'inline' });
