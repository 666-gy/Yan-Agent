'use strict';

const { BUILDER_SHELL_RULES, shellAllowPrefixes } = require('../shell-allowlist');

// Mirrors lib/shell-allowlist.js BUILDER_SHELL_RULES as bare prefixes for
// pre-validating builder bash permission requests.
const BUILDER_ALLOWED_SHELL_PREFIXES = shellAllowPrefixes(BUILDER_SHELL_RULES);

const SUBAGENT_ROLE_IDS = Object.freeze(['explorer', 'reviewer', 'researcher', 'tester', 'builder', 'mapper', 'tracer', 'reverser']);
const SUBAGENT_ROLE_LABELS = Object.freeze({ explorer: 'Sub Explore Agent', reviewer: 'Sub Review Agent', researcher: 'Sub Research Agent', tester: 'Sub Test Agent', builder: 'Sub Build Agent', mapper: 'Sub Mapper Agent', tracer: 'Sub Tracer Agent', reverser: 'Sub Reverser Agent' });
const SUB_BUILD_MAX_SLOTS = 3;
class SubBuildSlotPool {
  constructor(maxSlots = SUB_BUILD_MAX_SLOTS) {
    this.maxSlots = Math.max(1, Math.min(SUB_BUILD_MAX_SLOTS, Number(maxSlots) || SUB_BUILD_MAX_SLOTS));
    this.claims = new Map();
  }

  acquire(runId, requestId = '') {
    const owner = String(runId || '').trim();
    const request = String(requestId || '').trim();
    if (!owner || !request) {
      return { granted: false, used: this.claims.size, limit: this.maxSlots, reason: 'missing-request' };
    }
    const key = `${owner}:${request}`;
    const existing = this.claims.get(key);
    if (existing) return { granted: true, used: this.claims.size, limit: this.maxSlots, claim: existing };
    if (this.claims.size >= this.maxSlots) {
      return { granted: false, used: this.claims.size, limit: this.maxSlots, reason: 'busy' };
    }
    const claim = { key, runId: owner, requestId: request, callId: '' };
    this.claims.set(key, claim);
    return { granted: true, used: this.claims.size, limit: this.maxSlots, claim };
  }

  bindCall(runId, requestId, callId) {
    const key = `${String(runId || '').trim()}:${String(requestId || '').trim()}`;
    const claim = this.claims.get(key);
    if (!claim) return false;
    claim.callId = String(callId || '').trim();
    return true;
  }

  release(runId, { requestId = '', callId = '' } = {}) {
    const owner = String(runId || '').trim();
    const request = String(requestId || '').trim();
    const call = String(callId || '').trim();
    for (const [key, claim] of this.claims) {
      if (claim.runId !== owner) continue;
      if (request && claim.requestId !== request) continue;
      if (call && claim.callId !== call) continue;
      this.claims.delete(key);
      return true;
    }
    return false;
  }

  releaseRun(runId) {
    const owner = String(runId || '').trim();
    for (const [key, claim] of this.claims) {
      if (claim.runId === owner) this.claims.delete(key);
    }
  }

  status() {
    return { activeSlots: this.claims.size, maxSlots: this.maxSlots };
  }
}

function normalizeSubagentRoles(value = {}) {
  // Built-in roles are always available. Per-turn selection controls focus,
  // while the model may still delegate to any role unless the user forbids it.
  return Object.fromEntries(SUBAGENT_ROLE_IDS.map(role => [role, true]));
}

function normalizedSubagentRole(value) {
  return String(value || '').trim().toLowerCase();
}

function subagentRoleFromPermission(properties = {}) {
  return normalizedSubagentRole(
    properties.metadata?.subagent_type
      || properties.metadata?.subagentType
      || properties.subagent_type
      || properties.subagentType
      || properties.agent
      || properties.patterns?.find?.(pattern => SUBAGENT_ROLE_IDS.includes(normalizedSubagentRole(pattern)))
  );
}

function subagentRoleFromTaskPart(part = {}) {
  const input = part.state?.input && typeof part.state.input === 'object' ? part.state.input : {};
  return normalizedSubagentRole(
    input.subagent_type
      || input.subagentType
      || input.agent
      || part.agent
      || part.role
  );
}

function builderPermissionRequestAllowed(properties = {}, canWrite = true) {
  const permission = String(properties.permission || properties.action || '').trim().toLowerCase();
  if (['edit', 'write', 'apply_patch'].includes(permission)) return canWrite !== false;
  if (['read', 'glob', 'grep', 'list', 'lsp', 'todowrite'].includes(permission)) {
    return true;
  }
  if (permission !== 'bash') return false;
  const patterns = Array.isArray(properties.patterns) ? properties.patterns : [];
  if (!patterns.length) return false;
  const allowedPrefixes = BUILDER_ALLOWED_SHELL_PREFIXES;
  return patterns.every(pattern => {
    const command = String(pattern || '').trim();
    return allowedPrefixes.some(prefix => command === prefix.trim() || command.startsWith(prefix));
  });
}


module.exports = { SUBAGENT_ROLE_IDS, SUBAGENT_ROLE_LABELS, SUB_BUILD_MAX_SLOTS, SubBuildSlotPool, normalizeSubagentRoles, normalizedSubagentRole, subagentRoleFromPermission, subagentRoleFromTaskPart, builderPermissionRequestAllowed, parsePlanMarker: require('./plan').parsePlanMarker, formatPlanMarker: require('./plan').formatPlanMarker, validatePlanGraph: require('./plan').validatePlanGraph };
