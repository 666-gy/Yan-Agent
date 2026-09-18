'use strict';

// Review windowing: extreme change sets must return metadata for every file
// but rows for a single selected path, so opening and switching files stays
// fast no matter how large the working tree diff is.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const git = require('../lib/git-service');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yan-review-window-'));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function numberedLines(prefix, count, suffix = '') {
  return Array.from({ length: count }, (_, index) => `${prefix} line ${index + 1}${suffix}`).join('\n') + '\n';
}

async function makeRepo(t) {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  await git.initRepository(repo);
  await git.setIdentity(repo, 'Yan Review', 'review@example.com');
  write(path.join(repo, 'big.txt'), numberedLines('base', 6000));
  write(path.join(repo, 'small.txt'), 'a\nb\nc\n');
  await git.stageFiles(repo, [], true);
  await git.commit(repo, 'Base');
  return repo;
}

test('review windows a huge change set to one file and omits the rest', async t => {
  const repo = await makeRepo(t);
  write(path.join(repo, 'big.txt'), numberedLines('rewritten', 6000));
  write(path.join(repo, 'small.txt'), 'a\nb\nc\nd\n');

  const review = await git.review(repo, { windowPath: 'big.txt' });
  assert.equal(review.windowed, true);
  assert.equal(review.windowPath, 'big.txt');
  assert.equal(review.count, 2);
  assert.ok(review.additions + review.deletions > 4000);

  const big = review.files.find(file => file.path === 'big.txt');
  assert.ok(Array.isArray(big.diff.rows));
  assert.ok(big.diff.rows.length > 0, 'window target must carry rows');
  assert.ok(big.diff.rows.length <= 2401, 'rows stay capped');
  assert.equal(big.diff.truncated, true);

  const small = review.files.find(file => file.path === 'small.txt');
  assert.equal(small.diff.rows.length, 0, 'non-window files must not ship rows');
  assert.equal(small.diff.omitted, true);
  assert.equal(small.additions, 1, 'metadata counts survive windowing');
});

test('a summary layout reports stats without any rows', async t => {
  const repo = await makeRepo(t);
  write(path.join(repo, 'big.txt'), numberedLines('rewritten', 6000));

  const summary = await git.review(repo, { layout: 'summary' });
  assert.equal(summary.windowed, false);
  for (const file of summary.files) {
    assert.equal(file.diff.rows.length, 0);
  }
  const big = summary.files.find(file => file.path === 'big.txt');
  assert.equal(big.additions, 6000);
  assert.equal(big.deletions, 6000);
});

test('small change sets keep the classic full row payload', async t => {
  const repo = await makeRepo(t);
  write(path.join(repo, 'small.txt'), 'a\nb\nc\nd\ne\n');

  const review = await git.review(repo, {});
  assert.equal(review.windowed, false);
  const small = review.files.find(file => file.path === 'small.txt');
  assert.ok(small.diff.rows.some(row => row.type === 'add' && row.text === 'e'));
});

test('untracked files are row-capped while keeping true line counts', async t => {
  const repo = await makeRepo(t);
  write(path.join(repo, 'generated.txt'), numberedLines('generated', 12_000));

  const review = await git.review(repo, { paths: ['generated.txt'] });
  assert.equal(review.count, 1);
  const file = review.files[0];
  assert.equal(file.additions, 12_000);
  assert.equal(file.diff.truncated, true);
  assert.ok(file.diff.rows.length <= 2401);
  assert.ok(file.diff.rows.some(row => row.type === 'truncate'), 'truncate marker present');
});

test('paths filter builds rows for the requested file only', async t => {
  const repo = await makeRepo(t);
  write(path.join(repo, 'big.txt'), numberedLines('rewritten', 6000));
  write(path.join(repo, 'small.txt'), 'a\nb\nc\nd\n');

  const review = await git.review(repo, { paths: ['small.txt'], layout: 'full' });
  assert.equal(review.count, 1);
  assert.equal(review.files[0].path, 'small.txt');
  assert.ok(review.files[0].diff.rows.some(row => row.type === 'add' && row.text === 'd'));
});
