'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-background-bash-e2e-'));
const workspace = path.join(temp, 'workspace');
fs.mkdirSync(workspace);
fs.writeFileSync(path.join(workspace, 'slow.cjs'), "console.log('SHELL_STARTED'); console.log('SHELL_PID=' + process.pid); for (let i = 0; i < 100; i++) console.log('OUTPUT_LINE_' + i); setInterval(() => console.log('STREAM_TICK_' + Date.now()), 200); setTimeout(() => { console.log('SHELL_FINISHED'); process.exit(Number(process.argv[2] || 0)); }, Number(process.argv[3] || 6500));");
const failures = [], requests = [], commandCalls = [];
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'bash-fixture', object: 'model' }] })); return; }
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); const messages = body.messages || [];
    const index = messages.findLastIndex(message => message.role === 'user');
    const user = JSON.stringify(messages[index]?.content || '');
    const tools = messages.slice(index + 1).filter(message => message.role === 'tool');
    requests.push({ completion: user.includes('YAN BACKGROUND BASH COMPLETION'), kind: user.match(/BG_TEST_(SUCCESS|FAILURE|CANCEL_AGENT|CANCEL|DELETE|MANUAL|SHUTDOWN)/)?.[1], tools: tools.map(item => item.content) });
    const bash = body.tools?.find(item => item.function?.name === 'bash');
    let delta;
    if (user.includes('YAN BACKGROUND BASH COMPLETION')) {
      assert.match(user, /SHELL_FINISHED/);
      delta = { content: user.includes('failed') ? 'BG_RESUMED_FAILURE' : 'BG_RESUMED_SUCCESS' };
    } else if (bash && /BG_TEST_(SUCCESS|FAILURE|CANCEL_AGENT|CANCEL|DELETE|MANUAL|SHUTDOWN)/.test(user) && !tools.length) {
      const kind = user.match(/BG_TEST_(SUCCESS|FAILURE|CANCEL_AGENT|CANCEL|DELETE|MANUAL|SHUTDOWN)/)[1]; commandCalls.push(kind);
      assert.ok(bash.function.parameters.properties.run_in_background);
      delta = { tool_calls: [{ index: 0, id: 'call-' + commandCalls.length, type: 'function', function: { name: 'bash', arguments: JSON.stringify({
        command: 'node slow.cjs ' + (kind === 'FAILURE' ? 7 : 0) + ' ' + (['CANCEL', 'CANCEL_AGENT', 'DELETE', 'SHUTDOWN'].includes(kind) ? 60000 : 6500),
        yield_time_ms: kind === 'MANUAL' ? 120000 : 50
      }) } }] };
    } else if (tools.length) {
      assert.match(String(tools.at(-1).content), /running in the background/);
      delta = { content: 'BG_CONTINUED_OTHER_WORK' };
    } else delta = { content: 'fixture' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const emit = (data, finish = null) => res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'bash-fixture', choices: [{ index: 0, delta: data, finish_reason: finish }] }) + '\n\n');
    emit(delta);
    if (user.includes('BG_TEST_CANCEL_AGENT') && tools.length) return;
    emit({}, delta.tool_calls ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n');
  } catch (error) { failures.push(error.message); res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
});
let app;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
    env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: path.join(temp, 'profile') } });
  const page = await app.firstWindow();
  page.on('pageerror', error => failures.push(error.message));
  await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanBackgroundBash);
  await page.evaluate(async ({ url, workspace }) => {
    const saved = await api.connectionsSave({ name: 'Bash local fixture', apiKey: 'fixture', baseUrl: url, preset: 'openai', apiFormat: 'openai' });
    if (!saved.ok) throw new Error(saved.error);
    const model = (await api.listQuickModels()).models.find(item => item.id === 'bash-fixture');
    state.config = await api.setModelRole(model.providerId, model.id, 'text', model.supplierId || '');
    state.config = await api.setConfig({ agent: { accessMode: 'full', workMode: 'normal', reasoningSummary: 'off' }, general: { terminalShell: 'powershell' }, memory: { enabled: false }, workspace });
    renderModelBadge();
  }, { url: 'http://127.0.0.1:' + server.address().port + '/v1', workspace });
  async function task(kind) {
    return page.evaluate(async ({ kind, workspace }) => {
      const session = await api.createSession(true); session.workspace = workspace; session.title = kind;
      await api.saveSession(session); await refreshSessions(); await loadSession(session.id);
      window.__bashSubmit = submitMessage('BG_TEST_' + kind, [], []);
      return session.id;
    }, { kind, workspace });
  }
  async function jobs(id) { return page.evaluate(id => api.bashList(id), id); }
  async function until(check, label, timeout = 90000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = await check();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for ' + label);
  }
  async function waitJob(id, status) {
    return until(async () => (await jobs(id)).find(job => job.status === status), id + ' ' + status);
  }
  const success = await task('SUCCESS');
  await waitJob(success, 'running');
  await page.locator('#taskGitHubBtn').click();
  await page.locator('#taskBashToggleBtn').click();
  await page.locator('.bash-quick-open').first().click();
  await page.locator('#bashStatusPanel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#taskGitPanel').isVisible(), false);
  await page.locator('.bash-job-output-wrap').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.bash-job-output')?.textContent.includes('OUTPUT_LINE_99'));
  const layout = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    const close = getComputedStyle(document.querySelector('#bashStatusClose'));
    return { close: rect('#bashStatusClose'), radius: close.borderRadius, border: close.borderTopWidth,
      command: rect('.bash-job-command'), toggle: rect('.bash-job-output-toggle'), cwd: rect('.bash-job-cwd'),
      statusCount: document.querySelectorAll('.bash-job-status').length,
      icon: document.querySelector('.bash-job-output-toggle path').getAttribute('d') };
  });
  assert.ok(layout.close.width >= 32 && layout.close.width === layout.close.height);
  assert.equal(layout.radius, '50%'); assert.ok(parseFloat(layout.border) > 0);
  assert.equal(layout.statusCount, 0);
  assert.ok(layout.toggle.left - layout.command.right < 14, 'toggle directly follows command');
  assert.ok(Math.abs(layout.cwd.y + layout.cwd.height / 2 - layout.command.y - layout.command.height / 2) < 2, 'workspace stays on the command row');
  assert.equal(layout.icon, 'M9 6L15 12L9 18');
  const beforeScroll = await page.evaluate(() => {
    const output = document.querySelector('.bash-job-output');
    window.__bashOutputNode = output; output.scrollTop = 180;
    return { top: output.scrollTop, text: output.textContent };
  });
  assert.ok(beforeScroll.top > 0, 'fixture must have enough output to scroll');
  await page.waitForFunction(before => document.querySelector('.bash-job-output').textContent !== before, beforeScroll.text);
  const afterScroll = await page.evaluate(() => ({ same: window.__bashOutputNode === document.querySelector('.bash-job-output'), top: document.querySelector('.bash-job-output').scrollTop }));
  assert.equal(afterScroll.same, true, 'stream updates must keep the output node');
  assert.equal(afterScroll.top, beforeScroll.top, 'stream updates must preserve scroll');
  const clipboardBefore = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await page.evaluate(() => {
      window.__bashCopyExpected = document.querySelector('.bash-job-output').textContent;
      document.querySelector('.bash-job-copy').click();
    });
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent?.includes('已复制'));
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.equal(copied.replace(/\r\n/g, '\n'), (await page.evaluate(() => window.__bashCopyExpected)).replace(/\r\n/g, '\n'));
  } finally { await app.evaluate(({ clipboard }, previous) => clipboard.writeText(previous), clipboardBefore); }
  await page.locator('[data-bash-action="output"]').first().click();
  assert.equal(await page.locator('.bash-job-output-wrap').isVisible(), false);
  await page.locator('[data-bash-action="output"]').first().click();
  assert.equal(await page.locator('.bash-job-output').evaluate(node => node.scrollTop), beforeScroll.top);
  const bounds = await page.evaluate(() => ({ panel: document.querySelector('#bashStatusPanel').getBoundingClientRect().toJSON(), composer: document.querySelector('#composer').getBoundingClientRect().toJSON() }));
  assert.ok(bounds.panel.bottom <= bounds.composer.top + 2, 'panel must sit above composer');
  fs.mkdirSync(path.join(root, 'output', 'playwright'), { recursive: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.screenshot({ path: path.join(root, 'output/playwright/background-bash-light.png') });
  await page.waitForFunction(id => !state.activeRuns.has(id) && state.currentSession.messages.some(message => message.content?.includes('BG_RESUMED_SUCCESS')), success, { timeout: 90000 });
  assert.equal(await page.locator('#sendBtn').getAttribute('title'), '发送', 'completed Bash continuation must restore send mode');
  assert.equal(await page.locator('#app').evaluate(el => el.classList.contains('agent-working')), false);
  await page.evaluate(() => { setComposerText('继续检查'); syncComposerAfterInput(); });
  assert.equal(await page.locator('#sendBtn').isEnabled(), true);
  assert.equal(await page.locator('#sendBtn').getAttribute('title'), '发送');
  await page.evaluate(() => { setComposerText(''); syncComposerAfterInput(); });
  assert.equal((await jobs(success))[0].wakeStatus, 'delivered');
  assert.equal(commandCalls.filter(kind => kind === 'SUCCESS').length, 1);
  const failure = await task('FAILURE'); await waitJob(failure, 'running');
  await page.evaluate(id => loadSession(id), success);
  await until(async () => page.evaluate(async id => {
    const saved = await api.getSession(id);
    return !state.activeRuns.has(id) && saved.messages.some(message => message.content?.includes('BG_RESUMED_FAILURE'));
  }, failure), 'offscreen failure continuation saved');
  assert.equal(await page.evaluate(() => state.currentSession.id), success, 'wake must not switch the visible chat');
  await page.evaluate(id => loadSession(id), failure);
  assert.equal((await jobs(failure))[0].exit, 7);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({ path: path.join(root, 'output/playwright/background-bash-dark.png') });
  const cancelled = await task('CANCEL'); await waitJob(cancelled, 'running');
  await until(async () => (await jobs(cancelled))[0]?.background === true, 'command in background before cancellation');
  await page.locator('#taskGitHubBtn').click();
  await page.locator('#taskBashToggleBtn').click();
  await page.locator('.bash-quick-stop').first().click();
  await waitJob(cancelled, 'cancelled'); await page.evaluate(() => window.__bashSubmit);
  assert.equal((await jobs(cancelled))[0].wakeStatus, 'suppressed');
  await page.locator('#bashStatusPanel').screenshot({ path: path.join(root, 'output/playwright/background-bash-compact.png') });
  const agentCancelled = await task('CANCEL_AGENT'); await waitJob(agentCancelled, 'running');
  await until(() => requests.some(item => item.kind === 'CANCEL_AGENT' && item.tools.length), 'Agent continuing after background');
  await page.evaluate(() => abortTask());
  await waitJob(agentCancelled, 'cancelled');
  await page.waitForFunction(id => !state.activeRuns.has(id), agentCancelled, { timeout: 30000 });
  const cancelledJobs = await jobs(agentCancelled);
  assert.ok(cancelledJobs.length, JSON.stringify({ agentCancelled, all: await jobs(), commandCalls }));
  assert.equal(cancelledJobs[0].wakeStatus, 'suppressed');
  const deleted = await task('DELETE'); await waitJob(deleted, 'running');
  await page.evaluate(() => window.__bashSubmit);
  const deletion = await page.evaluate(id => api.deleteSession(id, true), deleted);
  assert.equal(deletion.ok, true, deletion.error);
  await waitJob(deleted, 'cancelled');
  assert.equal((await jobs(deleted))[0].wakeStatus, 'suppressed');
  const manual = await task('MANUAL'); await waitJob(manual, 'running');
  await page.locator('[data-bash-action="background"]').first().click();
  await until(async () => (await jobs(manual))[0]?.background === true, 'manual background');
  await page.waitForFunction(id => !state.activeRuns.has(id) && state.currentSession.messages.some(message => message.content?.includes('BG_RESUMED_SUCCESS')), manual, { timeout: 90000 });
  await page.evaluate(async id => { await loadSession(id); await window.YanBackgroundBash.refresh(); }, success);
  assert.equal(await page.locator('.bash-job').count(), 1);
  assert.equal(await page.locator('.bash-job').getAttribute('data-status'), 'succeeded');
  assert.equal(await page.locator('.bash-job-status').count(), 0);
  const shutdown = await task('SHUTDOWN'); const shutdownJob = await waitJob(shutdown, 'running');
  const pid = await until(async () => {
    const detail = await page.evaluate(({ id, sessionId }) => api.bashControl({ id, sessionId, action: 'output' }), { id: shutdownJob.id, sessionId: shutdown });
    return Number(detail.output.match(/SHELL_PID=(\d+)/)?.[1]);
  }, 'shutdown child PID');
  await app.close(); app = null;
  await until(() => { try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } }, 'shutdown child exit', 10000);
  assert.equal(requests.filter(item => item.completion).length, 3, 'only success, failure and manual background jobs wake');
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ ok: true, commandCalls, wakeCount: requests.filter(item => item.completion).length }));
})().catch(error => { console.error(error); console.error(JSON.stringify({ failures, requests }, null, 2)); process.exitCode = 1; }).finally(async () => {
  await app?.close().catch(() => {}); server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
});
