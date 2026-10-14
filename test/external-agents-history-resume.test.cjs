'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ExternalAgentService } = require('../lib/external-agents/service');
const { run } = require('../lib/external-agents/worker');
const { atomic, read } = require('../lib/external-agents/storage');

async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-history-resume-'));
  const workspace = path.join(root, 'work'); fs.mkdirSync(workspace);
  const journals = path.join(root, 'sessions'); fs.mkdirSync(journals);
  const sessionId = crypto.randomUUID(), log = path.join(journals, 'history.jsonl');
  const marker = 'This existing conversation contains the previous implementation and its verified tests.';
  const append = events => fs.appendFileSync(log, events.map(e => JSON.stringify(e)).join('\n') + '\n');
  const message = (role, text) => ({ type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
  append([{ type: 'session_meta', payload: { id: sessionId, cwd: workspace, originator: options.originator || 'Codex Desktop' } }, message('user', marker)]);
  let launches = 0;
  const create = () => new ExternalAgentService({ dataDir: root, loadConfig: () => ({ externalAgents: { enabled: true, providers: { codex: { enabled: true } } } }),
    launch: () => { launches++; return process.pid; }, historyOptions: { roots: [{ provider: 'codex', root: journals, depth: 0, archived: options.archived || false }] } });
  const service = create(); service.close();
  t.after(() => { service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const context = { workspace, sessionId: 'yan-a' };
  const historyId = (await service.listHistory(context)).sessions[0].history_id;
  const params = { provider: 'codex', request_key: 'historical-followup', prompt: 'Continue the chosen historical task and add tests', session_mode: 'history', history_id: historyId };
  const calls = [];
  const driver = async command => {
    calls.push(command); fs.writeFileSync(command.intent, 'intent');
    const turn = String(calls.length);
    append([{ type: 'event_msg', payload: { type: 'task_started', turn_id: turn } }, message('user', command.text),
      message('assistant', command.action === 'send' ? 'Done' : command.text),
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: turn, last_agent_message: command.action === 'send' ? 'Done' : command.text } }]);
  };
  const workerOptions = { driver, journalRoot: journals, detect: async () => ({ installed: true, executable: 'desktop.exe' }), interval: 1 };
  const dir = job => path.join(service.root, job.job_id);
  return { root, workspace, log, sessionId, service, create, context, historyId, params, append, message, calls, workerOptions, dir, marker, launches: () => launches };
}

test('unmanaged Codex history resumes exact desktop id, survives restart and sends only once', async t => {
  const f = await fixture(t);
  const job = await f.service.delegate(f.context, f.params);
  assert.equal(job.reused_session, true); assert.equal(job.history_id, f.historyId);
  const restored = f.create(); restored.close();
  assert.equal((await restored.delegate(f.context, f.params)).job_id, job.job_id);
  await run(f.dir(job), f.workerOptions);
  assert.deepEqual(f.calls.map(c => c.action), ['resume', 'send']);
  assert.equal(f.calls[0].url, `codex://threads/${f.sessionId}`);
  assert.equal(f.calls[0].marker, f.marker); assert.equal(f.calls[0].historyTarget, true);
  assert.equal(restored.result(f.context, job.job_id).output, 'Done');
  await run(f.dir(job), f.workerOptions);
  assert.equal(f.calls.length, 2);
  fs.renameSync(f.log, f.log + '.moved');
  assert.equal((await restored.delegate(f.context, f.params)).job_id, job.job_id);
  await assert.rejects(restored.delegate(f.context, { ...f.params, session_mode: 'new', history_id: undefined }), /request_key/);
});

test('explicit new bypasses existing Yan binding and remains idempotent', async t => {
  const f = await fixture(t);
  const old = await f.service.delegate(f.context, f.params); await run(f.dir(old), f.workerOptions);
  const request = { provider: 'codex', request_key: 'fresh', prompt: 'A distinct new task', session_mode: 'new', previous_job_id: old.job_id, new_issue: 'A newly requested independent task' };
  const fresh = await f.service.delegate(f.context, request);
  assert.equal(f.service.record(fresh.job_id).continuation, null);
  assert.equal(fresh.reused_session, false);
  const controller = new AbortController();
  await run(f.dir(fresh), { ...f.workerOptions, signal: controller.signal, driver: async command => {
    assert.equal(command.action, 'open'); assert.match(command.url, /^codex:\/\/threads\/new\?/); controller.abort();
  } });
  assert.equal((await f.service.delegate(f.context, request)).job_id, fresh.job_id);
});

test('history target rejects archive, CLI source, wrong workspace, busy and invalid selectors', async t => {
  for (const options of [{ archived: true }, { originator: 'codex_cli_rs' }]) {
    const f = await fixture(t, options);
    await assert.rejects(f.service.delegate(f.context, f.params), /归档|来源/);
    assert.equal(f.launches(), 0);
  }
  const f = await fixture(t);
  await assert.rejects(f.service.delegate({ ...f.context, workspace: f.root }, f.params), /工作区/);
  await assert.rejects(f.service.delegate(f.context, { ...f.params, history_id: '../../other' }), /工作区/);
  await assert.rejects(f.service.delegate(f.context, { ...f.params, provider: 'claude' }), /启用|Codex/);
  f.append([{ type: 'event_msg', payload: { type: 'task_started', turn_id: 'busy' } }]);
  await assert.rejects(f.service.delegate(f.context, f.params), /仍在运行/);
  assert.equal(f.launches(), 0);
});

test('queued history binding is frozen; changed cwd blocks before GUI interaction', async t => {
  const f = await fixture(t);
  const active = f.service.dispatch({ ...f.context, sessionId: 'other' }, { provider: 'codex', request_key: 'active', prompt: 'Other job' });
  const job = await f.service.delegate(f.context, f.params);
  assert.equal(job.status, 'queued');
  f.append([{ type: 'turn_context', payload: { cwd: f.root } }]);
  atomic(path.join(f.dir(active), 'state.json'), { status: 'succeeded', endedAt: Date.now() });
  f.service.drain();
  await run(f.dir(job), f.workerOptions);
  assert.equal(f.service.record(job.job_id).status, 'blocked');
  assert.equal(f.calls.length, 0);
});

test('uncertain historical handshake recovery listens without resending or creating a task', async t => {
  const f = await fixture(t);
  const job = await f.service.delegate(f.context, f.params);
  const controller = new AbortController(); let command;
  await run(f.dir(job), { ...f.workerOptions, signal: controller.signal, driver: async c => {
    command = c; fs.writeFileSync(c.intent, 'sent'); controller.abort(); throw Error('response lost');
  } });
  assert.equal(read(path.join(f.dir(job), 'state.json')).status, 'uncertain');
  f.append([{ type: 'event_msg', payload: { type: 'task_started', turn_id: 'handshake' } }, f.message('user', command.text),
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'handshake', last_agent_message: command.text } }]);
  await run(f.dir(job), f.workerOptions);
  assert.deepEqual(f.calls.map(c => c.action), ['send']);
  assert.equal(f.service.record(job.job_id).status, 'succeeded');
});
