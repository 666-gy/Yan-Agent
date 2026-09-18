'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-composer-todo-e2e-'));

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
      typeof createRunCtx === 'function'
      && typeof applyOpenCodeEvent === 'function'
      && typeof renderTodos === 'function'
      && quickInputHandlerReady === true
      && !!state.currentSession
      && document.querySelector('#composerInput')?.isContentEditable
    ));

    const pasteResult = await page.evaluate(() => {
      input.value = 'ab';
      composerLastCaretTextOffset = 1;
      window.getSelection()?.removeAllRanges();
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', 'C:\\Pictures\\sample.png');
      const event = new ClipboardEvent('paste', {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true
      });
      input.dispatchEvent(event);
      return {
        value: input.value,
        prevented: event.defaultPrevented,
        focused: document.activeElement === input
      };
    });
    assert.deepEqual(pasteResult, {
      value: 'aC:\\Pictures\\sample.pngb',
      prevented: true,
      focused: true
    });

    const composerPerformanceResult = await page.evaluate(async () => {
      input.replaceChildren();
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < 2000; index++) {
        const line = document.createElement('div');
        line.textContent = `line ${index} abcdefghijklmnopqrstuvwxyz`;
        fragment.append(line);
      }
      input.append(fragment);
      invalidateComposerTextCache();
      input.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);

      const durations = [];
      const starts = new WeakMap();
      const onInputStart = event => starts.set(event, performance.now());
      const onInputEnd = event => durations.push(performance.now() - starts.get(event));
      input.addEventListener('input', onInputStart, true);
      input.addEventListener('input', onInputEnd);

      let serializations = 0;
      const originalComposerNodeText = composerNodeText;
      composerNodeText = function measuredComposerNodeText(...args) {
        serializations += 1;
        return originalComposerNodeText.apply(this, args);
      };
      for (let index = 0; index < 24; index++) {
        document.execCommand('insertText', false, 'a');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      composerNodeText = originalComposerNodeText;
      input.removeEventListener('input', onInputStart, true);
      input.removeEventListener('input', onInputEnd);

      const sorted = [...durations].sort((left, right) => left - right);
      const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] || 0;
      const result = {
        events: durations.length,
        serializations,
        p95,
        childNodes: input.childNodes.length,
        sendDisabled: sendBtn.disabled
      };
      input.value = '';
      updateSendState();
      return result;
    });
    assert.equal(composerPerformanceResult.events, 24, JSON.stringify(composerPerformanceResult));
    assert.equal(composerPerformanceResult.serializations, 24, JSON.stringify(composerPerformanceResult));
    assert.equal(composerPerformanceResult.childNodes, 2000, JSON.stringify(composerPerformanceResult));
    assert.equal(composerPerformanceResult.sendDisabled, false, JSON.stringify(composerPerformanceResult));
    assert.ok(composerPerformanceResult.p95 < 8, JSON.stringify(composerPerformanceResult));

    const compositionResult = await page.evaluate(async () => {
      input.value = '';
      input.focus({ preventScroll: true });
      let serializations = 0;
      const originalComposerNodeText = composerNodeText;
      composerNodeText = function measuredComposerNodeText(...args) {
        serializations += 1;
        return originalComposerNodeText.apply(this, args);
      };

      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      for (const value of ['n', 'ni', '你']) {
        input.textContent = value;
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: value,
          inputType: 'insertCompositionText',
          isComposing: true
        }));
      }
      const duringComposition = serializations;
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你' }));
      await new Promise(resolve => setTimeout(resolve, 10));
      const result = {
        duringComposition,
        afterCommit: serializations,
        value: input.value,
        sendDisabled: sendBtn.disabled
      };
      composerNodeText = originalComposerNodeText;
      input.value = '';
      updateSendState();
      return result;
    });
    assert.deepEqual(compositionResult, {
      duringComposition: 0,
      afterCommit: 1,
      value: '你',
      sendDisabled: false
    });

    const todoResult = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      const runCtx = createRunCtx(state.currentSession.id, true, state.currentSession.workspace || '');
      runCtx.activeAgentRun = { runId: runCtx.runId, status: 'working', timeline: [] };
      state.activeRuns.set(state.currentSession.id, {
        sessionRef: state.currentSession,
        runCtx,
        assistantEl: null
      });
      applyOpenCodeEvent(runCtx, {
        type: 'todo.updated',
        properties: {
          sessionID: 'e2e-session',
          todos: [
            { content: '检查输入', status: 'completed' },
            { content: '修复渲染', status: 'in_progress' },
            { content: '完成验证', status: 'pending' }
          ]
        }
      });
      applyOpenCodeEvent(runCtx, {
        type: 'yan.review.updated',
        data: { count: 1, additions: 12, deletions: 3, files: [{ path: 'index.html', additions: 12, deletions: 3 }] }
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const host = document.querySelector('#todoProgressHost');
      const active = {
        hidden: host.classList.contains('hidden'),
        count: document.querySelector('#todoProgressCount')?.textContent,
        items: Array.from(document.querySelectorAll('#todoList .todo-item')).map(item => item.textContent.trim())
      };

      runCtx.agentState.status = 'done';
      runCtx.agentState.todos = runCtx.agentState.todos.map(todo => ({
        ...todo,
        done: true,
        inProgress: false
      }));
      state.activeRuns.delete(state.currentSession.id);
      renderTodos(runCtx.agentState);
      const completed = {
        hidden: host.classList.contains('hidden'),
        state: host.dataset.state,
        count: document.querySelector('#todoProgressCount')?.textContent
      };
      runCtx.agentState.changeSummary = { additions: 12, deletions: 3 };
      renderTodos(runCtx.agentState);
      const withChanges = document.querySelector('#todoProgressCount')?.textContent;
      runCtx.agentState.changeSummary = { additions: 0, deletions: 0 };
      renderTodos(runCtx.agentState);
      const withoutChanges = document.querySelector('#todoProgressCount')?.textContent;

      const fileOnlySummary = {
        count: 3,
        additions: 9,
        deletions: 4,
        files: [
          { path: 'index.html', additions: 7, deletions: 1 },
          { path: 'src/app.js', additions: 2, deletions: 3 },
          { path: 'README.md', additions: 0, deletions: 0 }
        ]
      };
      const fileOnlyState = {
        ...runCtx.agentState,
        status: 'done',
        todos: [],
        changeSummary: fileOnlySummary
      };
      runCtx.agentState = fileOnlyState;
      runCtx.activeAgentRun = {
        ...runCtx.activeAgentRun,
        runId: runCtx.runId,
        changeSummary: fileOnlySummary
      };
      state.activeRuns.set(state.currentSession.id, {
        sessionRef: state.currentSession,
        runCtx,
        assistantEl: null
      });
      renderTodos(fileOnlyState);
      setTodoProgressOpen(true);
      const originalOpenRunChangeReview = openRunChangeReview;
      let openedReview = null;
      openRunChangeReview = (agentRun, filePath) => {
        openedReview = { runId: agentRun?.runId || '', filePath };
        return true;
      };
      document.querySelectorAll('#todoList [data-todo-review-file]')[1]?.click();
      openRunChangeReview = originalOpenRunChangeReview;
      const addNode = document.querySelector('#todoProgressCount .todo-change-add');
      const delNode = document.querySelector('#todoProgressCount .todo-change-del');
      const labelNode = document.querySelector('#todoProgressCount .todo-progress-label');
      const fileOnly = {
        hidden: host.classList.contains('hidden'),
        mode: host.dataset.mode,
        count: document.querySelector('#todoProgressCount')?.textContent,
        ringDisplay: getComputedStyle(document.querySelector('#todoProgressRing')).display,
        panelHeadDisplay: getComputedStyle(document.querySelector('#todoProgressPanel .todo-progress-panel-head')).display,
        files: Array.from(document.querySelectorAll('#todoList .todo-change-file')).map(item => ({
          name: item.querySelector('.todo-change-file-name')?.textContent,
          stats: item.querySelector('.todo-change-file-stats')?.textContent || ''
        })),
        addColor: getComputedStyle(addNode).color,
        delColor: getComputedStyle(delNode).color,
        labelColor: getComputedStyle(labelNode).color,
        openedReview,
        openAfterFileClick: host.classList.contains('open'),
        translations: {
          progress: window.YanI18n?.translate('第 1/3 已完成', 'en'),
          files: window.YanI18n?.translate('编辑了文件', 'en')
        }
      };
      state.activeRuns.delete(state.currentSession.id);
      return { active, completed, withChanges, withoutChanges, fileOnly };
    });

    assert.equal(todoResult.active.hidden, false, JSON.stringify(todoResult));
    assert.equal(todoResult.active.count, '第 1/3 已完成，+12 -3', JSON.stringify(todoResult));
    assert.equal(todoResult.active.items.length, 3, JSON.stringify(todoResult));
    assert.equal(todoResult.completed.hidden, false, JSON.stringify(todoResult));
    assert.equal(todoResult.completed.state, 'success', JSON.stringify(todoResult));
    assert.equal(todoResult.completed.count, '第 3/3 已完成，+12 -3', JSON.stringify(todoResult));
    assert.equal(todoResult.withoutChanges, '第 3/3 已完成', JSON.stringify(todoResult));
    assert.equal(todoResult.fileOnly.hidden, false, JSON.stringify(todoResult));
    assert.equal(todoResult.fileOnly.mode, 'files', JSON.stringify(todoResult));
    assert.equal(todoResult.fileOnly.count, '编辑了3个文件 +9 -4', JSON.stringify(todoResult));
    assert.equal(todoResult.fileOnly.ringDisplay, 'none', JSON.stringify(todoResult));
    assert.equal(todoResult.fileOnly.panelHeadDisplay, 'none', JSON.stringify(todoResult));
    assert.deepEqual(todoResult.fileOnly.files, [
      { name: 'index.html', stats: '+7 -1' },
      { name: 'app.js', stats: '+2 -3' },
      { name: 'README.md', stats: '' }
    ], JSON.stringify(todoResult));
    assert.notEqual(todoResult.fileOnly.addColor, todoResult.fileOnly.delColor, JSON.stringify(todoResult));
    assert.notEqual(todoResult.fileOnly.addColor, todoResult.fileOnly.labelColor, JSON.stringify(todoResult));
    assert.notEqual(todoResult.fileOnly.delColor, todoResult.fileOnly.labelColor, JSON.stringify(todoResult));
    assert.ok(todoResult.fileOnly.openedReview?.runId, JSON.stringify(todoResult));
    assert.equal(todoResult.fileOnly.openedReview?.filePath, 'src/app.js', JSON.stringify(todoResult));
    assert.equal(todoResult.fileOnly.openAfterFileClick, false, JSON.stringify(todoResult));
    assert.deepEqual(todoResult.fileOnly.translations, {
      progress: 'Completed 1/3',
      files: 'Edited files'
    }, JSON.stringify(todoResult));

    const transientSurfaceResult = await page.evaluate(async () => {
      const host = document.querySelector('#todoProgressHost');
      host.classList.remove('hidden');
      setTodoProgressOpen(true);
      openSettings('general');
      const settings = {
        todoOpen: host.classList.contains('open'),
        todoVisibility: getComputedStyle(host).visibility,
        composerVisibility: getComputedStyle(document.querySelector('#composerStage')).visibility
      };
      closeSettings();

      setRightSidebarOpen(true);
      setBrowserFocusMode(true);
      setBrowserFocusComposerMode('expanded');
      await new Promise(resolve => requestAnimationFrame(resolve));

      const viewportWidth = window.innerWidth;
      const rect = selector => {
        const bounds = document.querySelector(selector).getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          width: bounds.width,
          insideViewport: bounds.left >= 0 && bounds.right <= viewportWidth + 0.5
        };
      };
      const focus = {
        stage: rect('#composerStage'),
        composer: rect('#composer'),
        dock: rect('#browserFocusConversationDock'),
        conversation: rect('.browser-focus-conversation-surface'),
        viewportWidth,
        scrollWidth: document.documentElement.scrollWidth
      };
      setBrowserFocusMode(false);
      return { settings, focus };
    });

    assert.deepEqual(transientSurfaceResult.settings, {
      todoOpen: false,
      todoVisibility: 'hidden',
      composerVisibility: 'hidden'
    }, JSON.stringify(transientSurfaceResult));
    assert.equal(transientSurfaceResult.focus.stage.insideViewport, true, JSON.stringify(transientSurfaceResult));
    assert.equal(transientSurfaceResult.focus.composer.insideViewport, true, JSON.stringify(transientSurfaceResult));
    assert.equal(transientSurfaceResult.focus.dock.insideViewport, true, JSON.stringify(transientSurfaceResult));
    assert.equal(transientSurfaceResult.focus.conversation.insideViewport, true, JSON.stringify(transientSurfaceResult));
    assert.equal(transientSurfaceResult.focus.scrollWidth, transientSurfaceResult.focus.viewportWidth, JSON.stringify(transientSurfaceResult));

    const openCodeWaitResult = await page.evaluate(() => {
      const runCtx = createRunCtx('opencode-wait-e2e', false, 'C:\\yan-review-test');
      runCtx.activeAgentRun = {
        runId: runCtx.runId,
        status: 'working',
        timeline: [{ type: 'progress', variant: 'agent-loader', content: '', openCodeKey: 'model-wait' }]
      };
      runCtx.openCodePartTypes = new Map();
      runCtx.openCodePendingPartDeltas = new Map();
      runCtx.openCodeRawTextParts = new Map();
      runCtx.openCodeNextStreamIDs = new Set();
      runCtx.openCodeSuppressedPartIDs = new Set();
      runCtx.openCodeProtocolProbe = new Map();
      rebuildOpenCodeTimelineIndex(runCtx);

      applyOpenCodeEvent(runCtx, {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'reasoning-1',
            type: 'reasoning',
            text: 'Planning the implementation.',
            time: { start: 1, end: 2 }
          }
        }
      }, { deferEffects: true });
      applyOpenCodeEvent(runCtx, {
        type: 'message.part.updated',
        properties: {
          part: { id: 'text-blank', type: 'text', text: '\n\n', time: { start: 2, end: 3 } }
        }
      }, { deferEffects: true });
      const afterBlank = {
        wait: openCodeTimelineItem(runCtx, 'model-wait')?.content || '',
        variant: openCodeTimelineItem(runCtx, 'model-wait')?.variant || '',
        textItems: runCtx.activeAgentRun.timeline.filter(item => item.type === 'text').length,
        partialContent: runCtx.partialContent
      };

      applyOpenCodeEvent(runCtx, {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'tool-1',
            callID: 'call-1',
            type: 'tool',
            tool: 'write',
            state: { status: 'completed', input: { file: 'index.html' }, output: 'ok' }
          }
        }
      }, { deferEffects: true });
      applyOpenCodeEvent(runCtx, {
        type: 'yan.model.request.started',
        data: { requestIndex: 2 }
      }, { deferEffects: true });
      const afterTool = {
        content: openCodeTimelineItem(runCtx, 'model-wait')?.content || '',
        variant: openCodeTimelineItem(runCtx, 'model-wait')?.variant || ''
      };
      const petAfterTool = mapOpenCodeEventToPet({
        type: 'yan.model.request.started',
        data: { requestIndex: 2 }
      }, runCtx)?.message || '';

      applyOpenCodeEvent(runCtx, {
        type: 'session.next.text.delta',
        data: { textID: 'text-visible', delta: 'Finished.' }
      }, { deferEffects: true });
      const waitAfterText = !!openCodeTimelineItem(runCtx, 'model-wait');
      const completed = openCodeResultToAgentRun({ status: 'done', text: 'Finished.' }, runCtx);
      const headerHost = document.createElement('div');
      document.body.appendChild(headerHost);
      const loaderHost = document.createElement('div');
      document.body.appendChild(loaderHost);
      renderAgentRunBody(loaderHost, {
        status: 'working',
        startedAt: Date.now(),
        timeline: [{ type: 'progress', variant: 'agent-loader', content: '' }]
      });
      const loaderRoot = loaderHost.querySelector('.capybaraloader');
      const loaderParts = {
        root: loaderHost.querySelectorAll('.capybaraloader').length,
        head: loaderHost.querySelectorAll('.capybaraloader .capyhead').length,
        ears: loaderHost.querySelectorAll('.capybaraloader .capyear').length,
        eyes: loaderHost.querySelectorAll('.capybaraloader .capyeye').length,
        backLegs: loaderHost.querySelectorAll('.capybaraloader .capyleg2').length,
        line: loaderHost.querySelectorAll('.capybaraloader .loaderline').length
      };
      const loaderScale = loaderRoot ? getComputedStyle(loaderRoot).transform : '';
      const loaderAnimations = loaderRoot ? loaderRoot.getAnimations({ subtree: true }) : [];
      const loaderAnimationNames = loaderAnimations.map(animation => animation.animationName);
      const loaderAnimationPlayStates = loaderAnimations.map(animation => animation.playState);
      const loaderLeg = loaderRoot ? loaderRoot.querySelector('.capyleg2') : null;
      const loaderLegTransformBefore = loaderLeg ? getComputedStyle(loaderLeg).transform : '';
      loaderAnimations.forEach(animation => {
        animation.currentTime = (Number(animation.currentTime) || 0) + 250;
      });
      const loaderLegTransformAfter = loaderLeg ? getComputedStyle(loaderLeg).transform : '';
      loaderHost.remove();
      const headerRun = {
        status: 'working',
        startedAt: Date.now() - 2500,
        timeline: []
      };
      renderAgentRunHeader(headerHost, headerRun);
      const waitingLabel = headerHost.querySelector('.run-status-label')?.textContent || '';
      const waitingStatus = headerHost.querySelector('.run-status')?.textContent.trim() || '';
      headerRun.responseStartedAt = Date.now() - 1200;
      headerRun.responseDurationMs = 1300;
      renderAgentRunHeader(headerHost, headerRun);
      const respondedLabel = headerHost.querySelector('.run-status-label')?.textContent || '';
      const respondedElapsed = !!headerHost.querySelector('.run-elapsed');
      headerRun.status = 'done';
      headerRun.durationMs = 4200;
      headerRun.usage = { input: 200, cacheRead: 800, cacheWrite: 0 };
      renderAgentRunHeader(headerHost, headerRun);
      const terminalHeader = headerHost.querySelector('.run-status')?.textContent.trim() || '';
      const replyHeader = headerHost.querySelector('.run-reply-time')?.textContent.trim() || '';
      const cacheHeader = headerHost.querySelector('.run-cache-hit')?.textContent.trim() || '';
      headerHost.remove();
      return {
        afterBlank,
        afterTool,
        petAfterTool,
        waitAfterText,
        waitAfterComplete: !!completed.timeline.find(item => item.openCodeKey === 'model-wait'),
        waitingLabel,
        waitingStatus,
        respondedLabel,
        respondedElapsed,
        terminalHeader,
        replyHeader,
        cacheHeader,
        loaderParts,
        loaderScale,
        loaderAnimationNames,
        loaderAnimationPlayStates,
        loaderLegTransformBefore,
        loaderLegTransformAfter,
        textContent: openCodeTimelineItem(runCtx, 'text:text-visible')?.content || '',
        partialContent: runCtx.partialContent
      };
    });

    assert.deepEqual(openCodeWaitResult.afterBlank, {
      wait: '',
      variant: 'agent-loader',
      textItems: 0,
      partialContent: ''
    }, JSON.stringify(openCodeWaitResult));
    assert.deepEqual(openCodeWaitResult.afterTool, {
      content: '',
      variant: 'agent-loader'
    }, JSON.stringify(openCodeWaitResult));
    assert.equal(openCodeWaitResult.petAfterTool, '起飞中', JSON.stringify(openCodeWaitResult));
    assert.equal(openCodeWaitResult.waitAfterText, true, JSON.stringify(openCodeWaitResult));
    assert.equal(openCodeWaitResult.waitAfterComplete, false, JSON.stringify(openCodeWaitResult));
    assert.equal(openCodeWaitResult.waitingLabel, '回包中', JSON.stringify(openCodeWaitResult));
    assert.match(openCodeWaitResult.waitingStatus, /^回包中\s+\d+/u, JSON.stringify(openCodeWaitResult));
    assert.equal(openCodeWaitResult.respondedLabel, '已处理', JSON.stringify(openCodeWaitResult));
    assert.equal(openCodeWaitResult.respondedElapsed, true, JSON.stringify(openCodeWaitResult));
    assert.match(openCodeWaitResult.terminalHeader, /^已处理/u, JSON.stringify(openCodeWaitResult));
    assert.match(openCodeWaitResult.replyHeader, /^回包时间/u, JSON.stringify(openCodeWaitResult));
    assert.match(openCodeWaitResult.cacheHeader, /^缓存命中/u, JSON.stringify(openCodeWaitResult));
    assert.deepEqual(openCodeWaitResult.loaderParts, {
      root: 1,
      head: 1,
      ears: 2,
      eyes: 2,
      backLegs: 2,
      line: 1
    }, JSON.stringify(openCodeWaitResult));
    assert.match(openCodeWaitResult.loaderScale, /^matrix\(0\.75, 0, 0, 0\.75,/u, JSON.stringify(openCodeWaitResult));
    assert.deepEqual(
      [...openCodeWaitResult.loaderAnimationNames].sort(),
      ['movebody', 'movebody', 'movebody', 'moveleg', 'moveleg2', 'moveline'],
      JSON.stringify(openCodeWaitResult)
    );
    assert.equal(
      openCodeWaitResult.loaderAnimationPlayStates.every(state => state === 'running'),
      true,
      JSON.stringify(openCodeWaitResult)
    );
    assert.notEqual(
      openCodeWaitResult.loaderLegTransformBefore,
      openCodeWaitResult.loaderLegTransformAfter,
      JSON.stringify(openCodeWaitResult)
    );
    assert.equal(openCodeWaitResult.textContent, 'Finished.', JSON.stringify(openCodeWaitResult));
    assert.equal(openCodeWaitResult.partialContent, 'Finished.', JSON.stringify(openCodeWaitResult));
    assert.deepEqual(pageErrors, []);

    console.log(JSON.stringify({
      ok: true,
      pasteResult,
      composerPerformanceResult,
      compositionResult,
      todoResult,
      openCodeWaitResult
    }));
  } finally {
    if (application) await application.close().catch(() => {});
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedUserData = path.resolve(userDataDir);
    if (resolvedUserData.startsWith(tempRoot + path.sep)) {
      fs.rmSync(resolvedUserData, { recursive: true, force: true });
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
