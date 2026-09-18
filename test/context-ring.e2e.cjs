'use strict';

// The composer context outline is gone: the right-dock ring is the readout.
// This guards the shape of that swap — no leftover outline nodes, the ring
// sits below the dock pill, and its panel opens to the left with live values.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-context-ring-'));
const evidenceDir = path.join(appRoot, '.yanagent', 'evidence');

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
    await page.waitForFunction(() => document.readyState === 'complete' && typeof switchSidebarNav === 'function');
    await page.waitForTimeout(500);

    const baseline = await page.evaluate(() => {
      const pill = document.querySelector('.rs-dock-pill')?.getBoundingClientRect();
      const button = document.querySelector('#contextRingBtn')?.getBoundingClientRect();
      return {
        outlineGone: !document.querySelector('#composerContextBorder')
          && !document.querySelector('.composer-context-border')
          && !document.querySelector('.composer-context-progress'),
        retainedGone: !document.querySelector('#retainedAgentUi'),
        ring: !!document.querySelector('#contextRingBtn #contextRingProgress'),
        unit: document.querySelector('#contextRingBtn .context-ring-unit')?.textContent || '',
        belowPill: pill && button ? button.top >= pill.bottom - 1 : false
      };
    });
    assert.equal(baseline.outlineGone, true, 'the composer context outline must stay removed');
    assert.equal(baseline.retainedGone, true, 'the hidden retained context block must stay removed');
    assert.equal(baseline.ring, true, 'the dock must expose the context ring');
    assert.equal(baseline.unit, 'K', 'the context ring must carry the K unit badge');
    assert.equal(baseline.belowPill, true, 'the ring must sit below the dock pill');

    await page.evaluate(() => {
      updateContextRing(45000, 100000, 70000, 100000, 'normal', { modelName: 'Test Model', statusLabel: '执行中' });
    });
    const state = await page.evaluate(() => ({
      dashoffset: Number(document.querySelector('#contextRingProgress').style.strokeDashoffset),
      aria: document.querySelector('#contextRingBtn').getAttribute('aria-valuenow'),
      percent: document.querySelector('#contextRingPercent').textContent,
      used: document.querySelector('#contextRingUsed').textContent,
      hint: document.querySelector('#contextRingHint').textContent,
      meta: document.querySelector('#contextRingMeta').textContent
    }));
    assert.ok(Math.abs(state.dashoffset - 0.55) < 0.001, `arc must mirror 45% usage, saw ${state.dashoffset}`);
    assert.equal(state.aria, '45');
    assert.equal(state.percent, '45%');
    assert.equal(state.used, '45K');
    assert.match(state.hint, /距离自动压缩还有/);
    assert.match(state.meta, /Test Model/);

    await page.locator('#contextRingBtn').click();
    await page.waitForSelector('#contextRingPanel:not(.hidden)');
    const panel = await page.evaluate(() => {
      const panelBox = document.querySelector('#contextRingPanel').getBoundingClientRect();
      const buttonBox = document.querySelector('#contextRingBtn').getBoundingClientRect();
      return {
        x: panelBox.x,
        width: panelBox.width,
        buttonX: buttonBox.x,
        height: panelBox.height,
        expanded: document.querySelector('#contextRingBtn').getAttribute('aria-expanded')
      };
    });
    assert.equal(panel.expanded, 'true');
    assert.ok(panel.height > 0 && panel.width > 0, 'panel must be visible');
    assert.ok(panel.x + panel.width <= panel.buttonX + 1, 'panel must open to the left of the ring');
    await page.screenshot({ path: path.join(evidenceDir, 'context-ring-panel.png'), fullPage: false });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'true', 'Escape must close the panel');

    await page.locator('#contextRingBtn').click();
    await page.waitForSelector('#contextRingPanel:not(.hidden)');
    await page.locator('#composer').click({ position: { x: 40, y: 20 } });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'true', 'outside click must close the panel');

    console.log(JSON.stringify({ ok: true, panel }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
