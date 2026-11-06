'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');

test('shell model output preserves head, tail, Unicode and recoverable captured data within both budgets', async t => {
  const { boundShellResult, SHELL_OUTPUT_BYTES, SHELL_OUTPUT_LINES } = await import('../lib/kernel-v2/plugin/shell-output.js');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yan-output-budget-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const text of ['HEAD\n' + '界🙂'.repeat(50000) + '\nTAIL', 'HEAD\n' + 'line\n'.repeat(3000) + 'TAIL']) {
    const result = await boundShellResult({ content: text, metadata: { truncated: false, exit: 7 } }, { directory, sessionID: 'a' });
    assert.ok(Buffer.byteLength(result.content) <= SHELL_OUTPUT_BYTES);
    assert.ok(result.content.split('\n').length <= SHELL_OUTPUT_LINES);
    assert.match(result.content, /^HEAD/); assert.match(result.content, /TAIL$/);
    assert.doesNotMatch(result.content, /\uFFFD/);
    assert.equal(result.metadata.exit, 7); assert.equal(result.metadata.truncated, true);
    assert.equal(result.metadata.captureTruncated, false);
    assert.equal(await fs.readFile(result.metadata.outputPath, 'utf8'), text);
    const repeated = await boundShellResult({ content: text }, { directory, sessionID: 'a' });
    assert.equal(repeated.metadata.outputPath, result.metadata.outputPath);
    const other = await boundShellResult({ content: text }, { directory, sessionID: 'b' });
    assert.notEqual(other.metadata.outputPath, result.metadata.outputPath);
  }
  const captured = await boundShellResult({ content: 'x'.repeat(100000), metadata: { truncated: true } }, { directory });
  assert.match(captured.content, /not the complete command output/);
  assert.equal(captured.metadata.captureTruncated, true);
  const small = await boundShellResult({ content: 'ok', metadata: { truncated: false, exit: 0 } }, { directory });
  assert.equal(small.content, 'ok'); assert.equal(small.metadata.outputPath, undefined);
  const invalidDirectory = path.join(directory, 'not-a-directory');
  await fs.writeFile(invalidDirectory, 'file');
  const failed = await boundShellResult({ content: 'x'.repeat(100000) }, { directory: invalidDirectory });
  assert.ok(Buffer.byteLength(failed.content) <= SHELL_OUTPUT_BYTES);
  assert.match(failed.content, /Could not save captured output/);
  assert.equal(failed.metadata.outputPath, undefined);
});
