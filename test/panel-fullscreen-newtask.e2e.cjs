'use strict';
// Regression: creating a task while the right panel is fullscreen must return
// to the normal layout. v1.8 briefly kept the fullscreen Agent canvas on the
// new task, which left the panel covering the window ("overflow").
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-panel-fullscreen-'));
const suppliers = [
  { id: 'supplier-a', name: 'Provider A', kind: 'custom', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test', models: [{ id: 'text-a', name: 'Alpha', modelType: 'text' }] },
];
fs.mkdirSync(path.join(profile, 'YanData'), { recursive: true });
fs.writeFileSync(path.join(profile, 'YanData', 'config.json'), JSON.stringify({
  general: { startupAnimation: false },
  api: {
    provider: 'openai', model: 'text-a', connectionsMigrated: true, enabledConnections: ['supplier-a'],
    providerSuppliers: { openai: suppliers }, providerActiveSupplierIds: { openai: 'supplier-a' },
    connections: suppliers.map(s => ({ id: s.id, name: s.name, providerId: 'openai', supplierId: s.id, enabled: true })),
  },
  agentModel: { providerId: 'openai', supplierId: 'supplier-a', modelId: 'text-a', modelType: 'text', name: 'Alpha' },
}));
const evidence = path.join(root, '.yanagent', 'evidence', 'panel-fullscreen-newtask');
fs.mkdirSync(evidence, { recursive: true });

const measure = page => page.evaluate(() => {
  const de = document.documentElement;
  const overflow = [...document.querySelectorAll('#app *')]
    .filter(el => {
      if (document.querySelector('#app').classList.contains('rs-hidden') && el.closest('#rightSidebar')) return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.right > window.innerWidth + 1 || b.bottom > window.innerHeight + 1);
    })
    .slice(0, 5)
    .map(el => ({ id: el.id || null, cls: String(el.className || '').slice(0, 40) }));
  return {
    hiddenPanel: (() => { const el = document.querySelector('#rightSidebar'); const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return { x: r.x, width: r.width, marginRight: c.marginRight, minWidth: c.minWidth, rsWidth: getComputedStyle(document.documentElement).getPropertyValue('--rs-w'), hidden: document.querySelector('#app').classList.contains('rs-hidden') }; })(),
    sessionId: state.currentSession?.id,
    focus: typeof browserFocusMode !== 'undefined' && browserFocusMode,
    fullChat: typeof fullChatSelected !== 'undefined' && fullChatSelected,
    appClass: document.querySelector('#app')?.className || '',
    chatInPanel: document.querySelector('#chatMainColumn')?.parentElement?.id === 'rs-agent-chat',
    headerDisplay: getComputedStyle(document.querySelector('#emptyHeader')).display,
    docOverflow: de.scrollWidth > de.clientWidth + 1 || de.scrollHeight > de.clientHeight + 1,
    overflow,
  };
});

async function newSessionFixture(page) {
  await page.evaluate(async () => {
    await newSession({ forceNew: true });
    state.currentSession.messages = [{ role: 'user', content: 'A task' }];
    state.currentSession.title = 'A task';
    await api.saveSession(state.currentSession);
    await refreshSessions();
    setEmptyState(false);
  });
  await page.waitForTimeout(400);
}

