'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-gpt-presentation-e2e-'));

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
    await page.waitForFunction(() => typeof renderAgentRunBody === 'function' && typeof appendMessage === 'function');
    const result = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      const initialEl = appendMessage('assistant', '');
      renderAgentRunBody(initialEl.querySelector('.msg-body'), {
        status: 'working',
        modelId: 'gpt-5.3',
        timeline: [{ type: 'progress', variant: 'agent-loader', content: '' }]
      });
      const initial = {
        gptChainCount: initialEl.querySelectorAll('.gpt-thinking-chain').length,
        lineText: initialEl.querySelector('.gpt-thinking-line')?.textContent,
        shineCount: initialEl.querySelectorAll('.gpt-thinking-line.agent-shine-text').length,
        legacyLoaderCount: initialEl.querySelectorAll('.agent-loader-note').length
      };
      const gptEl = appendMessage('assistant', '');
      const gptBody = gptEl.querySelector('.msg-body');
      renderAgentRunBody(gptBody, {
        status: 'working',
        modelId: 'gpt-5.3',
        timeline: [
          { type: 'thinking', content: '**先分析任务**', streaming: false },
          { type: 'tool_call', callId: 'gpt-tool', name: 'read', args: { path: 'README.md' } },
          { type: 'thinking', content: '**准备执行**', streaming: true },
          { type: 'text', content: '已读取文件', streaming: false },
          { type: 'thinking', content: '**整理结果**', streaming: true }
        ]
      });
      const working = {
        mode: resolveAgentPresentationMode('gpt-5.3'),
        gptChainCount: gptEl.querySelectorAll('.gpt-thinking-chain').length,
        legacyThinkingCount: gptEl.querySelectorAll('.thinking-block').length,
        lineTexts: Array.from(gptEl.querySelectorAll('.gpt-thinking-line')).map(line => line.textContent),
        shineCount: gptEl.querySelectorAll('.gpt-thinking-line.agent-shine-text').length,
        toolCount: gptEl.querySelectorAll('.tool-activity-group').length,
        childOrder: Array.from(gptBody.querySelector('.agent-activity-body').children).map(child => child.dataset.agentPartType),
        chainTexts: Array.from(gptEl.querySelectorAll('.gpt-thinking-chain')).map(chain => (
          Array.from(chain.querySelectorAll('.gpt-thinking-line')).map(line => line.textContent)
        ))
      };
      renderAgentRunBody(gptBody, {
        status: 'done',
        modelId: 'gpt-5.3',
        timeline: [{ type: 'thinking', content: '**分析任务**\n**准备执行**', streaming: false }]
      });
      const completed = {
        gptChainCount: gptEl.querySelectorAll('.gpt-thinking-chain').length,
        shineCount: gptEl.querySelectorAll('.gpt-thinking-line.agent-shine-text').length
      };
      const standardEl = appendMessage('assistant', '');
      renderAgentRunBody(standardEl.querySelector('.msg-body'), {
        status: 'working',
        modelId: 'agnes-2.5-flash',
        timeline: [{ type: 'thinking', content: '普通思考', streaming: true }]
      });
      const standard = {
        detailsCount: standardEl.querySelectorAll('.thinking-block').length,
        gptChainCount: standardEl.querySelectorAll('.gpt-thinking-chain').length
      };
      gptEl.remove();
      initialEl.remove();
      standardEl.remove();
      return { initial, working, completed, standard };
    });
    assert.deepEqual(result, {
      initial: {
        gptChainCount: 1,
        lineText: undefined,
        shineCount: 0,
        legacyLoaderCount: 0
      },
      working: {
        mode: 'gpt-action-progress',
        gptChainCount: 3,
        legacyThinkingCount: 0,
        lineTexts: ['先分析任务', '准备执行', '整理结果'],
        shineCount: 1,
        toolCount: 1,
        childOrder: ['thinking_group', 'tool_group', 'thinking_group', 'text', 'thinking_group'],
        chainTexts: [['先分析任务'], ['准备执行'], ['整理结果']]
      },
      completed: { gptChainCount: 1, shineCount: 0 },
      standard: { detailsCount: 1, gptChainCount: 0 }
    });
    console.log(JSON.stringify({ ok: true, result }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
