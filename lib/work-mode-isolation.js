'use strict';

function evolutionEnabled(request = {}) {
  return (typeof request.memoryEnabled === 'boolean' ? request.memoryEnabled : request.workMode === 'evolution') && !request.utility && !request.skillOnly;
}
function isolateWorkMode(request = {}) {
  const result = { ...request };
  if (!['normal', 'plan', 'goal', 'evolution'].includes(result.workMode)) result.workMode = 'normal';
  // Discard retired experimental fields from saved requests.
  for (const key of ['reasoningSidepath', 'sidepathState', 'artifactAuditState', 'escalation',
    'longHorizonContext', 'experienceEdgeContext', 'topologyVariantId']) delete result[key];
  if (!evolutionEnabled(result)) {
    result.harnessContext = '';
    result.behaviorPolicies = [];
  }
  return result;
}
function sessionModeMatches(session, request) {
  // Recreate older kernel sessions once to drop retired experimental prompts.
  return session?.metadata?.yanModeIsolation === 2
    && session.metadata.yanWorkMode === String(request.workMode || 'normal')
    && session.metadata.yanMemoryEnabled === request.memoryEnabled
    && String(session.metadata.yanInstructions || '') === String(request.customInstructions || '');
}
module.exports = { evolutionEnabled, isolateWorkMode, sessionModeMatches };
