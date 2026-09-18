'use strict';

// Deterministic symbol outline extraction — the fast path behind
// `code_outline` / `code_symbol`. Zero dependencies, line-based, v1 language
// coverage: JS/TS family, Python, and brace-family (C/C++/Java/C#/Go/Rust…).
// Precision is intentionally "good outline, not compiler": the goal is to
// keep agents from reading whole large files, not to replace a language
// server.

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts',
  '.py', '.pyi',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.hh', '.hxx',
  '.java', '.cs', '.go', '.rs', '.php', '.swift', '.kt', '.kts',
  '.vue', '.svelte'
]);

const MAX_OUTLINE_SCAN_LINES = 20_000;
const MAX_SYMBOL_SPAN_LINES = 2_000;

function detectLanguage(filePath) {
  const extension = String(filePath || '').slice(String(filePath || '').lastIndexOf('.')).toLowerCase();
  if (!extension.startsWith('.')) return '';
  if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte'].includes(extension)) return 'js';
  if (['.py', '.pyi'].includes(extension)) return 'python';
  if (CODE_EXTENSIONS.has(extension)) return 'brace';
  return '';
}

// Returns the 1-based line where the brace opened on `startLine` finally
// closes, capped so a pathological file cannot stall extraction.
function braceCloseLine(lines, startLine) {
  let depth = 0;
  let opened = false;
  const limit = Math.min(lines.length, startLine - 1 + MAX_SYMBOL_SPAN_LINES);
  for (let index = startLine - 1; index < limit; index++) {
    const line = lines[index];
    for (const character of line) {
      if (character === '{') { depth += 1; opened = true; }
      else if (character === '}') depth -= 1;
    }
    if (opened && depth <= 0) return index + 1;
  }
  return Math.min(lines.length, startLine - 1 + MAX_SYMBOL_SPAN_LINES);
}

function pythonCloseLine(lines, startLine, indent) {
  const limit = Math.min(lines.length, startLine - 1 + MAX_SYMBOL_SPAN_LINES);
  let lastContent = startLine;
  for (let index = startLine; index < limit; index++) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const lineIndent = line.match(/^\s*/)[0].length;
    if (lineIndent <= indent) break;
    lastContent = index + 1;
  }
  return lastContent;
}

const JS_PATTERNS = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: 'function' },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/, kind: 'function' },
  { re: /^\s+(?:(?:public|private|protected|static|readonly|async|override)\s+)*(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^;{}]*\)\s*(?::[^{]+)?\{/, kind: 'method' }
];

const PYTHON_PATTERNS = [
  { re: /^(\s*)class\s+([A-Za-z_]\w*)/, kind: 'class' },
  { re: /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: 'function' }
];

const BRACE_PATTERNS = [
  { re: /^\s*(?:export\s+)?(?:public|private|protected|internal|abstract|static|final|sealed|override|virtual|unsafe|async|const)*\s*(?:class|struct|interface|enum|impl|trait|record)\s+([A-Za-z_]\w*)/, kind: 'class' },
  { re: /^\s*(?:export\s+)?(?:public|private|protected|internal|static|const|virtual|override|unsafe|extern|async|inline|synchronized)*\s*[A-Za-z_][\w:<>~*&\s]*?\s([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?\{/, kind: 'function' },
  { re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/, kind: 'function' },
  { re: /^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^\s*(?:public|private|protected)?\s*function\s+([A-Za-z_]\w*)/, kind: 'function' }
];

// Extracts the symbol outline of one source file.
// Result: { language, symbols: [{ name, kind, line, endLine }] } with 1-based
// inclusive line ranges; `line === endLine` for one-line symbols.
function extractOutline(filePath, source, { maxSymbols = 400 } = {}) {
  const language = detectLanguage(filePath);
  if (!language) return { language: '', symbols: [] };
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const symbols = [];
  const seen = new Set();

  const push = (name, kind, line, endLine) => {
    if (!name || symbols.length >= maxSymbols) return;
    const key = `${name}:${kind}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    symbols.push({ name, kind, line, endLine });
  };

  if (language === 'js') {
    let currentClass = null;
    for (let index = 0; index < Math.min(lines.length, MAX_OUTLINE_SCAN_LINES); index++) {
      const line = lines[index];
      if (!line.trim() || line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
      let matched = false;
      for (const pattern of JS_PATTERNS) {
        const match = line.match(pattern.re);
        if (!match) continue;
        const name = match[1];
        const close = braceCloseLine(lines, index + 1);
        push(name, pattern.kind, index + 1, close);
        if (pattern.kind === 'class') currentClass = { name, endLine: close };
        matched = true;
        break;
      }
      if (!matched && currentClass && index + 1 <= currentClass.endLine) {
        // Restore class context for qualified method names:  Class.method
        const last = symbols[symbols.length - 1];
        if (last && last.kind === 'method' && !last.name.includes('.')) {
          last.name = `${currentClass.name}.${last.name}`;
        }
      }
      if (currentClass && index + 1 > currentClass.endLine) currentClass = null;
    }
    return { language, symbols };
  }

  if (language === 'python') {
    let currentClass = null;
    for (let index = 0; index < Math.min(lines.length, MAX_OUTLINE_SCAN_LINES); index++) {
      const line = lines[index];
      for (const pattern of PYTHON_PATTERNS) {
        const match = line.match(pattern.re);
        if (!match) continue;
        const indent = match[1].length;
        const name = pattern.kind === 'class' ? match[2] : match[2];
        const close = pythonCloseLine(lines, index + 1, indent);
        const qualified = currentClass && indent > currentClass.indent
          ? `${currentClass.name}.${name}`
          : name;
        push(qualified, pattern.kind, index + 1, close);
        if (pattern.kind === 'class') currentClass = { name, indent, endLine: close };
        break;
      }
      if (currentClass && index + 1 >= currentClass.endLine) currentClass = null;
    }
    return { language, symbols };
  }

  // Brace family: loose definition matching; a symbol ends where its braces
  // balance out.
  for (let index = 0; index < Math.min(lines.length, MAX_OUTLINE_SCAN_LINES); index++) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    for (const pattern of BRACE_PATTERNS) {
      const match = line.match(pattern.re);
      if (!match) continue;
      const close = braceCloseLine(lines, index + 1);
      push(match[1], pattern.kind, index + 1, close);
      break;
    }
  }
  return { language, symbols };
}

// Returns the best symbol match for a name (exact, or `Class.method` tail).
function findSymbol(symbols, name, occurrence = 1) {
  const target = String(name || '').trim();
  if (!target) return null;
  const candidates = symbols.filter(symbol => (
    symbol.name === target || symbol.name.endsWith(`.${target}`) || symbol.name.split('.').at(-1) === target
  ));
  return candidates[Math.max(0, Number(occurrence) - 1)] || null;
}

let wasmBackend = null;

// Async facade for user-facing outline reads: tree-sitter precision first,
// the line-based engine as the deterministic backstop (any wasm failure
// degrades to it transparently). Graph builders (repo map / calltree) keep
// the sync line engine for speed.
async function extractOutlineEx(filePath, source, options = {}) {
  try {
    if (!wasmBackend) wasmBackend = require('./outline-wasm');
    if (wasmBackend.isAvailable()) {
      const result = await wasmBackend.extractOutlineWasm(filePath, source, options);
      if (result) return result;
    }
  } catch {}
  return { ...extractOutline(filePath, source, options), backend: 'line' };
}

module.exports = {
  CODE_EXTENSIONS,
  detectLanguage,
  extractOutline,
  extractOutlineEx,
  findSymbol
};
