'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-tone-e2e-'));
const screenshotPath = path.join(os.tmpdir(), `yan-tone-settings-${Date.now()}.png`);
const editorScreenshotPath = path.join(os.tmpdir(), `yan-tone-editor-${Date.now()}.png`);

async function launch() {
  return electron.launch({
    executablePath: require('electron'),
    args: [appRoot],
    cwd: appRoot,
    env: {
      ...process.env,
      YAN_E2E_MODE: '1',
      YAN_E2E_USER_DATA_DIR: userDataDir
    }
  });
}

(async () => {
  let application;
  try {
    application = await launch();
    const page = await application.firstWindow();
    await page.waitForFunction(() => typeof openSettings === 'function');
    await page.locator('#settingsBtn').click();
    await page.locator('#settingsOverlay:not(.hidden)').waitFor();
    await page.locator('[data-tab="tone"]').click();
    await page.locator('#tab-tone.active').waitFor();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    const names = ['爽快', '严谨', '简练', '戏谑'];
    const instructions = ['没素质，爽快', '结论先行，只说有证据的内容', '尽量短句', '可以开玩笑但别编事实'];
    for (let index = 0; index < names.length; index += 1) {
      await page.locator('#addToneProfile').click();
      await page.locator('#toneEditorDialog[open]').waitFor();
      await page.locator('#toneEditorName').fill(names[index]);
      await page.locator('#toneEditorInstructions').fill(instructions[index]);
      if (index === 0) await page.screenshot({ path: editorScreenshotPath });
      await page.locator('#toneEditorSave').click();
      await page.locator('#toneEditorDialog').waitFor({ state: 'hidden' });
      await page.locator('[data-tone-profile-id]').nth(index).waitFor();
    }
    assert.equal(await page.locator('[data-tone-profile-id]').count(), 4);
    assert.equal(await page.locator('#addToneProfile').isDisabled(), true);

    const profileIds = await page.locator('[data-tone-profile-id]').evaluateAll(nodes => nodes.map(node => node.dataset.toneProfileId));
    await page.locator('[data-tone-select]').nth(2).click();
    await page.locator('[data-tone-remove]').nth(2).click();
    await page.waitForFunction(async expectedId => {
      const config = await window.yan.getConfig();
      return config.agent.tone.activeProfileId === expectedId && config.agent.tone.profiles.length === 3;
    }, profileIds[1]);

    const saved = await page.evaluate(() => window.yan.getConfig().then(config => config.agent.tone));
    assert.equal(saved.profiles.length, 3);
    assert.equal(saved.profiles[0].name, '爽快');
    assert.equal(saved.profiles[0].instructions, '没素质，爽快');
    assert.equal(saved.activeProfileId, profileIds[1]);
    assert.equal(await page.locator('[data-tone-select].active').getAttribute('data-tone-select'), profileIds[1]);
    assert.equal(await page.locator('#addToneProfile').isEnabled(), true);

    const cardBoxes = await page.locator('#toneProfileGrid > *, #toneProfileList > *').evaluateAll(nodes => nodes
      .filter(node => getComputedStyle(node).display !== 'contents')
      .map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
    assert.ok(cardBoxes.length >= 4);
    assert.ok(cardBoxes.every(box => box.width > 120 && box.height >= 64 && box.height < 100));
    await page.evaluate(() => {
      const content = document.querySelector('.settings-page-layer .sheet-content');
      if (content) content.scrollTop = 0;
    });
    await page.screenshot({ path: screenshotPath });

    await application.close();
    application = await launch();
    const restartedPage = await application.firstWindow();
    const restored = await restartedPage.evaluate(() => window.yan.getConfig().then(config => config.agent.tone));
    assert.deepEqual(restored, saved);
    console.log(JSON.stringify({ ok: true, screenshotPath, editorScreenshotPath, activeProfileId: restored.activeProfileId }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
