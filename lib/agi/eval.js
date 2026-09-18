'use strict';

// Offline regression suite for the AGI capability routes, plus the
// candidate -> validated -> reusable experience state machine shared by the
// P1-4 / computer-use experience stores and the P2-1 rubric versioning hook.

const fs = require('fs');
const path = require('path');

const {
  AGI_VERSION,
  EXPERIENCE_STATES,
  clip,
  normalizeId,
  stableHash,
  readJson,
  writeJsonAtomic,
  containsUnsafeText
} = require('./contracts');

const CORE_SUITE_ID = 'yan-eval-core';
const SKILL_VALIDATION_SUITE_ID = 'yan-skill-validation';
const RUBRIC_VERSION = 1;
const DETAIL_MAX = 400;
const CANDIDATE_PROMPT_MAX = 4000;

const ROUNDTRIP_NOTE = '# Yan 评估套件\n\n- 中文往返 ✅\n- emoji 🚀\n';

const BUGGY_SUM = [
  'function sum(values) {',
  '  let total = 0;',
  '  for (let i = 1; i <= values.length; i += 1) {',
  '    total += values[i];',
  '  }',
  '  return total;',
  '}'
].join('\n');

const FIXED_SUM = [
  'function sum(values) {',
  '  let total = 0;',
  '  for (let i = 0; i < values.length; i += 1) {',
  '    total += values[i];',
  '  }',
  '  return total;',
  '}'
].join('\n');

const RAW_JSON = [
  '{',
  '  "tags": ["agi", "eval",],',
  '  "name": "yan",',
  '  "meta": {"stable": true, "version": 1,},',
  '  "count": 2,',
  '}'
].join('\n');

const NORMALIZED_JSON = { count: 2, meta: { stable: true, version: 1 }, name: 'yan', tags: ['agi', 'eval'] };

const TABLE_ROWS = [['task', '结果'], ['fs', '通过'], ['json', '通过']];
const TABLE_EXPECTED = ['| task | 结果 |', '| ---- | ---- |', '| fs   | 通过 |', '| json | 通过 |'].join('\n') + '\n';

const SLUG_TITLES = ['Yan 评估套件 v1.6!', 'C++ 内存 优化', '  多  余   空格  '];
const SLUG_EXPECTED = ['yan-评估套件-v1-6', 'c-内存-优化', '多-余-空格'];

const DIFF_BEFORE = 'alpha\nbeta\ngamma';
const DIFF_AFTER = 'alpha\nbeta-plus\ngamma\ndelta';
const DIFF_EXPECTED = { before: 3, after: 4, added: 2, removed: 1, unchanged: 2 };

function isWideChar(char) {
  const code = char.codePointAt(0);
  return (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe4f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6);
}

function displayWidth(text) {
  let width = 0;
  for (const char of String(text === undefined || text === null ? '' : text)) {
    width += isWideChar(char) ? 2 : 1;
  }
  return width;
}

function padCell(text, width) {
  const value = String(text === undefined || text === null ? '' : text);
  return value + ' '.repeat(Math.max(0, width - displayWidth(value)));
}

function markdownTable(rows) {
  const widths = rows[0].map((cell, index) => Math.max(...rows.map(row => displayWidth(row[index]))));
  const renderRow = row => `| ${row.map((cell, index) => padCell(cell, widths[index])).join(' | ')} |`;
  const separator = `| ${widths.map(width => '-'.repeat(Math.max(3, width))).join(' | ')} |`;
  return [renderRow(rows[0]), separator, ...rows.slice(1).map(renderRow)].join('\n') + '\n';
}

function slugify(value) {
  return String(value === undefined || value === null ? '' : value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function repairJson(text) {
  return String(text || '').replace(/,(\s*[}\]])/g, '$1');
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key]);
    return sorted;
  }
  return value;
}

