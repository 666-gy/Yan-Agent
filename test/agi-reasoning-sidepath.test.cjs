'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SIDEPATH_TAG,
  SYSTEM_VOCABULARY_RULE,
  budgetForMode,
  isSubstantive,
  parseSidepathBrief,
  referencesPrompt,
  renderSidepathRequirement,
  sidepathCeiling,
  sidepathWriteGate,
  validateSidepathBrief
} = require('../lib/agi/reasoning-sidepath');

const USER_PROMPT = '写一个鹈鹕骑自行车 注意AGI';

function validBrief(overrides = {}) {
  return {
    mode: 'exploratory',
    deliverable: 'visual',
    userIntent: '用户说：写一个鹈鹕骑自行车 注意AGI',
    understanding: '用户要一个可交互的鹈鹕骑行页面，并希望 AGI 能力参与推理过程',
    uplift: '把“一辆自行车”扩成海边骑行小世界：环境视差、角色状态与可操作节奏共同表达慢生活',
    ambiguities: ['“AGI”可能被误解为作品主题，按系统能力处理'],
    intentDelta: '',
    task: '交付一个鹈鹕骑自行车的可交互动画页面',
    methods: ['decompose', 'relations'],
    relations: ['踏板位移驱动曲柄，曲柄驱动车轮'],
    constraints: ['窄屏不裁主体'],
    candidates: [
      { decision: '静态插画', status: 'rejected', why: '没有用户动作，只能被动观看' },
      { decision: '可暂停变速的骑行页面', status: 'chosen', why: '用户能控制节奏且世界一致' }
    ],
    openQuestions: [],
    world: '海边慢生活骑行俱乐部的一张明信片',
    moment: '傍晚下班后打开手机的人，想安静三十秒',
    interaction: '暂停/继续 + 速度调节，按钮给出状态反馈',
    accessibility: 'reduced-motion 默认停帧 + 键盘可操作',
    responsive: '窄屏改为竖版构图，控件换行',
    verification: [{ claim: '背景层在移动', check: '对比相邻两帧背景区域的像素差是否超过阈值' }],
    ...overrides
  };
}

test('budget ceilings: evolution mode raises all limits', () => {
  const normal = sidepathCeiling({ workMode: 'normal' });
  const evolution = sidepathCeiling({ workMode: 'evolution' });
  assert.ok(evolution.candidates >= normal.candidates);
  assert.ok(evolution.planRefusals >= normal.planRefusals);
  assert.ok(evolution.verification >= normal.verification);
  assert.deepEqual(budgetForMode('direct', evolution), {
    planRefusals: evolution.planRefusals,
    candidates: 0,
    verification: 0,
    evidenceRounds: 0
  });
  assert.equal(budgetForMode('exploratory', normal).candidates, 2);
});

test('parse: extracts a closed block and reports explicit format errors', () => {
  const text = `先说明。\n<${SIDEPATH_TAG}>${JSON.stringify(validBrief())}</${SIDEPATH_TAG}>\n然后实现。`;
  const parsed = parseSidepathBrief(text);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.equal(parsed.brief.mode, 'exploratory');

  assert.deepEqual(parseSidepathBrief('没有块').errors, ['missing side-path block']);
  assert.deepEqual(parseSidepathBrief(`<${SIDEPATH_TAG}>{}`).errors, ['side-path block is not closed']);
  const broken = parseSidepathBrief(`<${SIDEPATH_TAG}>{bad}</${SIDEPATH_TAG}>`);
  assert.equal(broken.ok, false);
  assert.match(broken.errors[0], /invalid JSON/);
});

test('parse: ambiguities must be an explicit array', () => {
  const missing = { ...validBrief() };
  delete missing.ambiguities;
  const parsed = parseSidepathBrief(`<${SIDEPATH_TAG}>${JSON.stringify(missing)}</${SIDEPATH_TAG}>`);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some(item => /ambiguities must be an explicit array/.test(item)));
});

test('validation: the quoted intent must actually reference the user request', () => {
  assert.equal(referencesPrompt('用户说：写一个鹈鹕骑自行车 注意AGI', USER_PROMPT), true);
  assert.equal(referencesPrompt('用户想要一个观察站', USER_PROMPT), false);

  const fabricated = validateSidepathBrief(validBrief({ userIntent: '用户想要一个观测网络' }), {
    userPrompt: USER_PROMPT
  });
  assert.equal(fabricated.ok, false);
  assert.ok(fabricated.errors.some(item => /does not reference the user request/.test(item)));

  const quoted = validateSidepathBrief(validBrief(), { userPrompt: USER_PROMPT });
  assert.equal(quoted.ok, true, JSON.stringify(quoted.errors));
});

test('validation: follow-up rounds require intentDelta', () => {
  const missing = validateSidepathBrief(validBrief(), { userPrompt: USER_PROMPT, followupRound: true });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some(item => /intentDelta is required/.test(item)));

  const provided = validateSidepathBrief(
    validBrief({ intentDelta: '上一轮把 AGI 做成了观测站主题；这一轮用户要的是系统能力参与推理' }),
    { userPrompt: USER_PROMPT, followupRound: true }
  );
  assert.equal(provided.ok, true, JSON.stringify(provided.errors));
});

