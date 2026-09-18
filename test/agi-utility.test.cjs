'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createUtilityLedger, utilityOutcomeFromVerification } = require('../lib/agi/utility');

function withTempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-agi-utility-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('utilityOutcomeFromVerification maps pass/fail and blanks everything else', () => {
  assert.equal(utilityOutcomeFromVerification('pass'), 'success');
  assert.equal(utilityOutcomeFromVerification('fail'), 'failure');
  assert.equal(utilityOutcomeFromVerification('unobserved'), '');
  assert.equal(utilityOutcomeFromVerification(''), '');
  assert.equal(utilityOutcomeFromVerification(undefined), '');
});

test('attribute rejects a missing runId or entries without a usable kind/id', () => {
  withTempDir(dir => {
    const ledger = createUtilityLedger({ filePath: path.join(dir, 'utility.json') });
    assert.equal(ledger.attribute({ entries: [{ kind: 'skill', id: 'alpha' }] }).ok, false);
    assert.equal(ledger.attribute({ runId: 'run-1' }).ok, false);
    const invalid = ledger.attribute({
      runId: 'run-1',
      entries: [{ kind: 'Skill Tool', id: 'Alpha' }, { kind: 'skill', id: '   ' }, null]
    });
    assert.equal(invalid.ok, false);
    assert.equal(typeof invalid.error, 'string');
    assert.equal(ledger.report().length, 0);
  });
});

test('counts outcomes and verdicts and scores each entry', () => {
  withTempDir(dir => {
    const ledger = createUtilityLedger({ filePath: path.join(dir, 'utility.json') });
    const first = ledger.attribute({
      runId: 'run-pass',
      refinementId: 'ref-1',
      entries: [{ kind: 'skill', id: 'alpha' }],
      outcome: 'success',
      verification: { verdict: 'pass' }
    });
    assert.equal(first.ok, true);
    let record = ledger.get('skill', 'alpha');
    assert.equal(record.success, 1);
    assert.equal(record.failure, 0);
    assert.equal(record.verifiedPass, 1);
    assert.equal(record.verifiedFail, 0);
    assert.equal(record.unobserved, 0);
    assert.equal(record.score, 2.5);

    ledger.attribute({
      runId: 'run-fail',
      entries: [{ kind: 'skill', id: 'alpha' }],
      outcome: 'failure',
      verification: { verdict: 'fail' }
    });
    record = ledger.get('skill', 'alpha');
    assert.equal(record.success, 1);
    assert.equal(record.failure, 1);
    assert.equal(record.verifiedPass, 1);
    assert.equal(record.verifiedFail, 1);
    assert.equal(record.score, 0);

    ledger.attribute({
      runId: 'run-unobserved',
      entries: [{ kind: 'skill', id: 'alpha' }],
      verification: { verdict: 'unobserved' }
    });
    record = ledger.get('skill', 'alpha');
    assert.equal(record.unobserved, 1);
    assert.equal(record.score, 0);
  });
});

test('the same run cannot be counted twice against the same entry', () => {
  withTempDir(dir => {
    const ledger = createUtilityLedger({ filePath: path.join(dir, 'utility.json') });
    assert.equal(ledger.attribute({ runId: 'run-1', entries: [{ kind: 'memory', id: 'note' }], outcome: 'success' }).ok, true);
    const duplicate = ledger.attribute({ runId: 'run-1', entries: [{ kind: 'memory', id: 'note' }], outcome: 'success' });
    assert.equal(duplicate.ok, false);
    const record = ledger.get('memory', 'note');
    assert.equal(record.success, 1);
    assert.deepEqual(record.recentRunIds, ['run-1']);

    // The same run can still credit a different entry, and repeated entries in
    // one call count once.
    assert.equal(ledger.attribute({
      runId: 'run-1',
      entries: [{ kind: 'memory', id: 'other' }, { kind: 'memory', id: 'other' }],
      outcome: 'success'
    }).ok, true);
    assert.equal(ledger.get('memory', 'other').success, 1);
  });
});

test('empty outcome and verdict add no credit', () => {
  withTempDir(dir => {
    const ledger = createUtilityLedger({ filePath: path.join(dir, 'utility.json') });
    assert.equal(ledger.attribute({
      runId: 'run-empty',
      entries: [{ kind: 'skill', id: 'beta' }],
      outcome: '',
      verification: { verdict: 'unknown' }
    }).ok, true);
    const record = ledger.get('skill', 'beta');
    assert.equal(record.score, 0);
    assert.equal(record.success, 0);
    assert.equal(record.failure, 0);
    assert.equal(record.verifiedPass, 0);
    assert.equal(record.verifiedFail, 0);
    assert.equal(record.unobserved, 0);
    assert.equal(ledger.report()[0].score, 0);
  });
});

test('report sorts entries by score descending', () => {
  withTempDir(dir => {
    const ledger = createUtilityLedger({ filePath: path.join(dir, 'utility.json') });
    ledger.attribute({ runId: 'run-alpha', entries: [{ kind: 'skill', id: 'alpha' }], outcome: 'success', verification: { verdict: 'pass' } });
    ledger.attribute({ runId: 'run-beta', entries: [{ kind: 'skill', id: 'beta' }], verification: { verdict: 'unobserved' } });
    ledger.attribute({ runId: 'run-gamma', entries: [{ kind: 'skill', id: 'gamma' }], outcome: 'failure', verification: { verdict: 'fail' } });
    const sorted = ledger.report();
    assert.deepEqual(sorted.map(item => item.key), ['skill:alpha', 'skill:beta', 'skill:gamma']);
    assert.deepEqual(sorted.map(item => item.score), [2.5, 0, -2.5]);
  });
});

test('ledger persists atomically and reloads the same records', () => {
  withTempDir(dir => {
    const filePath = path.join(dir, 'utility.json');
    const ledger = createUtilityLedger({ filePath });
    const attributed = ledger.attribute({
      runId: 'run-1',
      entries: [{ kind: 'skill', id: 'alpha' }, { kind: 'memory', id: 'note' }],
      outcome: 'success',
      verification: { verdict: 'pass' }
    });
    assert.deepEqual(attributed.attributed, ['skill:alpha', 'memory:note']);

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(raw.version, 1);
    assert.ok(raw.entries['skill:alpha']);

    const reloaded = createUtilityLedger({ filePath });
    const record = reloaded.get('skill', 'alpha');
    assert.equal(record.success, 1);
    assert.equal(record.verifiedPass, 1);
    assert.equal(record.score, 2.5);
    assert.equal(reloaded.report().length, 2);
    assert.equal(reloaded.get('skill', 'missing'), null);

    // The reloaded ledger keeps deduplicating the run it already counted.
    assert.equal(reloaded.attribute({ runId: 'run-1', entries: [{ kind: 'skill', id: 'alpha' }], outcome: 'success' }).ok, false);
    assert.equal(reloaded.get('skill', 'alpha').success, 1);
  });
});
