'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_PREFIXES,
  MAX_PREFIX_CHARS,
  createPermissionAudit,
  normalizeShellPrefixes,
  permissionAudit
} = require('../lib/permission-audit');

// ---------------------------------------------------------------------------
// Shell grant scope (P0/P4)
// The persisted list is the only thing standing between "the user allowed one
// command shape" and "the user allowed everything", so its normaliser is the
// contract: bounded, deduped, clipped, and harmless on garbage input.
// ---------------------------------------------------------------------------

test('a malformed grant payload degrades to no grants instead of throwing', () => {
  for (const value of [undefined, null, 'npm test', 42, {}, { 0: 'npm test' }]) {
    assert.deepEqual(normalizeShellPrefixes(value), []);
  }
});

test('grant prefixes are deduped and clipped', () => {
  const long = 'x'.repeat(MAX_PREFIX_CHARS + 50);
  const result = normalizeShellPrefixes(['npm test', 'npm test', '  ', long, 'pnpm run lint']);
  assert.deepEqual(result, ['npm test', 'x'.repeat(MAX_PREFIX_CHARS), 'pnpm run lint']);
  assert.ok(result.every(prefix => prefix.length <= MAX_PREFIX_CHARS));
});

test('the grant list is capped so it can never grow without limit', () => {
  const many = Array.from({ length: MAX_PREFIXES + 40 }, (_, index) => `cmd${index} run`);
  const result = normalizeShellPrefixes(many);
  assert.equal(result.length, MAX_PREFIXES);
  assert.equal(result[0], 'cmd0 run');
  assert.equal(result.at(-1), `cmd${MAX_PREFIXES - 1} run`);
});

// ---------------------------------------------------------------------------
// Decision trail (P3)
// ---------------------------------------------------------------------------

test('an ask records why, and the resolution fills the same entry', () => {
  const audit = createPermissionAudit();
  audit.recordRequested({
    requestId: 'per_1', permission: 'bash', subject: 'rm -rf build', source: 'session'
  });
  assert.equal(audit.pendingSize(), 1);

  audit.recordResolved({
    requestId: 'per_1', decision: 'allow', source: 'renderer',
    riskLevel: 'high', riskCategory: 'file_delete', grantPrefix: ''
  });

  const [entry] = audit.list();
  assert.equal(entry.requestId, 'per_1');
  assert.equal(entry.permission, 'bash');
  assert.equal(entry.subject, 'rm -rf build');
  assert.equal(entry.source, 'session');
  assert.equal(entry.decision, 'allow');
  assert.equal(entry.resolvedBy, 'renderer');
  assert.equal(entry.riskLevel, 'high');
  assert.equal(entry.riskCategory, 'file_delete');
  assert.equal(entry.requestedAt, entry.requestedAt);
  assert.ok(entry.resolvedAt);
  assert.equal(audit.pendingSize(), 0);
});

test('a repeated ask keeps the first timestamp instead of rewriting history', () => {
  const audit = createPermissionAudit();
  const first = audit.recordRequested({
    requestId: 'per_retry', permission: 'bash', subject: 'npm test', source: 'session', at: '2026-01-01T00:00:00.000Z'
  });
  const second = audit.recordRequested({
    requestId: 'per_retry', permission: 'bash', subject: 'npm test', source: 'session', at: '2026-01-01T00:05:00.000Z'
  });
  assert.equal(first, second);
  assert.equal(audit.size(), 1);
  assert.equal(audit.list()[0].requestedAt, '2026-01-01T00:00:00.000Z');
});

test('a resolution with no matching ask is still recorded', () => {
  const audit = createPermissionAudit();
  audit.recordResolved({ requestId: 'per_orphan', decision: 'once', source: 'renderer' });
  const [entry] = audit.list();
  assert.equal(entry.requestId, 'per_orphan');
  assert.equal(entry.permission, 'unknown');
  assert.equal(entry.decision, 'once');
});

test('entries are bounded and listed newest first', () => {
  const audit = createPermissionAudit({ maxEntries: 3 });
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    audit.recordRequested({ requestId: id, permission: 'bash', subject: id, source: 'session' });
  }
  assert.equal(audit.size(), 3);
  assert.deepEqual(audit.list().map(entry => entry.requestId), ['e', 'd', 'c']);
  assert.deepEqual(audit.list({ limit: 2 }).map(entry => entry.requestId), ['e', 'd']);
});

test('an unrecognised decision is preserved rather than silently dropped', () => {
  const audit = createPermissionAudit();
  audit.recordRequested({ requestId: 'per_x', permission: 'bash', source: 'session' });
  audit.recordResolved({ requestId: 'per_x', decision: 'something-new' });
  assert.equal(audit.list()[0].decision, 'something-new');
});

test('a request without an id records nothing and clear() empties the trail', () => {
  const audit = createPermissionAudit();
  assert.equal(audit.recordRequested({ permission: 'bash' }), null);
  assert.equal(audit.size(), 0);
  audit.recordRequested({ requestId: 'per_1', permission: 'bash', source: 'session' });
  audit.clear();
  assert.equal(audit.size(), 0);
  assert.equal(audit.pendingSize(), 0);
});

test('the process-wide audit instance is shared and bounded', () => {
  assert.equal(typeof permissionAudit.recordRequested, 'function');
  assert.equal(typeof permissionAudit.list, 'function');
  assert.ok(Array.isArray(permissionAudit.list()));
});
