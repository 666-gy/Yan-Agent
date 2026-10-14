'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ExternalAgentService } = require('../lib/external-agents/service');
const { run } = require('../lib/external-agents/worker');
const { Journal } = require('../lib/external-agents/journal');
const { atomic, read, jobDir } = require('../lib/external-agents/storage');
const { probe } = require('../lib/external-agents/adapters');

function events(provider, cwd, input, output, n = 1) {
  if (provider === 'claude') {
    const base = { entrypoint: 'claude-desktop-3p', cwd, sessionId: 'desktop-session', isSidechain: false };
    return [
      { ...base, type: 'user', message: { role: 'user', content: input } },
      { ...base, type: 'assistant', message: { id: `message-${n}`, content: [{ type: 'text', text: output }], stop_reason: 'end_turn' } },
      { ...base, type: 'system', subtype: 'stop_hook_summary', preventedContinuation: false }
    ];
  }
  return [
    ...(n === 1 ? [{ type: 'session_meta', payload: { id: '11111111-2222-4333-a444-555555555555', cwd, originator: 'Codex Desktop' } }] : []),
    { type: 'event_msg', payload: { type: 'task_started', turn_id: `turn-${n}` } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: input }] } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: `turn-${n}`, last_agent_message: output } }
  ];
}
function fixture(t, provider) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-desktop-test-'));
  const workspace = path.join(root, '工作区 with spaces'); fs.mkdirSync(workspace);
  const journals = path.join(root, 'journals'); fs.mkdirSync(journals);
  const config = { externalAgents: { enabled: true, providers: { [provider]: { enabled: true } } } };
  const service = new ExternalAgentService({ dataDir: root, loadConfig: () => config, launch: () => process.pid }); service.close();
  const ctx = { sessionId: 'yan-session', workspace };
  const job = service.dispatch(ctx, { provider, request_key: 'unique', prompt: '完整正文😀\n'.repeat(15000) + 'EXACT-END', read_only: true });
  const dir = jobDir(service.root, job.job_id);
  const log = path.join(journals, 'session.jsonl');
  const append = records => fs.appendFileSync(log, records.map(e => JSON.stringify(e)).join('\n') + '\n');
  t.after(() => { service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, workspace, journals, service, ctx, job, dir, log, append };
}

for (const provider of ['claude', 'codex']) {
  test(`${provider}: service → desktop transport → exact journal receipt → complete result`, async t => {
    const f = fixture(t, provider); const calls = [];
    const output = '完整返回😀\n'.repeat(10000) + 'RESULT-END';
    await run(f.dir, {
      interval: 1, journalRoot: f.journals,
      detect: async () => ({ installed: true, executable: 'desktop.exe' }),
      driver: async command => {
        calls.push(command.action);
        fs.writeFileSync(command.intent, 'intent');
        const url = new URL(command.url || 'https://example.invalid');
        if (command.action === 'open') {
          assert.equal(url.searchParams.get(provider === 'claude' ? 'folder' : 'path'), f.workspace);
          f.append(events(provider, f.workspace, command.text, command.text, 1));
        } else {
          if (provider === 'codex') assert.equal(command.url, 'codex://threads/11111111-2222-4333-a444-555555555555', 'return to the verified task if the user switched chats after handshake');
          assert.equal(command.text, fs.readFileSync(path.join(f.dir, 'input.txt'), 'utf8'));
          assert.ok(command.text.endsWith('EXACT-END'));
          f.append(events(provider, f.workspace, command.text, output, 2));
        }
      }
    });
    assert.deepEqual(calls, ['open', 'send']);
    assert.equal(f.service.record(f.job.job_id).status, 'succeeded');
    assert.equal(f.service.record(f.job.job_id).deliveryVerified, true);
    assert.equal(f.service.record(f.job.job_id).needsAttention, false);
    assert.equal(fs.readFileSync(path.join(f.dir, 'result.txt'), 'utf8'), output);
    await run(f.dir, { driver: () => assert.fail('terminal task must not be resent') });
  });

  test(`${provider}: mismatched workspace stops before delivering assignment`, async t => {
    const f = fixture(t, provider); const calls = [];
    await run(f.dir, { interval: 1, journalRoot: f.journals,
      detect: async () => ({ installed: true, executable: 'desktop.exe' }),
      driver: async command => { calls.push(command.action); f.append(events(provider, f.root, command.text, 'ready')); }
    });
    assert.deepEqual(calls, ['open']);
    assert.equal(f.service.record(f.job.job_id).status, 'blocked');
  });

  test(`${provider}: restart after uncertain send only watches the original session`, async t => {
    const f = fixture(t, provider); let assignment; const controller = new AbortController();
    await run(f.dir, { interval: 1, journalRoot: f.journals, signal: controller.signal,
      detect: async () => ({ installed: true, executable: 'desktop.exe' }),
      driver: async command => {
        if (command.action === 'open') f.append(events(provider, f.workspace, command.text, command.text));
        else { assignment = command.text; fs.writeFileSync(command.intent, 'intent'); controller.abort(); throw new Error('lost acknowledgement'); }
      }
    });
    assert.equal(f.service.record(f.job.job_id).status, 'uncertain');
    f.append(events(provider, f.workspace, assignment, 'late result after 35 minutes', 2));
    await run(f.dir, { interval: 1, journalRoot: f.journals, driver: () => assert.fail('never resend') });
    assert.equal(f.service.record(f.job.job_id).status, 'succeeded');
    assert.equal(f.service.result(f.ctx, f.job.job_id).output, 'late result after 35 minutes');
  });
}

