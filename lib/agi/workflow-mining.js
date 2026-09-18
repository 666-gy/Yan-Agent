'use strict';

// P1-1: model-free workflow mining. Repeated consecutive tool n-grams become
// parameterized Skill candidates; they stay candidates until evaluated.

const { clip, normalizeId, stableHash, containsUnsafeText } = require('./contracts');

const MAX_STEPS = 2000;
const MAX_EXAMPLE_INDEXES = 50;
const MIN_TOOLS_FOR_CANDIDATE = 3;

const DANGEROUS_PATTERNS = Object.freeze([
  /\brm\s+-rf\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/s\s+\/q\b/i,
  /\bmkfs(?:\.\w+)?\b/i,
  /\bshutdown\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\}/,
  /remove-item[^\n]{0,80}-recurse[^\n]{0,40}-force/i
]);

function toPositiveInt(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

function isDangerous(text) {
  const value = String(text === undefined || text === null ? '' : text);
  return containsUnsafeText(value) || DANGEROUS_PATTERNS.some(pattern => pattern.test(value));
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizeSteps(steps) {
  const list = Array.isArray(steps) ? steps.slice(0, MAX_STEPS) : [];
  const tools = [];
  for (const step of list) {
    const raw = typeof step === 'string' ? step : step && step.tool;
    const tool = clip(raw, 120);
    if (tool) tools.push(tool);
  }
  return tools;
}

function mineSequences(steps, options = {}) {
  const minLength = toPositiveInt(options.minLength, 3);
  const minOccurrences = toPositiveInt(options.minOccurrences, 2);
  const maxSequences = toPositiveInt(options.maxSequences, 20);
  const tools = normalizeSteps(steps);
  const found = new Map();
  for (let size = minLength; size <= minLength + 2; size += 1) {
    if (size > tools.length) break;
    for (let start = 0; start + size <= tools.length; start += 1) {
      const slice = tools.slice(start, start + size);
      const key = slice.join('\u0001');
      let entry = found.get(key);
      if (!entry) {
        entry = { tools: slice, length: size, occurrences: 0, exampleIndexes: [] };
        found.set(key, entry);
      }
      entry.occurrences += 1;
      if (entry.exampleIndexes.length < MAX_EXAMPLE_INDEXES) entry.exampleIndexes.push(start);
    }
  }
  return [...found.values()]
    .filter(entry => entry.occurrences >= minOccurrences)
    .sort((a, b) => (
      b.occurrences - a.occurrences
      || b.length - a.length
      || compareText(a.tools.join('\u0001'), b.tools.join('\u0001'))
    ))
    .slice(0, maxSequences);
}

function derivePreconditions(toolSteps, tools) {
  const targets = [];
  for (const step of Array.isArray(toolSteps) ? toolSteps : []) {
    const target = clip(step && typeof step === 'object' ? step.targetKey : '', 120);
    if (target && !targets.includes(target)) targets.push(target);
  }
  const preconditions = [];
  if (targets.length > 0) {
    preconditions.push(`工作区 {{workspace}} 中可访问：${targets.slice(0, 8).join('、')}`);
  } else {
    preconditions.push('{{workspace}} 可用且所需工具具备访问权限');
  }
  preconditions.push(`第一个步骤工具可调用：${tools[0]}`);
  return preconditions;
}

function buildPrompt(tools, postconditions, minPromptChars) {
  const lines = ['你是 Yan Agent 工作流技能。请在 {{workspace}} 中按顺序复现以下已验证的工具序列：'];
  tools.forEach((tool, index) => {
    lines.push(`${index + 1}. 调用 ${tool}，输入：{{input_${index + 1}}}，输出：{{output_${index + 1}}}`);
  });
  lines.push('要求：每一步都必须真实调用对应工具并保留输出，禁止跳过、合并或重排步骤。');
  if (postconditions.length > 0) {
    lines.push('验收要求：');
    postconditions.forEach((item, index) => lines.push(`- (${index + 1}) ${item}`));
  } else {
    lines.push('验收要求：逐步核对工具输出；当前候选没有后置条件，仅作为结构化草稿等待评估。');
  }
  lines.push('若任一步骤失败，停止执行并如实报告失败步骤，不得伪造结果。');
  let prompt = lines.join('\n');
  while (prompt.length < minPromptChars) {
    prompt += '\n补充要求：保持 {{workspace}} 参数化，不得硬编码绝对路径或凭据。';
  }
  return prompt;
}

function buildEvidence(sequence, tools, postconditions, provided) {
  const occurrences = Number(sequence && sequence.occurrences) || 1;
  const indexes = Array.isArray(sequence && sequence.exampleIndexes)
    ? sequence.exampleIndexes.slice(0, 10)
    : [];
  const generated = `工作流挖掘：工具链 ${tools.join(' -> ')}，重复出现 ${occurrences} 次`
    + `${indexes.length > 0 ? `，起始索引 ${indexes.join(', ')}` : ''}。`;
  let text = clip(provided, 480) || generated;
  if (postconditions.length === 0 && !text.includes('无后置条件')) {
    text = `${text} 无后置条件，仅结构化候选。`;
  }
  return clip(text, 600);
}

function proposeCandidate(sequence, options = {}) {
  const tools = (Array.isArray(sequence && sequence.tools) ? sequence.tools : [])
    .map(tool => clip(tool, 120))
    .filter(Boolean);
  if (tools.length < MIN_TOOLS_FOR_CANDIDATE) return null;

  const toolSteps = Array.isArray(options.toolSteps) ? options.toolSteps : [];
  const stepText = toolSteps
    .map(step => (step && typeof step === 'object' ? JSON.stringify(step) : String(step === undefined || step === null ? '' : step)))
    .join('\n');
  if (isDangerous(`${tools.join('\n')}\n${stepText}`)) return null;

  const postconditions = (Array.isArray(options.postconditions) ? options.postconditions : [])
    .map(item => clip(item, 200))
    .filter(Boolean)
    .slice(0, 8);
  const parsedMin = Math.floor(Number(options.minPromptChars));
  const minPromptChars = Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : 80;

  const id = normalizeId(`wf-${stableHash(JSON.stringify(tools)).slice(0, 10)}`);
  const name = clip(`工作流：${tools.join(' → ')}`, 80);
  const occurrences = Number(sequence && sequence.occurrences) || 1;
  const description = clip(
    `由本地工作流挖掘生成：重复 ${occurrences} 次的 ${tools.length} 步工具序列（${tools.join(' -> ')}）；需通过评估后才可复用。`,
    300
  );
  const triggers = [...new Set(['workflow-mining', ...tools.slice(0, 8)])].slice(0, 12);
  const prompt = buildPrompt(tools, postconditions, minPromptChars);
  const evidence = buildEvidence(sequence, tools, postconditions, options.evidence);

  return {
    id,
    name,
    description,
    prompt,
    triggers,
    evidence,
    verification: {
      preconditions: derivePreconditions(toolSteps, tools),
      postconditions
    }
  };
}

module.exports = { mineSequences, proposeCandidate };
