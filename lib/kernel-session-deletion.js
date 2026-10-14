'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { writeAtomic } = require('./yan-core/store');
const { deleteKernelSessionsNow } = require('./kernel-storage');

async function deleteKernelConversation({ dataDir, yanSessionId, sessionIds, directory, sidecar, lease = fn => fn(), deleteNow = deleteKernelSessionsNow }) {
  const runtimeRoot = path.join(dataDir, 'opencode-runtime');
  const key = crypto.createHash('sha256').update(yanSessionId).digest('hex');
  const pending = path.join(runtimeRoot, 'deleting', key + '.json');
  const saved = fs.existsSync(pending) ? JSON.parse(fs.readFileSync(pending, 'utf8')).ids : [];
  const ids = new Set([...saved, ...sessionIds]);
  const remember = discovered => {
    discovered.forEach(id => ids.add(id));
    // IDs only, never conversation contents. Persist before removing parents.
    writeAtomic(pending, { ids: [...ids] });
  };
  remember([]);
  let online = null;
  if (sidecar) online = await lease(() => sidecar.deleteKernelSessionTrees([...ids], directory, { onDiscovered: remember }));
  if (sidecar && (!online || (!online.notRunning && (!Array.isArray(online.failed) || !Number.isFinite(online.deleted))))) {
    return { ok: false, error: '内核删除结果异常，无法确认清理完成' };
  }
  if (online && !online.notRunning && online.failed?.length) return { ok: false, failed: online.failed, error: '部分内核会话未能删除' };
  const result = await deleteNow({ runtimeRoot, dataDir, sessionIds: [...ids], purgeOnly: !!online && !online.notRunning });
  if (!result.ok) return result;
  fs.rmSync(pending, { force: true });
  return { ok: true, deleted: (Number(online?.deleted) || 0) + (Number(result.deleted) || 0), failed: 0 };
}
module.exports = { deleteKernelConversation };
