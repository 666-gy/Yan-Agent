'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OpenCodeSidecar,
  normalizeInterjectionAnalysis,
  interjectionStructuredValue,
  interjectionCheckpointPrompt
} = require('../lib/opencode-sidecar');

test('normalizes graceful finish separately from an explicit hard cancel', () => {
  const finish = normalizeInterjectionAnalysis({
    kind: 'guidance',
    reply: '明白',
    guidance: '停止追加测试并交付',
    requestFinish: true,
    hardCancel: false
  });
  assert.equal(finish.requestFinish, true);
  assert.equal(finish.hardCancel, false);

  const hardCancel = normalizeInterjectionAnalysis({
    kind: 'guidance',
    reply: '明白',
    guidance: '强制取消整个运行',
    requestFinish: true,
    hardCancel: true
  });
  assert.equal(hardCancel.requestFinish, false);
  assert.equal(hardCancel.hardCancel, true);

  const check = normalizeInterjectionAnalysis({
    kind: 'check',
    reply: '仍有工具在运行',
    guidance: '不应送达',
    requestFinish: true,
    hardCancel: true
  });
  assert.deepEqual(check, {
    kind: 'check',
    reply: '仍有工具在运行',
    guidance: '',
    requestFinish: false,
    hardCancel: false
  });
});

test('checkpoint asks for a graceful finish without aborting the run', () => {
  const prompt = interjectionCheckpointPrompt([{
    version: 2,
    guidance: '现在交付',
    requestFinish: true
  }], 'after-work');
  assert.equal(prompt.includes('graceful finish'), true);
  assert.equal(prompt.includes('Do not abort the run'), true);
  assert.equal(prompt.includes('现在交付'), true);
});

test('reads schema output from a text part when the provider omits info.structured', () => {
  const value = interjectionStructuredValue({
    info: {},
    parts: [{
      type: 'text',
      text: '```json\n{"kind":"check","reply":"仍在运行","guidance":"","requestFinish":false,"hardCancel":false}\n```'
    }]
  });
  assert.deepEqual(value, {
    kind: 'check',
    reply: '仍在运行',
    guidance: '',
    requestFinish: false,
    hardCancel: false
  });
});

test('isolated auxiliary observer uses plain output with tools denied and a stable reply stream', async () => {
  const calls = { create: [], prompt: [], deleted: [] };
  const events = [];
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd(),
    interjectionStreamDelayMs: 0
  });
  sidecar.client = {
    session: {
      create: async payload => {
        calls.create.push(payload);
        return { data: { id: 'observer-session' } };
      },
      prompt: async payload => {
        calls.prompt.push(payload);
        return { data: { info: { structured: {
          kind: 'check',
          reply: '进程仍存活，但没有足够证据判断是否卡住。',
          guidance: '',
          requestFinish: false,
          hardCancel: false
        } } } };
      },
      delete: async payload => {
        calls.deleted.push(payload);
        return { data: true };
      }
    }
  };
  sidecar.activeRuns.set('run-1', {
    runId: 'run-1',
    directory: process.cwd(),
    openCodeSessionID: 'main-session',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    acceptingInterjections: true
  });

  const first = await sidecar.analyzeInterjection({
    runId: 'run-1',
    requestId: 'aux-1',
    text: '现在还在下载吗？',
    snapshot: { active: true, tools: [] }
  }, event => events.push(event));
  const second = await sidecar.analyzeInterjection({
    runId: 'run-1',
    requestId: 'aux-2',
    text: '是否已经卡住？',
    snapshot: { active: true, tools: [] }
  }, event => events.push(event));

  assert.equal(first.kind, 'check');
  assert.equal(second.kind, 'check');
  assert.equal(calls.create.length, 2);
  assert.deepEqual(calls.create[0].permission, [{ permission: '*', pattern: '*', action: 'deny' }]);
  assert.equal(calls.create[0].metadata.yanInterjectionObserver, true);
  assert.equal(calls.prompt.length, 2);
  assert.deepEqual(calls.prompt[0].tools, { '*': false });
  assert.equal(calls.prompt[0].format, undefined);
  assert.equal(Array.isArray(JSON.parse(calls.prompt[0].parts[0].text).auxiliaryConversation), true);
  assert.equal(events.some(event => event.type === 'status'), true);
  assert.equal(events.filter(event => event.type === 'text.delta').map(event => event.data.delta).join(''), first.reply + second.reply);
  assert.equal(calls.deleted.length, 2);
  assert.equal(calls.deleted[0].sessionID, 'observer-session');
});

