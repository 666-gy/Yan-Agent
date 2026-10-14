'use strict';

// IPC channel freeze (plan T0.2): the renderer/preload contract is frozen as a
// snapshot of every `ipcMain.handle/on(channel)` registration in main.js and
// lib/main/**. Moving a handler between files must not rename, add or drop a
// channel; intentional contract changes update test/fixtures/ipc-channels.json
// in the same commit and are visible in review.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');
const fixturePath = path.join(__dirname, 'fixtures', 'ipc-channels.json');
const CHANNEL_RE = /\bipcMain\.(handle|on)\(\s*(['"`])([^'"`]+)\2/g;

const expected = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function listSourceFiles() {
  const files = [path.join(appRoot, 'main.js')];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        files.push(full);
      }
    }
  };
  walk(path.join(appRoot, 'lib', 'main'));
  return files.slice().sort();
}

function collectChannels() {
  const found = new Map();
  for (const file of listSourceFiles()) {
    const relative = path.relative(appRoot, file).split(path.sep).join('/');
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(CHANNEL_RE)) {
      const name = match[3];
      const previous = found.get(name);
      assert.equal(
        previous,
        undefined,
        `duplicate IPC channel ${name}: ${previous?.file} and ${relative}`
      );
      found.set(name, { name, kind: match[1], file: relative });
    }
  }
  return found;
}

test('IPC channel surface matches the frozen snapshot exactly', () => {
  const actual = collectChannels();
  const actualNames = [...actual.keys()].sort();
  const expectedNames = expected.channels.map(channel => channel.name).sort();
  const added = actualNames.filter(name => !expectedNames.includes(name));
  const removed = expectedNames.filter(name => !actualNames.includes(name));
  assert.deepEqual(
    added,
    [],
    'new IPC channels must be added to test/fixtures/ipc-channels.json in the same commit'
  );
  assert.deepEqual(
    removed,
    [],
    'IPC channels disappeared; restore them or update the frozen fixture deliberately'
  );
  assert.equal(actualNames.length, expected.count, 'frozen channel count changed');
});

test('frozen channel kinds (handle vs on) are unchanged', () => {
  const actual = collectChannels();
  const mismatched = expected.channels
    .filter(channel => actual.get(channel.name) && actual.get(channel.name).kind !== channel.kind)
    .map(channel => `${channel.name}: expected ${channel.kind}, found ${actual.get(channel.name).kind}`);
  assert.deepEqual(mismatched, [], 'an IPC channel changed between handle and on');
});
