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
const MAX_REVIEW_DOCUMENT_CHARS = 4_000_000;

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
  if (status === 'added' || status === 'created') return 'created';
  if (status === 'deleted' || status === 'removed') return 'deleted';
  if (status === 'modified' || status === 'renamed' || status === 'changed' || status === 'updated' || status === 'copied') return 'modified';
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

function boundedReviewDocument(original, modified) {
  const before = normalizeLineEndings(original);
  const after = normalizeLineEndings(modified);
  if (before.length > MAX_REVIEW_DOCUMENT_CHARS || after.length > MAX_REVIEW_DOCUMENT_CHARS) {
    return { error: '文件过大，无法在审阅编辑器中完整显示。', code: 'REVIEW_FILE_TOO_LARGE' };
  }
  return { original: before, modified: after };
}

function openCodeReviewDocument(workspace, item = {}) {
  const sourcePath = item?.file || item?.path;
  const resolved = resolveWorkspaceFile(workspace, sourcePath);
  const status = normalizeOpenCodeStatus(item?.status);
  let modified = '';
  if (resolved && fs.existsSync(resolved)) {
    try {
      modified = fs.readFileSync(resolved, 'utf8');
    } catch (error) {
      return { error: error?.message || '无法读取修改后的文件。', code: 'REVIEW_FILE_READ_FAILED' };
    }
  }
  let original;
  if (Object.prototype.hasOwnProperty.call(item, 'before')) {
    original = item.before == null ? '' : String(item.before);
  } else if (item?.patch) {
    original = reversePatches(modified, [item.patch]);
  } else if (status === 'created') {
    original = '';
  }
  if (original === undefined) {
    return { error: '无法恢复该文件修改前的完整内容，将显示差异片段。', code: 'REVIEW_BASELINE_UNAVAILABLE' };
  }
  return boundedReviewDocument(original, modified);
}

function gitExec(workspace, args, timeoutMs = 4000) {
  return new Promise(resolve => {
    try {
      const child = require('child_process').execFile(
        'git',
        args,
        { cwd: workspace, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout) => resolve(error ? undefined : stdout)
      );
      child?.on('error', () => resolve(undefined));
    } catch {
      resolve(undefined);
    }
  });
}

// One `git cat-file --batch` process answers every HEAD baseline request,
// replacing one `git show` spawn per changed file (which dominated
// finalization on edit-heavy runs under Windows process-startup cost).
// Responses arrive strictly in request order: present objects answer
// "<oid> <type> <size>\n<content>\n", missing ones answer "<ref>:<path> missing\n".
// Content is decoded as UTF-8 to match the previous `git show` (execFile)
// behavior. `ref` selects the source: 'HEAD' (default) for HEAD blobs, ''
// for index stage-0 entries (`:path`).
async function readGitHeadFiles(workspace, relativePaths, { ref = 'HEAD' } = {}) {
  const results = new Map();
  const paths = [...new Set((Array.isArray(relativePaths) ? relativePaths : [])
    .map(value => String(value || '').replaceAll('\\', '/'))
    .filter(Boolean))];
  if (!paths.length) return results;

  const chunks = [];
  await new Promise(resolve => {
    let child;
    let timer = null;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { child?.kill(); } catch {}
      resolve();
    };
    let childProcess;
    try {
      childProcess = require('child_process');
      child = childProcess.spawn('git', ['cat-file', '--batch'], {
        cwd: workspace,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore']
      });
    } catch {
      return settle();
    }
    timer = setTimeout(settle, 8000);
    child.once('error', settle);
    child.once('close', settle);
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stdin.once('error', settle);
    child.stdin.end(paths.map(requestPath => `${ref ? `${ref}:` : ':'}${requestPath}\n`).join(''), 'utf8');
  });

  const GIT_OBJECT_TYPES = new Set(['blob', 'tree', 'commit', 'tag']);
  const buffer = Buffer.concat(chunks);
  let offset = 0;
  for (const requestPath of paths) {
    if (offset >= buffer.length) break;
    const headerEnd = buffer.indexOf(0x0a, offset);
    if (headerEnd === -1) break;
    const header = buffer.subarray(offset, headerEnd).toString('utf8').trim();
    offset = headerEnd + 1;
    const parts = header.split(' ');
    const size = Number(parts[parts.length - 1]);
    // A missing request echoes "HEAD:<path> missing"; a present one echoes
    // "<sha> blob <size>". Checking both the type token and the numeric size
    // keeps paths that merely contain words like "blob" from being misread.
    const isPresent = GIT_OBJECT_TYPES.has(parts[1]) && Number.isInteger(size) && size >= 0;
    if (!isPresent) continue;
    const content = buffer.subarray(offset, offset + size).toString('utf8');
    offset += size;
    if (buffer[offset] === 0x0a) offset += 1;
    results.set(requestPath, content);
  }
  return results;
}

