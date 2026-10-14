'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-browser-settings-'));
const shots = path.join(root, 'output/playwright/browser-settings');
fs.mkdirSync(shots, { recursive: true });
fs.writeFileSync(path.join(userData, 'browser-history.json'), JSON.stringify({ history: [
  { id: 'old', title: '旧记录', url: 'https://example.com/old', time: Date.now() - 3 * 86400000 }
], downloads: [{ id: 'download-old', time: Date.now() - 3 * 86400000 }, { id: 'download-new', time: Date.now() }] }));
(async () => {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<title>${req.url.includes('second') ? '第二页' : '浏览器测试页面'}</title><p>Browser settings test</p>`); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/first?test=1#fragment`;
  const app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
    env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(url => openBrowserUrlInNewTab(url), url);
    await page.waitForFunction(async () => (await window.yan.browserHistory()).some(item => item.title === '浏览器测试页面'));
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-browser').click();
    await page.evaluate(() => applyTheme('light'));
    await page.screenshot({ path: path.join(shots, 'settings-light.png') });
    await page.locator('#browserEnabled').uncheck();
    await page.waitForFunction(() => state.config.browser.enabled === false);
    await page.locator('#browserFullUrl').check();
    await page.waitForFunction(() => state.config.browser.showFullUrl === true);
    assert.equal(await page.evaluate(() => [...browserTabControllers.values()].some(c => c.urlInput.value.includes('?test=1#fragment'))), true);
    // Exercise the custom picker, not the hidden native select.
    await page.locator('#tab-browser .appearance-picker-trigger').first().click();
    await page.getByRole('option', { name: 'Yan Agent', exact: true }).click();
    await page.waitForFunction(() => state.config.browser.webTarget === 'builtin');
    assert.equal((await page.evaluate(() => window.yan.browserOpenLink('https://example.com/'))).target, 'builtin');
    assert.equal((await page.evaluate(url => window.yan.browserOpenLink(url), url)).target, 'builtin');
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-browser').click();
    assert.equal(await page.locator('#browserEnabled').isChecked(), false);
    assert.equal(await page.locator('#browserFullUrl').isChecked(), true);
    assert.equal(await page.locator('#browserWebTarget').inputValue(), 'builtin');
    await page.locator('#browserEnabled').check();
    await page.waitForFunction(() => state.config.browser.enabled === true);
    await page.evaluate(() => applyTheme('light'));
    await page.locator('#browserManage').click();
    assert.ok((await page.locator('#browserHistoryClose').boundingBox()).x > 1350);
    await page.getByRole('button', { name: /浏览器测试页面/ }).first().waitFor();
    await page.locator('#browserHistorySearch').fill('does-not-exist');
    assert.equal(await page.locator('.browser-history-row').count(), 0);
    await page.locator('#browserHistorySearch').fill('旧记录');
    assert.equal(await page.locator('.browser-history-row').count(), 1);
    await page.locator('#browserHistorySearch').fill('');
    await page.locator('.browser-history-row .browser-circle').first().click();
    await page.screenshot({ path: path.join(shots, 'history-menu.png') });
    await page.keyboard.press('Escape');
    await page.locator('#browserHistoryClose').click();
    assert.equal(await page.locator('#browserPreferences').isVisible(), true);
    await app.evaluate(async ({ session }, url) => { await session.fromPartition('persist:yan-browser').cookies.set({ url, name: 'test-cookie', value: 'yes' }); }, url);
    await page.locator('#browserPreferences [data-browser-clear]').click();
    await page.waitForFunction(() => document.querySelector('[data-summary="sites"]').textContent.includes('127.0.0.1'));
    const bounds = await page.locator('#browserClearDialog').boundingBox();
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - 720) < 1);
    assert.ok(Math.abs(bounds.y + bounds.height / 2 - 500) < 1);
    await page.screenshot({ path: path.join(shots, 'clear-light.png') });
    await page.locator('#browserClearConfirm').click();
    await page.waitForFunction(() => !document.querySelector('#browserClearDialog').open);
    let records = await page.evaluate(() => window.yan.browserHistory());
    assert.deepEqual(records.map(item => item.id), ['old']);
    assert.equal(await app.evaluate(async ({ session }) => (await session.fromPartition('persist:yan-browser').cookies.get({})).length), 0);
    const data = JSON.parse(fs.readFileSync(path.join(userData, 'browser-history.json'), 'utf8'));
    assert.deepEqual(data.downloads.map(item => item.id), ['download-old']);
    await page.locator('#browserManage').click();
    await page.locator('.browser-history-row .browser-circle').click();
    await page.getByRole('menuitem', { name: '从历史记录中移除' }).click();
    await page.waitForFunction(async () => (await window.yan.browserHistory()).length === 0);
    await page.locator('.browser-history-empty').waitFor({ state: 'visible' });
    await page.locator('#browserHistoryClose').click();
    await page.evaluate(() => applyTheme('dark'));
    await page.screenshot({ path: path.join(shots, 'settings-dark.png') });
    await page.locator('#browserPreferences [data-browser-clear]').click();
    await page.screenshot({ path: path.join(shots, 'clear-dark.png') });
    for (const width of [375, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const r = await page.locator('#browserClearDialog').boundingBox();
      assert.ok(r.x >= 0 && r.x + r.width <= width + 1);
      await page.screenshot({ path: path.join(shots, `clear-${width}.png`) });
    }
    console.log('Browser settings: real navigation/history, preference persistence, custom picker, full URL, search, removal, time-range clearing, cookie deletion, centered dialog and narrow layout passed.');
  } finally { await app.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
