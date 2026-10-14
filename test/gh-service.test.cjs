'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  detectGh,
  resolveRepoSlug,
  buildPrListArgs,
  parsePrList,
  buildPrCreateArgs,
  parsePrUrl,
  parseIssueNodes,
  buildIssueCreateArgs,
  parseIssueUrl,
  prDiff,
  GhError
} = require('../lib/gh-service');

test('resolveRepoSlug understands https and ssh remote URLs', () => {
  assert.equal(resolveRepoSlug('https://github.com/owner/repo.git'), 'owner/repo');
  assert.equal(resolveRepoSlug('https://github.com/owner/repo'), 'owner/repo');
  assert.equal(resolveRepoSlug('git@github.com:owner/repo.git'), 'owner/repo');
  assert.equal(resolveRepoSlug('ssh://git@github.com/owner/repo.git'), 'owner/repo');
  assert.equal(resolveRepoSlug('https://gitlab.com/owner/repo.git'), 'owner/repo');
  assert.equal(resolveRepoSlug('not a url'), '');
  assert.equal(resolveRepoSlug(''), '');
});

test('buildPrListArgs normalizes state and clamps the limit', () => {
  assert.deepEqual(
    buildPrListArgs({ limit: 5, state: 'open', base: 'main' }),
    ['pr', 'list', '--json', 'number,title,state,headRefName,baseRefName,url,updatedAt,author', '--limit', '5', '--state', 'open', '--base', 'main']
  );
  const args = buildPrListArgs({ limit: 9999, state: 'bogus' });
  assert.equal(args[args.indexOf('--limit') + 1], '100');
  assert.equal(args[args.indexOf('--state') + 1], 'open');
});

test('parsePrList normalizes gh JSON rows and drops junk', () => {
  const rows = parsePrList(JSON.stringify([
    { number: 12, title: 'Fix login', state: 'OPEN', headRefName: 'fix-login', baseRefName: 'main', url: 'https://github.com/o/r/pull/12', updatedAt: '2026-09-14T00:00:00Z', author: { login: 'yan' } },
    { number: 'x' }
  ]));
  assert.deepEqual(rows, [{
    number: 12,
    title: 'Fix login',
    state: 'open',
    headRefName: 'fix-login',
    baseRefName: 'main',
    url: 'https://github.com/o/r/pull/12',
    updatedAt: '2026-09-14T00:00:00Z',
    author: 'yan'
  }]);
  assert.throws(() => parsePrList('not json'), GhError);
  assert.throws(() => parsePrList(''), GhError);
});

test('buildPrCreateArgs requires a title and falls back to --fill', () => {
  assert.throws(() => buildPrCreateArgs({ title: '  ' }), GhError);
  assert.deepEqual(buildPrCreateArgs({ title: 'T' }), ['pr', 'create', '--title', 'T', '--fill']);
  assert.deepEqual(
    buildPrCreateArgs({ title: 'T', body: 'B', base: 'main', draft: true }),
    ['pr', 'create', '--title', 'T', '--body', 'B', '--base', 'main', '--draft']
  );
});

test('parsePrUrl extracts the PR link from gh output', () => {
  assert.equal(parsePrUrl('Creating pull request for branch...\nhttps://github.com/o/r/pull/9\n'), 'https://github.com/o/r/pull/9');
  assert.equal(parsePrUrl('nothing here'), '');
  assert.equal(parsePrUrl('https://github.company.test/o/r/pull/17'), 'https://github.company.test/o/r/pull/17');
  assert.equal(parsePrUrl('https://github.com/o/r/issues/17'), '');
});

test('parseIssueNodes keeps real issues and filters pull requests and junk', () => {
  const rows = parseIssueNodes([
    { __typename: 'Issue', number: 3, title: 'Crash on save', state: 'OPEN', url: 'https://github.com/o/r/issues/3', updatedAt: '2026-10-01T00:00:00Z', author: { login: 'yan' }, labels: { nodes: [{ name: 'bug' }, { name: '' }] } },
    { __typename: 'PullRequest', number: 4, title: 'A PR that shares the issues connection' },
    { number: 'x' }
  ]);
  assert.deepEqual(rows, [{
    number: 3,
    title: 'Crash on save',
    state: 'open',
    url: 'https://github.com/o/r/issues/3',
    updatedAt: '2026-10-01T00:00:00Z',
    author: 'yan',
    labels: ['bug']
  }]);
  assert.deepEqual(parseIssueNodes(undefined), []);
});


test('buildIssueCreateArgs requires a title and passes the body', () => {
  assert.throws(() => buildIssueCreateArgs({ title: '  ' }), GhError);
  assert.deepEqual(buildIssueCreateArgs({ title: 'T', body: 'B' }), ['issue', 'create', '--title', 'T', '--body', 'B']);
  assert.deepEqual(buildIssueCreateArgs({ title: 'T', body: 'B', bodyFile: '/tmp/b.md' }), ['issue', 'create', '--title', 'T', '--body-file', '/tmp/b.md']);
});

test('parseIssueUrl extracts the issue link from gh output', () => {
  assert.equal(parseIssueUrl('Creating issue...\nhttps://github.com/o/r/issues/9\n'), 'https://github.com/o/r/issues/9');
  assert.equal(parseIssueUrl('nothing here'), '');
  assert.equal(parseIssueUrl('https://github.com/o/r/pull/17'), '');
});

test('detectGh degrades to null when the binary is unavailable', async t => {
  const missing = process.platform === 'win32' ? 'yan-no-such-gh-binary' : '/yan/none/gh';
  assert.equal(await detectGh({ ghPath: missing }), null);
});

test('prDiff validates the PR number before touching the CLI', async () => {
  await assert.rejects(() => prDiff({ number: 0 }), GhError);
  await assert.rejects(() => prDiff({ number: 'abc' }), GhError);
});


test('GitHub connection status exposes active account state without credentials', () => {
  const { parseConnectionStatus } = require('../lib/gh-service');
  const result = parseConnectionStatus({ hosts: { 'github.com': [
    { login: 'valid', state: 'success', active: true, oauthToken: 'private', scopes: 'repo' },
    { login: 'old', state: 'error', active: false }
  ] } });
  assert.equal(result.connected, true);
  assert.equal(result.accounts[0].login, 'valid');
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(parseConnectionStatus({ hosts: {} }).connected, false);
});
