'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const url = pathToFileURL(path.resolve(__dirname, '../preview/hello-startup/index.html')).href;
    await page.goto(url + '?helloPreview');
    assert.equal(await page.locator('#app').evaluate(e => e.inert), true);
    assert.equal(await page.locator('.hello-enter').isVisible(), false);
    await page.waitForFunction(() => {
      const animations = document.getAnimations().filter(a => a.effect.target.tagName === 'path');
      return animations.length === 2 && animations.every(a => a.playState === 'finished');
    });
    const widths = [];
    for (const text of ['让想法妙笔生花', '现在开始，慧启新生', '一起构建吧', '让想法妙笔生花']) {
      await page.waitForFunction(text => document.querySelector('.hello-type')?.textContent === text, text);
      await page.waitForTimeout(230);
      widths.push(await page.locator('.hello-enter').evaluate(e => e.getBoundingClientRect().width));
    }
    assert.ok(widths[1] > widths[0] && widths[0] > widths[2], 'pill follows phrase width');
    assert.equal(await page.locator('#app').evaluate(e => e.inert), true, 'still waiting after a full loop');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#yanStartupHello').count(), 1, 'no keyboard bypass');
    await page.screenshot({ path: path.resolve(__dirname, '../preview/hello-startup/hello.png') });
    await page.locator('.hello-enter').click();
    await page.locator('#yanStartupHello').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#app').evaluate(e => e.inert), false);
    await page.goto(url + '?helloPreview');
    await page.evaluate(() => window.YanStartupHello.skip());
    await page.locator('#yanStartupHello').waitFor({ state: 'detached' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url + '?helloPreview');
    await page.waitForFunction(() => document.querySelector('.hello-type')?.textContent === '让想法妙笔生花');
    await page.locator('.hello-enter').click();
    await page.locator('#yanStartupHello').waitFor({ state: 'detached' });
    // Ordinary browser loads must not introduce the desktop-only startup layer.
    await page.goto(url);
    assert.equal(await page.locator('#yanStartupHello').count(), 0);
    // Simulate the preload bridge and verify that a renderer reload never replays it.
    await page.addInitScript(() => {
      window.yan = { onStartupShown(cb) { setTimeout(cb, 20); return () => {}; } };
    });
    await page.goto(url);
    await page.locator('.hello-enter').click();
    await page.locator('#yanStartupHello').waitFor({ state: 'detached' });
    await page.reload();
    assert.equal(await page.locator('#yanStartupHello').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: handwriting then pill, all phrases loop, adaptive width, waits for click, internal skip, reduced motion, reload exclusion');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
