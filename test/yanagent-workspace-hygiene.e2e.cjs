'use strict';

// Real-app acceptance for workspace hygiene: selecting a workspace must create
// a self-ignoring .yanagent folder (git-invisible, with scratch/) and keep the
// project tree clean.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-hygiene-e2e-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-hygiene-ws-'));

function gitStatus() {
  return execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8', windowsHide: true });
}

(async () => {
  let application;
  try {
    execFileSync('git', ['init', '-q'], { cwd: workspace, windowsHide: true });
    fs.writeFileSync(path.join(workspace, 'app.js'), 'const value = 1;\n', 'utf8');

    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof appendMessage === 'function' && !!state.currentSession);

    await page.evaluate(async target => {
      await api.setSessionWorkspace(state.currentSession.id, target, false);
    }, workspace);

    const yanagent = path.join(workspace, '.yanagent');
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (fs.existsSync(path.join(yanagent, '.gitignore'))) break;
      await new Promise(resolve => setTimeout(resolve, 120));
    }

    assert.equal(fs.existsSync(path.join(yanagent, '.gitignore')), true, '.yanagent/.gitignore must exist');
    assert.equal(fs.readFileSync(path.join(yanagent, '.gitignore'), 'utf8').trim(), '*');
    assert.equal(fs.existsSync(path.join(yanagent, 'README.txt')), true);
    for (const sub of ['logs', 'snapshots', 'scratch']) {
      assert.equal(fs.existsSync(path.join(yanagent, sub)), true, `.yanagent/${sub} must exist`);
    }

    const status = gitStatus();
    assert.equal(status.includes('.yanagent'), false, `git status leaked .yanagent: ${status}`);
    assert.equal(status.includes('app.js'), true, 'project files must stay visible');

    const leftovers = fs.readdirSync(workspace).filter(name => (
      name !== '.git' && name !== '.yanagent' && name !== 'app.js'
    ));
    assert.deepEqual(leftovers, [], `workspace must not gain stray entries: ${leftovers.join(', ')}`);
    assert.deepEqual(errors, []);

    console.log(JSON.stringify({ ok: true, workspace, yanagentEntries: fs.readdirSync(yanagent), gitStatus: status.trim() }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
