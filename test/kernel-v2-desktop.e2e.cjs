'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'playwright', 'node-v2');
const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'yan-node-desktop-'));
const workspace = path.join(profile, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
execFileSync('git', ['init', '--quiet', workspace], { windowsHide: true });
fs.mkdirSync(path.join(profile, 'YanData'), { recursive: true });
const skillDir = path.join(profile, 'YanData', 'skills', 'node-v2-proof');
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: node-v2-proof\ndescription: Node migration verification\n---\nWhen asked to apply this skill, reply with the exact marker YAN_SKILL_CONTEXT_OK. Do not call tools.\n');
fs.mkdirSync(output, { recursive: true });
// Electron's Windows OSCrypt key lives in Local State; config alone is insufficient.
fs.copyFileSync(path.join(process.env.APPDATA, 'yan-agent', 'Local State'), path.join(profile, 'Local State'));
const config = JSON.parse(fs.readFileSync(process.env.YAN_E2E_CONFIG_PATH || path.join(process.env.APPDATA, 'yan-agent', 'YanData', 'config.json'), 'utf8'));
config.workspace = workspace;
// These acceptance commands use PowerShell syntax; keep shell selection explicit.
config.general = { ...(config.general || {}), terminalShell: 'powershell' };
config.memory = { ...(config.memory || {}), enabled: false };
config.agent = { ...config.agent, accessMode: 'full', workMode: 'normal' };
config.agent.enableSubagents = true;
config.pet = { ...config.pet, enabled: false };
fs.writeFileSync(path.join(profile, 'YanData', 'config.json'), JSON.stringify(config));

(async () => {
  const net = require('node:net');
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const log = fs.openSync(path.join(output, 'desktop.log'), 'w');
  const env = { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `npm start -- --remote-debugging-port=${port}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] });
  let browser;
  try {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
      if (child.exitCode !== null) throw new Error(`npm start exited ${child.exitCode}`);
      await delay(500);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    let page;
    for (let count = 0; count < 100; count++) {
      page = context.pages().find(p => p.url().includes('index.html'));
      if (page) break;
      await delay(100);
    }
    assert.ok(page, 'desktop window exists');
    await page.waitForFunction(() => window.__YAN_APP_READY__ && !!state.currentSession, { timeout: 60000 });
    await page.evaluate(async workspace => {
      const session = await window.yan.createSession(true, workspace);
      await loadSession(session.id);
      window.__nodeTest = { events: [], completed: null };
      window.yan.onOpenCodeEvent(detail => { window.__nodeTest.events.push(detail.event.type); });
      window.yan.onOpenCodeCompleted(detail => { window.__nodeTest.completed = detail; });
    }, workspace);
    console.log('Desktop ready; submitting real model task.');
    await page.locator('#composerInput').fill('请在当前工作目录创建 node-kernel-proof.txt，内容严格为 YAN_NODE_V2_OK，然后读取该文件确认内容。完成后回复“Node 新内核任务已完成”。必须实际调用文件工具，不要只描述步骤。');
    await page.locator('#sendBtn').click();
    await page.waitForFunction(() => !!window.__nodeTest.completed, null, { timeout: 240000 });
    const outcome = await page.evaluate(() => window.__nodeTest);
    fs.writeFileSync(path.join(output, 'outcome.json'), JSON.stringify(outcome, null, 2));
    await page.screenshot({ path: path.join(output, 'desktop-task.png'), fullPage: true });
    assert.equal(outcome.completed.result?.status, 'done', JSON.stringify(outcome.completed));
    assert.equal(outcome.completed.result?.runtime, 'node');
    assert.equal(fs.readFileSync(path.join(workspace, 'node-kernel-proof.txt'), 'utf8').trim(), 'YAN_NODE_V2_OK');
    assert.ok(outcome.completed.result.toolCalls.some(call => call.ok), 'real tool executed');
    assert.ok(outcome.completed.result.changes.some(file => file.file.endsWith('node-kernel-proof.txt')), 'real snapshot diff returned');
    await page.waitForFunction(() => !document.querySelector('#sendBtn').classList.contains('stop'), null, { timeout: 10000 });
    await page.waitForFunction(id => state.currentSession.openCodeSessionId === id, outcome.completed.result.openCodeSessionId, { timeout: 15000 });
    await page.evaluate(() => { window.__nodeTest.completed = null; });
    await page.locator('#composerInput').fill('继续同一个任务：读取刚才的 node-kernel-proof.txt，确认内容后只回复“续接已完成”。');
    await page.locator('#sendBtn').click();
    await page.waitForFunction(() => !!window.__nodeTest.completed, null, { timeout: 120000 });
    const resumed = await page.evaluate(() => window.__nodeTest.completed.result);
    assert.equal(resumed.status, 'done', resumed.error);
    assert.equal(resumed.openCodeSessionId, outcome.completed.result.openCodeSessionId, 'same kernel session resumes');
    assert.ok(resumed.toolCalls.some(call => call.name === 'read' && call.ok));
    fs.writeFileSync(path.join(output, 'resume.json'), JSON.stringify(resumed, null, 2));
    await page.waitForFunction(() => !document.querySelector('#sendBtn').classList.contains('stop'));
    await page.locator('#composerInput').fill('请应用我选择的技能，按照技能正文要求回复。');
    await page.evaluate(() => {
      window.__nodeTest.completed = null;
      setComposerSkills([{ id: 'node-v2-proof', name: 'node-v2-proof' }]);
    });
    await page.locator('#sendBtn').click();
    await page.waitForFunction(() => !!window.__nodeTest.completed, null, { timeout: 120000 });
    const skillResult = await page.evaluate(() => window.__nodeTest.completed.result);
    assert.equal(skillResult.status, 'done', skillResult.error);
    assert.match(skillResult.text, /YAN_SKILL_CONTEXT_OK/);
    assert.equal(skillResult.toolCalls.length, 0, 'selected skill instructions arrive without rediscovery');
    fs.writeFileSync(path.join(output, 'skill.json'), JSON.stringify(skillResult, null, 2));
    await page.waitForFunction(() => !document.querySelector('#sendBtn').classList.contains('stop'));
    await page.evaluate(() => { window.__nodeTest.completed = null; });
    await page.locator('#composerInput').fill('使用 bash 工具执行 Write-Output YAN_V2_SHELL_OK，然后使用 plugins_list 查看插件目录，并使用 yan_runtime_log 列出日志。三个工具都必须实际调用，完成后回复 YAN_V2_BRIDGE_OK。');
    await page.locator('#sendBtn').click();
    await page.waitForFunction(() => !!window.__nodeTest.completed, null, { timeout: 180000 });
    const bridge = await page.evaluate(() => window.__nodeTest.completed.result);
    fs.writeFileSync(path.join(output, 'bridge.json'), JSON.stringify(bridge, null, 2));
    assert.equal(bridge.status, 'done', bridge.error);
    for (const name of ['bash', 'plugins_list', 'yan_runtime_log']) assert.ok(bridge.toolCalls.some(call => call.name === name && call.ok), JSON.stringify(bridge.toolCalls));
    assert.ok(bridge.toolCalls.some(call => call.name === 'bash' && /^YAN_V2_SHELL_OK\r?$/m.test(call.output) && call.output.includes('Command exited with code 0.')));
    await page.waitForFunction(() => !document.querySelector('#sendBtn').classList.contains('stop'));
    await page.evaluate(() => { window.__nodeTest.completed = null; window.__nodeTest.events = []; });
    await page.locator('#composerInput').fill('请实际调用 spawn_agent 工具，name 选择 文件调查，委派它只读 node-kernel-proof.txt 并报告文件内容。收到子代理结果后回复 YAN_V2_CHILD_OK。不要由主代理自己读取文件代替委派。');
    await page.locator('#sendBtn').click();
    try {
      await page.waitForFunction(() => !!window.__nodeTest.completed, null, { timeout: 240000 });
    } catch (error) {
      fs.writeFileSync(path.join(output, 'subagent-failure.json'), JSON.stringify(await page.evaluate(() => window.__nodeTest), null, 2));
      if (process.env.YAN_PRODUCT_ACCEPTANCE !== '1') throw error;
      await page.evaluate(async () => {
        for (const entry of state.activeRuns.values()) if (entry.runCtx?.runId) await window.yan.openCodeCancelRun(entry.runCtx.runId);
      });
      await page.waitForFunction(() => !!window.__nodeTest.completed, null, { timeout: 30000 });
    }
    const delegated = await page.evaluate(() => window.__nodeTest);
    fs.writeFileSync(path.join(output, 'subagent.json'), JSON.stringify(delegated, null, 2));
    const childPassed = delegated.completed.result?.status === 'done'
      && delegated.completed.result?.toolCalls.some(call => call.name === 'spawn_agent' && call.ok)
      && delegated.events.includes('yan.subagent.event');
    if (process.env.YAN_PRODUCT_ACCEPTANCE !== '1') assert.ok(childPassed, 'real child task and desktop events completed');
    if (process.env.YAN_PRODUCT_ACCEPTANCE === '1') {
      const cases = [{ name: 'subagent', status: childPassed ? 'passed' : 'failed',
        ...(!childPassed ? { error: delegated.completed.result?.error || 'Child execution failed or timed out' } : {}) }];
      async function verify(name, action) {
        try { await action(); cases.push({ name, status: 'passed' }); console.log(`[product] ${name}: passed`); }
        catch (error) {
          cases.push({ name, status: 'failed', error: error.message });
          console.error(`[product] ${name}: ${error.message}`);
          await page.screenshot({ path: path.join(output, `product-${name}.png`), fullPage: true }).catch(() => {});
          const active = await page.evaluate(() => [...state.activeRuns.values()].map(item => item.runCtx?.runId).filter(Boolean));
          for (const id of active) await page.evaluate(id => window.yan.openCodeCancelRun(id), id).catch(() => {});
          await page.waitForFunction(() => state.activeRuns.size === 0, null, { timeout: 30000 }).catch(() => {});
        }
        fs.writeFileSync(path.join(output, 'product-acceptance.json'), JSON.stringify(cases, null, 2));
      }
      async function submit(prompt) {
        await page.waitForFunction(() => !document.querySelector('#sendBtn').classList.contains('stop'), null, { timeout: 30000 });
        await page.evaluate(() => { window.__nodeTest.completed = null; window.__nodeTest.events = []; });
        await page.locator('#composerInput').fill(prompt);
        await page.locator('#sendBtn').click();
      }
      async function completed(name) {
        await page.waitForFunction(() => !!window.__nodeTest.completed, null, { timeout: 150000 });
        const result = await page.evaluate(() => window.__nodeTest.completed.result);
        fs.writeFileSync(path.join(output, `product-${name}.json`), JSON.stringify(result, null, 2));
        await page.waitForFunction(() => state.activeRuns.size === 0 && !document.querySelector('#sendBtn').classList.contains('stop'), null, { timeout: 30000 });
        return result;
      }
      await verify('compression', async () => {
        await page.waitForFunction(() => !document.querySelector('#sendBtn').classList.contains('stop'));
        await page.evaluate(() => manuallyCompressContext());
        assert.ok(await page.evaluate(() => state.currentSession.contextCompressionCount > 0), 'manual compression completed in UI');
        await submit('读取 node-kernel-proof.txt，确认内容后回复 YAN_COMPACT_RESUME_OK。');
        const result = await completed('compression');
        assert.equal(result.status, 'done', result.error);
        assert.match(result.text, /YAN_COMPACT_RESUME_OK/);
        assert.ok(result.toolCalls.some(call => call.name === 'read' && call.ok));
      });
      let cancelledKernelSession = '';
      await verify('cancel', async () => {
        cancelledKernelSession = await page.evaluate(() => state.currentSession.openCodeSessionId);
        assert.ok(cancelledKernelSession, 'cancel starts from a bound kernel session');
        await submit('必须调用 bash 执行 Set-Content cancellation-started.txt RUNNING; Start-Sleep -Seconds 60; Write-Output YAN_CANCEL_SHOULD_NOT_APPEAR。不要使用后台模式，等待命令结束。');
        // A file written by the actual command proves the shell started; model
        // streaming and text in the user prompt do not establish tool execution.
        const started = path.join(workspace, 'cancellation-started.txt');
        const deadline = Date.now() + 60000;
        while (!fs.existsSync(started) && Date.now() < deadline) await delay(100);
        assert.ok(fs.existsSync(started), 'long-running shell actually started');
        await page.locator('#sendBtn').click();
        const result = await completed('cancel');
        assert.equal(result.status, 'interrupted', JSON.stringify(result));
        assert.equal(result.toolCalls.some(call => call.ok && call.output?.includes('YAN_CANCEL_SHOULD_NOT_APPEAR')), false);
        assert.equal(await page.evaluate(() => state.currentSession.openCodeSessionId), cancelledKernelSession,
          'abort keeps the kernel session binding');
      });
      await verify('permission-deny', async () => {
        await page.evaluate(() => selectAccessMode('request'));
        await submit('必须用 bash 执行 Write-Output YAN_PERMISSION_DENIED。若用户拒绝则停止，不要换工具重试。');
        await page.locator('#agentPermissionPanel:not(.hidden)').waitFor({ timeout: 60000 });
        await page.locator('#agentPermissionDeny').click();
        const result = await completed('permission-deny');
        assert.equal(result.status, 'error', JSON.stringify(result));
        assert.equal(result.toolCalls.some(call => call.name === 'bash' && call.ok), false);
        assert.equal(result.openCodeSessionId, cancelledKernelSession, 'the next turn resumes the aborted kernel session');
      });
      await verify('permission-once', async () => {
        await submit('必须用 bash 执行 Write-Output YAN_PERMISSION_ONCE，然后回复完成。');
        await page.locator('#agentPermissionPanel:not(.hidden)').waitFor({ timeout: 60000 });
        await page.locator('#agentPermissionOnce').click();
        const result = await completed('permission-once');
        assert.equal(result.status, 'done', result.error);
        assert.ok(result.toolCalls.some(call => call.name === 'bash' && call.ok && /^YAN_PERMISSION_ONCE\r?$/m.test(call.output)));
      });
      await verify('read-only', async () => {
        await page.evaluate(async () => {
          await selectAccessMode('full');
          state.config = await window.yan.setConfig({ agent: { sandboxMode: 'read-only' } });
        });
        await submit('尝试用文件工具创建 readonly-forbidden.txt 内容为 FORBIDDEN。若权限拒绝则停止，不要绕过。');
        const result = await completed('read-only');
        assert.equal(fs.existsSync(path.join(workspace, 'readonly-forbidden.txt')), false, 'read-only must block writes');
        assert.equal(result.toolCalls.some(call => ['write', 'edit', 'patch'].includes(call.name) && call.ok), false);
        await page.evaluate(async () => { state.config = await window.yan.setConfig({ agent: { sandboxMode: 'full' } }); });
      });
      await verify('history-reload', async () => {
        await page.waitForFunction(() => !document.querySelector('#sendBtn').classList.contains('stop'));
        const id = await page.evaluate(() => state.currentSession.id);
        const before = await page.evaluate(id => window.yan.getSession(id), id);
        assert.ok(before.messages.length > 0);
        await page.reload();
        await page.waitForFunction(() => window.__YAN_APP_READY__ && !!state.currentSession);
        await page.evaluate(async id => {
          await loadSession(id);
          window.__nodeTest = { events: [], completed: null };
          window.yan.onOpenCodeEvent(detail => window.__nodeTest.events.push(detail.event.type));
          window.yan.onOpenCodeCompleted(detail => { window.__nodeTest.completed = detail; });
        }, id);
        const after = await page.evaluate(id => window.yan.getSession(id), id);
        assert.equal(after.messages.length, before.messages.length);
        assert.equal(after.openCodeSessionId, before.openCodeSessionId);
        assert.ok(await page.evaluate(() => document.body.innerText.includes('node-kernel-proof.txt')), 'user history visible after renderer reload');
        await submit('读取 node-kernel-proof.txt 后回复 YAN_HISTORY_RESUME_OK。');
        const result = await completed('history-reload');
        assert.equal(result.status, 'done', result.error);
        assert.equal(result.openCodeSessionId, before.openCodeSessionId);
      });
      await verify('session-delete', async () => {
        await page.waitForFunction(() => !document.querySelector('#sendBtn').classList.contains('stop'));
        const result = await page.evaluate(() => window.yan.deleteSession(state.currentSession.id, true));
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(fs.readFileSync(path.join(workspace, 'node-kernel-proof.txt'), 'utf8').trim(), 'YAN_NODE_V2_OK', 'deleting chat preserves workspace deliverables');
      });
      assert.equal(cases.filter(item => item.status === 'failed').length, 0, 'Product acceptance failures: see product-acceptance.json');
    }
    console.log(JSON.stringify({ status: 'passed', version: outcome.completed.result.openCodeVersion, runtime: 'node', tools: outcome.completed.result.toolCalls.map(call => ({ name: call.name, ok: call.ok })), screenshot: path.join(output, 'desktop-task.png') }));
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
    fs.closeSync(log);
    // The copied configuration contains encrypted credentials; do not keep it as an artifact.
    fs.rmSync(path.join(profile, 'YanData', 'config.json'), { force: true });
    fs.rmSync(path.join(profile, 'Local State'), { force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
