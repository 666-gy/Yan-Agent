'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { installPet } = require('../lib/pet-store');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-pet-data-'));
const dataDir = path.join(userData, 'YanData');
const output = path.join(root, 'output/playwright/pet-data');
const installed = installPet(dataDir, { name: 'Balance monitor', layout: 'widget', data_source: {
  url: 'https://balance.example/account', value_path: ['data', 'balance'], label: 'Account balance', prefix: '$', decimals: 2
} });
const web = installPet(dataDir, { name: 'Weason balance custom UI', layout: 'web', data_source: {
  url: 'https://balance.example/account', value_path: ['data', 'balance'], prefix: '$', decimals: 2
}, frontend: {
  width: 320, height: 160,
  html: `<header id="drag">Weason.cn余额<button id="refresh" title="刷新">↻</button></header><main><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 7V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7"/><path d="M21 12h-6v5h6"/><circle cx="17" cy="14.5" r=".5"/></svg><strong id="amount">--</strong></main><footer id="footer">Loading</footer>`,
  css: `body{box-sizing:border-box;font-family:Arial,sans-serif;color:#15251e;background:#f6faf8;border:1px solid #b7c9be;border-radius:8px;padding:18px;height:160px}header{font-size:16px;display:flex;align-items:center;justify-content:space-between;cursor:grab}button{font-size:22px;border:0;background:none;color:#375749;cursor:pointer}main{display:flex;gap:12px;align-items:center;margin:16px 0}strong{font-size:30px}footer{font-size:13px;color:#336147}`,
  js: `yanPet.onData(d=>{if(d.status==='ready'){amount.textContent=d.text;footer.textContent=d.value<5?'余额偏低':'余额充足'}else if(d.status==='error'){footer.textContent=d.error}});refresh.onclick=()=>yanPet.refreshData();drag.onpointerdown=()=>yanPet.startDrag();drag.onpointerup=()=>yanPet.stopDrag();window.isolation={node:typeof require};try{parent.document.body;window.isolation.parent=true}catch{window.isolation.parent=false}`
} });
fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ general: { promptSuggestions: false },
  pet: { selected: installed.pet.id, enabled: false, scale: 1 } }));
