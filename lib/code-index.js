/**
 * Yan Agent — shared code understanding & indexing (Node.js)
 * Used by main process for workspace index, project scan, symbol/reference search.
 */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const EXT_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', pyw: 'python',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  cs: 'csharp', cpp: 'cpp', cc: 'cpp', h: 'cpp', hpp: 'cpp',
  rb: 'ruby', php: 'php', swift: 'swift',
  vue: 'vue', svelte: 'svelte'
};

const DEFAULT_CODE_EXTENSIONS = [
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'kt',
  'cs', 'cpp', 'h', 'hpp', 'rb', 'php', 'vue', 'svelte', 'html', 'css', 'scss', 'json', 'md'
];

const SEARCH_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '__pycache__',
  '.yanagent', '.next', '.nuxt', 'vendor', 'target', '.cache', '.vscode', '.cursor'
]);

const SEARCH_SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);

const OUTLINE_RULES = {
  javascript: [
    { kind: 'class', re: /^(?:export\s+default\s+)?(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'function', re: /^(?:export\s+default\s+)?(?:export\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(/ },
    { kind: 'function', re: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/ },
    { kind: 'const', re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/ },
    { kind: 'interface', re: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'type', re: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ },
    { kind: 'enum', re: /^(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/ }
  ],
  typescript: [
    { kind: 'class', re: /^(?:export\s+default\s+)?(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'function', re: /^(?:export\s+default\s+)?(?:export\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*[<(]/ },
    { kind: 'function', re: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/ },
    { kind: 'const', re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/ },
    { kind: 'interface', re: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'type', re: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[<=]/ },
    { kind: 'enum', re: /^(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/ }
  ],
  python: [
    { kind: 'class', re: /^class\s+([A-Za-z_][\w]*)\s*[(:]/ },
    { kind: 'function', re: /^(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/ }
  ],
  go: [
    { kind: 'function', re: /^func\s+(?:\([^)]+\)\s+)?([A-Za-z_][\w]*)\s*\(/ },
    { kind: 'type', re: /^type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)\b/ }
  ],
  rust: [
    { kind: 'function', re: /^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*[<(]/ },
    { kind: 'struct', re: /^(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/ },
    { kind: 'enum', re: /^(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/ },
    { kind: 'trait', re: /^(?:pub\s+)?trait\s+([A-Za-z_][\w]*)/ }
  ],
  java: [
    { kind: 'class', re: /^(?:public\s+)?(?:abstract\s+)?(?:final\s+)?class\s+([A-Za-z_][\w]*)/ },
    { kind: 'interface', re: /^(?:public\s+)?interface\s+([A-Za-z_][\w]*)/ }
  ],
  csharp: [
    { kind: 'class', re: /^(?:public|private|internal)?\s*(?:partial\s+)?class\s+([A-Za-z_][\w]*)/ },
    { kind: 'interface', re: /^(?:public|private|internal)?\s*interface\s+([A-Za-z_][\w]*)/ }
  ],
  ruby: [
    { kind: 'class', re: /^class\s+([A-Za-z_][\w]*)/ },
    { kind: 'module', re: /^module\s+([A-Za-z_][\w]*)/ },
    { kind: 'function', re: /^def\s+(?:self\.)?([A-Za-z_][\w!?]*)/ }
  ],
  php: [
    { kind: 'class', re: /^(?:abstract\s+)?class\s+([A-Za-z_][\w]*)/ },
    { kind: 'function', re: /^(?:public|private|protected)?\s*(?:static\s+)?function\s+([A-Za-z_][\w]*)\s*\(/ }
  ]
};

function detectLanguage(filePath) {
  const ext = String(filePath || '').split('.').pop().toLowerCase();
  return EXT_LANG[ext] || 'unknown';
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clipLine(line, max = 120) {
  const t = String(line || '').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function outlineFile(content, filePath) {
  const lang = detectLanguage(filePath);
  const rules = OUTLINE_RULES[lang] || OUTLINE_RULES.javascript;
  const lines = String(content || '').split('\n');
  const symbols = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;
    for (const rule of rules) {
      const m = trimmed.match(rule.re);
      if (!m || !m[1]) continue;
      const key = `${rule.kind}:${m[1]}:${i + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({ line: i + 1, kind: rule.kind, name: m[1], preview: clipLine(trimmed) });
      break;
    }
  }
  return { language: lang, lineCount: lines.length, symbols };
}

function extractImportsExports(content, filePath) {
  const lang = detectLanguage(filePath);
  const lines = String(content || '').split('\n');
  const imports = [];
  const exports = [];
  const seenImp = new Set();
  const seenExp = new Set();

  const addImp = (v) => { const s = String(v || '').trim(); if (s && !seenImp.has(s)) { seenImp.add(s); imports.push(s); } };
  const addExp = (v) => { const s = String(v || '').trim(); if (s && !seenExp.has(s)) { seenExp.add(s); exports.push(s); } };

  for (const raw of lines) {
    const t = raw.trim();
    if (!t || t.startsWith('//') || t.startsWith('#')) continue;

    if (lang === 'javascript' || lang === 'typescript' || lang === 'vue' || lang === 'svelte' || lang === 'unknown') {
      let m = t.match(/^import\s+(?:type\s+)?(?:\{([^}]+)\}|(\*\s+as\s+\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/);
      if (m) { addImp(m[4]); if (m[1]) m[1].split(',').forEach(x => addExp(x.split(/\s+as\s+/).pop().trim())); else if (m[3]) addExp(m[3]); continue; }
      m = t.match(/^import\s+['"]([^'"]+)['"]/);
      if (m) { addImp(m[1]); continue; }
      m = t.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
      if (m) { addImp(m[1]); continue; }
      m = t.match(/^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/);
      if (m) { addExp(m[1]); continue; }
      m = t.match(/^export\s+(?:default\s+)?class\s+(\w+)/);
      if (m) { addExp(m[1]); continue; }
      m = t.match(/^export\s+(?:const|let|var)\s+(\w+)/);
      if (m) { addExp(m[1]); continue; }
      m = t.match(/^export\s*\{([^}]+)\}/);
      if (m) { m[1].split(',').forEach(x => addExp(x.split(/\s+as\s+/)[0].trim())); continue; }
    }

    if (lang === 'python') {
      let m = t.match(/^from\s+([\w.]+)\s+import\s+(.+)/);
      if (m) { addImp(m[1]); m[2].split(',').forEach(x => addExp(x.trim().split(/\s+as\s+/)[0])); continue; }
      m = t.match(/^import\s+([\w.]+)/);
      if (m) { addImp(m[1]); continue; }
    }

    if (lang === 'go') {
      const m = t.match(/^\s*"([^"]+)"/);
      if (m && (t.includes('import') || lines[lines.indexOf(raw) - 1]?.includes('import'))) addImp(m[1]);
    }

    if (lang === 'rust') {
      const m = t.match(/^use\s+([^;]+);/);
      if (m) addImp(m[1].trim());
    }
  }

  for (const s of outlineFile(content, filePath).symbols) {
    if (touchesExport(content, s.name, lang)) addExp(s.name);
  }

  return { imports, exports };
}

function touchesExport(content, name, lang) {
  const re = new RegExp(`export\\s+(?:default\\s+)?(?:function|class|const|let|var|interface|type|enum)\\s+${escapeRegExp(name)}\\b`);
  return re.test(content);
}

function definitionRegexes(symbol, lang) {
  const s = escapeRegExp(symbol);
  const common = [
    new RegExp(`\\bfunction\\s+${s}\\s*\\(`),
    new RegExp(`\\bclass\\s+${s}\\b`),
    new RegExp(`\\b(?:const|let|var)\\s+${s}\\s*=`),
    new RegExp(`\\binterface\\s+${s}\\b`),
    new RegExp(`\\btype\\s+${s}\\s*[=<>]`),
    new RegExp(`\\benum\\s+${s}\\b`)
  ];
  if (lang === 'python' || lang === 'unknown') {
    common.push(new RegExp(`\\bdef\\s+${s}\\s*\\(`));
    common.push(new RegExp(`\\bclass\\s+${s}\\s*[(:]`));
  }
  if (lang === 'go') {
    common.push(new RegExp(`\\bfunc\\s+(?:\\([^)]+\\)\\s+)?${s}\\s*\\(`));
    common.push(new RegExp(`\\btype\\s+${s}\\s+(?:struct|interface)\\b`));
  }
  if (lang === 'rust') {
    common.push(new RegExp(`\\bfn\\s+${s}\\s*[<(]`));
    common.push(new RegExp(`\\bstruct\\s+${s}\\b`));
    common.push(new RegExp(`\\benum\\s+${s}\\b`));
    common.push(new RegExp(`\\btrait\\s+${s}\\b`));
  }
  return common;
}

function classifyDefinitionLine(line) {
  const t = String(line || '').trim();
  if (/\bclass\s+/.test(t)) return 'class';
  if (/\binterface\s+/.test(t)) return 'interface';
  if (/\bstruct\s+/.test(t)) return 'struct';
  if (/\btrait\s+/.test(t)) return 'trait';
  if (/\benum\s+/.test(t)) return 'enum';
  if (/\btype\s+/.test(t)) return 'type';
  if (/\bmodule\s+/.test(t)) return 'module';
  if (/\b(?:def|function|fn|func)\s+/.test(t)) return 'function';
  if (/\b(?:const|let|var)\s+/.test(t)) return 'const';
  return 'symbol';
}

function isDefinitionLine(line, symbol, lang) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  return definitionRegexes(symbol, lang).some(re => re.test(trimmed));
}

function isReferenceLine(line, symbol, lang) {
  const trimmed = String(line || '').trim();
  if (!trimmed || isDefinitionLine(trimmed, symbol, lang)) return false;
  const s = escapeRegExp(symbol);
  return new RegExp(`\\b${s}\\b`).test(trimmed);
}

function lineMatchesQuery(line, query, { regex, caseSensitive }) {
  if (regex) {
    try {
      const flags = caseSensitive ? '' : 'i';
      return new RegExp(query, flags).test(line);
    } catch {
      return false;
    }
  }
  if (caseSensitive) return line.includes(query);
  return line.toLowerCase().includes(query.toLowerCase());
}

async function walkCodeFiles(root, opts = {}) {
  const {
    extensions = DEFAULT_CODE_EXTENSIONS,
    maxDepth = 10,
    maxFiles = 2500,
    maxFileSize = 512 * 1024,
    skipDirs = [],
    skipPaths = []
  } = opts;
  const exts = extensions.map(e => String(e).replace(/^\./, '').toLowerCase());
  const extraSkipDirs = new Set(skipDirs.map(String));
  const normalizedSkipPaths = skipPaths.map(p => String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''));
  const files = [];

  async function walk(dir, depth) {
    if (depth > maxDepth || files.length >= maxFiles) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.isDirectory()) {
        if (SEARCH_SKIP_DIRS.has(entry.name) || extraSkipDirs.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;
        const childDir = path.join(dir, entry.name);
        const relDir = path.relative(root, childDir).replace(/\\/g, '/');
        if (normalizedSkipPaths.some(prefix => relDir === prefix || relDir.startsWith(prefix + '/'))) continue;
        await walk(childDir, depth + 1);
        continue;
      }
      if (SEARCH_SKIP_FILES.has(entry.name)) continue;
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (exts.length && !exts.includes(ext)) continue;
      const fullPath = path.join(dir, entry.name);
      try {
        const stat = await fsp.stat(fullPath);
        if (stat.size > maxFileSize) continue;
        files.push({ fullPath, relPath: path.relative(root, fullPath).replace(/\\/g, '/'), mtime: stat.mtimeMs, size: stat.size });
      } catch { /* skip */ }
    }
  }

  await walk(root, 0);
  return files;
}

function buildFileIndexEntry(content, fullPath, relPath, mtime) {
  const outline = outlineFile(content, fullPath);
  const ie = extractImportsExports(content, fullPath);
  return {
    path: fullPath,
    relPath,
    mtime,
    language: outline.language,
    lineCount: outline.lineCount,
    symbols: outline.symbols,
    imports: ie.imports,
    exports: ie.exports
  };
}

async function buildWorkspaceIndex(workspace, opts = {}) {
  const files = await walkCodeFiles(workspace, opts);
  const index = {
    version: 1,
    workspace,
    builtAt: Date.now(),
    fileCount: 0,
    symbolCount: 0,
    files: {},
    symbolIndex: {}
  };

  for (const f of files) {
    let content;
    try { content = await fsp.readFile(f.fullPath, 'utf8'); } catch { continue; }
    const entry = buildFileIndexEntry(content, f.fullPath, f.relPath, f.mtime);
    index.files[f.relPath] = entry;
    index.fileCount++;
    for (const sym of entry.symbols) {
      index.symbolCount++;
      if (!index.symbolIndex[sym.name]) index.symbolIndex[sym.name] = [];
      index.symbolIndex[sym.name].push({
        path: f.fullPath,
        relPath: f.relPath,
        line: sym.line,
        kind: sym.kind,
        preview: sym.preview
      });
    }
  }
  return index;
}

function searchSymbols(index, query, opts = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !index?.symbolIndex) return [];
  const kind = opts.kind ? String(opts.kind).toLowerCase() : null;
  const limit = opts.limit || 40;
  const hits = [];

  for (const [name, entries] of Object.entries(index.symbolIndex)) {
    const nl = name.toLowerCase();
    const match = opts.regex
      ? (() => { try { return new RegExp(query, opts.caseSensitive ? '' : 'i').test(name); } catch { return false; } })()
      : nl.includes(q);
    if (!match) continue;
    for (const e of entries) {
      if (kind && e.kind !== kind) continue;
      hits.push({ name, ...e });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

function findSymbolInIndex(index, name, opts = {}) {
  const key = String(name || '').trim();
  if (!key || !index?.symbolIndex) return [];
  const entries = index.symbolIndex[key] || [];
  if (opts.kind) return entries.filter(e => e.kind === opts.kind);
  return entries;
}

function resolveImportTarget(workspace, fromRelPath, importPath) {
  const imp = String(importPath || '').trim();
  if (!imp || imp.startsWith('http')) return null;
  const base = path.dirname(path.join(workspace, fromRelPath));
  let candidate = imp.startsWith('.') ? path.normalize(path.join(base, imp)) : path.join(workspace, imp);
  const tries = [candidate, candidate + '.js', candidate + '.ts', candidate + '.tsx', candidate + '.jsx',
    path.join(candidate, 'index.js'), path.join(candidate, 'index.ts')];
  for (const t of tries) {
    if (fs.existsSync(t) && fs.statSync(t).isFile()) return t;
  }
  return null;
}

function findRelatedFiles(index, workspace, targetPath) {
  const abs = path.normalize(targetPath);
  let rel = null;
  for (const [r, entry] of Object.entries(index.files || {})) {
    if (path.normalize(entry.path) === abs) { rel = r; break; }
  }
  if (!rel) {
    rel = path.relative(workspace, abs).replace(/\\/g, '/');
    if (!index.files[rel]) return { imports: [], importedBy: [], exports: [], symbols: [] };
  }

  const entry = index.files[rel];
  const imports = [];
  const importedBy = [];

  for (const imp of entry.imports || []) {
    const resolved = resolveImportTarget(workspace, rel, imp);
    if (resolved) imports.push({ spec: imp, path: resolved });
  }

  const baseName = path.basename(rel, path.extname(rel));
  for (const [r, fe] of Object.entries(index.files)) {
    if (r === rel) continue;
    for (const imp of fe.imports || []) {
      if (imp.includes(baseName) || imp.includes(rel.replace(/\\/g, '/').replace(/\.[^.]+$/, ''))) {
        importedBy.push({ path: fe.path, relPath: r, spec: imp });
      }
    }
  }

  return {
    path: abs,
    relPath: rel,
    imports,
    importedBy: importedBy.slice(0, 30),
    exports: entry.exports || [],
    symbols: entry.symbols || []
  };
}

async function searchDefinitions(workspace, symbol, opts = {}) {
  const name = String(symbol || '').trim();
  if (!name) return [];
  const files = await walkCodeFiles(opts.directory || workspace, { maxFiles: opts.maxFiles || 1500 });
  const hits = [];
  const limit = opts.maxResults || 30;

  for (const f of files) {
    if (hits.length >= limit) break;
    let content;
    try { content = await fsp.readFile(f.fullPath, 'utf8'); } catch { continue; }
    const lang = detectLanguage(f.fullPath);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && hits.length < limit; i++) {
      if (!isDefinitionLine(lines[i], name, lang)) continue;
      hits.push({
        path: f.fullPath,
        relPath: f.relPath,
        line: i + 1,
        kind: classifyDefinitionLine(lines[i]),
        preview: clipLine(lines[i])
      });
    }
  }
  return hits;
}

async function searchReferences(workspace, symbol, opts = {}) {
  const name = String(symbol || '').trim();
  if (!name) return [];
  const files = await walkCodeFiles(opts.directory || workspace, { maxFiles: opts.maxFiles || 1500 });
  const hits = [];
  const limit = opts.maxResults || 50;

  for (const f of files) {
    if (hits.length >= limit) break;
    let content;
    try { content = await fsp.readFile(f.fullPath, 'utf8'); } catch { continue; }
    const lang = detectLanguage(f.fullPath);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && hits.length < limit; i++) {
      if (!isReferenceLine(lines[i], name, lang)) continue;
      hits.push({
        path: f.fullPath,
        relPath: f.relPath,
        line: i + 1,
        preview: clipLine(lines[i])
      });
    }
  }
  return hits;
}

function scanProjectMetadata(workspace) {
  const result = {
    workspace,
    name: path.basename(workspace),
    type: 'unknown',
    entries: [],
    scripts: {},
    dependencies: [],
    devDependencies: [],
    frameworks: [],
    extCounts: {},
    topDirs: {},
    readmeHint: null
  };

  const pkgPath = path.join(workspace, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      result.name = pkg.name || result.name;
      result.type = 'node';
      if (pkg.main) result.entries.push(pkg.main);
      if (pkg.scripts) result.scripts = pkg.scripts;
      result.dependencies = Object.keys(pkg.dependencies || {});
      result.devDependencies = Object.keys(pkg.devDependencies || {});
      if (result.dependencies.includes('electron') || result.devDependencies.includes('electron')) result.type = 'electron';
    } catch { /* ignore */ }
  }

  for (const f of ['renderer/index.html', 'index.html', 'src/main.ts', 'src/index.ts', 'main.py', 'app.py', 'Cargo.toml', 'go.mod']) {
    if (fs.existsSync(path.join(workspace, f)) && !result.entries.includes(f)) result.entries.push(f);
  }

  const fwMap = {
    react: 'React', vue: 'Vue', electron: 'Electron', express: 'Express',
    next: 'Next.js', nuxt: 'Nuxt', django: 'Django', flask: 'Flask',
    fastapi: 'FastAPI', spring: 'Spring'
  };
  for (const dep of [...result.dependencies, ...result.devDependencies]) {
    for (const [k, label] of Object.entries(fwMap)) {
      if (dep.includes(k) && !result.frameworks.includes(label)) result.frameworks.push(label);
    }
  }

  const readmePath = ['README.md', 'readme.md', 'README.zh-CN.md'].map(f => path.join(workspace, f)).find(p => fs.existsSync(p));
  if (readmePath) {
    const text = fs.readFileSync(readmePath, 'utf8');
    const first = text.split('\n').find(l => l.trim() && !l.startsWith('#'));
    result.readmeHint = first ? clipLine(first, 200) : null;
  }

  return result;
}

async function enrichProjectScan(workspace) {
  const meta = scanProjectMetadata(workspace);
  const files = await walkCodeFiles(workspace, { maxFiles: 3000, maxDepth: 8 });
  for (const f of files) {
    const ext = path.extname(f.relPath).slice(1).toLowerCase() || '(none)';
    meta.extCounts[ext] = (meta.extCounts[ext] || 0) + 1;
    const top = f.relPath.split('/')[0];
    if (top) meta.topDirs[top] = (meta.topDirs[top] || 0) + 1;
  }
  meta.totalCodeFiles = files.length;
  return meta;
}

function formatProjectScan(meta) {
  const lines = [
    `## Project: ${meta.name}`,
    `Type: ${meta.type}${meta.frameworks.length ? ' (' + meta.frameworks.join(', ') + ')' : ''}`,
    `Code files indexed: ${meta.totalCodeFiles || '?'}`,
  ];
  if (meta.entries.length) lines.push(`Entry points: ${meta.entries.join(', ')}`);
  if (meta.readmeHint) lines.push(`README: ${meta.readmeHint}`);
  if (Object.keys(meta.scripts).length) {
    lines.push('Scripts: ' + Object.entries(meta.scripts).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join(' | '));
  }
  const extSorted = Object.entries(meta.extCounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (extSorted.length) lines.push('Files by ext: ' + extSorted.map(([e, n]) => `${e}:${n}`).join(', '));
  const dirSorted = Object.entries(meta.topDirs || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (dirSorted.length) lines.push('Top dirs: ' + dirSorted.map(([d, n]) => `${d}/ (${n})`).join(', '));
  lines.push('Tip: call build_code_index for fast symbol lookup, then search_symbols / find_symbol.');
  return lines.join('\n');
}

function readFileRange(content, startLine, endLine) {
  const lines = String(content || '').split('\n');
  const start = Math.max(1, parseInt(startLine, 10) || 1);
  const end = Math.min(lines.length, parseInt(endLine, 10) || lines.length);
  if (start > end) return { error: 'start_line must be <= end_line', lines: [] };
  if (end - start + 1 > 250) return { error: 'Max 250 lines per read_file_range call', lines: [] };
  const slice = lines.slice(start - 1, end);
  const numbered = slice.map((l, i) => `${start + i}|${l}`).join('\n');
  return { start, end, lineCount: lines.length, content: numbered };
}

module.exports = {
  EXT_LANG,
  DEFAULT_CODE_EXTENSIONS,
  SEARCH_SKIP_DIRS,
  SEARCH_SKIP_FILES,
  detectLanguage,
  outlineFile,
  extractImportsExports,
  isDefinitionLine,
  isReferenceLine,
  classifyDefinitionLine,
  lineMatchesQuery,
  walkCodeFiles,
  buildWorkspaceIndex,
  searchSymbols,
  findSymbolInIndex,
  findRelatedFiles,
  searchDefinitions,
  searchReferences,
  scanProjectMetadata,
  enrichProjectScan,
  formatProjectScan,
  readFileRange,
  clipLine,
  escapeRegExp
};
