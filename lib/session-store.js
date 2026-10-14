'use strict';

// Session store (plan T3.1): the session JSON files, their parsed/summary
// caches, handoff bookkeeping and deletion safety. Moved verbatim from main.js;
// run state, the main window and the yanagent store arrive through explicit
// dependencies so this module stays independently testable.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { createDeletionFence } = require('./deletion-fence');
const { writeAtomic } = require('./yan-core/store');
const { purgeSessionArtifacts, describeSessionArtifacts } = require('./session-artifacts');
const {
  evaluateSessionDeletion,
  findReusableBlankSession
} = require('./session-policy');
const {
  contentToText,
  createHandoffPackage,
  findLatestWorkspaceSession,
  normalizeWorkspacePath,
  sameWorkspace
} = require('./session-handoff');
const { filterReviewSummary } = require('./run-change-summary');

// Durable session JSON carries no version field today, so a reader cannot tell
// a record written by an older build from a corrupt one — it just spreads
// whatever it finds over the expected shape. Recovery bookkeeping then gets
// force-overwritten instead of migrated, which is how a status vocabulary
// change silently becomes data loss. Records are stamped on write and migrated
// on read, so no migration ever has to touch updatedAt.
const SESSION_FORMAT_VERSION = 2;

// Adjacent steps only. Each entry upgrades a record from version N to N+1 and
// must be pure: no disk writes, no clock reads, no dependency on run state.
// A record at an unknown version is left exactly as found — a reader must never
// renumber a record it does not understand.
const SESSION_MIGRATIONS = new Map([
  [1, migrateSessionV1ToV2]
]);

// The vocabulary a turn can no longer move out of. Mirrors the Core Thread
// status machine (lib/yan-core/protocol.js TERMINAL_TURN_STATUSES) so a session
// and its Core Thread never disagree about whether a turn is finished. A turn
// missing from this set was interrupted by the process dying, not by the user.
const TERMINAL_SESSION_TURN_STATUSES = new Set(['completed', 'error', 'interrupted', 'aborted', 'cancelled']);

function isSafeSessionId(value) {
  const id = String(value || '').trim();
  return /^sess_[A-Za-z0-9_-]{4,160}$/.test(id);
}

// v1 records predate the version field entirely. The only shape change between
// v1 and v2 is that an unfinished turn now has to be explicitly closed, which
// closeInterruptedTurns() does — so the step itself is just the stamp. It is a
// registered step rather than a special case so that the next format change has
// a home and does not have to invent the mechanism.
function migrateSessionV1ToV2(session) {
  session.schemaVersion = 2;
  return session;
}

function migrateSessionRecord(session) {
  if (!session || typeof session !== 'object') return session;
  let version = Number(session.schemaVersion);
  // An unstamped record is v1: the format as it shipped before stamping began.
  if (!Number.isFinite(version) || version < 1) version = 1;
  if (version > SESSION_FORMAT_VERSION) return session;
  while (version < SESSION_FORMAT_VERSION) {
    const step = SESSION_MIGRATIONS.get(version);
    if (!step) break;
    session = step(session) || session;
    const next = Number(session.schemaVersion);
    // A step that does not advance the version would loop forever; refuse to
    // spin on a malformed migration instead.
    if (!Number.isFinite(next) || next <= version) break;
    version = next;
  }
  return session;
}

function sanitizeSessionReviewSummaries(session) {
  if (!session || typeof session !== 'object') return session;
  const workspace = String(session.workspace || '');
  for (const message of Array.isArray(session.messages) ? session.messages : []) {
    const run = message?.agentRun;
    if (!run?.changeSummary) continue;
    const summary = filterReviewSummary(workspace, run.changeSummary);
    run.changeCount = summary.count;
    if (summary.count > 0) run.changeSummary = summary;
    else delete run.changeSummary;
  }
  return session;
}

// Subagent records keep live de-duplication bookkeeping: every observed event
// id, milestone copies of tool output, and streaming buffers. Once a record is
// terminal none of it is read again, but serializing it on every save made
// long tasks with many subagents produce tens of megabytes of session JSON,
// which then stalled the main process on every read, save and list refresh.
const TERMINAL_SUBAGENT_STATUSES = new Set(['completed', 'error', 'interrupted', 'incomplete']);
const SUBAGENT_RUNTIME_BOOKKEEPING_FIELDS = ['seenEvents', 'milestones', 'pendingDeltas', 'nextStreams', 'partKinds', 'messages'];

// Long tasks often hold a few multi-megabyte messages (subagent records with
// full tool output). Count-based paging alone still ships those whole, so IPC
// payloads are bounded by accumulated character size as well.
const MESSAGE_TAIL_COUNT = 40;
const MESSAGE_TAIL_CHAR_BUDGET = 3_000_000;
const MESSAGE_PAGE_CHAR_BUDGET = 6_000_000;
const messageSizeEstimateCache = new WeakMap();

