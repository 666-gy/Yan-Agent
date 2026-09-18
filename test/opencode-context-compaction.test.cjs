'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOpenCodeConfig,
  compactOpenCodeSession,
  latestOpenCodeContextTokens,
  openCodeContextBudget,
  buildCompactionAnchor,
  contextAnchorSystem,
  estimateContextMessagesTokens
} = require('../lib/opencode-sidecar');
const {
  normalizeContextSettings,
  contextKToTokens,
  contextTokensToK
} = require('../lib/context-settings');
const {
  isContextOverflowError
} = require('../lib/opencode-stability');

function requestWithContext(contextWindow = 128_000, compactionThreshold = Math.floor(contextWindow * 0.75)) {
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
      compaction: { reserved: 24_000, threshold: compactionThreshold }
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

test('uses the user-configured context window and compaction threshold verbatim', () => {
  assert.deepEqual(openCodeContextBudget(requestWithContext()), {
    contextWindow: 128_000,
    reserved: 24_000,
    softThreshold: 96_000,
    hardThreshold: 128_000
  });
  assert.equal(openCodeContextBudget(requestWithContext(16_384, 12_000)).softThreshold, 12_000);
  assert.equal(openCodeContextBudget(requestWithContext(1_000_000, 950_000)).softThreshold, 950_000);
});

test('falls back to the migrated 1000k / 800k defaults when config is absent', () => {
  const budget = openCodeContextBudget({
    providerId: 'custom',
    modelId: 'mystery-model',
    openCodeConfig: {
      provider: { custom: { models: { 'mystery-model': {} } } },
      compaction: { reserved: 24_000 }
    }
  });
  assert.equal(budget.contextWindow, 1_000_000);
  assert.equal(budget.softThreshold, 800_000);
  assert.equal(budget.hardThreshold, 1_000_000);
});

test('builds OpenCode limits from explicit settings instead of inferred model limits', () => {
  const config = buildOpenCodeConfig({
    providerId: 'custom',
    providerName: 'Custom',
    modelId: 'tiny-declared-model',
    modelName: 'Tiny declared model',
    contextWindow: 2_000_000,
    compactionThreshold: 1_500_000,
    capabilities: { contextWindow: 32_768, maxOutputTokens: 8_192 }
  });
  assert.equal(config.provider.custom.models['tiny-declared-model'].limit.context, 2_000_000);
  assert.equal(config.compaction.threshold, 1_500_000);
  assert.equal(openCodeContextBudget({
    providerId: 'custom',
    modelId: 'tiny-declared-model',
    openCodeConfig: config
  }).softThreshold, 1_500_000);
});

test('converts decimal k values and normalizes invalid persisted thresholds', () => {
  assert.equal(contextKToTokens('128.5'), 128_500);
  assert.equal(contextTokensToK(128_500), '128.5');
  assert.equal(contextKToTokens('1e3'), 0);
  assert.deepEqual(normalizeContextSettings({
    maxTokens: 64_000,
    compactionThreshold: 80_000
  }), {
    maxTokens: 64_000,
    compactionThreshold: 63_999
  });
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

test('compacts from a content estimate when the provider reports no usage', async () => {
  let summarizeCalls = 0;
  const bigText = 'a'.repeat(50_000);
  const result = await compactOpenCodeSession({
    client: {
      session: {
        summarize: async () => { summarizeCalls += 1; return { data: true }; },
        messages: async () => ({ data: [assistantMessage('summary', 1_000)] })
      }
    },
    session: { id: 'session-silent' },
    directory: 'C:\workspace',
    // 16k window with a user-set 12k threshold; 50k ascii chars estimate ~14k.
    request: requestWithContext(16_384, 12_000),
    messages: [{ info: { id: 'u1', role: 'user' }, parts: [{ type: 'text', text: bigText }] }],
    onEvent: () => {}
  });
  assert.equal(summarizeCalls, 1);
  assert.equal(result.compacted, true);
  assert.ok(result.beforeTokens >= 12_000);
});

test('still skips compaction when a silent-provider session is small', async () => {
  let summarizeCalls = 0;
  const result = await compactOpenCodeSession({
    client: {
      session: { summarize: async () => { summarizeCalls += 1; return { data: true }; } }
    },
    session: { id: 'session-small' },
    directory: 'C:\workspace',
    request: requestWithContext(16_384, 12_000),
    messages: [{ info: { id: 'u1', role: 'user' }, parts: [{ type: 'text', text: 'hello' }] }],
    onEvent: () => {}
  });
  assert.equal(summarizeCalls, 0);
  assert.equal(result.compacted, false);
});

test('force bypasses the soft threshold for overflow recovery', async () => {
  let summarizeCalls = 0;
  const result = await compactOpenCodeSession({
    client: {
      session: {
        summarize: async () => { summarizeCalls += 1; return { data: true }; },
        messages: async () => ({ data: [assistantMessage('summary', 900)] })
      }
    },
    session: { id: 'session-forced' },
    directory: 'C:\workspace',
    request: requestWithContext(),
    messages: [assistantMessage('assistant-low', 1_000)],
    onEvent: () => {},
    force: true
  });
  assert.equal(summarizeCalls, 1);
  assert.equal(result.compacted, true);
});

test('recognizes context-overflow errors from major providers', () => {
  assert.equal(isContextOverflowError(
    new Error("This model's maximum context length is 131072 tokens. However, you requested 140000 tokens.")
  ), true);
  assert.equal(isContextOverflowError(new Error('prompt is too long: 250000 tokens > 200000 maximum')), true);
  assert.equal(isContextOverflowError(
    new Error('input length and `max_tokens` exceed context limit: 250000 + 32000 > 200000')
  ), true);
  assert.equal(isContextOverflowError(new Error('The input token count (1234567) exceeds the maximum number of tokens allowed (1048576).')), true);
  assert.equal(isContextOverflowError(new Error('请求的 tokens 数超过模型上限')), true);
  assert.equal(isContextOverflowError(new Error('Invalid API key')), false);
  assert.equal(isContextOverflowError(new Error('socket hang up')), false);
  assert.equal(isContextOverflowError(null), false);
});

test('anchors the original objective once a compaction boundary exists', () => {
  assert.equal(buildCompactionAnchor([
    { info: { id: 'u1', role: 'user' }, parts: [{ type: 'text', text: '帮我写一个记账库' }] },
    { info: { id: 'a1', role: 'assistant' }, parts: [{ type: 'text', text: '好的' }] }
  ]), null);

  const anchor = buildCompactionAnchor([
    {
      info: { id: 'u1', role: 'user' },
      parts: [{
        type: 'text',
        text: [
          'The following is bounded prior history from this Yan session.',
          '<yan-session-history>\nuser: old stuff\nassistant: older answer\n</yan-session-history>',
          '帮我写一个记账库，后端零错误、100 分安全。',
          '<yan-turn-context task_id="t1">\nworkspace stuff\n</yan-turn-context>'
        ].join('\n')
      }]
    },
    { info: { id: 'a1', role: 'assistant' }, parts: [{ type: 'text', text: '好的' }] },
    { info: { id: 'u2', role: 'user' }, parts: [{ type: 'compaction', auto: true }] }
  ]);
  assert.ok(anchor);
  assert.match(anchor.objective, /记账库/);
  assert.doesNotMatch(anchor.objective, /yan-session-history/);
  assert.doesNotMatch(anchor.objective, /old stuff/);
  assert.doesNotMatch(anchor.objective, /yan-turn-context/);
});

test('truncates oversized objectives and renders the anchor system block', () => {
  const longObjective = '目标'.repeat(2_000);
  const request = { compactionAnchor: { objective: longObjective } };
  assert.ok(longObjective.length > 1_600);
  assert.equal(buildCompactionAnchor([]), null);
  const system = contextAnchorSystem(request);
  assert.match(system, /<yan-compaction-anchor>/);
  assert.match(system, /目标/);
  assert.ok(system.length < longObjective.length);
  assert.equal(contextAnchorSystem({}), '');
});

test('estimates active-context tokens from parts, not the full JSON envelope', () => {
  const message = {
    info: { id: 'm1', role: 'user', time: { created: 1 } },
    parts: [{ type: 'text', text: 'x'.repeat(10_000) }]
  };
  const partsBased = estimateContextMessagesTokens([message]);
  const jsonBased = 10_000 * 0.28;
  assert.ok(partsBased >= jsonBased);
  // Metadata must not dominate: overhead stays under 1k tokens for this shape.
  assert.ok(partsBased < jsonBased + 1_000);
  // Non-message shapes fall back to per-item JSON estimation.
  assert.ok(estimateContextMessagesTokens([{ type: 'compaction', summary: '保留目标' }]) > 0);
});

test('manual compression requires a fresh nonempty successful summary', async () => {
  const original = [{ info: { id: 'old-summary', role: 'assistant', summary: true }, parts: [{type:'text',text:'old'}] }];
  for (const history of [original, [...original, {info:{id:'failed',role:'assistant',summary:true,error:{data:{message:'model rejected'}}},parts:[]} ]]) {
    const result = await compactOpenCodeSession({
      client: {session:{summarize:async()=>({data:true}),messages:async()=>({data:history})}},
      session:{id:'manual'},directory:'C:/fixture',request:requestWithContext(),messages:original,force:true,manual:true
    });
    assert.equal(result.compacted,false);
    assert.equal(result.failed,true);
    assert.match(result.error,/摘要|model rejected/);
  }
});

test('manual compression disables continuation and estimates the new summary when context endpoint is absent', async () => {
  let payload;
  const summary={info:{id:'new-summary',role:'assistant',summary:true},parts:[{type:'text',text:'Retain the task and constraints.'}]};
  const original=[assistantMessage('old',45000)];
  const result=await compactOpenCodeSession({
    client:{session:{summarize:async input=>{payload=input;return {data:true};},messages:async()=>({data:[...original,summary]})}},
    session:{id:'manual'},directory:'C:/fixture',request:requestWithContext(),messages:original,force:true,manual:true
  });
  assert.equal(payload.auto,false);
  assert.equal(result.compacted,true);
  assert.equal(result.afterTokens,estimateContextMessagesTokens([summary]));
  assert.ok(result.afterTokens>0 && result.afterTokens<result.beforeTokens);
});