test('cancelling auxiliary dialogue aborts only the auxiliary session', async () => {
  let rejectPrompt;
  const calls = { abort: [], deleted: [] };
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
  sidecar.client = {
    session: {
      create: async () => ({ data: { id: 'auxiliary-session' } }),
      prompt: async () => new Promise((resolve, reject) => { rejectPrompt = reject; }),
      abort: async payload => {
        calls.abort.push(payload);
        const error = new Error('cancelled');
        error.name = 'AbortError';
        rejectPrompt?.(error);
        return { data: true };
      },
      delete: async payload => {
        calls.deleted.push(payload);
        return { data: true };
      }
    }
  };
  sidecar.activeRuns.set('run-3', {
    runId: 'run-3',
    directory: process.cwd(),
    openCodeSessionID: 'main-session',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    acceptingInterjections: true
  });

  const pending = sidecar.analyzeInterjection({
    runId: 'run-3',
    requestId: 'aux-cancel',
    text: '停止这条辅助对话。',
    snapshot: { active: true }
  }).catch(error => error);
  await new Promise(resolve => setImmediate(resolve));
  const result = await sidecar.cancelInterjection('run-3', 'aux-cancel');
  const error = await pending;

  assert.equal(result.cancelled, true);
  assert.equal(calls.abort.length, 1);
  assert.equal(error.name, 'AbortError');
  assert.equal(sidecar.activeRuns.has('run-3'), true);
  assert.equal(calls.deleted.length, 1);
});

test('plain observer output is shown instead of being reclassified as guidance', async () => {
  const events = [];
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd(), interjectionStreamDelayMs: 0 });
  sidecar.log = { warn() {} };
  sidecar.client = {
    session: {
      create: async () => ({ data: { id: 'fallback-session' } }),
      prompt: async () => ({ data: { parts: [{ type: 'text', text: '普通文本，不是 JSON' }] } }),
      delete: async () => ({ data: true })
    }
  };
  sidecar.activeRuns.set('run-fallback', {
    runId: 'run-fallback',
    directory: process.cwd(),
    openCodeSessionID: 'main-session',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    acceptingInterjections: true
  });
  const result = await sidecar.analyzeInterjection({
    runId: 'run-fallback',
    requestId: 'fallback-1',
    text: '现在进度怎么样？',
    snapshot: { active: true, phase: 'work', tools: [{ name: 'bash', status: 'running' }] }
  }, event => events.push(event));
  assert.equal(result.kind, 'check');
  assert.equal(result.reply, '普通文本，不是 JSON');
  assert.equal(result.guidance, '');
  assert.equal(events.some(event => event.type === 'completed'), true);
});

test('an empty observer output falls back to a snapshot-safe answer', async () => {
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd(), interjectionStreamDelayMs: 0 });
  sidecar.log = { warn() {} };
  sidecar.client = {
    session: {
      create: async () => ({ data: { id: 'empty-fallback-session' } }),
      prompt: async () => ({ data: { parts: [] } }),
      delete: async () => ({ data: true })
    }
  };
  sidecar.activeRuns.set('run-empty-fallback', {
    runId: 'run-empty-fallback',
    directory: process.cwd(),
    openCodeSessionID: 'main-session',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    acceptingInterjections: true
  });
  const result = await sidecar.analyzeInterjection({
    runId: 'run-empty-fallback',
    requestId: 'empty-fallback-1',
    text: 'Agent在干嘛',
    snapshot: { active: true, phase: 'work', tools: [{ name: 'bash', status: 'running' }] }
  });
  assert.equal(result.kind, 'check');
  assert.match(result.reply, /bash/);
  assert.equal(result.guidance, '');
});

test('guidance delivery appends a no-reply message and never aborts', async () => {
  const calls = { promptAsync: [], abort: 0 };
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
  sidecar.client = {
    session: {
      promptAsync: async payload => {
        calls.promptAsync.push(payload);
        return { data: true };
      },
      abort: async () => {
        calls.abort += 1;
        throw new Error('deliverInterjection must not abort');
      }
    }
  };
  const run = {
    runId: 'run-2',
    directory: process.cwd(),
    openCodeSessionID: 'main-session',
    acceptingInterjections: true,
    guidanceVersion: 0,
    processedGuidanceVersion: 0,
    interjections: [],
    finishRequested: false,
    phase: 'work'
  };
  sidecar.activeRuns.set('run-2', run);

  const result = await sidecar.deliverInterjection('run-2', {
    kind: 'guidance',
    reply: '明白',
    guidance: '不要再重复测试，正常收尾',
    requestFinish: true,
    hardCancel: false
  });

  assert.equal(result.delivered, true);
  assert.equal(calls.promptAsync.length, 1);
  assert.equal(calls.promptAsync[0].noReply, true);
  assert.equal(calls.abort, 0);
  assert.equal(run.guidanceVersion, 1);
  assert.equal(run.finishRequested, true);
  assert.equal(run.interjections[0].guidance, '不要再重复测试，正常收尾');
});
