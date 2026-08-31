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
