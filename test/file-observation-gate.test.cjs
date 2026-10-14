'use strict';

// File observation gate (execution layer) — the decision contract.
//
// The gate answers exactly one question at mutation time: was this file
// observed in a state that still holds? Three outcomes, and the tests below pin
// all three plus the edges that make the difference between a gate and an
// obstacle:
//
//   1. Unobserved target        -> allowed. Otherwise copy-elsewhere work dies.
//   2. Observed and unchanged   -> allowed, silently.
//   3. Observed and changed     -> denied, with both revisions attached.
//
// Plus: deletion, case folding, path spellings, the multi-file apply_patch
// envelope, and the env off switch.
//
// The baseline lifecycle (a failed operation must NOT record one) is the
// caller's job and is pinned end-to-end in test/coding-environment.test.cjs,
// where the real hooks run. What matters here is that `observe` records
// whatever `revisionOf` reports, including 'missing', so the caller can rely on
// the gate never inventing a revision.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gate = require('../lib/file-observation-gate.js');
const { fileRevision } = require('../lib/verification-state');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-observation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function build(events = []) {
  const state = new Map();
  return {
    state,
    events,
    gate: gate.createFileObservationGate({
      state,
      revisionOf: fileRevision,
      events: event => events.push(event)
    })
  };
}

test('an unobserved file is allowed — the gate is not a read-before-write rule', t => {
  const root = workspace(t);
  const file = path.join(root, 'fresh.js');
  fs.writeFileSync(file, 'const a = 1;\n');
  const { gate: g, state } = build();
  assert.deepEqual(g.evaluate([file]), { action: 'allow' });
  assert.equal(state.size, 0, 'evaluating must not observe');
});

test('an observed file that has not moved is allowed, silently', t => {
  const root = workspace(t);
  const file = path.join(root, 'stable.js');
  fs.writeFileSync(file, 'const a = 1;\n');
  const events = [];
  const { gate: g } = build(events);
  g.observe(file);
  assert.deepEqual(g.evaluate([file]), { action: 'allow' });
  assert.deepEqual(events, [{ type: 'allow', count: 1 }]);
});

test('an observed file that changed underneath is denied, with both revisions', t => {
  const root = workspace(t);
  const file = path.join(root, 'moved.js');
  fs.writeFileSync(file, 'const a = 1;\n');
  const { gate: g } = build();
  const observed = g.observe(file);

  // The user's editor, a build, or another tool writes the file.
  fs.writeFileSync(file, 'const a = 2; // newer\n');

  const verdict = g.evaluate([file]);
  assert.equal(verdict.action, 'deny');
  assert.equal(verdict.file, file);
  assert.equal(verdict.observed, observed);
  assert.equal(verdict.current, fileRevision(file));
  assert.notEqual(verdict.observed, verdict.current);
  assert.ok(verdict.observedAt > 0);
});

test('a file observed and then deleted is denied, and the message says so', t => {
  const root = workspace(t);
  const file = path.join(root, 'gone.js');
  fs.writeFileSync(file, 'const a = 1;\n');
  const { gate: g } = build();
  g.observe(file);
  fs.unlinkSync(file);

  const verdict = g.evaluate([file]);
  assert.equal(verdict.action, 'deny');
  assert.equal(verdict.current, 'missing');

  const message = gate.staleObservationMessage(verdict);
  assert.match(message, /no longer exists/);
  assert.match(message, /Re-read the file/);
});

test('observing a file that does not exist records "missing" rather than throwing', t => {
  const root = workspace(t);
  const file = path.join(root, 'never-written.js');
  const { gate: g } = build();
  assert.equal(g.observe(file), 'missing');
  // Still missing, so the state has not moved and a create is allowed.
  assert.deepEqual(g.evaluate([file]), { action: 'allow' });
});

test('a multi-file patch is denied when any one target moved', t => {
  const root = workspace(t);
  const a = path.join(root, 'a.js');
  const b = path.join(root, 'b.js');
  fs.writeFileSync(a, 'a1\n');
  fs.writeFileSync(b, 'b1\n');
  const { gate: g } = build();
  g.observe(a);
  g.observe(b);

  fs.writeFileSync(b, 'b2\n');
  const verdict = g.evaluate([a, b]);
  assert.equal(verdict.action, 'deny');
  assert.equal(verdict.file, b, 'the moved file is named, not the first file');
});