test('Claude ignores intermediate tool turns, hook continuations, sidechains and duplicate message fragments', () => {
  const j = new Journal('claude', process.cwd(), 'handshake', 'assignment');
  events('claude', process.cwd(), 'handshake', 'ready').forEach(e => j.feed(e));
  j.feed({ type: 'user', message: { content: 'assignment' } });
  j.feed({ type: 'assistant', message: { id: 'a', content: [{ type: 'text', text: 'working' }], stop_reason: 'tool_use' } });
  j.feed({ type: 'system', subtype: 'stop_hook_summary', preventedContinuation: false });
  assert.equal(j.status, '');
  j.feed({ type: 'assistant', isSidechain: true, isApiErrorMessage: true, message: { content: 'child error' } });
  assert.equal(j.status, '');
  const final = { type: 'assistant', message: { id: 'b', content: [{ type: 'text', text: 'final' }], stop_reason: 'end_turn' } };
  j.feed(final); j.feed(final);
  j.feed({ type: 'system', subtype: 'stop_hook_summary', preventedContinuation: true });
  assert.equal(j.status, '');
  j.feed(final); j.feed({ type: 'system', subtype: 'stop_hook_summary', preventedContinuation: false });
  assert.equal(j.status, 'succeeded');
  assert.equal(j.output, 'working\n\nfinal');
});

test('Claude API failures and Codex cancellation are accepted as terminal results', () => {
  for (const provider of ['claude', 'codex']) {
    const j = new Journal(provider, process.cwd(), 'h', 'a');
    events(provider, process.cwd(), 'h', 'ready').forEach(e => j.feed(e));
    const pending = events(provider, process.cwd(), 'a', 'unused', 2); pending.slice(0, provider === 'claude' ? 1 : 2).forEach(e => j.feed(e));
    j.feed(provider === 'claude' ? { type: 'assistant', isApiErrorMessage: true, message: { content: [{ type: 'text', text: 'quota failure' }] } }
      : { type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'turn-2' } });
    assert.equal(j.status, provider === 'claude' ? 'failed' : 'cancelled');
  }
});

test('partial UTF-8 records are retained and input truncation never counts as delivery', t => {
  const f = fixture(t, 'claude'); const j = new Journal('claude', f.workspace, 'h😀', 'assignment exact');
  const first = Buffer.from(JSON.stringify(events('claude', f.workspace, 'h😀', 'ready')[0]) + '\n');
  const split = first.indexOf(Buffer.from('😀')) + 1;
  fs.writeFileSync(f.log, first.subarray(0, split)); j.poll(f.log); assert.equal(j.handshakeSeen, false);
  fs.appendFileSync(f.log, first.subarray(split)); j.poll(f.log); assert.equal(j.handshakeSeen, true);
  events('claude', f.workspace, 'h😀', 'ready').slice(1).forEach(e => j.feed(e));
  j.feed({ type: 'user', message: { content: 'assignment exac' } });
  assert.equal(j.inputSeen, false);
});

test('GUI readiness does not claim desktop authentication or a verified session', async () => {
  const status = await probe('claude', '', { platform: 'win32', bridgeReady: () => true,
    execute: (_exe, _args, _options, done) => done(null, JSON.stringify({ installed: true, executable: 'desktop.exe' })) });
  assert.equal(status.available, true); assert.equal(status.connected, false);
  assert.equal(status.authentication, 'unchecked');
});

test('journal replay preserves the assigned result after the desktop chat continues', () => {
  for (const provider of ['claude', 'codex']) {
    const j = new Journal(provider, process.cwd(), 'h', 'a');
    events(provider, process.cwd(), 'h', 'ready').forEach(e => j.feed(e));
    events(provider, process.cwd(), 'a', 'original result', 2).forEach(e => j.feed(e));
    events(provider, process.cwd(), 'unrelated next user task', 'do not substitute', 3).forEach(e => j.feed(e));
    assert.equal(j.output, 'original result'); assert.equal(j.status, 'succeeded');
  }
});

