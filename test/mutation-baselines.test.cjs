'use strict';

const assert = require('node:assert/strict');

const fs = require('node:fs');

const os = require('node:os');

const path = require('node:path');

const { execFileSync } = require('node:child_process');

const test = require('node:test');

const { captureWorkspaceBaselines } = require('../lib/run-change-summary');
const sidecar = require('../lib/kernel-policy');

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