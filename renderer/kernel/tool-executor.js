/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;

async function executeTool(name, args, runCtx) {
  const as = runCtx?.agentState || deps().getCurrentAgentState();
  const ui = runCtx?.ui !== false;
  switch (name) {
    case 'todo_write': {
      const todos = Array.isArray(args.todos) ? args.todos : [];
      as.todos = todos.map(t => ({
        text: String(t.text || ''),
        done: t.status === 'done',
        inProgress: t.status === 'in_progress'
      }));
      as.todosFromTool = true;
      if (ui) {
        deps().hooks.renderTodos(as);
        deps().hooks.updateContextInfo(as);
      }
      const doneCount = as.todos.filter(t => t.done).length;
      if (deps().hooks.clearDeferredTodosIfDone) {
        await deps().hooks.clearDeferredTodosIfDone(as);
      }
      return K.toolSuccess(name, `Todo list updated: ${doneCount}/${as.todos.length} done.`, {
        doneCount,
        total: as.todos.length
      });
    }
    case 'edit_file':
    case 'apply_patch': {
      return K.editTextFile(name, args, runCtx);
    }
    case 'read_file': {
      const path = await K.resolveWorkspacePath(args.path);
      const res = await api().readFile(path);
      if (res.error) return K.toolError(name, res.error, { path });
      if (runCtx && K.recordFileRead) K.recordFileRead(runCtx, path);
      if (res.isBinary) {
        return K.toolSuccess(name, `(binary file, ${res.size} bytes)`, { path, isBinary: true, size: res.size, mtime: res.mtime });
      }
      return K.toolSuccess(name, K.clipToolText(res.content), { path, size: res.size, mtime: res.mtime });
    }
    case 'write_file': {
      const path = await K.resolveWorkspacePath(args.path);
      const existing = await api().readFile(path);
      if (!existing.error && runCtx && K.requireReadBeforeEdit) {
        const policy = K.requireReadBeforeEdit(runCtx, path);
        if (!policy.ok) return K.toolError(name, policy.error, { path, policy: 'read_before_edit' });
      }
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
          if (rec?.ok && !rec.deduped) runCtx.fileChangeCount = (runCtx.fileChangeCount || 0) + 1;
        } catch {}
      }
      const res = await api().writeFile(path, args.content);
      if (res.error) return K.toolError(name, res.error, { path });
      if (runCtx && K.recordFileRead) K.recordFileRead(runCtx, path);
      const verification = await K.verifyTextFile(path, String(args.content ?? ''));
      const output = verification.ok
        ? `Wrote ${path} (${res.size} bytes). Read-back verified.`
        : `Wrote ${path} but read-back verification failed.`;
      return K.toolResult(verification.ok, name, {
        output,
        error: verification.ok ? null : verification.error,
        meta: { path, size: res.size, verification }
      });
    }
    case 'list_directory': {
      const ws = await api().getWorkspace();
      const dir = args.path ? await K.resolveWorkspacePath(args.path) : ws;
      const entries = await api().listWorkspace(dir);
      const listing = entries.map(e =>
        `${e.isDirectory ? '[DIR]  ' : '       '}${e.name}`
      ).join('\n');
      return K.toolSuccess(name, listing || '(empty directory)', { path: dir, count: entries.length });
    }
    case 'execute_shell': {
      let perm = await api().getPermissions();
      const needsPrompt = !perm.allowShell && !runCtx?.shellAllowedOnce;
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
            '用户拒绝了 Shell/PowerShell 执行权限。请改用 read_file、edit_file、apply_patch、write_file、search_files、list_directory 等工具完成任务，不要再次调用 execute_shell。',
            { denied: true, noRetry: true, command: args.command }
          );
        }
      } else if (needsPrompt) {
        return K.toolError(name, 'Shell execution is disabled in permissions.', { denied: true, noRetry: true });
      }
      const oneShot = !!(runCtx?.shellAllowedOnce && !perm.allowShell);
      const res = await api().executeShell(args.command, undefined, oneShot);
      return K.execToolResult(name, res, '(no output)');
    }
    case 'search_files': {
      const results = await api().searchFiles(args.query);
      const output = results.length
        ? results.map(r => `${r.path}:${r.line}: ${r.content}`).join('\n')
        : 'No matches found.';
      return K.toolSuccess(name, output, { query: args.query, count: results.length });
    }
    case 'git_status': {
      const res = await api().gitStatus();
      return K.execToolResult(name, res, '(no output)');
    }
    case 'git_diff': {
      const res = await api().gitDiff(args.staged || false);
      return K.execToolResult(name, res, '(no changes)');
    }
    case 'git_log': {
      const res = await api().gitLog(args.limit || 20);
      return K.execToolResult(name, res, '(no commits)');
    }
    case 'git_commit': {
      const res = await api().gitCommit(args.message);
      return K.execToolResult(name, res, 'Committed.');
    }
    case 'git_push': {
      const res = await api().gitPush(args.remote, args.branch);
      return K.execToolResult(name, res, 'Pushed.');
    }
    case 'git_pull': {
      const res = await api().gitPull(args.remote, args.branch);
      return K.execToolResult(name, res, 'Pulled.');
    }
    case 'git_clone': {
      const res = await api().gitClone(args.url);
      return K.execToolResult(name, res, 'Cloned.');
    }
    case 'git_branch': {
      const res = await api().gitBranch();
      return K.execToolResult(name, res, '(no branches)');
    }
    case 'spawn_subagent': {
      if (runCtx?.isSubagent) {
        return K.toolError(name, 'Nested subagents are not allowed.', { noRetry: true });
      }
      return K.runSubagent(args.type, args.task, args.context, runCtx);
    }
    case 'open_builtin_browser': {
      const isBg = !runCtx?.ui;
      const res = await deps().hooks.agentOpenBuiltinBrowser(args.url, { background: isBg });
      if (!res.ok) return K.toolError(name, res.error, { url: args.url });
      const msg = isBg
        ? `已在后台记录预览地址：${res.url}（不打扰当前界面）`
        : `已在内置浏览器打开：${res.url}`;
      return K.toolSuccess(name, msg, { url: res.url, background: isBg });
    }
    default: {
      const mcpInfo = (runCtx?.mcpToolMapSnapshot || K.getMcpToolMap()).get(name);
      if (mcpInfo) {
        const res = await api().mcpCallTool(mcpInfo.serverId, mcpInfo.toolName, args);
        if (res.error) return K.toolError(name, res.error, { serverId: mcpInfo.serverId, toolName: mcpInfo.toolName });
        const output = K.clipToolText(res.result || '(无输出)');
        return K.toolResult(!res.isError, name, {
          output,
          error: res.isError ? 'MCP tool returned isError=true' : null,
          meta: { serverId: mcpInfo.serverId, toolName: mcpInfo.toolName, isError: !!res.isError }
        });
      }
      return K.toolError(name, `Unknown tool: ${name}`);
    }
  }
}

  K.executeTool = executeTool;
})(window.YanKernel);
