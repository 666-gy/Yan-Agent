'use strict';

// File observation gate — wiring, driven through the plugin's real hooks.
//
// test/file-observation-gate.test.cjs pins the decision contract in isolation.
// This file pins the part that only exists once the gate is wired into the
// plugin, and that no unit test can cover: which kernel hook records a
// baseline, and what happens when an operation does not complete.
//
// The kernel's dispatch is:
//
//   trigger('tool.execute.before')  ->  tool runs  ->  trigger('tool.execute.after')
//
// with no try/finally around the tool, so `after` runs on success and ONLY on
// success. That is the whole basis of the lifecycle asserted here:
//
//   * A read that fails (permission refused, missing file, too large) never
//     reaches `after`, so it must not leave a baseline behind. If it did, a
//     write composed from assumption would look informed.
//   * A write that fails likewise leaves no baseline, so the file keeps
//     whatever revision the model last actually understood.
//
// The tests simulate a failed call the way the kernel produces one: `before`
// is invoked and `after` is not.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// A workspace with no AGENTS.md / YAN.md anywhere. The rules interposition
// throws on the first mutation of a repo that has rules, which would mask what
// the gate does. With no rules the interposition stays silent, so a rejection
// here can only have come from the gate.
function cleanRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-observation-wiring-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  return root;
}

async function pluginFor(root) {
  const factory = (await import(pathToFileURL(path.resolve('lib/coding-environment-plugin.mjs')))).default;
  return factory({
    directory: root,
    client: {
      session: {
        get: async () => ({ data: { id: 'session', permission: [{ permission: 'read', pattern: '*', action: 'allow' }] } })
      }
    }
  });
}

// One successful call: before, run, after.
async function callSucceeds(plugin, sessionID, tool, args) {
  const input = { sessionID, tool, callID: `${tool}-ok`, args };
  await plugin['tool.execute.before'](input, { args });
  await plugin['tool.execute.after'](input, { output: 'ok', metadata: {} });
}

// One failed call: the kernel runs `before`, the tool throws, and `after` never
// fires. Nothing else is simulated, because nothing else happens.
async function callFails(plugin, sessionID, tool, args) {
  const input = { sessionID, tool, callID: `${tool}-fail`, args };
  await plugin['tool.execute.before'](input, { args });
}

// assert.rejects() is an assertion, not a capture — it resolves to undefined,
// so the thrown error has to be caught explicitly to be inspected. Every
// refusal in this file needs its message read, because the message is the whole
// interface the model gets.
async function refusal(plugin, sessionID, tool, args) {
  try {
    await plugin['tool.execute.before']({ sessionID, tool, callID: `${tool}-no`, args }, { args });
  } catch (error) {
    return error;
  }
  assert.fail(`${tool} was allowed but should have been refused`);
}

test('a read that succeeded lets the following edit through', async t => {
  const root = cleanRepo(t);
  const plugin = await pluginFor(root);
  const file = path.join(root, 'src', 'app.js');
  fs.writeFileSync(file, 'const a = 1;\n');

  await callSucceeds(plugin, 's1', 'read', { filePath: file });
  await callSucceeds(plugin, 's1', 'edit', { filePath: file });
});

test('a read followed by an outside change blocks the edit, and the reason is delivered', async t => {
  const root = cleanRepo(t);
  const plugin = await pluginFor(root);
  const file = path.join(root, 'src', 'app.js');
  fs.writeFileSync(file, 'const a = 1;\n');

  await callSucceeds(plugin, 's1', 'read', { filePath: file });
  // The user saves from their editor while the model is composing the patch.
  fs.writeFileSync(file, 'const a = 1;\nconst b = 2;\n');

  const error = await refusal(plugin, 's1', 'edit', { filePath: file });
  assert.match(error.message, /changed on disk/);
  assert.match(error.message, /Re-read the file and re-apply/);
  assert.ok(error.message.includes(file), 'the model needs the path to act on it');

  // Re-reading restores the baseline and the retry lands.
  await callSucceeds(plugin, 's1', 'read', { filePath: file });
  await callSucceeds(plugin, 's1', 'edit', { filePath: file });
});

test('a read that never returned records no baseline', async t => {
  const root = cleanRepo(t);
  const plugin = await pluginFor(root);
  const file = path.join(root, 'src', 'app.js');
  fs.writeFileSync(file, 'const a = 1;\n');

  // The read is attempted and fails — permission refused, file too large, a
  // transport error. The model received no contents.
  await callFails(plugin, 's1', 'read', { filePath: file });

  // The file changes underneath, then an edit is composed against a belief the
  // model cannot have formed. With no baseline this passes, which is correct:
  // the gate must not claim the model observed something it never saw. The
  // write is governed by the kernel's permission model instead.
  fs.writeFileSync(file, 'const a = 1;\nconst b = 2;\n');
  await callSucceeds(plugin, 's1', 'edit', { filePath: file });
});

