'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { sessionPermissionForRun } = require('../kernel-policy');
const { childReadablePath } = require('../provider-staging');
const actionFor = action => ({ apply_patch: 'edit', patch: 'edit', write: 'edit', bash: 'shell', task: 'subagent' })[action] || action;

// OpenCode's native shell tool picks pwsh first on Windows unless the config
// names a shell. Yan's own bash tool honors the user's Git Bash preference, so
// an unset native shell makes the model-facing description disagree with the
// executor. Name the same shell family here; OpenCode still falls back when it
// is unavailable.
function configuredShell(input = {}) {
  if (process.platform !== 'win32') return undefined;
  const preference = (Array.isArray(input.plugin) ? input.plugin : []).map(value => {
    try { return new URL(String(value)).searchParams.get('yanShell') || ''; } catch { return ''; }
  }).find(Boolean) || '';
  if (preference === 'git-bash') return 'bash';
  return ['pwsh', 'powershell', 'cmd'].includes(preference) ? preference : 'bash';
}

function rules(permission = {}) {
  return Object.entries(permission).flatMap(([action, value]) => typeof value === 'string'
    ? [{ action: actionFor(action), resource: '*', effect: value }]
    : Object.entries(value || {}).map(([resource, effect]) => ({ action: actionFor(action), resource, effect })));
}

function permissions(request) {
  return [...basePermissions(request), { action: 'yan_connect', resource: '*', effect: request.utility ? 'deny' : 'allow' }];
}
function basePermissions(request) {
  if (request.customAgent) {
    const base = basePermissions({ ...request, customAgent: null });
    return [...base,
      { action: 'yan_custom_agent_mode', resource: '*', effect: 'allow' },
      ...(request.customAgent.tools || []).map(tool => ({ action: `yan_custom_tool.${tool}`, resource: '*', effect: 'allow' }))
    ];
  }
  if (require('../creative-agent').isCreative(request)) {
    const base = basePermissions({ ...request, agentPreset: 'standard' });
    const network = request.permissions?.allowNetwork === false ? 'deny'
      : ['full', 'delegate'].includes(request.accessMode) ? 'allow' : 'ask';
    return [...base,
      { action: 'anysearch', resource: '*', effect: network },
      { action: 'yan_creative_mode', resource: '*', effect: 'allow' }
    ];
  }
  if (require('../daily-agent').isDaily(request)) return require('../daily-agent').permissions(request);
  if (require('../voice-call-agent').isVoiceCall(request)) {
    const base = basePermissions({ ...request, utilityKind: '' });
    return [{ action: '*', resource: '*', effect: 'deny' },
      { action: 'yan_media_read_image', resource: '*', effect: request.permissions?.allowFileRead === false || request.permissions?.allowNetwork === false ? 'deny' : 'allow' },
      { action: 'websearch', resource: '*', effect: request.permissions?.allowNetwork === false ? 'deny' : 'allow' },
      ...base.filter(rule => ['shell', 'yan_media_read_image', 'external_directory', 'doom_loop'].includes(rule.action))];
  }
  if (request.utility && request.utilityKind === 'prompt-suggestion') return [{ action: '*', resource: '*', effect: 'deny' }];
  return [
    { action: '*', resource: '*', effect: 'ask' },
    ...sessionPermissionForRun(request).map(rule => ({ action: actionFor(rule.permission), resource: rule.pattern, effect: rule.action })),
    ...(!request.utility && [undefined, null, 'standard', 'uncensored'].includes(request.agentPreset)
      ? [{ action: 'yan_agent_creation', resource: '*', effect: 'allow' }] : []),
    ...(request.sandboxMode && request.sandboxMode !== 'full' ? [{ action: `yan_sandbox_${request.sandboxMode}`, resource: '*', effect: 'deny' }] : []),
    ...(request.browserAnnotation === true ? [] : [{ action: 'yan_browser_browser_apply_annotation', resource: '*', effect: 'deny' }]),
    // These V2 tools can bypass Yan's workspace/task ownership bridge.
    ...['session_move', 'worktree_*', 'session_*', 'task'].map(action => ({ action, resource: '*', effect: 'deny' })),
    { action: 'subagent', resource: '*', effect: 'deny' },
    { action: 'yan_delegate', resource: '*', effect: !request.utility && [undefined, null, 'standard', 'uncensored'].includes(request.agentPreset) ? 'allow' : 'deny' },
    // Disable Code Mode through the upstream switch, including its catalog instructions.
    { action: 'execute', resource: '*', effect: 'deny' }
  ];
}

