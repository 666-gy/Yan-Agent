'use strict';
const crypto = require('node:crypto');

// Commands belong to desktop sessions, not to an individual model turn or its
// AbortSignal. Completing a turn must not terminate outstanding shell work.
class BackgroundBash {
  constructor({ execute, changed = () => {}, wake, busy = () => false, acquireLock, persist = () => {}, wakeRetryMs = 1000, quietMs = 1500 }) {
    Object.assign(this, { execute, changed, wake, busy, acquireLock, persist, wakeRetryMs, quietMs });
    this.jobs = new Map(); this.runs = new Map(); this.pending = new Set();
    this.waking = new Set(); this.autoWoken = new Map(); this.closed = false;
    this.continuations = new Map();
    this.timer = setInterval(() => { void this.flush(); }, 500);
    this.timer.unref?.();
  }
  register(runId, request) {
    const { history, openCodeConfig, prompt, memoryContext, harnessContext, attachments, sessions, delegationReportActivations, ...owner } = request;
    this.runs.set(runId, { ...owner, registeredAt: Date.now(), runId, sessions: new Set(), cancelled: false, settled: false });
    // A user-initiated turn owns the conversation again. Its context already
    // covers anything that finished earlier, so those completions must not
    // open a competing turn; they stay visible on the job card instead.
    if (!request.backgroundBashWake && !request.utility && request.yanSessionId) this.beginIdlePeriod(request.yanSessionId);
    // Keep active/pending owners; remove old run metadata with no retained jobs.
    if (this.runs.size > 256) for (const [id, run] of this.runs) {
      if (run.settled && !this.continuations.has(id) && ![...this.jobs.values()].some(job => job.runId === id)) this.runs.delete(id);
    }
  }
  // Starting an idle period drops the auto-continue budget and folds pending
  // completions into the turn the user just started.
  beginIdlePeriod(sessionId) {
    this.autoWoken.delete(sessionId);
    // A new user turn recovers unreported child metadata itself.
    for (const id of this.continuations.keys()) if (this.runs.get(id)?.yanSessionId === sessionId) this.continuations.delete(id);
    for (const id of [...this.pending]) {
      const job = this.jobs.get(id);
      if (!job || job.sessionId !== sessionId) continue;
      this.pending.delete(id); job.wakeStatus = 'folded';
      this.notify(job);
    }
  }
  restore(records) {
    for (const record of records) {
      if (!record?.id || !record.sessionId) continue;
      const interrupted = record.status === 'running';
      const status = interrupted ? 'interrupted' : record.status;
      this.jobs.set(record.id, { ...record, status, phase: status, background: record.background === true,
        endedAt: record.endedAt || Date.now(),
        result: { exit: record.exit ?? null, output: record.output || '', truncated: record.truncated === true,
          error: interrupted ? '应用退出时命令尚未确认完成；已保留输出，请检查实际结果，不要自动重跑。' : record.error },
        wakeStatus: ['pending', ''].includes(record.wakeStatus) ? 'failed' : record.wakeStatus,
        wakeError: '此任务来自上次运行，可查看保存的输出。' });
    }
  }
  observe(runId, event) {
    const run = this.runs.get(runId); if (!run) return;
    const data = event.data || event.properties || {};
    if (event.type === 'yan.subagent.delivered') {
      const delivered = new Set(data.activationIds || []);
      for (const owner of this.runs.values()) {
        if (owner.yanSessionId !== run.yanSessionId) continue;
        owner.delegationDelivered ||= new Set();
        for (const id of delivered) owner.delegationDelivered.add(id);
        const pending = this.continuations.get(owner.runId);
        if (pending?.reports.some(report => delivered.has(report.activationId))) {
          pending.reports = pending.reports.filter(report => !delivered.has(report.activationId));
          if (!pending.reports.length) this.continuations.delete(owner.runId);
        }
      }
      return;
    }
    if (event.type === 'yan.subagent.event') {
      const nested = data.event;
      const inner = nested?.data || nested?.properties || {};
      if (nested?.type === 'yan.opencode.started' && inner.sessionID) run.sessions.add(inner.sessionID);
      return;
    }
    if (event.type === 'yan.opencode.started') {
      run.openCodeSessionId = data.sessionID; run.sessions.add(data.sessionID);
    }
    if (data.part?.type === 'tool' && data.part.sessionID) run.sessions.add(data.part.sessionID);
  }
  owner(sessionID) {
    return [...this.runs.values()].reverse().find(run => !run.settled && !run.cancelled && run.sessions.has(sessionID));
  }
  settled(runId) {
    const run = this.runs.get(runId); if (run) run.settled = true;
    void this.flush();
  }
  continueTask(runId, reports) {
    reports = reports?.filter(report => !this.runs.get(runId)?.delegationDelivered?.has(report.activationId));
    if (this.closed || !reports?.length || this.runs.get(runId)?.cancelled || this.continuations.has(runId)) return;
    this.continuations.set(runId, { reports, attempts: 0, nextAt: 0 });
  }
  async flushContinuations() {
    for (const [id, pending] of this.continuations) {
      const owner = this.runs.get(id);
      if (!owner || owner.cancelled || this.closed) { this.continuations.delete(id); continue; }
      const sessionId = owner.yanSessionId;
      if (!owner.settled || this.busy(sessionId) || this.waking.has(sessionId) || Date.now() < pending.nextAt) continue;
      this.waking.add(sessionId);
      try {
        const result = await this.wake(owner, [], { type: 'delegation', reports: pending.reports });
        if (result?.ok || result?.discard) this.continuations.delete(id);
        else throw new Error(result?.error || 'Waiting for previous turn persistence');
      } catch (error) {
        pending.nextAt = Date.now() + Math.min(30000, this.wakeRetryMs * 2 ** Math.min(++pending.attempts, 5));
        if (pending.attempts >= 12) { this.continuations.delete(id); console.error('[delegation] continuation failed:', error.message); }
      } finally { this.waking.delete(sessionId); }
    }
  }
  public(job, output = false) {
    const result = job.result || (output ? job.control?.snapshot() : null) || {};
    return { id: job.id, sessionId: job.sessionId, runId: job.runId, command: job.command, cwd: job.cwd, phase: job.phase,
      status: job.status, background: job.background, startedAt: job.startedAt, endedAt: job.endedAt || null,
      exit: result.exit ?? null, error: result.error || '', truncated: result.truncated === true,
      wakeStatus: job.wakeStatus || '', wakeError: job.wakeError || '', onComplete: job.onComplete || 'detach',
      waitingFor: job.waitingFor || [], waitMs: job.phase === 'queued' ? Date.now() - job.startedAt : 0,
      ...(output ? { output: result.output || '' } : {}) };
  }
  list(sessionId) {
    return [...this.jobs.values()].filter(job => !sessionId || job.sessionId === sessionId).map(job => this.public(job));
  }
  get(id, sessionId) {
    const job = this.jobs.get(id);
    if (!job || (sessionId && job.sessionId !== sessionId)) throw new Error('Bash 任务不存在');
    return job;
  }
  notify(job) {
    for (const callback of [() => this.changed(this.public(job)), () => this.persist(this.public(job, true))]) {
      try { callback(); } catch (error) { console.error('[bash] notification failed:', error.message); }
    }
  }
  async start(owner, args) {
    if (this.closed || owner.cancelled || owner.settled) throw new Error('任务已停止');
    // Child sessions can reuse the same provider tool-call ID; the session
    // must be part of the identity or one child's command is silently reused.
    const childSessionID = args.sessionID && args.sessionID !== owner.openCodeSessionId ? args.sessionID : '';
    // Never execute twice when the plugin retries a transport request.
    const existing = [...this.jobs.values()].find(job => job.runId === owner.runId
      && job.childSessionID === childSessionID && job.callID === args.callID && args.callID);
    if (existing) return existing.foreground;
    for (const [id, job] of this.jobs) {
      if (this.jobs.size < 128) break;
      // Finished jobs from any session are reclaimable. Restricting this to
      // the caller's own childSessionID let finished main-session jobs fill the
      // global 128 cap and reject every child Bash call.
      if (job.status !== 'running' && !this.pending.has(id)) this.jobs.delete(id);
    }
    if (this.jobs.size >= 128) throw new Error('Bash 任务数量已达上限');
    const running = [...this.jobs.values()].filter(job => job.status === 'running');
    if (childSessionID && (running.filter(job => job.childSessionID === childSessionID).length >= 16
      || running.filter(job => job.childSessionID).length >= 96)) throw new Error('子代理 Bash 配额已满；等待已有命令完成，主任务保留独立容量');
    const job = { id: crypto.randomUUID(), sessionId: owner.yanSessionId, runId: owner.runId,
      childSessionID,
      callID: args.callID, command: args.command, cwd: args.cwd, status: 'running',
      onComplete: args.onComplete === 'resume' ? 'resume' : 'detach',
      background: false, phase: 'queued', startedAt: Date.now(), controller: new AbortController() };
    this.jobs.set(job.id, job); this.notify(job);
    const supervisorName = process.platform === 'win32' ? `Local\\YanShell-${job.id}` : undefined;
    const finish = result => {
      job.releaseLock?.(); job.releaseLock = null;
      if (!this.jobs.has(job.id) || job.status !== 'running') return;
      job.result = result; job.endedAt = Date.now(); job.control = null;
      job.status = result.cancelled ? 'cancelled' : (!result.error && result.exit === 0 ? 'succeeded' : 'failed');
      job.phase = job.status;
      if (job.background && job.status !== 'cancelled' && !owner.cancelled && !this.closed) {
        // Only a job that declared it needs its result may open another turn.
        if ((job.onComplete || 'detach') === 'resume') { this.pending.add(job.id); job.wakeStatus = 'pending'; }
        else job.wakeStatus = 'detached';
      }
      this.notify(job); void this.flush();
    };
    const launch = () => { job.controller.signal.throwIfAborted(); job.phase = 'executing'; job.waitingFor = []; this.notify(job); return this.execute({ ...args, supervisorName, signal: job.controller.signal, backgroundOnTimeout: true,
      onOutput: () => { if (Date.now() - (job.lastOutputAt || 0) >= 250) { job.lastOutputAt = Date.now(); this.notify(job); } },
      onControl: control => { job.control = control; if (job.backgroundRequested) control.background(); },
      onBackgroundComplete: finish
    }); };
    const execute = () => { try { return Promise.resolve(launch()); } catch (error) { return Promise.reject(error); } };
    // A general terminal is not a filesystem transaction. Dev servers and
    // unrelated commands must not hold a user-global write lock. Callers can
    // explicitly serialize known write targets against native write/edit.
    const scopes = args.mutationPaths || [];
    const operation = (this.acquireLock && scopes.length ? this.acquireLock(scopes, { signal: job.controller.signal,
      owner: `${owner.runId}/${job.id}`, supervisorName, waitMs: 30000,
      onWait: holders => { job.waitingFor = holders; this.notify(job); } }).then(release => {
        job.releaseLock = release;
        job.controller.signal.throwIfAborted();
        return execute();
      }) : execute()).then(result => {
      if (!this.jobs.has(job.id)) return { ...result, jobId: job.id };
      if (result.background) {
        job.background = true; this.notify(job);
      } else finish(result);
      return { ...result, exit: result.exit ?? null, truncated: result.truncated === true, jobId: job.id };
    }).catch(error => {
      finish({ error: error.message, cancelled: error.name === 'AbortError' }); throw error;
    });
    // The foreground budget covers admission as well as execution, and is
    // shorter than the HTTP headers timeout. A queued job remains inspectable.
    const budget = args.background ? 0 : Math.min(10000, Math.max(1, Number(args.timeout) || 10000));
    let timer;
    job.foreground = Promise.race([operation, new Promise(resolve => {
      timer = setTimeout(() => {
        job.backgroundRequested = true; job.background = true;
        job.control?.background(); this.notify(job);
        const snapshot = job.control?.snapshot() || {};
        resolve({ ...snapshot, exit: null, truncated: snapshot.truncated === true,
          timedOut: false, background: true, phase: job.phase, jobId: job.id, waitingFor: job.waitingFor || [],
          output: job.phase === 'queued' ? 'Waiting for a declared file mutation lease (maximum 30 seconds). Use bash_status; do not rerun.' : snapshot.output || '' });
      }, budget);
    })]).finally(() => clearTimeout(timer));
    return job.foreground;
  }
  cancel(id, sessionId) {
    const job = this.get(id, sessionId);
    this.pending.delete(id); job.wakeStatus = 'suppressed';
    if (job.status === 'running') job.controller.abort();
    this.notify(job); return this.public(job);
  }
  cancelSession(sessionId) {
    for (const owner of this.runs.values()) if (owner.yanSessionId === sessionId) owner.cancelled = true;
    for (const id of this.continuations.keys()) if (this.runs.get(id)?.yanSessionId === sessionId) this.continuations.delete(id);
    for (const job of this.jobs.values()) if (job.sessionId === sessionId) this.cancel(job.id);
  }
  purgeSession(sessionId) {
    this.cancelSession(sessionId);
    for (const [id, job] of this.jobs) if (job.sessionId === sessionId) { this.pending.delete(id); this.jobs.delete(id); }
    for (const [id, owner] of this.runs) if (owner.yanSessionId === sessionId) this.runs.delete(id);
    this.persist(null, sessionId);
  }
  cancelRun(runId) { const owner = this.runs.get(runId); if (owner) this.cancelSession(owner.yanSessionId); }
  async flush() {
    if (this.closed) return;
    for (const [id, owner] of this.runs) {
      if (Date.now() - owner.registeredAt > 86400000 && !this.busy(owner.yanSessionId)
        && !this.continuations.has(id) && ![...this.jobs.values()].some(job => job.runId === id)) this.runs.delete(id);
    }
    if (this.continuations.size) await this.flushContinuations();
    for (const id of [...this.pending]) {
      const job = this.jobs.get(id), owner = job && this.runs.get(job.runId);
      if (!job || !owner || owner.cancelled) { this.pending.delete(id); continue; }
      const sessionId = job.sessionId, now = Date.now();
      if (!owner.settled || this.busy(sessionId) || this.waking.has(sessionId) || now < (job.nextWakeAt || 0)) continue;
      // Let a burst of completions settle into one continuation instead of one turn each.
      if (now - (job.endedAt || 0) < this.quietMs) continue;
      this.waking.add(sessionId);
      const batch = [...this.pending].map(key => this.jobs.get(key)).filter(item => item?.runId === owner.runId && now >= (item.nextWakeAt || 0)).slice(0, 8);
      // One automatic continuation per idle period; retries of the same batch stay allowed.
      const seen = this.autoWoken.get(sessionId);
      if (!batch.length || (seen && !batch.some(item => seen.has(item.id)))) { this.waking.delete(sessionId); continue; }
      this.autoWoken.set(sessionId, new Set([...(seen || []), ...batch.map(item => item.id)]));
      const retry = message => {
        for (const item of batch) {
          if (!this.pending.has(item.id) || owner.cancelled || this.closed) continue;
          item.wakeAttempts = (item.wakeAttempts || 0) + 1;
          item.wakeError = message || '等待任务结果保存后继续';
          item.nextWakeAt = Date.now() + Math.min(30000, this.wakeRetryMs * 2 ** Math.min(item.wakeAttempts - 1, 5));
          if (item.wakeAttempts >= 12) { this.pending.delete(item.id); item.wakeStatus = 'failed'; }
          this.notify(item);
        }
      };
      try {
        const result = await this.wake(owner, batch.map(item => this.public(item, true)));
        if (owner.cancelled || this.closed) continue;
        if (result?.ok) {
          for (const item of batch) { if (!this.pending.delete(item.id)) continue; item.wakeStatus = 'delivered'; item.wakeError = ''; this.notify(item); }
        } else if (result?.discard) {
          for (const item of batch) { if (!this.pending.delete(item.id)) continue; item.wakeStatus = 'suppressed'; this.notify(item); }
        } else retry(result?.error);
      } catch (error) {
        retry(error.message);
      }
      finally { this.waking.delete(sessionId); }
    }
  }
  close() {
    this.closed = true; clearInterval(this.timer); this.pending.clear();
    this.continuations.clear();
    for (const job of this.jobs.values()) if (job.status === 'running') job.controller.abort();
  }
}
module.exports = { BackgroundBash };