function diffStats(before, after) {
  const left = String(before).split('\n');
  const right = String(after).split('\n');
  const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const removedLines = [];
  const addedLines = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      removedLines.push(left[i]);
      i += 1;
    } else {
      addedLines.push(right[j]);
      j += 1;
    }
  }
  while (i < left.length) {
    removedLines.push(left[i]);
    i += 1;
  }
  while (j < right.length) {
    addedLines.push(right[j]);
    j += 1;
  }
  return {
    before: left.length,
    after: right.length,
    unchanged: table[0][0],
    added: addedLines.length,
    removed: removedLines.length,
    addedLines,
    removedLines
  };
}

function readTaskJson(ctx, rel) {
  const text = ctx.read(rel);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function fsRoundTripTask() {
  return {
    id: 'fs-roundtrip',
    tags: ['filesystem', 'unicode'],
    run(ctx) {
      ctx.write('notes/笔记.md', ROUNDTRIP_NOTE);
      ctx.write('notes/副本.txt', ROUNDTRIP_NOTE);
    },
    verify(ctx) {
      if (!ctx.exists('notes/笔记.md')) return { ok: false, detail: 'notes/笔记.md was not written' };
      if (ctx.read('notes/笔记.md') !== ROUNDTRIP_NOTE) return { ok: false, detail: 'utf8 round-trip changed the note body' };
      const names = ctx.list('notes');
      const missing = ['笔记.md', '副本.txt'].filter(name => !names.includes(name));
      if (missing.length > 0) return { ok: false, detail: `list() missed ${missing.join(', ')}` };
      return { ok: true, detail: 'Chinese and emoji survived a write/read round-trip' };
    }
  };
}

function exactReplaceTask() {
  return {
    id: 'exact-replace',
    tags: ['edit', 'javascript'],
    run(ctx) {
      ctx.write('src/sum.js', `'use strict';\n\n${BUGGY_SUM}\n\nmodule.exports = { sum };\n`);
      const source = ctx.read('src/sum.js');
      const next = source.replace(BUGGY_SUM, FIXED_SUM);
      if (next === source) throw new Error('buggy block was not found for exact replacement');
      ctx.write('src/sum.js', next);
    },
    verify(ctx) {
      const source = ctx.read('src/sum.js');
      if (!source || !source.includes(FIXED_SUM)) return { ok: false, detail: 'fixed loop block is missing' };
      if (source.includes('i = 1')) return { ok: false, detail: 'off-by-one loop survived the replacement' };
      // Executing the patched snippet proves the replacement really works.
      try {
        const loaded = { exports: {} };
        new Function('module', 'exports', source)(loaded, loaded.exports);
        const total = loaded.exports.sum([1, 2, 3, 4]);
        if (total !== 10) return { ok: false, detail: `patched sum([1,2,3,4]) returned ${total}` };
      } catch (error) {
        return { ok: false, detail: `patched module failed to load: ${clip(error && error.message, 120)}` };
      }
      return { ok: true, detail: 'exact replacement fixed the loop and the module sums correctly' };
    }
  };
}

function jsonNormalizeTask() {
  return {
    id: 'json-normalize',
    tags: ['json', 'repair'],
    run(ctx) {
      ctx.write('data/raw.json', RAW_JSON);
      const parsed = JSON.parse(repairJson(ctx.read('data/raw.json')));
      ctx.write('data/normalized.json', `${JSON.stringify(sortKeys(parsed), null, 2)}\n`);
    },
    verify(ctx) {
      const text = ctx.read('data/normalized.json');
      if (!text) return { ok: false, detail: 'normalized JSON was not written' };
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        return { ok: false, detail: `normalized JSON does not parse: ${clip(error && error.message, 120)}` };
      }
      if (JSON.stringify(parsed) !== JSON.stringify(NORMALIZED_JSON)) return { ok: false, detail: 'normalized JSON lost or changed values' };
      if (!text.startsWith('{\n  "count": 2,')) return { ok: false, detail: 'keys are not sorted with 2-space indentation' };
      return { ok: true, detail: 'trailing commas repaired and keys normalized deterministically' };
    }
  };
}

