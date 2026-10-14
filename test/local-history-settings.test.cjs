'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createLocalHistorySettings, HISTORY_AGE_MS } = require('../lib/main/local-history-settings');

function fixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-compression-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let config = { general: {} };
  let login = false;
  const service = createLocalHistorySettings({
    sessionsDir: dir, platform: 'win32',
    configStore: { loadConfig: () => config, saveConfig: value => { config = value; } },
    app: { isPackaged: true, getLoginItemSettings: () => ({ openAtLogin: login, executableWillLaunchAtLogin: login }),
      setLoginItemSettings: value => { login = value.openAtLogin; } },
    shell: { openExternal: async () => {} }, isSessionRunActive: id => id === 'sess_running', ...overrides
  });
  function seed(name, old = true) {
    const file = path.join(dir, name);
    const content = JSON.stringify({ id: name.slice(0, -5), messages: [{ role: 'assistant', content: '历史记录原样保留。'.repeat(10000) }] });
    fs.writeFileSync(file, content);
    if (old) { const date = new Date(Date.now() - HISTORY_AGE_MS - 10000); fs.utimesSync(file, date, date); }
    return { file, content };
  }
  return { service, seed, config: () => config };
}

test('only old, inactive session JSON is compressed; preference persists and disable stops sweeps', async t => {
  const calls = [];
  const f = fixture(t, { run: async (...args) => { calls.push(args); } });
  f.seed('sess_older.json'); f.seed('sess_newer.json', false); f.seed('sess_running.json'); f.seed('config.json');
  f.service.update('compressLocalHistory', true);
  await f.service.sweep();
  assert.equal(calls.length, 1);
  assert.match(calls[0][1][2], /sess_older.json$/);
  assert.equal(f.config().general.compressLocalHistory, true);
  f.service.update('compressLocalHistory', false);
  await f.service.sweep(); assert.equal(calls.length, 1);
  assert.equal(f.service.update('launchAtLogin', true).launchAtLogin, true);
  assert.equal(f.service.update('launchAtLogin', false).launchAtLogin, false);
});

test('compression failures remain visible and preserve original data', async t => {
  const f = fixture(t, { run: async () => { throw new Error('filesystem does not support compression'); } });
  const original = f.seed('sess_older.json');
  f.service.update('compressLocalHistory', true); await f.service.sweep();
  assert.match(f.service.status().compression.error, /does not support/);
  assert.equal(fs.readFileSync(original.file, 'utf8'), original.content);
  assert.equal(f.service.status().compression.running, false);
});

test('real Windows compression preserves bytes and subsequent JSON writes', { skip: process.platform !== 'win32' }, async t => {
  const f = fixture(t);
  const original = f.seed('sess_older.json');
  const fresh = f.seed('sess_newer.json', false);
  f.service.update('compressLocalHistory', true); await f.service.sweep();
  assert.equal(f.service.status().compression.error, '');
  const compressed = file => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `((Get-Item -LiteralPath '${file.replace(/'/g, "''")}').Attributes -band [IO.FileAttributes]::Compressed) -ne 0`], { encoding: 'utf8', windowsHide: true }).trim();
  assert.equal(compressed(original.file), 'True');
  assert.equal(compressed(fresh.file), 'False');
  assert.equal(fs.readFileSync(original.file, 'utf8'), original.content);
  const record = JSON.parse(fs.readFileSync(original.file, 'utf8'));
  record.messages.push({ role: 'user', content: '继续聊天' });
  fs.writeFileSync(original.file, JSON.stringify(record));
  assert.deepEqual(JSON.parse(fs.readFileSync(original.file, 'utf8')), record);
});
