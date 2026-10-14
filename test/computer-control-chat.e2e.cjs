'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-control-chat-e2e-'));
const evidenceDir = path.join(appRoot, '.yanagent', 'evidence');

// A recorded control target, exactly as lib/yan-computer-mcp.js attaches it to
// a tool result once a real executable was resolved from the driver PID.
function recordedApp(name, file, id) {
  return JSON.stringify({ computer_control_app: { id, path: file, name, lastUsedAt: 1 } });
}
const music = 'D:\\bodian\\bodian_pc.exe';
const shell = 'C:\\Windows\\System32\\cmd.exe';

function timeline() {
  const call = (callId, name, args = {}) => ({ type: 'tool_call', stage: 'work', callId, name, args });
  const done = (callId, name, output = '{}') => ({ type: 'tool_result', stage: 'work', callId, name, ok: true, output });
  const say = (index, content) => ({ type: 'text', stage: 'work', content, streaming: false, openCodeKey: `say:${index}` });
  return [
    say(1, '先观察当前界面。'),
    call('c1', 'yanp_demo_computer_launch_app', { path: music }),
    done('c1', 'yanp_demo_computer_launch_app', recordedApp('波点音乐', music, 'app-music')),
    say(2, '波点音乐已打开。'),
    call('c2', 'yanp_demo_computer_click', { pid: 10 }),
    done('c2', 'yanp_demo_computer_click', recordedApp('波点音乐', music, 'app-music')),
    // A non computer-control tool during the episode must stay inside the wrapper.
    call('c3', 'bash', { command: 'echo inside-episode' }),
    done('c3', 'bash', 'inside-episode'),
    // A console host is an objective service, never a controlled application.
    call('c4', 'yanp_demo_computer_click', { pid: 20 }),
    done('c4', 'yanp_demo_computer_click', recordedApp('cmd', shell, 'app-cmd')),
    say(3, '正在搜索目标歌曲。'),
    call('c5', 'yanp_demo_computer_end_session', {}),
    done('c5', 'yanp_demo_computer_end_session'),
    // Post-exit work must never be swallowed by the wrapper.
    say(4, '整理本次结果。'),
    { type: 'text', stage: 'summary', content: '已完成，正在播放《牵丝戏》。', streaming: false, openCodeKey: 'summary:result' },
    // The episode cycles: a later control run starts a fresh wrapper.
    call('c6', 'yanp_demo_computer_click', { pid: 10 }),
    done('c6', 'yanp_demo_computer_click', recordedApp('波点音乐', music, 'app-music')),
    say(5, '再次接管波点音乐。'),
    call('c7', 'yanp_demo_computer_end_session', {}),
    done('c7', 'yanp_demo_computer_end_session'),
    say(6, '收尾说明。')
  ];
}

