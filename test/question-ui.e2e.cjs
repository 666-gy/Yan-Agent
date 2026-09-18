'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-question-ui-e2e-'));
const screenshotDir = path.join(appRoot, 'output', 'playwright');
const screenshotPath = path.join(screenshotDir, 'agent-question-panel-paged.png');
fs.mkdirSync(screenshotDir, { recursive: true });

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: {
        ...process.env,
        YAN_E2E_MODE: '1',
        YAN_E2E_USER_DATA_DIR: userDataDir
      }
    });
    const page = await application.firstWindow();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForFunction(() => (
      typeof requestAgentQuestion === 'function'
      && typeof settleAgentQuestion === 'function'
      && typeof createRunCtx === 'function'
      && document.querySelector('#agentPermissionPanel')
    ));
    await page.setViewportSize({ width: 1536, height: 460 });
    await page.evaluate(() => applyTheme('light'));

    const runContext = await page.evaluate(() => {
      const sessionId = state.currentSession?.id || 'e2e-question-session';
      const runCtx = createRunCtx(sessionId, true, '');
      runCtx.openCodeHandledRequests = new Set();
      runCtx.activeAgentRun = { runId: runCtx.runId, status: 'working', timeline: [] };
      window.__questionRunCtx = runCtx;
      return { sessionId, runId: runCtx.runId };
    });

    await page.evaluate(() => {
      window.__questionResponse = requestAgentQuestion({
        requestId: 'question-ui-submit',
        sessionId: window.__questionRunCtx.sessionId,
        questions: [
          {
            header: '工作区',
            question: '选择工作区类型',
            options: [
              { label: '现有工作区', description: '继续当前目录' },
              { label: '新工作区', description: '创建隔离目录' },
              { label: '临时工作区', description: '只保留本轮内容' },
              { label: '远程工作区', description: '连接远程目录' }
            ]
          },
          {
            header: '技术栈',
            question: '选择需要保留的技术栈',
            multiple: true,
            options: [
              { label: 'Node.js', description: 'JavaScript runtime' },
              { label: 'TypeScript', description: 'Typed JavaScript' }
            ]
          },
          {
            header: '部署',
            question: '选择部署方式',
            custom: true,
            options: [
              { label: '本地', description: '仅在当前设备运行' },
              { label: '云端', description: '部署到远程环境' }
            ]
          },
          {
            header: '补充',
            question: '还有什么要求？',
            custom: true,
            options: []
          }
        ]
      }, window.__questionRunCtx);
    });
    await page.locator('#agentPermissionPanel:not(.hidden)').waitFor();
    assert.equal(await page.locator('#agentPermissionTitle').textContent(), '选择工作区类型');
    assert.equal(await page.locator('#agentPermissionPanel').getAttribute('data-mode'), 'question');
    assert.equal(await page.locator('#agentPermissionAlways').evaluate(button => button.classList.contains('hidden')), true);
    assert.equal(await page.locator('#agentPermissionOnce').textContent(), '下一题');
    assert.equal(await page.locator('.agent-question-count').textContent(), '1/4');
    assert.equal(await page.locator('#agentQuestionHeaderPrev').getAttribute('aria-disabled'), 'true');
    assert.equal(await page.locator('.agent-question-custom').getAttribute('placeholder'), '否，并告诉 Yan Agent 应该如何做不同');
    assert.equal(await page.locator('.agent-question-item').count(), 1);
    assert.equal(await page.locator('.agent-question-item input[type="radio"]').count(), 4);
    const optionViewport = await page.locator('#agentQuestionFields').evaluate(fields => {
      const rows = Array.from(fields.querySelectorAll('.agent-question-option'));
      const viewport = fields.getBoundingClientRect();
      return {
        viewport: { top: viewport.top, bottom: viewport.bottom, height: viewport.height },
        scrollHeight: fields.scrollHeight,
        clientHeight: fields.clientHeight,
        rows: rows.map(row => {
          const rect = row.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, height: rect.height };
        })
      };
    });
    assert.equal(optionViewport.rows.every(row => row.bottom <= optionViewport.viewport.bottom + 1), true, JSON.stringify(optionViewport));
    assert.equal(optionViewport.scrollHeight <= optionViewport.clientHeight + 1, true, JSON.stringify(optionViewport));
    assert.equal(await page.locator('#composerStage').evaluate(node => getComputedStyle(node).visibility), 'hidden');
    await page.locator('#agentQuestionCustomToggle').click();
    await page.screenshot({ path: screenshotPath });

    await page.locator('.agent-question-option').nth(1).click();
    await page.waitForFunction(() => document.querySelector('.agent-question-count')?.textContent === '2/4');
    assert.equal(await page.locator('.agent-question-item input[type="checkbox"]').count(), 2);
    await page.locator('.agent-question-option').nth(0).click();
    await page.waitForFunction(() => document.querySelector('.agent-question-count')?.textContent === '3/4');
    await page.locator('#agentQuestionCustomToggle').click();
    await page.locator('.agent-question-custom').fill('混合部署');
    await page.locator('.agent-question-custom').press('Enter');
    assert.equal(await page.locator('.agent-question-count').textContent(), '4/4');
    await page.locator('.agent-question-custom').fill('保留现有 API 兼容性');
    const geometry = await page.locator('#agentPermissionPanel').evaluate(panel => {
      const panelRect = panel.getBoundingClientRect();
      const actionsRect = panel.querySelector('.agent-permission-actions').getBoundingClientRect();
      const composerRect = document.querySelector('#composer').getBoundingClientRect();
      const hostRect = document.querySelector('#chatMainColumn').getBoundingClientRect();
      const toggleRect = panel.querySelector('#agentQuestionCustomToggle').getBoundingClientRect();
      const customField = panel.querySelector('#agentQuestionCustomField');
      const customRect = customField.getBoundingClientRect();
      const skipRect = panel.querySelector('#agentPermissionDeny').getBoundingClientRect();
      const customStyle = getComputedStyle(customField);
      const inside = rect => (
        rect.left >= panelRect.left - 1
        && rect.right <= panelRect.right + 1
        && rect.top >= panelRect.top - 1
        && rect.bottom <= panelRect.bottom + 1
      );
      return {
        panelHeight: panelRect.height,
        panelWidth: panelRect.width,
        panelTop: panelRect.top,
        panelLeft: panelRect.left,
        composerHeight: composerRect.height,
        composerWidth: composerRect.width,
        composerTop: composerRect.top,
        composerLeft: composerRect.left,
        hostTop: hostRect.top,
        customFillsGap: customRect.left > toggleRect.right && customRect.right < skipRect.left,
        customIsPill: parseFloat(customStyle.borderTopLeftRadius) >= (customRect.height / 2) - 1,
        toggleHeight: toggleRect.height,
        customHeight: customRect.height,
        skipHeight: skipRect.height,
        footerChildrenInside: [toggleRect, customRect, skipRect].every(inside),
        footerBottomClearance: Math.min(...[toggleRect, customRect, skipRect].map(rect => panelRect.bottom - rect.bottom)),
        actionsInsidePanel: actionsRect.bottom <= panelRect.bottom + 1,
        panelInsideViewport: panelRect.top >= 0 && panelRect.bottom <= window.innerHeight + 1,
        optionsUseFlex: getComputedStyle(panel.querySelector('.agent-question-options') || panel.querySelector('.agent-question-item')).display === 'flex'
      };
    });
    assert.ok(geometry.panelHeight >= geometry.composerHeight, JSON.stringify(geometry));
    const availableAboveComposer = (geometry.composerTop + geometry.composerHeight) - geometry.hostTop - 12;
    assert.ok(geometry.panelHeight <= availableAboveComposer + 1, JSON.stringify(geometry));
    assert.ok(geometry.panelTop >= geometry.hostTop + 11, JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.panelWidth - geometry.composerWidth) <= 2, JSON.stringify(geometry));
    assert.ok(Math.abs((geometry.panelTop + geometry.panelHeight) - (geometry.composerTop + geometry.composerHeight)) <= 2, JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.panelLeft - geometry.composerLeft) <= 2, JSON.stringify(geometry));
    assert.equal(geometry.customFillsGap, true, JSON.stringify(geometry));
    assert.equal(geometry.customIsPill, true, JSON.stringify(geometry));
    assert.equal(geometry.toggleHeight, 28, JSON.stringify(geometry));
    assert.equal(geometry.customHeight, 28, JSON.stringify(geometry));
    assert.equal(geometry.skipHeight, 28, JSON.stringify(geometry));
    assert.equal(geometry.footerChildrenInside, true, JSON.stringify(geometry));
    assert.ok(geometry.footerBottomClearance >= 4, JSON.stringify(geometry));
    assert.equal(geometry.actionsInsidePanel, true, JSON.stringify(geometry));
    assert.equal(geometry.panelInsideViewport, true, JSON.stringify(geometry));
    assert.equal(geometry.optionsUseFlex, true, JSON.stringify(geometry));
    for (let index = 0; index < 3; index += 1) {
      await page.locator('#agentQuestionHeaderPrev').click();
    }
    assert.equal(await page.locator('.agent-question-count').textContent(), '1/4');
    await page.locator('#agentQuestionCustomToggle').click();
    for (const viewport of [
      { width: 768, height: 900 },
      { width: 414, height: 896 },
      { width: 375, height: 812 },
      { width: 320, height: 640 }
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => positionAgentPermissionPanel());
      const responsive = await page.locator('#agentPermissionPanel').evaluate((panel, expectedViewport) => {
        const panelRect = panel.getBoundingClientRect();
        const composerRect = document.querySelector('#composer').getBoundingClientRect();
        const buttons = Array.from(panel.querySelectorAll('.agent-permission-actions button'));
        const optionViewport = panel.querySelector('#agentQuestionFields').getBoundingClientRect();
        const optionRows = Array.from(panel.querySelectorAll('.agent-question-option'))
          .map(option => option.getBoundingClientRect());
        const footerControls = [
          panel.querySelector('#agentQuestionCustomToggle'),
          panel.querySelector('#agentQuestionCustomField'),
          panel.querySelector('#agentPermissionDeny')
        ].filter(Boolean).map(control => control.getBoundingClientRect());
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          panelLeft: panelRect.left,
          panelRight: panelRect.right,
          panelTop: panelRect.top,
          panelBottom: panelRect.bottom,
          hasHorizontalOverflow: panel.scrollWidth > panel.clientWidth,
          footerControlsInside: footerControls.every(rect => (
            rect.left >= panelRect.left - 1
            && rect.right <= panelRect.right + 1
            && rect.top >= panelRect.top - 1
            && rect.bottom <= panelRect.bottom - 3
          )),
          allOptionsVisible: optionRows.length === 4 && optionRows.every(rect => (
            rect.top >= optionViewport.top - 1
            && rect.bottom <= optionViewport.bottom + 1
          )),
          buttonsSingleLine: buttons.every(button => (
            getComputedStyle(button).whiteSpace === 'nowrap'
            && button.scrollWidth <= button.clientWidth
          )),
          expectedViewport
        };
      }, viewport);
      assert.ok(responsive.panelLeft >= -1, JSON.stringify(responsive));
      assert.ok(responsive.panelRight <= responsive.viewport.width + 1, JSON.stringify(responsive));
      assert.ok(responsive.panelTop >= -1, JSON.stringify(responsive));
      assert.ok(responsive.panelBottom <= responsive.viewport.height + 1, JSON.stringify(responsive));
      assert.equal(responsive.hasHorizontalOverflow, false, JSON.stringify(responsive));
      assert.equal(responsive.footerControlsInside, true, JSON.stringify(responsive));
      assert.equal(responsive.allOptionsVisible, true, JSON.stringify(responsive));
      assert.equal(responsive.buttonsSingleLine, true, JSON.stringify(responsive));
      if (viewport.width === 320) {
        await page.screenshot({ path: path.join(screenshotDir, 'agent-question-panel-320.png') });
      }
    }
    await page.setViewportSize({ width: 1920, height: 1200 });
    await page.evaluate(() => positionAgentPermissionPanel());
    for (let index = 0; index < 3; index += 1) {
      await page.locator('#agentQuestionHeaderNext').click();
    }
    assert.equal(await page.locator('.agent-question-count').textContent(), '4/4');
    await page.locator('.agent-question-custom').press('Enter');
    const submitted = await page.evaluate(async () => window.__questionResponse);
    assert.deepEqual(submitted, {
      answers: [['新工作区'], ['Node.js'], ['混合部署'], ['保留现有 API 兼容性']],
      reject: false,
      cancelled: false
    });
    assert.equal(await page.locator('#agentPermissionPanel').evaluate(panel => panel.classList.contains('hidden')), true);
    assert.equal(await page.locator('#chatMainColumn').evaluate(node => node.classList.contains('permission-pending')), false);
    assert.equal(await page.locator('#chatMainColumn').evaluate(node => node.classList.contains('question-pending')), false);

    await page.evaluate(() => {
      window.__questionResponse = requestAgentQuestion({
        requestId: 'question-ui-reject',
        sessionId: window.__questionRunCtx.sessionId,
        questions: [{ question: '是否继续？', options: [{ label: '继续', description: '' }] }]
      }, window.__questionRunCtx);
    });
    await page.locator('#agentPermissionPanel:not(.hidden)').waitFor();
    await page.locator('#agentPermissionDeny').click();
    const rejected = await page.evaluate(async () => window.__questionResponse);
    assert.deepEqual(rejected, { answers: [['继续']], reject: false, cancelled: false });

    await page.evaluate(() => {
      window.__questionResponse = requestAgentQuestion({
        requestId: 'question-ui-external',
        sessionId: window.__questionRunCtx.sessionId,
        questions: [{ question: '外部已回答的问题', options: [{ label: '是', description: '' }] }]
      }, window.__questionRunCtx);
      applyOpenCodeEvent(window.__questionRunCtx, {
        type: 'question.v2.replied',
        data: { requestID: 'question-ui-external', answers: [['是']] }
      });
    });
    const externallySettled = await page.evaluate(async () => window.__questionResponse);
    assert.deepEqual(externallySettled, { answers: [], reject: false, cancelled: true });

    await page.evaluate(() => {
      window.__permissionResponse = requestAgentPermission({
        requestId: 'permission-after-question',
        title: '高危命令等待确认',
        description: 'Agent 即将执行下列高危命令，是否允许：',
        detail: 'npm publish',
        sessionId: window.__questionRunCtx.sessionId
      }, window.__questionRunCtx);
    });
    await page.locator('#agentPermissionPanel:not(.hidden)').waitFor();
    assert.equal(await page.locator('#agentPermissionPanel').getAttribute('data-mode'), 'permission');
    assert.equal(await page.locator('#agentPermissionAlways').evaluate(button => button.classList.contains('hidden')), false);
    assert.equal(await page.locator('#agentPermissionOnce').textContent(), '本次允许');
    assert.equal(await page.locator('#agentPermissionDetail').textContent(), 'npm publish');
    await page.locator('#agentPermissionOnce').click();
    const permission = await page.evaluate(async () => window.__permissionResponse);
    assert.deepEqual(permission, { decision: 'once', useVisionRelay: false });
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ ok: true, runContext, geometry, screenshotPath }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
