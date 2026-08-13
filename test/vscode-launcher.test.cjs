'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const {
  buildExternalAppEnv,
  buildVsCodeLaunchArgs,
  detectVsCode,
  getVsCodeCandidates,
  launchVsCode,
  normalizeVsCodeCliCandidate,
} = require('../lib/vscode-launcher');

function fakeFs(files = [], directories = []) {
  const fileSet = new Set(files);
  const directorySet = new Set(directories);
  return {
    statSync(candidate) {
      if (!fileSet.has(candidate) && !directorySet.has(candidate)) throw new Error('ENOENT');
      return {
        isFile: () => fileSet.has(candidate),
        isDirectory: () => directorySet.has(candidate),
      };
    },
  };
}

test('detects VS Code in a standard Windows installation', async () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\Yan\\AppData\\Local' };
  const [candidate] = getVsCodeCandidates(env, 'win32');
  const status = await detectVsCode({
    platform: 'win32',
    env,
    fsImpl: fakeFs([candidate]),
    cliPaths: [],
  });
  assert.deepEqual(status, { available: true, executable: candidate, source: 'install' });
});

test('converts a PATH bin/code.cmd entry to the sibling Code.exe', async () => {
  const cli = 'D:\\Apps\\Microsoft VS Code\\bin\\code.cmd';
  const executable = 'D:\\Apps\\Microsoft VS Code\\Code.exe';
  assert.deepEqual(normalizeVsCodeCliCandidate(cli, 'win32'), [executable]);
  const status = await detectVsCode({
    platform: 'win32',
    candidates: [],
    cliPaths: [cli],
    fsImpl: fakeFs([executable]),
  });
  assert.deepEqual(status, { available: true, executable, source: 'path' });
});

test('returns unavailable when no candidate exists', async () => {
  const status = await detectVsCode({
    platform: 'win32',
    candidates: ['C:\\missing\\Code.exe'],
    cliPaths: ['C:\\missing\\bin\\code.cmd'],
    fsImpl: fakeFs(),
  });
  assert.deepEqual(status, { available: false, executable: '', source: '' });
});

test('rejects an invalid workspace before launching', async () => {
  const result = await launchVsCode('C:\\missing-workspace', { fsImpl: fakeFs() });
  assert.match(result.error, /工作区路径无效/);
});

test('removes Electron-only variables before launching VS Code', () => {
  const env = buildExternalAppEnv({
    PATH: 'test-path',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
  });
  assert.deepEqual(env, { PATH: 'test-path' });
});

test('launches a new VS Code window with the resolved workspace', async () => {
  const workspace = path.resolve('C:\\workspace');
  const executable = 'D:\\Apps\\Microsoft VS Code\\Code.exe';
  let invocation;
  const spawnImpl = (exe, args, options) => {
    invocation = { exe, args, options };
    const child = new EventEmitter();
    child.pid = 42;
    child.unref = () => {};
    process.nextTick(() => child.emit('spawn'));
    return child;
  };
  const result = await launchVsCode(workspace, {
    fsImpl: fakeFs([], [workspace]),
    status: { available: true, executable },
    spawnImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(invocation.exe, executable);
  assert.deepEqual(invocation.args, buildVsCodeLaunchArgs(workspace));
  assert.deepEqual(invocation.args, ['--new-window', workspace]);
  assert.equal(invocation.options.detached, true);
  assert.equal(invocation.options.windowsHide, false);
});