function markdownTableTask() {
  return {
    id: 'markdown-table',
    tags: ['markdown', 'cjk'],
    run(ctx) {
      ctx.write('docs/table.md', markdownTable(TABLE_ROWS));
    },
    verify(ctx) {
      const text = ctx.read('docs/table.md');
      if (text !== TABLE_EXPECTED) return { ok: false, detail: 'markdown table does not match the expected CJK-aligned layout' };
      const lines = text.trimEnd().split('\n');
      if (lines.length !== TABLE_ROWS.length + 1) return { ok: false, detail: `expected ${TABLE_ROWS.length + 1} table lines, found ${lines.length}` };
      return { ok: true, detail: 'CJK-width aware markdown table rendered deterministically' };
    }
  };
}

function slugNormalizeTask() {
  return {
    id: 'slug-normalize',
    tags: ['slug', 'cjk'],
    run(ctx) {
      ctx.write('ids/slugs.json', `${JSON.stringify(SLUG_TITLES.map(slugify))}\n`);
    },
    verify(ctx) {
      const text = ctx.read('ids/slugs.json');
      if (!text) return { ok: false, detail: 'slug list was not written' };
      let slugs;
      try {
        slugs = JSON.parse(text);
      } catch {
        return { ok: false, detail: 'slug list is not valid JSON' };
      }
      if (JSON.stringify(slugs) !== JSON.stringify(SLUG_EXPECTED)) return { ok: false, detail: `unexpected slugs: ${JSON.stringify(slugs)}` };
      if (!slugs.every(slug => /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(slug))) return { ok: false, detail: 'a generated slug is not filesystem safe' };
      return { ok: true, detail: 'CJK preserved and punctuation collapsed into safe ids' };
    }
  };
}

function diffStatsTask() {
  return {
    id: 'diff-stats',
    tags: ['diff', 'report'],
    run(ctx) {
      const stats = diffStats(DIFF_BEFORE, DIFF_AFTER);
      ctx.write('reports/stats.json', `${JSON.stringify({
        before: stats.before,
        after: stats.after,
        added: stats.added,
        removed: stats.removed,
        unchanged: stats.unchanged
      })}\n`);
      const patch = [
        ...stats.removedLines.map(line => `- ${line}`),
        ...stats.addedLines.map(line => `+ ${line}`)
      ].join('\n') + '\n';
      ctx.write('reports/changes.diff', patch);
    },
    verify(ctx) {
      const stats = readTaskJson(ctx, 'reports/stats.json');
      if (!stats) return { ok: false, detail: 'diff stats are not valid JSON' };
      if (JSON.stringify(stats) !== JSON.stringify(DIFF_EXPECTED)) return { ok: false, detail: `unexpected diff stats: ${JSON.stringify(stats)}` };
      const patch = ctx.read('reports/changes.diff') || '';
      for (const expected of ['- beta', '+ beta-plus', '+ delta']) {
        if (!patch.includes(expected)) return { ok: false, detail: `patch is missing "${expected}"` };
      }
      return { ok: true, detail: 'LCS line diff counted 2 additions and 1 removal' };
    }
  };
}

function createCoreSuite({ rootDir } = {}) {
  return {
    suiteId: CORE_SUITE_ID,
    rubricVersion: RUBRIC_VERSION,
    rootDir: rootDir ? String(rootDir) : null,
    tasks: [
      fsRoundTripTask(),
      exactReplaceTask(),
      jsonNormalizeTask(),
      markdownTableTask(),
      slugNormalizeTask(),
      diffStatsTask()
    ]
  };
}

function createTaskContext(dir) {
  const resolve = rel => path.join(dir, rel === undefined || rel === null || rel === '' ? '.' : String(rel));
  return {
    dir,
    write(rel, text) {
      const target = resolve(rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, String(text === undefined || text === null ? '' : text), 'utf8');
      return target;
    },
    read(rel) {
      try {
        return fs.readFileSync(resolve(rel), 'utf8');
      } catch {
        return null;
      }
    },
    exists(rel) {
      return fs.existsSync(resolve(rel));
    },
    list(rel = '.') {
      try {
        return fs.readdirSync(resolve(rel)).sort();
      } catch {
        return [];
      }
    }
  };
}

