'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-review-output-e2e-'));

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
    await page.waitForFunction(() => (
      typeof appendMessage === 'function'
      && typeof createRightSidebarTab === 'function'
      && typeof setBrowserAgentControl === 'function'
    ));
    // The renderer exposes its functions before async init finishes.  Wait for
    // the settled chat shell so a concurrent initial session load cannot close
    // the review sidebar immediately after the fixture opens it.
    await page.locator('#taskBar:not(.hidden)').waitFor();

    const initial = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      clearMessages();
      state.currentSession.workspace = 'C:\\yan-review-test';
      state.currentSession.messages = [];
      const agentRun = {
        runId: 'single-line-review-run',
        changeCount: 5,
        status: 'done',
        summaryStarted: true,
        durationMs: 1000,
        timeline: [
          { type: 'progress', stage: 'work', content: '正在修改文件。' },
          { type: 'text', stage: 'summary', content: '已修复一行代码。' }
        ],
        changeSummary: {
          source: 'opencode',
          count: 5,
          additions: 15,
          deletions: 5,
          files: Array.from({ length: 5 }, (_, index) => ({
            path: index === 0 ? 'src/app.js' : `src/file-${index + 1}.js`,
            status: 'modified',
            additions: index + 1,
            deletions: 1,
            diff: index === 0 ? {
              rows: [
                { type: 'del', oldLine: 7, newLine: null, text: 'const ready = false;' },
                { type: 'add', oldLine: null, newLine: 7, text: 'const ready = true;' }
              ]
            } : { rows: [{ type: 'add', text: `export const file${index + 1} = true;` }] }
          }))
        }
      };
      const responseTs = new Date(2026, 0, 1, 3, 29).getTime();
      state.currentSession.messages.push({
        role: 'assistant',
        content: '已修复一行代码。',
        ts: responseTs,
        agentRun
      });
      appendMessage('assistant', '已修复一行代码。', [], false, 0, responseTs, 1000, agentRun);
      const message = document.querySelector('#messages .msg.assistant');
      const workItem = message?.querySelector('[data-agent-stage="work"]');
      const footerToggle = message?.querySelector('.msg-actions .agent-work-toggle');
      const workProcess = {
        topToggleCount: message?.querySelectorAll('.agent-run-summary .agent-work-toggle').length || 0,
        footerToggleCount: message?.querySelectorAll('.msg-actions .agent-work-toggle').length || 0,
        durationCount: message?.querySelectorAll('.msg-actions .msg-duration').length || 0,
        mountedBefore: !!workItem,
        hiddenBefore: !workItem || getComputedStyle(workItem).display === 'none',
        labelBefore: footerToggle?.textContent || ''
      };
      footerToggle?.click();
      const expandedWorkItem = message?.querySelector('[data-agent-stage="work"]');
      workProcess.mountedAfter = !!expandedWorkItem;
      workProcess.hiddenAfter = !expandedWorkItem || getComputedStyle(expandedWorkItem).display === 'none';
      workProcess.labelAfter = footerToggle?.textContent || '';
      footerToggle?.click();
      workProcess.mountedAfterCollapse = !!message?.querySelector('[data-agent-stage="work"]');
      workProcess.labelAfterCollapse = footerToggle?.textContent || '';
      const responseTime = message?.querySelector('.msg-actions .msg-response-time');
      const copyButton = message?.querySelector('.msg-actions [data-act="copy"]');
      appendMessage('user', '用户消息', [], false, -1, responseTs);
      const userMessage = document.querySelector('#messages .msg.user');
      const changePanel = message?.querySelector('.run-change-summary');
      const changeFiles = [...(changePanel?.querySelectorAll('[data-run-change-file-index]') || [])];
      const moreButton = changePanel?.querySelector('[data-run-change-more]');
      const reviewPanel = {
        title: changePanel?.querySelector('.run-change-title')?.textContent || '',
        stats: changePanel?.querySelector('.run-change-stats')?.textContent.replace(/\s+/g, ' ').trim() || '',
        initialVisibleCount: changeFiles.filter(item => !item.hidden).length,
        initialHiddenCount: changeFiles.filter(item => item.hidden).length,
        moreBefore: moreButton?.textContent.replace(/\s+/g, ' ').trim() || '',
        panelUndoCount: changePanel?.querySelectorAll('[data-run-change-rollback]').length || 0,
        footerUndoCount: message?.querySelectorAll('.msg-actions [data-act="rollback"]').length || 0,
        logoPath: changePanel?.querySelector('.run-change-icon path')?.getAttribute('d') || ''
      };
      moreButton?.click();
      reviewPanel.expandedVisibleCount = changeFiles.filter(item => !item.hidden).length;
      reviewPanel.moreAfter = moreButton?.textContent.replace(/\s+/g, ' ').trim() || '';
      const button = document.querySelector('[data-run-change-file-index="0"]');
      button?.click();
      return {
        buttonCount: document.querySelectorAll('[data-run-change-file-index]').length,
        buttonTag: button?.tagName || '',
        sidebarOpen: !document.querySelector('#app').classList.contains('rs-hidden'),
        responseTime: responseTime?.textContent || '',
        responseTimeDateTime: responseTime?.getAttribute('datetime') || '',
        responseTimeImmediatelyAfterCopy: copyButton?.nextElementSibling === responseTime,
        userDeleteCount: userMessage?.querySelectorAll('[data-act="delete"]').length || 0,
        userEditCount: userMessage?.querySelectorAll('[data-act="edit"]').length || 0,
        workProcess,
        reviewPanel
      };
    });

    await page.waitForFunction(() => document.querySelector('#rs-review')?.classList.contains('active'));
    await page.locator('#yanDshReviewFrame').waitFor();
    const reviewFrame = page.frameLocator('#yanDshReviewFrame');
    await reviewFrame.locator('.sidenav .navitem').first().waitFor();
    // The panel is lazy: the selected file loads its rows right after the
    // manifest document is up, so the diff body only appears on demand.
    await reviewFrame.locator('.dsh-cr-cell-new').first().waitFor({ timeout: 20_000 });
    await page.screenshot({ path: path.join(appRoot, 'output', 'playwright', 'review-embedded-sidebar.png'), fullPage: false });
    const review = await page.evaluate(() => ({
      selectedPath: rsReviewState.selectedPath,
      reviewRole: document.querySelector('#yanDshReviewPanel')?.getAttribute('role') || '',
      parentRefreshHidden: document.querySelector('#reviewRefreshBtn')?.classList.contains('hidden') || false
    }));
    review.navCount = await reviewFrame.locator('.sidenav .navitem').count();
    review.diffText = await reviewFrame.locator('.dsh-cr-cell-new').first().textContent();

    const backendFilter = await page.evaluate(async () => {
      const textFile = {
        path: 'src/app.js',
        status: 'modified',
        additions: 1,
        deletions: 1,
        diff: { rows: [{ type: 'add', text: 'const ready = true;' }] }
      };
      const persisted = await api.saveSession({
        id: `sess_binary-review-${Date.now()}`,
        title: 'Binary review filter fixture',
        workspace: 'C:\\yan-review-test',
        messages: [{
          role: 'assistant',
          content: '旧审阅记录',
          agentRun: {
            status: 'done',
            changeCount: 2,
            changeSummary: {
              source: 'opencode',
              count: 2,
              additions: 1,
              deletions: 1290,
              files: [{
                path: 'race1.png',
                status: 'deleted',
                additions: 0,
                deletions: 1289,
                diff: { rows: [{ type: 'del', text: '\u0000IHDR' }] }
              }, textFile]
            }
          }
        }]
      });
      const sanitized = await api.getSession(persisted.id);
      const summary = sanitized.messages[0].agentRun.changeSummary;
      return { count: summary.count, paths: summary.files.map(file => file.path) };
    });

    const browserWidths = await page.evaluate(() => {
      document.documentElement.style.setProperty('--rs-w', '360px');
      const tab = createRightSidebarTab('browser', { agentRunId: 'browser-width-run' });
      const controller = getBrowserTabController(tab.id);
      setBrowserAgentControl(controller, true, { runId: 'browser-width-run' });
      const expanded = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rs-w'));
      setBrowserAgentControl(controller, false, { runId: 'browser-width-run' });
      const released = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rs-w'));
      return { expanded, released };
    });

    const streamingMarkdown = await page.evaluate(() => {
      const element = buildWorkNarrationElement('');
      document.body.appendChild(element);
      const first = { type: 'text', content: '**Stable block**\n\nTail', streaming: true };
      updateAgentTimelinePartElement(element, first, null, 'running');
      const stableNode = element.firstElementChild;
      const stateAfterFirst = agentElementRenderState.get(element);
      updateAgentTimelinePartElement(element, {
        ...first,
        content: '**Stable block**\n\nTail keeps growing with [a link](https://example.com).'
      }, null, 'running');
      const stateAfterSecond = agentElementRenderState.get(element);
      const settledNodeReused = stableNode === element.firstElementChild;
      updateAgentTimelinePartElement(element, {
        ...first,
        content: '**Stable block**\n\nTail keeps growing with [a link](https://example.com).',
        streaming: false
      }, null, 'done');
      const result = {
        settledNodeReused,
        tailAppendedIncrementally: stateAfterSecond.tailTextNode?.data === stateAfterSecond.content,
        tailTextLength: stateAfterSecond.tailTextNode?.data.length || 0,
        firstPassWasStreaming: stateAfterFirst.streaming,
        cursorRemoved: !element.querySelector('.stream-cursor'),
        finalText: element.textContent.trim()
      };
      element.remove();
      return result;
    });

    assert.deepEqual(initial, {
      buttonCount: 5,
      buttonTag: 'BUTTON',
      sidebarOpen: true,
      responseTime: '03:29',
      responseTimeDateTime: new Date(2026, 0, 1, 3, 29).toISOString(),
      responseTimeImmediatelyAfterCopy: true,
      userDeleteCount: 0,
      userEditCount: 1,
      workProcess: {
        topToggleCount: 0,
        footerToggleCount: 1,
        durationCount: 0,
        mountedBefore: false,
        hiddenBefore: true,
        labelBefore: '查看工作过程',
        mountedAfter: true,
        hiddenAfter: false,
        labelAfter: '隐藏工作过程',
        mountedAfterCollapse: false,
        labelAfterCollapse: '查看工作过程'
      },
      reviewPanel: {
        title: '已编辑 5 个文件',
        stats: '+15 -5',
        initialVisibleCount: 3,
        initialHiddenCount: 2,
        moreBefore: '再显示 2 个文件',
        panelUndoCount: 1,
        footerUndoCount: 0,
        logoPath: 'M12 22C6.47715 22 2 17.5229 2 12C2 6.47715 6.47715 2 12 2M17.8778 3.90983C18.7268 4.52663 19.4734 5.2732 20.0902 6.12215M21.8769 10.4357C22.041 11.4721 22.041 12.5279 21.8769 13.5643M20.0902 17.8778C19.4734 18.7268 18.7268 19.4734 17.8778 20.0902M8 12L10.6667 15L16 9',
        expandedVisibleCount: 5,
        moreAfter: '收起 2 个文件'
      }
    });
    await page.locator('[data-run-change-rollback]').click();
    await page.locator('#genericConfirmModal:not(.hidden)').waitFor();
    assert.equal(await page.locator('#genericConfirmTitle').textContent(), '撤销改动');
    await page.locator('#genericConfirmCancel').click();
    assert.equal(review.selectedPath, 'src/app.js');
    assert.match(review.diffText || '', /const ready = true/);
    assert.equal(review.navCount, 5);
    assert.equal(review.reviewRole, 'region');
    assert.equal(review.parentRefreshHidden, true);
    assert.deepEqual(backendFilter, { count: 1, paths: ['src/app.js'] });
    assert.ok(browserWidths.expanded > 360, JSON.stringify(browserWidths));
    assert.equal(browserWidths.released, browserWidths.expanded);
    assert.equal(streamingMarkdown.settledNodeReused, true);
    assert.equal(streamingMarkdown.tailAppendedIncrementally, true);
    assert.ok(streamingMarkdown.tailTextLength > 0, JSON.stringify(streamingMarkdown));
    assert.equal(streamingMarkdown.firstPassWasStreaming, true);
    assert.equal(streamingMarkdown.cursorRemoved, true);
    assert.match(streamingMarkdown.finalText, /Stable block.*Tail keeps growing/s);
    await page.evaluate(() => applyLanguage('en'));
    await page.waitForFunction(() => document.querySelector('.run-change-title')?.textContent === 'Edited 5 files');
    const localizedPanel = await page.locator('.run-change-summary').evaluate(panel => ({
      title: panel.querySelector('.run-change-title')?.textContent || '',
      undo: panel.querySelector('[data-run-change-rollback]')?.textContent.trim() || '',
      more: panel.querySelector('[data-run-change-more-label]')?.textContent || '',
      chinese: [panel.textContent, ...[...panel.querySelectorAll('[aria-label], [title]')].flatMap(element => [
        element.getAttribute('aria-label'), element.getAttribute('title')
      ])].filter(value => /[\u3400-\u9fff]/u.test(value || ''))
    }));
    assert.deepEqual(localizedPanel, {
      title: 'Edited 5 files',
      undo: 'Undo',
      more: 'Show fewer 2 files',
      chinese: []
    });
    console.log(JSON.stringify({ ok: true, initial, review, backendFilter, browserWidths, streamingMarkdown, localizedPanel }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
