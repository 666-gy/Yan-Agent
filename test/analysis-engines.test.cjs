'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { offsetStats, inferStride, hexDump, diffSamples, probeChecksum } = require('../lib/analysis/protocol');
const { backwardSlice } = require('../lib/analysis/dataflow');
const { detectGhidra } = require('../lib/analysis/ghidra');
const { detectTshark } = require('../lib/analysis/pcap');
const { extractOutlineEx } = require('../lib/analysis/outline');

test('offsetStats classifies constant, low-entropy and payload offsets', () => {
  const records = [
    Buffer.from([0xaa, 0x01, 0x10, 0x55]),
    Buffer.from([0xaa, 0x01, 0x31, 0x9f]),
    Buffer.from([0xaa, 0x02, 0x77, 0x33])
  ];
  const stats = offsetStats(records, 4);
  assert.equal(stats.stride, 4);
  assert.equal(stats.records, 3);
  assert.equal(stats.stats[0].classification, 'constant');
  assert.equal(stats.stats[1].classification, 'low-entropy');
  assert.ok(['varying', 'high-entropy'].includes(stats.stats[2].classification));
});

test('inferStride finds the structural stride from constant columns', () => {
  const samples = [];
  for (let index = 0; index < 5; index++) {
    samples.push(Buffer.from([0xaa, index, 0x00]));
  }
  assert.equal(inferStride([Buffer.concat(samples)]), 3);
});

test('hexDump renders offset, hex and ascii columns', () => {
  const text = hexDump(Buffer.from('MAGIC\x01\x02payloadA'), {});
  assert.match(text, /^00000000 {2}4d 41 47 49 43 01 02 70/);
  assert.match(text, /|MAGIC..payloadA|/);
});

test('diffSamples reports first divergence and change table', () => {
  const left = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  const right = Buffer.from([0x01, 0x09, 0x03, 0x0a]);
  const result = diffSamples(left, right);
  assert.equal(result.firstDivergence, 1);
  assert.equal(result.changed, 2);
  assert.deepEqual(result.changes[0], { offset: 1, left: '0x02', right: '0x09' });
});

test('crc_probe identifies a trailing sum8 across every record', () => {
  const records = [
    Buffer.from([0x01, 0x02, 0x03, 0x06]),
    Buffer.from([0x05, 0x01, 0x00, 0x06]),
    Buffer.from([0x02, 0x02, 0x02, 0x06])
  ];
  const candidates = probeChecksum(records, { trailerBytes: 1 });
  const sum8 = candidates.find(candidate => candidate.algorithm === 'sum8');
  assert.ok(sum8, `sum8 in ${JSON.stringify(candidates)}`);
  assert.equal(sum8.payloadLength, 3);
  assert.equal(sum8.trailerOffset, 3);
});

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

test('external tool detection degrades to actionable hints', () => {
  const ghidra = detectGhidra();
  if (!ghidra.ok) assert.ok(ghidra.hint.includes('GHIDRA_INSTALL_DIR'));
  const tshark = detectTshark();
  assert.ok(tshark.ok || tshark.hint.includes('TSHARK_PATH'));
});

test('backwardSlice follows three dependency levels without future assignments', () => {
  const lines = ['const a = input;', 'const b = a + 1;', 'const c = b + 1;', 'return c;', 'a = unrelated;'];
  assert.deepEqual(backwardSlice(lines, 1, 5, 'c').lines.map(item => item.line), [1, 2, 3, 4]);
});

test('tshark probes PATH then falls back to installed locations', () => {
  const attempts = [];
  const result = detectTshark({ candidates: ['tshark', 'C:\\Program Files\\Wireshark\\tshark.exe'], probe(command) {
    attempts.push(command);
    return command === 'tshark' ? { status: null, error: new Error('ENOENT') } : { status: 0 };
  } });
  assert.equal(result.tshark, attempts[1]);
  assert.equal(attempts.length, 2);
  assert.equal(detectTshark({ candidates: ['missing'], probe: () => ({ status: 1 }) }).ok, false);
});

test('Ghidra batch launcher preserves spaces and cmd metacharacters', { skip: process.platform !== 'win32' }, async t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { promisify } = require('node:util');
  const exec = promisify(require('node:child_process').execFile);
  const { headlessCommand } = require('../lib/analysis/ghidra');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan headless '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const batch = path.join(dir, 'analyzeHeadless.bat');
  fs.writeFileSync(batch, '@echo off\r\necho %1\r\necho %2\r\n');
  const args = ['C:\\lab space\\sample & other.bin', 'name!literal%PATH%'];
  const launch = headlessCommand(batch, args);
  const result = await exec(launch.command, launch.args, { ...launch.options, windowsHide: true, timeout: 5000 });
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), args.map(value => `"${value}"`));
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