function resolveBaseDir(suite, sandboxDir) {
  const rootDir = suite && suite.rootDir ? String(suite.rootDir) : null;
  if (sandboxDir) {
    const dir = String(sandboxDir);
    return path.isAbsolute(dir) || !rootDir ? dir : path.join(rootDir, dir);
  }
  if (rootDir) return rootDir;
  throw new Error('runSuite requires a sandboxDir or a suite rootDir');
}

function normalizeVerdict(value) {
  if (value && typeof value === 'object' && value.ok === true) {
    return { ok: true, detail: clip(value.detail, DETAIL_MAX) || 'ok' };
  }
  const detail = value && typeof value === 'object' ? value.detail : value;
  return { ok: false, detail: clip(detail, DETAIL_MAX) || 'verification failed' };
}

function runSuite({ suite, sandboxDir } = {}) {
  if (!suite || !Array.isArray(suite.tasks) || suite.tasks.length === 0) {
    throw new Error('runSuite requires a suite with at least one task');
  }
  const baseDir = resolveBaseDir(suite, sandboxDir);
  const startedAt = Date.now();
  const results = suite.tasks.map(task => {
    const dir = path.join(baseDir, String(task.id));
    fs.mkdirSync(dir, { recursive: true });
    const ctx = createTaskContext(dir);
    const started = Date.now();
    let verdict;
    try {
      task.run(ctx);
      verdict = normalizeVerdict(task.verify(ctx));
    } catch (error) {
      verdict = { ok: false, detail: `task threw: ${clip(error && error.message, 160)}` };
    }
    return { id: task.id, ok: verdict.ok, detail: verdict.detail, ms: Date.now() - started };
  });
  const passed = results.filter(result => result.ok).length;
  const failed = results.length - passed;
  return {
    suiteId: suite.suiteId || CORE_SUITE_ID,
    rubricVersion: suite.rubricVersion || RUBRIC_VERSION,
    startedAt,
    results,
    passed,
    failed,
    ok: failed === 0
  };
}

function digestFor(results) {
  return stableHash(JSON.stringify(results.map(result => [result.id, result.ok === true])));
}

function evidenceRecord(report) {
  const results = Array.isArray(report && report.results) ? report.results : [];
  const passed = results.filter(result => result && result.ok === true).length;
  const failed = results.length - passed;
  return {
    suiteId: (report && report.suiteId) || CORE_SUITE_ID,
    rubricVersion: report && report.rubricVersion !== undefined ? report.rubricVersion : RUBRIC_VERSION,
    taskIds: results.map(result => result && result.id),
    ok: failed === 0 && results.length > 0,
    passed,
    failed,
    ranAt: Number.isFinite(report && report.startedAt) ? report.startedAt : Date.now(),
    digest: digestFor(results)
  };
}

function writeEvidence(filePath, report) {
  if (!filePath) throw new Error('writeEvidence requires a filePath');
  const record = evidenceRecord(report);
  writeJsonAtomic(filePath, record);
  return record;
}

function evaluatePromotion({ evidence, minPassRate = 1, requiredTaskIds = [] } = {}) {
  if (!evidence || typeof evidence !== 'object') return { ok: false, reason: 'no evidence provided' };
  if (evidence.rubricVersion !== RUBRIC_VERSION) {
    const received = evidence.rubricVersion === undefined ? 'none' : evidence.rubricVersion;
    return { ok: false, reason: `rubric version mismatch: required ${RUBRIC_VERSION}, received ${received}` };
  }
  if (evidence.ok !== true) return { ok: false, reason: 'evidence is not a passing run' };
  const passed = Number.isFinite(evidence.passed) ? evidence.passed : 0;
  const failed = Number.isFinite(evidence.failed) ? evidence.failed : 0;
  const taskIds = Array.isArray(evidence.taskIds) ? evidence.taskIds : [];
  const total = passed + failed > 0 ? passed + failed : taskIds.length;
  if (total <= 0) return { ok: false, reason: 'evidence contains no task results' };
  const rate = passed / total;
  const threshold = Number.isFinite(minPassRate) ? Math.min(1, Math.max(0, minPassRate)) : 1;
  if (rate < threshold) {
    return { ok: false, reason: `pass rate ${(rate * 100).toFixed(1)}% is below required ${(threshold * 100).toFixed(1)}%` };
  }
  const required = Array.isArray(requiredTaskIds) ? requiredTaskIds : [];
  const missing = required.filter(id => !taskIds.includes(id));
  if (missing.length > 0) return { ok: false, reason: `missing required tasks: ${missing.join(', ')}` };
  return { ok: true, reason: `evidence accepted: ${passed}/${total} tasks passed at rubric v${RUBRIC_VERSION}` };
}

