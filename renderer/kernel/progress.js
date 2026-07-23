/* Yan Agent — progress governor + phase state machine */
(function (K) {
  'use strict';

  K.PHASE = {
    PLAN: 'plan',
    ACT: 'act',
    VERIFY: 'verify',
    DELIVER: 'deliver',
    BLOCKED: 'blocked'
  };

  /** Tools allowed while establishing a plan (operational tasks). */
  K.PLAN_PHASE_TOOLS = new Set([
    'todo_write', 'search_capabilities', 'use_capability',
    'read_file', 'read_file_range', 'list_directory', 'search_files',
    'get_file_outline', 'get_file_imports', 'find_symbol', 'find_references',
    'find_related_files', 'search_symbols', 'build_code_index', 'scan_project',
    'trace_symbol', 'list_skills', 'read_skill', 'list_ui_kit', 'read_ui_kit',
    'git_status', 'git_diff', 'git_log', 'git_branch'
  ]);

  /** Tools preferred during verification. */
  K.VERIFY_PHASE_TOOLS = new Set([
    'todo_write', 'search_capabilities', 'use_capability',
    'read_file', 'read_file_range', 'list_directory', 'search_files',
    'get_file_outline', 'execute_shell', 'open_builtin_browser',
    'browser_snapshot', 'browser_read_page', 'browser_click', 'browser_type',
    'browser_press', 'browser_scroll', 'browser_wait', 'browser_screenshot',
    'git_status', 'git_diff', 'git_log', 'git_branch',
    'find_symbol', 'find_references', 'search_symbols', 'trace_symbol'
  ]);

  /** Successful calls on these tools count as real exploration progress. */
  K.EXPLORATION_TOOLS = new Set([
    'search_capabilities',
    'read_file', 'read_file_range', 'list_directory', 'search_files',
    'get_file_outline', 'get_file_imports', 'find_symbol', 'find_references',
    'find_related_files', 'search_symbols', 'build_code_index', 'scan_project',
    'trace_symbol', 'git_status', 'git_diff', 'git_log', 'git_branch',
    'list_skills', 'read_skill', 'list_ui_kit', 'read_ui_kit',
    'change_workspace', 'open_builtin_browser', 'browser_snapshot', 'browser_read_page',
    'browser_click', 'browser_type', 'browser_press', 'browser_scroll',
    'browser_wait', 'browser_screenshot'
  ]);

  K.MUTATION_TOOLS = new Set([
    'write_file', 'edit_file', 'apply_patch', 'execute_shell', 'change_workspace',
    'git_commit', 'git_push', 'git_pull', 'git_clone', 'todo_write'
  ]);

  K.MAX_NO_PROGRESS_ROUNDS = 8;
  K.MAX_IDENTICAL_ERROR_CODE = 20;
  K.DEFAULT_MAX_LOOP_ITERATIONS = 120;
  K.DEFAULT_TOKEN_BUDGET_SOFT = 600_000;
  /** Same exploration fingerprint (same path/query) may only reset no-progress this many times. */
  K.MAX_IDENTICAL_EXPLORATION = 4;

  K.initRunProgress = function (runCtx) {
    if (!runCtx) return;
    runCtx.phase = runCtx.phase || K.PHASE.PLAN;
    runCtx.progress = runCtx.progress || {
      lastFingerprint: '',
      noProgressRounds: 0,
      lastErrorCode: '',
      sameErrorCodeCount: 0,
      evidenceLedger: new Map(),
      roundIndex: 0,
      explorationHits: 0,
      mutationHits: 0,
      successHits: 0,
      lastExplorationKey: '',
      sameExplorationCount: 0,
      maxNoProgressRounds: null,
      maxIdenticalErrorCode: null
    };
    if (!(runCtx.progress.evidenceLedger instanceof Map)) {
      runCtx.progress.evidenceLedger = new Map();
    }
    if (!(runCtx.evidenceLedger instanceof Map)) {
      runCtx.evidenceLedger = runCtx.progress.evidenceLedger;
    }
    // Apply model budget overrides when present.
    const budget = runCtx.runBudget;
    if (budget) {
      if (budget.maxNoProgressRounds) runCtx.progress.maxNoProgressRounds = budget.maxNoProgressRounds;
      if (budget.maxIdenticalErrorCode) runCtx.progress.maxIdenticalErrorCode = budget.maxIdenticalErrorCode;
    }
  };

  K.isExplorationTool = function (name) {
    const n = String(name || '');
    if (K.EXPLORATION_TOOLS.has(n)) return true;
    // MCP desktop/browser observation (Snapshot, Screenshot, …) counts as exploration.
    if (n.startsWith('mcp__') && /snapshot|screenshot|screen|observe|inspect|tree/i.test(n)) return true;
    return false;
  };

  K.isMutationTool = function (name) {
    const n = String(name || '');
    if (K.MUTATION_TOOLS.has(n)) return true;
    if (n.startsWith('mcp__') && /click|type|press|write|input|launch|open|drag|scroll/i.test(n)) return true;
    return false;
  };

  K.explorationKeyFor = function (executed) {
    let path = '';
    let query = '';
    try {
      const parsed = JSON.parse(executed?.output || '{}');
      path = String(parsed?.meta?.path || '');
      query = String(parsed?.meta?.query || parsed?.meta?.pattern || '').slice(0, 80);
    } catch { /* */ }
    return `${executed?.name || ''}|${path}|${query}|${String(executed?.output || '').replace(/\s+/g, ' ').trim().slice(0, 60)}`;
  };

  K.computeProgressFingerprint = function (runCtx) {
    const as = runCtx?.agentState || {};
    const progress = runCtx?.progress || {};
    const todos = (as.todos || []).map(t => `${t.done ? 1 : 0}${t.inProgress ? 2 : 0}:${t.text}`).join('|');
    const criteria = (as.acceptanceCriteria || [])
      .map(c => `${c.status}:${c.text}:${String(c.evidence || '').slice(0, 40)}`)
      .join('|');
    const changes = Number(runCtx?.fileChangeCount || 0);
    const phase = String(runCtx?.phase || '');
    const fail = String(progress.lastErrorCode || '');
    const explore = Number(progress.explorationHits || 0);
    const mutate = Number(progress.mutationHits || 0);
    // Distinct exploration/mutation hits advance the fingerprint. Do NOT include raw
    // successHits — identical re-reads would never trip the no-progress governor.
    // Raw tool-call count is deliberately excluded: otherwise every repeated
    // no-op read changes the fingerprint and can never be detected as a stall.
    return `${phase}#c${changes}#e${explore}#m${mutate}#${todos}#${criteria}#${fail}`;
  };

  K.recordEvidence = function (runCtx, executed) {
    K.initRunProgress(runCtx);
    if (!executed?.id) return;
    let path = '';
    let snippet = '';
    try {
      const parsed = JSON.parse(executed.output || '{}');
      path = String(parsed?.meta?.path || '');
      snippet = String(parsed?.output || parsed?.error || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    } catch {
      snippet = String(executed.output || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    }
    const effectiveName = K.getExecutedEffectiveToolName?.(executed) || executed.name;
    const entry = {
      id: executed.id,
      name: effectiveName,
      ok: executed.ok === true,
      path,
      snippet,
      exploration: K.isExplorationTool(effectiveName),
      mutation: K.isMutationTool(effectiveName),
      ts: Date.now()
    };
    runCtx.progress.evidenceLedger.set(executed.id, entry);
    runCtx.evidenceLedger.set(executed.id, entry);
    // Cap ledger size: keep only the most recent 200 entries to prevent unbounded token growth.
    if (runCtx.progress.evidenceLedger.size > 200) {
      const oldest = runCtx.progress.evidenceLedger.keys().next().value;
      runCtx.progress.evidenceLedger.delete(oldest);
      runCtx.evidenceLedger.delete(oldest);
    }
  };

  K.recordProgressAfterTools = function (runCtx, scheduledResults) {
    K.initRunProgress(runCtx);
    const progress = runCtx.progress;
    progress.roundIndex = (progress.roundIndex || 0) + 1;

    let madeObservableProgress = false;
    let hadSuccess = false;
    let hadNewExploration = false;

    for (const executed of scheduledResults || []) {
      K.recordEvidence(runCtx, executed);
      const effectiveName = K.getExecutedEffectiveToolName?.(executed) || executed.name;
      if (executed?.ok === true) {
        hadSuccess = true;
        progress.successHits = (progress.successHits || 0) + 1;
        if (K.isExplorationTool(effectiveName)) {
          const key = K.explorationKeyFor({ ...executed, name: effectiveName });
          if (key && key === progress.lastExplorationKey) {
            progress.sameExplorationCount = (progress.sameExplorationCount || 0) + 1;
          } else {
            progress.lastExplorationKey = key;
            progress.sameExplorationCount = 1;
            progress.explorationHits = (progress.explorationHits || 0) + 1;
            hadNewExploration = true;
          }
          // Distinct or limited-repeat exploration still counts as progress.
          if (progress.sameExplorationCount <= (K.MAX_IDENTICAL_EXPLORATION || 4)) {
            madeObservableProgress = true;
          }
        }
        if (K.isMutationTool(effectiveName) || String(effectiveName || '').startsWith('mcp__')) {
          if (K.isMutationTool(effectiveName)) {
            progress.mutationHits = (progress.mutationHits || 0) + 1;
          }
          madeObservableProgress = true;
        }
        // Any successful tool that isn't a pure duplicate error-recovery counts.
        if (!K.isExplorationTool(effectiveName)) {
          madeObservableProgress = true;
        }
      } else if (executed?.ok === false) {
        let code = '';
        try { code = String(JSON.parse(executed.output || '{}')?.meta?.code || ''); } catch { /* */ }
        if (!code) code = `fail:${effectiveName}`;
        if (progress.lastErrorCode === code) progress.sameErrorCodeCount += 1;
        else {
          progress.lastErrorCode = code;
          progress.sameErrorCodeCount = 1;
        }
      }
    }

    // Successful rounds clear identical-error streak (model recovered or moved on).
    if (hadSuccess && !(scheduledResults || []).some(e => e?.ok === false)) {
      progress.sameErrorCodeCount = 0;
      progress.lastErrorCode = '';
    }

    const fingerprint = K.computeProgressFingerprint(runCtx);
    if (madeObservableProgress || fingerprint !== progress.lastFingerprint) {
      progress.noProgressRounds = 0;
      progress.lastFingerprint = fingerprint;
      if (hadNewExploration) progress.lastExplorationKey = progress.lastExplorationKey;
    } else {
      progress.noProgressRounds += 1;
    }
    return progress;
  };

  /**
   * @returns {null | { stop: true, status: string, message: string }}
   */
  K.evaluateProgressGovernor = function (runCtx) {
    K.initRunProgress(runCtx);
    const progress = runCtx.progress;
    const budget = runCtx.runBudget || {};
    const maxNoProgress = Number(
      progress.maxNoProgressRounds
      || budget.maxNoProgressRounds
      || K.MAX_NO_PROGRESS_ROUNDS
    ) || 8;
    const maxSameCode = Number(
      progress.maxIdenticalErrorCode
      || budget.maxIdenticalErrorCode
      || K.MAX_IDENTICAL_ERROR_CODE
    ) || 3;

    if (progress.sameErrorCodeCount >= maxSameCode && progress.lastErrorCode) {
      return {
        stop: true,
        status: 'error',
        message: `进度熔断：连续 ${progress.sameErrorCodeCount} 次相同错误码（${progress.lastErrorCode}）。请换策略、重读文件，或向用户说明阻塞原因。`
      };
    }
    // Repeated identical failures have their own exact 20-call breaker. Do not
    // let the broader no-progress governor stop that sequence prematurely.
    if (progress.noProgressRounds >= maxNoProgress && progress.sameErrorCodeCount < 2) {
      return {
        stop: true,
        status: 'error',
        message: `进度熔断：连续 ${progress.noProgressRounds} 轮无任何可观测进展（探索新文件/待办/验收/文件变更均未推进）。任务已停止以避免空转。`
      };
    }
    return null;
  };

  K.syncRunPhase = function (runCtx) {
    K.initRunProgress(runCtx);
    const plan = runCtx?.capabilityPlan;
    const as = runCtx?.agentState;
    if (!plan?.operational) {
      runCtx.phase = K.PHASE.ACT;
      return runCtx.phase;
    }
    // Desktop/browser actuators may act before a formal plan when todo_write is not exposed.
    const actuatorFirst = !!(plan?.desktop || plan?.browserAutomation);
    const todoWriteExposed = runCtx?.exposedToolNames instanceof Set
      ? runCtx.exposedToolNames.has('todo_write')
      : !!plan?.allowedToolNames?.has('todo_write');
    if (!as?.todosFromTool) {
      if (actuatorFirst && (!todoWriteExposed || Number(as?.toolCallCount || 0) > 0)) {
        runCtx.phase = K.PHASE.ACT;
      } else {
        runCtx.phase = K.PHASE.PLAN;
      }
      return runCtx.phase;
    }
    const gate = K.checkCompletionGate ? K.checkCompletionGate(runCtx) : { ok: true };
    if (gate.ok) {
      runCtx.phase = K.PHASE.DELIVER;
      return runCtx.phase;
    }
    const criteria = as.acceptanceCriteria || [];
    const waitingEvidence = criteria.some(c =>
      ['satisfied', 'skipped'].includes(c.status) && !K.isEvidenceGrounded?.(c, runCtx)
    );
    const pendingWork = (as.todos || []).some(t => !t.done);
    if (!pendingWork && criteria.length && (waitingEvidence || criteria.some(c => c.status === 'pending' || c.status === 'in_progress'))) {
      runCtx.phase = K.PHASE.VERIFY;
    } else {
      runCtx.phase = K.PHASE.ACT;
    }
    return runCtx.phase;
  };

  // Full exposure: phase never hides tools. It is conveyed to the model as guidance
  // in the live task-state prompt ("phase: verify — focus on checking your work"),
  // and execution-time policies (shell approval, read-before-edit, path sandbox)
  // do the real guarding. Kept as identity for backward compatibility.
  K.CORE_ALWAYS_TOOLS = new Set(['todo_write', 'search_capabilities', 'use_capability']);
  K.filterToolsByPhase = function (runCtx, tools) {
    return tools || [];
  };

  /**
   * Authoritative harness state injected every iteration (and after compress).
   * Strong-thinking models re-anchor on this after long reasoning drifts.
   */
  K.buildTaskStatePrompt = function (runCtx) {
    K.initRunProgress(runCtx);
    const as = runCtx?.agentState || {};
    const plan = runCtx?.capabilityPlan;
    const budget = runCtx?.runBudget;
    const progress = runCtx?.progress || {};
    // Cache-friendly: this block is injected append-only, so keep it STABLE across
    // iterations when nothing material changed (the loop dedupes identical blocks).
    // Volatile counters appear only when they carry a signal (approaching a limit).
    const lines = [
      '# Live task state (authoritative harness state — supersedes any earlier task-state block)',
      `- phase: ${runCtx.phase || 'act'}`,
      `- phase_guidance: ${runCtx.phase === 'plan' ? 'establish a todo_write plan before mutating' : runCtx.phase === 'verify' ? 'verify your work with reads/tests; fix defects you find' : runCtx.phase === 'deliver' ? 'finalize evidence and summarize' : 'execute the plan'}`
    ];
    const maxIter = Number(runCtx.maxLoopIterations || budget?.maxLoopIterations || K.MAX_LOOP_ITERATIONS) || 0;
    if (maxIter && (as.iteration || 0) >= maxIter * 0.7) {
      lines.push(`- WARNING iteration ${as.iteration}/${maxIter}: wrap up — finish essential work and deliver.`);
    }
    const maxStall = Number(progress.maxNoProgressRounds) || 0;
    if ((progress.noProgressRounds || 0) > 0 && maxStall) {
      lines.push(`- WARNING no observable progress for ${progress.noProgressRounds}/${maxStall} rounds: change approach or report the blocker.`);
    }
    if (budget?.label) lines.push(`- model_budget: ${budget.label} (max_tokens=${budget.maxTokens}, loop=${budget.maxLoopIterations})`);
    if (as.outcome) lines.push(`- outcome: ${as.outcome}`);
    if (as.acceptanceCriteria?.length) {
      lines.push('- acceptance_criteria:');
      for (const c of as.acceptanceCriteria.slice(0, 12)) {
        const grounded = K.isEvidenceGrounded?.(c, runCtx) ? 'grounded' : 'ungrounded';
        lines.push(`  - [${c.status}/${grounded}] ${c.text}${c.evidence ? ` | evidence: ${String(c.evidence).slice(0, 100)}` : ''}`);
      }
    }
    if (as.todos?.length) {
      lines.push('- todos:');
      for (const t of as.todos.slice(0, 16)) {
        const mark = t.done ? 'done' : (t.inProgress ? 'in_progress' : 'pending');
        lines.push(`  - [${mark}] ${t.text}`);
      }
    }
    if (runCtx.phase === K.PHASE.PLAN) {
      lines.push('- plan phase: call todo_write with outcome, acceptance_criteria, and todos before any write/shell mutation.');
    }
    if (runCtx.phase === K.PHASE.VERIFY) {
      lines.push('- verify phase: gather grounded evidence (tool call ids / command output / file paths) and update todo_write. Do not claim done without evidence.');
    }
    if (runCtx.contextCompressionCount > 0) {
      lines.push('- note: early history was compressed. Trust this harness block + recent_tool_ledger over vague memory of older steps.');
    }
    // The tool ledger is only emitted AFTER compression: before that, every tool
    // result (with its callId) is still verbatim in context, so repeating a rolling
    // 12-entry window here would change the block every round and defeat both the
    // append-dedup and the provider prefix cache.
    if (runCtx.contextCompressionCount > 0) {
      const recent = [...(runCtx.evidenceLedger?.values?.() || [])].slice(-12);
      if (recent.length) {
        lines.push('- recent_tool_ledger:');
        for (const e of recent) {
          const tag = e.exploration ? 'explore' : (e.mutation ? 'mutate' : 'tool');
          lines.push(`  - ${e.id} ${e.ok ? 'ok' : 'fail'} [${tag}] ${e.name}${e.path ? ` path=${e.path}` : ''}${e.snippet ? ` :: ${String(e.snippet).slice(0, 80)}` : ''}`);
        }
      }
    }
    const unresolved = [...(runCtx.unresolvedToolErrors?.values?.() || [])];
    if (unresolved.length) {
      lines.push('- unresolved_tool_errors (must recover or report):');
      for (const f of unresolved.slice(0, 6)) {
        lines.push(`  - ${f.label}: ${String(f.detail || '').slice(0, 160)}`);
      }
    }
    return lines.join('\n');
  };

  /** Compact block injected as a user message after context compression. */
  K.buildPostCompressHarnessPrompt = function (runCtx) {
    const state = K.buildTaskStatePrompt?.(runCtx) || '';
    return [
      '## Harness re-anchor (context was just compressed)',
      'The earlier conversation was summarized. Do not re-open finished work.',
      'Continue from the live task state below. Prefer tool call ids in recent_tool_ledger as evidence.',
      '',
      state
    ].join('\n');
  };

})(window.YanKernel);
