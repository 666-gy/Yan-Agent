'use strict';

// Read-only adapters for journals written by the DESKTOP applications. Never
// write their databases, credentials, session files, or private IPC sockets.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { canonical, workspaceKey } = require('./storage');

function textOf(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(b => ['text', 'input_text', 'output_text'].includes(b.type)).map(b => b.text || '').join('') : '';
}
function sameWorkspace(a, b) {
  try { return workspaceKey(canonical(a)) === workspaceKey(canonical(b)); } catch { return false; }
}
function journalRoot(provider, home = os.homedir()) {
  return path.join(home, provider === 'claude' ? '.claude/projects' : '.codex/sessions');
}
function candidates(root, since) {
  const files = [];
  function walk(dir, depth) {
    if (depth > 5) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try { if (fs.statSync(file).mtimeMs >= since - 5000) files.push(file); } catch {}
      }
    }
  }
  walk(root, 0);
  return files;
}

class Journal {
  constructor(provider, workspace, handshake, assignment) {
    Object.assign(this, { provider, workspace, handshake, assignment, offset: 0, pending: Buffer.alloc(0),
      sessionId: '', cwd: '', desktop: false, handshakeSeen: false, ready: false,
      inputSeen: false, output: '', status: '', error: '', turnId: '', activeTurn: '', parts: new Map() });
  }
  feed(e) {
    // Replaying a journal after restart must recover OUR finished turn even if
    // the user subsequently continued the same desktop conversation.
    if (['succeeded', 'failed', 'cancelled', 'blocked'].includes(this.status)) return;
    if (this.provider === 'claude') {
      if (e.isSidechain) return;
      if (e.entrypoint) this.desktop = e.entrypoint.startsWith('claude-desktop');
      if (e.cwd) this.cwd = e.cwd;
      if (e.sessionId) this.sessionId = e.sessionId;
      if (e.type === 'user' && typeof e.message?.content === 'string') this.user(e.message.content);
      if (e.type === 'assistant' && !e.isApiErrorMessage) {
        if (this.inputSeen) {
          for (const [i, block] of (e.message?.content || []).entries()) {
            if (block.type === 'text') this.parts.set(`${e.message.id || e.uuid}:${e.apiBlockIndex ?? i}`, block.text || '');
          }
          this.output = [...this.parts.values()].join('\n\n');
        }
        this.endTurn = e.message?.stop_reason === 'end_turn';
      }
      if (e.type === 'assistant' && e.isApiErrorMessage) {
        this.finish('failed', textOf(e.message?.content) || '桌面 Agent 返回 API 错误');
      }
      // A text block or tool_use is not completion. Hooks can continue a turn.
      if (e.type === 'system' && e.subtype === 'stop_hook_summary') {
        if (e.preventedContinuation === false && this.endTurn) this.finish('succeeded');
        else if (e.preventedContinuation === true) this.endTurn = false;
      }
      if (e.type === 'user' && /\[Request interrupted by user/.test(textOf(e.message?.content))) this.finish('cancelled', '桌面任务已被用户停止');
    } else {
      const p = e.payload || {};
      if (e.type === 'session_meta') {
        this.sessionId = p.id || p.session_id || '';
        this.cwd = p.cwd || '';
        this.desktop = p.originator === 'Codex Desktop';
      }
      if (e.type === 'turn_context' && p.cwd) this.cwd = p.cwd;
      if (e.type === 'event_msg' && p.type === 'task_started') this.activeTurn = p.turn_id;
      if (e.type === 'response_item' && p.type === 'message' && p.role === 'user') this.user(textOf(p.content));
      if (e.type === 'response_item' && p.type === 'message' && p.role === 'assistant' && this.inputSeen && p.phase === 'final_answer') {
        this.output = textOf(p.content);
      }
      if (e.type === 'event_msg' && (!this.turnId || !p.turn_id || p.turn_id === this.turnId)) {
        if (p.type === 'task_complete') {
          if (this.inputSeen && typeof p.last_agent_message === 'string') this.output = p.last_agent_message;
          this.finish('succeeded');
        }
        if (p.type === 'turn_aborted') this.finish('cancelled', '桌面任务已停止');
        if (p.type === 'error') this.finish('failed', typeof p.message === 'string' ? p.message : '桌面任务失败');
      }
    }
    if (this.handshakeSeen && (!this.desktop || !sameWorkspace(this.cwd, this.workspace))) {
      this.error = this.inputSeen ? '正式任务发送后桌面会话来源或工作区发生变化；请检查并停止原会话，不会重发'
        : '桌面会话来源或实际工作区不匹配；未授权执行正式任务';
      this.status = this.inputSeen ? 'uncertain' : 'blocked'; this.ready = false;
    }
  }
  user(text) {
    const normal = value => value.replace(/\r\n/g, '\n').replace(/\n+$/, '');
    if (normal(text) === normal(this.handshake)) { this.handshakeSeen = true; this.turnId = this.activeTurn; }
    if (this.ready && normal(text) === normal(this.assignment)) {
      this.inputSeen = true; this.turnId = this.activeTurn; this.status = ''; this.endTurn = false;
    } else if (this.inputSeen && normal(text) !== normal(this.assignment) && !text.startsWith('[Request interrupted')) {
      this.status = 'uncertain'; this.error = '外部会话收到其他用户输入；请检查原会话，不会重新派发';
    }
  }
  finish(status, error = '') {
    if (!this.handshakeSeen || this.status === 'uncertain' || this.status === 'blocked') return;
    if (this.inputSeen) { this.status = status; this.error = error; }
    else if (status === 'succeeded') this.ready = true;
    else { this.status = status; this.error = error || '桌面握手未完成'; }
  }
  poll(file) {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size < this.offset) throw new Error('桌面会话日志被截断，无法确认任务结果');
      let remaining = size - this.offset;
      // Bound each read, preserving UTF-8 across chunks and incomplete lines.
      while (remaining > 0) {
        const chunk = Buffer.alloc(Math.min(remaining, 256 * 1024));
        const count = fs.readSync(fd, chunk, 0, chunk.length, this.offset);
        if (!count) break;
        this.offset += count; remaining -= count;
        this.pending = Buffer.concat([this.pending, chunk.subarray(0, count)]);
        let newline;
        while ((newline = this.pending.indexOf(10)) !== -1) {
          const line = this.pending.subarray(0, newline).toString('utf8');
          this.pending = this.pending.subarray(newline + 1);
          if (line.trim()) this.feed(JSON.parse(line));
        }
        if (this.pending.length > 32 * 1024 * 1024) throw new Error('桌面日志单条记录过大，已停止解析但不会重发任务');
      }
    } finally { fs.closeSync(fd); }
    return this;
  }
}

function discover(provider, workspace, handshake, assignment, since, root = journalRoot(provider)) {
  const matches = [];
  for (const file of candidates(root, since)) {
    const journal = new Journal(provider, workspace, handshake, assignment);
    try { journal.poll(file); } catch { continue; }
    if (journal.handshakeSeen) matches.push({ file, journal });
  }
  if (matches.length > 1) throw new Error('发现多个同一任务的桌面会话，已暂停且不会重发');
  return matches[0] || null;
}

module.exports = { Journal, discover, journalRoot, sameWorkspace, textOf };
