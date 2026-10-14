'use strict';

// Converts electron-builder's latest.yml into the Reasonix-style immutable
// JSON manifest. The manifest contains a mirror URL and a GitHub Release URL
// for every asset, so clients can fail over without rebuilding the package.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseLatestYml } = require('../lib/update-checker');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const feedPath = path.join(dist, 'latest.yml');
if (!fs.existsSync(feedPath)) throw new Error('dist/latest.yml is missing; build the installer first');

const feed = parseLatestYml(fs.readFileSync(feedPath, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const buildManifestPath = path.join(root, 'lib', 'build-manifest.json');
const buildManifest = fs.existsSync(buildManifestPath) ? JSON.parse(fs.readFileSync(buildManifestPath, 'utf8')) : {};
const tag = process.env.YAN_RELEASE_TAG || `v${String(feed.version).replace(/^v/i, '')}`;
const repo = process.env.GITHUB_REPOSITORY || 'ViaTumLab/Yan-Agent';
const mirrorBase = String(process.env.YAN_UPDATE_MIRROR_URL || '').trim().replace(/\/+$/, '');
const githubBase = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}`;

const names = new Set([
  feed.fileName,
  ...fs.readdirSync(dist).filter((name) => /\.(exe|blockmap)$/i.test(name))
]);
const files = [];
for (const rawName of names) {
  const name = String(rawName || '').split('/').pop();
  if (!name || /^latest\.ya?ml$/i.test(name) || !fs.existsSync(path.join(dist, name))) continue;
  const bytes = fs.readFileSync(path.join(dist, name));
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const mirrorUrl = mirrorBase ? `${mirrorBase}/${encodeURIComponent(tag)}/${encodeURIComponent(name)}` : '';
  const githubUrl = `${githubBase}/${encodeURIComponent(name)}`;
  files.push({
    name,
    url: mirrorUrl || githubUrl,
    fallbackUrl: mirrorUrl ? githubUrl : '',
    size: bytes.length,
    sha512,
    sha256
  });
}
if (!files.length) throw new Error('no release assets found in dist');

const selected = files.find((entry) => /\.exe$/i.test(entry.name)) || files[0];
const manifest = {
  schemaVersion: 1,
  name: pkg.name,
  version: feed.version,
  buildId: buildManifest.buildId || feed.buildId || '',
  releaseDate: feed.releaseDate || new Date().toISOString(),
  tag,
  releaseUrl: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`,
  files,
  fileUrl: selected.url,
  fallbackFileUrl: selected.fallbackUrl,
  sha512: selected.sha512,
  sha256: selected.sha256,
  size: selected.size
};
fs.writeFileSync(path.join(dist, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[update-manifest] ${manifest.version}: ${files.length} assets, mirror=${mirrorBase || 'disabled'}`);
