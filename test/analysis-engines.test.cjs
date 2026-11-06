'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { backwardSlice } = require('../lib/analysis/dataflow');
const { extractOutlineEx } = require('../lib/analysis/outline');

test('backwardSlice keeps the transitive feeding lines of a variable', () => {
  const lines = [
    'function dispatch(frame) {',
    '  const size = frame.length;',
    '  const padded = pad(size);',
    '  if (size > 10) {',
    '    padded += 1;',
    '  }',
    '  return padded;',
    '}'
  ];
  const result = backwardSlice(lines, 1, 8, 'size');
  const byLine = new Map(result.lines.map(entry => [entry.line, entry.role]));
  assert.equal(byLine.get(2), 'seed');
  assert.ok(byLine.get(3), 'reader line included');
  assert.ok(byLine.get(4), 'reader line included');
  assert.equal(result.lines.every(entry => entry.text), true);
});

test('backwardSlice follows three dependency levels without future assignments', () => {
  const lines = ['const a = input;', 'const b = a + 1;', 'const c = b + 1;', 'return c;', 'a = unrelated;'];
  assert.deepEqual(backwardSlice(lines, 1, 5, 'c').lines.map(item => item.line), [1, 2, 3, 4]);
});

test('tree-sitter backend matches the line engine output shape', async () => {
  const source = [
    'import { helper } from "./b.js";',
    '',
    'export class Engine {',
    '  constructor(size) {',
    '    this.size = size;',
    '  }',
    '  start(mode) {',
    '    return helper(mode);',
    '  }',
    '}',
    '',
    'const quench = (heat) => {',
    '  return heat - 1;',
    '};'
  ].join('\n');
  const result = await extractOutlineEx('app/engine.js', source);
  const names = result.symbols.map(symbol => symbol.name);
  assert.equal(result.backend, 'tree-sitter');
  assert.ok(names.includes('Engine'));
  assert.ok(names.includes('Engine.start'), `methods: ${names.join(',')}`);
  assert.ok(names.includes('quench'));
  const engine = result.symbols.find(symbol => symbol.name === 'Engine');
  assert.equal(engine.line, 3);
});
