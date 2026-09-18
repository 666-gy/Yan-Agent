'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const fixtureUrl = pathToFileURL(path.join(__dirname, 'fixtures', 'browser-agent.html')).href;
const userUrl = `${fixtureUrl}?owner=user`;
const agentUrl = `${fixtureUrl}?owner=agent`;
const targetPath = String(process.env.YAN_E2E_TARGET_PATH || '').trim();
const targetClickName = String(process.env.YAN_E2E_TARGET_CLICK_NAME || '').trim();
const targetKey = String(process.env.YAN_E2E_TARGET_KEY || '').trim();
const targetKeyDuration = Math.max(30, Math.min(5000, Number(process.env.YAN_E2E_TARGET_KEY_DURATION_MS) || 600));
const targetKeyDelay = Math.max(0, Math.min(10000, Number(process.env.YAN_E2E_TARGET_KEY_DELAY_MS) || 0));
const targetUrl = targetPath ? pathToFileURL(path.resolve(targetPath)).href : '';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-browser-e2e-'));
const screenshotPath = path.join(os.tmpdir(), `yan-browser-agent-takeover-${Date.now()}.png`);
const addMenuScreenshotPath = path.join(os.tmpdir(), `yan-composer-add-menu-${Date.now()}.png`);
const targetScreenshotPath = path.join(os.tmpdir(), `yan-browser-agent-target-${Date.now()}.png`);

async function command(page, runId, action, params = {}) {
  return page.evaluate(({ runId: id, action: browserAction, params: input }) => (
    executeBrowserAgentCommand({
      action: browserAction,
      params: { ...input, yan_run_id: id }
    })
  ), { runId, action, params });
}

async function concurrentCommands(page, runId, commands) {
  return page.evaluate(({ runId: id, commands: browserCommands }) => Promise.all(
    browserCommands.map((entry, index) => executeBrowserAgentCommand({
      requestId: `${id}-concurrent-${index}`,
      action: entry.action,
      params: { ...(entry.params || {}), yan_run_id: id }
    }))
  ), { runId, commands });
}

async function releaseCommand(page, runId) {
  return page.evaluate(id => executeBrowserAgentCommand({
    action: 'release',
    params: { yan_run_id: id }
  }), runId);
}

