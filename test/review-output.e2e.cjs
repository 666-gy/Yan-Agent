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

    const initial = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      clearMessages();
      state.currentSession.workspace = 'C:\\yan-review-test';
      state.currentSession.messages = [];
      const agentRun = {
        runId: 'single-line-review-run',
        status: 'done',
        summaryStarted: true,
        durationMs: 1000,
        timeline: [
          { type: 'progress', stage: 'work', content: '正在修改文件。' },
          { type: 'text', stage: 'summary', content: '已修复一行代码。' }
        ],
        changeSummary: {
          source: 'opencode',
          count: 1,
          additions: 1,
          deletions: 1,
          files: [{
            path: 'src/app.js',
            status: 'modified',
            additions: 1,
            deletions: 1,
            diff: {
              rows: [
                { type: 'del', oldLine: 7, newLine: null, text: 'const ready = false;' },
                { type: 'add', oldLine: null, newLine: 7, text: 'const ready = true;' }
              ]
            }
          }]
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
        workProcess
      };
    });

    await page.waitForFunction(() => (
      document.querySelector('#rs-review')?.classList.contains('active')
      && document.querySelector('#reviewDiffHeader .review-diff-path')?.textContent === 'src/app.js'
    ));
    const review = await page.evaluate(() => ({
      selectedPath: rsReviewState.selectedPath,
      diffText: document.querySelector('#reviewDiffRows')?.textContent || ''
    }));

    const backendFilter = await page.evaluate(async () => {
      const textFile = {
        path: 'src/app.js',
        status: 'modified',
        additions: 1,
        deletions: 1,
        diff: { rows: [{ type: 'add', text: 'const ready = true;' }] }
      };
      const persisted = await api.saveSession({
        id: `binary-review-${Date.now()}`,
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
      buttonCount: 1,
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
      }
    });
    assert.equal(review.selectedPath, 'src/app.js');
    assert.equal(review.diffText.includes('const ready = true;'), true);
    assert.deepEqual(backendFilter, { count: 1, paths: ['src/app.js'] });
    assert.ok(browserWidths.expanded > 360, JSON.stringify(browserWidths));
    assert.equal(browserWidths.released, browserWidths.expanded);
    assert.equal(streamingMarkdown.settledNodeReused, true);
    assert.equal(streamingMarkdown.tailAppendedIncrementally, true);
    assert.ok(streamingMarkdown.tailTextLength > 0, JSON.stringify(streamingMarkdown));
    assert.equal(streamingMarkdown.firstPassWasStreaming, true);
    assert.equal(streamingMarkdown.cursorRemoved, true);
    assert.match(streamingMarkdown.finalText, /Stable block.*Tail keeps growing/s);
    console.log(JSON.stringify({ ok: true, initial, review, backendFilter, browserWidths, streamingMarkdown }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
