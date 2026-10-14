'use strict';

// End-to-end wiring for the computer-control experience review.
//
// A run whose last control action is an explicit exit queues one Harness review
// through the application. The post-turn reviewer must consume that queued
// request and project the genuine review back into the controlled
// application's experience document. This drives the real memory runtime (the
// same module main.js wires) with a real harness bridge, so it guards the
// caller wiring — in particular that the runtime actually receives and uses the
// data directory the application passes in.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { registerMemoryRuntime } = require('../lib/main/memory-runtime');
const { createHarnessBridge } = require('../lib/main/harness-bridge');
const { createComputerControlStore } = require('../lib/computer-control-store');

const music = 'D:\\bodian\\bodian_pc.exe';

function makeRuntime(dataDir, overrides = {}) {
  const bridge = createHarnessBridge({ dataDir });
  const runtime = registerMemoryRuntime({
    longTermMemory: { upsert: () => ({ ok: true }) },
    consumeHarnessRefinementRequest: bridge.consumeHarnessRefinementRequest,
    continualHarness: { load: () => ({ refinements: [] }), rollback: async () => ({ ok: true }), overview: () => '' },
    rollbackHarnessProjection: () => {},
    extractExplicitPolicyInstruction: () => '',
    persistExplicitUserPolicy: async () => ({ ok: true }),
    applyReviewedHarnessState: async () => [],
    recordReviewedRefinementOutcomes: async () => {},
    recordLearningReview: async () => {},
    attributeHarnessUsage: async () => {},
    loadConfig: () => ({ memory: { enabled: true } }),
    dataDir,
    ...overrides
  });
  return { bridge, runtime };
}

function runArgs(runId, overrides = {}) {
  return {
    selection: { providerId: 'yan-provider', modelId: 'yan-model' },
    request: { history: [] },
    result: { status: 'done', todos: [{ done: true }], toolCalls: [], changes: [] },
    prompt: '播放歌曲',
    workspace: '',
    yanSessionId: 'sess-cc',
    runId,
    harnessBaselines: {},
    evolutionMode: false,
    ...overrides
  };
}

