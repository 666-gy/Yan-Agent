'use strict';

// MCP runtime configuration (plan T5.3): the OpenCode MCP surface, the MCP
// management view and the runtime config signature. Moved verbatim from
// main.js; stores and the bundle builders arrive through dependencies.

const workspaceSandbox = require('../workspace-sandbox');
const { getModelType } = require('../model-roles');
const playwrightRuntime = require('../playwright-runtime');
const { isRemoteMcpServer } = require('../mcp-remote');
const { measurementKey } = require('../input-throughput');
const { readMagpieConfig } = require('../magpie-config');
const {
  buildOpenCodeConfig,
  stageDeepSeekProviderModule,
  stageCodingEnvironmentModule,
  stageGlmmProviderModule,
  stageQwemProviderModule,
  stageKimlProviderModule,
  stageJiyuanProviderModule,
  stageGptlProviderModule,
  stageAgnlProviderModule,
  stageGemlProviderModule,
  stageGrolProviderModule,
  stageAntlProviderModule,
  stageResponsesProviderModule
} = require('../kernel-policy');

function createMcpRuntimeConfig(deps) {
  const {
    providerConfig,
    MODEL_PROVIDERS,
    dataDir,
    appRoot,
    mcpServers,
    configStore,
    modelState,
    skillsDir,
    getMergedSkills,
    mcpServerBuilders,
    DEFAULT_INPUT_TOKENS_PER_SECOND,
    normalizeInputTokensPerSecond
  } = deps;
  const {
    buildYanMediaEnvironment,
    buildYanSkillsMcpServer,
    buildYanBrowserMcpServer,
    buildYanWebMcpServer,
    buildYanSessionMcpServer,
    buildYanHarnessMcpServer,
    buildYanAnalysisMcpServer,
    buildYanWorkspaceMcpServer,
    buildYanMcpServer,
    buildYanPluginMcpServer,
    buildYanProviderMcpServer,
  } = mcpServerBuilders;

  function selectedSkillIds(skills) {
    return new Set((Array.isArray(skills) ? skills : []).map(skill => (
      String(skill?.id || skill || '').trim().toLowerCase()
    )).filter(Boolean));
  }

  // `requires` arrives from the manifest in two shapes: a plain string, or
  // `{ kind, match }`. Normalizing here keeps the prompt renderer and the
  // enforcement check reading the same thing.
  function skillRequirements(skill) {
    return (Array.isArray(skill?.requires) ? skill.requires : []).map(requirement => {
      if (typeof requirement === 'string') {
        const [rawKind, ...rest] = requirement.split(':');
        const match = rest.join(':').trim();
        return match
          ? { kind: rawKind.trim().toLowerCase(), match: String(match).toLowerCase() }
          : { kind: '', match: rawKind.trim().toLowerCase() };
      }
      const kind = String(requirement?.kind || '').trim().toLowerCase();
      const match = String(requirement?.match || '').trim().toLowerCase();
      return { kind, match };
    }).filter(requirement => requirement.match);
  }

  // A requirement matches an MCP server when the manifest's token appears as a
  // whole component of either the server id or its display name -- so
  // `match: "serena"` matches `mcp_default_serena`. Substring matching is avoided:
  // requirement for `web` must not be satisfied by an unrelated `webdav` server.
  function mcpServerMatches(server, match) {
    const componentsIn = value => String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return componentsIn(server?.id).includes(match) || componentsIn(server?.name).includes(match);
  }

  // Returns the requirements of `skill` that this run cannot satisfy. Only
  // `kind: "mcp"` is judged: a `kind: "command"` requirement ("ffmpeg",
  // "node>=22") describes the machine, not the run, and probing for it here
  // would guess at an environment the run itself will discover. A disabled
  // server counts as missing; a server trimmed by task capability does not, or
  // a workspace-less run would drop every code Skill the user picked.
  function unmetSkillRequirements(skill, servers) {
    const list = Array.isArray(servers) ? servers : [];
    return skillRequirements(skill).filter(requirement => {
      if (requirement.kind !== 'mcp') return false;
      const candidates = list.filter(server => mcpServerMatches(server, requirement.match));
      if (!candidates.length) return true;
      return !candidates.some(server => server?.enabled !== false);
    });
  }

  function inferMcpTaskCapabilities(options = {}) {
    // Per-run MCP trimming may only react to construction-level facts about
    // what this run physically has — never to prompt or attachment content.
    // Keyword guessing cannot be exhaustive (v1.6.0 regression: "画一张海报"
    // missed the media list and the session was silently denied yan_media
    // mid-conversation), and a wrong deny is a hard capability loss, so
    // intent-derived trimming is forbidden. Builtins already gate their own
    // existence at build time (media models configured, browser bridge ready,
    // desktop on win32); the only exact trim left is workspace indexers
    // (serena/playwright e2e) in runs that have no workspace.
    if (!Object.prototype.hasOwnProperty.call(options, 'workspace')) {
      return { media: true, browser: true, session: true, desktop: true, code: true, playwright: true };
    }
    const hasWorkspace = !!workspaceSandbox.normalizeWorkspace(options.workspace);
    return {
      media: true,
      browser: true,
      session: true,
      desktop: true,
      code: hasWorkspace,
      playwright: hasWorkspace
    };
  }

  function isDesktopTaskRequest({ prompt = '' } = {}) {
    const text = String(prompt || '').toLowerCase();
    // This is intentionally narrower than desktop MCP capability exposure:
    // the desktop server stays available for every run, but only an explicit
    // desktop/software intent downgrades the otherwise full-access shell.
    return /电脑|桌面|窗口|软件|应用|鼠标|键盘|点开|点击|拖拽|播放歌曲|打开(?:波点音乐|记事本|计算器|浏览器)|computer\s*use|desktop\s*(?:task|control)|gui\s*(?:task|automation)|open\s+(?:the\s+)?(?:app|window)/i.test(text);
  }

  function withTaskCapability(server, enabled) {
    return server ? { ...server, taskEnabled: enabled !== false } : server;
  }

  // Every configured MCP is an external process and potentially heavy (npx
  // download, binary install, language server), so none of them connect at
  // kernel boot. The entry stays registered — permissions and the management
  // view are unchanged — and the model connects it on demand through
  // yan_mcp_activate_mcp_server. Deferral is unconditional so the shared config
  // signature never varies by run.
  function withDeferred(server) {
    return server ? { ...server, deferred: true } : server;
  }

  function getOpenCodeMcpServers(cfg, options = {}) {
    const childAppRoot = providerConfig.getChildReadableAppRoot();
    if (options.skillOnly) {
      return [buildYanSkillsMcpServer(cfg, childAppRoot, options)];
    }
    const capabilities = inferMcpTaskCapabilities(options);
    const servers = (cfg.mcpServers || []).flatMap(server => {
      // Retire the former standalone registration; desktop tools now activate
      // through the session-scoped Yan Computer Use plugin.
      if (server?.id === 'yan_media' || server?.runtime === 'yan-media') return [];
      if (server?.id === 'yan_computer' || server?.runtime === 'yan-computer') return [];
      if (server?.runtime === 'serena' || server?.id === 'mcp_default_serena') return [];
      const id = String(server?.id || '');
      if (id === 'mcp_default_playwright' || server?.runtime === 'playwright') {
        const resolved = playwrightRuntime.resolveServer(server, appRoot, dataDir);
        return [withTaskCapability(withDeferred(resolved.ok ? resolved.server : { ...server, runtime: 'playwright' }), capabilities.playwright)];
      }
      return [withTaskCapability(withDeferred(server), true)];
    });
    servers.push(withTaskCapability(buildYanSkillsMcpServer(cfg, childAppRoot, options), true));
    const browserServer = buildYanBrowserMcpServer(cfg, childAppRoot);
    if (browserServer) servers.push(withTaskCapability(browserServer, capabilities.browser));
    const sessionServer = buildYanSessionMcpServer(childAppRoot);
    if (sessionServer) servers.push(withTaskCapability(sessionServer, capabilities.session));
    const harnessServer = buildYanHarnessMcpServer(childAppRoot, options);
    // Self-evolution is opt-in per run: outside its own work mode the Harness
    // tools are denied for the session. taskEnabled stays out of the shared
    // config signature, so switching modes never restarts the kernel.
    if (harnessServer) servers.push(withTaskCapability(harnessServer, options.evolutionMode !== false));
    // Unconditional: the server is lightweight, workspace-less until called, and
    // its presence must not vary with run capabilities (the OpenCode config
    // signature has to stay identical across tasks).
    servers.push(withTaskCapability(buildYanAnalysisMcpServer(cfg, childAppRoot), true));
    servers.push(withTaskCapability(buildYanWorkspaceMcpServer(cfg, childAppRoot), true));
    // Unconditional like yan_analysis: the tool process stays workspace-less
    // until call time, and the shared kernel signature must not vary by run.
    servers.push(withTaskCapability(buildYanWebMcpServer(cfg, childAppRoot), true));
    // Natural-language MCP installation stays available in every run for the
    // same signature-stability reason; the MCP-Puller Skill carries the policy
    // and is auto-loaded whether or not the user selected it.
    servers.push(withTaskCapability(buildYanMcpServer(cfg, childAppRoot), true));
    // Natural-language plugin installation and marketplace management, kept
    // available in every run for the same config-signature reason.
    servers.push(withTaskCapability(buildYanPluginMcpServer(cfg, childAppRoot), true));
    // Natural-language provider setup. The server itself only talks to the
    // authenticated local bridge; the bridge port is stable for the app run, so
    // the shared config signature does not vary by task.
    const providerServer = buildYanProviderMcpServer(cfg, childAppRoot);
    if (providerServer) servers.push(withTaskCapability(providerServer, true));
    return servers;
  }

  function getMcpManagementServers(cfg) {
    const servers = getOpenCodeMcpServers(cfg, { includeInactiveSerena: true });
    const unavailableSystemServers = [];


    if (!servers.some(server => server.id === 'yan_browser')) {
      unavailableSystemServers.push({
        id: 'yan_browser',
        name: 'Yan Built-in Browser',
        description: '控制 Yan 右侧可见的内置浏览器，用于网页阅读、交互与视觉验收。',
        runtime: 'yan-browser',
        enabled: false,
        available: false,
        unavailableReason: '内置浏览器桥接尚未就绪',
        builtin: true,
        systemManaged: true
      });
    }

    if (!servers.some(server => server.id === 'yan_session')) {
      unavailableSystemServers.push({
        id: 'yan_session',
        name: 'Yan Session',
        description: '在用户明确授权后进入另一工作区的最新 Yan 任务；目标工作区没有任务时才创建并交接上下文。',
        runtime: 'yan-session',
        enabled: false,
        available: false,
        unavailableReason: '会话桥接尚未就绪',
        builtin: true,
        systemManaged: true
      });
    }

    return [...servers, ...unavailableSystemServers].map(server => ({
      id: String(server.id || ''),
      name: String(server.name || server.id || ''),
      description: String(server.description || ''),
      command: server.systemManaged ? '' : String(server.command || ''),
      args: server.systemManaged ? [] : (Array.isArray(server.args) ? server.args.map(String) : []),
      enabled: !!server.enabled,
      available: server.available !== false,
      unavailableReason: String(server.unavailableReason || ''),
      builtin: !!server.builtin,
      systemManaged: !!server.systemManaged,
      runtime: String(server.runtime || ''),
      sourceVersion: String(server.sourceVersion || ''),
      // Management views distinguish configured servers from live connections.
      status: server.systemManaged
        ? (server.available === false ? '不可用' : (server.deferred === true ? '按需加载' : '随任务启动'))
        : (mcpServers.has(String(server.id || '')) ? 'connected' : (server.type === 'remote' ? '远程 · 按需连接' : 'stopped')),
      type: server.type === 'remote' ? 'remote' : 'local',
      url: server.type === 'remote' ? String(server.url || '') : '',
      headerCount: server.type === 'remote' && server.headers && typeof server.headers === 'object'
        ? Object.keys(server.headers).length
        : 0
    }));
  }

  function getMcpServerConfig(cfg, id) {
    return getOpenCodeMcpServers(cfg, { includeInactiveSerena: true }).find(server => server.id === id) || null;
  }

  // `options.selection` lets a caller (Side Chat) request a text model that is
  // independent from the active Agent model without writing anything back to the
  // config. An unconfigured or unknown request falls back to the Agent model.
  function resolveRequestedTextSelection(cfg, requested) {
    const agentSelection = modelState.normalizeAgentModelSelection(cfg);
    const providerId = String(requested?.providerId || '').trim();
    const modelId = String(requested?.modelId || '').trim();
    if (!providerId || !modelId || !MODEL_PROVIDERS[providerId]) return agentSelection;
    const requestedSupplierId = String(requested?.supplierId || '').trim()
      || providerConfig.getRoleSupplierId(cfg, 'text', providerId);
    const supplier = providerConfig.getProviderSupplier(cfg, providerId, requestedSupplierId);
    if (!supplier || !providerConfig.isConfiguredSupplier(cfg, providerId, supplier)) return agentSelection;
    const model = providerConfig.getProviderModels(cfg, providerId, supplier.id)
      .find(item => item.id === modelId && getModelType(providerId, item) === 'text');
    if (!model) return agentSelection;
    return {
      providerId,
      supplierId: supplier.id,
      modelId: model.id,
      modelType: 'text',
      name: model.name || model.id,
      capabilities: model.capabilities || {}
    };
  }

  function getOpenCodeRuntimeConfig(cfg = configStore.loadConfig(), options = {}) {
    const magpie = Object.prototype.hasOwnProperty.call(options, 'magpie')
      ? options.magpie : readMagpieConfig(dataDir);
    const selection = magpie?.selection || (options.selection
      ? resolveRequestedTextSelection(cfg, options.selection)
      : modelState.normalizeAgentModelSelection(cfg));
    const providerId = selection.providerId || cfg.api?.provider;
    const provider = MODEL_PROVIDERS[providerId] || { id: providerId, name: providerId };
    const connection = magpie?.connection || providerConfig.getProviderConnectionForSupplier(cfg, providerId, selection.supplierId);
    const model = magpie ? { ...selection, contextWindow: magpie.contextWindow }
      : providerConfig.getProviderModels(cfg, providerId, selection.supplierId).find(item => item.id === selection.modelId) || selection;
    // One relay can host several vendors, so the vendor adapter follows the
    // model the user selected in the composer, not the connection alone.
    const adapterPreset = magpie ? '' : providerConfig.providerAdapterPreset(cfg, providerId, selection.modelId);
    const runtimeConfig = buildOpenCodeConfig({
      providerId,
      providerName: magpie ? 'Magpie' : provider.name || providerId,
      modelId: selection.modelId,
      modelName: model.name || selection.name || selection.modelId,
      capabilities: model.capabilities || selection.capabilities || {},
      contextWindow: model.contextWindow || model.capabilities?.contextWindow,
      compactionThreshold: model.compactionThreshold || model.capabilities?.compactionThreshold,
      apiKey: connection.apiKey,
      baseUrl: connection.baseUrl,
      apiFormat: magpie?.apiFormat || provider.apiFormat || 'openai',
      // Explicit vendor signal for user connections: the preset resolved from
      // the selected model, falling back to the connection's own preset and
      // name. The sidecar keeps its own model inference as a second net.
      dsml: adapterPreset === 'deepseek' ? true : undefined,
      glmm: adapterPreset === 'glm' ? true : undefined,
      qwem: adapterPreset === 'qwen' ? true : undefined,
      kiml: adapterPreset === 'kimi' ? true : undefined,
      jiyuan: adapterPreset === 'jiyuan' ? true : undefined,
      gptl: adapterPreset === 'gptl' ? true : undefined,
      agnl: adapterPreset === 'agnes' ? true : undefined,
      geml: adapterPreset === 'gemini' ? true : undefined,
      grol: adapterPreset === 'grok' ? true : undefined,
      antl: adapterPreset === 'anthropic' ? true : undefined,
      // Magpie translates vendors itself; never infer a vendor wire adapter
      // from a routed model's name (including group ids containing slashes).
      ...(magpie ? { dsml: false, glmm: false, qwem: false, kiml: false, jiyuan: false,
        gptl: false, agnl: false, geml: false, grol: false, antl: false } : {}),
      deepSeekProviderModule: stageDeepSeekProviderModule({ appRoot, dataDir }),
      codingEnvironmentModule: stageCodingEnvironmentModule({ appRoot, dataDir }),
      glmmProviderModule: stageGlmmProviderModule({ appRoot, dataDir }),
      qwemProviderModule: stageQwemProviderModule({ appRoot, dataDir }),
      kimlProviderModule: stageKimlProviderModule({ appRoot, dataDir }),
      jiyuanProviderModule: stageJiyuanProviderModule({ appRoot, dataDir }),
      responsesProviderModule: stageResponsesProviderModule({ appRoot, dataDir }),
      gptlProviderModule: stageGptlProviderModule({ appRoot, dataDir }),
      agnlProviderModule: stageAgnlProviderModule({ appRoot, dataDir }),
      gemlProviderModule: stageGemlProviderModule({ appRoot, dataDir }),
      grolProviderModule: stageGrolProviderModule({ appRoot, dataDir }),
      antlProviderModule: stageAntlProviderModule({ appRoot, dataDir }),
      reasoningSpeed: options.reasoningSpeed || cfg.api?.reasoningSpeed,
      yanTaskId: String(options.taskId || '').trim(),
      inputTokensPerSecond: Math.max(DEFAULT_INPUT_TOKENS_PER_SECOND, normalizeInputTokensPerSecond(
        cfg.api?.inputTokensPerSecond || cfg.agent?.inputTokensPerSecond
      )),
      // Learned per-(provider, model) prefill rate from previous runs. Zero
      // until a trustworthy measurement exists; the sidecar then lets this real
      // value override the declared baseline everywhere it matters.
      measuredInputTokensPerSecond: Number(
        cfg.api?.inputThroughput?.[measurementKey(providerId, selection.modelId)]?.tokensPerSecond
      ) || 0,
      workMode: cfg.agent?.workMode,
      accessMode: cfg.agent?.accessMode,
      sandboxMode: cfg.agent?.sandboxMode || 'full',
      responseTimeoutMinutes: cfg.agent?.responseTimeoutMinutes || 2,
      disableKernelFormatter: cfg.agent?.disableAutoFormatter === true,
      terminalShell: cfg.general?.terminalShell,
      permissions: cfg.permissions,
      skillOnly: options.skillOnly === true,
      yanSkillDirectory: skillsDir,
      mcpServers: Array.isArray(options.mcpServers) ? options.mcpServers : getOpenCodeMcpServers(cfg)
    });
    runtimeConfig.yanMediaEnvironment = options.skillOnly ? {} : buildYanMediaEnvironment(cfg, providerConfig.getChildReadableAppRoot(), options);
    return runtimeConfig;
  }

  function getOpenCodeCapabilityContext(cfg, mcpServers, options = {}) {
    const skippedIds = new Set((Array.isArray(options.skippedSkills) ? options.skippedSkills : [])
      .map(skill => String(skill?.id || '').trim().toLowerCase()).filter(Boolean));
    const skills = getMergedSkills(cfg).filter(skill => !skill.userOnly && !skippedIds.has(String(skill?.id || '').trim().toLowerCase())).map(skill => ({
      id: String(skill.id || ''),
      name: String(skill.name || skill.id || ''),
      description: String(skill.desc || ''),
      origin: String(skill.origin || ''),
      aliases: Array.isArray(skill.aliases) ? skill.aliases.map(String) : [],
      tags: Array.isArray(skill.tags) ? skill.tags.map(String) : [],
      requires: skillRequirements(skill)
        .map(requirement => (requirement.kind && requirement.match
          ? `${requirement.kind}:${requirement.match}`
          : (requirement.kind || requirement.match)))
        .filter(Boolean)
    })).filter(skill => skill.id);
    const servers = (Array.isArray(mcpServers) ? mcpServers : [])
      .filter(server => server?.taskEnabled !== false)
      .filter(server => server?.enabled && (server.command || isRemoteMcpServer(server)))
      .map(server => ({
        id: String(server.id || ''),
        name: String(server.name || server.id || ''),
        description: String(server.description || ''),
        runtime: String(server.runtime || ''),
        builtin: !!server.builtin,
        deferred: server.deferred === true
      }))
      .filter(server => server.id);
    return { skills, mcpServers: servers, yanBrowserAvailable: servers.some(server => server.id === 'yan_browser') };
  }

  return {
    selectedSkillIds,
    skillRequirements,
    mcpServerMatches,
    unmetSkillRequirements,
    inferMcpTaskCapabilities,
    isDesktopTaskRequest,
    withTaskCapability,
    getOpenCodeMcpServers,
    getMcpManagementServers,
    getMcpServerConfig,
    getOpenCodeRuntimeConfig,
    resolveRequestedTextSelection,
    getOpenCodeCapabilityContext,
  };
}

module.exports = { createMcpRuntimeConfig };
