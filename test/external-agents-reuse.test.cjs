'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ExternalAgentService } = require('../lib/external-agents/service');
const { run } = require('../lib/external-agents/worker');
const { read, atomic, jobDir } = require('../lib/external-agents/storage');
const { claudeDesktopSession } = require('../lib/external-agents/sessions');
const { sessionLink } = require('../lib/external-agents/desktop');

function fixture(t, provider) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-reuse-'));
  const workspace = path.join(root, '工作区 A'); fs.mkdirSync(workspace);
  const journals = path.join(root, 'journals'); fs.mkdirSync(journals);
  const metadataRoot = path.join(root, 'claude-code-sessions');
  const sessionId = crypto.randomUUID();
  const localId = `local_${crypto.randomUUID()}`;
  const metadataFile = path.join(metadataRoot, 'account', 'organization', `${localId}.json`);
  atomic(metadataFile, { sessionId: localId, cliSessionId: sessionId, cwd: workspace, isArchived: false });
  const log = path.join(journals, `${sessionId}.jsonl`);
  const config = { externalAgents: { enabled: true, providers: { codex: { enabled: true }, claude: { enabled: true } } } };
  const makeService = () => {
    const service = new ExternalAgentService({ dataDir: root, loadConfig: () => config, launch: () => process.pid });
    service.close(); return service;
  };
  const service = makeService();
  const context = { sessionId: 'yan-a', workspace };
  const first = service.dispatch(context, { provider, request_key: 'first', prompt: '第一项工作，保留完整上下文😀' });
  let turn = 0;
  function append(input, output, id = sessionId) {
    const n = ++turn;
    const base = { entrypoint: 'claude-desktop-3p', cwd: workspace, sessionId: id };
    const events = provider === 'claude' ? [
      { ...base, type: 'user', message: { content: input } },
      { ...base, type: 'assistant', message: { id: `message-${n}`, content: [{ type: 'text', text: output }], stop_reason: 'end_turn' } },
      { ...base, type: 'system', subtype: 'stop_hook_summary', preventedContinuation: false }
    ] : [
      ...(n === 1 ? [{ type: 'session_meta', payload: { id, cwd: workspace, originator: 'Codex Desktop' } }] : []),
      { type: 'event_msg', payload: { type: 'task_started', turn_id: `turn-${n}` } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: input }] } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: `turn-${n}`, last_agent_message: output } }
    ];
    fs.appendFileSync(log, events.map(e => JSON.stringify(e)).join('\n') + '\n');
  }
  const calls = [];
  const options = { interval: 1, journalRoot: journals, sessionRoots: [metadataRoot],
    detect: async () => ({ installed: true, executable: 'desktop.exe' }),
    driver: async command => {
      calls.push(command);
      fs.writeFileSync(command.intent, 'durable send intent');
      if (command.action === 'resume') {
        assert.equal(command.url, sessionLink(provider, provider === 'claude' ? localId : sessionId));
        assert.match(command.marker, /^YAN_READY_/);
        assert.equal(new URL(command.url).searchParams.has('prompt'), false);
      }
      append(command.text, command.action === 'send' ? `result-${calls.length}` : command.text);
    } };
  const dir = job => jobDir(service.root, job.job_id);
  const follow = (previous, key = 'follow', ctx = context, selected = service) => selected.dispatch(ctx, {
    provider, request_key: key, prompt: `处理新的独立问题：${key}`,
    ...(previous ? { previous_job_id: previous.job_id, new_issue: `新增问题 ${key}` } : {})
  });
  t.after(() => { service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, workspace, journals, service, context, first, calls, options, dir, follow, append,
    log, sessionId, localId, metadataRoot, metadataFile, makeService };
}

