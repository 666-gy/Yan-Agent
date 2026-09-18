'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plan-ui-e2e-'));
const plansDir = path.join(userDataDir, 'YanData', 'plans');
const planPath = path.join(plansDir, '实现登录页计划.md');
fs.mkdirSync(plansDir, { recursive: true });
fs.writeFileSync(planPath, [
  '<yan-delivery-contract>',
  'intent: presentable',
  'scope: leak',
  '</yan-delivery-contract>',
  '<thinking>内部思考不应出现</thinking>',
  '# 实现登录页计划',
  '',
  '第一步：搭建页面结构。',
  '',
  '第二步：接入登录接口。'
].join('\n'), 'utf8');

(async () => {
  let application;
  const errors = [];
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => (
      typeof createRunCtx === 'function'
      && typeof appendMessage === 'function'
      && typeof renderAgentRunBody === 'function'
      && typeof openCodeResultToAgentRun === 'function'
    ));

    const result = await page.evaluate(async ({ planPath: targetPath }) => {
      if (!state.currentSession) await newSession();
      const session = state.currentSession;
      const runCtx = createRunCtx(session.id, true, session.workspace || '');
      runCtx.workMode = 'plan';
      runCtx.activeAgentRun = { runId: runCtx.runId, status: 'working', timeline: [] };
      const el = appendMessage('assistant', '');
      const body = el.querySelector('.msg-body');
      const agentRun = openCodeResultToAgentRun({
        status: 'done',
        text: '计划已生成。',
        toolCalls: [],
        todos: [],
        reviewSummary: {
          count: 1,
          additions: 3,
          deletions: 1,
          files: [{ path: 'src/login.js', additions: 3, deletions: 1 }]
        },
        planFile: { name: '实现登录页计划.md', path: targetPath, createdAt: Date.now() }
      }, runCtx);
      const restored = JSON.parse(JSON.stringify(agentRun));
      renderAgentRunBody(body, restored, agentRun.textContent);
      const planCard = body.querySelector('.run-plan-summary');
      const changeCard = body.querySelector('.run-change-summary');
      return {
        hasPlanCard: !!planCard,
        hasChangeCard: !!changeCard,
        order: [...body.querySelectorAll('.run-plan-summary, .run-change-summary')].map(node => node.className.split(' ')[0]),
        cardTitle: planCard?.querySelector('.run-plan-title')?.textContent || '',
        button: planCard?.querySelector('[data-run-plan-view]')?.textContent || ''
      };
    }, { planPath });

    assert.equal(result.hasPlanCard, true, JSON.stringify(result));
    assert.equal(result.hasChangeCard, true, JSON.stringify(result));
    assert.deepEqual(result.order, ['run-plan-summary', 'run-change-summary'], JSON.stringify(result));
    assert.equal(result.cardTitle, '已写入计划文件', JSON.stringify(result));
    assert.equal(result.button, '查看', JSON.stringify(result));

    const initialDownloadDisabled = await page.evaluate(() => (
      document.querySelector('#rs-plan [data-plan-download]')?.disabled ?? null
    ));
    assert.equal(initialDownloadDisabled, true, 'download stays disabled without a plan file');

    await page.locator('.run-plan-summary [data-run-plan-view]').click();
    await page.waitForFunction(() => (
      document.querySelector('#rs-plan[data-state="ready"] .rs-plan-content')?.textContent?.includes('第一步')
    ), null, { timeout: 10_000 });
    const panel = await page.evaluate(() => ({
      sidebarPanelActive: document.querySelector('#rs-plan')?.classList.contains('active') ?? null,
      tabLabel: document.querySelector('[data-rs-tab="plan"] .rs-work-tab-label')?.textContent || '',
      hasTabIcon: !!document.querySelector('[data-rs-tab-unit="plan"] .rs-work-tab-icon svg'),
      fileName: document.querySelector('#rs-plan [data-plan-file-name]')?.textContent || '',
      content: document.querySelector('#rs-plan [data-plan-file-content]')?.textContent || '',
      download: (() => {
        const button = document.querySelector('#rs-plan [data-plan-download]');
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        const header = document.querySelector('#rs-plan .rs-plan-header')?.getBoundingClientRect();
        return {
          disabled: button.disabled,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          borderRadius: getComputedStyle(button).borderRadius,
          rightGap: header ? Math.round(header.right - rect.right) : -1,
          apiReady: typeof api?.downloadPlanFile === 'function'
        };
      })()
    }));
    assert.equal(panel.sidebarPanelActive, true, JSON.stringify(panel));
    assert.equal(panel.tabLabel, '计划文档', JSON.stringify(panel));
    assert.equal(panel.hasTabIcon, true, JSON.stringify(panel));
    assert.equal(panel.fileName, '实现登录页计划.md', JSON.stringify(panel));
    assert.match(panel.content, /第一步：搭建页面结构。/u, JSON.stringify(panel));
    assert.match(panel.content, /第二步：接入登录接口。/u, JSON.stringify(panel));
    assert.doesNotMatch(panel.content, /yan-delivery-contract|intent:|内部思考不应出现/u, JSON.stringify(panel));
    assert.ok(panel.download, 'download button exists');
    assert.equal(panel.download.disabled, false, JSON.stringify(panel));
    assert.equal(panel.download.width, panel.download.height, JSON.stringify(panel));
    assert.equal(panel.download.borderRadius, '50%', JSON.stringify(panel));
    assert.ok(panel.download.rightGap >= 0 && panel.download.rightGap <= 24, JSON.stringify(panel));
    assert.equal(panel.download.apiReady, true, JSON.stringify(panel));
    assert.equal(errors.length, 0, errors.join('; '));
    const screenshotDir = path.join(appRoot, 'output', 'playwright');
    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.locator('.run-plan-summary').screenshot({
      path: path.join(screenshotDir, 'run-plan-summary.png'),
      animations: 'disabled'
    });
    await page.screenshot({ path: path.join(screenshotDir, 'plan-document-panel.png') });
    console.log(JSON.stringify({ ok: true, ...result, panel }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
