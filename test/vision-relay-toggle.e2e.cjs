'use strict';

// Exercise the real renderer functions through Chromium's HTML parser. The
// persistence fixture isolates this UI regression from accounts and model APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-relay-toggle-'));
const renderer = fs.readFileSync(path.join(root, 'renderer/renderer.js'), 'utf8');
const source = renderer.slice(renderer.indexOf('let visionRelayCandidateCache = []'),
  renderer.indexOf('const VISION_RELAY_GUIDES ='));

(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    const result = await page.evaluate(async source => {
      const list = document.createElement('div');
      const candidates = [
        { providerId: 'conn-a', supplierId: 'official', modelId: 'vision-a' },
        { providerId: 'conn-b', supplierId: 'official', modelId: 'vision-"<&-b' }
      ];
      let saved = [];
      let writes = 0;
      const api = {
        getVisionRelayStatus: async () => ({ candidates: candidates.map(candidate => ({
          ...candidate, enabled: saved.some(item => JSON.stringify(item) === JSON.stringify(candidate))
        })) }),
        setConfig: async partial => {
          saved = JSON.parse(JSON.stringify(partial.api.visionRelayModels));
          writes++;
          return { api: { visionRelayModels: saved } };
        }
      };
      const escape = value => String(value).replace(/[&<>"']/g, char =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
      const ui = new Function('$', 'api', 'state', 'escapeHtml', 'escapeAttr', 'toast', 'describeRunError',
        source + '\nreturn { render: renderVisionRelaySettings, toggle: applyVisionRelayModelToggle };')(
        () => list, api, {}, escape, escape, message => { throw new Error(message); }, String);
      await ui.render();
      const toggle = async (index, checked) => {
        const input = list.querySelectorAll('input')[index];
        input.checked = checked;
        await ui.toggle(input);
      };
      await toggle(0, true);
      await toggle(1, true);
      const bothSaved = saved.length;
      list.innerHTML = ''; // Leave the settings page, then rebuild from storage.
      await ui.render();
      const reopened = [...list.querySelectorAll('input')].map(input => input.checked);
      await toggle(0, false);
      list.innerHTML = '';
      await ui.render();
      return { bothSaved, reopened, writes,
        afterDisable: [...list.querySelectorAll('input')].map(input => input.checked), saved };
    }, source);
    assert.equal(result.bothSaved, 2);
    assert.deepEqual(result.reopened, [true, true]);
    assert.deepEqual(result.afterDisable, [false, true]);
    assert.equal(result.writes, 3);
    assert.equal(result.saved[0].modelId, 'vision-"<&-b');
    console.log('PASS: single/multiple relay selections persist through DOM rebuild; disabling preserves the other model.');
  } finally {
    if (app) await app.close();
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (error) { if (!['EPERM', 'EBUSY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
