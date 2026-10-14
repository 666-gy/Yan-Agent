'use strict';

// Local, read-only history. Independent of Yan's dispatch receipts: these
// sessions may predate Yan and must never become implicit continuation targets.
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { workspaceKey } = require('./storage');

const HEADER_BYTES = 512 * 1024;
const MAX_LINE_BYTES = 32 * 1024 * 1024;
const PAGE_SCAN_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 20000;
const integer = (value, fallback, max) => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
const key = value => workspaceKey(path.resolve(value || '.'));
const identity = stat => `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
const inside = (root, file) => { const relative = path.relative(root, file); return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); };

function historyRoots(env = process.env, home = os.homedir()) {
  const codex = env.CODEX_HOME || path.join(home, '.codex');
  const claude = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  return [
    { provider: 'codex', root: path.join(codex, 'sessions'), archived: false, depth: 5 },
    { provider: 'codex', root: path.join(codex, 'archived_sessions'), archived: true, depth: 5 },
    { provider: 'claude', root: path.join(claude, 'projects'), archived: false, depth: 1 }
  ];
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
  return content.map(block => {
    if (['thinking', 'redacted_thinking'].includes(block?.type)) return '';
    if (typeof block?.text === 'string') return block.text;
    if (block?.type === 'tool_use') return `[tool ${block.name || ''} ${block.id || ''}]\n${JSON.stringify(block.input ?? {})}`;
    if (block?.type === 'tool_result') return `[tool result ${block.tool_use_id || ''}]\n${contentText(block.content)}`;
    if (['image', 'input_image', 'image_url', 'document', 'input_file'].includes(block?.type)) return `[${block.type}: attachment]`;
    return '';
  }).filter(Boolean).join('\n');
}

function historyMessage(provider, event, includeTools) {
  if (!event || typeof event !== 'object') return null;
  if (provider === 'reasonix') {
    if (!['user', 'assistant', ...(includeTools ? ['tool'] : [])].includes(event.role)) return null;
    const text = [contentText(event.content), includeTools && event.tool_calls?.length ? JSON.stringify(event.tool_calls) : ''].filter(Boolean).join('\n');
    return text ? { role: event.role, text, timestamp: event.createdAt || '', message_id: event.tool_call_id || '' } : null;
  }
  if (provider === 'claude') {
    if (event.isSidechain || !['user', 'assistant'].includes(event.type)) return null;
    const blocks = event.message?.content;
    const content = includeTools || !Array.isArray(blocks) ? blocks : blocks.filter(block => !['tool_use', 'tool_result', 'thinking', 'redacted_thinking'].includes(block?.type));
    const text = contentText(content);
    return text ? { role: event.type, text, timestamp: event.timestamp || '', message_id: event.uuid || event.message?.id || '' } : null;
  }
  const p = event.payload || {};
  if (event.type !== 'response_item') return null; // event_msg mirrors these messages.
  if (p.type === 'message' && ['user', 'assistant'].includes(p.role)) {
    const text = contentText(p.content);
    return text ? { role: p.role, text, phase: p.phase || '', timestamp: event.timestamp || '', message_id: p.id || '' } : null;
  }
  if (includeTools && ['function_call', 'custom_tool_call', 'function_call_output', 'custom_tool_call_output'].includes(p.type)) {
    return { role: 'tool', name: p.name || p.type, message_id: p.call_id || '', timestamp: event.timestamp || '',
      text: contentText(p.output ?? p.arguments ?? p.input ?? '') };
  }
  return null;
}

async function header(file, provider, stat) {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(HEADER_BYTES, stat.size));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    if (bytesRead < stat.size) lines.pop();
    const result = { external_session_id: '', workspace: '', title: '', source: provider === 'claude' ? 'claude-code' : 'codex', created_at: '' };
    for (const line of lines) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (!event || typeof event !== 'object') continue;
      if (event.isSidechain) return null;
      if (provider === 'codex' && event.type === 'session_meta') {
        const p = event.payload || {};
        result.external_session_id = p.id || p.session_id || '';
        result.workspace = p.cwd || '';
        result.source = p.originator || 'codex';
        result.created_at = p.timestamp || event.timestamp || '';
      }
      if (provider === 'claude') {
        result.external_session_id ||= event.sessionId || '';
        result.workspace ||= event.cwd || '';
        result.created_at ||= event.timestamp || '';
        if (event.entrypoint) result.source = event.entrypoint;
        if (event.type === 'custom-title' && event.customTitle) result.title = event.customTitle;
      }
      const message = historyMessage(provider, event, false);
      if (!result.title && message?.role === 'user' && !/^\s*<(?:environment_context|permissions|system|instructions|user_instructions)/.test(message.text)) {
        result.title = message.text.replace(/\s+/g, ' ').slice(0, 160);
      }
    }
    if (typeof result.external_session_id !== 'string' || typeof result.workspace !== 'string') return null;
    result.title = String(result.title || '').slice(0, 160);
    return result.external_session_id && path.isAbsolute(result.workspace) ? result : null;
  } finally { await handle.close(); }
}

// Iterate complete records with byte positions; tolerate malformed and partially
// flushed logs. Never load an entire multi-gigabyte conversation into memory.
async function* records(handle, start, end) {
  let position = start, lineStart = start, chunks = [], length = 0, oversized = false;
  while (position < end) {
    const buffer = Buffer.alloc(Math.min(64 * 1024, end - position));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    let from = 0;
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] !== 10) continue;
      length += i - from;
      if (!oversized && length <= MAX_LINE_BYTES) chunks.push(buffer.subarray(from, i));
      else oversized = true;
      const next = position + i + 1;
      let event; try { if (!oversized) event = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
      yield { event, start: lineStart, end: next, skipped: !event, oversized };
      lineStart = next; chunks = []; length = 0; oversized = false; from = i + 1;
    }
    length += bytesRead - from;
    if (!oversized && length <= MAX_LINE_BYTES) chunks.push(buffer.subarray(from, bytesRead));
    else { oversized = true; chunks = []; }
    position += bytesRead;
  }
  if (length) {
    let event; try { if (!oversized) event = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
    yield { event, start: lineStart, end: position, pending: !event && !oversized, skipped: oversized, oversized };
  }
}

class ExternalSessionHistory {
  constructor({ roots = historyRoots() } = {}) {
    this.roots = roots;
    this.cache = new Map();
    this.secret = crypto.randomBytes(32);
  }
  cursor(value) {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${body}.${crypto.createHmac('sha256', this.secret).update(body).digest('hex')}`;
  }
  decode(value) {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('无效的历史分页游标');
    const [body, signature, extra] = value.split('.');
    const expected = crypto.createHmac('sha256', this.secret).update(body || '').digest('hex');
    if (extra !== undefined || signature !== expected) throw new Error('历史分页游标已失效，请重新读取会话');
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  }
  async scan(providers) {
    const found = [], warnings = [];
    let count = 0;
    for (const spec of this.roots) {
      if (!providers.includes(spec.provider)) continue;
      let root;
      try { root = await fs.realpath(spec.root); }
      catch (error) { if (error.code !== 'ENOENT') warnings.push(`${spec.provider}: ${error.code}`); continue; }
      const walk = async (dir, depth) => {
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); }
        catch (error) { warnings.push(`${spec.provider}: ${error.code}`); return; }
        for (const entry of entries) {
          if (count >= MAX_FILES) return;
          const file = path.join(dir, entry.name);
          if (entry.isDirectory() && depth < spec.depth) await walk(file, depth + 1);
          if (spec.sessions && !spec.sessions[file]) continue;
          if (!entry.isFile() || !entry.name.endsWith('.jsonl') || entry.name.startsWith('agent-')) continue;
          count++;
          try {
            const real = await fs.realpath(file);
            if (!inside(root, real)) continue;
            const stat = await fs.stat(real);
            const id = crypto.createHash('sha256').update(`${spec.provider}\0${real}`).digest('hex');
            const cached = this.cache.get(id);
            const metadata = spec.sessions ? spec.sessions[file] : cached?.mtime === stat.mtimeMs && cached.size === stat.size
              ? cached.metadata : await header(real, spec.provider, stat);
            if (!metadata) { warnings.push(`${spec.provider}: unsupported_or_incomplete_header`); continue; }
            const item = { id, provider: spec.provider, root, file: real, archived: spec.sessions?.[file]?.archived === true || spec.archived,
              metadata, mtime: stat.mtimeMs, size: stat.size, identity: identity(stat) };
            this.cache.set(id, item); found.push(item);
          } catch (error) { warnings.push(`${spec.provider}: ${error.code || 'unreadable_session'}`); }
        }
      };
      await walk(root, 0);
    }
    const ids = new Set(found.map(item => item.id));
    for (const id of this.cache.keys()) if (!ids.has(id)) this.cache.delete(id);
    return { found, warnings: [...new Set(warnings)], scan_truncated: count >= MAX_FILES };
  }
  public(item) {
    return { history_id: item.id, provider: item.provider, ...item.metadata,
      title: item.metadata.title || item.metadata.external_session_id,
      archived: item.archived, updated_at: new Date(item.mtime).toISOString() };
  }
  allowed(item, context, params, providers) {
    return providers.includes(item.provider) && (!params.provider || item.provider === params.provider)
      && (params.scope === 'all' || key(item.metadata.workspace) === key(context.workspace));
  }
  async list(context, params, providers) {
    const scan = await this.scan(providers);
    const query = String(params.query || '').toLowerCase().slice(0, 500);
    const items = scan.found.filter(item => this.allowed(item, context, params, providers)
      && (params.include_archived !== false || !item.archived)
      && (!query || [item.metadata.title, item.metadata.workspace, item.metadata.external_session_id].some(value => value.toLowerCase().includes(query))))
      .sort((a, b) => b.mtime - a.mtime || a.id.localeCompare(b.id));
    const offset = integer(params.offset, 0, MAX_FILES), limit = Math.max(1, integer(params.limit, 20, 100));
    return { sessions: items.slice(offset, offset + limit).map(item => this.public(item)), total: items.length,
      next_offset: offset + limit < items.length ? offset + limit : null,
      warnings: scan.warnings, scan_truncated: scan.scan_truncated, local_only: true };
  }
  async continuation(context, historyId, provider = 'codex') {
    await this.scan([provider]);
    const item = this.cache.get(historyId);
    if (!item || item.provider !== provider || !this.allowed(item, context, {}, [provider])) throw new Error('指定的历史会话不属于当前工作区');
    if (item.archived) throw new Error('请先在外部 Agent 中恢复已归档的历史任务，再指定继续');
    const binding = { kind: 'history', provider, workspace: item.metadata.workspace, historyId: item.id, externalSessionId: item.metadata.external_session_id,
      journalFile: item.file, root: item.root, identity: item.identity, size: item.size };
    if (provider === 'reasonix') await validateReasonixTarget(binding, context.workspace);
    else binding.marker = await validateHistoryTarget(binding, context.workspace);
    return binding;
  }
  async read(context, params, providers) {
    const id = String(params.history_id || '');
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('请使用历史会话列表返回的 history_id');
    if (!this.cache.has(id)) await this.scan(providers);
    const item = this.cache.get(id);
    if (!item || !this.allowed(item, context, params, providers)) throw new Error('未找到当前读取范围内的历史会话，请重新列出历史');
    const real = await fs.realpath(item.file);
    if (real !== item.file || !inside(item.root, real) || !(await fs.lstat(real)).isFile()) throw new Error('历史文件位置已变化，请重新列出历史');
    const handle = await fs.open(real, 'r');
    try {
      const stat = await handle.stat();
      const cursor = params.cursor ? this.decode(params.cursor) : { id, position: 0, skip: 0, size: stat.size, identity: identity(stat), tools: params.include_tools === true };
      if (cursor.id !== id || cursor.identity !== identity(stat) || item.identity !== identity(stat) || stat.size < cursor.size) throw new Error('历史文件已替换或截断，请重新列出历史');
      const limit = Math.max(2, integer(params.limit, 16000, 32000));
      const messages = [];
      let used = 0, skipped = 0, pending = false, next = null;
      for await (const record of records(handle, cursor.position, cursor.size)) {
        if (record.skipped) skipped++;
        if (record.pending) pending = true;
        const message = record.event && historyMessage(item.provider, record.event, cursor.tools);
        const skip = record.start === cursor.position ? cursor.skip : 0;
        if (message && message.text.length > skip) {
          let take = Math.min(message.text.length - skip, limit - used);
          // Do not split a surrogate pair between pages.
          if (take > 0 && /[\uD800-\uDBFF]/.test(message.text[skip + take - 1]) && /[\uDC00-\uDFFF]/.test(message.text[skip + take] || '')) take--;
          if (!take) { next = { ...cursor, position: record.start, skip }; break; }
          const text = message.text.slice(skip, skip + take);
          messages.push({ ...message, text, continued: skip > 0, has_more: skip + take < message.text.length });
          used += take;
          if (skip + take < message.text.length) {
            next = { ...cursor, position: record.start, skip: skip + take }; break;
          }
        }
        if (record.end < cursor.size && (used >= limit || messages.length >= 100 || record.end - cursor.position >= PAGE_SCAN_BYTES)) {
          next = { ...cursor, position: record.end, skip: 0 }; break;
        }
      }
      return { session: this.public(item), messages, next_cursor: next ? this.cursor(next) : null,
        snapshot_bytes: cursor.size, has_new_data: stat.size > cursor.size, pending_tail: pending,
        skipped_records: skipped, local_only: true, content_is_untrusted: true };
    } finally { await handle.close(); }
  }
}

