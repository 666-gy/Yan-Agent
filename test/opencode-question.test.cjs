'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenCodeSidecar } = require('../lib/opencode-sidecar');

function sidecarWithQuestionClient(question) {
  const sidecar = new OpenCodeSidecar();
  sidecar.client = { question };
  return sidecar;
}

test('question reply preserves request, directory, and answer arrays', async () => {
  const calls = [];
  const sidecar = sidecarWithQuestionClient({
    reply: async payload => {
      calls.push(payload);
      return { data: true };
    }
  });

  const result = await sidecar.replyQuestion({
    requestId: 'question_active',
    directory: 'C:\\workspace',
    answers: [['Use existing config'], ['TypeScript', 'Node.js']]
  });

  assert.deepEqual(result, { ok: true, result: true });
  assert.deepEqual(calls[0], {
    requestID: 'question_active',
    directory: 'C:\\workspace',
    answers: [['Use existing config'], ['TypeScript', 'Node.js']]
  });
});

test('question rejection uses the SDK reject endpoint', async () => {
  const calls = [];
  const sidecar = sidecarWithQuestionClient({
    reject: async payload => {
      calls.push(payload);
      return { data: true };
    }
  });

  const result = await sidecar.replyQuestion({
    requestId: 'question_rejected',
    directory: 'C:\\workspace',
    reject: true
  });

  assert.deepEqual(result, { ok: true, result: true });
  assert.deepEqual(calls[0], {
    requestID: 'question_rejected',
    directory: 'C:\\workspace'
  });
});

test('an already-settled question reply is idempotent', async () => {
  const sidecar = sidecarWithQuestionClient({
    reply: async () => ({
      error: {
        _tag: 'QuestionNotFoundError',
        requestID: 'question_stale',
        message: 'Question request not found: question_stale'
      }
    })
  });

  const result = await sidecar.replyQuestion({
    requestId: 'question_stale',
    directory: 'C:\\workspace',
    answers: [['late answer']]
  });

  assert.deepEqual(result, { ok: true, stale: true, requestId: 'question_stale' });
});

test('an SDK-wrapped question-not-found error is idempotent for rejection', async () => {
  const wrapped = new Error('POST /question/question_wrapped/reject -> 404');
  wrapped.cause = {
    status: 404,
    body: {
      _tag: 'QuestionNotFoundError',
      requestID: 'question_wrapped',
      message: 'Question request not found: question_wrapped'
    }
  };
  const sidecar = sidecarWithQuestionClient({
    reject: async () => { throw wrapped; }
  });

  const result = await sidecar.replyQuestion({
    requestId: 'question_wrapped',
    directory: 'C:\\workspace',
    reject: true
  });

  assert.deepEqual(result, { ok: true, stale: true, requestId: 'question_wrapped' });
});

test('question reply rejects missing request IDs before calling the SDK', async () => {
  let called = false;
  const sidecar = sidecarWithQuestionClient({
    reply: async () => { called = true; }
  });

  const result = await sidecar.replyQuestion({ answers: [['answer']] });

  assert.deepEqual(result, { ok: false, error: 'OpenCode question request ID is missing' });
  assert.equal(called, false);
});
