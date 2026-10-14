const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const preferences = require('../lib/git-preferences');
const git = require('../lib/git-service');
const worktrees = require('../lib/worktree-service');
const { registerGitIpc } = require('../lib/main/ipc-git');
const { registerGhIpc } = require('../lib/main/ipc-gh');

test('Agent dispatch takes Git preferences from saved config, not a stale renderer request', async t => {
  const { createRunContext } = require('./helpers/run-context.cjs');
  const { startRun } = require('../lib/run-orchestrator');
  const fixture = createRunContext(t);
  fixture.config.git = { branchPrefix: 'saved/', mergeMethod: 'squash', draftPr: false, forceWithLease: true };
  assert.equal((await startRun(fixture.ctx, { runId: 'git-preferences', utility: true, gitPreferences: { branchPrefix: 'stale/' } })).ok, true);
  assert.deepEqual(fixture.calls.provider[0].request.gitPreferences, preferences.normalizeGitPreferences(fixture.config.git));
  fixture.complete({ status: 'done', text: 'done' });
  await fixture.idle;
});

test('all Git instructions reach generation/monitoring and auto-merge changes the real dispatched workflow', async t => {
  const { createRunContext } = require('./helpers/run-context.cjs');
  const { startRun } = require('../lib/run-orchestrator');
  const { combineSystem } = require('../lib/opencode-sidecar');
  for (const autoMerge of [false, true]) {
    const fixture = createRunContext(t);
    fixture.config.memory = { enabled: false };
    fixture.ctx.harnessBridge.registerHarnessRunContext = () => {};
    fixture.config.git = { autoMerge, mergeMethod: 'squash', monitorInstructions: 'Read failing logs first', commitInstructions: 'English subject with a body', prInstructions: 'Describe actual verification results' };
    assert.equal((await startRun(fixture.ctx, { runId: `monitor-${autoMerge}`, prompt: '/monitor-pr 7' })).ok, true);
    const dispatched = fixture.calls.provider[0].request;
    const system = combineSystem(dispatched);
    for (const key of ['monitorInstructions', 'commitInstructions', 'prInstructions']) assert.ok(system.includes(fixture.config.git[key]));
    assert.ok(dispatched.prompt.includes('Pull Request #7'));
    assert.ok(dispatched.prompt.includes(autoMerge ? '继续检查直到确认已合并' : '不要合并'));
    assert.ok(system.includes(autoMerge ? 'gh pr merge --squash --match-head-commit' : 'Do not merge, enable auto-merge'));
    fixture.complete({ status: 'done', text: 'done' }); await fixture.idle;
  }
  assert.equal(preferences.expandGitWorkflowPrompt('请生成提交说明', {}), '请生成提交说明');
  assert.throws(() => preferences.expandGitWorkflowPrompt('/monitor-pr 0', {}));
});

test('prefix validation and Agent system preferences', () => {
  assert.equal(preferences.prefixedBranch('feature', {}), 'yan/feature');
  assert.equal(preferences.prefixedBranch('yan/feature', {}), 'yan/feature');
  assert.equal(preferences.prefixedBranch('feature', { branchPrefix: '' }), 'feature');
  for (const prefix of ['../', '-x', 'a//', 'a.lock/', 'a b/', 'a@{b/']) assert.throws(() => preferences.validateBranchPrefix({ branchPrefix: prefix }));
  const { combineSystem } = require('../lib/opencode-sidecar');
  const system = combineSystem({ gitPreferences: { branchPrefix: 'team/', forceWithLease: true, mergeMethod: 'squash', draftPr: true } });
  for (const part of ['team/', '--force-with-lease', 'gh pr merge --squash', 'gh pr create --draft']) assert.ok(system.includes(part), part);
});

