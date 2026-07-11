/* Yan Agent — subagent runner (auxiliary + specialist profiles) */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;

  const EDIT_TOOLS = new Set([
    'read_file', 'read_file_range', 'get_file_outline', 'get_file_imports',
    'list_directory', 'search_files', 'search_symbols', 'find_symbol',
    'edit_file', 'apply_patch', 'write_file'
  ]);

  const PROFILES = {
    explore: {
      tier: 'auxiliary',
      label: 'Explore',
      icon: '🔍',
      tools: K.CODE_EXPLORE_TOOLS || new Set([
        'read_file', 'read_file_range', 'list_directory', 'search_files',
        'get_file_outline', 'get_file_imports', 'find_symbol', 'find_references',
        'search_symbols', 'find_related_files', 'scan_project', 'build_code_index',
        'trace_symbol', 'git_status', 'git_diff', 'git_log'
      ]),
      directive: `You are an Explore subagent (auxiliary, read-only).
Goal: quickly gather facts for the main agent — paths, symbols, git state, snippets.
Output a structured summary: Key files, Findings, Recommended next steps. No filler.`
    },
    shell: {
      tier: 'auxiliary',
      label: 'Shell',
      icon: '⚡',
      tools: new Set(['execute_shell']),
      directive: `You are a Shell subagent (auxiliary).
Run only commands required for the subtask. Report exit codes and relevant stdout/stderr.
Output: Commands run, Results, Blockers (if any).`
    },
    review: {
      tier: 'auxiliary',
      label: 'Review',
      icon: '📝',
      tools: new Set([
        ...(K.CODE_EXPLORE_TOOLS || []),
        'git_diff', 'git_log'
      ]),
      directive: `You are a Review subagent (auxiliary, read-only).
Audit code for correctness, security, performance, maintainability.
Output: Issues by severity (critical/major/minor), with file:line references when possible.`
    },
    edit: {
      tier: 'auxiliary',
      label: 'Edit',
      icon: '✏️',
      tools: EDIT_TOOLS,
      directive: `You are an Edit subagent (auxiliary).
Make focused, minimal changes assigned in the subtask. Read before edit. Verify after write.
Output: Files changed, What changed, Verification status. Do not expand scope.`
    },
    ui: {
      tier: 'specialist',
      label: 'UI',
      icon: '🎨',
      tools: new Set([
        ...EDIT_TOOLS,
        'open_builtin_browser'
      ]),
      directive: `You are a UI specialist subagent (HTML/CSS/JS, frontend).
Implement or fix UI as assigned. Match existing design tokens. After HTML changes, call open_builtin_browser to preview.
Output: Files touched, Preview URL/path, Visual/UX notes.`
    },
    doc: {
      tier: 'specialist',
      label: 'Doc',
      icon: '📄',
      tools: new Set([
        'read_file', 'read_file_range', 'list_directory', 'search_files',
        'write_file', 'edit_file', 'apply_patch', 'get_file_outline'
      ]),
      directive: `You are a Document specialist subagent (Markdown/HTML reports, README, slides outline).
Produce structured documents in the workspace (md/html). For slide decks, use Markdown with clear slide sections unless asked for HTML.
Output: Deliverable paths, Structure summary, Open questions.`
    }
  };

  // Normalize CODE_EXPLORE_TOOLS Set spread — Set can't spread directly in object literal at load time
  for (const key of ['review']) {
    const p = PROFILES[key];
    if (p && K.CODE_EXPLORE_TOOLS) {
      p.tools = new Set([...K.CODE_EXPLORE_TOOLS, 'git_diff', 'git_log']);
    }
  }

  const MAX_PARALLEL = 3;

  function filterTools(allTools, allowed) {
    return allTools.filter(t => {
      const name = t.function?.name;
      return name && allowed.has(name);
    });
  }

  function getProfile(type) {
    return PROFILES[String(type || '').trim()] || null;
  }

  function emitSubagentEvent(parentRunCtx, event) {
    try {
      deps().hooks?.onSubagentEvent?.({
        sessionId: parentRunCtx.sessionId,
        runId: parentRunCtx.runId,
        ...event
      });
    } catch { /* UI optional */ }
  }

  async function runSubagent(type, task, context, parentRunCtx, options = {}) {
    const profile = getProfile(type);
    if (!profile) {
      const known = Object.keys(PROFILES).join(', ');
      return K.toolError('spawn_subagent', `Unknown subagent type "${type}". Available: ${known}`);
    }
    const taskText = String(task || '').trim();
    if (!taskText) {
      return K.toolError('spawn_subagent', 'task is required.');
    }

    const subCtx = K.createRunCtx(parentRunCtx.sessionId, false);
    subCtx.isSubagent = true;
    subCtx.subagentType = type;
    subCtx.subagentTier = profile.tier;
    subCtx.runId = parentRunCtx.runId;
    subCtx.shellAllowedOnce = parentRunCtx.shellAllowedOnce;
    subCtx.mcpToolMapSnapshot = parentRunCtx.mcpToolMapSnapshot;
    subCtx.policyState = parentRunCtx.policyState;

    const tools = filterTools(K.snapshotTools(), profile.tools);
    if (!tools.length) {
      return K.toolError('spawn_subagent', 'No tools available for subagent profile.');
    }

    emitSubagentEvent(parentRunCtx, { phase: 'start', type, tier: profile.tier, task: taskText.slice(0, 200) });

    let basePrompt = '';
    try {
      basePrompt = await K.buildSystemPrompt();
    } catch {
      basePrompt = 'You are Yan Agent subagent.';
    }

    const apiMessages = [
      {
        role: 'system',
        content: basePrompt + '\n\n# Subagent: ' + profile.label + ' (' + profile.tier + ')\n' + profile.directive
      },
      {
        role: 'user',
        content: (context ? String(context).trim() + '\n\n' : '') + '## Subtask\n' + taskText
      }
    ];

    let iteration = 0;
    let summary = '';
    let toolCallCount = 0;
    const toolTrace = [];
    const maxIter = options.maxIterations || K.MAX_SUBAGENT_ITERATIONS || 12;

    while (iteration < maxIter) {
      if (parentRunCtx.shouldAbort) {
        emitSubagentEvent(parentRunCtx, { phase: 'interrupted', type, iterations: iteration, toolCalls: toolCallCount });
        return K.toolSuccess(options.toolName || 'spawn_subagent', summary || 'Subagent interrupted.', {
          type, tier: profile.tier, label: profile.label,
          iterations: iteration, toolCalls: toolCallCount, interrupted: true, subagent: true, toolTrace
        });
      }

      iteration++;
      const result = await K.callApiStream(apiMessages, null, subCtx, tools);

      if (result.content) summary = result.content;
      if (!result.tool_calls || !result.tool_calls.length) break;

      const assistantTurn = {
        role: 'assistant',
        content: result.content || '',
        tool_calls: result.tool_calls
      };
      if (result.reasoning_content) assistantTurn.reasoning_content = result.reasoning_content;
      apiMessages.push(assistantTurn);

      for (const tc of result.tool_calls) {
        if (parentRunCtx.shouldAbort) break;
        const fnName = tc.function.name;
        let fnArgs = {};
        try { fnArgs = JSON.parse(tc.function.arguments || '{}'); } catch {}

        let toolOutput;
        if (fnName === 'spawn_subagent' || fnName === 'spawn_subagents') {
          toolOutput = K.toolError(fnName, 'Nested subagents are not allowed.', { noRetry: true });
        } else {
          toolOutput = await K.executeToolWithRetry(fnName, fnArgs, subCtx);
        }
        toolCallCount++;
        toolTrace.push({
          tool: fnName,
          ok: (() => { try { return JSON.parse(toolOutput).ok; } catch { return null; } })()
        });
        emitSubagentEvent(parentRunCtx, {
          phase: 'tool', type, tool: fnName, iteration, toolCalls: toolCallCount
        });
        apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolOutput });
      }
    }

    parentRunCtx.fileChangeCount = (parentRunCtx.fileChangeCount || 0) + (subCtx.fileChangeCount || 0);

    emitSubagentEvent(parentRunCtx, {
      phase: 'done', type, tier: profile.tier,
      iterations: iteration, toolCalls: toolCallCount, summary: (summary || '').slice(0, 400)
    });

    return K.toolSuccess(options.toolName || 'spawn_subagent', summary || '(Subagent finished.)', {
      type,
      tier: profile.tier,
      label: profile.label,
      task: taskText.slice(0, 300),
      iterations: iteration,
      toolCalls: toolCallCount,
      subagent: true,
      toolTrace
    });
  }

  async function runSubagentsParallel(agents, parentRunCtx) {
    const list = Array.isArray(agents) ? agents : [];
    if (!list.length) {
      return K.toolError('spawn_subagents', 'agents array is required.');
    }
    if (list.length > MAX_PARALLEL) {
      return K.toolError('spawn_subagents', `Max ${MAX_PARALLEL} parallel subagents. Got ${list.length}.`);
    }

    emitSubagentEvent(parentRunCtx, { phase: 'parallel_start', count: list.length });

    const results = await Promise.all(list.map((spec, i) => {
      const type = spec.type || 'explore';
      const task = spec.task || '';
      const context = spec.context || '';
      return runSubagent(type, task, context, parentRunCtx, {
        toolName: 'spawn_subagents',
        maxIterations: spec.max_iterations
      }).then(raw => {
        let parsed = {};
        try { parsed = JSON.parse(raw); } catch { parsed = { output: raw }; }
        return { index: i, type, task: String(task).slice(0, 120), ...parsed };
      });
    }));

    const sections = results.map((r, i) => {
      const header = `### [${i + 1}] ${r.meta?.label || r.type || 'subagent'} (${r.meta?.tier || 'auxiliary'})`;
      const stats = `iterations: ${r.meta?.iterations ?? '?'}, tools: ${r.meta?.toolCalls ?? '?'}`;
      const body = r.output || r.error || '(no output)';
      return `${header}\n${stats}\n\n${body}`;
    });

    const combined = sections.join('\n\n---\n\n');
    const totalTools = results.reduce((n, r) => n + (r.meta?.toolCalls || 0), 0);

    emitSubagentEvent(parentRunCtx, { phase: 'parallel_done', count: list.length, totalTools });

    return K.toolSuccess('spawn_subagents', combined, {
      subagent: true,
      parallel: true,
      count: list.length,
      totalToolCalls: totalTools,
      results: results.map(r => ({
        type: r.type,
        tier: r.meta?.tier,
        label: r.meta?.label,
        ok: r.ok,
        toolCalls: r.meta?.toolCalls,
        iterations: r.meta?.iterations
      }))
    });
  }

  K.runSubagent = runSubagent;
  K.runSubagentsParallel = runSubagentsParallel;
  K.getSubagentProfile = getProfile;
  K.SUBAGENT_PROFILES = PROFILES;
})(window.YanKernel);
