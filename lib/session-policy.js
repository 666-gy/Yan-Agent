'use strict';

function isDefaultSessionTitle(title) {
  const value = String(title || '').trim().toLowerCase();
  return !value || value === 'new chat' || value === '新对话';
}

function getSessionMessageCount(session) {
  if (Array.isArray(session?.messages)) return session.messages.length;
  return Number(session?.messageCount) || 0;
}

function isBlankNewChat(session) {
  return !!session && isDefaultSessionTitle(session.title) && getSessionMessageCount(session) === 0;
}

function isBlankUnassignedNewChat(session) {
  return isBlankNewChat(session) && !String(session.workspace || '').trim();
}

function findReusableBlankSession(sessions) {
  return (sessions || []).find(isBlankUnassignedNewChat) || null;
}

function evaluateSessionDeletion(session, _total, options = {}) {
  if (!session) return { ok: false, code: 'not-found', error: '任务不存在' };
  if (options.running) return { ok: false, code: 'running', error: '任务运行中，无法删除' };
  if (!isBlankNewChat(session) && !options.confirmed) {
    return {
      ok: false,
      code: 'confirmation-required',
      error: '删除非空任务前需要确认',
      requiresConfirmation: true
    };
  }
  return { ok: true };
}

module.exports = {
  evaluateSessionDeletion,
  findReusableBlankSession,
  getSessionMessageCount,
  isBlankNewChat,
  isBlankUnassignedNewChat,
  isDefaultSessionTitle
};
