'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output/docs-throughput-fix');
fs.mkdirSync(output, { recursive: true });
(async () => {
  let app;
  const errors = [];
  let checked = 0;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'yan-help-documents-')) } });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof state === 'object' && state.config && typeof openSettings === 'function');
    await page.locator('#settingsBtn').click();
    for (let round = 0; round < 2; round++) {
      await page.evaluate(theme => applyTheme(theme), round === 0 ? 'dark' : 'light');
      await page.locator('[data-tab="api"]').click();
      await page.locator('#connectionList .provider-add').click();
      await page.locator('#connectionDialog[open]').waitFor();
      await page.locator('#connName').fill('文档隔离测试');
      await page.locator('#connNext').click();
      await page.locator('#connPrev').click();
      await page.locator('#connectionDialogClose').click();
      let settingsOpen = true;
      for (const key of ['yan-guide', 'glm', 'sensenova', 'agnes', 'siliconflow', 'overview', 'errors', 'release-notes']) {
        if (key === 'yan-guide') {
          if (settingsOpen) {
            await page.locator('#closeSettings').click();
            settingsOpen = false;
          }
          await page.locator('#guideBtn').click();
        } else {
          if (!settingsOpen) {
            await page.locator('#settingsBtn').click();
            settingsOpen = true;
          }
          await page.locator(`[data-tab="${['errors', 'release-notes'].includes(key) ? 'about' : 'vision-relay'}"]`).click();
          await page.locator(key === 'errors' ? '#aboutErrorsBtn' : `[data-vision-relay-guide="${key}"]`).click();
        }
        const prefix = key === 'errors' ? 'aboutError' : 'visionRelayGuide';
        await page.locator(`#${prefix}Dialog[open]`).waitFor();
        const total = Number((await page.locator(`#${prefix}StepLabel`).innerText()).split('/')[1]);
        for (let index = 0; index < total; index++) {
          const title = page.locator(`#${prefix}PageTitle`);
          const copy = page.locator(`#${prefix}PageCopy`);
          const visible = await title.isVisible() && await copy.isVisible();
          if (!visible) await page.screenshot({ path: path.join(output, 'documents-blank-repro.png') });
          assert.ok(visible, `${key} page ${index + 1} body must be visible after using connection wizard`);
          assert.ok((await copy.innerText()).trim(), `${key} page ${index + 1} must contain text`);
          assert.equal(await page.locator(`#${prefix}StepLabel`).innerText(), `${index + 1} / ${total}`);
          checked++;
          if (index === 0 && ['glm', 'errors', 'yan-guide'].includes(key)) {
            await page.screenshot({ path: path.join(output, `documents-${key}${round ? '-light' : ''}.png`) });
          }
          if (index + 1 < total) await page.locator(`#${prefix}Next`).click();
        }
        if (total > 1) {
          await page.locator(`#${prefix}Prev`).click();
          assert.ok(await page.locator(`#${prefix}PageCopy`).isVisible());
          await page.locator(`#${prefix}Next`).click();
        }
        await page.locator(`#${prefix}Next`).click();
        assert.equal(await page.locator(`#${prefix}Dialog`).getAttribute('open'), null);
      }
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, checked, rounds: 2, errors }));
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
