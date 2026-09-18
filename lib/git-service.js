'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const {
  buildLineDiff,
  buildPatchRows,
  countLineDiff,
  limitDiffRows,
  readGitHeadFiles,
  stringLooksBinary
} = require('./run-change-summary');

const DEFAULT_TIMEOUT_MS = 30_000;
const NETWORK_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_DIFF_CHARS = 600_000;
const MAX_REVIEW_DOCUMENT_BYTES = 4 * 1024 * 1024;
// One combined `git diff` for the whole review pass; a large multi-file change
// set must not overflow the default 8 MB buffer before rows are clipped.
const REVIEW_PATCH_MAX_BYTES = 64 * 1024 * 1024;
const INTERNAL_PATHSPECS = [':(exclude).yanagent', ':(exclude).yanagent/**'];
// Branch lists, remotes and identity never change on file edits; the hot
// status path reuses them for this long instead of re-spawning for-each-ref /
// remote / config on every workspace event burst.
const HEAVY_STATUS_TTL_MS = 3_000;

let gitAvailabilityPromise = null;
const heavyStatusCache = new Map();
const gitDirPathCache = new Map();

function clip(value, max = 4_000) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

function redactSecrets(value) {
  return String(value || '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, '$1***:***@')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@]+)@/gi, '$1***@')
    .replace(/\b(?:gh[opsu]|github_pat|glpat|sk)-[A-Za-z0-9_-]{12,}\b/g, '[redacted]');
}

function publicRemoteUrl(value) {
  const raw = String(value || '').trim();
  if (!/^(?:https?|ssh):\/\//i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    return parsed.href;
  } catch {
    return redactSecrets(raw);
  }
}

function gitError(message, code = 'GIT_ERROR', details = {}) {
  const error = new Error(redactSecrets(message));
  error.code = code;
  Object.assign(error, details);
  return error;
}

function runFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxBuffer: options.maxBuffer || MAX_OUTPUT_BYTES,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: options.allowCredentialPrompt ? '1' : '0',
        GIT_OPTIONAL_LOCKS: options.readOnly ? '0' : '1',
        ...(options.env || {})
      }
    }, (error, stdout = '', stderr = '') => {
      if (!error) {
        resolve({ stdout: String(stdout), stderr: String(stderr), exitCode: 0 });
        return;
      }
      reject(gitError(
        clip(stderr || stdout || error.message || 'Git command failed.'),
        error.killed ? 'GIT_TIMEOUT' : (error.code === 'ENOENT' ? 'GIT_NOT_FOUND' : 'GIT_COMMAND_FAILED'),
        { exitCode: Number.isInteger(error.code) ? error.code : null }
      ));
    });
  });
}

async function runGit(args, options = {}) {
  return runFile('git', args, options);
}

async function tryGit(args, options = {}) {
  try {
    const result = await runGit(args, options);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code, exitCode: error.exitCode };
  }
}

async function detectGit({ refresh = false } = {}) {
  if (!gitAvailabilityPromise || refresh) {
    gitAvailabilityPromise = tryGit(['--version'], { readOnly: true })
      .then(result => result.ok
        ? { available: true, version: result.stdout.trim().replace(/^git version\s+/i, '') }
        : { available: false, version: '', error: result.error || '未找到 Git。' });
  }
  return gitAvailabilityPromise;
}

async function resolveDirectory(value, label = '工作区') {
  const resolved = path.resolve(String(value || '').trim());
  if (!String(value || '').trim()) throw gitError(`${label}路径为空。`, 'WORKSPACE_REQUIRED');
  let stat;
  try {
    stat = await fsp.stat(resolved);
  } catch {
    throw gitError(`${label}不存在：${resolved}`, 'DIRECTORY_NOT_FOUND');
  }
  if (!stat.isDirectory()) throw gitError(`${label}不是文件夹：${resolved}`, 'NOT_A_DIRECTORY');
  return resolved;
}

async function resolveRepository(workspace, { required = true } = {}) {
  const directory = await resolveDirectory(workspace);
  const result = await tryGit(['-C', directory, 'rev-parse', '--show-toplevel'], { readOnly: true });
  if (!result.ok) {
    if (!required) return null;
    throw gitError('当前工作区不是 Git 仓库。', 'NOT_A_REPOSITORY');
  }
  return path.resolve(result.stdout.trim());
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeRepoPaths(root, values) {
  const source = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const normalized = [];
  for (const value of source) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    const absolute = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
    if (!pathInside(root, absolute)) throw gitError(`文件不在仓库内：${raw}`, 'PATH_OUTSIDE_REPOSITORY');
    const relative = path.relative(root, absolute).replace(/\\/g, '/');
    if (!relative || relative === '.git' || relative.startsWith('.git/')
        || relative === '.yanagent' || relative.startsWith('.yanagent/')) {
      throw gitError('不能直接操作 Git 或 Yan Agent 内部数据目录。', 'INVALID_REPOSITORY_PATH');
    }
    if (!seen.has(relative)) {
      seen.add(relative);
      normalized.push(relative);
    }
  }
  if (!normalized.length) throw gitError('没有可操作的文件。', 'PATH_REQUIRED');
  return normalized;
}

function statusLabel(indexStatus, worktreeStatus) {
  if (indexStatus === '?' && worktreeStatus === '?') return 'untracked';
  if (indexStatus === '!' && worktreeStatus === '!') return 'ignored';
  if ([indexStatus, worktreeStatus].some(code => code === 'U')
      || ['AA', 'DD', 'AU', 'UA', 'DU', 'UD'].includes(`${indexStatus}${worktreeStatus}`)) return 'conflicted';
  if (indexStatus === 'R' || worktreeStatus === 'R') return 'renamed';
  if (indexStatus === 'C' || worktreeStatus === 'C') return 'copied';
  if (indexStatus === 'D' || worktreeStatus === 'D') return 'deleted';
  if (indexStatus === 'A' || worktreeStatus === 'A') return 'added';
  if (indexStatus === 'T' || worktreeStatus === 'T') return 'typechanged';
  return 'modified';
}

