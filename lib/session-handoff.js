'use strict';

const path = require('path');

const MAX_HANDOFF_MESSAGES = 24;
const MAX_HANDOFF_CHARS = 64000;
const MAX_HANDOFF_MESSAGE_CHARS = 6000;

function normalizeWorkspacePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return path.resolve(raw);
  } catch {
    return '';
  }
}

function normalizeAbsoluteWorkspacePath(value) {
  const raw = String(value || '').trim();
  if (!raw || !path.isAbsolute(raw)) return '';
  return normalizeWorkspacePath(raw);
}

function workspaceKey(value) {
  const normalized = normalizeWorkspacePath(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function sameWorkspace(left, right) {
  return workspaceKey(left) === workspaceKey(right);
}

function findLatestWorkspaceSession(sessions, targetWorkspace, options = {}) {
  const target = normalizeAbsoluteWorkspacePath(targetWorkspace);
  if (!target) return null;
  const excludedIds = new Set(
    (Array.isArray(options.excludeSessionIds) ? options.excludeSessionIds : [])
      .map(id => String(id || ''))
      .filter(Boolean)
  );
  let latest = null;
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session?.id || excludedIds.has(String(session.id))) continue;
    if (!sameWorkspace(session.workspace, target)) continue;
    if (!latest) {
      latest = session;
      continue;
    }
    const updatedDifference = (Number(session.updatedAt) || 0) - (Number(latest.updatedAt) || 0);
    if (updatedDifference > 0) {
      latest = session;
      continue;
    }
    if (updatedDifference < 0) continue;
    const createdDifference = (Number(session.createdAt) || 0) - (Number(latest.createdAt) || 0);
    if (createdDifference > 0 || (createdDifference === 0 && String(session.id) > String(latest.id))) {
      latest = session;
    }
  }
  return latest;
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  return content.map(part => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (part.type === 'text') return String(part.text || '');
    if (part.type === 'image_url') return '[图片]';
    return '';
  }).filter(Boolean).join('\n');
}

function clippedMessageContent(content) {
  const text = contentToText(content).trim();
  if (text.length <= MAX_HANDOFF_MESSAGE_CHARS) return text;
  return `${text.slice(0, MAX_HANDOFF_MESSAGE_CHARS)}\n[内容已截断]`;
}

function collectHandoffMessages(messages) {
  const source = (Array.isArray(messages) ? messages : [])
    .filter(message => ['system', 'user', 'assistant'].includes(message?.role));
  const selected = [];
  let used = 0;
  for (let index = source.length - 1; index >= 0 && selected.length < MAX_HANDOFF_MESSAGES; index--) {
    const message = source[index];
    const content = clippedMessageContent(message.content);
    if (!content) continue;
    const remaining = MAX_HANDOFF_CHARS - used;
    if (remaining <= 0) break;
    const clipped = content.slice(0, remaining);
    selected.unshift({
      role: message.role,
      content: clipped,
      ts: Number(message.ts) || 0,
      attachments: (message.attachments || []).map(item => ({
        name: String(item?.name || ''),
        type: String(item?.type || item?.mimeType || '')
      })).filter(item => item.name).slice(0, 12)
    });
    used += clipped.length;
  }
  return selected;
}

function formatHandoffContext(handoff) {
  const lines = [
    'Yan cross-session handoff:',
    `Source task: ${handoff.sourceTitle || handoff.sourceSessionId}`,
    `Source workspace: ${handoff.sourceWorkspace || '(blank)'}`,
    `Active workspace: ${handoff.targetWorkspace || '(blank)'}`,
    'The active workspace is the only filesystem root for this new task.',
    'Prior approvals, running tools and pending confirmations were not transferred.'
  ];
  for (const message of handoff.messages || []) {
    const role = message.role === 'assistant' ? 'Assistant' : (message.role === 'user' ? 'User' : 'Context');
    lines.push('', `${role}:`, message.content);
  }
  return lines.join('\n');
}

function createHandoffPackage(sourceSession, targetWorkspace, options = {}) {
  const sourceWorkspace = normalizeWorkspacePath(sourceSession?.workspace);
  const target = normalizeWorkspacePath(targetWorkspace);
  const handoff = {
    id: String(options.id || ''),
    version: 1,
    createdAt: Number(options.now) || Date.now(),
    sourceSessionId: String(sourceSession?.id || ''),
    sourceTitle: String(sourceSession?.title || '来源任务'),
    sourceWorkspace,
    targetWorkspace: target,
    sourceMessageCount: Array.isArray(sourceSession?.messages) ? sourceSession.messages.length : 0,
    messages: collectHandoffMessages(sourceSession?.messages)
  };
  handoff.context = formatHandoffContext(handoff);
  return handoff;
}

module.exports = {
  contentToText,
  createHandoffPackage,
  findLatestWorkspaceSession,
  formatHandoffContext,
  normalizeAbsoluteWorkspacePath,
  normalizeWorkspacePath,
  sameWorkspace
};
