'use strict';

// Yan Workspace MCP: git worktree lifecycle for parallel builder tasks plus a
// reverse-dependency impact probe. stdio JSON-RPC, same shape as the other
// yan-* MCP servers. The process is workspace-less until a tool call carries a
// task_id; the matching harness run context (written by the main process per
// run) authorizes the workspace, mirroring yan-analysis-mcp.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const worktrees = require('./worktree-service');
const { buildFileGraph, rankNodes, fileKey, listCodeFiles } = require('./analysis/repo-map');
const { sourceRevision } = require('./analysis/source-cache');

const CONTEXT_DIR = String(process.env.YAN_WORKSPACE_CONTEXT_DIR || '').trim();
const IMPACT_CACHE_TTL_MS = 5 * 60_000;
const IMPACT_MAX_DEPTH = 6;
const IMPACT_TOP_LIST = 12;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan Workspace MCP error') } });
}

function toolResult(id, result) {
  success(id, {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
    isError: result && result.ok === false
  });
}

function authorize(params, { requireWrite = false } = {}) {
  const taskId = String(params.task_id || '').trim();
  if (!CONTEXT_DIR || !taskId) throw new Error('Active task_id and workspace context are required.');
  const key = crypto.createHash('sha256').update(taskId).digest('hex');
  let context;
  try {
    context = JSON.parse(fs.readFileSync(path.join(CONTEXT_DIR, `${key}.json`), 'utf8'));
  } catch {
    throw new Error('No workspace context is registered for this task_id; use the task_id from the current <yan-turn-context>.');
  }
  if (context.runId !== taskId || !context.workspace) {
    throw new Error('Workspace context for this task is not available.');
  }
  if (requireWrite && context.allowFileWrite !== true) {
    throw new Error('File writing is not authorized for this task.');
  }
  const workspace = fs.realpathSync(context.workspace);
  for (const field of ['base']) {
    if (params[field] !== undefined && (typeof params[field] !== 'string' || params[field].includes('..'))) {
      throw new Error(`${field} must be a plain branch name or commit ref.`);
    }
  }
  return { workspace, taskId };
}

async function authorizePath(params, options) {
  const authorized = authorize(params, options);
  authorized.pathTargets = [];
  for (const field of ['path']) {
    if (params[field] === undefined) continue;
    if (typeof params[field] !== 'string' || !params[field].trim() || !path.isAbsolute(params[field])) {
      throw new Error(`${field} must be an absolute workspace path.`);
    }
    const resolved = fs.realpathSync(params[field]);
    const relative = path.relative(authorized.workspace, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`${field} is outside the authorized workspace.`);
    }
    authorized.pathTargets.push(resolved);
  }
  return authorized;
}

// ---- code_impact ----

const impactCache = new Map();

function impactGraph(workspace, refresh = false) {
  const key = fileKey(workspace);
  const files = listCodeFiles(workspace, { maxFiles: 3000 });
  const revision = sourceRevision(files) + ':' + files.coverage.truncated;
  const cached = impactCache.get(key);
  if (cached?.revision === revision && !refresh && Date.now() - cached.builtAt < IMPACT_CACHE_TTL_MS) return cached;
  const nodes = buildFileGraph(workspace, { maxFiles: 3000 });
  const rank = rankNodes(nodes);
  const reverse = new Map();
  for (const [key, node] of nodes) {
    for (const dependency of node.deps) {
      if (!reverse.has(dependency)) reverse.set(dependency, []);
      reverse.get(dependency).push(key);
    }
  }
  const entry = { nodes, rank, reverse, builtAt: Date.now(), revision };
  impactCache.set(key, entry);
  if (impactCache.size > 8) impactCache.delete(impactCache.keys().next().value);
  return entry;
}

