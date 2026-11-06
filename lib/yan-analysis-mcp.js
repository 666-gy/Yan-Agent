'use strict';

// Yan Analysis MCP: deterministic code-comprehension tools for workspace tasks.
//   repo_map      - PageRank-ranked whole-repo skeleton inside a token budget
//   code_outline  - symbol outline of one file (JS/TS, Python, brace family)
//   code_symbol   - one symbol's exact line range + content
//   calltree      - transitive JS/TS call tree with noise pruning
//   code_search   - BM25 over workspace text/code files (CJK-aware)
//   history_search- BM25 over analysis notes / harness history dirs
// All tools are read-only. stdio JSON-RPC, same shape as yan-harness-mcp.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractOutlineEx, findSymbol } = require('./analysis/outline');
const { buildRepoMap } = require('./analysis/repo-map');
const { getCachedIndex, queryCallTree } = require('./analysis/calltree');
const { createBm25Index } = require('./analysis/bm25');
const { backwardSlice } = require('./analysis/dataflow');

const MAX_SYMBOL_CONTENT_LINES = 600;
const SEARCH_MAX_FILE_BYTES = 300 * 1024;
const CONTEXT_DIR = String(process.env.YAN_ANALYSIS_CONTEXT_DIR || '').trim();

function authorize(params) {
  const taskId = String(params.task_id || '').trim();
  if (!CONTEXT_DIR || !taskId) throw new Error('Active task_id and analysis context are required.');
  const key = crypto.createHash('sha256').update(taskId).digest('hex');
  const context = JSON.parse(fs.readFileSync(path.join(CONTEXT_DIR, `${key}.json`), 'utf8'));
  if (context.runId !== taskId || context.allowFileRead !== true || !context.workspace) {
    throw new Error('File reading is not authorized for this task.');
  }
  const workspace = fs.realpathSync(context.workspace);
  const checked = { ...params };
  const defaultNotes = path.join(workspace, '.yanagent', 'notes');
  if (checked.notes_dir === undefined && fs.existsSync(defaultNotes)) checked.notes_dir = defaultNotes;
  for (const field of ['root', 'path', 'notes_dir']) {
    if (checked[field] === undefined) continue;
    if (typeof checked[field] !== 'string' || !checked[field].trim() || !path.isAbsolute(checked[field])) {
      throw new Error(`${field} must be an absolute workspace path.`);
    }
    const resolved = fs.realpathSync(checked[field]);
    const relative = path.relative(workspace, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`${field} is outside the authorized workspace.`);
    }
    checked[field] = resolved;
  }
  return checked;
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan Analysis MCP error') } });
}

function toolResult(id, result) {
  success(id, {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
    isError: false
  });
}

function resolveRoot(value) {
  const root = path.resolve(String(value || '').trim());
  if (!root) throw new Error('root (workspace absolute path) is required.');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`root is not a directory: ${root}`);
  }
  return root;
}

function readSource(filePath) {
  const resolved = path.resolve(String(filePath || '').trim());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`file not found: ${resolved}`);
  }
  return { resolved, source: fs.readFileSync(resolved, 'utf8') };
}

