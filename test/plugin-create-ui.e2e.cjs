'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugin-create-ui-'));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanCapabilityExamples);
    await page.evaluate(() => window.YanStartupHello?.skip());
    await page.locator('#yanStartupHello').waitFor({ state: 'detached' });
    await page.evaluate(async () => {
      await newSession({ forceNew: true });
      setComposerText('保留原任务草稿'); captureComposerDraftForSession();
      window.__pluginSource = state.currentSession.id;
      window.__pluginSends = 0; sendMessage = async () => { window.__pluginSends++; };
      switchSidebarNav('plugins'); await window.YanPluginsPage.show();
    });
    assert.equal(await page.locator('#pluginImportBtn').textContent(), '+');
    assert.equal(await page.locator('#pluginImportBtn').evaluate(el => getComputedStyle(el).borderRadius), '50%');
    assert.equal(await page.locator('#pluginMarketDialog').count(), 0);
    assert.ok(await page.locator('[data-plugin-action="install"]').count() > 0);
    await page.locator('#pluginImportBtn').click();
    await page.waitForFunction(() => state.currentSession.id !== window.__pluginSource && getComposerText() === 'Create a new plugin：');
    const created = await page.evaluate(() => ({ skills: state.selectedSkills.map(s => s.id), sends: window.__pluginSends, messages: state.currentSession.messages.length }));
    assert.deepEqual(created, { skills: ['plugin-creator'], sends: 0, messages: 0 });
    await page.evaluate(() => loadSession(window.__pluginSource));
    assert.equal(await page.evaluate(() => getComposerText()), '保留原任务草稿');
    const exposed = await page.evaluate(() => ['pluginsAddMarketplace', 'pluginsMarkets', 'pluginsRemoveMarketplace', 'pluginsInstallCatalog'].filter(key => typeof window.yan[key] === 'function'));
    assert.deepEqual(exposed, ['pluginsInstallCatalog']);
    const output = path.join(root, 'output', 'playwright', 'plugin-create'); fs.mkdirSync(output, { recursive: true });
    await page.evaluate(async () => { switchSidebarNav('plugins'); await window.YanPluginsPage.show(); });
    await page.screenshot({ path: path.join(output, 'plugin-page.png') });
    console.log('Plugin creation UI: new task, skill selection, exact draft, no send, draft preservation and disabled install verified.');
  } finally {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
