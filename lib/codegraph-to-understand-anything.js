const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const INCLUDED_KINDS = new Set([
  'file',
  'function',
  'method',
  'class',
  'struct',
  'namespace',
  'interface'
]);

const TYPE_BY_KIND = Object.freeze({
  file: 'file',
  function: 'function',
  method: 'function',
  class: 'class',
  struct: 'class',
  interface: 'class',
  namespace: 'module'
});

// Converted graphs are Yan runtime output, not project files: they belong to
// the workspace-local .yanagent directory so the project tree stays clean.
const UA_OUTPUT_DIR_PARTS = Object.freeze(['.yanagent', 'ua']);

function understandAnythingOutputDir(root, outputDir = '') {
  const explicit = String(outputDir || '').trim();
  if (explicit) return path.resolve(explicit);
  return path.join(path.resolve(String(root || '')), ...UA_OUTPUT_DIR_PARTS);
}

const EDGE_TYPE_BY_KIND = Object.freeze({
  calls: 'calls',
  contains: 'contains',
  imports: 'imports',
  references: 'depends_on',
  instantiates: 'depends_on'
});

function normalizeRelativePath(workspace, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(workspace, raw);
  const relative = path.relative(workspace, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return path.basename(raw);
  }
  return relative.split(path.sep).join('/');
}

function complexityFor(node) {
  const lines = Math.max(1, Number(node.end_line || 0) - Number(node.start_line || 0) + 1);
  if (lines <= 20) return 'simple';
  if (lines <= 100) return 'moderate';
  return 'complex';
}

function shortSummary(node, filePath) {
  const doc = String(node.docstring || '').replace(/\s+/g, ' ').trim();
  if (doc) return doc.slice(0, 280);
  if (node.kind === 'file') return `代码文件：${filePath}`;
  const signature = String(node.signature || '').replace(/\s+/g, ' ').trim();
  if (signature) return signature.slice(0, 280);
  const kind = TYPE_BY_KIND[node.kind] || node.kind;
  return `${kind} ${node.name || node.qualified_name || '未命名符号'}`;
}

function tagsFor(node, filePath) {
  const tags = [TYPE_BY_KIND[node.kind] || node.kind];
  if (node.language) tags.push(String(node.language).toLowerCase());
  if (node.visibility) tags.push(String(node.visibility).toLowerCase());
  if (Number(node.is_exported)) tags.push('exported');
  const top = filePath.split('/')[0];
  if (top && top !== filePath) tags.push(top);
  return [...new Set(tags)].slice(0, 6);
}

function inferFrameworks(workspace) {
  const frameworks = new Set();
  const packageFiles = ['package.json', 'requirements.txt', 'pyproject.toml'];
  const packageJson = path.join(workspace, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (Object.keys(deps).some(name => /^react(?:-|$)/i.test(name))) frameworks.add('React');
    if (Object.keys(deps).some(name => /^(?:express|fastify|koa)(?:-|$)/i.test(name))) frameworks.add('Node.js');
    if (Object.keys(deps).some(name => /^electron(?:-|$)/i.test(name))) frameworks.add('Electron');
    if (Object.keys(deps).some(name => /^(?:vite|webpack|rollup)(?:-|$)/i.test(name))) frameworks.add('Web tooling');
  } catch {}
  try {
    const pyproject = fs.readFileSync(path.join(workspace, 'pyproject.toml'), 'utf8');
    if (/django|fastapi|flask/i.test(pyproject)) frameworks.add('Python web');
  } catch {}
  for (const file of packageFiles) {
    if (file !== 'package.json' && fs.existsSync(path.join(workspace, file))) frameworks.add('Python');
  }
  return [...frameworks];
}

function gitCommitHash(workspace) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8', windowsHide: true });
  if (result.status === 0) {
    const hash = String(result.stdout || '').trim();
    if (/^[0-9a-f]{40}$/i.test(hash)) return hash;
  }
  return '0000000000000000000000000000000000000000';
}

function layerFor(filePath) {
  const first = String(filePath || '').split('/')[0];
  return first || 'Root';
}

function describeLayer(name) {
  if (name === 'Root') return 'Workspace root files';
  return `Top-level ${name} directory`;
}

function buildTour(nodes, edgeCounts) {
  const candidates = nodes
    .filter(node => node.type === 'file')
    .map(node => ({ node, score: edgeCounts.get(node.id) || 0 }))
    .sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name))
    .slice(0, 8);
  return candidates.map(({ node }, index) => ({
    order: index + 1,
    title: `Explore ${node.name}`,
    description: `查看文件 ${node.name} 及其直接关系。`,
    nodeIds: [node.id]
  }));
}

function openDatabase(databasePath) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (error) {
    throw new Error(`CodeGraph 转换器需要自带 Node 的 node:sqlite：${error.message}`);
  }
  return new DatabaseSync(databasePath, { readOnly: true });
}

