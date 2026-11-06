'use strict';

// Pathless browser/clipboard Files arrive in bounded binary chunks, never one
// base64 string. Drafts are private to the originating webContents and expire.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { checkAttachmentSize, MAX_TURN_ATTACHMENT_BYTES } = require('../attachment-policy');

function createAttachmentDrafts({ filesDir, upload, timeoutMs = 60000 }) {
  const drafts = new Map();
  let reserved = 0;
  const lookup = (owner, id) => {
    const draft = drafts.get(id);
    if (!draft || draft.owner !== owner) throw new Error('附件上传已失效');
    return draft;
  };
  async function remove(id) {
    const draft = drafts.get(id);
    if (!draft) return;
    drafts.delete(id); reserved -= draft.size; clearTimeout(draft.timer);
    await draft.operation?.catch(() => {});
    await fs.unlink(draft.path).catch(() => {});
  }
  function refresh(id, draft) {
    clearTimeout(draft.timer);
    draft.timer = setTimeout(() => { void remove(id); }, timeoutMs);
    draft.timer.unref?.();
  }
  return {
    async begin(owner, payload) {
      checkAttachmentSize(payload.size);
      if (reserved + payload.size > MAX_TURN_ATTACHMENT_BYTES) throw new Error('正在上传的附件总量不能超过 640 MiB');
      if ([...drafts.values()].filter(draft => draft.owner === owner).length >= 2) throw new Error('请等待当前附件保存完成');
      const id = crypto.randomUUID();
      const draft = { owner, name: payload.name, mimeType: payload.mimeType, size: payload.size,
        path: path.join(filesDir, '.pending-' + id), received: 0, operation: null, finishing: false };
      drafts.set(id, draft); reserved += payload.size;
      try {
        draft.operation = (async () => {
          await fs.mkdir(filesDir, { recursive: true });
          await fs.writeFile(draft.path, '', { flag: 'wx' });
        })();
        await draft.operation;
        draft.operation = null;
        if (!drafts.has(id)) throw new Error('附件上传已取消');
        refresh(id, draft);
        return { id };
      } catch (error) { await remove(id); throw error; }
    },
    async append(owner, id, bytes) {
      const draft = lookup(owner, id);
      if (draft.finishing || draft.operation) throw new Error('附件分块尚未保存');
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > 1024 * 1024 || draft.received + bytes.byteLength > draft.size) throw new Error('附件分块大小无效');
      clearTimeout(draft.timer);
      draft.operation = fs.appendFile(draft.path, bytes);
      try { await draft.operation; draft.received += bytes.byteLength; }
      catch (error) { draft.operation = null; await remove(id); throw error; }
      draft.operation = null;
      if (drafts.has(id)) refresh(id, draft);
      return { received: draft.received };
    },
    async finish(owner, id) {
      const draft = lookup(owner, id);
      if (draft.finishing || draft.operation || draft.received !== draft.size) throw new Error('附件上传尚未完成');
      draft.finishing = true; clearTimeout(draft.timer);
      draft.operation = upload({ name: draft.name, mimeType: draft.mimeType, sourcePath: draft.path });
      try { return await draft.operation; }
      finally { draft.operation = null; await remove(id); }
    },
    async cancel(owner, id) { lookup(owner, id); await remove(id); },
    async cancelOwner(owner) { await Promise.all([...drafts].filter(([, draft]) => draft.owner === owner).map(([id]) => remove(id))); },
  };
}

module.exports = { createAttachmentDrafts };
