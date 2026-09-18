'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { mineSequences, proposeCandidate } = require('../lib/agi/workflow-mining');
const { SkillEvolutionStore } = require('../lib/skill-evolution');

function tool(name, targetKey) {
  return targetKey ? { tool: name, targetKey } : { tool: name };
}

function makeDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-agi-mining-'));
  return {
    root,
    file: path.join(root, 'skill-evolution.json'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

test('mining keeps repeated sequences and ignores single occurrences and empty tools', () => {
  const steps = [
    tool('read'), tool('edit'), tool('test'),
    { tool: '   ' },
    tool('read'), tool('edit'), tool('test'),
    tool('grep'), tool('read'), tool('edit')
  ];
  const sequences = mineSequences(steps);
  assert.equal(sequences.length, 1);
  assert.deepEqual(sequences[0].tools, ['read', 'edit', 'test']);
  assert.equal(sequences[0].length, 3);
  assert.equal(sequences[0].occurrences, 2);
  assert.deepEqual(sequences[0].exampleIndexes, [0, 3]);
});

test('counts windows for n = minLength through minLength + 2', () => {
  const cycle = ['a', 'b', 'c', 'd', 'e'];
  const steps = [...cycle, ...cycle].map(name => tool(name));
  const sequences = mineSequences(steps);
  const byLength = new Map();
  for (const sequence of sequences) byLength.set(sequence.length, (byLength.get(sequence.length) || 0) + 1);
  assert.equal(byLength.get(3), 3);
  assert.equal(byLength.get(4), 2);
  assert.equal(byLength.get(5), 1);
  assert.equal(sequences[0].length, 5);
  assert.deepEqual(sequences[0].tools, cycle);
  assert.equal(sequences[0].occurrences, 2);
});

test('sorts deterministically by occurrences, length then lexicographic tools', () => {
  const repeated = [
    tool('x'), tool('y'), tool('z'),
    tool('x'), tool('y'), tool('z'),
    tool('a'), tool('b'), tool('c'),
    tool('a'), tool('b'), tool('c'),
    tool('x'), tool('y'), tool('z')
  ];
  const sequences = mineSequences(repeated);
  assert.deepEqual(sequences.map(entry => entry.tools.join(',')), ['x,y,z', 'a,b,c']);
  assert.deepEqual(mineSequences(repeated), sequences);

  const tied = [
    tool('x'), tool('y'), tool('z'), tool('x'), tool('y'), tool('z'),
    tool('a'), tool('b'), tool('c'), tool('a'), tool('b'), tool('c')
  ];
  assert.deepEqual(mineSequences(tied).slice(0, 2).map(entry => entry.tools.join(',')), ['a,b,c', 'x,y,z']);
});

test('truncates input to 2000 steps and honors maxSequences', () => {
  const filler = Array.from({ length: 1999 }, (_, index) => tool(`fill-${index % 7}`));
  const steps = [
    ...filler,
    tool('late-a'), tool('late-b'), tool('late-c'),
    tool('late-a'), tool('late-b'), tool('late-c')
  ];
  const sequences = mineSequences(steps);
  assert.equal(sequences.some(sequence => sequence.tools.includes('late-a')), false);
  assert.ok(sequences.every(sequence => sequence.exampleIndexes.every(index => index < 2000)));
  assert.ok(sequences.length <= 20);
  assert.equal(mineSequences(steps, { maxSequences: 2 }).length, 2);
});

test('proposed candidate is accepted by SkillEvolutionStore.record', () => {
  const dir = makeDir();
  try {
    const steps = [
      tool('read', 'src/app.js'), tool('grep', 'src/app.js'), tool('edit', 'src/app.js'),
      tool('read', 'src/app.js'), tool('grep', 'src/app.js'), tool('edit', 'src/app.js')
    ];
    const [sequence] = mineSequences(steps);
    const candidate = proposeCandidate(sequence, {
      toolSteps: steps.slice(0, 3),
      postconditions: ['目标文件包含修复后的实现', '验收测试退出码为 0']
    });
    assert.ok(candidate);
    assert.match(candidate.id, /^wf-[0-9a-f]{10}$/);
    assert.ok(candidate.prompt.length >= 80);
    assert.ok(candidate.prompt.includes('{{workspace}}'));
    for (const name of sequence.tools) assert.ok(candidate.prompt.includes(name), name);
    assert.equal(candidate.verification.postconditions.length, 2);
    assert.match(candidate.evidence, /read/);
    assert.match(candidate.evidence, /重复出现 2 次/);

    const store = new SkillEvolutionStore({ filePath: dir.file });
    const result = store.record(candidate, { verified: true, toolCallCount: 4, runId: 'r1' });
    assert.equal(result.ok, true);
    assert.equal(result.candidate.id, candidate.id);
    assert.equal(result.candidate.prompt, candidate.prompt);
  } finally {
    dir.cleanup();
  }
});

test('rejects short or dangerous sequences', () => {
  assert.equal(proposeCandidate({ tools: ['read', 'edit'] }), null);
  assert.equal(proposeCandidate({ tools: ['read', 'edit', 'rm -rf /'] }), null);
  assert.equal(proposeCandidate({ tools: ['read', 'shell', 'write'] }, { toolSteps: [{ tool: 'shell', command: 'format c:' }] }), null);
  assert.equal(proposeCandidate(
    { tools: ['read', 'configure', 'write'] },
    { toolSteps: [{ tool: 'configure', command: 'api_key=abcdef123456' }] }
  ), null);
});

test('candidate id is deterministic for the same tool chain', () => {
  const tools = ['read', 'grep', 'edit'];
  const first = proposeCandidate({ tools, occurrences: 2 });
  const second = proposeCandidate({ tools: [...tools], occurrences: 7, exampleIndexes: [4, 9] });
  assert.ok(first && second);
  assert.equal(first.id, second.id);
  const reordered = proposeCandidate({ tools: ['edit', 'grep', 'read'] });
  assert.notEqual(reordered.id, first.id);
});

test('flags candidates without postconditions as structured drafts', () => {
  const candidate = proposeCandidate({ tools: ['read', 'grep', 'edit'], occurrences: 3, exampleIndexes: [1, 5, 9] });
  assert.ok(candidate);
  assert.deepEqual(candidate.verification.postconditions, []);
  assert.ok(candidate.verification.preconditions.length > 0);
  assert.ok(candidate.evidence.includes('无后置条件'));
  assert.ok(candidate.evidence.includes('仅结构化候选'));
  assert.ok(candidate.evidence.includes('read -> grep -> edit'));
});

test('prompt honors a raised minPromptChars floor and lists every tool', () => {
  const candidate = proposeCandidate({ tools: ['a-tool', 'b-tool', 'c-tool'] }, { minPromptChars: 600 });
  assert.ok(candidate);
  assert.ok(candidate.prompt.length >= 600);
  for (const name of ['a-tool', 'b-tool', 'c-tool']) assert.ok(candidate.prompt.includes(name), name);
});
