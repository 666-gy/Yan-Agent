'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readProjectInstructions } = require('../lib/project-instructions');
const { resolveModelContextSettings } = require('../lib/context-settings');
const { classifyCommand, summarizeVerification } = require('../lib/verification-state');
const { fileRevision } = require('../lib/verification-state');
const { projectEnvironment } = require('../lib/project-environment');
const { buildRepoMapBackground } = require('../lib/analysis/repo-map-background');
function repo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-environment-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'ROOT_RULE');
  fs.writeFileSync(path.join(root, 'YAN.md'), 'YAN_OVERRIDE');
  fs.writeFileSync(path.join(root, 'src', 'AGENTS.md'), 'SOURCE_RULE');
  return root;
}
test('project rules resolve directory order and refresh edits/deletes without crossing workspace', t => {
  const root = repo(t);
  const target = path.join(root, 'src', 'new.js');
  assert.deepEqual(readProjectInstructions(root, target).map(record => record.text), ['ROOT_RULE', 'YAN_OVERRIDE', 'SOURCE_RULE']);
  fs.writeFileSync(path.join(root, 'src', 'AGENTS.md'), 'CHANGED');
  assert.equal(readProjectInstructions(root, target).at(-1).text, 'CHANGED');
  fs.unlinkSync(path.join(root, 'src', 'AGENTS.md'));
  assert.equal(readProjectInstructions(root, target).length, 2);
  assert.throws(() => readProjectInstructions(root, path.join(root, '..', 'outside')));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'x'.repeat(30000));
  assert.equal(readProjectInstructions(root)[0].truncated, true);
});
test('manual model window and threshold remain authoritative', () => {
  assert.deepEqual(resolveModelContextSettings({ contextWindow: 300000, compactionThreshold: 220000,
    capabilities: { contextWindow: 200000 } }), { maxTokens: 300000, compactionThreshold: 220000, source: 'manual' });
  assert.equal(resolveModelContextSettings({ capabilities: { contextWindow: 200000 } }).maxTokens, 200000);
  assert.equal(resolveModelContextSettings({}).maxTokens, 128000);
});
test('checks reject version probes, failures, unknown exits, and stale results', () => {
  assert.equal(classifyCommand('node --version'), 'environment');
  assert.equal(classifyCommand('echo npm test'), 'unknown');
  assert.equal(classifyCommand('npm test || true'), 'unknown');
  const tool = (name, command, exit, status = 'completed') => ({ parts: [{ type: 'tool', tool: name,
    state: { status, input: { command }, metadata: { exit }, output: '' } }] });
  assert.equal(summarizeVerification([tool('bash', 'npm test', 1)]).status, 'failed');
  assert.equal(summarizeVerification([tool('bash', 'npm test', undefined)]).status, 'unknown');
  const pass = tool('bash', 'npm test', 0);
  assert.equal(summarizeVerification([pass]).hasCurrentPass, true);
  assert.equal(summarizeVerification([pass, tool('edit')]).status, 'stale');
  assert.equal(summarizeVerification([tool('bash', 'npm test', 1), tool('bash', 'npm run lint', 0)]).hasCurrentPass, false);
  assert.equal(summarizeVerification([tool('bash', 'npm test', 1), pass]).hasCurrentPass, true);
});

test('file receipts invalidate a check after an external modification', t => {
  const root = repo(t);
  const file = path.join(root, 'src', 'a.js');
  fs.writeFileSync(file, 'const x = 1;');
  const messages = [{ parts: [{ type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'node --check src/a.js' },
    metadata: { exit: 0, yanVerification: { files: { [file]: fileRevision(file) } } } } }] }];
  assert.equal(summarizeVerification(messages, { workspace: root }).status, 'passed');
  fs.writeFileSync(file, 'const x = ;');
  assert.equal(summarizeVerification(messages, { workspace: root }).status, 'stale');
});

test('package context stays scoped and background maps can be cancelled', async t => {
  const root = repo(t);
  fs.writeFileSync(path.join(root, 'src', 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const context = projectEnvironment(root, path.join(root, 'src', 'a.js'));
  assert.equal(context.packages[0].checks[0].command, 'node --test');
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'function hello() {}');
  assert.match(await buildRepoMapBackground(root), /a\.js/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(buildRepoMapBackground(root, { signal: controller.signal }), /cancelled/);
  await assert.rejects(buildRepoMapBackground(root, { timeoutMs: 1 }), /timed out/);
});
test('kernel hooks load rules for parent and child and block a first scoped edit before mutation', async t => {
  const root = repo(t);
  const factory = (await import(pathToFileURL(path.resolve('lib/coding-environment-plugin.mjs')))).default;
  const plugin = await factory({ directory: root, client: { session: { get: async () => ({ data: { id: 'session', permission: [{ permission: 'read', pattern: '*', action: 'allow' }] } }) } } });
  for (const sessionID of ['parent', 'child']) {
    const output = { system: [] };
    await plugin['experimental.chat.system.transform']({ sessionID }, output);
    assert.match(output.system.join('\n'), /ROOT_RULE/);
    assert.doesNotMatch(output.system.join('\n'), /SOURCE_RULE/);
    const input = { sessionID, tool: 'edit' };
    const args = { args: { filePath: path.join(root, 'src', 'new.js') } };
    await assert.rejects(plugin['tool.execute.before'](input, args), /SOURCE_RULE/);
    await plugin['tool.execute.before'](input, args);
    fs.writeFileSync(path.join(root, 'src', 'AGENTS.md'), 'SOURCE_RULE_UPDATED');
    await assert.rejects(plugin['tool.execute.before'](input, args), /SOURCE_RULE_UPDATED/);
    fs.writeFileSync(path.join(root, 'src', 'AGENTS.md'), 'SOURCE_RULE');
  }
});
test('read-denied sessions receive no project text', async t => {
  const root = repo(t);
  const factory = (await import(pathToFileURL(path.resolve('lib/coding-environment-plugin.mjs')))).default;
  const plugin = await factory({ directory: root, client: { session: { get: async () => ({ data: { id: 'session', permission: [{ permission: 'read', pattern: '*', action: 'deny' }] } }) } } });
  const output = { system: [] };
  await plugin['experimental.chat.system.transform']({ sessionID: 'denied' }, output);
  assert.deepEqual(output.system, []);
});
