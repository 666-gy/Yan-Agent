const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MEMORY_VERSION = 2;
const VALID_TYPES = new Set([
  'preference',
  'environment',
  'project',
  'decision',
  'procedure',
  'failure_solution',
  'work_state'
]);
const VALID_SCOPES = new Set(['global', 'machine', 'workspace']);
const DEFAULT_MAX_CONTEXT_CHARS = 3600;
const MAX_MEMORY_CONTENT_CHARS = 800;
const MAX_EVIDENCE_CHARS = 500;
const MAX_KEYWORDS = 16;
const RETRIEVAL_STOP_TOKENS = new Set([
  '帮我', '这个', '那个', '一下', '进行', '使用', '运行', '打开', '项目', '文件', '任务', '工作', '测试',
  '游戏', '网页', '网站', '代码', '程序', '问题', '错误', '正常', '修复', '检查', '验证',
  'please', 'help', 'with', 'this', 'that', 'use', 'run', 'open', 'project', 'file', 'task', 'test',
  'game', 'website', 'code', 'program', 'problem', 'error', 'normal', 'fix', 'check', 'verify'
]);
const SENSITIVE_MEMORY_MARKERS = Object.freeze([
  'api key:',
  'api key=',
  'apikey:',
  'apikey=',
  'access_token=',
  'refresh_token=',
  'authorization: bearer ',
  'password:',
  'password=',
  'passwd:',
  'passwd=',
  'private key-----',
  '密钥：',
  '密钥=',
  '密码：',
  '密码='
]);

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function clip(value, max) {
  return String(value || '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function normalizeWorkspace(workspace) {
  const value = String(workspace || '').trim();
  if (!value) return '';
  try { return path.resolve(value).toLowerCase(); } catch { return value.toLowerCase(); }
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function memoryId() {
  return `mem_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function tokenize(value) {
  const normalized = normalizeText(value);
  const tokens = new Set();
  const latin = normalized.match(/[a-z0-9][a-z0-9._:\\/-]{1,}/g) || [];
  for (const token of latin) {
    tokens.add(token);
    for (const part of token.split(/[._:\\/-]+/)) {
      if (part.length >= 2) tokens.add(part);
    }
  }
  const cjkRuns = normalized.match(/[\u3400-\u9fff]+/g) || [];
  for (const run of cjkRuns) {
    if (run.length <= 12) tokens.add(run);
    for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2));
  }
  return [...tokens].slice(0, 160);
}

function containsUnsafeMemoryText(value) {
  const text = normalizeText(value);
  if (!text) return true;
  return [
    /ignore (?:all |any )?(?:previous|prior) instructions?/i,
    /reveal (?:the )?(?:system|developer) prompt/i,
    /<\/?(?:system|developer|assistant|tool)[^>]*>/i,
    /忽略(?:之前|以上|所有).{0,12}(?:指令|提示词)/,
    /泄露.{0,12}(?:系统|开发者).{0,8}(?:提示词|指令)/
  ].some(pattern => pattern.test(text));
}

function containsSensitiveMemoryText(value) {
  const text = normalizeText(value);
  return SENSITIVE_MEMORY_MARKERS.some(marker => text.includes(marker));
}

function emptyStore() {
  return { version: MEMORY_VERSION, memories: [], updatedAt: 0 };
}

function migrateLegacyStore(raw, defaultScope = 'global', workspace = '') {
  if (raw?.version === MEMORY_VERSION && Array.isArray(raw.memories)) {
    return {
      version: MEMORY_VERSION,
      memories: raw.memories.filter(item => item && typeof item === 'object'),
      updatedAt: Number(raw.updatedAt) || 0
    };
  }
  const facts = Array.isArray(raw?.facts) ? raw.facts : [];
  const now = Date.now();
  return {
    version: MEMORY_VERSION,
    memories: facts.map((fact, index) => {
      const content = clip(typeof fact === 'string' ? fact : fact?.content, MAX_MEMORY_CONTENT_CHARS);
      return {
        id: `legacy_${stableHash(`${content}:${index}`).slice(0, 16)}`,
        key: '',
        type: 'project',
        scope: defaultScope,
        workspace: defaultScope === 'workspace' ? normalizeWorkspace(workspace) : '',
        content,
        keywords: tokenize(content).slice(0, MAX_KEYWORDS),
        evidence: 'Migrated from Yan Agent legacy memory.',
        confidence: 0.7,
        status: 'active',
        occurrences: 1,
        createdAt: Number(fact?.ts) || now,
        updatedAt: Number(fact?.ts) || now,
        source: { kind: 'legacy' }
      };
    }).filter(item => item.content),
    updatedAt: Number(raw?.updatedAt) || now
  };
}

function readStore(filePath, defaultScope, workspace) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return emptyStore();
    return migrateLegacyStore(JSON.parse(fs.readFileSync(filePath, 'utf8')), defaultScope, workspace);
  } catch {
    return emptyStore();
  }
}

function writeStore(filePath, store) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const next = { ...store, version: MEMORY_VERSION, updatedAt: Date.now() };
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8');
    try {
      fs.renameSync(temporary, filePath);
    } catch {
      // Windows can refuse rename over a file another handle keeps open; a
      // direct copy still lands the write instead of losing it.
      fs.copyFileSync(temporary, filePath);
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return next;
}

function workspaceMemoryPath(workspace, yanagentDir = '.yanagent') {
  const value = String(workspace || '').trim();
  return value ? path.join(value, yanagentDir, 'memory.json') : '';
}

function normalizeRecord(input = {}, options = {}) {
  const content = clip(input.content, MAX_MEMORY_CONTENT_CHARS);
  const evidence = clip(input.evidence, MAX_EVIDENCE_CHARS);
  if (!content || containsUnsafeMemoryText(content) || containsSensitiveMemoryText(content)) return null;
  if (evidence && (containsUnsafeMemoryText(evidence) || containsSensitiveMemoryText(evidence))) return null;
  const requestedScope = String(input.scope || options.defaultScope || 'global').toLowerCase();
  const scope = VALID_SCOPES.has(requestedScope) ? requestedScope : 'global';
  const requestedType = String(input.type || 'project').toLowerCase();
  const type = VALID_TYPES.has(requestedType) ? requestedType : 'project';
  const workspace = scope === 'workspace' ? normalizeWorkspace(options.workspace || input.workspace) : '';
  if (scope === 'workspace' && !workspace) return null;
  const suppliedKeywords = Array.isArray(input.keywords) ? input.keywords : [];
  const keywords = [...new Set([
    ...suppliedKeywords.map(keyword => normalizeText(keyword)).filter(Boolean),
    ...tokenize(content)
  ])].slice(0, MAX_KEYWORDS);
  const key = normalizeKey(input.key);
  const now = Date.now();
  const source = {
    kind: clip(options.sourceKind || input.source?.kind || 'background_review', 40),
    sessionId: clip(options.sessionId || input.source?.sessionId, 120),
    runId: clip(options.runId || input.source?.runId, 120),
    refinementId: clip(options.refinementId || input.source?.refinementId, 120)
  };
  return {
    id: memoryId(),
    key,
    type,
    scope,
    workspace,
    content,
    keywords,
    evidence,
    basis: clip(input.basis, 40),
    verified: input.verified === true,
    confidence: clamp(input.confidence, 0.1, 1, 0.75),
    status: 'active',
    occurrences: 1,
    createdAt: now,
    updatedAt: now,
    source,
    sources: [source]
  };
}

function sameSourceRun(a = {}, b = {}) {
  return !!a.runId && !!b.runId && a.runId === b.runId;
}

function sameSourceReference(a = {}, b = {}) {
  if (a.refinementId && b.refinementId) return a.refinementId === b.refinementId;
  return sameSourceRun(a, b);
}

function upsertIntoStore(store, record) {
  const memories = Array.isArray(store.memories) ? store.memories : [];
  const active = memories.filter(item => item?.status !== 'superseded');
  const fingerprint = stableHash(normalizeText(record.content));
  const duplicate = active.find(item => (
    item.scope === record.scope
    && normalizeWorkspace(item.workspace) === normalizeWorkspace(record.workspace)
    && stableHash(normalizeText(item.content)) === fingerprint
  ));
  if (duplicate) {
    const sources = Array.isArray(duplicate.sources) && duplicate.sources.length
      ? duplicate.sources
      : [duplicate.source || {}];
    if (!sources.some(sourceItem => sameSourceReference(sourceItem, record.source))) sources.push(record.source);
    duplicate.sources = sources.slice(-40);
    duplicate.source = duplicate.sources.at(-1);
    duplicate.occurrences = Math.max(1, duplicate.sources.length);
    duplicate.confidence = Math.max(Number(duplicate.confidence) || 0, record.confidence);
    duplicate.updatedAt = Date.now();
    duplicate.keywords = [...new Set([...(duplicate.keywords || []), ...record.keywords])].slice(0, MAX_KEYWORDS);
    if (record.evidence) duplicate.evidence = record.evidence;
    return { store: { ...store, memories }, memory: duplicate, action: 'reinforced' };
  }

  const conflicting = record.key
    ? active.find(item => (
      item.key === record.key
      && item.scope === record.scope
      && normalizeWorkspace(item.workspace) === normalizeWorkspace(record.workspace)
    ))
    : null;
  if (conflicting) {
    conflicting.status = 'superseded';
    conflicting.supersededBy = record.id;
    conflicting.updatedAt = Date.now();
    record.supersedes = conflicting.id;
  }
  memories.push(record);
  return { store: { ...store, memories }, memory: record, action: conflicting ? 'superseded' : 'created' };
}

function scoreMemory(memory, queryTokens, normalizedQuery, workspace) {
  if (!memory || memory.status === 'superseded') return -Infinity;
  if (memory.scope === 'workspace' && normalizeWorkspace(memory.workspace) !== normalizeWorkspace(workspace)) return -Infinity;
  const content = normalizeText(memory.content);
  const keywords = new Set((memory.keywords || []).flatMap(tokenize));
  const contentTokens = new Set(tokenize(content));
  let score = 0;
  if (normalizedQuery.length >= 4 && content.includes(normalizedQuery)) score += 12;
  for (const token of queryTokens) {
    if (RETRIEVAL_STOP_TOKENS.has(token)) continue;
    if (keywords.has(token)) score += token.length >= 4 ? 3.2 : 1.6;
    else if (contentTokens.has(token)) score += token.length >= 4 ? 2.2 : 1.1;
    else if (token.length >= 4 && content.includes(token)) score += 1.2;
  }
  if (memory.scope === 'workspace') score += 0.8;
  if (memory.type === 'failure_solution' || memory.type === 'environment') score += 0.35;
  score += clamp(memory.confidence, 0, 1, 0.5) * 0.75;
  score += Math.min(0.7, Math.log2(Math.max(1, Number(memory.occurrences) || 1)) * 0.2);
  return score;
}

function formatContext(memories, maxChars = DEFAULT_MAX_CONTEXT_CHARS) {
  if (!memories.length) return '';
  const header = [
    '## Relevant long-term memory (selectively retrieved)',
    'These are prior observations, not fresh tool evidence. Follow stable user preferences, but verify executable paths and mutable environment facts before relying on them.'
  ].join('\n');
  const lines = [header];
  let length = header.length;
  for (const memory of memories) {
    const label = `${memory.scope}/${memory.type}`;
    const evidence = memory.evidence ? ` Evidence: ${memory.evidence}` : '';
    const line = `- [${label}; confidence=${Number(memory.confidence || 0).toFixed(2)}] ${memory.content}${evidence}`;
    if (length + line.length + 1 > maxChars) break;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

class LongTermMemoryStore {
  constructor({ globalPath, yanagentDir = '.yanagent' }) {
    this.globalPath = globalPath;
    this.yanagentDir = yanagentDir;
  }

  getStores(workspace) {
    const global = readStore(this.globalPath, 'global', '');
    const localPath = workspaceMemoryPath(workspace, this.yanagentDir);
    const local = localPath ? readStore(localPath, 'workspace', workspace) : emptyStore();
    return { global, local, localPath };
  }

  list({ workspace = '', includeSuperseded = false } = {}) {
    const { global, local } = this.getStores(workspace);
    return [...global.memories, ...local.memories]
      .filter(memory => includeSuperseded || memory.status !== 'superseded')
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }

  upsert(input, options = {}) {
    const record = normalizeRecord(input, options);
    if (!record) return { ok: false, error: 'Memory was empty, unsafe, or missing its workspace scope.' };
    const targetPath = record.scope === 'workspace'
      ? workspaceMemoryPath(record.workspace, this.yanagentDir)
      : this.globalPath;
    const defaultScope = record.scope === 'workspace' ? 'workspace' : 'global';
    const store = readStore(targetPath, defaultScope, record.workspace);
    const result = upsertIntoStore(store, record);
    writeStore(targetPath, result.store);
    return { ok: true, memory: result.memory, action: result.action };
  }

  query({ query = '', workspace = '', maxChars = DEFAULT_MAX_CONTEXT_CHARS, limit = 12, boostRunIds = null, excludeSourceKinds = [] } = {}) {
    const normalizedQuery = normalizeText(query);
    const queryTokens = tokenize(normalizedQuery);
    if (!queryTokens.length) return { memories: [], context: '', total: 0 };
    const candidates = this.list({ workspace }).filter(memory => (
      ![memory.source, ...(memory.sources || [])].some(source => excludeSourceKinds.includes(source?.kind))
      &&
      !containsUnsafeMemoryText(memory.content)
      && !containsSensitiveMemoryText(memory.content)
      && (!memory.evidence || (
        !containsUnsafeMemoryText(memory.evidence)
        && !containsSensitiveMemoryText(memory.evidence)
      ))
    ));
    // Continuity beats relevance: the newest work-state card for the active
    // workspace is always injected so a new task knows where the last one stopped.
    const workState = candidates
      .filter(memory => memory.scope === 'workspace' && memory.type === 'work_state')
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, 1)
      .map(memory => ({ ...memory, relevance: 100 }));
    const always = [
      ...workState,
      ...candidates
        .filter(memory => (
          memory.scope === 'global'
          && memory.type === 'preference'
          && Number(memory.confidence || 0) >= 0.75
        ))
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .slice(0, 4)
        .map(memory => ({ ...memory, relevance: 100 }))
    ];
    const alwaysIds = new Set(always.map(memory => memory.id));
    const resultLimit = Math.max(1, Math.min(30, Number(limit) || 12));
    // P1-3: memories whose source run was later verified by real delivery get a
    // bounded bonus, so confirmed experience outranks unconfirmed recall.
    const verifiedRuns = boostRunIds instanceof Set && boostRunIds.size ? boostRunIds : null;
    const verifiedBonus = memory => {
      if (!verifiedRuns) return 0;
      const sources = Array.isArray(memory.sources) && memory.sources.length
        ? memory.sources
        : [memory.source || {}];
      return sources.some(sourceItem => verifiedRuns.has(String(sourceItem?.runId || ''))) ? 0.4 : 0;
    };
    const scored = candidates
      .filter(memory => !alwaysIds.has(memory.id))
      .map(memory => ({
        memory,
        score: scoreMemory(memory, queryTokens, normalizedQuery, workspace) + verifiedBonus(memory)
      }))
      .filter(item => item.score >= 2.6)
      .sort((a, b) => b.score - a.score || Number(b.memory.updatedAt || 0) - Number(a.memory.updatedAt || 0))
      .slice(0, Math.max(0, resultLimit - always.length));
    const memories = [
      ...always,
      ...scored.map(item => ({ ...item.memory, relevance: Number(item.score.toFixed(3)) }))
    ];
    const boundedChars = Math.max(600, Math.min(12000, Number(maxChars) || DEFAULT_MAX_CONTEXT_CHARS));
    return { memories, context: formatContext(memories, boundedChars), total: candidates.length };
  }

  removeBySource({ refinementId = '', runId = '', sessionId = '', workspace = '' } = {}) {
    const normalizedRefinementId = clip(refinementId, 120);
    const normalizedRunId = clip(runId, 120);
    const normalizedSessionId = clip(sessionId, 120);
    if (!normalizedRefinementId && !normalizedRunId && !normalizedSessionId) return { removed: 0 };
    let removed = 0;
    const removeFrom = (filePath, defaultScope, targetWorkspace) => {
      if (!filePath) return;
      const store = readStore(filePath, defaultScope, targetWorkspace);
      const before = store.memories.length;
      let sourcesChanged = false;
      const removedActiveIds = new Set();
      store.memories = store.memories.filter(memory => {
        const sources = Array.isArray(memory?.sources) && memory.sources.length
          ? memory.sources
          : [memory?.source || {}];
        const retained = sources.filter(sourceItem => !(
          (!normalizedRefinementId || sourceItem.refinementId === normalizedRefinementId)
          && (!normalizedRunId || sourceItem.runId === normalizedRunId)
          && (!normalizedSessionId || sourceItem.sessionId === normalizedSessionId)
        ));
        if (!retained.length) {
          if (memory.status !== 'superseded') removedActiveIds.add(memory.id);
          return false;
        }
        if (retained.length !== sources.length) sourcesChanged = true;
        memory.sources = retained;
        memory.source = retained.at(-1);
        memory.occurrences = Math.max(1, retained.length);
        return true;
      });
      for (const memory of store.memories) {
        if (memory.status !== 'superseded' || !removedActiveIds.has(memory.supersededBy)) continue;
        memory.status = 'active';
        delete memory.supersededBy;
        memory.updatedAt = Date.now();
        sourcesChanged = true;
      }
      removed += before - store.memories.length;
      if (before !== store.memories.length || sourcesChanged) writeStore(filePath, store);
    };
    removeFrom(this.globalPath, 'global', '');
    if (workspace) removeFrom(workspaceMemoryPath(workspace, this.yanagentDir), 'workspace', workspace);
    return { removed };
  }

  clear({ workspace = '', scope = 'all' } = {}) {
    if (scope === 'all' || scope === 'global' || scope === 'machine') {
      const store = readStore(this.globalPath, 'global', '');
      store.memories = scope === 'all'
        ? []
        : store.memories.filter(memory => memory.scope !== scope);
      writeStore(this.globalPath, store);
    }
    if ((scope === 'all' || scope === 'workspace') && workspace) {
      const localPath = workspaceMemoryPath(workspace, this.yanagentDir);
      writeStore(localPath, emptyStore());
    }
    return true;
  }
}

module.exports = {
  LongTermMemoryStore,
  MEMORY_VERSION,
  containsUnsafeMemoryText,
  containsSensitiveMemoryText,
  formatContext,
  migrateLegacyStore,
  normalizeRecord,
  normalizeWorkspace,
  scoreMemory,
  tokenize,
  upsertIntoStore,
  workspaceMemoryPath
};