function agentRun() {
  return {
    runId: 'control-chat-run',
    status: 'done',
    summaryStarted: true,
    modelId: 'gpt-5.3',
    timeline: timeline(),
    changeSummary: {
      source: 'opencode',
      count: 1,
      additions: 5,
      deletions: 1,
      files: [{ path: 'src/player.js', additions: 5, deletions: 1, status: 'modified' }]
    }
  };
}

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__ === true);
    await page.waitForFunction(() => (
      typeof state === 'object'
      && typeof newSession === 'function'
      && typeof appendMessage === 'function'
      && typeof renderAgentRunBody === 'function'
      && typeof collectComputerControlApps === 'function'
    ));

    const result = await page.evaluate(run => {
      if (!state.currentSession) newSession();
      state.config = state.config || {};
      state.config.general = { ...(state.config.general || {}), showQuickReview: true };
      setEmptyState(false);
      showMainPage('chat');
      const assistantEl = appendMessage('assistant', '');
      const body = assistantEl.querySelector('.msg-body');
      renderAgentRunBody(body, run, '已完成，正在播放《牵丝戏》。');
      // The work drawer is collapsed for a finished run; expand it so the
      // wrapper can be inspected and captured.
      const header = body.querySelector('.agent-run-header');
      header.dataset.workToggleTouched = 'true';
      header.dataset.workExpanded = 'true';
      renderAgentRunBody(body, run, '已完成，正在播放《牵丝戏》。');

      const activityBody = header.querySelector('.agent-activity-body');
      const groups = Array.from(activityBody.querySelectorAll(':scope > .computer-control-timeline-group'));
      const groupSummaries = groups.map(group => ({
        text: group.textContent,
        toolGroups: group.querySelectorAll('.computer-control-group-body [data-agent-part-type="tool_group"]').length,
        texts: group.querySelectorAll('.computer-control-group-body [data-agent-part-type="text"]').length
      }));
      const summaryOutput = Array.from(activityBody.querySelectorAll('.agent-summary-output'))
        .find(element => element.textContent.includes('已完成，正在播放'));
      const footnote = activityBody.querySelector(':scope > .computer-control-session-apps');
      const reviewCard = activityBody.querySelector(':scope > .run-change-summary');
      const sameScope = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));

      return {
        groupCount: groups.length,
        groupSummaries,
        summaryInsideGroup: !!summaryOutput?.closest('.computer-control-timeline-group'),
        summaryText: summaryOutput?.textContent || '',
        outsideGroupsTopLevelTexts: Array.from(activityBody.children)
          .filter(element => element.dataset.agentPartType === 'text')
          .map(element => element.textContent),
        outsideToolGroups: Array.from(activityBody.children)
          .filter(element => element.dataset.agentPartType === 'tool_group').length,
        footnote: footnote ? {
          isDirectChild: true,
          rows: Array.from(footnote.querySelectorAll('.computer-control-session-app')).map(row => row.textContent),
          hasReviewButton: !!footnote.querySelector('.computer-control-session-app-review'),
          stage: footnote.dataset.agentStage
        } : null,
        reviewCardCount: activityBody.querySelectorAll(':scope > .run-change-summary').length,
        order: {
          summaryBeforeFootnote: sameScope(summaryOutput, footnote),
          footnoteBeforeReview: sameScope(footnote, reviewCard)
        },
        collected: collectComputerControlApps(run).map(app => app.name)
      };
    }, agentRun());

    assert.equal(result.groupCount, 2, 'one wrapper per control episode');
    assert.equal(result.groupSummaries[0].toolGroups, 3, 'episode 1 keeps every tool group, including the non-control one');
    assert.equal(result.outsideToolGroups, 0, 'no unwrapped tool activity survives between the episodes');
    assert.equal(result.groupSummaries[0].texts, 2, 'episode 1 keeps interleaved narration inside');
    assert.match(result.groupSummaries[0].text, /正在搜索目标歌曲。/);
    assert.doesNotMatch(result.groupSummaries[0].text, /已完成，正在播放/);
    assert.doesNotMatch(result.groupSummaries[0].text, /整理本次结果。/);
    assert.equal(result.groupSummaries[1].texts, 1, 'the second episode starts a fresh wrapper');
    assert.match(result.groupSummaries[1].text, /再次接管波点音乐。/);
    assert.doesNotMatch(result.groupSummaries[1].text, /收尾说明。/);

    assert.equal(result.summaryInsideGroup, false, 'the delivered answer is never wrapped');
    assert.match(result.summaryText, /已完成，正在播放《牵丝戏》。/);
    assert.ok(result.outsideGroupsTopLevelTexts.some(text => text.includes('整理本次结果。')), 'post-exit work stays outside');
    assert.ok(result.outsideGroupsTopLevelTexts.some(text => text.includes('收尾说明。')), 'post-exit closing stays outside');

    assert.ok(result.footnote, 'the controlled-application footnote is rendered');
    assert.equal(result.footnote.stage, 'summary');
    assert.equal(result.footnote.hasReviewButton, true, 'reuses the review button');
    assert.equal(result.footnote.rows.length, 1, 'only apps that were actually operated are listed');
    assert.match(result.footnote.rows[0], /操控了 波点音乐/);
    assert.doesNotMatch(result.footnote.rows[0], /cmd/);
    assert.deepEqual(result.collected, ['波点音乐'], 'console hosts and discovery results are excluded');
    assert.equal(result.reviewCardCount, 1, 'the quick-review card is present for the order check');
    assert.equal(result.order.summaryBeforeFootnote, true, 'footnote sits below the answer');
    assert.equal(result.order.footnoteBeforeReview, true, 'footnote sits above the quick-review card');

    const streamingCheck = await page.evaluate(() => {
      const assistant = appendMessage('assistant', '');
      const body = assistant.querySelector('.msg-body');
      const narration = 'QQ 主窗口已定位，读取窗口状态。';
      const items = [
        { type: 'tool_call', stage: 'work', name: 'computer_click', callId: 'live-click', args: {} },
        { type: 'tool_result', stage: 'work', name: 'computer_click', callId: 'live-click', ok: true, output: '{}' },
        { type: 'thinking', stage: 'work', content: 'Observe the window.', summary: narration, summaryStatus: 'ready', streaming: false, openCodeKey: 'live-thinking' },
        { type: 'progress', stage: 'work', variant: 'reasoning-intent', content: narration, openCodeKey: 'live-intent' },
        { type: 'text', stage: 'work', content: '正在读取', streaming: true, openCodeKey: 'live-text' }
      ];
      const run = { runId: 'live-control', status: 'working', timeline: items };
      renderAgentRunBody(body, run, '');
      const group = body.querySelector('.computer-control-timeline-group');
      group.open = true;
      const first = group.querySelector('[data-agent-part-type="tool_group"]');
      first.open = true;
      const text = group.querySelector('[data-agent-part-type="text"]');
      const thinking = group.querySelector('[data-agent-part-type="thinking"]');
      const count = group.textContent.split(narration).length - 1;
      const unchanged = [];
      for (let i = 0; i < 10; i++) {
        run.timeline = items.map(item => item.type === 'text' ? { ...item, content: `正在读取窗口${i}` } : item);
        renderAgentRunBody(body, run, '');
        unchanged.push(first === group.querySelector('[data-agent-part-type="tool_group"]')
          && text === group.querySelector('[data-agent-part-type="text"]')
          && thinking === group.querySelector('[data-agent-part-type="thinking"]'));
      }
      return { count, unchanged, open: group.open, toolOpen: first.open, content: text.textContent };
    });
    assert.equal(streamingCheck.count, 1, 'the thinking label and reasoning-intent row render once inside the wrapper');
    assert.ok(streamingCheck.unchanged.every(Boolean), 'streaming updates preserve existing tool, text and thinking nodes');
    assert.equal(streamingCheck.open, true);
    assert.equal(streamingCheck.toolOpen, true, 'streaming preserves expanded tool details');
    assert.match(streamingCheck.content, /窗口9/);

    fs.mkdirSync(evidenceDir, { recursive: true });
    const diag = await page.evaluate(() => {
      const el = document.querySelector('.msg.assistant');
      const messages = document.getElementById('messages');
      const box = node => (node ? { w: Math.round(node.getBoundingClientRect().width), h: Math.round(node.getBoundingClientRect().height) } : null);
      return {
        elExists: !!el,
        elBox: box(el),
        elDisplay: el ? getComputedStyle(el).display : null,
        messagesDisplay: messages ? getComputedStyle(messages).display : null,
        messagesBox: box(messages),
        page: currentMainPage,
        appClass: document.getElementById('app')?.className || ''
      };
    });
    console.log('DIAG', JSON.stringify(diag));
    await page.screenshot({ path: path.join(evidenceDir, 'computer-control-chat-page.png') });
    await page.locator('.msg.assistant').last().screenshot({
      path: path.join(evidenceDir, 'computer-control-chat.png'),
      animations: 'disabled'
    }).catch(error => console.log('MESSAGE_SHOT_SKIPPED', error.message));
    await page.locator('.computer-control-session-apps').last().screenshot({
      path: path.join(evidenceDir, 'computer-control-apps-footnote.png'),
      animations: 'disabled'
    }).catch(error => console.log('FOOTNOTE_SHOT_SKIPPED', error.message));

    console.log('computer control chat e2e passed');
  } finally {
    if (application) await application.close();
    if (path.resolve(userDataDir).startsWith(path.join(os.tmpdir(), 'yan-control-chat-e2e-'))) {
      // A just-closed Electron profile can still hold a handle for a moment.
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* cleaned next boot */ }
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
