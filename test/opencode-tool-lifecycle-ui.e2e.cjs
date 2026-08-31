'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-tool-lifecycle-e2e-'));

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

    const states = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      const session = state.currentSession;
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

      const step = assistantEl.querySelector('.tool-step[data-call-id="write-call-1"]');
      const running = {
        exists: !!step,
        running: step?.classList.contains('is-running') || false,
        spinner: !!step?.querySelector('.tc-badge.running'),
        completed: !!step?.querySelector('.tc-badge.ok')
      };

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

      const completed = {
        exists: !!step,
        running: step?.classList.contains('is-running') || false,
        spinner: !!step?.querySelector('.tc-badge.running'),
        completed: !!step?.querySelector('.tc-badge.ok')
      };
      state.activeRuns.delete(session.id);
      assistantEl.remove();
      return { running, completed };
    });

    assert.deepEqual(states.running, {
      exists: true,
      running: true,
      spinner: true,
      completed: false
    });
    assert.deepEqual(states.completed, {
      exists: true,
      running: false,
      spinner: false,
      completed: true
    });
    console.log('OpenCode tool lifecycle UI E2E passed');
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
