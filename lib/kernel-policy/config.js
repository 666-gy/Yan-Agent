'use strict';

const { childReadablePath } = require('../provider-staging');

const { isolateWorkMode } = require('../work-mode-isolation');

const path = require('path');

const { pathToFileURL } = require('url');

const { resolveProviderAdapter } = require('../provider-adapter-routing');

const { endpointInfo, isOfficialOpenAI } = require('../api-endpoint');

const { resolveReasoningForModel } = require('../reasoning-effort');

const gptModelProfile = require('../gpt-model-profile');


const { hasAnySearchRoute } = require('../behavior-policy');

const { isRemoteMcpServer, normalizeRemoteHeaders } = require('../mcp-remote');

const { READ_ONLY_SHELL_ALLOW } = require('../shell-allowlist');

const { MAX_PROVIDER_OUTPUT_TOKENS, DEFAULT_PROVIDER_TIMEOUT_MS, DEFAULT_PROVIDER_CHUNK_TIMEOUT_MS, TOOL_OUTPUT_MAX_LINES, TOOL_OUTPUT_MAX_BYTES } = require('./constants');

function sanitizeId(value, fallback = 'yan') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function sortedMcpServers(servers = []) {
  return [...(Array.isArray(servers) ? servers : [])].sort((left, right) => (
    sanitizeId(left?.id || left?.name, '').localeCompare(sanitizeId(right?.id || right?.name, ''), 'en')
  ));
}

