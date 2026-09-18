'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..', 'lib', 'yan-analysis-mcp.js');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yan-analysis-mcp-'));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function startServer(env = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  const pending = new Map();
  let buffer = '';
  let nextId = 1;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const resolver = pending.get(message.id);
      if (resolver) {
        pending.delete(message.id);
        resolver(message);
      }
    }
  });
  const request = (method, params) => {
    console.error('[REQ]', method, params?.name || '');
    return new Promise(resolve => {
    if (method === 'tools/call') params = { ...params, arguments: { task_id: 'test-task', ...params.arguments } };
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  };
  return { child, request, async stop() { child.kill(); } };
}

test('yan analysis mcp answers initialize, tool list and every tool call', async t => {
  const workspace = makeTempRoot();
  const notes = makeTempRoot();
  const contextPath = path.join(notes, `${crypto.createHash('sha256').update('test-task').digest('hex')}.json`);
  write(contextPath, JSON.stringify({ runId: 'test-task', workspace, allowFileRead: true }));
  const workspaceNotes = path.join(workspace, 'notes');
  t.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(notes, { recursive: true, force: true });
  });

  write(path.join(workspace, 'src', 'core.js'), 'export function core() { return 1; }\nexport function coreTwo() { return 2; }\n');
  write(path.join(workspace, 'src', 'net.js'), 'export function encode(frame) {\n  return frame.length;\n}\n');
  write(path.join(workspace, 'src', 'app.js'), 'import { core } from "./core.js";\nimport { encode } from "./net.js";\n\nexport function boot() {\n  const size = core();\n  return encode(size);\n}\n');
  write(path.join(workspaceNotes, 'protocol-notes.md'), '# 分析笔记\n\n之前已经推断过协议状态机：握手后进入 auth 状态。');

  const server = startServer({
    YAN_ANALYSIS_CONTEXT_DIR: notes
  });
  t.after(() => server.stop());

  const init = await server.request('initialize', { protocolVersion: '2025-03-26' });
  assert.equal(init.result.serverInfo.name, 'Yan Analysis');

  const list = await server.request('tools/list', {});
  const names = list.result.tools.map(tool => tool.name).sort();
  assert.deepEqual(names, [
    'calltree', 'code_outline', 'code_search', 'code_symbol',
    'crc_probe', 'ghidra_decompile', 'ghidra_status', 'hex_diff', 'hex_dump',
    'hex_stats', 'history_search', 'pcap_overview', 'repo_map', 'slice'
  ].sort());

  const map = await server.request('tools/call', { name: 'repo_map', arguments: { root: workspace, budget_tokens: 400 } });
  const mapResult = map.result.structuredContent;
  assert.equal(mapResult.ok, true);
  assert.ok(mapResult.text.includes('src/core.js'));
  assert.ok(mapResult.text.includes('core, coreTwo'));

  const outline = await server.request('tools/call', { name: 'code_outline', arguments: { path: path.join(workspace, 'src', 'app.js') } });
  const outlineResult = outline.result.structuredContent;
  assert.equal(outlineResult.ok, true);
  assert.ok(outlineResult.symbols.some(symbol => symbol.name === 'boot'));

  const symbol = await server.request('tools/call', { name: 'code_symbol', arguments: { path: path.join(workspace, 'src', 'core.js'), name: 'coreTwo' } });
  const symbolResult = symbol.result.structuredContent;
  assert.equal(symbolResult.ok, true);
  assert.equal(symbolResult.line, 2);
  assert.match(symbolResult.content, /return 2;/);

  const tree = await server.request('tools/call', { name: 'calltree', arguments: { root: workspace, symbol: 'boot' } });
  const treeResult = tree.result.structuredContent;
  assert.equal(treeResult.ok, true);
  assert.match(treeResult.text, /encode/);

  const search = await server.request('tools/call', { name: 'code_search', arguments: { root: workspace, query: 'core return' } });
  const searchResult = search.result.structuredContent;
  assert.equal(searchResult.ok, true);
  assert.ok(searchResult.hits.length >= 1);
  assert.match(searchResult.hits[0].meta.path, /src[/\\]core\.js$/);

  const history = await server.request('tools/call', { name: 'history_search', arguments: { query: '协议状态机', notes_dir: workspaceNotes } });
  const historyResult = history.result.structuredContent;
  assert.equal(historyResult.ok, true);
  assert.equal(historyResult.scanned, 1);
  assert.match(historyResult.hits[0].meta.path, /protocol-notes\.md$/);

  // Round-2 protocol tooling: statistics, differential diff, checksum probe.
  write(path.join(workspace, 'lab', 'sample-a.bin'), Buffer.from([0xaa, 0x01, 0x10, 0xbb, 0xaa, 0x02, 0x20, 0xcc]));
  write(path.join(workspace, 'lab', 'sample-b.bin'), Buffer.from([0xaa, 0x09, 0x10, 0xc3, 0xaa, 0x02, 0x20, 0xcc]));
  const hexStats = await server.request('tools/call', { name: 'hex_stats', arguments: { path: path.join(workspace, 'lab', 'sample-a.bin'), record_length: 4 } });
  const statsResult = hexStats.result.structuredContent;
  assert.equal(statsResult.ok, true);
  assert.equal(statsResult.stride, 4);
  assert.equal(statsResult.stats[0].classification, 'constant');
  assert.equal(statsResult.stats[3].classification, 'varying');
  const inferred = await server.request('tools/call', { name: 'hex_stats', arguments: { path: path.join(workspace, 'lab', 'sample-a.bin') } });
  assert.equal(inferred.result.structuredContent.stride, 4);
  const hexDiff = await server.request('tools/call', { name: 'hex_diff', arguments: { left_path: path.join(workspace, 'lab', 'sample-a.bin'), right_path: path.join(workspace, 'lab', 'sample-b.bin') } });
  const diffResult = hexDiff.result.structuredContent;
  assert.equal(diffResult.changed, 2);
  assert.equal(diffResult.firstDivergence, 1);
  assert.deepEqual(diffResult.changes[0], { offset: 1, left: '0x01', right: '0x09' });
  const crcProbe = await server.request('tools/call', { name: 'crc_probe', arguments: { path: path.join(workspace, 'lab', 'sample-a.bin'), record_length: 4, trailer_bytes: 1 } });
  const crcResult = crcProbe.result.structuredContent;
  assert.equal(crcResult.ok, true);
  assert.ok(crcResult.candidates.some(candidate => candidate.algorithm === 'sum8'), JSON.stringify(crcResult.candidates));
  const slice = await server.request('tools/call', { name: 'slice', arguments: { path: path.join(workspace, 'src', 'app.js'), symbol: 'boot', variable: 'size' } });
  const sliceResult = slice.result.structuredContent;
  assert.equal(sliceResult.ok, true);
  assert.ok(sliceResult.lines.some(entry => entry.line === 5 && entry.text.includes('const size')));
  const ghidraStatus = await server.request('tools/call', { name: 'ghidra_status', arguments: {} });
  const ghidraResult = ghidraStatus.result.structuredContent;
  // Environment-dependent: Ghidra may or may not be installed on this machine.
  assert.equal(typeof ghidraResult.ok, 'boolean');
  assert.ok(ghidraResult.headless || ghidraResult.hint, 'either found or an installation hint');

  const missing = await server.request('tools/call', { name: 'code_symbol', arguments: { path: path.join(workspace, 'src', 'core.js'), name: 'nope' } });
  assert.equal(missing.result.structuredContent.ok, false);
  for (const args of [
    { task_id: '' },
    { task_id: 'expired-task' },
    { path: contextPath },
    { path: path.join(workspace, '..', path.basename(notes), path.basename(contextPath)) }
  ]) {
    const denied = await server.request('tools/call', { name: 'code_outline', arguments: { path: path.join(workspace, 'src', 'app.js'), ...args } });
    assert.equal(denied.result.structuredContent.ok, false);
  }
  const link = path.join(workspace, 'outside');
  fs.symlinkSync(notes, link, process.platform === 'win32' ? 'junction' : 'dir');
  for (const field of ['left_path', 'right_path']) {
    for (const outside of [contextPath, path.join(link, path.basename(contextPath))]) {
      const denied = await server.request('tools/call', { name: 'hex_diff', arguments: {
        left_path: path.join(workspace, 'lab', 'sample-a.bin'),
        right_path: path.join(workspace, 'lab', 'sample-b.bin'),
        [field]: outside
      } });
      assert.equal(denied.result.structuredContent.ok, false);
      assert.match(denied.result.structuredContent.error, /outside the authorized workspace/);
    }
  }
  const linked = await server.request('tools/call', { name: 'repo_map', arguments: { root: link } });
  assert.equal(linked.result.structuredContent.ok, false);
  const outsideHistory = await server.request('tools/call', { name: 'history_search', arguments: { query: 'task', notes_dir: notes } });
  assert.equal(outsideHistory.result.structuredContent.ok, false);
  write(contextPath, JSON.stringify({ runId: 'test-task', workspace, allowFileRead: false }));
  const revoked = await server.request('tools/call', { name: 'repo_map', arguments: { root: workspace } });
  assert.equal(revoked.result.structuredContent.ok, false);
  write(contextPath, JSON.stringify({ runId: 'test-task', workspace: notes, allowFileRead: true }));
  const otherWorkspace = await server.request('tools/call', { name: 'repo_map', arguments: { root: workspace } });
  assert.equal(otherWorkspace.result.structuredContent.ok, false);
  write(contextPath, JSON.stringify({ runId: 'test-task', workspace: '', allowFileRead: true }));
  const blank = await server.request('tools/call', { name: 'repo_map', arguments: { root: workspace } });
  assert.equal(blank.result.structuredContent.ok, false);
  fs.unlinkSync(contextPath);
  const expired = await server.request('tools/call', { name: 'repo_map', arguments: { root: workspace } });
  assert.equal(expired.result.structuredContent.ok, false);
});
