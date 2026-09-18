'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-right-sidebar-tabs-e2e-'));

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: {
        ...process.env,
        YAN_E2E_MODE: '1',
        YAN_E2E_USER_DATA_DIR: userDataDir
      }
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => (
      typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady
      && typeof renderRightSidebarTabs === 'function'
      && typeof createRightSidebarTab === 'function'
      && typeof syncRightSidebarTabLayout === 'function'
    ));

    const report = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      const app = document.querySelector('#app');
      app?.classList.remove('rs-hidden');
      setRightSidebarOpen(true);
      openRightSidebarTabs.splice(0, openRightSidebarTabs.length);

      const browser = createRightSidebarTab('browser');
      browser.label = 'A long browser page title';
      createRightSidebarTab('review');
      createRightSidebarTab('interjection');
      openRightSidebarTabs.push({ id: 'browser-extra', type: 'browser', label: 'Extra browser tab', favicon: '' });
      activeRightSidebarTab = openRightSidebarTabs.at(-1).id;

      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const inspect = () => {
        const units = [...document.querySelectorAll('#rightSidebarTabStrip > .rs-tab-unit')];
        const visible = units.filter(unit => !unit.hidden);
        const add = document.querySelector('#rightSidebarAddWrap')?.getBoundingClientRect();
        const last = visible.at(-1)?.getBoundingClientRect();
        return {
          widths: visible.map(unit => unit.getBoundingClientRect().width),
          hiddenCount: units.filter(unit => unit.hidden).length,
          overflowCount: document.querySelector('#rightSidebarTabOverflowMenu')?.children.length || 0,
          overflowHidden: document.querySelector('#rightSidebarTabOverflowWrap')?.classList.contains('hidden'),
          addGap: add && last ? add.left - last.right : null,
          openButton: document.querySelector('#rightDock')?.getBoundingClientRect().toJSON(),
          focusButton: document.querySelector('#rightSidebarFocusBtn')?.getBoundingClientRect().toJSON(),
          tabbarWidth: document.querySelector('#rightSidebarTabbar')?.getBoundingClientRect().width || 0,
          stripWidth: document.querySelector('#rightSidebarTabStrip')?.getBoundingClientRect().width || 0
        };
      };

      renderRightSidebarTabs();
      document.documentElement.style.setProperty('--rs-w', '800px');
      window.dispatchEvent(new Event('resize'));
      await settle();
      const base = inspect();

      for (let index = 0; index < 8; index += 1) {
        openRightSidebarTabs.push({ id: `browser-extra-${index}`, type: 'browser', label: `Extra browser page ${index}`, favicon: '' });
      }
      activeRightSidebarTab = openRightSidebarTabs.at(-1).id;
      renderRightSidebarTabs();
      document.documentElement.style.setProperty('--rs-w', '300px');
      window.dispatchEvent(new Event('resize'));
      await settle();
      return { base, narrow: inspect() };
    });

    assert.ok(report.base.widths.length >= 4, 'base layout should show all tool tabs');
    assert.ok(report.base.widths.every(width => width > 0), 'base tabs must be visible');
    assert.ok(report.base.widths.every(width => Math.abs(width - report.base.widths[0]) < 0.5), 'base tab widths should match');
    assert.ok(report.base.addGap >= 0 && report.base.addGap < 8, 'new tab button should follow the last visible tab');
    assert.ok(report.narrow.hiddenCount > 0, 'narrow layout should hide old tabs');
    assert.equal(report.narrow.overflowCount, report.narrow.hiddenCount, 'overflow menu should list hidden tabs');
    assert.equal(report.narrow.overflowHidden, false, 'overflow trigger should be visible when tabs are hidden');
    assert.ok(report.narrow.widths.every(width => Math.abs(width - report.narrow.widths[0]) < 0.5), 'compressed tab widths should match');
    assert.ok(report.narrow.addGap >= 0 && report.narrow.addGap < 8, 'new tab button should remain after visible tabs');
    console.log(JSON.stringify({ ok: true, ...report }));
  } finally {
    if (application) await application.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
