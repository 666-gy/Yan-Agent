'use strict';
// A: browser_acceptance_sweep must complete a whole pass in one call.
// B: a repeated frame must come back as unchanged instead of re-transferring.
// C: quick mode must refuse to sign off a high-risk page (WebGL / password /
//    POST / payment) until the user approves the upgrade.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');

const SAFE = `<!doctype html><html><head><meta charset="utf-8"><title>Safe Page</title></head>
<body style="margin:0;background:#0b1020;color:#cfe;font:16px sans-serif">
<h1 id="title">Dashboard</h1><main style="padding:24px"><button id="go">继续</button></main>
<script>localStorage.setItem('probe-progress','3');</script></body></html>`;

const SENSITIVE = `<!doctype html><html><head><meta charset="utf-8"><title>Sensitive Page</title></head>
<body style="margin:0;background:#0b1020;color:#cfe"><form method="get" action="/search">
<input type="email" name="email" placeholder="邮箱"><button type="submit">订阅</button></form></body></html>`;

const DESTRUCTIVE = `<!doctype html><html><head><meta charset="utf-8"><title>Destructive Page</title></head>
<body style="margin:0;background:#0b1020;color:#cfe"><h1>项目</h1>
<button id="rm">删除这个项目</button></body></html>`;

const DIRTY = `<!doctype html><html><head><meta charset="utf-8"><title>Dirty Page</title></head>
<body style="margin:0;background:#0b1020;color:#cfe"><h1>控制台</h1>
<button id="post" onclick="fetch('/api/save',{method:'POST',body:'{}'});document.getElementById('r').textContent='saved'">保存设置</button>
<div id="r"></div></body></html>`;

