'use strict';

// Task-scoped git worktrees. Each delegated builder task can work in its own
// worktree under <repo>/.yanagent/worktrees/<taskId> on branch
// yan-task-<taskId>, so parallel builders never touch the same checkout and a
// task's output merges back as one reviewable unit. All git access is
// spawn-with-array-args; taskId is sanitized into the branch/path name and
// never passed through a shell.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 60_000;
const WORKTREE_DIR_PARTS = ['.yanagent', 'worktrees'];
const BRANCH_PREFIX = 'yan-task-';
const EXCLUDE_LINE = '.yanagent/';
const MAX_TASK_ID_CHARS = 40;
const mergeQueues = new Map();

class WorktreeError extends Error {
  constructor(message, { code = 'WORKTREE_FAILED' } = {}) {
    super(message);
    this.name = 'WorktreeError';
    this.code = code;
  }
}

function runGit(repositoryRoot, args, { timeoutMs = DEFAULT_TIMEOUT_MS, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: cwd || repositoryRoot,
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new WorktreeError(`git ${args[0] || ''} timed out after ${timeoutMs}ms.`, { code: 'WORKTREE_TIMEOUT' }));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new WorktreeError(`git could not be executed: ${error.message}`, { code: 'WORKTREE_GIT_MISSING' }));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new WorktreeError(`git ${args.join(' ')} failed (${code}): ${stderr.trim().split('\n')[0] || 'unknown error'}`, { code: 'WORKTREE_GIT_FAILED' }));
    });
  });
}

function sanitizeTaskId(taskId) {
  const raw = String(taskId || '').trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '');
  if (!cleaned) {
    throw new WorktreeError('taskId is required and must contain letters, digits, dots, dashes, or underscores.', { code: 'WORKTREE_BAD_TASK_ID' });
  }
  if (cleaned.length > MAX_TASK_ID_CHARS) {
    throw new WorktreeError(`taskId must be at most ${MAX_TASK_ID_CHARS} characters.`, { code: 'WORKTREE_BAD_TASK_ID' });
  }
  if (['head', 'index'].includes(cleaned) || raw.startsWith('.') || cleaned.startsWith('.')) {
    throw new WorktreeError(`taskId "${cleaned}" is reserved.`, { code: 'WORKTREE_BAD_TASK_ID' });
  }
  return cleaned;
}

function worktreeRoot(repositoryRoot) {
  return path.join(path.resolve(String(repositoryRoot || '')), ...WORKTREE_DIR_PARTS);
}

// `.yanagent` is hidden from Yan's own status views via internal pathspecs,
// but a nested checkout would still show up in the user's raw `git status`.
// A local .git/info/exclude line keeps it invisible everywhere without
// touching the user's committed .gitignore.
async function ensureLocalExclusion(repositoryRoot) {
  const infoDir = path.join(path.resolve(repositoryRoot), '.git', 'info');
  const excludePath = path.join(infoDir, 'exclude');
  let existing = '';
  try { existing = fs.readFileSync(excludePath, 'utf8'); } catch { /* missing file or dir */ }
  const lines = existing.split(/\r?\n/);
  if (lines.some(line => line.trim() === EXCLUDE_LINE)) return;
  fs.mkdirSync(infoDir, { recursive: true });
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(excludePath, `${existing}${prefix}# Yan Agent task worktrees\n${EXCLUDE_LINE}\n`);
}

async function assertInsideRepository(repositoryRoot) {
  try {
    const { stdout } = await runGit(repositoryRoot, ['rev-parse', '--is-inside-work-tree']);
    if (stdout.trim() !== 'true') throw new Error('not a work tree');
  } catch {
    throw new WorktreeError('The workspace is not a git work tree.', { code: 'WORKTREE_NOT_A_REPO' });
  }
}

