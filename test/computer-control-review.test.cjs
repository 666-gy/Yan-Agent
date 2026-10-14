'use strict';

// The computer-control experience review is real Harness work now: a run whose
// LAST control action is an explicit exit queues exactly one evidence-backed
// refinement, and the post-turn reviewer distills it. A run that never exited,
// or never controlled anything, queues nothing.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  analyzeComputerControlRun,
  buildReviewInstructions,
  computerControlReviewRequest
} = require('../lib/computer-control-review');
const { createHarnessBridge } = require('../lib/main/harness-bridge');

const music = 'D:\\bodian\\bodian_pc.exe';
const shell = 'C:\\Windows\\System32\\cmd.exe';
const recordedApp = (name, file, id) => JSON.stringify({ computer_control_app: { id, path: file, name, lastUsedAt: 1 } });
const call = (name, args = {}) => ({ name, args, status: 'completed', ok: true, output: '{}' });

function controlRun({ end = true } = {}) {
  const calls = [
    call('yanp_demo_computer_launch_app', { path: music }),
    { ...call('yanp_demo_computer_click', { pid: 10, x: 455, y: 866 }), output: recordedApp('波点音乐', music, 'app-music') },
    call('yanp_demo_computer_click', { pid: 20 }), // console host: never a controlled app
    { ...call('yanp_demo_computer_click', { pid: 20 }), output: recordedApp('cmd', shell, 'app-cmd') },
    call('bash', { command: 'echo inside-episode' })
  ];
  if (end) calls.push(call('yanp_demo_computer_end_session'), call('yanp_demo_computer_end_session'));
  return calls;
}

test('an exit-ended control run queues one real Harness review with evidence', () => {
  const calls = controlRun();
  const analysis = analyzeComputerControlRun(calls);
  assert.equal(analysis.hasControl, true);
  assert.equal(analysis.endsWithExit, true);
  assert.deepEqual(analysis.apps.map(app => app.name), ['波点音乐'], 'console hosts are excluded');

  const request = computerControlReviewRequest({
    runId: 'run-1', sessionId: 'sess-1', workspace: 'C:\\ws',
    toolCalls: calls, result: { status: 'done' }, now: 1
  });
  assert.ok(request, 'a request is produced');
  assert.equal(request.action, 'refine');
  assert.equal(request.source, 'computer_control');
  assert.equal(request.runId, 'run-1');
  assert.equal(request.scope, 'global');
  assert.deepEqual(request.apps.map(app => app.path), [music]);
  assert.match(request.instructions, /波点音乐/);
  assert.match(request.instructions, /x=455/);
  assert.match(request.instructions, /成功完成/);
  assert.doesNotMatch(request.instructions, /cmd/);
});

test('control that never exits, or a run with no control, queues nothing', () => {
  assert.equal(computerControlReviewRequest({ runId: 'r', toolCalls: controlRun({ end: false }), result: { status: 'done' } }), null);
  assert.equal(computerControlReviewRequest({ runId: 'r', toolCalls: [call('bash'), call('read')], result: { status: 'done' } }), null);
  // A control action after the last exit means the episode reopened: not the last exit.
  const reopened = [...controlRun(), call('yanp_demo_computer_click', { pid: 10 })];
  assert.equal(computerControlReviewRequest({ runId: 'r', toolCalls: reopened, result: { status: 'done' } }), null);
});

test('buildReviewInstructions never invents a result for a non-control run', () => {
  assert.equal(buildReviewInstructions(analyzeComputerControlRun([call('bash')]), { status: 'done' }), '');
});

test('host release reviews completed control even without model end_session', () => {
  const request = computerControlReviewRequest({ runId: 'host-ended',
    controlReleased: true, toolCalls: controlRun({ end: false }), result: { status: 'done' } });
  assert.equal(request.apps[0].name, '波点音乐');
  assert.match(request.instructions, /任务结束时的宿主清理/);
});

test('the app-queued request is written once and never replaces a model-scheduled refinement', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-cc-review-'));
  try {
    const bridge = createHarnessBridge({ dataDir });
    const request = computerControlReviewRequest({
      runId: 'run-2', toolCalls: controlRun(), result: { status: 'done' }
    });
    const first = bridge.writeHarnessRefinementRequest('run-2', request);
    assert.ok(first && fs.existsSync(first));
    const consumed = bridge.consumeHarnessRefinementRequest('run-2');
    assert.equal(consumed.source, 'computer_control');
    assert.equal(consumed.action, 'refine');

    // A refinement the model already scheduled during the run wins untouched.
    const pendingFile = bridge.pendingHarnessRequestPath('run-3');
    fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
    fs.writeFileSync(pendingFile, JSON.stringify({ schema: 1, action: 'refine', runId: 'run-3', instructions: '用户规则优先' }));
    assert.equal(bridge.writeHarnessRefinementRequest('run-3', request), '');
    assert.equal(JSON.parse(fs.readFileSync(pendingFile, 'utf8')).instructions, '用户规则优先');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a failed end_session does not authorize review until the host releases control', () => {
  const calls = [...controlRun({ end: false }), { ...call('yan_computer_end_session'), ok: false, output: 'native driver disconnected' }];
  assert.equal(computerControlReviewRequest({ runId: 'failed-exit', toolCalls: calls, result: { status: 'error' } }), null);
  const request = computerControlReviewRequest({ runId: 'failed-exit', toolCalls: calls, result: { status: 'error' }, controlReleased: true });
  assert.match(request.instructions, /end_session\[失败\]: native driver disconnected/);
  assert.match(request.instructions, /结束状态 error/);
});
