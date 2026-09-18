'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const git = require('../lib/git-service');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yan-git-service-'));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test('status reports non-repositories without failing', async t => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const status = await git.repositoryStatus(root);
  assert.equal(status.available, true);
  assert.equal(status.isRepository, false);
});

test('full local Git workflow supports staging, commits, branches and diffs', async t => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);

  let status = await git.initRepository(repo);
  assert.equal(status.isRepository, true);
  assert.equal(status.currentBranch, 'main');
  await git.setIdentity(repo, 'Yan Test', 'yan@example.com');

  write(path.join(repo, 'README.md'), '# Yan\n');
  write(path.join(repo, '.yanagent', 'memory.json'), '{"internal":true}\n');
  status = await git.repositoryStatus(repo);
  assert.equal(status.changes.length, 1);
  assert.equal(status.changes[0].status, 'untracked');
  assert.equal((await git.diff(repo, 'README.md')).untracked, true);

  status = await git.stageFiles(repo, ['README.md']);
  assert.equal(status.stagedCount, 1);
  status = await git.unstageFiles(repo, ['README.md']);
  assert.equal(status.stagedCount, 0);
  await git.stageFiles(repo, [], true);
  assert.equal(execFileSync('git', ['-C', repo, 'ls-files', '.yanagent'], { encoding: 'utf8', windowsHide: true }).trim(), '');
  status = await git.unstageFiles(repo, [], true);
  assert.equal(status.stagedCount, 0);
  await git.stageFiles(repo, [], true);
  const first = await git.commit(repo, 'Initial commit');
  assert.equal(first.commit.subject, 'Initial commit');
  assert.equal(first.status.clean, true);

  status = await git.createBranch(repo, 'feature/git-ui');
  assert.equal(status.currentBranch, 'feature/git-ui');
  write(path.join(repo, 'README.md'), '# Yan\n\nGit UI\n');
  status = await git.repositoryStatus(repo);
  assert.deepEqual(status.diffStats, { added: 2, deleted: 0, binaryFiles: 0 });
  const unstagedDiff = await git.diff(repo, 'README.md');
  assert.match(unstagedDiff.diff, /Git UI/);
  await git.stageFiles(repo, ['README.md']);
  const stagedDiff = await git.diff(repo, 'README.md', true);
  assert.match(stagedDiff.diff, /Git UI/);
  const featureCommit = await git.commit(repo, 'Add Git UI');
  execFileSync('git', ['-C', repo, 'update-ref', 'refs/remotes/origin/pr-1', featureCommit.commit.hash], { windowsHide: true });
  status = await git.switchBranch(repo, 'main');
  assert.equal(status.currentBranch, 'main');
  const log = await git.history(repo);
  const initialCommit = log.find(commit => commit.subject === 'Initial commit');
  const loggedFeatureCommit = log.find(commit => commit.subject === 'Add Git UI');
  assert.ok(initialCommit);
  assert.ok(loggedFeatureCommit);
  assert.deepEqual(loggedFeatureCommit.parents, [initialCommit.hash]);
  assert.ok(log.some(commit => commit.subject === 'Add Git UI'));
  assert.ok(log.some(commit => commit.refs.includes('origin/pr-1')));

  write(path.join(repo, 'README.md'), '# Yan\n\nReviewed Git UI\n');
  write(path.join(repo, 'NEW.md'), 'new file\n');
  const review = await git.review(repo);
  assert.equal(review.count, 2);
  assert.equal(review.additions, 3);
  assert.equal(review.deletions, 0);
  assert.deepEqual(review.files.map(file => file.path).sort(), ['NEW.md', 'README.md']);
  assert.ok(review.files.find(file => file.path === 'README.md').diff.rows.some(row => row.type === 'add' && row.text === 'Reviewed Git UI'));
  assert.ok(review.files.find(file => file.path === 'NEW.md').diff.rows.some(row => row.type === 'add' && row.text === 'new file'));
});