(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    page.setDefaultTimeout(25000);
    await page.waitForFunction(() => window.__YAN_APP_READY__ && typeof state !== 'undefined' && state.currentSession);
    await page.setViewportSize({ width: 1700, height: 1000 });
    await page.waitForTimeout(400);

    // A. Empty panel fullscreen still shows the Agent canvas instead of a blank pane.
    await page.evaluate(() => setRightSidebarOpen(true));
    await page.waitForTimeout(300);
    await page.locator('#rightSidebarFocusBtn').click();
    await page.waitForTimeout(500);
    const stateA = await measure(page);
    assert.equal(stateA.focus, true);
    assert.equal(stateA.fullChat, true, 'empty fullscreen must select the Agent canvas');
    assert.equal(stateA.chatInPanel, true);

    // B. New task from the left sidebar exits fullscreen and restores the layout.
    await page.evaluate(() => setBrowserFocusMode(false));
    await newSessionFixture(page);
    await page.evaluate(() => { openRightSidebarTool('browser'); setBrowserFocusMode(true); });
    await page.waitForTimeout(300);
    await page.locator('[data-agent-chat-tab]').click();
    await page.waitForTimeout(300);
    assert.equal((await measure(page)).fullChat, true, 'fixture should be on the Agent canvas');
    const sidebarSourceId = (await measure(page)).sessionId;
    await page.locator('#newTaskNavBtn').click();
    await page.waitForFunction(id => state.currentSession?.id !== id && !newSessionPromise, sidebarSourceId);
    await page.waitForFunction(() => !document.querySelector('#app').classList.contains('rs-hidden') || document.querySelector('#rightSidebar').getBoundingClientRect().x >= window.innerWidth - 3);
    const stateB = await measure(page);
    assert.notEqual(stateB.sessionId, sidebarSourceId, 'sidebar button must actually switch A to B');
    assert.equal(stateB.focus, false, 'new task must leave fullscreen');
    assert.ok(!stateB.hiddenPanel.hidden || stateB.hiddenPanel.x >= 1697, 'hidden panel must not remain visible inside viewport');
    assert.doesNotMatch(stateB.appClass, /full-agent-chat|browser-focus-mode/);
    assert.equal(stateB.chatInPanel, false, 'chat must return to the main page');
    assert.equal(stateB.docOverflow, false, 'layout must not overflow the window');
    assert.deepEqual(stateB.overflow, []);
    assert.equal(stateB.headerDisplay, 'flex');
    await page.screenshot({ path: path.join(evidence, 'after-sidebar-new.png') });

    // C. New task from the task-bar button behaves the same.
    await newSessionFixture(page);
    await page.evaluate(() => { openRightSidebarTool('browser'); setBrowserFocusMode(true); });
    await page.waitForTimeout(300);
    await page.locator('[data-agent-chat-tab]').click();
    await page.waitForTimeout(300);
    const taskbarSourceId = (await measure(page)).sessionId;
    await page.evaluate(() => document.querySelector('#taskBarNewTask').click());
    await page.waitForFunction(id => state.currentSession?.id !== id && !newSessionPromise, taskbarSourceId);
    await page.waitForFunction(() => !document.querySelector('#app').classList.contains('rs-hidden') || document.querySelector('#rightSidebar').getBoundingClientRect().x >= window.innerWidth - 3);
    const stateC = await measure(page);
    assert.notEqual(stateC.sessionId, taskbarSourceId, 'task-bar handler must actually switch A to B');
    assert.equal(stateC.focus, false, 'task-bar new task must leave fullscreen');
    assert.ok(!stateC.hiddenPanel.hidden || stateC.hiddenPanel.x >= 1697, 'task-bar new task must hide the panel outside viewport');
    assert.doesNotMatch(stateC.appClass, /full-agent-chat|browser-focus-mode/);
    assert.equal(stateC.chatInPanel, false);
    assert.equal(stateC.docOverflow, false);
    assert.deepEqual(stateC.overflow, []);
    await page.screenshot({ path: path.join(evidence, 'after-taskbar-new.png') });

    // D. An active browser tab is still respected while fullscreen.
    await page.evaluate(() => { setBrowserFocusMode(false); closeAllRightSidebarTabs(); openRightSidebarTool('browser'); setBrowserFocusMode(true); });
    await page.waitForTimeout(500);
    const stateD = await measure(page);
    assert.equal(stateD.focus, true);
    assert.equal(stateD.fullChat, false, 'active browser tab should stay selected');

    await page.screenshot({ path: path.join(evidence, 'panel-fullscreen.png') });
    console.log('PASS fullscreen new task exits to the normal layout without overflow');
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('FAIL', error);
  process.exitCode = 1;
});
