'use strict';

// Real-app UI regression for two surfaces that are easy to break silently:
//   1. the sidebar utility row exposes an "API 配置" entry that navigates to the
//      API settings tab (it replaced the desktop-pet toggle, which still lives in
//      Settings → 常规);
//   2. when the renderer hits an uncaught error the page must show the centered
//      fatal-error screen with the concrete message instead of staying black.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-ui-quick-entry-e2e-'));

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForFunction(() => (
      typeof openSettings === 'function'
      && typeof closeSettings === 'function'
      && window.__YAN_APP_READY__ === true
      && !!document.querySelector('#apiConfigQuickBtn')
    ));

    // --- 1. sidebar quick entry → API settings tab -------------------------
    assert.equal(await page.locator('#petWindowToggle').count(), 0, '宠物 button must be gone from the sidebar');
    const quickEntry = page.locator('#apiConfigQuickBtn');
    assert.equal((await quickEntry.textContent()).trim(), 'API 配置');
    assert.equal(await quickEntry.getAttribute('title'), 'API 配置');

    // The utility row reads left to right: 设置 · API 配置 · 切换主题 · 上手指南.
    const utilityRow = await page.evaluate(() => {
      const boxOf = selector => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box ? { center: box.left + box.width / 2, top: box.top, width: box.width } : null;
      };
      return {
        settings: boxOf('#settingsBtn'),
        api: boxOf('#apiConfigQuickBtn'),
        theme: boxOf('#themeToggle'),
        guide: boxOf('#guideBtn')
      };
    });
    for (const [name, box] of Object.entries(utilityRow)) {
      assert.ok(box && box.width > 0, `${name} must be laid out in the utility row`);
    }
    assert.ok(utilityRow.settings.center < utilityRow.api.center,
      `设置 must sit left of API 配置: ${JSON.stringify(utilityRow)}`);
    assert.ok(utilityRow.api.center < utilityRow.theme.center,
      `API 配置 must sit left of 切换主题: ${JSON.stringify(utilityRow)}`);
    assert.ok(utilityRow.theme.center < utilityRow.guide.center,
      `切换主题 must sit left of 上手指南: ${JSON.stringify(utilityRow)}`);
    const rowTops = new Set(Object.values(utilityRow).map(box => Math.round(box.top)));
    assert.equal(rowTops.size, 1, `the four controls must share one row: ${JSON.stringify(utilityRow)}`);

    const overlay = page.locator('#settingsOverlay');
    await quickEntry.click();
    await overlay.waitFor({ state: 'visible' });
    assert.equal(await overlay.getAttribute('data-active-tab'), 'api');
    assert.equal(await page.locator('[data-tab="api"]').getAttribute('aria-selected'), 'true');
    assert.ok(await page.locator('#tab-api').isVisible(), 'API panel must be the visible tab');
    assert.ok(await page.locator('#connectionList').count() > 0, 'API panel content must be mounted');
    assert.equal(await page.locator('#tab-general').isVisible(), false);

    await page.locator('#closeSettings').click();
    await overlay.waitFor({ state: 'hidden' });

    // --- 2. uncaught renderer error → centered fatal-error screen ----------
    assert.equal(await page.locator('#yanFatalError').count(), 0);
    await page.evaluate(() => {
      setTimeout(() => { throw new Error('E2E_FATAL_PROBE'); }, 0);
    });
    const fatal = page.locator('#yanFatalError');
    await fatal.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#yanFatalError h1').textContent(), 'Yan Agent发生了错误');
    const detail = await page.locator('#yanFatalErrorDetail').textContent();
    assert.match(detail, /E2E_FATAL_PROBE/, 'the concrete error must be shown');
    assert.match(detail, /时间：/, 'the report must carry when it happened');

    // "正中间": the card sits at the centre of the viewport it covers.
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const screenBox = await fatal.boundingBox();
    const cardBox = await page.locator('#yanFatalError .yan-fatal-card').boundingBox();
    assert.ok(screenBox.width >= viewport.width - 1 && screenBox.height >= viewport.height - 1,
      `fatal screen must cover the viewport, got ${JSON.stringify(screenBox)} vs ${JSON.stringify(viewport)}`);
    const dx = Math.abs((cardBox.x + cardBox.width / 2) - viewport.width / 2);
    const dy = Math.abs((cardBox.y + cardBox.height / 2) - viewport.height / 2);
    assert.ok(dx <= 2 && dy <= 2, `error card must be centered, off by ${dx}x${dy}`);

    // Even a full-screen failure must be dismissible.
    await page.locator('#yanFatalError button[data-action="close"]').click();
    await fatal.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#yanFatalError').count(), 0);

    assert.deepEqual(pageErrors.filter(message => !message.includes('E2E_FATAL_PROBE')), []);
    console.log(JSON.stringify({ ok: true, cardBox, viewport }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
