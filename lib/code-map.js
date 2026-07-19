/**
 * Workspace code-map builder.
 *
 * Produces a cached hierarchy of directories, files, symbols, and relationships.
 * Local parsing is always available; optional AI enrichment only refreshes files
 * whose content hash changed.
 */
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const codeIndex = require('./code-index');

const CACHE_SCHEMA = 1;
const SUMMARY_VERSION = 2;
const DEFAULT_MAX_FILES = 600;
const MAX_SYMBOLS_PER_FILE = 24;
const VECTOR_DIMENSIONS = 96;
const AI_BATCH_SIZE = 6;

function cachePath(workspace) {
  return path.join(workspace, '.yanagent', 'code-map', 'cache.json');
}

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function stableId(kind, value) {
  return `${kind}_${sha1(String(value)).slice(0, 14)}`;
}

function normalizeRel(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

async function readCache(workspace) {
  try {
    const data = JSON.parse(await fsp.readFile(cachePath(workspace), 'utf8'));
    if (data.schema !== CACHE_SCHEMA || data.workspace !== workspace) return null;
    return data;
  } catch {
    return null;
  }
}

async function writeCache(workspace, data) {
  const target = cachePath(workspace);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, JSON.stringify(data), 'utf8');
}

function splitIdentifier(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  const normalized = splitIdentifier(value).toLowerCase();
  const latin = normalized.match(/[a-z][a-z0-9]{1,}/g) || [];
  const chineseRuns = normalized.match(/[\u3400-\u9fff]+/g) || [];
  const chinese = [];
  for (const run of chineseRuns) {
    if (run.length === 1) chinese.push(run);
    for (let i = 0; i < run.length - 1; i++) chinese.push(run.slice(i, i + 2));
  }
  return [...latin, ...chinese];
}

function hashToken(token) {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildVector(value) {
  const vector = Array(VECTOR_DIMENSIONS).fill(0);
  for (const token of tokenize(value)) {
    const idx = hashToken(token) % VECTOR_DIMENSIONS;
    vector[idx] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0)) || 1;
  return vector.map(n => Number((n / norm).toFixed(5)));
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  let value = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) value += a[i] * b[i];
  return value;
}

const DIRECTORY_ROLES = {
  src: '主要业务源码',
  app: '应用入口与业务模块',
  renderer: '渲染进程与界面逻辑',
  main: '主进程或应用入口',
  lib: '共享库与核心能力',
  core: '核心领域逻辑',
  kernel: 'Agent 内核与执行循环',
  components: '可复用界面组件',
  views: '页面与视图',
  pages: '页面级模块',
  assets: '图片、字体等静态资源',
  styles: '样式与主题资源',
  test: '自动化测试',
  tests: '自动化测试',
  scripts: '开发、构建和维护脚本',
  docs: '项目文档',
  config: '项目配置',
  public: '公开静态资源',
  api: '接口与服务端路由',
  server: '服务端实现',
  client: '客户端实现',
  utils: '通用工具函数',
  hooks: '可复用状态与生命周期逻辑'
};

function directorySummary(relPath, directFiles, totalFiles) {
  const name = path.posix.basename(relPath).toLowerCase();
  const role = DIRECTORY_ROLES[name] || '组织相关代码与资源';
  const count = totalFiles === directFiles
    ? `${totalFiles} 个文件`
    : `${totalFiles} 个文件，其中 ${directFiles} 个直属文件`;
  return `${role}，包含 ${count}。`;
}

function fileSummary(relPath, analysis) {
  const name = path.posix.basename(relPath);
  const lower = name.toLowerCase();
  const symbols = analysis.symbols || [];
  const names = symbols.slice(0, 4).map(s => s.name);
  const symbolText = names.length ? `主要定义 ${names.join('、')}` : '';
  const importText = analysis.imports?.length ? `依赖 ${analysis.imports.length} 个模块` : '';
  let role = '';

  if (lower === 'package.json') role = '项目依赖、脚本和构建元数据';
  else if (/^readme(?:\.|$)/i.test(name)) role = '项目说明和使用文档';
  else if (/\.test\.|\.spec\.|(^|[-_.])test(s)?\b/i.test(lower)) role = '自动化测试与行为验证';
  else if (lower === 'main.js' || lower === 'main.ts') role = '应用主入口与运行时协调';
  else if (lower.startsWith('preload.')) role = 'Electron 主进程与页面之间的安全桥接';
  else if (lower === 'index.html') role = '页面结构和静态挂载点';
  else if (/\.(css|scss|less)$/.test(lower)) role = '界面布局、主题和组件样式';
  else if (/\.(md|mdx)$/.test(lower)) role = '设计、使用或维护文档';
  else if (/config|settings?/.test(lower)) role = '运行配置和选项定义';
  else if (/route|router/.test(lower)) role = '请求路由与页面导航';
  else if (/store|state/.test(lower)) role = '应用状态管理';
  else if (/util|helper/.test(lower)) role = '共享工具与辅助逻辑';
  else role = `${analysis.language || '代码'} 模块`;

  return [role, symbolText, importText].filter(Boolean).join('；') + '。';
}

