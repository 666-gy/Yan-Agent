'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const requested = process.argv[2];
if (requested !== process.platform || !['linux', 'darwin'].includes(requested)) {
  throw Error(`Build ${requested} on its native runner; current host is ${process.platform}`);
}
if (!['x64', 'arm64'].includes(process.arch) || requested === 'linux' && process.arch !== 'x64') {
  throw Error(`Unverified platform target: ${requested}/${process.arch}`);
}
const npmCli = process.env.npm_execpath;
if (!npmCli) throw Error('Run through npm run build:linux or npm run build:mac');
function run(args) { execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' }); }
for (const script of ['bundle:katex', 'bundle:opencode-provider', 'bundle:dsh-review', 'bundle:tts', 'bundle:voice', 'bundle:intelligent-ui', 'build:playwright']) {
  run([npmCli, 'run', script]);
}
run([path.join(root, 'scripts/prepare-platform-runtime.cjs')]);
run([path.join(root, 'scripts/write-build-manifest.cjs')]);
const builder = require.resolve('electron-builder/cli.js');
run([builder, '--config', 'build/electron-builder-platform.js', requested === 'linux' ? '--linux' : '--mac', `--${process.arch}`,
  ...(process.argv.includes('--dir') ? ['--dir'] : []), '--publish', 'never']);
run([path.join(root, 'scripts/verify-platform-package.cjs')]);
