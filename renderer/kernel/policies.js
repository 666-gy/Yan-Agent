/* Yan Agent — kernel runtime policies (enforce, not prompt) */
(function (K) {
  'use strict';
  const deps = () => K._deps;

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
        error: 'Policy: read_file("' + filePath + '") required before editing this path.'
      };
    }
    return { ok: true };
  };

  /** 判断 pending todo 是否必须立即完成 */
  K.classifyPendingTodos = function (runCtx) {
    const as = runCtx.agentState;
    if (!as.todosFromTool || !as.todos.length) return { essential: false, pending: [] };
    const pending = as.todos.filter(t => !t.done);
    if (!pending.length) return { essential: false, pending: [] };

    const doneCount = as.todos.filter(t => t.done).length;
    const hasInProgress = pending.some(t => t.inProgress);

    // 必要：仍有进行中的项，或一项都没完成（计划刚建就试图结束）
    const essential = hasInProgress || doneCount === 0;
    return { essential, pending, hasInProgress, doneCount };
  };

  K.checkCompletionGate = function (runCtx) {
    const as = runCtx.agentState;
    const criteria = as.acceptanceCriteria || [];
    if (as.outcomeFromTool && criteria.length) {
      const remaining = criteria.filter(c => !['satisfied', 'skipped'].includes(c.status));
      const missingEvidence = criteria.filter(c =>
        ['satisfied', 'skipped'].includes(c.status) && !String(c.evidence || '').trim()
      );
      if (remaining.length || missingEvidence.length) {
        const lines = [
          ...remaining.map(c => `[${c.status || 'pending'}] ${c.text}`),
          ...missingEvidence.map(c => `[missing_evidence] ${c.text}`)
        ].join('\n');
        return {
          ok: false,
          essential: true,
          outcome: as.outcome,
          hint: 'Outcome gate: 目标尚未获得完整验收证据。请继续执行，并用 todo_write 更新完整的 acceptance_criteria；只有工具结果、实际产物或用户明确要求跳过验证才能作为 evidence：\n' + lines
        };
      }

      const pendingTodos = (as.todos || []).filter(t => !t.done);
      if (pendingTodos.length && deps().hooks?.deferPendingTodos) {
        deps().hooks.deferPendingTodos(runCtx, pendingTodos);
      }
      return {
        ok: true,
        outcomeSatisfied: true,
        evidenceCount: criteria.length,
        deferred: pendingTodos.length > 0,
        pendingCount: pendingTodos.length
      };
    }

    const { essential, pending } = K.classifyPendingTodos(runCtx);
    if (!pending.length) return { ok: true };

    if (!essential) {
      if (deps().hooks?.deferPendingTodos) {
        deps().hooks.deferPendingTodos(runCtx, pending);
      }
      return { ok: true, deferred: true, pendingCount: pending.length };
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
