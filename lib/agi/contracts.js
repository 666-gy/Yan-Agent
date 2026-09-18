'use strict';

// Shared primitives for the AGI capability modules under lib/agi.
// Keep this module dependency-free so every agi-* module can rely on it.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AGI_VERSION = 1;
const EVIDENCE_STATUSES = Object.freeze(['pass', 'fail', 'unobserved']);
const EXPERIENCE_STATES = Object.freeze(['candidate', 'validated', 'reusable', 'rejected']);

function clip(value, max) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, Math.max(0, Number(max) || 0));
}

function normalizeId(value, max = 80) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, Math.max(1, Number(max) || 80));
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value === undefined ? '' : value)).digest('hex');
}

function readJson(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    try {
      fs.renameSync(temporary, filePath);
    } catch {
      // Windows can refuse a rename over a file another handle keeps open; the
      // copy still lands the write instead of losing it.
      fs.copyFileSync(temporary, filePath);
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return value;
}

function appendTextAtomic(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, String(text || ''), 'utf8');
  return filePath;
}

const UNSAFE_PATTERNS = Object.freeze([
  /\brm\s+-rf\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/s\s+\/q\b/i,
  /remove-item[^\n]{0,80}-recurse[^\n]{0,40}-force/i,
  /(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*\S{8,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/
]);

function containsUnsafeText(value) {
  const text = String(value || '');
  return UNSAFE_PATTERNS.some(pattern => pattern.test(text));
}

module.exports = {
  AGI_VERSION,
  EVIDENCE_STATUSES,
  EXPERIENCE_STATES,
  clip,
  normalizeId,
  stableHash,
  readJson,
  writeJsonAtomic,
  appendTextAtomic,
  containsUnsafeText
};
