'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require('playwright');
const { atomic } = require('../lib/external-agents/storage');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-external-pill-'));
const workspace = path.join(userData, '工作区 A'); fs.mkdirSync(workspace);
const output = path.join(root, 'output/playwright/external-agent-status');
fs.mkdirSync(output, { recursive: true });
const records = {};
function job(provider, state) {
  const id = crypto.randomUUID();
  const dir = path.join(userData, 'YanData/external-agents/jobs', id);
  fs.mkdirSync(dir, { recursive: true });
  atomic(path.join(dir, 'request.json'), { id, provider, title: `${provider} 协同测试`, workspace,
    sessionId: 'another-conversation', dependsOn: [], createdAt: Date.now() });
  records[provider] = dir; update(provider, state);
}
function update(provider, state) {
  atomic(path.join(records[provider], 'state.json'), { workerPid: process.pid,
    startedAt: Date.now(), heartbeatAt: Date.now(), ...state });
}
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && state.currentSession);
    await page.evaluate(async workspace => {
      const session = await api.createSession(true, workspace);
      session.messages = [{ role: 'user', content: '请检查这个工作区的任务', timestamp: Date.now() }];
      await api.saveSession(session);
      await refreshSessions(); await loadSession(session.id);
    }, workspace);
    assert.equal(await page.locator('#externalAgentActivity').isVisible(), false);
    job('codex', { status: 'uncertain', needsAttention: true, error: '桌面应用请求信任工作区，请用户亲自在应用中确认' });
    job('claude', { status: 'running', deliveryVerified: true });
    // The desktop Agent UI now lives inside the capsule panel's 智能体 section.
    await page.locator('#taskGitHubBtn').click();
    await page.locator('#taskGitPanel:not(.hidden)').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.external-agent-activity-pill').length === 2);
    const codex = page.locator('.external-agent-activity-pill[data-provider="codex"]');
    const claude = page.locator('.external-agent-activity-pill[data-provider="claude"]');
    assert.equal(await codex.innerText(), '正在等待你信任工作区');
    assert.equal(await claude.innerText(), '正在处理Yan Agent的派发任务');
    assert.ok(await page.locator('.external-agent-activity-pill img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('#taskGitPanel').getBoundingClientRect();
      const pills = [...document.querySelectorAll('.external-agent-activity-pill')].map(pill => {
        const rect = pill.getBoundingClientRect();
        return { width: rect.width, left: rect.left, right: rect.right };
      });
      return { panel: { left: panel.left, right: panel.right }, pills };
    });
    assert.ok(layout.pills.every(pill => pill.width > 40 && pill.left >= layout.panel.left - 1 && pill.right <= layout.panel.right + 1), 'provider pills fit inside the capsule panel');
    await codex.click();
    assert.ok((await page.locator('.external-agent-activity-detail').innerText()).includes(workspace));
    await codex.click();
    assert.equal(await page.locator('.external-agent-activity-detail').isVisible(), false);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.locator('#taskBar').screenshot({ path: path.join(output, `${theme}.png`) });
    }
    await page.setViewportSize({ width: 1000, height: 760 });
    await page.locator('#taskBar').screenshot({ path: path.join(output, 'narrow.png') });
    const fits = await page.evaluate(() => {
      const panel = document.querySelector('#taskGitPanel').getBoundingClientRect();
      return panel.left >= 0 && panel.right <= innerWidth;
    });
    assert.ok(fits, 'Capsule panel fits in a narrow window');
    update('codex', { status: 'running', deliveryVerified: true });
    await page.waitForFunction(() => document.querySelector('[data-provider="codex"].external-agent-activity-pill')?.dataset.state === 'running');
    assert.equal(await codex.innerText(), '正在处理Yan Agent的派发任务');
    update('claude', { status: 'succeeded', endedAt: Date.now() });
    await page.waitForFunction(() => document.querySelectorAll('.external-agent-activity-pill').length === 1);
    assert.equal(await codex.isVisible(), true);
    update('codex', { status: 'failed', endedAt: Date.now() });
    await page.waitForFunction(() => document.querySelector('#externalAgentActivity')?.hidden === true);
    update('claude', { status: 'uncertain', needsAttention: true, error: '桌面输入框已有草稿，请先保存' });
    await page.waitForFunction(() => document.querySelector('.external-agent-activity-pill')?.dataset.state === 'attention');
    assert.equal(await claude.innerText(), '需要你处理桌面提示');
    update('claude', { status: 'cancelled', endedAt: Date.now() });
    await page.waitForFunction(() => document.querySelectorAll('.external-agent-activity-pill').length === 0);
    await page.evaluate(() => api.setConfig({ externalAgents: { enabled: true, providers: { codex: { enabled: true }, claude: { enabled: true } } } }));
    update('claude', { status: 'uncertain', needsAttention: true, error: '等待处理桌面提示' });
    update('codex', { status: 'queued', progress: '等待原任务释放派发队列' });
    await page.waitForFunction(() => document.querySelector('[data-provider="codex"].external-agent-activity-pill')?.dataset.state === 'queued');
    assert.equal(await codex.innerText(), '等待派发队列');
    await codex.click();
    assert.match(await page.locator('.external-agent-activity-detail').innerText(), /释放派发队列/);
    assert.deepEqual(errors, []);
    console.log('PASS actual IPC/durable state polling: trust → running → finished, independent provider pills, real logo assets, details, themes, cancellation and non-trust attention.');
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
