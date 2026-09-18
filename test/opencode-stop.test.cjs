'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { stopChildProcess } = require('../lib/opencode-sidecar');

function spawnSleeper() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], {
    stdio: 'ignore',
    windowsHide: true
  });
}

test('stops a live child process and reports no diagnostics', async () => {
  const child = spawnSleeper();
  try {
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    const diagnostics = [];
    const stopped = await stopChildProcess(child, 5_000, diagnostics);
    assert.equal(stopped, true);
    assert.deepEqual(diagnostics, []);
    assert.notEqual(child.exitCode, null);
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

test('resolves immediately for an already exited child', async () => {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true });
  await new Promise(resolve => child.once('exit', resolve));
  const diagnostics = [];
  const stopped = await stopChildProcess(child, 1_000, diagnostics);
  assert.equal(stopped, true);
  assert.deepEqual(diagnostics, []);
});

test('returns false when the process never exits', async () => {
  const fake = {
    pid: null,
    exitCode: null,
    once() {},
    kill() {}
  };
  const diagnostics = [];
  const startedAt = Date.now();
  const stopped = await stopChildProcess(fake, 150, diagnostics);
  assert.equal(stopped, false);
  assert.ok(Date.now() - startedAt >= 280, 'retry window should elapse before giving up');
});
