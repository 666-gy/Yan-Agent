'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { formatRunAuthoredFiles, resolveLocalPrettier, runProcess, selectFormatTargets } = require('../lib/finalize-format');

async function mkdtempWorkspace(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-finalize-format-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  return workspace;
}

test('selectFormatTargets keeps authorable sources and drops machine artifacts', t => {
  const workspace = path.join(os.tmpdir(), 'yan-finalize-format-fixture');
  const targets = selectFormatTargets(workspace, [
    path.join(workspace, 'src', 'app.ts'),
    path.join(workspace, 'main.go'),
    path.join(workspace, 'tool.py'),
    'relative/styles.css',
    path.join(workspace, 'package-lock.json'),
    path.join(workspace, 'pnpm-lock.yaml'),
    path.join(workspace, 'app.min.js'),
    path.join(workspace, 'types.d.ts'),
    path.join(workspace, 'logo.svg'),
    path.join(workspace, 'notes.txt'),
    path.join(os.tmpdir(), 'outside.js'),
    '',
    null
  ]);
  const picked = targets.map(target => path.basename(target.path)).sort();
  assert.deepEqual(picked, ['app.ts', 'main.go', 'styles.css', 'tool.py']);
  const python = targets.find(target => target.path.endsWith('tool.py'));
  assert.deepEqual(python.formatters, ['ruff', 'black'], 'python prefers ruff before black');
});

test('selectFormatTargets deduplicates case-insensitively on Windows and resolves relative paths', t => {
  const workspace = path.join(os.tmpdir(), 'yan-finalize-format-dup');
  const absolute = path.join(workspace, 'src', 'app.js');
  const targets = selectFormatTargets(workspace, [absolute, 'src/app.js', 'src\\APP.JS']);
  assert.equal(targets.length, process.platform === 'win32' ? 1 : 2);
});

test('runProcess resolves spawn failures without throwing', async () => {
  const ok = await runProcess(process.execPath, ['-e', 'process.exit(0)'], { timeoutMs: 5_000 });
  assert.equal(ok.ok, true);
  const missing = await runProcess('definitely-not-a-real-formatter-xyz', ['--version'], { timeoutMs: 5_000 });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /ENOENT/i);
});

test('runProcess enforces its timeout', async () => {
  const slow = await runProcess(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 60000)'],
    { timeoutMs: 300 }
  );
  assert.equal(slow.ok, false);
  assert.equal(slow.error, 'timeout');
});

test('resolveLocalPrettier returns null without a workspace-local prettier', async t => {
  const workspace = await mkdtempWorkspace(t);
  assert.equal(resolveLocalPrettier(workspace), null);
});

test('formatRunAuthoredFiles returns null when nothing is formattable', async t => {
  const workspace = await mkdtempWorkspace(t);
  await fs.writeFile(path.join(workspace, 'data.bin'), Buffer.from([0, 1, 2]));
  const result = await formatRunAuthoredFiles(workspace, [path.join(workspace, 'data.bin')], console);
  assert.equal(result, null);
});
