'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compactOpenCodeSession,
  latestOpenCodeContextTokens,
  openCodeContextBudget
} = require('../lib/opencode-sidecar');

function requestWithContext(contextWindow = 128_000) {
  return {
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    openCodeConfig: {
      provider: {
        deepseek: {
          models: {
            'deepseek-chat': { limit: { context: contextWindow } }
          }
        }
      },
      compaction: { reserved: 24_000 }
    }
  };
}

function assistantMessage(id, tokens) {
  return {
    info: {
      id,
      role: 'assistant',
      tokens: { input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
    },
    parts: [{ type: 'text', text: 'done' }]
  };
}

test('derives the proactive compaction line from the active model context window', () => {
  assert.deepEqual(openCodeContextBudget(requestWithContext()), {
    contextWindow: 128_000,
    reserved: 24_000,
    softThreshold: 102_400
  });
  assert.equal(openCodeContextBudget(requestWithContext(16_384)).softThreshold, 12_288);
  assert.equal(openCodeContextBudget(requestWithContext(1_000_000)).softThreshold, 800_000);
});

test('reads the latest measured OpenCode context instead of summing every turn', () => {
  assert.equal(latestOpenCodeContextTokens([
    assistantMessage('old', 70_000),
    { info: { id: 'user', role: 'user' }, parts: [] },
    assistantMessage('new', 12_000)
  ]), 12_000);
});

test('does not compact a session below the soft threshold', async () => {
  let summarizeCalls = 0;
  const result = await compactOpenCodeSession({
    client: { session: { summarize: async () => { summarizeCalls += 1; } } },
    session: { id: 'session-low' },
    directory: 'C:\\workspace',
    request: requestWithContext(),
    messages: [assistantMessage('assistant-low', 50_000)]
  });
  assert.equal(result.compacted, false);
  assert.equal(result.failed, false);
  assert.equal(summarizeCalls, 0);
});

test('compacts a reused OpenCode session and measures its active post-compaction context', async () => {
  const events = [];
  let summarizePayload = null;
  const nextMessages = [assistantMessage('summary', 96_000)];
  const client = {
    session: {
      summarize: async payload => {
        summarizePayload = payload;
        return { data: true };
      },
      messages: async () => ({ data: nextMessages })
    },
    v2: {
      session: {
        context: async () => ({
          data: {
            data: [{ type: 'compaction', summary: '保留目标、约束、路径和当前进度。', recent: '继续完成验收。' }]
          }
        })
      }
    }
  };
  const result = await compactOpenCodeSession({
    client,
    session: { id: 'session-high' },
    directory: 'C:\\workspace',
    request: requestWithContext(),
    messages: [assistantMessage('assistant-high', 110_000)],
    onEvent: event => events.push(event)
  });

  assert.equal(result.compacted, true);
  assert.equal(result.failed, false);
  assert.equal(result.afterTokens > 0, true);
  assert.deepEqual(summarizePayload, {
    sessionID: 'session-high',
    directory: 'C:\\workspace',
    providerID: 'deepseek',
    modelID: 'deepseek-chat',
    auto: true
  });
  assert.deepEqual(events.map(event => event.type), [
    'yan.context.compression.started',
    'yan.context.compression.completed'
  ]);
});

test('keeps the task runnable when proactive compaction fails', async () => {
  const events = [];
  const original = [assistantMessage('assistant-high', 110_000)];
  const result = await compactOpenCodeSession({
    client: {
      session: {
        summarize: async () => ({ error: { message: 'provider unavailable' } })
      }
    },
    session: { id: 'session-failed' },
    directory: 'C:\\workspace',
    request: requestWithContext(),
    messages: original,
    onEvent: event => events.push(event)
  });

  assert.equal(result.compacted, false);
  assert.equal(result.failed, true);
  assert.equal(result.messages, original);
  assert.match(result.error, /provider unavailable/i);
  assert.equal(events.at(-1).type, 'yan.context.compression.failed');
});
