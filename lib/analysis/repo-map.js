'use strict';

// Repo map: the whole-repository skeleton an agent can hold in one glance.
// Walks code files, extracts symbols, builds a file dependency graph from
// import/require statements, ranks files with PageRank, and renders the
// highest-ranked slice of the repo inside a token budget.

const fs = require('fs');
const path = require('path');
const { extractOutline, CODE_EXTENSIONS, detectLanguage } = require('./outline');
const { readSourceEntry, cacheParsed } = require('./source-cache');

const IGNORED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next',
  '__pycache__', '.yanagent', '.codegraph', '.ua', '.pets', 'vendor',
  '.cache', '.venv', 'venv', 'target', '.idea', '.vscode'
]);
const MAX_FILES = 3000;
const MAX_FILE_BYTES = 300 * 1024;
const MAX_SYMBOLS_PER_FILE_IN_MAP = 6;
const MAX_SYMBOL_NAME_CHARS = 48;
const CHARS_PER_TOKEN = 4;

function listCodeFiles(root, { maxFiles = MAX_FILES, extensions = CODE_EXTENSIONS } = {}) {
  maxFiles = Math.max(1, Math.min(20000, Math.floor(Number(maxFiles) || MAX_FILES)));
  const files = [];
  const queue = [path.resolve(String(root || ''))];
  let cursor = 0;
  while (cursor < queue.length && files.length <= maxFiles) {
    const directory = queue[cursor++];
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (files.length > maxFiles) break;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!extensions.has(extension)) continue;
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FILE_BYTES) continue;
      files.push(full);
    }
  }
  const truncated = files.length > maxFiles;
  const result = files.slice(0, maxFiles).sort();
  Object.defineProperty(result, 'coverage', { value: {
    indexedFiles: result.length, maxFiles, truncated, maxFileBytes: MAX_FILE_BYTES,
    excludes: 'generated/vendor/hidden directories, symlinks, empty and oversized files'
  } });
  return result;
}

// Resolves a relative import specifier to a walked file key. Tries exact
// match, extension completion, and directory index files. Returns the
// canonical graph key (fileKey), not the raw path.
function resolveImport(specifier, fromFile, fileSet) {
  if (!specifier || !specifier.startsWith('.')) return '';
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py', '.json'].map(extension => base + extension),
    ...['/index.js', '/index.ts', '/index.jsx', '/index.tsx', '/index.mjs', '/__init__.py'].map(suffix => base + suffix)
  ];
  for (const candidate of candidates) {
    const key = process.platform === 'win32' ? path.normalize(candidate).toLowerCase() : path.normalize(candidate);
    if (fileSet.has(key)) return key;
  }
  return '';
}

