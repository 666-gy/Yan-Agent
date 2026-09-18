'use strict';

const crypto = require('crypto');
const {
  containsSensitiveMemoryText,
  containsUnsafeMemoryText,
  tokenize
} = require('./long-term-memory');

const POLICY_MAX_CHARS = 12_000;
const POLICY_MAX_ENTRIES = 64;
const SEARCH_INTENT_RE = /搜索|搜集|查资料|查找|查询|检索|联网|调研|研究|资料|信息|新闻|最新|搜索引擎|search|research|look\s*up|web\s+search|current\s+information/iu;
const EXPLICIT_SEARCH_INTENT_RE = /搜索|搜集|查资料|查找|检索|调研|研究|新闻|最新|搜索引擎|search|research|look\s*up|web\s+search|current\s+information/iu;
const URL_OR_PAGE_INTENT_RE = /打开(?:链接|网址|网页|页面)|访问(?:链接|网址|网页|页面)|预览|截图|点击|交互|页面渲染|visual(?:ly)?\s+(?:verify|inspect)|open\s+(?:the\s+)?url|browse\s+the\s+page/iu;
const URL_RE = /https?:\/\/|\bwww\./iu;
const DURABLE_DIRECTIVE_RE = /以后|今后|从现在起|从此以后|记住|记下来|持久化|跨(?:会话|任务)|每次|始终|一律|默认|长期|永久|always|from\s+now\s+on|remember|persist|across\s+(?:sessions?|tasks?)|for\s+every/iu;
const PRIORITY_RE = /优先|首先|先用|第一顺位|默认使用|只用|必须使用|不得绕过|回退|降级|prefer|first|before|must\s+use|only\s+after|fall\s+back|instead\s+of|rather\s+than/iu;
const DIRECTIVE_ACTION_RE = /(?:以后|今后|从现在起|从此以后|每次|始终|一律|默认|长期|永久).{0,80}(?:要|请|必须|应当|应该|不要|不得|不能|务必|保持|使用|执行|遵守)|(?:always|from\s+now\s+on|for\s+every).{0,80}(?:use|keep|follow|apply|do|avoid|never|must|should)/iu;
const ANYSEARCH_RE = /anysearch|market[-_ ]?anysearch|anysearch[_ -]?cli/iu;

