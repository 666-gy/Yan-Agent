/* Machine-readable delegation plan marker for task prompts, shared by the
   sidecar, tests, and the renderer workflow renderer (UMD, no deps).

   A task prompt may carry a single marker line:

     yan-plan: {"id":"auth","dependsOn":["db"],"acceptance":"login flow passes"}

   The parent agent emits it (documented in subagentSystem guidance); the
   sidecar parses it when a task part appears to build the delegation DAG and
   per-task acceptance criteria. The renderer parses the same line so saved
   sessions stay self-describing. */

'use strict';

const MAX_PLAN_ID_CHARS = 64;
const MAX_ACCEPTANCE_CHARS = 400;
const MAX_DEPENDENCIES = 8;
const MARKER_RE = /^\s*yan-plan:\s*(\{.*\})\s*$/;

function cleanString(value, maxChars) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
}

function parsePlanMarker(prompt) {
  const input = String(prompt || '');
  if (!input) return null;
  for (const line of input.split(/\r?\n/)) {
    const match = line.match(MARKER_RE);
    if (!match) continue;
    let raw;
    try { raw = JSON.parse(match[1]); } catch { return null; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.id !== 'string') return null;
    const id = cleanString(raw.id, MAX_PLAN_ID_CHARS);
    if (!id) return null;
    const dependsOn = (Array.isArray(raw.dependsOn) ? raw.dependsOn : [])
      .filter(item => typeof item === 'string')
      .map(item => cleanString(item, MAX_PLAN_ID_CHARS))
      .filter(Boolean)
      .slice(0, MAX_DEPENDENCIES);
    const acceptance = cleanString(raw.acceptance, MAX_ACCEPTANCE_CHARS);
    return { id, dependsOn, acceptance };
  }
  return null;
}

function formatPlanMarker(plan = {}) {
  const id = cleanString(plan.id, MAX_PLAN_ID_CHARS);
  if (!id) return '';
  const payload = { id };
  const dependsOn = (Array.isArray(plan.dependsOn) ? plan.dependsOn : [])
    .map(item => cleanString(item, MAX_PLAN_ID_CHARS))
    .filter(Boolean)
    .slice(0, MAX_DEPENDENCIES);
  if (dependsOn.length) payload.dependsOn = dependsOn;
  const acceptance = cleanString(plan.acceptance, MAX_ACCEPTANCE_CHARS);
  if (acceptance) payload.acceptance = acceptance;
  return `yan-plan: ${JSON.stringify(payload)}`;
}

// Validates a set of parsed plan entries (one per delegated task) and returns
// a dependency-safe execution order. Unknown dependencies, duplicate ids, and
// cycles are reported instead of throwing so the caller can surface them.
function validatePlanGraph(entries = []) {
  const plans = (Array.isArray(entries) ? entries : []).filter(entry => entry && entry.id);
  const errors = [];
  const byId = new Map();
  for (const plan of plans) {
    if (byId.has(plan.id)) errors.push(`duplicate plan id: ${plan.id}`);
    else byId.set(plan.id, plan);
  }
  for (const plan of byId.values()) {
    for (const dependency of plan.dependsOn || []) {
      if (!byId.has(dependency)) errors.push(`${plan.id} depends on unknown task: ${dependency}`);
    }
  }
  const order = [];
  const visiting = new Set();
  const done = new Set();
  const visit = plan => {
    if (done.has(plan.id) || errors.length) return;
    if (visiting.has(plan.id)) {
      errors.push(`dependency cycle at: ${plan.id}`);
      return;
    }
    visiting.add(plan.id);
    for (const dependency of plan.dependsOn || []) {
      const target = byId.get(dependency);
      if (target) visit(target);
    }
    visiting.delete(plan.id);
    done.add(plan.id);
    order.push(plan.id);
  };
  for (const plan of byId.values()) visit(plan);
  return { ok: errors.length === 0, errors, order };
}

module.exports = { parsePlanMarker, formatPlanMarker, validatePlanGraph };