// Parses the `## ` header of `status --porcelain=v1 -z --branch`:
//   `## main...origin/main [ahead 1, behind 2]` | `[gone]`
//   `## main` (no upstream) | `## HEAD (no branch)` | `## No commits yet on main`
// Branch names cannot contain `..`, so splitting on `...` is unambiguous.
function parsePorcelainBranchInfo(raw) {
  const header = (String(raw || '').split('\0').find(record => record.startsWith('## ')) || '').slice(3);
  const info = { currentBranch: '', upstream: '', ahead: 0, behind: 0, unborn: false, detached: false };
  if (!header) return info;
  const noCommits = header.match(/^No commits yet on (.+)$/);
  if (noCommits) {
    info.currentBranch = noCommits[1];
    info.unborn = true;
    return info;
  }
  if (header === 'HEAD (no branch)') {
    info.detached = true;
    return info;
  }
  const bracketIndex = header.indexOf(' [');
  const mainPart = bracketIndex === -1 ? header : header.slice(0, bracketIndex);
  const bracket = bracketIndex === -1 ? '' : header.slice(bracketIndex + 1);
  const dotsIndex = mainPart.indexOf('...');
  if (dotsIndex === -1) {
    info.currentBranch = mainPart;
  } else {
    info.currentBranch = mainPart.slice(0, dotsIndex);
    info.upstream = mainPart.slice(dotsIndex + 3);
  }
  const counts = bracket.match(/^\[(.*)\]$/);
  if (counts && counts[1] !== 'gone') {
    const ahead = counts[1].match(/ahead (\d+)/);
    const behind = counts[1].match(/behind (\d+)/);
    info.ahead = ahead ? Number(ahead[1]) : 0;
    info.behind = behind ? Number(behind[1]) : 0;
  }
  return info;
}

function parsePorcelainStatus(raw) {
  const records = String(raw || '').split('\0');
  const changes = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record || record.startsWith('## ')) continue;
    const indexStatus = record[0] || ' ';
    const worktreeStatus = record[1] || ' ';
    const filePath = record.length > 3 ? record.slice(3) : '';
    let originalPath = '';
    if (indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C') {
      originalPath = records[++index] || '';
    }
    const staged = indexStatus !== ' ' && indexStatus !== '?' && indexStatus !== '!';
    const unstaged = worktreeStatus !== ' ' && worktreeStatus !== '!';
    changes.push({
      path: filePath.replace(/\\/g, '/'),
      originalPath: originalPath.replace(/\\/g, '/'),
      indexStatus,
      worktreeStatus,
      status: statusLabel(indexStatus, worktreeStatus),
      staged,
      unstaged,
      conflicted: statusLabel(indexStatus, worktreeStatus) === 'conflicted'
    });
  }
  return changes;
}

function parseRefList(raw, remote = false) {
  return String(raw || '').split(/\r?\n/).filter(Boolean).map(line => {
    const [name = '', upstream = '', hash = '', head = '', ...subjectParts] = line.split('\0');
    return {
      name,
      upstream,
      hash,
      current: head.trim() === '*',
      subject: subjectParts.join('\0'),
      remote
    };
  }).filter(item => item.name && (!remote || !item.name.endsWith('/HEAD')));
}

function parseNumstat(raw) {
  return String(raw || '').split(/\r?\n/).reduce((totals, line) => {
    if (!line) return totals;
    const [added, deleted] = line.split('\t');
    const addedCount = Number(added);
    const deletedCount = Number(deleted);
    if (Number.isFinite(addedCount)) totals.added += addedCount;
    if (Number.isFinite(deletedCount)) totals.deleted += deletedCount;
    if (added === '-' || deleted === '-') totals.binaryFiles += 1;
    return totals;
  }, { added: 0, deleted: 0, binaryFiles: 0 });
}

// `--numstat -z` record layout (verified against git 2.53):
//   plain:   `added\tdeleted\tpath\0`
//   binary:  `-\t-\tpath\0`
//   rename:  `added\tdeleted\t\0origPath\0newPath\0` — the stats record ends
//            with an empty path field and the next two records are the paths.
function parseNumstatZ(raw) {
  const records = String(raw || '').split('\0');
  const entries = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record) continue;
    const fields = record.split('\t');
    const added = fields[0];
    const deleted = fields[1];
    const binary = added === '-' || deleted === '-';
    if (fields.length === 3 && fields[2] === '') {
      const originalPath = records[++index] || '';
      const filePath = records[++index] || '';
      if (filePath) entries.push({ added: 0, deleted: 0, binary, path: filePath, originalPath });
      continue;
    }
    const filePath = fields.slice(2).join('\t');
    if (!filePath) continue;
    entries.push({
      added: binary ? 0 : Number(added) || 0,
      deleted: binary ? 0 : Number(deleted) || 0,
      binary,
      path: filePath,
      originalPath: ''
    });
  }
  return entries;
}

function sumNumstatZEntries(entries) {
  const totals = { added: 0, deleted: 0, binaryFiles: 0 };
  for (const entry of entries) {
    totals.added += entry.added;
    totals.deleted += entry.deleted;
    if (entry.binary) totals.binaryFiles += 1;
  }
  return totals;
}

// Porcelain rename info is the ground truth, but `git diff -M` misses
// renames when the new side is unstaged-edited or untracked (it cannot see
// untracked files at all). For renames, take the HEAD blob of the original
// path and diff it against the new content directly — one batched cat-file
// process for every original, no per-file `git show`.
async function renameContentPairs(root, renamedChanges, { staged = false } = {}) {
  const pairs = new Map();
  const originals = [...new Set(renamedChanges.map(change => change.originalPath))];
  const afters = [...new Set(renamedChanges.map(change => change.path))];
  const [beforeContents, afterContents] = await Promise.all([
    readGitHeadFiles(root, originals),
    staged ? readGitHeadFiles(root, afters, { ref: '' }) : readWorktreeFiles(root, afters)
  ]);
  for (const change of renamedChanges) {
    const before = beforeContents.get(change.originalPath);
    const after = afterContents.get(change.path);
    if (before === undefined || after === undefined) continue;
    if (stringLooksBinary(before) || stringLooksBinary(after)) {
      pairs.set(change.path, { binary: true, before, after });
      continue;
    }
    pairs.set(change.path, { binary: false, before, after });
  }
  return pairs;
}

async function readWorktreeFiles(root, relativePaths) {
  const contents = new Map();
  await Promise.all(relativePaths.map(async relativePath => {
    try {
      contents.set(relativePath, await fsp.readFile(path.join(root, relativePath), 'utf8'));
    } catch {}
  }));
  return contents;
}