const SYMBOL_KIND_LABELS = {
  class: '类', function: '函数', method: '方法', interface: '接口',
  type: '类型', enum: '枚举', struct: '结构体', const: '常量', module: '模块'
};

const SYMBOL_NAME_ROLE_RULES = [
  { test: /password|secret|credential|encrypt|hash|salt|strength|generator/, role: '密码生成、校验或强度规则' },
  { test: /checkbox|checkbutton|radio|radiobutton|button|slider|spinbox|combobox|dropdown|menu|toolbar|dialog|modal|window|frame|widget|canvas|scroll/, role: '界面控件或窗口组件' },
  { test: /label|text|caption|title|heading|hint|placeholder|messagebox/, role: '界面文本与提示展示' },
  { test: /style|theme|color|font|layout|skin|css|appearance|ttk/, role: '界面样式、布局或主题配置' },
  { test: /clipboard|copy_to|paste|drag|drop/, role: '剪贴板或拖拽交互' },
  { test: /render|draw|paint|display|show|view|preview|plot|chart/, role: '渲染与可视化展示' },
  { test: /fetch|load|read|get|list|query|search|find|lookup|scan/, role: '读取、查询或检索数据' },
  { test: /save|write|persist|store|export|dump|serialize/, role: '保存、写入或导出数据' },
  { test: /update|set|apply|sync|refresh|patch|edit|toggle/, role: '更新状态或同步变更' },
  { test: /parse|extract|decode|compile|tokenize|lex|analyze/, role: '解析、提取或分析输入' },
  { test: /format|normalize|convert|transform|map|translate|encode/, role: '格式化、转换或映射数据' },
  { test: /validate|verify|assert|ensure|check/, role: '校验条件、规则或状态' },
  { test: /handle|process|run|execute|perform|invoke|dispatch|callback|worker|task/, role: '处理事件或执行流程' },
  { test: /create|build|make|generate|construct|factory|spawn|produce/, role: '创建对象或生成结果' },
  { test: /open|close|start|stop|remove|delete|destroy|cleanup|dispose|clear|reset/, role: '资源或生命周期的开关与清理' },
  { test: /bind|connect|attach|listen|subscribe|register|hook|signal/, role: '绑定事件、依赖或回调' },
  { test: /route|navigate|redirect|path|url|link|router/, role: '路由、跳转或链接处理' },
  { test: /config|option|setting|preference|param|argument|env/, role: '配置项或参数定义' },
  { test: /log|debug|trace|metric|monitor|report|audit/, role: '日志、调试或监控输出' },
  { test: /test|mock|fixture|stub|fake|spec/, role: '测试辅助或模拟数据' },
  { test: /copy|clone|duplicate|mirror|fork/, role: '复制或克隆对象' },
  { test: /sort|filter|group|aggregate|reduce|merge|split|join/, role: '集合整理与数据聚合' },
  { test: /import|require|include|extend|inherit|mixin|implement/, role: '模块引入或继承关系' },
  { test: /random|shuffle|sample|pick|choose|uuid|token/, role: '随机选择或标识生成' },
  { test: /setup|configure|bootstrap|install|prepare|init/, role: '初始化与环境配置' }
];

function bareSymbolName(name) {
  return String(name || '').replace(/^[_$]+/, '');
}

function symbolTokenText(name) {
  return splitIdentifier(bareSymbolName(name)).toLowerCase();
}