function codeImpact(workspace, rawPaths, refresh) {
  const graph = impactGraph(workspace, refresh);
  const targets = [];
  for (const rawPath of rawPaths) {
    const key = fileKey(fs.realpathSync(rawPath));
    const node = graph.nodes.get(key);
    if (!node) {
      targets.push({ file: rawPath, ok: false, reason: 'not an indexed code file in this workspace' });
      continue;
    }
    const seen = new Set([key]);
    let frontier = [...(graph.reverse.get(key) || [])];
    const levels = [];
    for (let depth = 1; depth <= IMPACT_MAX_DEPTH && frontier.length; depth += 1) {
      const next = [];
      const level = [];
      for (const dependent of frontier) {
        if (seen.has(dependent)) continue;
        seen.add(dependent);
        level.push(dependent);
        next.push(...(graph.reverse.get(dependent) || []));
      }
      if (level.length) {
        level.sort((left, right) => graph.rank.get(right) - graph.rank.get(left));
        levels.push({ depth, files: level });
      }
      frontier = next;
    }
    const total = levels.reduce((sum, level) => sum + level.files.length, 0);
    const relative = path.relative(workspace, node.file).replace(/\\/g, '/');
    targets.push({
      ok: true,
      file: relative,
      symbols: node.symbols.map(symbol => symbol.name).slice(0, 8),
      directDependents: (levels[0]?.files || []).slice(0, IMPACT_TOP_LIST).map(file => path.relative(workspace, graph.nodes.get(file).file).replace(/\\/g, '/')),
      transitiveCount: total,
      levels: levels.map(level => ({ depth: level.depth, count: level.files.length, top: level.files.slice(0, 4).map(file => path.relative(workspace, graph.nodes.get(file).file).replace(/\\/g, '/')) }))
    });
  }
  const lines = ['Reverse-dependency impact (import graph; verify with reads or serena references before deleting/refactoring):'];
  if (graph.nodes.coverage.truncated) lines.push('Scan limit reached: this is a partial impact graph, not proof that no other dependents exist.');
  for (const target of targets) {
    if (!target.ok) {
      lines.push(`  ${target.file}: ${target.reason}`);
      continue;
    }
    lines.push(`  ${target.file} — ${target.directDependents.length} direct dependents shown, ${target.transitiveCount} total in impact cone`);
    for (const dependent of target.directDependents) lines.push(`    ← ${dependent}`);
    if (!target.directDependents.length) lines.push('    ← nothing imports this file directly');
  }
  return { ok: true, targets, text: lines.join('\n'), coverage: graph.nodes.coverage };
}

// ---- tool surface ----

function toolDefinitions() {
  return [
    {
      name: 'worktree_create',
      description: 'Create an isolated git worktree for one delegated task: <workspace>/.yanagent/worktrees/<name> on branch yan-task-<name>. Use one worktree per parallel builder task so they never edit the same checkout; pass the returned path to the builder in its task prompt, then merge with worktree_merge when it finishes.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Current task_id from <yan-turn-context>.' },
          name: { type: 'string', description: 'Short unique task id used in the path and branch (letters/digits/dots/dashes, ≤40 chars).' },
          base: { type: 'string', description: 'Optional base branch or commit; defaults to the current HEAD.' }
        },
        required: ['task_id', 'name'],
        additionalProperties: false
      }
    },
    {
      name: 'worktree_list',
      description: 'List Yan task worktrees in this workspace with their branches and HEADs.',
      inputSchema: {
        type: 'object',
        properties: { task_id: { type: 'string' } },
        required: ['task_id'],
        additionalProperties: false
      }
    },
    {
      name: 'worktree_status',
      description: 'Show one task worktree: branch, HEAD, and uncommitted files. Check this before merging or removing so builder work is not lost.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          name: { type: 'string' }
        },
        required: ['task_id', 'name'],
        additionalProperties: false
      }
    },
    {
      name: 'worktree_merge',
      description: 'Merge a finished task worktree branch back into the current branch of the main checkout (no-ff by default, or squash+commit). Refuses when the main tree has uncommitted changes; on conflicts it aborts the merge and returns the conflicting file list so you can resolve deliberately.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          name: { type: 'string' },
          message: { type: 'string', description: 'Merge/commit message.' },
          squash: { type: 'boolean', description: 'Squash the task branch into one commit instead of a merge commit.' }
        },
        required: ['task_id', 'name'],
        additionalProperties: false
      }
    },
    {
      name: 'worktree_remove',
      description: 'Remove a finished task worktree and delete its branch when fully merged. Refuses when the worktree still has uncommitted changes unless force is set; an unmerged yan-task branch is kept automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          name: { type: 'string' },
          force: { type: 'boolean', description: 'Discard uncommitted changes in the worktree.' }
        },
        required: ['task_id', 'name'],
        additionalProperties: false
      }
    },
    {
      name: 'code_impact',
      description: 'Reverse-dependency impact probe over the workspace import graph: which files import (directly or transitively) the given file. Run it BEFORE deleting, moving, or heavily refactoring a file, and before parallel edits that touch shared modules. Cheap and read-only; for symbol-level references use serena find_referencing_symbols or codegraph_explore.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Absolute file paths inside the workspace to probe.',
            minItems: 1,
            maxItems: 8
          },
          refresh: { type: 'boolean', description: 'Rebuild the import graph before answering.' }
        },
        required: ['task_id', 'paths'],
        additionalProperties: false
      }
    }
  ];
}