// diffStats with porcelain-rename awareness: numstat entries that belong to a
// porcelain rename (new path or old path) are replaced by content-based counts.
async function renameAwareDiffStats(root, changes, numstatResult, { staged = false } = {}) {
  const entries = numstatResult.ok ? parseNumstatZ(numstatResult.stdout) : [];
  const renamed = changes.filter(change => change.status === 'renamed' && change.originalPath);
  if (!renamed.length) return sumNumstatZEntries(entries);
  const renamePaths = new Set(renamed.map(change => change.path));
  const renameOrigins = new Set(renamed.map(change => change.originalPath));
  const totals = sumNumstatZEntries(entries.filter(entry => (
    !renamePaths.has(entry.path) && !renameOrigins.has(entry.path) && !renameOrigins.has(entry.originalPath)
  )));
  const pairs = await renameContentPairs(root, renamed, { staged });
  for (const pair of pairs.values()) {
    if (pair.binary) continue;
    const counted = countLineDiff(pair.before, pair.after);
    totals.added += counted.additions;
    totals.deleted += counted.deletions;
  }
  return totals;
}

async function listBranches(root) {
  const format = '%(refname:short)%00%(upstream:short)%00%(objectname:short)%00%(HEAD)%00%(subject)';
  const [local, remote] = await Promise.all([
    runGit(['-C', root, 'for-each-ref', `--format=${format}`, '--sort=refname', 'refs/heads/'], { readOnly: true }),
    runGit(['-C', root, 'for-each-ref', `--format=${format}`, '--sort=refname', 'refs/remotes/'], { readOnly: true })
  ]);
  return {
    local: parseRefList(local.stdout),
    remote: parseRefList(remote.stdout, true)
  };
}

async function listRemotes(root) {
  const names = (await runGit(['-C', root, 'remote'], { readOnly: true })).stdout
    .split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  return Promise.all(names.map(async name => {
    const [fetchUrl, pushUrl] = await Promise.all([
      tryGit(['-C', root, 'remote', 'get-url', name], { readOnly: true }),
      tryGit(['-C', root, 'remote', 'get-url', '--push', name], { readOnly: true })
    ]);
    const rawFetchUrl = fetchUrl.ok ? fetchUrl.stdout.trim() : '';
    const rawPushUrl = pushUrl.ok ? pushUrl.stdout.trim() : '';
    const safeFetchUrl = publicRemoteUrl(rawFetchUrl);
    const safePushUrl = publicRemoteUrl(rawPushUrl);
    return {
      name,
      fetchUrl: safeFetchUrl,
      pushUrl: safePushUrl,
      webUrl: remoteWebUrl(rawFetchUrl),
      credentialsHidden: safeFetchUrl !== rawFetchUrl || safePushUrl !== rawPushUrl
    };
  }));
}

async function readConfig(root, key) {
  const result = await tryGit(['-C', root, 'config', '--get', key], { readOnly: true });
  return result.ok ? result.stdout.trim() : '';
}

async function resolveGitDir(root) {
  const cached = gitDirPathCache.get(root);
  if (cached !== undefined) return cached;
  const result = await tryGit(['-C', root, 'rev-parse', '--git-dir'], { readOnly: true });
  const gitDir = result.ok ? path.resolve(root, result.stdout.trim()) : '';
  gitDirPathCache.set(root, gitDir);
  return gitDir;
}

function invalidateStatusCaches(root) {
  if (root) {
    heavyStatusCache.delete(root);
    gitDirPathCache.delete(root);
    reviewScanCache.delete(root);
  } else {
    heavyStatusCache.clear();
    gitDirPathCache.clear();
    reviewScanCache.clear();
  }
}

async function operationState(root) {
  const gitDir = await resolveGitDir(root);
  if (!gitDir) return '';
  const states = [
    ['rebase', ['rebase-merge', 'rebase-apply']],
    ['merge', ['MERGE_HEAD']],
    ['cherry-pick', ['CHERRY_PICK_HEAD']],
    ['revert', ['REVERT_HEAD']]
  ];
  for (const [name, markers] of states) {
    if (markers.some(marker => fs.existsSync(path.join(gitDir, marker)))) return name;
  }
  return '';
}

// Branches, remotes and identity only change through branch/remote/network
// operations (which invalidate the cache); file edits never touch them.
async function loadHeavyStatus(root, { freshHeavy = false } = {}) {
  const cached = freshHeavy ? undefined : heavyStatusCache.get(root);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const [branches, remotes, userName, userEmail] = await Promise.all([
    listBranches(root),
    listRemotes(root),
    readConfig(root, 'user.name'),
    readConfig(root, 'user.email')
  ]);
  const data = { branches, remotes, identity: { name: userName, email: userEmail } };
  heavyStatusCache.set(root, { expiresAt: Date.now() + HEAVY_STATUS_TTL_MS, data });
  return data;
}

async function repositoryStatus(workspace, { freshHeavy = false, skipHeavy = false } = {}) {
  const git = await detectGit();
  const normalizedWorkspace = await resolveDirectory(workspace);
  if (!git.available) return { ...git, workspace: normalizedWorkspace, isRepository: false };
  const root = await resolveRepository(normalizedWorkspace, { required: false });
  if (!root) return { ...git, workspace: normalizedWorkspace, isRepository: false };

  // Fast path: the porcelain branch header already carries currentBranch,
  // upstream and ahead/behind, so the whole sweep is 2 spawns (plus numstat
  // when there are tracked changes) instead of one process per fact.
  const [porcelain, headResult] = await Promise.all([
    runGit([
      '-C', root, 'status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all',
      '--', '.', ...INTERNAL_PATHSPECS
    ], { readOnly: true }),
    tryGit(['-C', root, 'rev-parse', '--short', 'HEAD'], { readOnly: true })
  ]);
  const branchInfo = parsePorcelainBranchInfo(porcelain.stdout);
  const changes = parsePorcelainStatus(porcelain.stdout);
  const head = headResult.ok ? headResult.stdout.trim() : '';
  const currentBranch = branchInfo.detached ? '' : branchInfo.currentBranch;
  const upstream = branchInfo.upstream;
  const unborn = branchInfo.unborn || (!head && !branchInfo.currentBranch && !branchInfo.detached);

  let diffStats = { added: 0, deleted: 0, binaryFiles: 0 };
  const pending = [];
  if (unborn) {
    // Fresh repository: `diff HEAD` fails, but --cached/--diff against the
    // empty tree still report the staged/unstaged line counts.
    if (changes.some(change => change.staged && change.status !== 'untracked')) {
      pending.push(tryGit(['-C', root, 'diff', '--cached', '--numstat', '-M', '-z', '--', '.', ...INTERNAL_PATHSPECS], { readOnly: true }));
      pending.push(tryGit(['-C', root, 'diff', '--numstat', '-M', '-z', '--', '.', ...INTERNAL_PATHSPECS], { readOnly: true }));
    }
  } else if (changes.some(change => change.status !== 'untracked')) {
    pending.push(tryGit(['-C', root, 'diff', 'HEAD', '--numstat', '-M', '-z', '--', '.', ...INTERNAL_PATHSPECS], { readOnly: true }));
  }
  pending.push(skipHeavy ? Promise.resolve({ branches: [], remotes: [] }) : loadHeavyStatus(root, { freshHeavy }));
  pending.push(operationState(root));
  const results = await Promise.all(pending);
  const operation = results.pop();
  const heavy = results.pop();
  if (pending.length > 2) {
    if (unborn) {
      // Renames cannot exist before the first commit.
      diffStats = sumNumstatZEntries([
        ...parseNumstatZ(results[0].ok ? results[0].stdout : ''),
        ...parseNumstatZ(results[1].ok ? results[1].stdout : '')
      ]);
    } else {
      diffStats = await renameAwareDiffStats(root, changes, results[0]);
    }
  }
  const remoteName = upstream.includes('/') ? upstream.slice(0, upstream.indexOf('/')) : (heavy.remotes.some(item => item.name === 'origin') ? 'origin' : (heavy.remotes[0]?.name || ''));
  return {
    ...git,
    workspace: normalizedWorkspace,
    root,
    isRepository: true,
    name: path.basename(root),
    currentBranch,
    detached: branchInfo.detached || (!currentBranch && !!head && !unborn),
    head,
    upstream,
    remoteName,
    ahead: branchInfo.ahead,
    behind: branchInfo.behind,
    clean: changes.length === 0,
    operation,
    changes,
    diffStats,
    stagedCount: changes.filter(item => item.staged).length,
    unstagedCount: changes.filter(item => item.unstaged).length,
    conflictedCount: changes.filter(item => item.conflicted).length,
    branches: heavy.branches,
    remotes: heavy.remotes,
    identity: heavy.identity
  };
}

