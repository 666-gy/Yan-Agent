'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ExternalAgentService, MAX_INPUT_BYTES } = require('../lib/external-agents/service');
const { atomic, read, hash, jobDir } = require('../lib/external-agents/storage');
const { normalize } = require('../lib/external-agents/preferences');
const { probe, GUI_UNAVAILABLE } = require('../lib/external-agents/adapters');
const { dispatch: dispatchTool, TOOLS } = require('../lib/external-agents/tools');
const { run: runWorker } = require('../lib/external-agents/worker');

function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-external-'));
  const a = path.join(dir, '工作区 A with spaces');
  const b = path.join(dir, 'workspace B');
  fs.mkdirSync(a); fs.mkdirSync(b);
  const config = { externalAgents: { enabled: true, providers: {
    codex: { enabled: true, executable: process.execPath }, claude: { enabled: true, executable: process.execPath }
  } } };
  const launches = [];
  const service = new ExternalAgentService({ dataDir: dir, loadConfig: () => config,
    launch: job => { launches.push(job); atomic(path.join(job, 'state.json'), { status: 'running', workerPid: process.pid, startedAt: 1000, heartbeatAt: 1000 }); return process.pid; }, ...options });
  service.close();
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { service, config, launches, dir, a, b, context: { runId: 'run-a', sessionId: 'session-a', workspace: a, prompt: '用户原始任务' } };
}
function request(prompt = 'Investigate bug A', extra = {}) { return { provider: 'codex', request_key: prompt, prompt, ...extra }; }
function finish(service, id, status = 'succeeded', output = 'done') {
  const dir = jobDir(service.root, id);
  fs.writeFileSync(path.join(dir, 'result.txt'), output);
  atomic(path.join(dir, 'state.json'), { status, endedAt: Date.now() });
}

test('preferences are opt-in; providers and concurrency are normalized', () => {
  assert.equal(normalize().enabled, false);
  assert.deepEqual(Object.keys(normalize().providers), ['codex', 'claude', 'reasonix']);
  assert.equal(normalize({ maxConcurrent: 100 }).maxConcurrent, 2);
});

test('collaboration preserves the kernel repetition guard without an invalid config override', () => {
  const { permissionRulesForRun, combineSystem } = require('../lib/opencode-sidecar');
  const rules = permissionRulesForRun({ hasUserWorkspace: true });
  assert.deepEqual(rules.filter(rule => rule.permission === 'doom_loop'), [
    { permission: 'doom_loop', pattern: '*', action: 'ask' }
  ]);
  assert.match(combineSystem({ externalAgentsEnabled: true }), /never resubmit|Never resubmit/);
  assert.match(combineSystem({ externalAgentsEnabled: false }), /External Agent collaboration is disabled/);
});

test('authoritative workspace, full Unicode input, original request and hash are persisted before launch', t => {
  const { service, context, a, launches } = setup(t);
  const prompt = '复杂任务😀\n带空格与引号 " $() ` 内容\n'.repeat(5000) + '\nEND-OF-COMPLETE-TASK';
  const job = service.dispatch(context, request(prompt, { request_key: 'large' }));
  const input = fs.readFileSync(path.join(launches[0], 'input.txt'), 'utf8');
  assert.ok(input.endsWith(prompt));
  assert.ok(input.includes(context.prompt));
  assert.equal(job.workspace, fs.realpathSync(a));
  assert.equal(job.input_sha256, hash(input));
  assert.equal(job.input_bytes, Buffer.byteLength(input));
  assert.equal(launches.length, 1);
});

test('oversize payload fails before dispatch instead of truncating', t => {
  const { service, context, launches } = setup(t);
  assert.throws(() => service.dispatch(context, request('a'.repeat(MAX_INPUT_BYTES + 1), { request_key: 'big' })), /4 MiB/);
  assert.equal(launches.length, 0);
  assert.equal(service.records().length, 0);
});

