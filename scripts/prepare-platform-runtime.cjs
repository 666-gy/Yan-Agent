'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const patch = require('../vendor/opencode/runtime-patch.json');
const platformPackage = `opencode-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
const pin = patch.binaries.find(item => item.package === platformPackage);
if (!pin) throw Error(`No verified OpenCode patch for ${platformPackage}`);
const executable = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
const source = path.join(root, 'node_modules', platformPackage, 'bin', executable);
const bytes = fs.readFileSync(source);
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
if (bytes.length !== pin.size || hash(bytes) !== pin.sourceSha256) throw Error('OpenCode source differs from the pinned upstream binary');
const filter = Buffer.from(pin.filter || patch.filter);
const offset = bytes.indexOf(filter);
if (offset < 0 || bytes.indexOf(filter, offset + filter.length) !== -1) throw Error('OpenCode file-tool filter is not unique');
bytes.fill(0x20, offset, offset + filter.length);
if (hash(bytes) !== pin.patchedSha256) throw Error('OpenCode patch integrity mismatch');
const output = path.join(root, 'output', 'opencode-runtime');
fs.mkdirSync(output, { recursive: true });
const target = path.join(output, executable);
fs.writeFileSync(target, bytes, { mode: 0o755 });
fs.chmodSync(target, 0o755);
// Bun's Mach-O signature covers the embedded JS. Re-sign after patching, never
// at first launch inside the read-only installed application bundle.
if (process.platform === 'darwin') {
  execFileSync('codesign', ['--force', '--sign', '-', target], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--strict', target], { stdio: 'inherit' });
}
fs.writeFileSync(path.join(output, 'runtime.json'), JSON.stringify({
  revision: patch.revision, package: platformPackage, platform: process.platform, arch: process.arch,
  executable, sourceSha256: pin.sourceSha256, sha256: hash(fs.readFileSync(target))
}, null, 2) + '\n');
console.log(`Prepared verified OpenCode ${patch.upstreamVersion} for ${process.platform}/${process.arch}`);