test('review documents resolve HEAD, index, worktree, untracked and deleted content', async t => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);

  await git.initRepository(repo);
  await git.setIdentity(repo, 'Yan Review', 'review@example.com');
  write(path.join(repo, 'tracked.txt'), 'base\n');
  write(path.join(repo, 'deleted.txt'), 'remove me\n');
  await git.stageFiles(repo, [], true);
  await git.commit(repo, 'Review baseline');

  write(path.join(repo, 'tracked.txt'), 'staged\n');
  await git.stageFiles(repo, ['tracked.txt']);
  write(path.join(repo, 'tracked.txt'), 'worktree\n');
  write(path.join(repo, 'untracked.txt'), 'new file\n');
  fs.unlinkSync(path.join(repo, 'deleted.txt'));
  await git.stageFiles(repo, ['deleted.txt']);

  const staged = await git.reviewDocument(repo, 'tracked.txt', { staged: true });
  assert.deepEqual(
    { original: staged.original, modified: staged.modified },
    { original: 'base\n', modified: 'staged\n' }
  );

  const worktree = await git.reviewDocument(repo, 'tracked.txt');
  assert.deepEqual(
    { original: worktree.original, modified: worktree.modified },
    { original: 'base\n', modified: 'worktree\n' }
  );

  const untracked = await git.reviewDocument(repo, 'untracked.txt');
  assert.deepEqual(
    { status: untracked.status, original: untracked.original, modified: untracked.modified },
    { status: 'created', original: '', modified: 'new file\n' }
  );

  const deleted = await git.reviewDocument(repo, 'deleted.txt', { staged: true });
  assert.deepEqual(
    { status: deleted.status, original: deleted.original, modified: deleted.modified },
    { status: 'deleted', original: 'remove me\n', modified: '' }
  );

  const stagedSummary = await git.review(repo, { staged: true });
  assert.deepEqual(stagedSummary.files.map(file => file.path).sort(), ['deleted.txt', 'tracked.txt']);
});

test('remote workflow supports push, clone, fetch and fast-forward pull', async t => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const clone = path.join(root, 'clone');
  const remote = path.join(root, 'remote.git');
  fs.mkdirSync(source);

  await git.initRepository(source);
  await git.setIdentity(source, 'Yan Source', 'source@example.com');
  write(path.join(source, 'app.txt'), 'one\n');
  await git.stageFiles(source, [], true);
  await git.commit(source, 'Initial');
  execFileSync('git', ['init', '--bare', remote], { windowsHide: true });
  await git.addRemote(source, 'origin', remote);
  let status = await git.push(source);
  assert.equal(status.upstream, 'origin/main');
  execFileSync('git', ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { windowsHide: true });

  const cloned = await git.cloneRepository(remote, clone);
  assert.equal(cloned.status.currentBranch, 'main');
  await git.setIdentity(clone, 'Yan Clone', 'clone@example.com');
  write(path.join(clone, 'app.txt'), 'one\ntwo\n');
  await git.stageFiles(clone, [], true);
  await git.commit(clone, 'Update from clone');
  await git.push(clone);

  status = await git.fetchRemote(source);
  assert.equal(status.behind, 1);
  status = await git.pull(source);
  assert.equal(status.behind, 0);
  assert.equal(fs.readFileSync(path.join(source, 'app.txt'), 'utf8').replace(/\r\n/g, '\n'), 'one\ntwo\n');
});

test('validation rejects option injection and paths outside the repository', async t => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  await git.initRepository(repo);
  assert.throws(() => git.validateBranchName('--force'), { code: 'INVALID_BRANCH' });
  assert.throws(() => git.validateRemoteName('-origin'), { code: 'INVALID_REMOTE' });
  assert.throws(() => git.validateRemoteUrl('--upload-pack=evil'), { code: 'INVALID_REMOTE_URL' });
  await assert.rejects(() => git.stageFiles(repo, [path.join(root, 'outside.txt')]), { code: 'PATH_OUTSIDE_REPOSITORY' });
  await assert.rejects(() => git.stageFiles(repo, ['.yanagent/memory.json']), { code: 'INVALID_REPOSITORY_PATH' });
  assert.equal(git.remoteWebUrl('git@github.com:666-gy/Yan-Agent.git'), 'https://github.com/666-gy/Yan-Agent');
  assert.equal(
    git.remoteWebUrl('https://oauth2:super-secret@github.com/666-gy/Yan-Agent.git'),
    'https://github.com/666-gy/Yan-Agent'
  );

  await git.addRemote(repo, 'secure', 'https://oauth2:super-secret@github.com/666-gy/Yan-Agent.git');
  const status = await git.repositoryStatus(repo);
  const secureRemote = status.remotes.find(remote => remote.name === 'secure');
  assert.equal(secureRemote.fetchUrl, 'https://github.com/666-gy/Yan-Agent.git');
  assert.equal(secureRemote.webUrl, 'https://github.com/666-gy/Yan-Agent');
  assert.equal(secureRemote.credentialsHidden, true);
});

