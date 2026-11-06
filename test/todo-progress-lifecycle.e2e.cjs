'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-todo-lifecycle-e2e-'));

// Retain a finished checklist until the next user submission. Automatic
// continuations remain in the same user task and retain its checklist.
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
      typeof renderTodos === 'function' && typeof getRunCtx === 'function' && typeof newSession === 'function'
    ));

    const observed = await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      const session = state.currentSession;
      const host = document.querySelector('#todoProgressHost');
      const read = () => ({ hidden: host.classList.contains('hidden'), mode: host.dataset.mode || '' });

      const live = { status: 'working', changeSummary: null, todos: [
        { text: 'A', done: true, inProgress: false },
        { text: 'B', done: false, inProgress: true }
      ] };
      const runCtx = { agentState: live, sessionId: session.id, runId: 'live-review', activeAgentRun: {}, ui: {}, replayingHistory: true };
      state.activeRuns.set(session.id, { runCtx, sessionRef: session });
      renderTodos(live);
      const during = read();

      live.todos = ['A', 'B', 'C'].map(text => ({ text, done: true }));
      renderTodos(live);
      const completedWhileWorking = read();
      live.status = 'done';
      renderTodos(live);
      const settledBeforeCleanup = read();
      live.status = 'working';

      live.todos = [];
      renderTodos(live);
      const emptyLive = read();
      applyOpenCodeEvent(runCtx, { type: 'yan.review.updated', data: { files: [{ path: 'live.js', additions: 3 }], additions: 3 } }, { deferEffects: true });
      const editedLive = { ...read(), label: document.querySelector('#todoProgressCount').textContent };
      applyOpenCodeEvent(runCtx, { type: 'yan.review.updated', data: { files: [], count: 0 } }, { deferEffects: true });
      const revertedLive = read();
      const errorText = toolResultDetails({ type: 'unknown', message: 'Command exited with code 7.' }).output;

      state.activeRuns.delete(session.id);
      const settled = { status: 'done', changeSummary: null, todos: [
        { text: 'A', done: true }, { text: 'B', done: true }
      ] };
      renderTodos(settled);
      const after = read();

      const withFiles = { status: 'done', todos: [],
        changeSummary: { files: [{ path: 'a.js', additions: 2, deletions: 1 }], additions: 2, deletions: 1 } };
      renderTodos(withFiles);
      const files = read();
      session.messages = [{ role: 'user', content: 'first task' }, { role: 'assistant', agentRun: settled }];
      syncCurrentSessionAgentUi(session);
      const restored = read();
      const wake = createRunCtx(session.id, true, session.workspace || '');
      initOpenCodeRunState(wake);
      state.activeRuns.set(session.id, { runCtx: wake, sessionRef: session });
      applyOpenCodeEvent(wake, { type: 'todo.updated', properties: { todos: settled.todos } });
      const background = read();
      state.activeRuns.delete(session.id);
      session.messages.push({ role: 'user', content: 'new task' });
      syncCurrentSessionAgentUi(session);
      const nextUser = read();
      const newRun = createRunCtx(session.id, true, session.workspace || '');
      state.activeRuns.set(session.id, { runCtx: newRun, sessionRef: session });
      syncCurrentSessionAgentUi(session);
      const nextRunning = read();
      state.activeRuns.delete(session.id);
      return { during, after, files, emptyLive, editedLive, revertedLive, errorText, completedWhileWorking, settledBeforeCleanup, restored, background, nextUser, nextRunning };
    });

    assert.deepEqual(observed.during, { hidden: false, mode: 'todos' }, 'an active run keeps the checklist visible');
    assert.equal(observed.emptyLive.hidden, true);
    assert.equal(observed.completedWhileWorking.hidden, false, 'current-turn completion remains visible until the turn settles');
    assert.equal(observed.settledBeforeCleanup.hidden, false, 'completion retains the checklist');
    assert.equal(observed.editedLive.hidden, false);
    assert.match(observed.editedLive.label, /编辑了1个文件/);
    assert.equal(observed.revertedLive.hidden, true, 'reverted edits must clear the live pill');
    assert.equal(observed.errorText, 'Command exited with code 7.');
    assert.equal(observed.after.hidden, false, 'a settled checklist stays above the composer');
    assert.equal(observed.restored.hidden, false, 'saved completed checklist remains visible');
    assert.equal(observed.background.hidden, false, 'background continuation keeps the checklist');
    assert.equal(observed.nextUser.hidden, true, 'new user submission clears the old checklist before run startup');
    assert.equal(observed.nextRunning.hidden, true, 'new user run starts without the old checklist');
    assert.equal(observed.files.hidden, false, 'a settled run with edits still shows its summary');
    assert.equal(observed.files.mode, 'files');
    assert.deepEqual(errors, []);
    console.log('PASS todo lifecycle: completion and Bash retain checklist; next user turn clears it; file summary retained');
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
