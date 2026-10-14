const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-child-settings-'));
const appRoot = path.resolve(__dirname, '..');
const suppliers = ['main', 'cheap'].map(id => ({ id, name: id, kind: 'custom',
  baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test-key', models: [{ id, name: id, modelType: 'text' },
    { id: 'hidden', name: 'hidden', modelType: 'text' }, { id: 'picture', modelType: 'image' }] }));
fs.mkdirSync(path.join(root, 'YanData'));
fs.writeFileSync(path.join(root, 'YanData/config.json'), JSON.stringify({ api: {
  provider: 'openai', model: 'main', connectionsMigrated: true, enabledConnections: ['main', 'cheap'],
  providerSuppliers: { openai: suppliers }, providerActiveSupplierIds: { openai: 'main' },
  connections: suppliers.map(s => ({ id: s.id, providerId: 'openai', supplierId: s.id,
    modelFlags: { hidden: { enabled: false }, picture: { image: true } } }))
}, agentModel: { providerId: 'openai', supplierId: 'main', modelId: 'main', modelType: 'text' } }));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_MAIN_TEST_EXPORTS: '1', YAN_E2E_USER_DATA_DIR: root } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-subagents').click();
    await page.waitForFunction(() => document.querySelector('#subagentModelsNotice').textContent === '');
    assert.equal(await page.locator('[data-subagent-model]').count(), 8);
    assert.equal(await page.locator('#settings-tab-subagents svg').getAttribute('data-keyline-icon'), 'bot-square');
    const value = JSON.stringify(['openai', 'cheap', 'cheap']);
    const explorer = page.locator('#subagent-model-explorer');
    assert.equal(await page.locator('#tab-subagents select').count(), 0);
    assert.deepEqual(await page.locator('.subagent-settings-name').allTextContents(), [
      'Sub Explore Agent', 'Sub Review Agent', 'Sub Research Agent', 'Sub Test Agent',
      'Sub Build Agent', 'Sub Mapper Agent', 'Sub Tracer Agent', 'Sub Reverser Agent'
    ]);
    const colors = await page.locator('.subagent-settings-icon').evaluateAll(elements => elements.map(el => getComputedStyle(el).color));
    assert.equal(new Set(colors).size, 8);
    await explorer.click();
    assert.equal(await page.locator('.subagent-model-menu [role="option"]').filter({ hasText: 'hidden' }).count(), 0);
    assert.equal(await page.locator('.subagent-model-menu [role="option"]').filter({ hasText: 'picture' }).count(), 0);
    await page.locator(`[data-model-option='${value}']`).click();
    await page.waitForFunction(() => state.config.agent.subagentModels.explorer?.modelId === 'cheap');
    await page.locator('#subagent-model-reviewer').click();
    await page.locator(`[data-model-option='${value}']`).click();
    await page.waitForFunction(() => state.config.agent.subagentModels.reviewer?.modelId === 'cheap');
    const runtime = await app.evaluate(({ app }) => {
      const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/main.js');
      const main = load(app.getAppPath() + '/main.js').__test;
      const config = main.getOpenCodeRuntimeConfig(main.configStore.loadConfig(), { mcpServers: [] });
      return { explorer: config.agent.explorer.model, reviewer: config.agent.reviewer.model,
        parent: config.model, child: Object.keys(config.provider['yan-subagent-explorer'].models) };
    });
    assert.equal(runtime.explorer, 'yan-subagent-explorer/cheap');
    assert.equal(runtime.reviewer, 'yan-subagent-reviewer/cheap');
    assert.match(runtime.parent, /\/main$/);
    assert.deepEqual(runtime.child, ['cheap']);
    await explorer.focus();
    await explorer.press('ArrowDown');
    await page.locator('.subagent-model-menu').press('Home');
    await page.locator('.subagent-model-menu').press('Enter');
    await page.waitForFunction(() => !state.config.agent.subagentModels.explorer);
    assert.equal(await page.locator('#subagent-model-reviewer').getAttribute('data-model-value'), value);
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-subagents').click();
    await page.waitForFunction(() => document.querySelector('#subagent-model-reviewer')?.dataset.modelValue.includes('cheap'));
    const directory = path.join(appRoot, 'output/playwright/subagent-settings');
    fs.mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, 'desktop.png') });
    await explorer.click();
    await page.screenshot({ path: path.join(directory, 'custom-menu.png') });
    await page.locator('.subagent-model-menu').press('Escape');
    assert.equal(await explorer.getAttribute('aria-expanded'), 'false');
    assert.equal(await explorer.evaluate(el => document.activeElement === el), true);
    await explorer.click();
    await page.locator('#settingsSectionTitle').click();
    await page.waitForFunction(() => !document.querySelector('.subagent-model-menu'));
    await page.setViewportSize({ width: 880, height: 800 });
    await page.screenshot({ path: path.join(directory, 'compact.png') });
    await page.locator('#subagent-model-reverser').click();
    const menuBounds = await page.locator('.subagent-model-menu').boundingBox();
    assert.ok(menuBounds.x >= 0 && menuBounds.y >= 0 && menuBounds.x + menuBounds.width <= 880 && menuBounds.y + menuBounds.height <= 800);
    await page.screenshot({ path: path.join(directory, 'compact-menu.png') });
    await page.evaluate(() => applyTheme('light'));
    await page.screenshot({ path: path.join(directory, 'light-menu.png') });
    const overflow = await page.locator('#subagentModelList').evaluate(el => el.scrollWidth > el.clientWidth);
    assert.equal(overflow, false);
    console.log('Subagent settings: catalog filtering, eight roles, independent persistence, clearing, reload and layout passed');
  } finally { await app?.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
