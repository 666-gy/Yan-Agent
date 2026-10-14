'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { createHash } = require('node:crypto');
const assets = new Map();
const imageTypes = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' };

// Only register actual images referenced by a task, within its real workspace.
async function prepareWorkImages(value, workspace) {
  let root;
  try { root = await fs.realpath(workspace); } catch { return value; }
  async function rewrite(value) {
    if (Array.isArray(value)) return Promise.all(value.map(rewrite));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await rewrite(item)])));
    if (typeof value !== 'string') return value;
    const pattern = /```[\s\S]*?```|`[^`\n]*`|!\[([^\]\n]*)\]\s*\(<?(file:\/\/\/[^\r\n]*?)>?\)/gi;
    let result = '', offset = 0;
    for (const match of value.matchAll(pattern)) {
      if (!match[2]) continue;
      try {
        const filePath = await fs.realpath(fileURLToPath(match[2]));
        const relative = path.relative(root, filePath);
        const type = imageTypes[path.extname(filePath).toLowerCase()];
        if (!type || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) continue;
        const id = createHash('sha256').update(filePath).digest('hex');
        assets.set(id, { filePath, type });
        result += value.slice(offset, match.index) + `![${match[1]}](/media/work-image?id=${id})`;
        offset = match.index + match[0].length;
      } catch { /* Preserve unavailable references as text. */ }
    }
    return result + value.slice(offset);
  }
  return rewrite(value);
}
module.exports = { prepareWorkImages, assets };
