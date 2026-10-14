'use strict';

function normalizeQuickLaunchConfig(value = {}, defaultShortcut) {
  const shortcut = String(value?.shortcut || '').trim() || defaultShortcut;
  return {
    enabled: value?.enabled !== false,
    shortcut: shortcut.slice(0, 120)
  };
}

function deepMerge(target, source) {
  if (typeof source !== 'object' || source === null) return source;
  if (typeof target !== 'object' || target === null) return source;
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const key of Object.keys(source)) {
    if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
      out[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

module.exports = { normalizeQuickLaunchConfig, deepMerge };
