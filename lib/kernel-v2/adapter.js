'use strict';
const { bounded } = require('./lifecycle');
const crypto = require('node:crypto');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { OpenCodeV2Sidecar } = require('./sidecar');
const { translateConfig, permissions } = require('./config');
const { VERSION } = require('./runtime');
const { DelegationManager, DELEGATION_POLICY } = require('./delegation');
const { createResources } = require('./resources');
const { latestTodos, readSessionTodos, resumableTodos } = require('./todos');
const { waitForMcp } = require('./mcp-readiness');
const { undiscoveredConfig } = require('../mcp-tool-catalog');
const { prepareAttachments } = require('./attachments');
const { writeInstructionEntry } = require('./instructions');
const { tokenUsage } = require('../usage-stats');
const { createRunPerformance, observePerformanceEvent, summarizeRunPerformance } = require('../open-code-stream');
const { buildRollbackChanges, summarizeOpenCodeToolChanges } = require('../run-change-summary');
const { resolveDeliveryPolicy, mutationEvidenceFromMessages, verificationEvidenceFromMessages, parseDeliveryContract,
  applyDeliveryContract, deliveryContractId, deliveryReviewFromMessages, deliveryReviewDiagnostics, describeReviewDiagnostics,
  visualVerdictFromMessages } = require('../delivery-policy');
const { summarizeVerification } = require('../verification-state');
const { combineSystem, combineTurnPrompt, turnContextSystem, isSelectedSkillReadOnlyRequest } = require('../kernel-policy');

const text = content => (content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
const errorText = error => error?.message || error?.data?.message || JSON.stringify(error);
const compactionErrorText = error => {
  const message = errorText(error);
  if (/Nothing to compact yet/i.test(message || '')) return '当前没有可压缩的早期对话，请继续对话后再试';
  if (/Compaction summary did not match|required template|Compaction produced no summary/i.test(message || '')) {
    return '模型未生成有效的上下文摘要，请重试或切换文本模型';
  }
  return message;
};
// Live events drive the UI; this slow sweep only recovers from a dropped stream.
const FALLBACK_SYNC_MS = 2000;
// The local kernel socket can be reset while the process keeps running. Reads
// and prompt admission are idempotent, so a short retry recovers the turn
// instead of surfacing the reset as a task failure.
const TRANSPORT_RETRY_DELAYS = [250, 750, 1500];
const TRANSPORT_FAILURE = /(?:Transport|terminated|fetch failed|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|other side closed|network error)/i;
const TRANSPORT_FAILURE_GRACE_MS = 60_000;
const STREAM_RECONNECT_MAX = 5;
const transportFailure = error => {
  const message = typeof error === 'string' ? error : errorText(error);
  return typeof message === 'string' && TRANSPORT_FAILURE.test(message);
};
// A cancelled kernel startup is a control signal, not a task failure. A stop
// that overlapped admission is retryable because no prompt reached the kernel
// yet; a released runtime means the turn was interrupted, not failed.
function startupCancellationAction(error, { cancelled = false, closed = false } = {}) {
  if (error?.code !== 'V2_START_CANCELLED' || cancelled) return 'fail';
  if (closed || error.reason !== 'requested_stop') return 'interrupted';
  return 'retry';
}
const pause = ms => new Promise(resolve => { const timer = setTimeout(resolve, ms); timer.unref?.(); });
async function retryTransport(operation, { signal, attempts = TRANSPORT_RETRY_DELAYS.length } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (signal?.aborted || attempt >= attempts || !transportFailure(error)) throw error;
      await pause(TRANSPORT_RETRY_DELAYS[Math.min(attempt, TRANSPORT_RETRY_DELAYS.length - 1)]);
    }
  }
}
const SYNC_DEBOUNCE_MS = 60;
const PAGE = 100;
const afterCursor = id => Buffer.from(JSON.stringify({ id, order: 'asc', direction: 'next' })).toString('base64url');
const contextTokens = tokens => tokens
  ? (Number(tokens.input) || 0) + (Number(tokens.output) || 0) + (Number(tokens.reasoning) || 0) + (Number(tokens.cache?.read) || 0) + (Number(tokens.cache?.write) || 0)
  : 0;
// Manual compaction has no measured usage to report: the compaction message
// carries the summarizer's own usage, which is the size of the input being
// summarized, not what remains afterwards. Estimate both sides from the real
// active context instead, using the kernel's own 4-chars-per-token constant.
const CONTEXT_CHARS_PER_TOKEN = 4;
const textOf = value => typeof value === 'string' ? value : '';
const jsonOf = value => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return ''; }
};
const toolStateText = state => {
  if (!state || typeof state !== 'object') return '';
  const pieces = [jsonOf(state.input)];
  for (const item of Array.isArray(state.content) ? state.content : []) {
    if (item?.type === 'text') pieces.push(textOf(item.text));
    else if (item?.type === 'file') pieces.push(textOf(item.name));
  }
  if (state.error) pieces.push(textOf(state.error.message));
  return pieces.filter(Boolean).join('\n');
};
const contextMessageText = message => {
  if (!message || typeof message !== 'object') return '';
  if (message.type === 'user' || message.type === 'system'
    || message.type === 'synthetic' || message.type === 'skill') return textOf(message.text);
  if (message.type === 'shell') return [textOf(message.command), textOf(message.output?.output)].filter(Boolean).join('\n');
  if (message.type === 'compaction') return [textOf(message.summary), textOf(message.recent)].filter(Boolean).join('\n');
  if (message.type !== 'assistant') return '';
  return (Array.isArray(message.content) ? message.content : []).map(part => {
    if (!part || typeof part !== 'object') return '';
    if (part.type === 'text' || part.type === 'reasoning') return textOf(part.text);
    if (part.type === 'tool') return toolStateText(part.state);
    if (part.type === 'tool-call') return `${textOf(part.name)}${jsonOf(part.input)}`;
    if (part.type === 'tool-result') return jsonOf(part.result?.value);
    return '';
  }).filter(Boolean).join('\n');
};
const estimateContextTokens = messages => {
  if (!Array.isArray(messages)) return 0;
  let chars = 0;
  for (const message of messages) chars += contextMessageText(message).length + 16;
  return Math.ceil(chars / CONTEXT_CHARS_PER_TOKEN);
};
const settled = message => message.type === 'assistant' ? !!message.time?.completed
  : message.type === 'compaction' ? message.status !== 'running'
    : message.type === 'shell' ? message.status !== 'running' : true;
// Text and reasoning ordinals are counted per kind inside one assistant step,
// matching the kernel's live delta events.
const partID = (messageID, kind, ordinal) => `${messageID}:${kind}:${ordinal}`;
const shellPreference = input => (input.plugin || []).map(value => {
  try { return new URL(String(value)).searchParams.get('yanShell') || ''; } catch { return ''; }
}).find(Boolean) || '';
// Delivery evidence readers predate V2 and expect { info, parts } messages.
const legacyMessages = messages => messages.filter(message => message.type === 'assistant').map(message => ({
  info: { id: message.id, role: 'assistant', time: message.time },
  parts: message.content.map(content => content.type === 'tool'
    ? { type: 'tool', id: content.id, callID: content.id, tool: String(content.name || '').replace(/^opencode[._]/, '').replace(/^shell$/, 'bash'),
      state: { ...content.state, output: text(content.state.content), time: { start: content.time?.ran, end: content.time?.completed } } }
    : { type: content.type, text: content.text })
}));
const reviewMessages = messages => legacyMessages(messages).flatMap(message =>
  message.parts.filter(part => part.type === 'tool').map(part => ({ ...message, parts: [part],
    info: { ...message.info, time: { ...message.info.time, created: part.state.time.start || message.info.time.created } } })))
  .sort((a, b) => a.info.time.created - b.info.time.created);
