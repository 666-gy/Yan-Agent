'use strict';

// The pinned V2 kernel rejects one instruction entry whose JSON value exceeds
// 256 KiB (`InstructionEntryValueTooLargeError`). Yan writes the whole durable
// policy as a single entry, so one oversized user setting used to make every
// new session fail before the first prompt. Split oversized values across
// ordered keys instead; the kernel renders them as consecutive context blocks.
const MAX_INSTRUCTION_ENTRY_BYTES = 256 * 1024;
// Leave headroom below the hard limit so JSON escaping of a chunk can never
// push it over between measurement and the request.
const INSTRUCTION_CHUNK_BYTES = 240 * 1024;

function instructionEntryBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function chunkInstructionValue(value, maxBytes = INSTRUCTION_CHUNK_BYTES) {
  const text = String(value ?? '');
  if (instructionEntryBytes(text) <= maxBytes) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let low = start + 1;
    let high = text.length;
    let end = start;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (instructionEntryBytes(text.slice(start, middle)) <= maxBytes) {
        end = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    if (end <= start) end = start + 1;
    // Prefer a newline boundary, but never shrink a chunk below half its
    // budget just to reach one. Minified single-line values keep the raw cut.
    const newline = text.lastIndexOf('\n', end - 1);
    if (newline >= start && newline + 1 > start + (end - start) / 2) end = newline + 1;
    // Never cut a surrogate pair in half.
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff && end < text.length) end -= 1;
    if (end <= start) end = start + 2;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function instructionChunkKeys(key, count) {
  const keys = [];
  for (let index = 0; index < count; index++) {
    keys.push(index === 0 ? key : `${key}.${String(index).padStart(3, '0')}`);
  }
  return keys;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Writes one logical instruction entry. Values that fit keep the original key
// exactly as before; larger values use `<key>.001`, `<key>.002`, ... and drop
// numbered chunks left over from a previous, larger value.
async function writeInstructionEntry(client, sessionID, key, value) {
  const entry = client?.session?.instructions?.entry;
  if (!entry?.put) return;
  const chunks = chunkInstructionValue(value);
  const keys = instructionChunkKeys(key, chunks.length);
  const sizes = chunks.map(instructionEntryBytes);
  for (let index = 0; index < chunks.length; index++) {
    try {
      await entry.put({ sessionID, key: keys[index], value: chunks[index] });
    } catch (error) {
      const detail = `${keys[index]} is ${sizes[index]} bytes (chunk ${index + 1}/${chunks.length}; chunk sizes: ${sizes.join(', ')})`;
      const reason = error?.message || error?.data?.message || String(error);
      const wrapped = new Error(`Failed to write instruction entry ${detail}: ${reason}`);
      wrapped.cause = error;
      throw wrapped;
    }
  }
  if (!entry.list || !entry.remove) return;
  let active;
  try { active = await entry.list({ sessionID }); } catch { return; }
  const current = new Set(keys);
  const suffix = new RegExp(`^${escapeRegExp(key)}\\.\\d{3}$`);
  for (const item of (Array.isArray(active) ? active : active?.data) || []) {
    if (!suffix.test(item.key) || current.has(item.key)) continue;
    try { await entry.remove({ sessionID, key: item.key }); } catch { /* best effort */ }
  }
}

module.exports = {
  MAX_INSTRUCTION_ENTRY_BYTES,
  INSTRUCTION_CHUNK_BYTES,
  instructionEntryBytes,
  chunkInstructionValue,
  instructionChunkKeys,
  writeInstructionEntry
};
