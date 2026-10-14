'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ExternalSessionHistory, historyRoots } = require('../lib/external-agents/history');
const { ExternalAgentService } = require('../lib/external-agents/service');
const msg = text => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-history-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'work');
  const roots = historyRoots({ CODEX_HOME: path.join(root, 'codex'), CLAUDE_CONFIG_DIR: path.join(root, 'claude') });
  roots.forEach(spec => fs.mkdirSync(spec.root, { recursive: true }));
  const history = new ExternalSessionHistory({ roots });
  function write(index, name, events) {
    const file = path.join(roots[index].root, name + '.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, events.map(e => JSON.stringify(e)).join('\n') + '\n');
    return file;
  }
  const codex = (id, cwd = workspace, text = 'Earlier question') => [
    { type: 'session_meta', payload: { id, cwd, originator: 'Codex Desktop' } }, msg(text),
    { type: 'event_msg', payload: { type: 'user_message', message: text } }
  ];
  return { root, workspace, roots, history, write, codex, context: { workspace }, providers: ['codex', 'claude'] };
}

test('discovers independent local sessions, archives and provider/workspace scopes', async t => {
  const f = fixture(t);
  f.write(0, '2026/10/09/local', f.codex('local'));
  f.write(1, 'archive', f.codex('archive'));
  f.write(0, 'other', f.codex('other', path.join(f.root, 'other')));
  f.write(2, 'project/session', [{ type: 'user', sessionId: 'claude', cwd: f.workspace, message: { content: 'Claude question' } }]);
  f.write(2, 'project/session/subagents/agent-child', [{ type: 'user', sessionId: 'child', cwd: f.workspace, isSidechain: true, message: { content: 'hidden' } }]);
  const list = await f.history.list(f.context, {}, f.providers);
  assert.equal(list.total, 3);
  assert.equal((await f.history.list(f.context, { scope: 'all' }, f.providers)).total, 4);
  assert.equal((await f.history.list(f.context, { include_archived: false }, ['codex'])).total, 1);
  const other = (await f.history.list(f.context, { scope: 'all', query: 'other' }, f.providers)).sessions[0];
  await assert.rejects(f.history.read(f.context, { history_id: other.history_id }, f.providers), /范围/);
  assert.equal((await f.history.read(f.context, { scope: 'all', history_id: other.history_id }, f.providers)).messages.length, 1);
  await assert.rejects(f.history.read(f.context, { history_id: '../../secret' }, f.providers), /history_id/);
});

test('Unicode pagination reconstructs messages exactly and omits Codex mirrored events', async t => {
  const f = fixture(t);
  const original = 'a😀中文🚀b'.repeat(20);
  f.write(0, 'local', [...f.codex('local', f.workspace, 'x'), msg(original)]);
  const { history_id } = (await f.history.list(f.context, {}, f.providers)).sessions[0];
  let cursor, pages = 0, text = '';
  do {
    const result = await f.history.read(f.context, { history_id, cursor, limit: 3 }, f.providers);
    for (const message of result.messages) {
      assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(message.text));
      text += message.text;
    }
    cursor = result.next_cursor;
    assert.ok(++pages < 300);
  } while (cursor);
  assert.equal(text, 'x' + original);
});

test('Claude text, tools and attachment markers without thinking or subagents', async t => {
  const f = fixture(t);
  f.write(2, 'project/session', [
    { type: 'user', sessionId: 'claude', cwd: f.workspace, message: { content: 'question' } },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'answer' }, { type: 'tool_use', name: 'Read', id: 't1', input: { file: 'a' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'file content' }] }, { type: 'image', source: { data: 'BASE64' } }] } }
  ]);
  const { history_id } = (await f.history.list(f.context, {}, f.providers)).sessions[0];
  const plain = await f.history.read(f.context, { history_id }, f.providers);
  assert.deepEqual(plain.messages.map(m => m.text), ['question', 'answer', '[image: attachment]']);
  const tools = JSON.stringify(await f.history.read(f.context, { history_id, include_tools: true }, f.providers));
  assert.match(tools, /file content/); assert.match(tools, /tool Read/);
  assert.doesNotMatch(tools, /private|BASE64/);
});

test('snapshot paging tolerates append, reports incomplete data, rejects tampering/truncation', async t => {
  const f = fixture(t);
  const file = f.write(0, 'local', f.codex('local', f.workspace, 'abcdefgh'));
  fs.appendFileSync(file, 'not json\nnull\n{"type":');
  const { history_id } = (await f.history.list(f.context, {}, f.providers)).sessions[0];
  const first = await f.history.read(f.context, { history_id, limit: 2 }, f.providers);
  fs.appendFileSync(file, '"event_msg"}\n' + JSON.stringify(msg('new')) + '\n');
  const rest = await f.history.read(f.context, { history_id, cursor: first.next_cursor }, f.providers);
  assert.equal(rest.messages[0].text, 'cdefgh');
  assert.equal(rest.has_new_data, true); assert.equal(rest.pending_tail, true);
  assert.equal(rest.skipped_records, 2);
  await assert.rejects(f.history.read(f.context, { history_id, cursor: first.next_cursor + '.extra' }, f.providers), /游标/);
  fs.truncateSync(file, 0);
  await assert.rejects(f.history.read(f.context, { history_id, cursor: first.next_cursor }, f.providers), /截断/);
});

test('history respects extension switches and never launches a worker or creates jobs', async t => {
  const f = fixture(t);
  f.write(0, 'local', f.codex('local'));
  let config = { enabled: true, providers: { codex: { enabled: true } } };
  const service = new ExternalAgentService({ dataDir: f.root, historyOptions: { roots: f.roots }, loadConfig: () => ({ externalAgents: config }), launch: () => { throw Error('must not launch'); } });
  t.after(() => service.close());
  assert.equal((await service.listHistory(f.context)).total, 1);
  assert.equal(service.records().length, 0);
  assert.throws(() => service.listHistory(f.context, { provider: 'claude' }), /启用/);
  config.enabled = false;
  assert.throws(() => service.listHistory(f.context), /启用/);
});
