'use strict';
const crypto = require('node:crypto');

// Commands belong to desktop sessions, not to an individual model turn or its
// AbortSignal. Completing a turn must not terminate outstanding shell work.
class BackgroundBash {
  constructor({ execute, changed = () => {}, wake, busy = () => false }) {
    Object.assign(this, { execute, changed, wake, busy });
    this.jobs = new Map(); this.runs = new Map(); this.pending = new Set();
    this.waking = new Set(); this.closed = false;
    this.timer = setInterval(() => { void this.flush(); }, 500);
    this.timer.unref?.();
  }
  register(runId, request) {
    this.runs.set(runId, { ...request, runId, sessions: new Set(), cancelled: false });
    // Keep active/pending owners; remove old run metadata with no retained jobs.
    if (this.runs.size > 256) for (const [id, run] of this.runs) {
      if (run.settled && ![...this.jobs.values()].some(job => job.runId === id)) this.runs.delete(id);
    }
  }
  observe(runId, event) {
    const run = this.runs.get(runId); if (!run) return;
    const data = event.data || event.properties || {};
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
  public(job, output = false) {
    const result = job.result || job.control?.snapshot() || {};
    return { id: job.id, sessionId: job.sessionId, runId: job.runId, command: job.command, cwd: job.cwd,
      status: job.status, background: job.background, startedAt: job.startedAt, endedAt: job.endedAt || null,
      exit: result.exit ?? null, error: result.error || '', truncated: result.truncated === true,
      wakeStatus: job.wakeStatus || '', wakeError: job.wakeError || '',
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
  notify(job) { this.changed(this.public(job)); }
  async start(owner, args) {
    if (this.closed || owner.cancelled || owner.settled) throw new Error('任务已停止');
    // Never execute twice when the plugin retries a transport request.
    const existing = [...this.jobs.values()].find(job => job.runId === owner.runId && job.callID === args.callID && args.callID);
    if (existing) return existing.foreground;
    for (const [id, job] of this.jobs) {
      if (this.jobs.size < 128) break;
      if (job.status !== 'running' && !this.pending.has(id)) this.jobs.delete(id);
    }
    if (this.jobs.size >= 128) throw new Error('Bash 任务数量已达上限');
    const job = { id: crypto.randomUUID(), sessionId: owner.yanSessionId, runId: owner.runId,
      callID: args.callID, command: args.command, cwd: args.cwd, status: 'running',
      background: false, startedAt: Date.now(), controller: new AbortController() };
    this.jobs.set(job.id, job); this.notify(job);
    const finish = result => {
      if (!this.jobs.has(job.id) || job.status !== 'running') return;
      job.result = result; job.endedAt = Date.now(); job.control = null;
      job.status = result.cancelled ? 'cancelled' : (!result.error && result.exit === 0 ? 'succeeded' : 'failed');
      if (job.background && job.status !== 'cancelled' && !owner.cancelled && !this.closed) {
        this.pending.add(job.id); job.wakeStatus = 'pending';
      }
      this.notify(job); void this.flush();
    };
    job.foreground = this.execute({ ...args, signal: job.controller.signal, backgroundOnTimeout: true,
      onControl: control => { job.control = control; if (job.backgroundRequested) control.background(); },
      onBackgroundComplete: finish
    }).then(result => {
      if (!this.jobs.has(job.id)) return { ...result, jobId: job.id };
      if (result.background) {
        job.background = true; this.notify(job);
      } else finish(result);
      return { ...result, jobId: job.id };
    }).catch(error => {
      finish({ error: error.message, cancelled: error.name === 'AbortError' }); throw error;
    });
    return job.foreground;
  }
  background(id, sessionId) {
    const job = this.get(id, sessionId);
    if (job.status === 'running') {
      job.backgroundRequested = true;
      if (job.control?.background()) { job.background = true; this.notify(job); }
    }
    return this.public(job);
  }
  cancel(id, sessionId) {
    const job = this.get(id, sessionId);
    this.pending.delete(id); job.wakeStatus = 'suppressed';
    if (job.status === 'running') job.controller.abort();
    this.notify(job); return this.public(job);
  }
  cancelSession(sessionId) {
    for (const owner of this.runs.values()) if (owner.yanSessionId === sessionId) owner.cancelled = true;
    for (const job of this.jobs.values()) if (job.sessionId === sessionId) this.cancel(job.id);
  }
  purgeSession(sessionId) {
    this.cancelSession(sessionId);
    for (const [id, job] of this.jobs) if (job.sessionId === sessionId) { this.pending.delete(id); this.jobs.delete(id); }
    for (const [id, owner] of this.runs) if (owner.yanSessionId === sessionId) this.runs.delete(id);
  }
  cancelRun(runId) { const owner = this.runs.get(runId); if (owner) this.cancelSession(owner.yanSessionId); }
  async flush() {
    if (this.closed) return;
    for (const id of [...this.pending]) {
      const job = this.jobs.get(id), owner = job && this.runs.get(job.runId);
      if (!job || !owner || owner.cancelled) { this.pending.delete(id); continue; }
      const sessionId = job.sessionId;
      if (!owner.settled || this.busy(sessionId) || this.waking.has(sessionId)) continue;
      this.waking.add(sessionId);
      const batch = [...this.pending].map(key => this.jobs.get(key)).filter(item => item?.sessionId === sessionId).slice(0, 8);
      try {
        const result = await this.wake(owner, batch.map(item => this.public(item, true)));
        if (owner.cancelled || this.closed) continue;
        if (result?.ok) {
          for (const item of batch) { if (!this.pending.delete(item.id)) continue; item.wakeStatus = 'delivered'; item.wakeError = ''; this.notify(item); }
        } else if (result?.discard) {
          for (const item of batch) { if (!this.pending.delete(item.id)) continue; item.wakeStatus = 'suppressed'; this.notify(item); }
        } else if (result?.error) {
          for (const item of batch) { if (!this.pending.has(item.id)) continue; item.wakeError = result.error; this.notify(item); }
        }
      } catch (error) {
        if (this.jobs.has(job.id) && !owner.cancelled && !this.closed) { job.wakeError = error.message; this.notify(job); }
      }
      finally { this.waking.delete(sessionId); }
    }
  }
  close() {
    this.closed = true; clearInterval(this.timer); this.pending.clear();
    for (const job of this.jobs.values()) if (job.status === 'running') job.controller.abort();
  }
}
module.exports = { BackgroundBash };
