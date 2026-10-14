'use strict';

// Skill id normalization, shared by the registry and the logo resolver.
//
// Kept in its own module so `skill-registry.js` (which is at its architecture
// budget) and `skill-logo.js` can both use it without a require cycle: the
// registry re-exports the same function, so existing callers are unchanged.

function normalizeId(id) {
  return String(id || '').trim().toLowerCase();
}

module.exports = { normalizeId };