for (const provider of ['codex', 'claude']) {
  test(`${provider}: subsequent assignments reuse the desktop task across service restart and Yan conversations`, async t => {
    const f = fixture(t, provider);
    await run(f.dir(f.first), f.options);
    const second = f.follow(f.first);
    assert.equal(second.reused_session, true);
    assert.equal(second.session_source_job_id, f.first.job_id);
    assert.notEqual(second.job_id, f.first.job_id);
    await run(f.dir(second), f.options);
    const restored = f.makeService();
    const thirdContext = { ...f.context, sessionId: 'new-yan-conversation' };
    const third = f.follow(null, 'third', thirdContext, restored);
    assert.equal(third.reused_session, true);
    assert.equal(third.session_source_job_id, second.job_id);
    await run(f.dir(third), f.options);
    assert.deepEqual(f.calls.map(call => call.action), ['open', 'send', 'resume', 'send', 'resume', 'send']);
    for (const job of [f.first, second, third]) {
      assert.equal(restored.record(job.job_id).status, 'succeeded');
      assert.equal(restored.record(job.job_id).externalSessionId, f.sessionId);
    }
    assert.equal(restored.result(f.context, f.first.job_id).output, 'result-2');
    assert.equal(restored.result(f.context, second.job_id).output, 'result-4');
    assert.equal(restored.result(thirdContext, third.job_id).output, 'result-6');
    assert.throws(() => restored.result(thirdContext, f.first.job_id), /不属于/);
    assert.equal(restored.dispatch(thirdContext, { provider, request_key: 'third', prompt: '处理新的独立问题：third' }).job_id, third.job_id);
    assert.equal(f.calls.length, 6);
  });

  test(`${provider}: queued follow-up binds after its predecessor finishes, without creating a second desktop task`, async t => {
    const f = fixture(t, provider);
    const next = f.service.dispatch(f.context, { provider, request_key: 'dependent', prompt: '审查刚完成的工作', depends_on: [f.first.job_id] });
    assert.equal(next.status, 'queued');
    await run(f.dir(f.first), f.options);
    f.service.drain();
    assert.equal(f.service.record(next.job_id).continuation.sourceJobId, f.first.job_id);
    await run(f.dir(next), f.options);
    assert.deepEqual(f.calls.map(call => call.action), ['open', 'send', 'resume', 'send']);
    assert.ok(f.calls[3].text.includes('result-2'));
  });

  test(`${provider}: another workspace and provider never inherit the original session`, async t => {
    const f = fixture(t, provider);
    await run(f.dir(f.first), f.options);
    const workspace = path.join(f.root, 'B'); fs.mkdirSync(workspace);
    const other = f.follow(null, 'other-workspace', { sessionId: 'yan-b', workspace });
    assert.equal(f.service.record(other.job_id).continuation, null);
    const otherProvider = provider === 'claude' ? 'codex' : 'claude';
    const next = f.service.dispatch(f.context, { provider: otherProvider, request_key: 'other-provider', prompt: '另一个 Agent 的新问题', previous_job_id: f.first.job_id, new_issue: '不同专长的检查' });
    assert.equal(f.service.record(next.job_id).continuation, null);
  });

  test(`${provider}: a missing original journal fails closed instead of opening another task`, async t => {
    const f = fixture(t, provider);
    await run(f.dir(f.first), f.options);
    fs.unlinkSync(f.log);
    const next = f.follow(f.first);
    await run(f.dir(next), { ...f.options, driver: () => assert.fail('must not navigate or send') });
    assert.equal(f.service.record(next.job_id).status, 'blocked');
    assert.equal(f.service.record(next.job_id).continuation.externalSessionId, f.sessionId);
  });

  test(`${provider}: resume timeout after sending handshake never sends it twice after recovery`, async t => {
    const f = fixture(t, provider);
    await run(f.dir(f.first), f.options);
    const next = f.follow(f.first);
    let handshake;
    const controller = new AbortController();
    await run(f.dir(next), { ...f.options, signal: controller.signal, driver: command => {
      assert.equal(command.action, 'resume'); handshake = command.text;
      fs.writeFileSync(command.intent, 'sent'); controller.abort();
      throw new Error('GUI acknowledgement lost');
    } });
    assert.equal(f.service.record(next.job_id).status, 'uncertain');
    f.append(handshake, handshake);
    let assignments = 0;
    await run(f.dir(next), { ...f.options, driver: command => {
      assert.equal(command.action, 'send'); assignments++;
      fs.writeFileSync(command.intent, 'sent'); f.append(command.text, 'recovered result');
    } });
    assert.equal(assignments, 1);
    assert.equal(f.service.result(f.context, next.job_id).output, 'recovered result');
  });

  test(`${provider}: resume before-send attention resumes the same binding after worker restart`, async t => {
    const f = fixture(t, provider);
    await run(f.dir(f.first), f.options);
    const next = f.follow(f.first);
    const controller = new AbortController();
    await run(f.dir(next), { ...f.options, signal: controller.signal, driver: command => {
      assert.equal(command.action, 'resume'); controller.abort();
      throw Object.assign(new Error('已有用户草稿'), { beforeSend: true });
    } });
    assert.equal(f.service.record(next.job_id).guiRetrySafe, true);
    await run(f.dir(next), f.options);
    assert.equal(f.service.record(next.job_id).status, 'succeeded');
    assert.deepEqual(f.calls.map(call => call.action), ['open', 'send', 'resume', 'send']);
  });

  test(`${provider}: uncertain assignment receipt recovers only that turn and preserves earlier results`, async t => {
    const f = fixture(t, provider);
    await run(f.dir(f.first), f.options);
    const next = f.follow(f.first);
    const controller = new AbortController(); let assignment;
    await run(f.dir(next), { ...f.options, signal: controller.signal, driver: async command => {
      if (command.action === 'resume') return f.options.driver(command);
      assignment = command.text; fs.writeFileSync(command.intent, 'sent'); controller.abort();
      throw new Error('lost acknowledgement');
    } });
    f.append(assignment, 'the second result');
    f.append('unrelated subsequent user message', 'not our result');
    await run(f.dir(next), { ...f.options, driver: () => assert.fail('no UI interaction during receipt recovery') });
    assert.equal(f.service.result(f.context, next.job_id).output, 'the second result');
    assert.equal(f.service.result(f.context, f.first.job_id).output, 'result-2');
  });
}

