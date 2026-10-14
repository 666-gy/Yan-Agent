'use strict';
function normalizeMemorySettings(value = {}) {
  return { enabled: value?.enabled !== false, instructions: String(value?.instructions || '').slice(0, 24000) };
}
module.exports = { normalizeMemorySettings };
