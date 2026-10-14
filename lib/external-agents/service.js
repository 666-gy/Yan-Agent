'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalize, PROVIDERS } = require('./preferences');
const { TERMINAL, hash, atomic, read, alive, canonical, workspaceKey, jobDir } = require('./storage');
const adapters = require('./adapters');
const { selectContinuation } = require('./sessions');
const MAX_INPUT_BYTES = 4 * 1024 * 1024;

class ExternalAgentService {
  constructor({ dataDir, loadConfig, launch, now = Date.now, historyOptions, reasonixConnect = require('./reasonix').connect }) {
    this.root = path.join(dataDir, 'external-agents', 'jobs');
    this.loadConfig = loadConfig;
    this.launch = launch === null ? null : launch || require('./launch').launch;
    this.now = now;
    this.reasonixConnect = reasonixConnect;
    this.history = new (require('./history').ExternalSessionHistory)(historyOptions);
    fs.mkdirSync(this.root, { recursive: true });
    this.timer = setInterval(() => { try { this.drain(); } catch (error) { console.error('[external-agents]', error.message); } }, 2000);
    this.timer.unref();
  }

  close() { clearInterval(this.timer); } // Closing Yan never cancels a worker.
  preferences() { return normalize(this.loadConfig().externalAgents); }
  historyProviders(params = {}) {
    const prefs = this.preferences();
    if (!prefs.enabled) throw new Error('请先在智能体设置中启用外部协同');
    if (params.provider && !PROVIDERS.includes(params.provider)) throw new Error('仅支持 Codex、Claude 和 Reasonix');
    if (params.scope && !['workspace', 'all'].includes(params.scope)) throw new Error('无效的历史会话范围');
    const providers = PROVIDERS.filter(provider => prefs.providers[provider].enabled && (!params.provider || params.provider === provider));
    if (!providers.length) throw new Error('请先启用要读取历史的 Agent');
    return providers;
  }
  async refreshReasonixHistory(providers) {
    if (!providers.includes('reasonix')) return;
    const client = await this.reasonixConnect(this.preferences().providers.reasonix.executable, { dataDir: path.resolve(this.root, '../..') });
    try {
      const tree = await client.request('/tree');
      const roots = [];
      for (const workspace of tree) {
        if (!path.isAbsolute(workspace.root || '')) continue;
        const groups = new Map();
        for (const session of workspace.sessions || []) {
          if (!path.isAbsolute(session.path || '') || !session.path.endsWith('.jsonl')) continue;
          const root = path.dirname(session.path);
          if (!groups.has(root)) groups.set(root, {});
          groups.get(root)[session.path] = { external_session_id: session.path, workspace: workspace.root,
            title: session.title || session.name || '', source: 'reasonix-studio', created_at: '', archived: session.archived === true };
        }
        for (const [root, sessions] of groups) roots.push({ provider: 'reasonix', root, depth: 0, sessions });
      }
      this.history.roots = [...this.history.roots.filter(root => root.provider !== 'reasonix'), ...roots];
      for (const [id, item] of this.history.cache) if (item.provider === 'reasonix') this.history.cache.delete(id);
    } finally { client.close(); }
  }
  listHistory(context, params = {}) {
    const providers = this.historyProviders(params);
    return this.listHistoryAsync(context, params, providers);
  }
  async listHistoryAsync(context, params, providers) {
    let warning;
    try { await this.refreshReasonixHistory(providers); }
    catch (error) { if (params.provider === 'reasonix') throw error; warning = error.message; }
    const result = await this.history.list(context, params, warning ? providers.filter(p => p !== 'reasonix') : providers);
    if (warning) result.warnings.push(`reasonix: ${warning}`);
    return result;
  }
  readHistory(context, params = {}) {
    const providers = this.historyProviders(params);
    return this.readHistoryAsync(context, params, providers);
  }
  async readHistoryAsync(context, params, providers) {
    const cached = this.history.cache.get(params.history_id);
    if (!cached || cached.provider === 'reasonix') {
      try { await this.refreshReasonixHistory(providers); }
      catch (error) { if (cached?.provider === 'reasonix') throw error; }
    }
    return this.history.read(context, params, providers);
  }
  records() {
    return fs.readdirSync(this.root).filter(id => /^[a-f0-9-]{36}$/.test(id)).map(id => {
      try { return this.record(id); } catch { return null; }
    }).filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
  }
  record(id) {
    const dir = jobDir(this.root, id);
    const request = read(path.join(dir, 'request.json'));
    const state = read(path.join(dir, 'state.json'));
    let launchPid;
    try { launchPid = read(path.join(dir, 'launch.json')).pid; } catch {}
    return { ...request, ...state, launchPid };
  }
  authorize(context, id) {
    const record = this.record(id);
    if (record.sessionId !== context.sessionId || workspaceKey(record.workspace) !== workspaceKey(canonical(context.workspace))) {
      throw new Error('该外部任务不属于当前 Yan 对话和工作区');
    }
    return record;
  }
  public(record) {
    return { job_id: record.id, provider: record.provider, title: record.title, workspace: record.workspace,
      status: record.status, terminal: TERMINAL.has(record.status), read_only: record.readOnly,
      request_key: record.requestKey, input_sha256: record.inputHash, input_bytes: record.inputBytes,
      depends_on: record.dependsOn, previous_job_id: record.previousJobId,
      created_at: record.createdAt, started_at: record.startedAt || null, ended_at: record.endedAt || null,
      last_activity_at: record.lastActivityAt || null, external_session_id: record.externalSessionId || '',
      reused_session: !!record.continuation, session_source_job_id: record.continuation?.sourceJobId || '',
      session_mode: record.sessionMode || 'auto', history_id: record.historyId || '',
      blocked_by: record.blockedBy || '',
      error: record.error || '', progress: record.progress || '', cancel_requested: record.cancelRequested === true,
      needs_attention: record.needsAttention === true, delivery_verified: record.deliveryVerified === true,
      delivery_sha256: record.deliveryHash || '', delivery_bytes: record.deliveryBytes || 0,
      elapsed_ms: Math.max(0, (record.endedAt || this.now()) - (record.startedAt || record.createdAt)) };
  }
  async status() {
    const prefs = this.preferences();
    return { enabled: prefs.enabled, max_concurrent: prefs.maxConcurrent,
      providers: await Promise.all(PROVIDERS.map(async provider => ({
        ...await adapters.probe(provider, prefs.providers[provider].executable, { dataDir: path.resolve(this.root, '../..') }), enabled: prefs.providers[provider].enabled
      }))) };
  }
  async delegate(context, params) {
    if (params.session_mode !== 'history') return this.dispatch(context, params);
    this.historyProviders({ provider: params.provider });
    if (!['codex', 'reasonix'].includes(params.provider) || typeof params.history_id !== 'string') throw new Error('指定历史续接支持 Codex 和 Reasonix，必须提供 history_id');
    // Preserve idempotency even if the original historical file later moves.
    const existing = this.records().some(record => record.sessionId === context.sessionId
      && workspaceKey(record.workspace) === workspaceKey(canonical(context.workspace)) && record.requestKey === params.request_key);
    if (existing) return this.dispatch(context, params);
    await this.refreshReasonixHistory([params.provider]);
    const binding = await this.history.continuation(context, params.history_id, params.provider);
    return this.dispatch(context, params, binding);
  }
  dispatch(context, params, historyBinding) {
    if (!context.sessionId) throw new Error('当前任务没有绑定 Yan 对话');
    const workspace = canonical(context.workspace);
    const provider = params.provider;
    if (!PROVIDERS.includes(provider)) throw new Error('仅支持 Codex、Claude 和 Reasonix');
    const sessionMode = params.session_mode || 'auto';
    if (!['auto', 'new', 'history'].includes(sessionMode)) throw new Error('无效的会话派发模式');
    if (sessionMode === 'history' && (!['codex', 'reasonix'].includes(provider) || !params.history_id)) throw new Error('历史续接需要 Codex 或 Reasonix history_id');
    if (sessionMode !== 'history' && params.history_id) throw new Error('history_id 必须配合 session_mode=history');
    const prompt = params.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('任务内容不能为空');
    if (typeof params.request_key !== 'string' || !params.request_key.trim() || params.request_key.length > 200) throw new Error('必须提供稳定的 request_key（最多 200 字符）');
    const records = this.records();
    const own = records.filter(record => record.sessionId === context.sessionId && workspaceKey(record.workspace) === workspaceKey(workspace));
    const fingerprint = hash(prompt.replace(/\r\n/g, '\n').trim());
    const duplicate = own.find(record => record.requestKey === params.request_key);
    if (duplicate) {
      if (duplicate.fingerprint !== fingerprint || duplicate.provider !== provider || (duplicate.sessionMode || 'auto') !== sessionMode || (duplicate.historyId || '') !== (params.history_id || '')) throw new Error('request_key 已用于不同的任务或目标会话，请使用原任务编号读取结果');
      return { ...this.public(duplicate), reused: true };
    }
    if (sessionMode === 'history' && (!historyBinding || historyBinding.historyId !== params.history_id)) throw new Error('指定历史会话尚未核验，请通过历史续接入口派发');
    const previous = params.previous_job_id ? this.authorize(context, params.previous_job_id) : null;
    if (previous && (!TERMINAL.has(previous.status) || typeof params.new_issue !== 'string' || !params.new_issue.trim())) {
      throw new Error('跟进必须等待上一任务结束，并说明新的问题 new_issue');
    }
    if (!previous && params.new_issue) throw new Error('新问题必须引用 previous_job_id');
    const same = own.find(record => record.fingerprint === fingerprint && (record.sessionMode || 'auto') === sessionMode && (record.historyId || '') === (params.history_id || ''));
    if (same) return { ...this.public(same), reused: true };
    if (!previous && !(params.depends_on || []).length && own.some(record => TERMINAL.has(record.status))) {
      throw new Error('该对话已有协同结果，请先读取并接受；如有新问题，必须引用 previous_job_id 并填写 new_issue，不能换正文或 Agent 重试');
    }
    // A provider failure never becomes permission to retry under another key.
    if (!previous && own.some(record => !TERMINAL.has(record.status) && record.provider === provider && !(params.depends_on || []).includes(record.id))) {
      throw new Error('该 Agent 已有未完成任务，请先等待结果；不要重新派发');
    }
    const prefs = this.preferences();
    if (!prefs.enabled || !prefs.providers[provider].enabled) throw new Error('请先在设置中启用所选 Agent');
    if (provider === 'reasonix') require('./reasonix').installation(prefs.providers.reasonix.executable);
    const dependsOn = [...new Set(params.depends_on || [])];
    if (dependsOn.length > 16) throw new Error('单个任务最多依赖 16 个任务');
    for (const id of dependsOn) this.authorize(context, id);
    const readOnly = params.read_only === true || context.readOnly === true;
    const id = crypto.randomUUID();
    const dir = jobDir(this.root, id);
    const input = [
      'You are an external subagent assisting Yan Agent. Complete only the assignment below. Do not delegate to other agents.',
      `Job: ${id}\nWorkspace: ${workspace}\nWork only in this workspace; do not switch projects or create another worktree. Continue in this desktop conversation; do not open another task or chat.`,
      readOnly ? 'READ ONLY: inspect and report; do not change files or run mutating commands.' : 'Preserve unrelated changes. Return changed files, checks performed, failures and remaining issues. Do not publish, push or deploy unless the assignment explicitly authorizes it.',
      previous ? `New issue following job ${previous.id}:\n${params.new_issue}` : '',
      context.prompt ? `Original user request (context):\n${context.prompt}` : '',
      'Complete assignment:', prompt
    ].filter(Boolean).join('\n\n');
    if (Buffer.byteLength(input, 'utf8') > MAX_INPUT_BYTES) throw new Error('任务超过 4 MiB；已拒绝派发，内容没有被截断');
    const request = { id, provider, transport: provider === 'reasonix' ? 'reasonix-host-v1' : 'desktop-gui-v1', workspace, sessionId: context.sessionId, runId: context.runId,
      title: String(params.title || prompt.split('\n')[0]).slice(0, 160), requestKey: params.request_key,
      fingerprint, inputHash: hash(input), inputBytes: Buffer.byteLength(input, 'utf8'), readOnly,
      dependsOn, previousJobId: previous?.id || '', executable: prefs.providers[provider].executable,
      sessionMode, historyId: params.history_id || '', historyBinding: historyBinding || null,
      createdAt: this.now() };
    fs.mkdirSync(dir, { recursive: true });
    // Save the complete payload before the job becomes visible to the scheduler.
    fs.writeFileSync(path.join(dir, 'input.txt'), input, { encoding: 'utf8', mode: 0o600 });
    atomic(path.join(dir, 'request.json'), request);
    atomic(path.join(dir, 'state.json'), { status: 'queued' });
    this.drain();
    return this.public(this.record(id));
  }

