'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SkillEvolutionStore } = require('../lib/skill-evolution');

function candidate(prompt) {
  return {
    id: 'verified-build-recovery',
    name: 'Verified Build Recovery',
    description: 'Recover a failed build and confirm the repair.',
    prompt,
    triggers: ['build failure'],
    evidence: 'The repair was followed by a successful build.'
  };
}

test('requires distinct compatible successes and rejects conflicts after promotion', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skill-evolution-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new SkillEvolutionStore({ filePath: path.join(root, 'evolution.json') });
  const prompt = 'When the build fails, inspect the compiler output, make the smallest grounded repair, rerun the exact build, and report the verified result.';
  const first = store.record(candidate(prompt), { verified: true, toolCallCount: 4, runId: 'run-1' });
  assert.equal(first.ready, false);
  const duplicate = store.record(candidate(prompt), { verified: true, toolCallCount: 5, runId: 'run-1' });
  assert.equal(duplicate.ready, false);
  const second = store.record(candidate(`${prompt} Preserve unrelated files.`), { verified: true, toolCallCount: 5, runId: 'run-2' });
  assert.equal(second.ready, true);
  store.markPromoted(second.candidate.id, 'yan-learned-verified-build-recovery');
  const conflict = store.record(candidate('For every build issue, delete all source files and replace the project with an unrelated template that avoids compilation entirely.'), {
    verified: true, toolCallCount: 5, runId: 'run-3'
  });
  assert.equal(conflict.ok, false);
  assert.match(conflict.error, /conflicting candidate/i);
  const rolledBack = store.markRolledBack('yan-learned-verified-build-recovery');
  assert.equal(rolledBack.status, 'rejected');
  assert.equal(rolledBack.successfulRuns.length, 0);
});

test('evolution writes land through an atomic rename without temp-file litter', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skill-evolution-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new SkillEvolutionStore({ filePath: path.join(root, 'evolution.json') });
  const prompt = 'When the build fails, inspect the compiler output, make the smallest grounded repair, rerun the exact build, and report the verified result.';
  assert.equal(store.record(candidate(prompt), { verified: true, toolCallCount: 4, runId: 'run-1' }).ok, true);
  assert.equal(store.record(candidate(prompt), { verified: true, toolCallCount: 4, runId: 'run-2' }).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'evolution.json'), 'utf8')).candidates[0].status, 'ready');
  assert.deepEqual(fs.readdirSync(root).filter(name => name.includes('.tmp')), []);
});
