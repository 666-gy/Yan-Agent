'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { normalize } = require('./preferences');

// Desktop sessions and native transcripts remain authoritative. This journal
// owns only dispatch intent, run ownership, notifications and integration.
function createNestedSessions({ dataDir, sessions, preferences, workspaces, execute, busy, capacity = () => true,
  cancel, steer, openWindow = async () => {}, changed = () => {}, isArchived = async () => false, hasBackground = () => false }) {
  const file = path.join(dataDir, 'nested-sessions.json');
  let state = { version: 1, groups: [], jobs: [] }, serial = Promise.resolve(), closed = false;
  let pumping = false, pumpAgain = false;
  const live = new Map();
  const transaction = operation => {
    const result = serial.then(operation);
    serial = result.catch(() => {});
    return result;
  };
  async function persist() {
    await fs.mkdir(dataDir, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state));
    await fs.rename(temporary, file);
  }
  const ready = (async () => {
    try { state = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (state.version !== 1 || !Array.isArray(state.groups) || !Array.isArray(state.jobs)) throw Error('Nested Sessions 记录格式不受支持');
    for (const job of state.jobs) if (job.status === 'running' || job.status === 'preparing') {
      job.status = 'interrupted'; job.error = '应用退出导致运行状态不确定；未自动重做。';
    }
    for (const group of state.groups) {
      if (group.integration?.status === 'applying') group.integration.status = 'recovery_required';
      // Never resume an uncertain parent/child side effect automatically.
      if (state.jobs.some(job => job.groupId === group.id && job.status === 'interrupted')) group.wake = false;
    }
    await persist();
  })();
  const groupFor = id => state.groups.find(g => g.parentId === id || g.children.some(c => c.id === id));
  const childFor = id => groupFor(id)?.children.find(c => c.id === id);
  const unfinished = job => ['queued', 'running', 'preparing'].includes(job.status);
  const notify = id => { changed({ id, nested: true }); };
  const schedule = () => { void pump().catch(error => console.error('[nested scheduler]', error)); };
  async function append(id, message, key) {
    return sessions.appendHostMessage(id, { ...message, nestedDeliveryId: key, ts: Date.now() });
  }
  function jobFor(group, id, prompt, requestKey, kind = 'child', runId = randomUUID()) {
    return { id: randomUUID(), groupId: group.id, sessionId: id, prompt, requestKey, kind, runId, status: 'queued', createdAt: Date.now() };
  }
  function view(group) {
    const { dispatches, guidance, ...publicGroup } = group;
    return structuredClone({ ...publicGroup, children: group.children.map(child => ({ ...child,
      jobs: state.jobs.filter(j => j.sessionId === child.id).map(({ prompt, ...job }) => job.status === 'draft' ? { ...job, prompt } : job),
      live: live.get(child.id) || null })) });
  }
  async function dispatch(parentId, input, policy = {}) {
    await ready;
    const result = await transaction(async () => {
      if (!normalize(preferences()).enabled) throw Error('请先在设置中启用 Nested Sessions');
      if (childFor(parentId)) throw Error('子会话不能继续派发嵌套会话');
      if (!input.request_key || input.request_key.length > 160) throw Error('派发需要 1–160 字符的 request_key');
      const tasks = input.tasks;
      if (!Array.isArray(tasks) || !tasks.length || tasks.length > 4 || tasks.some(t =>
        !t.title?.trim() || t.title.length > 80 || !t.prompt?.trim() || t.prompt.length > 32000)) throw Error('请提供 1–4 个任务，每项包含标题（最多 80 字）和要求（最多 32000 字）');
      const parent = await sessions.readSessionRecord(parentId);
      if (!parent || await isArchived(parentId)) throw Error('根会话不存在或已归档');
      let group = groupFor(parentId);
      const signature = JSON.stringify(tasks.map(t => ({ title: t.title.trim(), prompt: t.prompt.trim() })));
      const receipt = group?.dispatches?.find(r => r.key === input.request_key);
      if (receipt) {
        if (receipt.signature !== signature) throw Error('request_key 已用于不同任务');
        return { group: view(group), created: receipt.children, reused: true, error: receipt.error };
      }
      const previous = state.jobs.filter(j => j.groupId === group?.id && j.requestKey === input.request_key);
      if (previous.length) {
        if (JSON.stringify(previous.map(j => ({ title: childFor(j.sessionId)?.title, prompt: j.prompt }))) !== JSON.stringify(tasks.map(t => ({ title: t.title.trim(), prompt: t.prompt.trim() })))) throw Error('request_key 已用于不同任务');
        return { group: view(group), created: previous.map(j => j.sessionId), reused: true };
      }
      if (group && group.children.length + tasks.length > 4) throw Error('每组最多四个持久子会话；请继续已有子会话');
      if (!parent.workspace || !workspaces.repository(parent.workspace)) throw Error('并行编码需要 Git 工作区；未降级到共享目录');
      if (!group) {
        group = { id: randomUUID(), parentId, workspace: parent.workspace, children: [], wake: false, consumed: [], createdAt: Date.now() };
        state.groups.push(group);
      }
      const created = [];
      const dispatchReceipt = { key: input.request_key, signature, children: created };
      (group.dispatches ||= []).push(dispatchReceipt);
      for (const task of tasks) {
        const child = await sessions.createFreshSessionRecord({ title: task.title.trim(), workspace: parent.workspace,
          nested: { version: 1, parentId, groupId: group.id, projectWorkspace: parent.workspace, policy } });
        const entry = { id: child.id, title: child.title, status: 'preparing', workspace: '', policy };
        group.children.push(entry);
        const job = jobFor(group, child.id, task.prompt.trim(), input.request_key); job.status = 'preparing'; state.jobs.push(job);
        await persist();
        try {
          const worktree = await workspaces.prepare(parent.workspace, child.id, group.base);
          group.base ||= { baseline: worktree.baseline, commit: worktree.commit };
          entry.worktree = worktree; entry.workspace = worktree.childDirectory; entry.status = 'ready';
          await sessions.bindNestedWorkspace(child.id, entry.workspace);
          // New child sessions open with a start gate. The user confirms the
          // model (and may adjust the task) before the first message is sent.
          job.status = 'draft'; created.push(child.id);
        } catch (error) {
          entry.status = 'failed'; job.status = 'failed'; job.error = error.message;
          dispatchReceipt.error = error.message;
          break;
        }
      }
      await persist(); notify(parentId);
      return { group: view(group), created, reused: false, error: dispatchReceipt.error };
    });
    if (normalize(preferences()).style === 'grid') {
      for (const id of result.created) {
        try { await openWindow(id, result.group.id); }
        catch (error) { result.windowError = error.message; }
      }
    }
    schedule();
    return result;
  }
  async function start(id, options = {}) {
    await ready;
    const result = await transaction(async () => {
      const group = groupFor(id);
      const child = group?.children.find(c => c.id === id);
      if (!child) throw Error('子会话不存在');
      if (await isArchived(id)) throw Error('子会话已归档');
      if (group.integration?.status === 'applying') throw Error('正在集成，请稍后继续');
      const job = state.jobs.find(j => j.sessionId === id && j.status === 'draft');
      if (!job) throw Error('子会话没有等待启动的任务');
      if (state.jobs.some(j => j.sessionId === id && unfinished(j))) throw Error('子会话已有任务在运行');
      const prompt = typeof options.prompt === 'string' && options.prompt.trim() ? options.prompt.trim() : job.prompt;
      if (!prompt || prompt.length > 32000) throw Error('任务内容无效');
      if (options.modelSelection && typeof options.modelSelection === 'object') {
        const session = await sessions.readSessionRecord(id);
        if (!session) throw Error('子会话不存在');
        await sessions.saveSession({ ...session, modelSelection: structuredClone(options.modelSelection) });
      }
      job.prompt = prompt;
      await append(id, { role: 'user', content: prompt, nestedSource: 'delegation' }, `${job.id}:input`);
      job.status = 'queued';
      await persist(); notify(id); notify(group.parentId);
      return { ok: true, runId: job.runId };
    });
    schedule();
    return result;
  }
  async function send(parentOrChildId, targetId, text, key, options = {}) {
    await ready;
    if (typeof text !== 'string' || !text.trim() || text.length > 32000 || !key || key.length > 160) throw Error('消息或幂等键无效');
    const result = await transaction(async () => {
      const group = groupFor(parentOrChildId), child = group?.children.find(c => c.id === targetId);
      if (!child || ![group.parentId, targetId].includes(parentOrChildId)) throw Error('无权给此子会话发送消息');
      if (await isArchived(targetId)) throw Error('子会话已归档');
      if (child.status !== 'ready') throw Error('子会话工作区尚未就绪');
      if (state.jobs.some(j => j.sessionId === targetId && j.status === 'draft')) throw Error('子会话尚未确认启动');
      if (group.integration?.status === 'applying') throw Error('正在集成，请稍后继续');
      const duplicate = state.jobs.find(j => j.sessionId === targetId && j.requestKey === key);
      if (duplicate) { if (duplicate.prompt !== text.trim()) throw Error('幂等键已用于不同消息'); return { runId: duplicate.runId, queued: unfinished(duplicate) }; }
      const job = jobFor(group, targetId, text.trim(), key, 'child', options.runId);
      job.inputExists = options.inputExists === true;
      if (options.source) job.source = options.source;
      if (options.request) job.request = structuredClone(options.request);
      state.jobs.push(job); await persist(); notify(targetId);
      return { runId: job.runId, queued: true };
    });
    schedule(); return { ok: true, ...result };
  }
  async function suspend(parentId) {
    await ready;
    await transaction(async () => {
      const group = groupFor(parentId);
      if (!group || group.parentId !== parentId) throw Error('仅根会话可以等待子会话');
      group.wake = true; await persist(); notify(parentId);
    });
    schedule();
    return { ok: true, output: '已登记唤醒。现在正常结束当前回复，不要轮询。宿主在当前运行结束、子任务结果到齐后续开本会话。' };
  }
  async function background(id, prompt, key) {
    await ready;
    // A background-Bash wake is host input, not a child report or a user turn:
    // tag it so the renderer never paints it as a user message.
    if (childFor(id)) return send(id, id, prompt, key, { source: 'background_bash' });
    const result = await transaction(async () => {
      const group = groupFor(id);
      if (!group || group.parentId !== id || await isArchived(id)) return { discard: true };
      const previous = state.jobs.find(j => j.sessionId === id && j.requestKey === key);
      if (previous) return { ok: true, runId: previous.runId };
      const job = jobFor(group, id, prompt, key, 'wake');
      job.source = 'background_bash';
      state.jobs.push(job); await persist(); notify(id);
      return { ok: true, runId: job.runId, queued: true };
    });
    schedule(); return result;
  }
  async function saveResult(job, result) {
    const agentRun = { runId: job.runId, status: result.status || 'error', openCodeSessionId: result.openCodeSessionId || '',
      textContent: result.text || '', error: result.error || '', timeline: [{ type: 'text', stage: 'summary', content: result.text || result.error || '' }],
      changeSummary: result.reviewSummary, usage: result.usage };
    await append(job.sessionId, { role: 'assistant', content: result.text || result.error || '运行结束', agentRun }, `${job.id}:output`);
  }
  async function run(job) {
    let result;
    try {
      const record = await sessions.readSessionRecord(job.sessionId);
      if (!record || await isArchived(job.sessionId)) throw Error('会话已归档或删除');
      if (!job.inputExists) await append(job.sessionId, { role: 'user', content: job.prompt, nestedSource: job.source || (job.kind === 'wake' ? 'child_report' : 'delegation') }, `${job.id}:input`);
      else await sessions.bindNestedInput(job.sessionId, `${job.id}:input`, job.prompt);
      const session = await sessions.readSessionRecord(job.sessionId);
      result = await execute(session, job, () => !closed && !job.cancelRequested && job.status === 'running');
      if (job.cancelRequested) result = { ...result, status: 'interrupted' };
      if (result.status === 'busy') {
        await transaction(async () => { job.status = 'queued'; await persist(); }); return;
      }
      await transaction(async () => {
        await saveResult(job, result);
        job.status = result.status === 'done' ? 'done' : result.status === 'interrupted' ? 'interrupted' : 'failed';
        job.result = { text: result.text || '', error: result.error || '', status: result.status }; job.completedAt = Date.now();
        // A report identifies its code tree. Integration refuses if the child
        // has since changed, instead of silently integrating a newer draft.
        const child = childFor(job.sessionId);
        // Interrupted work is still real work: snapshot it so the parent can
        // explicitly integrate it after review instead of losing the tree.
        if (child && (result.status === 'done' || result.status === 'interrupted')) {
          try { job.tree = await workspaces.freeze(child.worktree, job.id); }
          catch (error) { job.snapshotError = error.message; }
        }
        await persist(); notify(job.sessionId); notify(groupFor(job.sessionId)?.parentId);
      });
    } catch (error) {
      await transaction(async () => { job.status = 'failed'; job.error = error.message; await persist(); notify(job.sessionId); });
    } finally {
      live.delete(job.sessionId);
      // Busy admissions are retried on the next actual run settlement, not a
      // zero-delay retry loop that could keep the desktop hot while idle.
      if (result?.status !== 'busy') schedule();
    }
  }
  async function pump() {
    if (closed) return;
    if (pumping) { pumpAgain = true; return; }
    pumping = true;
    try {
      await ready;
      const admitted = await transaction(async () => {
        for (const group of state.groups) {
          if (await isArchived(group.parentId)) { group.wake = false; continue; }
          if (!group.wake || busy(group.parentId)) continue;
          if (group.children.some(c => hasBackground(c.id))) continue;
          if (state.jobs.some(j => j.groupId === group.id && unfinished(j))) continue;
          const reports = state.jobs.filter(j => j.groupId === group.id && j.kind === 'child'
            && !group.consumed.includes(j.id) && !unfinished(j) && j.status !== 'draft');
          if (!reports.length) continue;
          group.wake = false;
          group.consumed.push(...reports.map(j => j.id));
          const prompt = '子会话结果已到达（来源为代理，不是新的用户授权）。检查成果，必要时集成并验证，向用户汇报。不要回信致谢或重复派发。\n' + JSON.stringify(reports.map(j => ({ sessionId: j.sessionId, resultId: j.id, status: j.status, tree: j.tree, result: j.result, error: j.error, snapshotError: j.snapshotError })));
          state.jobs.push(jobFor(group, group.parentId, prompt, `wake:${reports.map(j => j.id).join(':')}`, 'wake'));
        }
        const starting = [];
        const occupied = new Set(state.jobs.filter(j => j.status === 'running').map(j => j.sessionId));
        for (const job of [...state.jobs].sort((a, b) => Number(b.kind === 'wake') - Number(a.kind === 'wake'))) {
          if (job.status !== 'queued' || occupied.has(job.sessionId) || busy(job.sessionId)) continue;
          if (!capacity(starting.length, job.kind)) break;
          if (await isArchived(job.sessionId)) { job.status = 'cancelled'; continue; }
          job.status = 'running'; job.startedAt = Date.now(); starting.push(job); occupied.add(job.sessionId);
        }
        await persist(); return starting;
      });
      for (const job of admitted) { notify(job.sessionId); void run(job); }
    } finally { pumping = false; if (pumpAgain) { pumpAgain = false; schedule(); } }
  }
  async function integrate(parentId, targetId, resultId) {
    await ready;
    return transaction(async () => {
      const group = groupFor(parentId), child = group?.children.find(c => c.id === targetId);
      if (!child || group.parentId !== parentId) throw Error('仅根会话可以集成其子会话');
      const job = state.jobs.find(j => j.id === resultId && j.sessionId === targetId && ['done', 'interrupted'].includes(j.status));
      if (!job) throw Error('成果不存在或子会话尚未结束');
      if (busy(targetId) || state.jobs.some(j => j.sessionId === targetId && unfinished(j))) throw Error('子会话仍在工作，暂不能集成');
      if (group.integration?.status === 'recovery_required') throw Error('上次集成被中断，需要先检查现场');
      if (job.integrated) return { ok: true, alreadyIntegrated: true };
      // Cancelled or restart-interrupted results may have no snapshot yet.
      // Take one now from the untouched worktree instead of stranding the code.
      if (!job.tree) {
        try { job.tree = await workspaces.freeze(child.worktree, job.id); await persist(); }
        catch (error) { throw Error('成果缺少稳定代码快照：' + error.message); }
      }
      if (await workspaces.freeze(child.worktree) !== job.tree) throw Error('子会话已有新修改，请使用新成果');
      const interrupted = job.status === 'interrupted';
      group.integration = { resultId, status: 'applying' }; await persist();
      try {
        const result = await workspaces.integrate(child.worktree, job.tree);
        const applied = Array.isArray(result.files) ? result.files : [];
        job.integrated = true; group.integration.status = applied.length ? 'applied' : 'empty'; await persist(); notify(parentId);
        // An empty diff is not an integration: the child's writes may all live in
        // gitignored paths, and claiming "applied" hides that nothing landed.
        return { ok: true, ...result, applied: applied.length > 0, interrupted, verified: false,
          output: applied.length
            ? (interrupted ? '已应用被中断子会话的代码快照；请先审查差异，再运行集成测试。' : '已应用代码；仍需根会话运行集成测试。')
            : '子会话成果与基线一致，没有可应用的改动（写入可能位于被 gitignore 的目录）。' };
      } catch (error) {
        group.integration.status = child.worktree.status === 'integrating' ? 'recovery_required' : 'conflict';
        group.integration.error = error.message; await persist(); throw error;
      }
    });
  }
  async function cancelRun(runId) {
    await ready;
    const key = String(runId || '');
    if (!key) return { ok: false, error: '缺少运行标识' };
    const runs = await transaction(async () => {
      // Cancel exactly the run the caller owns. A window-level abort must never
      // take down other queued or running jobs of the same session.
      const job = state.jobs.find(j => j.runId === key && unfinished(j));
      if (!job) return [];
      job.cancelRequested = true;
      const running = job.status === 'running';
      if (!running) job.status = 'cancelled';
      await persist(); notify(job.sessionId);
      return running ? [job.runId] : [];
    });
    await Promise.all(runs.map(cancel));
    return { ok: true };
  }
  async function stop(id) {
    await ready;
    const runs = await transaction(async () => {
      const group = groupFor(id); if (group?.parentId === id) group.wake = false;
      const jobs = state.jobs.filter(j => j.sessionId === id && unfinished(j));
      for (const job of jobs) job.cancelRequested = true;
      for (const job of jobs) if (job.status === 'queued') job.status = 'cancelled';
      await persist(); return jobs.filter(j => j.status === 'running').map(j => j.runId);
    });
    await Promise.all(runs.map(cancel)); notify(id);
    return { ok: true };
  }
  async function inspect(id) {
    await ready; const group = groupFor(id);
    if (!group) throw Error('没有找到嵌套会话');
    return view(group);
  }
  function observe(id, runId, event) {
    if (!childFor(id)) return;
    let current = live.get(id);
    if (!current || current.runId !== runId) { current = { runId, parts: {}, permission: null, question: null }; live.set(id, current); }
    const data = event.properties || event.data || {};
    if (event.type === 'message.part.updated' && data.part?.type === 'text') current.parts[data.part.id] = data.part.text || '';
    if (event.type === 'message.part.delta' && data.field === 'text') current.parts[data.partID] = (current.parts[data.partID] || '') + (data.delta || '');
    if (event.type === 'permission.asked') current.permission = data;
    if (event.type === 'permission.replied') current.permission = null;
    if (event.type === 'question.asked') current.question = data;
    if (['question.replied', 'question.rejected'].includes(event.type)) current.question = null;
    changed({ id, nested: true, live: true });
  }
  async function command(id, input, policy) {
    switch (input.operation) {
      case 'dispatch': return dispatch(id, input, policy);
      case 'list': return inspect(id);
      case 'send': return send(id, input.session_id, input.message, input.request_key);
      case 'suspend': return suspend(id);
      case 'integrate': return integrate(id, input.session_id, input.result_id);
      default: throw Error('未知 Nested Sessions 操作');
    }
  }
  return { ready, dispatch, start, send, suspend, inspect, integrate, cancelRun, stop, pump, command, observe, background,
    isPending: id => state.jobs.some(j => j.sessionId === id && unfinished(j)),
    child: childFor, group: groupFor, close() { closed = true; },
    async guide(id, text, key = randomUUID()) {
      await ready;
      if (typeof text !== 'string' || !text.trim() || text.length > 32000 || typeof key !== 'string' || !key || key.length > 160) throw Error('消息无效');
      const result = await transaction(async () => {
        const group = groupFor(id);
        if (!childFor(id) || await isArchived(id)) throw Error('子会话不存在或已归档');
        const previous = group.guidance?.find(g => g.sessionId === id && g.key === key);
        if (previous) {
          if (previous.text !== text) throw Error('幂等键已用于不同消息');
          return { ok: true, runId: previous.runId, reused: true };
        }
        const job = state.jobs.find(j => j.sessionId === id && j.status === 'running' && !j.cancelRequested);
        if (!job || !busy(id)) return null;
        const accepted = await steer(job.runId, text);
        if (!accepted?.ok) return accepted || { ok: false, error: '引导未被接受，请稍后重试' };
        await append(id, { role: 'user', content: text, nestedSource: 'user' }, `guide:${key}`);
        (group.guidance ||= []).push({ sessionId: id, key, text, runId: job.runId });
        await persist(); notify(id);
        return accepted;
      });
      return result || send(id, id, text, key);
    }
  };
}
module.exports = { createNestedSessions };
