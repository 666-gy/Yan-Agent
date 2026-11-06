'use strict';
// Reload must fail fast, say which step stalled, retry once, and leave the model
// with an actionable next step instead of an opaque guest timeout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');

const HEALTHY = `<!doctype html><html><head><meta charset="utf-8"><title>Healthy</title></head>
<body style="margin:0;background:#0b1020;color:#cfe"><h1>健康页面</h1></body></html>`;

// Blocks its own main thread for 40 s as soon as load fires, so every guest
// call after commit hangs the way the reported session did.
const BLOCKING = `<!doctype html><html><head><meta charset="utf-8"><title>Blocking</title></head>
<body style="margin:0;background:#0b1020;color:#cfe"><h1>阻塞页面</h1>
<script>
window.addEventListener('load', () => { const end = performance.now() + 40000; while (performance.now() < end) {} });
</script></body></html>`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-reload-'));
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.url === '/blocking' ? BLOCKING : HEALTHY);
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
      session.messages = [{ role: 'user', content: 'reload 韧性探针' }];
      await api.saveSession(session);
      await loadSession(session.id);
      closeRightSidebar();
    });
    await page.evaluate(() => setRightSidebarOpen(true));
    await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('rs-hidden'));

    const opened = await page.evaluate(async url => agentOpenBuiltinBrowser(url, { runId: 'probe-run' }), `${base}/healthy`);
    assert.equal(opened.ok, true, JSON.stringify(opened));
    await sleep(600);

    const reload = () => page.evaluate(async () => {
      const controller = browserTabControllers.get(agentBrowserTabsByRun.get('probe-run'));
      const started = performance.now();
      const result = await executeBrowserAgentCommand({
        action: 'reload',
        operationId: `probe-reload-${Date.now()}`,
        params: { yan_run_id: 'probe-run', purpose: 'frontend_acceptance', acceptance_level: 'rigorous' },
        tabId: controller.id
      });
      return { ms: Math.round(performance.now() - started), ok: result?.ok, code: result?.code, step: result?.step, retried: result?.retried, error: String(result?.error || '') };
    });

    // 1. Healthy page: reload stays fast and does not retry.
    const healthy = await reload();
    assert.equal(healthy.ok, true, JSON.stringify(healthy));
    assert.equal(healthy.retried, undefined);
    assert.ok(healthy.ms < 3000, `healthy reload should stay fast, took ${healthy.ms}ms`);
    console.log(`[reload] healthy ${healthy.ms}ms`);

    // 2. Blocked guest: fail with a step, retry once, stay well under the bridge budget.
    await page.evaluate(async url => {
      const controller = browserTabControllers.get(agentBrowserTabsByRun.get('probe-run'));
      await controller.navigate(url, { waitForLoad: true });
    }, `${base}/blocking`);
    await sleep(500);
    const blocked = await reload();
    assert.equal(blocked.ok, false, JSON.stringify(blocked));
    assert.ok(/^BROWSER_RELOAD_/.test(String(blocked.code)), `expected a reload-specific code, got ${blocked.code}`);
    assert.ok(['settle', 'pageState'].includes(blocked.step), `expected a step name, got ${blocked.step}`);
    assert.equal(blocked.retried, true, 'reload must retry once');
    assert.match(blocked.error, /browser_snapshot/);
    assert.ok(blocked.ms < 32000, `blocked reload must fail under the bridge budget, took ${blocked.ms}ms`);
    assert.ok(blocked.ms > 4000, `expected the retry to consume real time, took ${blocked.ms}ms`);
    console.log(`[reload] blocked ${blocked.ms}ms code=${blocked.code} step=${blocked.step} retried=${blocked.retried}`);

    assert.deepEqual(pageErrors, [], `reload probe must not throw: ${pageErrors.join(' | ')}`);
    console.log('PASS: reload stays fast when healthy, and reports step + retry + next step when the guest is stuck');
  } finally {
    server.closeAllConnections();
    if (app) await Promise.race([app.close().catch(() => {}), sleep(8000)]);
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
