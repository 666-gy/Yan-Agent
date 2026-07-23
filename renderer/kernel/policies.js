/* Yan Agent — kernel runtime policies (enforce, not prompt) */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const WORK_MODES = new Set(['normal', 'plan', 'goal']);
  const PLAN_APPROVAL_RE = /^(?:开始|执行|继续|继续工作|按计划|照计划|照此|同意|批准|可以开始|开始干|动手|就这么做)/i;

  K.getWorkMode = function (configOrMode = {}) {
    const value = typeof configOrMode === 'string'
      ? configOrMode
      : configOrMode?.agent?.workMode;
    return WORK_MODES.has(String(value || '')) ? String(value) : 'normal';
  };

  K.isPlanExecutionApproved = function (messages = []) {
    const latestUser = [...messages].reverse().find(message => message?.role === 'user');
    if (!PLAN_APPROVAL_RE.test(String(latestUser?.content || '').trim())) return false;
    return messages.some(message => (
      message?.role === 'assistant'
      && message?.agentRun?.workMode === 'plan'
      && message.agentRun.planOnly === true
    ));
  };

  K.checkWorkModeToolPolicy = function (name, args, runCtx) {
    if (runCtx?.workMode !== 'plan' || runCtx?.planExecutionApproved) return { ok: true };
    const toolName = String(name || '');
    const blocked = new Set([
      'edit_file', 'apply_patch', 'write_file', 'execute_shell', 'generate_image',
      'git_commit', 'git_push', 'git_pull', 'git_clone', 'change_workspace'
    ]);
    let shouldBlock = blocked.has(toolName) || toolName.startsWith('mcp__');
    if (['spawn_subagent', 'spawn_subagents'].includes(toolName)) {
      const agents = toolName === 'spawn_subagent' ? [args] : (args?.agents || []);
      shouldBlock = agents.some(agent => ['shell', 'edit', 'ui', 'doc'].includes(String(agent?.type || '')));
    }
    if (!shouldBlock) return { ok: true };
    return {
      ok: false,
      code: 'PLAN_MODE_AWAITING_APPROVAL',
      error: '当前为“计划”工作方式：本轮只能检查现状并展示计划，尚未获得用户执行批准。请完成 todo_write 后向用户展示计划并等待其明确开始/继续。'
    };
  };

  K.applyWorkModeBudget = function (runCtx, budget) {
    if (!budget || runCtx?.workMode !== 'goal') return budget;
    budget.maxLoopIterations = Math.max(Number(budget.maxLoopIterations) || 0, 500);
    budget.maxNoProgressRounds = Math.max(Number(budget.maxNoProgressRounds) || 0, 16);
    budget.lengthContinueLimit = Math.max(Number(budget.lengthContinueLimit) || 0, 24);
    budget.gateBlockLimit = Math.max(Number(budget.gateBlockLimit) || 0, 12);
    if (runCtx) runCtx.maxLoopIterations = budget.maxLoopIterations;
    return budget;
  };

  K.createPolicyState = function () {
    return { readPaths: new Set() };
  };

  K.recordFileRead = function (runCtx, filePath) {
    if (!runCtx.policyState) runCtx.policyState = K.createPolicyState();
    runCtx.policyState.readPaths.add(String(filePath || '').toLowerCase());
  };

  K.requireReadBeforeEdit = function (runCtx, filePath) {
    if (!runCtx.policyState) runCtx.policyState = K.createPolicyState();
    const key = String(filePath || '').toLowerCase();
    if (!runCtx.policyState.readPaths.has(key)) {
      return {
        ok: false,
        error: 'Policy: read_file("' + filePath + '") required before editing this path.',
        code: 'POLICY_READ_BEFORE_EDIT'
      };
    }
    return { ok: true };
  };

  /** Extract call ids referenced in evidence text. */
  K.extractEvidenceCallIds = function (evidence) {
    const text = String(evidence || '');
    const ids = new Set();
    const re = /\b(call_[a-zA-Z0-9_.:-]+|run_[a-zA-Z0-9]+:[a-zA-Z0-9_.:-]+)\b/g;
    let match;
    while ((match = re.exec(text)) !== null) ids.add(match[1]);
    // Also accept bare tool ledger references like "callId=..."
    const re2 = /callId[=:]\s*([a-zA-Z0-9_.:-]+)/gi;
    while ((match = re2.exec(text)) !== null) ids.add(match[1]);
    return [...ids];
  };

  /**
   * Evidence is grounded if:
   * - status is skipped with non-empty evidence (user skip instruction), OR
   * - evidence references a known successful tool call id from this run, OR
   * - evidence contains a concrete path that was read/written this run, OR
   * - evidence contains exit code / verification markers from tool output snippets
   */
  K.isEvidenceGrounded = function (criterion, runCtx) {
    const status = String(criterion?.status || '');
    const evidence = String(criterion?.evidence || '').trim();
    if (!evidence) return false;
    if (status === 'skipped') return evidence.length >= 4;

    const ledger = runCtx?.evidenceLedger || runCtx?.progress?.evidenceLedger;
    const entries = ledger instanceof Map ? [...ledger.values()] : [];

    const callIds = K.extractEvidenceCallIds(evidence);
    if (callIds.length) {
      const hit = callIds.some(id => {
        const entry = ledger instanceof Map ? ledger.get(id) : null;
        return entry && entry.ok;
      });
      if (hit) return true;
    }

    // Path grounding: evidence mentions a path that appeared in a successful tool result
    const lower = evidence.toLowerCase();
    for (const entry of entries) {
      if (!entry.ok) continue;
      if (entry.path && lower.includes(String(entry.path).toLowerCase().replace(/\\/g, '/'))) return true;
      if (entry.snippet && entry.snippet.length >= 12 && lower.includes(entry.snippet.slice(0, 40).toLowerCase())) return true;
    }

    // Command-style grounding
    if (/\bexit\s*code\s*[:=]?\s*0\b/i.test(evidence) && entries.some(e => e.ok && e.name === 'execute_shell')) {
      return true;
    }
    if (/\bread-back verified|wrote .+ bytes|applied \d+ edit/i.test(evidence) && entries.some(e => e.ok && /edit_file|apply_patch|write_file/.test(e.name))) {
      return true;
    }

    // Lenient fallback for non-operational chat (no tools expected)
    if (runCtx?.capabilityPlan && runCtx.capabilityPlan.operational === false) return true;

    // Content-sufficiency fallback: if evidence is substantive (mentions a filename,
    // command, number, or path) treat it as grounded even without a call_id.
    // This prevents gate death-loops when the model writes good evidence in natural language.
    if (evidence.length >= 20 && /[\/.]|\d+|exit\s*code|wrote|created|updated|passed|verified|success/i.test(evidence)) return true;

    return false;
  };

  /** 判断 pending todo 是否必须立即完成 */
  K.classifyPendingTodos = function (runCtx) {
    const as = runCtx.agentState;
    if (!as.todosFromTool || !as.todos.length) return { essential: false, pending: [] };
    const pending = as.todos.filter(t => !t.done);
    if (!pending.length) return { essential: false, pending: [] };

    const doneCount = as.todos.filter(t => t.done).length;
    const hasInProgress = pending.some(t => t.inProgress);

    if (runCtx?.workMode === 'goal' && !runCtx?.workspaceRequestDenied) {
      return { essential: true, pending, hasInProgress, doneCount };
    }

    // 必要：仍有进行中的项，或一项都没完成（计划刚建就试图结束）
    const essential = hasInProgress || doneCount === 0;
    return { essential, pending, hasInProgress, doneCount };
  };

  const WEB_PAGE_FILE_RE = /\.(?:html?|xhtml)(?:[?#]|$)/i;
  const NON_PAGE_ASSET_RE = /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|avif|mp4|webm|mp3|wav|pdf)(?:[?#]|$)/i;
  const BROWSER_AUTOMATION_SOURCE_RE = /(?:@playwright\/test|\bplaywright\b|\bpuppeteer\b|selenium-webdriver|\bchromium\.launch\s*\(|\bfirefox\.launch\s*\(|\bwebkit\.launch\s*\()/gi;

  K.isWebPagePreviewUrl = function (value) {
    let url = String(value || '').trim();
    if (!url) return false;
    try { url = decodeURIComponent(url); } catch { /* keep the original text */ }
    if (/^https?:\/\//i.test(url)) return !NON_PAGE_ASSET_RE.test(url);
    return WEB_PAGE_FILE_RE.test(url);
  };

  function restrictToBuiltinWebPreview(runCtx) {
    const plan = runCtx?.capabilityPlan;
    return !!(plan?.webPreview && !plan?.browserAutomation);
  }

  K.checkWebVerificationShellPolicy = function (command, runCtx) {
    const source = String(command || '');
    if (runCtx?.capabilityPlan?.desktop && /(?:start(?:-process)?|invoke-item|explorer(?:\.exe)?|shell:AppsFolder|msedge(?:\.exe)?|chrome(?:\.exe)?|firefox(?:\.exe)?|抖音|微信)/i.test(source)) {
      return {
        ok: false,
        code: 'DESKTOP_ROUTE_REQUIRED',
        error: '用户要求操作可见的 Windows 应用或系统浏览器时，不能用 Shell/PowerShell 启动或代替点击。请使用 Yan Computer Use：先观察窗口，再执行一个动作并重新观察。'
      };
    }
    if (!restrictToBuiltinWebPreview(runCtx)) return { ok: true };
    const automation = /@playwright\/test|\bplaywright\b|\bpuppeteer\b|selenium(?:-webdriver)?/i.test(source);
    const adHocServer = /\b(?:python|python3|py)(?:\.exe)?\s+-m\s+http\.server\b/i.test(source);
    const externalLaunch = /\b(?:start(?:-process)?|invoke-item|explorer(?:\.exe)?)\b[^\r\n;&|]*(?:\b(?:msedge|chrome|chromium)(?:\.exe)?\b|https?:\/\/|file:\/{2,3}|\.html?(?:["'\s]|$))/i.test(source);
    if (!automation && !adHocServer && !externalLaunch) return { ok: true };
    return {
      ok: false,
      code: 'WEB_PREVIEW_ROUTE_REQUIRED',
      error: '普通网页/小游戏验收必须使用 open_builtin_browser 打开实际 HTML 或 HTTP 页面。不要启动 Edge/Chrome、临时 HTTP 服务，也不要创建或运行 Playwright/Puppeteer/Selenium 自动化；只有用户明确要求 E2E 或浏览器自动化时才能使用这些方式。'
    };
  };

  K.checkWebAutomationWritePolicy = function (path, beforeContent, afterContent, runCtx) {
    if (!restrictToBuiltinWebPreview(runCtx)) return { ok: true };
    const count = value => (String(value || '').match(BROWSER_AUTOMATION_SOURCE_RE) || []).length;
    if (count(afterContent) <= count(beforeContent)) return { ok: true };
    return {
      ok: false,
      code: 'WEB_AUTOMATION_SCRIPT_NOT_REQUESTED',
      error: `普通网页验收不应创建浏览器自动化脚本（${path}）。请直接调用 open_builtin_browser 打开 HTML/HTTP 页面；用户明确要求 Playwright、E2E 或浏览器自动化时才可编写此类脚本。`
    };
  };

  K.checkCompletionGate = function (runCtx) {
    const as = runCtx.agentState;
    const criteria = as.acceptanceCriteria || [];
    let outcomeSatisfied = false;

    // 操作型任务（需要动文件/桌面/Git/浏览器）必须先用 todo_write 建立可验收计划，
    // 否则 gate 会放行空手完成的模型回复。trivial 对话的 plan.operational=false 不受影响。
    // 前提：todo_write 必须真正暴露给模型。仅看 capability plan 的 allowed 集合不够——
    // 当本轮 toolsForRun 被 phase 过滤或测试/子 agent 裁剪后不包含 todo_write 时，
    // 继续要求计划会把已成功的 MCP/桌面动作卡死在 completion gate。
    const exposed = runCtx?.exposedToolNames;
    const todoWriteAvailable = exposed instanceof Set
      ? exposed.has('todo_write')
      : !!runCtx?.capabilityPlan?.allowedToolNames?.has('todo_write');
    if (runCtx?.capabilityPlan?.operational && !as.todosFromTool && todoWriteAvailable) {
      return {
        ok: false,
        essential: true,
        hint: 'Completion gate: 本次任务被识别为操作型任务（需动文件/桌面/Git/浏览器），但还没有调用 todo_write 建立可验收计划。先用 todo_write 写明 outcome、acceptance_criteria 和 todos，再开始执行。'
      };
    }

    if (runCtx?.workMode === 'plan' && !runCtx?.planExecutionApproved) {
      runCtx.planOnly = true;
      return {
        ok: true,
        planOnly: true,
        outcomeSatisfied: false,
        evidenceCount: 0,
        pendingCount: as.todos.filter(todo => !todo.done).length
      };
    }

    if (runCtx?.workMode === 'goal' && runCtx?.workspaceRequestDenied) {
      return {
        ok: true,
        blocked: true,
        outcomeSatisfied: false,
        evidenceCount: 0,
        pendingCount: as.todos.filter(todo => !todo.done).length
      };
    }

    if (runCtx?.capabilityPlan?.webPreview && !runCtx?.builtinWebPageOpened) {
      return {
        ok: false,
        essential: true,
        hint: 'Web preview gate: 网页/小游戏还没有在 Yan Agent 内置浏览器中成功打开。请调用 open_builtin_browser 打开实际 HTML 文件或 HTTP(S) 页面；PNG/JPG 截图、外部 Edge/Chrome 与自动化脚本都不能替代这一步。'
      };
    }

    if (as.outcomeFromTool && criteria.length) {
      const remaining = criteria.filter(c => !['satisfied', 'skipped'].includes(c.status));
      const missingEvidence = criteria.filter(c =>
        ['satisfied', 'skipped'].includes(c.status) && !String(c.evidence || '').trim()
      );
      const ungrounded = criteria.filter(c =>
        ['satisfied', 'skipped'].includes(c.status)
        && String(c.evidence || '').trim()
        && !K.isEvidenceGrounded(c, runCtx)
      );
      if (remaining.length || missingEvidence.length || ungrounded.length) {
        const lines = [
          ...remaining.map(c => `[${c.status || 'pending'}] ${c.text}`),
          ...missingEvidence.map(c => `[missing_evidence] ${c.text}`),
          ...ungrounded.map(c => `[ungrounded_evidence] ${c.text} — evidence must cite a successful tool call id from this run (e.g. ${[...(runCtx?.evidenceLedger?.keys?.() || [])].slice(-1)[0] || 'call_…'}) or a verified path/command result`)
        ].join('\n');
        return {
          ok: false,
          essential: true,
          outcome: as.outcome,
          hint: 'Outcome gate: 目标尚未获得完整、可核对的验收证据。请继续执行，并用 todo_write 更新 acceptance_criteria；satisfied/skipped 的 evidence 必须引用本轮成功的 tool call id、真实文件路径或命令输出，禁止空口自证：\n' + lines
        };
      }

      outcomeSatisfied = true;
    }

    const { essential, pending } = K.classifyPendingTodos(runCtx);
    if (!pending.length) return {
      ok: true,
      outcomeSatisfied,
      evidenceCount: outcomeSatisfied ? criteria.length : 0
    };

    if (!essential) {
      if (deps().hooks?.deferPendingTodos) {
        deps().hooks.deferPendingTodos(runCtx, pending);
      }
      return {
        ok: true,
        outcomeSatisfied,
        evidenceCount: outcomeSatisfied ? criteria.length : 0,
        deferred: true,
        pendingCount: pending.length
      };
    }

    const lines = pending.map(t =>
      (t.inProgress ? '[in_progress] ' : '[pending] ') + t.text
    ).join('\n');
    return {
      ok: false,
      essential: true,
      hint: 'Completion gate: 以下必要任务尚未完成，请继续执行或更新 todo_write：\n' + lines
    };
  };
})(window.YanKernel);
