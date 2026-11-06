'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function setup() {
  const timers = new Map(), jobs = [], listeners = {};
  let seq = 0, text = '';
  const state = { config: { general: {}, workspace: '/other-session' }, currentSession: null };
  const context = { state, console, currentMainPage: 'chat', input: { dataset: {}, addEventListener: (name, fn) => { listeners[name] = fn; } },
    setTimeout: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; }, clearTimeout: id => timers.delete(id),
    getComposerText: () => text, composerHasText: value => !!value, setComposerText: value => { text = value; },
    isSessionExecutionActive: () => false, isComposerSkillMenuOpen: () => false,
    createRunCtx: () => ({ abortController: new AbortController() }),
    runOpenCodeLoop: (session, _, run) => new Promise(resolve => jobs.push({ session, run, resolve })),
    window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/prompt-suggestions.js'), 'utf8'), context);
  const api = context.window.YanPromptSuggestions;
  const tick = ms => { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } };
  const open = session => { state.currentSession = session; api.onSessionOpened(session); };
  const finish = async (job, content) => { job.resolve({ content, agentRun: { status: 'done' } }); await new Promise(setImmediate); };
  return { context, state, jobs, api, tick, open, finish, listeners, text: () => text };
}
const session = (id, content = 'AAAA') => ({ id, messages: [{ role: 'user', content, ts: 1 }] });

test('scheduled creation receipts do not launch hidden suggestion runs', () => {
  const h = setup();
  h.open({ ...session('scheduled'), scheduledTaskId: 'sched_1' });
  h.tick(900); h.tick(1200); h.tick(900);
  assert.equal(h.jobs.length, 0);
});

test('switch clears visible suggestions and rejects stale Tab acceptance', async () => {
  const h = setup(); h.open(session('a')); h.tick(900); await h.finish(h.jobs[0], '建议 A');
  assert.match(h.context.input.dataset.placeholder, /建议 A/);
  h.state.currentSession = session('b');
  h.listeners.keydown({ key: 'Tab' });
  assert.equal(h.text(), '');
  h.api.onSessionOpened(h.state.currentSession);
  assert.equal(h.context.input.dataset.placeholder, '与 Yan Agent 协作');
});

test('late A completion cannot overwrite B and background settle cannot cancel B', async () => {
  const h = setup(), a = session('a'), b = session('b');
  h.open(a); h.tick(900); h.open(b); h.tick(900);
  assert.equal(h.jobs[0].run.abortController.signal.aborted, true);
  h.api.onRunSettled(a); h.tick(700);
  assert.equal(h.jobs[1].run.abortController.signal.aborted, false);
  await h.finish(h.jobs[0], '旧建议');
  assert.doesNotMatch(h.context.input.dataset.placeholder, /旧建议/);
  await h.finish(h.jobs[1], '新建议');
  assert.match(h.context.input.dataset.placeholder, /新建议/);
  assert.equal(h.jobs[1].session.workspace, '');
  assert.doesNotMatch(h.jobs[1].session.messages[0].content, /other-session/);
});

test('same-length edits on a reloaded session invalidate in-flight and cached suggestions', async () => {
  const h = setup(); h.open(session('a')); h.tick(900);
  h.open(session('a', 'BBBB')); h.tick(900);
  await h.finish(h.jobs[0], '旧建议'); await h.finish(h.jobs[1], '新建议');
  assert.match(h.context.input.dataset.placeholder, /新建议/);
  h.open(session('a', 'CCCC'));
  assert.equal(h.context.input.dataset.placeholder, '与 Yan Agent 协作');
  h.tick(900); assert.equal(h.jobs.length, 3);
});
