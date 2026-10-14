'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { stageOpenCodeRuntime } = require('../lib/opencode-runtime');
const patch = require('../vendor/opencode/runtime-patch.json');

test('prepared runtime rejects a wrong platform and altered executable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-platform-integrity-'));
  const executable = path.join(dir, 'opencode');
  const pin = patch.binaries[0];
  const manifest = { revision: patch.revision, package: pin.package, sourceSha256: pin.sourceSha256,
    executable: 'opencode', platform: 'invalid', arch: process.arch, sha256: '0'.repeat(64) };
  fs.writeFileSync(executable, 'altered executable');
  try {
    fs.writeFileSync(path.join(dir, 'runtime.json'), JSON.stringify(manifest));
    await assert.rejects(stageOpenCodeRuntime({ executable, dataDir: dir }), /平台或来源校验失败/);
    manifest.platform = process.platform;
    fs.writeFileSync(path.join(dir, 'runtime.json'), JSON.stringify(manifest));
    await assert.rejects(stageOpenCodeRuntime({ executable, dataDir: dir }), /文件校验失败/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('native Unix runtime executes and stays prepared; bundled CodeGraph and shell work', {
  skip: !['linux', 'darwin'].includes(process.platform)
}, async () => {
  const root = path.resolve(__dirname, '..');
  const resources = process.env.YAN_PLATFORM_RESOURCES;
  const appRoot = resources ? path.join(resources, 'app.asar.unpacked') : root;
  const executable = path.join(resources || path.join(root, 'output'), 'opencode-runtime', 'opencode');
  assert.equal(await stageOpenCodeRuntime({ executable, dataDir: os.tmpdir() }), executable);
  assert.equal(execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim(), patch.upstreamVersion);
  const graph = require('../lib/codegraph-runtime').resolveRuntime(appRoot);
  assert.equal(graph.ok, true, graph.error);
  assert.match(execFileSync(graph.command, [...graph.args, '--version'], { encoding: 'utf8' }), /1\.5\.0/);
  const { runBashCommand } = await import('../lib/kernel-bash-tool.mjs');
  const result = await runBashCommand({ command: "printf 'yan-unix-shell'", cwd: root });
  assert.equal(result.exit, 0);
  assert.equal(result.output, 'yan-unix-shell');
});
