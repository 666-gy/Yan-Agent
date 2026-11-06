'use strict';

// Sidebar motion acceptance: both panels reveal by sliding their layout margin
// (natural width hand-off to the main column) instead of popping in with a
// fade/translate, and the final state is still fully collapsed.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-sidebar-motion-'));
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
    await page.waitForFunction(() => typeof setLeftSidebarOpen === 'function' && typeof setRightSidebarOpen === 'function', null, { timeout: 60000 });
    await page.locator('#yanStartupHello').waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    await page.evaluate(() => window.YanStartupHello?.skip());
    await page.locator('#yanStartupHello').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);

    // --- left sidebar --------------------------------------------------------
    const motion = await page.evaluate(() => {
      const panel = document.querySelector('#sidebar');
      const style = getComputedStyle(panel);
      return { property: style.transitionProperty, duration: style.transitionDuration, display: style.display };
    });
    assert.match(motion.property, /margin-left/);
    assert.ok(motion.duration.split(',').every(value => value.trim() === '0.24s'), motion.duration);
    assert.notEqual(motion.display, 'none', 'the sidebar must stay laid out so it can slide');

    const closing = await page.evaluate(async () => {
      setLeftSidebarOpen(false);
      const panel = document.querySelector('#sidebar');
      const read = () => parseFloat(getComputedStyle(panel).marginLeft) || 0;
      await new Promise(resolve => setTimeout(resolve, 90));
      const mid = read();
      await new Promise(resolve => setTimeout(resolve, 320));
      return { mid, end: read(), display: getComputedStyle(panel).display, inert: panel.inert };
    });
    assert.ok(closing.mid < -1 && closing.mid > -255, `the sidebar must be mid-slide, not a jump: ${closing.mid}`);
    assert.ok(Math.abs(closing.end + 256) <= 1, `the sidebar must settle fully collapsed: ${closing.end}`);
    assert.notEqual(closing.display, 'none');
    assert.equal(closing.inert, true, 'a hidden sidebar stays inert');
    await page.screenshot({ path: path.join(evidenceDir, 'sidebar-motion-closed.png') });

    const opening = await page.evaluate(async () => {
      setLeftSidebarOpen(true);
      const panel = document.querySelector('#sidebar');
      const read = () => parseFloat(getComputedStyle(panel).marginLeft) || 0;
      await new Promise(resolve => setTimeout(resolve, 90));
      const mid = read();
      await new Promise(resolve => setTimeout(resolve, 320));
      return { mid, end: read() };
    });
    assert.ok(opening.mid > -255 && opening.mid < -1, `the sidebar must slide back in: ${opening.mid}`);
    assert.ok(Math.abs(opening.end) <= 1, `the sidebar must settle fully open: ${opening.end}`);

    // --- right sidebar -------------------------------------------------------
    await page.evaluate(() => openRightSidebarTool('review'));
    await page.waitForTimeout(400);
    const rightMotion = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('#rightSidebar'));
      return { property: style.transitionProperty, duration: style.transitionDuration };
    });
    assert.match(rightMotion.property, /margin-right/);
    assert.ok(rightMotion.duration.split(',').every(value => value.trim() === '0.24s'), rightMotion.duration);

    const rightClosing = await page.evaluate(async () => {
      const panel = document.querySelector('#rightSidebar');
      const width = panel.getBoundingClientRect().width;
      setRightSidebarOpen(false);
      const read = () => parseFloat(getComputedStyle(panel).marginRight) || 0;
      await new Promise(resolve => setTimeout(resolve, 90));
      const mid = read();
      await new Promise(resolve => setTimeout(resolve, 320));
      return { width, mid, end: read(), display: getComputedStyle(panel).display };
    });
    assert.ok(rightClosing.mid < -1 && rightClosing.mid > -(rightClosing.width - 1), `the panel must be mid-slide: ${JSON.stringify(rightClosing)}`);
    assert.ok(Math.abs(rightClosing.end + rightClosing.width) <= 2, `the panel must settle fully collapsed: ${JSON.stringify(rightClosing)}`);
    assert.notEqual(rightClosing.display, 'none');

    console.log('sidebar-motion.e2e: OK');
  } finally {
    try { await application?.close(); } catch { /* already closed */ }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('sidebar-motion.e2e: FAILED');
  console.error(error);
  process.exitCode = 1;
});
