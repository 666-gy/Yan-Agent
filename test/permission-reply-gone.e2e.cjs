'use strict';

// Regression: a permission reply whose run already settled must close the
// dialog instead of looping on "权限回复未送达". No model call is needed: the
// run id is deliberately unknown to the kernel pool.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'playwright', 'permission-gone');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-permission-gone-'));
const workspace = path.join(profile, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(path.join(profile, 'YanData'), { recursive: true });
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(path.join(process.env.APPDATA, 'yan-agent', 'Local State'), path.join(profile, 'Local State'));
const config = JSON.parse(fs.readFileSync(process.env.YAN_E2E_CONFIG_PATH
  || path.join(process.env.APPDATA, 'yan-agent', 'YanData', 'config.json'), 'utf8'));
config.workspace = workspace;
config.memory = { ...(config.memory || {}), enabled: false };
config.pet = { ...(config.pet || {}), enabled: false };
config.agent = { ...config.agent, accessMode: 'full', workMode: 'normal' };
fs.writeFileSync(path.join(profile, 'YanData', 'config.json'), JSON.stringify(config));

(async () => {
  const net = require('node:net');
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const log = fs.openSync(path.join(output, 'desktop.log'), 'w');
  const env = { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `npm start -- --remote-debugging-port=${port}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] });
  let browser;
  try {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
      if (child.exitCode !== null) throw new Error(`npm start exited ${child.exitCode}`);
      await delay(500);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    let page;
    for (let count = 0; count < 100; count++) {
      page = context.pages().find(p => p.url().includes('index.html'));
      if (page) break;
      await delay(100);
    }
    assert.ok(page, 'desktop window exists');
    await page.waitForFunction(() => window.__YAN_APP_READY__ && !!state.currentSession, { timeout: 60000 });
    await page.evaluate(async workspace => {
      const session = await window.yan.createSession(true, workspace);
      await loadSession(session.id);
      // A live sidecar makes the pool the source of the answer, not "kernel not running".
      await window.yan.openCodePrewarm({ workspace, yanSessionId: session.id });
    }, workspace);

    const direct = await page.evaluate(() => window.yan.openCodeReplyPermission({
      runId: 'run-that-never-existed', requestId: 'per_1', reply: 'once'
    }));
    fs.writeFileSync(path.join(output, 'reply.json'), JSON.stringify(direct, null, 2));
    assert.equal(direct.ok, false, JSON.stringify(direct));
    assert.equal(direct.code, 'RUN_GONE', JSON.stringify(direct));

    const outcome = await page.evaluate(async () => {
      const panel = document.querySelector('#agentPermissionPanel');
      const runCtx = {
        runId: 'run-that-never-existed',
        sessionId: state.currentSession.id,
        workspace: state.currentSession.workspace || '',
        accessMode: 'full',
        shouldAbort: false,
        coreSettled: false,
        openCodeHandledRequests: new Set(),
        agentState: { todos: [] },
        ui: false
      };
      await handleOpenCodePermission(runCtx, {
        type: 'permission.asked',
        properties: { id: 'per_2', action: 'tool', resources: [] }
      });
      const after = {
        hidden: panel.classList.contains('hidden'),
        text: document.body.innerText,
        title: document.querySelector('#agentPermissionTitle')?.textContent || ''
      };
      await new Promise(resolve => setTimeout(resolve, 1200));
      return {
        ...after,
        stillHidden: panel.classList.contains('hidden'),
        retryVisible: !!document.querySelector('#agentPermissionPanel:not(.hidden)'),
        afterText: document.body.innerText
      };
    });
    fs.writeFileSync(path.join(output, 'outcome.json'), JSON.stringify(outcome, null, 2));
    await page.screenshot({ path: path.join(output, 'permission-gone.png'), fullPage: true });

    assert.equal(outcome.hidden, true, 'dialog closes instead of re-asking');
    assert.equal(outcome.stillHidden, true, 'dialog stays closed');
    assert.equal(outcome.retryVisible, false, 'no retry dialog is raised');
    assert.match(outcome.afterText, /权限回复已丢弃/);
    assert.doesNotMatch(outcome.afterText, /权限回复未送达/);
    console.log(JSON.stringify({ status: 'passed', reply: direct, evidence: output }));
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
    fs.closeSync(log);
    fs.rmSync(path.join(profile, 'YanData', 'config.json'), { force: true });
    fs.rmSync(path.join(profile, 'Local State'), { force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
