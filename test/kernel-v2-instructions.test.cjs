'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_INSTRUCTION_ENTRY_BYTES,
  INSTRUCTION_CHUNK_BYTES,
  instructionEntryBytes,
  chunkInstructionValue,
  instructionChunkKeys,
  writeInstructionEntry
} = require('../lib/kernel-v2/instructions');

test('oversized instruction values split into bounded ordered entries', () => {
  const text = 'policy line\n'.repeat(50000);
  const chunks = chunkInstructionValue(text);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), text);
  for (const chunk of chunks) {
    assert.ok(instructionEntryBytes(chunk) <= INSTRUCTION_CHUNK_BYTES);
    assert.ok(instructionEntryBytes(chunk) <= MAX_INSTRUCTION_ENTRY_BYTES);
  }
  assert.deepEqual(instructionChunkKeys('yan.policy', 3), ['yan.policy', 'yan.policy.001', 'yan.policy.002']);
});

test('chunking never splits a surrogate pair', () => {
  const text = '😀'.repeat(120000);
  const chunks = chunkInstructionValue(text);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), text);
  for (const chunk of chunks) {
    assert.ok(!/^[\udc00-\udfff]/.test(chunk), 'chunk starts with a low surrogate');
    assert.ok(!/[\ud800-\udbff]$/.test(chunk), 'chunk ends with a high surrogate');
  }
});

test('small instruction values keep the single legacy key', async () => {
  const entries = new Map();
  const client = { session: { instructions: { entry: {
    put: async ({ key, value }) => { entries.set(key, value); },
    list: async () => [...entries].map(([key, value]) => ({ key, value })),
    remove: async ({ key }) => { entries.delete(key); }
  } } } };
  await writeInstructionEntry(client, 'ses', 'yan.policy', 'small policy');
  assert.deepEqual([...entries.keys()], ['yan.policy']);
});

test('large instruction values chunk and clear stale numbered suffixes', async () => {
  const entries = new Map([['yan.policy.003', 'stale'], ['yan.turn.001', 'other']]);
  const puts = [];
  const client = { session: { instructions: { entry: {
    put: async ({ key, value }) => { puts.push(key); entries.set(key, value); },
    list: async () => [...entries].map(([key, value]) => ({ key, value })),
    remove: async ({ key }) => { entries.delete(key); }
  } } } };
  const text = 'x'.repeat(600 * 1024);
  await writeInstructionEntry(client, 'ses', 'yan.policy', text);
  assert.ok(puts.length > 1);
  assert.equal(puts[0], 'yan.policy');
  assert.ok(puts.every(key => key === 'yan.policy' || /^yan\.policy\.\d{3}$/.test(key)));
  assert.equal(entries.has('yan.policy.003'), false);
  assert.equal(entries.has('yan.turn.001'), true);
  assert.equal(puts.map(key => entries.get(key)).join(''), text);
});

test('instruction write failures name the key, chunk and sizes', async () => {
  const client = { session: { instructions: { entry: {
    put: async ({ key }) => { if (key.endsWith('.001')) throw new Error('InstructionEntryValueTooLargeError'); }
  } } } };
  await assert.rejects(() => writeInstructionEntry(client, 'ses', 'yan.policy', 'x'.repeat(600 * 1024)), error => {
    assert.match(error.message, /yan\.policy\.001/);
    assert.match(error.message, /bytes/);
    assert.match(error.message, /chunk sizes/);
    assert.match(error.message, /InstructionEntryValueTooLargeError/);
    return true;
  });
});