for (const failure of ['archived', 'missing', 'wrong-workspace', 'ambiguous']) {
  test(`Claude metadata ${failure} never falls back to a new task`, async t => {
    const f = fixture(t, 'claude'); await run(f.dir(f.first), f.options);
    const metadata = read(f.metadataFile);
    if (failure === 'archived') atomic(f.metadataFile, { ...metadata, isArchived: true });
    if (failure === 'missing') fs.unlinkSync(f.metadataFile);
    if (failure === 'wrong-workspace') atomic(f.metadataFile, { ...metadata, cwd: f.root });
    if (failure === 'ambiguous') atomic(path.join(f.metadataRoot, 'another-account', `${f.localId}.json`), metadata);
    const next = f.follow(f.first);
    await run(f.dir(next), { ...f.options, driver: () => assert.fail('no GUI action without a verified original session') });
    assert.equal(f.service.record(next.job_id).status, 'blocked');
    assert.match(f.service.record(next.job_id).error, /不会新建/);
  });
}

test('Claude resolves the GUI id from the exact journal id and workspace, never from last activity or title', t => {
  const f = fixture(t, 'claude');
  atomic(path.join(f.metadataRoot, 'other', 'local-other.json'), { sessionId: 'local-other', cliSessionId: 'unrelated', cwd: f.workspace, lastActivityAt: Date.now() + 99999 });
  assert.equal(claudeDesktopSession(f.sessionId, f.workspace, [f.metadataRoot]), f.localId);
  assert.throws(() => sessionLink('claude', f.sessionId), /无效/);
  assert.throws(() => sessionLink('codex', '../new?prompt=bad'), /无效/);
});

test('changed session metadata is detected before the continuation handshake is sent', async t => {
  const f = fixture(t, 'codex'); await run(f.dir(f.first), f.options);
  fs.appendFileSync(f.log, JSON.stringify({ type: 'session_meta', payload: { id: crypto.randomUUID(), cwd: f.workspace, originator: 'Codex Desktop' } }) + '\n');
  const next = f.follow(f.first);
  await run(f.dir(next), { ...f.options, driver: () => assert.fail('no send to a changed journal session') });
  assert.equal(f.service.record(next.job_id).status, 'blocked');
  assert.match(f.service.record(next.job_id).error, /编号发生变化/);
});
