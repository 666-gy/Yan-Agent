'use strict';

// Tool-name aliasing shared by wire adapters whose endpoints constrain
// function names (OpenAI family convention ^[a-zA-Z0-9_-]{1,64}$). Aliases
// are deterministic and injective: already-legal names claim their wire slot
// in a first pass, then names that need aliasing are assigned disambiguated
// wire names, so two distinct originals can never collapse into one wire
// name. The restore map is built from the same assignment.

const MAX_TOOL_NAME_LENGTH = 64;

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function sanitizeToolName(name, maxChars = MAX_TOOL_NAME_LENGTH) {
  const raw = String(name || '');
  if (!raw) return '';
  const limit = Math.max(8, Number(maxChars) || MAX_TOOL_NAME_LENGTH);
  if (new RegExp(`^[a-zA-Z0-9_-]{1,${limit}}$`).test(raw)) return raw;
  let cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^[._-]+/, '');
  if (!cleaned) cleaned = 'tool';
  if (cleaned.length > limit) {
    const suffix = fnv1a(raw);
    cleaned = `${cleaned.slice(0, Math.max(1, limit - suffix.length - 1))}_${suffix}`;
  }
  return cleaned;
}

function buildToolAliasMap(toolNames, maxChars = MAX_TOOL_NAME_LENGTH) {
  const limit = Math.max(8, Number(maxChars) || MAX_TOOL_NAME_LENGTH);
  const names = (Array.isArray(toolNames) ? toolNames : []).map(name => String(name || '').trim()).filter(Boolean);
  const used = new Set();
  const needsAlias = [];
  for (const name of names) {
    const clean = sanitizeToolName(name, limit);
    if (clean === name) used.add(clean);
    else needsAlias.push(name);
  }
  const aliases = new Map(); // original → wire name
  const restore = new Map(); // wire name → original
  for (const name of needsAlias) {
    let clean = sanitizeToolName(name, limit);
    if (used.has(clean)) {
      let nonce = 2;
      while (used.has(`${clean.slice(0, Math.max(1, limit - String(nonce).length - 1))}_${nonce}`)) nonce += 1;
      clean = `${clean.slice(0, Math.max(1, limit - String(nonce).length - 1))}_${nonce}`;
    }
    used.add(clean);
    aliases.set(name, clean);
    restore.set(clean, name);
  }
  return { aliases, restore };
}

module.exports = { MAX_TOOL_NAME_LENGTH, fnv1a, sanitizeToolName, buildToolAliasMap };