test('duplicate submission returns the same job even after failure or across provider choice', t => {
  const { service, context, launches } = setup(t);
  const first = service.dispatch(context, request());
  assert.equal(service.dispatch(context, request()).job_id, first.job_id);
  finish(service, first.job_id, 'failed', 'permission denied');
  assert.equal(service.dispatch(context, request()).status, 'failed');
  const duplicate = service.dispatch(context, request('Investigate bug A', { request_key: 'new-key', provider: 'claude' }));
  assert.equal(duplicate.job_id, first.job_id);
  assert.equal(launches.length, 1);
  assert.throws(() => service.dispatch(context, request('changed', { request_key: 'Investigate bug A' })), /request_key/);
  assert.throws(() => service.dispatch(context, request('Please retry bug A', { request_key: 'retry', provider: 'claude' })), /已有协同结果/);
});

test('follow-ups require a completed predecessor and a concrete new issue', t => {
  const { service, context } = setup(t);
  const first = service.dispatch(context, request());
  assert.throws(() => service.dispatch(context, request('Fix B', { previous_job_id: first.job_id, new_issue: 'B' })), /等待/);
  finish(service, first.job_id, 'failed');
  assert.throws(() => service.dispatch(context, request('Fix B', { previous_job_id: first.job_id })), /new_issue/);
  const next = service.dispatch(context, request('Fix B', { previous_job_id: first.job_id, new_issue: 'New failing assertion in B' }));
  assert.notEqual(next.job_id, first.job_id);
});

test('same workspace is serial, independent workspaces can run together, failed dependencies block', t => {
  const { service, context, b, launches } = setup(t);
  const first = service.dispatch(context, request());
  const second = service.dispatch(context, request('Review A', { provider: 'claude', depends_on: [first.job_id], read_only: true }));
  assert.equal(second.status, 'queued');
  const other = service.dispatch({ ...context, sessionId: 'session-b', workspace: b }, request('Build B', { provider: 'claude' }));
  assert.equal(other.status, 'running');
  assert.equal(launches.length, 2);
  finish(service, first.job_id, 'failed'); service.drain();
  assert.equal(service.record(second.job_id).status, 'blocked');
  assert.equal(launches.length, 2);
});

test('successful prerequisite unblocks the existing queued job exactly once', t => {
  const { service, context, launches } = setup(t);
  const first = service.dispatch(context, request());
  const second = service.dispatch(context, request('Review', { provider: 'claude', depends_on: [first.job_id] }));
  finish(service, first.job_id); service.drain(); service.drain();
  assert.equal(service.record(second.job_id).status, 'running');
  assert.equal(launches.length, 2);
});

test('an hour-long task survives wait expiration and application service restart without redispatch', async t => {
  const { service, context, dir, config, launches } = setup(t, { now: () => 3600001 });
  const job = service.dispatch(context, request());
  const waiting = await service.wait(context, [job.job_id], 1);
  assert.equal(waiting.wait_expired, true);
  assert.equal(waiting.jobs[0].status, 'running');
  const restored = new ExternalAgentService({ dataDir: dir, loadConfig: () => config, launch: () => { throw new Error('MUST NOT REDISPATCH'); } });
  restored.close();
  assert.equal(restored.dispatch(context, request()).job_id, job.job_id);
  assert.equal(restored.list(context)[0].status, 'running');
  finish(restored, job.job_id, 'failed', 'one-hour failure');
  const final = await restored.wait(context, [job.job_id], 10);
  assert.equal(final.all_terminal, true);
  assert.equal(restored.result(context, job.job_id).output, 'one-hour failure');
  assert.equal(launches.length, 1);
});

