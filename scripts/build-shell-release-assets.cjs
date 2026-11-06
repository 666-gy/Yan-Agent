'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { buildDelta } = require('./prepare-update-delta.cjs');
const { applyDelta } = require('./apply-update-delta.cjs');
const root = path.resolve(__dirname, '..'), dir = path.join(root, 'dist/shell-release-20261019');
const name = 'Yan.Agent.Setup.v1.8.0.Beta1-RC1.shell-fix.exe', target = path.join(dir, name);
const tag = 'v1.8.0-Beta1-RC1', repo = '666-gy/Yan-Agent';
const hash = (file, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
(async () => {
  const baselines = [
    { id: 'update-fix', file: path.join(root, 'dist/Yan.Agent.Setup.v1.8.0.Beta1-RC1.update-fix.exe'), sha256: '274217b91058e845348f74c495068be12e25f0de4dbc203a4668a01fd6e8dc56' },
    { id: '1.7.0', file: path.join(root, 'output/update-baselines/1.7.0/Yan.Agent.Setup.v1.7.0.exe'), sha256: '9acef1fa851b00a00d82ebc838bacef356d8575391a28b652bdd2644a0a53d16' }
  ];
  const names = [name, name + '.blockmap', name + '.chunks.json', 'Apply-Yan-Update.ps1'];
  const reports = [];
  for (const base of baselines) {
    if (hash(base.file) !== base.sha256) throw new Error('Unverified baseline: ' + base.id);
    const deltaName = `${name}.from-${base.id}.yandelta`;
    const report = await buildDelta(base.file, target, path.join(dir, deltaName));
    const reconstruction = path.join(root, 'output', 'shell-release-reconstructed-' + base.id + '-' + Date.now() + '.exe');
    await applyDelta(base.file, path.join(dir, deltaName), reconstruction);
    if (hash(reconstruction) !== hash(target)) throw new Error('Reconstruction mismatch');
    names.push(deltaName, deltaName + '.json'); reports.push({ ...report, baselineSha256: base.sha256, reconstruction });
    console.log(JSON.stringify(report));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'output/shell-release-stage-20261019/lib/build-manifest.json')));
  const files = names.map(name => { const file = path.join(dir, name); return { name, url: `https://github.com/${repo}/releases/download/${tag}/${name}`, fallbackUrl: '', size: fs.statSync(file).size, sha512: hash(file, 'sha512', 'base64'), sha256: hash(file) }; });
  const index = files.find(file => file.name.endsWith('.chunks.json'));
  files[0].chunkIndex = { url: index.url, sha256: index.sha256, size: index.size };
  const feed = { schemaVersion: 1, name: 'yan-agent', version: manifest.version, buildId: manifest.buildId, releaseDate: new Date().toISOString(), tag,
    releaseUrl: `https://github.com/${repo}/releases/tag/${tag}`, files, fileUrl: files[0].url, fallbackFileUrl: '', sha512: files[0].sha512, sha256: files[0].sha256, size: files[0].size };
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(feed, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'latest.yml'), `version: ${manifest.version}\nfiles:\n  - url: ${name}\n    sha512: ${feed.sha512}\n    size: ${feed.size}\npath: ${name}\nsha512: ${feed.sha512}\nreleaseDate: '${feed.releaseDate}'\nbuildId: '${manifest.buildId}'\n`);
  fs.writeFileSync(path.join(dir, 'SHA256SUMS-SHELL-FIX.txt'), [...names, 'latest.json', 'latest.yml'].map(name => `${hash(path.join(dir, name))}  ${name}`).join('\n') + '\n');
  fs.writeFileSync(path.join(root, '.yanagent/evidence/shell-release-deltas.json'), JSON.stringify(reports, null, 2));
})();
