'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const low = require('./worktree-service');
const { normalizeWorktreePreferences } = require('./worktree-preferences');
const { normalizeGitPreferences } = require('./git-preferences');
const canonical = directory => {
  let result = path.resolve(directory);
  try { result = fs.realpathSync.native(result); } catch {}
  return process.platform === 'win32' ? result.toLowerCase() : result;
};
const overlaps = (a, b) => {
  a = canonical(a); b = canonical(b);
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
};

function createManagedWorktrees({ dataDir, loadConfig, isProtected = () => false, homeDir = os.homedir() }) {
  const registryPath = path.join(dataDir, 'managed-worktrees.json');
  const lockPath = registryPath + '.lock';
  const defaults = path.join(homeDir, '.yanagent', 'worktrees');
  const read = () => {
    try { const records = JSON.parse(fs.readFileSync(registryPath, 'utf8')); if (!Array.isArray(records)) throw new Error('工作树记录格式无效'); return records; }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const write = records => {
    const temp = registryPath + '.' + process.pid + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(records, null, 2)); fs.renameSync(temp, registryPath);
  };
  async function locked(action) {
    fs.mkdirSync(dataDir, { recursive: true });
    const deadline = Date.now() + 30000;
    for (;;) {
      try { fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' }); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner = 0;
        try { owner = Number(fs.readFileSync(lockPath, 'utf8')); } catch {}
        if (owner > 0) {
          try { process.kill(owner, 0); } catch (e) { if (e.code === 'ESRCH') { try { fs.unlinkSync(lockPath); } catch {} continue; } }
        }
        if (Date.now() > deadline) throw new Error('工作树正在执行其他操作，请稍后重试。');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    try { return await action(); } finally { fs.unlinkSync(lockPath); }
  }
  const settings = () => normalizeWorktreePreferences(loadConfig().worktrees);
  function protection(record) {
    if (isProtected(record)) return '正在使用';
    const cfg = loadConfig();
    if (cfg.workspace && overlaps(cfg.workspace, record.path)) return '当前工作区';
    // Persisted pinned chats and active run contexts protect checkouts even
    // when the operation is performed in the Agent's separate MCP process.
    for (const [folder, active] of [['sessions', false], [path.join('harness', 'runtime'), true]]) {
      const dir = path.join(dataDir, folder);
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir).filter(file => file.endsWith('.json'))) {
        try {
          const item = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
          if (item.workspace && (active || item.pinned) && (overlaps(item.workspace, record.path) || (active && overlaps(item.workspace, record.repository)))) return active ? '正在运行任务' : '置顶聊天正在使用';
        } catch { return '无法确认任务状态'; }
      }
    }
    return '';
  }
  async function inspect(record) {
    if (record.archived) return { ...record, reason: '' };
    try {
      const entries = await low.listTaskWorktrees(record.repository);
      const entry = entries.find(item => canonical(item.path) === canonical(record.path));
      if (!entry || !fs.existsSync(record.path)) return { ...record, reason: '工作树目录不可用', missing: true };
      let reason = protection(record) || (entry.locked ? '已锁定' : '');
      const { stdout: ignored } = await low.runGit(record.path, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory']);
      const { stdout: submodules } = await low.runGit(record.path, ['ls-files', '--stage']);
      if (!reason && ignored.trim()) reason = '含被 Git 忽略的文件，保留以防丢失';
      if (!reason && /^160000 /m.test(submodules)) reason = '含子模块，需手动管理';
      const { stdout: gitDirectory } = await low.runGit(record.path, ['rev-parse', '--absolute-git-dir']);
      if (!reason && ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'index.lock'].some(name => fs.existsSync(path.join(gitDirectory.trim(), name)))) reason = 'Git 操作尚未完成';
      const { stdout: dirty } = await low.runGit(record.path, ['status', '--porcelain']);
      return { ...record, branch: entry.branch, head: entry.head, reason, dirty: !!dirty.trim() };
    } catch (error) { return { ...record, reason: error.message }; }
  }
  async function snapshot(record) {
    const index = path.join(dataDir, `worktree-index-${crypto.randomUUID()}`);
    const env = { GIT_INDEX_FILE: index, GIT_AUTHOR_NAME: 'Yan Agent', GIT_AUTHOR_EMAIL: 'snapshot@yan.local', GIT_COMMITTER_NAME: 'Yan Agent', GIT_COMMITTER_EMAIL: 'snapshot@yan.local' };
    try {
      await low.runGit(record.path, ['read-tree', 'HEAD'], { env });
      await low.runGit(record.path, ['add', '-A', '--', '.'], { env });
      const { stdout: tree } = await low.runGit(record.path, ['write-tree'], { env });
      const contents = await low.runGit(record.path, ['ls-tree', '-r', tree.trim()]);
      if (/^160000 /m.test(contents.stdout)) throw new Error('含嵌套 Git 仓库，无法完整快照，未清理');
      const { stdout: head } = await low.runGit(record.path, ['rev-parse', 'HEAD']);
      const { stdout: commit } = await low.runGit(record.path, ['commit-tree', tree.trim(), '-p', head.trim(), '-m', 'Yan Agent worktree recovery snapshot'], { env });
      const ref = `refs/yan/worktree-snapshots/${record.id}`;
      await low.runGit(record.repository, ['update-ref', ref, commit.trim()]);
      return { snapshot: commit.trim(), snapshotRef: ref, originalHead: head.trim() };
    } finally { fs.rmSync(index, { force: true }); }
  }
  async function archiveRecord(records, record, automatic = false) {
    const current = await inspect(record);
    if (record.archived) return record;
    if (current.reason) throw new Error(current.reason);
    // Automatic pruning leaves unfinished edits alone. Explicit archival
    // preserves tracked and non-ignored untracked content in a Git snapshot.
    if (automatic && current.dirty) throw new Error('有未提交改动，暂不自动清理');
    const saved = await snapshot(record);
    Object.assign(record, saved); write(records); // durable recovery before removal
    // Reinspect after snapshot: fail closed if protection/ignored files changed.
    const check = await inspect(record);
    if (check.reason || (automatic && check.dirty)) throw new Error(check.reason || '文件已变化，取消清理');
    const verify = await snapshot(record);
    const a = (await low.runGit(record.repository, ['rev-parse', saved.snapshot + '^{tree}'])).stdout.trim();
    const b = (await low.runGit(record.repository, ['rev-parse', verify.snapshot + '^{tree}'])).stdout.trim();
    if (a !== b) throw new Error('文件正在变化，取消清理');
    Object.assign(record, verify); write(records);
    await low.runGit(record.repository, ['worktree', 'remove', ...(current.dirty ? ['--force'] : []), record.path]);
    record.archived = true; record.archivedAt = Date.now(); write(records);
    return record;
  }
  async function cleanupUnlocked(records, keepId = '') {
    const prefs = settings(), skipped = [];
    if (!prefs.autoCleanup) return { skipped };
    let count = records.filter(item => !item.archived).length;
    for (const record of records.filter(item => !item.archived && item.id !== keepId).sort((a, b) => a.createdAt - b.createdAt)) {
      if (count <= prefs.limit) break;
      // Newly created checkouts may be about to receive an Agent task.
      if (Date.now() - record.createdAt < 3600000) { skipped.push({ id: record.id, reason: '最近创建，暂不清理' }); continue; }
      try { await archiveRecord(records, record, true); count--; }
      catch (error) { skipped.push({ id: record.id, reason: error.message }); }
    }
    return { skipped };
  }
  async function adopt(records, workspace) {
    if (!workspace) return;
    const entries = await low.listTaskWorktrees(workspace);
    const repository = fs.realpathSync(workspace);
    for (const entry of entries) {
      if (records.some(item => canonical(item.path) === canonical(entry.path))) continue;
      records.push({ id: crypto.randomUUID(), repository, path: entry.path, branch: entry.branch, taskId: entry.taskId, createdAt: Date.now(), archived: false });
    }
    write(records);
  }
  return {
    defaultRoot: defaults,
    async list(workspace = '') {
      return locked(async () => {
        const records = read();
        if (workspace) { try { await adopt(records, workspace); } catch (error) { if (error.code !== 'WORKTREE_NOT_A_REPO') throw error; } }
        const items = [];
        for (const record of records) items.push(await inspect(record));
        return { worktrees: items, defaultRoot: defaults, settings: settings() };
      });
    },
    async createTaskWorktree(repository, options = {}) {
      return locked(async () => {
        const records = read(), prefs = settings();
        repository = fs.realpathSync(repository);
        await adopt(records, repository);
        const hash = crypto.createHash('sha256').update(canonical(repository)).digest('hex').slice(0, 12);
        const destinationRoot = path.join(prefs.root || defaults, hash);
        const taskId = low.sanitizeTaskId(options.taskId);
        if (records.some(item => canonical(item.repository) === canonical(repository) && item.taskId === taskId)) throw new Error('该工作树名称已有托管记录，请恢复原工作树或使用新名称。');
        const entry = await low.createTaskWorktree(repository, { ...options, branchPrefix: normalizeGitPreferences(loadConfig().git).branchPrefix, destinationRoot, fetchBeforeCreate: prefs.fetchBeforeCreate });
        const record = { ...entry, repository, id: crypto.randomUUID(), createdAt: Date.now(), archived: false };
        records.push(record); write(records);
        const cleanup = await cleanupUnlocked(records, record.id);
        return { ...entry, cleanup };
      });
    },
    cleanup() { return locked(() => cleanupUnlocked(read())); },
    archive(id) { return locked(async () => { const records = read(), record = records.find(item => item.id === id); if (!record) throw new Error('工作树不存在'); return archiveRecord(records, record); }); },
    restore(id) {
      return locked(async () => {
        const records = read(), record = records.find(item => item.id === id);
        if (!record?.archived || !record.snapshot) throw new Error('没有可恢复的工作树快照');
        if (fs.existsSync(record.path)) throw new Error('原工作树路径已被占用，未覆盖文件');
        await low.runGit(record.repository, ['cat-file', '-e', record.snapshot + '^{commit}']);
        await low.runGit(record.repository, ['worktree', 'add', '--detach', record.path, record.snapshot]);
        await low.rememberWorktree(record.repository, record.path);
        record.archived = false; record.createdAt = Date.now(); record.branch = ''; write(records);
        return record;
      });
    },
    async removeTaskWorktree(repository, { taskId, force = false } = {}) {
      return locked(async () => {
        const records = read();
        await adopt(records, repository);
        const record = records.find(item => canonical(item.repository) === canonical(repository) && item.taskId === low.sanitizeTaskId(taskId) && !item.archived);
        if (!record) throw new Error('工作树不存在');
        const current = await inspect(record);
        if (current.dirty && !force) return { removed: false, reason: 'dirty', taskId };
        await archiveRecord(records, record);
        return { removed: true, archived: true, taskId, branchKept: true };
      });
    },
    listTaskWorktrees: low.listTaskWorktrees,
    taskWorktreeStatus: low.taskWorktreeStatus,
    mergeTaskWorktree: low.mergeTaskWorktree
  };
}
module.exports = { createManagedWorktrees };
