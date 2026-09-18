'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'sidebar-optimization');

(async () => {
  let app;
  try {
    app = await electron.launch({
      executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'yan-sidebar-live-')) }
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    const tools = await page.evaluate(async () => {
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const settle = () => new Promise(resolve => setTimeout(resolve, 20));
      const call = (id, index, end = index + 1) => ({
        item: { type: 'tool_call', callId: id, name: 'read', args: { path: id + '.js' } },
        result: { type: 'tool_result', callId: id, output: 'output-' + id, ok: true },
        phase: 'done', callIndex: index, resultIndex: end
      });
      const a = call('a', 0), b = call('b', 2);
      const group = buildToolActivityGroupElement([a, b]);
      document.body.append(group);
      group.open = true;
      const first = group.querySelector('[data-call-id="a"]');
      check(!first.querySelector('.tool-result-panel'), 'Closed tool allocated a result panel');
      first.querySelector('summary').click();
      await settle();
      const panel = first.querySelector('.tool-result-panel');
      check(panel?.textContent.includes('output-a'), 'Click did not render correct result');
      syncToolActivityGroup(group, [a, b, call('c', 4)]);
      check(group.querySelector('[data-call-id="a"]') === first && first.open, 'Append replaced existing tool');
      check(first.querySelector('.tool-result-panel') === panel, 'Unchanged open panel replaced');
      syncToolActivityGroup(group, [a, { ...b, result: { ...b.result, output: 'updated-b' } }]);
      const second = group.querySelector('[data-call-id="b"]');
      second.querySelector('summary').click();
      await settle();
      check(second.textContent.includes('updated-b'), 'Lazy result used stale data');
      syncToolActivityGroup(group, [a, { ...b, result: { ...b.result, output: 'streamed-b' } }]);
      check(second.open && second.textContent.includes('streamed-b'), 'Open tool did not refresh');
      syncToolActivityGroup(group, [{ ...a, resultIndex: 10 }, b]);
      check(group.querySelector('.tool-parallel-group'), 'Parallel fixture missing');
      check(group.querySelector('[data-call-id="a"]') === first, 'Regrouping replaced row');
      syncToolActivityGroup(group, [a, b]);
      check(!group.querySelector('.tool-parallel-group') && group.querySelector('[data-call-id="a"]') === first,
        'Returning to serial lost row');
      group.remove();

      for (const name of ['read', 'bash']) {
        const step = buildToolStepElement(name, name === 'bash' ? { command: 'echo test' } : { path: 'test' }, null, null, 'running');
        document.body.append(step);
        cancelToolStepElement(step);
        step.querySelector('summary').click();
        await settle();
        check(step.classList.contains('is-interrupted') && step.querySelector('.tool-result-panel'), 'Cancelled lazy tool failed: ' + name);
        check(!step.querySelector('.tool-result-panel').textContent.includes('执行中'), 'Cancelled tool still running');
        step.remove();
      }
      const image = buildToolStepElement('generate_image', { prompt: 'test' }, null, null, 'running');
      check(image.open && image.textContent.includes('正在生成图片'), 'Image loading preview missing');
      const error = buildToolStepElement('read', { path: 'missing' }, 'error: missing', false, 'done');
      check(error.open && error.querySelector('.tool-result-panel')?.textContent.includes('missing'), 'Error tool failed to open');

      if (!state.currentSession) await newSession();
      clearMessages();
      state.currentSession.messages = [];
      const timeline = [];
      const append = i => timeline.push(
        { type: 'tool_call', stage: 'work', callId: 'long-' + i, name: 'read', args: { path: 'src/' + i + '.js' }, openCodeKey: 'call-' + i },
        { type: 'tool_result', stage: 'work', callId: 'long-' + i, name: 'read', output: 'result-' + i, ok: true, openCodeKey: 'result-' + i });
      for (let i = 0; i < 2400; i++) append(i);
      const run = { runId: 'sidebar-regression', status: 'working', startedAt: Date.now() - 7 * 3600000, timeline };
      appendMessage('assistant', '', [], false, 0, Date.now(), 0, run);
      setEmptyState(false);
      const message = document.querySelector('#messages .msg.assistant');
      const ctx = { ui: true, sessionId: state.currentSession.id, activeAgentRun: run,
        agentState: { todos: [], toolCallCount: 2400 }, openCodeDirtyTimelineKeys: new Set(),
        openCodeTimelineRevision: 0, partialContent: '' };
      state.activeRuns.set(state.currentSession.id, { runCtx: ctx, assistantEl: message });
      const activity = message.querySelector('.agent-activity-body');
      const retainedGroup = activity.querySelector('.tool-activity-group');
      retainedGroup.open = true;
      const retained = activity.querySelector('[data-call-id="long-2390"]');
      retained.querySelector('summary').click();
      await settle();
      const retainedPanel = retained.querySelector('.tool-result-panel');
      const times = [];
      for (let i = 2400; i < 2410; i++) {
        append(i);
        ctx.openCodeTimelineRevision++;
        ctx.openCodeDirtyTimelineKeys.add('call-' + i);
        ctx.openCodeDirtyTimelineKeys.add('result-' + i);
        const start = performance.now();
        renderOpenCodeRunNow(ctx);
        times.push(performance.now() - start);
        check(activity.querySelector('[data-call-id="long-2390"]') === retained, 'Sliding window discarded surviving row');
        check(retained.open && retained.querySelector('.tool-result-panel') === retainedPanel, 'Sliding window lost open result');
        check(activity.querySelector('.tool-activity-group') === retainedGroup, 'Sliding window replaced group');
      }
      check(activity.querySelectorAll('.tool-step').length <= 120, 'Long history mounted unbounded tool rows');
      check(activity.querySelectorAll('.tool-result-panel').length === 1, 'Closed historical tools eagerly rendered');

      const fixture = document.createElement('div');
      const separated = [...timeline.slice(-6, -4), { type: 'text', stage: 'work', content: '分组间说明', openCodeKey: 'separator' }, ...timeline.slice(-4)];
      syncAgentTimelineParts(fixture, separated, 'working', '', false, true);
      check(fixture.querySelectorAll('.tool-activity-group').length === 2, 'Separated groups merged');
      syncAgentTimelineParts(fixture, separated.slice(1), 'working', '', false, true);
      const keys = [...fixture.children].map(element => element.dataset.agentPartKey);
      check(new Set(keys).size === keys.length, 'Reconciliation duplicated a group');
      return { calls: 2410, mountedRows: activity.querySelectorAll('.tool-step').length, updateMaxMs: Math.max(...times) };
    });
    const resize = await page.evaluate(async () => {
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      setLeftSidebarOpen(true); setRightSidebarOpen(true);
      await settle();
      const root = document.documentElement;
      const left = document.querySelector('#sidebar'), right = document.querySelector('#rightSidebar');
      const mouse = (element, type, x) => element.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x }));
      const widths = [];
      for (const side of ['left', 'right']) {
        const handle = document.querySelector(side === 'left' ? '#leftResizeHandle' : '#rightResizeHandle');
        const panel = side === 'left' ? left : right;
        const property = side === 'left' ? '--sidebar-w' : '--rs-w';
        const before = root.style.getPropertyValue(property);
        mouse(handle, 'mousedown', handle.getBoundingClientRect().x);
        const target = side === 'left' ? 310 : innerWidth - 330;
        for (let i = 0; i < 100; i++) mouse(document, 'mousemove', target - 99 + i);
        check(panel.style.width === '', 'Drag wrote width before animation frame');
        await settle();
        check(root.style.getPropertyValue(property) === before, 'Drag invalidated inherited root width');
        check(parseFloat(panel.style.width) === (side === 'left' ? 310 : 330), 'Frame did not use latest pointer');
        if (side === 'left') mouse(document, 'mouseup', target);
        else window.dispatchEvent(new Event('blur'));
        check(left.style.width === '' && right.style.width === '', 'Inline drag width leaked after finish');
        check(!document.body.classList.contains('resizing'), 'Drag state leaked after finish');
        check(parseFloat(root.style.getPropertyValue(property)) === (side === 'left' ? 310 : 330), 'Final width not committed');
        widths.push(root.style.getPropertyValue(property));
      }
      mouse(document.querySelector('#leftResizeHandle'), 'mousedown', 310);
      mouse(document, 'mousemove', 10000);
      mouse(document, 'mouseup', 10000);
      check(root.style.getPropertyValue('--sidebar-w') === '420px', 'Left maximum not enforced');
      mouse(document.querySelector('#rightResizeHandle'), 'mousedown', innerWidth - 330);
      mouse(document, 'mousemove', innerWidth + 1000);
      mouse(document, 'mouseup', innerWidth + 1000);
      check(root.style.getPropertyValue('--rs-w') === '280px', 'Right minimum not enforced');
      let snapshots = 0;
      const original = document.startViewTransition;
      document.startViewTransition = () => { snapshots++; throw new Error('Unexpected page snapshot'); };
      try {
        for (let i = 0; i < 4; i++) { setLeftSidebarOpen(i % 2 === 1); setRightSidebarOpen(i % 2 === 1); }
      } finally { document.startViewTransition = original; }
      check(snapshots === 0, 'Sidebar requested full-page snapshot');
      await settle();
      return { widths, snapshots };
    });
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'sidebar-live-regression.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'PASS', tools, resize }, null, 2));
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
