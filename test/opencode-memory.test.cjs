'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  OpenCodeSidecar,
  combineSystem,
  normalizeMemoryReview
} = require('../lib/opencode-sidecar');

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

test('injects retrieved memory as prior observations with explicit verification boundaries', () => {
  const system = combineSystem({
    memoryContext: '- [workspace/project] This project builds with npm run verify.',
    availableSkills: [],
    availableMcpServers: []
  });
  assert.match(system, /yan-long-term-memory/);
  assert.match(system, /npm run verify/);
  assert.match(system, /not fresh tool evidence/i);
  assert.match(system, /reverify paths/i);
  assert.match(system, /current request and fresh evidence win/i);
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

test('memory reviewer uses an isolated no-tool session and deletes it after structured output', async t => {
  const calls = { create: null, prompt: null, deleted: null };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-memory-reviewer-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir });
  sidecar.client = {
    session: {
      create: async payload => {
        calls.create = payload;
        return { data: { id: 'memory-reviewer' } };
      },
      prompt: async payload => {
        calls.prompt = payload;
        return { data: { info: { structured: {
          memories: [{
            key: 'project.build.command',
            type: 'project',
            scope: 'workspace',
            content: 'The verified project build command is npm run verify.',
            keywords: ['build', 'verify'],
            confidence: 0.95,
            evidence: 'The command completed successfully in this run.',
            basis: 'successful_outcome',
            durable: true,
            verified: true,
            sensitive: false,
            transient: false
          }],
          skillCandidate: null,
          harnessCandidates: [],
          refinementOutcomes: []
        } } } };
      },
      delete: async payload => {
        calls.deleted = payload;
        return { data: true };
      }
    }
  };

  const review = await sidecar.reviewMemory(completedPayload());
  assert.equal(review.memories.length, 1);
  assert.deepEqual(calls.create.permission, [{ permission: '*', pattern: '*', action: 'deny' }]);
  assert.deepEqual(calls.prompt.tools, { '*': false });
  assert.equal(calls.prompt.format.type, 'json_schema');
  assert.equal(calls.deleted.sessionID, 'memory-reviewer');
});

test('memory review failure is non-fatal and still cleans up the isolated session', async t => {
  let deleted = false;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-memory-reviewer-failed-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir,
    log: { warn: () => {} }
  });
  sidecar.client = {
    session: {
      create: async () => ({ data: { id: 'memory-reviewer-failed' } }),
      prompt: async () => { throw new Error('provider unavailable'); },
      delete: async () => { deleted = true; return { data: true }; }
    }
  };

  const review = await sidecar.reviewMemory(completedPayload());
  assert.deepEqual(review.memories, []);
  assert.equal(review.skillCandidate, null);
  assert.match(review.error, /provider unavailable/i);
  assert.equal(deleted, true);
});
