'use strict';

// AGI reasoning side-path (v2). The runtime no longer guesses the task type
// from wording: the trigger is structural (the first file mutation), and all
// semantic judgement lives in a model-authored brief whose structure the
// runtime validates. Budgets are declared by the model's chosen mode and only
// clamped by runtime ceilings.

const { clip } = require('./contracts');

const SIDEPATH_TAG = 'yan-reasoning-sidepath';
const SIDEPATH_OPEN = `<${SIDEPATH_TAG}>`;
const SIDEPATH_CLOSE = `</${SIDEPATH_TAG}>`;
const MUTATION_PERMISSIONS = Object.freeze(['edit', 'write', 'apply_patch']);
const SIDEPATH_MODES = Object.freeze(['direct', 'structured', 'exploratory']);
const DELIVERABLE_KINDS = Object.freeze(['visual', 'code', 'doc', 'data', 'other']);
// A visual deliverable must plan these dimensions before any file exists; the
// runtime later measures the produced artifact for each of them.
const VISUAL_REQUIRED_FIELDS = Object.freeze(['world', 'moment', 'interaction', 'accessibility', 'responsive']);

// Standing semantic rule, not a detector: it defines what system terms mean so
// the model never turns them into artwork themes or decorative copy.
const SYSTEM_VOCABULARY_RULE = [
  'Yan 系统词表：用户提到 AGI、自进化、侧路、Harness、记忆、技能、评测、验收等，指 Yan 自身的能力与机制。',
  '除非用户明确要求把它们作为作品内容，否则不得把这些词变成作品主题、装饰、路牌、文案或界面标签。',
  '如果用户的话可以同时理解为“对系统能力的要求”和“对作品内容的要求”，必须按前者处理，并把歧义写进侧路简报的 ambiguities。'
].join('\n');

const REASONING_METHODS = Object.freeze([
  { id: 'abstract', label: '抽象' },
  { id: 'decompose', label: '分解' },
  { id: 'analogy', label: '类比' },
  { id: 'relations', label: '关系建模' },
  { id: 'constraints', label: '约束检查' },
  { id: 'comparison', label: '方案比较' },
  { id: 'counterexample', label: '反例搜索' },
  { id: 'experiment', label: '实验设计' }
]);
const METHOD_IDS = Object.freeze(REASONING_METHODS.map(item => item.id));

// A declared reasoning method must have actually produced something in the
// brief: methods are operations the model executes while thinking, not tags.
// Methods without a dedicated artifact field (analogy, counterexample) stay
// declarable but carry no field requirement.
const METHOD_ARTIFACT_FIELD = Object.freeze({
  abstract: 'understanding',
  decompose: 'task',
  relations: 'relations',
  constraints: 'constraints',
  comparison: 'candidates',
  experiment: 'verification'
});

const FILLER_TERMS = Object.freeze(['精美', '高级', '生动', '炫酷', '氛围感', '感觉', '好看', '优雅', '美观', '大气', '有质感']);

function isSubstantive(value, minChars = 4) {
  let rest = String(value || '');
  for (const term of FILLER_TERMS) rest = rest.split(term).join('');
  return rest.replace(/[\s，。、,.!！?？:：;；\-—]/g, '').length >= minChars;
}

// Runtime ceilings. Normal mode keeps a tight cap (the brief is a gate, not a
// stage). AGI/evolution mode widens the thinking space — more candidates may
// be compared, more verification dimensions planned — and a consumed
// escalation hint widens it once more. validateSidepathBrief enforces these
// as upper bounds, so the numbers printed in renderSidepathRequirement are
// the real contract.
function sidepathCeiling({ workMode = 'normal', escalated = false } = {}) {
  const raised = workMode === 'evolution' || workMode === 'agi';
  const base = raised
    ? { planRefusals: 3, candidates: 5, verification: 6 }
    : { planRefusals: 2, candidates: 2, verification: 3 };
  if (!escalated) return base;
  return {
    planRefusals: Math.min(4, base.planRefusals + 1),
    candidates: Math.min(6, base.candidates + 1),
    verification: Math.min(8, base.verification * 2)
  };
}

function budgetForMode(mode, ceiling = sidepathCeiling()) {
  const cap = ceiling || sidepathCeiling();
  const clamp = (min, max, value) => Math.min(max, Math.max(min, value));
  if (mode === 'direct') {
    return { planRefusals: Math.max(1, Number(cap.planRefusals) || 2), candidates: 0, verification: 0, evidenceRounds: 0 };
  }
  if (mode === 'structured') {
    return {
      planRefusals: Math.max(1, Number(cap.planRefusals) || 2),
      candidates: 1,
      verification: clamp(1, 2, Number(cap.verification) || 2),
      evidenceRounds: 1
    };
  }
  return {
    planRefusals: Math.max(1, Number(cap.planRefusals) || 2),
    candidates: clamp(2, 4, Number(cap.candidates) || 2),
    verification: clamp(2, 6, Number(cap.verification) || 2),
    evidenceRounds: 2
  };
}

