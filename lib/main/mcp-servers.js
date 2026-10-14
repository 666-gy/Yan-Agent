'use strict';

// Bundled Yan MCP server definitions (plan T5.1). Moved verbatim from
// main.js; every runtime singleton arrives through explicit dependencies.

const path = require('path');

function createMcpServers(deps) {
  const {
    dataDir,
    providerConfig,
    visionRelay,
    generatedMedia,
    skillsDir,
    configPath,
    browserAgentBridgeToken,
    getBrowserAgentBridgePort,
    sessionAgentBridgeToken,
    getSessionAgentBridgePort,
    continualHarnessPath,
    DEFAULT_INPUT_TOKENS_PER_SECOND,
    normalizeInputTokensPerSecond
  } = deps;

  function buildYanMediaMcpServer(cfg, childAppRoot, options = {}) {
    const configured = providerConfig.getConfiguredMediaModels(cfg);
    const visionModels = visionRelay.getVisionRelayModels(cfg);
    // NOTE: nothing per-run may enter this env — the whole config feeds
    // configSignature() and any per-run value restarts the kernel / breaks
    // concurrent runs. The run workspace is delivered through the registry
    // file (see registerMediaWorkspace), read dynamically per tool call.
    const runtime = {
      access: {
        accessMode: String(cfg.agent?.accessMode || 'request'),
        allowFileRead: cfg.permissions?.allowFileRead !== false,
        allowNetwork: cfg.permissions?.allowNetwork !== false
      },
      vision: {
        enabled: visionModels.length > 0,
        models: visionModels
      }
    };
    for (const selection of configured) {
      const connection = providerConfig.getProviderConnectionForSupplier(cfg, selection.providerId, selection.supplierId);
      if (!connection.apiKey) continue;
      if (selection.role === 'image' && cfg.imageGeneration?.available) {
        runtime.image = {
          ...selection,
          baseUrl: connection.baseUrl,
          apiKey: connection.apiKey,
          strategy: cfg.imageGeneration.strategy,
          providerOptions: {
            workspaceId: connection.workspaceId,
            adapterKind: providerConfig.providerAdapterPreset(cfg, selection.providerId)
          },
          imageEndpoints: {
            generations: connection.imageGenerationUrl,
            edits: connection.imageEditUrl
          }
        };
      }
      if (selection.role === 'video' && cfg.videoGeneration?.available) {
        runtime.video = {
          ...selection,
          baseUrl: connection.baseUrl,
          apiKey: connection.apiKey,
          providerOptions: {
            workspaceId: connection.workspaceId,
            videoGenerationUrl: connection.videoGenerationUrl,
            adapterKind: providerConfig.providerAdapterPreset(cfg, selection.providerId)
          }
        };
      }
    }
    return {
      id: 'yan_media',
      name: 'Yan Media',
      description: visionModels.length
        ? '通过视觉中继读取本地或历史生成图片，并调用当前会话选定的生图与生视频次模型。'
        : '调用当前会话选定的生图与生视频次模型。',
      runtime: 'yan-media',
      command: process.execPath,
      args: [path.join(childAppRoot, 'lib', 'yan-media-mcp.js')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        YAN_MEDIA_RUNTIME: Buffer.from(JSON.stringify(runtime), 'utf8').toString('base64'),
        YAN_MEDIA_DATA_DIR: dataDir,
        YAN_MEDIA_WORKSPACE_REGISTRY: generatedMedia.mediaWorkspaceRegistryPath
      },
      enabled: true,
      builtin: true,
      systemManaged: true,
      timeout: 12 * 60 * 1000
    };
  }

  function buildYanSkillsMcpServer(cfg, childAppRoot, options = {}) {
    const entry = path.join(childAppRoot, 'lib', 'yan-skills-mcp.js');
    const cli = path.join(childAppRoot, 'node_modules', 'skills', 'bin', 'cli.mjs');
    return {
      id: 'yan_skills',
      name: 'Yan Skills',
      description: '查找、安装、列出、读取和删除 Yan 自有 Skill；Blank 中也可使用。',
      runtime: 'yan-skills',
      command: process.execPath,
      args: [entry],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        YAN_SKILLS_ROOT: skillsDir,
        YAN_SKILLS_DATA_DIR: dataDir,
        YAN_SKILLS_CONFIG_PATH: configPath,
        // Signature-stable: the task workspace arrives per call through the
        // harness run context keyed by task_id, never through this shared env.
        YAN_SKILLS_CONTEXT_DIR: path.join(dataDir, 'harness', 'runtime'),
        YAN_SKILLS_APP_ROOT: childAppRoot,
        YAN_SKILLS_CLI: cli,
        YAN_SKILLS_ALLOW_NETWORK: cfg.permissions?.allowNetwork === false ? 'false' : 'true',
        // Lets high-throughput models request larger lossless Skill chunks.
        // The MCP keeps a 10000-token/s default when older configs omit it.
        YAN_INPUT_TOKENS_PER_SECOND: String(
          Math.max(DEFAULT_INPUT_TOKENS_PER_SECOND, normalizeInputTokensPerSecond(
            cfg.api?.inputTokensPerSecond || cfg.agent?.inputTokensPerSecond
          ))
        )
      },
      enabled: true,
      builtin: true,
      systemManaged: true,
      timeout: 12 * 60 * 1000
    };
  }

  function buildYanBrowserMcpServer(cfg, childAppRoot) {
    const bridgePort = getBrowserAgentBridgePort();
    if (!bridgePort) return null;
    return {
      id: 'yan_browser',
      name: 'Yan Built-in Browser',
      description: '控制 Yan 右侧可见的内置浏览器，用于网页阅读、交互与视觉验收。',
      runtime: 'yan-browser',
      command: process.execPath,
      args: [path.join(childAppRoot, 'lib', 'yan-browser-mcp.js')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        YAN_BROWSER_BRIDGE_PORT: String(bridgePort),
        YAN_BROWSER_BRIDGE_TOKEN: browserAgentBridgeToken,
        YAN_BROWSER_ALLOW_NETWORK: cfg.permissions?.allowNetwork === false ? 'false' : 'true'
      },
      enabled: true,
      builtin: true,
      systemManaged: true,
      timeout: 150_000
    };
  }

  function buildYanWebMcpServer(cfg, childAppRoot) {
    return {
      id: 'yan_web',
      name: 'Yan Web Fetch',
      description: '直接抓取静态资源并落盘（图标、图片、SVG、字体、压缩包等），已知 URL 的文本/页面也可直接读取；不需要打开内置浏览器，搜索仍优先 AnySearch。',
      runtime: 'yan-web',
      command: process.execPath,
      args: [path.join(childAppRoot, 'lib', 'yan-web-mcp.js')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        YAN_WEB_CONTEXT_DIR: path.join(dataDir, 'harness', 'runtime'),
        YAN_WEB_ALLOW_NETWORK: cfg.permissions?.allowNetwork === false ? 'false' : 'true'
      },
      enabled: true,
      builtin: true,
      systemManaged: true,
      timeout: 120_000
    };
  }

  function buildYanSessionMcpServer(childAppRoot) {
    const sessionBridgePort = getSessionAgentBridgePort();
    if (!sessionBridgePort) return null;
    return {
      id: 'yan_session',
      name: 'Yan Session',
      description: '在用户明确授权后进入另一工作区的最新 Yan 任务；目标工作区没有任务时才创建并交接上下文。',
      runtime: 'yan-session',
      command: process.execPath,
      args: [path.join(childAppRoot, 'lib', 'yan-session-mcp.js')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        YAN_SESSION_BRIDGE_PORT: String(sessionBridgePort),
        YAN_SESSION_BRIDGE_TOKEN: sessionAgentBridgeToken
      },
      enabled: true,
      builtin: true,
      systemManaged: true,
      timeout: 300_000
    };
  }

  function buildYanHarnessMcpServer(childAppRoot) {
    return {
      id: 'yan_harness',
      name: 'Yan Continual Harness',
      description: '将重复失败、可复用策略或子智能体角色排队，在本轮完成后进行证据化演进；运行中不会改写当前提示。',
      runtime: 'yan-harness',
      command: process.execPath,
      args: [path.join(childAppRoot, 'lib', 'yan-harness-mcp.js')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        YAN_HARNESS_CONTEXT_DIR: path.join(dataDir, 'harness', 'runtime'),
        YAN_HARNESS_GLOBAL_STATE_PATH: continualHarnessPath
      },
      enabled: true,
      builtin: true,
      systemManaged: true,
      timeout: 180_000
    };
  }

  function buildYanAnalysisMcpServer(cfg, childAppRoot) {
    // Config-signature stable on purpose: no per-run values (workspace) here.
    // Task context carries workspace authorization without restarting the MCP.
    return {
      id: 'yan_analysis',
      name: 'Yan Analysis',
      description: '确定性代码理解工具：repo map、符号大纲与精读、调用树、BM25 代码/历史检索。供分析与逆向子代理及主任务使用。',
      runtime: 'yan-analysis',
      command: process.execPath,
      args: [path.join(childAppRoot, 'lib', 'yan-analysis-mcp.js')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        YAN_ANALYSIS_CONTEXT_DIR: path.join(dataDir, 'harness', 'runtime')
      },
      enabled: true,
      builtin: true,
      systemManaged: true,
      timeout: 120_000
    };
  }

  function buildYanWorkspaceMcpServer(cfg, childAppRoot) {
    // Config-signature stable like yan_analysis: workspace authorization flows
    // through the per-run harness context file, not the server environment.
    return {
      id: 'yan_workspace',
      name: 'Yan Workspace',
      description: '工作区工程工具：任务级 git worktree 创建/合并/清理（并行 builder 隔离）与 code_impact 反向依赖影响面检查。',
      runtime: 'yan-workspace',
      command: process.execPath,
      args: [path.join(childAppRoot, 'lib', 'yan-workspace-mcp.js')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        YAN_WORKSPACE_CONTEXT_DIR: path.join(dataDir, 'harness', 'runtime'),
        YAN_GIT_CONFIG_PATH: path.join(dataDir, 'config.json')
      },
      enabled: true,
      builtin: true,
      systemManaged: true,
      timeout: 120_000
    };
  }

  function buildYanMcpServer(cfg, childAppRoot) {
    // Natural-language MCP installation: the tool writes the same config the
    // renderer wizard (mcp:add) writes. Config-signature stable on purpose —
    // only the config path and the network grant enter the environment.
    return {
      id: 'yan_mcp',
      name: 'Yan MCP',
      description: '用自然语言接入 MCP 服务：核对官方来源（npm/PyPI registry 与真实 MCP 握手）后，按规则写入 Yan 的 MCP 配置。',
      runtime: 'yan-mcp',
      command: process.execPath,
      args: [path.join(childAppRoot, 'lib', 'yan-mcp-mcp.js')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        YAN_MCP_CONFIG_PATH: configPath,
        // Live-kernel endpoints for on-demand MCP activation (default-deferred
        // servers like Playwright connect only when the model asks).
        YAN_MCP_KERNEL_ENDPOINTS_DIR: path.join(dataDir, 'opencode-runtime', 'endpoints'),
        // Activation has to resolve a `runtime: 'codegraph'` entry's placeholder
        // command to the real packaged runtime, which needs the app root.
        YAN_MCP_APP_ROOT: childAppRoot,
        YAN_MCP_ALLOW_NETWORK: cfg.permissions?.allowNetwork === false ? 'false' : 'true'
      },
      enabled: true,
      builtin: true,
      systemManaged: true,
      timeout: 12 * 60 * 1000
    };
  }

  function buildYanPluginMcpServer(cfg, childAppRoot) {
    // Natural-language plugin installation and marketplace management: the
    // tools operate on the same YanData/plugins registry the plugin page uses.
    // Config-signature stable on purpose — only the data directory and the
    // network grant enter the environment.
    return {
      id: 'yan_plugin',
      name: 'Yan Plugin',
      description: '用自然语言安装管理插件：浏览内置目录与自定义市场、按 id 安装、添加或移除插件市场来源。',
      runtime: 'yan-plugin',
      command: process.execPath,
      args: [path.join(childAppRoot, 'lib', 'yan-plugin-mcp.js')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        YAN_PLUGIN_DATA_DIR: dataDir,
        YAN_PLUGIN_ALLOW_NETWORK: cfg.permissions?.allowNetwork === false ? 'false' : 'true'
      },
      enabled: true,
      builtin: true,
      systemManaged: true,
      timeout: 12 * 60 * 1000
    };
  }

  return {
    buildYanMediaMcpServer,
    buildYanSkillsMcpServer,
    buildYanBrowserMcpServer,
    buildYanWebMcpServer,
    buildYanSessionMcpServer,
    buildYanHarnessMcpServer,
    buildYanAnalysisMcpServer,
    buildYanWorkspaceMcpServer,
    buildYanMcpServer,
    buildYanPluginMcpServer,
  };
}

module.exports = { createMcpServers };