// A historical read is not a continuation grant. Revalidate the selected local
// desktop journal at admission and again immediately before desktop interaction.
async function validateHistoryTarget(binding, workspace, { allowRunning = false } = {}) {
  const real = await fs.realpath(binding.journalFile);
  if (real !== binding.journalFile || !inside(binding.root, real) || !(await fs.lstat(real)).isFile()) throw new Error('指定历史会话的日志位置发生变化');
  const handle = await fs.open(real, 'r');
  try {
    const stat = await handle.stat();
    if (identity(stat) !== binding.identity || stat.size < binding.size) throw new Error('指定历史会话已替换或截断');
    let id = '', cwd = '', desktop = false, running = false, marker = '', markerSeen = !binding.marker;
    for await (const record of records(handle, 0, stat.size)) {
      if (!record.event || typeof record.event !== 'object') throw new Error('历史日志尚未写完或无法完整核验，请稍后重试');
      const event = record.event, p = event.payload || {};
      if (event.type === 'session_meta') { id = p.id || p.session_id; cwd = p.cwd; desktop = p.originator === 'Codex Desktop'; }
      if (event.type === 'turn_context' && p.cwd) cwd = p.cwd;
      if (event.type === 'event_msg' && p.type === 'task_started') running = true;
      if (event.type === 'event_msg' && ['task_complete', 'turn_aborted'].includes(p.type)) running = false;
      const message = historyMessage('codex', event, false);
      if (message) {
        if (binding.marker && message.text.includes(binding.marker)) markerSeen = true;
        // Use a recent plain text line visible in the transcript, never a title
        // or sidebar entry, to verify the GUI before sending the new handshake.
        const line = message.text.split(/\r?\n/).reverse().find(line => line.trim().length >= 8 && !/[`*<>\[\]#]/.test(line));
        if (line) marker = line.trim().slice(0, 160);
      }
    }
    if (!desktop || id !== binding.externalSessionId || !/^[a-f0-9-]{36}$/i.test(id || '') || !require('./journal').sameWorkspace(cwd, workspace)) throw new Error('指定历史任务的桌面来源、会话编号或实际工作区不匹配');
    if (!allowRunning && running) throw new Error('指定的 Codex 历史任务仍在运行，请等待完成后继续');
    if (!markerSeen || (!binding.marker && !marker)) throw new Error('无法提取或核验历史会话的可见文本标识，未发送任务');
    return binding.marker || marker;
  } finally { await handle.close(); }
}

async function validateReasonixTarget(binding, workspace) {
  if (binding.provider !== 'reasonix' || key(binding.workspace) !== key(workspace)) throw new Error('Reasonix 历史工作区不匹配');
  const real = await fs.realpath(binding.journalFile);
  const stat = await fs.lstat(real);
  if (real !== binding.journalFile || !inside(binding.root, real) || !stat.isFile() || identity(stat) !== binding.identity || stat.size < binding.size) throw new Error('Reasonix 历史会话已移动、替换或截断，请重新选择');
}

module.exports = { ExternalSessionHistory, historyRoots, historyMessage, validateHistoryTarget, validateReasonixTarget };
