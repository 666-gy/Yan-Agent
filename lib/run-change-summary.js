'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const {
  applyPatch,
  createTwoFilesPatch,
  diffLines,
  parsePatch,
  reversePatch
} = require('diff');

const BINARY_REVIEW_EXTENSIONS = new Set([
  '.7z', '.a', '.aac', '.accdb', '.appx', '.avi', '.avif', '.bin', '.bmp', '.bz2',
  '.class', '.ckpt', '.dat', '.db', '.db3', '.dds', '.dll', '.dmg', '.doc', '.docx',
  '.dylib', '.eot', '.exe', '.exr', '.flac', '.flv', '.gguf', '.gif', '.gz', '.heic',
  '.heif', '.ico', '.iso', '.jar', '.jpeg', '.jpg', '.lib', '.m4a', '.m4v', '.mdb',
  '.mkv', '.mov', '.mp3', '.mp4', '.mpeg', '.mpg', '.msi', '.o', '.odp', '.ods',
  '.odt', '.ogg', '.onnx', '.opus', '.otf', '.pdf', '.png', '.ppt', '.pptx', '.psd',
  '.pt', '.pth', '.pyc', '.pyd', '.rar', '.raw', '.safetensors', '.so', '.sqlite',
  '.swf', '.tar', '.tgz', '.tif', '.tiff', '.ttf', '.war', '.wasm', '.wav', '.webm',
  '.webp', '.wma', '.wmv', '.woff', '.woff2', '.xls', '.xlsx', '.xz', '.zip', '.zst'
]);
const BINARY_SAMPLE_BYTES = 8_192;

function hasUtf16Bom(buffer) {
  return buffer.length >= 2 && (
    (buffer[0] === 0xff && buffer[1] === 0xfe)
    || (buffer[0] === 0xfe && buffer[1] === 0xff)
  );
}

function bufferLooksBinary(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (!buffer.length || hasUtf16Bom(buffer)) return false;
  let controlBytes = 0;
  for (const byte of buffer) {
    if (byte === 0) return true;
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) controlBytes++;
  }
  if (controlBytes > Math.max(2, Math.floor(buffer.length * 0.01))) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return false;
  } catch {
    return true;
  }
}

function stringLooksBinary(value) {
  const text = String(value ?? '');
  if (!text) return false;
  if (text.includes('\u0000')) return true;
  let controls = 0;
  for (const character of text) {
    const code = character.codePointAt(0) || 0;
    if (code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13) controls++;
  }
  return controls > Math.max(2, Math.floor(text.length * 0.01));
}

function fileSampleLooksBinary(filePath) {
  let descriptor;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) return false;
    descriptor = fs.openSync(filePath, 'r');
    const sample = Buffer.alloc(Math.min(BINARY_SAMPLE_BYTES, stat.size));
    const bytesRead = fs.readSync(descriptor, sample, 0, sample.length, 0);
    return bufferLooksBinary(sample.subarray(0, bytesRead));
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function patchDeclaresBinary(patch) {
  const text = String(patch || '').toLowerCase();
  return text.includes('git binary patch') || text.includes('binary files differ');
}

function reviewEntryLooksBinary(workspace, item = {}) {
  if (item.binary === true || item.isBinary === true) return true;
  const sourcePath = String(item.file || item.path || '').trim();
  if (BINARY_REVIEW_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) return true;
  if (patchDeclaresBinary(item.patch)) return true;
  if (Buffer.isBuffer(item.before) && bufferLooksBinary(item.before)) return true;
  if (typeof item.before === 'string' && stringLooksBinary(item.before)) return true;
  const rows = Array.isArray(item.diff?.rows) ? item.diff.rows : [];
  if (rows.some(row => stringLooksBinary(row?.text))) return true;
  const filePath = resolveWorkspaceFile(workspace, sourcePath);
  return !!filePath && fileSampleLooksBinary(filePath);
}

function filterReviewSummary(workspace, summary = {}) {
  const files = (Array.isArray(summary?.files) ? summary.files : [])
    .filter(file => !reviewEntryLooksBinary(workspace, file));
  return {
    ...summary,
    count: files.length,
    additions: files.reduce((sum, file) => sum + (Math.max(0, Number(file.additions) || 0)), 0),
    deletions: files.reduce((sum, file) => sum + (Math.max(0, Number(file.deletions) || 0)), 0),
    files
  };
}

