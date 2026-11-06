'use strict';

const test = require('node:test');

const assert = require('node:assert/strict');

const fs = require('node:fs');

const os = require('node:os');

const path = require('node:path');
const { combineSystem, combineTurnPrompt, normalizeMemoryReview } = require('../lib/kernel-policy');

function completedPayload() {
  return {
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workspace: 'C:\\workspace',
    sessionId: 'yan-session',
    runId: 'run-memory',
    prompt: 'Use the project build command and fix the compile error.',
    history: [{ role: 'user', content: 'Keep the final response concise.' }],
    result: {
      status: 'done',
      text: 'Fixed and compiled successfully.',
      toolCalls: [{ name: 'bash', status: 'completed', ok: true, args: { command: 'npm test' }, output: 'passed' }],
      changes: [{ file: 'src/app.js', status: 'modified', additions: 1, deletions: 1 }],
      todos: []
    }
  };
}

test('injects retrieved memory into the current turn while keeping the system prefix stable', () => {
  const request = {
    runId: 'run-memory',
    memoryContext: '- [workspace/project] This project builds with npm run verify.',
    availableSkills: [],
    availableMcpServers: []
  };
  const system = combineSystem(request);
  const turn = combineTurnPrompt(request, 'Fix the build.', false);
  assert.doesNotMatch(system, /yan-long-term-memory/);
  assert.doesNotMatch(system, /npm run verify/);
  assert.match(turn, /yan-long-term-memory/);
  assert.match(turn, /npm run verify/);
  assert.match(turn, /not fresh tool evidence/i);
  assert.match(turn, /reverify paths/i);
  assert.match(turn, /current request and fresh evidence win/i);
});

test('dynamic run context never changes the cacheable system prefix', () => {
  const stable = {
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    availableSkills: [],
    availableMcpServers: []
  };
  const first = {
    ...stable,
    runId: 'run-a',
    yanSessionId: 'session-a',
    workspace: 'C:\\workspace-a',
    workMode: 'normal',
    memoryContext: 'memory-a',
    harnessContext: 'harness-a',
    measuredInputTokensPerSecond: 6000,
    repoMap: 'repo map: 1 code file\n  src/before.js'
  };
  const second = {
    ...stable,
    runId: 'run-b',
    yanSessionId: 'session-b',
    workspace: 'C:\\workspace-b',
    workMode: 'goal',
    memoryContext: 'memory-b',
    harnessContext: 'harness-b',
    measuredInputTokensPerSecond: 30000,
    repoMap: 'repo map: 2 code files\n  src/after.js'
  };

  assert.equal(combineSystem(first), combineSystem(second));
  assert.notEqual(
    combineTurnPrompt(first, 'Do the work.', false),
    combineTurnPrompt(second, 'Do the work.', false)
  );
});

test('GLMM measurement and repo updates preserve the prefix and refresh only the new turn', () => {
  const stable = { providerId: 'glm', modelId: 'glm-5.3-flash' };
  const system = combineSystem(stable);
  for (const speed of [0, 6000, 30000, 233458]) {
    const request = { ...stable, measuredInputTokensPerSecond: speed, repoMap: `snapshot-${speed}` };
    assert.equal(combineSystem(request), system);
    const turn = combineTurnPrompt(request, 'Continue.');
    assert.match(turn, new RegExp(`<yan-repo-map>\\nsnapshot-${speed}\\n</yan-repo-map>`));
    if (speed) assert.match(turn, /Recent effective input throughput/);
    else assert.doesNotMatch(turn, /Recent effective input throughput/);
  }
  assert.match(system, /current yan-turn-context; older turns are historical/);
  assert.match(system, /no measurement, use input_tokens_per_second=10000/);
});

