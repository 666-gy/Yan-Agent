'use strict';

const crypto = require('crypto');
const { tokenize: tokenizeMemoryText } = require('../long-term-memory');
const { derivePolicyControls, policyId } = require('../behavior-policy');

function createHarnessPolicy({ continualHarness, configStore }) {
  function harnessEntryId(prefix, value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 90);
    if (normalized) return `${prefix}-${normalized}`.slice(0, 100);
    return `${prefix}-${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16)}`;
  }

  async function persistExplicitUserPolicy({ instructions, scope = 'global', workspace = '', runId = '', sessionId = '', source = 'agent_refine', recoveredFrom = '' } = {}) {
    if (configStore.loadConfig().memory?.enabled === false) return { ok: false, error: '记忆已关闭' };
    const content = String(instructions || '').replace(/\r\n?/g, '\n').trim().slice(0, 6_000);
    if (!content) return { ok: false, error: 'Explicit policy is empty.' };
    const normalizedScope = scope === 'workspace' && workspace ? 'workspace' : 'global';
    const state = continualHarness.load({ scope: normalizedScope, workspace });
    const id = harnessEntryId('prompt', policyId(content).replace(/^user-policy-/u, ''));
    const existing = state.entries.prompt[id];
    if (existing?.metadata?.status === 'active' && existing.content === content) {
      return { ok: true, skipped: true, refinement: null, revision: state.revision };
    }
    const result = await continualHarness.apply({
      id: `policy-${crypto.createHash('sha256').update(`${normalizedScope}:${content}`).digest('hex').slice(0, 16)}`,
      trigger: `Explicit user policy: ${content}`,
      evidence: 'The user explicitly requested this durable behavior policy.',
      expectedOutcome: 'Make the explicit user policy active for every relevant future task.',
      edits: [{
        action: existing ? 'update' : 'create',
        kind: 'prompt',
        id,
        title: 'Explicit user policy',
        content,
        path: 'user-policy',
        scope: normalizedScope,
        metadata: {
          status: 'active',
          enforcement: 'mandatory',
          basis: 'explicit_user_statement',
          controls: derivePolicyControls(content),
          ...(recoveredFrom ? { recoveredFrom } : {})
        },
        reason: 'Explicit user instruction is the evidence for this active policy.'
      }]
    }, {
      scope: normalizedScope,
      workspace,
      expectedRevision: state.revision,
      baselineState: state,
      runId,
      sessionId,
      source
    });
    const applied = result.ok && (result.refinement?.appliedEdits || [])
      .some(edit => edit.applied === true && edit.kind === 'prompt' && edit.id === id);
    if (applied) {
      await continualHarness.recordOutcome(result.refinement.id, {
        status: 'partial',
        evidence: 'The explicit user policy was persisted and activated before reviewer output was considered.'
      }, { scope: normalizedScope, workspace });
    }
    if (applied) return result;
    // Another task or the stable Harness MCP may have activated the same rule
    // while this task waited for the state lock. Treat the durable end state as
    // success instead of reporting a stale-revision failure.
    const concurrent = continualHarness.get('prompt', id, { scope: normalizedScope, workspace });
    if (concurrent?.metadata?.status === 'active' && concurrent.content === content) {
      return { ok: true, skipped: true, concurrent: true, refinement: null, revision: result.revision };
    }
    return { ...result, ok: false, error: result.error || 'Explicit policy failed the Harness safety validation.' };
  }

  function harnessCandidateSimilarity(left, right) {
    const leftTokens = new Set(tokenizeMemoryText(left));
    const rightTokens = new Set(tokenizeMemoryText(right));
    if (!leftTokens.size || !rightTokens.size) return 0;
    let shared = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) shared += 1;
    }
    return shared / Math.max(leftTokens.size, rightTokens.size);
  }

  async function applyReviewedHarnessState(review, payload = {}) {
    if (configStore.loadConfig().memory?.enabled === false) return [];
    const byScope = new Map();
    const add = (scope, item) => {
      const normalizedScope = scope === 'workspace' && payload.workspace ? 'workspace' : 'global';
      if (!byScope.has(normalizedScope)) byScope.set(normalizedScope, { edits: [], memories: [], observing: false });
      const group = byScope.get(normalizedScope);
      group.edits.push(item.edit);
      if (item.memory) group.memories.push({ id: item.edit.id, record: item.memory });
      if (item.observing) group.observing = true;
    };

    for (const memory of Array.isArray(review?.memories) ? review.memories : []) {
      const scope = memory.scope === 'workspace' && payload.workspace ? 'workspace' : 'global';
      const state = continualHarness.load({ scope, workspace: payload.workspace });
      const id = harnessEntryId('memory', memory.key || memory.content);
      add(scope, {
        memory,
        edit: {
          action: state.entries.memory[id] ? 'update' : 'create',
          kind: 'memory',
          id,
          title: String(memory.key || memory.type || 'Durable memory'),
          content: memory.content,
          path: memory.type || 'general',
          scope,
          metadata: {
            status: 'active',
            key: memory.key,
            type: memory.type,
            confidence: memory.confidence,
            basis: memory.basis,
            verified: memory.verified === true,
            ...(memory.type === 'preference' && memory.basis === 'explicit_user_statement'
              ? { enforcement: 'mandatory', controls: derivePolicyControls(memory.content) }
              : {})
          },
          reason: memory.evidence
        }
      });
    }

    for (const candidate of Array.isArray(review?.harnessCandidates) ? review.harnessCandidates : []) {
      const scope = candidate.scope === 'workspace' && payload.workspace ? 'workspace' : 'global';
      const state = continualHarness.load({ scope, workspace: payload.workspace });
      const id = harnessEntryId(candidate.kind, candidate.id || candidate.title);
      const existing = state.entries[candidate.kind]?.[id];
      const compatible = !existing || harnessCandidateSimilarity(existing.content, candidate.content) >= 0.55;
      if (existing?.metadata?.status === 'active' && !compatible) continue;
      // Agent-requested refinements (the model relaying an explicit user
      // instruction such as "prefer AnySearch from now on") activate
      // immediately: the user is the evidence. Background-mined candidates
      // keep the two-independent-verified-runs gate, which would otherwise
      // deadlock - an observing entry is invisible to promptContext, so it can
      // never gather the second run's evidence on its own.
      const agentRequested = !!payload.refineInstructions;
      const evidenceRuns = [...new Set([
        ...(compatible && Array.isArray(existing?.metadata?.evidenceRuns) ? existing.metadata.evidenceRuns : []),
        String(payload.runId || '')
      ].filter(Boolean))].slice(-20);
      const successfulRuns = [...new Set([
        ...(compatible && Array.isArray(existing?.metadata?.successfulRuns) ? existing.metadata.successfulRuns : []),
        ...(payload.verifiedSuccess ? [String(payload.runId || '')] : [])
      ].filter(Boolean))].slice(-20);
      const active = agentRequested || successfulRuns.length >= 2;
      add(scope, {
        observing: !active,
        edit: {
          action: existing ? 'update' : 'create',
          kind: candidate.kind,
          id,
          title: candidate.title,
          content: candidate.content,
          path: candidate.path || 'general',
          scope,
          metadata: {
            status: active ? 'active' : 'observing',
            enforcement: agentRequested ? 'mandatory' : 'advisory',
            controls: derivePolicyControls(candidate.content),
            evidenceRuns,
            successfulRuns,
            evidenceCount: evidenceRuns.length,
            successCount: successfulRuns.length
          },
          reason: candidate.evidence
        }
      });
    }

    const results = [];
    for (const [scope, group] of byScope) {
      if (!group.edits.length) continue;
      const baselineState = payload.harnessBaselines?.[scope];
      const result = await continualHarness.apply({
        trigger: payload.refineInstructions
          ? `Agent-requested refinement: ${payload.refineInstructions}`
          : 'Background review found durable reusable evidence.',
        evidence: group.edits.map(edit => edit.reason).filter(Boolean).join('\n').slice(0, 2_000),
        expectedOutcome: group.observing
          ? 'Retain first observations without activating them until an independent successful run reinforces the same entry.'
          : 'Make verified durable evidence available to relevant future tasks.',
        edits: group.edits
      }, {
        scope,
        workspace: payload.workspace,
        expectedRevision: baselineState?.revision,
        baselineState,
        runId: payload.runId,
        sessionId: payload.sessionId,
        source: payload.refineInstructions ? 'agent_refine' : 'background_review'
      });
      if (result.ok) {
        await continualHarness.recordOutcome(result.refinement.id, {
          status: 'partial',
          evidence: group.observing
            ? 'Candidate is isolated in observing state pending a second distinct evidence run.'
            : 'Evidence passed the storage gate; behavioral improvement remains pending a later task outcome.'
        }, { scope, workspace: payload.workspace });
      }
      const appliedIds = new Set((result.refinement?.appliedEdits || [])
        .filter(edit => edit.applied)
        .map(edit => edit.id));
      results.push({
        scope,
        result,
        memories: result.ok
          ? group.memories.filter(item => appliedIds.has(item.id)).map(item => item.record)
          : []
      });
    }
    return results;
  }

  async function recordReviewedRefinementOutcomes(review, workspace) {
    const outcomes = [];
    for (const outcome of Array.isArray(review?.refinementOutcomes) ? review.refinementOutcomes : []) {
      const scopes = workspace ? ['workspace', 'global'] : ['global'];
      for (const scope of scopes) {
        const state = continualHarness.load({ scope, workspace });
        if (!state.refinements.some(item => item.id === outcome.refinementId)) continue;
        outcomes.push(await continualHarness.recordOutcome(outcome.refinementId, outcome, { scope, workspace }));
        break;
      }
    }
    return outcomes;
  }

  return { harnessEntryId, persistExplicitUserPolicy, harnessCandidateSimilarity, applyReviewedHarnessState, recordReviewedRefinementOutcomes };
}

module.exports = { createHarnessPolicy };
