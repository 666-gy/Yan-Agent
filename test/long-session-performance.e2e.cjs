'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const outputDir = path.join(appRoot, 'output', 'playwright');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-long-session-performance-e2e-'));

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
    await page.waitForFunction(() => typeof appendMessage === 'function' && typeof newSession === 'function');
    await page.locator('#taskBar:not(.hidden)').waitFor();

    const metrics = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      clearMessages();
      const timeline = [];
      for (let index = 0; index < 240; index++) {
        const callId = `perf-${index}`;
        timeline.push({ type: 'tool_call', stage: 'work', callId, name: 'read', args: { path: `src/${index}.js` } });
        timeline.push({ type: 'tool_result', stage: 'work', callId, name: 'read', output: `output-${index}`, ok: true });
      }
      timeline.push({ type: 'text', stage: 'summary', content: '性能测试完成。' });
      const agentRun = {
        runId: 'long-session-performance-run',
        status: 'done',
        summaryStarted: true,
        startedAt: Date.now() - 22 * 60_000,
        completedAt: Date.now(),
        durationMs: 22 * 60_000,
        timeline
      };
      state.currentSession.messages = [];
      appendMessage('user', '长会话性能测试', [], false, 0, Date.now() - 22 * 60_000);
      appendMessage('assistant', '性能测试完成。', [], false, 1, Date.now(), agentRun.durationMs, agentRun);
      setEmptyState(false);
      const message = document.querySelector('#messages .msg.assistant');
      const toggle = message.querySelector('.agent-work-toggle');
      toggle.click();
      message.querySelector('.tool-activity-group').open = true;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const scroll = document.querySelector('#chatScroll');
      const activity = message.querySelector('.agent-activity-body');
      const rows = message.querySelectorAll('.tool-activity-body > .tool-step');
      const firstRow = rows[0];
      const style = getComputedStyle(firstRow);
      const summaryStyle = getComputedStyle(message.querySelector('.tool-step > summary'));
      const scrollStyle = getComputedStyle(scroll);

      const frameTimes = [];
      await new Promise(resolve => {
        let previous = performance.now();
        let count = 0;
        const sample = now => {
          frameTimes.push(now - previous);
          previous = now;
          if (++count >= 120) resolve();
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });

      scroll.scrollTop = 0;
      const beforeScroll = scroll.scrollTop;
      scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
      const afterScroll = scroll.scrollTop;
      await new Promise(resolve => requestAnimationFrame(resolve));
      const maxFrameGap = Math.max(...frameTimes);
      return {
        mountedActivityParts: activity.children.length,
        mountedToolRows: rows.length,
        maxFrameGapMs: Math.round(maxFrameGap * 100) / 100,
        scrollChangedImmediately: afterScroll !== beforeScroll,
        scrollHeight: scroll.scrollHeight,
        scrollClientHeight: scroll.clientHeight,
        scrollTop: scroll.scrollTop,
        scrollBehavior: scrollStyle.scrollBehavior,
        rowContentVisibility: style.contentVisibility,
        rowContain: style.contain,
        summaryTransitionProperty: summaryStyle.transitionProperty
      };
    });

    assert.equal(metrics.scrollBehavior, 'auto');
    assert.equal(metrics.rowContentVisibility, 'visible');
    assert.equal(metrics.summaryTransitionProperty.includes('background'), false);
    assert.ok(metrics.scrollChangedImmediately || metrics.mountedToolRows > 0, `scroll metrics: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.mountedToolRows >= 100, `mounted tool rows: ${metrics.mountedToolRows}`);
    assert.ok(metrics.maxFrameGapMs < 100, `max frame gap: ${metrics.maxFrameGapMs}ms`);
    const scrollBox = await page.locator('#chatScroll').boundingBox();
    await page.evaluate(() => {
      const scroll = document.querySelector('#chatScroll');
      scroll.scrollTop = scroll.scrollHeight;
      window.__longSessionScrollSamples = [scroll.scrollTop];
      window.__longSessionScrollHandler = () => window.__longSessionScrollSamples.push(scroll.scrollTop);
      scroll.addEventListener('scroll', window.__longSessionScrollHandler, { passive: true });
    });
    await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2);
    await page.evaluate(() => {
      window.__longSessionFrameSamples = [];
      window.__longSessionFramePrevious = performance.now();
      window.__longSessionFrameActive = true;
      const sampleFrame = now => {
        if (!window.__longSessionFrameActive) return;
        window.__longSessionFrameSamples.push(now - window.__longSessionFramePrevious);
        window.__longSessionFramePrevious = now;
        requestAnimationFrame(sampleFrame);
      };
      requestAnimationFrame(sampleFrame);
    });
    for (let index = 0; index < 6; index++) {
      await page.mouse.wheel(0, -360);
      await page.waitForTimeout(24);
    }
    const wheelMetrics = await page.evaluate(() => {
      const scroll = document.querySelector('#chatScroll');
      scroll.removeEventListener('scroll', window.__longSessionScrollHandler);
      window.__longSessionFrameActive = false;
      return {
        scrollSamples: window.__longSessionScrollSamples,
        frameSamples: window.__longSessionFrameSamples
      };
    });
    const upwardJumps = wheelMetrics.scrollSamples.slice(1).filter((value, index) => value > wheelMetrics.scrollSamples[index] + 1);
    const maxWheelFrameGap = Math.max(...wheelMetrics.frameSamples);
    assert.equal(upwardJumps.length, 0, `wheel scroll oscillated: ${JSON.stringify(wheelMetrics.scrollSamples)}`);
    assert.ok(maxWheelFrameGap < 100, `wheel frame gap: ${maxWheelFrameGap}ms`);
    fs.mkdirSync(outputDir, { recursive: true });
    const screenshot = path.join(outputDir, 'long-session-performance.png');
    await page.screenshot({ path: screenshot, fullPage: false });
    console.log(JSON.stringify({ ok: true, metrics, wheelMetrics, screenshot }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
