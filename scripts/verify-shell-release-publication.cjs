'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'dist/shell-release-20261019');
const remote = JSON.parse(fs.readFileSync(process.argv[2]));
const includeFeeds = process.argv.includes('--feeds');
const names = fs.readdirSync(dir).filter(name => fs.statSync(path.join(dir, name)).isFile()
  && name !== 'builder-debug.yml' && (includeFeeds || !['latest.json', 'latest.yml'].includes(name)));
for (const name of names) {
  const asset = remote.assets.find(asset => asset.name === name);
  assert.ok(asset, 'Missing asset: ' + name);
  assert.equal(asset.state, 'uploaded', name);
  const bytes = fs.readFileSync(path.join(dir, name));
  assert.equal(asset.size, bytes.length, name);
  assert.equal(asset.digest, 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'), name);
}
console.log('Verified GitHub size and SHA-256 for ' + names.length + ' assets.');
