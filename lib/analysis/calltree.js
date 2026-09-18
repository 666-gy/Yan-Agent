'use strict';

// Calltree queries over JS/TS: build a caller->callee index once per repo,
// answer `who does this symbol call, transitively` with noise pruning and
// cycle guards. v1 resolution: same-file definitions, imported aliases, then
// a unique same-name definition across the repo; everything else renders as
// an unresolved leaf. Precision is honest-approximate: structure-level, not
// compiler-grade.

const path = require('path');
const { extractOutline } = require('./outline');
const { listCodeFiles, fileKey } = require('./repo-map');
const { readSourceEntry, sourceRevision, cacheParsed } = require('./source-cache');

const MAX_FILES = 1500;
const CALL_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
const MAX_CHILDREN_PER_NODE = 12;
const NOISE_NAME_RE = /^(?:get|set)[A-Z_]|^_[a-z]|\$$/;
const KEYWORD_RE = /^(?:if|for|while|switch|catch|return|function|typeof|new|delete|void|in|of|do|else|try|finally|throw|await|async|yield|case|super|this|import|export|require|console|Math|JSON|Object|Array|String|Number|Boolean|Promise|Map|Set|Date|RegExp|Error|process)$/;
const CALL_RE = /\b([A-Za-z_$][\w$]*)\s*(?:<[^<>()]{0,40}>)?\s*\(/g;
const IMPORT_RE = /import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|(?:\*\s+as\s+([\w$]+))|([\w$]+))?\s*(?:,\s*\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;
const REQUIRE_RE = /(?:const|let|var)\s+(?:\{([^}]*)\}|([\w$]+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const INDEX_CACHE_TTL_MS = 120_000;

const indexCache = new Map(); // root -> { builtAt, index }

function looksRelative(specifier) {
  return String(specifier || '').startsWith('.');
}

function importTargetsFor(source, file, fileSet) {
  const targets = new Map(); // local name -> resolved file
  const record = (local, specifier, imported = local) => {
    if (!local || !looksRelative(specifier)) return;
    const base = path.resolve(path.dirname(file), specifier);
    const candidates = [base, ...['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'].map(extension => base + extension), `${base}/index.js`, `${base}/index.ts`];
    for (const candidate of candidates) {
      const key = fileKey(candidate);
      if (fileSet.has(key)) { targets.set(local, { file: path.normalize(candidate), imported }); return; }
    }
  };
  for (const match of source.matchAll(IMPORT_RE)) {
    const [, defaultOne, namedBlock, namespace, bareDefault, extraNamed, specifier] = match;
    record(defaultOne, specifier);
    record(bareDefault, specifier);
    record(namespace, specifier);
    for (const block of [namedBlock, extraNamed]) {
      if (!block) continue;
      for (const piece of block.split(',')) {
        const [imported, local] = piece.split(/\s+as\s+/).map(part => part.trim());
        if (imported) record(local || imported, specifier, imported);
      }
    }
  }
  for (const match of source.matchAll(REQUIRE_RE)) {
    const [, namedBlock, bare, specifier] = match;
    if (namedBlock) {
      for (const piece of namedBlock.split(',')) {
        const [imported, local] = piece.split(/\s*:\s*/).map(part => part.trim());
        if (imported) record(local || imported, specifier, imported);
      }
    } else if (bare) {
      record(bare, specifier);
    }
  }
  return targets;
}

// Builds { defs: Map<lowercase name -> [{file, name, line, endLine}]>,
//          calls: Map<`${file}:${line}:${name}` -> string[] callee names> }.
function buildCallIndex(root, { maxFiles = MAX_FILES, sourceFiles } = {}) {
  const files = sourceFiles || listCodeFiles(root, { maxFiles, extensions: CALL_EXTENSIONS });
  const fileSet = new Set(files.map(fileKey));
  const index = { defs: new Map(), calls: new Map(), files: files.length, coverage: files.coverage };
  const byFile = new Map();
  for (const file of files) {
    let entry;
    try { entry = readSourceEntry(file); } catch { continue; }
    const source = entry.source;
    if (!entry.parsed.has('calls')) cacheParsed(entry, 'calls', extractOutline(file, source, { maxSymbols: 300 }));
    const outline = entry.parsed.get('calls');
    const targets = importTargetsFor(source, file, fileSet);
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    byFile.set(file, { outline, targets, lines });
    for (const symbol of outline.symbols) {
      const key = symbol.name.split('.').at(-1).toLowerCase();
      if (!index.defs.has(key)) index.defs.set(key, []);
      index.defs.get(key).push({ file, name: symbol.name, line: symbol.line, endLine: symbol.endLine });
    }
  }
  for (const [file, { outline, targets, lines }] of byFile) {
    for (const symbol of outline.symbols) {
      if (symbol.endLine - symbol.line > 800) continue; // skip huge spans
      const callees = new Set();
      for (let line = symbol.line - 1; line < Math.min(symbol.endLine, lines.length); line++) {
        for (const match of lines[line].matchAll(CALL_RE)) {
          const name = match[1];
          if (name === symbol.name.split('.').at(-1)) continue;
          if (KEYWORD_RE.test(name)) continue;
          callees.add(name);
          if (callees.size >= 60) break;
        }
        if (callees.size >= 60) break;
      }
      index.calls.set(`${file}:${symbol.line}`, [...callees]);
      // Remember how each callee name should resolve from this file.
      for (const callee of [...callees]) {
        const resolutionKey = `${file}:${symbol.line}:${callee}`;
        const lower = callee.toLowerCase();
        const local = targets.has(callee) ? targets.get(callee) : null;
        index.calls.set(resolutionKey, { file: local?.file || null, lower: local?.imported?.toLowerCase() || lower });
      }
    }
  }
  return index;
}

function getCachedIndex(root, { maxFiles = MAX_FILES } = {}) {
  const resolved = path.resolve(String(root || ''));
  const files = listCodeFiles(resolved, { maxFiles, extensions: CALL_EXTENSIONS });
  const revision = sourceRevision(files) + ':' + files.coverage.truncated;
  const key = `${resolved}:${maxFiles}`;
  const cached = indexCache.get(key);
  if (cached?.revision === revision && Date.now() - cached.builtAt < INDEX_CACHE_TTL_MS) return cached.index;
  const index = buildCallIndex(resolved, { maxFiles, sourceFiles: files });
  indexCache.set(key, { builtAt: Date.now(), revision, index });
  if (indexCache.size > 8) {
    const oldest = [...indexCache.entries()].sort((a, b) => a[1].builtAt - b[1].builtAt)[0];
    if (oldest) indexCache.delete(oldest[0]);
  }
  return index;
}

function resolveCallee(index, fromFile, symbolLine, calleeName) {
  const resolution = index.calls.get(`${fromFile}:${symbolLine}:${calleeName}`);
  const lower = calleeName.toLowerCase();
  // Same file first.
  const localDefs = index.defs.get(lower) || [];
  const sameFile = localDefs.find(def => path.normalize(def.file) === path.normalize(fromFile));
  if (sameFile) return sameFile;
  if (resolution && resolution.file) {
    const imported = (index.defs.get(resolution.lower) || []).find(def => fileKey(def.file) === fileKey(resolution.file));
    if (imported) return imported;
  }
  // Unique repo-wide definition for the bare name.
  if (localDefs.length === 1) return localDefs[0];
  return null;
}

// Queries the transitive call tree of a symbol. Noise callees (getters,
// setters, private helpers) are rendered as non-expanded [pruned] leaves so
// the chain stays honest without wasting nodes on them.
// Result: { text, nodes, unresolved, truncated, root }.
function queryCallTree(index, symbolName, { depth = 4, maxNodes = 300 } = {}) {
  const key = String(symbolName || '').trim().split('.').at(-1).toLowerCase();
  const roots = index.defs.get(key) || [];
  if (!roots.length) return { text: `symbol not found: ${symbolName}`, nodes: 0, unresolved: 0, truncated: false, root: symbolName };
  const lines = [];
  let nodes = 0;
  let unresolved = 0;
  let truncated = false;

  const walk = (def, linePrefix, childPrefix, remainingDepth, pathSet) => {
    if (nodes >= maxNodes) { truncated = true; return; }
    nodes += 1;
    lines.push(`${linePrefix}${def.name}  (${def.file}:${def.line})`);
    if (remainingDepth <= 0 || truncated) return;
    const calleeNames = index.calls.get(`${def.file}:${def.line}`) || [];
    const children = [];
    for (const calleeName of calleeNames) {
      if (children.length >= MAX_CHILDREN_PER_NODE + 8) break;
      if (NOISE_NAME_RE.test(calleeName)) {
        children.push({ leaf: true, label: `${calleeName} [pruned]` });
        continue;
      }
      const resolved = resolveCallee(index, def.file, def.line, calleeName);
      if (resolved) {
        if (pathSet.has(`${resolved.file}:${resolved.line}`)) continue;
        children.push(resolved);
      } else {
        unresolved += 1;
        children.push({ leaf: true, label: `${calleeName} [unresolved]` });
      }
    }
    const shown = children.slice(0, MAX_CHILDREN_PER_NODE);
    shown.forEach((child, position) => {
      const isLast = position === shown.length - 1 && children.length <= MAX_CHILDREN_PER_NODE + 8;
      const branch = `${childPrefix}${isLast ? '└─ ' : '├─ '}`;
      const nextChildPrefix = `${childPrefix}${isLast ? '   ' : '│  '}`;
      if (child.leaf) {
        lines.push(`${branch}${child.label}`);
        return;
      }
      pathSet.add(`${child.file}:${child.line}`);
      walk(child, branch, nextChildPrefix, remainingDepth - 1, pathSet);
      pathSet.delete(`${child.file}:${child.line}`);
    });
    const hidden = children.length - shown.length;
    if (hidden > 0) lines.push(`${childPrefix}${shown.length ? (shown.length >= MAX_CHILDREN_PER_NODE + 8 ? '└─ ' : '├─ ') : '└─ '}…+${hidden} more`);
  };

  for (const root of roots.slice(0, 3)) {
    walk(root, '', '  ', depth, new Set([`${root.file}:${root.line}`]));
    if (nodes >= maxNodes) break;
  }
  return { text: lines.join('\n'), nodes, unresolved, truncated, root: symbolName };
}

module.exports = { buildCallIndex, queryCallTree, getCachedIndex, resolveCallee };
