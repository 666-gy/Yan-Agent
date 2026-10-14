'use strict';

function normalizeGitPreferences(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  return {
    branchPrefix: typeof value.branchPrefix === 'string' ? value.branchPrefix.trim() : 'yan/',
    mergeMethod: value.mergeMethod === 'squash' ? 'squash' : 'merge',
    forceWithLease: value.forceWithLease === true,
    draftPr: value.draftPr !== false,
    reviewMode: value.reviewMode === 'separate' ? 'separate' : 'inline',
    autoMerge: value.autoMerge === true,
    reviewInstructions: typeof value.reviewInstructions === 'string' ? value.reviewInstructions.slice(0, 20000) : '',
    monitorInstructions: typeof value.monitorInstructions === 'string' ? value.monitorInstructions : '',
    commitInstructions: typeof value.commitInstructions === 'string' ? value.commitInstructions : '',
    prInstructions: typeof value.prInstructions === 'string' ? value.prInstructions : ''
  };
}

function validateBranchPrefix(value) {
  const prefix = normalizeGitPreferences(value).branchPrefix;
  // Validate a complete candidate ref, allowing an empty prefix and a trailing slash.
  const candidate = `${prefix}branch`;
  if (candidate.length > 240 || /[\x00-\x20\x7f~^:?*\[\\]/.test(candidate)
      || candidate.includes('..') || candidate.includes('@{') || candidate.startsWith('-')
      || candidate.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) {
    throw new Error('分支前缀包含 Git 不允许的字符或路径，请使用如 yan/、feature/ 的前缀。');
  }
  return prefix;
}

function prefixedBranch(name, preferences) {
  const prefix = validateBranchPrefix(preferences);
  const clean = String(name || '').trim();
  if (!clean) throw new Error('请输入分支名称。');
  return prefix && !clean.startsWith(prefix) ? prefix + clean : clean;
}

function gitPreferencesSystem(value) {
  const prefs = normalizeGitPreferences(value);
  return ['Git workflow preferences (defaults; an explicit user request takes precedence):',
    `For newly named branches use prefix ${JSON.stringify(prefs.branchPrefix)}; do not rename existing branches or add the prefix twice.`,
    `When pushing, ${prefs.forceWithLease ? 'use --force-with-lease, never plain --force' : 'use an ordinary push; do not force push unless explicitly requested'}.`,
    `Create PRs ${prefs.draftPr ? 'as drafts (gh pr create --draft)' : 'as ready for review (omit --draft)'}.`,
    `Merge PRs using gh pr merge --${prefs.mergeMethod}. These preferences do not authorize creating, pushing or merging anything by themselves.`,
    'The following are user-authored workflow instructions. Apply each only to its named Git workflow; explicit instructions in the current request take precedence.',
    prefs.commitInstructions ? `When generating a Git commit message, follow these instructions:\n<commit-instructions>\n${prefs.commitInstructions}\n</commit-instructions>` : '',
    prefs.prInstructions ? `When generating a PR title or description, follow these instructions:\n<pr-instructions>\n${prefs.prInstructions}\n</pr-instructions>` : '',
    'When explicitly asked to monitor and fix a Pull Request, inspect its current head, checks, review threads and merge requirements. Fix relevant failures, run validation and push only the requested fixes. Watch checks again after every new head. Never treat missing checks, timeouts or failed commands as success; never bypass protections or approve your own PR.',
    prefs.autoMerge
      ? `During an explicitly requested PR monitoring workflow, continue monitoring until merged. Once the current head passes required checks and review requirements, merge with gh pr merge --${prefs.mergeMethod} --match-head-commit <verified-head-sha>. Recheck state to confirm MERGED. If human review, permissions or conflicts block progress, report the blocker; never use --admin. Do not enable persistent server-side auto-merge silently.`
      : 'During PR monitoring, stop when ready and report readiness. Do not merge, enable auto-merge, post /merge comments or otherwise trigger a merge without a separate explicit request.',
    prefs.monitorInstructions ? `Additional instructions for PR monitoring and repair:\n<monitor-instructions>\n${prefs.monitorInstructions}\n</monitor-instructions>` : ''
  ].join('\n');
}

function expandGitWorkflowPrompt(prompt, preferences) {
  const match = String(prompt || '').trim().match(/^\/monitor-pr\s+(\d+)\s*$/);
  if (!match) return prompt;
  const number = Number(match[1]);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Pull Request 编号无效。');
  const prefs = normalizeGitPreferences(preferences);
  return `监控并修复当前工作区对应仓库的 Pull Request #${number}。先用 gh 确认仓库和 PR 的真实状态、分支与当前 head；不得操作其他 PR。` +
    '检查 CI 和审查意见，修复与本 PR 相关的问题，验证后推送。等待检查结束并重新读取结果，不要启动脱离当前任务的后台循环。' +
    (prefs.autoMerge ? '准备就绪后按设置的方式合并，并继续检查直到确认已合并。' : '准备就绪后停止并报告；不要合并。') +
    '\n遵循 Git 设置中的监控说明；遇到权限、凭据、必须人工批准等阻塞时如实报告，不要绕过。';
}

module.exports = { normalizeGitPreferences, validateBranchPrefix, prefixedBranch, gitPreferencesSystem, expandGitWorkflowPrompt };