test('porcelain branch header parses every variant git emits', () => {
  const parse = git.parsePorcelainBranchInfo;
  assert.deepEqual(parse('## main...origin/main [ahead 1, behind 2]\0? x\0'), {
    currentBranch: 'main', upstream: 'origin/main', ahead: 1, behind: 2, unborn: false, detached: false
  });
  assert.deepEqual(parse('## main\0'), {
    currentBranch: 'main', upstream: '', ahead: 0, behind: 0, unborn: false, detached: false
  });
  assert.equal(parse('## main...origin/main\0').upstream, 'origin/main');
  assert.equal(parse('## main...origin/main [gone]\0').ahead, 0);
  assert.equal(parse('## main...origin/main [gone]\0').behind, 0);
  assert.equal(parse('## HEAD (no branch)\0').detached, true);
  assert.deepEqual(parse('## No commits yet on fresh\0'), {
    currentBranch: 'fresh', upstream: '', ahead: 0, behind: 0, unborn: true, detached: false
  });
  // Non-ASCII and slash branch names arrive unquoted.
  assert.equal(parse('## No commits yet on 分支测试\0').currentBranch, '分支测试');
  assert.equal(parse('## feat/x-y...origin/feat/x-y [ahead 3]\0').currentBranch, 'feat/x-y');
});

test('numstat -z parses plain, binary and rename records', () => {
  const sample = [
    '-\t-\tb.bin',
    '0\t2\tdel.txt',
    '1\t0\t',
    'old.txt',
    'new.txt'
  ].join('\0');
  const entries = git.parseNumstatZ(sample);
  assert.deepEqual(entries, [
    { added: 0, deleted: 0, binary: true, path: 'b.bin', originalPath: '' },
    { added: 0, deleted: 2, binary: false, path: 'del.txt', originalPath: '' },
    { added: 0, deleted: 0, binary: false, path: 'new.txt', originalPath: 'old.txt' }
  ]);
});

test('splitPatchSections cuts combined diff output at file headers', () => {
  const sections = git.splitPatchSections([
    'diff --git a/a.txt b/a.txt',
    'index 1..2 100644',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1 @@',
    '-one',
    '+two',
    'diff --git a/b.txt b/b.txt',
    '--- a/b.txt',
    '+++ b/b.txt'
  ].join('\n'));
  assert.equal(sections.length, 2);
  assert.match(sections[0], /^diff --git a\/a\.txt/);
  assert.match(sections[1], /^diff --git a\/b\.txt/);
});