function validateBranchName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 240 || name.startsWith('-') || /[\u0000-\u001f\u007f~^:?*\\\[\]]/.test(name)
      || name.includes('..') || name.includes('@{') || name.endsWith('.') || name.endsWith('/') || name.includes('//')) {
    throw gitError('分支名称无效。', 'INVALID_BRANCH');
  }
  return name;
}

function validateRemoteName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) throw gitError('远程仓库名称无效。', 'INVALID_REMOTE');
  return name;
}

function validateRemoteUrl(value) {
  const url = String(value || '').trim();
  if (!url || url.length > 4_096 || url.startsWith('-') || /[\r\n\u0000]/.test(url)) {
    throw gitError('远程仓库地址无效。', 'INVALID_REMOTE_URL');
  }
  const allowed = /^(?:https?|ssh|git|file):\/\//i.test(url)
    || /^[^\s@]+@[^\s:]+:.+/.test(url)
    || path.isAbsolute(url);
  if (!allowed) throw gitError('仅支持 HTTPS、SSH、Git、file URL 或本地绝对路径。', 'INVALID_REMOTE_URL');
  return url;
}

async function initRepository(workspace, initialBranch = 'main') {
  const directory = await resolveDirectory(workspace);
  const existing = await resolveRepository(directory, { required: false });
  if (!existing) {
    await runGit(['-C', directory, 'init', '-b', validateBranchName(initialBranch)]);
    invalidateStatusCaches();
  }
  return repositoryStatus(directory);
}

async function stageFiles(workspace, paths = [], all = false) {
  const root = await resolveRepository(workspace);
  if (all) await runGit(['-C', root, 'add', '-A', '--', '.', ...INTERNAL_PATHSPECS]);
  else await runGit(['-C', root, 'add', '--', ...normalizeRepoPaths(root, paths)]);
  return repositoryStatus(root);
}

async function unstageFiles(workspace, paths = [], all = false) {
  const root = await resolveRepository(workspace);
  const hasHead = (await tryGit(['-C', root, 'rev-parse', '--verify', 'HEAD'], { readOnly: true })).ok;
  if (hasHead) {
    await runGit(all
      ? ['-C', root, 'restore', '--staged', '--', '.', ...INTERNAL_PATHSPECS]
      : ['-C', root, 'restore', '--staged', '--', ...normalizeRepoPaths(root, paths)]);
  } else {
    await runGit(all
      ? ['-C', root, 'rm', '--cached', '-r', '--ignore-unmatch', '--', '.', ...INTERNAL_PATHSPECS]
      : ['-C', root, 'rm', '--cached', '-r', '--ignore-unmatch', '--', ...normalizeRepoPaths(root, paths)]);
  }
  return repositoryStatus(root);
}

async function discardFiles(workspace, paths = []) {
  const root = await resolveRepository(workspace);
  const normalized = normalizeRepoPaths(root, paths);
  if (!normalized.length) return repositoryStatus(root);
  const status = await repositoryStatus(root);
  const byPath = new Map(status.changes.map(change => [change.path, change]));
  const hasHead = (await tryGit(['-C', root, 'rev-parse', '--verify', 'HEAD'], { readOnly: true })).ok;
  const tracked = [];
  const untracked = [];
  const stagedOnlyAdds = [];
  for (const relative of normalized) {
    const change = byPath.get(relative);
    if (change && change.indexStatus === '?' && change.worktreeStatus === '?') untracked.push(relative);
    else if (!hasHead && change && change.staged && !change.unstaged) stagedOnlyAdds.push(relative);
    else tracked.push(relative);
  }
  if (tracked.length) {
    await runGit(['-C', root, 'restore', '--worktree', '--source=HEAD', '--', ...tracked]);
  }
  if (stagedOnlyAdds.length) {
    // Fresh repository without HEAD: discarding a staged new file removes it entirely.
    await runGit(['-C', root, 'rm', '-f', '--', ...stagedOnlyAdds]);
  }
  if (untracked.length) {
    await runGit(['-C', root, 'clean', '-f', '--', ...untracked]);
  }
  return repositoryStatus(root);
}

async function commit(workspace, message, { amend = false } = {}) {
  const root = await resolveRepository(workspace);
  const cleanMessage = String(message || '').replace(/\u0000/g, '').trim();
  if (!cleanMessage) throw gitError('请输入提交说明。', 'COMMIT_MESSAGE_REQUIRED');
  if (cleanMessage.length > 10_000) throw gitError('提交说明过长。', 'COMMIT_MESSAGE_TOO_LONG');
  const args = ['-C', root, 'commit'];
  if (amend) args.push('--amend');
  args.push('-m', cleanMessage);
  await runGit(args, { timeoutMs: 60_000 });
  // Branch tips (and their subjects in the branch list) just changed.
  invalidateStatusCaches(root);
  const info = await runGit(['-C', root, 'log', '-1', '--format=%H%x00%h%x00%s'], { readOnly: true });
  const [hash = '', shortHash = '', subject = ''] = info.stdout.trim().split('\0');
  return { ok: true, commit: { hash, shortHash, subject }, status: await repositoryStatus(root) };
}

