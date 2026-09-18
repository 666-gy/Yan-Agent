'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const entries = new Map();
const MAX_BYTES = 32 * 1024 * 1024;
let bytes = 0;

function trimCache() {
  while (bytes > MAX_BYTES && entries.size) {
    const oldest = entries.keys().next().value;
    bytes -= entries.get(oldest).bytes;
    entries.delete(oldest);
  }
}

function cacheParsed(entry, kind, value) {
  if (entry.parsed.has(kind)) return entry.parsed.get(kind);
  entry.parsed.set(kind, value);
  // Account for parsed outlines too; this is an estimate, not a heap limit.
  const added = Buffer.byteLength(JSON.stringify(value)) * 2;
  entry.bytes += added;
  if (entries.get(entry.key) === entry) { bytes += added; trimCache(); }
  return value;
}

function stamp(file) {
  const stat = fs.statSync(file, { bigint: true });
  return `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.ino}`;
}

// Revalidate on every query, including branch switches and same-size edits.
// Reuse parsed results only for an unchanged file; cap process-wide memory.
function readSourceEntry(file) {
  const key = path.resolve(file);
  const revision = stamp(key);
  const cached = entries.get(key);
  if (cached?.revision === revision) {
    entries.delete(key);
    entries.set(key, cached);
    return cached;
  }
  if (cached) { bytes -= cached.bytes; entries.delete(key); }
  const source = fs.readFileSync(key, 'utf8');
  const entry = { key, revision, source, parsed: new Map(), bytes: Buffer.byteLength(source) * 2 };
  entries.set(key, entry);
  bytes += entry.bytes;
  trimCache();
  return entry;
}

function sourceRevision(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file).update('\0');
    try { hash.update(stamp(file)); } catch { hash.update('missing'); }
    hash.update('\0');
  }
  return hash.digest('hex');
}

module.exports = { readSourceEntry, sourceRevision, cacheParsed };