test('cross-session and cross-workspace reads fail, caller cannot override workspace', async t => {
  const { service, context, b } = setup(t);
  const job = service.dispatch(context, request());
  assert.throws(() => service.result({ ...context, workspace: b }, job.job_id), /不属于/);
  assert.throws(() => service.result({ ...context, sessionId: 'other' }, job.job_id), /不属于/);
  await assert.rejects(dispatchTool(service, new Map(), 'delegate_external_task', { task_id: 'missing', ...request() }), /有效/);
  assert.equal(TOOLS.find(tool => tool.name === 'delegate_external_task').inputSchema.additionalProperties, false);
});

test('read-only admission cannot be escalated by the model; disabling blocks only queued work', t => {
  const { service, context, config } = setup(t);
  const first = service.dispatch({ ...context, readOnly: true }, request('Read', { read_only: false }));
  assert.equal(first.read_only, true);
  const second = service.dispatch(context, request('Edit', { provider: 'claude' }));
  config.externalAgents.enabled = false; service.drain();
  assert.equal(service.record(first.job_id).status, 'running');
  assert.equal(service.record(second.job_id).status, 'blocked');
});

test('all output pages reconstruct the full Unicode result including a failure', t => {
  const { service, context } = setup(t);
  const first = service.dispatch(context, request());
  const output = '测试😀\n'.repeat(10000) + 'END';
  finish(service, first.job_id, 'failed', output);
  let offset = 0, actual = '';
  do {
    const page = service.result(context, first.job_id, offset, 113);
    assert.equal(page.status, 'failed'); actual += page.output; offset = page.next_offset;
  } while (offset !== null);
  assert.equal(actual, output);
});

test('start uncertainty reserves the workspace and never reruns the job', t => {
  const { service, context, launches } = setup(t, { now: () => 90000 });
  const first = service.dispatch(context, request());
  const dir = jobDir(service.root, first.job_id);
  atomic(path.join(dir, 'request.json'), { ...read(path.join(dir, 'request.json')), transport: 'legacy' });
  atomic(path.join(dir, 'state.json'), { status: 'starting', startedAt: 1 });
  atomic(path.join(dir, 'launch.json'), { pid: null });
  service.drain();
  assert.equal(service.record(first.job_id).status, 'uncertain');
  const second = service.dispatch(context, request('Review A', { provider: 'claude' }));
  assert.equal(second.status, 'queued');
  assert.equal(launches.length, 1);
});

test('production dispatch is blocked without launching a CLI and remains deduplicated', async t => {
  const { service, context } = setup(t, { launch: null });
  const job = service.dispatch(context, request('Desktop-only task'));
  assert.equal(job.status, 'blocked');
  assert.equal(job.terminal, true);
  assert.equal(job.error, GUI_UNAVAILABLE);
  assert.equal(service.dispatch(context, request('Desktop-only task')).job_id, job.job_id);
  const waited = await service.wait(context, [job.job_id], 1);
  assert.equal(waited.all_terminal, true);
  assert.equal(waited.jobs[0].error, GUI_UNAVAILABLE);
  assert.equal(service.record(job.job_id).launchPid, undefined);
});

test('queued legacy jobs cannot restart through the old CLI launcher', t => {
  const { service, context, config, dir, launches } = setup(t);
  const first = service.dispatch(context, request());
  const queued = service.dispatch(context, request('Later review', { provider: 'claude', depends_on: [first.job_id] }));
  assert.equal(queued.status, 'queued');
  const restored = new ExternalAgentService({ dataDir: dir, loadConfig: () => config, launch: null });
  restored.close();
  restored.drain();
  assert.equal(restored.record(queued.job_id).status, 'blocked');
  assert.equal(restored.record(first.job_id).status, 'running');
  assert.equal(launches.length, 1);
  finish(restored, first.job_id, 'failed', 'Legacy result preserved');
  restored.drain();
  assert.equal(restored.result(context, first.job_id).output, 'Legacy result preserved');
});