function toolDefinitions() {
  return [
    {
      name: 'repo_map',
      description: 'Ranked skeleton of a whole repository: files ordered by structural importance (import graph PageRank) with their top symbols, clipped to a token budget. Start every large-repo orientation here instead of listing directories.',
      inputSchema: {
        type: 'object',
        properties: {
          root: { type: 'string', description: 'Workspace absolute path.' },
          budget_tokens: { type: 'number', description: 'Max map size in tokens (200–16000, default 1200).' },
          max_files: { type: 'integer', minimum: 1, maximum: 20000, description: 'Scan cap (default 3000). For larger repositories narrow root to a package or raise this cap; inspect coverage.truncated.' }
        },
        required: ['root']
      }
    },
    {
      name: 'code_outline',
      description: 'Symbol outline of one file (name, kind, line range). Use it instead of reading a whole large file.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute file path.' } },
        required: ['path']
      }
    },
    {
      name: 'code_symbol',
      description: 'Read exactly one symbol (function/class/method) by name: its line range and source content, without loading the rest of the file.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          name: { type: 'string', description: 'Symbol name; Class.method accepted.' },
          occurrence: { type: 'number', description: '1-based match index when several symbols share the name.' }
        },
        required: ['path', 'name']
      }
    },
    {
      name: 'calltree',
      description: 'Transitive JS/TS call tree of a symbol with noise pruning (getters/setters/private helpers) and cycle guards. Approximate at the structure level: unresolved callees are marked [unresolved].',
      inputSchema: {
        type: 'object',
        properties: {
          max_files: { type: 'integer', minimum: 1, maximum: 20000, description: 'JS/TS scan cap (default 1500). Narrow root or raise the cap if coverage.truncated.' },
          root: { type: 'string' },
          symbol: { type: 'string', description: 'Function or method name.' },
          depth: { type: 'number', description: 'Max depth (default 4).' },
          max_nodes: { type: 'number', description: 'Max rendered nodes (default 300).' }
        },
        required: ['root', 'symbol']
      }
    },
    {
      name: 'code_search',
      description: 'BM25 ranking over the workspace text/code files. CJK-aware. Better than grep for "where is X handled" style queries; worse for exact identifiers - use grep for those.',
      inputSchema: {
        type: 'object',
        properties: {
          root: { type: 'string' },
          query: { type: 'string' },
          limit: { type: 'number', description: 'Max hits (default 8).' }
        },
        required: ['root', 'query']
      }
    },
    {
      name: 'history_search',
      description: 'BM25 over current-workspace analysis notes. Defaults to <workspace>/.yanagent/notes; notes_dir must remain in the authorized workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
          notes_dir: { type: 'string', description: 'Optional extra directory of notes (e.g. <workspace>/.yanagent/notes) to include in the index.' }
        },
        required: ['query']
      }
    },
    {
      name: 'slice',
      description: 'Statement-level backward slice of a variable inside one JS/TS symbol: every line that transitively feeds the value, tagged anchor/assign/seed. Structure-level approximation - the fast way to see which lines matter before deep-reading an algorithm.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          symbol: { type: 'string', description: 'Function/method name containing the variable.' },
          variable: { type: 'string' }
        },
        required: ['path', 'symbol', 'variable']
      }
    }
  ].map(tool => ({ ...tool, inputSchema: {
    ...tool.inputSchema,
    properties: { ...tool.inputSchema.properties, task_id: { type: 'string', description: 'Exact task_id from the latest yan-turn-context. Required for workspace authorization.' } },
    required: [...(tool.inputSchema.required || []), 'task_id']
  } }));
}

function callRepoMap(id, params) {
  const root = resolveRoot(params.root);
  const result = buildRepoMap(root, { budgetTokens: Math.max(200, Math.min(16000, Number(params.budget_tokens) || 1200)), maxFiles: params.max_files });
  toolResult(id, { ok: true, ...result });
}

async function callCodeOutline(id, params) {
  const { resolved, source } = readSource(params.path);
  const outline = await extractOutlineEx(resolved, source);
  toolResult(id, {
    ok: true,
    path: resolved,
    language: outline.language,
    backend: outline.backend || 'line',
    symbols: outline.symbols,
    truncated: outline.symbols.length >= 400
  });
}

async function callCodeSymbol(id, params) {
  const { resolved, source } = readSource(params.path);
  const outline = await extractOutlineEx(resolved, source);
  const symbol = findSymbol(outline.symbols, params.name, Number(params.occurrence) || 1);
  if (!symbol) {
    toolResult(id, { ok: false, error: `symbol not found: ${params.name}`, path: resolved, language: outline.language });
    return;
  }
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const content = lines.slice(symbol.line - 1, Math.min(symbol.endLine, symbol.line - 1 + MAX_SYMBOL_CONTENT_LINES)).join('\n');
  toolResult(id, {
    ok: true,
    path: resolved,
    backend: outline.backend || 'line',
    name: symbol.name,
    kind: symbol.kind,
    line: symbol.line,
    endLine: symbol.endLine,
    truncated: symbol.endLine - symbol.line + 1 > MAX_SYMBOL_CONTENT_LINES,
    content
  });
}

function callCallTree(id, params) {
  const root = resolveRoot(params.root);
  const index = getCachedIndex(root, { maxFiles: params.max_files });
  const result = queryCallTree(index, params.symbol, {
    depth: Math.max(1, Math.min(8, Number(params.depth) || 4)),
    maxNodes: Math.max(20, Math.min(2000, Number(params.max_nodes) || 300))
  });
  toolResult(id, { ok: result.nodes > 0, ...result, coverage: index.coverage });
}