function normalizeEvidence(evidence) {
  return {
    suiteId: clip(evidence.suiteId, 80) || null,
    rubricVersion: Number.isFinite(evidence.rubricVersion) ? evidence.rubricVersion : null,
    ok: evidence.ok === true,
    digest: clip(evidence.digest, 128) || null,
    taskIds: Array.isArray(evidence.taskIds) ? evidence.taskIds.map(id => clip(id, 120)).slice(0, 256) : [],
    passed: Number.isFinite(evidence.passed) ? evidence.passed : 0,
    failed: Number.isFinite(evidence.failed) ? evidence.failed : 0,
    ranAt: Number.isFinite(evidence.ranAt) ? evidence.ranAt : null
  };
}

function isStoredRecord(record) {
  return Boolean(record)
    && typeof record.id === 'string'
    && record.id.length > 0
    && EXPERIENCE_STATES.includes(record.state);
}

function sanitizeStored(record) {
  return {
    id: normalizeId(record.id),
    kind: clip(record.kind, 60) || 'general',
    title: clip(record.title, 200) || null,
    content: clip(record.content, 4000),
    state: record.state,
    evidence: record.evidence && typeof record.evidence === 'object' ? normalizeEvidence(record.evidence) : null,
    validation: record.validation && typeof record.validation === 'object' ? record.validation : null,
    reuse: record.reuse && typeof record.reuse === 'object' ? record.reuse : null,
    rejection: record.rejection && typeof record.rejection === 'object' ? record.rejection : null,
    createdAt: Number.isFinite(record.createdAt) ? record.createdAt : null,
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : null
  };
}