test('status derives branch facts from the porcelain header', async t => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);

  await git.initRepository(repo);
  const unborn = await git.repositoryStatus(repo);
  assert.equal(unborn.currentBranch, 'main');
  assert.equal(unborn.head, '');
  assert.equal(unborn.detached, false);
  assert.equal(unborn.ahead, 0);

  await git.setIdentity(repo, 'Yan Header', 'header@example.com');
  // Heavy status (identity among it) must be fresh right after the mutation.
  assert.equal((await git.repositoryStatus(repo)).identity.name, 'Yan Header');

  write(path.join(repo, 'app.txt'), 'one\n');
  await git.stageFiles(repo, [], true);
  await git.commit(repo, 'Base');
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { windowsHide: true });
  await git.addRemote(repo, 'origin', remote);
  await git.push(repo);
  let status = await git.repositoryStatus(repo);
  assert.equal(status.upstream, 'origin/main');
  assert.equal(status.ahead, 0);
  assert.equal(status.behind, 0);

  write(path.join(repo, 'app.txt'), 'one\ntwo\n');
  await git.stageFiles(repo, [], true);
  await git.commit(repo, 'Local only');
  status = await git.repositoryStatus(repo);
  assert.equal(status.ahead, 1);
  assert.equal(status.behind, 0);

  const twin = path.join(root, 'twin');
  execFileSync('git', ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { windowsHide: true });
  execFileSync('git', ['clone', '--quiet', remote, twin], { windowsHide: true });
  execFileSync('git', ['-C', twin, 'config', 'user.name', 'Yan Test'], { windowsHide: true });
  execFileSync('git', ['-C', twin, 'config', 'user.email', 'yan@example.com'], { windowsHide: true });
  execFileSync('git', ['-C', twin, 'commit', '--allow-empty', '-m', 'Twin side'], { windowsHide: true });
  execFileSync('git', ['-C', twin, 'push', '--quiet'], { windowsHide: true });
  status = await git.fetchRemote(repo);
  assert.equal(status.ahead, 1);
  assert.equal(status.behind, 1);

  execFileSync('git', ['-C', repo, 'update-ref', '-d', 'refs/remotes/origin/main'], { windowsHide: true });
  status = await git.repositoryStatus(repo);
  assert.equal(status.upstream, 'origin/main');
  assert.equal(status.ahead, 0);
  assert.equal(status.behind, 0);

  execFileSync('git', ['-C', repo, 'checkout', '--detach', 'HEAD'], { windowsHide: true });
  status = await git.repositoryStatus(repo);
  assert.equal(status.detached, true);
  assert.equal(status.currentBranch, '');
  assert.ok(status.head.length > 0);
});

test('review reports rename content edits instead of full add/delete counts', async t => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);

  await git.initRepository(repo);
  await git.setIdentity(repo, 'Yan Rename', 'rename@example.com');
  write(path.join(repo, 'old.txt'), 'l1\nl2\nl3\n');
  await git.stageFiles(repo, [], true);
  await git.commit(repo, 'Base');

  execFileSync('git', ['-C', repo, 'mv', 'old.txt', 'new.txt'], { windowsHide: true });
  write(path.join(repo, 'new.txt'), 'l1\nl2\nl3 edited\n');

  const status = await git.repositoryStatus(repo);
  const change = status.changes.find(item => item.path === 'new.txt');
  assert.equal(change.status, 'renamed');
  assert.equal(change.originalPath, 'old.txt');
  // Rename-aware stats: only the content edit counts, not a 3-line add plus a
  // 3-line delete.
  assert.deepEqual(status.diffStats, { added: 1, deleted: 1, binaryFiles: 0 });

  const review = await git.review(repo);
  assert.equal(review.count, 1);
  const file = review.files.find(item => item.path === 'new.txt');
  assert.equal(file.status, 'modified');
  assert.equal(file.additions, 1);
  assert.equal(file.deletions, 1);
  assert.ok(file.diff.rows.some(row => row.type === 'add' && row.text === 'l3 edited'));

  // Land the worktree rename before the staged-scope phase so its counts do
  // not leak into the assertions below.
  await git.stageFiles(repo, [], true);
  await git.commit(repo, 'Rename with edit');

  // A pure staged rename (100% similarity) stays a rename with 0/0 stats.
  write(path.join(repo, 'old2.txt'), 'p1\np2\n');
  await git.stageFiles(repo, ['old2.txt']);
  await git.commit(repo, 'Add old2');
  execFileSync('git', ['-C', repo, 'mv', 'old2.txt', 'new2.txt'], { windowsHide: true });
  const pureStatus = await git.repositoryStatus(repo);
  assert.equal(pureStatus.changes.find(item => item.path === 'new2.txt').status, 'renamed');
  assert.deepEqual(pureStatus.diffStats, { added: 0, deleted: 0, binaryFiles: 0 });
  const pureReview = await git.review(repo, { staged: true });
  const pureFile = pureReview.files.find(item => item.path === 'new2.txt');
  assert.equal(pureFile.additions, 0);
  assert.equal(pureFile.deletions, 0);
});
