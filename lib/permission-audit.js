'use strict';

// ---------------------------------------------------------------------------
// Yan Agent — permission audit + shell grant scope
// ---------------------------------------------------------------------------
// Two questions had no answer before this module existed:
//
//   "why was this command allowed?"  -> entries[] keeps the Yan-side verdict for
//                                       every permission ask: who decided, the
//                                       risk level/category the renderer used,
//                                       and the final decision Yan sent.
//   "what am I currently allowing?"  -> shellAllowPrefixes is the persisted,
//                                       inspectable, revocable grant scope.
//
// The store is in-memory and bounded. It is a decision trail for the current
// process, not a log file: it must never be able to grow without limit.

const DEFAULT_MAX_ENTRIES = 200;
const MAX_SUBJECT_CHARS = 400;
const MAX_PREFIXES = 32;
const MAX_PREFIX_CHARS = 120;
const MAX_REQUEST_ID_CHARS = 200;

const DECISIONS = new Set(['pending', 'allow', 'deny', 'reject', 'always', 'once', 'modify', 'escalate']);

function clip(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const text = String(value || '').trim();
  return text || new Date().toISOString();
}

/**
 * Dedupe, clip and cap a candidate grant list. Never throws, so a malformed
 * payload from the renderer degrades to "no extra grants" instead of an
 * unbounded or corrupt persisted set.
 */
function normalizeShellPrefixes(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const prefix = clip(item, MAX_PREFIX_CHARS);
    if (!prefix || seen.has(prefix)) continue;
    seen.add(prefix);
    out.push(prefix);
    if (out.length >= MAX_PREFIXES) break;
  }
  return out;
}

function createPermissionAudit({ maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  const limit = Math.max(1, Number(maxEntries) || DEFAULT_MAX_ENTRIES);
  const entries = [];
  const pending = new Map();

  function trim() {
    if (entries.length > limit) entries.splice(0, entries.length - limit);
  }

  return {
    recordRequested({ requestId, permission, subject, source, at } = {}) {
      const id = clip(requestId, MAX_REQUEST_ID_CHARS);
      if (!id) return null;
      // Kernel retries re-emit the same request id; keep the first ask so the
      // trail shows when the user was actually first blocked, not the retry.
      const existing = pending.get(id);
      if (existing) return existing;
      const entry = {
        requestId: id,
        permission: clip(permission, 80) || 'unknown',
        subject: clip(subject, MAX_SUBJECT_CHARS),
        source: clip(source, 40) || 'unknown',
        decision: 'pending',
        requestedAt: normalizeTimestamp(at)
      };
      entries.push(entry);
      pending.set(id, entry);
      trim();
      return entry;
    },

    recordResolved({ requestId, decision, reply, source, reason, riskLevel, riskCategory, grantPrefix, at } = {}) {
      const id = clip(requestId, MAX_REQUEST_ID_CHARS);
      if (!id) return null;
      const normalized = clip(decision || reply, 40).toLowerCase();
      const resolved = {
        decision: DECISIONS.has(normalized) ? normalized : (normalized || 'unknown'),
        resolvedAt: normalizeTimestamp(at),
        ...(clip(riskLevel, 40) ? { riskLevel: clip(riskLevel, 40) } : {}),
        ...(clip(riskCategory, 40) ? { riskCategory: clip(riskCategory, 40) } : {}),
        ...(clip(grantPrefix, MAX_PREFIX_CHARS) ? { grantPrefix: clip(grantPrefix, MAX_PREFIX_CHARS) } : {}),
        ...(clip(reason, MAX_SUBJECT_CHARS) ? { reason: clip(reason, MAX_SUBJECT_CHARS) } : {}),
        ...(clip(source, 40) ? { resolvedBy: clip(source, 40) } : {})
      };
      const entry = pending.get(id);
      if (entry) {
        Object.assign(entry, resolved);
        pending.delete(id);
        return entry;
      }
      // A reply can arrive for a request this process never saw asked (kernel
      // restart, stale window). Record it rather than dropping the evidence.
      const orphan = { requestId: id, permission: 'unknown', subject: '', source: 'unknown', ...resolved };
      entries.push(orphan);
      trim();
      return orphan;
    },

    list({ limit: requested } = {}) {
      const count = Math.max(1, Math.min(limit, Number(requested) || limit));
      return entries.slice(-count).reverse().map(entry => ({ ...entry }));
    },

    size() { return entries.length; },
    pendingSize() { return pending.size; },
    clear() { entries.length = 0; pending.clear(); }
  };
}

// One audit per process: the sidecar records into it, main reads it back for
// the UI, and both must see the same entries regardless of kernel pooling.
const permissionAudit = createPermissionAudit();

module.exports = {
  MAX_PREFIXES,
  MAX_PREFIX_CHARS,
  createPermissionAudit,
  normalizeShellPrefixes,
  permissionAudit
};
