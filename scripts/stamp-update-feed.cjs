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
{
  // Local --publish never builds may have no publisher and therefore no feed.
  const pkg = require('../package.json');
  const name = pkg.build.nsis.artifactName.replace('${ext}', 'exe');
  const installer = path.join(root, 'dist', name);
  if (!fs.existsSync(installer)) throw new Error(`Installer missing: ${name}`);
  const sha512 = require('crypto').createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
  fs.writeFileSync(feedPath, `version: ${pkg.version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${fs.statSync(installer).size}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`);
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
