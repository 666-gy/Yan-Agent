'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { _electron: electron } = require('playwright');

test('text/status observation preserves refs and combined focus/press reaches the target', { timeout: 45000 }, async t => {
  const appRoot = path.resolve(__dirname, '..');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-observe-e2e-'));
  const app = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
    env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: data } });
  t.after(async () => { await app.close(); fs.rmSync(data, { recursive: true, force: true }); });
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof executeBrowserAgentCommand === 'function' && state.currentSession);
  const command = (action, params = {}) => page.evaluate(({ action, params }) => executeBrowserAgentCommand({ action, params: { ...params, yan_run_id: 'observe-test' } }), { action, params });
  const opened = await command('open', { target_type: 'file', url_or_path: pathToFileURL(path.join(appRoot, 'test/fixtures/browser-agent.html')).href });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const snapshot = await command('snapshot');
  const ref = snapshot.items.find(item => item.name.includes('Name'))?.ref;
  assert.ok(ref, JSON.stringify(snapshot));
  assert.equal((await command('read_page')).ok, true);
  assert.equal((await command('status')).ok, true);
  const focus = await command('focus', { ref });
  assert.equal(focus.ok, true, JSON.stringify(focus));
  const pressed = await command('press', { ref, key: 'ArrowRight' });
  assert.equal(pressed.ok, true, JSON.stringify(pressed));
  assert.equal(await page.evaluate(id => browserTabControllers.get(id).webview.executeJavaScript('document.activeElement.id'), opened.tabId), 'nameInput');
  const filled = await command('type', { ref, text: 'preserved ref' });
  assert.equal(filled.pageState.target.value, 'preserved ref');
  await command('snapshot');
  const stale = await command('press', { ref, key: 'Enter' });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'STALE_REF');
  await command('release');
});
