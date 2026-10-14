'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  lengthTruncatedWithoutOutput,
  noFinalAnswerError
} = require('../lib/opencode-sidecar');

test('lengthTruncatedWithoutOutput recognizes reasoning-only truncation', () => {
  const truncated = {
    info: {
      role: 'assistant',
      finish: { unified: 'length', raw: 'length' },
      tokens: { output: 180, reasoning: 31820 }
    },
    parts: []
  };
  assert.equal(lengthTruncatedWithoutOutput(truncated), true);
});

test('lengthTruncatedWithoutOutput rejects message with text', () => {
  const withText = {
    info: {
      role: 'assistant',
      finish: { unified: 'length' },
      tokens: { output: 2400, reasoning: 29600 }
    },
    parts: [{ type: 'text', text: '分析完成，现在执行操作。' }]
  };
  assert.equal(lengthTruncatedWithoutOutput(withText), false);
});

test('lengthTruncatedWithoutOutput rejects message with tool calls', () => {
  const withTools = {
    info: {
      role: 'assistant',
      finish: { unified: 'length' },
      tokens: { output: 1200, reasoning: 30800 }
    },
    parts: [{ type: 'tool', tool: 'read', state: { status: 'completed' } }]
  };
  assert.equal(lengthTruncatedWithoutOutput(withTools), false);
});

test('lengthTruncatedWithoutOutput ignores a reasoning-only part list', () => {
  const reasoningOnly = {
    info: { role: 'assistant', finish: 'length', tokens: { output: 0, reasoning: 32000 } },
    parts: [{ type: 'reasoning', text: '...' }, { type: 'text', text: '', ignored: true }]
  };
  assert.equal(lengthTruncatedWithoutOutput(reasoningOnly), true);
});

test('lengthTruncatedWithoutOutput rejects stop reason', () => {
  const stopped = {
    info: {
      role: 'assistant',
      finish: { unified: 'stop' },
      tokens: { output: 80 }
    },
    parts: []
  };
  assert.equal(lengthTruncatedWithoutOutput(stopped), false);
});

test('lengthTruncatedWithoutOutput rejects message with error', () => {
  const errored = {
    info: {
      role: 'assistant',
      finish: { unified: 'length' },
      error: { message: 'Rate limit exceeded' }
    },
    parts: []
  };
  assert.equal(lengthTruncatedWithoutOutput(errored), false);
});

test('noFinalAnswerError produces actionable message for length over 30k', () => {
  const message = {
    info: {
      finish: { unified: 'length' },
      tokens: { output: 2100, reasoning: 29900 }
    }
  };
  const error = noFinalAnswerError(message);
  assert.match(error, /32,000 token/);
  assert.match(error, /思考 29,900/);
  assert.match(error, /调整该模型的最大输出/);
});

test('noFinalAnswerError produces brief message for length under 30k', () => {
  const message = {
    info: {
      finish: { unified: 'length' },
      tokens: { output: 800, reasoning: 1200 }
    }
  };
  const error = noFinalAnswerError(message);
  assert.match(error, /finish=length/);
  assert.match(error, /2,000 token/);
  assert.doesNotMatch(error, /设置/);
});

test('noFinalAnswerError handles stop reason', () => {
  const message = {
    info: {
      finish: { unified: 'stop', raw: 'end_turn' },
      tokens: { output: 45 }
    }
  };
  const error = noFinalAnswerError(message);
  assert.match(error, /finish=stop/);
  assert.match(error, /output=45/);
});
