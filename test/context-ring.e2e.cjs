'use strict';

// The composer context readout is now a ring pill to the right of the token
// pill. Its panel is anchored above that pill, carries the compress action in
// the top-left, and shows the blue -> yellow -> red usage bar plus the
// system/tools/messages estimate. This guards the readout, geometry and the
// task-level persistence of the panel.

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
    await page.locator('#yanStartupHello').waitFor({ state: 'detached', timeout: 5000 }).catch(async () => {
      await page.evaluate(() => {
        document.querySelector('#yanStartupHello')?.remove();
        document.querySelector('#app')?.removeAttribute('inert');
      });
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      state.config.general.showContextUsage = true;
      updateContextInfo();
    });

    assert.equal(await page.locator('#contextRingWrap, #contextRingBtn').count(), 0);
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'true', 'empty tasks keep the context panel hidden');
    const diagnostics = await page.evaluate(() => {
      const run = { sessionId: 'diagnostic-fixture', runId: 'diagnostic-run', utility: true, contextUiTokens: 560000 };
      initOpenCodeRunState(run);
      const data = { reason: 'overflow', automatic: true, beforeTokens: 780000, threshold: 800000,
        contextWindow: 1000000, measured: 560000, estimatedTokens: 220000, afterTokens: 1200, estimated: true };
      applyOpenCodeEvent(run, { type: 'yan.context.compression.started', data }, { deferEffects: true });
      const started = run.activeAgentRun.timeline.find(row => row.variant === 'context-compression').content;
      applyOpenCodeEvent(run, { type: 'yan.context.compression.completed', data }, { deferEffects: true });
      const completed = run.activeAgentRun.timeline.find(row => row.variant === 'context-compression').content;
      const session = {};
      persistSessionContextCompression(session, run, run.activeAgentRun);
      const after = run.contextUiTokens;
      applyOpenCodeEvent(run, { type: 'yan.context.compression.completed', data: { reason: 'auto' } }, { deferEffects: true });
      return { started, completed, saved: session.contextCompression, after, unknown: run.contextUiTokens,
        unknownHasSize: Object.hasOwn(run.lastContextCompression, 'afterTokens'),
        measured: openCodeContextTokens({ tokens: { input: 100, output: 10, reasoning: 20, cache: { read: 50, write: 5 } } }) };
    });
    assert.match(diagnostics.started, /服务端上下文超限/);
    assert.match(diagnostics.completed, /触发时估算 780K \/ 阈值 800K/);
    assert.equal(diagnostics.saved.reason, 'overflow');
    assert.equal(diagnostics.saved.pendingEstimatedTokens, 220000);
    assert.equal(diagnostics.after, 1200);
    assert.equal(diagnostics.unknown, 1200, 'unavailable measurements preserve the last size');
    assert.equal(diagnostics.unknownHasSize, false);
    assert.equal(diagnostics.measured, 185, 'V2 visible output and reasoning are disjoint');
    // A legacy global preference must never open the detail panel by itself:
    // the old "showContextUsage" toggle is gone, and its leftover value used to
    // pop the panel open on every session switch and on the first message.
    await page.evaluate(() => {
      state.currentSession = { id: 'context-existing', messages: [{ role: 'user', content: 'Existing task' }] };
      setEmptyState(false);
      updateContextInfo();
    });
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'true', 'legacy showContextUsage must not open the panel');
    await page.evaluate(() => {
      state.currentSession = { id: 'context-other', messages: [{ role: 'user', content: 'Other task' }] };
      updateContextInfo();
    });
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'true', 'switching conversations keeps the panel closed');
    await page.evaluate(() => {
      state.currentSession = { id: 'context-new', messages: [] };
      updateContextInfo();
      setContextRingPanelOpen(true);
      if (!document.querySelector('#contextRingPanel').classList.contains('hidden')) throw new Error('empty task opened context panel');
      state.currentSession.messages.push({ role: 'user', content: 'First message' });
      updateContextInfo();
    });
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'true', 'the first message must not open the panel');

    // A stored task preference must not reopen the panel either: only a click
    // can open it, and switching away never restores it.
    await page.evaluate(() => {
      state.currentSession = { id: 'context-explicit', messages: [{ role: 'user', content: 'Existing task' }], contextPanelOpen: true };
      updateContextInfo();
    });
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'true', 'a stored task preference must not open the panel');
    await page.evaluate(() => document.querySelector('#composerContext').click());
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'false', 'clicking the context pill opens the panel');
    await page.evaluate(() => {
      state.currentSession = { id: 'context-plain', messages: [{ role: 'user', content: 'Other task' }] };
      updateContextInfo();
    });
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'true', 'switching tasks closes the panel');
    await page.evaluate(() => {
      state.currentSession = { id: 'context-explicit', messages: [{ role: 'user', content: 'Existing task' }], contextPanelOpen: true };
      updateContextInfo();
    });
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'true', 'returning to a task never reopens the panel');

    const modelBudgets = await page.evaluate(() => {
      state.config.models = [
        { id: 'model-a', name: 'Model A', capabilities: { contextWindow: 100000, compactionThreshold: 70000 } },
        { id: 'model-b', name: 'Model B', capabilities: { contextWindow: 200000, compactionThreshold: 150000 } }
      ];
      state.config.context = { maxTokens: 1000000, compactionThreshold: 800000 };
      const read = () => ({ value: document.querySelector('#contextRingValue').textContent,
        hint: document.querySelector('#contextRingHint').textContent });
      state.config.agentModel = { providerId: 'test', supplierId: 'official', modelId: 'model-a', modelType: 'text', name: 'Model A', capabilities: state.config.models[0].capabilities };
      renderModelBadge();
      const a = read();
      const previousSession = state.currentSession;
      const session = { id: 'context-switch-test', messages: [] };
      state.currentSession = session;
      state.activeRuns.set(session.id, { runCtx: {
        sessionRef: session, providerId: 'test', supplierId: 'official', modelId: 'model-a',
        agentState: { status: 'working' },
        runBudget: { contextWindow: 100000, compressSoftThreshold: 70000, compressHardThreshold: 100000 }
      } });
      try {
        state.config.agentModel = { ...state.config.agentModel, modelId: 'model-b', name: 'Model B', capabilities: state.config.models[1].capabilities };
        renderModelBadge();
        return { a, b: read() };
      } finally {
        state.activeRuns.delete(session.id);
        state.currentSession = previousSession;
      }
    });
    assert.match(modelBudgets.a.value, /\/ 100K$/);
    assert.match(modelBudgets.a.hint, /70K/);
    assert.match(modelBudgets.b.value, /\/ 200K$/);
    assert.match(modelBudgets.b.hint, /150K/);

    await page.evaluate(() => {
      updateContextRing(45000, 100000, 70000, 100000, 'normal', {
        modelName: 'Test Model', statusLabel: '执行中',
        breakdown: { system: 4100, tools: 40900, messages: 5 }
      });
    });
    const state = await page.evaluate(() => {
      const bar = document.querySelector('#contextRingBar');
      const ring = document.querySelector('#composerContextRingProgress');
      return {
        percentReadout: document.querySelector('#contextRingPercent').textContent,
        value: document.querySelector('#contextRingValue').textContent,
        rows: [...document.querySelectorAll('.context-usage-row')].map(node => node.innerText),
        hint: document.querySelector('#contextRingHint').textContent,
        triggerText: document.querySelector('#composerContext').textContent.trim(),
        trackNow: document.querySelector('#contextRingTrack').getAttribute('aria-valuenow'),
        compressMarker: document.querySelector('#contextRingTrack').style.getPropertyValue('--ctx-compress-pct'),
        barRatio: bar.style.getPropertyValue('--ctx-token-ratio'),
        barImage: getComputedStyle(bar).backgroundImage,
        ringOffset: Number(ring.style.strokeDashoffset),
        ringDash: Number(ring.style.strokeDasharray)
      };
    });
    assert.equal(state.percentReadout, '45%');
    assert.equal(state.triggerText, '45%');
    assert.equal(state.value, '~45K / 100K');
    assert.match(state.rows[0], /系统提示词/);
    assert.match(state.rows[0], /~4\.1K/);
    assert.match(state.rows[1], /工具定义/);
    assert.match(state.rows[1], /~40\.9K/);
    assert.match(state.rows[2], /对话消息/);
    assert.match(state.rows[2], /~5$/);
    assert.match(state.hint, /距离自动压缩还有 25K/);
    assert.equal(state.trackNow, '45');
    assert.equal(state.compressMarker, '70%');
    assert.equal(state.barRatio, '0.45');
    assert.match(state.barImage, /linear-gradient/);
    assert.ok(state.ringOffset < state.ringDash, 'context ring shows progress');

    // The gradient is blue -> yellow -> red; the fill grows across it as usage
    // rises, while the percentage and panel budget state recolor at warn/critical.
    const budgets = await page.evaluate(() => {
      const panel = document.querySelector('#contextRingPanel');
      const bar = document.querySelector('#contextRingBar');
      const read = () => ({
        budget: panel.dataset.budget,
        percentColor: getComputedStyle(document.querySelector('#contextRingPercent')).color,
        barWidth: parseFloat(getComputedStyle(bar).width) || 0
      });
      updateContextRing(45000, 100000, 70000, 100000, 'normal');
      const normal = read();
      updateContextRing(75000, 100000, 70000, 100000, 'warn');
      const warn = read();
      updateContextRing(100000, 100000, 70000, 100000, 'critical');
      const critical = read();
      updateContextRing(45000, 100000, 70000, 100000, 'normal');
      return { normal, warn, critical };
    });
    assert.equal(budgets.normal.budget, 'normal');
    assert.equal(budgets.warn.budget, 'warn');
    assert.equal(budgets.critical.budget, 'critical');
    assert.notEqual(budgets.warn.percentColor, budgets.normal.percentColor, 'warn must recolor the percentage');
    assert.notEqual(budgets.critical.percentColor, budgets.normal.percentColor, 'critical must recolor the percentage');
    assert.ok(budgets.critical.barWidth > budgets.normal.barWidth, 'the fill grows into the red end of the gradient');

    await page.evaluate(() => setContextRingPanelOpen(true, { refresh: false }));
    await page.waitForSelector('#contextRingPanel:not(.hidden)');
    await page.waitForTimeout(200);
    // Critical state evidence: the full bar reaches the red end of the
    // blue -> yellow -> red gradient, and the percentage/ring turn red.
    await page.evaluate(() => updateContextRing(100000, 100000, 70000, 100000, 'critical'));
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(evidenceDir, 'context-ring-panel-critical.png'), fullPage: false });
    await page.evaluate(() => updateContextRing(45000, 100000, 70000, 100000, 'normal'));
    await page.waitForTimeout(100);
    const panel = await page.evaluate(() => {
      const box = selector => document.querySelector(selector)?.getBoundingClientRect();
      const panelBox = box('#contextRingPanel');
      const triggerBox = box('#composerContext');
      const composerBox = box('#composer');
      const compressBox = box('#contextCompressBtn');
      return {
        x: panelBox.x,
        width: panelBox.width,
        bottom: panelBox.bottom,
        center: (panelBox.left + panelBox.right) / 2,
        triggerTop: triggerBox.top,
        triggerCenter: (triggerBox.left + triggerBox.right) / 2,
        composerTop: composerBox.top,
        compressLeft: compressBox.left,
        compressTop: compressBox.top,
        panelTop: panelBox.top,
        panelLeft: panelBox.left,
        viewportWidth: window.innerWidth,
        height: panelBox.height,
        expanded: document.querySelector('#contextRingPanel').getAttribute('aria-hidden') === 'false' ? 'true' : 'false'
      };
    });
    assert.equal(panel.expanded, 'true');
    assert.ok(panel.height > 0 && panel.width > 0, 'panel must be visible');
    assert.ok(panel.bottom <= panel.triggerTop - 6, 'panel sits above the context pill');
    assert.ok(panel.triggerTop - panel.bottom <= 12, 'panel keeps a small gap to the context pill');
    assert.ok(Math.abs(panel.center - panel.triggerCenter) <= 1, 'panel is anchored to the context pill');
    assert.ok(panel.bottom > panel.composerTop, 'panel overlaps the composer area');
    assert.ok(panel.panelLeft >= 0 && panel.panelLeft + panel.width <= panel.viewportWidth, 'panel stays inside the viewport');
    assert.ok(panel.compressLeft - panel.panelLeft <= 20, 'compress action is at the panel left edge');
    assert.ok(panel.compressTop - panel.panelTop <= 20, 'compress action is at the panel top edge');

    // Evidence frame: a live 45% reading shows the percentage, the fill and
    // the system/tools/messages breakdown together.
    await page.evaluate(() => updateContextRing(45000, 100000, 70000, 100000, 'normal', { modelName: 'Test Model', statusLabel: '执行中' }));
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(evidenceDir, 'context-ring-panel.png'), fullPage: false });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'false', 'Escape must keep the panel visible');
    await page.locator('.context-ring-title').click();
    await page.mouse.click(900, 200);
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'false', 'outside clicks keep panel visible');

    await page.evaluate(() => setContextRingPanelOpen(true));
    await page.waitForSelector('#contextRingPanel:not(.hidden)');
    await page.locator('#composer').click({ position: { x: 40, y: 20 } });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'false', 'typing keeps status panel visible');
    await page.locator('#composerContext').click();
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'true');

    await page.evaluate(() => updateContextInfo());
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'true', 'updates preserve manual dismissal');
    await page.evaluate(() => window.YanComposerConfig.open());
    const ids = await page.locator('[data-composer-config]').evaluateAll(nodes => nodes.map(node => node.dataset.composerConfig));
    assert.equal(ids.indexOf('status'), ids.indexOf('model') + 1);
    assert.equal(ids.includes('goal'), false);
    assert.ok(ids.includes('plan'));
    assert.equal(await page.locator('[data-composer-config="status"] [data-keyline-icon="gauge-high"]').count(), 1);
    await page.locator('[data-composer-config="status"]').click();
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'false');
    await page.evaluate(() => { state.config.general.showContextUsage = true; syncGeneralPreferences(); });
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'false', 'settings sync leaves an open panel alone');
    await page.evaluate(() => { state.config.general.showContextUsage = false; syncGeneralPreferences(); });
    assert.equal(await page.locator('#contextRingPanel').getAttribute('aria-hidden'), 'false');
    console.log(JSON.stringify({ ok: true, panel }));
  } finally {
    await application?.close().catch(() => {});
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      if (error.code !== 'EPERM') throw error;
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