function extractSidepathBlock(text) {
  const source = String(text || '');
  const start = source.indexOf(SIDEPATH_OPEN);
  if (start < 0) return null;
  const end = source.indexOf(SIDEPATH_CLOSE, start + SIDEPATH_OPEN.length);
  if (end < 0) return { open: true, body: source.slice(start + SIDEPATH_OPEN.length) };
  return { open: false, body: source.slice(start + SIDEPATH_OPEN.length, end) };
}

function stringList(value, max, maxChars, errors, label, { min = 0, requiredArray = false } = {}) {
  if (requiredArray && !Array.isArray(value)) {
    errors.push(`${label} must be an explicit array`);
    return [];
  }
  const items = (Array.isArray(value) ? value : [])
    .map(item => clip(typeof item === 'string' ? item : item?.text, maxChars))
    .filter(Boolean)
    .slice(0, max);
  if (items.length < min) errors.push(`${label} requires at least ${min} item(s)`);
  return items;
}

function normalizeBrief(raw, errors = []) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const mode = SIDEPATH_MODES.includes(source.mode) ? source.mode : '';
  if (!mode) errors.push(`mode must be one of ${SIDEPATH_MODES.join(' / ')}`);
  const deliverable = DELIVERABLE_KINDS.includes(source.deliverable) ? source.deliverable : '';
  if (!deliverable) errors.push(`deliverable must be one of ${DELIVERABLE_KINDS.join(' / ')}`);
  const brief = {
    mode,
    deliverable,
    userIntent: clip(source.userIntent, 600),
    understanding: clip(source.understanding, 600),
    intentDelta: clip(source.intentDelta, 600),
    uplift: clip(source.uplift, 600),
    ambiguities: stringList(source.ambiguities, 8, 300, errors, 'ambiguities', { requiredArray: true }),
    task: clip(source.task, 600),
    methods: stringList(source.methods, 8, 40, errors, 'methods')
      .map(item => item.toLowerCase())
      .filter(item => METHOD_IDS.includes(item)),
    relations: stringList(source.relations, 12, 300, errors, 'relations'),
    constraints: stringList(source.constraints, 12, 300, errors, 'constraints'),
    candidates: (Array.isArray(source.candidates) ? source.candidates : [])
      .slice(0, 6)
      .map(item => ({
        decision: clip(item?.decision, 300),
        status: item?.status === 'chosen' ? 'chosen' : 'rejected',
        why: clip(item?.why || item?.rationale, 400)
      }))
      .filter(item => item.decision),
    openQuestions: stringList(source.openQuestions, 8, 300, errors, 'openQuestions'),
    verification: (Array.isArray(source.verification) ? source.verification : [])
      .slice(0, 8)
      .map(item => ({ claim: clip(item?.claim, 300), check: clip(item?.check, 400) }))
      .filter(item => item.claim || item.check)
  };
  for (const field of VISUAL_REQUIRED_FIELDS) {
    brief[field] = clip(source[field], 400);
  }
  return brief;
}

function parseSidepathBrief(text) {
  const block = extractSidepathBlock(text);
  if (!block) return { ok: false, brief: null, errors: ['missing side-path block'] };
  if (block.open) return { ok: false, brief: null, errors: ['side-path block is not closed'] };
  let parsed;
  try {
    parsed = JSON.parse(block.body.trim());
  } catch (error) {
    return { ok: false, brief: null, errors: [`invalid JSON: ${error?.message || 'parse failed'}`] };
  }
  const errors = [];
  const brief = normalizeBrief(parsed, errors);
  if (errors.length) return { ok: false, brief: null, errors };
  return { ok: true, brief, errors: [] };
}

// Structural reference check: the quoted intent must actually contain words
// from the user's request. This validates the quote, not the meaning.
function referencesPrompt(userIntent, prompt) {
  const runs = [...new Set([...String(prompt || '').matchAll(/[\u4e00-\u9fffA-Za-z0-9]{2,}/g)].map(match => match[0]))];
  if (!runs.length) return true;
  const target = String(userIntent || '');
  return runs.some(run => {
    if (target.includes(run)) return true;
    // Short function words like "一个" are not evidence of a quote: require a
    // match of at least three characters before accepting a partial quote.
    if (run.length < 3) return false;
    const max = Math.min(6, run.length);
    for (let size = max; size >= 3; size -= 1) {
      for (let index = 0; index + size <= run.length; index += 1) {
        if (target.includes(run.slice(index, index + size))) return true;
      }
    }
    return false;
  });
}

