'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { createManagedWorktrees } = require('../lib/managed-worktrees');
const low = require('../lib/worktree-service');
const { normalizeWorktreePreferences, validateWorktreePreferences } = require('../lib/worktree-preferences');
function git(cwd, ...args) { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-managed-wt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const repository = path.join(root, 'repo'), dataDir = path.join(root, 'data'); fs.mkdirSync(repository); fs.mkdirSync(dataDir);
  git(repository, 'init', '-b', 'main'); git(repository, 'config', 'core.autocrlf', 'false'); git(repository, 'config', 'user.name', 'Test'); git(repository, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(repository, 'file.txt'), 'initial\n'); git(repository, 'add', '.'); git(repository, 'commit', '-m', 'initial');
  const config = { git: { branchPrefix: 'yan/' }, worktrees: { limit: 15 } };
  const create = () => createManagedWorktrees({ dataDir, homeDir: root, loadConfig: () => config });
  const age = () => { const file = path.join(dataDir, 'managed-worktrees.json'); const records = JSON.parse(fs.readFileSync(file)); records.forEach((item, i) => item.createdAt = Date.now() - 7200000 + i); fs.writeFileSync(file, JSON.stringify(records)); };
  return { root, repository, dataDir, config, create, manager: create(), age };
}
test('worktree preferences validate real paths and counts', () => {
  assert.deepEqual(normalizeWorktreePreferences(), { root: '', fetchBeforeCreate: false, autoCleanup: true, limit: 15 });
  assert.throws(() => validateWorktreePreferences({ root: 'relative/path' }));
  for (const limit of [0, -1, 1.5, 1001, 'hello']) assert.throws(() => validateWorktreePreferences({ limit }));
});
test('changed roots affect new checkouts only; existing worktrees remain discoverable and mergeable', async t => {
  const f = fixture(t);
  f.config.worktrees.root = path.join(f.root, 'custom A');
  const a = await f.manager.createTaskWorktree(f.repository, { taskId: 'one' });
  assert.ok(a.path.startsWith(f.config.worktrees.root));
  f.config.worktrees.root = path.join(f.root, 'custom B');
  const b = await f.manager.createTaskWorktree(f.repository, { taskId: 'two' });
  assert.ok(b.path.startsWith(f.config.worktrees.root));
  assert.equal((await f.create().list()).worktrees.length, 2);
  assert.equal((await low.listTaskWorktrees(f.repository)).length, 2);
  fs.writeFileSync(path.join(a.path, 'change.txt'), 'branch work'); git(a.path, 'add', '.'); git(a.path, 'commit', '-m', 'branch work');
  assert.equal((await f.manager.mergeTaskWorktree(f.repository, { taskId: 'one' })).merged, true);
  assert.equal(fs.readFileSync(path.join(f.repository, 'change.txt'), 'utf8'), 'branch work');
});
test('cleanup snapshots old checkouts and restore recovers them; dirty, ignored and locked checkouts are retained', async t => {
  const f = fixture(t);
  const a = await f.manager.createTaskWorktree(f.repository, { taskId: 'old' });
  const b = await f.manager.createTaskWorktree(f.repository, { taskId: 'new' });
  f.age(); f.config.worktrees.limit = 1;
  await f.manager.cleanup();
  let records = (await f.manager.list()).worktrees;
  const archived = records.find(item => item.taskId === 'old');
  assert.equal(archived.archived, true); assert.equal(fs.existsSync(a.path), false); assert.equal(fs.existsSync(b.path), true);
  assert.equal(git(f.repository, 'cat-file', '-t', archived.snapshot), 'commit');
  await f.create().restore(archived.id);
  assert.equal(fs.readFileSync(path.join(a.path, 'file.txt'), 'utf8'), 'initial\n');
  fs.writeFileSync(path.join(a.path, 'file.txt'), 'unsaved'); f.age();
  git(f.repository, 'worktree', 'lock', b.path);
  const cleanup = await f.manager.cleanup();
  assert.equal(cleanup.skipped.length, 2); assert.ok(fs.existsSync(a.path)); assert.ok(fs.existsSync(b.path));
  git(f.repository, 'worktree', 'unlock', b.path);
  f.config.worktrees.autoCleanup = false;
  await f.manager.cleanup(); assert.equal((await f.manager.list()).worktrees.filter(item => !item.archived).length, 2);
});
test('manual archive preserves dirty tracked and untracked files without changing branch or main checkout', async t => {
  const f = fixture(t);
  const a = await f.manager.createTaskWorktree(f.repository, { taskId: 'dirty' });
  const originalHead = git(a.path, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(a.path, 'file.txt'), 'staged'); git(a.path, 'add', 'file.txt');
  fs.writeFileSync(path.join(a.path, 'file.txt'), 'unstaged final');
  fs.writeFileSync(path.join(a.path, 'untracked.txt'), 'not yet committed');
  const record = (await f.manager.list()).worktrees[0];
  await f.manager.archive(record.id);
  assert.equal(git(f.repository, 'rev-parse', 'yan/dirty'), originalHead);
  await f.manager.restore(record.id);
  assert.equal(fs.readFileSync(path.join(a.path, 'file.txt'), 'utf8'), 'unstaged final');
  assert.equal(fs.readFileSync(path.join(a.path, 'untracked.txt'), 'utf8'), 'not yet committed');
  assert.equal(fs.readFileSync(path.join(f.repository, 'file.txt'), 'utf8'), 'initial\n');
  assert.equal((await f.manager.mergeTaskWorktree(f.repository, { taskId: 'dirty' })).merged, true);
});
test('ignored files, nested repositories, pinned chats and active contexts prevent archival', async t => {
  const f = fixture(t);
  const a = await f.manager.createTaskWorktree(f.repository, { taskId: 'protected' });
  const record = (await f.manager.list()).worktrees[0];
  fs.writeFileSync(path.join(a.path, '.gitignore'), 'secret.env\n'); fs.writeFileSync(path.join(a.path, 'secret.env'), 'keep');
  await assert.rejects(f.manager.archive(record.id), /忽略/);
  fs.unlinkSync(path.join(a.path, 'secret.env'));
  const nested = path.join(a.path, 'nested'); fs.mkdirSync(nested); git(nested, 'init'); git(nested, 'config', 'user.name', 'Test'); git(nested, 'config', 'user.email', 't@example.com'); git(nested, 'commit', '--allow-empty', '-m', 'nested');
  await assert.rejects(f.manager.archive(record.id), /嵌套/); fs.rmSync(nested, { recursive: true, force: true });
  const sessions = path.join(f.dataDir, 'sessions'); fs.mkdirSync(sessions); fs.writeFileSync(path.join(sessions, 'pinned.json'), JSON.stringify({ pinned: true, workspace: a.path }));
  await assert.rejects(f.manager.archive(record.id), /置顶/); fs.unlinkSync(path.join(sessions, 'pinned.json'));
  const runtime = path.join(f.dataDir, 'harness', 'runtime'); fs.mkdirSync(runtime, { recursive: true }); fs.writeFileSync(path.join(runtime, 'active.json'), JSON.stringify({ workspace: f.repository }));
  await assert.rejects(f.manager.archive(record.id), /运行/);
  assert.ok(fs.existsSync(a.path));
});
test('fetch preference updates remote refs and prevents creation when fetch fails', async t => {
  const f = fixture(t), remote = path.join(f.root, 'remote.git');
  git(f.root, 'init', '--bare', remote); git(f.repository, 'remote', 'add', 'origin', remote); git(f.repository, 'push', '-u', 'origin', 'main');
  const other = path.join(f.root, 'other'); git(f.root, 'clone', '-b', 'main', remote, other); git(other, 'config', 'user.name', 'Other'); git(other, 'config', 'user.email', 'o@example.com'); git(other, 'commit', '--allow-empty', '-m', 'remote update'); git(other, 'push');
  f.config.worktrees.fetchBeforeCreate = true;
  const a = await f.manager.createTaskWorktree(f.repository, { taskId: 'fetched', base: 'origin/main' });
  assert.equal(git(a.path, 'rev-parse', 'HEAD'), git(other, 'rev-parse', 'HEAD'));
  git(f.repository, 'remote', 'set-url', 'origin', path.join(f.root, 'missing.git'));
  await assert.rejects(f.manager.createTaskWorktree(f.repository, { taskId: 'failed' }), /fetch/);
  assert.equal((await f.manager.list()).worktrees.length, 1);
});
test('parallel manager clients preserve registry entries and legacy worktrees can be adopted', async t => {
  const f = fixture(t);
  await low.createTaskWorktree(f.repository, { taskId: 'legacy' });
  assert.equal((await f.manager.list(f.repository)).worktrees.length, 1);
  await Promise.all([f.manager.createTaskWorktree(f.repository, { taskId: 'a' }), f.create().createTaskWorktree(f.repository, { taskId: 'b' })]);
  assert.equal((await f.manager.list()).worktrees.length, 3);
});
