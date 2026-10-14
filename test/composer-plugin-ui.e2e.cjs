'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { createPluginStore } = require('../lib/plugins/store');
const { createPluginCatalog } = require('../lib/plugins/catalog');
const { resolveSelectedPlugins, selectedPluginContext } = require('../lib/plugins/selection');
const appRoot = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugin-composer-'));
const dataDir = path.join(userData, 'YanData');
const store = createPluginStore(dataDir);
createPluginCatalog(store).install('remotion');
createPluginCatalog(store).install('hyperframes');
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanComposerPlugins);
    const input = page.locator('#composerInput');
    await page.locator('#attachBtn').click();
    assert.equal(await page.locator('#composerPluginAction').count(), 0);
    assert.equal(await page.locator('#composerPluginView .composer-add-section-title').innerText(), '插件');
    assert.equal(await page.locator('#composerAddMainView [data-work-mode]').last().getAttribute('data-work-mode'), 'plan');
    assert.ok(await page.locator('#composerPluginView').evaluate(node => !!node.previousElementSibling?.querySelector('[data-work-mode="plan"]')));
    await page.locator('[data-composer-plugin-choice="hyperframes"]').waitFor();
    const evidence = path.join(appRoot, 'output/playwright/plugin-composer');
    fs.mkdirSync(evidence, { recursive: true });
    const menu = page.locator('#attachmentMenu');
    await menu.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await menu.screenshot({ path: path.join(evidence, `inline-${theme}.png`) });
    }
    for (const width of [768, 414, 375, 320]) {
      if (width < 768) await page.evaluate(() => setLeftSidebarOpen(false));
      await page.setViewportSize({ width, height: 860 });
      const bounds = await menu.boundingBox();
      assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0);
      await page.screenshot({ path: path.join(evidence, `inline-${width}.png`) });
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await page.evaluate(() => applyTheme('dark'));
    assert.match(await page.locator('[data-composer-plugin-choice="remotion"] .skill-call-desc').textContent(), /已关闭/);
    await page.locator('[data-composer-plugin-choice="remotion"]').click();
    const token = page.locator('#composerInput [data-composer-plugin-id="remotion"]');
    await token.waitFor();
    assert.equal(await page.evaluate(() => window.YanComposerPlugins.validate()), false);
    assert.equal(store.get('remotion').enabled, false, 'choosing an installed plugin must preserve its off switch');
    store.update('remotion', { enabled: true });
    assert.match(await token.locator('img').first().getAttribute('src'), /remotion/);
    for (const [theme, color] of [['light', 'rgb(8, 123, 234)'], ['dark', 'rgb(89, 173, 255)']]) {
      await page.evaluate(theme => applyTheme(theme), theme);
      assert.equal(await token.evaluate(el => getComputedStyle(el).color), color);
    }
    await page.evaluate(async () => {
      window.__pluginDraftSession = state.currentSession.id;
      setComposerText('制作视频'); captureComposerDraftForSession();
      await newSession({ standalone: true, forceNew: true });
      await loadSession(window.__pluginDraftSession);
    });
    await token.waitFor();
    assert.equal(await page.evaluate(() => getComposerText()), '制作视频');
    await page.evaluate(() => { setComposerText(''); input.focus(); setComposerCaretByTextOffset(0); });
    await input.press('Backspace');
    assert.equal(await token.count(), 0);
    assert.equal(await page.evaluate(() => state.selectedPlugins.length), 0);
    await input.fill('name@example.com');
    assert.equal(await page.locator('#attachmentMenu').evaluate(el => el.classList.contains('hidden')), true);
    await input.fill('@');
    assert.equal(await page.locator('#attachmentMenu').isVisible(), false);
    await input.fill('');
    await page.locator('#attachBtn').click();
    await page.locator('[data-composer-plugin-choice="remotion"]').waitFor();
    await page.locator('[data-composer-plugin-choice="remotion"]').focus();
    await page.keyboard.press('Enter');
    await token.waitFor();
    assert.equal(await page.evaluate(() => getComposerText()), '');
    assert.equal(await page.evaluate(() => window.YanComposerPlugins.validate()), true);
    await page.locator('#composer').screenshot({ path: path.join(evidence, 'plugin-token.png') });
    const message = await page.evaluate(() => {
      const el = appendMessage('user', '制作视频', [], false, -1, Date.now(), null, null, [], null, state.selectedPlugins);
      const mention = el.querySelector('.composer-plugin-token');
      const result = { color: getComputedStyle(mention).color, logo: mention.querySelector('img').getAttribute('src') };
      el.remove(); return result;
    });
    assert.equal(message.color, 'rgb(89, 173, 255)');
    assert.match(message.logo, /remotion/);
    const queued = await page.evaluate(() => {
      const session = state.currentSession;
      state.activeRuns.set(session.id, { sessionRef: session, runCtx: createRunCtx(session.id, true, '') });
      const ok = queueCurrentComposerTurn();
      const plugins = state.queuedTurns.get(session.id)?.pluginCalls;
      editCurrentQueuedTurn(); state.activeRuns.delete(session.id); updateSendState();
      return { ok, plugins, restored: state.selectedPlugins };
    });
    assert.equal(queued.ok, true);
    assert.equal(queued.plugins[0].id, 'remotion');
    assert.deepEqual(queued.restored, queued.plugins);
    const sent = await page.evaluate(async () => {
      const original = submitMessage;
      let captured;
      submitMessage = async (text, attachments, skills, options) => { captured = options.pluginCalls; return { ok: true }; };
      try { await sendMessage(); return captured; } finally { submitMessage = original; }
    });
    assert.equal(sent[0].id, 'remotion');
    await page.evaluate(items => window.YanComposerPlugins.set(items), sent);
    const selected = resolveSelectedPlugins(dataDir, [{ id: 'remotion', name: 'untrusted' }]);
    assert.notEqual(selected[0].name, 'untrusted');
    assert.match(selectedPluginContext(selected), /plugins_inspect/);
    store.update('remotion', { enabled: false });
    assert.throws(() => resolveSelectedPlugins(dataDir, selected), /未启用/);
    assert.equal(await page.evaluate(() => window.YanComposerPlugins.validate()), false);
    await page.evaluate(() => { window.YanComposerPlugins.set([]); window.YanComposerPlugins.open(); });
    await page.locator('[data-composer-plugin-choice="remotion"]').waitFor();
    assert.match(await page.locator('[data-composer-plugin-choice="remotion"] .skill-call-desc').textContent(), /已关闭/);
    await page.locator('[data-composer-plugin-choice="remotion"]').click();
    await page.evaluate(() => window.YanComposerPlugins.open());
    await page.locator('[data-composer-plugin-choice="hyperframes"]').click();
    await page.evaluate(() => window.YanComposerPlugins.set([...state.selectedPlugins, ...window.YanAgentCatalog.items]));
    await page.evaluate(() => window.YanComposerPlugins.open());
    await page.locator('#composerPluginMenuList .skill-call-empty').waitFor();
    assert.match(await page.locator('#composerPluginMenuList .skill-call-empty').textContent(), /均已选择/);
    await page.evaluate(() => {
      setAttachmentMenuOpen(false); window.YanComposerPlugins.set([]);
      input.innerHTML = '<b>制作</b> <i>视频</i> @'; invalidateComposerTextCache();
      input.focus(); setComposerCaretByTextOffset(getComposerText().length);
      window.YanComposerPlugins.open();
    });
    await page.locator('[data-composer-plugin-choice="remotion"]').click();
    assert.deepEqual(await page.evaluate(() => ({ bold: !!input.querySelector('b'), italic: !!input.querySelector('i'), text: getComposerText() })),
      { bold: true, italic: true, text: '**制作** *视频* @' });
    console.log('PASS: inline plugins, removed @ trigger, logo, themes, draft, deletion, keyboard, user message, queue, send payload and disabled-plugin validation');
  } finally {
    const child = app?.process(), stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    await app?.close().catch(() => {}); await stopped;
    assert.equal(path.dirname(userData), path.resolve(os.tmpdir()));
    await fs.promises.rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
