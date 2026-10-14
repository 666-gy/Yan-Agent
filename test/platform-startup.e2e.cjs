'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-platform-start-'));
let application;
(async () => {
  const packaged = process.env.YAN_PLATFORM_EXECUTABLE;
  const args = packaged ? [] : [root];
  // Electron 44 on Linux can report an unusable inspector port when passed 0.
  // Choose an available loopback port explicitly for the startup test.
  const availablePort = () => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  const inspectorPort = await availablePort();
  let browserPort = await availablePort();
  while (browserPort === inspectorPort) browserPort = await availablePort();
  args.unshift(`--inspect=127.0.0.1:${inspectorPort}`, `--remote-debugging-port=${browserPort}`);
  if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox');
  application = await _electron.launch({ executablePath: packaged || require('electron'), args, cwd: root,
    env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: path.join(directory, 'data') }, timeout: 60000 });
  const page = await application.firstWindow();
  await page.waitForFunction(() => window.__YAN_APP_READY__, { timeout: 60000 });
  await page.waitForFunction(() => typeof state !== 'undefined' && !!state.currentSession, { timeout: 60000 });
  assert.equal(await page.locator('#yanFatalError').count(), 0);
  assert.equal(await page.locator('#app').count(), 1);
  await page.locator('#settingsBtn').click();
  await page.locator('#settings-tab-browser').click();
  assert.ok(await page.locator('#browserPreferences').isVisible());
  fs.mkdirSync(path.join(root, 'output/cross-platform'), { recursive: true });
  await page.screenshot({ path: path.join(root, `output/cross-platform/startup-${process.platform}-${process.arch}.png`) });
  console.log(`Verified ${packaged ? 'packaged' : 'source'} ${process.platform}/${process.arch}: application initialized, session created, browser settings opened`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  // Native child services may keep a CI Electron process alive during shutdown.
  // Bound test cleanup after the normal quit handlers have had time to run.
  await application?.evaluate(({ app }) => {
    const timer = setTimeout(() => app.exit(0), 10000);
    timer.unref();
  }).catch(() => {});
  await application?.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
