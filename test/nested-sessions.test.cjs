'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { createNestedSessions } = require('../lib/nested-sessions/service');
const { createSessionStore } = require('../lib/session-store');
async function until(check) { for (let i = 0; i < 300; i++) { if (await check()) return; await delay(10); } throw Error('condition timed out'); }
async function fixture(t, overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-nested-unit-'));
  const records = new Map([['parent', { id: 'parent', title: 'parent', workspace: '/project', messages: [] }]]);
  let index = 0, settings = { enabled: true, style: 'grid' };
  const running = new Map(), calls = [], opened = [], busy = new Set();
  const sessions = {
    readSessionRecord: async id => structuredClone(records.get(id)),
    createFreshSessionRecord: async input => { const record = { ...input, id: 'child' + ++index, messages: [] }; records.set(record.id, record); return structuredClone(record); },
    bindNestedWorkspace: async (id, workspace) => { records.get(id).workspace = workspace; },
    appendHostMessage: async (id, message) => { const r = records.get(id); if (!r.messages.some(m => m.nestedDeliveryId === message.nestedDeliveryId)) r.messages.push(message); },
    saveSession: async session => { records.set(session.id, structuredClone(session)); return { ok: true }; }
  };
  const options = { dataDir, sessions, preferences: () => settings, busy: id => busy.has(id),
    workspaces: { repository: () => true, prepare: async (root, id) => ({ childID: id, childDirectory: root + '/' + id, baseline: 'base', commit: 'commit' }), freeze: async () => 'tree', integrate: async () => ({ files: ['a.js'] }) },
    execute: (session, job) => new Promise(resolve => { calls.push({ session, job }); running.set(job.runId, resolve); }),
    cancel: async id => { running.get(id)?.({ status: 'interrupted' }); },
    openWindow: async id => opened.push(id), ...overrides };
  const service = createNestedSessions(options); await service.ready;
  t.after(async () => { service.close(); for (const resolve of running.values()) resolve({ status: 'interrupted' }); await delay(100); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const dispatch = async count => {
    const result = await service.dispatch('parent', { request_key: 'dispatch', tasks: Array.from({ length: count }, (_, i) => ({ title: 'Task ' + i, prompt: 'Do ' + i })) });
    // Existing tests exercise the post-confirmation scheduler; new draft/start
    // behavior has its own dedicated test below.
    for (const id of result.created) {
      try { await service.start(id, {}); }
      catch (error) { if (!/等待启动/.test(error.message)) throw error; }
    }
    return result;
  };
  return { service, dispatch, records, calls, opened, busy, dataDir, options, settings, finish: (index, result = { status: 'done', text: 'done' }) => running.get(calls[index].job.runId)(result) };
}
test('four independent persistent children, idempotent dispatch, bounded depth and fanout', async t => {
  const f = await fixture(t), first = await f.dispatch(4);
  await until(() => f.calls.length === 4);
  assert.equal(new Set(f.calls.map(c => c.session.workspace)).size, 4);
  assert.equal(f.opened.length, 4);
  const again = await f.dispatch(4); assert.deepEqual(again.created, first.created); assert.equal(f.records.size, 5);
  await assert.rejects(f.service.dispatch('parent', { request_key: 'fifth', tasks: [{ title: '5', prompt: '5' }] }), /四/);
  await assert.rejects(f.service.dispatch(first.created[0], { request_key: 'grandchild', tasks: [{ title: 'g', prompt: 'g' }] }), /不能/);
  await assert.rejects(f.service.send(first.created[0], first.created[1], 'cross window', 'cross'), /无权/);
});
test('dispatched children wait for the user to confirm a model before running', async t => {
  const f = await fixture(t);
  const result = await f.service.dispatch('parent', { request_key: 'gate', tasks: [{ title: 'Gate', prompt: 'Original task' }] });
  const id = result.created[0];
  await delay(30);
  assert.equal(f.calls.length, 0, 'draft child must not run before confirmation');
  const view = await f.service.inspect('parent');
  const child = view.children.find(c => c.id === id);
  assert.equal(child.jobs[0].status, 'draft');
  assert.equal(child.jobs[0].prompt, 'Original task');
  assert.equal(f.records.get(id).messages.length, 0, 'no user message before confirmation');
  await assert.rejects(f.service.send('parent', id, 'too early', 'early'), /尚未确认启动/);
  const modelSelection = { providerId: 'p', supplierId: 's', modelId: 'm', modelType: 'text', name: 'M' };
  const started = await f.service.start(id, { modelSelection, prompt: 'Edited task' });
  assert.equal(started.ok, true);
  await until(() => f.calls.length === 1);
  assert.equal(f.calls[0].job.prompt, 'Edited task');
  assert.equal(f.calls[0].session.modelSelection.modelId, 'm');
  assert.equal(f.records.get(id).messages[0].content, 'Edited task');
});
test('parent sleeps without polling, wakes once only after all reports and parent settlement', async t => {
  const f = await fixture(t); f.busy.add('parent'); await f.dispatch(2); await f.service.suspend('parent');
  await until(() => f.calls.length === 2); f.finish(0);
  await until(async () => (await f.service.inspect('parent')).children[0].jobs[0].status === 'done');
  await f.service.pump(); assert.equal(f.calls.length, 2);
  f.finish(1); await until(async () => (await f.service.inspect('parent')).children.every(c => c.jobs[0].status === 'done'));
  await f.service.pump(); assert.equal(f.calls.length, 2);
  f.busy.delete('parent'); await f.service.pump(); await until(() => f.calls.length === 3);
  assert.equal(f.calls[2].job.kind, 'wake'); assert.match(f.calls[2].job.prompt, /resultId/);
  f.finish(2); await delay(60); await f.service.pump(); assert.equal(f.calls.length, 3);
});
test('user stop disarms parent wake; child messages queue exactly once', async t => {
  const f = await fixture(t), { created: [id] } = await f.dispatch(1);
  await until(() => f.calls.length === 1); await f.service.suspend('parent'); await f.service.stop('parent');
  const sent = await f.service.send(id, id, 'follow up', 'message');
  assert.equal((await f.service.send(id, id, 'follow up', 'message')).runId, sent.runId);
  await assert.rejects(f.service.send(id, id, 'different', 'message'), /幂等/);
  assert.equal(f.calls.length, 1); f.finish(0); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].session.id, id); f.finish(1); await delay(60);
  assert.equal(f.calls.length, 2);
});
test('disabled/non-Git dispatch rejects; tree style never opens windows', async t => {
  const f = await fixture(t); f.settings.enabled = false; await assert.rejects(f.dispatch(1), /启用/);
  f.settings.enabled = true; f.options.workspaces.repository = () => false; await assert.rejects(f.dispatch(1), /Git/);
  f.options.workspaces.repository = () => true; f.settings.style = 'tree'; await f.dispatch(1);
  assert.equal(f.opened.length, 0);
});
test('background completions remain journaled, deduplicated turns in the same parent or child', async t => {
  const f = await fixture(t), { created: [id] } = await f.dispatch(1);
  await until(() => f.calls.length === 1); f.finish(0);
  await until(async () => (await f.service.inspect(id)).children[0].jobs[0].status === 'done');
  f.busy.add('parent');
  const first = await f.service.background('parent', 'background result', 'bash:one');
  assert.equal((await f.service.background('parent', 'background result', 'bash:one')).runId, first.runId);
  await f.service.pump(); assert.equal(f.calls.length, 1);
  f.busy.delete('parent'); await f.service.pump(); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].session.id, 'parent'); f.finish(1);
  await f.service.background(id, 'child background result', 'bash:two');
  await until(() => f.calls.length === 3); assert.equal(f.calls[2].session.id, id);
});
test('one through four windows tile within the selected monitor without overlap', () => {
  const { tileBounds } = require('../lib/main/nested-sessions');
  const area = { x: -1920, y: 40, width: 1920, height: 1040 };
  for (let count = 1; count <= 4; count++) {
    const bounds = tileBounds(area, count); assert.equal(bounds.length, count);
    for (const a of bounds) {
      assert.ok(a.x >= area.x && a.y >= area.y && a.x + a.width <= area.x + area.width && a.y + a.height <= area.y + area.height);
      for (const b of bounds) if (a !== b) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
  }
});
test('partial workspace preparation failure retains successful work and a stable retry receipt', async t => {
  const f = await fixture(t); let count = 0;
  f.options.workspaces.prepare = async (root, id) => { if (++count === 2) throw Error('disk unavailable'); return { childDirectory: root + '/' + id }; };
  const first = await f.dispatch(3); assert.match(first.error, /disk/); assert.equal(first.created.length, 1);
  await until(() => f.calls.length === 1); assert.equal(f.opened.length, 1);
  const again = await f.dispatch(3); assert.deepEqual(again.created, first.created); assert.equal(count, 2);
});
test('restart marks uncertain jobs interrupted and never replays them or wakes the parent', async t => {
  const f = await fixture(t); await f.dispatch(1); await until(() => f.calls.length === 1); await f.service.suspend('parent'); f.service.close();
  let executed = false;
  const recovered = createNestedSessions({ ...f.options, execute: async () => { executed = true; } });
  await recovered.ready; await recovered.pump();
  assert.equal((await recovered.inspect('parent')).children[0].jobs[0].status, 'interrupted');
  assert.equal((await recovered.inspect('parent')).wake, false); assert.equal(executed, false); recovered.close();
});
test('stale renderer saves cannot erase host results, native session identity or isolated workspace', async t => {
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-nested-store-'));
  t.after(() => fs.rmSync(sessionsDir, { recursive: true, force: true }));
  const store = createSessionStore({ sessionsDir, ensureDirs: () => {}, mainWindow: { get: () => null },
    yanagent: { migrateMemoryToWorkspace() {}, ensureYanagent() {} }, activateWorkspace() {}, activeRuns: new Map(), runAdmissions: new Map(), deleteCoreThread: () => ({ ok: true }) });
  const s = await store.createFreshSessionRecord({ title: 'child', workspace: 'parent', nested: { parentId: 'parent' } });
  await store.bindNestedWorkspace(s.id, 'isolated');
  await store.appendHostMessage(s.id, { role: 'assistant', content: 'result', nestedDeliveryId: 'j:output', agentRun: { runId: 'r', status: 'done', openCodeSessionId: 'kernel' }, ts: 1 });
  await store.saveSession({ ...s, nested: { parentId: 'forged' }, workspace: 'wrong', messages: [] });
  const record = await store.readSessionRecord(s.id);
  assert.equal(record.workspace, 'isolated'); assert.equal(record.nested.parentId, 'parent');
  assert.equal(record.openCodeSessionId, 'kernel'); assert.equal(record.messages.filter(m => m.nestedDeliveryId).length, 1);
  await assert.rejects(store.setSessionWorkspace(s.id, 'wrong'), /固定/);
});
test('real Git worktrees share a dirty baseline, preserve parent index and retain immutable results', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-nested-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  git('init', '-q'); git('config', 'core.autocrlf', 'false'); fs.writeFileSync(path.join(root, 'file.txt'), 'base\n'); git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(root, 'file.txt'), 'dirty\n');
  const index = git('write-tree'), workspaces = require('../lib/nested-sessions/workspace');
  const a = await workspaces.prepare(root, 'nested_a');
  fs.writeFileSync(path.join(root, 'later.txt'), 'parent only');
  const b = await workspaces.prepare(root, 'nested_b', { baseline: a.baseline, commit: a.commit });
  assert.equal(fs.readFileSync(path.join(b.directory, 'file.txt'), 'utf8'), 'dirty\n');
  assert.equal(fs.existsSync(path.join(b.directory, 'later.txt')), false); assert.equal(git('write-tree'), index);
  fs.writeFileSync(path.join(a.directory, 'child.txt'), 'result'); const tree = await workspaces.freeze(a, 'result_a');
  fs.writeFileSync(path.join(a.directory, 'child.txt'), 'newer');
  assert.notEqual(await workspaces.freeze(a), tree); assert.equal(git('rev-parse', 'refs/yan/nested/result_a').trim(), tree);
  await assert.rejects(workspaces.integrate(a, tree), /changed/);
  fs.writeFileSync(path.join(a.directory, 'child.txt'), 'result'); await workspaces.integrate(a, tree);
  assert.equal(fs.readFileSync(path.join(root, 'child.txt'), 'utf8'), 'result'); assert.equal(git('write-tree'), index);
});
test('cancelling one run never cancels sibling work or queued follow-ups', async t => {
  const f = await fixture(t), { created: [a, b] } = await f.dispatch(2);
  await until(() => f.calls.length === 2);
  await f.service.send(a, a, 'follow up', 'queued_after_cancel');
  const firstRun = f.calls[0].job.runId;
  await f.service.cancelRun(firstRun);
  await until(async () => (await f.service.inspect(a)).children[0].jobs.find(j => j.runId === firstRun)?.status === 'interrupted');
  const aJobs = (await f.service.inspect(a)).children.find(c => c.id === a).jobs;
  const followUp = aJobs.find(j => j.requestKey === 'queued_after_cancel');
  assert.ok(!followUp.cancelRequested);
  assert.notEqual(followUp.status, 'cancelled');
  const bJob = (await f.service.inspect(b)).children.find(c => c.id === b).jobs[0];
  assert.equal(bJob.status, 'running'); assert.ok(!bJob.cancelRequested);
  assert.equal(f.calls.filter(c => c.job.runId === f.calls[1].job.runId).length, 1);
});
test('cancelled children keep an integrable code snapshot', async t => {
  const f = await fixture(t), { created: [id] } = await f.dispatch(1);
  await until(() => f.calls.length === 1);
  await f.service.cancelRun(f.calls[0].job.runId);
  await until(async () => {
    const job = (await f.service.inspect(id)).children[0].jobs[0];
    return job.status === 'interrupted' && job.tree === 'tree';
  });
  const job = (await f.service.inspect(id)).children[0].jobs[0];
  const applied = await f.service.integrate('parent', id, job.id);
  assert.equal(applied.ok, true); assert.equal(applied.interrupted, true); assert.match(applied.output, /审查/);
  assert.equal((await f.service.integrate('parent', id, job.id)).alreadyIntegrated, true);
});
test('restart-interrupted results are recovered from their worktree on integrate', async t => {
  const f = await fixture(t); await f.dispatch(1); await until(() => f.calls.length === 1); f.service.close();
  const recovered = createNestedSessions({ ...f.options }); await recovered.ready; t.after(() => recovered.close());
  const view = await recovered.inspect('parent'), id = view.children[0].id, job = view.children[0].jobs[0];
  assert.equal(job.status, 'interrupted'); assert.equal(job.tree, undefined);
  const applied = await recovered.integrate('parent', id, job.id);
  assert.equal(applied.ok, true); assert.equal(applied.interrupted, true);
});
test('child windows read neutral values instead of rejecting main-only channels', async t => {
  const sessionWindows = require('../lib/main/windows/session-windows');
  const handlers = new Map(), ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
  const { registerExternalAgents } = require('../lib/main/external-agents');
  let listed = 0;
  registerExternalAgents({ ipcMain, dialog: {}, getMainWindow: () => null, service: { list: () => { listed++; return [{ id: 'job' }]; } } });
  const win = { webContents: { id: 771, mainFrame: {} }, once() {}, isDestroyed: () => false };
  sessionWindows.bind('child_window', win);
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  assert.deepEqual(await handlers.get('external-agents:list')(event), []);
  assert.equal(listed, 0);
  assert.throws(() => handlers.get('external-agents:status')(event), /无权/);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-nested-browser-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const { registerBrowserSettings } = require('../lib/main/browser-settings');
  registerBrowserSettings({ app: { getPath: () => userData, on() {}, whenReady: () => Promise.resolve() }, ipcMain, session: { fromPartition: () => ({ on() {} }) }, shell: {}, dialog: {} },
    { BROWSER_PARTITION: 'persist:test', getMainWindow: () => null, configStore: { loadConfig: () => ({}) } });
  assert.deepEqual(await handlers.get('browser:downloads')(event), []);
  assert.throws(() => handlers.get('browser:download-location')(event), /无权/);
});
test('integrate reports an empty result instead of claiming applied code', async t => {
  const f = await fixture(t, { workspaces: {
    repository: () => true,
    prepare: async (root, id) => ({ childID: id, childDirectory: root + '/' + id, baseline: 'base', commit: 'commit' }),
    freeze: async () => 'tree',
    integrate: async () => ({ files: [] })
  } });
  const { created: [id] } = await f.dispatch(1);
  await until(() => f.calls.length === 1); f.finish(0);
  await until(async () => (await f.service.inspect(id)).children[0].jobs[0].status === 'done');
  const job = (await f.service.inspect(id)).children[0].jobs[0];
  const applied = await f.service.integrate('parent', id, job.id);
  assert.equal(applied.ok, true);
  assert.equal(applied.applied, false);
  assert.deepEqual(applied.files, []);
  assert.match(applied.output, /没有可应用的改动/);
  assert.doesNotMatch(applied.output, /已应用代码/);
  const view = await f.service.inspect('parent');
  assert.equal(view.integration.status, 'empty');
});