function convertCodeGraph({ workspace, databasePath, outputDir } = {}) {
  const root = path.resolve(String(workspace || ''));
  const dbPath = path.resolve(databasePath || path.join(root, '.codegraph', 'codegraph.db'));
  const out = understandAnythingOutputDir(root, outputDir);
  if (!fs.existsSync(dbPath)) throw new Error(`CodeGraph 数据库不存在：${dbPath}`);
  fs.mkdirSync(out, { recursive: true });

  const db = openDatabase(dbPath);
  const rows = db.prepare('SELECT * FROM nodes').all();
  const edgeRows = db.prepare('SELECT source, target, kind, metadata, line, col, provenance FROM edges').all();
  const fileRows = db.prepare('SELECT path, language FROM files').all();
  const selectedRows = rows
    .filter(row => INCLUDED_KINDS.has(row.kind))
    .map(row => ({ ...row, filePath: normalizeRelativePath(root, row.file_path) }))
    .filter(row => row.filePath)
    .sort((a, b) => a.filePath.localeCompare(b.filePath) || Number(a.start_line || 0) - Number(b.start_line || 0) || String(a.name).localeCompare(String(b.name)));

  const idByCodeGraphId = new Map();
  const nodes = selectedRows.map((row, index) => {
    const id = `cg-${index}`;
    idByCodeGraphId.set(row.id, id);
    const type = TYPE_BY_KIND[row.kind] || 'module';
    const name = row.kind === 'file' ? row.filePath : String(row.name || row.qualified_name || 'Unnamed');
    return {
      id,
      type,
      name,
      filePath: row.filePath,
      summary: shortSummary(row, row.filePath),
      tags: tagsFor(row, row.filePath),
      complexity: complexityFor(row),
      ...(row.kind !== 'file' ? {
        qualifiedName: row.qualified_name || name,
        startLine: Number(row.start_line || 1),
        endLine: Number(row.end_line || row.start_line || 1),
        signature: row.signature || undefined,
        docstring: row.docstring || undefined
      } : {})
    };
  });

  const edgeCounts = new Map();
  const edges = [];
  const seenEdges = new Set();
  for (const row of edgeRows) {
    const source = idByCodeGraphId.get(row.source);
    const target = idByCodeGraphId.get(row.target);
    const type = EDGE_TYPE_BY_KIND[row.kind];
    if (!source || !target || !type || source === target) continue;
    const key = `${source}|${target}|${type}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edgeCounts.set(source, (edgeCounts.get(source) || 0) + 1);
    edgeCounts.set(target, (edgeCounts.get(target) || 0) + 1);
    edges.push({
      source,
      target,
      type,
      direction: 'forward',
      weight: type === 'calls' ? 0.8 : type === 'contains' ? 0.5 : 0.25,
      ...(row.line ? { line: Number(row.line) } : {}),
      ...(row.provenance ? { provenance: row.provenance } : {})
    });
  }

  const layerMap = new Map();
  for (const node of nodes) {
    const name = layerFor(node.filePath);
    if (!layerMap.has(name)) layerMap.set(name, []);
    layerMap.get(name).push(node.id);
  }
  const layers = [...layerMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, nodeIds], index) => ({
    id: `layer-${index}`,
    name,
    description: describeLayer(name),
    nodeIds
  }));

  const languages = [...new Set(fileRows.map(row => String(row.language || '').trim()).filter(Boolean))]
    .map(value => value.charAt(0).toUpperCase() + value.slice(1));
  const projectName = path.basename(root);
  const analyzedAt = new Date().toISOString();
  const graph = {
    version: '1.0.0',
    project: {
      name: projectName,
      languages,
      frameworks: inferFrameworks(root),
      description: '由 Yan Agent CodeGraph 本地索引转换生成的只读代码知识图谱。',
      analyzedAt,
      gitCommitHash: gitCommitHash(root)
    },
    nodes,
    edges,
    layers,
    tour: buildTour(nodes, edgeCounts)
  };
  fs.writeFileSync(path.join(out, 'knowledge-graph.json'), `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(out, 'config.json'), `${JSON.stringify({ autoUpdate: false, outputLanguage: 'zh' }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(out, 'meta.json'), `${JSON.stringify({ generatedBy: 'Yan Agent CodeGraph bridge', generatedAt: analyzedAt, nodeCount: nodes.length, edgeCount: edges.length }, null, 2)}\n`, 'utf8');
  try { db.close(); } catch {}
  return { ok: true, workspace: root, outputDir: out, nodeCount: nodes.length, edgeCount: edges.length, layerCount: layers.length };
}

if (require.main === module) {
  const workspace = process.argv[2];
  try {
    console.log(JSON.stringify(convertCodeGraph({ workspace })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { convertCodeGraph, normalizeRelativePath, understandAnythingOutputDir };