async function readGitStatusEntries(workspace) {
  const stdout = await gitExec(workspace, ['status', '--porcelain', '-z', '--untracked-files=all']);
  if (stdout === undefined) return null;
  const entries = [];
  const tokens = stdout.split('\0');
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;
    // Porcelain v1 -z format: "XY <path>" or "XY <path>\0<path>" for renames.
    const statusCode = token.slice(0, 2);
    let filePath = token.slice(3);
    if (statusCode.includes('R') || statusCode.includes('C')) index += 1;
    if (!filePath) continue;
    if (filePath.endsWith('/')) continue;
    const worktreeStatus = statusCode[1];
    if (worktreeStatus === 'D') continue; // deletions have no mtime to verify; skip in sweep
    entries.push({
      path: filePath,
      untracked: statusCode === '??'
    });
  }
  return entries;
}

const SWEEP_IGNORED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '__pycache__', '.yanagent', '.codegraph', '.ua', '.pets', 'vendor'
]);
const SWEEP_MAX_FILES = 20000;
const SWEEP_MAX_DURATION_MS = 1500;

// Run-start dirty-set snapshot caps: a filthy workspace must not stall run
// startup or balloon memory, so beyond the caps those files fall back to the
// end-of-run sweep's HEAD/birthtime heuristics.
const RUN_BASELINE_MAX_FILES = 400;
const RUN_BASELINE_MAX_TOTAL_BYTES = 48 * 1024 * 1024;
const RUN_BASELINE_MAX_FILE_BYTES = 8 * 1024 * 1024;

// Snapshot the worktree content of every file that is already dirty when a
// run starts (tracked-modified and untracked). Tool-mediated edits capture
// their own baselines when they execute, but bash-written files used to be
// anchored to HEAD at finalization — wrong when the file was already
// modified before the run, and empty for untracked files.
async function captureWorkspaceBaselines(workspace) {
  const root = path.resolve(String(workspace || ''));
  if (!root || !fs.existsSync(root)) return new Map();
  const entries = await readGitStatusEntries(root);
  if (!entries || !entries.length) return new Map();

  const candidates = [];
  for (const entry of entries.slice(0, RUN_BASELINE_MAX_FILES)) {
    const resolved = resolveWorkspaceFile(root, entry.path);
    if (!resolved) continue;
    candidates.push(resolved);
  }
  const sized = await Promise.all(candidates.map(async resolved => {
    try {
      const stat = await fsp.stat(resolved);
      return stat.isFile() && stat.size > 0 && stat.size <= RUN_BASELINE_MAX_FILE_BYTES
        ? { resolved, size: stat.size }
        : null;
    } catch {
      return null;
    }
  }));
  let totalBytes = 0;
  const readable = sized.filter(item => item && (() => {
    if (totalBytes + item.size > RUN_BASELINE_MAX_TOTAL_BYTES) return false;
    totalBytes += item.size;
    return true;
  })());
  const baselines = new Map();
  await Promise.all(readable.map(async ({ resolved }) => {
    try {
      const buffer = await fsp.readFile(resolved);
      if (bufferLooksBinary(buffer)) return;
      baselines.set(canonicalFilePath(resolved), { path: resolved, before: buffer.toString('utf8') });
    } catch {}
  }));
  return baselines;
}