function clip(value, max) {
  return String(value || '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function normalizedText(value) {
  return clip(value, 6_000).replace(/\s+/gu, ' ').trim();
}

function policyId(value) {
  const text = normalizedText(value).toLowerCase();
  if (ANYSEARCH_RE.test(text) && SEARCH_INTENT_RE.test(text)) return 'user-policy-search-routing';
  return `user-policy-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 24)}`;
}

function isSearchRequest(value) {
  const text = String(value || '').trim();
  if (!text || !SEARCH_INTENT_RE.test(text)) return false;
  // A combined request such as "search Astra, then open the official site"
  // is still a search task. Direct-page requests that only use ambiguous
  // words such as "information" or "query" stay on the page route.
  if (EXPLICIT_SEARCH_INTENT_RE.test(text)) return true;
  return !URL_OR_PAGE_INTENT_RE.test(text) && !URL_RE.test(text);
}

function policyRequestText(request = {}) {
  return [
    request.prompt,
    ...(Array.isArray(request.history) ? request.history : [])
      .filter(message => message?.role === 'user')
      .slice(-8)
      .map(message => message?.content)
  ].filter(Boolean).join('\n').slice(0, 12_000);
}

function derivePolicyControls(value) {
  const text = normalizedText(value);
  const controls = {};
  if (ANYSEARCH_RE.test(text) && SEARCH_INTENT_RE.test(text) && PRIORITY_RE.test(text)) {
    controls.searchRoute = 'anysearch';
    controls.requiredFirstTool = 'anysearch_cli';
    controls.blockedBeforeRequired = ['yan_browser', 'webfetch', 'websearch'];
  }
  return controls;
}

function isDurableDirective(value) {
  const text = String(value || '').trim();
  return !!text && DURABLE_DIRECTIVE_RE.test(text) && (
    PRIORITY_RE.test(text)
    || DIRECTIVE_ACTION_RE.test(text)
    || /规则|偏好|策略|行为|工具|skill|搜索|search|browser|浏览器/iu.test(text)
  );
}

function extractExplicitPolicyInstruction({ refineInstructions = '', prompt = '', history = [] } = {}) {
  const direct = normalizedText(refineInstructions);
  if (direct) return { text: direct, source: 'scheduled_refinement' };
  const candidates = [
    ...(Array.isArray(history) ? history : [])
      .filter(message => message?.role === 'user')
      .map(message => normalizedText(message?.content)),
    normalizedText(prompt)
  ].filter(Boolean).reverse();
  const text = candidates.find(candidate => isDurableDirective(candidate));
  return text ? { text, source: 'explicit_user_statement' } : null;
}

function isPolicyEntry(entry = {}) {
  if (entry?.metadata?.status === 'rejected') return false;
  if (entry.kind === 'prompt' || entry.kind === 'subagent') return true;
  if (entry.kind !== 'memory') return false;
  const type = String(entry.metadata?.type || '').toLowerCase();
  return ['preference', 'decision', 'procedure'].includes(type)
    && (entry.metadata?.basis === 'explicit_user_statement' || entry.metadata?.enforcement === 'mandatory');
}

function safePolicyEntry(entry = {}) {
  const content = clip(entry.content, 6_000);
  if (!content || containsUnsafeMemoryText(content) || containsSensitiveMemoryText(content)) return null;
  const controls = entry.metadata?.controls && typeof entry.metadata.controls === 'object'
    ? { ...entry.metadata.controls }
    : derivePolicyControls(content);
  return {
    id: String(entry.id || ''),
    kind: String(entry.kind || ''),
    scope: String(entry.scope || 'global'),
    title: clip(entry.title || entry.id, 160),
    content,
    controls,
    metadata: entry.metadata && typeof entry.metadata === 'object' ? { ...entry.metadata } : {},
    updatedAt: Number(entry.updatedAt) || 0
  };
}

function policyScore(entry, query) {
  const queryTokens = new Set(tokenize(query));
  const entryTokens = new Set(tokenize(`${entry.title} ${entry.content}`));
  let score = entry.metadata?.enforcement === 'mandatory' ? 100 : 0;
  if (entry.scope === 'global') score += 10;
  for (const token of queryTokens) if (entryTokens.has(token)) score += token.length >= 4 ? 3 : 1;
  return score + Math.min(0.99, entry.updatedAt / 1e16);
}

function normalizePolicies(entries = [], { query = '', maxChars = POLICY_MAX_CHARS, maxEntries = POLICY_MAX_ENTRIES } = {}) {
  const seen = new Set();
  const policies = (Array.isArray(entries) ? entries : [])
    .filter(isPolicyEntry)
    .map(safePolicyEntry)
    .filter(entry => {
      if (!entry || !entry.id || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .sort((left, right) => policyScore(right, query) - policyScore(left, query));
  const selected = [];
  let used = 0;
  for (const policy of policies.slice(0, Math.max(1, Number(maxEntries) || POLICY_MAX_ENTRIES))) {
    const line = `- [${policy.scope}:${policy.id}] ${policy.content}`;
    if (used + line.length + 1 > maxChars) continue;
    selected.push(policy);
    used += line.length + 1;
  }
  return selected;
}

function policyContext(policies = [], options = {}) {
  return normalizePolicies(policies, options)
    .map(policy => `- [${policy.scope}:${policy.id}] ${policy.content}`)
    .join('\n');
}

function relevantPolicies(policies = [], request = {}) {
  const requestText = policyRequestText(request);
  return normalizePolicies(policies).filter(policy => (
    policy.controls?.searchRoute !== 'anysearch' || isSearchRequest(requestText)
  ));
}

// Read legacy stored responses written before policy acceptance became native.
// New runs never ask the model to produce this marker.
function stripPolicyAcceptanceMarker(value) {
  return String(value || '')
    .replace(/\s*YAN_POLICY_ACCEPTANCE\s*:\s*(?:PASS|REPAIR_REQUIRED|BLOCKED)\s*$/imu, '')
    .trim();
}

function hasAnySearchRoute(policies = [], request = {}) {
  return relevantPolicies(policies, request).some(policy => policy.controls?.searchRoute === 'anysearch');
}

function isAnySearchCommand(value) {
  const text = String(value || '').toLowerCase();
  return ANYSEARCH_RE.test(text) && /(?:search|batch_search|extract|get_sub_domains)/u.test(text);
}

function parsePolicyToolOutput(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').trim();
  if (!text || text.length > 200_000) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
    if (typeof parsed === 'string') return parsePolicyToolOutput(parsed);
  } catch {}
  return null;
}

function anySearchOutputFailed(output) {
  const structured = parsePolicyToolOutput(output);
  if (structured) {
    for (const key of ['structuredContent', 'result', 'data', 'output', 'metadata']) {
      const nested = structured[key];
      if (nested && nested !== structured && anySearchOutputFailed(nested)) return true;
    }
    if (structured.ok === false || structured.success === false) return true;
    if (['error', 'failed', 'cancelled', 'canceled'].includes(String(structured.status || '').toLowerCase())) return true;
    for (const key of ['exitCode', 'exit_code', 'returnCode', 'return_code']) {
      if (Number.isFinite(Number(structured[key])) && Number(structured[key]) !== 0) return true;
    }
    if (structured.error && typeof structured.error === 'object') return true;
    if (typeof structured.error === 'string' && structured.error.trim()) return true;
  }
  const text = String(output || '').trim();
  if (!text) return false;
  return /(?:^|\r?\n)\s*(?:command\s+failed|process\s+exited|exit(?:ed)?\s+(?:with\s+)?(?:code|status)\s*[:=]?\s*[1-9]\d*|npm\s+err!|error\s*:\s*(?:anysearch|search|request|network))/iu.test(text);
}

function anySearchOutputInsufficient(output) {
  const structured = parsePolicyToolOutput(output);
  if (structured) {
    if (['empty', 'no_results', 'no-results', 'insufficient'].includes(String(structured.status || '').toLowerCase())) return true;
    for (const key of ['results', 'items', 'data']) {
      if (Array.isArray(structured[key])) return structured[key].length === 0;
    }
    for (const key of ['structuredContent', 'result', 'output', 'metadata']) {
      const nested = structured[key];
      if (nested && nested !== structured && anySearchOutputInsufficient(nested)) return true;
    }
  }
  return /(?:no\s+results?|0\s+results?|没有(?:找到)?结果|无(?:相关)?结果|结果不足|insufficient\s+results?)/iu.test(String(output || ''));
}

function permissionFamily(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'yan_browser' || text.includes('yan_browser') || text === 'browser') return 'yan_browser';
  if (text === 'webfetch' || text === 'websearch') return text;
  return text;
}

function permissionPatterns(request = {}) {
  const patterns = request.patterns || request.pattern || request.command;
  return (Array.isArray(patterns) ? patterns : [patterns])
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

function bashCommandUsesNetwork(command) {
  const text = String(command || '').toLowerCase();
  if (!text) return false;
  if (/https?:\/\//u.test(text)) return true;
  return /(?:^|[;&|\r\n]\s*|\s)(?:curl|wget|httpie|fetch|websocat|ssh|scp|sftp|ftp|telnet|nslookup|dig|host|ping|tracert|traceroute|invoke-webrequest|invoke-restmethod|iwr|irm|start-bitstransfer|git\s+(?:clone|fetch|pull|push|ls-remote)|npm\s+(?:view|search|install|i|update|publish)|pnpm\s+(?:add|install|update|publish)|yarn\s+(?:add|install|upgrade|publish)|pip\s+(?:install|download)|python\s+-m\s+pip\s+(?:install|download)|(?:node|nodejs)\s+(?:-e|--eval)|python(?:3)?\s+(?:-c|--command)|powershell(?:\.exe)?\s+(?:-command|-c)|pwsh(?:\.exe)?\s+(?:-command|-c)|cmd(?:\.exe)?\s+\/c)\b.*(?:https?|fetch|request|axios|urllib|requests|webclient|socket|net\.|dns)/iu.test(text);
}

function bashCommandIsClearlyLocal(command) {
  const text = String(command || '').trim();
  if (!text || bashCommandUsesNetwork(text)) return false;
  const segments = text.split(/[;&|\r\n]+/u).map(item => item.trim()).filter(Boolean);
  if (!segments.length) return false;
  const localCommand = /^(?:get-(?:content|childitem|item|command|location)|set-location|test-path|resolve-path|select-string|measure-object|compare-object|format-(?:table|list)|out-string|where(?:\.exe)?|rg|findstr|git\s+(?:status|diff|log|show|branch|rev-parse)|node(?:\.exe)?\s+--(?:version|help)|npm(?:\.cmd)?\s+--(?:version|help)|pnpm(?:\.cmd)?\s+--(?:version|help)|yarn(?:\.cmd)?\s+--(?:version|help)|dir|ls|cat|type|pwd|cd)\b/iu;
  return segments.every(segment => localCommand.test(segment));
}

function fallbackAllowed(state = {}, request = {}) {
  if (state.anySearchFailed === true || state.anySearchFallbackEligible === true) return true;
  return state.anySearchSucceeded === true && URL_OR_PAGE_INTENT_RE.test(policyRequestText(request));
}

function policyPermissionDecision({ policies = [], request = {}, state = {}, permission = '', patterns = [] } = {}) {
  if (!hasAnySearchRoute(policies, request)) return null;
  const family = permissionFamily(permission);
  if (family === 'bash') {
    const requestedPatterns = permissionPatterns({ patterns });
    const anySearch = requestedPatterns.length > 0 && requestedPatterns.every(isAnySearchCommand);
    if (anySearch) return { reply: 'once', message: '当前命令是策略要求优先执行的 AnySearch。' };
    const network = requestedPatterns.some(bashCommandUsesNetwork);
    const clearlyLocal = requestedPatterns.length > 0 && requestedPatterns.every(bashCommandIsClearlyLocal);
    if (!network && clearlyLocal) return { reply: 'once', message: '当前 Bash 命令已确认是本地操作。' };
    if (!network && state.anySearchSucceeded !== true && state.anySearchFailed !== true) {
      return {
        reply: 'reject',
        message: '当前搜索任务仅允许明确的本地 Bash 操作；请先调用 AnySearch，未知脚本可能绕过已持久化的搜索策略。'
      };
    }
    if (fallbackAllowed(state, request)) {
      return { reply: 'once', message: 'AnySearch 已先完成或明确不可用，策略允许当前联网回退。' };
    }
    state.blockedBeforeRequiredAttempts = (Number(state.blockedBeforeRequiredAttempts) || 0) + 1;
    return {
      reply: 'reject',
      message: '当前搜索任务必须先调用 AnySearch；不得通过 Bash 网络命令绕过已持久化的搜索策略。'
    };
  }
  if (!['yan_browser', 'webfetch', 'websearch'].includes(family)) return null;
  if (fallbackAllowed(state, request)) {
    return {
      reply: 'once',
      message: 'AnySearch 已先完成或明确不可用，当前策略允许使用回退渠道。'
    };
  }
  state.blockedBeforeRequiredAttempts = (Number(state.blockedBeforeRequiredAttempts) || 0) + 1;
  return {
    reply: 'reject',
    message: '当前任务命中了已持久化的搜索策略：必须先调用 AnySearch；只有 AnySearch 明确不可用或结果不足后，才允许使用浏览器或 webfetch。'
  };
}

function authoritativePolicySystem(policies = [], request = {}) {
  const relevant = relevantPolicies(policies, request);
  if (!relevant.length) return '';
  return [
    'Yan authoritative durable policies:',
    'These policies were persisted from explicit user rules or verified reusable behavior. They are binding for the current task when relevant. Apply them before choosing tools; do not reinterpret a preference as optional. A current explicit user request may supersede a policy, and a policy that cannot be applied must be reported as a concrete limitation.',
    '<yan-authoritative-policies>',
    ...relevant.map(policy => `- [${policy.scope}:${policy.id}] ${policy.content}`),
    '</yan-authoritative-policies>'
  ].join('\n');
}

module.exports = {
  POLICY_MAX_CHARS,
  POLICY_MAX_ENTRIES,
  authoritativePolicySystem,
  derivePolicyControls,
  extractExplicitPolicyInstruction,
  hasAnySearchRoute,
  isAnySearchCommand,
  isDurableDirective,
  isPolicyEntry,
  isSearchRequest,
  normalizePolicies,
  policyContext,
  policyId,
  policyPermissionDecision,
  policyRequestText,
  bashCommandUsesNetwork,
  bashCommandIsClearlyLocal,
  relevantPolicies,
  safePolicyEntry,
  stripPolicyAcceptanceMarker,
  anySearchOutputFailed,
  anySearchOutputInsufficient
};
