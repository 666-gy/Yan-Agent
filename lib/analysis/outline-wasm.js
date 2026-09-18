'use strict';

// Tree-sitter (WASM) outline backend. Loaded lazily so the MCP process only
// pays the grammar cost when `code_outline` / `code_symbol` actually run.
// Output shape matches the line-based engine in outline.js exactly:
// { language, symbols: [{ name, kind, line, endLine }] } with 1-based
// inclusive ranges, plus `backend: 'tree-sitter'`. Returns null when the
// file has no installed grammar so callers can fall back deterministically.

const path = require('path');

let parserInstance = null;
let parserInitPromise = null;
const languageCache = new Map(); // grammar id -> Language

const GRAMMAR_BY_EXTENSION = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts',
  '.py', '.pyi',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.hh', '.hxx',
  '.java', '.go', '.rs'
]);

const JS_GRAMMARS = [
  { id: 'typescript', wasm: 'tree-sitter-typescript/tree-sitter-tsx.wasm', extensions: ['.tsx'] },
  { id: 'typescript', wasm: 'tree-sitter-typescript/tree-sitter-typescript.wasm', extensions: ['.ts', '.mts', '.cts'] },
  { id: 'javascript', wasm: 'tree-sitter-javascript/tree-sitter-javascript.wasm', extensions: ['.js', '.mjs', '.cjs', '.jsx'] }
];

const BRACE_GRAMMARS = [
  { id: 'cpp', wasm: 'tree-sitter-cpp/tree-sitter-cpp.wasm', extensions: ['.cc', '.cpp', '.hpp', '.hh', '.hxx'] },
  { id: 'c', wasm: 'tree-sitter-c/tree-sitter-c.wasm', extensions: ['.c', '.h'] },
  { id: 'java', wasm: 'tree-sitter-java/tree-sitter-java.wasm', extensions: ['.java'] },
  { id: 'go', wasm: 'tree-sitter-go/tree-sitter-go.wasm', extensions: ['.go'] },
  { id: 'rust', wasm: 'tree-sitter-rust/tree-sitter-rust.wasm', extensions: ['.rs'] }
];

const PYTHON_GRAMMAR = { id: 'python', wasm: 'tree-sitter-python/tree-sitter-python.wasm', extensions: ['.py', '.pyi'] };

function grammarFor(filePath) {
  const extension = String(filePath || '').slice(String(filePath || '').lastIndexOf('.')).toLowerCase();
  if (!GRAMMAR_BY_EXTENSION.has(extension)) return null;
  for (const grammar of [...JS_GRAMMARS, PYTHON_GRAMMAR, ...BRACE_GRAMMARS]) {
    if (grammar.extensions.includes(extension)) return grammar;
  }
  return null;
}

async function ensureParser() {
  if (parserInstance) return parserInstance;
  if (!parserInitPromise) {
    parserInitPromise = (async () => {
      const { Parser } = require('web-tree-sitter');
      await Parser.init();
      parserInstance = new Parser();
      return parserInstance;
    })();
  }
  return parserInitPromise;
}

async function loadLanguage(grammar) {
  if (languageCache.has(grammar.id)) return languageCache.get(grammar.id);
  const { Language } = require('web-tree-sitter');
  const wasmPath = path.join(process.cwd(), 'node_modules', grammar.wasm);
  const language = await Language.load(wasmPath);
  languageCache.set(grammar.id, language);
  return language;
}

function inclusiveEndLine(node) {
  // tree-sitter endPosition is 0-based and points just past the node.
  return node.endPosition.column === 0 ? node.endPosition.row : node.endPosition.row + 1;
}

function kindOf(nodeType) {
  if (/class|struct|interface|enum|impl|trait|record/.test(nodeType)) return 'class';
  if (/method/.test(nodeType)) return 'method';
  return 'function';
}

