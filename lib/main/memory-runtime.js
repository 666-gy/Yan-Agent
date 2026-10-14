'use strict';

// Long-term memory runtime (plan T3.4): selective memory writes plus the
// post-run memory review. Moved verbatim from main.js; the harness hooks it
// coordinates arrive through explicit dependencies.

const {
  DEFAULT_INPUT_TOKENS_PER_SECOND,
  normalizeInputTokensPerSecond
} = require('../opencode-sidecar');

// The reviewer's real output is projected back into each controlled
// application's experience document, so the settings page and the run footnote
// show the same genuine review that entered the Harness — never a fixed shell.
function projectComputerControlExperience(request, review, dataDir) {
  try {
    const apps = Array.isArray(request?.apps) ? request.apps.filter(app => app?.path) : [];
    if (!apps.length || !dataDir) return;
    const { createComputerControlStore } = require('../computer-control-store');
    const store = createComputerControlStore(dataDir);
    let memories = Array.isArray(review?.memories) ? review.memories.filter(memory => String(memory?.content || '').trim()) : [];
    if (apps.length === 1) {
      const target = apps[0];
      const otherApps = store.list().filter(app => app.path.toLowerCase() !== target.path.toLowerCase());
      memories = memories.filter(memory => {
        const content = String(memory.content).toLowerCase();
        const namesTarget = content.includes(target.path.toLowerCase()) || (target.name && content.includes(target.name.toLowerCase()));
        return namesTarget || !otherApps.some(app => content.includes(app.path.toLowerCase())
          || (app.name && content.includes(app.name.toLowerCase())));
      });
    }
    const lines = ['## 本次电脑操控复盘', ''];
    if (request.runId) lines.push(`来源任务：${request.runId}`, '');
    lines.push('### 适用场景', '', apps.map(app => `${app.name}（${app.path}）`).join('；'), '');
    const observations = String(request?.instructions || '').trim();
    // Successful refinement writes the distilled experience, not the reviewer
    // prompt and the entire action trace again on every run.
    if (!memories.length && observations) {
      if (request.source === 'computer_control') {
        for (const app of apps) store.recordPendingReview(app.path, request, app.name);
        return;
      }
      lines.push('### 待验证经验', '', observations, '');
    }
    if (memories.length) {
      lines.push('### 可复用经验');
      for (const memory of memories) {
        const content = String(memory?.content || '').trim();
        if (content) lines.push(content, '');
        if (memory.evidence) lines.push(`验证依据：${String(memory.evidence).trim()}`, '');
      }
      lines.push('');
    }
    const markdown = lines.join('\n').trim();
    if (!markdown) return;
    for (const app of apps) {
      if (apps.length > 1) {
        const relevant = memories.filter(memory => String(memory.content).includes(app.path)
          || (app.name && String(memory.content).includes(app.name)));
        if (relevant.length) projectComputerControlExperience({ ...request, apps: [app] }, { memories: relevant }, dataDir);
        else store.recordPendingReview(app.path, request, app.name);
        continue;
      }
      try { store.recordReview(app.path, markdown, app.name); } catch { /* a deleted app record is skipped */ }
    }
  } catch (error) {
    console.warn('[harness] computer-control experience projection failed:', error?.message || error);
  }
}