function inferRoleFromPreview(preview, kind) {
  const line = String(preview || '');
  if (!line) return '';
  if (/tkinter|tk\.|ttk\.|Qt|QWidget|wx\./i.test(line)) {
    if (/Label|Text|title/i.test(line)) return '创建或配置界面文本控件';
    if (/Checkbutton|Checkbox|Radiobutton|Button|Entry|Spinbox/i.test(line)) return '创建或配置可交互界面控件';
    if (/Frame|Window|Toplevel|Canvas|Paned|Notebook/i.test(line)) return '创建或管理界面容器';
    if (/Style|theme|configure/i.test(line)) return '设置界面样式或主题';
    return '构建桌面界面组件';
  }
  if (/def __init__|constructor/i.test(line) && (kind === 'method' || kind === 'function')) return '初始化实例状态与默认值';
  if (/async def|Promise|await /i.test(line)) return '异步流程处理';
  if (/return self|-> self/i.test(line) && kind === 'method') return '链式配置当前实例';
  if (/\bself,\s*parent\b/i.test(line)) return '在父容器中组装界面元素';
  if (/->\s*str|->\s*int|->\s*bool|->\s*list|->\s*dict/i.test(line)) return '封装并返回结构化结果';
  return '';
}

function inferRoleFromName(name) {
  const bare = bareSymbolName(name);
  const lower = bare.toLowerCase();
  const tokenText = symbolTokenText(name);
  const haystack = `${lower} ${tokenText}`;

  for (const rule of SYMBOL_NAME_ROLE_RULES) {
    if (rule.test.test(haystack)) return rule.role;
  }

  const prefixRules = [
    [/^(get|read|load|fetch|find|search|list|query)/, '读取或查询'],
    [/^(make|create|build|generate|new)/, '创建或生成'],
    [/^(set|update|apply|sync|refresh)/, '更新或同步'],
    [/^(render|show|display|draw|paint)/, '展示或渲染'],
    [/^(validate|verify|check|is|has|can|should)/, '校验或判断'],
    [/^(handle|process|run|execute|on)/, '执行或响应'],
    [/^(parse|extract|decode|compile)/, '解析或提取'],
    [/^(open|close|start|stop|remove|delete)/, '开启、关闭或清理'],
    [/^(setup|init|configure|prepare)/, '初始化与配置'],
    [/^(bind|connect|register|listen)/, '绑定与注册']
  ];
  for (const [pattern, verb] of prefixRules) {
    if (pattern.test(lower)) {
      const rest = splitIdentifier(bare.replace(pattern, '')).trim();
      return rest ? `${verb}${rest}` : verb;
    }
  }

  const tokens = tokenText.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) return `围绕 ${tokens.slice(0, 3).join('、')} 的实现`;
  if (tokens.length === 1) return `围绕 ${tokens[0]} 的实现逻辑`;
  return '封装该符号的具体职责';
}

function symbolSummary(symbol) {
  const kind = SYMBOL_KIND_LABELS[symbol.kind] || '符号';
  const name = symbol.name || '(未命名)';
  const role = inferRoleFromPreview(symbol.preview, symbol.kind) || inferRoleFromName(name);
  return `${kind} ${name}：${role}。`;
}

function summarizeCodeBlock(chunk, startLine, endLine) {
  const sample = chunk.map(line => line.trim()).filter(line => {
    if (!line) return false;
    return !line.startsWith('#') && !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*');
  }).slice(0, 6).join(' ');
  const classMatch = sample.match(/\bclass\s+([A-Za-z_]\w*)/);
  if (classMatch) return `定义类 ${classMatch[1]}（第 ${startLine}-${endLine} 行）。`;
  const defMatch = sample.match(/\b(?:async\s+)?def\s+([A-Za-z_]\w*)/);
  if (defMatch) return `实现 ${defMatch[1]} 等方法（第 ${startLine}-${endLine} 行）。`;
  const fnMatch = sample.match(/\bfunction\s+([A-Za-z_$]\w*)/);
  if (fnMatch) return `实现函数 ${fnMatch[1]}（第 ${startLine}-${endLine} 行）。`;
  if (/import |from /.test(sample)) return `组织依赖与模块引用（第 ${startLine}-${endLine} 行）。`;
  return `涵盖第 ${startLine}-${endLine} 行的连续实现。`;
}