async function collectWorkspaceFileSweep(workspace, options = {}) {
  const startedAt = Math.max(0, Number(options.startTime) || 0);
  const result = new Map();
  const root = path.resolve(String(workspace || ''));
  if (!root || !fs.existsSync(root)) return result;
  const selected = Array.isArray(options.paths) && options.paths.length
    ? new Set(options.paths.map(file => resolveWorkspaceFile(root, file)).filter(Boolean).map(canonicalFilePath))
    : null;

  const gitEntries = startedAt ? await readGitStatusEntries(root) : null;
  if (gitEntries && gitEntries.length) {
    const tracked = [];
    for (const entry of gitEntries) {
      const resolved = resolveWorkspaceFile(root, entry.path);
      if (!resolved || (selected && !selected.has(canonicalFilePath(resolved)))) continue;
      try {
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) continue;
        if (Number(stat.mtimeMs) < startedAt - 2000) continue;
      } catch {
        continue;
      }
      if (entry.untracked) {
        let before;
        try {
          const stat = fs.statSync(resolved);
          before = Number(stat.birthtimeMs) >= startedAt - 2000 ? null : undefined;
        } catch {
          before = undefined;
        }
        result.set(canonicalFilePath(resolved), { path: resolved, before, touched: true, sweep: true });
        continue;
      }
      tracked.push({ resolved, gitPath: entry.path });
    }
    const headContents = await readGitHeadFiles(root, tracked.map(item => item.gitPath));
    for (const item of tracked) {
      // Absent from HEAD (read failed or batch truncated): skip, matching the
      // per-file `git show` semantics where undefined skipped the entry.
      if (!headContents.has(item.gitPath)) continue;
      result.set(canonicalFilePath(item.resolved), {
        path: item.resolved,
        before: headContents.get(item.gitPath),
        touched: true,
        sweep: true
      });
    }
    return result;
  }

  if (!startedAt) return result;
  const deadline = Date.now() + SWEEP_MAX_DURATION_MS;
  const queue = selected ? [] : [root];
  if (selected) {
    for (const full of selected) {
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile() || Number(stat.mtimeMs) < startedAt - 2000) continue;
        const before = Number(stat.birthtimeMs) >= startedAt - 2000 ? null : undefined;
        result.set(full, { path: full, before, touched: true, sweep: true });
      } catch {}
    }
  }
  let visited = 0;
  while (queue.length && visited < SWEEP_MAX_FILES && Date.now() < deadline) {
    const dir = queue.shift();
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (++visited >= SWEEP_MAX_FILES || Date.now() >= deadline) break;
      const full = path.join(dir, name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!SWEEP_IGNORED_DIRECTORIES.has(name)) queue.push(full);
        continue;
      }
      if (!stat.isFile()) continue;
      if (Number(stat.mtimeMs) < startedAt - 2000) continue;
      const before = Number(stat.birthtimeMs) >= startedAt - 2000 ? null : undefined;
      result.set(canonicalFilePath(full), { path: full, before, touched: true, sweep: true });
    }
  }
  return result;
}

