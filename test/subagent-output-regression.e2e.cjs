'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-child-output-'));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof subagentPanel !== 'undefined' && quickInputHandlerReady);
    await page.evaluate(() => window.YanStartupHello?.skip());
    await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      window.childOutputRecord = { id: 'child-output', role: 'builder', title: '计算平方和', status: 'running', startedAt: Date.now() - 3000,
        executionStartedAt: Date.now() - 2500, revision: 0, outputRevision: 0, timeline: [], result: '' };
      state.currentSession.messages = [{ role: 'assistant', content: '', agentRun: { runId: 'test', status: 'working', subagentWorkflowVersion: 1, timeline: [], subagents: [childOutputRecord] } }];
      subagentPanel.open(childOutputRecord.id);
    });
    const body = page.locator('[data-subagents-detail-body]');
    const initial = await body.locator('.run-elapsed').innerText();
    await page.waitForFunction(value => document.querySelector('[data-subagents-detail-body] .run-elapsed')?.textContent !== value, initial, { timeout: 4000 });
    assert.equal(await page.evaluate(() => childOutputRecord.responseStartedAt || null), null, 'clock advances before any output arrives');
    await page.evaluate(() => {
      Object.assign(childOutputRecord, { status: 'completed', completedAt: Date.now(), result: 'B：结果 55。\n计算依据：1 + 4 + 9 + 16 + 25 = 55。', outputRevision: 1,
        timeline: [{ type: 'text', content: 'B：结果 55。', stage: 'work', openCodeKey: 't1' }, { type: 'text', content: '\n计算依据：1 + 4 + 9 + 16 + 25 = 55。', stage: 'work', openCodeKey: 't2' }] });
      subagentPanel.render();
    });
    assert.equal((await body.innerText()).split('B：结果 55。').length - 1, 1);
    assert.equal(await body.locator('.agent-work-toggle').count(), 0, 'plain answer is not work history');
    await page.evaluate(() => {
      childOutputRecord.timeline.unshift({ type: 'thinking', content: '核对平方和', stage: 'work', openCodeKey: 'reasoning:1', streaming: false });
      childOutputRecord.outputRevision++;
      subagentPanel.render();
    });
    const toggle = body.locator('.agent-work-toggle');
    await toggle.click();
    assert.equal((await body.innerText()).split('B：结果 55。').length - 1, 1, 'expanded work never duplicates the answer');
    await toggle.click();
    assert.equal((await body.innerText()).split('B：结果 55。').length - 1, 1);
    const frozen = await body.locator('.run-elapsed').innerText();
    await page.waitForTimeout(1100);
    assert.equal(await body.locator('.run-elapsed').innerText(), frozen, 'settled duration is fixed');
    assert.deepEqual(errors, []);
    console.log('Child output regression passed: pre-output clock, text-only answer, multipart answer, work toggle and settled duration.');
  } finally { await app?.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