function validateSidepathBrief(brief, { ceiling = sidepathCeiling(), followupRound = false, userPrompt = '', requireExploratory = false } = {}) {
  const errors = [];
  if (!brief) return { ok: false, errors: ['missing brief'] };
  if (!brief.mode) errors.push('mode is required');
  if (!brief.deliverable) errors.push('deliverable is required');
  if (requireExploratory && brief.mode !== 'exploratory') {
    errors.push('this mode floors the run at exploratory: declare exploratory and compare at least two concept candidates');
  }
  if (requireExploratory && !isSubstantive(brief.uplift)) {
    errors.push('AGI mode requires an uplift: state what this run enlarges beyond the literal request (world / gameplay / expressiveness / depth)');
  }
  if (!brief.userIntent || brief.userIntent.length < 4) {
    errors.push('userIntent must quote what the user asked');
  } else if (!referencesPrompt(brief.userIntent, userPrompt)) {
    errors.push('userIntent does not reference the user request');
  }
  if (!brief.understanding || !isSubstantive(brief.understanding)) {
    errors.push('understanding is missing or not substantive');
  }
  if (!brief.task || brief.task.length < 8) errors.push('task representation is too short');
  if (followupRound && (!brief.intentDelta || !isSubstantive(brief.intentDelta))) {
    errors.push('intentDelta is required when the user is responding to a previous delivery');
  }
  if (brief.deliverable === 'visual') {
    for (const field of VISUAL_REQUIRED_FIELDS) {
      if (!isSubstantive(brief[field])) errors.push(`visual deliverables require a substantive "${field}" plan`);
    }
  }
  if (brief.mode !== 'direct') {
    const budget = budgetForMode(brief.mode, ceiling);
    if (!brief.relations.length) errors.push('at least one relation is required');
    if (!brief.verification.length) errors.push('at least one verification requirement is required');
    if (requireExploratory && (brief.methods || []).length < 2) {
      errors.push('AGI mode requires at least two reasoning methods to be declared and executed');
    }
    for (const method of (brief.methods || [])) {
      const field = METHOD_ARTIFACT_FIELD[method];
      if (!field) continue;
      const value = brief[field];
      const empty = Array.isArray(value) ? value.length === 0 : !String(value || '').trim();
      if (empty) {
        errors.push(`reasoning method "${method}" was declared but produced no ${field}; execute it while thinking or drop the tag`);
      }
    }
    if (brief.candidates.length > ceiling.candidates) {
      errors.push(`candidate decisions exceed the runtime ceiling (${brief.candidates.length} > ${ceiling.candidates})`);
    }
    if (brief.verification.length > ceiling.verification) {
      errors.push(`verification requirements exceed the runtime ceiling (${brief.verification.length} > ${ceiling.verification})`);
    }
    const chosen = brief.candidates.filter(item => item.status === 'chosen');
    if (chosen.length !== 1) errors.push('exactly one candidate decision must be marked chosen');
    if (budget.candidates > 1 && brief.candidates.length < 2) {
      errors.push(`this task needs at least two candidate decisions; runtime allows ${budget.candidates}`);
    }
    for (const item of brief.candidates) {
      if (!isSubstantive(item.why)) errors.push(`rationale for "${clip(item.decision, 40)}" is not substantive`);
    }
    for (const item of brief.verification) {
      if (!item.claim || item.claim.length < 4) errors.push('each verification requirement needs a claim');
      if (!item.check || item.check.length < 8) {
        errors.push(`verification check for "${clip(item.claim, 40)}" is too short to be observable`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function renderSidepathRequirement({ ceiling = sidepathCeiling(), followupRound = false, agiMode = false } = {}) {
  return [
    '## AGI reasoning side-path (runtime-gated)',
    'The runtime requires exactly one short, parseable side-path brief before the first file mutation of this run: edit / write / apply_patch are held until the brief exists.',
    agiMode
      ? [
          'This run is in AGI mode, and AGI widens your thinking space instead of narrowing it:',
          '1. Before writing any file, imagine a version one level LARGER than the literal request — a bigger world, deeper gameplay, stronger expressiveness, or more depth — and put it on the table as a real candidate next to the literal baseline.',
          '2. Prefer the uplifted candidate unless a hard constraint genuinely blocks it. The sidepath compares candidates; it does not ban ambition.',
          '3. If you reject the more ambitious candidate, the rejection MUST state what is lost by giving it up and which constraint made it not worth it this round. Rejecting an upgrade for convenience ("用户没要求") is not a valid rejection.',
          '4. Fill "uplift": one sentence naming what this run enlarges beyond the literal request. It will be shown to the user as the AGI delta.'
        ].join('\n')
      : '',
    'Emit it as visible text with this exact tag (one JSON object inside):',
    SIDEPATH_OPEN,
    '{"mode":"structured|exploratory|direct","deliverable":"visual|code|doc|data|other","userIntent":"quote the user\'s own words","understanding":"what you understand they want","uplift":"AGI mode: what this run enlarges beyond the literal request (world/gameplay/expressiveness/depth)","ambiguities":["anything genuinely unclear; empty array when clear"],"intentDelta":"only when responding to a previous delivery: what changed","task":"one-sentence task representation","methods":["decompose","relations"],"relations":["who/what drives what"],"constraints":["hard constraint"],"candidates":[{"decision":"...","status":"chosen","why":"..."},{"decision":"...","status":"rejected","why":"what is lost and which constraint blocks it"}],"openQuestions":["..."],"world":"only when deliverable=visual: the world this belongs to","moment":"only when deliverable=visual: who uses it, at what moment","interaction":"only when deliverable=visual: at least one user action and its feedback","accessibility":"only when deliverable=visual: reduced-motion / keyboard plan","responsive":"only when deliverable=visual: narrow-viewport plan","verification":[{"claim":"observable claim","check":"how to measure it externally"}]}',
    SIDEPATH_CLOSE,
    followupRound
      ? 'This is a follow-up round on a previous delivery: intentDelta is mandatory, and continuing the previous acceptance narrative or expanding the old plan before reconciling intent is not acceptable.'
      : '',
    'Rules: choose the approach BEFORE implementing; userIntent must quote the user; every verification check must be externally observable (frame delta, DOM/render state, geometry, measurements) — self-claimed passes do not count.',
    'methods are reasoning operations you execute while thinking, not tags: each declared method must have left its artifact in the brief (abstract→understanding, decompose→task, relations→relations, constraints→constraints, comparison→candidates, experiment→verification). A tag without an artifact fails the gate.',
    'For deliverable=visual the runtime independently measures the produced file for identity / interaction / responsive / reduced-motion / aria coverage and will require fixing or explicitly justifying every missing dimension.',
    `Runtime ceilings: candidates <= ${ceiling.candidates}, verification checks <= ${ceiling.verification}, rejected write attempts allowed: ${ceiling.planRefusals}.`
  ].filter(Boolean).join('\n');
}

// Pure runtime gate used by the sidecar permission hub.
function sidepathWriteGate({ state = null, permission = '', budget = null } = {}) {
  if (!state || state.required !== true || state.brief || state.degraded === true) return { block: false };
  const name = String(permission || '').trim().toLowerCase();
  if (!MUTATION_PERMISSIONS.includes(name)) return { block: false };
  const allowed = Math.max(0, Number(
    budget?.planRefusals ?? state.budget?.planRefusals ?? state.ceiling?.planRefusals ?? 2
  ) || 0);
  const blocked = Number(state.blocked) || 0;
  if (blocked >= allowed) return { block: false, degrade: true };
  const detail = Array.isArray(state.errors) && state.errors.length
    ? ` Current issues: ${state.errors.slice(0, 3).join('; ')}.`
    : '';
  return {
    block: true,
    message: `AGI reasoning side-path is required before the first file mutation: emit one <${SIDEPATH_TAG}> {...} ${SIDEPATH_CLOSE} block (mode / userIntent quoting the request / understanding / ambiguities / task / relations / candidates with one chosen / verification), then retry.${detail}`
  };
}

function summarizeSidepath(sidepath) {
  if (!sidepath?.required) return '';
  const parts = ['required'];
  parts.push(`mode=${sidepath.mode || 'pending'}`);
  parts.push(sidepath.brief ? 'brief=ok' : 'brief=missing');
  if (sidepath.followupRound) parts.push('followup');
  if (Number(sidepath.blocked)) parts.push(`blocked=${Number(sidepath.blocked)}`);
  if (sidepath.bypassed) parts.push('bypassed');
  if (sidepath.degraded) parts.push('degraded');
  return parts.join(' ');
}

module.exports = {
  SIDEPATH_TAG,
  SIDEPATH_OPEN,
  SIDEPATH_CLOSE,
  SIDEPATH_MODES,
  DELIVERABLE_KINDS,
  VISUAL_REQUIRED_FIELDS,
  MUTATION_PERMISSIONS,
  REASONING_METHODS,
  METHOD_IDS,
  METHOD_ARTIFACT_FIELD,
  SYSTEM_VOCABULARY_RULE,
  budgetForMode,
  extractSidepathBlock,
  isSubstantive,
  normalizeBrief,
  parseSidepathBrief,
  referencesPrompt,
  renderSidepathRequirement,
  sidepathCeiling,
  sidepathWriteGate,
  summarizeSidepath,
  validateSidepathBrief
};
