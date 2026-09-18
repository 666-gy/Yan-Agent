'use strict';

// Read-only surface of the Harness MCP: list_entries / get_entry. In
// production the module runs as a stdio server; YAN_HARNESS_TEST_EXPORTS keeps
// the stdin loop off and exposes the pure functions for tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

delete process.env.YAN_HARNESS_CONTEXT_DIR;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-harness-read-'));
process.env.YAN_HARNESS_GLOBAL_STATE_PATH = path.join(root, 'global-harness.json');
process.env.YAN_HARNESS_TEST_EXPORTS = '1';
const mcp = require('../lib/yan-harness-mcp');
const { ContinualHarnessStore } = require('../lib/continual-harness');

const context = { runId: 'run-read', sessionId: 'sess-read', workspace: '' };

test('list_entries filters by status, kind, and query with usage counters', async () => {
  const store = new ContinualHarnessStore({ globalPath: process.env.YAN_HARNESS_GLOBAL_STATE_PATH });
  await store.apply({ edits: [
    {
      action: 'create', kind: 'memory', id: 'read-tool-memory', title: '读工具记忆',
      content: '列表工具要支持按关键字过滤，并在预览里返回内容。', path: 'harness', scope: 'global',
      metadata: { status: 'active' }
    },
    {
      action: 'create', kind: 'prompt', id: 'read-tool-observing', title: '尚未激活的候选',
      content: '这条候选处于 observing 状态，默认列表不应返回它。', path: 'policy', scope: 'global',
      metadata: { status: 'observing' }
    }
  ] }, { scope: 'global' });
  await store.recordUsage({
    entries: [{ kind: 'memory', id: 'read-tool-memory', scope: 'global' }],
    outcome: 'success',
    runId: 'run-read-1'
  }, { scope: 'global' });

  const active = mcp.listEntries(context, {});
  assert.equal(active.ok, true);
  assert.deepEqual(active.entries.map(entry => entry.id), ['read-tool-memory']);
  assert.equal(active.entries[0].usage.successes, 1);

  const inactive = mcp.listEntries(context, { include_inactive: true, kind: 'prompt' });
  assert.deepEqual(inactive.entries.map(entry => entry.id), ['read-tool-observing']);

  const query = mcp.listEntries(context, { query: '关键字' });
  assert.deepEqual(query.entries.map(entry => entry.id), ['read-tool-memory']);
  assert.deepEqual(mcp.listEntries(context, { query: '不存在的词' }).entries, []);
});

test('get_entry returns full content and validates kind and id', () => {
  const fetched = mcp.getEntry(context, { kind: 'memory', id: 'read-tool-memory' });
  assert.equal(fetched.ok, true);
  assert.equal(fetched.entry.content, '列表工具要支持按关键字过滤，并在预览里返回内容。');
  assert.equal(fetched.entry.status, 'active');
  assert.equal(mcp.getEntry(context, { kind: 'memory', id: 'missing-entry' }).entry, null);
  assert.throws(() => mcp.listEntries(context, { kind: 'unknown' }), /Unsupported harness kind/);
  assert.throws(() => mcp.getEntry(context, { kind: 'memory' }), /entry id is required/);
  assert.throws(() => mcp.getEntry(context, { kind: 'memory', id: 'x', scope: 'elsewhere' }), /scope must be/);
  assert.throws(() => mcp.listEntries(context, { scope: 'workspace' }), /active workspace/);
  assert.throws(() => mcp.getEntry(context, { kind: 'memory', id: 'read-tool-memory', scope: 'workspace' }), /active workspace/);
});

test('tool definitions expose the read tools with a strict schema', t => {
  const tools = mcp.toolDefinitions();
  assert.deepEqual(tools.map(tool => tool.name), [
    'schedule_refinement', 'list_entries', 'get_entry', 'delete_entry', 'get_refinement_status', 'schedule_rollback'
  ]);
  const list = tools.find(tool => tool.name === 'list_entries');
  assert.equal(list.inputSchema.additionalProperties, false);
  const get = tools.find(tool => tool.name === 'get_entry');
  assert.deepEqual(get.inputSchema.required, ['kind', 'id']);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
});