async function summarizeOpenCodeToolChanges(workspace, messages, options = {}) {
  const requestedPaths = Array.isArray(options.paths) && options.paths.length
    ? new Set(options.paths.map(file => resolveWorkspaceFile(workspace, file)).filter(Boolean).map(canonicalFilePath))
    : null;
  const wanted = file => file && (!requestedPaths || requestedPaths.has(canonicalFilePath(file)));
  const observations = new Map();
  const changes = new Map();
  const parts = completedToolParts(messages, options);
  const mutationTools = new Set([
    'edit', 'write', 'apply_patch', 'edit_file', 'write_file', 'create_file', 'patch'
  ]);

  if (options.baselines instanceof Map) {
    for (const [entryKey, entryValue] of options.baselines) {
      const entry = entryValue && typeof entryValue === 'object' && Object.prototype.hasOwnProperty.call(entryValue, 'before')
        ? entryValue
        : { path: entryKey, before: entryValue };
      const filePath = resolveWorkspaceFile(workspace, entry.path || entryKey);
      if (!wanted(filePath)) continue;
      if (reviewEntryLooksBinary(workspace, { file: filePath, before: entry.before })) continue;
      changes.set(canonicalFilePath(filePath), {
        file: filePath,
        before: entry.before,
        hasBefore: true,
        patches: [],
        direct: [],
        ...(entry.touched ? { touched: true } : {})
      });
    }
  }

  for (const candidate of options.touchedFiles instanceof Set ? options.touchedFiles : []) {
    const filePath = resolveWorkspaceFile(workspace, candidate);
    if (!wanted(filePath) || reviewEntryLooksBinary(workspace, { file: filePath })) continue;
    const key = canonicalFilePath(filePath);
    const existing = changes.get(key);
    if (existing) {
      existing.touched = true;
      continue;
    }
    changes.set(key, {
      file: filePath,
      before: undefined,
      hasBefore: false,
      patches: [],
      direct: [],
      touched: true
    });
  }

  for (const part of parts) {
    const state = part.state || {};
    const input = state.input || {};
    const metadata = state.metadata || {};
    const display = metadata.display || {};
    if (String(part.tool || '') === 'read' && display.path && Object.prototype.hasOwnProperty.call(display, 'text')) {
      const observedPath = resolveWorkspaceFile(workspace, display.path);
      if (wanted(observedPath)) observations.set(canonicalFilePath(observedPath), String(display.text ?? ''));
      continue;
    }

    const rawFileDiff = metadata.filediff || metadata.fileDiff;
    const fileDiff = rawFileDiff && typeof rawFileDiff === 'object'
      ? rawFileDiff
      : null;
    if (!fileDiff && !mutationTools.has(String(part.tool || ''))) continue;
    const candidatePath = fileDiff?.file
      || fileDiff?.path
      || metadata.filepath
      || metadata.filePath
      || input.filePath
      || input.file_path
      || input.path
      || input.file
      || input.targetPath
      || input.target_file
      || input.target;
    const filePath = resolveWorkspaceFile(workspace, candidatePath);
    if (!wanted(filePath)) continue;
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
    if (!change.hasBefore && (metadata.exists === false || fileDiff?.exists === false)) {
      change.before = null;
      change.hasBefore = true;
    } else if (!change.hasBefore && observations.has(key)) {
      change.before = observations.get(key);
      change.hasBefore = true;
    }
    change.touched = true;
    if (fileDiff?.patch) change.patches.push(String(fileDiff.patch));
    if (fileDiff) {
      change.direct.push({
        file: filePath,
        ...(fileDiff.patch ? { patch: String(fileDiff.patch) } : {}),
        additions: Math.max(0, Number(fileDiff.additions) || 0),
        deletions: Math.max(0, Number(fileDiff.deletions) || 0),
        status: fileDiff.status || 'modified'
      });
    }
  }

  const results = [];
  const cache = options.cache instanceof Map ? options.cache : null;
  for (const change of changes.values()) {
    // Live review polls this every few hundred milliseconds while a run (or
    // its subagents) writes files. Memoize per file on stat identity so an
    // unchanged file skips the readFile + reversePatches + double diff that
    // otherwise saturate the main process during edit storms.
    let stat = null;
    try { stat = await fsp.stat(change.file); } catch {}
    const cacheKey = canonicalFilePath(change.file);
    const patchesKey = `${change.patches.length}:${change.direct.length}:${change.hasBefore ? (change.before === null ? 'deleted' : String(change.before).length) : 'unknown'}`;
    const cached = cache?.get(cacheKey);
    if (cached && cached.patchesKey === patchesKey && stat && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      if (cached.result) results.push(cached.result);
      continue;
    }
    if (reviewEntryLooksBinary(workspace, change)) {
      cache?.set(cacheKey, { mtimeMs: stat?.mtimeMs, size: stat?.size, patchesKey, result: null });
      continue;
    }
    let store = (entry) => { cache?.set(cacheKey, { mtimeMs: stat?.mtimeMs, size: stat?.size, patchesKey, result: entry }); };
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
      if (beforeExists === afterExists && beforeText === afterText) {
        store(null); // unchanged since the last poll: skip next time too
        continue;
      }
      const stats = countLineDiff(beforeText, afterText);
      const entry = {
        file: change.file,
        ...(options.includeDiff !== false ? { patch: createTwoFilesPatch(change.file, change.file, beforeText, afterText, '', '', { context: 3 }) } : {}),
        additions: stats.additions,
        deletions: stats.deletions,
        status: !beforeExists && afterExists ? 'added' : (beforeExists && !afterExists ? 'deleted' : 'modified')
      };
      store(entry);
      results.push(entry);
      continue;
    }

    if (change.direct.length) {
      const latest = change.direct.at(-1);
      const entry = {
        ...(options.includeDiff === false ? { file: latest.file, status: latest.status } : latest),
        additions: change.direct.reduce((sum, item) => sum + item.additions, 0),
        deletions: change.direct.reduce((sum, item) => sum + item.deletions, 0)
      };
      store(entry);
      results.push(entry);
      continue;
    }

    if (change.touched) {
      const startedAt = Math.max(0, Number(options.startTime || options.startedAt) || 0);
      let createdDuringRun = false;
      if (afterExists && startedAt > 0) {
        try {
          const birthStat = fs.statSync(change.file);
          createdDuringRun = birthStat.isFile()
            && Number(birthStat.birthtimeMs) >= Math.max(0, startedAt - 2_000);
        } catch {}
      }
      if (createdDuringRun) {
        const afterText = normalizeLineEndings(String(after));
        const stats = countLineDiff('', afterText);
        const entry = {
          file: change.file,
          ...(options.includeDiff !== false ? { patch: createTwoFilesPatch(change.file, change.file, '', afterText, '', '', { context: 3 }) } : {}),
          additions: stats.additions,
          deletions: stats.deletions,
          status: 'added'
        };
        store(entry);
        results.push(entry);
        continue;
      }
      if (afterExists) {
        // The file exists but we could not recover its pre-run content
        // (e.g. written by a shell command outside tracked tool calls).
        // Report it as modified rather than an opaque "unknown +0/-0" row.
        const entry = {
          file: change.file,
          additions: 0,
          deletions: 0,
          status: 'modified',
          partial: true
        };
        store(entry);
        results.push(entry);
        continue;
      }
      const entry = {
        file: change.file,
        additions: 0,
        deletions: 0,
        status: 'unknown'
      };
      store(entry);
      results.push(entry);
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

function summarizeOpenCodeDiffs(workspace, diffs, { includeDiff = false, documentPath = '', startTime = 0, startedAt = 0, paths = null } = {}) {
  const runStartedAt = Math.max(0, Number(startTime || startedAt) || 0);
  const requestedDocumentPath = String(documentPath || '').replace(/\\/g, '/');
  // Windowed review: build rows only for the requested paths so a huge change
  // set never materializes every file's diff in one IPC payload.
  const requestedPaths = Array.isArray(paths) && paths.length
    ? new Set(paths.map(item => String(item || '').replace(/\\/g, '/')).filter(Boolean))
    : null;
  const files = (Array.isArray(diffs) ? diffs : []).flatMap(item => {
    const filePath = openCodeDisplayPath(workspace, item?.file || item?.path);
    if (!filePath) return [];
    if (requestedPaths && !requestedPaths.has(filePath)) return [];
    if (reviewEntryLooksBinary(workspace, item)) return [];
    let additions = Math.max(0, Number(item?.additions) || 0);
    let deletions = Math.max(0, Number(item?.deletions) || 0);
    let status = normalizeOpenCodeStatus(item?.status);
    let recoveredAfter = '';
    if (status === 'unknown' && runStartedAt) {
      try {
        const resolved = resolveWorkspaceFile(workspace, filePath);
        const stat = resolved ? fs.statSync(resolved) : null;
        if (stat?.isFile() && Number(stat.birthtimeMs) >= Math.max(0, runStartedAt - 2_000)) {
          recoveredAfter = fs.readFileSync(resolved, 'utf8');
          const stats = countLineDiff('', recoveredAfter);
          additions = stats.additions;
          deletions = stats.deletions;
          status = 'created';
        }
      } catch {}
    }
    if (status === 'unknown') {
      // File exists but the source diff gave no usable status: call it modified
      // with the reported counts instead of surfacing an opaque "unknown".
      try {
        const resolved = resolveWorkspaceFile(workspace, filePath);
        if (resolved && fs.existsSync(resolved)) status = 'modified';
      } catch {}
    }
    const file = {
      path: filePath,
      additions,
      deletions,
      status
    };
    if (includeDiff) {
      file.diff = recoveredAfter
        ? buildLineDiff('', recoveredAfter)
        : buildPatchRows(item?.patch);
    }
    if (requestedDocumentPath && filePath === requestedDocumentPath) {
      const document = recoveredAfter
        ? boundedReviewDocument('', recoveredAfter)
        : openCodeReviewDocument(workspace, item);
      if (document.error) file.documentError = document;
      else file.document = document;
    }
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

async function summarizeRunChanges(workspace, changes, { includeDiff = false, documentPath = '', paths = null } = {}) {
  const requestedDocumentPath = String(documentPath || '').replace(/\\/g, '/');
  const requestedPaths = Array.isArray(paths) && paths.length
    ? new Set(paths.map(item => String(item || '').replace(/\\/g, '/')).filter(Boolean))
    : null;
  const files = [];
  for (const change of changes || []) {
    if (reviewEntryLooksBinary(workspace, change)) continue;
    const relativePath = workspaceRelativePath(workspace, change.path);
    if (requestedPaths && !requestedPaths.has(relativePath)) continue;
    const beforeExists = change.before !== null && change.before !== undefined;
    const afterExists = fs.existsSync(change.path);
    let after = '';
    if (afterExists) {
      try {
        after = await fsp.readFile(change.path, 'utf8');
      } catch (error) {
        files.push({
          path: relativePath,
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
      path: relativePath,
      additions: stats.additions,
      deletions: stats.deletions,
      status: !beforeExists && afterExists ? 'created' : (beforeExists && !afterExists ? 'deleted' : 'modified'),
      op: change.op || 'write'
    };
    if (includeDiff) file.diff = buildLineDiff(before, after);
    if (requestedDocumentPath && file.path === requestedDocumentPath) {
      const document = boundedReviewDocument(before, after);
      if (document.error) file.documentError = document;
      else file.document = document;
    }
    files.push(file);
  }
  return {
    count: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files
  };
}

async function buildRollbackChanges(workspace, changes, baselines = new Map()) {
  const rollback = [];
  for (const item of changes || []) {
    if (reviewEntryLooksBinary(workspace, item)) continue;
    const resolved = resolveWorkspaceFile(workspace, item?.file || item?.path);
    if (!resolved) continue;
    const key = canonicalFilePath(resolved);
    let before;
    if (baselines instanceof Map) {
      const supplied = baselineEntry(baselines, key, resolved);
      if (supplied.found) {
        const raw = supplied.value;
        before = raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'before')
          ? raw.before
          : raw;
      }
    }
    if (before === undefined && item?.patch) {
      let after = null;
      try { after = await fsp.readFile(resolved, 'utf8'); } catch {}
      if (after !== null) before = reversePatches(after, [item.patch]);
    }
    if (before === undefined) continue; // no reliable pre-run content to restore
    rollback.push({ path: resolved, before, op: item?.status || 'modified', ts: Date.now() });
  }
  return rollback;
}

module.exports = {
  bufferLooksBinary,
  buildPatchRows,
  buildLineDiff,
  buildRollbackChanges,
  captureWorkspaceBaselines,
  collectWorkspaceFileSweep,
  countLineDiff,
  filterReviewSummary,
  limitDiffRows,
  mergeChangeHistory,
  readGitHeadFiles,
  reviewEntryLooksBinary,
  openCodeReviewDocument,
  summarizeOpenCodeDiffs,
  summarizeOpenCodeToolChanges,
  summarizeRunChanges,
  stringLooksBinary,
  workspaceRelativePath
};
