'use strict';
// Regression for the built-in browser's blocked-guest behaviour and the new
// acceptance primitives:
//  - a guest whose main thread is stuck must fail fast with a specific code
//    instead of hanging until the 40 s bridge budget;
//  - the serial action queue must keep advancing while the guest is stuck;
//  - browser_eval returns values and storage, inspect_page reports WebGL
//    context state instead of sampling the GPU framebuffer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const BLOCK_MS = 45000;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Guest Probe</title>
<style>html,body{margin:0;height:100%;background:#0b1020;color:#cfe;font:16px sans-serif}
canvas{display:block;width:100vw;height:100vh}</style></head><body>
<canvas id="gl"></canvas><div id="out" style="position:absolute;left:12px;top:12px">ready</div>
<script>
window.__state = { hits: 0 };
localStorage.setItem('probe-key', 'probe-value');
sessionStorage.setItem('probe-session', 's-value');
const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl', { antialias: true });
window.__glOk = !!gl;
if (gl) {
  const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; gl.viewport(0, 0, canvas.width, canvas.height); };
  resize(); addEventListener('resize', resize);
  const tick = () => { gl.clearColor(0.05, 0.08, 0.2, 1); gl.clear(gl.COLOR_BUFFER_BIT); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
window.__block = ms => { const end = performance.now() + ms; while (performance.now() < end) { /* busy */ } };
</script></body></html>`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-guest-probe-'));
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
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
      session.messages = [{ role: 'user', content: '内置浏览器阻塞回归' }];
      await api.saveSession(session);
      await loadSession(session.id);
      closeRightSidebar();
    });
    await page.evaluate(() => setRightSidebarOpen(true));
    await page.waitForFunction(() => !document.getElementById('app')?.classList.contains('rs-hidden'));

    await page.evaluate(async url => {
      const tab = createRightSidebarTab('browser');
      activateRightSidebarTab(tab.id);
      const controller = browserTabControllers.get(tab.id);
      await controller.navigate(url, { waitForLoad: true });
      window.__probe = { tabId: tab.id };
    }, `${base}/page`);
    await sleep(1200);

    // 1. New acceptance primitives on a WebGL page.
    const evalValue = await page.evaluate(() => browserTabControllers.get(window.__probe.tabId).agent.evaluate('document.title'));
    assert.equal(evalValue.ok, true, JSON.stringify(evalValue));
    assert.equal(evalValue.value, 'Guest Probe');

    const evalObject = await page.evaluate(() => browserTabControllers.get(window.__probe.tabId).agent.evaluate('JSON.stringify(window.__state)'));
    assert.equal(evalObject.ok, true);
    assert.equal(evalObject.value, '{"hits":0}');

    const storage = await page.evaluate(() => browserTabControllers.get(window.__probe.tabId).agent.evaluate('', { storage: true }));
    assert.equal(storage.ok, true, JSON.stringify(storage));
    assert.equal(storage.localStorage['probe-key'], 'probe-value');
    assert.equal(storage.sessionStorage['probe-session'], 's-value');

    const inspect = await page.evaluate(() => browserTabControllers.get(window.__probe.tabId).agent.inspectPage({ includePerformance: true }));
    assert.equal(inspect.ok, true, JSON.stringify(inspect).slice(0, 400));
    const glCanvas = (inspect.canvases || []).find(item => item.kind === 'webgl');
    assert.ok(glCanvas, `inspect_page must report the WebGL canvas as webgl: ${JSON.stringify(inspect.canvases)}`);
    assert.equal(glCanvas.webgl.contextLost, false);
    assert.equal(glCanvas.pixelCoverage, undefined, 'a WebGL canvas must not be sampled with getImageData');
    assert.ok(inspect.resources && typeof inspect.resources.count === 'number');
    assert.ok(inspect.performance && 'loadMs' in inspect.performance);
    assert.ok(inspect.frameSample && typeof inspect.frameSample.fps === 'number', 'frameSample missing');
    console.log(`[guest] eval/storage/inspect ok, webgl renderer="${glCanvas.webgl.renderer.slice(0, 40)}" fps=${inspect.frameSample.fps}`);

    // 2. Blocked guest: fail fast with a code, and keep the queue moving.
    await page.evaluate(() => browserTabControllers.get(window.__probe.tabId).webview
      .executeJavaScript('setTimeout(() => window.__block(' + 45000 + '), 200); true'));
    await sleep(1200);

    const first = await page.evaluate(async () => {
      const started = performance.now();
      const result = await browserTabControllers.get(window.__probe.tabId).agent.snapshot();
      return { ms: Math.round(performance.now() - started), ok: result?.ok, code: result?.code };
    });
    assert.equal(first.ok, false, 'a blocked guest must not report success');
    assert.equal(first.code, 'BROWSER_GUEST_TIMEOUT', JSON.stringify(first));
    assert.ok(first.ms < 25000, `blocked guest must fail under the bridge budget, took ${first.ms}ms`);

    const second = await page.evaluate(async () => {
      const started = performance.now();
      const result = await browserTabControllers.get(window.__probe.tabId).agent.readPage();
      return { ms: Math.round(performance.now() - started), ok: result?.ok, code: result?.code };
    });
    assert.equal(second.ok, false);
    assert.equal(second.code, 'BROWSER_GUEST_TIMEOUT', 'the queue must advance instead of wedging behind the stuck call');
    console.log(`[guest] blocked snapshot=${first.ms}ms(${first.code}) readPage=${second.ms}ms(${second.code})`);

    // 3. After the guest unblocks everything works again.
    await sleep(Math.max(0, BLOCK_MS - (first.ms + second.ms) + 6000));
    const recovered = await page.evaluate(async () => {
      const started = performance.now();
      const result = await browserTabControllers.get(window.__probe.tabId).agent.snapshot();
      return { ms: Math.round(performance.now() - started), ok: result?.ok };
    });
    assert.equal(recovered.ok, true, `snapshot must recover after the guest unblocks: ${JSON.stringify(recovered)}`);
    assert.ok(recovered.ms < 10000, `recovered snapshot took ${recovered.ms}ms`);

    assert.deepEqual(pageErrors, [], `browser guest probe must not throw: ${pageErrors.join(' | ')}`);
    console.log('PASS: blocked guest fails fast with BROWSER_GUEST_TIMEOUT, the action queue keeps advancing, and eval/storage/WebGL inspection work');
  } finally {
    server.closeAllConnections();
    if (app) await Promise.race([app.close().catch(() => {}), sleep(8000)]);
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