function estimateMessageSize(value, depth = 0) {
  if (value == null) return 0;
  const type = typeof value;
  if (type === 'string') return value.length;
  if (type !== 'object') return 8;
  if (depth > 8) return 8;
  if (depth === 0) {
    const cached = messageSizeEstimateCache.get(value);
    if (cached !== undefined) return cached;
    let total = 0;
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        total += key.length + 2 + estimateMessageSize(value[key], depth + 1);
      }
      if (total > 64_000_000) break;
    }
    messageSizeEstimateCache.set(value, total);
    return total;
  }
  let total = 0;
  if (Array.isArray(value)) {
    for (const item of value) total += estimateMessageSize(item, depth + 1);
    return total;
  }
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      total += key.length + 2 + estimateMessageSize(value[key], depth + 1);
    }
    if (total > 64_000_000) break;
  }
  return total;
}

function selectTailMessages(messages, countLimit = MESSAGE_TAIL_COUNT, sizeBudget = MESSAGE_TAIL_CHAR_BUDGET) {
  let start = messages.length;
  let count = 0;
  let size = 0;
  while (start > 0) {
    const estimated = estimateMessageSize(messages[start - 1]);
    // Always keep at least the newest message so a single oversized message
    // cannot produce an empty conversation.
    if (start < messages.length && (count >= countLimit || size + estimated > sizeBudget)) break;
    start -= 1;
    count += 1;
    size += estimated;
  }
  return { tail: messages.slice(start), messagesStart: start };
}

function pruneSessionRuntimeBookkeeping(session) {
  if (!session || typeof session !== 'object') return session;
  for (const message of Array.isArray(session.messages) ? session.messages : []) {
    const run = message?.agentRun;
    if (!run || typeof run !== 'object' || !Array.isArray(run.subagents)) continue;
    for (const record of run.subagents) {
      if (!record || typeof record !== 'object' || !TERMINAL_SUBAGENT_STATUSES.has(record.status)) continue;
      for (const field of SUBAGENT_RUNTIME_BOOKKEEPING_FIELDS) {
        if (record[field] !== undefined) delete record[field];
      }
    }
  }
  return session;
}

// Run statuses that are not a resting state. The renderer persists a session
// only when a Turn ends, so a record found on disk with one of these can only
// mean the process died with the Turn still live — the save that would have
// finalized it never happened.
const NON_TERMINAL_RUN_STATUSES = new Set(['working', 'running', 'pending', 'paused', 'observing']);

// Close a Turn the previous process abandoned. Until this runs, a session
// interrupted by an app exit is indistinguishable from one the user aborted on
// purpose: both are stored as `interrupted`, and only `recoveredAfterRestart`
// separates them (renderer.js messageEndedByUserAbort). A stalled tail is the
// worse half — a user message with no assistant reply renders as though the
// model silently ignored it.
//
// This is a pure transform over one record: it never writes, never reads the
// clock, and never touches updatedAt. Regenerating the closing events on every
// read is what keeps it safe to run inside the read path, where it must not
// have side effects.
function closeInterruptedTurns(session) {
  const closed = [];
  if (!session || typeof session !== 'object') return { session, closed };
  const messages = Array.isArray(session.messages) ? session.messages : [];
  if (!messages.length) return { session, closed };

  // Only the final Turn can be interrupted: every earlier one already has a
  // persisted ending, or the tail check below would not have found a boundary.
  let turnStart = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (String(messages[index]?.role || '') === 'user') { turnStart = index; break; }
  }

  const tail = turnStart >= 0 ? messages.slice(turnStart + 1) : messages;
  const tailOffset = turnStart >= 0 ? turnStart + 1 : 0;
  for (let index = 0; index < tail.length; index += 1) {
    const message = tail[index];
    const run = message?.agentRun;
    if (!run || typeof run !== 'object') continue;
    if (!NON_TERMINAL_RUN_STATUSES.has(String(run.status || ''))) continue;
    const previousStatus = String(run.status);
    run.status = 'interrupted';
    // The renderer distinguishes "the app went away" from "the user pressed
    // stop" by this flag alone (renderer.js messageEndedByUserAbort), so it
    // must sit on the run itself, not only inside the detail object below.
    run.recoveredAfterRestart = true;
    // Same vocabulary as the Yan Core recovery pass (lib/yan-core/core.js
    // recoverInterruptedTurns) so the two stores describe one event one way.
    run.interruption = {
      previousStatus,
      detectedAt: Number(message.ts) || Number(run.startedAt) || Number(session.createdAt) || 0,
      recoveredAfterRestart: true
    };
    run.completedAt = run.completedAt || Number(message.ts) || Date.now();
    closed.push({ messageIndex: tailOffset + index, previousStatus, runId: String(run.runId || '') });
  }

  // A user message with nothing after it never got an assistant record at all,
  // so there is no agentRun to close. Synthesize the closing message the Turn
  // would have written, rather than leaving the tail silent.
  if (turnStart >= 0 && turnStart === messages.length - 1) {
    const promptTs = Number(messages[turnStart].ts) || Number(session.createdAt) || Date.now();
    const agentRun = {
      // Deterministic, so a reopen of the same record describes the same Turn
      // instead of inventing a new identity each read.
      runId: `${String(session.id || 'session')}:interrupted`,
      status: 'interrupted',
      startedAt: promptTs,
      completedAt: promptTs,
      durationMs: 0,
      textContent: '',
      timeline: [],
      toolCallCount: 0,
      todos: [],
      recoveredAfterRestart: true,
      // The user aborted nothing; the application went away while this Turn was
      // pending. Distinct from messageEndedByUserAbort, which reads `status`.
      interruption: { previousStatus: 'pending', detectedAt: promptTs, recoveredAfterRestart: true }
    };
    messages.push({ role: 'assistant', content: '', ts: promptTs, duration: 0, agentRun, yanSynthetic: true });
    closed.push({ messageIndex: messages.length - 1, previousStatus: 'pending', runId: agentRun.runId });
  }

  return { session, closed };
}

