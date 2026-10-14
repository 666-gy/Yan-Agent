'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { YanCore } = require('../lib/yan-core');

const appRoot = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-startup-recovery-notice-'));
const dataDir = path.join(userData, 'YanData');
const sessionsDir = path.join(dataDir, 'sessions');
fs.mkdirSync(sessionsDir, { recursive: true });

// Eight old, already aborted turns, half with deleted sessions. No provider
// journal is available, so startup has nothing new to restore or announce.
let now = Date.UTC(2026, 8, 11);
const core = new YanCore({ rootDir: path.join(dataDir, 'yan-core'), clock: () => now++ });
for (let index = 0; index < 8; index++) {
  const id = `sess_oldnotice000${index}`;
  const runId = `run-old-notice-${index}`;
  core.startTurn({ threadId: id, turnId: runId, workspace: '', intent: { prompt: '旧请求' } });
  if (index >= 4) {
    fs.writeFileSync(path.join(sessionsDir, `${id}.json`), JSON.stringify({
      id, title: '历史任务', workspace: '', createdAt: now, updatedAt: now,
      messages: [{ role: 'user', content: '旧请求', ts: now - 1 }]
    }));
  }
}
core.recoverInterruptedTurns();
for (let index = 0; index < 8; index++) core.completeTurn(`run-old-notice-${index}`, { status: 'interrupted', text: '' });
core.persist();

(async () => {
  let app;
  let stderr = '';
  try {
    // A second launch must also stay quiet without deleting recovery records.
    for (let launch = 0; launch < 2; launch++) {
      app = await electron.launch({
        executablePath: require('electron'), args: [appRoot], cwd: appRoot,
        env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData }
      });
      app.process().stderr?.on('data', chunk => { stderr += chunk.toString(); });
      const page = await app.firstWindow();
      await page.waitForFunction(() => window.__YAN_APP_READY__ === true);
      assert.equal(await page.evaluate(async () => (await listRecoveredYanCoreTurns()).length), 8);
      assert.doesNotMatch(await page.locator('#toast').textContent(), /任务被中断|已从运行日志恢复/);

      if (launch === 0) {
        await app.evaluate(() => {
          global.__e2eConsoleLines = [];
          const original = console.log;
          console.log = (...args) => { global.__e2eConsoleLines.push(args.join(' ')); original(...args); };
        });
        await page.evaluate(() => {
          console.debug('console-event-e2e-debug');
          console.info('console-event-e2e-info');
          console.warn('console-event-e2e-warning');
          console.error('console-event-e2e-error');
        });
        let forwarded = [];
        for (let attempt = 0; attempt < 100; attempt++) {
          forwarded = await app.evaluate(() => global.__e2eConsoleLines.filter(line => line.includes('console-event-e2e-')));
          if (forwarded.length === 4) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(forwarded.length, 4);
        for (const [level, tag] of [['debug', 'DEBUG'], ['info', 'LOG'], ['warning', 'WARN'], ['error', 'ERROR']]) {
          const line = forwarded.find(item => item.includes(`console-event-e2e-${level}`));
          assert.ok(line.startsWith(`[renderer ${tag}]`), line);
          assert.match(line, /:\d+\)$/);
          assert.doesNotMatch(line, /undefined/);
        }
      }
      const child = app.process();
      const stopped = child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
      await app.close(); await stopped; app = null;
    }
    assert.doesNotMatch(stderr, /console-message.*deprecated/i);
    console.log('PASS: old recovery candidates stay quiet across two launches; four console levels forward correctly without deprecated arguments.');
  } finally {
    if (app) {
      const child = app.process();
      const stopped = child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
      await app.close().catch(() => {}); await stopped;
    }
    assert.equal(path.dirname(userData), path.resolve(os.tmpdir()));
    await fs.promises.rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
