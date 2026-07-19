/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;

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

async function executeTool(name, args, runCtx) {
  const as = runCtx?.agentState || deps().getCurrentAgentState();
  const ui = runCtx?.ui !== false;
  switch (name) {
    case 'todo_write': {
      const todos = Array.isArray(args.todos) ? args.todos : [];
      const criteria = Array.isArray(args.acceptance_criteria) ? args.acceptance_criteria : [];
      as.todos = todos.map(t => ({
        text: String(t.text || ''),
        done: t.status === 'done',
        inProgress: t.status === 'in_progress'
      }));
      as.todosFromTool = true;
      as.outcome = String(args.outcome || '').trim();
      as.acceptanceCriteria = criteria.map(c => ({
        text: String(c.text || '').trim(),
        status: ['pending', 'in_progress', 'satisfied', 'skipped'].includes(c.status) ? c.status : 'pending',
        evidence: String(c.evidence || '').trim()
      }));
      as.outcomeFromTool = !!(as.outcome && as.acceptanceCriteria.length);
      if (ui) {
        deps().hooks.renderTodos(as);
        deps().hooks.updateContextInfo(as);
      }
      const doneCount = as.todos.filter(t => t.done).length;
      const satisfiedCount = as.acceptanceCriteria.filter(c => ['satisfied', 'skipped'].includes(c.status) && c.evidence).length;
      if (deps().hooks.clearDeferredTodosIfDone) {
        await deps().hooks.clearDeferredTodosIfDone(as);
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
      const path = await K.resolveWorkspacePath(args.path, runCtx);
      const res = await api().readFile(path);
      if (res.error) return K.toolError(name, res.error, { path });
      if (runCtx && K.recordFileRead) K.recordFileRead(runCtx, path);
      if (res.isBinary) {
        return K.toolSuccess(name, `(binary file, ${res.size} bytes)`, { path, isBinary: true, size: res.size, mtime: res.mtime });
      }
      return K.toolSuccess(name, K.clipToolText(res.content), { path, size: res.size, mtime: res.mtime });
    }
    case 'write_file': {
      const path = await K.resolveWorkspacePath(args.path, runCtx);
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
      const ws = await K.getRunWorkspace(runCtx);
      const dir = args.path ? await K.resolveWorkspacePath(args.path, runCtx) : ws;
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
            '用户拒绝了 Shell/PowerShell 执行权限。请改用 read_file、read_file_range、edit_file、apply_patch、write_file、search_files、get_file_outline、find_symbol、find_references、search_symbols、list_directory 等工具完成任务，不要再次调用 execute_shell。',
            { denied: true, noRetry: true, command: args.command }
          );
        }
      } else if (needsPrompt) {
        return K.toolError(name, 'Shell execution is disabled in permissions.', { denied: true, noRetry: true });
      }
      const oneShot = !!(runCtx?.shellAllowedOnce && !perm.allowShell);
      const ws = await K.getRunWorkspace(runCtx);
      const res = await api().executeShell(args.command, ws || undefined, oneShot);
      return K.execToolResult(name, res, '(no output)');
    }
    case 'search_files': {
      const ws = await K.getRunWorkspace(runCtx);
      const directory = args.path ? await K.resolveWorkspacePath(args.path, runCtx) : ws;
      const results = await api().searchFiles({
        query: args.query,
        directory,
        extensions: args.extensions,
        regex: !!args.regex,
        caseSensitive: !!args.case_sensitive,
        contextLines: args.context_lines
      });
      const output = K.formatSearchResults(results);
      return K.toolSuccess(name, output, { query: args.query, count: results.length, directory });
    }
    case 'get_file_outline': {
      const path = await K.resolveWorkspacePath(args.path, runCtx);
      const res = await api().readFile(path);
      if (res.error) return K.toolError(name, res.error, { path });
      if (res.isBinary) return K.toolError(name, 'Cannot outline binary file.', { path, isBinary: true });
      if (runCtx && K.recordFileRead) K.recordFileRead(runCtx, path);
      const outline = K.outlineFile(res.content, path);
      const output = K.formatOutline(path, outline);
      return K.toolSuccess(name, output, { path, ...outline });
    }
    case 'find_symbol': {
      const workspace = await K.getRunWorkspace(runCtx);
      const { hits, error } = await K.findSymbolDefinitions(args.name, { kind: args.kind, workspace });
      if (error) return K.toolError(name, error);
      const output = K.formatSymbolHits(args.name, hits);
      return K.toolSuccess(name, output, { name: args.name, count: hits.length, hits });
    }
    case 'read_file_range': {
      const path = await K.resolveWorkspacePath(args.path, runCtx);
      const res = await api().readFileRange(path, args.start_line, args.end_line);
      if (res.error) return K.toolError(name, res.error, { path });
      if (runCtx && K.recordFileRead) K.recordFileRead(runCtx, path);
      const header = `## ${path} (lines ${res.start}-${res.end} of ${res.lineCount})`;
      return K.toolSuccess(name, `${header}\n${res.content}`, { path, ...res });
    }
    case 'get_file_imports': {
      const path = await K.resolveWorkspacePath(args.path, runCtx);
      const data = await api().codeFileImports(path);
      if (data.error) return K.toolError(name, data.error, { path });
      if (runCtx && K.recordFileRead) K.recordFileRead(runCtx, path);
      return K.toolSuccess(name, K.formatImports(path, data), { path, ...data });
    }
    case 'find_references': {
      const workspace = await K.getRunWorkspace(runCtx);
      const res = await api().codeFindReferences({ name: args.name, max_results: args.max_results, workspace });
      if (res.error) return K.toolError(name, res.error);
      const output = K.formatReferenceHits(args.name, res.hits || []);
      return K.toolSuccess(name, output, { name: args.name, count: res.count || 0, hits: res.hits });
    }
    case 'find_related_files': {
      const workspace = await K.getRunWorkspace(runCtx);
      const path = await K.resolveWorkspacePath(args.path, runCtx);
      const data = await api().codeFindRelated({ path, workspace });
      if (data.error) return K.toolError(name, data.error, { path });
      return K.toolSuccess(name, K.formatRelated(data), { path, ...data });
    }
    case 'search_symbols': {
      const workspace = await K.getRunWorkspace(runCtx);
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
      const workspace = await K.getRunWorkspace(runCtx);
      const res = await api().buildCodeIndex({ force: !!args.force, workspace });
      if (res.error) return K.toolError(name, res.error);
      const msg = res.cached
        ? `Code index ready (cached). ${res.fileCount} files, ${res.symbolCount} symbols.`
        : `Code index built. ${res.fileCount} files, ${res.symbolCount} symbols saved to .yanagent/code-index.json`;
      return K.toolSuccess(name, msg, res);
    }
    case 'scan_project': {
      const workspace = await K.getRunWorkspace(runCtx);
      const res = await api().codeScanProject(workspace);
      if (res.error) return K.toolError(name, res.error);
      return K.toolSuccess(name, res.summary, { meta: res.meta });
    }
    case 'trace_symbol': {
      const workspace = await K.getRunWorkspace(runCtx);
      const res = await api().codeTraceSymbol({ name: args.name, workspace });
      if (res.error) return K.toolError(name, res.error);
      const output = K.formatTrace(res);
      return K.toolSuccess(name, output, res);
    }
    case 'git_status': {
      const workspace = await K.getRunWorkspace(runCtx);
      const res = await api().gitStatus(workspace || undefined);
      return K.execToolResult(name, res, '(no output)');
    }
    case 'git_diff': {
      const workspace = await K.getRunWorkspace(runCtx);
      const res = workspace
        ? await api().gitDiff(workspace, !!args.staged)
        : await api().gitDiff(!!args.staged);
      return K.execToolResult(name, res, '(no changes)');
    }
    case 'git_log': {
      const workspace = await K.getRunWorkspace(runCtx);
      const res = workspace
        ? await api().gitLog(workspace, args.limit || 20)
        : await api().gitLog(args.limit || 20);
      return K.execToolResult(name, res, '(no commits)');
    }
    case 'git_commit': {
      const workspace = await K.getRunWorkspace(runCtx);
      const res = await api().gitCommit(args.message, workspace || undefined);
      return K.execToolResult(name, res, 'Committed.');
    }
    case 'git_push': {
      const workspace = await K.getRunWorkspace(runCtx);
      const res = workspace
        ? await api().gitPush(workspace, args.remote, args.branch)
        : await api().gitPush(args.remote, args.branch);
      return K.execToolResult(name, res, 'Pushed.');
    }
    case 'git_pull': {
      const workspace = await K.getRunWorkspace(runCtx);
      const res = workspace
        ? await api().gitPull(workspace, args.remote, args.branch)
        : await api().gitPull(args.remote, args.branch);
      return K.execToolResult(name, res, 'Pulled.');
    }
    case 'git_clone': {
      const workspace = await K.getRunWorkspace(runCtx);
      const res = await api().gitClone(args.url, workspace || undefined);
      return K.execToolResult(name, res, 'Cloned.');
    }
    case 'git_branch': {
      const workspace = await K.getRunWorkspace(runCtx);
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
      let items = [
        ...(catalog.installed || []).map(s => ({ ...s, installed: true })),
        ...(catalog.market || []).filter(s => !s.installed).map(s => ({ ...s, installed: false }))
      ];
      if (tag) items = items.filter(s => (s.tags || []).includes(tag));
      if (q) {
        items = items.filter(s => {
          const hay = `${s.id} ${s.name} ${s.desc} ${(s.triggers || []).join(' ')}`.toLowerCase();
          return hay.includes(q);
        });
      }
      items = items.slice(0, 40);
      const lines = items.map(s =>
        `- ${s.id} [${s.installed ? 'installed' : 'market'}] ${s.name}: ${s.desc}`
      );
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
      const header = `# Skill: ${res.name} (${res.id})${res.autoInstalled ? ' [已从 Skill 目录自动安装]' : ''}`;
      return K.toolSuccess(name, `${header}\n\n${res.prompt}`, {
        id: res.id,
        name: res.name,
        autoInstalled: !!res.autoInstalled,
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
      }
      const msg = isBg
        ? `已在后台记录预览地址：${res.url}（不打扰当前界面）`
        : `已在内置浏览器打开：${res.url}`;
      return K.toolSuccess(name, msg, { url: res.url, background: isBg });
    }
    default: {
      const mcpInfo = (runCtx?.mcpToolMapSnapshot || K.getMcpToolMap()).get(name);
      if (mcpInfo) {
        const isPlaywright = /playwright/i.test(`${mcpInfo.serverId} ${mcpInfo.toolName}`);
        if (isPlaywright && !runCtx?.ui) {
          return K.toolError(name,
            '后台任务禁止启动 Playwright 或外部浏览器。请使用 open_builtin_browser 记录预览地址，或把交互验证留给前台任务。',
            { noRetry: true, policy: 'no_background_playwright', requiredTool: 'open_builtin_browser' });
        }
        if (isPlaywright && !runCtx?.builtinBrowserOpened) {
          return K.toolError(name,
            '必须先成功调用 open_builtin_browser 完成内置预览，不能直接启动 Edge/Playwright。',
            { noRetry: true, policy: 'builtin_browser_first', requiredTool: 'open_builtin_browser' });
        }
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
  K.findLatestRunImageAttachment = findLatestRunImageAttachment;
})(window.YanKernel);