async function createBranch(workspace, branchName, { checkout = true } = {}) {
  const root = await resolveRepository(workspace);
  const name = validateBranchName(branchName);
  await runGit(checkout
    ? ['-C', root, 'switch', '-c', name]
    : ['-C', root, 'branch', name]);
  invalidateStatusCaches(root);
  return repositoryStatus(root);
}

async function switchBranch(workspace, branchName, remoteBranch = '') {
  const root = await resolveRepository(workspace);
  const name = validateBranchName(branchName);
  if (remoteBranch) {
    const remote = validateBranchName(remoteBranch);
    await runGit(['-C', root, 'switch', '--track', '-c', name, remote]);
  } else {
    await runGit(['-C', root, 'switch', name]);
  }
  invalidateStatusCaches(root);
  return repositoryStatus(root);
}

async function fetchRemote(workspace, remoteName = '') {
  const root = await resolveRepository(workspace);
  const args = ['-C', root, 'fetch', '--prune'];
  if (remoteName) args.push(validateRemoteName(remoteName));
  await runGit(args, { timeoutMs: NETWORK_TIMEOUT_MS, allowCredentialPrompt: true });
  invalidateStatusCaches(root);
  return repositoryStatus(root);
}

async function pull(workspace) {
  const status = await repositoryStatus(workspace);
  if (!status.upstream) throw gitError('当前分支尚未设置上游分支。请先推送。', 'UPSTREAM_REQUIRED');
  await runGit(['-C', status.root, 'pull', '--ff-only'], { timeoutMs: NETWORK_TIMEOUT_MS, allowCredentialPrompt: true });
  invalidateStatusCaches(status.root);
  return repositoryStatus(status.root);
}

async function push(workspace, remoteName = '') {
  const status = await repositoryStatus(workspace);
  if (!status.currentBranch) throw gitError('游离 HEAD 状态下不能直接推送。', 'DETACHED_HEAD');
  if (status.upstream) {
    await runGit(['-C', status.root, 'push'], { timeoutMs: NETWORK_TIMEOUT_MS, allowCredentialPrompt: true });
  } else {
    const remote = validateRemoteName(remoteName || status.remoteName || status.remotes[0]?.name || '');
    await runGit(['-C', status.root, 'push', '-u', remote, status.currentBranch], { timeoutMs: NETWORK_TIMEOUT_MS, allowCredentialPrompt: true });
  }
  invalidateStatusCaches(status.root);
  return repositoryStatus(status.root);
}

async function addRemote(workspace, remoteName, remoteUrl) {
  const root = await resolveRepository(workspace);
  await runGit(['-C', root, 'remote', 'add', validateRemoteName(remoteName), validateRemoteUrl(remoteUrl)]);
  invalidateStatusCaches(root);
  return repositoryStatus(root);
}

async function setRemoteUrl(workspace, remoteName, remoteUrl) {
  const root = await resolveRepository(workspace);
  await runGit(['-C', root, 'remote', 'set-url', validateRemoteName(remoteName), validateRemoteUrl(remoteUrl)]);
  invalidateStatusCaches(root);
  return repositoryStatus(root);
}

async function removeRemote(workspace, remoteName) {
  const root = await resolveRepository(workspace);
  await runGit(['-C', root, 'remote', 'remove', validateRemoteName(remoteName)]);
  invalidateStatusCaches(root);
  return repositoryStatus(root);
}

async function setIdentity(workspace, name, email) {
  const root = await resolveRepository(workspace);
  const cleanName = String(name || '').replace(/[\r\n\u0000]/g, ' ').trim().slice(0, 200);
  const cleanEmail = String(email || '').replace(/[\r\n\u0000]/g, '').trim().slice(0, 320);
  if (!cleanName) throw gitError('Git 用户名不能为空。', 'IDENTITY_NAME_REQUIRED');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw gitError('Git 邮箱格式无效。', 'IDENTITY_EMAIL_INVALID');
  await runGit(['-C', root, 'config', '--local', 'user.name', cleanName]);
  await runGit(['-C', root, 'config', '--local', 'user.email', cleanEmail]);
  invalidateStatusCaches(root);
  return repositoryStatus(root);
}

async function history(workspace, limit = 40) {
  const root = await resolveRepository(workspace);
  const count = Math.max(1, Math.min(200, Number(limit) || 40));
  const result = await tryGit([
    '-C', root, 'log', '--all', '--topo-order', '--decorate=short', `-${count}`,
    '--date=iso-strict',
    '--format=%H%x00%h%x00%P%x00%an%x00%aI%x00%s%x00%D'
  ], { readOnly: true });
  if (!result.ok) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean).map(line => {
    const [hash = '', shortHash = '', parents = '', author = '', date = '', subject = '', refs = ''] = line.split('\0');
    return { hash, shortHash, parents: parents.split(/\s+/).filter(Boolean), author, date, subject, refs };
  });
}

function gitReviewStatus(status) {
  if (status === 'added' || status === 'untracked' || status === 'copied') return 'created';
  if (status === 'deleted') return 'deleted';
  return 'modified';
}

const REVIEW_IMAGE_MIME = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml'
});
const MAX_REVIEW_IMAGE_BYTES = 8 * 1024 * 1024;

function reviewImageMime(filePath) {
  const extension = path.extname(String(filePath || '')).slice(1).toLowerCase();
  return REVIEW_IMAGE_MIME[extension] || '';
}

