'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { acquireFiles, canonical } = require('../lib/workspace/file-locks');
const { prepare, integrate } = require('../lib/workspace/worktree');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-isolation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }); }
function repository(t) {
  const root = fixture(t); git(root, 'init', '-q'); git(root, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(root, 'a'), 'base\n'); fs.writeFileSync(path.join(root, 'b'), 'base\n');
  git(root, 'add', '.'); git(root, '-c', 'user.name=test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'base');
  return root;
}
test('cross-process claims wait, cancellation releases no live owner, dead owners recover', async t => {
  const root = fixture(t), ledger = path.join(root, 'locks.sqlite'), file = path.join(root, 'file');
  const release = await acquireFiles([file], { ledger });
  const source = `const {acquireFiles}=require(${JSON.stringify(require.resolve('../lib/workspace/file-locks'))});
    acquireFiles([${JSON.stringify(file)}],{ledger:${JSON.stringify(ledger)}}).then(release=>{process.send('acquired');process.on('message',()=>{release();process.exit()})});`;
  const child = spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  t.after(() => child.kill());
  let acquired = false;
  const ready = new Promise(resolve => child.once('message', () => { acquired = true; resolve(); }));
  await new Promise(r => setTimeout(r, 150)); assert.equal(acquired, false);
  const controller = new AbortController();
  const pending = acquireFiles([file], { ledger, signal: controller.signal }); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  release(); await ready;
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited;
  const recovered = await acquireFiles([file], { ledger }); recovered();
});
test('path scopes overlap directories and disjoint files remain concurrent', async t => {
  const root = fixture(t), ledger = path.join(root, 'locks.sqlite');
  const a = await acquireFiles([path.join(root, 'a')], { ledger });
  const b = await acquireFiles([path.join(root, 'b')], { ledger });
  const controller = new AbortController();
  const pending = acquireFiles([root], { ledger, signal: controller.signal }); controller.abort();
  await assert.rejects(pending); a(); b();
  assert.equal(canonical(path.join(root, 'x', '..', 'a')), canonical(path.join(root, 'a')));
});
test('worktrees include dirty and untracked inputs, integrate disjoint changes without changing index', async t => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'a'), 'dirty\n'); git(root, 'add', 'a');
  fs.writeFileSync(path.join(root, 'a'), 'dirty unstaged\n'); fs.writeFileSync(path.join(root, 'new'), 'untracked\n');
  const index = git(root, 'diff', '--cached');
  const one = await prepare(root, 'child_one'), two = await prepare(root, 'child_two');
  assert.equal(fs.readFileSync(path.join(one.directory, 'a'), 'utf8'), 'dirty unstaged\n');
  assert.equal(fs.readFileSync(path.join(one.directory, 'new'), 'utf8'), 'untracked\n');
  fs.writeFileSync(path.join(one.directory, 'a'), 'one\n'); fs.writeFileSync(path.join(two.directory, 'b'), 'two\n');
  await integrate(one); await integrate(two);
  assert.equal(fs.readFileSync(path.join(root, 'a'), 'utf8'), 'one\n');
  assert.equal(fs.readFileSync(path.join(root, 'b'), 'utf8'), 'two\n');
  assert.equal(git(root, 'diff', '--cached'), index);
  assert.equal((await prepare(root, 'child_one')).directory, one.directory);
});
test('overlapping builders fail closed and retain recovery worktree; uncertainty is not replayed', async t => {
  const root = repository(t), one = await prepare(root, 'child_one'), two = await prepare(root, 'child_two');
  fs.writeFileSync(path.join(one.directory, 'a'), 'one\n'); fs.writeFileSync(path.join(two.directory, 'a'), 'two\n');
  await integrate(one); await assert.rejects(integrate(two), /integration conflict/);
  assert.equal(fs.readFileSync(path.join(root, 'a'), 'utf8'), 'one\n');
  assert.equal(fs.readFileSync(path.join(two.directory, 'a'), 'utf8'), 'two\n');
  fs.writeFileSync(two.file, JSON.stringify({ ...two, status: 'integrating' }));
  await assert.rejects(prepare(root, 'child_two'), /uncertain/);
});

test('integration preserves binary data, deletions and abort before parent mutation', async t => {
  const root = repository(t), record = await prepare(root, 'child_binary');
  const bytes = Buffer.from([0, 255, 7, 13, 10, 0, 128]);
  fs.writeFileSync(path.join(record.directory, 'data.bin'), bytes);
  fs.unlinkSync(path.join(record.directory, 'a'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(integrate(record, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fs.existsSync(path.join(root, 'data.bin')), false);
  assert.equal(fs.existsSync(path.join(root, 'a')), true);
  await integrate(record);
  assert.deepEqual(fs.readFileSync(path.join(root, 'data.bin')), bytes);
  assert.equal(fs.existsSync(path.join(root, 'a')), false);
});
