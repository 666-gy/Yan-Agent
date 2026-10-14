'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createComputerControlStore } = require('../lib/computer-control-store');
const { createComputerAdapter } = require('../lib/yan-computer-mcp');
const { sessionApps } = require('../lib/computer-control-history');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-control-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, store: createComputerControlStore(dir) };
}

test('legacy reports are linked to successful history and deletion cannot resurrect them', t => {
  const { dir, store } = fixture(t);
  fs.mkdirSync(path.join(dir, 'sessions'));
  const timeline = [
    { type: 'tool_call', callId: '1', name: 'yanp_computer_launch_app', args: { path: 'D:\\Music\\music.exe' } },
    { type: 'tool_result', callId: '1', name: 'yanp_computer_launch_app', ok: true, completedAt: 100, output: '{"running":true,"pid":10,"windows":[{"title":"音乐"}]}\n\nLaunched' },
  ];
  fs.writeFileSync(path.join(dir, 'sessions/old.json'), JSON.stringify({ messages: [{ agentRun: { timeline } }] }));
  const reports = path.join(dir, 'Computer-Use-Astra'); fs.mkdirSync(reports);
  const report = path.join(reports, '音乐.md');
  fs.writeFileSync(report, '---\napp: 音乐\nprocess: music.exe\n---\n# 经验\n操作后核验');
  const [app] = store.list();
  assert.equal(app.name, '音乐'); assert.equal(app.path, 'D:\\Music\\music.exe');
  assert.match(store.experience(app.id).markdown, /操作后核验/);
  store.removeApp(app.id);
  assert.equal(fs.existsSync(report), false);
  const restored = createComputerControlStore(dir);
  assert.equal(restored.list().length, 0); assert.throws(() => restored.experience(app.id), /不存在/);
});

test('history excludes discovered apps and failed calls, and resolves successful targets by PID', () => {
  const timeline = [
    { type: 'tool_call', callId: '1', name: 'yan_computer_list_apps', args: {} },
    { type: 'tool_result', callId: '1', name: 'yan_computer_list_apps', ok: true, output: { apps: [{ pid: 10, path: 'D:\\QQ\\QQ.exe', name: 'QQ' }] } },
    { type: 'tool_call', callId: '2', name: 'yan_computer_click', args: { pid: 10 } },
    { type: 'tool_result', callId: '2', name: 'yan_computer_click', ok: false },
  ];
  const session = { messages: [{ agentRun: { timeline } }] };
  assert.deepEqual(sessionApps(session), []);
  timeline.push({ type: 'tool_call', callId: '3', name: 'yan_computer_click', args: { pid: 10 } }, { type: 'tool_result', callId: '3', name: 'yan_computer_click', ok: true, completedAt: 50, output: '{}' });
  assert.deepEqual(sessionApps(session), [{ path: 'D:\\QQ\\QQ.exe', name: 'QQ', lastUsedAt: 50 }]);
});
test('EXE identity is case insensitive, path specific, and survives restart', t => {
  const { dir, store } = fixture(t);
  store.allow('C:\\Apps\\Editor.exe'); store.allow('c:\\apps\\EDITOR.EXE'); store.allow('D:\\Apps\\Editor.exe');
  store.update({ enabled: false });
  const restored = createComputerControlStore(dir);
  assert.equal(restored.settings().enabled, false); assert.equal(restored.settings().allowedApps.length, 2);
  assert.throws(() => store.allow('C:\\Apps\\script.cmd'));
  assert.throws(() => store.experience('../settings.json'));
});
test('deletion removes the app record and files, preserving permissions and other apps', t => {
  const { dir, store } = fixture(t);
  const a = store.record('C:\\Apps\\One.exe'), b = store.record('C:\\Apps\\Two.exe');
  store.allow(a.path); store.writeExperience(a.id, '# 经验\n使用菜单'); store.writeExperience(b.id, '# 其他经验');
  const owned = path.join(dir, 'computer-control/apps', a.id);
  fs.mkdirSync(path.join(owned, 'reviews')); fs.writeFileSync(path.join(owned, 'reviews/history.md'), 'old');
  store.removeApp(a.id);
  assert.throws(() => store.experience(a.id), /不存在/); assert.match(store.experience(b.id).markdown, /其他经验/);
  assert.equal(store.list().length, 1); assert.equal(store.settings().allowedApps.length, 1);
  assert.equal(fs.existsSync(owned), false);
});

test('review history appends instead of replacing the previous experience', t => {
  const { store } = fixture(t);
  const first = store.recordReview('C:\\Apps\\Music.exe', '# 第一次复盘\n打开搜索');
  store.recordReview(first.path, '## 第二次复盘\n先读取窗口状态');
  const markdown = store.experience(first.id).markdown;
  assert.match(markdown, /第一次复盘/);
  assert.match(markdown, /第二次复盘/);
  assert.match(markdown, /\n---\n/);
});

test('experience view combines legacy report with canonical reviews without copying legacy on every review', t => {
  const { dir, store } = fixture(t);
  const app = store.record('C:\\Apps\\LegacyMusic.exe', 'Legacy Music');
  const reports = path.join(dir, 'Computer-Use-Astra'); fs.mkdirSync(reports);
  fs.writeFileSync(path.join(reports, 'Legacy Music.md'), '# 历史操作\n\n先读取窗口状态');
  const appFile = path.join(dir, 'computer-control', 'apps', app.id, 'app.json');
  const saved = JSON.parse(fs.readFileSync(appFile, 'utf8')); saved.legacyReport = 'Legacy Music.md'; fs.writeFileSync(appFile, JSON.stringify(saved));
  store.writeExperience(app.id, '# 本次复盘\n\n验证播放状态');
  const combined = store.experience(app.id).markdown;
  assert.match(combined, /历史操作/); assert.match(combined, /本次复盘/);
  store.recordReview(app.path, '## 第二次复盘\n\n记录搜索路径');
  const afterReview = store.experience(app.id).markdown;
  assert.equal((afterReview.match(/历史操作/g) || []).length, 1);
  assert.match(afterReview, /第二次复盘/);
});

test('live disable blocks native requests and only successful targets enter history', async t => {
  const { dir, store } = fixture(t); let calls = 0, refused = false;
  const client = { start: async () => ['list_windows','click'].map(name => ({ name, inputSchema: { type: 'object', properties: {} } })), request: async () => { calls++; return { content: [], isError: refused }; }, close: async () => {} };
  const adapter = createComputerAdapter({ client, imageDir: dir, controlStore: store, resolveExecutable: async () => 'C:\\Apps\\Editor.exe' });
  await adapter.call(1, 'list_windows', { pid: 10 }); assert.equal(store.list().length, 0);
  refused = true; await adapter.call(2, 'click', { pid: 10 }); assert.equal(store.list().length, 0);
  refused = false; await adapter.call(3, 'click', { pid: 10 }); assert.equal(store.list().length, 1);
  store.update({ enabled: false }); await assert.rejects(adapter.call(4, 'click', { pid: 10 }), /已关闭/); assert.equal(calls, 3);
});