function mcpPermissionForRun(config = {}) {
  const accessMode = String(config.accessMode || 'request');
  const delegated = accessMode === 'delegate' || accessMode === 'full';
  const permissions = config.permissions || {};
  const result = {};
  for (const server of sortedMcpServers(config.mcpServers)) {
    if (!server?.enabled || !server.id) continue;
    if (!server.command) {
      const remoteUrl = String(server.url || '').trim();
      if (!isRemoteMcpServer(server) || !/^https?:\/\//i.test(remoteUrl)) continue;
    }
    const id = sanitizeId(server.id, 'mcp');
    if (server.taskEnabled === false) {
      result[`${id}_*`] = 'deny';
      continue;
    }
    let action = delegated ? 'allow' : 'ask';
    if (server.runtime === 'yan-browser' || id === 'yan-browser') action = 'allow';
    else if (server.runtime === 'yan-session' || id === 'yan-session') action = 'allow';
    else if (server.runtime === 'yan-skills' || id === 'yan-skills') action = 'allow';
    else if (server.runtime === 'yan-media' || id === 'yan-media') {
      action = permissions.allowNetwork === false ? 'deny' : 'allow';
    }
    result[`${id}_*`] = action;
  }
  return result;
}

function permissionForRun(config = {}) {
  config = isolateWorkMode(config);
  const accessMode = String(config.accessMode || 'request');
  const workMode = String(config.workMode || 'normal');
  const permissions = config.permissions || {};
  const delegated = accessMode === 'delegate' || accessMode === 'full';
  const fileRead = permissions.allowFileRead !== false ? 'allow' : 'deny';
  const fileWrite = permissions.allowFileWrite !== false
    ? (delegated ? 'allow' : 'ask')
    : 'deny';
  // A desktop task has a purpose-built native MCP path. Keep the generic
  // shell approval-gated even in Full Access so SendInput/Win32 scripts cannot
  // bypass Yan's coordinate, foreground, and drift guards.
  const searchPolicyActive = hasAnySearchRoute(config.behaviorPolicies, config);
  const shell = searchPolicyActive
    ? 'ask'
    : (config.desktopTask === true ? 'ask' : (accessMode === 'full' ? 'allow' : 'ask'));
  const network = permissions.allowNetwork !== false
    ? (delegated ? 'allow' : 'ask')
    : 'deny';
  // Cross-workspace work is a normal workflow (a sibling copy of the project,
  // another task's workspace): file tools may leave the session workspace, so
  // external directories are always allowed. The session workspace stays the
  // default root for the task, and shell risk stays gated separately.
  const externalDirectory = 'allow';
  const serverTaskEnabled = id => {
    const normalized = sanitizeId(id, '');
    const server = (Array.isArray(config.mcpServers) ? config.mcpServers : [])
      .find(item => sanitizeId(item?.id || item?.name, '') === normalized);
    return !server || server.taskEnabled !== false;
  };
  const routedBrowser = searchPolicyActive ? 'ask' : (serverTaskEnabled('yan_browser') ? 'allow' : 'deny');
  const routedNetwork = searchPolicyActive ? 'ask' : network;
  const builtInMcpPermissions = config.skillOnly
    ? { 'yan_skills_*': 'allow' }
    : {
        'yan_media_*': serverTaskEnabled('yan_media') && permissions.allowNetwork !== false ? 'allow' : 'deny',
        'yan_skills_*': 'allow',
        'yan_analysis_*': serverTaskEnabled('yan_analysis') && permissions.allowFileRead !== false ? 'allow' : 'deny',
        'yan_browser_*': routedBrowser,
        'yan_web_*': serverTaskEnabled('yan_web') ? routedNetwork : 'deny',
        'yan_session_*': serverTaskEnabled('yan_session') ? 'allow' : 'deny',
        'yan_session_intelligent_ui_creator': require('../intelligent-ui').canCreateIntelligentUi(config) ? 'allow' : 'deny'
      };
  const base = {
    'yanp_*': 'deny',
    yan_runtime_log: 'allow',
    plugins_list: 'allow', plugins_inspect: 'allow', plugins_deactivate: 'allow',
    plugins_read_resource: fileRead, plugins_activate: fileRead === 'deny' ? 'deny' : (delegated ? 'allow' : 'ask'),
    plugins_execute: config.skillOnly || workMode === 'plan' || config.sandboxMode === 'read-only' || config.sandboxMode === 'workspace-write' || fileRead === 'deny' || permissions.allowFileWrite === false || permissions.allowNetwork === false ? 'deny' : (delegated ? 'allow' : 'ask'),
    read: fileRead,
    glob: fileRead,
    grep: fileRead,
    list: fileRead,
    lsp: fileRead,
    edit: fileWrite,
    write: fileWrite,
    apply_patch: fileWrite,
    bash: shell,
    // OpenCode's native Task tool creates a child session. Keep it disabled
    // Native delegation is retired; legacy task calls remain denied.
    task: 'deny',
    skill: 'deny',
    todowrite: 'allow',
    question: 'ask',
    webfetch: 'deny',
    websearch: routedNetwork,
    ...mcpPermissionForRun(config),
    ...builtInMcpPermissions,
    yan_web_fetch: serverTaskEnabled('yan_web') ? routedNetwork : 'deny',
    external_directory: externalDirectory,
    // OpenCode's config schema only accepts an action here, not a pattern map.
    // This policy is shared by global and agent config; keep the loop guard on.
    doom_loop: 'ask'
  };
  if (workMode !== 'plan') return require('../agent-sandbox').restrictPermissions(base, config.sandboxMode);
  return require('../agent-sandbox').restrictPermissions({
    ...base,
    edit: 'deny',
    write: 'deny',
    apply_patch: 'deny',
    bash: {
      '*': 'ask',
      ...READ_ONLY_SHELL_ALLOW
    }
  }, config.sandboxMode);
}

function permissionRulesForRun(config = {}) {
  const rules = [];
  for (const [permission, policy] of Object.entries(permissionForRun(config))) {
    if (typeof policy === 'string') {
      rules.push({ permission, pattern: '*', action: policy });
      continue;
    }
    if (!policy || typeof policy !== 'object') continue;
    for (const [pattern, action] of Object.entries(policy)) {
      if (typeof action !== 'string') continue;
      rules.push({ permission, pattern, action });
    }
  }
  return rules;
}



function sessionPermissionForRun(config = {}) {
  // Blank tasks have no user workspace, but they are not read-only: file writes
  // follow the same access mode and sandbox rules as tasks with a workspace.
  // The blank session's execution directory stays the default root, and
  // external directories stay allowed, so nothing here may downgrade
  // edit/write/apply_patch or hide disk tools.
  return permissionRulesForRun(config);
}

function uniqueMcpId(mapped, base) {
  if (!Object.prototype.hasOwnProperty.call(mapped, base)) return base;
  let suffix = 2;
  while (Object.prototype.hasOwnProperty.call(mapped, `${base}-${suffix}`)) suffix += 1;
  // The kernel id is what `activate_mcp_server` and the permission keys match
  // on, so a rename is worth a trace: without it the user sees a connected
  // server whose id no longer appears in the config they wrote.
  console.warn(`[MCP] id "${base}" is used by more than one server; rename to "${base}-${suffix}" so both stay reachable`);
  return `${base}-${suffix}`;
}

function mapMcpServers(servers = []) {
  const mapped = {};
  for (const server of sortedMcpServers(servers)) {
    if (!server?.enabled) continue;
    const id = uniqueMcpId(mapped, sanitizeId(server.id || server.name, `mcp-${Object.keys(mapped).length + 1}`));
    const timeout = Math.max(5_000, Number(server.timeout) || 30_000);
    // Deferred servers are registered but not connected at kernel boot: the
    // model connects them through the on-demand activation tool. `enabled:false`
    // keeps the entry (and its permission rules) present without the boot cost.
    const enabled = server.deferred !== true;
    const remote = isRemoteMcpServer(server);
    if (remote) {
      const url = String(server.url || '').trim();
      if (!/^https?:\/\//i.test(url)) continue;
      const headers = normalizeRemoteHeaders(server.headers);
      mapped[id] = {
        type: 'remote',
        url,
        ...(Object.keys(headers).length ? { headers } : {}),
        enabled,
        timeout
      };
      continue;
    }
    if (!server.command) continue;
    mapped[id] = {
      type: 'local',
      command: [String(server.command), ...(Array.isArray(server.args) ? server.args.map(String) : [])],
      ...(server.cwd ? { cwd: String(server.cwd) } : {}),
      ...(server.env && typeof server.env === 'object' ? { environment: server.env } : {}),
      enabled,
      timeout
    };
  }
  return mapped;
}

function buildOpenCodeConfig(options = {}) {
  const runtimeMcpServers = options.skillOnly
    ? (Array.isArray(options.mcpServers) ? options.mcpServers : [])
      .filter(server => {
        const id = sanitizeId(server?.id || server?.name, '');
        return id === 'yan_skills' || server?.runtime === 'yan-skills';
      })
    : options.mcpServers;
  // Task capability flags control each session's tool surface. They must not
  // enter the process-wide config signature or one concurrent run could force
  // a kernel restart underneath another run.
  const stableRuntimeMcpServers = (Array.isArray(runtimeMcpServers) ? runtimeMcpServers : []).map(server => {
    const { taskEnabled: _taskEnabled, ...stable } = server || {};
    return stable;
  });
  // Per-run desktopTask is consumed by sessionPermissionForRun(request), not
  // by this process-wide config. Strip it here so a desktop/non-desktop pair
  // can reuse the same kernel without a signature-triggered restart.
  const { desktopTask: _desktopTask, ...stableOptions } = options;
  const configOptions = stableOptions.skillOnly
    ? {
        ...stableOptions,
        mcpServers: stableRuntimeMcpServers,

      }
    : { ...stableOptions, mcpServers: stableRuntimeMcpServers };
  const providerID = sanitizeId(options.providerId, 'yan-provider');
  const modelID = String(options.modelId || '').trim();
  const permission = permissionForRun(configOptions);
  const capabilities = options.capabilities || {};
  // The kernel replaces file parts with "Cannot read … does not support" error
  // text whenever input.image is false, so a model the user declared
  // multimodal must have its image input admitted here.
  const imageInputDeclared = !!(capabilities.imageInput || capabilities.vision);
  const contextSettings = require('../context-settings').resolveModelContextSettings(options);
  const contextLimit = contextSettings.maxTokens;
  // Verified automatic budgets and manual overrides may exceed the legacy
  // fallback ceiling. Unknown models retain the existing conservative default.
  const automaticOutputLimit = require('../model-budget-profiles').lookupModelBudget(modelID)?.maxOutputTokens || 0;
  const userOutputLimit = Math.max(0, Number(capabilities.userMaxOutputTokens) || 0);
  const declaredOutputLimit = Math.max(0, Number(capabilities.maxOutputTokens) || 0);
  const outputLimit = Math.max(1, Math.min(
    userOutputLimit || (automaticOutputLimit
      ? declaredOutputLimit || automaticOutputLimit
      : Math.min(declaredOutputLimit || MAX_PROVIDER_OUTPUT_TOKENS, MAX_PROVIDER_OUTPUT_TOKENS)),
    Math.max(1, contextLimit - 1)
  ));
  const modelName = String(options.modelName || modelID || 'Yan model');
  const providerName = String(options.providerName || providerID);
  const apiKey = String(options.apiKey || '').trim();
  const endpoint = endpointInfo(options.baseUrl);
  const baseURL = endpoint.baseURL;
  const modelOptions = {};
  // 阶段 C：按模型/供应商声明的能力映射推理档位；若旧配置没有声明，
  // reasoning-effort 仅使用兼容性后备表。所有映射都显式标记 adjusted，
  // 便于核验实际出站值，电脑操控层本身不绑定任何模型。
  const reasoningResolution = resolveReasoningForModel(options.modelId, options.reasoningSpeed, {
    supported: capabilities.reasoningEffortLevels || capabilities.reasoningEfforts,
    capabilityLabel: modelName
  });
  modelOptions.reasoningEffort = reasoningResolution.effort;
  if (reasoningResolution.adjusted) {
    modelOptions.reasoningEffortAdjusted = {
      requested: reasoningResolution.requested,
      model: reasoningResolution.model
    };
  }

  // An explicit `dsml` flag comes from a user connection whose adapter preset
  // resolved to deepseek; name/model inference stays as the automatic path.
  const adapter = resolveProviderAdapter(options, { providerID, providerName, modelID, baseURL });
  const usesJiyuan = adapter === 'jiyuan';
  const usesDeepSeekDsml = adapter === 'deepseek';
  const usesGlmm = adapter === 'glm';
  const usesQwem = adapter === 'qwen';
  const usesKiml = adapter === 'kimi';
  const requestedApiFormat = String(options.apiFormat || 'auto').trim().toLowerCase();
  const usesGptl = adapter === 'gptl';
  const usesAgnl = adapter === 'agnes';
  const usesGeml = adapter === 'gemini';
  const usesGrol = adapter === 'grok';
  // Any Messages connection gets the cache-breakpoint layer, including a relay
  // whose model id names nothing Anthropic-like.
  (adapter === 'anthropic');
  const vendorAdapter = usesAgnl ? 'agnl' : usesGeml ? 'geml' : usesGrol ? 'grol' : '';
  const vendorModule = vendorAdapter ? String(options[`${vendorAdapter}ProviderModule`] || '').trim()
    || pathToFileURL(childReadablePath(path.join(__dirname, '..', `opencode-${vendorAdapter}-provider.mjs`))).href : '';
  const effectiveFormat = ['openai', 'responses', 'anthropic'].includes(requestedApiFormat)
    ? requestedApiFormat : (endpoint.format || 'openai');
  const apiFormat = effectiveFormat;
  const stagedModule = (option, file) => String(options[option] || '').trim()
    || pathToFileURL(childReadablePath(path.join(__dirname, '..', file))).href;
  const antlModule = stagedModule('antlProviderModule', 'opencode-antl-provider.mjs');
  const yanOpenAIProviderModule = stagedModule('deepSeekProviderModule', 'opencode-dsml-provider.mjs');
  const yanResponsesProviderModule = String(options.responsesProviderModule || '').trim();
  const yanGptlProviderModule = String(options.gptlProviderModule || '').trim();
  const yanGlmmProviderModule = stagedModule('glmmProviderModule', 'opencode-glmm-provider.mjs');
  const yanQwemProviderModule = stagedModule('qwemProviderModule', 'opencode-qwem-provider.mjs');
  const yanKimlProviderModule = stagedModule('kimlProviderModule', 'opencode-kiml-provider.mjs');
  const yanJiyuanProviderModule = stagedModule('jiyuanProviderModule', 'opencode-jiyuan-provider.mjs');
  if (apiFormat === 'responses' && !usesGptl && !yanResponsesProviderModule) throw new Error('OpenAI Responses provider module is missing.');
  if (usesGptl && apiFormat !== 'anthropic' && !yanGptlProviderModule) throw new Error('GPTL provider module is missing.');
  const gptlProfile = gptModelProfile.profileFor(modelID);
  const gptlNeedsResponsesRoute = gptlProfile.kind !== 'unknown'
    && (gptlProfile.requiresResponsesForTools === true
      || gptlProfile.toolsOnChat === false
      || gptlProfile.chatEndpoint === false);
  const gptlHostEligible = isOfficialOpenAI(baseURL);
  // Adapter selection and the wire protocol are independent; automatic official
  // GPT routing happens only when no explicit protocol or endpoint was set.
  const useGptlModule = (usesGptl && apiFormat !== 'anthropic')
    || (apiFormat === 'openai'
      && !!yanGptlProviderModule
      && !usesGlmm
      && !usesDeepSeekDsml
      && !usesQwem
      && !usesKiml
      && !vendorAdapter
      && gptlNeedsResponsesRoute
      && gptlHostEligible);
  let providerBaseURL = baseURL;
  if (apiFormat === 'anthropic' && providerBaseURL && !/\/v\d+(beta\d*)?$/i.test(providerBaseURL)) {
    providerBaseURL += '/v1';
  }
  const provider = modelID ? {
    [providerID]: {
      name: providerName,
      // The official SDK still implements the protocol; ANTL only supplies the
      // fetch layer that places the cache breakpoints the SDK leaves to its caller.
      npm: apiFormat === 'anthropic'
        ? antlModule
        : (usesJiyuan ? yanJiyuanProviderModule
          : useGptlModule ? yanGptlProviderModule
          : apiFormat === 'responses' ? yanResponsesProviderModule
          : usesGlmm ? yanGlmmProviderModule
          : usesQwem ? yanQwemProviderModule
          : usesKiml ? yanKimlProviderModule
          : vendorModule || yanOpenAIProviderModule),
      options: {
        ...(apiKey ? { apiKey } : {}),
        ...(providerBaseURL ? { baseURL: providerBaseURL } : {}),
        // 部分 Anthropic 兼容网关（如火山方舟）只认 Bearer，双头并行提升兼容性
        ...(apiFormat === 'anthropic' && apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
        ...(useGptlModule
          ? { apiFormat: ['auto', 'gptl'].includes(requestedApiFormat) && !endpoint.format && gptlHostEligible ? 'auto' : apiFormat }
          : (usesJiyuan ? {}
            : (apiFormat === 'anthropic' ? { yanAntlCompatibility: true }
            : (apiFormat === 'openai'
              ? (usesGlmm ? { yanGlmmCompatibility: true } : usesQwem ? { yanQwemCompatibility: true }
                : usesKiml ? { yanKimlCompatibility: true } : vendorAdapter ? {} : { yanDsmlCompatibility: usesDeepSeekDsml })
              : {})))),
        timeout: DEFAULT_PROVIDER_TIMEOUT_MS,
        headerTimeout: Math.max(1, Number(configOptions.responseTimeoutMinutes) || 2) * 60 * 1000,
        chunkTimeout: DEFAULT_PROVIDER_CHUNK_TIMEOUT_MS
      },
      models: {
        [modelID]: {
          id: modelID,
          name: modelName,
          reasoning: capabilities.reasoning !== false,
          ...((usesGlmm || usesDeepSeekDsml || usesQwem || usesKiml || usesAgnl || usesGeml || usesGrol || (usesGptl && !gptlHostEligible)) && apiFormat === 'openai' ? { interleaved: { field: 'reasoning_content' } } : {}),
          attachment: imageInputDeclared,
          tool_call: true,
          modalities: {
            input: imageInputDeclared ? ['text', 'image'] : ['text'],
            output: ['text']
          },
          limit: {
            context: contextLimit,
            input: contextLimit,
            output: outputLimit
          },
          ...(Object.keys(modelOptions).length ? { options: modelOptions } : {})
        }
      }
    }
  } : {};

  const skillReaderTools = Object.fromEntries([
    'read', 'glob', 'grep', 'list', 'lsp', 'edit', 'write', 'apply_patch',
    'bash', 'task', 'question', 'todowrite', 'webfetch', 'websearch',
    'yan_skills_read_skill', 'yan_skills_read_skill_resource', 'yan_skills_read_skill_resources'
  ].map(tool => [tool, false]));
  // NOTE: nothing per-run (task ids, measured speeds) may be embedded in the
  // agent prompts below. This whole object feeds configSignature(); any
  // per-run value here restarts the OpenCode server between tasks and makes
  // concurrent tasks fail with "configuration changed". Per-run values live
  // in the current user message (turnContextSystem) instead.
  return {
    autoupdate: false,
    plugin: [(() => {
      const module = String(options.codingEnvironmentModule || pathToFileURL(childReadablePath(path.join(__dirname, '..', 'coding-environment-plugin.bundle.mjs'))).href);
      const url = new URL(module);
      url.searchParams.set('yanComputerImageInput', String(imageInputDeclared));
      if (options.terminalShell) url.searchParams.set('yanShell', options.terminalShell);
      if (options.sandboxMode && options.sandboxMode !== 'full') url.searchParams.set('yanSandbox', options.sandboxMode);
      return url.href;
    })()],
    share: 'disabled',
    // Kernel-side auto-formatting reruns a project formatter and re-reads the
    // file after every edit/write, which dominates fast consecutive mutations.
    // Yan's mutation prompt already instructs the model to run project
    // formatters explicitly when formatting is required, so the fast path can
    // skip the automatic pass. Config-level (not per-run) on purpose: this
    // object feeds configSignature() and a per-run value would restart the
    // kernel underneath concurrent runs.
    ...(options.disableKernelFormatter === true || (options.sandboxMode && options.sandboxMode !== 'full') ? { formatter: false } : {}),
    model: modelID ? `${providerID}/${modelID}` : undefined,
    default_agent: 'build',
    provider,
    mcp: mapMcpServers(stableRuntimeMcpServers),
    skills: { paths: [] },
    agent: {
      build: {
        permission,
        tools: { task: false, subagent: false }
      },
      plan: { permission: permissionForRun({ ...configOptions, workMode: 'plan' }) },
      'skill-reader': {
        mode: 'primary',
        hidden: true,
        description: 'One-step reader for explicitly selected Skill documents.',
        maxSteps: 1,
        tools: skillReaderTools,
        permission: Object.fromEntries(Object.keys(permission).map(key => [key, 'deny']))
      },
    },
    permission,
    tool_output: {
      max_lines: TOOL_OUTPUT_MAX_LINES,
      max_bytes: TOOL_OUTPUT_MAX_BYTES
    },
    compaction: {
      auto: true,
      prune: true,
      threshold: contextSettings.compactionThreshold,
      tail_turns: 6,
      preserve_recent_tokens: 24_000,
      reserved: 24_000
    }
  };
}

const COMPACTION_ANCHOR_MAX_CHARS = 1_600;

module.exports = { sanitizeId, sortedMcpServers, mcpPermissionForRun, permissionForRun, permissionRulesForRun,  sessionPermissionForRun, uniqueMcpId, mapMcpServers, buildOpenCodeConfig, COMPACTION_ANCHOR_MAX_CHARS };