// JS/TS: explicit handling for declarations, methods, and arrow/function
// variable initializers (the shapes agents actually navigate).
function collectJs(node, symbols, className, depth) {
  if (depth > 40 || symbols.length >= 400) return;
  switch (node.type) {
    case 'class_declaration':
    case 'abstract_class_declaration': {
      const name = node.childForFieldName('name')?.text || '';
      if (name) symbols.push({ name: className ? `${className}.${name}` : name, kind: 'class', line: node.startPosition.row + 1, endLine: inclusiveEndLine(node) });
      for (const child of node.children) collectJs(child, symbols, className ? `${className}.${name}` : name, depth + 1);
      return;
    }
    case 'function_declaration':
    case 'function_signature':
    case 'generator_function_declaration': {
      const name = node.childForFieldName('name')?.text || '';
      if (name) symbols.push({ name: className ? `${className}.${name}` : name, kind: 'function', line: node.startPosition.row + 1, endLine: inclusiveEndLine(node) });
      return;
    }
    case 'method_definition':
    case 'method_signature':
    case 'abstract_method_signature': {
      const name = node.childForFieldName('name')?.text || '';
      if (name) symbols.push({ name: className ? `${className}.${name}` : name, kind: 'method', line: node.startPosition.row + 1, endLine: inclusiveEndLine(node) });
      return;
    }
    case 'lexical_declaration':
    case 'variable_declaration': {
      for (const declarator of node.children.filter(child => child.type === 'variable_declarator')) {
        const name = declarator.childForFieldName('name')?.text || '';
        const value = declarator.childForFieldName('value');
        if (!name || !value) continue;
        if (/arrow_function|function_expression|function\b/.test(value.type)) {
          symbols.push({ name: className ? `${className}.${name}` : name, kind: 'function', line: node.startPosition.row + 1, endLine: inclusiveEndLine(value) });
        }
      }
      return;
    }
    default:
      for (const child of node.children) collectJs(child, symbols, className, depth + 1);
  }
}

function collectPython(node, symbols, className, depth) {
  if (depth > 40 || symbols.length >= 400) return;
  if (node.type === 'decorated_definition') {
    for (const child of node.children) collectPython(child, symbols, className, depth + 1);
    return;
  }
  if (node.type === 'class_definition' || node.type === 'function_definition') {
    const name = node.childForFieldName('name')?.text || '';
    if (name) {
      const kind = node.type === 'class_definition' ? 'class' : 'function';
      symbols.push({ name: className ? `${className}.${name}` : name, kind, line: node.startPosition.row + 1, endLine: inclusiveEndLine(node) });
      if (kind === 'class') {
        for (const child of node.children) collectPython(child, symbols, `${className ? `${className}.` : ''}${name}`, depth + 1);
        return;
      }
    }
    return;
  }
  for (const child of node.children) collectPython(child, symbols, className, depth + 1);
}

// Brace family generic pass: any definition-ish node with a name field.
function collectGeneric(node, symbols, depth) {
  if (depth > 60 || symbols.length >= 400) return;
  if (/^(?:class|struct|interface|enum|impl|trait|record)_\w*(?:definition|declaration|specifier|item)$/.test(node.type)
      || /^(?:function|method)_\w*(?:definition|declaration|item)$/.test(node.type)
      || /^function_item$/.test(node.type)) {
    const name = node.childForFieldName('name')?.text || '';
    if (name) symbols.push({ name, kind: kindOf(node.type), line: node.startPosition.row + 1, endLine: inclusiveEndLine(node) });
    return;
  }
  for (const child of node.children) collectGeneric(child, symbols, depth + 1);
}

// Returns { language, symbols, backend: 'tree-sitter' } or null when no
// grammar is installed for the file type (or anything fails to load).
async function extractOutlineWasm(filePath, source, { maxSymbols = 400 } = {}) {
  const grammar = grammarFor(filePath);
  if (!grammar) return null;
  try {
    const parser = await ensureParser();
    const language = await loadLanguage(grammar);
    parser.setLanguage(language);
    const tree = parser.parse(String(source || ''));
    const symbols = [];
    if (grammar.id === 'python') collectPython(tree.rootNode, symbols, '', 0);
    else if (grammar.id === 'javascript' || grammar.id === 'typescript') collectJs(tree.rootNode, symbols, '', 0);
    else collectGeneric(tree.rootNode, symbols, 0);
    return { language: grammar.id, symbols: symbols.slice(0, maxSymbols), backend: 'tree-sitter' };
  } catch {
    return null;
  }
}

function isAvailable() {
  try {
    require('web-tree-sitter');
    return true;
  } catch {
    return false;
  }
}

module.exports = { extractOutlineWasm, isAvailable, grammarFor };
