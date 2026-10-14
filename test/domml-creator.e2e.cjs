'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-domml-creator-'));
const dataDir = path.join(userData, 'YanData');
const output = path.join(root, 'output/playwright/domml-creator');
const launch = () => _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
  env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
function startMcp() {
  const child = spawn(process.execPath, [path.join(root, 'lib/yan-skills-mcp.js')], { cwd: root,
    env: { ...process.env, YAN_SKILLS_ROOT: path.join(dataDir, 'skills'), YAN_SKILLS_DATA_DIR: dataDir,
      YAN_SKILLS_APP_ROOT: root, YAN_SKILLS_CLI: path.join(root, 'node_modules/skills/bin/cli.mjs'), YAN_SKILLS_ALLOW_NETWORK: 'false' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buffer = '', id = 0;
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message); pending.delete(message.id);
    }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => reject(Error(`MCP timeout: ${method}`)), 15000);
    pending.set(requestId, message => { clearTimeout(timer); resolve(message); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
  });
  return { child, request };
}
(async () => {
  let app, mcp;
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.setViewportSize({ width: 1440, height: 1040 });
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-pet').click();
    await page.locator('#petCustomize').click();
    await page.locator('#petSize').fill('0.7');
    await page.locator('#petSize').dispatchEvent('change');
    await page.waitForFunction(() => state.config.pet.scale === 0.7);
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'customize.png') });
    await page.evaluate(() => applyTheme('light'));
    await page.screenshot({ path: path.join(output, 'customize-light.png') });
    await page.evaluate(() => applyTheme('dark'));
    await page.locator('#petSizeReset').click();
    await page.waitForFunction(() => state.config.pet.scale === 1);
    assert.equal(await page.locator('#petSize').inputValue(), '1');
    await page.keyboard.press('Escape');
    const before = await page.evaluate(() => state.currentSession.id);
    // The current chat has a workspace and a draft; creation must leave both behind.
    await page.evaluate(workspace => { state.currentSession.workspace = workspace; input.value = 'existing draft'; }, root);
    await page.locator('#petCreate').click();
    try {
      await page.waitForFunction(before => state.currentSession.id !== before && input.value === '帮我做一个宠物', before, { timeout: 5000 });
    } catch (error) {
      console.error(await page.evaluate(() => ({ id: state.currentSession.id, value: input.value, skills: state.selectedSkills, toast: document.querySelector('#toast')?.textContent })), errors);
      throw error;
    }
    const composer = await page.evaluate(() => ({ workspace: state.currentSession.workspace || '',
      skills: state.selectedSkills.map(s => s.id), messages: state.currentSession.messages?.length || 0,
      settingsClosed: settingsOverlay.classList.contains('hidden') }));
    assert.deepEqual(composer, { workspace: '', skills: ['domml-creator'], messages: 0, settingsClosed: true });
    assert.equal(await page.evaluate(before => state.composerDrafts.get(before)?.text, before), 'existing draft');
    const skills = await page.evaluate(() => api.listSkills());
    assert.ok(skills.some(skill => skill.id === 'domml-creator'));
    mcp = startMcp();
    await mcp.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const definitions = await mcp.request('tools/list');
    assert.ok(definitions.result.tools.some(tool => tool.name === 'install_pet'));
    const loaded = await mcp.request('tools/call', { name: 'read_skill', arguments: { id: 'domml-creator', task_id: await page.evaluate(() => state.currentSession.id) } });
    assert.equal(loaded.result.isError, false);
    assert.match(JSON.stringify(loaded.result), /yan_skills_install_pet/);
    assert.match(JSON.stringify(loaded.result), /data_source/);
    assert.match(JSON.stringify(loaded.result), /widget/);
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-pet').click();
    // Use existing licensed artwork as a deterministic install fixture; no paid model call.
    const png = await app.evaluate(({ nativeImage }, root) => nativeImage.createFromPath(`${root}/renderer/assets/logo-light.png`).toPNG().toString('base64'), root);
    const assetId = 'e'.repeat(32);
    fs.mkdirSync(path.join(dataDir, 'generated-images'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'generated-images', `${assetId}.png`), Buffer.from(png, 'base64'));
    await page.evaluate(() => closeSettings());
    const installed = await mcp.request('tools/call', { name: 'install_pet', arguments: { name: 'Domml E2E', description: '自动刷新验证', layout: 'static', source_asset_id: assetId } });
    assert.equal(installed.result.isError, false, JSON.stringify(installed));
    const petId = installed.result.structuredContent.pet.id;
    await page.waitForFunction(id => !!settingsOverlay.querySelector(`[data-pet-select="${id}"]`), petId);
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-pet').click();
    await page.locator(`[data-pet-select="${petId}"]`).waitFor();
    await page.locator(`[data-pet-select="${petId}"]`).click();
    await page.waitForFunction(id => state.config.pet.selected === id, petId);
    assert.equal(await page.locator('#petSettingsPreview .pet-settings-sprite').evaluate(el => getComputedStyle(el).backgroundSize), 'contain');
    await page.locator('#petCustomize').click();
    await page.locator('#petSize').fill('1.25');
    await page.locator('#petSize').dispatchEvent('change');
    await page.waitForFunction(() => state.config.pet.scale === 1.25);
    await page.locator('#petCustomizeClose').click();
    const petReady = app.waitForEvent('window');
    await page.locator('#petVisibilityToggle').click();
    const pet = await petReady;
    await pet.waitForFunction(id => document.body.dataset.pet === id, petId);
    const petBounds = await (await app.browserWindow(pet)).evaluate(win => win.getBounds());
    // Windows display scaling may round a physical pixel up at the DIP boundary.
    assert.ok(Math.abs(petBounds.width - 310) <= 1);
    assert.ok(Math.abs(petBounds.height - 298) <= 1);
    assert.equal(await pet.locator('.pet-sprite').evaluate(el => el.classList.contains('is-static') && el.style.backgroundImage.startsWith('url("data:image/png;base64,')), true);
    await page.locator('#petCustomize').click();
    await page.locator('#petSize').fill('0.5');
    await page.locator('#petSize').dispatchEvent('change');
    await pet.waitForFunction(() => getComputedStyle(document.querySelector('.pet-app')).transform === 'matrix(0.5, 0, 0, 0.5, 0, 0)');
    const smallBounds = await (await app.browserWindow(pet)).evaluate(win => win.getBounds());
    assert.ok(Math.abs(smallBounds.width - 124) <= 1);
    await page.locator('#petSize').fill('1.25');
    await page.locator('#petSize').dispatchEvent('change');
    await pet.waitForFunction(() => getComputedStyle(document.querySelector('.pet-app')).transform === 'matrix(1.25, 0, 0, 1.25, 0, 0)');
    await page.locator('#petCustomizeClose').click();
    const main = await app.browserWindow(page);
    await main.evaluate(win => win.hide());
    await pet.locator('#entertainmentPet').click();
    await page.waitForFunction(() => document.hasFocus());
    const listed = await mcp.request('tools/call', { name: 'list_pets', arguments: {} });
    assert.ok(listed.result.structuredContent.pets.some(p => p.id === petId));
    await page.locator('#petVisibilityToggle').click();
    await app.close();
    app = await launch(); page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.locator('#settingsBtn').click(); await page.locator('#settings-tab-pet').click();
    await page.waitForFunction(id => document.querySelector('#petSettingsPreview').dataset.pet === id, petId);
    assert.equal(await page.evaluate(() => state.config.pet.scale), 1.25);
    assert.equal(await page.locator('[data-pet-delete]').count(), 1);
    const remove = page.locator(`[data-pet-delete="${petId}"]`);
    await remove.click();
    await page.locator('#petDeleteDialog').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(output, 'delete-confirm.png'), animations: 'disabled' });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.locator('#petDeleteDialog').screenshot({ path: path.join(output, `delete-confirm-${theme}.png`), animations: 'disabled' });
    }
    await page.locator('#petDeleteCancel').click();
    assert.ok(fs.existsSync(path.join(dataDir, 'pets', petId)));
    await remove.click();
    await page.keyboard.press('Escape');
    assert.ok(fs.existsSync(path.join(dataDir, 'pets', petId)));
    // Deleting an unselected card must not select it, even briefly.
    await page.locator('[data-pet-select="claude"]').click();
    await page.waitForFunction(() => state.config.pet.selected === 'claude' && !petSettingsBusy);
    await remove.click();
    assert.equal(await page.evaluate(() => state.config.pet.selected), 'claude');
    await page.locator('#petDeleteCancel').click();
    await page.locator(`[data-pet-select="${petId}"]`).click();
    await page.waitForFunction(id => state.config.pet.selected === id && !petSettingsBusy, petId);
    const shown = app.waitForEvent('window');
    await page.locator('#petVisibilityToggle').click();
    const visiblePet = await shown;
    await visiblePet.waitForFunction(id => document.body.dataset.pet === id, petId);
    await remove.click();
    await page.locator('#petDeleteConfirm').click();
    await page.waitForFunction(() => state.config.pet.selected === 'orb' && !petSettingsBusy);
    await visiblePet.waitForFunction(() => document.body.dataset.pet === 'orb');
    assert.equal(await page.locator('[data-pet-delete]').count(), 0);
    assert.equal(await page.locator('[data-pet-select]').count(), 3);
    assert.equal(fs.existsSync(path.join(dataDir, 'pets', petId)), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).pet.selected, 'orb');
    await page.screenshot({ path: path.join(output, 'after-delete.png') });
    await page.locator('#petVisibilityToggle').click();
    assert.deepEqual(errors, []);
    console.log('Domml creation, install, restart, deletion confirmation/cancel, active-pet fallback and persistence passed.');
  } finally {
    mcp?.child.kill(); await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
