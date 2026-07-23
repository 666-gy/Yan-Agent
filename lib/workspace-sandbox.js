/**
 * Yan Agent — workspace sandbox (main process)
 * All agent file/shell/git paths must resolve inside the active workspace.
 */
const path = require('path');
const fs = require('fs');

const DESTRUCTIVE_SHELL_RE = /(?:^|[\s;&|])(?:rm\s+(-[a-zA-Z]*\s+)*-r[a-zA-Z]*|rmdir\s+\/s|del\s+\/[sq]|Remove-Item\s+.*-Recurse|format\s+[a-z]:|mkfs\.|dd\s+if=|>\s*\/dev\/sd|reg\s+delete|Remove-ItemProperty|Shutdown|Restart-Computer|Stop-Computer|curl\s+.*\|\s*(?:sh|bash|powershell)|iwr\s+.*\|\s*iex|Invoke-Expression\s*\(|Start-Process\s+.*-Verb\s+RunAs)/i;

function normalizeWorkspace(workspace) {
  const raw = String(workspace || '').trim();
  if (!raw) return '';
  try {
    return path.resolve(raw);
  } catch {
    return '';
  }
}

/**
 * Resolve a candidate path and ensure it stays inside workspace.
 * @returns {{ ok: true, path: string, workspace: string } | { ok: false, error: string, code: string }}
 */
function resolveInsideWorkspace(workspace, filePath, options = {}) {
  const ws = normalizeWorkspace(workspace);
  const raw = String(filePath || '').trim();
  if (!raw) {
    return { ok: false, error: 'Path is empty.', code: 'PATH_EMPTY' };
  }
  if (!ws) {
    return {
      ok: false,
      error: 'Workspace is not set. Choose a workspace before reading or writing project files.',
      code: 'WORKSPACE_REQUIRED'
    };
  }

  let resolved;
  try {
    if (path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
      resolved = path.resolve(raw);
    } else {
      resolved = path.resolve(ws, raw);
    }
  } catch (error) {
    return { ok: false, error: `Invalid path: ${error.message}`, code: 'PATH_INVALID' };
  }

  const rel = path.relative(ws, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      ok: false,
      error: `Path escapes workspace: ${raw}`,
      code: 'PATH_ESCAPE',
      path: resolved,
      workspace: ws
    };
  }

  if (options.mustExist) {
    try {
      if (!fs.existsSync(resolved)) {
        return { ok: false, error: `Path not found: ${resolved}`, code: 'PATH_NOT_FOUND', path: resolved, workspace: ws };
      }
    } catch (error) {
      return { ok: false, error: error.message, code: 'PATH_STAT_FAILED', path: resolved, workspace: ws };
    }
  }

  return { ok: true, path: resolved, workspace: ws, relative: rel || '.' };
}

function assertDirInsideWorkspace(workspace, dirPath) {
  const ws = normalizeWorkspace(workspace);
  if (!ws) {
    return { ok: false, error: 'Workspace is not set.', code: 'WORKSPACE_REQUIRED' };
  }
  if (!dirPath) {
    return { ok: true, path: ws, workspace: ws };
  }
  return resolveInsideWorkspace(ws, dirPath);
}

/**
 * Classify shell risk. Destructive patterns require explicit allowDestructive flag.
 */
function classifyShellCommand(command) {
  const cmd = String(command || '');
  if (!cmd.trim()) return { level: 'empty', blocked: true, code: 'SHELL_EMPTY', reason: 'Command is empty.' };
  if (DESTRUCTIVE_SHELL_RE.test(cmd)) {
    return {
      level: 'destructive',
      blocked: true,
      code: 'SHELL_DESTRUCTIVE',
      reason: 'Destructive or high-impact shell command blocked by policy. Use safer scoped commands, or ask the user to run this manually.'
    };
  }
  return { level: 'normal', blocked: false, code: null, reason: null };
}

function resolveShellCwd(workspace, cwd) {
  const ws = normalizeWorkspace(workspace);
  if (!ws) {
    return { ok: false, error: 'Workspace is not set for shell execution.', code: 'WORKSPACE_REQUIRED' };
  }
  if (!cwd) return { ok: true, path: ws, workspace: ws };
  return resolveInsideWorkspace(ws, cwd);
}

/**
 * Parse IPC payload that may be a bare path string or { filePath, workspace, ... }.
 */
function parsePathPayload(payload, pathKey = 'filePath') {
  if (payload == null) return { filePath: '', workspace: '' };
  if (typeof payload === 'string') return { filePath: payload, workspace: '' };
  if (typeof payload === 'object') {
    return {
      filePath: payload[pathKey] ?? payload.path ?? payload.filePath ?? '',
      workspace: payload.workspace ?? payload.dirPath ?? payload.cwd ?? '',
      ...payload
    };
  }
  return { filePath: String(payload), workspace: '' };
}

module.exports = {
  normalizeWorkspace,
  resolveInsideWorkspace,
  assertDirInsideWorkspace,
  classifyShellCommand,
  resolveShellCwd,
  parsePathPayload,
  DESTRUCTIVE_SHELL_RE
};
