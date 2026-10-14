'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'lib', 'build-manifest.json');
const feedPath = path.join(root, 'dist', 'latest.yml');

if (!fs.existsSync(manifestPath)) {
  console.error('[update-feed] lib/build-manifest.json missing; run write-build-manifest.cjs first');
  process.exit(1);
}
if (!fs.existsSync(feedPath)) {
  console.error('[update-feed] dist/latest.yml missing; electron-builder did not produce an update feed');
  process.exit(1);
}

const { version, buildId } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let yml = fs.readFileSync(feedPath, 'utf8');

if (/^version:\s*(.*)$/m.test(yml)) {
  const feedVersion = (yml.match(/^version:\s*(.*)$/m)[1] || '').trim().replace(/^['"]|['"]$/g, '');
  if (feedVersion !== version) {
    console.error(`[update-feed] version mismatch: feed=${feedVersion} manifest=${version}`);
    process.exit(1);
  }
}

if (/^buildId:/m.test(yml)) {
  yml = yml.replace(/^buildId:.*$/m, `buildId: '${buildId}'`);
} else {
  if (!yml.endsWith('\n')) yml += '\n';
  yml += `buildId: '${buildId}'\n`;
}

fs.writeFileSync(feedPath, yml);
console.log(`[update-feed] stamped buildId=${buildId} into dist/latest.yml`);
