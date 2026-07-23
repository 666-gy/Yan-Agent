/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;
  const RECOVERABLE_CAPABILITY_CODES = new Set([
    'CAPABILITY_NOT_FOUND',
    'CAPABILITY_NOT_DISCOVERED',
    'INVALID_CAPABILITY_ARGUMENTS',
    'INVALID_CAPABILITY_TARGET'
  ]);

function isRecoverableCapabilityError(code) {
  return RECOVERABLE_CAPABILITY_CODES.has(String(code || ''));
}

function findLatestRunImageAttachment(runCtx) {
  const messages = runCtx?.sessionRef?.messages || [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    return attachments.find(attachment => (
      attachment?.kind === 'image'
      || /^image\//i.test(String(attachment?.mimeType || ''))
      || /\.(?:png|jpe?g|webp|gif)$/i.test(String(attachment?.name || attachment?.path || ''))
    )) || null;
  }
  return null;
}

function getWindowsMcpPolicyViolation(mcpInfo, args = {}) {
  if (!/windows/i.test(String(mcpInfo?.serverId || ''))) return null;
  const toolName = String(mcpInfo?.toolName || '').toLowerCase();
  if (toolName === 'powershell' || toolName === 'registry') {
    return 'Yan Computer Use 禁止通过桌面 MCP 执行 PowerShell 或修改注册表。请使用 Yan Agent 受权限控制的内置工具完成合法的文件或命令任务。';
  }
  if (toolName === 'shortcut') {
    const keys = String(args.shortcut || '').split('+').map(key => key.trim().toLowerCase());
    if (keys.some(key => ['win', 'windows', 'meta', 'super', 'cmd', 'command', 'os'].includes(key))) {
      return 'Yan Computer Use 禁止使用 Windows、Meta、Super 或 Cmd 系统快捷键。';
    }
  }
  return null;
}

function normalizeTodoPlan(args = {}) {
  const outcome = String(args.outcome || '').trim();
  const rawTodos = Array.isArray(args.todos) ? args.todos : [];
  const rawCriteria = Array.isArray(args.acceptance_criteria) ? args.acceptance_criteria : [];
  const errors = [];
  const todoTexts = new Set();
  const criterionTexts = new Set();
  let inProgressCount = 0;

  const todos = rawTodos.map((item, index) => {
    const text = String(item?.text || '').trim();
    const status = String(item?.status || 'pending');
    const key = text.toLocaleLowerCase();
    if (!text) errors.push(`todos[${index}].text 不能为空`);
    if (text && todoTexts.has(key)) errors.push(`todo 重复：${text}`);
    if (text) todoTexts.add(key);
    if (!['pending', 'in_progress', 'done'].includes(status)) errors.push(`todos[${index}].status 无效`);
    if (status === 'in_progress') inProgressCount++;
    return { text, done: status === 'done', inProgress: status === 'in_progress' };
  });

  const acceptanceCriteria = rawCriteria.map((item, index) => {
    const text = String(item?.text || '').trim();
    const status = String(item?.status || 'pending');
    const key = text.toLocaleLowerCase();
    if (!text) errors.push(`acceptance_criteria[${index}].text 不能为空`);
    if (text && criterionTexts.has(key)) errors.push(`验收条件重复：${text}`);
    if (text) criterionTexts.add(key);
    if (!['pending', 'in_progress', 'satisfied', 'skipped'].includes(status)) {
      errors.push(`acceptance_criteria[${index}].status 无效`);
    }
    return { text, status, evidence: String(item?.evidence || '').trim() };
  });

  if (!outcome) errors.push('outcome 不能为空');
  if (!acceptanceCriteria.length) errors.push('acceptance_criteria 至少需要一项');
  if (inProgressCount > 1) errors.push('同一时间最多只能有一个 in_progress todo');
  return { ok: errors.length === 0, errors, outcome, todos, acceptanceCriteria };
}

function stashMcpVisionFrame(runCtx, toolName, images) {
  if (!runCtx || !Array.isArray(images) || !images.length) return null;
  const safeImages = images
    .filter(image => /^image\//i.test(String(image?.mimeType || '')) && typeof image?.data === 'string')
    .filter(image => image.data.length <= 8 * 1024 * 1024)
    .slice(0, 2)
    .map(image => ({ mimeType: image.mimeType, data: image.data }));
  if (!safeImages.length) return null;
  if (!(runCtx.mcpVisionFrames instanceof Map)) runCtx.mcpVisionFrames = new Map();
  const frameId = `${runCtx.runId || 'run'}:mcp-frame:${Date.now().toString(36)}:${runCtx.mcpVisionFrames.size}`;
  runCtx.mcpVisionFrames.set(frameId, { toolName, images: safeImages });
  return frameId;
}

async function resolveToolPath(filePath, runCtx) {
  if (K.resolveWorkspacePathSafe) {
    const resolved = await K.resolveWorkspacePathSafe(filePath, runCtx);
    if (!resolved.ok) return resolved;
    return { ok: true, path: resolved.path };
  }
  try {
    return { ok: true, path: await K.resolveWorkspacePath(filePath, runCtx) };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), code: error?.code || 'PATH_ESCAPE' };
  }
}

async function runWorkspace(runCtx) {
  return (await K.getRunWorkspace(runCtx)) || '';
}

