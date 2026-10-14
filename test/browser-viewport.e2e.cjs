'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-viewport-'));
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#dceaff}button{margin:40px;padding:20px}@media(max-width:500px){body{background:#ffe5dc}}</style><h1>Responsive preview</h1><button onclick="this.textContent=\'Clicked\'">Test click</button>');
});
(async () => {
  let app;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    const command = (action, params = {}) => page.evaluate(({ action, params }) =>
      executeBrowserAgentCommand({ action, params: { ...params, yan_run_id: 'viewport-test' } }), { action, params });
    const opened = await command('open', { target_type: 'url', url_or_path: `http://127.0.0.1:${server.address().port}` });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    const measure = () => page.evaluate(id => browserTabControllers.get(id).webview.executeJavaScript(
      '({width:innerWidth,height:innerHeight,color:getComputedStyle(document.body).backgroundColor,mobile:matchMedia("(max-width:500px)").matches,clicked:document.querySelector("button").textContent})'), opened.tabId);
    for (const [width, height] of [[390, 844], [844, 390], [768, 1024], [1440, 900]]) {
      const resized = await command('set_viewport', { width, height });
      assert.equal(resized.ok, true, JSON.stringify(resized));
      assert.deepEqual(resized.viewport, { width, height });
      const metrics = await measure();
      assert.equal(metrics.mobile, width <= 500);
      assert.equal(metrics.color, width <= 500 ? "rgb(255, 229, 220)" : "rgb(220, 234, 255)");
      const shot = await command('screenshot');
      assert.equal(shot.ok, true, JSON.stringify(shot));
      const png = Buffer.from(shot.image.data, 'base64');
      if (width === 390) { fs.mkdirSync(path.join(root, 'output/playwright/browser-viewport'), {recursive:true}); fs.writeFileSync(path.join(root, 'output/playwright/browser-viewport/phone-capture.png'), png); }
      const ratio = png.readUInt32BE(16) / png.readUInt32BE(20);
      assert.ok(Math.abs(ratio - width / height) < 0.01, 'Screenshot preserves viewport aspect ratio');
    }
    await command('set_viewport', { width: 390, height: 844 });
    const point = await page.evaluate(id => browserTabControllers.get(id).webview.executeJavaScript(
      '(()=>{const r=document.querySelector("button").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()'), opened.tabId);
    const clicked = await command('pointer', { action: 'click', ...point });
    assert.equal(clicked.ok, true, JSON.stringify(clicked));
    assert.equal((await measure()).clicked, 'Clicked');
    const invalid = await command('set_viewport', { width: -1, height: 844 });
    assert.equal(invalid.ok, false);
    await command('screenshot');
    assert.equal((await measure()).width, 390);
    assert.equal((await measure()).color, 'rgb(255, 229, 220)');
    await page.waitForTimeout(200);
    const evidence = path.join(root, 'output/playwright/browser-viewport');
    fs.mkdirSync(evidence, { recursive: true });
    const preview = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    fs.writeFileSync(path.join(evidence, 'phone-preview.png'), Buffer.from(preview, 'base64'));
    assert.equal(await page.locator('[data-browser-viewport], .browser-viewport-controls').count(), 0);
    const reset = await command('set_viewport', { reset: true });
    assert.equal(reset.ok, true, JSON.stringify(reset));
    assert.equal(reset.mode, 'auto');
    assert.equal(await page.evaluate(id => browserTabControllers.get(id).responsiveViewport, opened.tabId), null);
    // Preserve the user's zoom and page state across every control exit.
    await page.evaluate(id => {
      const controller = browserTabControllers.get(id);
      controller.manualZoom = 0.8;
      syncBrowserViewport(id);
    }, opened.tabId);
    await page.waitForFunction(id => browserTabControllers.get(id).zoom === 0.8, opened.tabId);
    const original = await measure();
    for (const exit of ['run_finished', 'run_cancelled', 'escape', 'cleanup_failure']) {
      await page.evaluate(id => setBrowserAgentControl(browserTabControllers.get(id), true, { runId: 'viewport-test' }), opened.tabId);
      await command('set_viewport', { width: 1440, height: 900 });
      await command('set_viewport', { width: 390, height: 844 });
      assert.equal((await measure()).width, 390);
      if (exit === 'escape') {
        await page.keyboard.press('Escape');
      } else if (exit === 'cleanup_failure') {
        await page.evaluate(async id => {
          const agent = browserTabControllers.get(id).agent;
          const release = agent.releaseActions;
          agent.releaseActions = async () => { throw new Error('Guest cleanup failed'); };
          try { await executeBrowserAgentCommand({ action: 'release', params: { yan_run_id: 'viewport-test' } }); }
          catch (error) { if (error.message !== 'Guest cleanup failed') throw error; }
          finally { agent.releaseActions = release; }
        }, opened.tabId);
      } else {
        assert.equal((await command('release', { reason: exit })).ok, true);
      }
      await page.waitForFunction(id => {
        const c = browserTabControllers.get(id);
        return !c.agentControlActive && !c.responsiveViewport && c.viewportScale === 1
          && c.webview.style.transform === '' && c.zoom === 0.8
          && !c.panel.classList.contains('responsive-viewport')
          && [...c.root.querySelectorAll('[data-browser-zoom]')].every(button => !button.disabled);
      }, opened.tabId);
      await page.waitForFunction(async ({ id, original }) => {
        const actual = await browserTabControllers.get(id).webview.executeJavaScript('({width:innerWidth,height:innerHeight})');
        return actual.width === original.width && actual.height === original.height;
      }, { id: opened.tabId, original });
      assert.deepEqual(await measure(), original, `Restore actual page dimensions, breakpoint and content after ${exit}`);
    }
    // Hidden tabs must lose the fixed geometry immediately, before reactivation.
    await page.evaluate(id => setBrowserAgentControl(browserTabControllers.get(id), true, { runId: 'viewport-test' }), opened.tabId);
    await command('set_viewport', { width: 390, height: 844 });
    const hidden = await page.evaluate(id => {
      const c = browserTabControllers.get(id);
      c.root.classList.remove('active');
      releaseBrowserAgentControl('viewport-test');
      const result = { viewport: c.responsiveViewport, transform: c.webview.style.transform, width: c.webview.style.width };
      c.root.classList.add('active');
      syncBrowserViewport(id);
      return result;
    }, opened.tabId);
    assert.deepEqual(hidden, { viewport: null, transform: '', width: '' });
    console.log('PASS: responsive CSS dimensions, breakpoints, screenshot ratios, pointer clicks, Agent-only controls, validation and reset.');
    console.log('PASS: automatic viewport restoration on completion, cancellation, Escape, guest cleanup failure and hidden-tab release; user zoom/content preserved.');
  } finally {
    if (app) await app.close();
    await new Promise(resolve => server.close(resolve));
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (error) { if (!['EPERM', 'EBUSY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