const mergeReviewChanges = (workspace, primary, fallback) => {
  const key = change => path.resolve(workspace, change.file || change.path).toLowerCase();
  const merged = new Map(fallback.map(change => [key(change), change]));
  for (const change of primary) merged.set(key(change), change);
  return [...merged.values()];
};
const WAIVE_CHECKS = /(?:不(?:用|要)|无需|跳过|禁止)s*(?:运行|执行|做)?s*(?:测试|验证|检查)|(?:skip|without|no)s+(?:tests?|verification|checks?)/i;
const configSignature = input => JSON.stringify({ config: translateConfig(input), media: input.yanMediaEnvironment || {}, shell: shellPreference(input) });

class OpenCodeV2Adapter {
  constructor(options) {
    this.transport = new OpenCodeV2Sidecar(options);
    this.compactionTimeoutMs = Number(options.compactionTimeoutMs) > 0 ? Number(options.compactionTimeoutMs) : 120000;
    this.runs = new Map();
    this.completed = new Map();
    this.delegation = new DelegationManager(this);
    this.config = null;
    this.startQueue = Promise.resolve();
    this.startCache = new WeakMap();
    this.waitForPreviousClose = options.waitForPreviousClose;
    this.resources = createResources({
      idleMs: options.instanceIdleMs,
      log: options.log,
      stop: () => this.transport.stop(),
      isBusy: async () => this.client?.session.active
        ? Object.keys(await this.client.session.active()).length > 0 : false
    });
    for (const name of ['start', 'prewarm', 'run', 'reviewMemory', 'deliverInterjection', 'cancel',
      'runChanges', 'sessionChanges', 'compressSession', 'deleteKernelSessionTrees', 'replyPermission', 'replyQuestion']) {
      const operation = this[name].bind(this);
      this[name] = (...args) => this.resources.use(async () => {
        if (name === 'start') this.lastStartConfig = args[0] || {};
        if (['runChanges', 'sessionChanges', 'deleteKernelSessionTrees', 'reviewMemory', 'compressSession'].includes(name)
          && !this.client && this.lastStartConfig) await this.start(this.lastStartConfig);
        return operation(...args);
      });
    }
  }
  get client() { return this.transport.client; }
  status() { return this.transport.status(); }
  // Quit path only: before-quit cannot await, so the transport must be killed
  // synchronously or the kernel outlives the app while holding owner.json.
  killNow() { return this.transport.killNow(); }
  hasRun(id) { return this.runs.has(id); }
  hasPendingRun(id) { return this.runs.has(id); }
  start(input = {}) {
    // Child runs reuse the parent's openCodeConfig object. Cache the translated
    // config and signature so a fan-out does not re-copy the same policy per
    // child admission.
    const cacheKey = input && typeof input === 'object' ? input : null;
    let cached = cacheKey ? this.startCache.get(cacheKey) : null;
    if (!cached) {
      cached = { config: translateConfig(input), signature: configSignature(input) };
      if (cacheKey) this.startCache.set(cacheKey, cached);
    }
    const { config, signature } = cached;
    const result = this.startQueue.then(async () => {
      await this.waitForPreviousClose?.();
      if (this.config !== signature && this.client) {
        if ([...this.runs.values()].some(run => run.signature !== signature)) throw new Error('已有任务运行，请完成后再更换内核配置');
        await this.transport.stop();
      }
      this.transport.shellPreference = shellPreference(input);
      this.transport.mediaEnvironment = input.yanMediaEnvironment || {};
      this.transport.delegationEnvironment = await this.delegation.bridge();
      const status = await this.transport.start(config);
      this.config = signature;
      return status;
    });
    this.startQueue = result.catch(() => {});
    return result;
  }
  async prewarm(config, directory) {
    await this.start(config);
    if (directory) {
      await this.client.location.get({ location: { directory } });
      await waitForMcp(this.client, undiscoveredConfig(translateConfig(config)), directory);
    }
    return this.status();
  }
  // A stop that overlapped admission can cancel a startup before any prompt
  // reached the kernel. Retry that once on the same session; a released runtime
  // means the turn was interrupted, not failed. Returns true when interrupted.
  async startForRun(config, run) {
    const child = this.delegation.context(run.id);
    const parent = child && this.runs.get(child.parentRunID);
    if (parent && this.client && parent.signature === run.signature && !this.transport.closed) return false;
    try {
      await this.start(config);
      return false;
    } catch (error) {
      const action = startupCancellationAction(error, { cancelled: run.cancelled, closed: this.transport.closed });
      if (action === 'retry') {
        await this.start(config);
        return false;
      }
      if (action !== 'interrupted') throw error;
      run.interruptionReason = error.reason === 'runtime_released' ? 'runtime_released' : 'app_shutdown';
      return true;
    }
  }
  invalidate() { this.config = null; }
  async messages(sessionID) {
    const messages = [];
    let cursor;
    do {
      const page = await retryTransport(() => this.client.message.list({ sessionID, limit: PAGE, ...(cursor ? { cursor } : { order: 'asc' }) }));
      messages.push(...page.data);
      cursor = page.cursor?.next;
    } while (cursor);
    return messages;
  }
  // view holds all messages for one session after the baseline tail.
  // anchor tracks the last settled message so refreshes only read the open tail.
  view(sessionID) {
    return { sessionID, baseline: new Set(), baselineTail: '', anchor: '', list: [], index: new Map(), parts: new Map(), emit: () => {} };
  }
  async refresh(view) {
    const after = view.anchor || view.baselineTail;
    const fresh = [];
    let cursor = after ? afterCursor(after) : undefined;
    do {
      const page = await retryTransport(() => this.client.message.list({ sessionID: view.sessionID, limit: PAGE, ...(cursor ? { cursor } : { order: 'asc' }) }));
      fresh.push(...page.data);
      cursor = page.data.length === PAGE ? page.cursor?.next : undefined;
    } while (cursor);
    for (const message of fresh) {
      if (view.baseline.has(message.id)) continue;
      if (!view.index.has(message.id)) { view.index.set(message.id, view.list.length); view.list.push(message); }
      else view.list[view.index.get(message.id)] = message;
    }
    // Everything before the first open message is final; later refreshes start there.
    const open = view.list.findIndex(message => !settled(message));
    const stable = open === -1 ? view.list.at(-1) : view.list[open - 1];
    if (stable) view.anchor = stable.id;
    return view.list;
  }
  emitMessages(run, messages, view = run.view) {
    for (const message of messages.filter(item => item.type === 'assistant' && !view.baseline.has(item.id))) {
      const counters = { text: 0, reasoning: 0 };
      for (const content of message.content) {
        const ordinal = content.type === 'tool' ? -1 : counters[content.type]++;
        const id = content.type === 'tool'
          ? `${message.id}:tool:${content.id}`
          : partID(message.id, content.type, ordinal);
        const part = content.type === 'tool' ? {
          id, type: 'tool', messageID: message.id, sessionID: view.sessionID, callID: content.id, tool: content.name,
          state: { ...content.state, output: text(content.state.content), time: { start: content.time.ran, end: content.time.completed } }
        } : { id, type: content.type, messageID: message.id, sessionID: view.sessionID, text: content.text,
          time: { start: message.time.created, end: content.time?.completed || message.time.completed } };
        // Don't overwrite streamed content with an empty open-part projection.
        if (content.type !== 'tool' && !content.text && !part.time.end) continue;
        const signature = JSON.stringify(part);
        if (view.parts.get(id) === signature) continue;
        view.parts.set(id, signature);
        view.emit({ type: 'message.part.updated', properties: { part } });
      }
      // Emit message.updated once per completed assistant message so the
      // context-token meter and input-throughput learning loop stay fed.
      if (message.time.completed && !view.parts.has(`${message.id}:meta`)) {
        view.parts.set(`${message.id}:meta`, '1');
        view.emit({ type: 'message.updated', properties: { info: { id: message.id, role: 'assistant',
          sessionID: view.sessionID, time: message.time, tokens: message.tokens, cost: message.cost,
          modelID: message.model?.id } } });
      }
    }
  }
  emitForm(run, form, sessionID) {
    if (run.permissions.has(form.id)) return;
    run.permissions.add(form.id);
    run.approvalSessions ||= new Map();
    run.approvalSessions.set(form.id, sessionID);
    run.emit({ type: 'question.asked', properties: { id: form.id, sessionID,
      questions: form.fields.map(field => ({ header: field.title, question: field.description || field.title,
        custom: field.custom !== false,
        multiple: field.type === 'multiselect', options: (field.options || []).map(option => ({ label: option.label || option.value, description: option.description || '' })) })) } });
  }
  // Incremental projection sweep: re-reads only the open tail of the session.
  async sync(run) {
    if (run.syncing) { run.resync = true; return run.syncing; }
    run.syncing = (async () => {
      do {
        run.resync = false;
        const messages = await this.refresh(run.view);
        await this.delegation.observeDeliveries(run, messages);
        this.emitTodos(run, latestTodos(messages));
        this.emitMessages(run, messages);
        const mutations = messages.flatMap(message => message.content || []).filter(call =>
          call.type === 'tool' && call.state?.status === 'completed'
          && /^(?:opencode[._])?(?:write|edit|patch|apply_patch|bash|shell)$/.test(call.name));
        const mutationKey = mutations.map(call => call.id).join(':');
        if (mutationKey !== run.reviewMutationKey) {
          run.reviewMutationKey = mutationKey;
          if (mutations.length) this.scheduleReview(run);
        }
        const lastActivity = messages.findLast(item => ['user', 'assistant', 'idle'].includes(item.type));
        run.idle = lastActivity?.type === 'idle' && !run.consumedIdle.has(lastActivity.id) ? lastActivity : null;
      } while (run.resync && !run.idle);
      run.transportFailureSince = 0;
    })().finally(() => { run.syncing = null; });
    return run.syncing;
  }
  emitTodos(run, snapshot) {
    if (!snapshot) return;
    const signature = JSON.stringify(snapshot.todos);
    run.todos = snapshot.todos;
    if (run.todoSignature === signature) return;
    run.todoSignature = signature;
    run.emit({ type: 'todo.updated', properties: { sessionID: run.sessionID, todos: snapshot.todos } });
  }
  async sweep(run) {
    if (!this.client) throw this.processExitError();
    for (const permission of await this.client.permission.list({ sessionID: run.sessionID })) {
      if (run.permissions.has(permission.id)) continue;
      run.permissions.add(permission.id);
      run.approvalSessions.set(permission.id, run.sessionID);
      run.emit({ type: 'permission.asked', properties: { ...permission, permission: permission.action,
        patterns: permission.resources, requestID: permission.id } });
    }
    for (const form of await this.client.session.form.list({ sessionID: run.sessionID })) this.emitForm(run, form, run.sessionID);
    await this.sync(run);
  }
  scheduleSync(run, ms = SYNC_DEBOUNCE_MS) {
    if (run.syncTimer) return;
    run.syncTimer = setTimeout(() => {
      run.syncTimer = null;
      this.sync(run).catch(e => { this.noteSyncFailure(run, e); run.wake?.(); }).then(() => run.idle && run.wake?.());
    }, ms);
  }
  // A local transport reset is not a task failure: keep the 2s sweep running
  // while the kernel process is alive, and only give up after a sustained
  // outage so a genuinely dead connection still surfaces.
  noteSyncFailure(run, error) {
    if (!transportFailure(error)) { run.streamError = run.streamError || error; return; }
    run.streamWarning = errorText(error);
    run.transportFailureSince ||= Date.now();
    if (Date.now() - run.transportFailureSince >= TRANSPORT_FAILURE_GRACE_MS) run.streamError = run.streamError || error;
  }
  scheduleReview(run) {
    run.reviewRevision = (run.reviewRevision || 0) + 1;
    if (run.reviewTimer || run.reviewPending) { run.reviewDirty = true; return; }
    run.reviewTimer = setTimeout(async () => {
      run.reviewTimer = null;
      run.reviewPending = true;
      run.reviewDirty = false;
      try {
        const diff = await this.runChanges(run.id);
        if (this.runs.get(run.id) === run) run.emit({ type: 'session.diff', properties: { sessionID: run.sessionID, diff } });
      } catch (error) {
        run.reviewError = errorText(error);
      } finally {
        run.reviewPending = false;
        if (run.reviewDirty && this.runs.get(run.id) === run) this.scheduleReview(run);
      }
    }, 150);
  }
  // An automatic compaction has the same measurement problem as a manual one:
  // the compaction message carries the summarizer's own usage, which is the
  // size of the input being summarized, not what remains. Read the real active
  // context instead so the panel can fall back after compression.
  async reportCompaction(run, sessionID, data, metadata = {}) {
    const diagnostic = metadata.yanContext || run.compactionDiagnostic || {};
    const beforeTokens = diagnostic.beforeTokens ?? run.lastContextTokens ?? 0;
    // Summarizer usage is billed work, never the remaining context size.
    // The completed checkpoint is a usable fallback if the context read fails.
    let afterTokens = typeof data.text === 'string' && !data.providerContext
      ? estimateContextTokens([{ type: 'compaction', summary: data.text, recent: data.recent }]) : null;
    if (this.client?.session?.context) {
      // The compaction event precedes the next model request, so a bounded
      // measurement here cannot delay visible output; it must never stall the
      // event stream if the local socket stops answering.
      const deadline = Date.now() + 3000;
      const measure = async () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        const active = await Promise.race([
          this.activeContext(sessionID).catch(() => null),
          delay(remaining, undefined, { ref: false }).then(() => null)
        ]);
        return active ? estimateContextTokens(active) : null;
      };
      let measured = await measure();
      // A read that lands before the compaction is committed still reports the
      // pre-compaction size; retry briefly instead of publishing that number.
      for (let attempt = 0; measured !== null && beforeTokens > 0 && measured >= beforeTokens && attempt < 3; attempt++) {
        await delay(150);
        measured = await measure();
      }
      if (measured !== null && (beforeTokens <= 0 || measured < beforeTokens)) afterTokens = measured;
    }
    if (afterTokens !== null) run.lastContextTokens = afterTokens;
    run.emit({ type: 'yan.context.compression.completed',
      data: { sessionID, automatic: data.reason !== 'manual', ...diagnostic, beforeTokens,
        estimatedTokens: diagnostic.estimated,
        ...(afterTokens === null ? {} : { afterTokens, estimated: true }) } });
    run.compactionDiagnostic = null;
  }
  async onEvent(run, event) {
    const data = event.data || {};
    const sid = data.sessionID || data.form?.sessionID || data.data?.sessionID || '';
    if (sid !== run.sessionID) return;
    const view = run.view;
    const type = event.type;
    if (type === 'permission.replied') {
      run.permissionReplies ||= new Map();
      run.permissionReplies.set(data.requestID, data.reply);
      return;
    }
    if (type === 'session.text.delta' || type === 'session.reasoning.delta') {
      const kind = type === 'session.text.delta' ? 'text' : 'reasoning';
      const id = partID(data.assistantMessageID, kind, data.ordinal);
      // Announce a live part before its first delta so the renderer can append.
      if (!view.parts.has(`${id}:live`)) {
        view.parts.set(`${id}:live`, '1');
        view.emit({ type: 'message.part.updated', properties: { part: { id, type: kind,
          messageID: data.assistantMessageID, sessionID: sid } } });
      }
      view.emit({ type: 'message.part.delta', properties: { partID: id, messageID: data.assistantMessageID,
        sessionID: sid, field: kind, delta: data.delta } });
      if (sid === run.sessionID) observePerformanceEvent(run.performance,
        { type: 'message.part.delta', data: { partID: id, field: kind, delta: data.delta } });
      return;
    }
    if (type === 'permission.asked') {
      if (run.permissions.has(data.id)) return;
      run.permissions.add(data.id);
      run.approvalSessions.set(data.id, sid);
      run.emit({ type: 'permission.asked', properties: { id: data.id, sessionID: sid, action: data.action,
        permission: data.action, patterns: data.resources, resources: data.resources, requestID: data.id } });
      return;
    }
    if (type === 'form.created') { this.emitForm(run, data.form, data.form?.sessionID || sid); return; }
    if (type === 'form.replied' || type === 'form.cancelled') {
      run.emit({ type: type === 'form.replied' ? 'question.replied' : 'question.rejected',
        properties: { id: data.id, sessionID: sid } });
      return;
    }
    if (sid === run.sessionID) {
      if (type === 'session.step.started') {
        if (run.idle) this.delegation.consumeIdle(run);
        run.emit({ type: 'yan.model.request.started', data: { sessionID: sid, requestIndex: ++run.requestIndex } });
        observePerformanceEvent(run.performance, { type: 'message.part.updated', data: { part: { type: 'step-start', messageID: data.assistantMessageID } } });
      } else if (type === 'session.step.ended') {
        observePerformanceEvent(run.performance, { type: 'message.updated', properties: { info: { role: 'assistant', id: data.assistantMessageID, time: { completed: event.created || Date.now() }, tokens: data.tokens } } });
        const observed = contextTokens(data.tokens);
        if (observed > 0) run.lastContextTokens = observed;
        run.emit({ type: 'message.updated', properties: { info: { id: data.assistantMessageID, role: 'assistant',
          sessionID: sid, tokens: data.tokens, cost: data.cost, time: { completed: event.created || Date.now() } } } });
        // Files changed by this step invalidate the live review panel.
        for (const file of data.files || []) {
          run.changedFiles.add(file);
          run.emit({ type: 'file.edited', properties: { file } });
        }
        if (data.files?.length) this.scheduleReview(run);
      } else if (type === 'session.retry.scheduled') {
        run.retryCount += 1;
        run.emit({ type: 'session.status', properties: { sessionID: sid,
          status: { type: 'retry', attempt: data.attempt, message: data.error?.message || '' } } });
      } else if (type === 'session.compaction.started') {
        run.compactionDiagnostic = event.metadata?.yanContext || {};
        run.emit({ type: 'yan.context.compression.started', data: { sessionID: sid, automatic: data.reason !== 'manual',
          ...run.compactionDiagnostic, beforeTokens: run.compactionDiagnostic.beforeTokens ?? run.lastContextTokens ?? 0 } });
      } else if (type === 'session.compaction.ended') {
        run.compactions++;
        await this.reportCompaction(run, sid, data, event.metadata);
      } else if (type === 'session.compaction.failed') {
        run.emit({ type: 'yan.context.compression.failed', data: { sessionID: sid, message: errorText(data.error) } });
      }
    }
    // Durable lifecycle events mutate the projection; schedule a debounced sweep.
    if (/^session\.(step|text|reasoning|tool|execution|compaction|shell|synthetic|skill|message)\.(?!delta)/.test(type) || type === 'session.idle') {
      this.scheduleSync(run, type === 'session.idle' || type.startsWith('session.execution.') ? 0 : SYNC_DEBOUNCE_MS);
    }
  }
  async run(request, emit = () => {}) {
    if (require('../minimal-agent').isMinimal(request)) request = { ...request, workMode: 'normal',
      openCodeConfig: { ...request.openCodeConfig, yanMinimalMode: true,
        agent: { build: { prompt: combineSystem(request) } }, agents: { build: { system: combineSystem(request) } } } };
    if (require('../creative-agent').isCreative(request)) request = { ...request, workMode: 'normal',
      openCodeConfig: { ...request.openCodeConfig, yanCreativeMode: true,
        agent: { build: { prompt: combineSystem(request) } }, agents: { build: { system: combineSystem(request) } } } };
    if (require('../daily-agent').isDaily(request)) request = { ...request, workMode: 'normal',
      openCodeConfig: { ...request.openCodeConfig, yanDailyMode: true,
        agent: { build: { prompt: combineSystem(request) } }, agents: { build: { system: combineSystem(request) } } } };
    const id = request.runId || crypto.randomUUID();
    if (this.runs.has(id)) throw new Error('该执行 ID 已有运行中的任务');
    if (request.openCodeSessionId && [...this.runs.values()].some(run =>
      run.sessionID === request.openCodeSessionId || run.request?.openCodeSessionId === request.openCodeSessionId)) {
      throw new Error('该内核会话已有运行中的任务，不能重复接管');
    }
    const view = this.view('');
    view.emit = emit;
    const run = { id, request, emit, signature: configSignature(request.openCodeConfig || {}), sessionID: '',
      view, permissions: new Set(), approvalSessions: new Map(), sessions: new Set(),
      cancelled: false, finishRequested: false, requestIndex: 0, compactions: 0,
      lastContextTokens: 0, consumedIdle: new Set(), changedFiles: new Set(), performance: createRunPerformance(), idle: null, syncing: null, resync: false,
      syncTimer: null, streamError: null, streamWarning: null, streamLost: false, transportFailureSince: 0, retryCount: 0, wake: null };
    let finishRun;
    run.finished = new Promise(resolve => { finishRun = resolve; });
    this.runs.set(id, run);
    const delegated = this.delegation.context(id);
    if (this.delegation.blocked.has(id) || (delegated && this.delegation.blocked.has(delegated.rootRunID))) run.cancelled = true;
    // A delegated child must not inherit the ability to delegate again. Strip
    // the delegation grant from its session permissions; the plugin then hides
    // every delegation tool and the local bridge rejects any stale request.
    const runPermissions = delegated
      ? delegated.permissions.filter(rule => rule.action !== 'yan_delegate')
      : permissions(request);
    const stream = new AbortController();
    let fallback;
    try {
      if (await this.startForRun(request.openCodeConfig || {}, run)) return this.result(run, [], 'interrupted');
      run.performance.kernelReadyAt = Date.now();
      const admission = run.performance.admission = {};
      let phaseStartedAt = Date.now();
      const phase = name => { const now = Date.now(); admission[name] = now - phaseStartedAt; phaseStartedAt = now; };
      if (run.cancelled) return this.result(run, [], 'interrupted');
      const model = { providerID: request.providerId, id: request.modelId };
      let session;
      if (request.openCodeSessionId) {
        try { session = await this.client.session.get({ sessionID: request.openCodeSessionId }); }
        catch (error) {
          if (!/not.?found|404/i.test(errorText(error))) throw error;
          if (delegated) throw new Error('子代理上下文已不存在，不能静默创建替代会话');
          session = await this.client.session.create({ location: { directory: request.workspace }, title: request.title || 'Yan migrated task', model, permissions: runPermissions });
          run.recreated = true;
        }
        if (path.resolve(session.location.directory) !== path.resolve(request.workspace)) throw new Error('会话工作区不匹配');
        await this.client.session.switchModel({ sessionID: session.id, model });
        await this.client.session.update({ sessionID: session.id, permissions: runPermissions });
      } else session = await this.client.session.create({ location: { directory: request.workspace }, title: request.title || 'Yan task', model, permissions: runPermissions, ...(delegated ? { parentID: delegated.parentSessionID, metadata: { yanDelegation: this.delegation.metadata(delegated) } } : {}) });
      run.sessionID = session.id;
      if (delegated) {
        delegated.sessionID = session.id;
        await this.client.session.update({ sessionID: session.id, metadata: { ...session.metadata, yanDelegation: this.delegation.metadata(delegated) } });
      }
      view.sessionID = session.id;
      run.sessions.add(session.id);
      phase('sessionOpenMs');
      await writeInstructionEntry(this.client, session.id, 'yan.policy', combineSystem(request));
      await writeInstructionEntry(this.client, session.id, 'yan.turn', turnContextSystem(request));
      if (runPermissions.some(rule => rule.action === 'yan_delegate' && rule.effect === 'allow')) {
        await writeInstructionEntry(this.client, session.id, 'yan.delegation', DELEGATION_POLICY + (delegated ? '\nYou are a delegated child. Do not delegate further; complete the assignment yourself. You inherit your parent permissions; approvals are mediated by the main task. Report questions to your parent instead of asking the user directly.' : ''));
      }
      const recoveredChildren = request.openCodeSessionId && !run.recreated ? await this.delegation.recover(run) : [];
      if (!delegated && !request.utility) {
        await this.delegation.workflows.restore(run);
        if (run.workflow) await writeInstructionEntry(this.client, session.id, 'yan.workflow',
          'Persisted workflow state (task data): ' + JSON.stringify(this.delegation.workflows.snapshot(run)) + '\nInspect before reviewing or resuming. Recovery never replays work automatically.');
      }
      phase('instructionsAndRecoveryMs');
      const suppliedActivations = new Set(request.delegationReportActivations || []);
      const additionalReports = recoveredChildren?.filter(record => !suppliedActivations.has(record.activationID));
      await waitForMcp(this.client, undiscoveredConfig(translateConfig(request.openCodeConfig || {})), request.workspace, () => run.cancelled);
      phase('mcpReadyMs');
      if (run.cancelled) return this.result(run, [], 'interrupted');
      // Only need the newest existing message ID as the baseline anchor.
      const latest = await this.client.message.list({ sessionID: session.id, limit: 1, order: 'desc' });
      if (latest.data[0]) { view.baseline.add(latest.data[0].id); view.baselineTail = latest.data[0].id; }
      run.performance.sessionReadyAt = Date.now();
      emit({ type: 'yan.opencode.started', data: { sessionID: session.id, runID: id, version: VERSION, runtime: 'node', modelId: request.modelId, modelName: request.modelName || request.modelId, reasoningMode: request.reasoningMode || '' } });
      emit({ type: 'yan.context.budget', data: { sessionID: session.id, ...this.compactionBudget(request) } });
      if (request.openCodeSessionId && !run.recreated && !session.parentID) {
        const snapshot = await readSessionTodos(this.client, session.id);
        let retiredCallID = session.metadata?.yanTodoRetiredCallID || '';
        if (!request.backgroundBashWake && !request.utility && snapshot) {
          retiredCallID = snapshot.callID;
          await this.client.session.update({ sessionID: session.id,
            metadata: { ...session.metadata, yanTodoRetiredCallID: retiredCallID } });
        }
        this.emitTodos(run, resumableTodos(snapshot, retiredCallID));
      }
      phase('baselineAndTodosMs');
      // Subscribe before submitting so the first deltas cannot race the subscription.
      let connected;
      const ready = new Promise(resolve => { connected = resolve; });
      (async () => {
        let attempt = 0;
        while (!stream.signal.aborted) {
          try {
            for await (const event of this.client.event.subscribe({ signal: stream.signal,
              onActivity: () => { connected?.(); connected = null; } })) {
              connected?.(); connected = null;
              attempt = 0;
              if (run.streamLost) {
                run.streamLost = false;
                run.emit({ type: 'yan.opencode.reconnected', data: { sessionID: run.sessionID } });
              }
              try { await this.onEvent(run, event); } catch (e) { run.streamError = run.streamError || e; run.wake?.(); }
            }
            if (stream.signal.aborted) return;
            throw new Error('OpenCode 事件流已断开');
          } catch (error) {
            if (stream.signal.aborted) return;
            attempt += 1;
            const message = errorText(error);
            run.streamWarning = message;
            run.streamLost = true;
            run.emit({ type: 'yan.opencode.event-stream-lost', data: { sessionID: run.sessionID, attempt,
              maxAttempts: STREAM_RECONNECT_MAX, message } });
            if (attempt > STREAM_RECONNECT_MAX) {
              // Live events are an optimization: the 2s sweep keeps the turn
              // correct, so never fail a task because the stream stayed down.
              run.emit({ type: 'yan.opencode.event-stream-lost', data: { sessionID: run.sessionID, attempt,
                maxAttempts: STREAM_RECONNECT_MAX, exhausted: true, message } });
              return;
            }
            run.emit({ type: 'yan.opencode.reconnecting', data: { sessionID: run.sessionID, attempt,
              maxAttempts: STREAM_RECONNECT_MAX, message } });
            this.scheduleSync(run, 0);
            await pause(Math.min(1000 * attempt, 5000));
          }
        }
      })().catch(e => { if (!stream.signal.aborted) { run.streamWarning = errorText(e); run.wake?.(); } });
      await Promise.race([ready, delay(3000)]);
      phase('eventSubscriptionMs');
      const { files, context: attachmentContext } = await prepareAttachments(request.attachments);
      const prompt = [
        isSelectedSkillReadOnlyRequest(request) ? 'Read the supplied selected Skill documents only. Do not call tools or execute their workflows. Reply with a brief receipt.' : '',
        combineTurnPrompt(request, request.prompt, run.recreated || (!request.openCodeSessionId && request.history?.length > 0)),
        attachmentContext,
        additionalReports?.length ? 'Unreported child results from previous executions (tools were not replayed):\n' + JSON.stringify(additionalReports) : ''
      ].filter(Boolean).join('\n\n');
      run.promptAdmitted = true;
      run.from = `msg_${crypto.randomBytes(12).toString('hex')}`;
      phase('attachmentsAndPromptMs');
      // The kernel inbox admits by message id, so a retried admission can never
      // create a duplicate turn.
      await retryTransport(() => this.client.session.prompt({ sessionID: session.id, id: run.from, text: prompt, files }),
        { signal: stream.signal });
      phase('promptAdmissionMs');
      this.delegation.admitted(run);
      await this.delegation.markReported(recoveredChildren || [], run);
      // A cancel that landed between session setup and admission must still stop the turn.
      if (run.cancelled) await this.client.session.interrupt({ sessionID: session.id }).catch(() => {});
      // Fallback poll in case the SSE stream drops an event.
      fallback = setInterval(() => {
        this.sweep(run).then(() => run.idle && run.wake?.(), e => { this.noteSyncFailure(run, e); run.wake?.(); });
      }, FALLBACK_SYNC_MS);
      await retryTransport(() => this.sweep(run), { signal: stream.signal });
      for (;;) {
        if (!this.client) throw this.processExitError();
        if (run.streamError) throw run.streamError;
        if (run.cancelled) {
          // A cancellation acknowledgement is authoritative even if the idle
          // event raced a late request-start event or was lost on the stream.
          if (run.cancelling) await bounded(() => run.cancelling, 10000);
          run.idle ||= { id: `cancelled:${run.id}`, outcome: 'interrupted' };
          run.finishing = true;
          break;
        }
        if (run.idle) {
          await run.syncing;
          if (!run.idle) continue;
          const candidate = run.idle;
          const continued = await this.delegation.settle(run);
          if (!continued && run.idle?.id === candidate?.id) { run.finishing = true; break; }
          if (run.idle) continue;
        }
        await new Promise(resolve => {
          const timer = setTimeout(resolve, FALLBACK_SYNC_MS + 500);
          run.wake = () => { clearTimeout(timer); resolve(); };
        });
        run.wake = null;
      }
      await run.syncing?.catch(error => { if (!transportFailure(error)) throw error; this.noteSyncFailure(run, error); });
      const idle = run.idle;
      clearInterval(fallback); fallback = null;
      clearTimeout(run.syncTimer); run.syncTimer = null;
      await run.syncing?.catch(error => { if (!transportFailure(error)) throw error; this.noteSyncFailure(run, error); });
      const fresh = run.view.list;
      const status = run.cancelled ? 'interrupted' : run.permissionDenied ? 'error' : idle.outcome === 'succeeded' ? 'done' : 'error';
      const rawFailure = idle.error || (run.permissionDenied ? '权限请求被拒绝，任务已停止' : idle.outcome === 'interrupted' && !run.cancelled ? '内核执行已中断（非用户取消）' : undefined);
      const failure = rawFailure && run.retryCount
        ? `${errorText(rawFailure)}（模型请求已自动重试 ${run.retryCount} 次）` : rawFailure;
      const result = this.result(run, fresh, status, failure);
      try { result.delivery = this.assessDelivery(run, fresh); }
      catch (e) { result.delivery = null; result.deliveryError = errorText(e); }
      const from = fresh.find(item => item.type === 'user')?.id;
      run.from = from;
      try {
        result.changes = await this.runChanges(id);
        result.rollbackChanges = await buildRollbackChanges(request.workspace, result.changes);
      } catch (e) { result.reviewError = errorText(e); }
      const lastAssistant = fresh.filter(m => m.type === 'assistant').at(-1);
      result.contextTokens = contextTokens(lastAssistant?.tokens);
      if (!delegated) this.completed.set(id, { sessionID: session.id, from, changes: result.changes || [] });
      if (this.completed.size > 100) this.completed.delete(this.completed.keys().next().value);
      return result;
    } catch (error) {
      this.delegation.blocked.add(run.id);
      if (run.promptAdmitted && run.sessionID && this.client) await this.client.session.interrupt({ sessionID: run.sessionID }).catch(() => {});
      throw error;
    } finally {
      clearInterval(fallback);
      clearTimeout(run.syncTimer);
      clearTimeout(run.reviewTimer);
      stream.abort();
      try { await bounded(() => this.delegation.stop(run), 10000); }
      catch (error) { this.killNow(); console.warn('[delegation] cleanup:', errorText(error)); }
      finally {
      this.runs.delete(id);
      this.delegation.release(run);
      finishRun();
      }
    }
  }
  // Waits for the next turn's idle message; the sweep covers a dropped stream.
  async waitIdle(run) {
    while (!run.idle) {
      if (!this.client) throw this.processExitError();
      if (run.streamError) throw run.streamError;
      await new Promise(resolve => { run.wake = resolve; setTimeout(resolve, FALLBACK_SYNC_MS + 500); });
      run.wake = null;
    }
    await run.syncing;
    return run.idle;
  }
  // Passive delivery check, as in 1.7.0: inspect evidence the run already
  // produced. It never sends another prompt or replaces the final response.
  assessDelivery(run, messages) {
    const request = run.request;
    if (request.utility) return null;
    const assistants = legacyMessages(messages);
    let policy = resolveDeliveryPolicy(request);
    const delivery = { policy, contractId: '', acceptanceRounds: 0, repairRounds: 0, verified: false, failure: '',
      passive: true, skipped: true, skipReason: 'no-followup', prechecked: false, review: null, reviewIssues: null, verification: null };
    const contract = parseDeliveryContract(assistants);
    if (contract) {
      policy = applyDeliveryContract(policy, contract);
      delivery.policy = policy;
      delivery.contractId = deliveryContractId(policy.contract);
      run.emit({ type: 'yan.delivery.contract.updated', data: { sessionID: run.sessionID, contractId: delivery.contractId, contract: policy.contract } });
    }
    const waived = request.skipVerification === true || WAIVE_CHECKS.test(request.prompt || '');
    if (waived) delivery.verification = { status: 'waived', hasCurrentPass: false, records: [], reason: 'user-request' };
    else if (assistants.some(message => message.parts.some(part => part.state?.metadata?.yanEnvironment?.mutation))) {
      delivery.verification = summarizeVerification(assistants, { workspace: request.workspace });
    }
    if (policy.eligibleForReview && !run.finishRequested && (run.changedFiles.size > 0 || mutationEvidenceFromMessages(assistants))) {
      delivery.review = deliveryReviewFromMessages(assistants, policy);
      delivery.verified = verificationEvidenceFromMessages(assistants, policy);
      if (delivery.verification) delivery.verified &&= delivery.verification.hasCurrentPass;
      delivery.prechecked = delivery.verified;
      if (!delivery.review) {
        const diagnostics = deliveryReviewDiagnostics(assistants, policy);
        if (diagnostics.blockSeen) {
          delivery.reviewIssues = diagnostics;
          delivery.failure = `验收记录被丢弃：${describeReviewDiagnostics(diagnostics)}`;
          run.emit({ type: 'yan.delivery.review.dropped', data: { sessionID: run.sessionID, reason: describeReviewDiagnostics(diagnostics), issues: diagnostics } });
        }
      }
      if (delivery.review?.verdict === 'fail' || visualVerdictFromMessages(assistants) === 'fail') {
        delivery.failure = '主轮验证发现尚未解决的问题，请查看已有验证记录。';
      }
    }
    return {
      passive: true, intent: String(policy.intent || ''), artifact: String(policy.artifact || ''),
      contract: policy.contract || null, contractId: delivery.contractId, review: delivery.review,
      acceptanceRounds: 0, repairRounds: 0, verified: delivery.verified, skipped: true, skipReason: 'no-followup',
      prechecked: delivery.prechecked, visualWaived: policy.visualWaived === true, visualOptOut: policy.visualOptOut === true,
      reviewIssues: delivery.reviewIssues, failure: delivery.failure, verification: delivery.verification
    };
  }
  processExitError() {
    const exit = this.transport.lastExit;
    return new Error(exit ? `Node 内核进程已退出（PID ${exit.pid}，退出码 ${exit.code ?? '未知'}，信号 ${exit.signal || '无'}，原因 ${exit.reason}）。请查看运行日志中的 kernel-${exit.pid}.jsonl。` : 'Node 内核连接已断开，请查看运行日志。');
  }
  result(run, messages, status, error) {
    (this.delegation.context(run.id));
    const assistants = messages.filter(item => item.type === 'assistant');
    const last = assistants.at(-1);
    const usage = assistants.reduce((sum, message) => {
      const tokens = tokenUsage(message.tokens || {});
      for (const name of Object.keys(sum)) sum[name] += tokens[name];
      return sum;
    }, tokenUsage());
    for (const child of this.delegation.children(run)) {
      for (const key of Object.keys(usage)) usage[key] += child.usage?.[key] || 0;
    }
    const perf = run.performance ? summarizeRunPerformance(run.performance, usage) : null;
    return { delegation: { records: this.delegation.records(run), reports: run.delegationReports || [], deliveryError: run.reportDeliveryError || '', workflow: this.delegation.workflows.snapshot(run) }, openCodeVersion: VERSION, openCodeSessionId: run.sessionID, runtime: 'node', status,
      ...(status === 'interrupted' ? { interruptionReason: run.interruptionReason || 'system_interrupted' } : {}),
      text: text(last?.content), reasoning: assistants.flatMap(item => item.content).filter(item => item.type === 'reasoning').map(item => item.text).join('\n'),
      toolCalls: assistants.flatMap(item => item.content).filter(item => item.type === 'tool').map(item => ({ callId: item.id, name: item.name, input: item.state.input, output: text(item.state.content), ok: item.state.status === 'completed' })),
      usage, todos: latestTodos(messages)?.todos ?? run.todos ?? [], changes: [], contextCompressionCount: run.compactions || 0, userRequestedFinish: !!run.finishRequested, ...(perf ? { performance: perf } : {}), ...(error ? { error: errorText(error) } : {}) };
  }
  async cancel(id) {
    const run = this.runs.get(id);
    if (!run) return { ok: false, error: '任务不存在' };
    if (run.cancelling) return run.cancelling;
    const clearRetry = () => {
      run.cancelling = null;
      const root = this.runs.get(this.delegation.root(run)) || run;
      root.cancelVisited = null;
    };
    run.cancelling = this.cancelRunTree(run).then(result => {
      if (!result?.ok) clearRetry();
      return result;
    }, error => { clearRetry(); throw error; });
    return run.cancelling;
  }
  async cancelRunTree(run) {
    run.cancelled = true;
    run.interruptionReason ||= 'user_cancel';
    const stopChildren = this.delegation.stop(run);
    if (run.sessionID && this.client) {
      const sessions = this.client.session;
      const failures = [];
      const root = this.runs.get(this.delegation.root(run)) || run;
      const visited = root.cancelVisited ||= new Set();
      const stop = async sessionID => {
        if (visited.has(sessionID)) return;
        visited.add(sessionID);
        try { await bounded(() => sessions.interrupt({ sessionID })); }
        catch (error) { failures.push(errorText(error)); }
        // Discover after interrupting the parent so children created since the
        // last UI poll are included, including paginated descendants.
        try {
          let cursor;
          do {
            const page = await bounded(() => sessions.list({ parentID: sessionID, limit: 100, ...(cursor ? { cursor } : {}) }));
            for (const child of page.data) await stop(child.id);
            cursor = page.cursor?.next;
          } while (cursor);
        } catch (error) { failures.push(errorText(error)); }
      };
      await stop(run.sessionID);
      await stopChildren;
      if (failures.length) return { ok: false, error: failures.join('; ') };
    }
    await stopChildren;
    return { ok: true };
  }
  async replyPermission(payload) {
    const run = this.runs.get(payload.runId);
    // The renderer retries a failed reply. A run that already settled can never
    // accept one, so say so with a code instead of a bare message.
    if (!run?.sessionID) return { ok: false, code: 'RUN_GONE', error: '任务不存在' };
    const requestID = payload.requestID || payload.requestId;
    const decision = ['once', 'always', 'reject'].includes(payload.reply) ? payload.reply : 'reject';
    const previous = run.permissionReplies?.get(requestID);
    if (previous) return { ok: true, alreadyResolved: true, reply: previous };
    try {
      await this.client.permission.reply({ sessionID: run.approvalSessions?.get(requestID) || run.sessionID, requestID, decision, message: payload.message });
    } catch (error) {
      // An "always" reply may resolve another pending request before its UI
      // reply arrives. Give the corresponding SSE acknowledgement time to arrive;
      // never turn arbitrary missing IDs or transport failures into approvals.
      if (/not.?found|404/i.test(errorText(error))) {
        for (let i = 0; i < 10 && !run.permissionReplies?.has(requestID); i++) await delay(25);
        if (run.permissionReplies?.has(requestID)) return { ok: true, alreadyResolved: true, reply: run.permissionReplies.get(requestID) };
      }
      throw error;
    }
    if (!['once', 'always'].includes(payload.reply)) run.permissionDenied = true;
    return { ok: true };
  }
  async deliverInterjection(id, analysis) {
    const run = this.runs.get(id);
    if (!run?.sessionID) return { ok: false, error: '任务不存在' };
    if (run.finishing || run.cancelled) return { ok: false, delivered: false, error: '主任务正在结束，请在主对话中发送下一条消息。' };
    const guidance = String(analysis.guidance || analysis.text || analysis.message || '').trim();
    if (!guidance) return { ok: false, delivered: false, error: '没有可送达的引导内容。' };
    if (analysis.childSessionId || analysis.childSessionID) return { ok: false, delivered: false, code: 'SUBAGENT_DIRECT_GUIDANCE_DISABLED', error: '请在主对话中提出要求，由主代理转达给子代理。' };
    if (analysis.requestFinish) run.finishRequested = true;
    const text = ['YAN LIVE USER INTERJECTION', guidance,
      run.finishRequested
        ? 'User intent: finish gracefully after making the current state coherent; do not hard-cancel and do not add optional polish.'
        : 'User intent: adjust the remaining work without interrupting the active operation.'
    ].join('\n\n');
    if (run.view) this.delegation.consumeIdle(run);
    await this.client.session.prompt({ sessionID: run.sessionID, text, delivery: 'steer' });
    const payload = { sessionID: run.sessionID, count: 1, requestFinish: !!run.finishRequested };
    run.emit({ type: 'yan.interjection.processing', data: payload });
    run.emit({ type: 'yan.interjection.processed', data: payload });
    return { ok: true, delivered: true, target: 'run', requestFinish: !!run.finishRequested };
  }
  async replyQuestion(payload) {
    const run = this.runs.get(payload.runId);
    if (!run?.sessionID) return { ok: false, error: '任务不存在' };
    const input = { sessionID: run.approvalSessions?.get(payload.requestId) || run.sessionID, formID: payload.requestId };
    if (payload.reject) await this.client.session.form.cancel(input);
    else {
      const form = await this.client.session.form.get(input);
      // A lost HTTP response may be retried after the kernel accepted it.
      if (form.state?.status === 'answered') return { ok: true };
      const answer = Object.fromEntries(form.fields.map((field, i) => [field.key,
        field.type === 'multiselect'
          ? (payload.answers?.[i] || []).map(value => field.options?.find(option => option.label === value)?.value ?? value)
          : field.options?.find(option => option.label === (payload.answers?.[i] || []).join(', '))?.value
            ?? (payload.answers?.[i] || []).join(', ')]));
      await this.client.session.form.reply({ ...input, answer });
    }
    return { ok: true };
  }
  async runChanges(id) {
    const run = this.runs.get(id) || this.completed.get(id);
    if (!run?.sessionID) return [];
    if (run.changes && (!run.request || run.changesRevision === run.reviewRevision)) return run.changes;
    const revision = run.reviewRevision;
    const diffs = await this.client.session.diff({ sessionID: run.sessionID, ...(run.from ? { from: run.from } : {}) });
    if (!run.request?.workspace) return diffs;
    // Child tools belong to separate native sessions. Include their receipts in
    // the root review, including outside Git where native snapshots are empty.
    const family = reviewMessages(this.delegation.familyMessages(run));
    const toolChanges = await summarizeOpenCodeToolChanges(run.request.workspace, family, { includeDiff: true });
    run.changes = mergeReviewChanges(run.request.workspace, diffs,
      mergeReviewChanges(run.request.workspace, this.delegation.settledChanges(run), toolChanges));
    run.changesRevision = revision;
    return run.changes;
  }
  mergeChildChanges(run, changes) {
    run.childChanges = mergeReviewChanges(run.request.workspace, run.childChanges || [], changes);
    run.reviewRevision = (run.reviewRevision || 0) + 1;
  }
  async sessionChanges(payload) {
    const sessionID = payload.openCodeSessionId || payload.sessionId;
    const messages = await this.messages(sessionID);
    const users = messages.filter(item => item.type === 'user' && item.time.created >= (payload.startTime || 0) && item.time.created <= (payload.endTime || Infinity));
    if (!users.length) return [];
    const diffs = await this.client.session.diff({ sessionID, from: users[0].id, to: users.at(-1).id });
    const workspace = payload.workspace || payload.directory;
    if (!workspace) return diffs;
    const family = [...messages, ...await this.delegation.savedChildMessages(sessionID)];
    const changes = await summarizeOpenCodeToolChanges(workspace, reviewMessages(family), {
      startTime: payload.startTime, endTime: payload.endTime, includeDiff: payload.includeDiff !== false, paths: payload.paths
    });
    return mergeReviewChanges(workspace, diffs, changes);
  }
  // The model sees only the messages after the last completed compaction, so
  // that list is the honest source for both sides of a manual compression.
  async activeContext(sessionID) {
    if (!this.client?.session?.context) return null;
    const page = await this.client.session.context({ sessionID });
    return Array.isArray(page) ? page : Array.isArray(page?.data) ? page.data : null;
  }
  compactionBudget(request = {}) {
    let config = {};
    try { config = translateConfig(request.openCodeConfig || {}); } catch { config = {}; }
    const model = config.providers?.[request.providerId]?.models?.[request.modelId];
    const contextWindow = Number(model?.limit?.input) || Number(model?.limit?.context) || 0;
    // Match V2 calculateCeiling, including an explicit zero buffer.
    const buffer = config.compaction?.buffer
      ?? Math.max(Math.floor(contextWindow * 0.1), contextWindow >= 32000 ? 16000 : 0);
    const softThreshold = contextWindow > 0 ? contextWindow - buffer : 0;
    return { contextWindow, softThreshold, hardThreshold: contextWindow };
  }
  async compressSession(request) {
    await this.start(request.openCodeConfig);
    const sessionID = request.openCodeSessionId;
    if ([...this.runs.values()].some(run => run.sessionID === sessionID)) throw new Error('任务运行中，不能压缩');
    // A restored session can still reference a model from an old connection.
    // Compact uses the persisted session model, not the runtime default.
    await this.client.session.switchModel({ sessionID,
      model: { providerID: request.providerId, id: request.modelId } });
    const budget = this.compactionBudget(request);
    const baseline = new Set((await this.messages(sessionID)).map(item => item.id));
    const before = await this.activeContext(sessionID).catch(() => null);
    const beforeTokens = before ? estimateContextTokens(before) : null;
    await this.client.session.compact({ sessionID });
    const deadline = Date.now() + this.compactionTimeoutMs;
    while (Date.now() < deadline) {
      const fresh = (await this.messages(sessionID)).filter(item => !baseline.has(item.id));
      const item = fresh.find(item => item.type === 'compaction');
      if (item?.status === 'completed') {
        const after = await this.activeContext(sessionID).catch(() => null);
        // Omit an unavailable measurement instead of reporting 0, so the UI
        // can keep its own estimate rather than show a fake empty context.
        return { compacted: true, estimated: true,
          ...(beforeTokens === null ? {} : { beforeTokens }),
          ...(after === null ? {} : { afterTokens: estimateContextTokens(after) }), budget };
      }
      if (item?.status === 'failed') return { compacted: false, error: compactionErrorText(item.error), budget };
      // Model resolution and other admission failures can end execution before
      // any compaction message exists. Do not wait two minutes for that message.
      const idle = fresh.find(item => item.type === 'idle' && item.outcome !== 'succeeded');
      if (idle) return { compacted: false,
        error: compactionErrorText(idle.error) || (idle.outcome === 'interrupted' ? '上下文压缩已中断' : '内核未生成压缩摘要，请重试'), budget };
      await delay(200);
    }
    await this.client.session.interrupt({ sessionID });
    throw new Error(`压缩超时（${Math.round(this.compactionTimeoutMs / 1000)} 秒），已请求中断`);
  }
  async deleteKernelSessionTrees(ids, directory, options = {}) {
    if (!this.client) return { ok: false, notRunning: true, error: '请先启动 Node 内核后删除会话' };
    const failed = [];
    let deleted = 0;
    const discovered = new Set();
    const discover = async sessionID => {
      if (discovered.has(sessionID)) return;
      discovered.add(sessionID);
      let cursor;
      do {
        const page = await this.client.session.list({ parentID: sessionID, limit: 100, ...(cursor ? { cursor } : {}) });
        for (const child of page.data) await discover(child.id);
        cursor = page.cursor?.next;
      } while (cursor);
    };
    for (const sessionID of ids) {
      try {
        const live = [...this.runs.values()].find(run => run.sessionID === sessionID);
        if (live) { await this.cancel(live.id); await live.finished; }
        await discover(sessionID);
        // Notify the archive before native recursive deletion hides descendants.
        await options.onDiscovered?.([...discovered]);
        await this.client.session.remove({ sessionID });
        deleted++;
      }
      catch (error) { if (!/not.?found|404/i.test(errorText(error))) failed.push(sessionID); }
    }
    return { ok: failed.length === 0, deleted, failed };
  }
  async reviewMemory(payload = {}) {
    const empty = { memories: [], skillCandidate: null, harnessCandidates: [], refinementOutcomes: [] };
    if (!payload.hostControlReview && (!['done', 'error'].includes(payload.result?.status) || payload.userRequestedFinish)) return empty;
    if (!this.client || !payload.modelId) return { ...empty, error: 'Memory reviewer model is unavailable' };
    const { memoryReviewerSystem, buildMemoryReviewInput, MEMORY_REVIEW_SCHEMA, normalizeMemoryReview } = require('../kernel-policy');
    const { normalizeExperienceMarkdown } = require('../experience-markdown');
    let session;
    try {
      session = await this.client.session.create({ location: { directory: this.transport.paths.home },
        title: 'Yan long-term memory reviewer', model: { providerID: payload.providerId, id: payload.modelId },
        permissions: [{ action: '*', resource: '*', effect: 'deny' }] });
      let correction = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const baseline = new Set((await this.messages(session.id)).map(item => item.id));
        await this.client.session.prompt({ sessionID: session.id, text: [memoryReviewerSystem(),
          'Return only a JSON object matching this schema. Do not use tools.', JSON.stringify(MEMORY_REVIEW_SCHEMA),
          JSON.stringify(buildMemoryReviewInput(payload)), correction].filter(Boolean).join('\n\n') });
        const deadline = Date.now() + 120000;
        let fresh;
        while (Date.now() < deadline) {
          fresh = (await this.messages(session.id)).filter(item => !baseline.has(item.id));
          const idle = fresh.findLast(item => item.type === 'idle');
          if (idle) {
            if (idle.outcome !== 'succeeded') throw new Error(errorText(idle.error || 'Memory review interrupted'));
            break;
          }
          await delay(200);
        }
        if (!fresh?.some(item => item.type === 'idle')) throw new Error('Memory review timed out');
        try {
          const output = text(fresh.findLast(item => item.type === 'assistant')?.content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
          const structured = JSON.parse(output);
          if (!structured || !Array.isArray(structured.memories) || !Array.isArray(structured.harnessCandidates) || !Array.isArray(structured.refinementOutcomes)) throw new Error('Invalid memory review result');
          for (const item of [...structured.memories, ...structured.harnessCandidates]) {
            item.content = normalizeExperienceMarkdown(item.content, { title: item.title || item.key || '经验',
              maxLength: structured.memories.includes(item) ? 700 : 5800 }).markdown.trim();
          }
          return normalizeMemoryReview(structured, payload.workspace);
        } catch (error) {
          if (attempt === 2) throw error;
          correction = `Previous result failed validation: ${error.message}. Return a corrected complete JSON result based only on the original evidence.`;
        }
      }
    } catch (error) { return { ...empty, error: errorText(error) }; }
    finally {
      if (session && this.client) {
        await this.client.session.interrupt({ sessionID: session.id }).catch(() => {});
        await this.client.session.remove({ sessionID: session.id }).catch(() => {});
      }
    }
  }
  async close() {
    for (const run of this.runs.values()) { run.cancelled = true; run.interruptionReason = 'app_shutdown'; }
    const active = [...this.runs.values()];
    try {
      await bounded(async () => {
        await Promise.allSettled(active.filter(run => !this.delegation.context(run.id)).map(run => this.cancel(run.id)));
        await Promise.all(active.map(run => run.finished));
      }, 12000);
    } catch { this.killNow(); }
    finally {
      try { await bounded(() => this.resources.close()); }
      finally {
        try { await bounded(() => this.transport.close()); }
        catch { this.killNow(); }
        finally { await this.delegation.close(); }
      }
    }
  }
}
module.exports = { OpenCodeV2Adapter, startupCancellationAction };