function buildCodeBlocks(content, relPath) {
  const lines = String(content || '').split('\n');
  if (lines.length < 8) return [];
  const blocks = [];
  const chunkSize = 60;
  for (let start = 0; start < lines.length && blocks.length < 12; start += chunkSize) {
    const end = Math.min(lines.length, start + chunkSize);
    const chunk = lines.slice(start, end);
    if (!chunk.some(line => line.trim() && !line.trim().startsWith('//') && !line.trim().startsWith('#'))) continue;
    blocks.push({
      id: stableId('block', `${relPath}:${start + 1}:${sha1(chunk.join('\n')).slice(0, 10)}`),
      kind: 'code-block',
      name: `第 ${start + 1}-${end} 行`,
      line: start + 1,
      endLine: end,
      preview: codeIndex.clipLine(chunk.find(line => line.trim()) || '', 100),
      summary: summarizeCodeBlock(chunk, start + 1, end)
    });
  }
  return blocks;
}

function analyzeFile(content, relPath) {
  const fullHint = relPath;
  const outline = codeIndex.outlineFile(content, fullHint);
  const io = codeIndex.extractImportsExports(content, fullHint);
  const symbols = outline.symbols.slice(0, MAX_SYMBOLS_PER_FILE).map((symbol, index, all) => ({
    ...symbol,
    id: stableId('symbol', `${relPath}:${symbol.kind}:${symbol.name}:${symbol.line}`),
    endLine: Math.max(symbol.line, (all[index + 1]?.line || outline.lineCount + 1) - 1),
    summary: symbolSummary(symbol)
  }));
  const blocks = symbols.length ? [] : buildCodeBlocks(content, relPath);
  const analysis = {
    language: outline.language,
    lineCount: outline.lineCount,
    imports: io.imports,
    exports: io.exports,
    symbols,
    blocks,
    sourceExcerpt: String(content || '').slice(0, 1800)
  };
  analysis.localSummary = fileSummary(relPath, analysis);
  analysis.vector = buildVector([
    relPath,
    analysis.localSummary,
    ...symbols.map(s => `${s.kind} ${s.name} ${s.preview}`),
    ...io.imports,
    ...io.exports,
    String(content || '').slice(0, 5000)
  ].join('\n'));
  return analysis;
}

function resolveImport(records, fromRelPath, importPath) {
  const spec = String(importPath || '').replace(/\\/g, '/').trim();
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRelPath), spec));
  const tries = [
    base, `${base}.js`, `${base}.ts`, `${base}.tsx`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`,
    `${base}.py`, `${base}/index.js`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/__init__.py`
  ];
  return tries.find(candidate => records[candidate]) || null;
}

async function collectFileRecords(workspace, previous, options = {}) {
  const files = await codeIndex.walkCodeFiles(workspace, {
    maxFiles: options.maxFiles || DEFAULT_MAX_FILES,
    maxDepth: options.maxDepth || 10,
    maxFileSize: options.maxFileSize || 512 * 1024,
    skipDirs: ['backup'],
    skipPaths: ['lib/ui-kits']
  });
  const records = {};
  const stats = { scanned: files.length, reused: 0, changed: 0, removed: 0 };
  const previousFiles = previous?.files || {};

  for (const file of files) {
    const relPath = normalizeRel(file.relPath);
    const old = previousFiles[relPath];
    if (!options.force && old && old.mtime === file.mtime && old.size === file.size && old.summaryVersion === SUMMARY_VERSION) {
      records[relPath] = old;
      stats.reused++;
      continue;
    }

    let content;
    try { content = await fsp.readFile(file.fullPath, 'utf8'); }
    catch { continue; }
    const hash = sha1(content);
    if (!options.force && old && old.hash === hash && old.summaryVersion === SUMMARY_VERSION) {
      records[relPath] = { ...old, mtime: file.mtime, size: file.size };
      stats.reused++;
      continue;
    }

    records[relPath] = {
      relPath,
      mtime: file.mtime,
      size: file.size,
      hash,
      summaryVersion: SUMMARY_VERSION,
      aiHash: null,
      aiSummary: null,
      ...analyzeFile(content, relPath)
    };
    stats.changed++;
  }

  for (const relPath of Object.keys(previousFiles)) {
    if (!records[relPath]) stats.removed++;
  }
  return { records, stats, truncated: files.length >= (options.maxFiles || DEFAULT_MAX_FILES) };
}