test('IPC preferences drive real branch/worktree creation and lease-protected push', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-git-prefs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo'), remote = path.join(root, 'remote.git');
  fs.mkdirSync(repo);
  const cmd = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  cmd(repo, 'init', '-b', 'main'); cmd(repo, 'config', 'user.name', 'Test'); cmd(repo, 'config', 'user.email', 'test@example.com');
  cmd(repo, 'commit', '--allow-empty', '-m', 'initial'); cmd(root, 'init', '--bare', remote); cmd(repo, 'remote', 'add', 'origin', remote);
  let cfg = { git: { branchPrefix: 'team/', forceWithLease: false } };
  const handlers = new Map();
  registerGitIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, config: { load: () => cfg }, services: { gitService: git, worktreeService: worktrees } });
  const call = (name, data) => handlers.get(name)(null, { workspace: repo, ...data });
  assert.equal((await call('git:branch-create', { name: 'fix' })).ok, true);
  assert.equal(cmd(repo, 'branch', '--show-current'), 'team/fix');
  const wt = await call('git:worktree-create', { taskId: 'test' });
  assert.equal(wt.worktree.branch, 'team/test');
  cfg.git.branchPrefix = 'other/';
  assert.equal((await call('git:worktree-status', { taskId: 'test' })).ok, true);
  assert.equal((await call('git:worktree-remove', { taskId: 'test' })).ok, true);
  assert.equal((await call('git:push')).ok, true);
  cmd(repo, 'commit', '--allow-empty', '-m', 'second');
  assert.equal((await call('git:push')).ok, true);
  cmd(repo, 'commit', '--amend', '--allow-empty', '-m', 'rewritten');
  assert.equal((await call('git:push')).ok, false, 'ordinary push must reject rewritten history');
  cfg.git.forceWithLease = true;
  assert.equal((await call('git:push')).ok, true, 'lease flag must reach real git');
  assert.equal(cmd(remote, 'rev-parse', 'refs/heads/team/fix'), cmd(repo, 'rev-parse', 'HEAD'));
  // A remote update unknown to our tracking ref must remain protected.
  const clone = path.join(root, 'other'); cmd(root, 'clone', '-b', 'team/fix', remote, clone);
  cmd(clone, 'config', 'user.name', 'Other'); cmd(clone, 'config', 'user.email', 'other@example.com');
  cmd(clone, 'commit', '--allow-empty', '-m', 'remote change'); cmd(clone, 'push');
  cmd(repo, 'commit', '--allow-empty', '-m', 'local change');
  assert.equal((await call('git:push')).ok, false, 'stale lease must not overwrite another push');
});

test('PR IPC reads live defaults, honors draft override, and executes selected gh merge flag', async t => {
  let cfg = { git: { draftPr: true, mergeMethod: 'merge' } };
  const calls = [], handlers = new Map();
  registerGhIpc({ ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, config: { load: () => cfg }, services: { ghService: { prCreate: async options => { calls.push(options); return {}; }, prMerge: async options => { calls.push(options); return {}; } } } });
  await handlers.get('gh:pr-create')(null, { workspace: 'repo' }); assert.equal(calls.pop().draft, true);
  await handlers.get('gh:pr-create')(null, { workspace: 'repo', draft: false }); assert.equal(calls.pop().draft, false);
  cfg.git = { draftPr: false, mergeMethod: 'squash' };
  await handlers.get('gh:pr-create')(null, { workspace: 'repo' }); assert.equal(calls.pop().draft, false);
  await handlers.get('gh:pr-merge')(null, { workspace: 'repo', number: 7 }); assert.equal(calls.pop().method, 'squash');
  const child = require('node:child_process');
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  const argv = [];
  t.mock.method(child, 'spawn', (bin, args) => {
    argv.push(args); const process = new EventEmitter(); process.stdout = new PassThrough(); process.stderr = new PassThrough(); process.kill = () => {};
    queueMicrotask(() => process.emit('close', 0)); return process;
  });
  delete require.cache[require.resolve('../lib/gh-service')];
  const gh = require('../lib/gh-service');
  await gh.prMerge({ cwd: 'repo', number: 7, method: 'squash' });
  await gh.prMerge({ cwd: 'repo', number: 7, method: 'merge' });
  assert.deepEqual(argv, [['pr', 'merge', '7', '--squash'], ['pr', 'merge', '7', '--merge']]);
});
