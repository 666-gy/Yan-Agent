/* Yan Agent — code understanding (renderer bridge + local outline) */
(function (K) {
  'use strict';

  const EXT_LANG = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', go: 'go', rs: 'rust', java: 'java', cs: 'csharp'
  };

  const OUTLINE_RULES = {
    javascript: [
      { kind: 'class', re: /^(?:export\s+default\s+)?(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'function', re: /^(?:export\s+default\s+)?(?:export\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(/ },
      { kind: 'function', re: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/ },
      { kind: 'const', re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/ },
      { kind: 'interface', re: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'type', re: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ }
    ],
    typescript: [
      { kind: 'class', re: /^(?:export\s+default\s+)?(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'function', re: /^(?:export\s+default\s+)?(?:export\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*[<(]/ },
      { kind: 'function', re: /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/ },
      { kind: 'interface', re: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ }
    ],
    python: [
      { kind: 'class', re: /^class\s+([A-Za-z_][\w]*)\s*[(:]/ },
      { kind: 'function', re: /^(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/ }
    ]
  };

  const DEFAULT_CODE_EXTENSIONS = [
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'kt',
    'cs', 'cpp', 'h', 'rb', 'php', 'vue', 'svelte', 'html', 'css', 'json', 'md'
  ];

  const CODE_EXPLORE_TOOLS = new Set([
    'read_file', 'read_file_range', 'list_directory', 'search_files',
    'get_file_outline', 'get_file_imports', 'find_symbol', 'find_references',
    'search_symbols', 'find_related_files', 'scan_project', 'build_code_index',
    'trace_symbol', 'git_status', 'git_diff', 'git_log'
  ]);

  function detectLanguage(filePath) {
    const ext = String(filePath || '').split('.').pop().toLowerCase();
    return EXT_LANG[ext] || 'unknown';
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
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
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

  function formatOutline(filePath, outline) {
    if (!outline.symbols.length) {
      return `No symbols extracted from ${filePath} (${outline.language}, ${outline.lineCount} lines). Try read_file_range or get_file_imports.`;
    }
    const header = `## Outline: ${filePath} (${outline.language}, ${outline.lineCount} lines, ${outline.symbols.length} symbols)`;
    const body = outline.symbols.map(s => `L${s.line} [${s.kind}] ${s.name} — ${s.preview}`).join('\n');
    return `${header}\n${body}`;
  }

  function formatSymbolHits(symbol, hits) {
    if (!hits.length) {
      return `No definitions found for "${symbol}". Try search_symbols or build_code_index.`;
    }
    const header = `## Definitions of "${symbol}" (${hits.length})`;
    const body = hits.map(h => `${h.path || h.relPath}:${h.line} [${h.kind || 'symbol'}] ${h.preview || ''}`).join('\n');
    return `${header}\n${body}`;
  }

  function formatReferenceHits(symbol, hits) {
    if (!hits.length) return `No references found for "${symbol}".`;
    const header = `## References to "${symbol}" (${hits.length})`;
    const body = hits.map(h => `${h.path}:${h.line}: ${h.preview}`).join('\n');
    return `${header}\n${body}`;
  }

  function formatSymbolSearch(hits, query) {
    if (!hits.length) return `No symbols matching "${query}".`;
    const header = `## Symbols matching "${query}" (${hits.length})`;
    const body = hits.map(h => `${h.path}:${h.line} [${h.kind}] ${h.name} — ${h.preview || ''}`).join('\n');
    return `${header}\n${body}`;
  }

  function formatImports(path, data) {
    const lines = [`## Imports/Exports: ${path} (${data.language || '?'}, ${data.lineCount || '?'} lines)`];
    if (data.imports?.length) lines.push('Imports:\n' + data.imports.map(i => `- ${i}`).join('\n'));
    else lines.push('Imports: (none detected)');
    if (data.exports?.length) lines.push('Exports:\n' + data.exports.map(e => `- ${e}`).join('\n'));
    else lines.push('Exports: (none detected)');
    return lines.join('\n\n');
  }

  function formatRelated(data) {
    const lines = [`## Related files: ${data.path}`];
    if (data.imports?.length) {
      lines.push('Imports (' + data.imports.length + '):\n' + data.imports.map(i => `- ${i.spec} → ${i.path}`).join('\n'));
    }
    if (data.importedBy?.length) {
      lines.push('Imported by (' + data.importedBy.length + '):\n' + data.importedBy.map(i => `- ${i.path} (${i.spec})`).join('\n'));
    }
    if (data.symbols?.length) {
      lines.push('Symbols: ' + data.symbols.slice(0, 12).map(s => s.name).join(', ') + (data.symbols.length > 12 ? '…' : ''));
    }
    if (!data.imports?.length && !data.importedBy?.length) lines.push('No import relationships detected. Run build_code_index first.');
    return lines.join('\n\n');
  }

  function formatTrace(data) {
    const lines = [`## Trace: ${data.name}`, `Definitions: ${data.definitionCount}, References: ${data.referenceCount}`];
    if (data.definitions?.length) {
      lines.push('Definitions:\n' + data.definitions.map(d => `- ${d.path}:${d.line} [${d.kind}] ${d.preview || ''}`).join('\n'));
    }
    if (data.references?.length) {
      lines.push('References (sample):\n' + data.references.slice(0, 20).map(r => `- ${r.path}:${r.line}: ${r.preview}`).join('\n'));
    }
    return lines.join('\n\n');
  }

  function formatSearchResults(results) {
    if (!results.length) return 'No matches found.';
    return results.map(r => {
      let block = `${r.path}:${r.line}: ${r.content}`;
      if (r.contextBefore?.length) block = r.contextBefore.map((l, i) => `  ${r.line - r.contextBefore.length + i}|${l}`).join('\n') + '\n' + block;
      if (r.contextAfter?.length) block += '\n' + r.contextAfter.map((l, i) => `  ${r.line + 1 + i}|${l}`).join('\n');
      return block;
    }).join('\n---\n');
  }

  async function findSymbolDefinitions(symbol, options = {}) {
    const api = () => K._deps.api;
    const name = String(symbol || '').trim();
    if (!name) return { hits: [], error: 'symbol name is required' };
    const res = await api().codeFindSymbol({ name, kind: options.kind });
    if (res.error) return { hits: [], error: res.error };
    return { hits: res.hits || [], fromIndex: true };
  }

  async function ensureCodeIndex(force = false) {
    const api = () => K._deps.api;
    return api().buildCodeIndex({ force });
  }

  K.detectLanguage = detectLanguage;
  K.outlineFile = outlineFile;
  K.formatOutline = formatOutline;
  K.findSymbolDefinitions = findSymbolDefinitions;
  K.formatSymbolHits = formatSymbolHits;
  K.formatReferenceHits = formatReferenceHits;
  K.formatSymbolSearch = formatSymbolSearch;
  K.formatImports = formatImports;
  K.formatRelated = formatRelated;
  K.formatTrace = formatTrace;
  K.formatSearchResults = formatSearchResults;
  K.ensureCodeIndex = ensureCodeIndex;
  K.DEFAULT_CODE_EXTENSIONS = DEFAULT_CODE_EXTENSIONS;
  K.CODE_EXPLORE_TOOLS = CODE_EXPLORE_TOOLS;

})(window.YanKernel);