test('Skill and MCP catalog order cannot invalidate the cacheable prefix', () => {
  const skills = [
    { id: 'zeta', name: 'Zeta', description: 'last' },
    { id: 'alpha', name: 'Alpha', description: 'first' }
  ];
  const servers = [
    { id: 'zeta', name: 'Zeta MCP', description: 'last' },
    { id: 'alpha', name: 'Alpha MCP', description: 'first' }
  ];
  const first = combineSystem({ availableSkills: skills, availableMcpServers: servers });
  const second = combineSystem({
    availableSkills: [...skills].reverse(),
    availableMcpServers: [...servers].reverse()
  });
  assert.equal(first, second);
  assert.ok(first.indexOf('alpha | Alpha') < first.indexOf('zeta | Zeta'));
});

test('normalization accepts durable evidence and rejects transient, sensitive, or unverified records', () => {
  const review = normalizeMemoryReview({
    memories: [
      {
        key: 'preference.response.style',
        type: 'preference',
        scope: 'global',
        content: 'The user prefers concise final responses.',
        keywords: ['concise'],
        confidence: 0.95,
        evidence: 'The user stated this preference directly.',
        basis: 'explicit_user_statement',
        durable: true,
        verified: true,
        sensitive: false,
        transient: false
      },
      {
        key: 'project.current.progress',
        type: 'project',
        scope: 'workspace',
        content: 'The current command is still running.',
        keywords: ['running'],
        confidence: 0.9,
        evidence: 'A progress event was observed.',
        basis: 'verified_tool_result',
        durable: false,
        verified: true,
        sensitive: false,
        transient: true
      },
      {
        key: 'environment.secret',
        type: 'environment',
        scope: 'machine',
        content: 'A credential was found.',
        keywords: ['credential'],
        confidence: 1,
        evidence: 'Tool output contained it.',
        basis: 'verified_tool_result',
        durable: true,
        verified: true,
        sensitive: true,
        transient: false
      },
      {
        key: 'environment.runtime',
        type: 'environment',
        scope: 'machine',
        content: 'A runtime might be installed.',
        keywords: ['runtime'],
        confidence: 0.6,
        evidence: 'The model guessed from a filename.',
        basis: 'project_artifact',
        durable: true,
        verified: false,
        sensitive: false,
        transient: false
      },
      {
        key: 'failure.compile.missing-semicolon',
        type: 'failure_solution',
        scope: 'workspace',
        content: 'After adding the missing semicolon, the project compiled successfully.',
        keywords: ['compile', 'semicolon'],
        confidence: 0.98,
        evidence: 'The compiler exited successfully after the edit.',
        basis: 'successful_outcome',
        durable: true,
        verified: true,
        sensitive: false,
        transient: false
      }
    ],
    skillCandidate: null,
    harnessCandidates: [],
    refinementOutcomes: []
  }, 'C:\\workspace');

  assert.deepEqual(review.memories.map(item => item.key), [
    'preference.response.style',
    'failure.compile.missing-semicolon'
  ]);
});

test('normalization keeps a valid workspace work state and drops empty ones', () => {
  const review = normalizeMemoryReview({
    memories: [],
    workState: {
      done: 'Completed the icon download',
      pending: 'Wire it into the page',
      nextStep: 'Run the smoke test',
      evidence: 'output/icons/check.svg'
    },
    skillCandidate: null,
    harnessCandidates: [],
    refinementOutcomes: []
  }, 'C:\\workspace');
  assert.equal(
    review.workState.content,
    '进展：Completed the icon download；未决：Wire it into the page；下一步：Run the smoke test'
  );
  assert.equal(review.workState.evidence, 'output/icons/check.svg');

  const withoutWorkspace = normalizeMemoryReview({
    workState: { done: 'Anything', pending: '', nextStep: '', evidence: 'y' }
  }, '');
  assert.equal(withoutWorkspace.workState, null);

  const withoutProgress = normalizeMemoryReview({
    workState: { done: '', pending: '', nextStep: '', evidence: 'y' }
  }, 'C:\\workspace');
  assert.equal(withoutProgress.workState, null);
});