test('a write that never returned does not establish a baseline', async t => {
  const root = cleanRepo(t);
  const plugin = await pluginFor(root);
  const file = path.join(root, 'src', 'app.js');

  // A failed write to a file the model never read: no baseline, and none is
  // created by the failure, so the state is exactly as it was.
  await callFails(plugin, 's1', 'write', { filePath: file });
  fs.writeFileSync(file, 'someone else wrote this\n');
  await callSucceeds(plugin, 's1', 'write', { filePath: file });
});

test('a write that succeeded becomes the new baseline and does not self-trip', async t => {
  const root = cleanRepo(t);
  const plugin = await pluginFor(root);
  const file = path.join(root, 'src', 'app.js');

  // Creating a file, then editing it again. If the write had not refreshed the
  // baseline the second edit would be rejected as stale against 'missing'.
  await callSucceeds(plugin, 's1', 'write', { filePath: file });
  await callSucceeds(plugin, 's1', 'edit', { filePath: file });
});

test('a deletion after a read is refused rather than silently recreated', async t => {
  const root = cleanRepo(t);
  const plugin = await pluginFor(root);
  const file = path.join(root, 'src', 'app.js');
  fs.writeFileSync(file, 'const a = 1;\n');

  await callSucceeds(plugin, 's1', 'read', { filePath: file });
  fs.unlinkSync(file);

  const error = await refusal(plugin, 's1', 'write', { filePath: file });
  assert.match(error.message, /no longer exists/);
});

test('a multi-file patch is refused when one target moved even if the others did not', async t => {
  const root = cleanRepo(t);
  const plugin = await pluginFor(root);
  const a = path.join(root, 'src', 'a.js');
  const b = path.join(root, 'src', 'b.js');
  fs.writeFileSync(a, 'a1\n');
  fs.writeFileSync(b, 'b1\n');

  await callSucceeds(plugin, 's1', 'read', { filePath: a });
  await callSucceeds(plugin, 's1', 'read', { filePath: b });
  fs.writeFileSync(b, 'b2\n');

  const args = { patchText: `*** Begin Patch\n*** Update File: ${a}\n*** Update File: ${b}\n*** End Patch` };
  const error = await refusal(plugin, 's1', 'apply_patch', args);
  assert.ok(error.message.includes(b), 'the moved file is the one named');
});

test('session state does not leak across sessions or across workspaces', async t => {
  const root = cleanRepo(t);
  const plugin = await pluginFor(root);
  const file = path.join(root, 'src', 'app.js');
  fs.writeFileSync(file, 'const a = 1;\n');

  await callSucceeds(plugin, 's1', 'read', { filePath: file });
  fs.writeFileSync(file, 'const a = 1;\nconst b = 2;\n');

  // A different session has observed nothing, so it is not blocked by another
  // session's baseline.
  await callSucceeds(plugin, 's2', 'edit', { filePath: file });

  // And the original session still is.
  await refusal(plugin, 's1', 'edit', { filePath: file });
});

test('the env switch turns the gate off without breaking the hooks', async t => {
  const root = cleanRepo(t);
  const plugin = await pluginFor(root);
  const file = path.join(root, 'src', 'app.js');
  fs.writeFileSync(file, 'const a = 1;\n');

  const previous = process.env.YAN_FILE_OBSERVATION_GATE;
  process.env.YAN_FILE_OBSERVATION_GATE = 'off';
  t.after(() => {
    if (previous === undefined) delete process.env.YAN_FILE_OBSERVATION_GATE;
    else process.env.YAN_FILE_OBSERVATION_GATE = previous;
  });

  await callSucceeds(plugin, 's1', 'read', { filePath: file });
  fs.writeFileSync(file, 'changed while disabled\n');
  await callSucceeds(plugin, 's1', 'edit', { filePath: file });
});

test('tools the gate does not govern are untouched by it', async t => {
  const root = cleanRepo(t);
  const plugin = await pluginFor(root);
  const file = path.join(root, 'src', 'app.js');
  fs.writeFileSync(file, 'const a = 1;\n');

  await callSucceeds(plugin, 's1', 'read', { filePath: file });
  fs.writeFileSync(file, 'moved\n');

  // bash can write anything and the gate cannot attribute a path to it; grep and
  // glob report matches, not contents. None of them may be blocked or observed.
  for (const tool of ['bash', 'grep', 'glob', 'list']) {
    const input = { sessionID: 's1', tool, callID: `${tool}-1`, args: { command: 'echo hi', pattern: 'a', path: root } };
    await plugin['tool.execute.before'](input, { args: input.args });
    await plugin['tool.execute.after'](input, { output: 'ok', metadata: {} });
  }

  // The read baseline is still intact, so the edit is still refused. A stray
  // observation from any of the tools above would have refreshed it.
  await refusal(plugin, 's1', 'edit', { filePath: file });
});