// V2 compacts when the context reaches `window - buffer` and has no threshold
// field, so Yan's per-model threshold is expressed as the buffer below the window.
function compaction(input) {
  const source = input.compaction || {};
  const [providerID, ...rest] = String(input.model || '').split('/');
  const limit = input.provider?.[providerID]?.models?.[rest.join('/')]?.limit || {};
  const window = Number(limit.input || limit.context) || 0;
  const threshold = Number(source.threshold) || 0;
  const buffer = window > 0 && threshold > 0 && threshold < window ? window - threshold : Number(source.reserved) || 0;
  return {
    auto: source.auto !== false,
    ...(buffer > 0 ? { buffer } : {}),
    ...(source.preserve_recent_tokens ? { keep: { tokens: source.preserve_recent_tokens } } : {})
  };
}

function translateConfig(input = {}) {
  const { yanMediaEnvironment, ...coreInput } = input;
  input = coreInput;
  // The desktop already gates network tools through session permissions.
  // Without a selection V2 asks its own onboarding form on fresh stores,
  // occupying the same UI as model questions. Preserve explicit opt-outs.
  // V2 accepts only `false` or `{ provider }`; a bare string is rejected by
  // its config schema, which would leave the onboarding form active.
  const websearch = typeof input.websearch === 'string'
    ? { provider: input.websearch }
    : input.websearch ?? { provider: 'random' };
  if (input.providers) return { ...input, shell: input.shell || configuredShell(input), websearch, plugins: [pathToFileURL(childReadablePath(path.join(__dirname, input.yanVoiceCall ? 'plugin/voice-call.js' : input.yanCreativeMode ? 'plugin/creative' : input.yanDailyMode ? 'plugin/daily' : input.yanMinimalMode ? 'plugin/minimal' : 'plugin'))).href] };
  const providers = Object.fromEntries(Object.entries(input.provider || {}).map(([id, provider]) => [id, {
    name: provider.name,
    package: `aisdk:${provider.npm}`,
    settings: provider.options || {},
    models: Object.fromEntries(Object.entries(provider.models || {}).map(([modelID, model]) => [modelID, {
      modelID: model.id || modelID, name: model.name, limit: model.limit,
      capabilities: { tools: model.tool_call !== false, input: model.modalities?.input || ['text'], output: ['text'] },
      // V1 options are SDK settings, not a raw HTTP body overlay. V2 applies
      // body overlays AFTER the adapter fetch, bypassing all wire shaping.
      // Keep reasoningEffort in settings so the SDK emits reasoning_effort;
      // the adjustment receipt belongs only to Yan's UI.
      settings: Object.fromEntries(Object.entries(model.options || {})
        .filter(([key]) => key !== 'reasoningEffortAdjusted'))
    }]))
  }]));
  const servers = Object.fromEntries(Object.entries(input.mcp || {}).map(([id, server]) => {
    const { enabled, timeout, ...rest } = server;
    return [id, { ...rest, disabled: enabled === false, codemode: false,
      ...(timeout ? { timeout: { startup: timeout, catalog: timeout, execution: timeout } } : {}) }];
  }));
  return {
    model: input.model, default_agent: 'build', providers, websearch, mcp: { servers },
    shell: configuredShell(input),
    plugins: [pathToFileURL(childReadablePath(path.join(__dirname, input.yanVoiceCall ? 'plugin/voice-call.js' : input.yanCreativeMode ? 'plugin/creative' : input.yanDailyMode ? 'plugin/daily' : input.yanMinimalMode ? 'plugin/minimal' : 'plugin'))).href],
    agents: Object.fromEntries(Object.entries(input.agent || { build: {} }).map(([id, agent]) => [id, {
      ...(agent.mode ? { mode: agent.mode } : {}), ...(agent.description ? { description: agent.description } : {}),
      ...(agent.prompt ? { system: agent.prompt } : {}), ...(agent.model ? { model: agent.model } : {}),
      ...(agent.maxSteps ? { steps: agent.maxSteps } : {}), ...(agent.hidden !== undefined ? { hidden: agent.hidden } : {}),
      permissions: rules(agent.permission)
    }])),
    ...(input.compaction ? { compaction: compaction(input) } : {}),
    skills: [], formatter: false, snapshots: true, update: 'disable', share: 'disabled'
  };
}
module.exports = { translateConfig, permissions };
