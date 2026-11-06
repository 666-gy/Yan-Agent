'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { listProjectFiles, readProjectFile } = require('../lib/main/project-files');

test('video previews return a local URL instead of decoding binary as text', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-video-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'clip #1.mp4'), Buffer.from([0, 1, 2]));
  const file = await readProjectFile(root, 'clip #1.mp4');
  assert.equal(file.kind, 'video');
  assert.match(file.content, /^file:.*clip%20%231\.mp4\?v=/);
});

test('project files list hidden files, sort folders first, bound previews and reject escapes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-files-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'project'));
  const project = path.join(root, 'project');
  await fs.mkdir(path.join(project, 'src'));
  await fs.writeFile(path.join(project, '.env'), 'EXAMPLE=1');
  await fs.writeFile(path.join(project, 'hello.js'), 'const greeting = "你好";');
  await fs.writeFile(path.join(root, 'outside'), 'private');
  await fs.writeFile(path.join(project, 'binary'), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(project, 'large'), Buffer.alloc(2 * 1024 * 1024 + 1));
  const entries = await listProjectFiles(project, '');
  assert.equal(entries[0].name, 'src');
  assert.ok(entries.some(entry => entry.name === '.env'));
  assert.equal((await readProjectFile(project, 'hello.js')).content, 'const greeting = "你好";');
  assert.equal((await readProjectFile(project, 'binary')).kind, 'unsupported');
  assert.equal((await readProjectFile(project, 'large')).kind, 'unsupported');
  await assert.rejects(readProjectFile(project, '../outside'), /当前项目/);
  await fs.symlink(root, path.join(project, 'escape'), 'junction');
  await assert.rejects(listProjectFiles(project, 'escape'), /当前项目/);
  assert.ok(!(await listProjectFiles(project, '')).some(entry => entry.name === 'escape'));
});


test('250 MB boundary, bounded text pages and UTF-8 boundaries', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-files-limit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const handle = await fs.open(path.join(root, 'boundary.txt'), 'w');
  await handle.truncate(250 * 1024 * 1024);
  await handle.write(Buffer.alloc(256 * 1024, 97), 0, 256 * 1024, 0);
  await handle.close();
  const boundary = await readProjectFile(root, 'boundary.txt');
  assert.equal(boundary.kind, 'text');
  assert.equal(boundary.size, 250 * 1024 * 1024);
  assert.equal(boundary.hasMore, true);
  assert.ok(boundary.content.length <= 256 * 1024);
  await fs.truncate(path.join(root, 'boundary.txt'), 250 * 1024 * 1024 + 1);
  const oversized = await readProjectFile(root, 'boundary.txt');
  assert.equal(oversized.kind, 'unsupported');
  assert.match(oversized.message, /250 MB/);
  const original = 'a'.repeat(256 * 1024 - 1) + '你好🌍\n' + '行\n'.repeat(4500);
  await fs.writeFile(path.join(root, 'utf8.txt'), original);
  let offset = 0;
  let restored = '';
  let version;
  do {
    const page = await readProjectFile(root, 'utf8.txt', { offset, version });
    assert.equal(page.kind, 'text');
    assert.ok(page.nextOffset > offset);
    restored += page.content;
    offset = page.nextOffset;
    version = page.version;
    if (!page.hasMore) break;
  } while (true);
  assert.equal(restored, original);
  await fs.appendFile(path.join(root, 'utf8.txt'), 'changed');
  await assert.rejects(readProjectFile(root, 'utf8.txt', { offset, version }), /已更改/);
});

test('save as copies original bytes, supports cancellation and rejects escaped paths', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-files-save-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = Buffer.from([0, 1, 2, 255]);
  await fs.writeFile(path.join(root, 'source.bin'), source);
  const handlers = {};
  let canceled = false;
  let revealed;
  const owner = { isDestroyed: () => false, webContents: { id: 7 } };
  require('../lib/main/project-files').registerProjectFilesIpc({
    ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    windows: { getMainWindow: () => owner },
    shell: { showItemInFolder: target => { revealed = target; } },
    dialog: { showSaveDialog: async () => ({ canceled, filePath: path.join(root, 'copy.bin') }) }
  }, { readSessionRecord: async () => ({ id: 'test', workspace: root }) }, {});
  const action = payload => handlers['project-files:action']({ sender: { id: 7 } }, { sessionId: 'test', path: 'source.bin', ...payload });
  assert.equal((await action({ action: 'save' })).result.ok, true);
  assert.deepEqual(await fs.readFile(path.join(root, 'copy.bin')), source);
  canceled = true;
  assert.equal((await action({ action: 'save' })).result.canceled, true);
  await action({ action: 'explorer' });
  assert.equal(revealed, path.join(root, 'source.bin'));
  assert.equal((await action({ path: '../outside', action: 'save' })).ok, false);
  assert.equal((await handlers['project-files:action']({ sender: { id: 99 } }, { sessionId: 'test', path: 'source.bin', action: 'save' })).ok, false);
});


test('editing replaces only selected byte ranges and refuses external changes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-files-edit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'edit.txt');
  await fs.writeFile(target, 'before\r\n你好\r\nafter');
  const original = await readProjectFile(root, 'edit.txt');
  const { saveProjectEdits } = require('../lib/main/project-files');
  await saveProjectEdits(root, 'edit.txt', { version: original.version, edits: [{ offset: 8, end: 14, content: '世界' }] });
  assert.equal(await fs.readFile(target, 'utf8'), 'before\r\n世界\r\nafter');
  await assert.rejects(saveProjectEdits(root, 'edit.txt', { version: original.version, edits: [{ offset: 0, end: 1, content: 'x' }] }), /已更改/);
  const fresh = await readProjectFile(root, 'edit.txt');
  await assert.rejects(saveProjectEdits(root, 'edit.txt', { version: fresh.version, edits: [{ offset: 4, end: 5, content: 'x' }, { offset: 3, end: 6, content: 'y' }] }), /无效/);
  assert.equal(await fs.readFile(target, 'utf8'), 'before\r\n世界\r\nafter');
  assert.equal((await fs.readdir(root)).filter(name => name.endsWith('.tmp')).length, 0);
});


test('explicit local file roots remain scoped to the opening session and main window', async t => {
  const { registerProjectFilesIpc } = require('../lib/main/project-files');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-file-roots-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace);
  const target = path.join(root, 'external.md'); await fs.writeFile(target, '# external');
  const handlers = {};
  registerProjectFilesIpc({
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    windows: { getMainWindow: () => ({ isDestroyed: () => false, webContents: { id: 7 } }) }
  }, { readSessionRecord: async id => ({ id, workspace }) }, {});
  const event = { sender: { id: 7 } };
  const resolved = await handlers['project-files:resolve'](event, { sessionId: 'one', path: target });
  assert.equal(resolved.ok, true);
  assert.ok(resolved.rootToken);
  const payload = { sessionId: 'one', rootToken: resolved.rootToken, path: resolved.path };
  assert.equal((await handlers['project-files:read'](event, payload)).result.content, '# external');
  assert.equal((await handlers['project-files:read'](event, { ...payload, sessionId: 'two' })).ok, false);
  assert.equal((await handlers['project-files:read'](event, { ...payload, rootToken: 'unknown' })).ok, false);
  assert.equal((await handlers['project-files:resolve']({ sender: { id: 9 } }, { sessionId: 'one', path: target })).ok, false);
});