async function currentBase(repositoryRoot) {
  const { stdout: branch } = await runGit(repositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const name = branch.trim();
  if (name && name !== 'HEAD') return name;
  const { stdout: sha } = await runGit(repositoryRoot, ['rev-parse', 'HEAD']);
  return sha.trim();
}

async function createTaskWorktree(repositoryRoot, { taskId, base } = {}) {
  const root = path.resolve(String(repositoryRoot || ''));
  await assertInsideRepository(root);
  const id = sanitizeTaskId(taskId);
  const wtPath = path.join(worktreeRoot(root), id);
  const branch = `${BRANCH_PREFIX}${id}`;
  if (fs.existsSync(wtPath)) {
    throw new WorktreeError(`Worktree for task "${id}" already exists.`, { code: 'WORKTREE_EXISTS' });
  }
  let branchExists = false;
  try {
    await runGit(root, ['rev-parse', '--verify', branch]);
    branchExists = true;
  } catch { /* branch absent */ }
  if (branchExists) {
    throw new WorktreeError(`Branch ${branch} already exists; pick another taskId or remove the old worktree.`, { code: 'WORKTREE_BRANCH_EXISTS' });
  }
  const baseRef = String(base || '').trim() || await currentBase(root);
  await ensureLocalExclusion(root);
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  await runGit(root, ['worktree', 'add', '-b', branch, wtPath, baseRef]);
  return { taskId: id, path: wtPath, branch, base: baseRef };
}

// Parses `git worktree list --porcelain` blocks.
function parseWorktreeList(stdout) {
  const entries = [];
  let current = null;
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: line.slice('worktree '.length).trim(), branch: '', head: '', detached: false, bare: false };
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim();
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    } else if (current && line === 'detached') {
      current.detached = true;
    } else if (current && line === 'bare') {
      current.bare = true;
    }
  }
  if (current) entries.push(current);
  return entries;
}

