'use strict';
const fs = require('fs');
const path = require('path');
const { atomic, read, hash, TERMINAL, alive, canonical, workspaceKey } = require('./storage');
const { connect } = require('./reasonix');
const { prepare } = require('./payload');

async function run(dir, { connectHost = connect, interval = 1000 } = {}) {
  const file = path.join(dir, 'state.json'), request = read(path.join(dir, 'request.json'));
  if (TERMINAL.has(read(file).status)) return;
  const lock = path.join(dir, 'worker.lock');
  if (fs.existsSync(lock)) {
    if (alive(read(lock).pid)) return;
    fs.unlinkSync(lock);
  }
  try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') return; throw error; }
  const update = patch => { const old = read(file); if (!TERMINAL.has(old.status)) atomic(file, { ...old, ...patch, workerPid: process.pid, heartbeatAt: Date.now() }); };
  let client, heartbeat;
  const intent = path.join(dir, 'assignment-send.intent');
  try {
    if (fs.existsSync(intent)) throw new Error('Reasonix 发送已有记录，原连接中断后不会重发；请检查 Reasonix 历史');
    heartbeat = setInterval(() => update({}), 2000);
    const input = fs.readFileSync(path.join(dir, 'input.txt'), 'utf8');
    if (hash(input) !== request.inputHash || Buffer.byteLength(input) !== request.inputBytes) throw new Error('任务内容校验失败');
    const payload = prepare(dir, request, input);
    client = await connectHost(request.executable, { dataDir: path.resolve(dir, '../../..') });
    const binding = request.sessionMode === 'history' ? request.historyBinding : null;
    if (binding) await require('./history').validateReasonixTarget(binding, request.workspace);
    update({ progress: binding ? '已连接 RS 桌面，正在核验指定历史会话' : '已连接 RS 桌面，正在查找当前工作区的空白会话' });
    if (binding) {
      const tree = await client.request('/tree');
      const target = tree.find(w => workspaceKey(w.root) === workspaceKey(request.workspace))?.sessions?.find(s => workspaceKey(s.path) === workspaceKey(binding.journalFile));
      if (!target || target.archived) throw new Error('指定 Reasonix 历史会话已不存在或已归档');
    }
    const runtimes = await client.request('/runtimes');
    let runtime, empty;
    for (const candidate of Array.isArray(runtimes) ? runtimes : []) {
      if (!/^\/rt\/[A-Za-z0-9_-]+$/.test(candidate.base || '') ||
          workspaceKey(canonical(candidate.root)) !== workspaceKey(request.workspace)) continue;
      const state = await client.request(candidate.base + '/status');
      if (binding && state.sessionPath && workspaceKey(state.sessionPath) === workspaceKey(binding.journalFile)) {
        if (state.running || candidate.readOnly || state.readOnly) throw new Error('指定 RS 历史会话仍在运行或只读，尚未发送');
        runtime = candidate; break;
      }
      if (state.running || candidate.readOnly || state.readOnly || state.sessionPath) continue;
      const history = await client.request(candidate.base + '/history');
      if (Array.isArray(history) && history.every(message => message.role === 'system')) empty ||= candidate;
    }
    if (!runtime) {
      runtime = empty;
      if (!runtime) throw new Error('请在 RS 桌面打开目标历史会话或当前工作区的空白会话，再派发；不会占用其他聊天');
      if (binding) await client.request(runtime.base + '/resume', { path: binding.journalFile });
    }
    const status = await client.request(runtime.base + '/status');
    if (status.running || status.readOnly || workspaceKey(canonical(status.workspaceRoot)) !== workspaceKey(request.workspace)) throw new Error('Reasonix 会话正在运行、只读或工作区不匹配');
    if (binding && workspaceKey(status.sessionPath || '') !== workspaceKey(binding.journalFile)) throw new Error('RS 载入的历史会话与指定目标不符');
    update({ externalSessionId: runtime.id, runtimeBase: runtime.base, deliveryHash: payload.sha256, deliveryBytes: payload.bytes });
    let done, streamError, attention = false, sent = false, cancelSent = false;
    const stream = await client.events(runtime.base, event => {
      if (!sent) return;
      update({ lastActivityAt: Date.now() });
      if (event.kind === 'turn_done') done = event;
      if (['approval_request', 'ask_user', 'ask_request', 'plan_approval'].includes(event.kind)) attention = true;
    });
    stream.finished.then(() => { if (!done) streamError = new Error('Reasonix 事件连接已关闭'); }, () => { streamError = new Error('Reasonix 事件连接中断，未自动重发'); });
    if (fs.existsSync(path.join(dir, 'cancel.json'))) { update({ status: 'cancelled', endedAt: Date.now() }); return; }
    const beforeSend = await client.request(runtime.base + '/history');
    if (!Array.isArray(beforeSend) || (!binding && beforeSend.some(message => message.role !== 'system'))) throw new Error('RS 空白会话已被使用，尚未发送任务');
    if (binding) await require('./history').validateReasonixTarget(binding, request.workspace);
    const liveRuntime = (await client.request('/runtimes')).find(item => item.id === runtime.id);
    if (!liveRuntime || liveRuntime.readOnly) throw new Error('RS 目标会话已关闭或只读，尚未发送');
    const finalStatus = await client.request(runtime.base + '/status');
    if (finalStatus.running || finalStatus.readOnly || (binding && workspaceKey(finalStatus.sessionPath || '') !== workspaceKey(binding.journalFile))) throw new Error('RS 会话状态已变化，尚未发送任务');
    const baselineCount = beforeSend.length;
    fs.writeFileSync(intent, String(Date.now()), { flag: 'wx', mode: 0o600 });
    sent = true;
    await client.request(runtime.base + '/submit', { input: payload.text });
    update({ status: 'running', progress: 'Reasonix 已接收任务，正在等待结果', deliveryVerified: true });
    while (!done) {
      if (streamError) throw streamError;
      if (!cancelSent && fs.existsSync(path.join(dir, 'cancel.json'))) {
        await client.request(runtime.base + '/cancel', {});
        cancelSent = true;
        update({ progress: '已请求停止 RS 任务，等待桌面确认' });
      }
      if (attention) update({ needsAttention: true, progress: '请在 RS 桌面处理审批或输入请求，Yan 正在实时监听' });
      await new Promise(resolve => setTimeout(resolve, interval));
      const current = await client.request(runtime.base + '/status');
      attention = Array.isArray(current.decisions) && current.decisions.some(d => !d.resolvedAt && !d.outcome);
      update({ needsAttention: attention });
      if (current.sessionPath) update({ externalSessionId: current.sessionPath });
    }
    const messages = await client.request(runtime.base + '/history');
    if (!Array.isArray(messages) || !messages.some(m => m.role === 'user' && m.content === payload.text)) throw new Error('Reasonix 未返回完整任务接收记录');
    const start = messages.findIndex((m, index) => index >= baselineCount && m.role === 'user' && m.content === payload.text);
    if (start < 0) throw new Error('RS 未返回本轮任务记录');
    const following = messages.slice(start + 1);
    const nextUser = following.findIndex(m => m.role === 'user');
    const turn = nextUser < 0 ? following : following.slice(0, nextUser);
    const output = turn.filter(m => m.role === 'assistant' && typeof m.content === 'string').map(m => m.content).join('\n\n');
    fs.writeFileSync(path.join(dir, 'result.txt'), output, { mode: 0o600 });
    update({ needsAttention: false, status: done.cancelled ? 'cancelled' : done.err ? 'failed' : 'succeeded', endedAt: Date.now(),
      error: typeof done.err === 'string' ? done.err.slice(0, 2000) : '', progress: 'Reasonix 会话已返回结果', deliveryVerified: true });
  } catch (error) {
    update({ status: fs.existsSync(intent) ? 'uncertain' : 'blocked', ...(fs.existsSync(intent) ? {} : { endedAt: Date.now() }), error: error.message, progress: fs.existsSync(intent) ? '与 RS 桌面的连接中断，任务可能仍在运行；请检查桌面，不会自动重发' : '尚未发送任务，请检查 RS 桌面连接' });
  } finally {
    clearInterval(heartbeat); client?.close();
    try { fs.unlinkSync(lock); } catch {}
  }
}
module.exports = { run };
