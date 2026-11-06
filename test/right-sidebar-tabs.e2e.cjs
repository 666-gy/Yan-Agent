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
          fixedWidth: parseFloat(getComputedStyle(document.querySelector('#rightSidebarTabStrip')).getPropertyValue('--rs-tab-unit-width')),
          addWidth: document.querySelector('#rightSidebarAddBtn')?.getBoundingClientRect().width || 0,
          hiddenCount: units.filter(unit => unit.hidden).length,
          overflowCount: document.querySelectorAll('#rightSidebarTabOverflowMenu .rs-tab-overflow-item').length,
          overflowHead: document.querySelector('#rightSidebarTabOverflowMenu .rs-tab-overflow-head')?.textContent || '',
          overflowMenuRadius: (() => {
            const menu = document.querySelector('#rightSidebarTabOverflowMenu');
            return menu ? getComputedStyle(menu).borderRadius : '';
          })(),
          overflowItemRadius: (() => {
            const item = document.querySelector('#rightSidebarTabOverflowMenu .rs-tab-overflow-item');
            return item ? getComputedStyle(item).borderRadius : '';
          })(),
          overflowHidden: document.querySelector('#rightSidebarTabOverflowWrap')?.classList.contains('hidden'),
          addGap: add && last ? add.left - last.right : null,
          openButton: document.querySelector('#rightDock')?.getBoundingClientRect().toJSON(),
          focusButton: document.querySelector('#rightSidebarFocusBtn')?.getBoundingClientRect().toJSON(),
          tabbarWidth: document.querySelector('#rightSidebarTabbar')?.getBoundingClientRect().width || 0,
          stripWidth: document.querySelector('#rightSidebarTabStrip')?.getBoundingClientRect().width || 0
        };
      };

      renderRightSidebarTabs();
      // The window width clamps --rs-w, so size the sidebar itself to make the
      // two layout cases deterministic.
      document.querySelector('#rightSidebar').style.width = '800px';
      window.dispatchEvent(new Event('resize'));
      await settle();
      const base = inspect();

      for (let index = 0; index < 8; index += 1) {
        openRightSidebarTabs.push({ id: `browser-extra-${index}`, type: 'browser', label: `Extra browser page ${index}`, favicon: '' });
      }
      activeRightSidebarTab = openRightSidebarTabs.at(-1).id;
      renderRightSidebarTabs();
      document.querySelector('#rightSidebar').style.width = '300px';
      window.dispatchEvent(new Event('resize'));
      await settle();
      return { base, narrow: inspect() };
    });

    const behavior = await page.evaluate(async () => {
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      openRightSidebarTabs.splice(0, openRightSidebarTabs.length);

      // A fresh blank tab is reused by the next + instead of stacking.
      const blank = createRightSidebarTab('browser');
      activeRightSidebarTab = blank.id;
      renderRightSidebarTabs();
      await settle();
      const blankState = {
        count: openRightSidebarTabs.length,
        disabled: document.querySelector('#rightSidebarAddBtn').disabled
      };
      document.querySelector('#rightSidebarAddBtn').click();
      await settle();
      const afterPlus = {
        count: openRightSidebarTabs.length,
        sameTab: openRightSidebarTabs[0]?.id === blank.id
      };

      // Any tool tab consumes the blank placeholder.
      const review = createRightSidebarTab('review');
      activeRightSidebarTab = review.id;
      renderRightSidebarTabs();
      await settle();
      const afterReview = {
        count: openRightSidebarTabs.length,
        hasBlank: openRightSidebarTabs.some(tab => tab.id === blank.id),
        types: openRightSidebarTabs.map(tab => tab.type),
        disabled: document.querySelector('#rightSidebarAddBtn').disabled
      };

      // Agent-owned tabs must stay pinned while user tabs overflow.
      openRightSidebarTabs.splice(0, openRightSidebarTabs.length);
      const agent = createRightSidebarTab('browser', { agentRunId: 'run-1', agentOwned: true });
      const agentController = getBrowserTabController(agent.id);
      if (agentController) agentController.currentUrl = 'https://example.com/agent';
      for (let index = 0; index < 5; index += 1) {
        openRightSidebarTabs.push({ id: `user-${index}`, type: 'browser', label: `User ${index}`, favicon: '' });
      }
      activeRightSidebarTab = agent.id;
      const sidebar = document.querySelector('#rightSidebar');
      sidebar.style.width = '470px';
      window.dispatchEvent(new Event('resize'));
      renderRightSidebarTabs();
      await settle();
      const units = [...document.querySelectorAll('#rightSidebarTabStrip > .rs-tab-unit')];
      const agentUnit = units.find(unit => unit.dataset.rsTabUnit === agent.id);
      const agentVisible = !!agentUnit && !agentUnit.hidden;
      const agentWidth = agentUnit?.getBoundingClientRect().width || 0;
      const hiddenCount = units.filter(unit => unit.hidden).length;

      // The Agent conversation tab must also stay pinned while user tabs overflow.
      browserFocusMode = true;
      fullChatSelected = false;
      renderRightSidebarTabs();
      await settle();
      const chatUnit = document.querySelector('#rightSidebarTabStrip [data-agent-chat-tab]')?.closest('.rs-tab-unit');
      const chatPinned = !!chatUnit && !chatUnit.hidden;
      browserFocusMode = false;
      fullChatSelected = false;
      renderRightSidebarTabs();
      await settle();

      return {
        blankState,
        afterPlus,
        afterReview,
        agentVisible,
        agentWidth,
        hiddenCount,
        chatPinned
      };
    });
    assert.equal(behavior.blankState.count, 1, 'only one blank tab may exist');
    assert.equal(behavior.blankState.disabled, false, 'the + button is never disabled');
    assert.equal(behavior.afterPlus.count, 1, 'clicking + reuses the blank tab instead of stacking');
    assert.equal(behavior.afterPlus.sameTab, true, 'the blank tab is reused in place');
    assert.equal(behavior.afterReview.count, 1, 'opening a tool tab consumes the blank tab');
    assert.equal(behavior.afterReview.hasBlank, false, 'no blank tab is left behind');
    assert.deepEqual(behavior.afterReview.types, ['review'], 'the tool tab replaced the blank tab');
    assert.equal(behavior.afterReview.disabled, false, 'the + button stays usable after replacing the blank tab');
    assert.equal(behavior.agentVisible, true, 'agent-owned tab must stay pinned');
    assert.equal(behavior.agentWidth, 200, 'pinned agent tab keeps the 200px width');
    assert.equal(behavior.chatPinned, true, 'the Agent conversation tab must stay pinned');

    assert.ok(report.base.widths.length >= 1, 'base layout should show the fixed-width tabs');
    assert.ok(report.base.widths.every(width => Math.abs(width - 200) < 0.5), 'every tab should be exactly 200px');
    assert.equal(report.base.fixedWidth, 200, 'tabs should use the fixed 200px width');
    assert.equal(report.base.addWidth, 30, 'the new-tab button should stay a 30px circle');
    assert.equal(report.base.fixedWidth, report.narrow.fixedWidth, 'tab width must not change with the number of tabs');
    assert.ok(report.base.addGap >= 0 && report.base.addGap < 8, 'new tab button should follow the last visible tab');
    assert.ok(report.narrow.hiddenCount > 0, 'narrow layout should hide old tabs');
    assert.equal(report.narrow.overflowCount, report.narrow.hiddenCount, 'overflow menu should list hidden tabs');
    assert.equal(report.narrow.overflowHead, '隐藏的标签页', 'overflow menu shows its header');
    assert.equal(report.narrow.overflowItemRadius, '0px', 'overflow rows use a strict rectangle');
    assert.notEqual(report.narrow.overflowMenuRadius, '0px', 'overflow panel keeps rounded corners');
    assert.equal(report.narrow.overflowHidden, false, 'overflow trigger should be visible when tabs are hidden');
    assert.ok(report.narrow.widths.every(width => Math.abs(width - 200) < 0.5), 'visible tabs keep the fixed width');
    assert.ok(report.narrow.addGap === null || (report.narrow.addGap >= 0 && report.narrow.addGap < 8), 'new tab button stays after visible tabs');
    console.log(JSON.stringify({ ok: true, ...report }));
  } finally {
    if (application) await application.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