test('validation: exploratory needs a compared decision and observable checks', () => {
  const oneCandidate = validateSidepathBrief(
    validBrief({ candidates: [validBrief().candidates[1]] }),
    { userPrompt: USER_PROMPT }
  );
  assert.equal(oneCandidate.ok, false);
  assert.ok(oneCandidate.errors.some(item => /two candidate decisions/.test(item)));

  const filler = validateSidepathBrief(validBrief({
    candidates: [
      { decision: 'A', status: 'rejected', why: '精美' },
      { decision: 'B', status: 'chosen', why: '高级，好看' }
    ]
  }), { userPrompt: USER_PROMPT });
  assert.equal(filler.ok, false);
  assert.ok(filler.errors.some(item => /not substantive/.test(item)));

  const weakCheck = validateSidepathBrief(
    validBrief({ verification: [{ claim: '背景在动', check: '看' }] }),
    { userPrompt: USER_PROMPT }
  );
  assert.equal(weakCheck.ok, false);
  assert.ok(weakCheck.errors.some(item => /too short to be observable/.test(item)));
});

test('validation: direct mode stays minimal but still names intent', () => {
  const direct = validBrief({
    mode: 'direct',
    deliverable: 'code',
    candidates: [],
    verification: [],
    relations: [],
    task: '把用户这句话追加到 note.txt 末尾'
  });
  const result = validateSidepathBrief(direct, { userPrompt: USER_PROMPT });
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  const noIntent = validateSidepathBrief({ ...direct, userIntent: '' }, { userPrompt: USER_PROMPT });
  assert.equal(noIntent.ok, false);
});

test('validation: deliverable is required and drives the visual plan fields', () => {
  const missingDeliverable = validateSidepathBrief(validBrief({ deliverable: '' }), { userPrompt: USER_PROMPT });
  assert.equal(missingDeliverable.ok, false);
  assert.ok(missingDeliverable.errors.some(item => /deliverable is required/.test(item)));

  const missingWorld = validateSidepathBrief(validBrief({ world: '精美' }), { userPrompt: USER_PROMPT });
  assert.equal(missingWorld.ok, false);
  assert.ok(missingWorld.errors.some(item => /"world" plan/.test(item)));

  const codeDeliverable = validateSidepathBrief(
    validBrief({ deliverable: 'code', world: '', moment: '', interaction: '', accessibility: '', responsive: '' }),
    { userPrompt: USER_PROMPT }
  );
  assert.equal(codeDeliverable.ok, true, JSON.stringify(codeDeliverable.errors));
});

test('validation: AGI mode floors the run at exploratory', () => {
  const structured = validateSidepathBrief(validBrief({ mode: 'structured' }), {
    userPrompt: USER_PROMPT,
    requireExploratory: true
  });
  assert.equal(structured.ok, false);
  assert.ok(structured.errors.some(item => /floors the run at exploratory/.test(item)));

  const exploratory = validateSidepathBrief(validBrief(), { userPrompt: USER_PROMPT, requireExploratory: true });
  assert.equal(exploratory.ok, true, JSON.stringify(exploratory.errors));

  // AGI widens thinking space; a brief without an uplift did not widen anything.
  const noUplift = validateSidepathBrief(validBrief({ uplift: '' }), { userPrompt: USER_PROMPT, requireExploratory: true });
  assert.equal(noUplift.ok, false);
  assert.ok(noUplift.errors.some(item => /requires an uplift/.test(item)));
});

test('gate: mutations are held before the brief and degrade after the budget', () => {
  const state = {
    required: true,
    brief: null,
    errors: [],
    blocked: 0,
    degraded: false,
    ceiling: { planRefusals: 2 },
    budget: null
  };
  const first = sidepathWriteGate({ state, permission: 'edit' });
  assert.equal(first.block, true);
  assert.match(first.message, new RegExp(SIDEPATH_TAG));
  assert.equal(sidepathWriteGate({ state, permission: 'read' }).block, false);

  state.blocked = 2;
  const spent = sidepathWriteGate({ state, permission: 'write' });
  assert.equal(spent.block, false);
  assert.equal(spent.degrade, true);

  state.brief = validBrief();
  assert.equal(sidepathWriteGate({ state, permission: 'apply_patch' }).block, false);
});

test('render: requirement carries the schema, ceilings and follow-up rule', () => {
  const section = renderSidepathRequirement({ ceiling: sidepathCeiling(), followupRound: false });
  assert.match(section, new RegExp(`<${SIDEPATH_TAG}>`));
  assert.match(section, /userIntent/);
  assert.match(section, /Runtime ceilings: candidates <= 2/);
  assert.doesNotMatch(section, /follow-up round/);

  const followup = renderSidepathRequirement({ ceiling: sidepathCeiling({ workMode: 'evolution' }), followupRound: true });
  assert.match(followup, /follow-up round/);
  assert.match(followup, /intentDelta/);
  assert.match(followup, /Runtime ceilings: candidates <= 5/);

  const agi = renderSidepathRequirement({ ceiling: sidepathCeiling({ workMode: 'agi' }), agiMode: true });
  assert.match(agi, /widens your thinking space/, 'AGI brief copy must be expansion-oriented');
  assert.match(agi, /uplift/);
  assert.match(agi, /what is lost/, 'rejecting an upgrade must state its cost');
  assert.match(agi, /deliverable=visual/);
  assert.match(agi, /independently measures/);
});

test('the standing vocabulary rule defines system terms without keyword gating', () => {
  assert.match(SYSTEM_VOCABULARY_RULE, /AGI/);
  assert.match(SYSTEM_VOCABULARY_RULE, /不得把这些词变成作品主题/);
  assert.equal(isSubstantive('精美'), false);
  assert.equal(isSubstantive('用户要可交互的骑行页面'), true);
});