// Every kernel session a Yan task has used: the current one, plus the older
// ones recorded on each run after a model or kernel switch.
function collectKernelSessionIds(record) {
  const ids = new Set();
  const add = value => {
    const id = String(value || '').trim();
    if (id) ids.add(id);
  };
  add(record?.openCodeSessionId);
  for (const message of Array.isArray(record?.messages) ? record.messages : []) add(message?.agentRun?.openCodeSessionId);
  return [...ids];
}

function createSessionStore(deps) {
  const deletionFence = createDeletionFence(deps.sessionsDir);
  const sessionWrites = new Map();
  const pendingContents = new Map();
  const deletedError = () => Object.assign(new Error('任务已永久删除或正在清理，不能重新保存'), { code: 'SESSION_DELETED' });
  const {
    sessionsDir,
    ensureDirs,
    mainWindow,
    yanagent,
    activateWorkspace,
    activeRuns,
    runAdmissions,
    deleteCoreThread,
    deleteKernelSessions
  } = deps;

  function sessionPath(id) {
    const normalized = String(id || '').trim();
    return isSafeSessionId(normalized) ? path.join(sessionsDir, `${normalized}.json`) : null;
  }

  // Archive metadata is independent of message saves, including stale renderer saves.
  const archiveFile = path.join(sessionsDir, '.archived');
  function readArchives() {
    try { return JSON.parse(fs.readFileSync(archiveFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  function setSessionArchivedRecord(ids, archived) {
    ensureDirs();
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !isSafeSessionId(id) || deletionFence.has(id) || !fs.existsSync(sessionPath(id)))) {
      return { ok: false, error: '聊天不存在' };
    }
    const records = readArchives();
    for (const id of ids) { if (archived) records[id] = Date.now(); else delete records[id]; }
    fs.writeFileSync(archiveFile + '.tmp', JSON.stringify(records));
    fs.renameSync(archiveFile + '.tmp', archiveFile);
    notifyDesktopSessionUpdate({ archived: !!archived, ids });
    return { ok: true };
  }

  // session:get fires on every task switch, and re-reading plus re-parsing a
  // multi-megabyte session file each time stalled the main process for hundreds
  // of milliseconds while the window sat on the loading spinner. Cache parsed
  // records keyed by file mtime+size, exactly like the summary cache below.
  const sessionRecordCache = new Map();
  const SESSION_RECORD_CACHE_MAX = 6;

  function touchSessionRecordCache(id, session, stat) {
    const key = String(id || '');
    if (!key || !session || !stat || deletionFence.has(key)) return;
    sessionRecordCache.delete(key);
    sessionRecordCache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, runActive: isSessionRunActive(key), session });
    while (sessionRecordCache.size > SESSION_RECORD_CACHE_MAX) {
      sessionRecordCache.delete(sessionRecordCache.keys().next().value);
    }
  }

  function invalidateSessionRecordCache(id) {
    sessionRecordCache.delete(String(id || ''));
  }

  // Every durable record load passes through here, so a session is migrated and
  // its abandoned Turn closed identically whether it is opened directly, listed
  // in the sidebar, or located as a handoff target. Migrating in one path and
  // not another is how a record ends up half-upgraded.
  function hydrateSessionRecord(raw, key) {
    const data = pruneSessionRuntimeBookkeeping(sanitizeSessionReviewSummaries(raw));
    migrateSessionRecord(data);
    // This is a read-time recovery projection, not a newly interrupted task.
    // The original file deliberately stays untouched, so logging "closed" here
    // reports the same old tail again on list/get, cache eviction and restart.
    // A turn owned by this process is still live and must not be projected as
    // abandoned while the renderer reads its saved messages.
    if (!isSessionRunActive(key)) closeInterruptedTurns(data);
    return data;
  }

  async function readSessionRecord(id, options = {}) {
    const key = String(id || '');
    const file = sessionPath(key);
    if (!file || !fs.existsSync(file)) return null;
    const stat = await fsp.stat(file);
    const cached = sessionRecordCache.get(key);
    let data;
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && cached.runActive === isSessionRunActive(key)) {
      data = cached.session;
    } else {
      data = hydrateSessionRecord(JSON.parse(await fsp.readFile(file, 'utf8')), key);
      touchSessionRecordCache(key, data, stat);
    }
    // Task switching only needs the newest messages to paint the conversation;
    // the full history stays cached here and is served page by page through
    // session:messages, so a multi-megabyte session no longer crosses IPC whole.
    const messageLimit = Number(options.messageLimit) || 0;
    if (messageLimit > 0 && Array.isArray(data.messages) && data.messages.length > 1) {
      const { tail, messagesStart } = selectTailMessages(data.messages, messageLimit);
      if (messagesStart > 0) {
        return {
          ...data,
          messages: tail,
          totalMessages: data.messages.length,
          messagesStart,
          messagesTruncated: true
        };
      }
    }
    return data;
  }

  // session:list fires after every run completion and session save. Parsing
  // every session file (with full message history) each time made the app
  // progressively slower as usage accumulated. Summaries are tiny immutable
  // objects, so cache them keyed by file mtime+size and re-parse only files
  // that actually changed.
  const sessionSummaryCache = new Map();

  async function listSessionSummaries(options = {}) {
    ensureDirs();
    const files = await fsp.readdir(sessionsDir);
    const summaries = [];
    // Disk state can change while the app runs, so workspace existence is
    // re-checked (one stat per unique workspace) on every list call.
    const workspaceExists = new Map();
    const workspaceMissing = workspace => {
      const value = String(workspace || '').trim();
      if (!value) return false;
      if (!workspaceExists.has(value)) {
        try { workspaceExists.set(value, fs.existsSync(value)); }
        catch { workspaceExists.set(value, false); }
      }
      return !workspaceExists.get(value);
    };
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(sessionsDir, file);
      try {
        const stat = await fsp.stat(filePath);
        const key = file.slice(0, -'.json'.length);
        const runActive = isSessionRunActive(key);
        const cached = sessionSummaryCache.get(filePath);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && cached.runActive === runActive) {
          summaries.push({ ...cached.summary, workspaceMissing: workspaceMissing(cached.summary.workspace) });
          continue;
        }
        // session:save refreshes the parsed-record cache; reuse it so a large
        // session changed by a running task is not parsed a second time here.
        const cachedRecord = sessionRecordCache.get(key);
        let data = null;
        if (cachedRecord && cachedRecord.mtimeMs === stat.mtimeMs && cachedRecord.size === stat.size && cachedRecord.runActive === runActive) {
          data = cachedRecord.session;
        } else {
          // Same hydrate path as a direct read: the sidebar must show the
          // closed Turn and the post-migration message count, not the raw file.
          data = hydrateSessionRecord(JSON.parse(await fsp.readFile(filePath, 'utf8')), key);
        }
        if (!isSafeSessionId(data?.id)) continue;
        const summary = toSessionSummary(data);
        sessionSummaryCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, runActive: isSessionRunActive(key), summary });
        summaries.push({ ...summary, workspaceMissing: workspaceMissing(summary.workspace) });
      } catch { /* skip invalid session files */ }
    }
    const archives = readArchives();
    return summaries.map(item => ({ ...item, deletionPending: deletionFence.has(item.id), archived: !!archives[item.id] || deletionFence.has(item.id), archivedAt: archives[item.id] || 0 }))
      .filter(item => options.includeArchived || item.archived === !!options.archived).sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function toSessionSummary(data) {
    return {
      id: data.id,
      title: data.title,
      workspace: data.workspace || '',
      parentSessionId: data.parentSessionId || '',
      hasHandoff: !!data.handoff,
      pinned: !!data.pinned,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      messageCount: (data.messages || []).length
    };
  }

  function notifyDesktopSessionUpdate(detail) {
    const win = mainWindow.get();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send('session:changed', detail || {});
  }

  let createSessionPromise = null;
  let sessionDeleteQueue = Promise.resolve();

  function isSessionRunActive(sessionId) {
    const target = String(sessionId || '');
    if (!target) return false;
    if ([...activeRuns.values()].some(run => String(run?.yanSessionId || '') === target)) return true;
    return [...runAdmissions.values()].some(admittedSessionId => String(admittedSessionId || '') === target);
  }

  async function createFreshSessionRecord(options = {}) {
    ensureDirs();
    const id = 'sess_' + crypto.randomUUID();
    const session = {
      schemaVersion: SESSION_FORMAT_VERSION,
      id,
      title: String(options.title || '新对话').slice(0, 80),
      messages: [],
      pinned: false,
      workspace: normalizeWorkspacePath(options.workspace),
      createdAt: Date.now(), updatedAt: Date.now()
    };
    if (options.parentSessionId) session.parentSessionId = String(options.parentSessionId);
    if (options.handoff) session.handoff = options.handoff;
    await fsp.writeFile(sessionPath(id), JSON.stringify(session, null, 2), { flag: 'wx' });
    return session;
  }

  async function validateHandoffTarget(sourceWorkspace, targetWorkspace) {
    const source = normalizeWorkspacePath(sourceWorkspace);
    const target = normalizeWorkspacePath(targetWorkspace);
    if (!source) return { ok: false, error: '来源任务当前没有工作区。', code: 'WORKSPACE_SOURCE_REQUIRED' };
    if (!target) return { ok: false, error: '目标工作区路径为空。', code: 'WORKSPACE_TARGET_REQUIRED' };
    if (sameWorkspace(source, target)) {
      return { ok: false, error: '目标工作区必须不同于当前任务工作区。', code: 'WORKSPACE_TARGET_SAME' };
    }
    try {
      const stat = await fsp.stat(target);
      if (!stat.isDirectory()) {
        return { ok: false, error: `目标不是文件夹：${target}`, code: 'WORKSPACE_TARGET_NOT_DIRECTORY' };
      }
    } catch (error) {
      return {
        ok: false,
        error: `目标工作区不存在或无法访问：${target}`,
        code: error?.code || 'WORKSPACE_TARGET_NOT_FOUND'
      };
    }
    return { ok: true, source, target };
  }

  async function resolveWorkspaceSessionForHandoff(sourceSessionId, targetWorkspace) {
    const source = await readSessionRecord(sourceSessionId);
    if (!source) return { ok: false, error: '来源任务不存在。', code: 'SESSION_SOURCE_NOT_FOUND' };
    const validation = await validateHandoffTarget(source.workspace, targetWorkspace);
    if (!validation.ok) return validation;
    // 只用摘要定位目标会话,命中后再读完整记录,避免把所有会话全文解析一遍
    const summary = findLatestWorkspaceSession(await listSessionSummaries(), validation.target, {
      excludeSessionIds: [source.id]
    });
    if (summary) {
      const existing = await readSessionRecord(summary.id);
      if (existing) return { ok: true, session: existing, handoffId: '', reused: true };
    }
    const handoffId = `handoff_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
    const handoff = createHandoffPackage(source, validation.target, { id: handoffId });
    const suffix = ' · 继续';
    const sourceTitle = String(source.title || '任务');
    const baseTitle = sourceTitle.endsWith(suffix) ? sourceTitle.slice(0, -suffix.length) : sourceTitle;
    const session = await createFreshSessionRecord({
      title: `${baseTitle}${suffix}`,
      workspace: validation.target,
      parentSessionId: source.id,
      handoff
    });
    yanagent.migrateMemoryToWorkspace(session.workspace);
    yanagent.ensureYanagent(session.workspace);
    return { ok: true, session, handoffId, reused: false };
  }

  async function readBoundSourceContext(sessionId, startValue, limitValue) {
    const child = await readSessionRecord(sessionId);
    if (!child?.parentSessionId || child.handoff?.sourceSessionId !== child.parentSessionId) {
      return { ok: false, error: '当前任务没有绑定的来源任务。', code: 'SESSION_HANDOFF_REQUIRED' };
    }
    const source = await readSessionRecord(child.parentSessionId);
    if (!source) return { ok: false, error: '来源任务已经不存在。', code: 'SESSION_SOURCE_NOT_FOUND' };
    const messages = Array.isArray(source.messages) ? source.messages : [];
    const limit = Math.max(1, Math.min(20, Number(limitValue) || 10));
    const start = Math.max(0, Math.min(messages.length, Number(startValue) || 0));
    const items = [];
    let remaining = 6000;
    for (const message of messages.slice(start, start + limit)) {
      if (remaining <= 0) break;
      const content = contentToText(message?.content).slice(0, Math.min(3000, remaining));
      remaining -= content.length;
      items.push({
        role: String(message?.role || ''),
        content,
        ts: Number(message?.ts) || 0,
        attachments: (message?.attachments || []).map(item => ({ name: String(item?.name || '') })).filter(item => item.name)
      });
    }
    return {
      ok: true,
      sourceSessionId: source.id,
      sourceTitle: source.title,
      start,
      nextStart: start + items.length < messages.length ? start + items.length : null,
      total: messages.length,
      messages: items
    };
  }

  async function createOrReuseSessionRecord() {
    if (createSessionPromise) return createSessionPromise;
    createSessionPromise = (async () => {
      // 找可复用空会话只需要标题/条数/工作区,用摘要缓存即可,
      // 不必把磁盘上每个会话(可达 45MB)全部解析一遍
      const summaries = await listSessionSummaries();
      const reusable = findReusableBlankSession(summaries);
      if (reusable) {
        const existing = await readSessionRecord(reusable.id);
        if (existing) return { session: existing, reused: true };
      }
      return { session: await createFreshSessionRecord(), reused: false };
    })();
    try {
      return await createSessionPromise;
    } finally {
      createSessionPromise = null;
    }
  }

  async function renameSessionRecord(id, title) {
    const p = sessionPath(id);
    if (!p || !fs.existsSync(p)) return null;
    // 走带缓存读取,命中时免去一次整会话 JSON.parse
    const data = await readSessionRecord(id);
    if (!data) return null;
    const nextTitle = String(title || '').trim().slice(0, 80);
    if (!nextTitle) return null;
    data.title = nextTitle;
    data.updatedAt = Date.now();
    await writeSessionFileAtomic(p, JSON.stringify(data, null, 2));
    await refreshSessionSummaryCache(id, data);
    return data;
  }

  async function setSessionPinnedRecord(id, pinned) {
    const p = sessionPath(id);
    if (!p || !fs.existsSync(p)) return null;
    const data = await readSessionRecord(id);
    if (!data) return null;
    data.pinned = !!pinned;
    data.updatedAt = Date.now();
    await writeSessionFileAtomic(p, JSON.stringify(data, null, 2));
    await refreshSessionSummaryCache(id, data);
    return data;
  }

  function deleteSessionRecord(id, options = {}) {
    const operation = sessionDeleteQueue.then(async () => {
      if (!isSafeSessionId(id)) return { ok: false, code: 'invalid-session-id', error: '会话 ID 无效' };
      // 删除判定只需要标题与消息条数,读摘要即可,避免全量解析所有会话文件
      const sessions = await listSessionSummaries({ includeArchived: true });
      const session = sessions.find(item => item.id === id);
      const cleanupEligible = record => {
        if (options.cleanupDays === undefined) return true;
        const days = Number(options.cleanupDays);
        const updatedAt = Number(record?.updatedAt || record?.createdAt);
        return [30, 90, 180, 365].includes(days) && Number.isFinite(updatedAt) && updatedAt > 0 && updatedAt < Date.now() - days * 86400000;
      };
      if (!cleanupEligible(session)) return { ok: false, code: 'cleanup-filter-changed', error: '聊天已更新或不符合清理条件，请重新检查列表' };
      if (options.archivedOnly && !deletionFence.has(id) && !readArchives()[id]) return { ok: false, error: '此聊天已取消归档，请刷新列表' };
      const running = isSessionRunActive(id);
      const decision = evaluateSessionDeletion(session, sessions.length, { ...options, running });
      if (!decision.ok) return decision;
      const replacedLast = sessions.length <= 1;
      let full = await readSessionRecord(id);
      if (!full) return { ok: false, code: 'not-found', error: '任务不存在' };
      if (isSessionRunActive(id)) return { ok: false, code: 'running', error: '任务运行中，无法删除' };
      const interruptedContents = [...pendingContents.values()].filter(entry => entry.id === id).map(entry => entry.content);
      const cleanupFile = sessionPath(id) + '.deleting';
      let cleanupPlan;
      try {
        // No yield between taking current references, persisting their cleanup
        // plan and fencing writes. This plan never contains message content.
        full = JSON.parse(fs.readFileSync(sessionPath(id), 'utf8'));
        if (options.archivedOnly && !deletionFence.has(id) && !readArchives()[id]) return { ok: false, error: '此聊天已取消归档，请刷新列表' };
        if (!cleanupEligible(full) || interruptedContents.some(content => !cleanupEligible(JSON.parse(content)))) {
          return { ok: false, code: 'cleanup-filter-changed', error: '聊天已更新或不符合清理条件，请重新检查列表' };
        }
        const records = [full, ...interruptedContents.map(content => JSON.parse(content))];
        let previous = {};
        try { previous = JSON.parse(fs.readFileSync(cleanupFile, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        cleanupPlan = { ...describeSessionArtifacts(records), kernelIds: records.flatMap(collectKernelSessionIds) };
        for (const key of ['paths', 'assets', 'workspaces', 'kernelIds']) {
          cleanupPlan[key] = [...new Set([...(previous[key] || []), ...cleanupPlan[key]])];
        }
        writeAtomic(cleanupFile, cleanupPlan);
      } catch (error) {
        return { ok: false, code: 'deletion-prepare-failed', error: '无法准备永久删除，请重试。' + (error?.message || error) };
      }
      // Commit the irreversible write barrier before yielding to cleanup.
      // Until cleanup succeeds the existing record stays available for retry.
      deletionFence.mark(id);
      invalidateSessionRecordCache(id);
      sessionSummaryCache.delete(sessionPath(id));
      const kernelIds = cleanupPlan.kernelIds;
      let kernelDeleted = 0;
      try {
        await Promise.allSettled([...(sessionWrites.get(id) || [])]);
        await deps.onDeleting?.(id);
        const coreDeletion = await deleteCoreThread?.(id);
        if (coreDeletion?.ok === false && coreDeletion.code !== 'YAN_THREAD_NOT_FOUND') {
          throw new Error(coreDeletion.error || coreDeletion.code);
        }
        if (kernelIds.length) {
          if (typeof deleteKernelSessions !== 'function') throw new Error('内核清理服务不可用');
          const result = await deleteKernelSessions({ yanSessionId: id, sessionIds: kernelIds, directory: String(full.workspace || '') });
          const failed = Array.isArray(result?.failed) ? result.failed.length : Number(result?.failed) || 0;
          if (!result || result.ok === false || failed || result.pending || result.notRunning || result.skipped === 'live-kernel') {
            throw new Error(result?.error || '内核会话尚未清理完成');
          }
          kernelDeleted = Number(result.deleted) || 0;
        }
        // No yielding between reference checks, artifact removal and unlink.
        purgeSessionArtifacts({ sessionsDir, filesDir: deps.filesDir, record: full, cleanupPlan,
          interruptedContents, pendingContents: [...pendingContents.values()].filter(entry => entry.id !== id).map(entry => entry.content) });
        // All referenced artifacts are now gone; remove pointer-only retry
        // metadata before the primary record, which remains on any failure.
        for (const name of fs.readdirSync(sessionsDir)) {
          if (name === path.basename(cleanupFile) || name.startsWith(path.basename(cleanupFile) + '.tmp-')) {
            fs.rmSync(path.join(sessionsDir, name), { force: true });
          }
        }
        const archives = readArchives();
        delete archives[id];
        fs.writeFileSync(archiveFile + '.tmp', JSON.stringify(archives));
        fs.renameSync(archiveFile + '.tmp', archiveFile);
        fs.unlinkSync(sessionPath(id));
        invalidateSessionRecordCache(id);
        sessionSummaryCache.delete(sessionPath(id));
      } catch (error) {
        return { ok: false, code: 'deletion-pending', deletionPending: true, id,
          error: '永久删除尚未完成，已阻止任务重新写入；请重试删除。' + (error?.message || error) };
      }
      const replacementSession = replacedLast ? await createFreshSessionRecord().catch(() => null) : null;
      return { ok: true, id, replacedLast, replacementSession, kernelSessions: kernelIds.length, kernelDeleted };
    });
    sessionDeleteQueue = operation.catch(() => {});
    return operation;
  }

  // Session JSON is one of two durable copies of the conversation — the Yan
  // Core Thread (lib/yan-core) is the other, and the two use different status
  // vocabularies for the same Turn. Write to a temporary file and rename so a
  // crash mid-write cannot truncate it.
  // 保存/改名/置顶等写操作后,顺手刷新摘要缓存,
  // 下一次 session:list 就不必为这个(可能 45MB 的)文件重新做整包 JSON.parse
  async function refreshSessionSummaryCache(id, data) {
    try {
      const file = sessionPath(id);
      const stat = await fsp.stat(file);
      sessionSummaryCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, runActive: isSessionRunActive(id), summary: toSessionSummary(data) });
    } catch { /* 缓存留在失效状态,下次 list 自动重建 */ }
  }

  function writeSessionFileAtomic(filePath, content) {
    const id = path.basename(filePath, '.json');
    const allowed = () => !deletionFence.has(id) && fs.existsSync(filePath);
    const operation = (async () => {
      if (!allowed()) throw deletedError();
      const temporary = filePath + '.tmp-' + process.pid + '-' + crypto.randomUUID();
      try {
        await fsp.writeFile(temporary, content);
        // Re-check after disk IO, then commit without yielding to a delete.
        if (!allowed()) throw deletedError();
        try { fs.renameSync(temporary, filePath); }
        catch { fs.copyFileSync(temporary, filePath); }
      } finally { await fsp.rm(temporary, { force: true }); }
    })();
    let writes = sessionWrites.get(id);
    if (!writes) sessionWrites.set(id, writes = new Set());
    const tracked = operation.finally(() => { pendingContents.delete(tracked); writes.delete(tracked); if (!writes.size) sessionWrites.delete(id); });
    pendingContents.set(tracked, { id, content });
    writes.add(tracked);
    return tracked;
  }

  async function getSessionMessages({ id, offset, limit } = {}) {
    const session = await readSessionRecord(id);
    if (!session) return { ok: false, error: '会话不存在' };
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const total = messages.length;
    const requestedStart = Math.max(0, Math.min(total, Number(offset) || 0));
    const requestedCount = Math.max(1, Math.min(200, Number(limit) || 40));
    // Cap each page by accumulated size too, so paging back through a session
    // full of multi-megabyte messages never materializes them all at once.
    let end = requestedStart;
    let size = 0;
    let count = 0;
    while (end < total && count < requestedCount) {
      const estimated = estimateMessageSize(messages[end]);
      if (count > 0 && size + estimated > MESSAGE_PAGE_CHAR_BUDGET) break;
      end += 1;
      count += 1;
      size += estimated;
    }
    return { ok: true, messages: messages.slice(requestedStart, end), total, offset: requestedStart };
  }

  async function createSession(options = {}) {
    const workspace = normalizeWorkspacePath(options.workspace);
    const result = (options.forceNew || workspace)
      ? { session: await createFreshSessionRecord({ workspace }), reused: false }
      : await createOrReuseSessionRecord();
    return result.session;
  }

  async function saveSession(session) {
    if (!session || !isSafeSessionId(session.id)) {
      return { ok: false, error: '会话 ID 无效', code: 'invalid-session-id' };
    }
    if (deletionFence.has(session.id) || !fs.existsSync(sessionPath(session.id))) return { ok: false, code: 'SESSION_DELETED', error: deletedError().message };
    ensureDirs();
    // The renderer may hold only the newest slice of the conversation (loaded
    // through session:get with a message limit). Re-attach the older messages
    // from the stored record so a tail save can never truncate the history.
    let persisted = session;
    if (session.messagesTruncated === true && Number.isInteger(session.messagesStart) && session.messagesStart > 0) {
      const stored = await readSessionRecord(session.id);
      if (stored && Array.isArray(stored.messages)) {
        const head = stored.messages.slice(0, session.messagesStart);
        persisted = {
          ...session,
          messages: [...head, ...(Array.isArray(session.messages) ? session.messages : [])]
        };
        delete persisted.messagesTruncated;
        delete persisted.messagesStart;
        delete persisted.totalMessages;
      }
    }
    sanitizeSessionReviewSummaries(persisted);
    pruneSessionRuntimeBookkeeping(persisted);
    // The renderer's copy carries whatever version it read; the record being
    // written is always current. Without this a migrated v1 session would keep
    // its stale stamp and be re-migrated on every single read.
    persisted.schemaVersion = SESSION_FORMAT_VERSION;
    persisted.updatedAt = Date.now();
    const file = sessionPath(persisted.id);
    try { await writeSessionFileAtomic(file, JSON.stringify(persisted, null, 2)); }
    catch (error) { if (error.code === 'SESSION_DELETED') return { ok: false, code: error.code, error: error.message }; throw error; }
    try {
      const stat = await fsp.stat(file);
      touchSessionRecordCache(persisted.id, persisted, stat);
      await refreshSessionSummaryCache(persisted.id, persisted);
    } catch { invalidateSessionRecordCache(persisted.id); }
    return persisted;
  }

  // 会话级工作区：存储在 session 对象中，而非全局 config，实现会话隔离
  async function setSessionWorkspace(id, workspace, activate = true) {
    const p = sessionPath(id);
    if (!p || !fs.existsSync(p)) return null;
    // 走缓存读取,避免为改一个字段而整包解析 45MB 会话
    const data = await readSessionRecord(id);
    if (!data) return null;
    data.workspace = workspace || '';
    data.updatedAt = Date.now();
    await writeSessionFileAtomic(p, JSON.stringify(data, null, 2));
    await refreshSessionSummaryCache(id, data);
    if (activate !== false) {
      activateWorkspace(workspace || '');
    } else if (workspace) {
      yanagent.migrateMemoryToWorkspace(workspace);
      yanagent.ensureYanagent(workspace);
    }
    return data;
  }

  return {
    sessionPath,
    readSessionRecord,
    listSessionSummaries,
    setSessionArchivedRecord,
    createFreshSessionRecord,
    createOrReuseSessionRecord,
    renameSessionRecord,
    setSessionPinnedRecord,
    deleteSessionRecord,
    isSessionRunActive,
    isSessionDeleted: id => deletionFence.has(id),
    readBoundSourceContext,
    validateHandoffTarget,
    resolveWorkspaceSessionForHandoff,
    notifyDesktopSessionUpdate,
    getSessionMessages,
    createSession,
    saveSession,
    setSessionWorkspace
  };
}

module.exports = {
  isSafeSessionId,
  collectKernelSessionIds,
  createSessionStore,
  estimateMessageSize,
  MESSAGE_PAGE_CHAR_BUDGET
};