test('session tool claims match identity fields, not the trimmed argument object', () => {
  const { sessionClaimMatches } = require('../lib/main/bridges');
  const claimed = { operation: 'dispatch', task_id: 'task-1', request_key: 'key-1',
    tasks: [{ title: 'a', prompt: 'b', prompt_note: '' }] };
  assert.equal(sessionClaimMatches('nested_sessions',
    { operation: 'dispatch', task_id: 'task-1', request_key: 'key-1', tasks: [{ title: 'a', prompt: 'b' }] }, claimed), true);
  assert.equal(sessionClaimMatches('nested_sessions', { operation: 'dispatch', task_id: 'task-2', request_key: 'key-1' }, claimed), false);
  assert.equal(sessionClaimMatches('nested_sessions', { operation: 'list', task_id: 'task-1' }, claimed), false);
  assert.equal(sessionClaimMatches('nested_sessions', { operation: 'dispatch', task_id: 'task-1', request_key: 'key-2' }, claimed), false);
  assert.equal(sessionClaimMatches('other_action', { anything: 1 }, claimed), true);
});
test('background Bash wakes are tagged apart from child reports and user turns', async t => {
  const f = await fixture(t), { created: [id] } = await f.dispatch(1);
  await until(() => f.calls.length === 1); f.finish(0);
  await until(async () => (await f.service.inspect(id)).children[0].jobs[0].status === 'done');
  await f.service.background('parent', 'YAN BACKGROUND BASH COMPLETION parent', 'bash:root');
  await until(() => f.calls.length === 2);
  const rootMsg = f.records.get('parent').messages.find(m => m.content === 'YAN BACKGROUND BASH COMPLETION parent');
  assert.equal(rootMsg.nestedSource, 'background_bash');
  assert.notEqual(rootMsg.nestedSource, 'child_report');
  await f.service.background(id, 'YAN BACKGROUND BASH COMPLETION child', 'bash:child');
  await until(() => f.calls.length === 3);
  const childMsg = f.records.get(id).messages.find(m => m.content === 'YAN BACKGROUND BASH COMPLETION child');
  assert.equal(childMsg.nestedSource, 'background_bash');
  assert.notEqual(childMsg.nestedSource, 'delegation');
});