test('legacy worker entrypoint blocks unsent jobs without overwriting running or terminal jobs', async t => {
  const { service, context } = setup(t, { launch: () => undefined });
  const job = service.dispatch(context, request('Old queued request'));
  const dir = jobDir(service.root, job.job_id);
  atomic(path.join(dir, 'request.json'), { ...read(path.join(dir, 'request.json')), transport: 'legacy' });
  await runWorker(dir);
  assert.equal(service.record(job.job_id).status, 'blocked');
  assert.match(service.record(job.job_id).error, /旧版任务/);
  await runWorker(dir);
  finish(service, job.job_id, 'succeeded', 'Saved old result');
  await runWorker(dir);
  assert.equal(service.result(context, job.job_id).output, 'Saved old result');
  assert.equal(service.record(job.job_id).status, 'succeeded');
  atomic(path.join(dir, 'state.json'), { status: 'running', workerPid: process.pid });
  await runWorker(dir);
  assert.equal(service.record(job.job_id).status, 'running');
});

test('installation never implies GUI connection or CLI authentication', async () => {
  let captured;
  const configured = path.resolve('desktop & literal $.exe');
  const status = await probe('codex', configured, {
    platform: 'win32', bridgeReady: () => false,
    execute: (exe, args, options, done) => {
      captured = { exe, args, options };
      done(null, JSON.stringify({ installed: true, executable: configured, version: 'desktop-version', available: true, connected: true, authentication: 'authenticated' }));
    }
  });
  assert.equal(status.installed, true);
  assert.equal(status.available, false);
  assert.equal(status.connected, false);
  assert.equal(status.authentication, 'unchecked');
  assert.equal(status.transport, 'desktop-gui');
  assert.equal(status.error, GUI_UNAVAILABLE);
  assert.equal(path.basename(captured.exe).toLowerCase(), 'powershell.exe');
  assert.ok(captured.args.includes('-File'));
  assert.ok(captured.args.at(-1).endsWith('detect-desktop.ps1'));
  assert.equal(captured.options.env.YAN_DESKTOP_EXECUTABLE, configured);
  assert.equal(captured.options.env.YAN_DESKTOP_PROVIDER, 'codex');
  assert.equal(captured.options.env.YAN_SESSION_BRIDGE_TOKEN, undefined);
  assert.ok(!captured.args.includes(configured));
  assert.ok(!captured.args.some(arg => ['exec', '--print', '--version', 'login', 'auth'].includes(arg)));
});

test('desktop probe rejects bad paths and reports failed/invalid metadata safely', async () => {
  const noExecute = () => assert.fail('must not execute');
  assert.equal((await probe('claude', 'relative.exe', { platform: 'win32', execute: noExecute })).installed, false);
  assert.equal((await probe('claude', '', { platform: 'linux', execute: noExecute })).available, false);
  await assert.rejects(probe('other'), /不支持/);
  for (const [error, output] of [[new Error('failure'), ''], [null, 'not json'], [null, '{"installed":false,"reason":"not-desktop"}']]) {
    const status = await probe('claude', '', { platform: 'win32', execute: (_exe, _args, _options, done) => done(error, output) });
    assert.equal(status.available, false);
    assert.equal(status.installed, false);
    assert.ok(status.error);
  }
});

test('selected non-desktop executable is inspected, never run as an Agent', { skip: process.platform !== 'win32' }, async () => {
  const status = await probe('codex', process.execPath);
  assert.equal(status.installed, false);
  assert.equal(status.available, false);
  assert.match(status.error, /不是可识别的桌面应用/);
});

test('desktop-only instructions prohibit CLI fallback and no adapter exports CLI commands', () => {
  const { system } = require('../lib/external-agents/preferences');
  assert.match(system(true), /never fall back to codex exec, claude --print/i);
  assert.match(TOOLS.find(tool => tool.name === 'external_agents_status').description, /DESKTOP GUI/);
  assert.equal(require('../lib/external-agents/adapters').command, undefined);
  assert.equal(require('../lib/external-agents/adapters').resolveExecutable, undefined);
});
