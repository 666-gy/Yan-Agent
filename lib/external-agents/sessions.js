'use strict';

const fs = require('fs');
const path = require('path');
const { TERMINAL, read, jobDir, workspaceKey, hash } = require('./storage');
const { Journal, sameWorkspace } = require('./journal');

function handshake(id) {
  return `Yan desktop handshake ${id}. READ ONLY. Report your current working directory and repeat YAN_READY_${id}. Do not modify files, switch directories, create a worktree, or start any other task. Wait for the next message.`;
}

// The completed jobs ARE the durable workspace/provider binding. Derive it
// from verified receipts so pre-upgrade jobs also work, without another index
// that could get out of sync with a worker's atomic completion record.
function selectContinuation(request, records) {
  const eligible = records.filter(item => item.id !== request.id && item.provider === request.provider
    && workspaceKey(item.workspace) === workspaceKey(request.workspace)
    && item.transport === 'desktop-gui-v1' && TERMINAL.has(item.status)
    && item.deliveryVerified === true && item.externalSessionId && item.journalFile);
  eligible.sort((a, b) => (b.endedAt || b.createdAt) - (a.endedAt || a.createdAt));
  const source = eligible.find(item => item.id === request.previousJobId) || eligible[0];
  return source ? { sourceJobId: source.id, externalSessionId: source.externalSessionId, journalFile: source.journalFile } : null;
}

function validateContinuation(dir, request, binding) {
  const sourceDir = jobDir(path.dirname(dir), binding.sourceJobId);
  const source = { ...read(path.join(sourceDir, 'request.json')), ...read(path.join(sourceDir, 'state.json')) };
  if (source.id === request.id || source.provider !== request.provider || !sameWorkspace(source.workspace, request.workspace)
    || source.transport !== 'desktop-gui-v1' || !TERMINAL.has(source.status) || source.deliveryVerified !== true
    || source.externalSessionId !== binding.externalSessionId || source.journalFile !== binding.journalFile) {
    throw new Error('保存的外部会话关联无法核验；不会新建或向其他任务发送');
  }
  const assignment = fs.readFileSync(path.join(sourceDir, 'delivery.txt'), 'utf8');
  if (hash(assignment) !== source.deliveryHash) throw new Error('原任务发送记录校验失败；不会新建会话');
  const journal = new Journal(source.provider, source.workspace, handshake(source.id), assignment);
  journal.poll(binding.journalFile);
  if (!journal.desktop || journal.sessionId !== binding.externalSessionId || !journal.inputSeen || !TERMINAL.has(journal.status)) {
    throw new Error('原桌面会话已失效或无法确认；不会新建会话，请检查原任务');
  }
  return source;
}

function claudeSessionRoots(env = process.env) {
  const roots = [];
  if (env.CLAUDE_USER_DATA_DIR) roots.push(path.join(env.CLAUDE_USER_DATA_DIR, 'claude-code-sessions'));
  for (const base of [env.LOCALAPPDATA, env.APPDATA]) {
    if (!base) continue;
    for (const name of ['Claude', 'Claude-3p', 'Claude-Data', 'Claude-3p-Data']) roots.push(path.join(base, name, 'claude-code-sessions'));
  }
  return [...new Set(roots)];
}

// Read only Code session metadata, never account credentials or app databases.
// Claude uses local_<uuid> for its GUI route and a separate UUID in JSONL.
function claudeDesktopSession(externalSessionId, workspace, roots = claudeSessionRoots()) {
  const matches = [];
  function walk(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 3) walk(file, depth + 1);
      if (!entry.isFile() || !/^local_[A-Za-z0-9-]{1,64}\.json$/.test(entry.name)) continue;
      let value;
      try { value = read(file); } catch { continue; }
      if (value.cliSessionId !== externalSessionId) continue;
      if (entry.name !== `${value.sessionId}.json` || !sameWorkspace(value.cwd, workspace) || value.isArchived === true) {
        throw new Error('原 Claude 任务已归档或工作区发生变化；请恢复原任务，Yan 不会新建会话');
      }
      matches.push(value.sessionId);
    }
  }
  for (const root of roots) walk(root, 0);
  if (matches.length !== 1) throw new Error('无法唯一定位原 Claude 桌面任务；请检查原任务，Yan 不会新建会话');
  return matches[0];
}

function desktopSession(provider, externalSessionId, workspace, roots) {
  return provider === 'claude' ? claudeDesktopSession(externalSessionId, workspace, roots) : externalSessionId;
}

module.exports = { handshake, selectContinuation, validateContinuation, claudeSessionRoots, claudeDesktopSession, desktopSession };