function browserControlPolicy(runCtx) {
  if (!runCtx?.startedInForeground) {
    return {
      ok: false,
      error: '后台任务不能操作共享的内置浏览器。请在前台任务中完成网页交互或验收。',
      code: 'BROWSER_FOREGROUND_REQUIRED'
    };
  }
  if (!runCtx?.builtinWebPageOpened) {
    return {
      ok: false,
      error: '请先成功调用 open_builtin_browser 打开真实网页或本地 HTML，再读取或操作页面。',
      code: 'BROWSER_OPEN_REQUIRED'
    };
  }
  return { ok: true };
}

function browserToolResult(name, result, extraMeta = {}) {
  if (!result?.ok) {
    return K.toolError(name, result?.error || '内置浏览器操作失败。', {
      code: result?.code || 'BROWSER_ACTION_FAILED',
      repair_hints: result?.code === 'STALE_REF'
        ? ['页面已变化，先调用 browser_snapshot 获取新的元素引用']
        : undefined,
      ...extraMeta
    });
  }
  return K.toolSuccess(name, result.output || '内置浏览器操作完成。', {
    url: result.url || undefined,
    title: result.title || undefined,
    count: result.count ?? undefined,
    ...extraMeta
  });
}

async function executeTool(name, args, runCtx) {
  const as = runCtx?.agentState || deps().getCurrentAgentState();
  const ui = runCtx?.ui !== false;
  const workModePolicy = K.checkWorkModeToolPolicy?.(name, args, runCtx);
  if (workModePolicy && !workModePolicy.ok) {
    return K.toolError(name, workModePolicy.error, {
      policy: 'plan_mode_read_only',
      code: workModePolicy.code,
      nonFatal: true,
      noRetry: true
    });
  }
  switch (name) {
    case 'search_capabilities': {
      const result = await K.searchCapabilities?.(runCtx, args);
      if (!result?.ok) {
        return K.toolError(name, result?.message || '能力索引不可用。', {
          noRetry: true,
          code: result?.code || 'CAPABILITY_SEARCH_FAILED'
        });
      }
      const payload = {
        results: result.results || [],
        total_hidden_capabilities: result.total_hidden_capabilities || 0,
        status: result.status || 'ready',
        note: result.note || undefined
      };
      return K.toolSuccess(name, JSON.stringify(payload, null, 2), {
        resultCount: payload.results.length,
        totalHiddenCapabilities: payload.total_hidden_capabilities,
        status: payload.status
      });
    }
    case 'use_capability': {
      const capabilityId = String(args.capability_id || '').trim();
      const entry = K.getCapabilityEntry?.(runCtx, capabilityId);
      const permission = K.validateCapabilityUse?.(runCtx, entry) || {
        ok: false,
        message: '能力执行策略不可用。',
        code: 'CAPABILITY_POLICY_UNAVAILABLE'
      };
      if (!permission.ok) {
        const code = permission.code || 'CAPABILITY_DENIED';
        return K.toolError(name, permission.message, {
          capabilityId,
          noRetry: true,
          policy: 'capability_gate',
          code,
          // A stale/undiscovered capability id is a model routing mistake, not a
          // failed user task. The next search_capabilities call can recover it.
          nonFatal: isRecoverableCapabilityError(code)
        });
      }

      const targetInput = args.input && typeof args.input === 'object' && !Array.isArray(args.input)
        ? args.input
        : {};
      const validationErrors = K.validateToolArguments
        ? K.validateToolArguments(targetInput, entry.inputSchema, 'input')
        : [];
      if (validationErrors.length) {
        return K.toolError(name, `能力参数无效：${validationErrors.join('；')}`, {
          capabilityId,
          effectiveToolName: entry.target?.toolName || entry.target?.skillId,
          validationErrors,
          invalidArguments: true,
          noRetry: true,
          code: 'INVALID_CAPABILITY_ARGUMENTS',
          nonFatal: true
        });
      }

      let effectiveToolName = entry.target?.toolName || '';
      let output;
      if (entry.kind === 'skill') {
        effectiveToolName = 'read_skill';
        output = await executeTool('read_skill', {
          id: entry.target.skillId,
          task_context: targetInput.task_context || runCtx?.capabilityPlan?.taskText || ''
        }, runCtx);
      } else {
        if (!effectiveToolName || ['search_capabilities', 'use_capability', 'request_capability'].includes(effectiveToolName)) {
          return K.toolError(name, '能力目标无效，禁止递归调用能力路由器。', {
            capabilityId,
            noRetry: true,
            code: 'INVALID_CAPABILITY_TARGET',
            nonFatal: true
          });
        }
        output = await executeTool(effectiveToolName, targetInput, runCtx);
      }
      return K.mergeToolResultMeta(output, {
        capabilityId,
        capabilityKind: entry.kind,
        capabilityCategory: entry.category,
        effectiveToolName
      });
    }
    case 'request_capability': {
      const result = await K.grantCapability?.(runCtx, args);
      if (!result) {
        return K.toolError(name, '任务能力路由不可用，请继续使用当前已提供的工具。', {
          nonFatal: true,
          noRetry: true
        });
      }
      if (!result.ok) {
        return K.toolError(name, result.message || '能力申请未获批准。', {
          nonFatal: result.nonFatal !== false,
          noRetry: true,
          ...(result.meta || {})
        });
      }
      return K.toolSuccess(name, result.message || '能力已启用。', result.meta || {});
    }
    case 'request_workspace': {
      if (runCtx?.workspaceRequestDenied) {
        return K.toolError(name, '用户已经拒绝了本轮工作区申请，请不要重复申请。改为在对话中交付，或明确说明文件交付受到阻塞。', {
          code: 'WORKSPACE_PERMISSION_ALREADY_DENIED',
          denied: true,
          nonFatal: true,
          noRetry: true
        });
      }
      const existing = await runWorkspace(runCtx);
      if (existing) {
        return K.toolSuccess(name, `当前任务已经拥有工作区：${existing}`, {
          workspace: existing,
          alreadyAssigned: true
        });
      }
      const location = String(args.suggested_location || 'choose');
      const labels = { desktop: '桌面', documents: '文档', downloads: '下载目录', choose: '用户选择的文件夹' };
      let suggestedPath = '';
      if (location !== 'choose' && api().getKnownWorkspacePath) {
        const known = await api().getKnownWorkspacePath(location);
        if (known?.error) {
          return K.toolError(name, known.error, { code: known.code || 'WORKSPACE_TARGET_UNAVAILABLE', noRetry: true });
        }
        suggestedPath = String(known?.workspace || '');
      }
      const decision = await deps().hooks?.requestWorkspacePermission?.({
        reason: String(args.reason || ''),
        suggestedLocation: location,
        suggestedLabel: labels[location] || location,
        suggestedPath,
        artifactType: String(args.artifact_type || 'files'),
        sessionId: runCtx?.sessionId
      }, runCtx);
      if (!decision?.approved || !decision?.workspace) {
        if (runCtx) runCtx.workspaceRequestDenied = true;
        return K.toolError(name, '用户未批准工作区申请。请尊重决定，不要再次申请；改为在对话中交付可行结果，或说明文件交付受到阻塞。', {
          code: 'WORKSPACE_PERMISSION_DENIED',
          denied: true,
          nonFatal: true,
          noRetry: true
        });
      }
      const assigned = await K.assignRunWorkspace?.(runCtx, decision.workspace, 'user-approved');
      if (!assigned?.ok) {
        return K.toolError(name, assigned?.error || '工作区绑定失败', {
          code: 'WORKSPACE_ASSIGN_FAILED',
          noRetry: true
        });
      }
      if (runCtx?.capabilityPlan) {
        const plan = runCtx.capabilityPlan;
        plan.workspace = true;
        plan.workspaceAvailable = true;
        plan.workspacePath = assigned.workspace;
        plan.readOnly = false;
        plan.allowMutation = true;
        plan.operational = true;
        if (args.artifact_type === 'web') plan.webPreview = true;
      }
      runCtx.workspaceRequestDenied = false;
      return K.toolSuccess(name, `用户已批准工作区：${assigned.workspace}。后续相对路径均以此目录为根。`, {
        workspace: assigned.workspace,
        approved: true,
        artifactType: args.artifact_type
      });
    }
    case 'change_workspace': {
      const current = await runWorkspace(runCtx);
      if (!current) {
        return K.toolError(name, '当前任务还没有工作区。用户明确要求进入桌面、文档或下载目录时先由内核自动绑定；否则先调用 request_workspace。', {
          code: 'WORKSPACE_REQUIRED',
          noRetry: true,
          nonFatal: true
        });
      }
      const rawPath = String(args.path || '').trim();
      if (!rawPath || (runCtx?.accessMode !== 'full' && /(^|[\\/])\.\.([\\/]|$)/.test(rawPath))) {
        return K.toolError(name, '只能进入当前工作区内的目录，不能使用 .. 跳出工作区。', {
          code: 'WORKSPACE_PATH_ESCAPE',
          noRetry: true
        });
      }
      const inspected = await api().inspectWorkspace?.(rawPath, current);
      if (!inspected?.ok) {
        return K.toolError(name, inspected?.error || '无法检查目标目录。', {
          code: inspected?.code || 'WORKSPACE_INSPECT_FAILED',
          noRetry: true
        });
      }
      if (!inspected.exists || !inspected.isDirectory) {
        return K.toolError(name, `目录不存在：${rawPath}。请先创建该目录，再重新调用 change_workspace。`, {
          code: 'WORKSPACE_DIRECTORY_NOT_FOUND',
          nonFatal: true,
          repair_hints: ['先使用 execute_shell 创建目录', '创建成功后重新调用 change_workspace']
        });
      }
      const assigned = await K.assignRunWorkspace?.(runCtx, inspected.path, 'user-requested-subdirectory');
      if (!assigned?.ok) {
        return K.toolError(name, assigned?.error || '工作区切换失败。', {
          code: 'WORKSPACE_ASSIGN_FAILED',
          noRetry: true
        });
      }
      if (runCtx?.capabilityPlan) {
        runCtx.capabilityPlan.workspace = true;
        runCtx.capabilityPlan.workspaceAvailable = true;
        runCtx.capabilityPlan.workspacePath = assigned.workspace;
        runCtx.capabilityPlan.readOnly = false;
        runCtx.capabilityPlan.allowMutation = true;
        runCtx.capabilityPlan.operational = true;
      }
      return K.toolSuccess(name, `当前任务工作区已切换到：${assigned.workspace}`, {
        workspace: assigned.workspace,
        parentWorkspace: current,
        changed: true
      });
    }
    case 'todo_write': {
      const plan = normalizeTodoPlan(args);
      if (!plan.ok) {
        return K.toolError(name, `待办计划无效：${plan.errors.join('；')}。请修正后重新提交完整计划。`, {
          validationErrors: plan.errors
        });
      }
      as.todos = plan.todos;
      as.todosFromTool = true;
      as.outcome = plan.outcome;
      as.acceptanceCriteria = plan.acceptanceCriteria;
      as.outcomeFromTool = !!(as.outcome && as.acceptanceCriteria.length);
      if (ui) {
        deps().hooks.renderTodos(as);
        deps().hooks.updateContextInfo(as);
      }
      const doneCount = as.todos.filter(t => t.done).length;
      const satisfiedCount = as.acceptanceCriteria.filter(c => ['satisfied', 'skipped'].includes(c.status) && c.evidence).length;
      if (deps().hooks.clearDeferredTodosIfDone) {
        await deps().hooks.clearDeferredTodosIfDone(runCtx, as);
      }
      return K.toolSuccess(name, `Outcome updated: ${satisfiedCount}/${as.acceptanceCriteria.length} criteria satisfied; ${doneCount}/${as.todos.length} steps done.`, {
        outcome: as.outcome,
        satisfiedCount,
        criteriaCount: as.acceptanceCriteria.length,
        doneCount,
        total: as.todos.length
      });
    }
    case 'edit_file':
    case 'apply_patch': {
      return K.editTextFile(name, args, runCtx);
    }
    case 'read_file': {
      const resolved = await resolveToolPath(args.path, runCtx);
      if (!resolved.ok) return K.toolError(name, resolved.error, { path: args.path, code: resolved.code, noRetry: true });
      const path = resolved.path;
      const ws = await runWorkspace(runCtx);
      const res = await api().readFile(path, ws);
      if (res.error) return K.toolError(name, res.error, { path, code: res.code });
      if (runCtx && K.recordFileRead) K.recordFileRead(runCtx, path);
      if (res.isBinary) {
        return K.toolSuccess(name, `(binary file, ${res.size} bytes)`, { path, isBinary: true, size: res.size, mtime: res.mtime });
      }
      // Duplicate-read dedup: if this exact file version was already returned in
      // full during the current compression epoch, its content is still in the
      // model's context — return a short notice instead of another 12k chars.
      // A new epoch (after live compression) always re-sends full content.
      if (runCtx) {
        const epoch = runCtx.contextEpoch || 0;
        const cache = runCtx.fullReadCache || (runCtx.fullReadCache = new Map());
        const prev = cache.get(path);
        if (prev && prev.epoch === epoch && prev.mtime === res.mtime && prev.size === res.size) {
          return K.toolSuccess(name,
            `(unchanged since your last read in this run — content already in context above, ${res.size} bytes. Re-read a specific part with read_file_range if needed.)`,
            { path, size: res.size, mtime: res.mtime, deduped: true });
        }
        cache.set(path, { epoch, mtime: res.mtime, size: res.size });
      }
      return K.toolSuccess(name, K.clipFileContent(res.content, path), { path, size: res.size, mtime: res.mtime });
    }
    case 'write_file': {
      const resolved = await resolveToolPath(args.path, runCtx);
      if (!resolved.ok) return K.toolError(name, resolved.error, { path: args.path, code: resolved.code, noRetry: true });
      const path = resolved.path;
      const ws = await runWorkspace(runCtx);
      const existing = await api().readFile(path, ws);
      if (!existing.error && runCtx && K.requireReadBeforeEdit) {
        const policy = K.requireReadBeforeEdit(runCtx, path);
        if (!policy.ok) return K.toolError(name, policy.error, { path, policy: 'read_before_edit', code: policy.code || 'POLICY_READ_BEFORE_EDIT', noRetry: true });
      }
      if (runCtx && K.checkWebAutomationWritePolicy) {
        const browserPolicy = K.checkWebAutomationWritePolicy(
          path,
          existing.error || existing.isBinary ? '' : existing.content,
          args.content,
          runCtx
        );
        if (!browserPolicy.ok) {
          return K.toolError(name, browserPolicy.error, {
            path,
            policy: 'builtin_web_preview_only',
            code: browserPolicy.code,
            nonFatal: true,
            noRetry: true
          });
        }
      }
      let recordedChange = false;
      if (runCtx?.sessionId && runCtx?.runId && api().yanagentRecordChange) {
        try {
          const before = existing.error ? null : (existing.isBinary ? null : existing.content);
          const rec = await api().yanagentRecordChange({
            sessionId: runCtx.sessionId,
            runId: runCtx.runId,
            filePath: path,
            before,
            op: 'write_file'
          });
          recordedChange = !!(rec?.ok && !rec.deduped);
        } catch {}
      }
      const res = await api().writeFile(path, args.content, ws);
      if (res.error) return K.toolError(name, res.error, { path, code: res.code });
      if (recordedChange) runCtx.fileChangeCount = (runCtx.fileChangeCount || 0) + 1;
      if (runCtx && K.recordFileRead) K.recordFileRead(runCtx, path);
      const verification = await K.verifyTextFile(path, String(args.content ?? ''), ws);
      const output = verification.ok
        ? `Wrote ${path} (${res.size} bytes). Read-back verified.`
        : `Wrote ${path} but read-back verification failed.`;
      return K.toolResult(verification.ok, name, {
        output,
        error: verification.ok ? null : verification.error,
        meta: { path, size: res.size, verification, code: verification.ok ? 'OK' : (verification.code || 'EDIT_VERIFY_MISMATCH') }
      });
    }
    case 'list_directory': {
      const ws = await runWorkspace(runCtx);
      let dir = ws;
      if (args.path) {
        const resolved = await resolveToolPath(args.path, runCtx);
        if (!resolved.ok) return K.toolError(name, resolved.error, { path: args.path, code: resolved.code, noRetry: true });
        dir = resolved.path;
      }
      const entries = await api().listWorkspace({ dirPath: dir, workspace: ws });
      if (entries?.error) return K.toolError(name, entries.error, { path: dir, code: entries.code });
      const list = Array.isArray(entries) ? entries : [];
      const listing = list.map(e =>
        `${e.isDirectory ? '[DIR]  ' : '       '}${e.name}`
      ).join('\n');
      return K.toolSuccess(name, listing || '(empty directory)', { path: dir, count: list.length });
    }
    case 'execute_shell': {
      if (runCtx && K.checkWebVerificationShellPolicy) {
        const browserPolicy = K.checkWebVerificationShellPolicy(args.command, runCtx);
        if (!browserPolicy.ok) {
          return K.toolError(name, browserPolicy.error, {
            command: args.command,
            policy: 'builtin_web_preview_only',
            code: browserPolicy.code,
            nonFatal: true,
            noRetry: true
          });
        }
      }
      let perm = await api().getPermissions();
      const autoApproved = runCtx?.accessMode === 'delegate' || runCtx?.accessMode === 'full';
      const needsPrompt = !autoApproved && !perm.allowShell && !runCtx?.shellAllowedOnce;
      if (needsPrompt && deps().hooks.requestShellPermission) {
        const decision = await deps().hooks.requestShellPermission({
          command: String(args.command || ''),
          sessionId: runCtx?.sessionId
        });
        if (decision === 'always') {
          perm = await api().setPermissions({ allowShell: true });
        } else if (decision === 'once') {
          runCtx.shellAllowedOnce = true;
        } else {
          return K.toolError(name,
            '用户拒绝了 Shell/PowerShell 执行权限。请改用 read_file、read_file_range、edit_file、apply_patch、write_file、search_files、get_file_outline、find_symbol、find_references、search_symbols、list_directory 等工具完成任务，不要再次调用 execute_shell。',
            { denied: true, noRetry: true, code: 'PERMISSION_DENIED', command: args.command }
          );
        }
      } else if (needsPrompt) {
        return K.toolError(name, 'Shell execution is disabled in permissions.', { denied: true, noRetry: true, code: 'PERMISSION_DENIED' });
      }
      const oneShot = !!((runCtx?.shellAllowedOnce || autoApproved) && !perm.allowShell);
      const ws = await runWorkspace(runCtx);
      const res = await api().executeShell(args.command, ws || undefined, oneShot, ws || undefined);
      // Pass the command text through so execToolResult can recognize search/diff tools
      // whose exit code 1 means "no match", not failure.
      return K.execToolResult(name, { ...res, command: args.command }, '(no output)');
    }
    case 'search_files': {
      const ws = await runWorkspace(runCtx);
      let directory = ws;
      if (args.path) {
        const resolved = await resolveToolPath(args.path, runCtx);
        if (!resolved.ok) return K.toolError(name, resolved.error, { path: args.path, code: resolved.code, noRetry: true });
        directory = resolved.path;
      }
      const results = await api().searchFiles({
        query: args.query,
        directory,
        workspace: ws,
        extensions: args.extensions,
        regex: !!args.regex,
        caseSensitive: !!args.case_sensitive,
        contextLines: args.context_lines
      });
      if (results?.error) return K.toolError(name, results.error, { directory, code: results.code });
      const list = Array.isArray(results) ? results : [];
      const output = K.formatSearchResults(list);
      return K.toolSuccess(name, output, { query: args.query, count: list.length, directory });
    }
    case 'get_file_outline': {
      const resolved = await resolveToolPath(args.path, runCtx);
      if (!resolved.ok) return K.toolError(name, resolved.error, { path: args.path, code: resolved.code, noRetry: true });
      const path = resolved.path;
      const ws = await runWorkspace(runCtx);
      const res = await api().readFile(path, ws);
      if (res.error) return K.toolError(name, res.error, { path, code: res.code });
      if (res.isBinary) return K.toolError(name, 'Cannot outline binary file.', { path, isBinary: true, code: 'EDIT_BINARY' });
      if (runCtx && K.recordFileRead) K.recordFileRead(runCtx, path);
      const outline = K.outlineFile(res.content, path);
      const output = K.formatOutline(path, outline);
      return K.toolSuccess(name, output, { path, ...outline });
    }
    case 'find_symbol': {
      const workspace = await runWorkspace(runCtx);
      const { hits, error } = await K.findSymbolDefinitions(args.name, { kind: args.kind, workspace });
      if (error) return K.toolError(name, error);
      const output = K.formatSymbolHits(args.name, hits);
      return K.toolSuccess(name, output, { name: args.name, count: hits.length, hits });
    }
    case 'read_file_range': {
      const resolved = await resolveToolPath(args.path, runCtx);
      if (!resolved.ok) return K.toolError(name, resolved.error, { path: args.path, code: resolved.code, noRetry: true });
      const path = resolved.path;
      const ws = await runWorkspace(runCtx);
      const res = await api().readFileRange(path, args.start_line, args.end_line, ws);
      if (res.error) return K.toolError(name, res.error, { path, code: res.code });
      if (runCtx && K.recordFileRead) K.recordFileRead(runCtx, path);
      const header = `## ${path} (lines ${res.start}-${res.end} of ${res.lineCount})`;
      return K.toolSuccess(name, `${header}\n${res.content}`, { path, ...res });
    }
    case 'get_file_imports': {
      const resolved = await resolveToolPath(args.path, runCtx);
      if (!resolved.ok) return K.toolError(name, resolved.error, { path: args.path, code: resolved.code, noRetry: true });
      const path = resolved.path;
      const data = await api().codeFileImports(path);
      if (data.error) return K.toolError(name, data.error, { path, code: data.code });
      if (runCtx && K.recordFileRead) K.recordFileRead(runCtx, path);
      return K.toolSuccess(name, K.formatImports(path, data), { path, ...data });
    }
    case 'find_references': {
      const workspace = await runWorkspace(runCtx);
      const res = await api().codeFindReferences({ name: args.name, max_results: args.max_results, workspace });
      if (res.error) return K.toolError(name, res.error);
      const output = K.formatReferenceHits(args.name, res.hits || []);
      return K.toolSuccess(name, output, { name: args.name, count: res.count || 0, hits: res.hits });
    }
    case 'find_related_files': {
      const workspace = await runWorkspace(runCtx);
      const resolved = await resolveToolPath(args.path, runCtx);
      if (!resolved.ok) return K.toolError(name, resolved.error, { path: args.path, code: resolved.code, noRetry: true });
      const path = resolved.path;
      const data = await api().codeFindRelated({ path, workspace });
      if (data.error) return K.toolError(name, data.error, { path, code: data.code });
      return K.toolSuccess(name, K.formatRelated(data), { path, ...data });
    }
    case 'search_symbols': {
      const workspace = await runWorkspace(runCtx);
      const res = await api().codeSearchSymbols({
        query: args.query,
        kind: args.kind,
        limit: args.limit,
        workspace
      });
      const hits = res.hits || [];
      const output = K.formatSymbolSearch(hits, args.query);
      return K.toolSuccess(name, output, {
        query: args.query,
        count: hits.length,
        indexAge: res.indexAge,
        fileCount: res.fileCount,
        symbolCount: res.symbolCount
      });
    }
    case 'build_code_index': {
      const workspace = await runWorkspace(runCtx);
      const res = await api().buildCodeIndex({ force: !!args.force, workspace });
      if (res.error) return K.toolError(name, res.error);
      const msg = res.cached
        ? `Code index ready (cached). ${res.fileCount} files, ${res.symbolCount} symbols.`
        : `Code index built. ${res.fileCount} files, ${res.symbolCount} symbols saved to .yanagent/code-index.json`;
      return K.toolSuccess(name, msg, res);
    }
    case 'scan_project': {
      const workspace = await runWorkspace(runCtx);
      const res = await api().codeScanProject(workspace);
      if (res.error) return K.toolError(name, res.error);
      return K.toolSuccess(name, res.summary, { meta: res.meta });
    }
    case 'trace_symbol': {
      const workspace = await runWorkspace(runCtx);
      const res = await api().codeTraceSymbol({ name: args.name, workspace });
      if (res.error) return K.toolError(name, res.error);
      const output = K.formatTrace(res);
      return K.toolSuccess(name, output, res);
    }
    case 'git_status': {
      const workspace = await runWorkspace(runCtx);
      const res = await api().gitStatus(workspace || undefined);
      return K.execToolResult(name, res, '(no output)');
    }
    case 'git_diff': {
      const workspace = await runWorkspace(runCtx);
      const res = workspace
        ? await api().gitDiff(workspace, !!args.staged)
        : await api().gitDiff(!!args.staged);
      return K.execToolResult(name, res, '(no changes)');
    }
    case 'git_log': {
      const workspace = await runWorkspace(runCtx);
      const res = workspace
        ? await api().gitLog(workspace, args.limit || 20)
        : await api().gitLog(args.limit || 20);
      return K.execToolResult(name, res, '(no commits)');
    }
    case 'git_commit': {
      const workspace = await runWorkspace(runCtx);
      const res = await api().gitCommit(args.message, workspace || undefined);
      return K.execToolResult(name, res, 'Committed.');
    }
    case 'git_push': {
      const workspace = await runWorkspace(runCtx);
      const res = workspace
        ? await api().gitPush(workspace, args.remote, args.branch)
        : await api().gitPush(args.remote, args.branch);
      return K.execToolResult(name, res, 'Pushed.');
    }
    case 'git_pull': {
      const workspace = await runWorkspace(runCtx);
      const res = workspace
        ? await api().gitPull(workspace, args.remote, args.branch)
        : await api().gitPull(args.remote, args.branch);
      return K.execToolResult(name, res, 'Pulled.');
    }
    case 'git_clone': {
      const workspace = await runWorkspace(runCtx);
      const res = await api().gitClone(args.url, workspace || undefined);
      return K.execToolResult(name, res, 'Cloned.');
    }
    case 'git_branch': {
      const workspace = await runWorkspace(runCtx);
      const res = await api().gitBranch(workspace || undefined);
      return K.execToolResult(name, res, '(no branches)');
    }
    case 'list_ui_kit': {
      const kit = String(args.kit || '').trim();
      if (!kit) return K.toolError(name, 'kit is required (react-bits | uiverse)');
      const res = await api().listUiKit?.(kit, args.query);
      if (res?.error) return K.toolError(name, res.error);
      const lines = (res.items || []).map(it =>
        `- ${it.id || it.name}: ${it.desc || it.title || ''} [${it.category || ''}]`
      );
      return K.toolSuccess(name, lines.length ? lines.join('\n') : 'No matches.', res);
    }
    case 'read_ui_kit': {
      const kit = String(args.kit || '').trim();
      const component = String(args.component || '').trim();
      if (!kit || !component) return K.toolError(name, 'kit and component are required');
      const res = await api().readUiKit?.(kit, component, args.variant);
      if (res?.error) {
        const sug = (res.suggestions || []).join(', ');
        return K.toolError(name, res.error + (sug ? ` Try: ${sug}` : ''));
      }
      return K.toolSuccess(name, res.content, {
        kit: res.kit,
        component: res.component,
        variant: res.variant,
        dependencies: res.dependencies
      });
    }
    case 'list_skills': {
      const catalog = await api().getSkillCatalog?.();
      if (!catalog) return K.toolError(name, 'Skill catalog unavailable');
      const q = String(args.query || '').trim().toLowerCase();
      const tag = String(args.tag || '').trim();
      let items = (catalog.installed || []).map(s => ({ ...s, installed: true }));
      if (tag) items = items.filter(s => (s.tags || []).includes(tag));
      if (q) {
        items = items.filter(s => {
          const hay = `${s.id} ${s.name} ${s.desc} ${(s.triggers || []).join(' ')}`.toLowerCase();
          return hay.includes(q);
        });
      }
      items = items.slice(0, 40);
      const lines = items.map(s => `- ${s.id} [installed] ${s.name}: ${s.desc}`);
      return K.toolSuccess(name, lines.length ? lines.join('\n') : 'No skills matched.', {
        count: lines.length,
        query: q || null,
        tag: tag || null
      });
    }
    case 'read_skill': {
      const skillId = String(args.id || '').trim();
      if (!skillId) return K.toolError(name, 'id is required');
      const res = await api().readSkill(skillId, args.task_context);
      if (res.error) {
        const sug = (res.suggestions || []).map(s => `${s.id}: ${s.name}`).join('; ');
        return K.toolError(name, res.error + (sug ? ` Suggestions: ${sug}` : ''));
      }
      const header = `# Skill: ${res.name} (${res.id})`;
      return K.toolSuccess(name, `${header}\n\n${res.prompt}`, {
        id: res.id,
        name: res.name,
        fuzzy: !!res.fuzzy
      });
    }
    case 'spawn_subagent': {
      if (runCtx?.isSubagent) {
        return K.toolError(name, 'Nested subagents are not allowed.', { noRetry: true });
      }
      return K.runSubagent(args.type, args.task, args.context, runCtx, { skills: args.skills });
    }
    case 'spawn_subagents': {
      if (runCtx?.isSubagent) {
        return K.toolError(name, 'Nested subagents are not allowed.', { noRetry: true });
      }
      return K.runSubagentsParallel(args.agents, runCtx);
    }
    case 'generate_image': {
      const requestId = runCtx?.runId || `image_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const sourceImage = args.use_input_image === false ? null : findLatestRunImageAttachment(runCtx);
      const result = await api().generateImage({
        requestId,
        prompt: args.prompt,
        aspectRatio: args.aspect_ratio || (sourceImage ? 'auto' : '1:1'),
        sourceImagePath: sourceImage?.path || ''
      });
      if (result?.error || !result?.assetId) return K.toolError(name, result?.error || '图片接口没有返回会话预览资产', {
        noRetry: true,
        code: result.code,
        interrupted: result.code === 'IMAGE_GENERATION_CANCELLED'
      });
      return K.toolSuccess(name, result.edited ? '图片已编辑，可点击预览图下载。' : '图片已生成，可点击预览图下载。', {
        generatedImageId: result.assetId,
        name: result.name,
        mimeType: result.mimeType,
        size: result.size,
        model: result.model,
        edited: !!result.edited,
        revisedPrompt: result.revisedPrompt || ''
      });
    }
    case 'open_builtin_browser': {
      const isBg = !runCtx?.ui;
      const res = await deps().hooks.agentOpenBuiltinBrowser(args.url, { background: isBg, runCtx });
      if (!res.ok) {
        return K.toolError(name,
          `${res.error}。请修复路径或页面后重新调用 open_builtin_browser，不要改用外部 Edge 或 Playwright 兜底。`,
          { url: args.url, noRetry: true, policy: 'builtin_browser_required' });
      }
      if (runCtx) {
        runCtx.builtinBrowserOpened = true;
        runCtx.builtinBrowserUrl = res.url;
        if (K.isWebPagePreviewUrl?.(res.url || args.url)) {
          runCtx.builtinWebPageOpened = true;
          runCtx.builtinWebPageUrl = res.url;
        }
      }
      const msg = isBg
        ? `已在后台记录预览地址：${res.url}（不打扰当前界面）`
        : `已在内置浏览器打开：${res.url}`;
      return K.toolSuccess(name, msg, { url: res.url, background: isBg });
    }
    case 'browser_snapshot': {
      const policy = browserControlPolicy(runCtx);
      if (!policy.ok) return K.toolError(name, policy.error, { code: policy.code, noRetry: true, nonFatal: true });
      return browserToolResult(name, await deps().hooks.agentBrowserSnapshot?.());
    }
    case 'browser_read_page': {
      const policy = browserControlPolicy(runCtx);
      if (!policy.ok) return K.toolError(name, policy.error, { code: policy.code, noRetry: true, nonFatal: true });
      return browserToolResult(name, await deps().hooks.agentBrowserReadPage?.());
    }
    case 'browser_click': {
      const policy = browserControlPolicy(runCtx);
      if (!policy.ok) return K.toolError(name, policy.error, { code: policy.code, noRetry: true, nonFatal: true });
      return browserToolResult(name, await deps().hooks.agentBrowserClick?.(args.ref));
    }
    case 'browser_type': {
      const policy = browserControlPolicy(runCtx);
      if (!policy.ok) return K.toolError(name, policy.error, { code: policy.code, noRetry: true, nonFatal: true });
      return browserToolResult(name, await deps().hooks.agentBrowserType?.(args.ref, args.text));
    }
    case 'browser_press': {
      const policy = browserControlPolicy(runCtx);
      if (!policy.ok) return K.toolError(name, policy.error, { code: policy.code, noRetry: true, nonFatal: true });
      return browserToolResult(name, await deps().hooks.agentBrowserPress?.(args.key));
    }
    case 'browser_scroll': {
      const policy = browserControlPolicy(runCtx);
      if (!policy.ok) return K.toolError(name, policy.error, { code: policy.code, noRetry: true, nonFatal: true });
      return browserToolResult(name, await deps().hooks.agentBrowserScroll?.(args.direction, args.amount));
    }
    case 'browser_wait': {
      const policy = browserControlPolicy(runCtx);
      if (!policy.ok) return K.toolError(name, policy.error, { code: policy.code, noRetry: true, nonFatal: true });
      return browserToolResult(name, await deps().hooks.agentBrowserWait?.(args.ms, args.text));
    }
    case 'browser_screenshot': {
      const policy = browserControlPolicy(runCtx);
      if (!policy.ok) return K.toolError(name, policy.error, { code: policy.code, noRetry: true, nonFatal: true });
      const result = await deps().hooks.agentBrowserScreenshot?.();
      if (!result?.ok) return browserToolResult(name, result);
      const mcpVisionFrameId = stashMcpVisionFrame(runCtx, name, [result.image]);
      return browserToolResult(name, result, {
        mcpVisionFrameId: mcpVisionFrameId || undefined,
        imageCount: mcpVisionFrameId ? 1 : undefined
      });
    }
    default: {
      const mcpInfo = (runCtx?.mcpToolMapSnapshot || K.getMcpToolMap()).get(name);
      if (mcpInfo) {
        const windowsPolicyViolation = getWindowsMcpPolicyViolation(mcpInfo, args);
        if (windowsPolicyViolation) {
          return K.toolError(name, windowsPolicyViolation, {
            noRetry: true,
            policy: 'yan_computer_use_safety',
            serverId: mcpInfo.serverId,
            toolName: mcpInfo.toolName
          });
        }
        const isPlaywright = /playwright/i.test(`${mcpInfo.serverId} ${mcpInfo.toolName}`);
        if (isPlaywright && !runCtx?.startedInForeground) {
          return K.toolError(name,
            '后台任务禁止启动 Playwright 或外部浏览器。请使用 open_builtin_browser 记录预览地址，或把交互验证留给前台任务。',
            { noRetry: true, nonFatal: true, policy: 'no_background_playwright', requiredTool: 'open_builtin_browser' });
        }
        if (isPlaywright && !runCtx?.builtinWebPageOpened) {
          return K.toolError(name,
            '必须先成功调用 open_builtin_browser 完成内置预览，不能直接启动 Edge/Playwright。',
            { noRetry: true, nonFatal: true, policy: 'builtin_browser_first', requiredTool: 'open_builtin_browser' });
        }
        const isWindowsComputerUse = /windows/i.test(String(mcpInfo.serverId || ''));
        if (isWindowsComputerUse) {
          deps().hooks.setComputerUseVisualState?.(true, { name, args, mcpInfo, runCtx });
        }
        const res = await api().mcpCallTool(mcpInfo.serverId, mcpInfo.toolName, args);
        if (res.error) return K.toolError(name, res.error, {
          serverId: mcpInfo.serverId,
          toolName: mcpInfo.toolName,
          code: res.code,
          stderr: res.stderr ? K.clipToolText(res.stderr, 1200) : undefined
        });
        const output = K.clipToolText(res.result || '(无输出)');
        const mcpVisionFrameId = stashMcpVisionFrame(runCtx, name, res.images);
        return K.toolResult(!res.isError, name, {
          output,
          error: res.isError ? (output || 'MCP 工具报告执行失败') : null,
          meta: {
            serverId: mcpInfo.serverId,
            toolName: mcpInfo.toolName,
            isError: !!res.isError,
            mcpVisionFrameId: mcpVisionFrameId || undefined,
            imageCount: mcpVisionFrameId ? res.images.length : undefined
          }
        });
      }
      return K.toolError(name, `Unknown tool: ${name}`);
    }
  }
}

  K.executeTool = executeTool;
  K.normalizeTodoPlan = normalizeTodoPlan;
  K.isRecoverableCapabilityError = isRecoverableCapabilityError;
  K.stashMcpVisionFrame = stashMcpVisionFrame;
  K.browserControlPolicy = browserControlPolicy;
  K.findLatestRunImageAttachment = findLatestRunImageAttachment;
})(window.YanKernel);
