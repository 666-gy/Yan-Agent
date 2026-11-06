'use strict';
// Offline reconstruction only. Does not execute an installer or modify an app.
const fs = require('node:fs');
const crypto = require('node:crypto');
async function hashFile(file) {
  const hash = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('base64');
}
async function applyDelta(basePath, deltaPath, outputPath) {
  const patch = await fs.promises.open(deltaPath, 'r');
  let old, out;
  const temp = outputPath + '.' + crypto.randomUUID() + '.part';
  try {
    const prefix = Buffer.alloc(12); await patch.read(prefix, 0, 12, 0);
    const length = prefix.readUInt32LE(8);
    if (prefix.toString('ascii', 0, 8) !== 'YANDELTA' || length > 32 * 1024 ** 2) throw new Error('Invalid delta header');
    const json = Buffer.alloc(length); const read = await patch.read(json, 0, length, 12);
    if (read.bytesRead !== length) throw new Error('Truncated delta header');
    const header = JSON.parse(json);
    if (header.schemaVersion !== 1 || !Array.isArray(header.operations) || header.operations.length > 262144
      || !Number.isSafeInteger(header.target.size) || header.target.size < 1 || header.target.size > 8 * 1024 ** 3) throw new Error('Invalid delta manifest');
    if (await hashFile(basePath) !== header.base.sha512) throw new Error('Wrong baseline installer');
    old = await fs.promises.open(basePath, 'r'); out = await fs.promises.open(temp, 'wx');
    let position = 0;
    for (const op of header.operations) {
      if (op.offset !== position || !Number.isInteger(op.size) || op.size < 1 || op.size > 512 * 1024
        || !Number.isSafeInteger(op.sourceOffset) || op.sourceOffset < 0 || !['base', 'payload'].includes(op.source)) throw new Error('Invalid delta operation');
      const bytes = Buffer.alloc(op.size), source = op.source === 'base' ? old : patch;
      const result = await source.read(bytes, 0, bytes.length, op.sourceOffset + (op.source === 'payload' ? 12 + length : 0));
      if (result.bytesRead !== op.size || crypto.createHash('sha256').update(bytes).digest('hex') !== op.sha256) throw new Error('Corrupt delta data');
      await out.write(bytes); position += bytes.length;
    }
    await out.close(); out = null;
    if (position !== header.target.size || await hashFile(temp) !== header.target.sha512) throw new Error('Reconstruction checksum mismatch');
    // Do not overwrite any existing file, including the caller's baseline.
    await fs.promises.copyFile(temp, outputPath, fs.constants.COPYFILE_EXCL);
    return { path: outputPath, size: position, sha512: header.target.sha512 };
  } finally { await patch.close(); await old?.close(); await out?.close(); await fs.promises.unlink(temp).catch(() => {}); }
}
if (require.main === module) {
  const [base, delta, output] = process.argv.slice(2);
  if (!base || !delta || !output) throw new Error('Usage: node apply-update-delta.cjs OLD.exe PATCH.yandelta NEW.exe');
  applyDelta(base, delta, output).then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e.message); process.exitCode = 1; });
}
module.exports = { applyDelta };
