'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { acquireFiles } = require('./file-locks');

function git(directory, args, options = {}) {
  return execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], ...options
  });
}
function repository(directory) {
  try { return git(directory, ['rev-parse', '--show-toplevel']).trim(); }
  catch (error) {
    if (String(error.stderr).includes('not a git repository') || error.code === 'ENOENT') return null;
    throw error;
  }
}
// Snapshot tracked and non-ignored untracked content with a private index.
// The user's index, branch and commit history are never changed.
function snapshot(root) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') };
  try {
    git(root, ['read-tree', '--empty'], { env });
    git(root, ['add', '-A', '--', '.'], { env });
    return git(root, ['write-tree'], { env }).trim();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function save(record) {
  const temporary = record.file + '.' + randomUUID();
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2));
  fs.renameSync(temporary, record.file);
}
async function prepare(directory, childID, options = {}) {
  const root = repository(directory);
  if (!root) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(childID)) throw new Error('Invalid child identity');
  const common = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']).trim());
  const records = path.join(common, 'yan-builders');
  fs.mkdirSync(records, { recursive: true });
  const file = path.join(records, childID + '.json');
  const release = await acquireFiles([root], options);
  try {
    if (fs.existsSync(file)) {
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!['ready', 'integrated', 'conflict'].includes(record.status)) throw new Error(`Worktree integration uncertain; inspect ${file} before resuming`);
      if (!fs.existsSync(record.directory)) throw new Error(`Retained worktree missing: ${record.directory}`);
      return record;
    }
    const baseline = options.baseline || snapshot(root);
    const commit = options.commit || git(root, ['-c', 'user.name=Yan Builder', '-c', 'user.email=builder@localhost',
      'commit-tree', baseline, '-m', 'Yan isolated builder baseline']).trim();
    const worktree = path.join(records, childID);
    const record = { file, root, directory: worktree, childDirectory: path.join(worktree, path.relative(root, directory)),
      baseline, commit, childID, status: 'preparing', createdAt: Date.now() };
    save(record);
    git(root, ['worktree', 'add', '--detach', worktree, commit]);
    record.status = 'ready'; save(record);
    return record;
  } finally { release(); }
}
async function integrate(record, options = {}) {
  const release = await acquireFiles([record.root, record.directory], options);
  try {
    const tree = snapshot(record.directory);
    if (options.expectedTree && tree !== options.expectedTree) throw new Error('Child worktree changed after its result snapshot');
    const files = git(record.root, ['diff', '--name-only', '-z', '--no-renames', record.baseline, tree]).split('\0').filter(Boolean);
    const current = snapshot(record.root);
    const changed = new Set(git(record.root, ['diff', '--name-only', '-z', '--no-renames', record.baseline, current]).split('\0').filter(Boolean));
    const conflicts = files.filter(file => changed.has(file));
    if (conflicts.length) {
      record.status = 'conflict'; record.conflicts = conflicts; save(record);
      throw new Error(`Builder integration conflict: ${conflicts.join(', ')}. Changes retained at ${record.directory}`);
    }
    const patch = git(record.root, ['diff', '--binary', '--no-ext-diff', '--no-renames', record.baseline, tree], { encoding: 'buffer' });
    if (patch.length) {
      git(record.root, ['apply', '--check', '--binary', '-'], { input: patch });
      // Durable uncertainty marker BEFORE mutating parent. Crash recovery never
      // automatically retries a possibly partially applied integration.
      record.status = 'integrating'; record.resultTree = tree; save(record);
      git(record.root, ['apply', '--binary', '-'], { input: patch });
    }
    record.status = 'integrated'; record.baseline = tree; record.files = files;
    git(record.root, ['update-ref', `refs/yan/builders/${record.childID}`, tree]);
    record.integratedAt = Date.now(); save(record);
    return { directory: record.directory, status: record.status, files };
  } finally { release(); }
}
module.exports = { repository, snapshot, prepare, integrate };
