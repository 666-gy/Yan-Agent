'use strict';

// Read-only access to the per-run harness context file.
//
// Yan's MCP servers are long-lived child processes shared by every workspace:
// the kernel config signature must stay identical across tasks, so the active
// workspace travels with the task_id the model passes on each call instead of
// entering the server environment. `registerHarnessRunContext` writes
// `<sha256(runId)>.json`; this module reads it back for the workspace-scoped
// tools (Yan Skills project source, Yan Analysis, Yan Workspace).

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function readRunContext(contextDir, taskId) {
  const dir = String(contextDir || '').trim();
  const id = String(taskId || '').trim();
  if (!dir || !id) return null;
  const key = crypto.createHash('sha256').update(id).digest('hex');
  try {
    const context = JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), 'utf8'));
    return context && context.runId === id ? context : null;
  } catch {
    return null;
  }
}

function runWorkspace(contextDir, taskId) {
  const context = readRunContext(contextDir, taskId);
  return context && typeof context.workspace === 'string' ? context.workspace : '';
}

// Loads the Yan config with the calling task's workspace applied, so a shared
// MCP resolves project/workspace-scoped data for that task only.
async function readTaskScopedConfig(configPath, contextDir, taskId) {
  let config = {};
  try { config = JSON.parse(await fsp.readFile(configPath, 'utf8')); } catch {}
  const workspace = runWorkspace(contextDir, taskId);
  if (workspace) config.workspace = workspace;
  return config;
}

module.exports = { readRunContext, runWorkspace, readTaskScopedConfig };
