'use strict';

// .yanagent — workspace-local memory, logs and session snapshots (plan T3.3).
// Moved verbatim from main.js; the resource lock manager and the .yanagent
// directory name arrive through explicit dependencies.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { pruneYanagentEvidence } = require('../yanagent-evidence');
const { mergeChangeHistory } = require('../run-change-summary');
const { isSafeSessionId } = require('../session-store');
const workspaceSandbox = require('../workspace-sandbox');

function registerYanagentStore(deps) {
  const { resourceLocks, yanagentDir } = deps;
  const fence = deps.sessionsDir ? require('../deletion-fence').createDeletionFence(deps.sessionsDir) : null;

  function yanagentRoot(workspace) {
    if (!workspace) return null;
    return path.join(workspace, yanagentDir);
  }

  function ensureYanagent(workspace) {
    const root = yanagentRoot(workspace);
    if (!root) return null;
    for (const sub of ['logs', 'snapshots', 'scratch', 'evidence']) {
      const d = path.join(root, sub);
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }
    // Reusable acceptance evidence is allowed to outlive the run that produced
    // it; the TTL keeps a long-lived workspace bounded without deleting it.
    pruneYanagentEvidence(root);
    const readme = path.join(root, 'README.txt');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme,
        'Yan Agent 数据目录（记忆、日志、会话快照、工具产物与验收证据）。\n' +
        '内部含 .gitignore，不会出现在你的 Git 变更里。\n' +
        '可随时删除，不影响项目代码；删除后记忆、日志、会话快照与验收证据会丢失。\n',
        'utf8');
    }
    // Yan runtime files must never surface in the user's git status. The project
    // .gitignore stays untouched; this file only hides this folder.
    const ignore = path.join(root, '.gitignore');
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n', 'utf8');
    return root;
  }

  function migrateMemoryToWorkspace(workspace) {
    if (!workspace) return;
    ensureYanagent(workspace);
  }

  function runSnapshotPath(workspace, sessionId, runId) {
    if (!isSafeSessionId(sessionId) || !isSafePathSegment(runId) || fence?.has(sessionId)) return null;
    ensureYanagent(workspace);
    const dir = path.join(yanagentRoot(workspace), 'snapshots', sessionId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${runId}.json`);
  }

  function isSafePathSegment(value) {
    return /^[A-Za-z0-9_-]{1,200}$/.test(String(value || '').trim());
  }

  async function writeRunRollbackSnapshot({ workspace, sessionId, runId, rollbackChanges }) {
    try {
      if (!workspace || !sessionId || !runId) return;
      const changes = (Array.isArray(rollbackChanges) ? rollbackChanges : [])
        .filter(change => change?.path && Object.prototype.hasOwnProperty.call(change, 'before'));
      if (!changes.length) return;
      await resourceLocks.withLock(`workspace:${path.resolve(workspace)}`, 'write', { owner: runId }, async () => {
        const snapPath = runSnapshotPath(workspace, sessionId, runId);
        if (!snapPath) return;
        // Fence check and commit share one synchronous turn; a delayed lock
        // callback cannot recreate rollback data after permanent deletion.
        fs.writeFileSync(snapPath, JSON.stringify({ sessionId, runId, ts: Date.now(), changes }), 'utf8');
      });
    } catch (error) {
      console.warn('[opencode] Rollback snapshot write failed:', error?.message || error);
    }
  }

  async function loadSessionChangeHistory(workspace, sessionId) {
    if (!isSafeSessionId(sessionId)) return [];
    const dir = path.join(yanagentRoot(workspace), 'snapshots', sessionId);
    if (!fs.existsSync(dir)) return [];
    const names = (await fsp.readdir(dir)).filter(name => name.toLowerCase().endsWith('.json'));
    const snapshots = [];
    for (const name of names) {
      const filePath = path.join(dir, name);
      try {
        const [data, stat] = await Promise.all([
          fsp.readFile(filePath, 'utf8').then(JSON.parse),
          fsp.stat(filePath)
        ]);
        snapshots.push({ ...data, ts: Number(stat.birthtimeMs) || Number(stat.mtimeMs) || 0 });
      } catch { /* ignore incomplete or obsolete snapshots */ }
    }
    return mergeChangeHistory(snapshots);
  }

  function isPathInside(rootPath, targetPath) {
    const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }

  async function resolveRollbackTarget(workspace, rawPath) {
    const checked = workspaceSandbox.resolveInsideWorkspace(workspace, rawPath);
    if (!checked.ok) return checked;
    const realWorkspace = await fsp.realpath(checked.workspace).catch(() => path.resolve(checked.workspace));
    // Resolve existing files and their parent directories through symlinks /
    // junctions. Lexical path.relative checks alone cannot stop a snapshot from
    // writing through a link that points outside the session workspace.
    const realTarget = await fsp.realpath(checked.path).catch(async () => {
      const parent = await fsp.realpath(path.dirname(checked.path)).catch(() => path.dirname(checked.path));
      return path.join(parent, path.basename(checked.path));
    });
    if (!isPathInside(realWorkspace, realTarget)) {
      return { ok: false, error: '回滚路径通过符号链接越界', code: 'PATH_SYMLINK_ESCAPE' };
    }
    return checked;
  }

  async function applySnapshotRollback(changes, workspace) {
    return resourceLocks.withLock(`workspace:${path.resolve(workspace || '')}`, 'write', { owner: 'rollback' }, async () => {
      const results = [];
      for (const ch of [...(changes || [])].reverse()) {
        const checked = await resolveRollbackTarget(workspace, ch?.path);
        if (!checked.ok) {
          results.push({ path: ch?.path, ok: false, error: checked.error });
          continue;
        }
        const targetPath = checked.path;
        if (ch.before === null || ch.before === undefined) {
          try {
            if (fs.existsSync(targetPath)) await fsp.unlink(targetPath);
            results.push({ path: targetPath, ok: true, action: 'deleted' });
          } catch (e) {
            results.push({ path: targetPath, ok: false, error: e.message });
          }
        } else {
          try {
            await fsp.mkdir(path.dirname(targetPath), { recursive: true });
            await fsp.writeFile(targetPath, ch.before, 'utf8');
            results.push({ path: targetPath, ok: true, action: 'restored' });
          } catch (e) {
            results.push({ path: targetPath, ok: false, error: e.message });
          }
        }
      }
      return results;
    });
  }

  function appendYanagentLog(workspace, line) {
    const root = ensureYanagent(workspace);
    if (!root) return;
    const logFile = path.join(root, 'logs', new Date().toISOString().slice(0, 10) + '.log');
    const ts = new Date().toISOString();
    try {
      fs.appendFileSync(logFile, `[${ts}] ${line}\n`, 'utf8');
    } catch (e) { console.error('appendYanagentLog:', e.message); }
  }

  return {
    yanagentRoot,
    ensureYanagent,
    migrateMemoryToWorkspace,
    runSnapshotPath,
    isSafePathSegment,
    writeRunRollbackSnapshot,
    loadSessionChangeHistory,
    applySnapshotRollback,
    appendYanagentLog
  };
}

module.exports = { registerYanagentStore };