function createExperienceStore({ filePath } = {}) {
  if (!filePath) throw new Error('createExperienceStore requires a filePath');
  const persisted = readJson(filePath, null);
  const records = Array.isArray(persisted && persisted.records)
    ? persisted.records.filter(isStoredRecord).map(sanitizeStored).filter(record => record.id.length > 0)
    : [];
  const clone = value => JSON.parse(JSON.stringify(value));
  const fail = reason => ({ ok: false, reason });
  const find = id => records.find(record => record.id === normalizeId(id));
  const persist = () => writeJsonAtomic(filePath, { version: AGI_VERSION, records });
  const missing = id => fail(`experience not found: ${normalizeId(id) || id}`);

  return {
    propose(input = {}) {
      const id = normalizeId(input.id);
      if (!id) return fail('id is required');
      const content = clip(input.content, 4000);
      if (!content) return fail('content is required');
      const title = clip(input.title, 200) || null;
      if (containsUnsafeText(content) || containsUnsafeText(title || '')) {
        return fail('content rejected by the safety screen');
      }
      const kind = clip(input.kind, 60) || 'general';
      const evidence = input.evidence && typeof input.evidence === 'object' ? normalizeEvidence(input.evidence) : null;
      let record = find(id);
      if (!record) {
        record = {
          id,
          kind,
          title,
          content,
          state: 'candidate',
          evidence: null,
          validation: null,
          reuse: null,
          rejection: null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        records.push(record);
      } else {
        // A re-proposed experience must re-earn validation; stale evidence is dropped.
        record.kind = kind;
        record.title = title;
        record.content = content;
        record.state = 'candidate';
      }
      record.evidence = evidence;
      record.validation = null;
      record.reuse = null;
      record.updatedAt = Date.now();
      persist();
      return { ok: true, record: clone(record) };
    },

    attachEvidence(id, evidence) {
      const record = find(id);
      if (!record) return missing(id);
      if (record.state === 'rejected') return fail('rejected experiences are terminal');
      if (!evidence || typeof evidence !== 'object') return fail('evidence object is required');
      record.evidence = normalizeEvidence(evidence);
      record.state = 'candidate';
      record.validation = null;
      record.updatedAt = Date.now();
      persist();
      return { ok: true, evidence: clone(record.evidence) };
    },

    validate(id) {
      const record = find(id);
      if (!record) return missing(id);
      if (record.state === 'rejected') return fail('rejected experiences are terminal');
      if (record.state === 'validated' || record.state === 'reusable') {
        return { ok: true, reason: 'already validated', record: clone(record) };
      }
      if (!record.evidence) return fail('no evidence attached');
      if (record.evidence.ok !== true) return fail('attached evidence is not a passing run');
      if (record.evidence.rubricVersion !== RUBRIC_VERSION) {
        return fail(`evidence rubric version mismatch: required ${RUBRIC_VERSION}, received ${record.evidence.rubricVersion}`);
      }
      record.state = 'validated';
      record.validation = { digest: record.evidence.digest, at: Date.now() };
      record.updatedAt = Date.now();
      persist();
      return { ok: true, reason: 'evidence accepted, experience validated', record: clone(record) };
    },

    markReusable(id, options = {}) {
      const record = find(id);
      if (!record) return missing(id);
      if (record.state === 'rejected') return fail('rejected experiences are terminal');
      if (record.state === 'reusable') return { ok: true, reason: 'already reusable', record: clone(record) };
      if (record.state !== 'validated') return fail('only validated experiences can become reusable');
      // OpenSpace semantics: reusable requires success recorded away from the validation run.
      if (options.independentSuccess !== true) return fail('reuse requires independentSuccess === true');
      record.state = 'reusable';
      record.reuse = { runId: clip(options.runId, 80) || null, at: Date.now() };
      record.updatedAt = Date.now();
      persist();
      return { ok: true, reason: 'independent success recorded, experience is reusable', record: clone(record) };
    },

    reject(id, reason) {
      const record = find(id);
      if (!record) return missing(id);
      if (record.state === 'rejected') return { ok: true, reason: 'already rejected', record: clone(record) };
      record.state = 'rejected';
      record.rejection = { reason: clip(reason, 300) || 'rejected', at: Date.now() };
      record.updatedAt = Date.now();
      persist();
      return { ok: true, reason: 'experience rejected', record: clone(record) };
    },

    get(id) {
      const record = find(id);
      return record ? clone(record) : null;
    },

    list() {
      return records.map(clone);
    }
  };
}

// ---- Skill candidate validation -------------------------------------------
// The promotion gate used to be a formality: attachValidation had no caller,
// so "validated" never happened in production. This evaluator turns a real
// promotion check into an evidence record: deterministic static checks on the
// candidate content plus one model-judge verdict produced by a separate
// headless judge session (never the generator — mining has no model voice,
// and the judge session uses the reviewer model with tools disabled).

const ABSOLUTE_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\/home\/|\/Users\/|\/root\/)/;
const STEP_TOOL_PATTERN = /^\s*\d+\.\s*调用\s+([A-Za-z][A-Za-z0-9_.-]*)/gm;

function candidateToolSequence(prompt) {
  const text = String(prompt || '');
  const tools = [];
  for (const match of text.matchAll(STEP_TOOL_PATTERN)) tools.push(match[1]);
  return tools;
}

