'use strict';

// Harness bridge (plan T5.5): MCP process I/O, harness run context files,
// usage bookkeeping and outcome attribution. Moved verbatim from main.js.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

function createHarnessBridge(deps) {
  const {
    dataDir,
    configStore,
    continualHarness,
    longTermMemory,
    skillRegistry,
    skillEvolution,
    workspaceSandbox,
    refreshYanSkillRegistry
  } = deps;

  function mcpSend(proc, msg) {
    // 子进程崩溃后 stdin 在 close 之前写入会触发 EPIPE;这里守卫 + 静默失败,
    // 由 mcpStart 里挂的 stdin error 监听兜底,绝不能让主进程因未捕获异常退出
    const stdin = proc && proc.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return false;
    try {
      stdin.write(JSON.stringify(msg) + '\n');
      return true;
    } catch {
      return false;
    }
  }

  function killProcessTree(proc) {
    // Windows 上 cmd /c 包装的子进程必须杀整棵树,只 kill 直接子进程会留下孤儿
    if (!proc || typeof proc.pid !== 'number') return;
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } else {
        proc.kill('SIGKILL');
      }
    } catch {}
  }

  function mcpRequest(server, method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = server.nextId++;
      const timer = setTimeout(() => {
        if (server.pending.has(id)) {
          server.pending.delete(id);
          reject(new Error('MCP 请求超时: ' + method));
        }
      }, server.requestTimeoutMs || 30000);
      server.pending.set(id, { resolve, reject, timer });
      if (!mcpSend(server.process, { jsonrpc: '2.0', id, method, params })) {
        server.pending.delete(id);
        clearTimeout(timer);
        reject(new Error('MCP 服务器进程不可用: ' + method));
      }
    });
  }

  function rollbackHarnessProjection(target, workspace) {
    if (!target) return { removedMemories: 0, removedSkills: [] };
    const memoryRemoval = longTermMemory.removeBySource({
      refinementId: target.id,
      workspace
    });
    const removedSkills = [];
    for (const edit of Array.isArray(target.appliedEdits) ? target.appliedEdits : []) {
      if (!edit.applied || edit.kind !== 'skill' || edit.after?.metadata?.status !== 'active') continue;
      const cfg = configStore.loadConfig();
      // The projection records the id the Harness wrote, which can differ in case
      // from the stored entry; match both sides normalized or the rollback leaves
      // the Skill behind while reporting it removed.
      const wanted = skillRegistry.normalizeId(edit.id);
      const skill = (cfg.customSkills || []).find(item => skillRegistry.normalizeId(item?.id) === wanted);
      if (!skill || skill.createdBy !== 'yan-skill-creator') continue;
      const removal = skillRegistry.removeYanUserSkill(dataDir, skill.id);
      if (!removal.ok) continue;
      cfg.customSkills = (cfg.customSkills || []).filter(
        item => skillRegistry.normalizeId(item?.id) !== skillRegistry.normalizeId(skill.id)
      );
      configStore.saveConfig(cfg);
      refreshYanSkillRegistry({ reason: 'harness-rollback', id: skill.id });
      skillEvolution.markRolledBack(skill.id, target.id);
      removedSkills.push(skill.id);
    }
    return { removedMemories: memoryRemoval.removed, removedSkills };
  }

  function harnessRunContextPath(runId) {
    const key = crypto.createHash('sha256').update(String(runId || '')).digest('hex');
    return path.join(dataDir, 'harness', 'runtime', `${key}.json`);
  }

  function registerHarnessRunContext({ runId, sessionId = '', workspace = '', allowFileRead = true, allowNetwork = true, allowFileWrite = true } = {}) {
    const id = String(runId || '').trim();
    if (!id) return '';
    const contextPath = harnessRunContextPath(id);
    const normalizedWorkspace = workspaceSandbox.normalizeWorkspace(workspace);
    const context = {
      schema: 1,
      runId: id,
      sessionId: String(sessionId || ''),
      workspace: normalizedWorkspace || '',
      allowFileRead,
      allowNetwork,
      allowFileWrite,
      requestPath: pendingHarnessRequestPath(id),
      workspaceStatePath: normalizedWorkspace
        ? continualHarness.statePath({ scope: 'workspace', workspace: normalizedWorkspace })
        : '',
      createdAt: Date.now()
    };
    fs.mkdirSync(path.dirname(contextPath), { recursive: true });
    const temporary = `${contextPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(context)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, contextPath);
    return contextPath;
  }

  function removeHarnessRunContext(runId) {
    try { fs.rmSync(harnessRunContextPath(runId), { force: true }); } catch {}
  }

  function pendingHarnessRequestPath(runId) {
    const key = crypto.createHash('sha256').update(String(runId || '')).digest('hex');
    return path.join(dataDir, 'harness', 'pending', `${key}.json`);
  }

  function consumeHarnessRefinementRequest(runId) {
    const filePath = pendingHarnessRequestPath(runId);
    try {
      if (!fs.existsSync(filePath)) return null;
      const request = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      fs.rmSync(filePath, { force: true });
      if (!request || typeof request !== 'object' || String(request.runId || '') !== String(runId || '')) return null;
      return request;
    } catch {
      try { fs.rmSync(filePath, { force: true }); } catch {}
      return null;
    }
  }

  // Queue a refinement on behalf of the application (not the model). Used when
  // a run's last computer-control action is an explicit exit: the post-turn
  // reviewer then performs a real experience review from the run's trajectory.
  // An explicit refinement the model scheduled during the run always wins — the
  // user's own instruction must not be replaced by an app-queued review.
  function writeHarnessRefinementRequest(runId, request = {}) {
    const id = String(runId || '').trim();
    if (!id) return '';
    const filePath = pendingHarnessRequestPath(id);
    if (fs.existsSync(filePath)) return '';
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload = { ...request, schema: request.schema || 1, runId: id };
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, filePath);
    return filePath;
  }

  // Result attribution bookkeeping: remember which harness entries this run
  // actually injected, so the post-turn review can credit or blame them with
  // the run's verified outcome. The review runs outside the Harness MCP context
  // lifecycle, so this state lives in its own file and is consumed exactly once.
  function harnessUsagePath(runId) {
    const key = crypto.createHash('sha256').update(String(runId || '')).digest('hex');
    return path.join(dataDir, 'harness', 'usage', `${key}.json`);
  }

  function pruneHarnessUsageFiles(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    try {
      const dir = path.dirname(harnessUsagePath('probe'));
      const cutoff = Date.now() - Math.max(60_000, Number(maxAgeMs) || 0);
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        const file = path.join(dir, name);
        try {
          if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
        } catch {}
      }
    } catch {}
  }

  function registerHarnessUsage({ runId, workspace = '', sessionId = '', entries = [] } = {}) {
    const id = String(runId || '').trim();
    const items = (Array.isArray(entries) ? entries : []).map(entry => ({
      kind: String(entry?.kind || '').trim(),
      id: String(entry?.id || '').trim(),
      scope: entry?.scope === 'workspace' ? 'workspace' : 'global'
    })).filter(item => item.kind && item.id).slice(0, 32);
    if (!id || !items.length) return '';
    pruneHarnessUsageFiles();
    const filePath = harnessUsagePath(id);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({
      schema: 1,
      runId: id,
      workspace: String(workspace || ''),
      sessionId: String(sessionId || ''),
      injectedAt: Date.now(),
      entries: items
    })}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, filePath);
    return filePath;
  }

  function consumeHarnessUsage(runId) {
    const filePath = harnessUsagePath(runId);
    try {
      if (!fs.existsSync(filePath)) return null;
      const usage = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      fs.rmSync(filePath, { force: true });
      if (!usage || String(usage.runId || '') !== String(runId || '')) return null;
      return usage;
    } catch {
      try { fs.rmSync(filePath, { force: true }); } catch {}
      return null;
    }
  }

  // Only outcomes the run itself can prove count: a completed run with every
  // todo done is a success, a provider-level error is a failure. Runs that
  // stopped early (cancelled, user-requested finish, open todos) stay neutral
  // so attribution never guesses.
  function harnessRunOutcome(result) {
    if (result?.status === 'error') return 'failure';
    const todos = Array.isArray(result?.todos) ? result.todos : [];
    if (result?.status === 'done' && todos.every(todo => todo?.done === true)) return 'success';
    return '';
  }

  async function attributeHarnessUsage({ runId, workspace = '', sessionId = '', result } = {}) {
    const usage = consumeHarnessUsage(runId);
    if (!usage?.entries?.length) return null;
    const outcome = harnessRunOutcome(result);
    if (!outcome) return null;
    const attribution = await continualHarness.recordUsage({
      entries: usage.entries,
      outcome,
      runId,
      sessionId,
      injectedAt: usage.injectedAt
    }, { workspace });
    if (attribution?.demoted?.length) {
      console.warn(`[harness] usage attribution returned ${attribution.demoted.length} repeated-failure entr(ies) to observing for run ${runId}`);
    } else if (attribution && attribution.ok === false) {
      console.warn(`[harness] usage attribution failed for run ${runId}: ${attribution.error || 'unknown error'}`);
    }
    return attribution;
  }

  return {
    mcpSend,
    killProcessTree,
    mcpRequest,
    rollbackHarnessProjection,
    harnessRunContextPath,
    registerHarnessRunContext,
    removeHarnessRunContext,
    pendingHarnessRequestPath,
    consumeHarnessRefinementRequest,
    writeHarnessRefinementRequest,
    harnessUsagePath,
    pruneHarnessUsageFiles,
    registerHarnessUsage,
    consumeHarnessUsage,
    harnessRunOutcome,
    attributeHarnessUsage,
  };
}

module.exports = { createHarnessBridge };
