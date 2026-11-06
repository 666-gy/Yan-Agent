'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-subagent-ui-'));
const output = path.join(appRoot, 'output', 'playwright');
fs.mkdirSync(output, { recursive: true });
const launch = () => electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
  env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir } });

(async () => {
  let app;
  const errors = [];
  try {
    app = await launch();
    let page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof initOpenCodeRunState === 'function' && typeof subagentPanel !== 'undefined' && quickInputHandlerReady);
    await page.evaluate(() => window.YanStartupHello?.skip());
    await page.locator('#yanStartupHello').waitFor({ state: 'detached' });
    if (!fs.existsSync(path.join(appRoot, 'output', 'delegation-live-events.json'))) require('node:child_process').execFileSync(process.execPath, ['--test', '--test-name-pattern=standard: real dynamic child', 'test/kernel-v2-delegation.test.cjs'], { cwd: appRoot, timeout: 60000, stdio: 'pipe', windowsHide: true });
    const fixture = JSON.parse(fs.readFileSync(path.join(appRoot, 'output', 'delegation-live-events.json'), 'utf8'));
    await page.evaluate(async ({ events, result }) => {
      if (!state.currentSession) await newSession();
      const session = state.currentSession;
      session.title = '动态子代理真实事件';
      session.messages = [{ role: 'user', content: '自主派发并整合结果', ts: Date.now() }];
      renderMessages(session.messages); setEmptyState(false);
      const ctx = createRunCtx(session.id, true, session.workspace || '');
      initOpenCodeRunState(ctx);
      const assistantEl = appendMessage('assistant', '');
      state.activeRuns.set(session.id, { sessionRef: session, runCtx: ctx, assistantEl });
      for (const event of events) applyOpenCodeEvent(ctx, event);
      const finished = openCodeResultToAgentRun(result, ctx);
      session.messages.push({ role: 'assistant', content: result.text, agentRun: finished, ts: Date.now() });
      state.activeRuns.delete(session.id);
      renderMessages(session.messages); renderSubagentUi();
      subagentPanel.open();
      await saveCurrentSession();
    }, fixture);
    assert.equal(await page.locator('[data-subagent-ui-id]').count(), 1);
    assert.equal(await page.locator('.subagent-ui-row.is-completed').count(), 1);
    const avatarIndex = await page.locator('.subagent-ui-row [data-agent-avatar]').getAttribute('data-agent-avatar');
    await page.locator('[data-subagent-ui-id]').click();
    assert.equal(await page.locator('[data-subagents-detail-icon] [data-agent-avatar]').getAttribute('data-agent-avatar'), avatarIndex);
    const avatarChecks = await page.evaluate(() => {
      const record = state.currentSession.messages.find(m => m.agentRun?.subagents?.length).agentRun.subagents[0];
      const resumed = { ...record, activationID: 'resumed-activation', role: 'different-role', title: 'renamed', status: 'running' };
      return {
        stable: YanSubagentPanel.avatarIndex(record) === YanSubagentPanel.avatarIndex(resumed),
        count: new Set(Array.from({ length: 1000 }, (_, i) => YanSubagentPanel.avatarIndex({ agentID: 'agent-' + i }))).size,
        safe: !YanSubagentPanel.avatarFor({ agentID: '<img onerror=alert(1)>' }).includes('onerror')
      };
    });
    assert.deepEqual(avatarChecks, { stable: true, count: 28, safe: true });
    await page.evaluate(async () => {
      await Promise.all(Array.from({ length: 28 }, (_, index) => ['light', 'dark'].map(async theme => {
        const image = new Image();
        image.src = `assets/subagent-avatars/${String(index).padStart(2, '0')}-${theme}.svg`;
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight) throw new Error(`Empty avatar ${image.src}`);
      })).flat());
    });
    assert.equal(await page.locator('[data-subagents-detail-name]').innerText(), '动态调查');
    assert.ok((await page.locator('[data-subagents-detail-body]').innerText()).includes('CHILD_VERIFIED_RESULT'));
    const layout = await page.locator('[data-subagents-detail-body]').evaluate(body => {
      const list = body.querySelector('.agent-summary-output ul') || body.querySelector('ul');
      return { nested: !!list?.querySelector('li > ul'), italic: list?.querySelectorAll('em').length,
        empty: body.querySelectorAll('p:empty').length,
        height: list?.getBoundingClientRect().height,
        rows: list?.querySelectorAll('li').length };
    });
    assert.equal(layout.nested, true, 'nested lists retain their structure');
    assert.equal(layout.italic, 0, 'list markers do not become emphasis');
    assert.equal(layout.empty, 0, 'list blank lines do not create empty paragraphs');
    assert.ok(layout.height < layout.rows * 45, JSON.stringify(layout));
    assert.equal(await page.locator('#rs-subagents input, #rs-subagents textarea, [data-subagents-steer]').count(), 0);
    await page.evaluate(() => {
      const run = state.currentSession.messages.find(m => m.agentRun?.subagents?.length).agentRun;
      const child = run.subagents[0];
      child.modelName = 'DeepSeek-v4.1-flash'; child.reasoningMode = 'medium';
      for (const status of ['running', 'interrupted', 'error']) run.subagents.push({ ...child, agentID: 'layout-' + status, id: 'layout-' + status, status, title: status });
      subagentPanel.open(child.id);
    });
    assert.equal(await page.locator('[data-subagents-detail-model]').innerText(), 'DeepSeek-v4.1-flash · 中');
    assert.ok(await page.locator('.subagents-detail-header').evaluate(el => el.getBoundingClientRect().height <= 42));
    await page.locator('[data-subagents-back]').click();
    assert.equal(await page.locator('[data-subagents-active] [data-subagent-ui-id]').count(), 1);
    assert.equal(await page.locator('[data-subagents-completed] [data-subagent-ui-id]').count(), 3);
    const rowLayout = await page.locator('.subagent-ui-row').first().evaluate(el => ({ radius: getComputedStyle(el).borderRadius, height: el.getBoundingClientRect().height, iconHeight: el.querySelector('.subagent-ui-icon').getBoundingClientRect().height }));
    // Current rows retain the title + description layout; avatars must not expand it.
    assert.ok(rowLayout.radius === '0px' && rowLayout.height <= 54 && rowLayout.iconHeight <= 22, JSON.stringify(rowLayout));
    await page.screenshot({ path: path.join(output, 'subagent-compact-list.png') });
    await page.locator('[data-subagents-completed] [data-subagent-ui-id]').first().click();
    for (const theme of ['light', 'dark']) {
      const colors = await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        const main = getComputedStyle(document.querySelector('.main'));
        const child = getComputedStyle(document.querySelector('#rs-subagents'));
        return { main: main.backgroundColor, child: child.backgroundColor };
      }, theme);
      assert.equal(colors.child, colors.main, `${theme}: child surface matches main chat`);
      const image = page.locator(`[data-subagents-detail-icon] .subagent-avatar-${theme}`);
      await image.evaluate(img => img.decode());
      assert.equal(await image.isVisible(), true);
      assert.equal(await page.locator(`[data-subagents-detail-icon] .subagent-avatar-${theme === 'dark' ? 'light' : 'dark'}`).isVisible(), false);
      await page.screenshot({ path: path.join(output, `subagent-theme-${theme}.png`) });
    }
    await page.screenshot({ path: path.join(output, 'subagent-dynamic-completed.png') });
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.waitForFunction(() => typeof subagentPanel !== 'undefined' && quickInputHandlerReady);
    await page.evaluate(() => { window.YanStartupHello?.skip(); subagentPanel.open(); });
    await page.locator('#yanStartupHello').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.subagent-ui-row.is-completed').count(), 1);
    assert.equal(await page.locator('.subagent-ui-row [data-agent-avatar]').getAttribute('data-agent-avatar'), avatarIndex, 'avatar survives desktop restart');
    await page.locator('[data-subagent-ui-id]').click();
    assert.equal(await page.locator('[data-subagents-detail-name]').innerText(), '动态调查');
    assert.equal(await page.locator('#rs-subagents input, #rs-subagents textarea').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: real kernel delegation events render dynamic names, completion, child results, main-only guidance, and survive desktop restart');
  } finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
