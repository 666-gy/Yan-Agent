'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { createControlLease } = require('../lib/computer-control-lease');
const { createComputerAdapter } = require('../lib/yan-computer-mcp');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-desktop-control-'));
const owner = '1234567890abcdef';
(async () => {
  let app, adapter, native;
  try {
    const fixture = path.join(dir, 'main.cjs');
    fs.writeFileSync(fixture, `const electron = require('electron');
        global.run = { status: 'running', aborted: false, steps: 0 };
        global.lifecycle = require(${JSON.stringify(path.join(root, 'lib/computer-control-lifecycle'))});
        require(${JSON.stringify(path.join(root, 'lib/main/computer-control-desktop'))}).registerComputerControlDesktop({
          ...electron, paths: { dataDir: ${JSON.stringify(dir)}, appRoot: ${JSON.stringify(root)} },
          // Isolate the fixture from the user's running control session and cursor scheme.
          spawnCursor() { return require('child_process').spawn(process.execPath, ['-e',
            'console.log("ready");process.stdin.resume();process.stdin.on("end",()=>process.exit(0))'],
            { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe','pipe','pipe'], windowsHide: true }); },
          globalShortcut: { register(key, callback) { global.escape = callback; return true; },
            unregister() {} }
        });
      electron.app.whenReady().then(() => {
        const win = new electron.BrowserWindow({ show: false }); win.loadURL('about:blank');
        electron.app.on('window-all-closed', () => {});
      });`);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: require('electron'), args: [fixture], cwd: root, env });
    await app.firstWindow();
    let worker, rejectInput, delivered = 0;
    const createClient = () => worker = {
      closed: false, id: 1,
      start: async () => ['click', 'end_session'].map(name => ({ name, description: name, inputSchema: { type: 'object' } })),
      request: async (_, params) => {
        if (params.name === 'end_session') return { content: [] };
        delivered++;
        return new Promise((resolve, reject) => { rejectInput = reject; });
      },
      close: async () => { worker.closed = true; rejectInput?.(new Error('worker released')); }, notify: async () => {}
    };
    adapter = createComputerAdapter({ client: createClient(), createClient, imageDir: dir,
      createLease: release => createControlLease(dir, release, owner) });
    const observe = id => app.evaluate((_, { id, owner }) => {
      global.lifecycle.emit('tool-event', id, { type: 'session.next.tool.called', data: { tool: `yanp_${owner}_plugin_computer_click` } });
    }, { id, owner });
    await observe('run-1');
    const first = adapter.call(1, 'click').then(() => null, e => e.message);
    const queued = adapter.call(2, 'click').then(() => null, e => e.message);
    const opened = await app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
    await opened?.waitForURL('**/computer-control-overlay/index.html');
    const overlay = app.windows().find(page => page.url().includes('computer-control-overlay'));
    if (!overlay) throw new Error(`Desktop overlay did not open: ${await first}`);
    await overlay.locator('.status-pill').waitFor();
    assert.match(await overlay.locator('.status-pill').innerText(), /Yan Agent 正在操控你的电脑.*按 Esc 退出/s);
    assert.equal(await overlay.locator('button').count(), 0);
    assert.equal(await overlay.locator('img').evaluate(img => img.complete && img.naturalWidth > 0), true);
    await overlay.evaluate(() => {
      window.controlPointerFeedback({ type: 'move', x: 100, y: 200 });
      window.controlPointerFeedback({ type: 'move', x: 150, y: 200 });
      window.controlPointerFeedback({ type: 'click', x: 150, y: 200 });
    });
    await overlay.waitForFunction(() => {
      const canvas = document.getElementById('pointer-feedback');
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v > 0);
    });
    fs.mkdirSync(path.join(root, 'output/playwright/computer-control'), { recursive: true });
    await overlay.screenshot({ path: path.join(root, 'output/playwright/computer-control/desktop-overlay.png') });
    await app.evaluate(() => { global.escape(); global.run.steps++; });
    assert.match(await first, /COMPUTER_CONTROL_RELEASED/);
    assert.match(await queued, /COMPUTER_CONTROL_RELEASED/);
    assert.equal(delivered, 1);
    assert.deepEqual(await app.evaluate(() => global.run), { status: 'running', aborted: false, steps: 1 });
    assert.equal(await app.evaluate(({ BrowserWindow, globalShortcut }) => ({
      windows: BrowserWindow.getAllWindows().filter(w => w.getTitle() === 'Yan Agent 电脑操控').length,
      escape: globalShortcut.isRegistered('Escape')
    })).then(v => v.windows === 0 && v.escape === false), true);
    await assert.rejects(adapter.call(3, 'click'), /COMPUTER_CONTROL_RELEASED/);
    assert.equal((await adapter.call(4, 'end_session')).isError, undefined);
    await observe('run-2');
    const next = adapter.call(5, 'click').then(() => null, e => e.message);
    await app.waitForEvent('window', { timeout: 20000 });
    await app.evaluate(() => global.lifecycle.emit('run-ended', 'run-2'));
    assert.match(await next, /COMPUTER_CONTROL_RELEASED/);
    await observe('run-3');
    const { PluginMcpClient } = require('../lib/plugins/mcp-client');
    native = new PluginMcpClient({ id: 'desktop-smoke', type: 'local', command: process.execPath,
      args: [path.join(root, 'lib/yan-computer-mcp.js')], cwd: root,
      env: { ...process.env, YAN_COMPUTER_DATA_DIR: dir, YAN_COMPUTER_OWNER: owner }, timeoutMs: 30000 });
    await native.start();
    const result = await native.request('tools/call', { name: 'get_screen_size', arguments: {} });
    assert.ok(!result.isError, JSON.stringify(result));
    const ended = await native.request('tools/call', { name: 'end_session', arguments: {} });
    assert.ok(!ended.isError, JSON.stringify(ended));
    console.log('PASS: desktop overlay, Esc releases active/queued input without cancelling task, next run can acquire, completion cleans up, real CUA read-only smoke.');
  } finally {
    await native?.close(); await adapter?.close(); await app?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
