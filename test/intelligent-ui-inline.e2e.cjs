'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { createIntelligentUi } = require('../lib/intelligent-ui-creator');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-inline-ui-'));
const html = fs.readFileSync(path.join(__dirname, 'fixtures/intelligent-ui-cost.html'), 'utf8');

(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [process.cwd()], env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanIntelligentUi);
    const active = { intelligentUiAllowed: true };
    const args = { task_id: 'inline-test', action: 'start', title: '服务方案月成本', purpose: '调整人数和每人调用量，找到成本更低的方案。', placement: 'final' };
    const initial = createIntelligentUi(active, args.task_id, args);
    await page.evaluate(async ({ args, initial }) => {
      if (!state.currentSession) await newSession();
      setEmptyState(false);
      appendMessage('user', '帮我比较三个服务方案，看看人数和调用量变化会怎样影响月成本。');
      window.inlineTimeline = [
        { type: 'tool_call', callId: 'ui-start', name: 'yan_session_intelligent_ui_creator', args },
        { type: 'tool_result', callId: 'ui-start', name: 'yan_session_intelligent_ui_creator', output: JSON.stringify(initial), ok: true }
      ];
      window.inlineBody = appendMessage('assistant', '').querySelector('.msg-body');
      renderAgentRunBody(inlineBody, { status: 'working', timeline: inlineTimeline, modelId: 'deepseek-v4' });
    }, { args, initial });
    assert.equal(await page.locator('.intelligent-ui-status').textContent(), '正在创建');
    const rendered = createIntelligentUi(active, args.task_id, { task_id: args.task_id, action: 'render', html });
    await page.evaluate(({ rendered, html }) => {
      inlineTimeline = [...inlineTimeline,
        { type: 'tool_call', callId: 'ui-render', name: 'yan_session_intelligent_ui_creator', args: { task_id: 'inline-test', action: 'render', html } },
        { type: 'tool_result', callId: 'ui-render', name: 'yan_session_intelligent_ui_creator', output: JSON.stringify(rendered), ok: true },
        { type: 'text', stage: 'summary', content: '当前条件下，C 方案每月 460 元。可以调整上方参数比较。' }
      ];
      renderAgentRunBody(inlineBody, { status: 'done', summaryStarted: true, timeline: inlineTimeline, modelId: 'deepseek-v4' });
    }, { rendered, html });
    assert.equal(await page.locator('.intelligent-ui-output').count(), 1);
    const ui = page.frameLocator('.intelligent-ui-frame').frameLocator('iframe');
    await ui.locator('#a').waitFor({ timeout: 10000 });
    assert.equal(await ui.locator('#a').textContent(), '600');
    assert.equal(await ui.locator('#b').textContent(), '520');
    assert.equal(await ui.locator('#c').textContent(), '460');
    assert.equal(await page.locator('.intelligent-ui-output').evaluate(el => getComputedStyle(el).borderTopWidth), '0px');
    assert.equal(await page.locator('.intelligent-ui-purpose').isVisible(), false);
    assert.equal(await ui.locator('.usage').evaluate(el => getComputedStyle(el).display), 'flex', 'generated CSS overrides foundation layout');
    assert.equal(await ui.locator('.ui-controls').evaluate(el => getComputedStyle(el).display), 'flex');
    assert.equal(await ui.locator('details').getAttribute('open'), null);
    await ui.locator('summary').click();
    assert.equal(await ui.locator('details').evaluate(el => el.open), true);
    await ui.locator('summary').click();
    await ui.locator('#calls').fill('1000');
    assert.equal(await ui.locator('#c').textContent(), '500');
    await page.evaluate(() => renderAgentRunBody(inlineBody, { status: 'done', summaryStarted: true, timeline: [...inlineTimeline], modelId: 'deepseek-v4' }));
    assert.equal(await ui.locator('#calls').inputValue(), '1000', 'timeline refresh preserves iframe state');
    const isolation = await ui.locator('body').evaluate(async () => {
      let parentBlocked = false, networkBlocked = false;
      try { void parent.document; } catch { parentBlocked = true; }
      try { await fetch('https://example.com'); } catch { networkBlocked = true; }
      return { parentBlocked, networkBlocked, node: typeof require, yan: typeof window.yan };
    });
    assert.deepEqual(isolation, { parentBlocked: true, networkBlocked: true, node: 'undefined', yan: 'undefined' });
    assert.equal(await page.locator('webview').count(), 0, 'no built-in browser opened');
    fs.mkdirSync('output/playwright/intelligent-ui', { recursive: true });
    await page.screenshot({ path: 'output/playwright/intelligent-ui/inline-dark.png' });
    // A JSON history roundtrip restores the inline result without Creator running again.
    await page.evaluate(() => {
      const saved = JSON.parse(JSON.stringify(inlineTimeline));
      inlineBody.replaceChildren();
      renderAgentRunBody(inlineBody, { status: 'done', summaryStarted: true, timeline: saved, modelId: 'deepseek-v4' });
    });
    await ui.locator('#a').waitFor();
    assert.equal(await ui.locator('#calls').inputValue(), '800');
    // Narrow layout and light appearance use the same shipped defaults.
    for (const width of [320,375,414,768]) {
      await page.locator('.intelligent-ui-output').evaluate((el,width) => { el.style.width = width+'px'; },width);
      await ui.locator('body').evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await ui.locator('body').evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `no overflow at ${width}px`);
    }
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
      inlineBody.replaceChildren();
      renderAgentRunBody(inlineBody, { status: 'done', summaryStarted: true, timeline: inlineTimeline, modelId: 'deepseek-v4' });
    });
    await ui.locator('#a').waitFor();
    assert.equal(await ui.locator('body').evaluate(el => getComputedStyle(el).color), 'rgb(32, 32, 32)');
    await page.screenshot({ path: 'output/playwright/intelligent-ui/inline-light.png' });
    await ui.locator('#calls').fill('1500');
    assert.equal(await ui.locator('[data-best=true]').count(),2,'tie is represented');
    await ui.locator('#calls').fill('');
    assert.equal(await ui.locator('#calls').getAttribute('aria-invalid'),'true');
    // A spatial explanation must be free to use a different structure and shape.
    const orbit = fs.readFileSync(path.join(__dirname,'fixtures/intelligent-ui-orbit.html'),'utf8');
    await page.evaluate(orbit => {
      const element=document.querySelector('.intelligent-ui-output');
      YanIntelligentUi.update(element,{id:'orbit-demo',revision:1,title:'日照方向探索',purpose:'观察光照方向',status:'ready',html:orbit});
    },orbit);
    await ui.locator('#angle').waitFor();
    assert.equal(await ui.locator('.planet').evaluate(el=>getComputedStyle(el).borderRadius),'50%');
    await ui.locator('#angle').fill('180');
    assert.equal(await ui.locator('#degrees').textContent(),'180°');
    await page.locator('.intelligent-ui-output').screenshot({path:'output/playwright/intelligent-ui/orbit.png'});

    // A mini-app changes its task object, retains a useful choice, and restores it.
    const miniHtml = fs.readFileSync(path.join(__dirname, 'fixtures/intelligent-ui-miniapp.html'), 'utf8');
    const miniActive = { intelligentUiAllowed: true };
    const miniArgs = { task_id: 'room-miniapp-test', action: 'start', title: '房间配色', purpose: '选择墙色并收藏方案。', placement: 'final' };
    const miniStart = createIntelligentUi(miniActive, miniArgs.task_id, miniArgs);
    const miniRender = createIntelligentUi(miniActive, miniArgs.task_id, { task_id: miniArgs.task_id, action: 'render', html: miniHtml });
    await page.evaluate(({ args, started, rendered, html }) => {
      inlineBody.id = 'miniapp-message';
      window.miniTimeline = [
        { type: 'tool_call', callId: 'room-start', name: 'yan_session_intelligent_ui_creator', args },
        { type: 'tool_result', callId: 'room-start', name: 'yan_session_intelligent_ui_creator', output: JSON.stringify(started), ok: true },
        { type: 'tool_call', callId: 'room-render', name: 'yan_session_intelligent_ui_creator', args: { task_id: args.task_id, action: 'render', html } },
        { type: 'tool_result', callId: 'room-render', name: 'yan_session_intelligent_ui_creator', output: JSON.stringify(rendered), ok: true }
      ];
      renderAgentRunBody(inlineBody, { status: 'done', summaryStarted: true, timeline: miniTimeline, modelId: 'deepseek-v4' });
    }, { args: miniArgs, started: miniStart, rendered: miniRender, html: miniHtml });
    const mini = page.frameLocator('#miniapp-message .intelligent-ui-frame').frameLocator('iframe');
    await mini.locator('body[data-miniapp-ready=true]').waitFor();
    assert.equal(await mini.locator('#room-wall').getAttribute('fill'), '#E5D4BF');
    await mini.locator('[data-palette=sage]').click();
    await mini.locator('#save-status[data-persisted=true]').waitFor();
    assert.equal(await mini.locator('#room-wall').getAttribute('fill'), '#B6C1AD', 'swatch changes the actual room preview');
    await mini.locator('#save-choice').click();
    await mini.locator('#save-status[data-persisted=true]').waitFor();
    assert.equal(await mini.locator('#saved-choice').textContent(), '鼠尾草绿 · #B6C1AD');
    assert.ok(await mini.locator('#save-choice').evaluate(el => parseFloat(getComputedStyle(el).borderRadius) >= el.clientHeight / 2), 'host default buttons are pills');
    await mini.locator('body').evaluate(() => { window.keepFrame = 'still-here'; });
    await page.evaluate(() => renderAgentRunBody(inlineBody, { status: 'done', summaryStarted: true, timeline: [...miniTimeline], modelId: 'deepseek-v4' }));
    assert.equal(await mini.locator('body').evaluate(() => window.keepFrame), 'still-here', 'refresh preserves the running mini-app');

    const restoreMini = async () => {
      await page.evaluate(() => {
        inlineBody.replaceChildren();
        renderAgentRunBody(inlineBody, { status: 'done', summaryStarted: true, timeline: JSON.parse(JSON.stringify(miniTimeline)), modelId: 'deepseek-v4' });
      });
      await mini.locator('body[data-miniapp-ready=true]').waitFor();
    };
    await restoreMini();
    assert.equal(await mini.locator('#room-wall').getAttribute('fill'), '#B6C1AD', 'history reconstruction restores selected wall');
    assert.equal(await mini.locator('#saved-choice').textContent(), '鼠尾草绿 · #B6C1AD', 'history reconstruction restores saved result');
    assert.equal(await mini.locator('body').evaluate(() => window.keepFrame), undefined, 'history reconstruction created a fresh frame');

    const invalidResults = await mini.locator('body').evaluate(async () => {
      const cyclic = {}; cyclic.self = cyclic;
      const results = [];
      for (const value of [{ note: '墙'.repeat(6000) }, cyclic, { invalid: undefined }, { invalid: NaN }]) {
        try { results.push(await window.yanUi.setState(value) === false); }
        catch { results.push(true); }
      }
      return results;
    });
    assert.deepEqual(invalidResults, [true, true, true, true], 'oversized UTF-8 and non-JSON writes are rejected');
    await restoreMini();
    assert.equal(await mini.locator('#saved-choice').textContent(), '鼠尾草绿 · #B6C1AD', 'rejected writes preserve last saved choice');

    // A storage failure keeps interaction available and cannot replace durable state.
    await page.evaluate(() => {
      window.originalMiniappSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && key === 'yan.intelligent-ui.state.v1') throw new DOMException('Storage is full', 'QuotaExceededError');
        return window.originalMiniappSetItem.call(this, key, value);
      };
    });
    try {
      assert.equal(await mini.locator('body').evaluate(() => window.yanUi.setState({ version: 1, selected: 'blue', saved: 'sage' })), false, 'setState reports persistence failure');
      assert.equal(await mini.locator('body').evaluate(() => window.yanUi.getState().selected), 'blue', 'live state remains available after persistence failure');
      await mini.locator('[data-palette=blue]').click();
      await mini.locator('#save-status').filter({ hasText: '未保存' }).waitFor();
      assert.equal(await mini.locator('#room-wall').getAttribute('fill'), '#B4C6D0', 'room controls still work when storage is unavailable');
    } finally {
      await page.evaluate(() => {
        Storage.prototype.setItem = window.originalMiniappSetItem;
        delete window.originalMiniappSetItem;
      });
    }
    await restoreMini();
    assert.equal(await mini.locator('#room-wall').getAttribute('fill'), '#B6C1AD', 'reconstruction restores the last persisted choice, not the failed write');
    assert.equal(await mini.locator('#saved-choice').textContent(), '鼠尾草绿 · #B6C1AD');

    // A sibling panel cannot overwrite a different task's state by posting its protocol.
    await page.evaluate(html => {
      const other = YanIntelligentUi.create();
      other.id = 'isolated-room';
      document.querySelector('#miniapp-message').parentElement.append(other);
      YanIntelligentUi.update(other, { id: 'another-room-task', revision: 1, title: '另一间房', purpose: '', status: 'ready', html });
      window.postMessage({ type: 'yan-ui-state', requestId: 1, json: JSON.stringify({ selected: 'blue', saved: 'blue' }) }, '*');
      document.querySelector('#miniapp-message .intelligent-ui-frame').contentWindow.postMessage({ type: 'state', requestId: 1, json: JSON.stringify({ selected: 'blue', saved: 'blue' }) }, '*');
    }, miniHtml);
    const other = page.frameLocator('#isolated-room .intelligent-ui-frame').frameLocator('iframe');
    await other.locator('body[data-miniapp-ready=true]').waitFor();
    assert.equal(await other.locator('#room-wall').getAttribute('fill'), '#E5D4BF', 'different task begins with its own state');
    await other.locator('[data-palette=blue]').click();
    await other.locator('#save-status[data-persisted=true]').waitFor();
    await other.locator('#save-choice').click();
    await other.locator('#save-status[data-persisted=true]').waitFor();
    await page.evaluate(() => document.getElementById('isolated-room').remove());
    await restoreMini();
    assert.equal(await mini.locator('#saved-choice').textContent(), '鼠尾草绿 · #B6C1AD', 'other task and forged messages cannot overwrite the original');

    for (const width of [320, 375, 414, 760]) {
      await page.locator('#miniapp-message .intelligent-ui-output').evaluate((el, width) => { el.style.width = `${width}px`; }, width);
      await mini.locator('body').evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(await mini.locator('body').evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `mini-app fits ${width}px`);
    }
    assert.ok(await mini.locator('body').evaluate(() => document.body.scrollHeight < 500), 'room mini-app has a compact chat footprint');
    await page.locator('#miniapp-message .intelligent-ui-output').screenshot({ path: 'output/playwright/intelligent-ui/room-miniapp.png' });

    const persistedHistory = await page.evaluate(() => ({ timeline: miniTimeline, sessionId: state.currentSession.id }));
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanIntelligentUi);
    await page.evaluate(async ({ timeline, sessionId }) => {
      if (state.currentSession?.id !== sessionId) await loadSession(sessionId);
      setEmptyState(false);
      window.miniTimeline = timeline;
      window.inlineBody = appendMessage('assistant', '').querySelector('.msg-body');
      inlineBody.id = 'miniapp-message';
      renderAgentRunBody(inlineBody, { status: 'done', summaryStarted: true, timeline: miniTimeline, modelId: 'deepseek-v4' });
    }, persistedHistory);
    await mini.locator('body[data-miniapp-ready=true]').waitFor();
    assert.equal(await mini.locator('#saved-choice').textContent(), '鼠尾草绿 · #B6C1AD', 'renderer reload restores persisted choice');

    // Arbitrary user text roundtrips without being interpreted as frame markup.
    assert.equal(await mini.locator('body').evaluate(async () => window.yanUi.setState({ selected: 'sage', saved: 'sage', note: '</script><script>window.injected=true</script>\u2028\u2029' })), true);
    await restoreMini();
    assert.deepEqual(await mini.locator('body').evaluate(() => ({ note: window.yanUi.getState().note, injected: window.injected === true })), { note: '</script><script>window.injected=true</script>\u2028\u2029', injected: false });

    const revisedHtml = `${miniHtml}\n<span hidden data-content-version="2"></span>`;
    const revised = createIntelligentUi(miniActive, miniArgs.task_id, { task_id: miniArgs.task_id, action: 'render', html: revisedHtml });
    await page.evaluate(({ html, rendered }) => {
      miniTimeline.push(
        { type: 'tool_call', callId: 'room-revision', name: 'yan_session_intelligent_ui_creator', args: { task_id: 'room-miniapp-test', action: 'render', html } },
        { type: 'tool_result', callId: 'room-revision', name: 'yan_session_intelligent_ui_creator', output: JSON.stringify(rendered), ok: true }
      );
      renderAgentRunBody(inlineBody, { status: 'done', summaryStarted: true, timeline: miniTimeline, modelId: 'deepseek-v4' });
    }, { html: revisedHtml, rendered: revised });
    await mini.locator('[data-content-version="2"]').waitFor({ state: 'attached' });
    assert.equal(await mini.locator('#room-wall').getAttribute('fill'), '#E5D4BF', 'new render content starts with clean state');
    assert.equal(await mini.locator('body').evaluate(() => window.yanUi.getState()), null);
    console.log('PASS inline rendering, cost interaction, room choice/save/restore/reload, state isolation and validation, compact pills, sandbox');
  } finally {
    await app?.close();
    await fs.promises.rm(userData, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