let app;
(async () => {
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const main = await app.firstWindow();
    await main.waitForFunction(() => window.__YAN_APP_READY__);
    await app.evaluate(() => {
      const original = globalThis.fetch;
      globalThis.petFixtureBalance = 12.34;
      globalThis.fetch = (url, init) => {
        if (String(url) !== 'https://balance.example/account') return original(url, init);
        if (globalThis.petFixtureBalance == null) return Promise.reject(new Error('fixture offline'));
        return Promise.resolve(Response.json({ data: { balance: globalThis.petFixtureBalance } }));
      };
    });
    const petPromise = app.waitForEvent('window');
    await main.evaluate(id => api.setConfig({ pet: { selected: id, enabled: true, scale: 1 } }), installed.pet.id);
    const pet = await petPromise;
    await pet.locator('#petDataValue').filter({ hasText: '$12.34' }).waitFor();
    assert.equal(await pet.locator('#entertainmentPet').isVisible(), false);
    await app.evaluate(() => { globalThis.petFixtureBalance = 56.78; });
    await pet.locator('#petDataRefresh').click();
    await pet.waitForFunction(() => document.getElementById('petDataValue').textContent === '$56.78');
    await app.evaluate(() => { globalThis.petFixtureBalance = null; });
    await pet.locator('#petDataRefresh').click();
    await pet.waitForFunction(() => document.getElementById('petDataStatus').textContent === '数据暂不可用');
    assert.equal(await pet.locator('#petDataValue').textContent(), '$56.78');
    fs.mkdirSync(output, { recursive: true });
    await pet.screenshot({ path: path.join(output, 'balance-widget.png') });
    await main.locator('#settingsBtn').click(); await main.locator('#settings-tab-pet').click();
    await main.locator(`[data-pet-select="${installed.pet.id}"]`).waitFor();
    await main.screenshot({ path: path.join(output, 'widget-settings.png') });
    await main.evaluate(() => api.setConfig({ pet: { scale: 0.5 } }));
    await pet.waitForFunction(() => getComputedStyle(document.querySelector('.pet-app')).transform === 'matrix(0.5, 0, 0, 0.5, 0, 0)');
    await pet.screenshot({ path: path.join(output, 'balance-widget-small.png') });
    await app.evaluate(() => { globalThis.petFixtureBalance = 12.34; });
    await main.evaluate(id => api.setConfig({ pet: { selected: id, scale: 1 } }), web.pet.id);
    const frontend = pet.frameLocator('#petFrontend');
    await frontend.locator('#amount').filter({ hasText: '$12.34' }).waitFor();
    assert.equal(await frontend.locator('#footer').textContent(), '余额充足');
    assert.equal(await pet.locator('.pet-stage').isVisible(), false);
    const customFrame = pet.frames().find(frame => frame !== pet.mainFrame());
    assert.deepEqual(await customFrame.evaluate(() => window.isolation), { node: 'undefined', parent: false });
    assert.equal(await customFrame.evaluate(() => JSON.stringify(window.yanPet).includes('connection')), false);
    await pet.screenshot({ path: path.join(output, 'balance-custom.png') });
    await app.evaluate(() => { globalThis.petFixtureBalance = 2.5; });
    await frontend.locator('#refresh').click();
    await frontend.locator('#amount').filter({ hasText: '$2.50' }).waitFor();
    assert.equal(await frontend.locator('#footer').textContent(), '余额偏低');
    await app.evaluate(() => { globalThis.petFixtureBalance = null; });
    await frontend.locator('#refresh').click();
    await frontend.locator('#footer').filter({ hasText: '数据暂不可用' }).waitFor();
    assert.equal(await frontend.locator('#amount').textContent(), '$2.50');
    await main.evaluate(() => api.setConfig({ pet: { scale: 0.5 } }));
    await pet.waitForFunction(() => innerWidth === 160 && innerHeight === 80);
    await pet.screenshot({ path: path.join(output, 'balance-custom-small.png') });
    const errors = [];
    pet.on('pageerror', error => errors.push(error.message));
    await main.evaluate(() => api.setConfig({ pet: { selected: 'orb' } }));
    await pet.waitForFunction(() => document.getElementById('petData').hidden);
    assert.equal(await pet.locator('#petFrontend').isVisible(), false);
    assert.deepEqual(errors, []);
    await main.evaluate(id => api.setConfig({ pet: { selected: id, enabled: false, scale: 1 } }), installed.pet.id);
    await app.close();
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const reopened = await app.firstWindow();
    await reopened.waitForFunction(() => window.__YAN_APP_READY__);
    const catalog = await reopened.evaluate(() => api.listPets());
    assert.ok(catalog.some(item => item.id === installed.pet.id && item.dataSource.url === 'https://balance.example/account'));
    assert.ok(catalog.some(item => item.id === web.pet.id && item.frontend.html.includes('Weason.cn')));
    assert.equal(await reopened.evaluate(() => state.config.pet.selected), installed.pet.id);
    await app.evaluate(() => {
      const original = globalThis.fetch;
      globalThis.fetch = (url, init) => String(url) === 'https://balance.example/account'
        ? Promise.resolve(Response.json({ data: { balance: 8.75 } })) : original(url, init);
    });
    const restoredPetPromise = app.waitForEvent('window');
    await reopened.evaluate(id => api.setConfig({ pet: { selected: id, enabled: true, scale: 1 } }), web.pet.id);
    const restoredPet = await restoredPetPromise;
    await restoredPet.frameLocator('#petFrontend').locator('#amount').filter({ hasText: '$8.75' }).waitFor();
    console.log(JSON.stringify({ ok: true, petId: installed.pet.id, screenshots: output }));
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
