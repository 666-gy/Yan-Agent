'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectStorageStats, subagentBytes } = require('../lib/storage-stats');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'YanData');
  fs.mkdirSync(dataDir);
  const write = (file, value) => {
    const target = path.join(dataDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
    return Buffer.byteLength(value);
  };
  return { root, dataDir, write };
}

test('real byte totals partition chats, embedded subagents, archives, malformed chats and other files', async t => {
  const { dataDir, write } = fixture(t);
  const child = [{ id: 'child', text: '中文与 emoji 🐈', subagents: [{ id: 'nested' }] }];
  const active = JSON.stringify({ id: 'active', messages: [{ content: '"subagents": [123]', agentRun: { subagents: child } }] });
  const archived = JSON.stringify({ id: 'archived', messages: [] });
  const activeBytes = write('sessions/active.json', active);
  const archivedBytes = write('sessions/archived.json', archived);
  const brokenBytes = write('sessions/broken.json', '{bad json');
  const wrongShapeBytes = write('sessions/wrong.json', '{}');
  const metaBytes = write('sessions/.archived', JSON.stringify({ archived: 1 }));
  const otherBytes = write('opencode-runtime/data/opencode/opencode.db', 'sqlite fixture');
  const result = await collectStorageStats({ dataDir });
  const childBytes = Buffer.byteLength(JSON.stringify(child));
  assert.deepEqual(result.categories, { chats: activeBytes - childBytes, subagents: childBytes, archivedChats: archivedBytes,
    unclassifiedChats: brokenBytes + wrongShapeBytes, worktrees: 0, other: metaBytes + otherBytes });
  assert.equal(result.totalBytes, activeBytes + archivedBytes + brokenBytes + wrongShapeBytes + metaBytes + otherBytes);
  assert.equal(result.partial, true);
  assert.equal(result.warningCount, 2);
});

test('subagent byte spans retain formatting and ignore tool input keys, empty arrays and quoted examples', () => {
  const source = JSON.stringify({ id: 's', subagents: ['ignore'], messages: [
    { content: '"subagents":[{}]', agentRun: { subagents: [{ text: '中文 ] \\"', messages: [] }],
      tool: { subagents: ['ignore'] } } }, { agentRun: { subagents: [] } }
  ] }, null, 2);
  const start = source.indexOf('[', source.indexOf('"subagents"', source.indexOf('"agentRun"')));
  const end = source.indexOf('\n        ]', start) + '\n        ]'.length;
  assert.equal(subagentBytes(source), Buffer.byteLength(source.slice(start, end)));
});

test('registered worktrees count once across duplicate and nested roots and data-directory overlap', async t => {
  const { root, dataDir, write } = fixture(t);
  const external = path.join(root, 'worktree');
  fs.mkdirSync(path.join(external, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(external, 'a'), '123');
  fs.writeFileSync(path.join(external, 'nested', 'b'), '45678');
  const internal = path.join(dataDir, 'worktrees', 'internal');
  write('worktrees/internal/a', '1234567');
  const registryBytes = write('managed-worktrees.json', JSON.stringify([
    { path: path.join(external, 'nested') }, { path: external }, { path: external }, { path: internal },
    { path: path.join(root, 'gone'), archived: true }, { path: path.join(root, 'missing') }
  ]));
  const result = await collectStorageStats({ dataDir });
  assert.equal(result.categories.worktrees, 15);
  assert.equal(result.categories.other, registryBytes);
  assert.equal(result.totalBytes, registryBytes + 15);
  assert.equal(result.worktreeRoots.length, 2);
  assert.equal(result.partial, false);
});

test('refresh detects additions and deletions, and corrupt metadata rejects rather than returning zero', async t => {
  const { dataDir, write } = fixture(t);
  assert.equal((await collectStorageStats({ dataDir })).totalBytes, 0);
  write('cache/test', '123456789');
  assert.equal((await collectStorageStats({ dataDir })).totalBytes, 9);
  fs.unlinkSync(path.join(dataDir, 'cache/test'));
  assert.equal((await collectStorageStats({ dataDir })).totalBytes, 0);
  write('managed-worktrees.json', 'broken');
  await assert.rejects(collectStorageStats({ dataDir }), /无法读取存储索引/);
});

test('junctions are skipped without loops or scanning external content; invalid parent roots are skipped', async t => {
  const { root, dataDir, write } = fixture(t);
  const external = path.join(root, 'external');
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, 'secret'), 'not owned');
  fs.symlinkSync(external, path.join(dataDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(dataDir, path.join(dataDir, 'recursive'), process.platform === 'win32' ? 'junction' : 'dir');
  const bytes = write('managed-worktrees.json', JSON.stringify([{ path: root }]));
  const result = await collectStorageStats({ dataDir });
  assert.equal(result.totalBytes, bytes);
  assert.equal(result.partial, true);
});