async function guestState(page, tabId) {
  return page.evaluate(async id => {
    const controller = browserTabControllers.get(id);
    return controller.webview.executeJavaScript(`(() => ({
      action: document.getElementById('actionState')?.textContent,
      name: document.getElementById('nameInput')?.value,
      mode: document.getElementById('modeSelect')?.value,
      checked: document.getElementById('featureCheck')?.checked,
      hover: document.getElementById('hoverState')?.textContent,
      drag: document.getElementById('dragState')?.textContent,
      canvas: document.getElementById('canvasState')?.textContent,
      keyboard: {
        x: Number(document.getElementById('keyboardState')?.dataset.x || 0),
        down: Number(document.getElementById('keyboardState')?.dataset.down || 0),
        up: Number(document.getElementById('keyboardState')?.dataset.up || 0),
        held: document.getElementById('keyboardState')?.dataset.held === 'true'
      },
      scrollY: window.scrollY
    }))()`, true);
  }, tabId);
}

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
    const rendererErrors = [];
    page.on('pageerror', error => rendererErrors.push(error?.stack || error?.message || String(error)));
    page.on('console', message => {
      if (message.type() === 'error') rendererErrors.push(message.text());
    });
    try {
      await page.waitForFunction(() => {
        try {
          return typeof openBrowserUrlInNewTab === 'function'
            && typeof executeBrowserAgentCommand === 'function'
            && browserTabControllers instanceof Map
            && document.readyState === 'complete';
        } catch {
          return false;
        }
      }, null, { timeout: 10_000 });
    } catch (error) {
      throw new Error(`Yan Renderer did not finish browser initialization: ${rendererErrors.join('\n') || error.message}`);
    }
    const kernel = await page.evaluate(() => window.yan.getConfig().then(config => config.executionKernel));
    assert.equal(kernel.id, 'yan-kernel');
    assert.equal(kernel.name, 'Yan Kernel');
    assert.equal(kernel.version, '1.4.0');
    assert.equal(kernel.engine, 'opencode');
    assert.equal(kernel.engineVersion, '1.18.11');

    const computerControlIntegration = await page.evaluate(async () => {
      const [config, servers, installedSkills, marketSkills] = await Promise.all([
        window.yan.getConfig(),
        window.yan.mcpList(),
        window.yan.listSkills(),
        window.yan.getSkillMarket()
      ]);
      return {
        hasLegacyConfig: Object.hasOwn(config, 'computerUseV3'),
        hasLegacyMcp: servers.some(server => server.id === 'mcp_default_windows'),
        hasLegacySettings: !!document.querySelector('#computerUseV3Enabled, #computerUseV3Actor')
      };
    });
    if (process.env.YAN_BROWSER_E2E_SKIP_COMPUTER_CONTROL_CHECK !== '1') {
      assert.deepEqual(computerControlIntegration, {
        hasLegacyConfig: false,
        hasLegacyMcp: false,
        hasLegacySettings: false
      });
    }

    if (process.env.YAN_BROWSER_E2E_SKIP_COMPUTER_CONTROL_CHECK !== '1') {
      await page.locator('#attachBtn').click();
      const addMenu = await page.evaluate(() => ({
        labels: [...document.querySelectorAll('#attachmentMenu .composer-add-action-name')]
          .map(element => element.textContent.trim()),
        role: document.querySelector('#attachmentMenu')?.getAttribute('role'),
        workModeLauncherExpanded: document.querySelector('#composerSkillWorkModeAction')?.getAttribute('aria-expanded')
      }));
      assert.deepEqual(addMenu.labels.slice(0, 3), ['添加附件', '优化你的prompt', '使用/选择技能或工作方式']);
      assert.equal(addMenu.role, 'menu');
      assert.equal(addMenu.workModeLauncherExpanded, 'false');
      await page.screenshot({ path: addMenuScreenshotPath });
      await page.locator('#attachBtn').click();
    }

    const mcpReady = await page.evaluate(async () => {
      const servers = await window.yan.mcpList();
      const browser = servers.find(server => server.id === 'yan_browser');
      if (!browser?.available || !browser?.enabled) return { ok: false, browser };
      return window.yan.mcpStart('yan_browser');
    });
    assert.equal(mcpReady.ok, true);
    assert.ok(mcpReady.tools.some(tool => tool.name === 'browser_inspect_page'));
    assert.equal(mcpReady.tools.some(tool => tool.name === 'computer_use'), false);
    const pressTool = mcpReady.tools.find(tool => tool.name === 'browser_press');
    assert.ok(pressTool?.inputSchema?.properties?.duration_ms);
    assert.equal(Object.hasOwn(pressTool.inputSchema.properties, 'yan_run_id'), false);

    const initialPointer = await application.evaluate(({ screen }) => screen.getCursorScreenPoint());
    assert.equal(await page.evaluate(url => openBrowserUrlInNewTab(url), userUrl), true);
    await page.waitForFunction(expected => (
      [...document.querySelectorAll('webview')].some(view => String(view.getURL?.() || '').includes(expected))
    ), 'owner=user');

    const runId = 'browser-e2e-main';
    const initialRightWidth = await page.evaluate(() => (
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rs-w')) || 360
    ));
    const opened = await command(page, runId, 'open', { target_type: 'url', url_or_path: agentUrl });
    assert.equal(opened.ok, true);
    assert.equal(opened.created, true);
    const agentTabId = opened.tabId;

    const takeover = await page.evaluate(({ agentTabId: id, userMarker }) => {
      const roots = [...document.querySelectorAll('[data-browser-tab-id]')];
      const agentRoot = document.querySelector(`[data-browser-tab-id="${id}"]`);
      const controls = [...agentRoot.querySelectorAll('[data-browser-action]')]
        .map(button => ({ action: button.dataset.browserAction, disabled: button.disabled }));
      const takeoverElement = agentRoot.querySelector('[data-browser-role="agent-takeover"]');
      const takeoverStyle = getComputedStyle(takeoverElement);
      return {
        tabCount: roots.length,
        urls: roots.map(root => root.querySelector('webview')?.getURL?.() || ''),
        controlled: agentRoot.classList.contains('agent-controlled'),
        label: agentRoot.querySelector('[data-browser-role="agent-control-label"] span')?.textContent?.trim(),
        handButton: !!agentRoot.querySelector('.browser-agent-control-label-button'),
        topStatusHidden: getComputedStyle(
          agentRoot.querySelector('[data-browser-role="agent-status"]')
        ).display === 'none',
        shieldFocused: document.activeElement === agentRoot.querySelector('[data-browser-role="agent-input-shield"]'),
        takeoverVisible: takeoverStyle.visibility === 'visible' && Number(takeoverStyle.opacity) === 1,
        controls,
        addressDisabled: agentRoot.querySelector('[data-browser-role="url"]')?.disabled,
        userUrlIntact: roots.some(root => String(root.querySelector('webview')?.getURL?.() || '').includes(userMarker)),
        rightWidth: document.querySelector('#rightSidebar')?.getBoundingClientRect().width || 0
      };
    }, { agentTabId, userMarker: 'owner=user' });
    assert.equal(takeover.tabCount, 2);
    assert.equal(takeover.userUrlIntact, true);
    assert.equal(takeover.controlled, true);
    assert.equal(takeover.takeoverVisible, true);
    assert.equal(takeover.label, 'Yan Agent正在操控Browser');
    assert.equal(takeover.handButton, true);
    assert.equal(takeover.topStatusHidden, true);
    assert.equal(takeover.shieldFocused, true);
    assert.equal(takeover.addressDisabled, true);
    assert.equal(takeover.controls.find(item => item.action === 'reload')?.disabled, false);
    assert.equal(takeover.controls.filter(item => item.action !== 'reload').every(item => item.disabled), true);
    assert.ok(takeover.rightWidth >= initialRightWidth + 80, JSON.stringify({ initialRightWidth, expanded: takeover.rightWidth }));
    const expandedRightWidth = await page.evaluate(() => (
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rs-w')) || 0
    ));

    const snapshot = await command(page, runId, 'snapshot');
    assert.equal(snapshot.ok, true);
    assert.ok(snapshot.items.length >= 8);
    const itemNamed = name => snapshot.items.find(item => String(item.name || '').includes(name));
    const ref = name => itemNamed(name)?.ref;
    const canvasItem = snapshot.items.find(item => item.name === 'Test canvas');
    assert.ok(ref('Name'));
    assert.ok(ref('Password'));
    assert.ok(ref('Run action'));
    assert.ok(ref('Mode'));
    assert.ok(ref('Enable feature'));
    assert.ok(ref('Hover target'));
    assert.ok(ref('Drag source'));
    assert.ok(ref('Drop target'));
    assert.ok(canvasItem?.ref);
    const passwordItem = itemNamed('Password');
    assert.equal(passwordItem.state.value, undefined);
    assert.equal(passwordItem.state.hasValue, true);
    assert.equal(snapshot.output.includes('fixture-secret'), false);

    const freshSnapshot = await command(page, runId, 'snapshot');
    assert.equal(freshSnapshot.ok, true);
    assert.notEqual(freshSnapshot.snapshotId, snapshot.snapshotId);
    assert.equal(freshSnapshot.items.some(item => snapshot.items.some(previous => previous.ref === item.ref)), false);
    const staleRef = await command(page, runId, 'focus', { ref: ref('Name') });
    assert.equal(staleRef.ok, false);
    assert.equal(staleRef.code, 'STALE_REF');
    const freshItemNamed = name => freshSnapshot.items.find(item => String(item.name || '').includes(name));
    const freshRef = name => freshItemNamed(name)?.ref;
    const freshCanvasItem = freshSnapshot.items.find(item => item.name === 'Test canvas');

    const typed = await command(page, runId, 'type', { ref: freshRef('Name'), text: 'Yan Agent' });
    assert.equal(typed.pageState.target.value, 'Yan Agent');
    assert.equal(typed.pageState.snapshotRequired, false);
    const passwordTyped = await command(page, runId, 'type', { ref: freshRef('Password'), text: 'new-secret' });
    assert.equal(passwordTyped.pageState.target.value, '[redacted]');
    assert.equal(JSON.stringify(passwordTyped).includes('new-secret'), false);
    const selected = await command(page, runId, 'select', { ref: freshRef('Mode'), value: 'advanced' });
    assert.equal(selected.pageState.target.value, 'advanced');
    const checked = await command(page, runId, 'check', { ref: freshRef('Enable feature'), checked: true });
    assert.equal(checked.pageState.target.checked, true);
    await command(page, runId, 'hover', { ref: freshRef('Hover target') });
    await command(page, runId, 'drag', { from_ref: freshRef('Drag source'), to_ref: freshRef('Drop target') });
    await page.evaluate(id => {
      const agent = browserTabControllers.get(id).agent;
      agent.__e2eSendMouse = agent.sendMouse;
      agent.sendMouse = () => {};
    }, agentTabId);
    const verifiedClick = await command(page, runId, 'click', { ref: freshRef('Run action') });
    await page.evaluate(id => {
      const agent = browserTabControllers.get(id).agent;
      agent.sendMouse = agent.__e2eSendMouse;
      delete agent.__e2eSendMouse;
    }, agentTabId);
    assert.equal(verifiedClick.ok, true);
    assert.equal(verifiedClick.delivery, 'verified-dom-fallback');
    assert.equal(verifiedClick.eventReceived, true);
    assert.equal(verifiedClick.pageChanged, true);
    assert.equal(verifiedClick.pageState.changed, true);
    await page.evaluate(async id => {
      await browserTabControllers.get(id).webview.executeJavaScript(
        "document.getElementById('actionButton').disabled = true",
        true
      );
    }, agentTabId);
    const rejectedClick = await command(page, runId, 'click', { ref: freshRef('Run action') });
    assert.equal(rejectedClick.ok, false);
    assert.equal(rejectedClick.code, 'CLICK_NOT_DELIVERED');
    await page.evaluate(async id => {
      await browserTabControllers.get(id).webview.executeJavaScript(
        "document.getElementById('actionButton').disabled = false",
        true
      );
    }, agentTabId);
    await page.evaluate(id => {
      const agent = browserTabControllers.get(id).agent;
      agent.__e2eSendKey = agent.sendKey;
      agent.sendKey = () => {};
    }, agentTabId);
    let heldKey;
    try {
      heldKey = await command(page, runId, 'press', { key: 'ArrowRight', duration_ms: 260 });
    } finally {
      await page.evaluate(id => {
        const agent = browserTabControllers.get(id).agent;
        agent.sendKey = agent.__e2eSendKey;
        delete agent.__e2eSendKey;
      }, agentTabId);
    }
    assert.equal(heldKey.ok, true);
    assert.equal(heldKey.delivery, 'verified-dom-fallback');
    assert.equal(heldKey.keydownReceived, true);
    assert.equal(heldKey.keyupReceived, true);
    assert.ok(heldKey.durationMs >= 240);
    await command(page, runId, 'pointer', { action: 'click', x: freshCanvasItem.rect.x, y: freshCanvasItem.rect.y });
    await command(page, runId, 'scroll', { direction: 'down', amount: 600 });
    const waited = await command(page, runId, 'wait', { text: 'action complete', timeout_ms: 1200 });
    assert.equal(waited.ok, true);

    const state = await guestState(page, agentTabId);
    assert.equal(state.action, 'action complete');
    assert.equal(state.name, 'Yan Agent');
    assert.equal(state.mode, 'advanced');
    assert.equal(state.checked, true);
    assert.equal(state.hover, 'hover complete');
    assert.equal(state.drag, 'drop complete');
    assert.ok(String(state.canvas).startsWith('canvas '));
    assert.ok(state.keyboard.x >= 45);
    assert.equal(state.keyboard.down, 1);
    assert.equal(state.keyboard.up, 1);
    assert.equal(state.keyboard.held, false);
    assert.ok(state.scrollY > 0);

    const queueStartedAt = Date.now();
    const [firstWait, secondWait] = await concurrentCommands(page, runId, [
      { action: 'wait', params: { timeout_ms: 500 } },
      { action: 'wait', params: { timeout_ms: 500 } }
    ]);
    assert.equal(firstWait.ok, true);
    assert.equal(secondWait.ok, true);
    assert.ok(Date.now() - queueStartedAt >= 900, 'Concurrent browser actions must execute serially');

    const cancellation = await page.evaluate(async ({ runId: id }) => {
      const controller = getAgentBrowserController(id);
      const operationId = `${id}-cancel-one`;
      const pending = executeBrowserAgentCommand({
        requestId: operationId,
        action: 'wait',
        params: { yan_run_id: id, timeout_ms: 5000 }
      });
      await new Promise(resolve => setTimeout(resolve, 80));
      const cancelled = controller.agent.cancelOperation(operationId);
      return { cancelled, result: await pending };
    }, { runId });
    assert.equal(cancellation.cancelled, true);
    assert.equal(cancellation.result.code, 'BROWSER_ACTION_CANCELLED');
    const afterCancel = await command(page, runId, 'status');
    assert.equal(afterCancel.ok, true);

    const inspection = await command(page, runId, 'inspect_page');
    assert.equal(inspection.ok, true);
    assert.ok(inspection.brokenImages.length >= 1);
    assert.ok(inspection.invalidFields.includes('requiredEmail'));
    assert.ok(inspection.canvases.length >= 1);
    assert.ok(inspection.canvases[0].sample.pixelCoverage < 0.1);
    assert.ok(inspection.canvases[0].warnings.some(message => message.includes('transparent or unpainted')));
    assert.ok(inspection.diagnostics.console.some(entry => String(entry.message || entry).includes('fixture console diagnostic')));
    const returnedToTop = await command(page, runId, 'scroll', { direction: 'up', amount: 1200 });
    assert.equal(returnedToTop.ok, true);
    const screenshot = await command(page, runId, 'screenshot');
    assert.equal(screenshot.ok, true);
    assert.ok(screenshot.image.data.length > 1000);
    assert.equal(screenshot.captureState.title, 'Yan Browser Agent Fixture');
    assert.ok(screenshot.captureState.text.includes('action complete'));
    await page.screenshot({ path: screenshotPath });

    const reloaded = await command(page, runId, 'reload');
    assert.equal(reloaded.ok, true);
    assert.equal(reloaded.navigationCompleted, true);
    const staleAfterNavigation = await command(page, runId, 'focus', { ref: freshRef('Name') });
    assert.equal(staleAfterNavigation.ok, false);
    assert.equal(staleAfterNavigation.code, 'STALE_REF');

    const finalPointer = await application.evaluate(({ screen }) => screen.getCursorScreenPoint());
    assert.deepEqual(finalPointer, initialPointer);
    const cursorVisible = await page.evaluate(id => {
      const root = document.querySelector(`[data-browser-tab-id="${id}"]`);
      return root.querySelector('[data-browser-role="agent-cursor"]')?.classList.contains('visible');
    }, agentTabId);
    assert.equal(cursorVisible, true);

    await page.locator(
      `[data-browser-tab-id="${agentTabId}"] .browser-agent-control-label-button`
    ).click();
    await page.waitForFunction(id => !document.querySelector(`[data-browser-tab-id="${id}"]`)?.classList.contains('agent-controlled'), agentTabId);
    const retainedRightWidth = await page.evaluate(() => (
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rs-w')) || 0
    ));
    assert.equal(retainedRightWidth, expandedRightWidth);
    const afterEscape = await command(page, runId, 'status');
    assert.equal(afterEscape.code, 'BROWSER_AGENT_CONTROL_RELEASED');

    // A later task must reclaim the retained Agent tab without opening it
    // again. This mirrors a user starting a second conversation after the
    // first browser task has completed.
    const sequentialRunId = 'browser-e2e-sequential';
    const sequentialStatus = await command(page, sequentialRunId, 'status');
    assert.equal(sequentialStatus.ok, true);
    assert.equal(sequentialStatus.tabId, agentTabId);
    assert.equal(sequentialStatus.agentControlled, true);
    await releaseCommand(page, sequentialRunId);

    const closeRunId = 'browser-e2e-close';
    const closeOpened = await command(page, closeRunId, 'open', { target_type: 'url', url_or_path: agentUrl });
    assert.equal(closeOpened.ok, true);
    await page.locator(`[data-rs-close-tab="${closeOpened.tabId}"]`).click();
    const reopenAfterClose = await command(page, closeRunId, 'open', { target_type: 'url', url_or_path: agentUrl });
    assert.equal(reopenAfterClose.code, 'BROWSER_AGENT_CONTROL_RELEASED');

    const releaseRunId = 'browser-e2e-release';
    const releaseOpened = await command(page, releaseRunId, 'open', { target_type: 'url', url_or_path: agentUrl });
    assert.equal(releaseOpened.ok, true);
    const releaseOutcome = await page.evaluate(async id => {
      const first = executeBrowserAgentCommand({
        requestId: `${id}-release-first`,
        action: 'wait',
        params: { yan_run_id: id, timeout_ms: 5000 }
      });
      const second = executeBrowserAgentCommand({
        requestId: `${id}-release-second`,
        action: 'wait',
        params: { yan_run_id: id, timeout_ms: 5000 }
      });
      await new Promise(resolve => setTimeout(resolve, 80));
      const released = await executeBrowserAgentCommand({ action: 'release', params: { yan_run_id: id } });
      return { released, results: await Promise.all([first, second]) };
    }, releaseRunId);
    const released = releaseOutcome.released;
    assert.equal(released.ok, true);
    assert.deepEqual(releaseOutcome.results.map(result => result.code), [
      'BROWSER_ACTION_CANCELLED',
      'BROWSER_ACTION_CANCELLED'
    ]);
    const releaseState = await page.evaluate(id => {
      const root = document.querySelector(`[data-browser-tab-id="${id}"]`);
      return { exists: !!root, controlled: root?.classList.contains('agent-controlled') };
    }, releaseOpened.tabId);
    assert.deepEqual(releaseState, { exists: true, controlled: false });

    let targetEvidence = null;
    if (targetUrl) {
      assert.ok(targetClickName, 'YAN_E2E_TARGET_CLICK_NAME is required when YAN_E2E_TARGET_PATH is set');
      const targetRunId = 'browser-e2e-target';
      const targetOpened = await command(page, targetRunId, 'open', { target_type: 'url', url_or_path: targetUrl });
      assert.equal(targetOpened.ok, true);
      const targetSnapshot = await command(page, targetRunId, 'snapshot');
      assert.equal(targetSnapshot.ok, true);
      const clickTarget = targetSnapshot.items.find(item => String(item.name || '').includes(targetClickName));
      assert.ok(clickTarget, `Target page does not expose an interactive element named ${targetClickName}`);
      await page.evaluate(id => {
        const agent = browserTabControllers.get(id).agent;
        agent.__e2eSendMouse = agent.sendMouse;
        agent.sendMouse = () => {};
      }, targetOpened.tabId);
      let targetClick;
      try {
        targetClick = await command(page, targetRunId, 'click', { ref: clickTarget.ref });
      } finally {
        await page.evaluate(id => {
          const agent = browserTabControllers.get(id).agent;
          agent.sendMouse = agent.__e2eSendMouse;
          delete agent.__e2eSendMouse;
        }, targetOpened.tabId);
      }
      assert.equal(targetClick.ok, true);
      assert.equal(targetClick.delivery, 'verified-dom-fallback');
      assert.equal(targetClick.eventReceived, true);
      if (targetClick.targetAfter.visible !== false) {
        const clickInspection = await command(page, targetRunId, 'inspect_page');
        assert.equal(targetClick.targetAfter.visible, false, JSON.stringify({
          click: targetClick,
          diagnostics: clickInspection.diagnostics,
          brokenImages: clickInspection.brokenImages
        }));
      }
      const targetAfterSnapshot = await command(page, targetRunId, 'snapshot');
      assert.equal(targetAfterSnapshot.items.some(item => String(item.name || '').includes(targetClickName)), false);
      const targetBeforeKeyScreenshot = targetKey ? await command(page, targetRunId, 'screenshot') : null;
      if (targetBeforeKeyScreenshot?.image?.data) {
        fs.writeFileSync(`${targetScreenshotPath}.before.png`, Buffer.from(targetBeforeKeyScreenshot.image.data, 'base64'));
      }
      if (targetKeyDelay) await command(page, targetRunId, 'wait', { timeout_ms: targetKeyDelay });
      const targetKeyResult = targetKey
        ? await command(page, targetRunId, 'press', { key: targetKey, duration_ms: targetKeyDuration })
        : null;
      if (targetKeyResult) {
        assert.equal(targetKeyResult.ok, true);
        assert.equal(targetKeyResult.keydownReceived, true);
        assert.equal(targetKeyResult.keyupReceived, true);
        assert.ok(targetKeyResult.durationMs >= targetKeyDuration - 20);
      }
      const targetInspection = await command(page, targetRunId, 'inspect_page');
      assert.equal(targetInspection.ok, true);
      const targetScreenshot = await command(page, targetRunId, 'screenshot');
      assert.equal(targetScreenshot.ok, true);
      fs.writeFileSync(targetScreenshotPath, Buffer.from(targetScreenshot.image.data, 'base64'));
      targetEvidence = {
        url: targetUrl,
        click: targetClick,
        key: targetKeyResult,
        canvas: targetInspection.canvases,
        screenshotBeforeKeyPath: targetKey ? `${targetScreenshotPath}.before.png` : '',
        screenshotPath: targetScreenshotPath
      };
      await releaseCommand(page, targetRunId);
    }

    process.stdout.write(`${JSON.stringify({
      ok: true,
      screenshotPath,
      addMenuScreenshotPath,
      agentTabId,
      initialRightWidth,
      expandedRightWidth,
      retainedRightWidth,
      targetEvidence
    })}\n`);
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
