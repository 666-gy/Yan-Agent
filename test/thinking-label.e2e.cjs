'use strict';

// Only model-authored summaries may label a stretch. Both UI modes preserve
// the expandable original and persist summaries through event replay.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-thinking-label-'));

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
    await page.waitForFunction(() => typeof renderAgentRunBody === 'function' && typeof state === 'object');
    await page.waitForFunction(() => window.__YAN_APP_READY__);

    const probe = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      state.currentSession.messages = [];
      const renderCase = (timeline, times = 1, presentationMode = 'standard') => {
        clearMessages();
        setEmptyState(false);
        const assistantEl = appendMessage('assistant', '');
        const agentRun = {
          status: 'working',
          presentationMode,
          timeline: timeline.map(item => ({ ...item })),
          startedAt: Date.now() - 2_000,
          toolCallCount: 0,
          todos: []
        };
        for (let i = 0; i < times; i += 1) {
          renderAgentRunBody(assistantEl.querySelector('.msg-body'), agentRun, '');
        }
        return {
          labels: [...assistantEl.querySelectorAll('.thinking-label')].map(el => el.textContent),
          block: assistantEl.querySelector('.thinking-block'),
          narration: [...assistantEl.querySelectorAll('.msg-round')].map(el => el.textContent).join(''),
          intentRows: [...assistantEl.querySelectorAll('.reasoning-intent-note .reasoning-intent-label')].map(el => el.textContent),
          intentIcon: !!assistantEl.querySelector('.reasoning-intent-note .thinking-bot'),
          hasTriangle: assistantEl.querySelector('.msg-body').textContent.includes('\u25b8')
        };
      };
      const thinking = () => ({ type: 'thinking', stage: 'work', content: '用户想改端口，我先确认配置在哪。', streaming: false });
      const step = (callId, name, args = {}) => ({ type: 'tool_call', stage: 'work', callId, name, args });

      const withIntent = renderCase([
        thinking(),
        { type: 'text', stage: 'work', content: '意图：已定位根因，开始做最小 diff', streaming: false },
        step('c1', 'edit')
      ]);
      // A silent model must not get a fabricated summary from tool arguments.
      const withTarget = renderCase([
        thinking(),
        step('c4', 'read', { filePath: 'C:/Users/x/lib/main/renderer.js' })
      ]);
      const withCommand = renderCase([
        thinking(),
        step('c5', 'bash', { command: 'export PATH=/usr/bin; cd "/x/y" && npm test' })
      ]);
      const stable = renderCase([
        thinking(),
        { type: 'text', stage: 'work', content: '意图：已定位根因，开始做最小 diff', streaming: false },
        step('c1', 'edit')
      ], 3);
      const withSentence = renderCase([
        thinking(),
        { type: 'text', stage: 'work', content: '我先读取配置文件并核对端口。', streaming: false },
        step('c2', 'read')
      ]);
      // The intent line normally arrives after the tool round it reports on.
      // It must keep the orb icon there instead of printing the raw marker.
      const afterToolRound = renderCase([
        thinking(),
        step('c6', 'read'),
        { type: 'tool_result', stage: 'work', callId: 'c6', name: 'read', output: 'ok', ok: true },
        { type: 'text', stage: 'work', content: '意图：已定位根因，开始做最小 diff', streaming: false }
      ]);
      // The final delivery may open with the intent line; the marker must not
      // survive into the answer text.
      const summaryWithIntent = renderCase([
        thinking(),
        { type: 'text', stage: 'summary', content: '意图：已核实三条链路，给出结论与边界建议。\n\n**结论：值得做。**', streaming: false }
      ]);
      const orphanIntent = renderCase([
        { type: 'text', stage: 'work', content: '意图：这是身份与能力介绍，无需工具，直接作答。', streaming: false }
      ]);
      // Stored conversations from earlier releases carry the retired arrowhead
      // marker. It must be consumed on replay exactly like the current one, so a
      // reopened history never shows it.
      const legacyStoredIntent = renderCase([
        thinking(),
        step('c7', 'read'),
        { type: 'tool_result', stage: 'work', callId: 'c7', name: 'read', output: 'ok', ok: true },
        { type: 'text', stage: 'work', content: '\u25b8 已定位根因，开始做最小 diff', streaming: false }
      ]);
      // Regression: the closing answer used to relabel every stretch.
      const closingOnly = renderCase([
        thinking(),
        { type: 'text', stage: 'work', content: '改好了。', streaming: false }
      ]);
      const twoSegments = renderCase([
        thinking(),
        step('c3', 'read'),
        thinking(),
        { type: 'text', stage: 'work', content: '改好了。', streaming: false }
      ]);
      const capped = renderCase([
        thinking(),
        { type: 'text', stage: 'work', content: '意图：先确认配置文件里的端口号是否与文档一致然后再决定是否修改它以及如何回滚', streaming: false }
      ]);

      const generated = renderCase([
        {...thinking(), summary: '已确认端口冲突，准备调整配置', summaryStatus: 'ready'},
        step('generated', 'edit')
      ], 1, 'gpt-action-progress');
      const gptIntent = renderCase([
        thinking(),
        { type: 'text', stage: 'work', content: '意图：已定位根因，开始做最小 diff', streaming: false },
        step('gpt-intent', 'edit')
      ], 3, 'gpt-action-progress');
      const gptAfterTool = renderCase([
        thinking(), step('gpt-boundary', 'read'),
        { type: 'progress', variant: 'reasoning-intent', content: '工具之后的新进展' }
      ], 1, 'gpt-action-progress');
      const gptStreaming = renderCase([
        { ...thinking(), streaming: true },
        { type: 'progress', variant: 'reasoning-intent', content: '流式思考期间的进展' }
      ], 1, 'gpt-action-progress');
      const pending = renderCase([{...thinking(), summaryStatus: 'pending'}]);
      const failed = renderCase([{...thinking(), summaryStatus: 'failed'}]);
      const boundary = renderCase([thinking(), thinking(), {type:'text', content:'意图：只属于第二段', streaming:false}]);
      const ctx = createRunCtx(state.currentSession.id, true, '');
      initOpenCodeRunState(ctx);
      applyOpenCodeEvent(ctx, {type:'message.part.updated', data:{part:{id:'r1',type:'reasoning',text:'本段思考',time:{end:1}}}});
      applyOpenCodeEvent(ctx, {type:'yan.reasoning.summary',data:{key:'reasoning:r1',content:'本段思考',summary:'模型生成的进展说明',summaryStatus:'ready'}});
      const stored = JSON.parse(JSON.stringify(ctx.activeAgentRun.timeline));
      const replay = renderCase(stored, 1, 'gpt-action-progress');
      applyOpenCodeEvent(ctx, {type:'session.next.text.ended',data:{textID:'intent1',text:'意图：模型生成的进展说明\n\n正常正文保留。'}});
      // Replay both the final snapshot and the summary notification, as reconnect does.
      applyOpenCodeEvent(ctx, {type:'message.part.updated',data:{part:{id:'intent1',type:'text',text:'意图：模型生成的进展说明\n\n正常正文保留。',time:{end:2}}}});
      applyOpenCodeEvent(ctx, {type:'yan.reasoning.summary',data:{key:'reasoning:r1',content:'本段思考',summary:'模型生成的进展说明',summaryStatus:'ready',summarySource:'native'}});
      const gptReplay = renderCase(JSON.parse(JSON.stringify(ctx.activeAgentRun.timeline)), 3, 'gpt-action-progress');
      const clickTarget = generated.block;
      clickTarget.querySelector('summary').click();
      const priorSummaryMode = state.config.agent.reasoningSummary;
      state.config.agent.reasoningSummary = 'none';
      const disabledSummary = renderCase([
        { ...thinking(), summary: '不应显示的摘要', summaryStatus: 'ready' },
        step('disabled', 'read'),
        { type: 'progress', variant: 'reasoning-intent', content: '不应显示的独立摘要' }
      ], 1, 'gpt-action-progress');
      state.config.agent.reasoningSummary = priorSummaryMode;
      return {
        gptIntent: { labels: gptIntent.labels, rows: gptIntent.intentRows, narration: gptIntent.narration },
        gptAfterTool: gptAfterTool.intentRows, gptStreaming: gptStreaming.intentRows,
        gptReplay: { labels: gptReplay.labels, rows: gptReplay.intentRows, narration: gptReplay.narration },
        disabledSummary: { labels: disabledSummary.labels, rows: disabledSummary.intentRows },
        generated: generated.labels[0], pending: pending.labels[0], failed: failed.labels[0],
        boundary: boundary.labels, replay: replay.labels[0], intentNarration: withIntent.narration,
        withIntent: withIntent.labels[0],
        withTarget: withTarget.labels[0],
        withCommand: withCommand.labels[0],
        stable: stable.labels[0],
        withSentence: withSentence.labels[0],
        afterToolRound: { rows: afterToolRound.intentRows, icon: afterToolRound.intentIcon, triangle: afterToolRound.hasTriangle, narration: afterToolRound.narration },
        summaryWithIntent: { triangle: summaryWithIntent.hasTriangle, narration: summaryWithIntent.narration },
        orphanIntent: { rows: orphanIntent.intentRows, icon: orphanIntent.intentIcon, triangle: orphanIntent.hasTriangle },
        legacyStoredIntent: { rows: legacyStoredIntent.intentRows, icon: legacyStoredIntent.intentIcon, triangle: legacyStoredIntent.hasTriangle, narration: legacyStoredIntent.narration },
        closingOnly: closingOnly.labels[0],
        twoSegments: twoSegments.labels,
        capped: capped.labels[0],
        expandedAfterClick: clickTarget.open === true,
        thinkingText: clickTarget.querySelector('.thinking-text')?.textContent || ''
      };
    });

    assert.equal(probe.withIntent, '已定位根因，开始做最小 diff', 'the model intent line labels the stretch');
    assert.deepEqual(probe.gptIntent, { labels: ['已定位根因，开始做最小 diff'], rows: [], narration: '' }, 'GPT native progress appears once, even after repeated rendering');
    assert.deepEqual(probe.gptAfterTool, ['工具之后的新进展'], 'a tool boundary must preserve independent GPT progress');
    assert.deepEqual(probe.gptStreaming, ['流式思考期间的进展'], 'the streaming GPT chain has no summary label to replace the progress row');
    assert.deepEqual(probe.gptReplay.labels, ['模型生成的进展说明']);
    assert.deepEqual(probe.gptReplay.rows, [], 'snapshot and summary replay must not duplicate the finished GPT progress');
    assert.ok(probe.gptReplay.narration.includes('正常正文保留。'));
    assert.deepEqual(probe.disabledSummary, { labels: ['思考已结束'], rows: [] });
    assert.equal(probe.withTarget, '思考已结束', 'tool targets never masquerade as summaries');
    assert.equal(probe.withCommand, '思考已结束', 'commands never masquerade as summaries');
    assert.equal(probe.stable, probe.withIntent, 'the label does not change across re-renders');
    assert.equal(probe.withSentence, '思考已结束', 'ordinary narration is not borrowed');
    assert.equal(probe.closingOnly, '思考已结束', 'the closing answer must not become the label');
    assert.deepEqual(probe.twoSegments, ['思考已结束', '思考已结束'], 'no stretch is relabelled by the closing answer');
    assert.notEqual(probe.twoSegments[1], '改好了。');
    assert.ok(probe.capped.endsWith('如何回滚'), 'progress sentences remain readable in full');
    assert.equal(probe.generated, '已确认端口冲突，准备调整配置');
    assert.equal(probe.pending, '正在整理进展…');
    assert.equal(probe.failed, '进展摘要暂不可用');
    assert.deepEqual(probe.boundary, ['思考已结束', '只属于第二段']);
    assert.equal(probe.replay, '模型生成的进展说明', 'summary survives event ingestion and serialization');
    assert.equal(probe.intentNarration, '', 'intent appears once as the expandable progress paragraph');
    assert.equal(probe.expandedAfterClick, true, 'clicking the label still expands the raw thinking');
    assert.match(probe.thinkingText, /用户想改端口/, 'the raw thinking text is preserved underneath');
    // The reasoning-intent line must never print the U+25B8 marker: a stretch
    // that ends before the line arrives shows it under the same orb icon.
    assert.equal(probe.afterToolRound.triangle, false, 'the intent marker never reaches the work view');
    assert.deepEqual(probe.afterToolRound.rows, ['已定位根因，开始做最小 diff'], 'the orphaned intent keeps its own orb-led row');
    assert.equal(probe.afterToolRound.icon, true, 'the intentional row carries the thinking icon');
    assert.equal(probe.afterToolRound.narration, '', 'the intent row is not duplicated as narration');
    assert.equal(probe.summaryWithIntent.triangle, false, 'the intent marker never reaches the final answer');
    assert.ok(probe.summaryWithIntent.narration.includes('结论：值得做。'), 'the answer body survives the strip');
    assert.equal(probe.orphanIntent.triangle, false, 'an intent line with no reasoning above it never prints the marker');
    assert.equal(probe.orphanIntent.icon, true, 'it is introduced by the thinking icon instead');
    // A conversation stored by an earlier release carries the retired marker; it
    // is consumed on replay exactly like the current one.
    assert.equal(probe.legacyStoredIntent.triangle, false, 'a stored legacy marker never reaches the view');
    assert.deepEqual(probe.legacyStoredIntent.rows, ['已定位根因，开始做最小 diff'], 'the stored label is still recovered');
    assert.equal(probe.legacyStoredIntent.icon, true, 'the stored row keeps the thinking icon');
    assert.equal(probe.legacyStoredIntent.narration, '', 'the stored marker is not left in the narration');
    console.log(JSON.stringify({ ok: true, probe }, null, 2));
  } finally {
    await application?.close().catch(() => {});
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* Windows may still hold the profile briefly */ }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