function collectTextFiles(root, { maxFiles = 2000 } = {}) {
  const files = [];
  const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '__pycache__', '.yanagent', '.codegraph', '.ua', '.pets', 'vendor', '.cache']);
  const extensions = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.md', '.json', '.txt', '.yaml', '.yml', '.html', '.css', '.go', '.rs', '.java', '.cs', '.c', '.cpp', '.h']);
  const queue = [root];
  while (queue.length && files.length < maxFiles) {
    const directory = queue.shift();
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name) && !entry.name.startsWith('.')) queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!extensions.has(extension)) continue;
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (!stat.isFile() || stat.size === 0 || stat.size > SEARCH_MAX_FILE_BYTES) continue;
      files.push(full);
    }
  }
  return files;
}

function searchWorkspace(root, query, limit) {
  const index = createBm25Index();
  const files = collectTextFiles(resolveRoot(root));
  for (const file of files) {
    try {
      index.add(path.normalize(file).toLowerCase(), `${path.basename(file)}\n${fs.readFileSync(file, 'utf8')}`, { path: file, title: path.basename(file) });
    } catch {}
  }
  return { hits: index.search(query, { limit }), scanned: files.length };
}

function searchHistory(query, limit, extraDirs = []) {
  const index = createBm25Index();
  let scanned = 0;
  const dirs = extraDirs.map(dir => String(dir || '').trim()).filter(Boolean);
  for (const dir of dirs) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/\.(md|json|jsonl|txt)$/i.test(entry.name)) continue;
      const full = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(full);
        if (stat.size > SEARCH_MAX_FILE_BYTES) continue;
        index.add(full.toLowerCase(), `${entry.name}\n${fs.readFileSync(full, 'utf8')}`, { path: full, title: entry.name });
        scanned += 1;
      } catch {}
    }
  }
  return { hits: index.search(query, { limit }), scanned };
}

async function callTool(message) {
  const id = message.id;
  const name = String(message.params?.name || '');
  const params = authorize(message.params?.arguments || {});
  if (name === 'repo_map') return callRepoMap(id, params);
  if (name === 'code_outline') return callCodeOutline(id, params);
  if (name === 'code_symbol') return callCodeSymbol(id, params);
  if (name === 'calltree') return callCallTree(id, params);
  if (name === 'code_search') {
    const result = searchWorkspace(params.root, String(params.query || ''), Math.max(1, Math.min(25, Number(params.limit) || 8)));
    return toolResult(id, { ok: result.hits.length > 0, query: params.query, ...result });
  }
  if (name === 'history_search') {
    const extraDirs = Array.isArray(params.notes_dir) ? params.notes_dir : [params.notes_dir];
    const result = searchHistory(String(params.query || ''), Math.max(1, Math.min(25, Number(params.limit) || 8)), extraDirs);
    return toolResult(id, { ok: result.hits.length > 0, query: params.query, ...result });
  }
  if (name === 'slice') {
    const { resolved, source } = readSource(params.path);
    const outline = await extractOutlineEx(resolved, source);
    const symbol = findSymbol(outline.symbols, params.symbol, Number(params.occurrence) || 1);
    if (!symbol) return toolResult(id, { ok: false, error: `symbol not found: ${params.symbol}`, path: resolved });
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const result = backwardSlice(lines, symbol.line, symbol.endLine, params.variable);
    return toolResult(id, {
      ok: result.lines.length > 0,
      path: resolved,
      symbol: symbol.name,
      line: symbol.line,
      endLine: symbol.endLine,
      variable: String(params.variable || ''),
      ...result
    });
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return;
  if (message.method === 'initialize') {
    success(message.id, {
      protocolVersion: String(message.params?.protocolVersion || '2025-03-26'),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Yan Analysis', version: '1.1.0' }
    });
    return;
  }
  if (message.method === 'ping') {
    success(message.id, {});
    return;
  }
  if (message.method === 'tools/list') {
    success(message.id, { tools: toolDefinitions() });
    return;
  }
  if (message.method === 'tools/call') {
    try { await callTool(message); }
    catch (error) {
      const result = { ok: false, error: error?.message || String(error) };
      toolResult(message.id, result);
    }
    return;
  }
  if (message.id !== undefined) failure(message.id, -32601, `Unsupported method: ${message.method}`);
}

let buffered = '';
if (process.env.YAN_MCP_CATALOG_ONLY === '1') require('./mcp-tool-catalog').emitCatalog(toolDefinitions);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffered += String(chunk || '');
  while (true) {
    const newline = buffered.indexOf('\n');
    if (newline < 0) break;
    const line = buffered.slice(0, newline).trim();
    buffered = buffered.slice(newline + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); }
    catch (error) { failure(null, -32700, error?.message || String(error)); }
  }
});
process.stdin.on('end', () => process.exit(0));