async function readReviewImage(root, relativePath) {
  const mimeType = reviewImageMime(relativePath);
  if (!mimeType) return null;
  try {
    const absolute = path.join(root, relativePath);
    const stat = await fsp.stat(absolute);
    if (!stat.isFile() || stat.size > MAX_REVIEW_IMAGE_BYTES) return null;
    const buffer = await fsp.readFile(absolute);
    return { mimeType, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}` };
  } catch {
    return null;
  }
}

function reviewDocumentError(message, code) {
  return { ok: false, error: message, code };
}

async function readReviewTextFile(absolutePath) {
  try {
    const stat = await fsp.stat(absolutePath);
    if (!stat.isFile()) return reviewDocumentError('文件不存在。', 'REVIEW_FILE_NOT_FOUND');
    if (stat.size > MAX_REVIEW_DOCUMENT_BYTES) {
      return reviewDocumentError('文件过大，无法在审阅编辑器中完整显示。', 'REVIEW_FILE_TOO_LARGE');
    }
    const buffer = await fsp.readFile(absolutePath);
    if (buffer.subarray(0, 8_000).includes(0)) {
      return reviewDocumentError('二进制文件无法作为文本差异显示。', 'REVIEW_BINARY_FILE');
    }
    return { ok: true, text: buffer.toString('utf8') };
  } catch (error) {
    if (error?.code === 'ENOENT') return reviewDocumentError('文件不存在。', 'REVIEW_FILE_NOT_FOUND');
    return reviewDocumentError(error?.message || '无法读取文件。', 'REVIEW_FILE_READ_FAILED');
  }
}

async function readReviewGitBlob(root, spec) {
  const result = await tryGit(['-C', root, 'show', spec], {
    readOnly: true,
    maxBuffer: MAX_REVIEW_DOCUMENT_BYTES + 1024
  });
  if (!result.ok) return reviewDocumentError(result.error || '无法读取 Git 文件内容。', 'REVIEW_GIT_BLOB_FAILED');
  if (Buffer.byteLength(result.stdout, 'utf8') > MAX_REVIEW_DOCUMENT_BYTES) {
    return reviewDocumentError('文件过大，无法在审阅编辑器中完整显示。', 'REVIEW_FILE_TOO_LARGE');
  }
  if (String(result.stdout).includes('\u0000')) {
    return reviewDocumentError('二进制文件无法作为文本差异显示。', 'REVIEW_BINARY_FILE');
  }
  return { ok: true, text: result.stdout };
}

async function reviewDocument(workspace, filePath, options = {}) {
  const root = await resolveRepository(workspace);
  const [relative] = normalizeRepoPaths(root, [filePath]);
  const status = await repositoryStatus(root);
  const change = status.changes.find(item => item.path === relative);
  if (!change) return reviewDocumentError('该文件已不在当前 Git 改动中。', 'REVIEW_CHANGE_NOT_FOUND');
  if (reviewImageMime(relative)) return reviewDocumentError('图像文件使用图像预览。', 'REVIEW_IMAGE_FILE');

  const hasHead = !!status.head;
  const staged = !!options.staged;
  const created = change.status === 'untracked' || change.status === 'added' || !hasHead;
  const deleted = change.status === 'deleted';
  const originalPath = change.originalPath || relative;

  let original = { ok: true, text: '' };
  if (!created && hasHead) original = await readReviewGitBlob(root, `HEAD:${originalPath}`);

  let modified = { ok: true, text: '' };
  if (!deleted) {
    modified = staged
      ? await readReviewGitBlob(root, `:${relative}`)
      : await readReviewTextFile(path.join(root, relative));
  }

  if (!original.ok) return original;
  if (!modified.ok) return modified;
  return {
    ok: true,
    path: relative,
    status: gitReviewStatus(change.status),
    original: original.text,
    modified: modified.text
  };
}

function countTextLines(content) {
  const normalized = String(content || '').replace(/\r\n?/g, '\n');
  if (!normalized) return 0;
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.length;
}

// Untracked files can be arbitrarily large; rows are capped with a truncate
// marker so one new file cannot inflate the review payload without bound.
function addedFileRows(content, { maxRows = 2400 } = {}) {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n').filter((_, index, source) => (
    index < source.length - 1 || source[index] !== ''
  ));
  const limited = limitDiffRows(
    lines.map((text, index) => ({ type: 'add', oldLine: null, newLine: index + 1, text })),
    maxRows
  );
  return { rows: limited.rows, truncated: limited.truncated, additions: lines.length };
}

// ---------------------------------------------------------------------------
// Review scanning: a change set can hold hundreds of files and tens of
// thousands of changed lines. Building diff rows for every file on the main
// thread and shipping them over IPC is what froze the review panel. The scan
// keeps only metadata (paths/status/counts) plus the combined patch when the
// caller explicitly wants full rows, and it is cached for a short window so
// switching files inside the panel reuses one repository sweep.
// ---------------------------------------------------------------------------
const reviewScanCache = new Map();
const REVIEW_SCAN_TTL_MS = 20_000;
const REVIEW_WINDOW_LINE_THRESHOLD = 4_000;

async function collectReviewScan(root, { staged = false, includePatch = false, fresh = false } = {}) {
  const cached = reviewScanCache.get(root);
  const cacheAge = cached ? Date.now() - cached.at : Infinity;
  // fresh means the caller explicitly forced a re-scan (refresh button after
  // files changed on disk). The 20s TTL cache only serves routine re-renders;
  // a short grace window here previously made a force refresh right after an
  // edit return a stale manifest with the new files missing.
  if (cached
    && !fresh
    && cached.staged === staged
    && cacheAge < REVIEW_SCAN_TTL_MS
    && (!includePatch || cached.scan.sectionsReady)) {
    return cached.scan;
  }

  const status = await repositoryStatus(root, { skipHeavy: true });
  const changes = staged ? status.changes.filter(change => change.staged) : status.changes;
  const hasHead = !!status.head;

  // Two git processes cover every tracked change (one `--numstat -z -M` for
  // stats, one full patch split by `diff --git` sections) instead of two per
  // file — process startup dominated review on edit-heavy change sets.
  const trackedChanges = changes.filter(change => change.status !== 'untracked');
  let sectionByPath = new Map();
  let entryByPath = new Map();
  let combinedDiffUsable = false;
  let sectionsReady = false;
  if (trackedChanges.length > 0) {
    const rangeArgs = staged ? ['diff', '--cached'] : ['diff', 'HEAD'];
    const [numstatResult, patchResult] = await Promise.all([
      tryGit(['-C', root, ...rangeArgs, '--numstat', '-M', '-z', '--', '.', ...INTERNAL_PATHSPECS], { readOnly: true }),
      includePatch
        ? tryGit(['-C', root, ...rangeArgs, '--no-ext-diff', '--no-color', '--unified=3', '-M', '--', '.', ...INTERNAL_PATHSPECS], { readOnly: true, maxBuffer: REVIEW_PATCH_MAX_BYTES })
        : Promise.resolve({ ok: false })
    ]);
    if (numstatResult.ok) {
      const entries = parseNumstatZ(numstatResult.stdout);
      entryByPath = new Map(entries.map(entry => [entry.path, entry]));
      if (includePatch && patchResult.ok) {
        const sections = splitPatchSections(patchResult.stdout);
        // Mismatch means an unhandled diff record shape; fall back to the
        // per-file path rather than rendering wrong rows.
        if (sections.length === entries.length) {
          sectionByPath = new Map(entries.map((entry, index) => [entry.path, sections[index]]));
          combinedDiffUsable = true;
          sectionsReady = true;
        }
      }
    }
  }

  // Untracked files (and every change in a repository without HEAD) only have
  // their on-disk content as a source: read once here for stats/binary flags.
  const diskBacked = changes.filter(change => (
    change.status !== 'deleted' && (change.status === 'untracked' || !hasHead)
  ));
  const diskStats = new Map();
  await Promise.all(diskBacked.map(async change => {
    try {
      const content = await fsp.readFile(path.join(root, change.path));
      const binary = content.subarray(0, 8_000).includes(0);
      if (binary || reviewImageMime(change.path)) {
        diskStats.set(change.path, { binary: true, additions: 0 });
      } else {
        diskStats.set(change.path, { binary: false, additions: countTextLines(content.toString('utf8')) });
      }
    } catch {
      diskStats.set(change.path, { binary: false, additions: 0 });
    }
  }));

  // Renames are content-diffed from their HEAD baseline (see
  // renameContentPairs): numstat/patch cannot see untracked rename targets.
  // Stats must stay rename-aware in every layout, so this runs regardless of
  // whether rows are materialized.
  let renamePairs = new Map();
  if (hasHead) {
    const renamed = changes.filter(change => change.status === 'renamed' && change.originalPath);
    if (renamed.length) renamePairs = await renameContentPairs(root, renamed, { staged });
  }

  const scan = {
    status,
    changes,
    hasHead,
    staged: !!staged,
    sectionsReady,
    combinedDiffUsable,
    sectionByPath,
    entryByPath,
    diskStats,
    renamePairs
  };
  reviewScanCache.set(root, { at: Date.now(), staged: !!staged, scan });
  return scan;
}

// Small change sets render every file, so one combined patch is still cheaper
// than one git process per file. Called only after the auto layout decided the
// set fits the window threshold.
async function ensureReviewScanSections(root, scan, staged) {
  if (scan.sectionsReady || !scan.entryByPath.size || !scan.hasHead) return;
  const rangeArgs = staged ? ['diff', '--cached'] : ['diff', 'HEAD'];
  const patchResult = await tryGit(
    ['-C', root, ...rangeArgs, '--no-ext-diff', '--no-color', '--unified=3', '-M', '--', '.', ...INTERNAL_PATHSPECS],
    { readOnly: true, maxBuffer: REVIEW_PATCH_MAX_BYTES }
  );
  if (!patchResult.ok) return;
  const sections = splitPatchSections(patchResult.stdout);
  if (sections.length !== scan.entryByPath.size) return;
  const sectionByPath = new Map();
  let index = 0;
  for (const path of scan.entryByPath.keys()) {
    sectionByPath.set(path, sections[index]);
    index += 1;
  }
  scan.sectionByPath = sectionByPath;
  scan.combinedDiffUsable = true;
  scan.sectionsReady = true;
}

function reviewFileStats(change, scan) {
  if (scan.renamePairs.has(change.path)) {
    const pair = scan.renamePairs.get(change.path);
    if (pair.binary) return { additions: 0, deletions: 0, binary: true };
    const counted = countLineDiff(pair.before, pair.after);
    return { additions: counted.additions, deletions: counted.deletions, binary: false };
  }
  const entry = scan.entryByPath.get(change.path);
  if (entry) return { additions: entry.added, deletions: entry.deleted, binary: entry.binary };
  const disk = scan.diskStats.get(change.path);
  if (disk) return { additions: disk.additions, deletions: 0, binary: disk.binary };
  return { additions: 0, deletions: 0, binary: false };
}

async function buildReviewFileRows(change, scan, root, { staged, maxRowsPerFile }) {
  let rows = [];
  let rowsTruncated = false;
  if (change.status === 'deleted') return { rows, rowsTruncated };

  const renamePair = scan.renamePairs.get(change.path);
  if (renamePair && !renamePair.binary) {
    const built = buildLineDiff(renamePair.before, renamePair.after, { maxRows: maxRowsPerFile });
    return { rows: built.rows, rowsTruncated: built.truncated === true };
  }

  const disk = scan.diskStats.get(change.path);
  if (disk || (change.status === 'untracked' && !scan.hasHead) || change.status === 'untracked') {
    if (disk?.binary) return { rows, rowsTruncated };
    try {
      const content = await fsp.readFile(path.join(root, change.path));
      const added = addedFileRows(content.toString('utf8'), { maxRows: maxRowsPerFile });
      return { rows: added.rows, rowsTruncated: added.truncated };
    } catch {
      return { rows, rowsTruncated };
    }
  }

  const entry = scan.entryByPath.get(change.path);
  if (entry?.binary) return { rows, rowsTruncated };
  if (scan.combinedDiffUsable) {
    const built = buildPatchRows(scan.sectionByPath.get(change.path) || '', { maxRows: maxRowsPerFile });
    return { rows: built.rows, rowsTruncated: built.truncated === true };
  }
  // Per-file fallback: only reached for the windowed file (or small sets whose
  // combined patch was unusable), so the extra git process cost is bounded.
  const patchResult = await tryGit([
    '-C', root, 'diff', staged ? '--cached' : 'HEAD', '--no-ext-diff', '--no-color', '--unified=3', '-M', '--', change.path
  ], { readOnly: true, maxBuffer: MAX_OUTPUT_BYTES });
  if (!patchResult.ok) return { rows, rowsTruncated };
  const built = buildPatchRows(patchResult.stdout, { maxRows: maxRowsPerFile });
  return { rows: built.rows, rowsTruncated: built.truncated === true };
}

async function review(workspace, options = {}) {
  const root = await resolveRepository(workspace);
  const staged = !!options.staged;
  const requestedLayout = options.layout === 'summary' || options.layout === 'full' ? options.layout : 'auto';
  const maxRowsPerFile = Math.max(1, Number(options.maxRowsPerFile) || 2400);
  const threshold = Math.max(1, Number(options.windowThreshold) || REVIEW_WINDOW_LINE_THRESHOLD);
  const requestedPaths = Array.isArray(options.paths) && options.paths.length
    ? new Set(options.paths.map(item => String(item || '').replace(/\\/g, '/')).filter(Boolean))
    : null;
  const windowPath = String(options.windowPath || '').replace(/\\/g, '/');

  const scan = await collectReviewScan(root, {
    staged,
    // Full rows for every file are only materialized when explicitly asked
    // for; the auto layout decides after seeing the change size.
    includePatch: requestedLayout === 'full' && !requestedPaths,
    fresh: options.fresh === true
  });
  const allChanges = scan.changes;
  const changes = requestedPaths
    ? allChanges.filter(change => requestedPaths.has(change.path) || requestedPaths.has(change.originalPath))
    : allChanges;

  const totals = changes.reduce((sum, change) => {
    const stats = reviewFileStats(change, scan);
    return {
      additions: sum.additions + stats.additions,
      deletions: sum.deletions + stats.deletions
    };
  }, { additions: 0, deletions: 0 });
  const windowed = requestedLayout === 'auto'
    && changes.length > 1
    && (totals.additions + totals.deletions) > threshold;
  // The renderer sends its current selection; an empty or stale path (first
  // open, deleted file) falls back to the first changed file so the window
  // always has content to show.
  const effectiveWindowPath = windowed
    ? (changes.some(change => change.path === windowPath) ? windowPath : (changes[0]?.path || ''))
    : '';
  if (requestedLayout === 'auto' && !windowed) await ensureReviewScanSections(root, scan, staged);
  const includeImages = options.includeImages !== false;

  const files = await Promise.all(changes.map(async change => {
    const stats = reviewFileStats(change, scan);
    const isWindowTarget = effectiveWindowPath !== '' && change.path === effectiveWindowPath;
    const wantRows = requestedLayout !== 'summary'
      && !stats.binary
      && (!windowed || isWindowTarget);
    const built = wantRows
      ? await buildReviewFileRows(change, scan, root, { staged, maxRowsPerFile })
      : { rows: [], rowsTruncated: false };

    let image = null;
    const isImageFile = change.status !== 'deleted' && !!reviewImageMime(change.path);
    if (isImageFile && includeImages && requestedLayout !== 'summary' && (!windowed || isWindowTarget)) {
      // Base64 preview data is only read when the panel can actually show it:
      // never for the summary layout, and never for files windowed out.
      image = await readReviewImage(root, change.path);
    }

    return {
      path: change.path,
      status: gitReviewStatus(change.status),
      additions: stats.additions,
      deletions: stats.deletions,
      binary: stats.binary || isImageFile,
      image,
      diff: { rows: built.rows, truncated: built.rowsTruncated, omitted: windowed && !isWindowTarget }
    };
  }));

  return {
    source: 'git',
    scope: staged ? 'staged' : 'worktree',
    count: files.length,
    additions: totals.additions,
    deletions: totals.deletions,
    windowed,
    windowPath: effectiveWindowPath,
    files
  };
}

// Splits a combined `git diff` output into per-file patch sections. Paths are
// never parsed from the headers (quotepath makes them unreliable); sections
// are paired with `--numstat -z` entries by order, which both commands share.
function splitPatchSections(patchText) {
  const sections = [];
  let current = null;
  for (const line of String(patchText || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) sections.push(current.join('\n'));
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) sections.push(current.join('\n'));
  return sections;
}

async function diff(workspace, filePath, staged = false) {
  const root = await resolveRepository(workspace);
  const [relative] = normalizeRepoPaths(root, [filePath]);
  const status = await repositoryStatus(root);
  const change = status.changes.find(item => item.path === relative);
  if (!staged && change?.status === 'untracked') {
    const absolute = path.join(root, relative);
    const buffer = await fsp.readFile(absolute);
    const binary = buffer.subarray(0, 8_000).includes(0);
    const content = binary ? '' : buffer.toString('utf8');
    return {
      path: relative,
      staged: false,
      untracked: true,
      binary,
      diff: binary ? '未跟踪的二进制文件' : clip(content, MAX_DIFF_CHARS),
      truncated: content.length > MAX_DIFF_CHARS
    };
  }
  const args = ['-C', root, 'diff', '--no-ext-diff', '--no-color', '--unified=3'];
  if (staged) args.push('--cached');
  args.push('--', relative);
  const result = await runGit(args, { readOnly: true, maxBuffer: MAX_OUTPUT_BYTES });
  return {
    path: relative,
    staged: !!staged,
    untracked: false,
    binary: /Binary files|GIT binary patch/i.test(result.stdout),
    diff: clip(result.stdout, MAX_DIFF_CHARS),
    truncated: result.stdout.length > MAX_DIFF_CHARS
  };
}

async function cloneRepository(remoteUrl, destination) {
  const url = validateRemoteUrl(remoteUrl);
  const target = path.resolve(String(destination || '').trim());
  if (!String(destination || '').trim()) throw gitError('请选择克隆目标文件夹。', 'CLONE_DESTINATION_REQUIRED');
  const parent = path.dirname(target);
  await resolveDirectory(parent, '目标父目录');
  if (fs.existsSync(target)) {
    const stat = await fsp.stat(target);
    if (!stat.isDirectory()) throw gitError('克隆目标已存在且不是文件夹。', 'CLONE_DESTINATION_INVALID');
    const entries = await fsp.readdir(target);
    if (entries.length) throw gitError('克隆目标文件夹必须为空。', 'CLONE_DESTINATION_NOT_EMPTY');
  }
  await runGit(['clone', '--', url, target], { timeoutMs: NETWORK_TIMEOUT_MS, allowCredentialPrompt: true, cwd: parent });
  return { ok: true, path: target, status: await repositoryStatus(target) };
}

function remoteWebUrl(remoteUrl) {
  const raw = String(remoteUrl || '').trim();
  if (!raw) return '';
  let url = raw;
  const scp = raw.match(/^git@([^:]+):(.+)$/i);
  if (scp) url = `https://${scp[1]}/${scp[2]}`;
  else if (/^ssh:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      url = `https://${parsed.hostname}${parsed.pathname}`;
    } catch { return ''; }
  }
  if (!/^https?:\/\//i.test(url)) return '';
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.href.replace(/\.git\/?$/i, '').replace(/\/$/, '');
  } catch {
    return '';
  }
}

module.exports = {
  addRemote,
  cloneRepository,
  commit,
  createBranch,
  detectGit,
  diff,
  discardFiles,
  review,
  reviewDocument,
  fetchRemote,
  history,
  initRepository,
  parseNumstatZ,
  parsePorcelainBranchInfo,
  parsePorcelainStatus,
  parseNumstat,
  splitPatchSections,
  pull,
  push,
  remoteWebUrl,
  removeRemote,
  repositoryStatus,
  setIdentity,
  setRemoteUrl,
  stageFiles,
  switchBranch,
  unstageFiles,
  validateBranchName,
  validateRemoteName,
  validateRemoteUrl
};
