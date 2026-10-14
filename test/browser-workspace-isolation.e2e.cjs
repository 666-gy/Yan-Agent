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
    assert.notEqual(result.backgroundA.tabId, result.openedA.tabId);
    assert.equal(result.backgroundA.activeStayedOnB, true);
    const concurrent = await page.evaluate(async fixtureUrl => {
      const scope = { yan_workspace: 'C:/YanWorkspace/workspace-b', yan_session_id: state.currentSession.id };
      const open = id => executeBrowserAgentCommand({ action: 'open', params: {
        ...scope, yan_run_id: id, target_type: 'url', url_or_path: fixtureUrl + '?owner=' + id } });
      const [a, b] = await Promise.all([open('parallel-a'), open('parallel-b')]);
      const read = id => executeBrowserAgentCommand({ action: 'read_page', params: { ...scope, yan_run_id: id } });
      const [readA, readB] = await Promise.all([read('parallel-a'), read('parallel-b')]);
      const snapshot = id => executeBrowserAgentCommand({ action: 'snapshot', params: { ...scope, yan_run_id: id } });
      const [snapshotA, snapshotB] = await Promise.all([snapshot('parallel-a'), snapshot('parallel-b')]);
      const type = (id, snapshot, text) => executeBrowserAgentCommand({ action: 'type', params: {
        ...scope, yan_run_id: id, ref: snapshot.items.find(item => item.name === 'Name').ref, text } });
      const typed = await Promise.all([type('parallel-a', snapshotA, 'value-a'), type('parallel-b', snapshotB, 'value-b')]);
      const values = await Promise.all([snapshot('parallel-a'), snapshot('parallel-b')]);
      const controllerA = browserTabControllers.get(a.tabId);
      const controllerB = browserTabControllers.get(b.tabId);
      const hijackRejected = setBrowserAgentControl(controllerA, true, { runId: 'parallel-b' }) === false;
      await executeBrowserAgentCommand({ action: 'release', params: { yan_run_id: 'parallel-a' } });
      return { a, b, readA, readB, typed: typed.map(result => result.ok), values: values.map(snapshot => snapshot.items.find(item => item.name === 'Name').state.value), hijackRejected,
        bStillOwned: controllerB.agentControlActive && controllerB.agentRunId === 'parallel-b',
        owners: [controllerA.agentRunId, controllerB.agentRunId] };
    }, fixture);
    assert.equal(concurrent.a.ok, true);
    assert.equal(concurrent.b.ok, true);
    assert.notEqual(concurrent.a.tabId, concurrent.b.tabId);
    assert.ok(JSON.stringify(concurrent.readA).includes('owner=parallel-a'));
    assert.ok(JSON.stringify(concurrent.readB).includes('owner=parallel-b'));
    assert.deepEqual(concurrent.typed, [true, true]);
    assert.deepEqual(concurrent.values, ['value-a', 'value-b']);
    assert.equal(concurrent.hijackRejected, true);
    assert.equal(concurrent.bStillOwned, true);
    const handoff = await page.evaluate(async fixtureUrl => {
      const scope = { yan_workspace: 'C:/YanWorkspace/handoff', yan_session_id: state.currentSession.id };
      const open = id => executeBrowserAgentCommand({ action: 'open', params: {
        ...scope, yan_run_id: id, target_type: 'url', url_or_path: fixtureUrl } });
      const a = await open('cleanup-a');
      const controller = browserTabControllers.get(a.tabId);
      const original = controller.agent.releaseActions.bind(controller.agent);
      let finish;
      const gate = new Promise(resolve => { finish = resolve; });
      controller.agent.releaseActions = async () => { await gate; return original(); };
      const release = executeBrowserAgentCommand({ action: 'release', params: { yan_run_id: 'cleanup-a' } });
      try {
        const b = await open('cleanup-b');
        const again = await open('cleanup-b');
        const missing = await executeBrowserAgentCommand({ action: 'status', params: { ...scope, yan_run_id: 'cleanup-c' } });
        return { a, b, again, missing, aStillCleaning: !!controller.agentReleasePromise };
      } finally {
        finish();
        await release;
      }
    }, fixture);
    assert.equal(handoff.b.ok, true);
    assert.notEqual(handoff.a.tabId, handoff.b.tabId);
    assert.equal(handoff.again.tabId, handoff.b.tabId);
    assert.equal(handoff.aStillCleaning, true);
    assert.equal(handoff.missing.code, 'BROWSER_NOT_OPEN');
    console.log(JSON.stringify({ ok: true, result, concurrent }));
  } finally {
    await application?.close().catch(() => {});
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
