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

test('checkpoint exposes tracked child tasks and requires same-task correction', () => {
  const prompt = interjectionCheckpointPrompt([{ version: 3, guidance: 'A 子代理应改用已有接口并补充测试' }], 'work', [
    { taskId: 'call-a', childSessionID: 'child-a', role: 'builder', title: '实现接口', status: 'running' }
  ]);
  assert.match(prompt, /call-a/);
  assert.match(prompt, /child-a/);
  assert.match(prompt, /resuming its existing task_id/);
  assert.match(prompt, /do not create a duplicate task/);
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
