'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'playwright', 'work-gui');
const url = pathToFileURL(path.join(root, 'renderer', 'work-gui', 'preview.html')).href;
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.YanWorkGui?.debug3d().characters === 5);
    await page.waitForTimeout(800);
    const firstPixels = await page.evaluate(() => window.YanWorkGui.samplePixels());
    assert.ok(firstPixels.colors > 40, JSON.stringify(firstPixels));
    assert.ok(firstPixels.opaque > 100);
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.wgu-top .wgu-icon').count(), 3, 'only district icons remain in the header');
    assert.equal(await page.locator('[data-action="pause"],[data-action="residents"]').count(), 0);
    assert.equal(await page.locator('.wgu-camera > button:last-child').getAttribute('data-action'), 'day');
    assert.equal(await page.locator('.wgu-side,.wgu-card,.wgu-session').count(), 0);
    assert.equal(await page.evaluate(() => window.YanWorkGui.getState().actors.find(a => a.id === 'main').name), 'Yan Agent');
    assert.equal(await page.evaluate(() => window.YanWorkGui.getState().actors.find(a => a.id === 'sub:read').name), 'Research Agent');
    const identity = await page.evaluate(() => ({
      circular: [...document.querySelectorAll('.wgu-camera button')].every(button => {
        const rect = button.getBoundingClientRect();
        return Math.abs(rect.width - rect.height) < 1 && parseFloat(getComputedStyle(button).borderRadius) >= rect.height / 2;
      })
    }));
    assert.deepEqual(identity, { circular: true });
    assert.equal(await page.evaluate(() => window.YanSubagentPanel.iconFor('explore') === window.YanSubagentPanel.iconFor('explorer')), true);
    await page.screenshot({ path: path.join(output, 'overview.png') });
    const initial = await page.evaluate(() => window.YanWorkGui.debug3d());
    assert.ok(initial.triangles > 0);
    assert.ok(initial.calls < 700, 'static scene uses shared instance batches');
    const working = initial.projected.find(a => a.id === 'main');
    assert.equal(working.pose, 'type');
    assert.equal(initial.projected.find(a => a.id === 'sub:read').pose, 'read');
    assert.equal(initial.projected.find(a => a.id === 'sub:design').pose, 'paint');

    // Pointer tooltips use the names printed above the buildings.
    await page.evaluate(async () => window.YanWorkGui.applySnapshot({ ...await api.workGuiSnapshot(), agents: [] }));
    await page.waitForFunction(() => window.YanWorkGui.debug3d().characters === 0);
    const places = await page.evaluate(() => window.YanWorkGui.debug3d().places);
    assert.equal(places.length, 8);
    for (const place of places) {
      assert.equal(place.visible, true, place.name);
      await page.mouse.move(place.x, place.y);
      await page.waitForFunction(name => document.querySelector('.wgu-tip:not([hidden]) strong')?.textContent === name, place.name, { timeout: 2500 });
    }
    const workshop = places.find(place => place.zone === 'workshop');
    assert.equal(workshop.name, '编程工坊');
    await page.mouse.click(workshop.x, workshop.y);
    await page.waitForFunction(() => window.YanWorkGui.debug3d().camera.span < 40);
    assert.equal(await page.locator('.wgu-side,.wgu-inspector').count(), 0);
    await page.evaluate(async () => window.YanWorkGui.applySnapshot(await api.workGuiSnapshot()));
    await page.waitForFunction(() => window.YanWorkGui.debug3d().characters === 5);

    // Changing districts moves the view; it must not turn working residents idle.
    const before = await page.evaluate(() => window.YanWorkGui.getState().actors);
    await page.locator('[data-scene="home"]').click();
    await page.waitForTimeout(700);
    assert.deepEqual(await page.evaluate(() => window.YanWorkGui.getState().actors), before);
    await page.screenshot({ path: path.join(output, 'home.png') });
    await page.locator('[data-scene="worksite"]').click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(output, 'work.png') });

    // Clicking a resident follows them without opening an inspector.
    const hit = await page.evaluate(() => window.YanWorkGui.debug3d().projected.find(a => a.id === 'main'));
    await page.mouse.click(hit.x, hit.y);
    await page.waitForFunction(() => window.YanWorkGui.debug3d().followId === 'main');
    assert.equal(await page.locator('.wgu-side,.wgu-inspector').count(), 0);
    await page.waitForTimeout(850);
    await page.screenshot({ path: path.join(output, 'resident.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.YanWorkGui.debug3d().followId), '');

    assert.equal(await page.evaluate(() => window.YanWorkGui.debug3d().characters), 5);
    await page.locator('[data-action="reset"]').click();
    await page.locator('[data-action="day"]').click();
    await page.waitForTimeout(700);
    assert.equal(await page.locator('[data-action="day"]').getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: path.join(output, 'night.png') });
    await page.locator('[data-action="day"]').click();

    // Completion changes behaviour: the resident heads to a living area, across a bridge.
    await page.evaluate(() => window.YanWorkGui.ingest({ events: [{
      kind: 'agent.updated', agentId: 'sub:read', runId: 'preview-run', ts: Date.now(),
      payload: { name: '资料研究员', state: 'done', zone: 'library', toolCount: 6 }
    }] }));
    await page.waitForTimeout(50);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => window.YanWorkGui.debug3d().reducedMotion);
    await page.waitForTimeout(150);
    const resting = await page.evaluate(() => window.YanWorkGui.debug3d().projected.find(a => a.id === 'sub:read'));
    assert.ok(resting.position.x > 15, 'completed resident goes to the living bank');
    assert.notEqual(resting.pose, 'type');

    const responsive = [];
    for (const width of [320, 375, 414, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.locator('[data-action="reset"]').click();
      await page.waitForTimeout(180);
      const pixels = await page.evaluate(() => window.YanWorkGui.samplePixels());
      assert.ok(pixels.colors > 40, JSON.stringify(pixels));
      const layout = await page.evaluate(() => {
        const root = document.querySelector('.wgu-root');
        const controls = [...document.querySelectorAll('.wgu-scenes button,.wgu-camera button')];
        return {
          rootWidth: root.clientWidth, scrollWidth: root.scrollWidth,
          clipped: controls.filter(b => { const r=b.getBoundingClientRect(); return r.left<0 || r.right>innerWidth || r.top<0 || r.bottom>innerHeight; }).map(b=>b.title||b.textContent),
          twoLine: [...document.querySelectorAll('.wgu-scene')].some(b => b.scrollHeight > b.clientHeight)
        };
      });
      assert.equal(layout.clipped.length, 0, JSON.stringify(layout));
      assert.ok(layout.scrollWidth <= layout.rootWidth, JSON.stringify(layout));
      assert.equal(layout.twoLine, false);
      responsive.push(width);
      await page.screenshot({ path: path.join(output, 'width-' + width + '.png') });
      if (width === 320) {
        const resident = await page.evaluate(() => window.YanWorkGui.debug3d().projected.find(a => a.id === 'main'));
        await page.mouse.click(resident.x, resident.y);
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.YanWorkGui.debug3d().followId), 'main');
        assert.equal(await page.locator('.wgu-side,.wgu-inspector').count(), 0);
        await page.screenshot({ path: path.join(output, 'mobile-follow.png') });
        await page.locator('[data-action="reset"]').click();
      }
    }

    // A machine without WebGL keeps an explicit fallback without restoring panels.
    const fallback = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await fallback.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return String(type).includes('webgl') ? null : getContext.call(this, type, ...args);
      };
    });
    await fallback.goto(url);
    await fallback.waitForSelector('.wgu-root[data-error="true"]');
    assert.match(await fallback.locator('.wgu-hint').textContent(), /无法显示/);
    assert.equal(await fallback.locator('.wgu-side,.wgu-card,.wgu-session').count(), 0);
    await fallback.screenshot({ path: path.join(output, 'fallback.png') });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({ ok:true, calls:initial.calls, triangles:initial.triangles, firstPixels, responsive, screenshots:output }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