function registerMemoryRuntime(deps) {
  const {
    longTermMemory,

    consumeHarnessRefinementRequest,
    continualHarness,
    rollbackHarnessProjection,
    extractExplicitPolicyInstruction,
    persistExplicitUserPolicy,
    applyReviewedHarnessState,
    recordReviewedRefinementOutcomes,
    recordLearningReview,
    attributeHarnessUsage,
    loadConfig,
    dataDir,

  } = deps;

  let reviewing = 0;

  function addMemoryRecord(record = {}, options = {}) {
    if (loadConfig().memory?.enabled === false) return { ok: false, error: '记忆已关闭' };
    const workspace = String(options.workspace || record.workspace || '').trim();
    const defaultScope = record.scope || (workspace ? 'workspace' : 'global');
    const result = longTermMemory.upsert(record, {
      workspace,
      defaultScope,
      sourceKind: options.sourceKind || record.sourceKind,
      sessionId: options.sessionId || record.sessionId,
      runId: options.runId || record.runId,
      refinementId: options.refinementId || record.refinementId
    });
    return result;
  }

  async function reviewCompletedRunMemory({
    sidecar,
    selection,
    request,
    result,
    prompt,
    workspace,
    yanSessionId,
    runId,
    harnessBaselines,
    evolutionMode = false
  }) {
    if (loadConfig().memory?.enabled === false) return;
    // Consume the pending refinement synchronously, before the run's finally
    // removes the file, so an app-queued computer-control review is not lost.
    const refineRequest = consumeHarnessRefinementRequest(runId);
    const { computerControlReviewRequest, controlledAppsFromCalls } = require('../computer-control-review');
    const { recentControlContext, namedControlApps } = require('../computer-control-context');
    // A model-scheduled refinement must not suppress the host's control review.
    const controlRequest = refineRequest?.source === 'computer_control' ? refineRequest
      : computerControlReviewRequest({ runId, sessionId: yanSessionId, workspace,
        toolCalls: result?.toolCalls, result, controlReleased: true });
    const computerControlReview = !!controlRequest;
    const currentApps = controlledAppsFromCalls(result?.toolCalls || []);
    const contextApps = currentApps.length ? currentApps
      : recentControlContext(dataDir, yanSessionId, runId).apps;
    const explicitApps = refineRequest?.action === 'refine' && refineRequest.source !== 'computer_control'
      ? namedControlApps(refineRequest.instructions, contextApps) : [];
    if (!evolutionMode && !computerControlReview && !explicitApps.length) return;
    let controlProjected = false;
    reviewing++;
    try {
      if (refineRequest?.action === 'rollback') {
        const targetState = continualHarness.load({ scope: refineRequest.scope, workspace });
        const target = targetState.refinements.find(item => item.id === refineRequest.rollbackId);
        const rollback = await continualHarness.rollback(refineRequest.rollbackId, {
          scope: refineRequest.scope,
          workspace,
          source: 'explicit_user_rollback',
          evidence: refineRequest.instructions
        });
        if (rollback.ok) rollbackHarnessProjection(target, workspace);
        if (!rollback.ok) console.warn(`[harness] rollback ${refineRequest.rollbackId} failed: ${rollback.error}`);
        return;
      }
      // Persist an explicit user policy before consulting the isolated reviewer.
      // Reviewer output is enrichment only; a provider/schema failure must never
      // be able to erase or postpone a rule the user explicitly requested.
      const explicitPolicy = evolutionMode && refineRequest?.source !== 'computer_control'
        ? (refineRequest?.action === 'refine'
          ? { text: refineRequest.instructions, source: 'scheduled_refinement' }
          : extractExplicitPolicyInstruction({ prompt, history: request.history }))
        : null;
      let directPolicyResult = null;
      if (evolutionMode && explicitPolicy?.text) {
        const policyScope = refineRequest?.scope === 'workspace' && workspace ? 'workspace' : 'global';
        directPolicyResult = await persistExplicitUserPolicy({
          instructions: explicitPolicy.text,
          scope: policyScope,
          workspace,
          runId,
          sessionId: yanSessionId,
          source: refineRequest ? 'agent_refine' : 'explicit_user_policy'
        });
        if (!directPolicyResult.ok) {
          console.warn(`[harness] explicit policy was not activated for run ${runId}: ${directPolicyResult.error}`);
        }
      }
      // Model-scheduled app experience uses the explicit refinement path.
      // Project only instructions naming an app actually operated in this run,
      // after persistence succeeds, independently of the optional reviewer.
      if (directPolicyResult?.ok && refineRequest?.action === 'refine') {
        const instructions = String(refineRequest.instructions || '');
        if (explicitApps.length) projectComputerControlExperience({ apps: explicitApps, instructions }, {}, dataDir);
      }
      // Local app experience is independent of the optional global evolution mode.
      if (!evolutionMode && explicitApps.length) {
        projectComputerControlExperience({ apps: explicitApps, instructions: refineRequest.instructions }, {}, dataDir);
      }
      const cfg = loadConfig();
      const review = await sidecar.reviewMemory({
        providerId: selection.providerId,
        modelId: selection.modelId,
        inputTokensPerSecond: Math.max(DEFAULT_INPUT_TOKENS_PER_SECOND, normalizeInputTokensPerSecond(
          cfg.api?.inputTokensPerSecond || cfg.agent?.inputTokensPerSecond
        )),
        workspace,
        sessionId: yanSessionId,
        runId,
        prompt,
        history: request.history,
        result,
        hostControlReview: computerControlReview || explicitApps.length > 0,
        refineInstructions: [refineRequest?.instructions, controlRequest !== refineRequest ? controlRequest?.instructions : ''].filter(Boolean).join('\n\n'),
        harnessOverview: evolutionMode ? continualHarness.overview({ workspace, query: prompt }) : '',
        userRequestedFinish: result?.userRequestedFinish === true
      });
      if (loadConfig().memory?.enabled === false) return;
      // The direct policy above is the authoritative representation of an
      // explicit user instruction. Do not create a second competing candidate
      // from the reviewer for the same request.
      const reviewForHarness = explicitPolicy?.text
        ? { ...review, harnessCandidates: [] }
        : review;
      const harnessResults = (evolutionMode || computerControlReview)
        ? await applyReviewedHarnessState(reviewForHarness, {
          workspace,
          sessionId: yanSessionId,
          runId,
          harnessBaselines,
          // A computer-control review carries observations, not a user rule:
          // never force its candidates active as if the user ordered them.
          refineInstructions: computerControlReview ? '' : (refineRequest?.instructions || ''),
          verifiedSuccess: result?.status === 'done'
            && (Array.isArray(result?.todos) ? result.todos : []).every(todo => todo?.done === true)
        })
        : [];
      if (evolutionMode) await recordReviewedRefinementOutcomes(review, workspace);
      const memoryResults = (evolutionMode || computerControlReview)
        ? harnessResults.flatMap(item => item.memories.map(({ record }) => addMemoryRecord(record, {
          workspace,
          sourceKind: computerControlReview
            ? 'computer_control_review'
            : (refineRequest ? 'agent_refine' : 'background_review'),
          sessionId: yanSessionId,
          runId,
          refinementId: item.result?.refinement?.id
        })))
        : (Array.isArray(review?.memories) ? review.memories.map(memory => addMemoryRecord(memory, {
          workspace,
          sourceKind: 'background_review',
          sessionId: yanSessionId,
          runId
        })) : []);
      // Continuity card: one superseding record per workspace so a new task in
      // the same workspace starts from where this run stopped.
      if (review?.workState && workspace) {
        const workStateResult = addMemoryRecord({
          key: 'work.state.current',
          type: 'work_state',
          scope: 'workspace',
          content: review.workState.content,
          confidence: 0.9,
          evidence: review.workState.evidence,
          basis: 'project_artifact',
          verified: true,
          durable: true,
          sensitive: false,
          transient: false
        }, { workspace, sourceKind: 'work_state', sessionId: yanSessionId, runId });
        if (!workStateResult?.ok) {
          console.warn(`[memory] work state was not stored for run ${runId}: ${workStateResult?.error || 'unknown error'}`);
        }
      }
      if (evolutionMode && review?.skillCandidate) {
        await recordLearningReview({
          sidecar,
          skillCandidate: review.skillCandidate,
          verified: result?.status === 'done'
            && (Array.isArray(result?.todos) ? result.todos : []).every(todo => todo?.done === true),
          toolCallCount: Array.isArray(result?.toolCalls) ? result.toolCalls.length : 0,
          workspace,
          sessionId: yanSessionId,
          runId,
          harnessBaseline: harnessBaselines?.[workspace ? 'workspace' : 'global']
        });
      }
      if (computerControlReview && !review?.error) {
        projectComputerControlExperience(controlRequest, review, dataDir);
        controlProjected = true;
      }
      // Result attribution runs after the reviewer's edits on purpose: usage
      // bookkeeping changes the entry fingerprint, and doing it first would trip
      // the revision-conflict check for any entry the same review is updating.
      // Attribution itself only needs the run's verified outcome, not the
      // reviewer, so its own failure never blocks the rest of the pipeline.
      if (evolutionMode) {
        try {
          await attributeHarnessUsage({ runId, workspace, sessionId: yanSessionId, result });
        } catch (error) {
          console.warn(`[harness] usage attribution failed for run ${runId}:`, error?.message || error);
        }
      }
      const stored = memoryResults.filter(item => item?.ok).length;
      if (stored > 0) console.log(`[memory] stored ${stored} durable record(s) from run ${runId}`);
      if (review?.error) console.warn(`[memory] review skipped for run ${runId}: ${review.error}`);
    } catch (error) {
      console.warn(`[memory] non-fatal review failure for run ${runId}:`, error?.message || error);
    } finally {
      // Failed reviews stay in a separate pending artifact, never the experience page.
      if (controlRequest && !controlProjected && loadConfig().memory?.enabled !== false) {
        projectComputerControlExperience(controlRequest, {}, dataDir);
      }
      reviewing--;
    }
  }

  return { addMemoryRecord, reviewCompletedRunMemory, isReviewing: () => reviewing > 0 };
}

module.exports = { registerMemoryRuntime };
