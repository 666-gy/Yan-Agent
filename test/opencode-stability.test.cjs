'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isTransientOpenCodeError,
  withRetries,
  createAbortError,
  PROMPT_RETRY_ATTEMPTS
} = require('../lib/opencode-stability');

test('classifies mid-stream interruption and transport errors as transient', () => {
  const transient = [
    'Upstream response stream was interrupted',
    'upstream response stream was interrupted before completion',
    'DeepSeek returned an incomplete Tool Call block.',
    'fetch failed: socket hang up',
    'ECONNRESET: connection reset',
    'request failed with status 503',
    'The operation was aborted due to timeout',
    'DeepSeek 工具调用适配失败：DeepSeek returned DSML text without a parseable Tool Call.',
    'rate limit exceeded (429)'
  ];
  for (const message of transient) {
    assert.equal(isTransientOpenCodeError({ message }), true, message);
  }
});

test('does not classify config, auth, or context errors as transient', () => {
  const stable = [
    "Expected 'id' to be a string.",
    'ConfigInvalidError: Invalid input',
    'Invalid API key provided',
    'This model maximum context length is 128000 tokens',
    'OpenCode configuration changed while Agent runs are active.',
    ''
  ];
  for (const message of stable) {
    assert.equal(isTransientOpenCodeError({ message }), false, message);
  }
});

test('withRetries retries transient failures and returns the first success', async () => {
  let calls = 0;
  const result = await withRetries(async () => {
    calls += 1;
    if (calls < 3) throw new Error('upstream response stream was interrupted');
    return 'ok';
  }, { baseDelayMs: 1 });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('withRetries stops immediately on a non-transient failure', async () => {
  let calls = 0;
  await assert.rejects(
    withRetries(async () => {
      calls += 1;
      throw new Error("Expected 'id' to be a string.");
    }, { baseDelayMs: 1 }),
    /Expected 'id'/
  );
  assert.equal(calls, 1);
});

test('withRetries honors an abort signal and stops retrying', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    withRetries(async () => {
      calls += 1;
      controller.abort(createAbortError('stopped'));
      throw new Error('upstream response stream was interrupted');
    }, { baseDelayMs: 1, signal: controller.signal }),
    /stopped/
  );
  assert.equal(calls, 1);
});

test('withRetries gives up after the configured attempt budget', async () => {
  let calls = 0;
  await assert.rejects(
    withRetries(async () => {
      calls += 1;
      throw new Error('upstream response stream was interrupted');
    }, { attempts: 2, baseDelayMs: 1 }),
    /upstream response stream was interrupted/
  );
  assert.equal(calls, 2);
  assert.equal(PROMPT_RETRY_ATTEMPTS, 3);
});
