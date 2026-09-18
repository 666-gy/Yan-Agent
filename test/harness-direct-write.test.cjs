'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContinualHarnessStore, normalizeState, readState } = require('../lib/continual-harness');

function makeStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-harness-direct-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new ContinualHarnessStore({
    globalPath: path.join(root, 'global-harness-state.json'),
    yanagentDir: '.yanagent'
  });
}

const DIRECT_WRITE_STATE = {
  version: 1,
  entries: {
    memory: {
      'well-formed': { id: 'well-formed', kind: 'memory', title: 'Tool write', content: 'sanctioned entry', status: 'active' }
    },
    // The model invented its own bucket.
    evolution: {
      'evo-741': 'EVO_ENTRY_741 free-form evolution note'
    }
  },
  // The model added its own top-level bookkeeping key.
  evolutionNote: 'written directly by the model at 03:41',
  refinements: []
};

test('direct-written scalars, contentless objects, unknown kinds and keys all survive normalization', () => {
  const state = normalizeState(JSON.parse(JSON.stringify(DIRECT_WRITE_STATE)), 'workspace');
  // Well-formed entries keep their strict shape.
  assert.equal(state.entries.memory['well-formed'].content, 'sanctioned entry');
  // String entry: content becomes the scalar verbatim, marked direct-write.
  const stringEntry = state.externalEntries.evolution['evo-741'] ?? state.entries.memory;
  // Unknown bucket is preserved verbatim on the state.
  assert.equal(state.externalEntries.evolution['evo-741'], 'EVO_ENTRY_741 free-form evolution note');
  // Unknown top-level key is preserved.
  assert.equal(state.preserved.evolutionNote, 'written directly by the model at 03:41');
  assert.ok(stringEntry);
});

test('store round-trip preserves direct-written state across load and rewrite', t => {
  const store = makeStore(t);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-harness-direct-ws-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const statePath = path.join(workspace, '.yanagent', 'harness', 'harness-state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(DIRECT_WRITE_STATE, null, 2));

  // Exactly what applyReviewedHarnessState does: load current disk state,
  // apply reviewed edits, write the state back.
  const state = store.load({ scope: 'workspace', workspace });
  state.entries.memory['review-741'] = {
    id: 'review-741', kind: 'memory', title: 'Reviewed', content: 'REVIEW_741', path: 'general',
    scope: 'workspace', metadata: { status: 'active' }, source: 'tool', createdAt: Date.now(),
    updatedAt: Date.now(), version: 1
  };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  const reloaded = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(reloaded.entries.memory['well-formed'].content, 'sanctioned entry');
  assert.equal(reloaded.entries.memory['review-741'].content, 'REVIEW_741');
  assert.equal(reloaded.externalEntries.evolution['evo-741'], 'EVO_ENTRY_741 free-form evolution note');
  assert.equal(reloaded.preserved.evolutionNote, 'written directly by the model at 03:41');
});

test('well-formed sanctioned entries are unaffected by lenient normalization', () => {
  const wellFormed = {
    version: 1,
    entries: { prompt: { 'rule-1': { id: 'rule-1', kind: 'prompt', title: 'Rule', content: 'Always lint.', path: 'coding', metadata: { status: 'active' } } } },
    refinements: []
  };
  const state = normalizeState(JSON.parse(JSON.stringify(wellFormed)), 'global');
  const entry = state.entries.prompt['rule-1'];
  assert.equal(entry.content, 'Always lint.');
  assert.equal(entry.source, 'migration');
  assert.equal(entry.path, 'coding');
  assert.equal(state.externalEntries && Object.keys(state.externalEntries).length, 0);
});