const RISKY = `<!doctype html><html><head><meta charset="utf-8"><title>Risky Page</title></head>
<body style="margin:0"><canvas id="gl" style="width:100vw;height:60vh;display:block"></canvas>
<form method="post" action="/submit"><input type="password" name="pw"><button>登录</button></form>
<script>const gl=document.getElementById('gl').getContext('webgl');if(gl){gl.clearColor(0.1,0.2,0.3,1);gl.clear(gl.COLOR_BUFFER_BIT);}</script>
</body></html>`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-sweep-'));
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.url === '/risky') return res.end(RISKY);
    if (req.url === '/sensitive') return res.end(SENSITIVE);
    if (req.url === '/destructive') return res.end(DESTRUCTIVE);
    if (req.url === '/dirty') return res.end(DIRTY);
    res.end(SAFE);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let app;
  try {
    app = await _electron.launch({
      executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile }
    });
    const page = await app.firstWindow();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(async () => {
      window.YanStartupHello?.skip();
      const session = await api.createSession(true, '');
      session.messages = [{ role: 'user', content: '验收 sweep 探针' }];
      await api.saveSession(session);
      await loadSession(session.id);
      closeRightSidebar();
    });
    await page.evaluate(() => setRightSidebarOpen(true));
    await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('rs-hidden'));

    const opened = await page.evaluate(async url => agentOpenBuiltinBrowser(url, { runId: 'probe-run' }), `${base}/safe`);
    assert.equal(opened.ok, true, JSON.stringify(opened));
    await sleep(800);

    const command = (action, params) => page.evaluate(async ({ action, params }) => {
      const controller = browserTabControllers.get(agentBrowserTabsByRun.get('probe-run'));
      return await executeBrowserAgentCommand({
        action,
        operationId: `probe-${action}-${Date.now()}`,
        params: { yan_run_id: 'probe-run', purpose: 'frontend_acceptance', acceptance_level: 'rigorous', ...params },
        tabId: controller?.id || ''
      });
    }, { action, params });

    // A. one sweep = many checks + one frame.
    const sweep = await command('acceptance_sweep', {
      checks: [
        { type: 'title_contains', value: 'Safe Page' },
        { type: 'text_visible', value: 'Dashboard' },
        { type: 'element_visible', selector: '#go' },
        { type: 'no_horizontal_overflow' },
        { type: 'storage_equals', key: 'probe-progress', value: '3' },
        { type: 'no_console_errors' }
      ],
      settle_ms: 1500
    });
    assert.equal(sweep.ok, true, `sweep failed: ${JSON.stringify(sweep).slice(0, 500)}`);
    assert.equal(sweep.checks.length, 6, JSON.stringify(sweep.checks));
    assert.deepEqual(sweep.failed, []);
    assert.ok(sweep.image && sweep.image.data, 'sweep must return one frame');
    assert.ok(sweep.screenshot.viewport.width > 0);
    assert.ok(sweep.settleMs >= 0);
    console.log(`[sweep] ${sweep.checks.length} checks in one call, ${sweep.settleMs}ms settle, frame ${sweep.screenshot.viewport.width}x${sweep.screenshot.viewport.height}`);

    // A2. a failing check must be reported per-item, not as a blanket failure.
    const partial = await command('acceptance_sweep', {
      checks: [{ type: 'title_contains', value: 'Dashboard' }, { type: 'text_visible', value: '不存在的文案' }],
      settle_ms: 0
    });
    assert.equal(partial.ok, false);
    assert.deepEqual(partial.failed, ['title_contains', 'text_visible']);
    assert.equal(partial.checks.filter(check => check.pass).length, 0);

    // B. an identical frame is not re-transferred.
    const first = await command('screenshot', { force: true });
    assert.equal(first.ok, true, JSON.stringify(first).slice(0, 300));
    assert.ok(first.image?.data);
    const second = await command('screenshot', {});
    assert.equal(second.ok, true);
    assert.equal(second.unchanged, true, `repeated frame should be unchanged: ${JSON.stringify(second).slice(0, 300)}`);
    const forced = await command('screenshot', { force: true });
    assert.ok(forced.image?.data, 'force:true must return the image again');
    console.log(`[dedup] first=${first.image.data.length}B second=unchanged forced=${forced.image.data.length}B`);

    // C. quick mode must refuse a high-risk page.
    await page.evaluate(async url => {
      const controller = browserTabControllers.get(agentBrowserTabsByRun.get('probe-run'));
      await controller.navigate(url, { waitForLoad: true });
    }, `${base}/risky`);
    await sleep(600);
    await page.evaluate(() => {
      state.config = { ...state.config, browser: { ...(state.config?.browser || {}), acceptanceLevel: 'quick', acceptanceUpgradeAlways: false } };
    });
    const blocked = await command('acceptance_sweep', { checks: [{ type: 'canvas_present' }] });
    assert.equal(blocked.code, 'BROWSER_ACCEPTANCE_APPROVAL_REQUIRED', JSON.stringify(blocked).slice(0, 400));
    assert.ok(blocked.risk.length >= 3, `expected webgl+sensitive+write signals, got ${JSON.stringify(blocked.risk)}`);
    assert.match(blocked.error, /browser_request_acceptance_upgrade/);
    console.log(`[gate] quick blocked risky page: ${blocked.risk.join(' / ')}`);

    // C1b. category coverage beyond the three obvious signals.
    const navigate = url => page.evaluate(async target => {
      const controller = browserTabControllers.get(agentBrowserTabsByRun.get('probe-run'));
      await controller.navigate(target, { waitForLoad: true });
    }, url);
    for (const [route, expected] of [['/sensitive', /敏感输入/], ['/destructive', /破坏性操作/]]) {
      await navigate(`${base}${route}`);
      await sleep(500);
      const denied = await command('acceptance_sweep', { checks: [{ type: 'title_contains', value: 'x' }] });
      assert.equal(denied.code, 'BROWSER_ACCEPTANCE_APPROVAL_REQUIRED', `${route}: ${JSON.stringify(denied).slice(0, 300)}`);
      assert.ok(denied.risk.some(reason => expected.test(reason)), `${route}: ${JSON.stringify(denied.risk)}`);
      console.log(`[gate] ${route} blocked: ${denied.risk.join(' / ')}`);
    }

    // C1c. a page with no static risk is allowed, until it performs a write.
    await navigate(`${base}/dirty`);
    await sleep(500);
    const beforeWrite = await command('acceptance_sweep', { checks: [{ type: 'title_contains', value: 'Dirty Page' }] });
    assert.equal(beforeWrite.ok, true, `a clean page must pass before any write: ${JSON.stringify(beforeWrite).slice(0, 300)}`);
    const clicked = await command('evaluate', { expression: "document.getElementById('post').click(); 'clicked'" });
    assert.equal(clicked.ok, true, JSON.stringify(clicked).slice(0, 200));
    await sleep(400);
    const afterWrite = await command('acceptance_sweep', { checks: [{ type: 'title_contains', value: 'Dirty Page' }] });
    assert.equal(afterWrite.code, 'BROWSER_ACCEPTANCE_APPROVAL_REQUIRED', `a page write must revoke quick: ${JSON.stringify(afterWrite).slice(0, 300)}`);
    assert.ok(afterWrite.risk.some(reason => /写请求/.test(reason)), JSON.stringify(afterWrite.risk));
    console.log(`[gate] write detected and revoked quick: ${afterWrite.risk.join(' / ')}`);

    // C2. a non-risky page still passes in quick mode.
    await page.evaluate(async url => {
      const controller = browserTabControllers.get(agentBrowserTabsByRun.get('probe-run'));
      await controller.navigate(url, { waitForLoad: true });
    }, `${base}/safe`);
    await sleep(600);
    const quickOk = await command('acceptance_sweep', { checks: [{ type: 'title_contains', value: 'Safe Page' }] });
    assert.equal(quickOk.ok, true, `quick mode must still work on a safe page: ${JSON.stringify(quickOk).slice(0, 300)}`);

    // C3. approving the upgrade releases the gate.
    await page.evaluate(async url => {
      const controller = browserTabControllers.get(agentBrowserTabsByRun.get('probe-run'));
      await controller.navigate(url, { waitForLoad: true });
      state.config = { ...state.config, browser: { ...(state.config?.browser || {}), acceptanceUpgradeAlways: true } };
    }, `${base}/risky`);
    await sleep(600);
    const released = await command('acceptance_sweep', { checks: [{ type: 'canvas_present' }, { type: 'webgl_context_ok' }] });
    assert.equal(released.ok, true, `approved rigorous acceptance must run: ${JSON.stringify(released).slice(0, 400)}`);
    assert.ok(released.metrics.webgl && released.metrics.webgl.contextLost === false);
    console.log('[gate] approval released rigorous acceptance');

    assert.deepEqual(pageErrors, [], `sweep probe must not throw: ${pageErrors.join(' | ')}`);
    console.log('PASS: one-call sweep, per-check failures, frame dedup, and the quick-mode risk gate all behave as designed');
  } finally {
    server.closeAllConnections();
    if (app) await Promise.race([app.close().catch(() => {}), sleep(8000)]);
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