test('a queued computer-control review drives the reviewer and is projected into the app experience', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-cc-projection-'));
  try {
    const { bridge, runtime } = makeRuntime(dataDir);
    const runId = 'run-cc-projection';
    const file = bridge.writeHarnessRefinementRequest(runId, {
      schema: 1,
      action: 'refine',
      runId,
      sessionId: 'sess-cc',
      scope: 'global',
      source: 'computer_control',
      apps: [{ id: 'app-music', path: music, name: '波点音乐' }],
      instructions: '操控应用：波点音乐（D:\\bodian\\bodian_pc.exe）\n本轮结果：成功完成'
    });
    assert.ok(file && fs.existsSync(file));

    let reviewerRan = false;
    await runtime.reviewCompletedRunMemory(runArgs(runId, {
      sidecar: {
        reviewMemory: async () => {
          reviewerRan = true;
          return {
            memories: [{ type: 'observation', content: '播放需点行内封面缩略图上的绿色播放按钮，并以底部三信号验收。', confidence: 0.9 }],
            skillCandidate: null,
            refinementOutcomes: [],
            harnessCandidates: []
          };
        }
      }
    }));

    assert.equal(reviewerRan, true, 'the app-queued review actually drives the reviewer');
    assert.equal(fs.existsSync(file), false, 'the pending request is consumed exactly once');

    const store = createComputerControlStore(dataDir);
    const [app] = store.list();
    assert.ok(app, 'the controlled application is recorded');
    assert.equal(app.name, '波点音乐');
    const markdown = store.experience(app.id).markdown;
    assert.match(markdown, /本次电脑操控复盘/, 'the real review is projected, not a fixed shell');
    assert.match(markdown, /绿色播放按钮/, 'the reviewer memory content is preserved');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a run that never queued a review leaves the reviewer untouched', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-cc-plain-'));
  try {
    const { runtime } = makeRuntime(dataDir);
    let reviewerRan = false;
    await runtime.reviewCompletedRunMemory(runArgs('run-plain', {
      sidecar: { reviewMemory: async () => { reviewerRan = true; return { memories: [], harnessCandidates: [] }; } }
    }));
    assert.equal(reviewerRan, false, 'no evolution and no control review means no reviewer call');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('automatic control review preserves factual evidence when the reviewer fails', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-cc-fallback-'));
  try {
    const { runtime } = makeRuntime(dataDir);
    await runtime.reviewCompletedRunMemory(runArgs('no-end', {
      result: { status: 'done', toolCalls: [{ name: 'computer_click', args: { x: 455, y: 620 }, ok: true,
        output: JSON.stringify({ computer_control_app: { path: music, name: '波点音乐' } }) }] },
      sidecar: { reviewMemory: async () => { throw new Error('provider offline'); } }
    }));
    const store = createComputerControlStore(dataDir), [app] = store.list();
    assert.equal(store.experience(app.id).markdown, '', 'failed review must not pollute experience');
    const pending = JSON.parse(fs.readFileSync(path.join(dataDir, 'computer-control', 'apps', app.id, 'pending-review.json'), 'utf8'));
    assert.equal(pending.status, 'pending');
    assert.match(pending.request.instructions, /x=455/);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('follow-up refinement uses the latest operated app in the same session, matching its name', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-cc-followup-'));
  try {
    fs.mkdirSync(path.join(dataDir, 'sessions'));
    fs.writeFileSync(path.join(dataDir, 'sessions', 'sess-cc.json'), '{}');
    const sessionId = 'sess_123-abc';
    fs.writeFileSync(path.join(dataDir, 'sessions', `${sessionId}.json`), JSON.stringify({ messages: [{
      agentRun: { runId: 'previous', timeline: [
        { type: 'tool_call', callId: 'c', name: 'computer_click', args: { x: 455, y: 620 } },
        { type: 'tool_result', callId: 'c', name: 'computer_click', ok: true,
          output: JSON.stringify({ computer_control_app: { path: music, name: '波点音乐' } }) }
      ] }
    }] }));
    const { bridge, runtime } = makeRuntime(dataDir);
    bridge.writeHarnessRefinementRequest('followup', { action: 'refine', instructions: '波点音乐：以底部歌曲名、暂停按钮和递增进度验收。' });
    await runtime.reviewCompletedRunMemory(runArgs('followup', { yanSessionId: sessionId,
      sidecar: { reviewMemory: async () => { throw new Error('reviewer unavailable'); } } }));
    const store = createComputerControlStore(dataDir), [app] = store.list();
    assert.equal(app.name, '波点音乐');
    assert.match(store.experience(app.id).markdown, /递增进度验收/);
    const { recentControlContext } = require('../lib/computer-control-context');
    assert.deepEqual(recentControlContext(dataDir, 'sess_other', 'next').apps, []);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('a persisted model-scheduled QQ refinement reaches app experience even if the reviewer fails', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-cc-explicit-'));
  try {
    const { bridge, runtime } = makeRuntime(dataDir);
    const runId = 'run-qq-explicit';
    const qq = 'D:\\qq\\QQ.exe';
    bridge.writeHarnessRefinementRequest(runId, {
      action: 'refine', scope: 'global', instructions: `QQ（${qq}）：后台输入失败后先带到前台，发送后核验气泡与输入框清空。`
    });
    let reviewerRan = false;
    await runtime.reviewCompletedRunMemory(runArgs(runId, {
      evolutionMode: true,
      result: { status: 'done', toolCalls: [{
        name: 'yanp_demo_computer_click', ok: true,
        output: JSON.stringify({ computer_control_app: { path: qq, name: 'QQ' } })
      }] },
      sidecar: { reviewMemory: async () => { reviewerRan = true; throw new Error('reviewer unavailable'); } }
    }));
    assert.equal(reviewerRan, true);
    const store = createComputerControlStore(dataDir);
    const [app] = store.list();
    assert.equal(app.name, 'QQ');
    assert.match(store.experience(app.id).markdown, /发送后核验气泡/);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('failed persistence and unrelated refinements never contaminate the automatic app review', async () => {
  for (const failed of [true, false]) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-cc-explicit-skip-'));
    try {
      const { bridge, runtime } = makeRuntime(dataDir, {
        persistExplicitUserPolicy: async () => ({ ok: !failed })
      });
      const qq = 'D:\\qq\\QQ.exe';
      bridge.writeHarnessRefinementRequest('skip', {
        action: 'refine', instructions: failed ? `${qq}：发送后核验。` : '修改代码排版。'
      });
      await runtime.reviewCompletedRunMemory(runArgs('skip', {
        evolutionMode: true,
        result: { status: 'done', toolCalls: [{ name: 'computer_click', ok: true,
          output: JSON.stringify({ computer_control_app: { path: qq, name: 'QQ' } }) }] },
        sidecar: { reviewMemory: async () => ({ memories: [], harnessCandidates: [] }) }
      }));
      const store = createComputerControlStore(dataDir);
      const [app] = store.list();
      assert.ok(app, 'the actual computer episode still receives its automatic review');
      assert.doesNotMatch(store.experience(app.id).markdown, /修改代码排版|发送后核验/);
    } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
  }
});

test('QQ reviewer knowledge cannot be projected into the music experience', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-cc-app-boundary-'));
  try {
    const store = createComputerControlStore(dataDir);
    store.record('D:\\qq\\QQ.exe', 'QQ');
    const { runtime } = makeRuntime(dataDir);
    await runtime.reviewCompletedRunMemory(runArgs('app-boundary', {
      result: { status: 'done', toolCalls: [{ name: 'computer_click', ok: true,
        output: JSON.stringify({ computer_control_app: { path: music, name: '波点音乐' } }) }] },
      sidecar: { reviewMemory: async () => ({ memories: [{ content: 'QQ：发送后验证气泡与输入框清空。' }] }) }
    }));
    const app = store.list().find(app => app.path === music);
    assert.ok(app);
    assert.equal(store.experience(app.id).markdown, '');
    assert.ok(fs.existsSync(path.join(dataDir, 'computer-control', 'apps', app.id, 'pending-review.json')));
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
