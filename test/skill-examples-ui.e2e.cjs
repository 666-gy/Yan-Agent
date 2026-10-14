'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const registry = require('../lib/skill-registry');
const appRoot = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-skill-examples-'));
const workspace = path.join(userData, 'workspace');
fs.mkdirSync(workspace);
registry.installYanUserSkill(path.join(userData, 'YanData'), {
  id: 'custom-example', name: 'Custom <Skill>', desc: 'User-imported fixture', prompt: 'Help with the user task.', source: 'custom'
});
const evidence = path.join(appRoot, 'output/playwright/skill-examples');
fs.mkdirSync(evidence, { recursive: true });

(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanSkillExamples);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(async folder => {
      const session = await window.yan.createSession(true, folder);
      await loadSession(session.id); await refreshSessions();
      setComposerText('保留原任务草稿');
      setComposerSkills([{ id: 'yan-uiverse', name: 'Uiverse Web UI' }]);
      captureComposerDraftForSession();
      window.__exampleSourceId = session.id;
      window.__exampleSendAttempts = 0;
      sendMessage = async () => { window.__exampleSendAttempts++; };
    }, workspace);
    const catalog = await page.evaluate(async () => (await window.yan.getSkillCatalog()).map(skill => ({
      ...skill, examples: window.YanSkillExamples.prompts(skill)
    })));
    for (const skill of catalog) {
      assert.ok(skill.examples.length >= 1 && skill.examples.length <= 3, skill.id);
      assert.equal(new Set(skill.examples).size, skill.examples.length);
    }
    const open = async id => {
      await page.locator('[data-nav="plugins"]').click();
      await page.locator('#pluginsSkillsTab').click();
      const close = page.locator('#skillDetailContent [data-detail-action="back"]');
      if (await close.isVisible()) await close.click();
      await page.locator(`#skillMarketGrid [data-market-id="${id}"]`).click();
      await page.locator('#skillDetailMarkdown[aria-busy="false"]').waitFor();
    };
    const panel = page.locator('#skillDetailContent .plugin-examples');
    await open('hyperframes');
    assert.equal(await panel.evaluate(el => getComputedStyle(el).backgroundPosition), '50% 50%');
    assert.match(await panel.evaluate(el => getComputedStyle(el).backgroundImage), /plugin-demo-night-sky\.webp/);
    assert.equal(await panel.evaluate(el => el.getBoundingClientRect().top < document.getElementById('skillDetailPartsTitle').getBoundingClientRect().top), true);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await panel.screenshot({ path: path.join(evidence, `hyperframes-${theme}.png`), animations: 'disabled' });
    }
    let count = 0;
    for (const skill of catalog.filter(skill => !skill.hidden)) {
      for (let index = 0; index < skill.examples.length; index++) {
        await open(skill.id);
        const before = await page.evaluate(() => ({ id: state.currentSession.id, count: state.sessions.length, text: getComposerText() }));
        const expected = skill.examples[index];
        const button = page.locator(`[data-skill-example-action][data-example-index="${index}"]`);
        if (count === 0) await button.evaluate(el => { el.click(); el.click(); });
        else if (count === 1) { await button.focus(); await page.keyboard.press('Enter'); }
        else await button.click();
        await page.waitForFunction(({ id, expected }) => state.currentSession.id !== id && getComposerText() === expected &&
          state.composerDrafts.get(state.currentSession.id)?.text === expected, { id: before.id, expected });
        const after = await page.evaluate(id => ({
          id: state.currentSession.id, workspace: state.currentSession.workspace, count: state.sessions.length,
          draft: state.composerDrafts.get(state.currentSession.id), old: state.composerDrafts.get(id)?.text,
          tokens: [...input.querySelectorAll('[data-composer-skill-id]')].map(el => ({ id: el.dataset.composerSkillId, name: el.dataset.composerSkillName })),
          messages: state.currentSession.messages.length, runs: state.activeRuns.size, sends: window.__exampleSendAttempts,
          focused: document.activeElement === input, chatVisible: !document.getElementById('pageChat').classList.contains('hidden')
        }), before.id);
        assert.equal(after.workspace, workspace);
        assert.equal(after.count, before.count + 1);
        assert.equal(after.old, before.text);
        assert.deepEqual(after.tokens, [{ id: skill.id, name: skill.name }]);
        assert.equal(after.draft.skills.length, 1);
        assert.equal(after.draft.skills[0].id, skill.id);
        assert.equal(after.draft.plugins.length, 0);
        assert.equal(after.draft.text, expected);
        assert.equal(after.messages, 0); assert.equal(after.runs, 0); assert.equal(after.sends, 0);
        assert.equal(after.focused, true); assert.equal(after.chatVisible, true);
        count++;
      }
    }
    await page.evaluate(async () => {
      await window.yan.setSkillEnabled('yan-uiverse', false);
      await newSession({ standalone: true, forceNew: true });
    });
    await open('yan-uiverse');
    await page.locator('[data-skill-example-action]').first().click();
    await page.waitForFunction(() => state.composerDrafts.get(state.currentSession.id)?.skills[0]?.id === 'yan-uiverse');
    assert.equal(await page.evaluate(() => state.currentSession.workspace), '');
    assert.equal(await page.evaluate(async () => (await window.yan.getSkillCatalog()).find(s => s.id === 'yan-uiverse').enabled), false);
    assert.equal(await page.evaluate(async () => (await window.yan.readSkill('yan-uiverse')).ok), false);
    const draftId = await page.evaluate(() => state.currentSession.id);
    await page.evaluate(async id => { await loadSession(window.__exampleSourceId); await loadSession(id); }, draftId);
    assert.equal(await page.locator('#composerInput [data-composer-skill-id="yan-uiverse"]').count(), 1);
    await open('yan-uiverse');
    const prior = await page.evaluate(() => ({ id: state.currentSession.id, text: getComposerText() }));
    await app.evaluate(({ ipcMain }) => {
      global.__skillCreate = ipcMain._invokeHandlers.get('session:create');
      ipcMain.removeHandler('session:create'); ipcMain.handle('session:create', () => null);
    });
    await page.locator('[data-skill-example-action]').last().click();
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('未能创建新任务'));
    assert.deepEqual(await page.evaluate(() => ({ id: state.currentSession.id, text: getComposerText() })), prior);
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('session:create'); ipcMain.handle('session:create', global.__skillCreate); });
    await open('officecli');
    await page.locator('#sidebarToggle').click();
    for (const width of [375, 768]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await panel.evaluate(el => el.scrollWidth > el.clientWidth), false);
      await panel.screenshot({ path: path.join(evidence, `office-${width}.png`), animations: 'disabled' });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: ${catalog.length} skill definitions / ${count} clickable examples; shared wallpaper, fresh workspace drafts, native skill tokens, no send, double-click guard, disabled state preserved, draft restoration, failure handling and responsive layouts.`);
  } finally {
    const child = app?.process(), stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    await app?.close().catch(() => {}); await stopped;
    assert.equal(path.dirname(userData), path.resolve(os.tmpdir()));
    await fs.promises.rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
