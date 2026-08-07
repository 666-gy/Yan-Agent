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
  const tools = {
    open: 'open_builtin_browser',
    snapshot: 'browser_snapshot',
    read_page: 'browser_read_page',
    click: 'browser_click',
    type: 'browser_type',
    select: 'browser_select',
    check: 'browser_check',
    hover: 'browser_hover',
    focus: 'browser_focus',
    drag: 'browser_drag',
    pointer: 'browser_pointer',
    press: 'browser_press',
    scroll: 'browser_scroll',
    wait: 'browser_wait',
    screenshot: 'browser_screenshot',
    inspect_page: 'browser_inspect_page',
    history: 'browser_history',
    status: 'browser_status'
  };
  const toolName = tools[action];
  assert.ok(toolName, `No MCP tool mapping for ${action}`);
  return page.evaluate(async ({ runId: id, tool, params: input }) => {
      const response = await window.yan.mcpCallTool(
        'yan_browser',
        tool,
        input,
        id
    );
    if (response?.error) return { ok: false, error: response.error, code: response.code || 'MCP_CALL_FAILED' };
    let parsed;
    try { parsed = JSON.parse(response?.result || '{}'); }
    catch { parsed = { ok: !response?.isError, output: String(response?.result || '') }; }
    if (response?.images?.[0]) parsed.image = response.images[0];
    return parsed;
  }, { runId, tool: toolName, params });
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
    await page.waitForFunction(() => (
      typeof openBrowserUrlInNewTab === 'function'
      && typeof executeBrowserAgentCommand === 'function'
    ));
    const kernel = await page.evaluate(() => window.yan.getConfig().then(config => config.executionKernel));
    assert.equal(kernel.id, 'yan-kernel');
    assert.equal(kernel.name, 'Yan Kernel');
    assert.equal(kernel.version, '1.4.0');
    assert.equal(kernel.engine, 'opencode');
    assert.equal(kernel.engineVersion, '1.18.11');

    const retiredDesktopControl = await page.evaluate(async () => {
      const [config, servers, catalog] = await Promise.all([
        window.yan.getConfig(),
        window.yan.mcpList(),
        window.yan.getSkillCatalog()
      ]);
      return {
        hasLegacyConfig: Object.hasOwn(config, 'computerUseV3'),
        hasLegacyMcp: servers.some(server => server.id === 'mcp_default_windows'),
        hasLegacySkill: [...(catalog.installed || []), ...(catalog.market || [])]
          .some(skill => skill.id === 'yan-computer-use'),
        hasLegacySettings: !!document.querySelector('#computerUseV3Enabled, #computerUseV3Actor')
      };
    });
    assert.deepEqual(retiredDesktopControl, {
      hasLegacyConfig: false,
      hasLegacyMcp: false,
      hasLegacySkill: false,
      hasLegacySettings: false
    });

    await page.locator('#attachBtn').click();
    const addMenuHeadings = await page.evaluate(() => {
      const add = document.querySelector('#composerAddSectionTitle');
      const skill = document.querySelector('#composerSkillSectionTitle')?.closest('.composer-add-section-title');
      const summarize = element => {
        const style = getComputedStyle(element);
        return {
          minHeight: style.minHeight,
          padding: style.padding,
          color: style.color,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          backgroundColor: style.backgroundColor
        };
      };
      return {
        addText: add?.textContent?.trim(),
        skillText: skill?.textContent?.trim(),
        add: summarize(add),
        skill: summarize(skill)
      };
    });
    assert.equal(addMenuHeadings.addText, '添加');
    assert.equal(addMenuHeadings.skillText, '技能');
    assert.deepEqual(addMenuHeadings.skill, addMenuHeadings.add);
    await page.screenshot({ path: addMenuScreenshotPath });
    await page.locator('#attachBtn').click();

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
        label: agentRoot.querySelector('[data-browser-role="agent-control-label"]')?.textContent,
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
    assert.equal(takeover.label, 'Agent正在操控该网页，按Esc退出');
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
    assert.ok(ref('Run action'));
    assert.ok(ref('Mode'));
    assert.ok(ref('Enable feature'));
    assert.ok(ref('Hover target'));
    assert.ok(ref('Drag source'));
    assert.ok(ref('Drop target'));
    assert.ok(canvasItem?.ref);

    await command(page, runId, 'type', { ref: ref('Name'), text: 'Yan Agent' });
    await command(page, runId, 'select', { ref: ref('Mode'), value: 'advanced' });
    await command(page, runId, 'check', { ref: ref('Enable feature'), checked: true });
    await command(page, runId, 'hover', { ref: ref('Hover target') });
    await command(page, runId, 'drag', { from_ref: ref('Drag source'), to_ref: ref('Drop target') });
    await page.evaluate(id => {
      const agent = browserTabControllers.get(id).agent;
      agent.__e2eSendMouse = agent.sendMouse;
      agent.sendMouse = () => {};
    }, agentTabId);
    const verifiedClick = await command(page, runId, 'click', { ref: ref('Run action') });
    await page.evaluate(id => {
      const agent = browserTabControllers.get(id).agent;
      agent.sendMouse = agent.__e2eSendMouse;
      delete agent.__e2eSendMouse;
    }, agentTabId);
    assert.equal(verifiedClick.ok, true);
    assert.equal(verifiedClick.delivery, 'verified-dom-fallback');
    assert.equal(verifiedClick.eventReceived, true);
    assert.equal(verifiedClick.pageChanged, true);
    await page.evaluate(async id => {
      await browserTabControllers.get(id).webview.executeJavaScript(
        "document.getElementById('actionButton').disabled = true",
        true
      );
    }, agentTabId);
    const rejectedClick = await command(page, runId, 'click', { ref: ref('Run action') });
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
    await command(page, runId, 'pointer', { action: 'click', x: canvasItem.rect.x, y: canvasItem.rect.y });
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

    const inspection = await command(page, runId, 'inspect_page');
    assert.equal(inspection.ok, true);
    assert.ok(inspection.brokenImages.length >= 1);
    assert.ok(inspection.invalidFields.includes('requiredEmail'));
    assert.ok(inspection.canvases.length >= 1);
    assert.ok(inspection.canvases[0].sample.pixelCoverage < 0.1);
    assert.ok(inspection.canvases[0].warnings.some(message => message.includes('transparent or unpainted')));
    assert.ok(inspection.diagnostics.console.some(entry => String(entry.message || entry).includes('fixture console diagnostic')));
    const screenshot = await command(page, runId, 'screenshot');
    assert.equal(screenshot.ok, true);
    assert.ok(screenshot.image.data.length > 1000);
    assert.equal(screenshot.captureState.title, 'Yan Browser Agent Fixture');
    assert.ok(screenshot.captureState.text.includes('action complete'));

    await page.screenshot({ path: screenshotPath });
    const finalPointer = await application.evaluate(({ screen }) => screen.getCursorScreenPoint());
    assert.deepEqual(finalPointer, initialPointer);
    const cursorVisible = await page.evaluate(id => {
      const root = document.querySelector(`[data-browser-tab-id="${id}"]`);
      return root.querySelector('[data-browser-role="agent-cursor"]')?.classList.contains('visible');
    }, agentTabId);
    assert.equal(cursorVisible, true);

    await page.keyboard.press('Escape');
    await page.waitForFunction(id => !document.querySelector(`[data-browser-tab-id="${id}"]`)?.classList.contains('agent-controlled'), agentTabId);
    const retainedRightWidth = await page.evaluate(() => (
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rs-w')) || 0
    ));
    assert.equal(retainedRightWidth, expandedRightWidth);
    const afterEscape = await command(page, runId, 'status');
    assert.equal(afterEscape.code, 'BROWSER_AGENT_CONTROL_RELEASED');

    const closeRunId = 'browser-e2e-close';
    const closeOpened = await command(page, closeRunId, 'open', { target_type: 'url', url_or_path: agentUrl });
    assert.equal(closeOpened.ok, true);
    await page.locator(`[data-rs-close-tab="${closeOpened.tabId}"]`).click();
    const reopenAfterClose = await command(page, closeRunId, 'open', { target_type: 'url', url_or_path: agentUrl });
    assert.equal(reopenAfterClose.code, 'BROWSER_AGENT_CONTROL_RELEASED');

    const releaseRunId = 'browser-e2e-release';
    const releaseOpened = await command(page, releaseRunId, 'open', { target_type: 'url', url_or_path: agentUrl });
    assert.equal(releaseOpened.ok, true);
    const released = await releaseCommand(page, releaseRunId);
    assert.equal(released.ok, true);
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