const IMPORT_RE = /(?:import\s[^'"]*?from\s*|import\s*|require\s*\(\s*|from\s+)[\'"]([^\'"]+)[\'"]/g;
const PYTHON_IMPORT_RE = /^(?:\s*)from\s+([\w.]+)\s+import|^(?:\s*)import\s+([\w.]+)/gm;

function fileKey(file) {
  const normalized = path.normalize(file);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function buildFileGraph(root, { maxFiles = MAX_FILES } = {}) {
  const files = listCodeFiles(root, { maxFiles });
  const fileSet = new Set(files.map(fileKey));
  const nodes = new Map();
  nodes.coverage = files.coverage;
  for (const file of files) {
    let entry;
    try { entry = readSourceEntry(file); } catch { continue; }
    const source = entry.source;
    const language = detectLanguage(file);
    if (!entry.parsed.has('map')) cacheParsed(entry, 'map', extractOutline(file, source, { maxSymbols: 120 }));
    const { symbols } = entry.parsed.get('map');
    const deps = new Set();
    if (language === 'js') {
      for (const match of source.matchAll(IMPORT_RE)) {
        const resolved = resolveImport(match[1], file, fileSet);
        if (resolved && resolved !== fileKey(file)) deps.add(resolved);
      }
    } else if (language === 'python') {
      for (const match of source.matchAll(PYTHON_IMPORT_RE)) {
        const modulePath = (match[1] || match[2] || '').replace(/\./g, '/');
        const resolved = resolveImport(`./${modulePath}`, file, fileSet)
          || resolveImport(`./${modulePath}.py`, file, fileSet)
          || resolveImport(`./${modulePath}/__init__.py`, file, fileSet);
        if (resolved && resolved !== fileKey(file)) deps.add(resolved);
      }
    }
    nodes.set(fileKey(file), { file, symbols, deps: [...deps] });
  }
  return nodes;
}

// Damped iteration over the file graph (PageRank). Deterministic.
function rankNodes(nodes, { iterations = 24, damping = 0.85 } = {}) {
  const keys = [...nodes.keys()];
  const rank = new Map(keys.map(key => [key, 1 / Math.max(1, keys.length)]));
  if (!keys.length) return rank;
  for (let step = 0; step < iterations; step++) {
    const next = new Map(keys.map(key => [key, (1 - damping) / keys.length]));
    for (const key of keys) {
      const deps = nodes.get(key).deps.filter(dependency => nodes.has(dependency));
      const share = rank.get(key) / Math.max(1, deps.length);
      if (!deps.length) {
        next.set(key, next.get(key) + damping * rank.get(key));
        continue;
      }
      for (const dependency of deps) {
        if (!next.has(dependency)) continue;
        next.set(dependency, next.get(dependency) + damping * share);
      }
    }
    for (const key of keys) rank.set(key, next.get(key));
  }
  return rank;
}

function formatSymbols(symbols) {
  const names = [];
  let used = 0;
  for (const symbol of symbols) {
    const display = symbol.name.length > MAX_SYMBOL_NAME_CHARS
      ? `${symbol.name.slice(0, MAX_SYMBOL_NAME_CHARS - 1)}…`
      : symbol.name;
    if (used + display.length > 90) break;
    names.push(display);
    used += display.length + 2;
    if (names.length >= MAX_SYMBOLS_PER_FILE_IN_MAP) break;
  }
  const remaining = Math.max(0, symbols.length - names.length);
  return names.join(', ') + (remaining > 0 ? ` …+${remaining}` : '');
}

// Builds and renders the map. Result: { text, files, truncated, budgetTokens }.
function buildRepoMap(root, { budgetTokens = 1200, maxFiles = MAX_FILES } = {}) {
  const nodes = buildFileGraph(root, { maxFiles });
  const rank = rankNodes(nodes);
  const ordered = [...nodes.keys()].sort((left, right) => rank.get(right) - rank.get(left));
  const resolvedRoot = path.resolve(String(root || ''));
  const header = `repo map: ${nodes.size} code files, ranked by structural importance (imports + symbols)${nodes.coverage.truncated ? ' [scan limit reached; narrow root or increase max_files]' : ''}`;
  const lines = [header];
  let truncated = false;
  let usedChars = header.length;
  const budgetChars = Math.max(200, budgetTokens * CHARS_PER_TOKEN);
  for (const key of ordered) {
    const node = nodes.get(key);
    const relative = path.relative(resolvedRoot, node.file).replace(/\\/g, '/');
    const score = rank.get(key).toFixed(4);
    const line = `  ${relative}  [${score}]  ${formatSymbols(node.symbols)}`;
    if (usedChars + line.length > budgetChars) { truncated = true; break; }
    lines.push(line);
    usedChars += line.length + 1;
  }
  if (truncated) lines.push(`  …${ordered.length - (lines.length - 1)} more files below the budget cut`);
  return { text: lines.join('\n'), files: nodes.size, truncated, budgetTokens, coverage: nodes.coverage };
}

module.exports = { buildRepoMap, listCodeFiles, buildFileGraph, rankNodes, resolveImport, fileKey };
