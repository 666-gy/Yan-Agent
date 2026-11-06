'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { indexFile } = require('../lib/update-chunks');
const { parseLatestYml } = require('../lib/update-checker');
async function buildDelta(base, target, output) {
  const previous = await indexFile(base), next = await indexFile(target);
  const known = new Map(previous.chunks.map(c => [c.sha256, c]));
  let payloadOffset = 0, reused = 0;
  const operations = next.chunks.map(chunk => {
    const old = known.get(chunk.sha256);
    if (old && old.size === chunk.size) { reused += chunk.size; return { ...chunk, source: 'base', sourceOffset: old.offset }; }
    const op = { ...chunk, source: 'payload', sourceOffset: payloadOffset }; payloadOffset += chunk.size; return op;
  });
  const header = { schemaVersion: 1, base: { name: path.basename(base), sha512: previous.sha512, size: previous.size },
    target: { name: path.basename(target), sha512: next.sha512, size: next.size }, operations };
  const json = Buffer.from(JSON.stringify(header)), prefix = Buffer.alloc(12);
  prefix.write('YANDELTA', 0, 'ascii'); prefix.writeUInt32LE(json.length, 8);
  const input = await fs.promises.open(target, 'r'), out = await fs.promises.open(output, 'w');
  try {
    await out.write(prefix); await out.write(json);
    for (const op of operations.filter(c => c.source === 'payload')) {
      const bytes = Buffer.alloc(op.size); const read = await input.read(bytes, 0, bytes.length, op.offset);
      if (read.bytesRead !== bytes.length) throw new Error('Installer changed while building delta');
      await out.write(bytes);
    }
  } finally { await input.close(); await out.close(); }
  fs.writeFileSync(target + '.chunks.json', JSON.stringify(next));
  const sha256 = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(output)) sha256.update(bytes);
  const report = { base: header.base, target: header.target, delta: path.basename(output),
    deltaBytes: fs.statSync(output).size, reusedBytes: reused, sha256: sha256.digest('hex'),
    reductionPercent: Math.round((1 - fs.statSync(output).size / next.size) * 10000) / 100 };
  fs.writeFileSync(output + '.json', JSON.stringify(report, null, 2));
  fs.copyFileSync(path.join(__dirname, 'Apply-Yan-Update.ps1'), path.join(path.dirname(output), 'Apply-Yan-Update.ps1'));
  return report;
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
  const feed = parseLatestYml(fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8'));
  const base = process.env.YAN_DELTA_BASE || path.join(root, 'output', 'update-baselines', '1.7.0', 'Yan.Agent.Setup.v1.7.0.exe');
  if (!fs.existsSync(base)) throw new Error('Verified 1.7.0 baseline missing; set YAN_DELTA_BASE');
  const expected = '9acef1fa851b00a00d82ebc838bacef356d8575391a28b652bdd2644a0a53d16';
  if (crypto.createHash('sha256').update(fs.readFileSync(base)).digest('hex') !== expected) {
    throw new Error('Baseline does not match the published Windows 1.7.0 installer');
  }
  buildDelta(base, path.join(dist, feed.fileName), path.join(dist, feed.fileName + '.from-1.7.0.yandelta'))
    .then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { buildDelta };