function workspaceRelativePath(workspace, filePath) {
  const relative = path.relative(workspace, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return path.basename(filePath);
  return relative.replace(/\\/g, '/');
}

function normalizeLineEndings(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function countLineDiff(before, after) {
  let additions = 0;
  let deletions = 0;
  for (const part of diffLines(normalizeLineEndings(before), normalizeLineEndings(after))) {
    const count = Number(part.count) || 0;
    if (part.added) additions += count;
    if (part.removed) deletions += count;
  }
  return { additions, deletions };
}

function splitDiffLines(value) {
  const normalized = normalizeLineEndings(value);
  if (!normalized) return [];
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function limitDiffRows(rows, maxRows = 2400) {
  if (rows.length <= maxRows) return { rows, truncated: false };
  const headCount = Math.floor(maxRows * 0.7);
  const tailCount = Math.max(0, maxRows - headCount - 1);
  return {
    rows: [
      ...rows.slice(0, headCount),
      { type: 'truncate', count: rows.length - headCount - tailCount },
      ...rows.slice(rows.length - tailCount)
    ],
    truncated: true
  };
}

function buildPatchRows(patch, { maxRows = 2400 } = {}) {
  const source = String(patch || '');
  if (!source.trim()) return { rows: [], truncated: false };

  let parsed;
  try {
    parsed = parsePatch(source);
  } catch {
    return { rows: [], truncated: false };
  }

  const rows = [];
  for (const file of parsed) {
    let previousOldEnd = null;
    let previousNewEnd = null;
    for (const hunk of file.hunks || []) {
      if (previousOldEnd !== null && previousNewEnd !== null) {
        const omitted = Math.max(0, hunk.oldStart - previousOldEnd, hunk.newStart - previousNewEnd);
        if (omitted > 0) rows.push({ type: 'skip', count: omitted });
      }

      let oldLine = Number(hunk.oldStart) || 1;
      let newLine = Number(hunk.newStart) || 1;
      for (const line of hunk.lines || []) {
        const marker = line[0];
        if (marker === '\\') continue;
        const type = marker === '+' ? 'add' : (marker === '-' ? 'del' : 'context');
        rows.push({
          type,
          oldLine: type === 'add' ? null : oldLine,
          newLine: type === 'del' ? null : newLine,
          text: line.slice(1)
        });
        if (type !== 'add') oldLine++;
        if (type !== 'del') newLine++;
      }
      previousOldEnd = oldLine;
      previousNewEnd = newLine;
    }
  }

  return limitDiffRows(rows, maxRows);
}

function normalizeOpenCodeStatus(status) {
  if (status === 'added') return 'created';
  if (status === 'deleted') return 'deleted';
  if (status === 'modified') return 'modified';
  return 'unknown';
}

function canonicalFilePath(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function resolveWorkspaceFile(workspace, filePath) {
  const root = path.resolve(String(workspace || ''));
  const source = String(filePath || '').trim();
  if (!root || !source) return '';
  const resolved = path.isAbsolute(source) ? path.resolve(source) : path.resolve(root, source);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return '';
  return resolved;
}

function messageCreatedAt(message) {
  return Number(message?.info?.time?.created) || 0;
}

function completedToolParts(messages, options = {}) {
  const startTime = Math.max(0, Number(options.startTime) || 0);
  const endTime = Number.isFinite(Number(options.endTime)) ? Number(options.endTime) : Number.POSITIVE_INFINITY;
  const messageIDs = options.messageIDs instanceof Set ? options.messageIDs : null;
  return (Array.isArray(messages) ? messages : [])
    .filter(message => message?.info?.role === 'assistant')
    .filter(message => !messageIDs || messageIDs.has(String(message?.info?.id || '')))
    .filter(message => {
      const createdAt = messageCreatedAt(message);
      return createdAt >= startTime && createdAt <= endTime;
    })
    .sort((left, right) => messageCreatedAt(left) - messageCreatedAt(right))
    .flatMap(message => Array.isArray(message?.parts) ? message.parts : [])
    .filter(part => part?.type === 'tool' && part?.state?.status === 'completed');
}

function baselineEntry(baselines, key, filePath) {
  if (!(baselines instanceof Map)) return { found: false, value: undefined };
  if (baselines.has(key)) return { found: true, value: baselines.get(key) };
  if (baselines.has(filePath)) return { found: true, value: baselines.get(filePath) };
  return { found: false, value: undefined };
}

function reversePatches(after, patches) {
  let content = String(after ?? '');
  for (const patch of [...patches].reverse()) {
    try {
      const parsed = parsePatch(String(patch || ''));
      if (parsed.length !== 1) return undefined;
      const previous = applyPatch(content, reversePatch(parsed[0]));
      if (previous === false) return undefined;
      content = previous;
    } catch {
      return undefined;
    }
  }
  return content;
}

async function summarizeOpenCodeToolChanges(workspace, messages, options = {}) {
  const observations = new Map();
  const changes = new Map();
  const parts = completedToolParts(messages, options);
  const mutationTools = new Set(['edit', 'write', 'apply_patch']);

  if (options.baselines instanceof Map) {
    for (const [entryKey, entryValue] of options.baselines) {
      const entry = entryValue && typeof entryValue === 'object' && Object.prototype.hasOwnProperty.call(entryValue, 'before')
        ? entryValue
        : { path: entryKey, before: entryValue };
      const filePath = resolveWorkspaceFile(workspace, entry.path || entryKey);
      if (!filePath) continue;
      if (reviewEntryLooksBinary(workspace, { file: filePath, before: entry.before })) continue;
      changes.set(canonicalFilePath(filePath), {
        file: filePath,
        before: entry.before,
        hasBefore: true,
        patches: [],
        direct: []
      });
    }
  }

  for (const part of parts) {
    const state = part.state || {};
    const input = state.input || {};
    const metadata = state.metadata || {};
    const display = metadata.display || {};
    if (String(part.tool || '') === 'read' && display.path && Object.prototype.hasOwnProperty.call(display, 'text')) {
      const observedPath = resolveWorkspaceFile(workspace, display.path);
      if (observedPath) observations.set(canonicalFilePath(observedPath), String(display.text ?? ''));
      continue;
    }

    const fileDiff = metadata.filediff && typeof metadata.filediff === 'object'
      ? metadata.filediff
      : null;
    if (!fileDiff && !mutationTools.has(String(part.tool || ''))) continue;
    const candidatePath = fileDiff?.file || metadata.filepath || input.filePath || input.path;
    const filePath = resolveWorkspaceFile(workspace, candidatePath);
    if (!filePath) continue;
    if (reviewEntryLooksBinary(workspace, { file: filePath, patch: fileDiff?.patch })) continue;
    const key = canonicalFilePath(filePath);
    let change = changes.get(key);
    if (!change) {
      const supplied = baselineEntry(options.baselines, key, filePath);
      let before;
      let hasBefore = false;
      if (supplied.found) {
        const raw = supplied.value;
        before = raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'before')
          ? raw.before
          : raw;
        hasBefore = true;
      } else if (observations.has(key)) {
        before = observations.get(key);
        hasBefore = true;
      } else if (metadata.exists === false) {
        before = null;
        hasBefore = true;
      }
      change = { file: filePath, before, hasBefore, patches: [], direct: [] };
      changes.set(key, change);
    }
    if (fileDiff?.patch) {
      change.patches.push(String(fileDiff.patch));
      change.direct.push({
        file: filePath,
        patch: String(fileDiff.patch),
        additions: Math.max(0, Number(fileDiff.additions) || 0),
        deletions: Math.max(0, Number(fileDiff.deletions) || 0),
        status: fileDiff.status || 'modified'
      });
    }
  }

  const results = [];
  for (const change of changes.values()) {
    if (reviewEntryLooksBinary(workspace, change)) continue;
    let after = null;
    let afterExists = false;
    try {
      after = await fsp.readFile(change.file, 'utf8');
      afterExists = true;
    } catch {}

    let before = change.hasBefore ? change.before : undefined;
    if (change.patches.length && afterExists) {
      const recoveredBefore = reversePatches(after, change.patches);
      const baselineMatchesAfter = before !== undefined
        && normalizeLineEndings(before === null ? '' : String(before)) === normalizeLineEndings(String(after));
      if (before === undefined || (baselineMatchesAfter && recoveredBefore !== undefined)) {
        before = recoveredBefore;
      }
    }
    if (before !== undefined) {
      const beforeExists = before !== null;
      const beforeText = normalizeLineEndings(beforeExists ? String(before) : '');
      const afterText = normalizeLineEndings(afterExists ? String(after) : '');
      if (beforeExists === afterExists && beforeText === afterText) continue;
      const stats = countLineDiff(beforeText, afterText);
      results.push({
        file: change.file,
        patch: createTwoFilesPatch(change.file, change.file, beforeText, afterText, '', '', { context: 3 }),
        additions: stats.additions,
        deletions: stats.deletions,
        status: !beforeExists && afterExists ? 'added' : (beforeExists && !afterExists ? 'deleted' : 'modified')
      });
      continue;
    }

    if (change.direct.length) {
      const latest = change.direct.at(-1);
      results.push({
        ...latest,
        additions: change.direct.reduce((sum, item) => sum + item.additions, 0),
        deletions: change.direct.reduce((sum, item) => sum + item.deletions, 0)
      });
    }
  }
  return results;
}

function openCodeDisplayPath(workspace, filePath) {
  const source = String(filePath || '').trim();
  if (!source) return '';
  if (workspace && path.isAbsolute(source)) return workspaceRelativePath(workspace, source);
  return source.replace(/\\/g, '/');
}

function summarizeOpenCodeDiffs(workspace, diffs, { includeDiff = false } = {}) {
  const files = (Array.isArray(diffs) ? diffs : []).flatMap(item => {
    if (reviewEntryLooksBinary(workspace, item)) return [];
    const filePath = openCodeDisplayPath(workspace, item?.file || item?.path);
    if (!filePath) return [];
    const file = {
      path: filePath,
      additions: Math.max(0, Number(item?.additions) || 0),
      deletions: Math.max(0, Number(item?.deletions) || 0),
      status: normalizeOpenCodeStatus(item?.status)
    };
    if (includeDiff) file.diff = buildPatchRows(item?.patch);
    return [file];
  });
  return {
    count: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files
  };
}

function mergeChangeHistory(snapshots) {
  const ordered = [];
  for (const [snapshotIndex, snapshot] of (snapshots || []).entries()) {
    for (const [changeIndex, change] of (snapshot?.changes || []).entries()) {
      if (!change?.path) continue;
      ordered.push({
        change,
        order: Number(change.ts) || Number(snapshot?.ts) || snapshotIndex,
        snapshotIndex,
        changeIndex
      });
    }
  }
  ordered.sort((a, b) =>
    a.order - b.order
    || a.snapshotIndex - b.snapshotIndex
    || a.changeIndex - b.changeIndex
  );

  const firstChangeByPath = new Map();
  for (const item of ordered) {
    const key = path.resolve(String(item.change.path)).toLowerCase();
    if (!firstChangeByPath.has(key)) firstChangeByPath.set(key, { ...item.change });
  }
  return [...firstChangeByPath.values()];
}

function buildLineDiff(before, after, { contextLines = 3, maxRows = 2400 } = {}) {
  const rows = [];
  let oldLine = 1;
  let newLine = 1;

  for (const part of diffLines(normalizeLineEndings(before), normalizeLineEndings(after))) {
    const type = part.added ? 'add' : (part.removed ? 'del' : 'context');
    for (const text of splitDiffLines(part.value)) {
      rows.push({
        type,
        oldLine: type === 'add' ? null : oldLine,
        newLine: type === 'del' ? null : newLine,
        text
      });
      if (type !== 'add') oldLine++;
      if (type !== 'del') newLine++;
    }
  }

  const changedIndexes = rows
    .map((row, index) => row.type === 'context' ? -1 : index)
    .filter(index => index >= 0);
  if (!changedIndexes.length) return { rows: [], truncated: false };

  const visible = new Set();
  for (const index of changedIndexes) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(rows.length - 1, index + contextLines);
    for (let cursor = start; cursor <= end; cursor++) visible.add(cursor);
  }

  const compact = [];
  for (let index = 0; index < rows.length;) {
    if (visible.has(index)) {
      compact.push(rows[index]);
      index++;
      continue;
    }
    const start = index;
    while (index < rows.length && !visible.has(index)) index++;
    compact.push({ type: 'skip', count: index - start });
  }

  return limitDiffRows(compact, maxRows);
}

async function summarizeRunChanges(workspace, changes, { includeDiff = false } = {}) {
  const files = [];
  for (const change of changes || []) {
    if (reviewEntryLooksBinary(workspace, change)) continue;
    const beforeExists = change.before !== null && change.before !== undefined;
    const afterExists = fs.existsSync(change.path);
    let after = '';
    if (afterExists) {
      try {
        after = await fsp.readFile(change.path, 'utf8');
      } catch (error) {
        files.push({
          path: workspaceRelativePath(workspace, change.path),
          additions: 0,
          deletions: 0,
          status: 'unknown',
          error: error.message
        });
        continue;
      }
    }
    const before = beforeExists ? String(change.before) : '';
    if (before === after && beforeExists === afterExists) continue;
    const stats = countLineDiff(before, after);
    const file = {
      path: workspaceRelativePath(workspace, change.path),
      additions: stats.additions,
      deletions: stats.deletions,
      status: !beforeExists && afterExists ? 'created' : (beforeExists && !afterExists ? 'deleted' : 'modified'),
      op: change.op || 'write'
    };
    if (includeDiff) file.diff = buildLineDiff(before, after);
    files.push(file);
  }
  return {
    count: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files
  };
}

module.exports = {
  bufferLooksBinary,
  buildPatchRows,
  buildLineDiff,
  countLineDiff,
  filterReviewSummary,
  mergeChangeHistory,
  reviewEntryLooksBinary,
  summarizeOpenCodeDiffs,
  summarizeOpenCodeToolChanges,
  summarizeRunChanges,
  workspaceRelativePath
};
