'use strict';
const path = require('path');
function normalizeWorktreePreferences(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  const limit = Number(value.limit);
  return { root: typeof value.root === 'string' ? value.root.trim() : '', fetchBeforeCreate: value.fetchBeforeCreate === true,
    autoCleanup: value.autoCleanup !== false, limit: Number.isInteger(limit) && limit >= 1 && limit <= 1000 ? limit : 15 };
}
function validateWorktreePreferences(value) {
  if (value.root && (!path.isAbsolute(value.root) || /[\x00-\x1f]/.test(value.root))) throw new Error('工作树根目录必须是有效的绝对路径，或留空使用默认位置。');
  if (value.limit != null && (!Number.isInteger(Number(value.limit)) || Number(value.limit) < 1 || Number(value.limit) > 1000)) throw new Error('保留数量请输入 1 至 1000 的整数。');
}
module.exports = { normalizeWorktreePreferences, validateWorktreePreferences };