  drain() {
    const records = this.records();
    if (!records.some(record => !TERMINAL.has(record.status))) return;
    for (const record of records) {
      if (!['running', 'starting', 'uncertain'].includes(record.status)) continue;
      const heartbeat = record.heartbeatAt || record.startedAt;
      if (!heartbeat || this.now() - heartbeat < 30000) continue;
      if (!alive(record.workerPid) && !alive(record.launchPid)) {
        const latest = read(path.join(jobDir(this.root, record.id), 'state.json'));
        // The worker can finish between the scan and the liveness probe. A
        // stale recovery snapshot must never overwrite its terminal result.
        if (TERMINAL.has(latest.status) || this.now() - (latest.heartbeatAt || latest.startedAt || 0) < 30000) {
          Object.assign(record, latest);
          continue;
        }
        if (record.transport === 'desktop-gui-v1' && this.launch) {
          // Relaunch only the journal supervisor. Its durable action markers
          // forbid reopening a draft or clicking Send a second time.
          const resumed = { ...latest, status: 'uncertain', heartbeatAt: this.now(), progress: '恢复原桌面会话监听，不会重新发送任务' };
          atomic(path.join(jobDir(this.root, record.id), 'state.json'), resumed);
          try {
            const pid = this.launch(jobDir(this.root, record.id));
            atomic(path.join(jobDir(this.root, record.id), 'launch.json'), { pid: pid || null });
          } catch (error) { atomic(path.join(jobDir(this.root, record.id), 'state.json'), { ...resumed, error: error.message }); }
          Object.assign(record, resumed); continue;
        }
        // Legacy processes may still be working; never redispatch them.
        const status = record.provider === 'reasonix' || alive(record.childPid) || !record.workerPid ? 'uncertain' : 'interrupted';
        const state = { ...latest, status,
          error: status === 'uncertain' ? '工作进程失联，外部 Agent 可能仍在运行；不会自动重发' : '工作进程已退出，未收到最终结果；不会自动重发',
          ...(status === 'interrupted' ? { endedAt: this.now() } : {}) };
        atomic(path.join(jobDir(this.root, record.id), 'state.json'), state);
        Object.assign(record, state);
      }
    }
    const queued = records.filter(item => item.status === 'queued');
    if (!queued.length) return;
    const prefs = this.preferences();
    const active = records.filter(record => ['starting', 'running', 'uncertain'].includes(record.status));
    for (const record of queued) {
      const dir = jobDir(this.root, record.id);
      if (!this.launch) {
        atomic(path.join(dir, 'state.json'), { status: 'blocked', endedAt: this.now(), error: adapters.GUI_UNAVAILABLE });
        continue;
      }
      const dependencies = record.dependsOn.map(id => records.find(item => item.id === id));
      if (!prefs.enabled || !prefs.providers[record.provider].enabled || dependencies.some(dep => !dep || (TERMINAL.has(dep.status) && dep.status !== 'succeeded'))) {
        atomic(path.join(dir, 'state.json'), { status: 'blocked', endedAt: this.now(), error: '协同已关闭，或前置任务未成功；未派发该任务' });
        continue;
      }
      if (dependencies.some(dep => dep.status !== 'succeeded')) continue;
      const blocker = active.find(other => workspaceKey(other.workspace) === workspaceKey(record.workspace)
        || (other.provider === record.provider && record.transport === 'desktop-gui-v1')) || (active.length >= prefs.maxConcurrent ? active[0] : null);
      if (blocker) {
        const progress = `等待 ${blocker.provider} 前置任务 ${blocker.id} 释放派发队列${blocker.needsAttention ? '；该任务需要处理桌面提示' : ''}`;
        const latest = read(path.join(dir, 'state.json'));
        if (latest.progress !== progress || latest.blockedBy !== blocker.id) atomic(path.join(dir, 'state.json'), { ...latest, progress, blockedBy: blocker.id });
        continue;
      }
      // The marker is durable BEFORE spawning. Recovery never dispatches it a
      // second time, even if Yan crashes before it can observe the child PID.
      // Resolve only when the job actually starts: a queued predecessor may
      // have established the workspace's first desktop session in the meantime.
      // Freeze the choice before launch; a supervisor restart uses this binding.
      const state = { status: 'starting', startedAt: this.now(), heartbeatAt: this.now(),
        continuation: record.sessionMode === 'new' ? null : record.sessionMode === 'history' ? record.historyBinding : selectContinuation(record, records) };
      atomic(path.join(dir, 'state.json'), state);
      let launched = false;
      try {
        const launchPid = this.launch(dir);
        launched = true;
        atomic(path.join(dir, 'launch.json'), { pid: launchPid || null });
      } catch (error) {
        const latest = read(path.join(dir, 'state.json'));
        if (!TERMINAL.has(latest.status)) atomic(path.join(dir, 'state.json'), { ...latest,
          status: launched ? 'uncertain' : 'failed', ...(launched ? {} : { endedAt: this.now() }), error: error.message });
      }
      active.push(record);
    }
  }
  list(context) {
    this.drain();
    return this.records().filter(record => !context || (record.sessionId === context.sessionId && workspaceKey(record.workspace) === workspaceKey(canonical(context.workspace))))
      .map(record => this.public(record));
  }
  async wait(context, ids, waitMs = 60000) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 16) throw new Error('请提供 1 到 16 个外部任务编号');
    const deadline = Date.now() + Math.max(0, Math.min(60000, Number(waitMs) || 0));
    while (true) {
      this.drain();
      const jobs = ids.map(id => this.public(this.authorize(context, id)));
      if (jobs.every(job => job.terminal) || Date.now() >= deadline) return {
        jobs, all_terminal: jobs.every(job => job.terminal), wait_expired: jobs.some(job => !job.terminal),
        next_wait_cursor: crypto.randomUUID(),
        instruction: '等待结束不代表任务结束；继续等待原 job_id，将 next_wait_cursor 传给下一次 wait_cursor，不要重发任务。'
      };
      await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(1, deadline - Date.now()))));
    }
  }
  result(context, id, offset = 0, limit = 16000) {
    const record = context ? this.authorize(context, id) : this.record(id);
    const dir = jobDir(this.root, id);
    let output = '';
    try { output = fs.readFileSync(path.join(dir, 'result.txt'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    offset = Math.max(0, Math.floor(Number(offset) || 0));
    limit = Math.max(1, Math.min(32000, Math.floor(Number(limit) || 16000)));
    let end = Math.min(output.length, offset + limit);
    if (end < output.length && /[\uD800-\uDBFF]/.test(output[end - 1])) end++;
    return { ...this.public(record), output: output.slice(offset, end), offset,
      next_offset: end < output.length ? end : null, total_chars: output.length };
  }
  cancel(context, id) {
    const record = context ? this.authorize(context, id) : this.record(id);
    if (TERMINAL.has(record.status)) return this.public(record);
    const dir = jobDir(this.root, id);
    if (record.status === 'uncertain' && !alive(record.workerPid)) throw new Error('工作进程失联，无法确认停止。请在外部 Agent 中检查并停止原任务；Yan 不会重新派发。');
    if (record.status === 'queued') atomic(path.join(dir, 'state.json'), { status: 'cancelled', endedAt: this.now() });
    else atomic(path.join(dir, 'cancel.json'), { requestedAt: this.now() });
    return { ...this.public(this.record(id)), cancel_requested: true };
  }
  acknowledgeStopped(id) {
    const record = this.record(id);
    if (record.status !== 'uncertain') throw new Error('仅失联任务需要手动确认');
    if (record.transport !== 'desktop-gui-v1' && (alive(record.workerPid) || alive(record.launchPid) || alive(record.childPid))) throw new Error('检测到原工作进程仍在运行，请先停止外部任务');
    const file = path.join(jobDir(this.root, id), 'state.json');
    atomic(file, { ...read(file), status: 'interrupted', endedAt: this.now(),
      error: '用户已确认外部任务停止；结果未确认，不会自动重发' });
    return this.public(this.record(id));
  }
}
module.exports = { ExternalAgentService, MAX_INPUT_BYTES };
