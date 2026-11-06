'use strict';

// Offline desktop smoke. All writes go to an isolated temporary profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-desktop-smoke-'));

(async () => {
  let app;
  try {
    const env = { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(() => window.YanStartupHello?.skip());
    await page.locator('#yanStartupHello').waitFor({ state: 'detached' });

    const result = await page.evaluate(async () => {
      await newSession();
      showMainPage('chat');
      const user = appendMessage('user', 'Desktop smoke', [], false);
      const assistant = appendMessage('assistant', 'Reply rendered', [], false);
      openSettings('general');
      const settingsOpen = !document.querySelector('#settingsOverlay').classList.contains('hidden');
      closeSettings();
      return {
        user: user.textContent.includes('Desktop smoke'),
        assistant: assistant.textContent.includes('Reply rendered'),
        settingsOpen,
        settingsClosed: document.querySelector('#settingsOverlay').classList.contains('hidden'),
        sessionId: state.currentSession.id,
        sessions: (await api.listSessions()).map(session => session.id)
      };
    });
    assert.equal(result.user, true);
    assert.equal(result.assistant, true);
    assert.equal(result.settingsOpen, true);
    assert.equal(result.settingsClosed, true);
    assert.ok(result.sessions.includes(result.sessionId), 'created session is available through preload IPC');
    assert.deepEqual(errors, []);
    console.log('PASS isolated desktop startup, session IPC, chat rendering and settings navigation');
  } finally {
    await app?.close();
    // Validate the resolved target before recursively removing the owned profile.
    if (!profile.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('Unexpected profile path');
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