test('same provider input is serialized even across different workspaces', t => {
  const f = fixture(t, 'codex'); const b = path.join(f.root, 'B'); fs.mkdirSync(b);
  const next = f.service.dispatch({ sessionId: 'another', workspace: b }, { provider: 'codex', request_key: 'B', prompt: 'different task' });
  assert.equal(next.status, 'queued');
});

test('long waits return distinct continuation cursors while preserving the original job', async t => {
  const f = fixture(t, 'codex'); const cursors = new Set();
  for (let i = 0; i < 4; i++) {
    const result = await f.service.wait(f.ctx, [f.job.job_id], 0);
    assert.equal(result.wait_expired, true); assert.equal(result.jobs[0].job_id, f.job.job_id);
    cursors.add(result.next_wait_cursor);
  }
  assert.equal(cursors.size, 4);
});

test('a confirmed-before-send UI failure can wait for user action without a second task', async t => {
  const f = fixture(t, 'claude'); let checks = 0; let sent = 0;
  await run(f.dir, { interval: 1, journalRoot: f.journals,
    detect: async () => ({ installed: true, executable: 'desktop.exe' }),
    driver: async command => {
      if (command.action === 'open' && ++checks === 1) throw Object.assign(new Error('Trust workspace'), { beforeSend: true });
      fs.writeFileSync(command.intent, 'intent');
      if (command.action === 'open') f.append(events('claude', f.workspace, command.text, command.text));
      else { sent++; f.append(events('claude', f.workspace, command.text, 'complete', 2)); }
    }
  });
  assert.equal(checks, 2); assert.equal(sent, 1);
  assert.equal(f.service.record(f.job.job_id).status, 'succeeded');
});

test('dependent tasks receive the complete frozen predecessor result', async t => {
  const f = fixture(t, 'codex');
  const evidence = '前置任务检查😀\n'.repeat(8000) + 'PRIOR-RESULT-END';
  fs.writeFileSync(path.join(f.dir, 'result.txt'), evidence);
  atomic(path.join(f.dir, 'state.json'), { status: 'succeeded', endedAt: Date.now() });
  const next = f.service.dispatch(f.ctx, { provider: 'codex', request_key: 'review', prompt: 'Review previous findings', depends_on: [f.job.job_id] });
  const dir = jobDir(f.service.root, next.job_id);
  await run(dir, { interval: 1, journalRoot: f.journals,
    detect: async () => ({ installed: true, executable: 'desktop.exe' }),
    driver: async command => {
      if (command.action === 'send') { assert.ok(command.text.includes(evidence)); assert.ok(command.text.includes('Review previous findings')); }
      f.append(events('codex', f.workspace, command.text, command.action === 'open' ? command.text : 'review complete', command.action === 'open' ? 1 : 2));
    }
  });
  assert.equal(f.service.record(next.job_id).status, 'succeeded');
  assert.ok(f.service.record(next.job_id).deliveryBytes > Buffer.byteLength(evidence));
  fs.writeFileSync(path.join(f.dir, 'result.txt'), 'later changes must not rewrite the submitted payload');
  const request = read(path.join(dir, 'request.json'));
  const payload = require('../lib/external-agents/payload').prepare(dir, request, fs.readFileSync(path.join(dir, 'input.txt'), 'utf8'));
  assert.ok(payload.text.includes(evidence));
});

test('missing input ends safely and releases its worker lock', async t => {
  const f = fixture(t, 'codex'); fs.unlinkSync(path.join(f.dir, 'input.txt'));
  await run(f.dir, { driver: () => assert.fail('no GUI call without verified input') });
  assert.equal(f.service.record(f.job.job_id).status, 'blocked');
  assert.equal(fs.existsSync(path.join(f.dir, 'worker.lock')), false);
});

test('a workspace change after delivery keeps the job reserved until inspected', t => {
  const f = fixture(t, 'codex'); const j = new Journal('codex', f.workspace, 'h', 'a');
  events('codex', f.workspace, 'h', 'ready').forEach(e => j.feed(e));
  events('codex', f.workspace, 'a', '', 2).slice(0, 2).forEach(e => j.feed(e));
  j.feed({ type: 'turn_context', payload: { cwd: f.root } });
  assert.equal(j.inputSeen, true); assert.equal(j.status, 'uncertain');
  j.feed({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-2', last_agent_message: 'changed elsewhere' } });
  assert.equal(j.status, 'uncertain');
});
