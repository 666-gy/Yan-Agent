'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-composer-usage-'));

(async () => {
  let app;
  try {
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData }
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && !!state.currentSession);
    // First-run handwriting overlay would otherwise intercept every click.
    await page.evaluate(() => window.YanStartupHello?.skip?.());

    await page.evaluate(() => {
      state.currentSession.messages = [
        { id: 'u1', role: 'user', content: 'hi', ts: 1 },
        {
          id: 'a1', role: 'assistant', content: 'ok', ts: 2,
          agentRun: {
            status: 'done', durationMs: 1000, timeline: [],
            usage: { input: 100, cacheRead: 200, output: 50 }
          }
        }
      ];
      setEmptyState(false);
      renderMessages(state.currentSession.messages);
      updateContextInfo();
    });
    await page.waitForTimeout(250);

    assert.equal(await page.locator('#composerDisclaimer').count(), 0, 'AI disclaimer is gone');
    const line = page.locator('#composerUsage');
    assert.equal(await line.isVisible(), true, 'token readout is visible under the composer');
    const capsuleText = await line.innerText();
    assert.match(capsuleText, /350 tok · 缓存命中 66\.7%/);
    assert.equal(capsuleText.includes('/'), false, 'capsule shows task spend, not context/max');
    const cacheFont = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('#composerUsageCache'));
      return { weight: style.fontWeight, family: style.fontFamily };
    });
    assert.equal(cacheFont.weight, '700', 'cache label is bold');
    assert.match(cacheFont.family, /Microsoft YaHei|微软雅黑/, 'cache label uses Microsoft YaHei');

    const panel = page.locator('#tokenUsagePanel');
    assert.equal(await panel.isVisible(), false, 'token panel starts closed');
    await line.click();
    await page.waitForTimeout(150);
    assert.equal(await panel.isVisible(), true, 'clicking the readout opens the token panel');
    assert.equal(await line.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#contextRingPanel').isVisible(), false, 'only one composer panel is open');
    assert.equal(await page.locator('#tokenUsageTotal').innerText(), '350 tok');
    assert.equal(await page.locator('#tokenUsageCacheRate').innerText(), '66.7%');
    assert.equal(await page.locator('#tokenUsageUncached').innerText(), '100 tok');
    assert.equal(await page.locator('#tokenUsageCacheRead').innerText(), '200 tok');
    assert.equal(await page.locator('#tokenUsageOutput').innerText(), '50 tok');

    const geometry = await page.evaluate(() => {
      const box = selector => document.querySelector(selector)?.getBoundingClientRect();
      const panelBox = box('#tokenUsagePanel');
      const capsuleBox = box('#composerUsage');
      const contextBox = box('#composerContext');
      const wrapBox = box('#composerUsageWrap');
      const composerBox = box('#composer');
      return {
        panelBottom: panelBox.bottom,
        panelLeft: panelBox.left,
        panelRight: panelBox.right,
        panelCenter: (panelBox.left + panelBox.right) / 2,
        capsuleTop: capsuleBox.top,
        capsuleCenter: (capsuleBox.left + capsuleBox.right) / 2,
        contextLeft: contextBox.left,
        usageRight: capsuleBox.right,
        wrapCenter: (wrapBox.left + wrapBox.right) / 2,
        composerCenter: (composerBox.left + composerBox.right) / 2,
        borderWidth: getComputedStyle(document.querySelector('#composerUsage')).borderTopWidth,
        viewportWidth: window.innerWidth
      };
    });
    assert.ok(geometry.panelBottom <= geometry.capsuleTop - 6, 'token panel sits above the capsule');
    assert.ok(geometry.capsuleTop - geometry.panelBottom <= 12, 'token panel keeps a small gap to the capsule');
    assert.ok(Math.abs(geometry.panelCenter - geometry.capsuleCenter) <= 1, 'token panel is centered on its capsule');
    assert.ok(Math.abs(geometry.wrapCenter - geometry.composerCenter) <= 1, 'token + context pills are centered as a group');
    assert.ok(geometry.contextLeft >= geometry.usageRight - 1, 'context pill sits to the right of the token pill');
    assert.equal(geometry.borderWidth, '0px', 'capsule has no default border');
    assert.ok(geometry.panelLeft >= 0 && geometry.panelRight <= geometry.viewportWidth, 'panel stays inside the viewport');

    await line.click();
    await page.waitForTimeout(120);
    assert.equal(await panel.isVisible(), false, 'clicking again closes the panel');

    await line.click();
    await page.waitForTimeout(120);
    await page.keyboard.press('Escape');
    assert.equal(await panel.isVisible(), false, 'Escape closes the panel');

    await line.click();
    await page.waitForTimeout(120);
    await page.locator('#messages').click({ position: { x: 30, y: 30 } });
    await page.waitForTimeout(120);
    assert.equal(await panel.isVisible(), false, 'outside click closes the panel');

    // Context component: a ring pill to the right of the token pill opens the
    // panel directly above itself, with the compress action in its top-left.
    await page.evaluate(() => updateContextRing(45000, 100000, 70000, 100000, 'normal'));
    const contextTrigger = page.locator('#composerContext');
    assert.equal(await contextTrigger.isVisible(), true, 'context pill is visible next to the token pill');
    assert.equal((await contextTrigger.innerText()).trim(), '45%', 'context pill shows the live percentage');
    await contextTrigger.click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#contextRingPanel').isVisible(), true, 'clicking the context pill opens its panel');
    assert.equal(await panel.isVisible(), false, 'opening the context panel closes the token panel');
    assert.equal(await contextTrigger.getAttribute('aria-expanded'), 'true');
    // The pill's refresh reads the live session estimate; re-apply the
    // deterministic 45% fixture after opening so this test asserts the panel
    // geometry and colors rather than the tiny probe conversation.
    await page.evaluate(() => updateContextRing(45000, 100000, 70000, 100000, 'normal', {
      breakdown: { system: 4100, tools: 40900, messages: 2 }
    }));
    await page.waitForTimeout(50);
    const contextGeometry = await page.evaluate(() => {
      const box = selector => document.querySelector(selector)?.getBoundingClientRect();
      const panelBox = box('#contextRingPanel');
      const triggerBox = box('#composerContext');
      const compressBox = box('#contextCompressBtn');
      const bar = document.querySelector('#contextRingBar');
      const ring = document.querySelector('#composerContextRingProgress');
      return {
        panelLeft: panelBox.left,
        panelRight: panelBox.right,
        panelTop: panelBox.top,
        panelBottom: panelBox.bottom,
        panelCenter: (panelBox.left + panelBox.right) / 2,
        triggerTop: triggerBox.top,
        triggerCenter: (triggerBox.left + triggerBox.right) / 2,
        compressLeft: compressBox.left,
        compressTop: compressBox.top,
        header: document.querySelector('.context-usage-head')?.innerText || '',
        percent: document.querySelector('#contextRingPercent')?.textContent,
        value: document.querySelector('#contextRingValue')?.textContent,
        rows: [...document.querySelectorAll('.context-usage-row')].map(node => node.innerText),
        barBg: getComputedStyle(bar).backgroundImage,
        ratio: bar.style.getPropertyValue('--ctx-token-ratio'),
        ringOffset: ring.style.strokeDashoffset,
        ringDash: ring.style.strokeDasharray,
        viewportWidth: window.innerWidth
      };
    });
    assert.ok(contextGeometry.panelBottom <= contextGeometry.triggerTop - 6, 'context panel sits above the context pill');
    assert.ok(contextGeometry.triggerTop - contextGeometry.panelBottom <= 12, 'context panel keeps a small gap');
    assert.ok(Math.abs(contextGeometry.panelCenter - contextGeometry.triggerCenter) <= 1, 'context panel is anchored to the context pill');
    assert.ok(contextGeometry.panelLeft >= 0 && contextGeometry.panelRight <= contextGeometry.viewportWidth, 'context panel stays inside the viewport');
    assert.ok(contextGeometry.compressLeft - contextGeometry.panelLeft <= 20, 'compress button sits at the panel left edge');
    assert.ok(contextGeometry.compressTop - contextGeometry.panelTop <= 20, 'compress button sits at the panel top edge');
    assert.match(await page.locator('#contextCompressBtn').innerText(), /我来压缩/);
    assert.match(contextGeometry.header, /上下文已用/);
    assert.equal(contextGeometry.percent, '45%');
    assert.match(contextGeometry.value, /^~45K \/ 100K$/);
    assert.match(contextGeometry.rows[0], /系统提示词/);
    assert.match(contextGeometry.rows[0], /~4\.1K/);
    assert.match(contextGeometry.rows[1], /工具定义/);
    assert.match(contextGeometry.rows[1], /~40\.9K/);
    assert.match(contextGeometry.rows[2], /对话消息/);
    assert.match(contextGeometry.rows[2], /~2$/);
    assert.match(contextGeometry.barBg, /linear-gradient/);
    assert.equal(contextGeometry.ratio, '0.45');
    assert.ok(Number(contextGeometry.ringOffset) < Number(contextGeometry.ringDash), 'context ring shows progress');

    await page.locator('#messages').click({ position: { x: 30, y: 30 } });
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#contextRingPanel').isVisible(), true, 'context panel is persistent outside clicks');

    // Token and context panels stay mutually exclusive, and closing the token
    // panel must not bring the context panel back.
    await line.click();
    await page.waitForTimeout(150);
    assert.equal(await panel.isVisible(), true, 'token panel opens over the context panel');
    assert.equal(await page.locator('#contextRingPanel').isVisible(), false, 'token panel hides the context panel');
    await line.click();
    await page.waitForTimeout(150);
    assert.equal(await panel.isVisible(), false, 'token panel closes again');
    assert.equal(await page.locator('#contextRingPanel').isVisible(), false, 'closing the token panel never reopens the context panel');

    await page.locator('#composerContext').click();
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#contextRingPanel').isVisible(), true, 'context pill opens the panel on demand');
    await page.locator('#composerContext').click();
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#contextRingPanel').isVisible(), false, 'context pill toggles the panel closed');
    assert.equal(await contextTrigger.getAttribute('aria-expanded'), 'false');
    await page.evaluate(() => setContextRingPanelOpen(false));

    const header = await page.evaluate(() => {
      const host = document.createElement('div');
      document.querySelector('#messages').append(host);
      renderAgentRunHeader(host, {
        status: 'done', durationMs: 1000, timeline: [],
        usage: { input: 100, cacheRead: 400 }
      });
      const summary = host.querySelector('.agent-run-summary');
      const result = {
        text: summary.textContent,
        cache: !!summary.querySelector('.run-cache-hit')
      };
      host.remove();
      const actions = document.createElement('div');
      actions.innerHTML = buildAssistantActionsHtml({ status: 'done', usage: { input: 100, cacheRead: 400 } }, 1000, Date.now());
      const copy = actions.querySelector('[data-act="copy"]');
      const cache = actions.querySelector('.msg-cache-hit');
      const clock = actions.querySelector('.msg-response-time');
      document.querySelector('#messages').append(actions);
      const cacheStyle = getComputedStyle(cache);
      const hoverFont = { weight: cacheStyle.fontWeight, family: cacheStyle.fontFamily };
      actions.remove();
      return {
        ...result,
        hoverText: cache?.textContent || '',
        hoverFont,
        afterCopy: !!cache && copy?.nextElementSibling === cache,
        beforeClock: !!cache && cache.nextElementSibling === clock
      };
    });
    assert.equal(header.cache, false, 'run summary no longer carries the cache badge');
    assert.equal(header.text.includes('缓存命中'), false, 'run summary text has no cache badge');
    assert.equal(header.hoverText, '缓存命中 80%');
    assert.equal(header.hoverFont.weight, '700', 'hover cache hit is bold');
    assert.match(header.hoverFont.family, /Microsoft YaHei|微软雅黑/, 'hover cache hit uses Microsoft YaHei');
    assert.equal(header.afterCopy, true);
    assert.equal(header.beforeClock, true);

    // Live rounds: a running turn must move the capsule as each model round
    // finishes, not only when its assistant message is persisted at the end.
    const liveRound = await page.evaluate(() => {
      const session = state.currentSession;
      const runCtx = createRunCtx(session.id, true, '');
      runCtx.sessionRef = session;
      runCtx.activeAgentRun = { status: 'working', timeline: [] };
      state.activeRuns.set(session.id, { sessionRef: session, runCtx, assistantEl: null });
      const round = id => ({ type: 'message.updated', properties: { info: { id, role: 'assistant', sessionID: session.openCodeSessionId || '', tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 200, write: 0 } } } } });
      applyOpenCodeEvent(runCtx, round('round-1'));
      const first = {
        text: document.querySelector('#composerUsageText').textContent,
        total: sessionUsageStats(session).total
      };
      applyOpenCodeEvent(runCtx, round('round-2'));
      const second = {
        text: document.querySelector('#composerUsageText').textContent,
        total: sessionUsageStats(session).total
      };
      // Re-reporting the same round must replace its snapshot, not add to it.
      applyOpenCodeEvent(runCtx, round('round-2'));
      return { first, second, repeated: sessionUsageStats(session).total };
    });
    assert.equal(liveRound.first.text, '700 tok', 'capsule advances when the first round lands');
    assert.equal(liveRound.first.total, 700);
    assert.equal(liveRound.second.text, '1.1K tok', 'capsule advances again on the next round');
    assert.equal(liveRound.second.total, 1050);
    assert.equal(liveRound.repeated, 1050, 'repeated updates for one round are not summed twice');

    await line.click();
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#tokenUsageTotal').innerText(), '1,050 tok', 'the open usage panel follows live rounds too');
    await line.click();
    await page.waitForTimeout(120);

    const settled = await page.evaluate(() => {
      const session = state.currentSession;
      const runCtx = getRunCtx(session.id);
      const runId = runCtx.runId;
      // Production order: the assistant message is persisted first, then its
      // authoritative usage is added to the task total.
      const assistantMsg = {
        role: 'assistant',
        content: 'live round reply',
        ts: Date.now(),
        agentRun: { runId, usage: { input: 200, cacheRead: 400, output: 100, reasoning: 0 } }
      };
      session.messages.push(assistantMsg);
      addMessageUsage(session, assistantMsg);
      updateContextInfo(runCtx.agentState, session);
      const value = {
        total: sessionUsageStats(session).total,
        text: document.querySelector('#composerUsageText').textContent,
        live: runCtx.liveUsageRounds
      };
      state.activeRuns.delete(session.id);
      updateContextInfo();
      return {
        ...value,
        afterEnd: sessionUsageStats(session).total,
        afterText: document.querySelector('#composerUsageText').textContent
      };
    });
    assert.equal(settled.total, 1050, 'authoritative run usage replaces the live overlay without doubling');
    assert.equal(settled.text, '1.1K tok');
    assert.equal(settled.live, null, 'live rounds are cleared once the run usage is persisted');
    assert.equal(settled.afterEnd, 1050, 'task total survives the run ending');
    assert.equal(settled.afterText, '1.1K tok');

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, disclaimerGone: true, composerLine: true, tokenPanel: true, hoverCache: true }));
  } finally {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
