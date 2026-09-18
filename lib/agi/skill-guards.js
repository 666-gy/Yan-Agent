'use strict';

// P1-5: deterministic safety guards for generated / refined Skills.
// 1) checkConsistency   - documentation vs executable content.
// 2) detectSelfConfirmation - generator and judge of the same origin.
// 3) regressionCheck    - refinement must not regress evidence.

const CONSISTENCY_CODES = Object.freeze({
  EMPTY_CONTENT: 'empty-content',
  UNDOCUMENTED_EXECUTION: 'undocumented-execution',
  EFFECT_MISMATCH: 'effect-mismatch',
  PROMISE_GAP: 'promise-gap'
});

const EXECUTION_WORDS = /执行|运行|安装|\b(?:install(?:ed|ing|s)?|run(?:s|ning)?|execut(?:e|es|ed|ing|ion))\b/i;

const EXECUTABLE_HINTS = Object.freeze([
  /```/,
  /\b(?:npm|npx|pnpm|yarn|node|python3?|pip3?|bash|sh|zsh|pwsh|powershell|curl|wget)\b/i,
  /\brm\b/i,
  /\b(?:select|insert|update|delete|drop|create|alter|grant)\b[\s\S]{0,80}\b(?:from|into|table|database)\b/i,
  /(?:^|[;&|]\s*)(?:sudo|chmod|chown|sed|awk|grep|make)\s/
]);

const WRITE_EFFECT_PATTERNS = Object.freeze([
  /\b(?:rm|del|delete|remove|unlink|truncate)\b/i,
  /\bremove[-_ ]?item\b/i,
  /\b(?:write|writefile|mkdir|rename|move|copy|append|publish|install|deploy)\b/i,
  /(?:写入|删除|移除|发布|安装|覆盖)/
]);

function tokenize(value) {
  return String(value === undefined || value === null ? '' : value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length >= 2);
}

function checkConsistency({ name, description, prompt, declaredEffect = 'read' } = {}) {
  const issues = [];
  const nameText = String(name === undefined || name === null ? '' : name).trim();
  const promptText = String(prompt === undefined || prompt === null ? '' : prompt).trim();
  if (!nameText || !promptText) {
    const missing = [];
    if (!nameText) missing.push('name');
    if (!promptText) missing.push('prompt');
    issues.push({ code: CONSISTENCY_CODES.EMPTY_CONTENT, detail: `缺少必要内容：${missing.join(', ')}` });
    return { ok: false, issues };
  }

  const descriptionText = String(description === undefined || description === null ? '' : description).trim();

  if (EXECUTABLE_HINTS.some(pattern => pattern.test(promptText)) && !EXECUTION_WORDS.test(descriptionText)) {
    issues.push({
      code: CONSISTENCY_CODES.UNDOCUMENTED_EXECUTION,
      detail: 'prompt 含可执行命令特征，但 description 未出现执行/运行/install/run 类说明'
    });
  }

  if (String(declaredEffect || 'read') === 'read' && WRITE_EFFECT_PATTERNS.some(pattern => pattern.test(promptText))) {
    issues.push({
      code: CONSISTENCY_CODES.EFFECT_MISMATCH,
      detail: 'declaredEffect 为 read，但 prompt 含写/删/发布/安装类模式'
    });
  }

  if (descriptionText.length >= 20) {
    const descriptionTokens = [...new Set(tokenize(descriptionText))];
    const promptTokens = new Set(tokenize(promptText));
    if (descriptionTokens.length > 0) {
      let shared = 0;
      for (const token of descriptionTokens) {
        if (promptTokens.has(token)) shared += 1;
      }
      const overlap = shared / descriptionTokens.length;
      if (overlap < 0.15) {
        issues.push({
          code: CONSISTENCY_CODES.PROMISE_GAP,
          detail: `description 关键词与 prompt 内容重叠率 ${(overlap * 100).toFixed(1)}%，低于 15%`
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

const ROLE_FAMILIES = Object.freeze([
  'review', 'judge', 'critic', 'audit', 'verify', 'eval',
  'build', 'author', 'generate', 'implement', 'engineer', 'plan', 'research', 'test'
]);

function normalizeModel(value) {
  return String(value === undefined || value === null ? '' : value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function roleFamilies(value) {
  const normalized = String(value === undefined || value === null ? '' : value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return ROLE_FAMILIES.filter(family => normalized.includes(family));
}

function detectSelfConfirmation({ generatorModel, judgeModel, generatorRole = '', judgeRole = '' } = {}) {
  const generator = normalizeModel(generatorModel);
  const judge = normalizeModel(judgeModel);
  if (generator && judge && generator === judge) {
    return {
      warn: true,
      reason: `生成模型 ${String(generatorModel).trim()} 与评判模型 ${String(judgeModel).trim()} 为同一模型，生成与评判同源，存在自确认循环风险`
    };
  }
  const generatorFamilies = roleFamilies(generatorRole);
  const judgeFamilies = roleFamilies(judgeRole);
  const sharedFamilies = generatorFamilies.filter(family => judgeFamilies.includes(family));
  if (generatorFamilies.length > 0 && judgeFamilies.length > 0 && sharedFamilies.length > 0) {
    return {
      warn: true,
      reason: `生成角色「${String(generatorRole).trim()}」与评判角色「${String(judgeRole).trim()}」同属 ${sharedFamilies.join(', ')} 角色族，生成与评判同源，存在自确认循环风险`
    };
  }
  return { warn: false, reason: '生成与评判的模型或角色不同源，未检测到自确认循环' };
}

function asTaskIds(value) {
  return (Array.isArray(value) ? value : [])
    .map(id => String(id === undefined || id === null ? '' : id))
    .filter(Boolean);
}

function normalizeVersion(value) {
  return Number.isFinite(value) ? value : null;
}

function regressionCheck({ beforeEvidence, afterEvidence, requiredTaskIds = [] } = {}) {
  if (!beforeEvidence || typeof beforeEvidence !== 'object') {
    return { ok: false, reason: '缺少 before 证据，无法进行回归检查' };
  }
  if (!afterEvidence || typeof afterEvidence !== 'object') {
    return { ok: false, reason: '缺少 after 证据，无法进行回归检查' };
  }
  if (beforeEvidence.ok !== true) return { ok: false, reason: 'before 证据不是通过状态，无法作为回归基线' };
  if (afterEvidence.ok !== true) return { ok: false, reason: 'after 证据不是通过状态，回归检查拒绝' };

  const beforeVersion = normalizeVersion(beforeEvidence.rubricVersion);
  const afterVersion = normalizeVersion(afterEvidence.rubricVersion);
  if (beforeVersion === null || afterVersion === null) {
    return { ok: false, reason: `rubric 版本缺失：before=${beforeEvidence.rubricVersion}，after=${afterEvidence.rubricVersion}` };
  }
  if (beforeVersion !== afterVersion) {
    return { ok: false, reason: `rubric 版本不一致：before v${beforeVersion}，after v${afterVersion}` };
  }

  const beforeTasks = asTaskIds(beforeEvidence.taskIds);
  const afterTasks = new Set(asTaskIds(afterEvidence.taskIds));
  const required = asTaskIds(requiredTaskIds);
  const missingRequired = required.filter(id => !afterTasks.has(id));
  if (missingRequired.length > 0) {
    return { ok: false, reason: `after 证据缺少必需任务：${missingRequired.join(', ')}` };
  }
  const regressed = beforeTasks.filter(id => !afterTasks.has(id));
  if (regressed.length > 0) {
    return { ok: false, reason: `任务覆盖回退：after 证据缺少 before 中的任务 ${regressed.join(', ')}` };
  }
  return { ok: true, reason: `回归检查通过：after 覆盖 ${afterTasks.size} 个任务，rubric v${afterVersion}` };
}

const DEFAULT_GUARD_RULES = Object.freeze([
  Object.freeze({
    code: CONSISTENCY_CODES.EMPTY_CONTENT,
    scope: 'consistency',
    severity: 'error',
    description: 'name 或 prompt 为空时拒绝候选技能'
  }),
  Object.freeze({
    code: CONSISTENCY_CODES.UNDOCUMENTED_EXECUTION,
    scope: 'consistency',
    severity: 'error',
    description: 'prompt 含可执行命令特征但 description 未声明执行语义'
  }),
  Object.freeze({
    code: CONSISTENCY_CODES.EFFECT_MISMATCH,
    scope: 'consistency',
    severity: 'error',
    description: 'declaredEffect=read 但 prompt 含写/删/发布/安装模式'
  }),
  Object.freeze({
    code: CONSISTENCY_CODES.PROMISE_GAP,
    scope: 'consistency',
    severity: 'warn',
    description: 'description 关键词与 prompt 的内容重叠率低于 15%'
  }),
  Object.freeze({
    code: 'self-confirmation',
    scope: 'generation',
    severity: 'warn',
    description: '生成与评判的模型 id 或角色族同源，存在自确认循环风险'
  }),
  Object.freeze({
    code: 'regression',
    scope: 'refinement',
    severity: 'error',
    description: 'refinement 后证据缺失、rubric 版本不一致、必需任务缺失或任务覆盖回退'
  })
]);

module.exports = { checkConsistency, detectSelfConfirmation, regressionCheck, DEFAULT_GUARD_RULES };
