'use strict';

// Source-text pin guard (plan T0.3): the 8 audited source-text assertions are
// tracked in test/fixtures/source-text-pins.json. Their count may only go
// down. A new test that reads main.js / renderer/renderer.js source text fails
// here instead of silently adding a migration blocker.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const testDir = __dirname;
const fixture = JSON.parse(fs.readFileSync(path.join(testDir, 'fixtures', 'source-text-pins.json'), 'utf8'));

const MAIN_TEXT_RE = /readFileSync\([^)]*['"`][^'"`]*main\.js/;
const RENDERER_TEXT_RE = /readFileSync\([^)]*['"`][^'"`]*renderer\.js/;

function scanPins() {
  const main = [];
  const renderer = [];
  for (const name of fs.readdirSync(testDir).sort()) {
    if (!/\.(test|e2e)\.cjs$/.test(name)) continue;
    const source = fs.readFileSync(path.join(testDir, name), 'utf8');
    if (MAIN_TEXT_RE.test(source)) main.push(name);
    if (RENDERER_TEXT_RE.test(source)) renderer.push(name);
  }
  return { main, renderer };
}

test('source-text pins are exactly the audited inventory', () => {
  const actual = scanPins();
  for (const kind of ['main', 'renderer']) {
    assert.deepEqual(
      actual[kind].sort(),
      [...fixture.pins[kind]].sort(),
      `the ${kind}-side text-pin inventory changed; convert the test to behavior assertions and remove it from test/fixtures/source-text-pins.json`
    );
  }
});

test('every pin is scheduled for conversion before a named wave', () => {
  const pinned = new Set([...fixture.pins.main, ...fixture.pins.renderer]);
  const scheduled = new Set(Object.keys(fixture.convertedBefore));
  const unscheduled = [...pinned].filter(name => !scheduled.has(name));
  assert.deepEqual(unscheduled, [], 'every pin needs a conversion wave in convertedBefore');
});
