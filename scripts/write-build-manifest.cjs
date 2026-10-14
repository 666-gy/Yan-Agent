'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const buildId = new Date().toISOString();
const manifest = { name: pkg.name, version: pkg.version, buildId };

fs.writeFileSync(
  path.join(root, 'lib', 'build-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
);

console.log(`[build-manifest] version=${pkg.version} buildId=${buildId}`);
