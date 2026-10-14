'use strict';

// Provider catalog and built-in MCP defaults. Each application composition
// owns its returned definitions; this module has no mutable runtime singleton.
const { GLM_OFFICIAL_SUPPLEMENTAL_MODELS, SENSENOVA_OFFICIAL_SUPPLEMENTAL_MODELS } = require('../provider-model-catalog');
const { AGNES_FALLBACK_MODELS } = require('../model-roles');
const { decorateModels } = require('../model-capabilities');
const { createSerenaServer } = require('../serena-runtime');
const playwrightRuntime = require('../playwright-runtime');
const path = require('path');
const { readMcpMirror } = require('../mcp-installer');

function createRuntimeDefaults({ dataDir }) {
  // Media capabilities were verified against vendor-hosted APIs on 2026-08-02;
  // they do not depend on the contents of GET /models.
  const EMPTY_MEDIA_CAPABILITIES = Object.freeze({
    imageGeneration: false,
    imageEditing: false,
    videoGeneration: false
  });
  const PROVIDER_MEDIA_CAPABILITIES = Object.freeze({
    openai: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: true }),
    grok: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: true }),
    agnes: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: true }),
    sensenova: Object.freeze({ imageGeneration: true, imageEditing: false, videoGeneration: false }),
    deepseek: Object.freeze({ imageGeneration: false, imageEditing: false, videoGeneration: false }),
    qwen: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: true }),
    glm: Object.freeze({ imageGeneration: true, imageEditing: false, videoGeneration: true }),
    doubao: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: true }),
    moonshot: Object.freeze({ imageGeneration: false, imageEditing: false, videoGeneration: false }),
    stepfun: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: false }),
    minimax: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: true }),
    baichuan: Object.freeze({ imageGeneration: false, imageEditing: false, videoGeneration: false }),
    yi: Object.freeze({ imageGeneration: false, imageEditing: false, videoGeneration: false }),
    hunyuan: Object.freeze({ imageGeneration: true, imageEditing: false, videoGeneration: true }),
    siliconflow: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: true })
  });

  // Only these capabilities have a Yan request/response adapter. The settings
  // and model pickers must use this table instead of the vendor capability table.
  const PROVIDER_MEDIA_ADAPTERS = Object.freeze({
    openai: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: true }),
    grok: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: true }),
    agnes: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: true }),
    sensenova: Object.freeze({ imageGeneration: true, imageEditing: false, videoGeneration: false }),
    deepseek: Object.freeze({ imageGeneration: false, imageEditing: false, videoGeneration: false }),
    qwen: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: true }),
    glm: Object.freeze({ imageGeneration: true, imageEditing: false, videoGeneration: true }),
    doubao: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: true }),
    moonshot: Object.freeze({ imageGeneration: false, imageEditing: false, videoGeneration: false }),
    stepfun: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: false }),
    minimax: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: true }),
    baichuan: Object.freeze({ imageGeneration: false, imageEditing: false, videoGeneration: false }),
    yi: Object.freeze({ imageGeneration: false, imageEditing: false, videoGeneration: false }),
    hunyuan: Object.freeze({ imageGeneration: false, imageEditing: false, videoGeneration: false }),
    siliconflow: Object.freeze({ imageGeneration: true, imageEditing: true, videoGeneration: true })
  });

  const STATIC_PROVIDER_SUPPLEMENTAL_MODELS = Object.freeze({
    // GLM's /models response is incomplete: documented free, vision, image and
    // video IDs remain callable but are not returned. Keep them sourced and
    // separate so the UI never presents them as API-discovered models.
    glm: GLM_OFFICIAL_SUPPLEMENTAL_MODELS,
    sensenova: SENSENOVA_OFFICIAL_SUPPLEMENTAL_MODELS,
    doubao: Object.freeze([
      { id: 'doubao-seedream-5-0-pro-260628', name: 'Doubao Seedream 5.0 Pro', modelType: 'image', source: 'official-supplement' },
      { id: 'doubao-seedance-2-0-260128', name: 'Doubao Seedance 2.0', modelType: 'video', source: 'official-supplement' }
    ]),
    stepfun: Object.freeze([
      { id: 'step-image-edit-2', name: 'Step Image Edit 2', modelType: 'image', source: 'official-supplement' },
      { id: 'step-2x-large', name: 'Step 2X Large', modelType: 'image', source: 'official-supplement' }
    ]),
    minimax: Object.freeze([
      { id: 'image-01', name: 'MiniMax Image 01', modelType: 'image', source: 'official-supplement' },
      { id: 'image-01-live', name: 'MiniMax Image 01 Live', modelType: 'image', source: 'official-supplement' },
      { id: 'MiniMax-H3', name: 'MiniMax H3', modelType: 'video', source: 'official-supplement' },
      { id: 'video-01', name: 'MiniMax Video 01', modelType: 'video', source: 'official-supplement' },
      { id: 'video-01-live2', name: 'MiniMax Video 01 Live2', modelType: 'video', source: 'official-supplement' }
    ])
  });

  const MODEL_PROVIDERS = {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyPlaceholder: 'sk-...',
      dynamicModels: true,
      models: []
    },
    grok: {
      id: 'grok',
      name: 'Grok',
      baseUrl: 'https://api.x.ai/v1',
      apiKeyPlaceholder: 'sk-...',
      dynamicModels: true,
      models: []
    },
    agnes: {
      id: 'agnes',
      name: 'Agnes',
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      apiKeyPlaceholder: 'sk-...',
      dynamicModels: true,
      models: AGNES_FALLBACK_MODELS
    },
    deepseek: {
      id: 'deepseek',
      name: 'DeepSeek (深度求索)',
      baseUrl: 'https://api.deepseek.com',
      apiKeyPlaceholder: 'sk-...',
      dynamicModels: true,
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
        { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision Experimental', capabilities: { vision: true } }
      ]
    },
    qwen: {
      id: 'qwen',
      name: '通义千问 (阿里云百炼)',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKeyPlaceholder: 'sk-...',
      dynamicModels: true,
      models: [
        { id: 'qwen3.8-max-preview', name: 'Qwen3.8 Max Preview (旗舰)', capabilities: { vision: true } },
        { id: 'qwen3.7-max', name: 'Qwen3.7 Max (旗舰)' },
        { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus (均衡)' },
        { id: 'qwen3.7-flash', name: 'Qwen3.7 Flash (高速多模态)', capabilities: { vision: true } },
        { id: 'qwen3.6-flash', name: 'Qwen3.6 Flash (轻量)' },
        { id: 'qwen3.6-max-preview', name: 'Qwen3.6 Max Preview' },
        { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus' },
        { id: 'qwen3-max', name: 'Qwen3 Max' },
        { id: 'qwen-plus', name: 'Qwen Plus' },
        { id: 'qwen-turbo', name: 'Qwen Turbo' },
        { id: 'qwen-long', name: 'Qwen Long (长文本)' }
      ]
    },
    glm: {
      id: 'glm',
      name: '智谱 GLM (智谱AI)',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKeyPlaceholder: '...',
      // GLM exposes the current text catalog through /models. Media models are
      // documented on the image/video endpoints and merged separately below.
      dynamicModels: true,
      // Text IDs are populated exclusively from GLM's /models response after
      // the provider is configured.
      models: []
    },
    doubao: {
      id: 'doubao',
      name: '豆包 (火山引擎方舟)',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKeyPlaceholder: '...',
      models: [
        { id: 'doubao-seed-2-1-pro-260628', name: 'Doubao Seed 2.1 Pro 260628' },
        { id: 'doubao-seed-2-1-turbo-260628', name: 'Doubao Seed 2.1 Turbo 260628' },
        { id: 'doubao-seed-2-0-lite-260428', name: 'Doubao Seed 2.0 Lite 260428' },
        { id: 'doubao-seed-2-0-mini-260428', name: 'Doubao Seed 2.0 Mini 260428' },
        { id: 'doubao-seed-2-0-pro-260215', name: 'Doubao Seed 2.0 Pro 260215' }
      ]
    },
    moonshot: {
      id: 'moonshot',
      name: 'Kimi (月之暗面)',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKeyPlaceholder: 'sk-...',
      dynamicModels: true,
      models: [
        { id: 'kimi-k3', name: 'Kimi K3 (1M 旗舰多模态)' },
        { id: 'kimi-k2.7-code-highspeed', name: 'Kimi K2.7 Code HighSpeed' },
        { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code' },
        { id: 'kimi-k2.6', name: 'Kimi K2.6 (通用多模态)' },
        { id: 'kimi-k2.5', name: 'Kimi K2.5 (多模态)' }
      ]
    },
    stepfun: {
      id: 'stepfun',
      name: 'StepFun (阶跃星辰)',
      baseUrl: 'https://api.stepfun.com/v1',
      apiKeyPlaceholder: 'sk-...',
      models: [
        { id: 'step-3.7-flash', name: 'Step 3.7 Flash (多模态推理)' },
        { id: 'step-3.5-flash', name: 'Step 3.5 Flash (推理)' }
      ]
    },
    minimax: {
      id: 'minimax',
      name: 'MiniMax (稀宇)',
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKeyPlaceholder: '...',
      models: [
        { id: 'MiniMax-M3', name: 'MiniMax M3 (1M 旗舰)' },
        { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 HighSpeed' },
        { id: 'MiniMax-M2.7', name: 'MiniMax M2.7' }
      ]
    },
    baichuan: {
      id: 'baichuan',
      name: '百川智能 (Baichuan)',
      baseUrl: 'https://api.baichuan-ai.com/v1',
      apiKeyPlaceholder: 'sk-...',
      models: [
        { id: 'Baichuan4', name: 'Baichuan 4' },
        { id: 'Baichuan3-Turbo', name: 'Baichuan 3 Turbo' }
      ]
    },
    yi: {
      id: 'yi',
      name: '零一万物 (Yi)',
      baseUrl: 'https://api.lingyiwanwu.com/v1',
      apiKeyPlaceholder: 'sk-...',
      models: [
        { id: 'yi-large', name: 'Yi Large' },
        { id: 'yi-lightning', name: 'Yi Lightning' }
      ]
    },
    hunyuan: {
      id: 'hunyuan',
      name: '腾讯混元 (Hunyuan)',
      baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
      apiKeyPlaceholder: 'sk-...',
      models: [
        { id: 'hunyuan-turbos-latest', name: '混元 Turbo S Latest' },
        { id: 'hunyuan-turbos', name: '混元 Turbo S (兼容别名)' },
        { id: 'hunyuan-a13b', name: '混元 A13B (混合推理)' },
        { id: 'hunyuan-pro', name: '混元 Pro' },
        { id: 'hunyuan-vision', name: '混元 Vision', capabilities: { vision: true } },
        { id: 'hunyuan-vision-1.5-instruct', name: '混元 Vision 1.5 Instruct', capabilities: { vision: true } },
        { id: 'hunyuan-t1-vision-20250916', name: '混元 T1 Vision', capabilities: { vision: true } }
      ]
    },
    siliconflow: {
      id: 'siliconflow',
      name: '硅基流动 (SiliconFlow)',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKeyPlaceholder: 'sk-...',
      dynamicModels: true,
      models: []
    }
  };

  const DEFAULT_MODELS = decorateModels('agnes', MODEL_PROVIDERS.agnes.models);
  const DEFAULT_MCP_SERVERS = [
    {
      id: 'mcp_default_codegraph',
      name: 'CodeGraph',
      description: '为当前工作区建立代码图并执行结构化代码检索与理解。',
      command: 'codegraph',
      args: ['serve', '--mcp'],
      enabled: true,
      builtin: true,
      runtime: 'codegraph',
      sourceVersion: '1.5.0'
    },
    createSerenaServer(dataDir)
  ];

  // Playwright ships as an installable plugin: its MCP service is registered
  // only once the plugin (and therefore the Chromium runtime) is installed.
  // Until then the descriptor stays out of the defaults, so the eviction pass
  // below also retires the entry older builds registered unconditionally.
  function defaultMcpServers() {
    const servers = [...DEFAULT_MCP_SERVERS];
    if (playwrightRuntime.isInstalled(dataDir)) servers.unshift(playwrightRuntime.createPlaywrightServer());
    return servers;
  }

  function ensureDefaultMcp(servers) {
    const defaults = defaultMcpServers();
    const defaultIds = new Set(defaults.map(server => server.id));
    const list = (Array.isArray(servers) ? servers : []).filter(server => (
      !server?.builtin
      || !String(server.id || '').startsWith('mcp_default_')
      || defaultIds.has(String(server.id || ''))
    ));
    for (const d of defaults) {
      const normalizedName = d.name.toLowerCase();
      const idIndex = list.findIndex(server => server?.id === d.id);
      const builtinNameIndex = list.findIndex(server => (
        server?.builtin && String(server.name || '').toLowerCase() === normalizedName
      ));
      const index = idIndex >= 0 ? idIndex : builtinNameIndex;
      if (index < 0) {
        if (list.some(server => String(server?.name || '').toLowerCase() === normalizedName)) continue;
        list.push({ ...d });
        continue;
      }
      // Built-in definitions are migrated on load so existing installations do
      // not remain on a broken cached command after an application update.
      list[index] = {
        ...list[index],
        name: d.name,
        description: d.description,
        command: d.command,
        args: [...d.args],
        builtin: true,
        runtime: d.runtime,
        sourceVersion: d.sourceVersion,
        timeout: d.timeout,
        ...(d.env ? { env: { ...d.env } } : {})
      };
    }
    // Agent-installed MCP servers (natural-language install) are mirrored next
    // to the config. Merging the mirror back on load keeps a just-installed
    // server from being dropped when an unrelated in-memory config save
    // persists the whole config object. Idempotent: known ids are skipped.
    const indexById = new Map();
    list.forEach((server, index) => indexById.set(String(server?.id || ''), index));
    for (const mirrored of readMcpMirror(path.join(String(dataDir || ''), 'config.json'))) {
      const id = String(mirrored?.id || '');
      if (!id) continue;
      const description = String(mirrored?.description || '').trim();
      const index = indexById.get(id);
      if (index === undefined) {
        list.push({ ...mirrored });
        indexById.set(id, list.length - 1);
        continue;
      }
      // A stale in-memory save can also drop an introduction this tool added.
      if (description && !String(list[index]?.description || '').trim()) {
        list[index] = { ...list[index], description };
      }
    }
    return list;
  }

  return { EMPTY_MEDIA_CAPABILITIES, PROVIDER_MEDIA_CAPABILITIES, PROVIDER_MEDIA_ADAPTERS, STATIC_PROVIDER_SUPPLEMENTAL_MODELS, MODEL_PROVIDERS, DEFAULT_MODELS, DEFAULT_MCP_SERVERS, ensureDefaultMcp };
}

module.exports = { createRuntimeDefaults };
