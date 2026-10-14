'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function service(responses) {
  const calls = [], module = {exports:{}};
  const spawn = (_binary, args, options) => {
    calls.push({args, options});
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.emit('data', JSON.stringify(responses.shift()));
      child.emit('close', 0);
    });
    return child;
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../lib/gh-service'), 'utf8'), {
    module, exports:module.exports, process, URL, setTimeout, clearTimeout,
    require: name => name === 'child_process' ? {spawn} : require(name)
  });
  return {gh:module.exports, calls};
}

test('review project reads every PR page and preserves target and source repository permissions', async () => {
  const repo = {name:'repo', owner:{login:'team'}, url:'https://github.company.test/team/repo'};
  const page = (nodes, next) => ({data:{repository:{nameWithOwner:'team/repo',url:repo.url,owner:repo.owner,viewerPermission:'WRITE',pullRequests:{nodes,pageInfo:{hasNextPage:!!next,endCursor:next}}}}});
  const {gh, calls} = service([repo, page([{number:1,headRepository:{viewerPermission:'READ'}}], 'next'), page([{number:2,headRepository:{viewerPermission:'WRITE'}}], '')]);
  const result = await gh.reviewProject({cwd:process.cwd()});
  assert.equal(result.repository.permission, 'WRITE');
  assert.equal(result.repository.developer, 'team');
  assert.equal(result.prs.length, 2);
  assert.equal(result.prs[0].headRepository.viewerPermission, 'READ');
  assert.ok(calls[1].args.includes('github.company.test'));
  assert.ok(calls[2].args.includes('cursor=next'));
  assert.equal(calls[2].options.cwd, process.cwd());
});

test('review project rejects partial GraphQL permission responses', async () => {
  const {gh} = service([{name:'r',owner:{login:'o'},url:'https://github.com/o/r'}, {errors:[{message:'Forbidden'}],data:{repository:null}}]);
  await assert.rejects(gh.reviewProject({cwd:process.cwd()}), {code:'GH_INVALID_RESPONSE'});
});

test('merge requires the displayed PR commit when supplied', async () => {
  const {gh, calls} = service(['merged']);
  await gh.prMerge({cwd:process.cwd(),number:12,method:'squash',expectedHead:'abc123'});
  assert.deepEqual(Array.from(calls[0].args), ['pr','merge','12','--squash','--match-head-commit','abc123']);
});

test('issue list pages through GraphQL and drops pull requests', async () => {
  const repo = {name:'repo', owner:{login:'team'}, url:'https://github.com/team/repo'};
  const page = (nodes, next) => ({data:{repository:{issues:{nodes,pageInfo:{hasNextPage:!!next,endCursor:next}}}}});
  const {gh, calls} = service([
    repo,
    page([{__typename:'Issue',number:3,title:'Crash',url:'https://github.com/team/repo/issues/3',state:'OPEN',author:{login:'yan'},updatedAt:'2026-10-01T00:00:00Z',labels:{nodes:[{name:'bug'}]}},{__typename:'PullRequest',number:9,title:'PR'}], 'next'),
    page([{__typename:'Issue',number:4,title:'Slow',url:'https://github.com/team/repo/issues/4',state:'OPEN',author:{login:'yan2'},updatedAt:'2026-09-01T00:00:00Z',labels:{nodes:[]}}], '')
  ]);
  const issues = await gh.issueList({cwd:process.cwd()});
  assert.deepEqual(Array.from(calls[0].args).slice(0,3), ['repo','view','--json']);
  assert.equal(calls[1].args[0], 'api');
  assert.equal(calls[1].args[1], 'graphql');
  assert.ok(calls[1].args.includes('owner=team') && calls[1].args.includes('name=repo'));
  assert.ok(calls[2].args.includes('cursor=next'));
  assert.deepEqual(JSON.parse(JSON.stringify(issues)), [
    {number:3,title:'Crash',state:'open',url:'https://github.com/team/repo/issues/3',updatedAt:'2026-10-01T00:00:00Z',author:'yan',labels:['bug']},
    {number:4,title:'Slow',state:'open',url:'https://github.com/team/repo/issues/4',updatedAt:'2026-09-01T00:00:00Z',author:'yan2',labels:[]}
  ]);
});

test('issue list rejects a GraphQL error response', async () => {
  const {gh} = service([{name:'r',owner:{login:'o'},url:'https://github.com/o/r'}, {errors:[{message:'Forbidden'}],data:{repository:null}}]);
  await assert.rejects(gh.issueList({cwd:process.cwd()}), {code:'GH_INVALID_RESPONSE'});
});