async function callTool(request) {
  const name = String(request.params?.name || '');
  const input = request.params?.arguments && typeof request.params.arguments === 'object'
    ? request.params.arguments
    : {};
  try {
    let result;
    switch (name) {
      case 'worktree_create': {
        const { workspace } = authorize(input, { requireWrite: true });
        result = { ok: true, ...(await worktrees.createTaskWorktree(workspace, { taskId: input.name, base: input.base })) };
        break;
      }
      case 'worktree_list': {
        const { workspace } = authorize(input);
        result = { ok: true, worktrees: await worktrees.listTaskWorktrees(workspace) };
        break;
      }
      case 'worktree_status': {
        const { workspace } = authorize(input);
        result = { ok: true, ...(await worktrees.taskWorktreeStatus(workspace, { taskId: input.name })) };
        break;
      }
      case 'worktree_merge': {
        const { workspace } = authorize(input, { requireWrite: true });
        result = { ...(await worktrees.mergeTaskWorktree(workspace, { taskId: input.name, message: input.message, squash: !!input.squash })) };
        result.ok = result.merged === true;
        break;
      }
      case 'worktree_remove': {
        const { workspace } = authorize(input, { requireWrite: true });
        result = { ...(await worktrees.removeTaskWorktree(workspace, { taskId: input.name, force: !!input.force })) };
        result.ok = result.removed === true;
        break;
      }
      case 'code_impact': {
        const { workspace, pathTargets } = await authorizePath(input, {});
        const paths = Array.isArray(input.paths) ? input.paths : [];
        for (const candidate of paths) {
          if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
            throw new Error('paths entries must be absolute workspace paths.');
          }
          const resolved = fs.realpathSync(candidate);
          const relative = path.relative(workspace, resolved);
          if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            throw new Error('paths entries must stay inside the authorized workspace.');
          }
          pathTargets.push(resolved);
        }
        result = codeImpact(workspace, pathTargets, !!input.refresh);
        break;
      }
      default:
        throw new Error(`Unknown Yan workspace tool: ${name}`);
    }
    toolResult(request.id, result);
  } catch (error) {
    toolResult(request.id, { ok: false, error: error?.message || String(error), code: error?.code || 'YAN_WORKSPACE_TOOL_FAILED' });
  }
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'initialize') {
    success(message.id, {
      protocolVersion: String(message.params?.protocolVersion || '2025-03-26'),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Yan Workspace', version: '1.0.0' }
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
    await callTool(message);
    return;
  }
  if (message.id !== undefined) failure(message.id, -32601, `Unsupported method: ${message.method}`);
}

let buffered = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffered += String(chunk || '');
  while (true) {
    const newline = buffered.indexOf('\n');
    if (newline < 0) break;
    const line = buffered.slice(0, newline).trim();
    buffered = buffered.slice(newline + 1);
    if (!line) continue;
    try {
      void handle(JSON.parse(line));
    } catch (error) {
      failure(null, -32700, error?.message || String(error));
    }
  }
});