function createDirectoryData(records) {
  const dirs = new Map();
  const ensure = relPath => {
    const normalized = normalizeRel(relPath).replace(/\/$/, '');
    if (!normalized) return null;
    if (!dirs.has(normalized)) dirs.set(normalized, { relPath: normalized, directFiles: 0, totalFiles: 0 });
    return dirs.get(normalized);
  };

  for (const relPath of Object.keys(records)) {
    const parts = relPath.split('/');
    const direct = parts.slice(0, -1).join('/');
    if (direct) ensure(direct).directFiles++;
    for (let i = 1; i < parts.length; i++) ensure(parts.slice(0, i).join('/')).totalFiles++;
  }
  return dirs;
}

function buildGraph(workspace, records, stats, truncated) {
  const metadata = codeIndex.scanProjectMetadata(workspace);
  const rootId = stableId('workspace', workspace);
  const nodes = [];
  const edges = [];
  const dirs = createDirectoryData(records);
  const files = Object.values(records);
  const languageCounts = {};
  let symbolCount = 0;

  for (const record of files) {
    languageCounts[record.language] = (languageCounts[record.language] || 0) + 1;
    symbolCount += record.symbols?.length || 0;
  }
  const leadingLanguages = Object.entries(languageCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
  const frameworkText = metadata.frameworks.length ? metadata.frameworks.join('、') : metadata.type;
  nodes.push({
    id: rootId,
    kind: 'workspace',
    title: metadata.name || path.basename(workspace),
    path: workspace,
    relPath: '',
    parentId: null,
    summary: `${frameworkText || '代码'}项目，包含 ${files.length} 个代码文件和 ${symbolCount} 个可视化符号。`,
    meta: { languages: leadingLanguages, fileCount: files.length, symbolCount, entries: metadata.entries || [] },
    childCount: [...dirs.values()].filter(d => !d.relPath.includes('/')).length + files.filter(f => !f.relPath.includes('/')).length
  });

  const dirIds = new Map();
  for (const dir of [...dirs.values()].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    const id = stableId('directory', `${workspace}:${dir.relPath}`);
    dirIds.set(dir.relPath, id);
    const parentRel = path.posix.dirname(dir.relPath) === '.' ? '' : path.posix.dirname(dir.relPath);
    const parentId = parentRel ? dirIds.get(parentRel) : rootId;
    nodes.push({
      id,
      kind: 'directory',
      title: path.posix.basename(dir.relPath),
      path: path.join(workspace, dir.relPath),
      relPath: dir.relPath,
      parentId,
      summary: directorySummary(dir.relPath, dir.directFiles, dir.totalFiles),
      meta: { fileCount: dir.totalFiles, directFiles: dir.directFiles },
      childCount: [...dirs.values()].filter(d => path.posix.dirname(d.relPath) === dir.relPath).length + dir.directFiles
    });
    edges.push({ id: stableId('edge', `${parentId}:${id}:contains`), from: parentId, to: id, kind: 'contains' });
  }

  const fileIds = new Map();
  for (const record of files.sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    const id = stableId('file', `${workspace}:${record.relPath}`);
    fileIds.set(record.relPath, id);
    const parentRel = path.posix.dirname(record.relPath) === '.' ? '' : path.posix.dirname(record.relPath);
    const parentId = parentRel ? dirIds.get(parentRel) : rootId;
    const symbols = (record.symbols || []).slice(0, MAX_SYMBOLS_PER_FILE).map(item => ({
      id: item.id,
      kind: item.kind || 'symbol',
      name: item.name,
      title: item.name,
      summary: item.summary || symbolSummary(item),
      line: item.line,
      endLine: item.endLine,
      preview: item.preview || ''
    }));
    const previewLine = symbols[0]?.preview || codeIndex.clipLine(String(record.sourceExcerpt || '').split('\n').find(l => l.trim()) || '', 96);
    nodes.push({
      id,
      kind: 'file',
      title: path.posix.basename(record.relPath),
      path: path.join(workspace, record.relPath),
      relPath: record.relPath,
      parentId,
      summary: record.aiHash === record.hash && record.aiSummary ? record.aiSummary : record.localSummary,
      meta: {
        language: record.language,
        lineCount: record.lineCount,
        size: record.size,
        imports: record.imports?.length || 0,
        exports: record.exports?.length || 0,
        summarySource: record.aiHash === record.hash && record.aiSummary ? 'ai' : 'local',
        preview: previewLine,
        symbols
      },
      childCount: symbols.length
    });
    edges.push({ id: stableId('edge', `${parentId}:${id}:contains`), from: parentId, to: id, kind: 'contains' });
  }

  for (const record of files) {
    const fromId = fileIds.get(record.relPath);
    for (const spec of record.imports || []) {
      const targetRel = resolveImport(records, record.relPath, spec);
      const toId = targetRel ? fileIds.get(targetRel) : null;
      if (!toId || toId === fromId) continue;
      edges.push({ id: stableId('edge', `${fromId}:${toId}:imports`), from: fromId, to: toId, kind: 'imports' });
    }
  }

  if (files.length <= 200) {
    for (let i = 0; i < files.length; i++) {
      let best = null;
      for (let j = 0; j < files.length; j++) {
        if (i === j) continue;
        const score = cosine(files[i].vector, files[j].vector);
        if (score >= 0.74 && (!best || score > best.score)) best = { record: files[j], score };
      }
      if (!best) continue;
      const from = fileIds.get(files[i].relPath);
      const to = fileIds.get(best.record.relPath);
      const pair = [from, to].sort().join(':');
      if (!edges.some(edge => edge.kind === 'related' && [edge.from, edge.to].sort().join(':') === pair)) {
        edges.push({ id: stableId('edge', `${pair}:related`), from, to, kind: 'related', weight: Number(best.score.toFixed(3)) });
      }
    }
  }

  return {
    schema: CACHE_SCHEMA,
    workspace,
    rootId,
    builtAt: Date.now(),
    nodes,
    edges,
    stats: {
      ...stats,
      files: files.length,
      symbols: symbolCount,
      directories: dirs.size,
      aiPending: files.filter(record => record.aiHash !== record.hash).length,
      truncated
    }
  };
}

async function buildCodeMap(workspace, options = {}) {
  const resolved = path.resolve(String(workspace || ''));
  if (!workspace || !fs.existsSync(resolved)) throw new Error('Workspace does not exist.');
  const previous = await readCache(resolved);
  const { records, stats, truncated } = await collectFileRecords(resolved, previous, options);
  const cache = {
    schema: CACHE_SCHEMA,
    workspace: resolved,
    builtAt: Date.now(),
    files: records
  };
  await writeCache(resolved, cache);
  return buildGraph(resolved, records, stats, truncated);
}

function selectAnalysisApi(config, options = {}) {
  const codeMapApi = options.codeMapApi;
  if (codeMapApi?.api) return codeMapApi.api;

  const modelId = config?.codeMap?.model || config?.api?.model || 'deepseek-v4-flash';
  const providers = options.providers;
  if (providers) {
    for (const [providerId, provider] of Object.entries(providers)) {
      if (!provider?.models?.some(item => item.id === modelId)) continue;
      const apiKey = config?.api?.apiKeys?.[providerId] || '';
      if (!apiKey || !provider.baseUrl) return null;
      return { apiKey, baseUrl: provider.baseUrl, model: modelId };
    }
    return null;
  }

  const api = config?.api || {};
  if (!api.apiKey || !api.baseUrl) return null;
  return { apiKey: api.apiKey, baseUrl: api.baseUrl, model: modelId };
}

function analysisModelMeta(config, options = {}) {
  const codeMapApi = options.codeMapApi;
  if (codeMapApi) {
    return {
      id: codeMapApi.modelId || config?.codeMap?.model || 'deepseek-v4-flash',
      name: codeMapApi.modelName || codeMapApi.modelId || 'DeepSeek V4 Flash'
    };
  }
  const modelId = config?.codeMap?.model || 'deepseek-v4-flash';
  return { id: modelId, name: modelId };
}

function parseAiJson(value) {
  const text = String(value || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const parsed = JSON.parse(candidate);
  return Array.isArray(parsed) ? parsed : parsed.items;
}

function buildSummaryRequestBody(api, items) {
  const body = {
    model: api.model,
    stream: false,
    messages: [
      {
        role: 'system',
        content: [
          '你是代码架构摘要器。只返回 JSON 数组，不要 Markdown。',
          '每项格式：{"path":"原路径","summary":"一句中文职责说明"}。',
          '要求：说明「负责什么具体事务」，不要解释实现细节；必须点出领域对象或用户价值（如「密码强度配置界面」「Tkinter 控件工厂」）。',
          '禁止空泛措辞：核心能力、相关逻辑、一项、该模块、处理逻辑、连续逻辑、补充职责。',
          '不超过 48 个汉字，基于输入事实，不臆造。'
        ].join('')
      },
      { role: 'user', content: JSON.stringify(items) }
    ]
  };

  if (api.model === 'kimi-k3') {
    body.reasoning_effort = 'max';
  } else {
    body.temperature = 0.2;
  }
  return body;
}

async function callSummaryApi(api, items) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${api.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey}` },
      signal: controller.signal,
      body: JSON.stringify(buildSummaryRequestBody(api, items))
    });
    if (!res.ok) throw new Error(`Summary API HTTP ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = parseAiJson(content);
    if (!Array.isArray(parsed)) throw new Error('Summary API returned invalid JSON.');
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function enrichCodeMap(workspace, config, options = {}) {
  const resolved = path.resolve(String(workspace || ''));
  let cache = await readCache(resolved);
  if (!cache) {
    await buildCodeMap(resolved, options);
    cache = await readCache(resolved);
  }
  const modelMeta = analysisModelMeta(config, options);
  const api = selectAnalysisApi(config, options);
  if (!api) {
    const error = options.codeMapApi?.error || '未配置可用的分析模型 API Key。';
    return {
      ok: false,
      error,
      analysisModel: modelMeta.id,
      analysisModelName: modelMeta.name,
      map: buildGraph(resolved, cache.files, {}, false)
    };
  }

  const limit = Math.max(1, Math.min(30, Number(options.limit) || 18));
  const candidates = Object.values(cache.files)
    .filter(record => record.aiHash !== record.hash)
    .sort((a, b) => {
      const aEntry = /(^|\/)(main|index|app|server|preload)\.[^.]+$/i.test(a.relPath) ? 1 : 0;
      const bEntry = /(^|\/)(main|index|app|server|preload)\.[^.]+$/i.test(b.relPath) ? 1 : 0;
      return bEntry - aEntry || (b.symbols?.length || 0) - (a.symbols?.length || 0);
    })
    .slice(0, limit);
  if (!candidates.length) {
    return {
      ok: true,
      updated: 0,
      analysisModel: api.model,
      analysisModelName: modelMeta.name,
      map: buildGraph(resolved, cache.files, {}, false)
    };
  }

  let updated = 0;
  const errors = [];
  for (let offset = 0; offset < candidates.length; offset += AI_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + AI_BATCH_SIZE);
    options.onProgress?.({ phase: 'summarize', completed: offset, total: candidates.length });
    const payload = batch.map(record => ({
      path: record.relPath,
      language: record.language,
      localSummary: record.localSummary,
      symbols: (record.symbols || []).slice(0, 10).map(s => `${s.kind} ${s.name}: ${s.preview}`),
      imports: (record.imports || []).slice(0, 12),
      sourceExcerpt: record.sourceExcerpt
    }));
    try {
      const summaries = await callSummaryApi(api, payload);
      for (const item of summaries) {
        const record = cache.files[normalizeRel(item.path)];
        const summary = String(item.summary || '').trim();
        if (!record || !summary || summary.length > 180) continue;
        record.aiSummary = summary;
        record.aiHash = record.hash;
        updated++;
      }
      await writeCache(resolved, cache);
    } catch (error) {
      errors.push(error.message);
      break;
    }
  }
  options.onProgress?.({ phase: 'ready', completed: updated, total: candidates.length });
  return {
    ok: errors.length === 0,
    updated,
    error: errors[0] || null,
    analysisModel: api.model,
    analysisModelName: modelMeta.name,
    map: buildGraph(resolved, cache.files, {}, false)
  };
}

async function clearCodeMapCache(workspace) {
  const target = cachePath(path.resolve(String(workspace || '')));
  try { await fsp.unlink(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return true;
}

module.exports = {
  CACHE_SCHEMA,
  buildVector,
  cosine,
  splitIdentifier,
  fileSummary,
  symbolSummary,
  analyzeFile,
  buildSummaryRequestBody,
  buildCodeMap,
  enrichCodeMap,
  clearCodeMapCache,
  readCache
};
