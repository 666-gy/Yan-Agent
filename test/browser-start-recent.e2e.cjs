const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-start-recent-'));
const history = Array.from({ length: 12 }, (_, i) => ({ id: String(i), favicon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><rect width="18" height="18" fill="red"/></svg>'), title: '页面 ' + i, url: 'https://example.com/' + i, time: Date.now() - i * 60000 })).reverse();
const localPage = pathToFileURL(path.join(temp, 'local page.html')).href;
history.find(item => item.id === '0').url = localPage;
fs.writeFileSync(path.join(temp, 'browser-history.json'), JSON.stringify({ history, downloads: [] }));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: temp } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(() => openRightSidebarTool('browser'));
    const list = page.locator('.rs-browser-panel.active .side-start-recent');
    const tools = page.locator('.rs-browser-panel.active .side-start-tools');
    await tools.evaluate(node => { node.style.width = '220px'; });
    await page.waitForFunction(() => document.querySelector('.rs-browser-panel.active .side-start-tools')?.classList.contains('is-compact'));
    assert.equal(await tools.locator('button > span:last-child').first().isVisible(), false);
    assert.equal(await tools.locator('button[aria-label="文件"][title="文件"]').count(), 1);
    await tools.evaluate(node => { node.style.width = '650px'; });
    await page.waitForFunction(() => !document.querySelector('.rs-browser-panel.active .side-start-tools')?.classList.contains('is-compact'));
    assert.equal(await tools.locator('button > span:last-child').first().isVisible(), true);
    await tools.evaluate(node => { node.style.removeProperty('width'); });

    await list.locator('button').first().waitFor();
    assert.equal(await list.locator('button').count(), 10);
    await page.waitForFunction(() => document.querySelector('.rs-browser-panel.active .side-start-recent img')?.naturalWidth > 0);
    assert.equal(await list.locator('img').count(), 10);
    assert.equal(await list.locator('strong').first().textContent(), '页面 0');
    assert.equal(await list.locator('strong').last().textContent(), '页面 9');
    assert.equal(await list.locator('time[datetime]').count(), 10);
    const nav = await page.locator('.rs-browser-panel.active .tool-panel-nav').evaluate(node => ({ shadow: getComputedStyle(node).boxShadow, height: node.getBoundingClientRect().height / (parseFloat(getComputedStyle(document.documentElement).zoom) || 1) }));
    assert.equal(nav.shadow, 'none');
    await page.screenshot({ path: path.join(temp, 'start-recent.png') });
    await page.evaluate(() => { getBrowserTabController().navigate = async url => { window.__recentOpened = url; }; });
    await list.locator('button').first().click();
    assert.equal(await page.evaluate(() => window.__recentOpened), localPage);
    await page.evaluate(async () => { await api.browserRemoveHistory(Array.from({ length: 12 }, (_, i) => String(i))); await renderBrowserStartRecent(getBrowserTabController()); });
    assert.equal(await list.locator('button').count(), 0);
    assert.equal(await page.locator('.rs-browser-panel.active .side-start-recent-section').isVisible(), false);
    console.log('PASS recent history order, limit, time, navigation, deletion; screenshot ' + path.join(temp, 'start-recent.png'));
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
