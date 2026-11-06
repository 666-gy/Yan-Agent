'use strict';

(require('path'));

function safeErrorText(value) {
  if (typeof value === 'string') return value.trim();
  if (value == null || typeof value !== 'object') return value == null ? '' : String(value);
  try {
    return JSON.stringify(value).slice(0, 300);
  } catch {
    return '[unserializable error object]';
  }
}

function openCodeErrorDetail(value) {
  const error = value?.error || value || {};
  const candidates = [
    error,
    error.data,
    error.body,
    error.cause,
    error.cause?.data,
    error.cause?.body,
    error.cause?.body?.data
  ].filter(candidate => candidate && typeof candidate === 'object');
  const tags = candidates.flatMap(candidate => [candidate.name, candidate._tag, candidate.kind])
    .map(safeErrorText)
    .map(item => item.trim())
    // Kernel-internal names like UnknownError carry no information once the
    // upstream message text exists; keep specific tags (ConfigInvalidError…).
    .filter(Boolean)
    .filter(tag => !/^(?:error|unknownerror|unknown_error)$/i.test(tag));
  const messages = candidates.flatMap(candidate => [
    ...Array.isArray(candidate.data) ? [] : [candidate.data?.message],
    candidate.message,
    candidate.detail,
    candidate.reason
  ])
    .map(safeErrorText)
    .map(item => item.trim())
    .filter((item, index, all) => item && all.indexOf(item) === index);
  const statusTexts = candidates.flatMap(candidate => [
    candidate.statusCode ? `HTTP ${candidate.statusCode}` : '',
    typeof candidate.responseBody === 'string' && candidate.responseBody.trim()
      ? safeErrorText(candidate.responseBody).trim().slice(0, 300)
      : ''
  ]).filter(Boolean);
  const issues = candidates.flatMap(candidate => Array.isArray(candidate.issues) ? candidate.issues : [])
    .map(issue => {
      if (typeof issue === 'string') return issue.trim();
      const path = Array.isArray(issue?.path) ? issue.path.join('.') : safeErrorText(issue?.path || issue?.field);
      const message = safeErrorText(issue?.message || issue?.reason || issue?.code).trim();
      return path && message ? `${path}: ${message}` : (message || path);
    })
    .filter(Boolean);
  // Original tag-first order is asserted by tests; noisy generic tags are
  // filtered above so upstream text reads clean on its own.
  const details = [...new Set([...tags, ...messages, ...issues, ...statusTexts])];
  if (details.length) return details.join(': ');
  if (typeof error === 'string') return error;
  return 'Unknown OpenCode error';
}

module.exports = { safeErrorText, openCodeErrorDetail };
