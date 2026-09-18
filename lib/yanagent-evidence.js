'use strict';

// Reusable acceptance evidence (screenshots, captured frames, comparison
// images) is worth keeping across runs, unlike one-off probes, logs and
// backups. It lives under <workspace>/.yanagent/evidence (self-ignoring for
// git) and is bounded by a TTL so a long-lived workspace cannot grow without
// limit.
const fs = require('node:fs');
const path = require('node:path');

const EVIDENCE_DIR = 'evidence';
const EVIDENCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function pruneYanagentEvidence(root, { now = Date.now(), ttlMs = EVIDENCE_TTL_MS } = {}) {
  if (!root) return { removed: 0 };
  const dir = path.join(root, EVIDENCE_DIR);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { removed: 0 };
  }
  const cutoff = Number(now) - Number(ttlMs);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(dir, entry.name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) {
        fs.rmSync(file, { force: true });
        removed += 1;
      }
    } catch {
      // Evidence pruning must never block workspace setup.
    }
  }
  return { removed };
}

module.exports = { EVIDENCE_DIR, EVIDENCE_TTL_MS, pruneYanagentEvidence };
