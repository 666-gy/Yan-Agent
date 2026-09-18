'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const fixture = pathToFileURL(path.join(__dirname, 'fixtures', 'browser-agent.html')).href;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-browser-workspace-isolation-e2e-'));

async function command(page, runId, action, params = {}) {
  return page.evaluate(({ id, action: name, input }) => executeBrowserAgentCommand({
    action: name,
    params: { ...input, yan_run_id: id }
  }), { id: runId, action, input: params });
}

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
    await page.waitForFunction(() => (
      typeof executeBrowserAgentCommand === 'function'
      && typeof syncAgentBrowserVisibility === 'function'
      && typeof activateRightSidebarTab === 'function'
    ));
    await page.waitForFunction(() => document.readyState === 'complete');

    const result = await page.evaluate(async ({ fixtureUrl }) => {
      if (!state.currentSession) await newSession();
      const session = state.currentSession;
      const workspaceA = 'C:/YanWorkspace/workspace-a';
      const workspaceB = 'C:/YanWorkspace/workspace-b';
      session.workspace = workspaceA;
      const scopeA = { yan_workspace: workspaceA, yan_session_id: session.id };
      const openedA = await executeBrowserAgentCommand({
        action: 'open',
        params: { yan_run_id: 'run-a', ...scopeA, target_type: 'url', url_or_path: `${fixtureUrl}?owner=a` }
      });
      const tabA = openedA.tabId;
      await executeBrowserAgentCommand({ action: 'release', params: { yan_run_id: 'run-a' } });

      session.workspace = workspaceB;
      syncAgentBrowserVisibility();
      const hiddenForeignTab = activateRightSidebarTab(tabA) === false
        && document.querySelector('#app')?.classList.contains('rs-hidden');

      const openedB = await executeBrowserAgentCommand({
        action: 'open',
        params: { yan_run_id: 'run-b', yan_workspace: workspaceB, yan_session_id: session.id, target_type: 'url', url_or_path: `${fixtureUrl}?owner=b` }
      });
      const controllerA = browserTabControllers.get(tabA);
      const controllerB = browserTabControllers.get(openedB.tabId);

      session.workspace = workspaceB;
      const activeBeforeBackgroundA = activeRightSidebarTab;
      const backgroundA = await executeBrowserAgentCommand({
        action: 'open',
        params: { yan_run_id: 'run-a-2', yan_workspace: workspaceA, yan_session_id: session.id, target_type: 'url', url_or_path: `${fixtureUrl}?owner=a2` }
      });
      return {
        openedA: { ok: openedA.ok, tabId: tabA },
        openedB: { ok: openedB.ok, tabId: openedB.tabId },
        distinctTabs: tabA !== openedB.tabId,
        scopes: [controllerA?.agentScopeKey, controllerB?.agentScopeKey],
        hiddenForeignTab,
        backgroundA: { ok: backgroundA.ok, tabId: backgroundA.tabId, activeStayedOnB: activeRightSidebarTab === activeBeforeBackgroundA }
      };
    }, { fixtureUrl: fixture });

    assert.equal(result.openedA.ok, true);
    assert.equal(result.openedB.ok, true);
    assert.equal(result.distinctTabs, true);
    assert.deepEqual(result.scopes, [
      'workspace:c:/yanworkspace/workspace-a',
      'workspace:c:/yanworkspace/workspace-b'
    ]);
    assert.equal(result.hiddenForeignTab, true);
    assert.equal(result.backgroundA.ok, true);
    assert.equal(result.backgroundA.activeStayedOnB, true);
    console.log(JSON.stringify({ ok: true, result }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
