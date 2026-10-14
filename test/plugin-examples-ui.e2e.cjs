'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { createPluginStore } = require('../lib/plugins/store');
const { createPluginCatalog } = require('../lib/plugins/catalog');
const appRoot = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugin-examples-'));
const workspace = path.join(userData, 'example-workspace'); fs.mkdirSync(workspace);
const store = createPluginStore(path.join(userData, 'YanData')); createPluginCatalog(store).install('remotion');
const evidence = path.join(appRoot, 'output/playwright/plugin-examples'); fs.mkdirSync(evidence, { recursive: true });
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot, env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanPluginExamples);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(async folder => {
      const session = await window.yan.createSession(true, folder); await loadSession(session.id); await refreshSessions();
      setComposerText('保留这份原任务草稿'); captureComposerDraftForSession();
      window.__exampleSourceId = session.id;
      window.__exampleSendAttempts = 0;
      sendMessage = async () => { window.__exampleSendAttempts++; };
    }, workspace);
    const catalog = (await page.evaluate(() => window.yan.pluginsCatalog())).plugins;
    assert.deepEqual(catalog.map(item => item.id).sort(), ['build-ios-apps', 'build-macos-apps', 'canva', 'circleci', 'figma', 'game-studio', 'hyperframes', 'remotion']);
    async function open(id) {
      await page.locator('[data-nav="plugins"]').click();
      await page.evaluate(() => window.YanPluginsPage.show());
      const close = page.locator('#pluginDetailContent [data-plugin-action="back"]');
      if (await close.isVisible()) await close.click();
      await page.locator(`[data-plugin-open="${id}"]`).click();
    }
    await open('remotion');
    const panel = page.locator('.plugin-examples');
    assert.equal(await panel.evaluate(el => getComputedStyle(el).backgroundPosition), '50% 50%');
    assert.equal(await panel.evaluate(async el => {
      const image = new Image(); image.src = getComputedStyle(el).backgroundImage.slice(5, -2); await image.decode();
      return image.naturalWidth === 1800 && image.naturalHeight === 640;
    }), true);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await panel.screenshot({ path: path.join(evidence, `remotion-${theme}.png`), animations: 'disabled' });
    }
    let checkedExamples = 0;
    for (const plugin of catalog) {
      await open(plugin.id);
      const prompts = await page.locator('.plugin-example-prompt').allTextContents();
      assert.ok(prompts.length >= 1 && prompts.length <= 3, plugin.id);
      assert.equal(new Set(prompts).size, prompts.length);
      for (let index = 0; index < prompts.length; index++) {
        if (index) await open(plugin.id);
        const before = await page.evaluate(() => ({ id: state.currentSession.id, draft: getComposerText(), count: state.sessions.length }));
        const expected = prompts[index];
        const button = page.locator(`[data-plugin-action="example"][data-example-index="${index}"]`);
        if (checkedExamples === 0) await button.evaluate(node => { node.click(); node.click(); });
        else if (checkedExamples === 1) { await button.focus(); await page.keyboard.press('Enter'); }
        else await button.click();
        await page.waitForFunction(({ previousId, expected }) => state.currentSession.id !== previousId && getComposerText() === expected && document.getElementById('pagePluginPackages').getAttribute('aria-busy') === 'false', { previousId: before.id, expected });
        const after = await page.evaluate(previousId => ({
          id: state.currentSession.id, workspace: state.currentSession.workspace, count: state.sessions.length,
          messages: state.currentSession.messages, runs: state.activeRuns.size, sends: window.__exampleSendAttempts,
          draft: state.composerDrafts.get(state.currentSession.id)?.text,
          plugins: state.composerDrafts.get(state.currentSession.id)?.plugins,
          tokens: [...input.querySelectorAll('[data-composer-plugin-id]')].map(el => ({ id: el.dataset.composerPluginId, name: el.dataset.composerPluginName, logo: el.querySelector('img')?.getAttribute('src') })),
          oldDraft: state.composerDrafts.get(previousId)?.text,
          focused: document.activeElement === input, chatVisible: !document.getElementById('pageChat').classList.contains('hidden')
        }), before.id);
        assert.equal(after.workspace, workspace); assert.equal(after.count, before.count + 1);
        assert.equal(after.draft, expected); assert.equal(after.oldDraft, before.draft);
        assert.equal(after.plugins.length, 1); assert.equal(after.plugins[0].id, plugin.id);
        assert.equal(after.tokens.length, 1); assert.equal(after.tokens[0].id, plugin.id);
        assert.equal(after.tokens[0].name, plugin.name); assert.equal(after.tokens[0].logo, plugin.logo);
        assert.equal(after.sends, 0); assert.equal(after.runs, 0); assert.equal(after.messages.length, 0);
        assert.equal(after.focused, true); assert.equal(after.chatVisible, true);
        assert.equal((await page.evaluate(id => window.yan.getSession(id), after.id)).messages.length, 0);
        checkedExamples++;
      }
    }
    assert.equal(store.get('remotion').enabled, false, 'prefilling does not silently enable a plugin');
    await page.evaluate(async () => { await loadSession(window.__exampleSourceId); });
    assert.equal(await page.evaluate(() => getComposerText()), '保留这份原任务草稿');
    // An unassigned task remains unassigned, even when recent projects exist.
    await page.evaluate(async () => { await newSession({ standalone: true, forceNew: true }); });
    await open('remotion');
    await page.locator('[data-plugin-action="example"]').first().click();
    await page.waitForFunction(() => getComposerText().includes('5 根柱子'));
    assert.equal(await page.evaluate(() => state.currentSession.workspace), '');
    const exampleSession = await page.evaluate(() => state.currentSession.id);
    await page.evaluate(async id => { await loadSession(window.__exampleSourceId); await loadSession(id); }, exampleSession);
    assert.equal(await page.locator('#composerInput [data-composer-plugin-id="remotion"]').count(), 1);
    // Failed task creation must not overwrite the current draft or send it.
    await open('remotion');
    const prior = await page.evaluate(() => ({ id: state.currentSession.id, text: getComposerText() }));
    await app.evaluate(({ ipcMain }) => {
      global.__exampleCreate = ipcMain._invokeHandlers.get('session:create');
      ipcMain.removeHandler('session:create'); ipcMain.handle('session:create', () => null);
    });
    await page.locator('[data-plugin-action="example"]').last().click();
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('未能创建新任务'));
    assert.deepEqual(await page.evaluate(() => ({ id: state.currentSession.id, text: getComposerText() })), prior);
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('session:create'); ipcMain.handle('session:create', global.__exampleCreate); });
    await open('build-macos-apps');
    await page.locator('#sidebarToggle').click();
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await panel.evaluate(el => el.scrollWidth > el.clientWidth), false, `panel overflow at ${width}`);
      assert.equal(await page.locator('#pluginDetailContent').evaluate(el => el.scrollWidth > el.clientWidth), false);
      await panel.screenshot({ path: path.join(evidence, `macos-${width}.png`), animations: 'disabled' });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: ${catalog.length} plugins / ${checkedExamples} examples; current workspace, one fresh task per click, preserved drafts, keyboard action, no send, disabled plugin unchanged, creation failure, centered wallpaper, themes and narrow layouts.`);
  } finally {
    const child = app?.process(), stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    await app?.close().catch(() => {}); await stopped;
    assert.equal(path.dirname(userData), path.resolve(os.tmpdir())); await fs.promises.rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
