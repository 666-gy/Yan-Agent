'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parsePlanMarker, formatPlanMarker, validatePlanGraph } = require('../lib/subagent/plan');

test('parsePlanMarker reads the marker line and ignores surrounding prompt text', () => {
  const prompt = [
    ' yan-plan: {"id":"auth","dependsOn":["db","schema"],"acceptance":"node test/auth.test.js passes"} ',
    'Implement the auth module in src/auth.js.',
    'Do not touch src/db.js.'
  ].join('\n');
  assert.deepEqual(parsePlanMarker(prompt), {
    id: 'auth',
    dependsOn: ['db', 'schema'],
    acceptance: 'node test/auth.test.js passes'
  });
});

test('parsePlanMarker returns null for missing, malformed, or id-less markers', () => {
  assert.equal(parsePlanMarker('no marker here'), null);
  assert.equal(parsePlanMarker(''), null);
  assert.equal(parsePlanMarker('yan-plan: {not json}'), null);
  assert.equal(parsePlanMarker('yan-plan: ["array"]'), null);
  assert.equal(parsePlanMarker('yan-plan: {"dependsOn":["db"]}'), null);
  assert.equal(parsePlanMarker('yan-plan: {"id":"  "}'), null);
});

test('parsePlanMarker clamps oversized fields and drops bad dependencies', () => {
  const plan = parsePlanMarker(`yan-plan: {"id":"${'x'.repeat(100)}","dependsOn":["ok","",123],"acceptance":"${'y'.repeat(500)}"}`);
  assert.ok(plan.id.length <= 64);
  assert.deepEqual(plan.dependsOn, ['ok']);
  assert.ok(plan.acceptance.length <= 400);
});

test('formatPlanMarker round-trips through parsePlanMarker', () => {
  const plan = { id: 'ui', dependsOn: ['api'], acceptance: 'npm test' };
  assert.deepEqual(parsePlanMarker(formatPlanMarker(plan)), plan);
  assert.equal(formatPlanMarker({ id: '' }), '');
  assert.equal(formatPlanMarker({ id: 'solo' }), 'yan-plan: {"id":"solo"}');
});

test('validatePlanGraph orders dependencies first and reports cycles and unknowns', () => {
  const linear = validatePlanGraph([
    { id: 'b', dependsOn: ['a'] },
    { id: 'a' },
    { id: 'c', dependsOn: ['b'] }
  ]);
  assert.equal(linear.ok, true);
  assert.deepEqual(linear.order, ['a', 'b', 'c']);

  const cycle = validatePlanGraph([
    { id: 'a', dependsOn: ['b'] },
    { id: 'b', dependsOn: ['a'] }
  ]);
  assert.equal(cycle.ok, false);
  assert.ok(cycle.errors.some(error => error.includes('cycle')));

  const unknown = validatePlanGraph([{ id: 'a', dependsOn: ['ghost'] }]);
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.some(error => error.includes('ghost')));

  const duplicate = validatePlanGraph([{ id: 'a' }, { id: 'a' }]);
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.errors.some(error => error.includes('duplicate')));
});
