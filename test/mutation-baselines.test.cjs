'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { captureWorkspaceBaselines } = require('../lib/run-change-summary');
const sidecar = require('../lib/opencode-sidecar');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yan-mutation-baselines-'));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function fakeRun(directory) {
  return {
    directory,
    fileBaselines: new Map(),
    callShadows: new Map(),
    touchedFiles: new Set(),
    repairedMutations: 0
  };
}

function toolEvent(status, extra = {}) {
  return {
    type: 'message.part.updated',
    properties: {
      part: {
        id: 'call-1',
        type: 'tool',
        tool: 'apply_patch',
        state: { status, ...extra }
      }
    }
  };
}

test('captureWorkspaceBaselines snapshots the pre-run dirty set', async t => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const git = args => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
  git(['init', '--quiet', '-b', 'main']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 't']);

  write(path.join(repo, 'tracked.txt'), 'head\n');
  write(path.join(repo, 'clean.txt'), 'untouched\n');
  write(path.join(repo, 'gone.txt'), 'deleted later\n');
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'base']);

  // Dirty at run start: a tracked edit, a pre-existing untracked file.
  write(path.join(repo, 'tracked.txt'), 'head\nplus pre-run edit\n');
  write(path.join(repo, 'untracked.txt'), 'untracked before run\n');
  write(path.join(repo, 'logo.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
  fs.rmSync(path.join(repo, 'gone.txt'));

  const baselines = await captureWorkspaceBaselines(repo);
  const key = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);

  // The tracked baseline must be the pre-run worktree content, not HEAD.
  assert.equal(baselines.get(key(path.join(repo, 'tracked.txt')))?.before, 'head\nplus pre-run edit\n');
  assert.equal(baselines.get(key(path.join(repo, 'untracked.txt')))?.before, 'untracked before run\n');
  // Clean files and binary files are not captured; deletions have no content.
  assert.equal(baselines.has(key(path.join(repo, 'clean.txt'))), false);
  assert.equal(baselines.has(key(path.join(repo, 'logo.bin'))), false);
  assert.equal(baselines.has(key(path.join(repo, 'gone.txt'))), false);
});

test('captureWorkspaceBaselines returns empty outside a git repository', async t => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, 'a.txt'), 'plain\n');
  const baselines = await captureWorkspaceBaselines(root);
  assert.equal(baselines.size, 0);
});

test('restoreCallShadow puts back byte-exact content and removes created files', t => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const existing = path.join(root, 'existing.bin');
  const original = Buffer.from([0x61, 0x0d, 0x0a, 0x62, 0xff, 0xfe, 0x00, 0x63]);
  fs.writeFileSync(existing, original);
  const created = path.join(root, 'created.txt');

  const run = fakeRun(root);
  sidecar.captureCallShadow(run, 'call-1', [existing, created]);
  assert.equal(run.callShadows.get('call-1').size, 2);

  // Simulate the failed tool call: corrupt the existing file, create the new one.
  fs.writeFileSync(existing, Buffer.from([0x01, 0x02, 0x03]));
  fs.writeFileSync(created, 'partial application\n');

  const restored = sidecar.restoreCallShadow(run, 'call-1');
  assert.deepEqual(restored.sort(), [created, existing].sort());
  assert.ok(Buffer.compare(fs.readFileSync(existing), original) === 0);
  assert.equal(fs.existsSync(created), false);
  assert.equal(run.callShadows.has('call-1'), false);

  // Restoring twice is a no-op.
  assert.deepEqual(sidecar.restoreCallShadow(run, 'call-1'), []);
});

test('emitTrackedRunEvent restores failed multi-file patches and drops completed shadows', t => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, 'a.txt');
  const b = path.join(root, 'b.txt');
  write(a, 'a original\n');
  write(b, 'b original\n');

  const run = fakeRun(root);
  const events = [];
  const onEvent = event => events.push(event);
  const patch = '*** Begin Patch\n*** Update File: a.txt\n*** Update File: b.txt\n*** End Patch';

  // The kernel starts the call: shadows and run baselines are captured.
  sidecar.emitTrackedRunEvent(run, toolEvent('running', { input: { patch } }), onEvent);
  assert.equal(run.callShadows.get('call-1').size, 2);
  assert.equal(run.fileBaselines.size, 2);

  // Simulate a partial application: first file applied, second failed.
  write(a, 'a applied\n');

  sidecar.emitTrackedRunEvent(run, toolEvent('error', { error: 'patch did not apply' }), onEvent);
  assert.equal(fs.readFileSync(a, 'utf8'), 'a original\n');
  assert.equal(fs.readFileSync(b, 'utf8'), 'b original\n');
  assert.equal(run.repairedMutations, 2);
  const invalidated = events.filter(event => event.type === 'yan.review.invalidated');
  assert.equal(invalidated.length, 2);

  // A completed call leaves the workspace alone and drops its shadow.
  sidecar.emitTrackedRunEvent(run, toolEvent('running', { input: { patch } }), onEvent);
  sidecar.emitTrackedRunEvent(run, toolEvent('completed'), onEvent);
  assert.equal(run.callShadows.has('call-1'), false);
  assert.equal(fs.readFileSync(a, 'utf8'), 'a original\n');
});