test('case folding follows the platform so a case-sensitive fs is never folded', () => {
  assert.equal(gate.observationKey('C:\\Work\\Src\\App.js', 'win32'), 'c:\\work\\src\\app.js');
  assert.equal(gate.observationKey('/work/src/App.js', 'linux'), '\\work\\src\\App.js');
  assert.notEqual(gate.observationKey('/w/App.js', 'linux'), gate.observationKey('/w/app.js', 'linux'));
  assert.equal(gate.observationKey('c:/work/app.js', 'win32'), 'c:\\work\\app.js');
  assert.equal(gate.observationKey('  C:\\work\\app.js\\\\  ', 'win32'), 'c:\\work\\app.js');
  assert.equal(gate.observationKey('', 'win32'), '');
});

test('a denied file found through a different path spelling is still denied', t => {
  const root = workspace(t);
  const file = path.join(root, 'spelled.js');
  fs.writeFileSync(file, 'one\n');
  const { gate: g } = build();
  g.observe(file);
  fs.writeFileSync(file, 'two\n');

  // Forward slashes and a trailing separator must not create a second identity
  // for a file that was already observed.
  assert.equal(g.evaluate([file.replace(/\\/g, '/')]).action, 'deny');
  assert.equal(g.evaluate([`${file}${path.sep}`]).action, 'deny');

  // On Windows the same file reached through a different case is the same file,
  // so the denial has to survive case changes too.
  if (process.platform === 'win32') {
    assert.equal(g.evaluate([file.toUpperCase()]).action, 'deny');
  }
});

test('mutation targets come from both argument spellings and the patch envelope', () => {
  assert.deepEqual(gate.mutationTargets('edit', { filePath: 'a.js' }), ['a.js']);
  assert.deepEqual(gate.mutationTargets('write', { path: 'b.js' }), ['b.js']);
  assert.deepEqual(gate.mutationTargets('edit', {}), []);
  assert.deepEqual(gate.mutationTargets('edit', { filePath: '' }), []);
  assert.deepEqual(gate.mutationTargets('read', { filePath: 'a.js' }), ['a.js']);
  assert.deepEqual(
    gate.mutationTargets('apply_patch', {
      patchText: '*** Begin Patch\n*** Update File: x.js\n*** Add File: y.js\n*** Delete File: z.js\n*** End Patch'
    }),
    ['x.js', 'y.js', 'z.js']
  );
  assert.deepEqual(
    gate.mutationTargets('apply_patch', { patchText: '*** Begin Patch\n*** Update File: x.js\n*** Move to: y.js\n*** End Patch' }),
    ['x.js', 'y.js']
  );
});

test('the gate is on unless explicitly turned off, and "off" has to be spelled out', () => {
  assert.equal(gate.isFileObservationGateEnabled({}), true);
  assert.equal(gate.isFileObservationGateEnabled({ YAN_FILE_OBSERVATION_GATE: '' }), true);
  assert.equal(gate.isFileObservationGateEnabled({ YAN_FILE_OBSERVATION_GATE: '   ' }), true);
  assert.equal(gate.isFileObservationGateEnabled({ YAN_FILE_OBSERVATION_GATE: 'on' }), true);
  assert.equal(gate.isFileObservationGateEnabled({ YAN_FILE_OBSERVATION_GATE: 'yes' }), true);
  for (const value of ['off', 'OFF', '0', 'false', 'disabled', 'no', ' off ']) {
    assert.equal(gate.isFileObservationGateEnabled({ YAN_FILE_OBSERVATION_GATE: value }), false, value);
  }
});

test('the gate refuses to be constructed without a state store or a revision source', () => {
  assert.throws(() => gate.createFileObservationGate({ revisionOf: () => 'x' }), /Map-like state store/);
  assert.throws(() => gate.createFileObservationGate({ state: new Map() }), /revisionOf/);
});

test('only content-reading tools count as observations', () => {
  // glob/grep/list report paths and matches, not contents. Treating them as
  // observations would make a write composed from assumption look informed.
  assert.deepEqual([...gate.OBSERVATION_TOOLS], ['read']);
  assert.deepEqual([...gate.MUTATION_TOOLS].sort(), ['apply_patch', 'edit', 'write']);
});

test('the denial message names the file, the reason, and the recovery', t => {
  const root = workspace(t);
  const file = path.join(root, 'msg.js');
  fs.writeFileSync(file, 'one\n');
  const { gate: g } = build();
  g.observe(file);
  fs.writeFileSync(file, 'two\n');
  const message = gate.staleObservationMessage(g.evaluate([file]));
  assert.match(message, /changed on disk/);
  assert.ok(message.includes(file));
  assert.match(message, /Re-read the file and re-apply/);
  // It must not tell the model the write succeeded, and it must not invite it
  // to clobber a concurrent writer.
  assert.match(message, /preserve their change instead of overwriting it/);
});
