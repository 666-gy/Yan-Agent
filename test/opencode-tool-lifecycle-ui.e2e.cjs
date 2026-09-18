'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-tool-lifecycle-e2e-'));
const screenshotDir = path.join(appRoot, 'output', 'playwright');
const expandedDarkScreenshotPath = path.join(screenshotDir, 'tool-activity-expanded-dark.png');
const collapsedLightScreenshotPath = path.join(screenshotDir, 'tool-activity-collapsed-light.png');
const commandPanelScreenshotPath = path.join(screenshotDir, 'tool-command-panel-dark.png');
const genericPanelScreenshotPath = path.join(screenshotDir, 'tool-result-panel-dark.png');

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
      typeof createRunCtx === 'function'
      && typeof applyOpenCodeEvent === 'function'
      && typeof applyOpenCodeEventBatch === 'function'
      && typeof appendMessage === 'function'
    ));

    const protocolExamples = await page.evaluate(() => {
      const text = '适配器处理 `<｜｜DSML｜｜tool_calls>`，接下来继续规划。';
      const ctx = createRunCtx('protocol-example', true, '');
      initOpenCodeRunState(ctx);
      for (const character of text) {
        applyOpenCodeNextTextDelta(ctx, 'example-text', character);
        applyOpenCodeNextReasoningDelta(ctx, 'example-reasoning', character);
      }
      return {
        text: ctx.openCodeRawTextParts.get('example-text'),
        reasoning: openCodeTimelineItem(ctx, 'reasoning:example-reasoning')?.content,
        suppressed: ctx.openCodeSuppressedPartIDs.size,
        genuine: containsDsmlProtocolMarkup('<｜｜DSML｜｜tool_calls>')
      };
    });
    assert.deepEqual(protocolExamples, {
      text: '适配器处理 `<｜｜DSML｜｜tool_calls>`，接下来继续规划。',
      reasoning: '适配器处理 `<｜｜DSML｜｜tool_calls>`，接下来继续规划。',
      suppressed: 0,
      genuine: true
    });

    const states = await page.evaluate(async () => {
      const openDetails = async element => {
        element.querySelectorAll('.tool-activity-group, .tool-parallel-group, .tool-step').forEach(row => { row.open = true; });
        await new Promise(resolve => setTimeout(resolve, 0));
      };
      if (!state.currentSession) await newSession();
      const session = state.currentSession;
      const thinkingProbe = buildThinkingElement('思考内容', false);
      document.body.appendChild(thinkingProbe);
      const thinkingDot = thinkingProbe.querySelector('.thinking-orb-dot');
      const thinking = {
        label: thinkingProbe.querySelector('.thinking-label')?.textContent,
        englishLabel: window.YanI18n?.translate('深度求索中……', 'en'),
        variant: thinkingProbe.querySelector('.thinking-orb-helix')?.dataset.variant,
        dotCount: thinkingProbe.querySelectorAll('.thinking-orb-dot').length,
        animationName: thinkingDot ? getComputedStyle(thinkingDot).animationName : '',
        animationDuration: thinkingDot ? getComputedStyle(thinkingDot).animationDuration : '',
        hasKeyframes: ['--g0x', '--g0y', '--g0o', '--g7x', '--g7y', '--g7o']
          .every(property => !!thinkingDot?.style.getPropertyValue(property))
      };
      updateAgentTimelinePartElement(thinkingProbe, {
        type: 'thinking',
        content: '已完成思考',
        streaming: false
      }, null, null);
      thinking.completedLabel = thinkingProbe.querySelector('.thinking-label')?.textContent;
      thinkingProbe.remove();
      const runCtx = createRunCtx(session.id, true, session.workspace || '');
      runCtx.activeAgentRun = { runId: runCtx.runId, status: 'working', timeline: [] };
      runCtx.openCodePartTypes = new Map();
      runCtx.openCodePendingPartDeltas = new Map();
      runCtx.openCodeRawTextParts = new Map();
      runCtx.openCodeNextStreamIDs = new Set();
      runCtx.openCodeSuppressedPartIDs = new Set();
      runCtx.openCodeProtocolProbe = new Map();
      rebuildOpenCodeTimelineIndex(runCtx);

      const assistantEl = appendMessage('assistant', '');
      state.activeRuns.set(session.id, { sessionRef: session, runCtx, assistantEl });

      // Leave a frame-batched text update pending before the lifecycle event.
      applyOpenCodeEventBatch(runCtx, [{
        type: 'session.next.reasoning.delta',
        data: { reasoningID: 'reasoning-1', delta: 'Plan complete.' }
      }]);
      applyOpenCodeEvent(runCtx, {
        type: 'message.part.updated',
        data: {
          part: {
            id: 'tool-part-1',
            messageID: 'assistant-step-1',
            callID: 'write-call-1',
            type: 'tool',
            tool: 'write',
            state: { status: 'running', input: { path: 'index.html' } }
          }
        }
      });

      const runningGroup = assistantEl.querySelector('.tool-activity-group');
      const runningStep = assistantEl.querySelector('.tool-step[data-call-id="write-call-1"]');
      const runningShine = runningStep?.querySelector(':scope > summary .tc-name.tool-state-shine');
      const runningShineStyle = runningShine ? getComputedStyle(runningShine) : null;
      const running = {
        groupCount: assistantEl.querySelectorAll('.tool-activity-group').length,
        groupClosed: runningGroup?.open === false,
        groupLabelMode: runningGroup?.dataset.toolLabelMode,
        groupState: runningGroup?.querySelector(':scope > summary .tool-activity-label')?.textContent,
        stepExists: !!runningStep,
        stepState: runningStep?.querySelector(':scope > summary .tc-name')?.textContent,
        summary: runningGroup?.querySelector('.tool-activity-label')?.textContent,
        stepLabel: runningStep?.querySelector('.tc-name')?.textContent,
        stepPreview: runningStep?.querySelector('.tc-preview')?.textContent,
        icon: runningStep?.querySelector('.tc-icon-svg')?.dataset.icon,
        shineAnimation: runningShineStyle?.animationName || '',
        shineIterations: runningShineStyle?.animationIterationCount || '',
        groupShineAttached: runningGroup?.querySelector(':scope > summary > .tool-activity-label')?.classList.contains('tool-state-shine'),
        stepShineAttached: runningStep?.querySelector(':scope > summary > .tc-name')?.classList.contains('tool-state-shine'),
        groupInnerLabelClass: runningGroup?.querySelector(':scope > summary > .tool-activity-label')?.className,
        standaloneStateCount: assistantEl.querySelectorAll(':scope .tool-activity-summary > .tool-state-shine:not(.tool-activity-label), :scope .tool-parallel-summary > .tool-state-shine:not(.tool-parallel-label), :scope .tc-header > .tool-state-shine:not(.tc-name)').length,
        chevronCount: assistantEl.querySelectorAll('.tool-row-chevron').length,
        legacyBadgeCount: assistantEl.querySelectorAll('.tc-badge').length
      };
      const runningColors = {
        groupLabel: runningGroup ? getComputedStyle(runningGroup.querySelector('.tool-activity-label')).color : '',
        groupIcon: runningGroup ? getComputedStyle(runningGroup.querySelector('.tool-activity-icon')).color : '',
        stepLabel: runningStep ? getComputedStyle(runningStep.querySelector('.tc-name')).color : ''
      };

      const runningCommandEl = appendMessage('assistant', '');
      renderAgentRunBody(runningCommandEl.querySelector('.msg-body'), {
        runId: 'running-command',
        status: 'working',
        timeline: [
          { type: 'tool_call', callId: 'running-command', name: 'bash', args: { command: 'Get-Location' } }
        ]
      });
      await openDetails(runningCommandEl);
      const runningCommandStatus = runningCommandEl.querySelector('.tool-command-status');
      const runningCommand = {
        visibleText: runningCommandStatus?.textContent.trim() || '',
        ariaLabel: runningCommandStatus?.getAttribute('aria-label') || '',
        panelState: runningCommandEl.querySelector('.tool-command-panel')?.dataset.commandState || ''
      };
      runningCommandEl.remove();

      applyOpenCodeEvent(runCtx, {
        type: 'message.part.updated',
        data: {
          part: {
            id: 'tool-part-1',
            messageID: 'assistant-step-1',
            callID: 'write-call-1',
            type: 'tool',
            tool: 'write',
            state: {
              status: 'completed',
              input: { path: 'index.html' },
              output: 'ok'
            }
          }
        }
      });

      const completedGroup = assistantEl.querySelector('.tool-activity-group');
      const completedStep = assistantEl.querySelector('.tool-step[data-call-id="write-call-1"]');
      const completed = {
        groupStateCount: completedGroup?.querySelectorAll(':scope > summary .tool-state-shine').length,
        stepStateCount: completedStep?.querySelectorAll(':scope > summary .tool-state-shine').length,
        groupLabelMode: completedGroup?.dataset.toolLabelMode,
        groupLabel: completedGroup?.querySelector(':scope > summary > .tool-activity-label')?.textContent,
        groupOuterLabelClass: completedGroup?.querySelector(':scope > summary > .tool-activity-label')?.className,
        groupOuterLabelShine: completedGroup?.querySelector(':scope > summary > .tool-activity-outer-label')?.classList.contains('tool-state-shine') || false,
        stepLabel: completedStep?.querySelector(':scope > summary > .tc-name')?.textContent,
        toolNameShine: completedStep?.querySelector(':scope > summary > .tc-name')?.classList.contains('tool-state-shine') || false,
        runningClass: completedStep?.classList.contains('is-running') || false,
        completedClass: completedStep?.classList.contains('is-completed') || false,
        legacyBadgeCount: assistantEl.querySelectorAll('.tc-badge').length
      };

      const compressionEl = appendMessage('assistant', '');
      renderAgentRunBody(compressionEl.querySelector('.msg-body'), {
        runId: 'context-compression',
        status: 'working',
        timeline: [
          { type: 'thinking', content: '整理上下文。' },
          { type: 'progress', variant: 'context-compression', compressionState: 'running', content: '正在压缩上下文……' }
        ]
      });
      const compressionRunningNote = compressionEl.querySelector('.context-compression-note');
      const compressionRunning = {
        text: compressionRunningNote?.textContent,
        state: compressionRunningNote?.className,
        iconCount: compressionRunningNote?.querySelectorAll('.context-compression-icon svg').length,
        iconStrokeWidth: compressionRunningNote?.querySelector('.context-compression-icon svg')?.getAttribute('stroke-width'),
        iconPath: compressionRunningNote?.querySelector('.context-compression-icon path')?.getAttribute('d')
      };
      renderAgentRunBody(compressionEl.querySelector('.msg-body'), {
        runId: 'context-compression',
        status: 'completed',
        timeline: [
          { type: 'thinking', content: '整理上下文。' },
          { type: 'progress', variant: 'context-compression', compressionState: 'completed', content: '上下文压缩已完成' }
        ]
      });
      const compressionCompletedNote = compressionEl.querySelector('.context-compression-note');
      const compressionCompleted = {
        text: compressionCompletedNote?.textContent,
        state: compressionCompletedNote?.className,
        iconCount: compressionCompletedNote?.querySelectorAll('.context-compression-icon svg').length,
        iconStrokeWidth: compressionCompletedNote?.querySelector('.context-compression-icon svg')?.getAttribute('stroke-width'),
        iconPath: compressionCompletedNote?.querySelector('.context-compression-icon path')?.getAttribute('d')
      };
      compressionEl.remove();

      const relayRunCtx = createRunCtx(`${session.id}-vision-relay`, true, session.workspace || '');
      relayRunCtx.activeAgentRun = {
        runId: relayRunCtx.runId,
        status: 'working',
        timeline: []
      };
      const relayEl = appendMessage('assistant', '');
      applyOpenCodeEvent(relayRunCtx, {
        type: 'yan.vision.relay.started',
        data: {
          modelId: 'glm-4.6v-flash',
          modelName: 'GLM-4.6V-Flash',
          imageCount: 1
        }
      }, { deferEffects: true });
      renderAgentRunBody(relayEl.querySelector('.msg-body'), relayRunCtx.activeAgentRun);
      const relayRunningNote = relayEl.querySelector('.vision-relay-note');
      const relayRunning = {
        text: relayRunningNote?.textContent,
        state: relayRunningNote?.className,
        iconCount: relayRunningNote?.querySelectorAll('.vision-relay-icon svg').length,
        iconStrokeWidth: relayRunningNote?.querySelector('.vision-relay-icon svg')?.getAttribute('stroke-width'),
        iconPath: relayRunningNote?.querySelector('.vision-relay-icon svg path')?.getAttribute('d')
      };
      applyOpenCodeEvent(relayRunCtx, {
        type: 'yan.vision.relay.completed',
        data: {
          modelId: 'glm-4.6v-flash',
          modelName: 'GLM-4.6V-Flash',
          imageCount: 1
        }
      }, { deferEffects: true });
      renderAgentRunBody(relayEl.querySelector('.msg-body'), relayRunCtx.activeAgentRun);
      const relayCompletedNote = relayEl.querySelector('.vision-relay-note');
      const relayCompleted = {
        text: relayCompletedNote?.textContent,
        state: relayCompletedNote?.className,
        iconCount: relayCompletedNote?.querySelectorAll('.vision-relay-icon svg').length,
        iconStrokeWidth: relayCompletedNote?.querySelector('.vision-relay-icon svg')?.getAttribute('stroke-width'),
        iconPath: relayCompletedNote?.querySelector('.vision-relay-icon svg path')?.getAttribute('d')
      };
      relayEl.remove();

      const policyRunCtx = createRunCtx(`${session.id}-policy-acceptance`, true, session.workspace || '');
      policyRunCtx.activeAgentRun = {
        runId: policyRunCtx.runId,
        status: 'working',
        timeline: []
      };
      const policyEl = appendMessage('assistant', '');
      applyOpenCodeEvent(policyRunCtx, {
        type: 'yan.policy.acceptance.started',
        data: {
          callID: 'policy-acceptance:e2e',
          tool: 'yan_policy_acceptance',
          input: { policyCount: 1, policies: ['prompt-search-routing'] }
        }
      }, { deferEffects: true });
      applyOpenCodeEvent(policyRunCtx, {
        type: 'yan.policy.acceptance.passed',
        data: {
          callID: 'policy-acceptance:e2e',
          tool: 'yan_policy_acceptance',
          output: { ok: true, policyCount: 1, findings: [] }
        }
      }, { deferEffects: true });
      renderAgentRunBody(policyEl.querySelector('.msg-body'), policyRunCtx.activeAgentRun);
      const policyStep = policyEl.querySelector('.tool-step[data-tool="yan_policy_acceptance"]');
      const policyAcceptance = {
        callCount: policyRunCtx.activeAgentRun.timeline.filter(item => item.type === 'tool_call').length,
        resultCount: policyRunCtx.activeAgentRun.timeline.filter(item => item.type === 'tool_result').length,
        textCount: policyRunCtx.activeAgentRun.timeline.filter(item => item.type === 'text').length,
        label: policyStep?.querySelector('.tc-name')?.textContent,
        icon: policyStep?.querySelector('.tc-icon-svg')?.dataset.icon,
        state: policyStep?.dataset.toolState,
        ok: policyStep?.dataset.ok
      };
      policyEl.remove();

      const reconnectRunCtx = createRunCtx(`${session.id}-stream-reconnect`, true, session.workspace || '');
      reconnectRunCtx.activeAgentRun = {
        runId: reconnectRunCtx.runId,
        status: 'working',
        timeline: []
      };
      const reconnectEl = appendMessage('assistant', '');
      applyOpenCodeEvent(reconnectRunCtx, {
        type: 'yan.opencode.reconnecting',
        data: {
          attempt: 1,
          maxAttempts: 5,
          message: 'network error: connection reset'
        }
      }, { deferEffects: true });
      renderAgentRunBody(reconnectEl.querySelector('.msg-body'), reconnectRunCtx.activeAgentRun);
      const reconnectNote = reconnectEl.querySelector('.stream-reconnect-note');
      const reconnectRunning = {
        tagName: reconnectNote?.tagName,
        text: reconnectNote?.querySelector('.stream-reconnect-label')?.textContent,
        iconCount: reconnectNote?.querySelectorAll('.stream-reconnect-icon svg').length,
        iconStrokeWidth: reconnectNote?.querySelector('.stream-reconnect-icon svg')?.getAttribute('stroke-width'),
        collapsed: reconnectNote?.open === false,
        detail: reconnectNote?.querySelector('.stream-reconnect-detail')?.textContent,
        detailHidden: reconnectNote?.querySelector('.stream-reconnect-detail')?.checkVisibility?.() === false
      };
      reconnectNote?.querySelector('summary')?.click();
      const reconnectExpanded = {
        open: reconnectNote?.open === true,
        detail: reconnectNote?.querySelector('.stream-reconnect-detail')?.textContent
      };
      applyOpenCodeEvent(reconnectRunCtx, {
        type: 'yan.opencode.reconnecting',
        data: {
          attempt: 3,
          maxAttempts: 5,
          message: 'network error: second attempt'
        }
      }, { deferEffects: true });
      renderAgentRunBody(reconnectEl.querySelector('.msg-body'), reconnectRunCtx.activeAgentRun);
      const reconnectUpdated = {
        text: reconnectEl.querySelector('.stream-reconnect-label')?.textContent,
        detail: reconnectEl.querySelector('.stream-reconnect-detail')?.textContent,
        stillOpen: reconnectEl.querySelector('.stream-reconnect-note')?.open === true
      };
      applyOpenCodeEvent(reconnectRunCtx, {
        type: 'yan.opencode.reconnected',
        data: { attempt: 3, maxAttempts: 5 }
      }, { deferEffects: true });
      renderAgentRunBody(reconnectEl.querySelector('.msg-body'), reconnectRunCtx.activeAgentRun);
      const reconnectCleared = reconnectEl.querySelector('.stream-reconnect-note') == null;
      applyOpenCodeEvent(reconnectRunCtx, {
        type: 'yan.opencode.reconnecting',
        data: {
          attempt: 1,
          maxAttempts: 5,
          message: 'network error: later disconnect'
        }
      }, { deferEffects: true });
      renderAgentRunBody(reconnectEl.querySelector('.msg-body'), reconnectRunCtx.activeAgentRun);
      const reconnectReset = reconnectEl.querySelector('.stream-reconnect-label')?.textContent;
      reconnectEl.remove();

      const groupedEl = appendMessage('assistant', '');
      const groupedTimeline = [
        { type: 'thinking', content: '先读取需要的上下文。' },
        { type: 'tool_call', callId: 'read-a', name: 'read', args: { path: 'a.txt' } },
        { type: 'tool_call', callId: 'read-b', name: 'read', args: { path: 'b.txt' } },
        { type: 'progress', variant: 'agent-loader', content: '' },
        { type: 'tool_call', callId: 'browser-a', name: 'yan_browser_browser_snapshot', args: {} },
        { type: 'tool_call', callId: 'browser-b', name: 'yan_browser_browser_click', args: { target: 'button' } },
        { type: 'tool_result', callId: 'read-a', name: 'read', output: 'a', ok: true },
        { type: 'tool_result', callId: 'read-b', name: 'read', output: 'b', ok: true },
        { type: 'tool_result', callId: 'browser-a', name: 'yan_browser_browser_snapshot', output: 'snapshot', ok: true },
        { type: 'tool_result', callId: 'browser-b', name: 'yan_browser_browser_click', output: 'clicked', ok: true },
        { type: 'thinking', content: '已经取得上下文。' }
      ];
      renderAgentRunBody(groupedEl.querySelector('.msg-body'), {
        runId: 'grouped-tools',
        status: 'completed',
        timeline: groupedTimeline
      });
      const grouped = groupedEl.querySelector('.tool-activity-group');
      grouped.dataset.e2eFixture = 'tool-activity';
      const groupedSummary = grouped?.querySelector(':scope > .tool-activity-summary');
      const collapsedBeforeClick = grouped?.open === false;
      groupedSummary?.click();
      const parallelLabels = Array.from(groupedEl.querySelectorAll('.tool-parallel-label'))
        .map(element => element.textContent);
      const parallelGroups = Array.from(groupedEl.querySelectorAll('.tool-parallel-group'));
      parallelGroups.forEach(element => { element.open = true; });
      const skillColorProbe = document.createElement('span');
      skillColorProbe.className = 'composer-skill-token';
      skillColorProbe.textContent = 'skill';
      document.body.appendChild(skillColorProbe);
      const skillColor = getComputedStyle(skillColorProbe).color;
      skillColorProbe.remove();
      const rowSummaries = [
        groupedSummary,
        ...parallelGroups.map(element => element.querySelector(':scope > .tool-parallel-summary')),
        ...Array.from(groupedEl.querySelectorAll('.tool-step > .tc-header'))
      ].filter(Boolean);
      const rowLeftEdges = rowSummaries
        .map(element => Math.round(element.getBoundingClientRect().left * 10) / 10);
      const recoveredTimeline = collectTimelineFromDom(groupedEl.querySelector('.msg-body'));
      const groupedState = {
        thinkingCount: groupedEl.querySelectorAll('.thinking-block').length,
        groupCount: groupedEl.querySelectorAll('.tool-activity-group').length,
        callCount: groupedEl.querySelectorAll('.tool-step').length,
        collapsedBeforeClick,
        expandedAfterClick: grouped?.open === true,
        summary: grouped?.querySelector('.tool-activity-label')?.textContent,
        statusCount: groupedSummary?.querySelectorAll('.tool-state-shine').length,
        outerLabelColor: getComputedStyle(grouped?.querySelector('.tool-activity-label')).color,
        outerIconColor: getComputedStyle(grouped?.querySelector('.tool-activity-icon')).color,
        parallelLabelColor: getComputedStyle(grouped?.querySelector('.tool-parallel-label')).color,
        innerLabelColor: getComputedStyle(grouped?.querySelector('.tool-step .tc-name')).color,
        skillColor,
        parallelLabels,
        parallelCounts: Array.from(groupedEl.querySelectorAll('.tool-parallel-group'))
          .map(element => Number(element.dataset.parallelCount)),
        readIcons: Array.from(groupedEl.querySelectorAll('.tool-step[data-tool="read"] .tc-icon-svg'))
          .map(element => element.dataset.icon),
        readLabels: Array.from(groupedEl.querySelectorAll('.tool-step[data-tool="read"] .tc-name'))
          .map(element => element.textContent),
        browserLabels: Array.from(groupedEl.querySelectorAll('.tool-step[data-tool^="yan_browser_"] .tc-name'))
          .map(element => element.textContent),
        browserIcons: Array.from(groupedEl.querySelectorAll('.tool-step[data-tool^="yan_browser_"] .tc-icon-svg'))
          .map(element => element.dataset.icon),
        recoveredCalls: recoveredTimeline.filter(item => item.type === 'tool_call').map(item => item.callId),
        recoveredResults: recoveredTimeline.filter(item => item.type === 'tool_result').map(item => item.callId),
        chevronCount: groupedEl.querySelectorAll('.tool-row-chevron').length,
        rowLeftEdges,
        fontWeights: [
          groupedEl.querySelector('.tool-activity-label'),
          groupedEl.querySelector('.tool-parallel-label'),
          groupedEl.querySelector('.tool-step .tc-name')
        ].map(element => Number(getComputedStyle(element).fontWeight)),
        legacyBadgeCount: groupedEl.querySelectorAll('.tc-badge').length
      };

      const sequentialEl = appendMessage('assistant', '');
      renderAgentRunBody(sequentialEl.querySelector('.msg-body'), {
        runId: 'sequential-tools',
        status: 'completed',
        timeline: [
          { type: 'thinking', content: '顺序读取。' },
          { type: 'tool_call', callId: 'seq-a', name: 'read', args: { path: 'a.txt' } },
          { type: 'tool_result', callId: 'seq-a', name: 'read', output: 'a', ok: true },
          { type: 'tool_call', callId: 'seq-b', name: 'read', args: { path: 'b.txt' } },
          { type: 'tool_result', callId: 'seq-b', name: 'read', output: 'b', ok: true },
          { type: 'thinking', content: '完成。' }
        ]
      });
      const sequential = {
        summary: sequentialEl.querySelector('.tool-activity-label')?.textContent,
        parallelCount: sequentialEl.querySelectorAll('.tool-parallel-group').length,
        leafLabels: Array.from(sequentialEl.querySelectorAll('.tool-step .tc-name'))
          .map(element => element.textContent)
      };

      const originalSessions = state.sessions;
      const originalCollapsedWorkspaceGroups = new Set(collapsedWorkspaceGroups);
      const folderOpenWorkspace = 'C:\\e2e-workspace-open';
      const folderClosedWorkspace = 'C:\\e2e-workspace-closed';
      state.sessions = [
        { id: 'folder-open-session', title: 'Open folder', workspace: folderOpenWorkspace, updatedAt: 2, pinned: false },
        { id: 'folder-closed-session', title: 'Closed folder', workspace: folderClosedWorkspace, updatedAt: 1, pinned: false }
      ];
      collapsedWorkspaceGroups.clear();
      collapsedWorkspaceGroups.add(workspaceGroupKey(folderClosedWorkspace));
      renderSessionList();
      const sidebarFolders = {
        chevronCount: document.querySelectorAll('#sessionList .workspace-toggle-chevron').length,
        states: Array.from(document.querySelectorAll('#sessionList .workspace-icon'))
          .map(element => ({
            state: element.dataset.workspaceFolderState,
            strokeWidth: element.querySelector('svg')?.getAttribute('stroke-width'),
            path: element.querySelector('svg path')?.getAttribute('d')
          }))
      };
      state.sessions = originalSessions;
      collapsedWorkspaceGroups.clear();
      originalCollapsedWorkspaceGroups.forEach(key => collapsedWorkspaceGroups.add(key));
      renderSessionList();

      const mixedRunningEl = appendMessage('assistant', '');
      const mixedRunningTimeline = [
        { type: 'thinking', content: '先后执行工具。' },
        { type: 'tool_call', callId: 'mixed-bash-1', name: 'bash', args: { command: 'echo one' } },
        { type: 'tool_result', callId: 'mixed-bash-1', name: 'bash', output: 'one', ok: true },
        { type: 'tool_call', callId: 'mixed-bash-2', name: 'bash', args: { command: 'echo two' } },
        { type: 'tool_call', callId: 'mixed-write', name: 'write', args: { path: 'mixed.txt', content: 'two' } }
      ];
      renderAgentRunBody(mixedRunningEl.querySelector('.msg-body'), {
        runId: 'mixed-running-tools',
        status: 'working',
        timeline: mixedRunningTimeline
      });
      const mixedRunningGroup = mixedRunningEl.querySelector('.tool-activity-group');
      const mixedRunning = {
        labelMode: mixedRunningGroup?.dataset.toolLabelMode,
        summary: mixedRunningGroup?.querySelector('.tool-activity-label')?.textContent,
        labelClass: mixedRunningGroup?.querySelector('.tool-activity-label')?.className,
        parallelLabels: Array.from(mixedRunningGroup?.querySelectorAll('.tool-parallel-label') || [])
          .map(element => element.textContent),
        stepLabels: Array.from(mixedRunningGroup?.querySelectorAll('.tool-step .tc-name') || [])
          .map(element => element.textContent)
      };
      renderAgentRunBody(mixedRunningEl.querySelector('.msg-body'), {
        runId: 'mixed-running-tools',
        status: 'completed',
        timeline: mixedRunningTimeline.concat([
          { type: 'tool_result', callId: 'mixed-bash-2', name: 'bash', output: 'two', ok: true },
          { type: 'tool_result', callId: 'mixed-write', name: 'write', output: 'ok', ok: true }
        ])
      });
      const mixedCompletedGroup = mixedRunningEl.querySelector('.tool-activity-group');
      const mixedCompleted = {
        labelMode: mixedCompletedGroup?.dataset.toolLabelMode,
        summary: mixedCompletedGroup?.querySelector('.tool-activity-label')?.textContent,
        labelClass: mixedCompletedGroup?.querySelector('.tool-activity-label')?.className
      };
      mixedRunningEl.remove();

      const terminalStates = {};
      const terminalLabelColors = {};
      for (const fixture of [
        { key: 'failure', status: 'error', result: { output: 'permission denied', ok: false } },
        { key: 'interrupted', status: 'interrupted', result: { output: 'cancelled', ok: false, interrupted: true } },
        { key: 'interruptedUnresolved', status: 'interrupted', result: null }
      ]) {
        const element = appendMessage('assistant', '');
        const timeline = [
          { type: 'tool_call', callId: fixture.key, name: 'bash', args: { command: 'echo test' } }
        ];
        if (fixture.result) {
          timeline.push({ type: 'tool_result', callId: fixture.key, name: 'bash', ...fixture.result });
        }
        renderAgentRunBody(element.querySelector('.msg-body'), {
          runId: fixture.key,
          status: fixture.status,
          timeline
        });
        await openDetails(element);
        const terminalGroupLabel = element.querySelector('.tool-activity-summary .tool-activity-label');
        const terminalStepLabel = element.querySelector('.tool-step .tc-name');
        const terminalStatus = element.querySelector('.tool-command-status');
        terminalStates[fixture.key] = {
          group: terminalGroupLabel?.textContent,
          step: terminalStepLabel?.textContent,
          status: terminalStatus?.textContent.trim() || '',
          standaloneStateCount: element.querySelectorAll('.tool-activity-summary > .tool-state-shine:not(.tool-activity-label), .tool-step .tc-header > .tool-state-shine:not(.tc-name)').length
        };
        terminalLabelColors[fixture.key] = {
          group: terminalGroupLabel ? getComputedStyle(terminalGroupLabel).color : '',
          step: terminalStepLabel ? getComputedStyle(terminalStepLabel).color : '',
          status: terminalStatus ? getComputedStyle(terminalStatus).color : '',
          groupClass: terminalGroupLabel?.className || '',
          stepClass: terminalStepLabel?.className || ''
        };
        element.remove();
      }

      const commandEl = appendMessage('assistant', '');
      renderAgentRunBody(commandEl.querySelector('.msg-body'), {
        runId: 'command-tools',
        status: 'completed',
        timeline: [
          { type: 'thinking', content: '运行命令。' },
          { type: 'tool_call', callId: 'command-ok', name: 'bash', args: { command: 'Write-Output hello' } },
          { type: 'tool_result', callId: 'command-ok', name: 'bash', output: JSON.stringify({ ok: true, output: 'hello', meta: { exitCode: 0, shell: 'powershell' } }), ok: true }
        ]
      });
      await openDetails(commandEl);
      const commandPanel = commandEl.querySelector('.tool-command-panel');
      const commandCopyButtons = commandPanel ? Array.from(commandPanel.querySelectorAll('.tool-command-copy')) : [];
      const commandCopyIdleOpacity = commandCopyButtons.map(button => getComputedStyle(button).opacity);
      const commandOutput = commandPanel?.querySelector('.tool-command-output')?.textContent;
      const commandValue = commandPanel?.querySelector('.tool-command-value')?.textContent;
      const command = {
        panelCount: commandEl.querySelectorAll('.tool-command-panel').length,
        runtime: commandPanel?.querySelector('.tool-command-runtime')?.textContent,
        command: commandValue,
        output: commandOutput,
        status: commandPanel?.querySelector('.tool-command-status')?.textContent.trim(),
        exitCode: commandPanel?.dataset.exitCode || '',
        copyCount: commandCopyButtons.length,
        copyIdleOpacity: commandCopyIdleOpacity,
        copyTargetNames: commandCopyButtons.map(button => button.dataset.copyTarget),
        commandName: commandEl.querySelector('.tool-step .tc-name')?.textContent,
        commandNameShine: commandEl.querySelector('.tool-step .tc-name')?.classList.contains('tool-state-shine') || false
      };

      const genericEl = appendMessage('assistant', '');
      renderAgentRunBody(genericEl.querySelector('.msg-body'), {
        runId: 'generic-tool-panels',
        status: 'completed',
        timeline: [
          { type: 'thinking', content: '读取并写入文件。' },
          { type: 'tool_call', callId: 'generic-read', name: 'read', args: { path: 'README.md' } },
          { type: 'tool_result', callId: 'generic-read', name: 'read', output: 'hello\nworld', ok: true },
          { type: 'tool_call', callId: 'generic-write', name: 'write', args: { path: 'out.txt', content: 'hello' } },
          { type: 'tool_result', callId: 'generic-write', name: 'write', output: 'ok', ok: true },
          { type: 'tool_call', callId: 'generic-grep', name: 'grep', args: { pattern: 'hello', path: '.' } },
          { type: 'tool_result', callId: 'generic-grep', name: 'grep', output: 'README.md:1:hello', ok: true }
        ]
      });
      await openDetails(genericEl);
      const genericPanels = Array.from(genericEl.querySelectorAll('.tool-result-panel'));
      const genericPanel = genericPanels[0];
      const genericOutput = genericPanel?.querySelector('.tool-result-output');
      const genericInput = genericPanel?.querySelector('.tool-result-input');
      const genericFooter = genericPanel?.querySelector('.tool-result-footer');
      const genericOutputStyle = genericOutput ? getComputedStyle(genericOutput) : null;
      const genericFooterStyle = genericFooter ? getComputedStyle(genericFooter) : null;
      const genericFooterRect = genericFooter?.getBoundingClientRect();
      const genericStatusRect = genericFooter?.querySelector('.tool-panel-status')?.getBoundingClientRect();
      const generic = {
        panelCount: genericPanels.length,
        commandPanelCount: genericEl.querySelectorAll('.tool-command-panel').length,
        runtimes: genericPanels.map(panel => panel.querySelector('.tool-result-runtime')?.textContent.trim()),
        inputs: genericPanels.map(panel => panel.querySelector('.tool-result-input')?.textContent.trim()),
        outputs: genericPanels.map(panel => panel.querySelector('.tool-result-output')?.textContent.trim()),
        statuses: genericPanels.map(panel => panel.querySelector('.tool-panel-status')?.textContent.trim()),
        copyTargets: Array.from(genericEl.querySelectorAll('.tool-result-copy')).map(button => button.dataset.copyTarget),
        hasLegacyArgs: genericEl.querySelectorAll('.tc-args-block').length > 0,
        hasLegacyResult: genericEl.querySelectorAll('.tc-result').length > 0,
        outputOverflowX: genericOutputStyle?.overflowX,
        outputOverflowY: genericOutputStyle?.overflowY,
        outputWhiteSpace: genericOutputStyle?.whiteSpace,
        footerJustifyContent: genericFooterStyle?.justifyContent,
        statusRightAligned: !!genericStatusRect && !!genericFooterRect && genericStatusRect.right >= genericFooterRect.right - (Number.parseFloat(genericFooterStyle?.paddingRight) || 0) - 1,
        firstInput: genericInput?.textContent.trim() || ''
      };

      const runningGenericEl = appendMessage('assistant', '');
      renderAgentRunBody(runningGenericEl.querySelector('.msg-body'), {
        runId: 'running-generic-tool',
        status: 'working',
        timeline: [
          { type: 'tool_call', callId: 'running-generic-tool', name: 'read', args: { path: 'pending.txt' } }
        ]
      });
      await openDetails(runningGenericEl);
      const runningGenericStep = runningGenericEl.querySelector('.tool-step');
      const runningGenericPanel = runningGenericStep?.querySelector('.tool-result-panel');
      const runningGeneric = {
        panelState: runningGenericPanel?.dataset.toolState,
        status: runningGenericPanel?.querySelector('.tool-panel-status')?.textContent.trim() || '',
        ariaLabel: runningGenericPanel?.querySelector('.tool-panel-status')?.getAttribute('aria-label') || ''
      };
      cancelToolStepElement(runningGenericStep);
      const cancelledGeneric = {
        stepState: runningGenericStep?.dataset.toolState,
        panelState: runningGenericPanel?.dataset.toolState,
        status: runningGenericPanel?.querySelector('.tool-panel-status')?.textContent.trim() || ''
      };
      runningGenericEl.remove();

      const genericErrorEl = appendMessage('assistant', '');
      renderAgentRunBody(genericErrorEl.querySelector('.msg-body'), {
        runId: 'generic-tool-error',
        status: 'completed',
        timeline: [
          { type: 'tool_call', callId: 'generic-tool-error', name: 'grep', args: { pattern: 'missing' } },
          { type: 'tool_result', callId: 'generic-tool-error', name: 'grep', output: JSON.stringify({ error: 'not found' }) }
        ]
      });
      const genericError = {
        stepState: genericErrorEl.querySelector('.tool-step')?.dataset.toolState,
        panelState: genericErrorEl.querySelector('.tool-result-panel')?.dataset.toolState,
        status: genericErrorEl.querySelector('.tool-panel-status')?.textContent.trim() || ''
      };
      genericErrorEl.remove();
      genericEl.dataset.e2eFixture = 'generic-tool-panel';

      const commandOverflow = (() => {
        const group = commandEl.querySelector('.tool-activity-group');
        const step = commandEl.querySelector('.tool-step');
        const outputEl = commandPanel?.querySelector('.tool-command-output');
        const commandValueEl = commandPanel?.querySelector('.tool-command-value');
        const commandBlockEl = commandPanel?.querySelector('.tool-command-command-block');
        const outputBlockEl = commandPanel?.querySelector('.tool-command-output-block');
        const footerEl = commandPanel?.querySelector('.tool-command-footer');
        if (!group || !step || !outputEl || !commandValueEl || !commandBlockEl || !outputBlockEl || !footerEl) return null;
        group.open = true;
        step.open = true;
        const originalOutput = outputEl.textContent;
        const originalCommand = commandValueEl.textContent;
        outputEl.textContent = Array.from({ length: 80 }, (_, index) =>
          `${String(index + 1).padStart(2, '0')} ${'x'.repeat(320)}`
        ).join('\n');
        commandValueEl.textContent = 'x'.repeat(320);
        const outputStyle = getComputedStyle(outputEl);
        const commandBlockStyle = getComputedStyle(commandBlockEl);
        const outputBlockStyle = getComputedStyle(outputBlockEl);
        const panelStyle = getComputedStyle(commandPanel);
        const footerStyle = getComputedStyle(footerEl);
        const footerRect = footerEl.getBoundingClientRect();
        const statusRect = footerEl.querySelector('.tool-command-status')?.getBoundingClientRect();
        const footerRightInset = Number.parseFloat(footerStyle.paddingRight) || 0;
        const result = {
          overflowX: outputStyle.overflowX,
          overflowY: outputStyle.overflowY,
          whiteSpace: outputStyle.whiteSpace,
          hasPanelBorder: Number.parseFloat(panelStyle.borderTopWidth) > 0,
          outputBorderTop: outputBlockStyle.borderTopWidth,
          footerBorderTop: footerStyle.borderTopWidth,
          commandPaddingBottom: commandBlockStyle.paddingBottom,
          outputPaddingTop: outputBlockStyle.paddingTop,
          hasHorizontalOverflow: outputEl.scrollWidth > outputEl.clientWidth + 1,
          hasVerticalOverflow: outputEl.scrollHeight > outputEl.clientHeight + 1,
          footerJustifyContent: footerStyle.justifyContent,
          statusRightAligned: !!statusRect && statusRect.right >= footerRect.right - footerRightInset - 1
        };
        outputEl.textContent = originalOutput;
        commandValueEl.textContent = originalCommand;
        return result;
      })();
      commandEl.querySelector('.tool-activity-group').open = true;
      commandEl.dataset.e2eFixture = 'command-panel';

      const commandErrorStates = [];
      for (const [key, output] of [
        ['plain-error', 'Error: command failed'],
        ['structured-error', JSON.stringify({ error: 'permission denied' })]
      ]) {
        const element = appendMessage('assistant', '');
        renderAgentRunBody(element.querySelector('.msg-body'), {
          runId: key,
          status: 'completed',
          timeline: [
            { type: 'tool_call', callId: key, name: 'bash', args: { command: 'echo test' } },
            { type: 'tool_result', callId: key, name: 'bash', output }
          ]
        });
        commandErrorStates.push({
          key,
          stepState: element.querySelector('.tool-step')?.dataset.toolState,
          panelState: element.querySelector('.tool-command-panel')?.dataset.commandState,
          status: element.querySelector('.tool-command-status')?.textContent.trim()
        });
        element.remove();
      }

      const abortCommandEl = appendMessage('assistant', '');
      renderAgentRunBody(abortCommandEl.querySelector('.msg-body'), {
        runId: 'abort-command',
        status: 'working',
        timeline: [
          { type: 'tool_call', callId: 'abort-command', name: 'bash', args: { command: 'Get-Process' } }
        ]
      });
      const abortCommandStep = abortCommandEl.querySelector('.tool-step');
      cancelToolStepElement(abortCommandStep);
      await openDetails(abortCommandEl);
      const abortCommand = {
        stepState: abortCommandStep?.dataset.toolState,
        panelState: abortCommandStep?.querySelector('.tool-command-panel')?.dataset.commandState,
        status: abortCommandStep?.querySelector('.tool-command-status')?.textContent.trim()
      };
      abortCommandEl.remove();

      const iconCases = [
        ['read', 'file-text'],
        ['glob', 'file-arrow-left'],
        ['grep', 'file-arrow-up'],
        ['write', 'pen-line'],
        ['edit', 'circle-pen'],
        ['apply_patch', 'square-pen'],
        ['bash', 'terminal'],
        ['webfetch', 'globe-plus'],
        ['websearch', 'globe'],
        ['question', 'message-plus'],
        ['todowrite', 'circle-more-horizontal'],
        ['task', 'square-more-horizontal'],
        ['yan_skills_find_skills', 'eye'],
        ['yan_skills_install_skill', 'download'],
        ['yan_skills_list_installed_skills', 'filter'],
        ['yan_skills_read_skill_resource', 'file'],
        ['yan_skills_remove_skill', 'bin'],
        ['yan_media_read_image', 'image-check'],
        ['mcp__yan_media__generate_image', 'image-plus'],
        ['yan_media_generate_video', 'list-video'],
        ['yan_browser_browser_click', 'globe-cursor'],
        ['yan_session_create_handoff', 'folder-arrow-left'],
        ['yan_session_read_source_context', 'folder-arrow-up'],
        ['mcp_default_serena_find_symbol', 'file-check'],
        ['mcp_default_codegraph_codegraph_explore', 'folder-check'],
        ['mcp_default_playwright_browser_click', 'terminal-cursor'],
        ['yan_harness_schedule_refinement', 'sliders-horizontal'],
        ['mcp__custom_server__custom_action', 'monitor'],
        ['unknown_native_tool', 'square-more-horizontal']
      ].map(([tool, expected]) => ({
        tool,
        expected,
        actual: resolveToolUi(tool, {}).iconKey
      }));
      const iconCatalog = {
        count: Object.keys(TOOL_ICON_SVG).length,
        invalid: Object.entries(TOOL_ICON_SVG)
          .filter(([name, svg]) => {
            const required = [
              'stroke-linecap="round"',
              'stroke-linejoin="round"'
            ];
            if (name === 'badge-check') required.push('stroke-width="2"');
            else required.push('stroke-width="1.5"');
            return !required.every(attribute => svg.includes(attribute));
          })
          .map(([name]) => name)
      };
      const displayNameCases = [
        ['read', 'read'],
        ['write', 'write'],
        ['bash', 'bash'],
        ['yan_browser_browser_click', 'Yan-builtin-browser-Control'],
        ['mcp_default_serena_find_symbol', 'Yan-Serena-MCP'],
        ['mcp_default_codegraph_codegraph_explore', 'Yan-CodeGraph-MCP'],
        ['mcp_default_playwright_browser_click', 'Yan-Playwright-MCP'],
        ['yan_harness_schedule_refinement', 'Yan-Continual-Harness']
      ].map(([tool, expected]) => ({ tool, expected, actual: getToolDisplayName(tool) }));

      state.activeRuns.delete(session.id);
      assistantEl.remove();
      sequentialEl.remove();
      return {
        running,
        thinking,
        runningColors,
        runningCommand,
        completed,
        groupedState,
        sequential,
        compressionRunning,
        compressionCompleted,
        relayRunning,
        relayCompleted,
        policyAcceptance,
        reconnectRunning,
        reconnectExpanded,
        reconnectUpdated,
        reconnectCleared,
        reconnectReset,
        sidebarFolders,
        mixedRunning,
        mixedCompleted,
        terminalStates,
        terminalLabelColors,
        command,
        generic,
        runningGeneric,
        cancelledGeneric,
        genericError,
        commandOverflow,
        commandErrorStates,
        abortCommand,
        iconCases,
        iconCatalog,
        displayNameCases
      };
    });

    assert.deepEqual(states.running, {
      groupCount: 1,
      groupClosed: true,
      groupLabelMode: 'inner',
      groupState: 'write index.html',
      stepExists: true,
      stepState: 'write',
      summary: 'write index.html',
      stepLabel: 'write',
      stepPreview: 'index.html',
      icon: 'pen-line',
      shineAnimation: 'toolStateShine',
      shineIterations: 'infinite',
      groupShineAttached: true,
      stepShineAttached: true,
      groupInnerLabelClass: 'tool-activity-label tool-activity-inner-label tool-state-shine',
      standaloneStateCount: 0,
      chevronCount: 0,
      legacyBadgeCount: 0
    });
    assert.deepEqual(states.thinking, {
      label: '深度求索中……',
      completedLabel: '思考',
      englishLabel: 'Deep Diving……',
      variant: 'G2',
      dotCount: 40,
      animationName: 'orb-globe-spin',
      animationDuration: '3.6s',
      hasKeyframes: true
    });
    assert.notEqual(states.runningColors.groupLabel, states.groupedState.skillColor);
    assert.notEqual(states.runningColors.groupIcon, states.groupedState.skillColor);
    assert.notEqual(states.runningColors.stepLabel, states.groupedState.skillColor);
    assert.deepEqual(states.runningCommand, {
      visibleText: '',
      ariaLabel: '执行中',
      panelState: 'running'
    });
    assert.match(states.completed.groupLabel, /^已写入文件 · \d+秒$/u);
    const completedWithoutDuration = { ...states.completed };
    delete completedWithoutDuration.groupLabel;
    assert.deepEqual(completedWithoutDuration, {
      groupStateCount: 0,
      stepStateCount: 0,
      groupLabelMode: 'outer',
      groupOuterLabelClass: 'tool-activity-label tool-activity-outer-label',
      groupOuterLabelShine: false,
      stepLabel: 'write',
      toolNameShine: false,
      runningClass: false,
      completedClass: true,
      legacyBadgeCount: 0
    });
    assert.deepEqual(states.compressionRunning, {
      text: '正在压缩上下文……',
      state: 'agent-progress-note context-compression-note is-running',
      iconCount: 1,
      iconStrokeWidth: '1.5',
      iconPath: 'M8 9H12M8 13H16M4 5C4 3.34315 5.34315 2 7 2H17C18.6569 2 20 3.34315 20 5V20L16 22L12 20L8 22L4 20V5Z'
    });
    assert.deepEqual(states.compressionCompleted, {
      text: '上下文压缩已完成',
      state: 'agent-progress-note context-compression-note is-completed',
      iconCount: 1,
      iconStrokeWidth: '1.5',
      iconPath: 'M8 9H12M8 13H16M4 5C4 3.34315 5.34315 2 7 2H17C18.6569 2 20 3.34315 20 5V20L16 22L12 20L8 22L4 20V5Z'
    });
    assert.deepEqual(states.relayRunning, {
      text: '视觉中继正使用模型GLM-4.6V-Flash读取你上传的图像',
      state: 'agent-progress-note vision-relay-note is-running',
      iconCount: 1,
      iconStrokeWidth: '1.5',
      iconPath: 'M3 8V18C3 19.6569 4.3431 21 6 21H16'
    });
    assert.deepEqual(states.relayCompleted, {
      text: '视觉中继已使用模型GLM-4.6V-Flash完成图像读取，正转交主模型中',
      state: 'agent-progress-note vision-relay-note is-completed',
      iconCount: 1,
      iconStrokeWidth: '1.5',
      iconPath: 'M3 8V18C3 19.6569 4.3431 21 6 21H16'
    });
    assert.deepEqual(states.reconnectRunning, {
      tagName: 'DETAILS',
      text: '正在重新连接 1/5……',
      iconCount: 1,
      iconStrokeWidth: '1.5',
      collapsed: true,
      detail: 'stream disconnected before completion: network error: connection reset',
      detailHidden: true
    });
    assert.deepEqual(states.reconnectExpanded, {
      open: true,
      detail: 'stream disconnected before completion: network error: connection reset'
    });
    assert.deepEqual(states.reconnectUpdated, {
      text: '正在重新连接 3/5……',
      detail: 'stream disconnected before completion: network error: second attempt',
      stillOpen: true
    });
    assert.equal(states.reconnectCleared, true);
    assert.equal(states.reconnectReset, '正在重新连接 1/5……');
    assert.deepEqual(states.sidebarFolders, {
      chevronCount: 0,
      states: [
        {
          state: 'open',
          strokeWidth: '1.5',
          path: 'M6 15L7.4472 12.1056C7.786 11.428 8.4785 11 9.2361 11L19.9978 11C21.4451 11 22.4132 12.4897 21.8254 13.8123L19.6032 18.8123C19.2822 19.5345 18.5659 20 17.7756 20L4 20C2.8954 20 2 19.1046 2 18L2 6C2 4.8954 2.8954 4 4 4L7.3787 4C7.7765 4 8.158 4.158 8.4393 4.4393L9.5607 5.5607C9.842 5.842 10.2235 6 10.6213 6L17 6C18.1046 6 19 6.8954 19 8L19 11'
        },
        {
          state: 'closed',
          strokeWidth: '1.5',
          path: 'M3 7C3 5.3431 4.3431 4 6 4L8.6716 4C9.202 4 9.7107 4.2107 10.0858 4.5858L11.4142 5.9142C11.7893 6.2893 12.298 6.5 12.8284 6.5L18 6.5C19.6569 6.5 21 7.8431 21 9.5L21 17C21 18.6569 19.6569 20 18 20L6 20C4.3431 20 3 18.6569 3 17Z'
        }
      ]
    });
    assert.equal(states.groupedState.thinkingCount, 2);
    assert.equal(states.groupedState.groupCount, 1);
    assert.equal(states.groupedState.callCount, 4);
    assert.equal(states.groupedState.collapsedBeforeClick, true);
    assert.equal(states.groupedState.expandedAfterClick, true);
    assert.equal(states.groupedState.summary, '已读取文件、已使用 Yan 内置浏览器');
    assert.doesNotMatch(states.groupedState.summary, /并行|\d+次/);
    assert.equal(states.groupedState.statusCount, 0);
    assert.equal(states.groupedState.outerLabelColor, states.groupedState.skillColor);
    assert.equal(states.groupedState.outerIconColor, states.groupedState.skillColor);
    assert.notEqual(states.groupedState.parallelLabelColor, states.groupedState.skillColor);
    assert.notEqual(states.groupedState.innerLabelColor, states.groupedState.skillColor);
    assert.deepEqual(states.groupedState.parallelLabels, [
      'read（并行·2）',
      'Yan-builtin-browser-Control（并行·2）'
    ]);
    assert.deepEqual(states.groupedState.parallelCounts, [2, 2]);
    assert.deepEqual(states.groupedState.readIcons, ['file-text', 'file-text']);
    assert.deepEqual(states.groupedState.readLabels, ['read', 'read']);
    assert.deepEqual(states.groupedState.browserLabels, [
      'Yan-builtin-browser-Control',
      'Yan-builtin-browser-Control'
    ]);
    assert.deepEqual(states.groupedState.browserIcons, ['globe-cursor', 'globe-cursor']);
    assert.deepEqual(states.groupedState.recoveredCalls, ['read-a', 'read-b', 'browser-a', 'browser-b']);
    assert.deepEqual(states.groupedState.recoveredResults, ['read-a', 'read-b', 'browser-a', 'browser-b']);
    assert.equal(states.groupedState.chevronCount, 0);
    assert.equal(new Set(states.groupedState.rowLeftEdges).size, 1);
    assert.equal(states.groupedState.fontWeights.every(weight => weight <= 500), true);
    assert.equal(states.groupedState.legacyBadgeCount, 0);
    assert.deepEqual(states.sequential, {
      summary: '已读取文件',
      parallelCount: 0,
      leafLabels: ['read', 'read']
    });
    assert.deepEqual(states.mixedRunning, {
      labelMode: 'inner',
      summary: 'bash echo one bash echo two write mixed.txt',
      labelClass: 'tool-activity-label tool-activity-inner-label tool-state-shine',
      parallelLabels: [],
      stepLabels: ['bash', 'bash', 'write']
    });
    assert.match(states.mixedCompleted.summary, /^已执行命令、已写入文件 · \d+秒$/u);
    const mixedCompletedWithoutDuration = { ...states.mixedCompleted };
    delete mixedCompletedWithoutDuration.summary;
    assert.deepEqual(mixedCompletedWithoutDuration, {
      labelMode: 'outer',
      labelClass: 'tool-activity-label tool-activity-outer-label'
    });
    assert.deepEqual(states.terminalStates, {
      failure: { group: '已执行命令', step: 'bash', status: '× 退出码 1', standaloneStateCount: 0 },
      interrupted: { group: '已执行命令', step: 'bash', status: '× 已中断', standaloneStateCount: 0 },
      interruptedUnresolved: { group: '已执行命令', step: 'bash', status: '× 已中断', standaloneStateCount: 0 }
    });
    for (const key of ['failure', 'interrupted', 'interruptedUnresolved']) {
      assert.equal(states.terminalLabelColors[key].groupClass, 'tool-activity-label tool-activity-outer-label');
      assert.equal(states.terminalLabelColors[key].stepClass, 'tc-name');
      assert.equal(states.terminalLabelColors[key].group, states.groupedState.skillColor);
      assert.notEqual(states.terminalLabelColors[key].step, states.groupedState.skillColor);
      assert.equal(states.terminalLabelColors[key].status, 'rgb(168, 168, 168)');
    }
    assert.deepEqual(states.command, {
      panelCount: 1,
      runtime: 'PowerShell',
      command: 'Write-Output hello',
      output: 'hello',
      status: '√ 成功',
      exitCode: '0',
      copyCount: 2,
      copyIdleOpacity: ['0', '0'],
      copyTargetNames: ['command', 'output'],
      commandName: 'bash',
      commandNameShine: false
    });
    assert.deepEqual(states.generic, {
      panelCount: 3,
      commandPanelCount: 0,
      runtimes: ['read', 'write', 'grep'],
      inputs: ['path: README.md', 'path: out.txt\ncontent: hello', 'pattern: hello\npath: .'],
      outputs: ['hello\nworld', 'ok', 'README.md:1:hello'],
      statuses: ['√ 成功', '√ 成功', '√ 成功'],
      copyTargets: ['input', 'output', 'input', 'output', 'input', 'output'],
      hasLegacyArgs: false,
      hasLegacyResult: false,
      outputOverflowX: 'auto',
      outputOverflowY: 'auto',
      outputWhiteSpace: 'pre',
      footerJustifyContent: 'flex-end',
      statusRightAligned: true,
      firstInput: 'path: README.md'
    });
    assert.deepEqual(states.runningGeneric, {
      panelState: 'running',
      status: '',
      ariaLabel: '执行中'
    });
    assert.deepEqual(states.cancelledGeneric, {
      stepState: 'interrupted',
      panelState: 'interrupted',
      status: '× 已中断'
    });
    assert.deepEqual(states.genericError, {
      stepState: 'error',
      panelState: 'error',
      status: '× 错误'
    });
    assert.deepEqual(states.commandOverflow, {
      overflowX: 'auto',
      overflowY: 'auto',
      whiteSpace: 'pre',
      hasPanelBorder: true,
      outputBorderTop: '0px',
      footerBorderTop: '0px',
      commandPaddingBottom: '0px',
      outputPaddingTop: '0px',
      hasHorizontalOverflow: true,
      hasVerticalOverflow: true,
      footerJustifyContent: 'flex-end',
      statusRightAligned: true
    });
    assert.deepEqual(states.commandErrorStates, [
      { key: 'plain-error', stepState: 'error', panelState: 'error', status: '× 退出码 1' },
      { key: 'structured-error', stepState: 'error', panelState: 'error', status: '× 退出码 1' }
    ]);
    assert.deepEqual(states.abortCommand, {
      stepState: 'interrupted',
      panelState: 'interrupted',
      status: '× 已中断'
    });
    for (const iconCase of states.iconCases) {
      assert.equal(iconCase.actual, iconCase.expected, iconCase.tool);
    }
    assert.deepEqual(states.policyAcceptance, {
      callCount: 1,
      resultCount: 1,
      textCount: 0,
      label: '策略验收',
      icon: 'badge-check',
      state: 'completed',
      ok: 'true'
    });
    assert.deepEqual(states.iconCatalog, { count: 31, invalid: [] });
    for (const displayNameCase of states.displayNameCases) {
      assert.equal(displayNameCase.actual, displayNameCase.expected, displayNameCase.tool);
    }

    fs.mkdirSync(screenshotDir, { recursive: true });
    const visualGroup = page.locator('[data-e2e-fixture="tool-activity"]');
    const commandPanelVisual = page.locator('[data-e2e-fixture="command-panel"] .tool-command-panel');
    const genericPanelVisual = page.locator('[data-e2e-fixture="generic-tool-panel"] .tool-result-panel').first();
    await page.setViewportSize({ width: 1100, height: 720 });
    await visualGroup.evaluate(group => { group.closest('.msg').style.width = '720px'; });
    await page.evaluate(() => applyTheme('dark'));
    await visualGroup.scrollIntoViewIfNeeded();
    await visualGroup.screenshot({ path: expandedDarkScreenshotPath });
    await commandPanelVisual.evaluate(panel => {
      panel.closest('.tool-activity-group')?.setAttribute('open', '');
      panel.closest('.tool-step')?.setAttribute('open', '');
    });
    await commandPanelVisual.screenshot({ path: commandPanelScreenshotPath });
    await genericPanelVisual.evaluate(panel => {
      panel.closest('.tool-activity-group')?.setAttribute('open', '');
      panel.closest('.tool-step')?.setAttribute('open', '');
    });
    await genericPanelVisual.screenshot({ path: genericPanelScreenshotPath });

    const responsiveLayouts = [];
    for (const availableWidth of [320, 375, 414, 768]) {
      await visualGroup.evaluate((group, width) => { group.closest('.msg').style.width = `${width}px`; }, availableWidth);
      await visualGroup.scrollIntoViewIfNeeded();
      responsiveLayouts.push(await visualGroup.evaluate((group, width) => {
        const groupRect = group.getBoundingClientRect();
        const rows = Array.from(group.querySelectorAll('summary'))
          .filter(element => element.getClientRects().length > 0)
          .map(element => {
            const rect = element.getBoundingClientRect();
            return {
              left: rect.left,
              right: rect.right,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth
            };
          });
        return {
          availableWidth: width,
          expectedGroupWidth: width, // work-tab runs track the message width (fullscreen mode has no 720 clamp)
          groupWidth: groupRect.width,
          groupLeft: groupRect.left,
          groupRight: groupRect.right,
          groupOverflow: group.scrollWidth > group.clientWidth + 1,
          rowOverflow: rows.some(row => row.scrollWidth > row.clientWidth + 1),
          rowsOutsideGroup: rows.some(row => row.left < groupRect.left - 1 || row.right > groupRect.right + 1)
        };
      }, availableWidth));
    }
    for (const layout of responsiveLayouts) {
      assert.equal(layout.groupOverflow, false, JSON.stringify(layout));
      assert.equal(layout.rowOverflow, false, JSON.stringify(layout));
      assert.equal(layout.rowsOutsideGroup, false, JSON.stringify(layout));
      assert.ok(Math.abs(layout.groupWidth - layout.expectedGroupWidth) <= 1, JSON.stringify(layout));
    }

    await visualGroup.evaluate(group => { group.closest('.msg').style.width = '720px'; });
    await visualGroup.locator(':scope > .tool-activity-summary').click();
    await page.evaluate(() => applyTheme('light'));
    await visualGroup.screenshot({ path: collapsedLightScreenshotPath });
    await visualGroup.evaluate(group => group.closest('.msg')?.remove());
    await commandPanelVisual.evaluate(panel => panel.closest('.msg')?.remove());
    await genericPanelVisual.evaluate(panel => panel.closest('.msg')?.remove());

    console.log(JSON.stringify({
      ok: true,
      expandedDarkScreenshotPath,
      collapsedLightScreenshotPath,
      commandPanelScreenshotPath,
      genericPanelScreenshotPath,
      responsiveLayouts
    }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
