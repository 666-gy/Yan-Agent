'use strict';

/**
 * Build the vendored dsh-code-review core for the Yan renderer.
 *
 * Upstream: https://github.com/yangzhe1991/dsh-code-review (MIT).
 * The bundled entry (src/yan-bridge.ts) contains no UI: it re-exports the
 * verbatim upstream pure modules. All review markup/styles/strings are
 * generated at runtime by the untouched upstream diff-view.ts.
 */

const path = require('path');
const { mkdir, writeFile } = require('fs/promises');
const { build } = require('esbuild');

async function main() {
  const root = path.resolve(__dirname, '..');
  const srcDir = path.join(root, 'lib', 'vendor', 'dsh-code-review', 'src');
  const outDir = path.join(root, 'renderer', 'vendor', 'dsh-code-review');
  await mkdir(outDir, { recursive: true });
  await build({
    entryPoints: [path.join(srcDir, 'yan-bridge.ts')],
    outfile: path.join(outDir, 'core.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    sourcemap: false,
    legalComments: 'inline',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') }
  });
  const { version } = require(path.join(root, 'lib', 'vendor', 'dsh-code-review', 'upstream-package.json'));
  await writeFile(
    path.join(outDir, 'VERSION'),
    `@yangzhe1991/dsh-code-review ${version}\n`,
    'utf8'
  );
  console.log('[build-dsh-code-review] renderer/vendor/dsh-code-review/core.js written');
}

main().catch(error => {
  console.error('[build-dsh-code-review] failed:', error);
  process.exitCode = 1;
});