function staticSkillChecks(candidate) {
  const prompt = String(candidate?.prompt || '');
  const description = String(candidate?.description || '');
  const preconditions = Array.isArray(candidate?.verification?.preconditions)
    ? candidate.verification.preconditions.filter(Boolean)
    : [];
  const tools = candidateToolSequence(prompt);
  const checks = [
    {
      id: 'content-present',
      ok: prompt.trim().length >= 40 && description.trim().length >= 8,
      detail: prompt.trim().length >= 40 ? 'prompt 与 description 内容充分' : 'prompt 或 description 过短，不足以指导执行'
    },
    {
      id: 'parameterized',
      ok: prompt.includes('{{workspace}}') || preconditions.length > 0,
      detail: prompt.includes('{{workspace}}') || preconditions.length > 0
        ? '工作区参数化或前置条件已声明'
        : 'prompt 既没有 {{workspace}} 参数也没有前置条件，执行范围不受控'
    },
    {
      id: 'no-absolute-paths',
      ok: !ABSOLUTE_PATH_PATTERN.test(prompt),
      detail: ABSOLUTE_PATH_PATTERN.test(prompt) ? 'prompt 含绝对路径，跨工作区不可复用' : '没有硬编码绝对路径'
    },
    {
      id: 'safe-content',
      ok: !containsUnsafeText(`${prompt}\n${description}`),
      detail: containsUnsafeText(`${prompt}\n${description}`) ? '内容未通过安全筛查' : '内容通过安全筛查'
    },
    {
      id: 'tool-sequence-wellformed',
      ok: tools.length >= 3 && tools.every(tool => prompt.includes(tool)),
      detail: tools.length >= 3
        ? `解析出 ${tools.length} 个步骤工具且全部出现在 prompt 中`
        : `步骤工具序列不完整（解析到 ${tools.length} 个，至少需要 3 个）`
    }
  ];
  return { checks, tools };
}

function evaluateSkillCandidate({ candidate, judge = null } = {}) {
  const { checks, tools } = staticSkillChecks(candidate);
  const judgeExecutable = judge?.executable === true;
  const results = [
    ...checks.map(check => ({ id: check.id, ok: check.ok === true, detail: clip(check.detail, DETAIL_MAX) })),
    {
      id: 'model-executable',
      ok: judgeExecutable,
      detail: judge
        ? (judgeExecutable
          ? clip(judge.summary || '独立 judge 判定该候选可按原文执行', DETAIL_MAX)
          : `judge 判定不可直接执行：${clip((judge.issues || []).join('；') || '未说明原因', DETAIL_MAX)}`)
        : 'judge 不可用（运行时离线或返回无效），无法证明候选可执行'
    }
  ];
  const passed = results.filter(result => result.ok).length;
  const failed = results.length - passed;
  return {
    suiteId: SKILL_VALIDATION_SUITE_ID,
    rubricVersion: RUBRIC_VERSION,
    taskIds: results.map(result => result.id),
    ok: failed === 0 && results.length > 0,
    passed,
    failed,
    ranAt: Date.now(),
    tools,
    judgeSummary: judge ? clip(judge.summary || '', 300) : '',
    digest: digestFor(results)
  };
}

function auditSuiteStability({ suite, sandboxDir, runs = 2 } = {}) {
  const count = Math.max(1, Math.floor(Number(runs) || 2));
  const baseDir = resolveBaseDir(suite, sandboxDir);
  const digests = [];
  for (let index = 0; index < count; index += 1) {
    const report = runSuite({ suite, sandboxDir: path.join(baseDir, `run-${index + 1}`) });
    digests.push(digestFor(report.results));
  }
  return { stable: digests.every(digest => digest === digests[0]), digests };
}

function rubricInfo() {
  // Rubric versions are append-only; v1 is the initial entry.
  return { suiteId: CORE_SUITE_ID, rubricVersion: RUBRIC_VERSION, changelog: [] };
}

module.exports = {
  CORE_SUITE_ID,
  SKILL_VALIDATION_SUITE_ID,
  RUBRIC_VERSION,
  createCoreSuite,
  runSuite,
  evidenceRecord,
  writeEvidence,
  evaluatePromotion,
  createExperienceStore,
  evaluateSkillCandidate,
  staticSkillChecks,
  candidateToolSequence,
  auditSuiteStability,
  rubricInfo
};