async function listTaskWorktrees(repositoryRoot) {
  const root = path.resolve(String(repositoryRoot || ''));
  await assertInsideRepository(root);
  const { stdout } = await runGit(root, ['worktree', 'list', '--porcelain']);
  // git prints forward slashes on Windows; normalize before prefix matching.
  const normalize = value => {
    const resolved = path.resolve(String(value));
    // Git expands Windows 8.3 paths (RUNNER~1) in its output.
    let canonical = resolved;
    try { canonical = fs.realpathSync.native(resolved); } catch { /* missing worktree */ }
    const normalized = canonical.replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const prefix = `${normalize(worktreeRoot(root))}/`;
  return parseWorktreeList(stdout)
    .filter(entry => !entry.bare && normalize(entry.path).startsWith(prefix))
    .map(entry => ({ ...entry, taskId: path.basename(entry.path) }));
}

async function findTaskWorktree(repositoryRoot, taskId) {
  const entries = await listTaskWorktrees(repositoryRoot);
  const id = sanitizeTaskId(taskId);
  const entry = entries.find(item => item.taskId === id || item.branch === `${BRANCH_PREFIX}${id}`);
  if (!entry) {
    throw new WorktreeError(`No worktree found for task "${id}".`, { code: 'WORKTREE_NOT_FOUND' });
  }
  return entry;
}

// Untracked + modified files inside the worktree, so callers can refuse to
// discard in-progress builder work.
async function taskWorktreeStatus(repositoryRoot, { taskId } = {}) {
  const entry = await findTaskWorktree(repositoryRoot, taskId);
  const { stdout } = await runGit(entry.path, ['status', '--porcelain'], { cwd: entry.path });
  const files = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return { taskId: entry.taskId, path: entry.path, branch: entry.branch, head: entry.head, dirty: files.length > 0, files };
}

// Uncommitted changes in the main checkout, ignoring our own .yanagent tree.
async function mainTreeDirtyFiles(repositoryRoot) {
  const root = path.resolve(String(repositoryRoot || ''));
  const { stdout } = await runGit(root, ['status', '--porcelain', '-z', '--', '.', ':(exclude).yanagent', ':(exclude).yanagent/**']);
  return stdout.split('\0').map(entry => entry.trim()).filter(Boolean);
}

function splitConflictFiles(stdout) {
  return String(stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

async function mergeTaskWorktree(repositoryRoot, { taskId, message, squash = false } = {}) {
  const root = fs.realpathSync(path.resolve(String(repositoryRoot || '')));
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  const previous = mergeQueues.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(() => mergeTaskWorktreeUnlocked(root, { taskId, message, squash }));
  mergeQueues.set(key, operation);
  try { return await operation; }
  finally { if (mergeQueues.get(key) === operation) mergeQueues.delete(key); }
}

async function mergeTaskWorktreeUnlocked(repositoryRoot, { taskId, message, squash = false } = {}) {
  const root = path.resolve(String(repositoryRoot || ''));
  const entry = await findTaskWorktree(root, taskId);
  const dirty = await mainTreeDirtyFiles(root);
  if (dirty.length) {
    return { merged: false, reason: 'main-tree-dirty', dirtyFiles: dirty, taskId: entry.taskId, branch: entry.branch };
  }
  const commitMessage = String(message || '').trim() || `Merge task worktree ${entry.taskId} (${entry.branch})`;
  const { stdout: startingHead } = await runGit(root, ['rev-parse', 'HEAD']);
  try {
    if (squash) {
      await runGit(root, ['merge', '--squash', entry.branch]);
      await runGit(root, ['commit', '-m', commitMessage]);
    } else {
      await runGit(root, ['merge', '--no-ff', '-m', commitMessage, entry.branch]);
    }
  } catch (error) {
    let conflicts = [];
    try {
      const { stdout } = await runGit(root, ['diff', '--name-only', '--diff-filter=U']);
      conflicts = splitConflictFiles(stdout);
    } catch { /* fall through to abort */ }
    let recoveryError = '';
    try {
      // Squash does not write MERGE_HEAD, so merge --abort cannot recover it.
      // --merge preserves unrelated unstaged edits or refuses safely; never
      // use reset --hard / clean on the user's working directory.
      await runGit(root, squash ? ['reset', '--merge', startingHead.trim()] : ['merge', '--abort']);
    } catch (recovery) { recoveryError = recovery.message; }
    return {
      merged: false,
      reason: conflicts.length ? 'conflicts' : 'merge-failed',
      conflicts,
      recoveryError,
      recovered: !recoveryError,
      taskId: entry.taskId,
      branch: entry.branch,
      detail: error.message
    };
  }
  const { stdout: commit } = await runGit(root, ['rev-parse', '--short', 'HEAD']);
  return { merged: true, taskId: entry.taskId, branch: entry.branch, commit: commit.trim(), squash: !!squash, message: commitMessage };
}

async function removeTaskWorktree(repositoryRoot, { taskId, force = false } = {}) {
  const root = path.resolve(String(repositoryRoot || ''));
  const entry = await findTaskWorktree(root, taskId);
  if (!force) {
    const { stdout } = await runGit(entry.path, ['status', '--porcelain'], { cwd: entry.path });
    const files = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (files.length) {
      return { removed: false, reason: 'dirty', files, taskId: entry.taskId, branch: entry.branch };
    }
  }
  await runGit(root, force ? ['worktree', 'remove', '--force', entry.path] : ['worktree', 'remove', entry.path]);
  let branchKept = false;
  try {
    await runGit(root, ['branch', '-d', entry.branch]);
  } catch {
    branchKept = true; // unmerged changes: keep the branch rather than lose work
  }
  return { removed: true, taskId: entry.taskId, branch: entry.branch, branchKept };
}

module.exports = {
  WorktreeError,
  sanitizeTaskId,
  worktreeRoot,
  createTaskWorktree,
  listTaskWorktrees,
  taskWorktreeStatus,
  mergeTaskWorktree,
  removeTaskWorktree,
  parseWorktreeList,
  splitConflictFiles
};
