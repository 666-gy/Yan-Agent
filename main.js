const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage, webContents, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { exec, execFile, spawn } = require('child_process');
const codeIndex = require('./lib/code-index');
const codeMap = require('./lib/code-map');
const { fetchRemoteModelCatalog, normalizeRemoteModels } = require('./lib/model-catalog');
const { decorateModels, resolveImageGenerationConfig } = require('./lib/model-capabilities');
const { detectImageType, generateImage } = require('./lib/image-generation');
const { summarizeRunChanges } = require('./lib/run-change-summary');
const {
  evaluateSessionDeletion,
  findReusableBlankSession,
  isBlankUnassignedNewChat
} = require('./lib/session-policy');
const skillRegistry = require('./lib/skill-registry');
const uiKitRegistry = require('./lib/ui-kit-registry');
const { launchYanxiCode } = require('./lib/yanxi-launcher');
const { parseOpenWorkspaceArg, parseYanxiRequestIdArg, createYanxiCodeReceiver } = require('./lib/yanxi-code-receiver');
const { TerminalManager } = require('./lib/terminal-manager');
const crypto = require('crypto');
const { RemoteServer } = require('./lib/remote-server');

const appRoot = __dirname;

let mainWindow = null;
let mainRendererReady = false;
let petWindow = null;
let tray = null;
let isQuiting = false;
let remoteServer = null;
let petState = {
  status: 'idle',
  sessionId: null,
  running: false,
  title: 'Yan Agent',
  message: '随时待命',
  assessment: '本地监督已就绪',
  stats: { iteration: 0, toolCalls: 0, changes: 0 }
};
const remotePending = new Map();
const activeImageGenerations = new Map();
const generatedImages = new Map();
const generatedImageViewers = new Map();
const terminalManager = new TerminalManager({
  onEvent(ownerId, payload) {
    const target = webContents.fromId(ownerId);
    if (target && !target.isDestroyed()) target.send('terminal:event', payload);
  }
});

// ---------------------------------------------------------------------------
// Paths & storage
// ---------------------------------------------------------------------------
// 用户数据统一存放在固定目录 YanData，更新/重装后保留会话、配置与记忆。
// 首次从旧版「按构建隔离」目录（YanData-*）自动迁移。
const userDataDir = app.getPath('userData');
const STABLE_DATA_DIR = path.join(userDataDir, 'YanData');

function migrateLegacyDataDir() {
  if (fs.existsSync(path.join(STABLE_DATA_DIR, 'config.json'))) return;

  let names = [];
  try { names = fs.readdirSync(userDataDir); } catch { return; }

  let bestDir = null;
  let bestMtime = 0;
  for (const name of names) {
    if (!name.startsWith('YanData-')) continue;
    const candidate = path.join(userDataDir, name);
    const cfg = path.join(candidate, 'config.json');
    if (!fs.existsSync(cfg)) continue;
    try {
      const mtime = fs.statSync(cfg).mtimeMs;
      if (mtime > bestMtime) {
        bestMtime = mtime;
        bestDir = candidate;
      }
    } catch { /* skip */ }
  }

  if (!bestDir) return;
  try {
    fs.mkdirSync(STABLE_DATA_DIR, { recursive: true });
    fs.cpSync(bestDir, STABLE_DATA_DIR, { recursive: true, force: true });
    console.log('[data] migrated legacy data from', path.basename(bestDir), 'to YanData');
  } catch (e) {
    console.error('[data] migrate legacy data failed:', e.message);
  }
}

const dataDir = STABLE_DATA_DIR;
const configPath = path.join(dataDir, 'config.json');
const sessionsDir = path.join(dataDir, 'sessions');
const filesDir = path.join(dataDir, 'uploads');
const generatedImageStoreDir = path.join(dataDir, 'generated-images');
const legacyGeneratedImageTempDir = path.join(app.getPath('temp'), 'YanAgent', 'generated-images');
const memoryPath = path.join(dataDir, 'memory.json');
const YANAGENT_DIR = '.yanagent';
const MAX_STORED_GENERATED_IMAGES = 100;
const MAX_STORED_GENERATED_IMAGE_BYTES = 1024 * 1024 * 1024;
const GENERATED_IMAGE_MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
};

function loadGeneratedImageStore() {
  generatedImages.clear();
  fs.mkdirSync(generatedImageStoreDir, { recursive: true });
  try {
    for (const file of fs.readdirSync(legacyGeneratedImageTempDir, { withFileTypes: true })) {
      if (!file.isFile() || !/^[a-f0-9]{32}\.(?:png|jpg|jpeg|webp|gif)$/i.test(file.name)) continue;
      const target = path.join(generatedImageStoreDir, file.name.toLowerCase());
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(legacyGeneratedImageTempDir, file.name), target);
    }
    fs.rmSync(legacyGeneratedImageTempDir, { recursive: true, force: true });
  } catch {}

  const restored = [];
  for (const file of fs.readdirSync(generatedImageStoreDir, { withFileTypes: true })) {
    const match = file.isFile() && file.name.match(/^([a-f0-9]{32})\.(png|jpg|jpeg|webp|gif)$/i);
    if (!match) continue;
    const filePath = path.join(generatedImageStoreDir, file.name);
    try {
      const stat = fs.statSync(filePath);
      restored.push({
        assetId: match[1].toLowerCase(),
        filePath,
        name: `generated_${Math.trunc(stat.mtimeMs)}_${match[1].slice(0, 6)}.${match[2].toLowerCase()}`,
        size: stat.size,
        mimeType: GENERATED_IMAGE_MIME_BY_EXTENSION[match[2].toLowerCase()],
        createdAt: stat.mtimeMs
      });
    } catch {}
  }
  restored.sort((a, b) => a.createdAt - b.createdAt);
  for (const asset of restored) generatedImages.set(asset.assetId, asset);
  pruneGeneratedImageStore();
}

function closeGeneratedImageViewers() {
  for (const viewer of generatedImageViewers.values()) {
    if (!viewer.isDestroyed()) viewer.destroy();
  }
  generatedImageViewers.clear();
  generatedImages.clear();
}

function getGeneratedImageAsset(assetId) {
  const id = String(assetId || '').trim();
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const asset = generatedImages.get(id);
  if (!asset || !fs.existsSync(asset.filePath)) {
    if (asset) generatedImages.delete(id);
    return null;
  }
  return asset;
}

function pruneGeneratedImageStore() {
  let totalBytes = [...generatedImages.values()].reduce((sum, item) => sum + item.size, 0);
  for (const [id, item] of generatedImages) {
    if (generatedImages.size <= MAX_STORED_GENERATED_IMAGES && totalBytes <= MAX_STORED_GENERATED_IMAGE_BYTES) break;
    generatedImages.delete(id);
    totalBytes -= item.size;
    fsp.unlink(item.filePath).catch(() => {});
    const viewer = generatedImageViewers.get(id);
    if (viewer && !viewer.isDestroyed()) viewer.destroy();
  }
}

async function registerGeneratedImage(result) {
  fs.mkdirSync(generatedImageStoreDir, { recursive: true });
  const assetId = crypto.randomBytes(16).toString('hex');
  const name = `generated_${Date.now()}_${assetId.slice(0, 6)}.${result.extension}`;
  const filePath = path.join(generatedImageStoreDir, `${assetId}.${result.extension}`);
  await fsp.writeFile(filePath, result.buffer);
  generatedImages.set(assetId, {
    assetId,
    filePath,
    name,
    size: result.buffer.length,
    mimeType: result.mimeType,
    createdAt: Date.now()
  });
  pruneGeneratedImageStore();
  return generatedImages.get(assetId);
}
// ---------------------------------------------------------------------------
// .yanagent — workspace-local memory, logs, session snapshots (safe to delete)
// ---------------------------------------------------------------------------
function yanagentRoot(workspace) {
  if (!workspace) return null;
  return path.join(workspace, YANAGENT_DIR);
}

const workspaceIndexCache = new Map();

function codeIndexPath(workspace) {
  return path.join(yanagentRoot(workspace), 'code-index.json');
}

async function loadPersistedCodeIndex(workspace) {
  if (workspaceIndexCache.has(workspace)) return workspaceIndexCache.get(workspace);
  const p = codeIndexPath(workspace);
  try {
    const raw = await fsp.readFile(p, 'utf8');
    const index = JSON.parse(raw);
    if (index.workspace === workspace) {
      workspaceIndexCache.set(workspace, index);
      return index;
    }
  } catch { /* no index yet */ }
  return null;
}

async function persistCodeIndex(index) {
  const ws = index.workspace;
  await ensureYanagent(ws);
  await fsp.writeFile(codeIndexPath(ws), JSON.stringify(index), 'utf8');
  workspaceIndexCache.set(ws, index);
  return index;
}

function ensureYanagent(workspace) {
  const root = yanagentRoot(workspace);
  if (!root) return null;
  for (const sub of ['logs', 'snapshots']) {
    const d = path.join(root, sub);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  const readme = path.join(root, 'README.txt');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme,
      'Yan Agent 数据目录（记忆、日志、会话快照）。\n' +
      '可随时删除，不影响项目代码；删除后记忆与日志会丢失。\n',
      'utf8');
  }
  return root;
}

function resolveMemoryPath() {
  const ws = loadConfig().workspace;
  if (ws) {
    ensureYanagent(ws);
    return path.join(yanagentRoot(ws), 'memory.json');
  }
  return memoryPath;
}

function migrateMemoryToWorkspace(workspace) {
  if (!workspace) return;
  ensureYanagent(workspace);
  const target = path.join(yanagentRoot(workspace), 'memory.json');
  if (fs.existsSync(target)) return;
  try {
    if (fs.existsSync(memoryPath)) {
      fs.copyFileSync(memoryPath, target);
    }
  } catch (e) { console.error('migrateMemoryToWorkspace:', e.message); }
}

function runSnapshotPath(workspace, sessionId, runId) {
  ensureYanagent(workspace);
  const dir = path.join(yanagentRoot(workspace), 'snapshots', sessionId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${runId}.json`);
}

async function applySnapshotRollback(changes) {
  const results = [];
  for (const ch of [...(changes || [])].reverse()) {
    if (ch.before === null || ch.before === undefined) {
      try {
        if (fs.existsSync(ch.path)) await fsp.unlink(ch.path);
        results.push({ path: ch.path, ok: true, action: 'deleted' });
      } catch (e) {
        results.push({ path: ch.path, ok: false, error: e.message });
      }
    } else {
      try {
        await fsp.mkdir(path.dirname(ch.path), { recursive: true });
        await fsp.writeFile(ch.path, ch.before, 'utf8');
        results.push({ path: ch.path, ok: true, action: 'restored' });
      } catch (e) {
        results.push({ path: ch.path, ok: false, error: e.message });
      }
    }
  }
  return results;
}

function appendYanagentLog(workspace, line) {
  const root = ensureYanagent(workspace);
  if (!root) return;
  const logFile = path.join(root, 'logs', new Date().toISOString().slice(0, 10) + '.log');
  const ts = new Date().toISOString();
  try {
    fs.appendFileSync(logFile, `[${ts}] ${line}\n`, 'utf8');
  } catch (e) { console.error('appendYanagentLog:', e.message); }
}

function isYanagentPath(filePath) {
  if (!filePath) return false;
  const norm = filePath.replace(/\\/g, '/').toLowerCase();
  return norm.includes('/.yanagent/') || norm.endsWith('/.yanagent');
}


function ensureDirs() {
  for (const dir of [dataDir, sessionsDir, filesDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// Verified against each vendor's official API documentation on 2026-07-11.
// Prices are mainland-China pay-as-you-go API prices per 1M tokens unless noted.
// Promotions and tiered prices can change; see MODEL_VENDOR_AUDIT_2026-07-11.md.
const MODEL_PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://ai8.my/v1',
    apiKeyPlaceholder: 'sk-...',
    dynamicModels: true,
    models: []
  },
  grok: {
    id: 'grok',
    name: 'Grok',
    baseUrl: 'https://ai8.my/v1',
    apiKeyPlaceholder: 'sk-...',
    dynamicModels: true,
    models: []
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek (深度求索)',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyPlaceholder: 'sk-...',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', price: '缓存命中 ¥0.02 · 输入 ¥1 · 输出 ¥2 / 1M' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', price: '缓存命中 ¥0.025 · 输入 ¥3 · 输出 ¥6 / 1M' }
    ]
  },
  qwen: {
    id: 'qwen',
    name: '通义千问 (阿里云百炼)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyPlaceholder: 'sk-...',
    models: [
      { id: 'qwen3.7-max', name: 'Qwen3.7 Max (旗舰)', price: '限时输入 ¥6 · 输出 ¥18 / 1M（原价 ¥12/¥36）' },
      { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus (均衡)', price: '≤256K ¥1.6/¥6.4；>256K ¥4.8/¥19.2 / 1M（输入/输出，限时）' },
      { id: 'qwen3.6-flash', name: 'Qwen3.6 Flash (轻量)', price: '≤256K ¥1.2/¥7.2；>256K ¥4.8/¥28.8 / 1M（输入/输出）' },
      { id: 'qwen3.6-max-preview', name: 'Qwen3.6 Max Preview', price: '≤128K ¥9/¥54；128–256K ¥15/¥90 / 1M（输入/输出）' },
      { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus', price: '≤256K ¥2/¥12；>256K ¥8/¥48 / 1M（输入/输出）' },
      { id: 'qwen3-max', name: 'Qwen3 Max', price: '≤32K ¥2.5/¥10；32–128K ¥4/¥16；128–256K ¥7/¥28 / 1M' },
      { id: 'qwen-plus', name: 'Qwen Plus', price: '≤128K 输入 ¥0.8 · 输出 ¥2(非思考)/¥8(思考)；长上下文阶梯价' },
      { id: 'qwen-turbo', name: 'Qwen Turbo', price: '输入 ¥0.3 · 输出 ¥0.6(非思考)/¥3(思考) / 1M' },
      { id: 'qwen-long', name: 'Qwen Long (长文本)', price: '输入 ¥0.5 · 输出 ¥2 / 1M' }
    ]
  },
  glm: {
    id: 'glm',
    name: '智谱 GLM (智谱AI)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyPlaceholder: '...',
    models: [
      { id: 'glm-5.2', name: 'GLM-5.2 (1M 旗舰)', price: '按官方实时按量价（输入/输出分项）' },
      { id: 'glm-5.1', name: 'GLM-5.1', price: '按官方实时按量价（输入/输出分项）' },
      { id: 'glm-5-turbo', name: 'GLM-5 Turbo', price: '按官方实时按量价（输入/输出分项）' },
      { id: 'glm-5', name: 'GLM-5', price: '按官方实时按量价（输入/输出分项）' },
      { id: 'glm-4.7', name: 'GLM-4.7', price: '按官方实时按量价（输入/输出分项）' },
      { id: 'glm-4.7-flashx', name: 'GLM-4.7 FlashX', price: '按官方实时按量价（输入/输出分项）' },
      { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', price: '免费' },
      { id: 'glm-4.6', name: 'GLM-4.6', price: '按官方实时按量价（输入/输出分项）' },
      { id: 'glm-4.5-air', name: 'GLM-4.5 Air', price: '按官方实时按量价（输入/输出分项）' },
      { id: 'glm-4.5-airx', name: 'GLM-4.5 AirX', price: '按官方实时按量价（输入/输出分项）' },
      { id: 'glm-4-flashx-250414', name: 'GLM-4 FlashX 250414', price: '¥0.1 / 1M tokens（官方统一 Token 价）' },
      { id: 'glm-4-flash-250414', name: 'GLM-4 Flash 250414', price: '免费' }
    ]
  },
  doubao: {
    id: 'doubao',
    name: '豆包 (火山引擎方舟)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyPlaceholder: '...',
    models: [
      { id: 'doubao-seed-2-1-pro-260628', name: 'Doubao Seed 2.1 Pro 260628', price: '阶梯计费：输入长度/缓存/推理方式，见方舟实时价格页' },
      { id: 'doubao-seed-2-1-turbo-260628', name: 'Doubao Seed 2.1 Turbo 260628', price: '阶梯计费：输入长度/缓存/推理方式，见方舟实时价格页' },
      { id: 'doubao-seed-2-0-lite-260428', name: 'Doubao Seed 2.0 Lite 260428', price: '阶梯计费：输入长度/缓存/推理方式，见方舟实时价格页' },
      { id: 'doubao-seed-2-0-mini-260428', name: 'Doubao Seed 2.0 Mini 260428', price: '阶梯计费：输入长度/缓存/推理方式，见方舟实时价格页' },
      { id: 'doubao-seed-2-0-pro-260215', name: 'Doubao Seed 2.0 Pro 260215', price: '阶梯计费：输入长度/缓存/推理方式，见方舟实时价格页' }
    ]
  },
  moonshot: {
    id: 'moonshot',
    name: 'Kimi (月之暗面)',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyPlaceholder: 'sk-...',
    models: [
      { id: 'kimi-k3', name: 'Kimi K3 (1M 旗舰多模态)', price: '缓存命中 ¥2 · 输入 ¥20 · 输出 ¥100 / 1M' },
      { id: 'kimi-k2.7-code-highspeed', name: 'Kimi K2.7 Code HighSpeed', price: '缓存命中 ¥2.6 · 输入 ¥13 · 输出 ¥54 / 1M' },
      { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', price: '缓存命中 ¥1.3 · 输入 ¥6.5 · 输出 ¥27 / 1M' },
      { id: 'kimi-k2.6', name: 'Kimi K2.6 (通用多模态)', price: '输入/输出/缓存分项，见 Kimi 官方实时价格页' },
      { id: 'kimi-k2.5', name: 'Kimi K2.5 (多模态)', price: '输入/输出/缓存分项，见 Kimi 官方实时价格页' }
    ]
  },
  stepfun: {
    id: 'stepfun',
    name: 'StepFun (阶跃星辰)',
    baseUrl: 'https://api.stepfun.com/v1',
    apiKeyPlaceholder: 'sk-...',
    models: [
      { id: 'step-3.7-flash', name: 'Step 3.7 Flash (多模态推理)', price: '缓存命中 ¥0.27 · 输入 ¥1.35 · 输出 ¥8.1 / 1M' },
      { id: 'step-3.5-flash', name: 'Step 3.5 Flash (推理)', price: '缓存命中 ¥0.14 · 输入 ¥0.7 · 输出 ¥2.1 / 1M' }
    ]
  },
  minimax: {
    id: 'minimax',
    name: 'MiniMax (稀宇)',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiKeyPlaceholder: '...',
    models: [
      { id: 'MiniMax-M3', name: 'MiniMax M3 (1M 旗舰)', price: '≤512K 输入 ¥2.1 · 输出 ¥8.4 · 缓存读 ¥0.42；>512K 翻倍 / 1M' },
      { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 HighSpeed', price: '输入 ¥4.2 · 输出 ¥16.8 · 缓存读 ¥0.42 · 缓存写 ¥2.625 / 1M' },
      { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', price: '输入 ¥2.1 · 输出 ¥8.4 · 缓存读 ¥0.42 · 缓存写 ¥2.625 / 1M' }
    ]
  }
};

const DEFAULT_MODELS = decorateModels('deepseek', MODEL_PROVIDERS.deepseek.models);

const DEFAULT_MCP_SERVERS = [
  {
    id: 'mcp_default_playwright',
    name: 'Playwright',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    enabled: true,
    builtin: true
  },
  {
    id: 'mcp_default_windows',
    name: 'Windows-MCP',
    command: 'uvx',
    args: ['windows-mcp', 'serve'],
    enabled: true,
    builtin: true
  }
];

function ensureDefaultMcp(servers) {
  const list = Array.isArray(servers) ? [...servers] : [];
  const ids = new Set(list.map(s => s.id));
  const names = new Set(list.map(s => (s.name || '').toLowerCase()));
  for (const d of DEFAULT_MCP_SERVERS) {
    if (!ids.has(d.id) && !names.has(d.name.toLowerCase())) {
      list.push({ ...d });
    }
  }
  return list;
}

const DEFAULT_SKILLS = skillRegistry.getBuiltinSkills(appRoot);

function getMergedSkills(cfg) {
  return skillRegistry.getMergedSkillsForList(cfg, appRoot);
}

function getBuiltinSkillIds() {
  return new Set(DEFAULT_SKILLS.map(s => s.id));
}

function buildDefaultApiKeys() {
  const keys = {};
  for (const id of Object.keys(MODEL_PROVIDERS)) {
    keys[id] = '';
  }
  return keys;
}

function getProviderModels(cfg, providerId) {
  const provider = MODEL_PROVIDERS[providerId];
  if (!provider) return [];
  let models;
  if (provider.dynamicModels) {
    models = normalizeRemoteModels(cfg?.providerModels?.[providerId] || []);
  } else {
    models = provider.models;
  }
  return decorateModels(providerId, models);
}

function updateImageGenerationConfig(cfg) {
  cfg.imageGeneration = resolveImageGenerationConfig(
    cfg.api.provider,
    cfg.api.model,
    cfg.models || []
  );
  return cfg.imageGeneration;
}

function buildPublicModelState(cfg = loadConfig()) {
  const provider = cfg.api?.provider || '';
  const models = getProviderModels(cfg, provider).map(model => ({
    id: model.id,
    name: model.name || model.id,
    capabilities: model.capabilities || {}
  }));
  const current = models.find(model => model.id === cfg.api?.model) || null;
  return {
    provider,
    providerName: MODEL_PROVIDERS[provider]?.name || provider,
    model: current?.id || '',
    capabilities: current?.capabilities || {},
    models
  };
}

function publishModelState(cfg) {
  const detail = buildPublicModelState(cfg);
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('model:changed', detail);
  }
  remoteServer?.broadcast('model-changed', detail);
  return detail;
}

function setActiveModel(modelId) {
  const cfg = loadConfig();
  const id = String(modelId || '').trim();
  const models = getProviderModels(cfg, cfg.api.provider);
  if (!models.some(model => model.id === id)) {
    return { error: '模型不属于当前厂商' };
  }
  cfg.api.model = id;
  cfg.models = models;
  updateImageGenerationConfig(cfg);
  saveConfig(cfg);
  publishModelState(cfg);
  return cfg;
}

function applyProviderSelection(cfg, providerId, apiKey, models) {
  const provider = MODEL_PROVIDERS[providerId];
  if (!cfg.api.apiKeys) cfg.api.apiKeys = buildDefaultApiKeys();
  cfg.api.apiKeys[providerId] = apiKey;
  cfg.api.provider = providerId;
  cfg.api.baseUrl = provider.baseUrl;
  cfg.api.apiKey = apiKey;
  cfg.models = decorateModels(providerId, models);
  if (!cfg.models.some(model => model.id === cfg.api.model)) {
    cfg.api.model = cfg.models[0]?.id || '';
  }
  updateImageGenerationConfig(cfg);
  return cfg;
}

function loadConfig() {
  let cfg = null;
  try {
    if (fs.existsSync(configPath)) {
      cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('loadConfig error:', e);
  }

  const defaults = {
    api: {
      provider: 'deepseek',
      baseUrl: MODEL_PROVIDERS.deepseek.baseUrl,
      apiKey: '',
      apiKeys: buildDefaultApiKeys(),
      model: 'deepseek-v4-flash',
      thinking: false
    },
    workspace: path.join(app.getPath('home'), 'YanWorkspace'),
    theme: 'dark',
    permissions: {
      allowFileRead: true,
      allowFileWrite: true,
      allowShell: false,
      allowNetwork: true
    },
    models: DEFAULT_MODELS,
    providerModels: { openai: [], grok: [] },
    imageGeneration: { available: false, strategy: '', providerId: 'deepseek', model: '' },
    codeMap: {
      model: 'deepseek-v4-flash'
    },
    yanxiCode: {
      executable: ''
    },
    remoteControl: {
      enabled: true,
      port: 0,
      password: ''
    },
    mcpServers: ensureDefaultMcp([]),
    skills: DEFAULT_SKILLS,
    customSkills: [],
    skillsSyncUrl: '',
    skillsLastSyncAt: 0,
    automations: []
  };

  if (!cfg) return defaults;

  const merged = deepMerge(defaults, cfg);

  // 迁移旧配置：旧的单 apiKey 迁移到 apiKeys.deepseek
  if (merged.api?.apiKey && !merged.api.apiKeys?.deepseek) {
    if (!merged.api.apiKeys) merged.api.apiKeys = buildDefaultApiKeys();
    merged.api.apiKeys.deepseek = merged.api.apiKey;
  }

  // 确保 apiKeys 包含所有已知厂商
  if (!merged.api.apiKeys) merged.api.apiKeys = buildDefaultApiKeys();
  for (const id of Object.keys(MODEL_PROVIDERS)) {
    if (merged.api.apiKeys[id] === undefined) merged.api.apiKeys[id] = '';
  }

  // 确保 provider 有效
  if (!merged.api.provider || !MODEL_PROVIDERS[merged.api.provider]) {
    merged.api.provider = 'deepseek';
  }

  const provider = MODEL_PROVIDERS[merged.api.provider];
  merged.api.baseUrl = provider.baseUrl;
  merged.api.apiKey = merged.api.apiKeys[merged.api.provider] || '';

  // 动态厂商使用服务端返回并持久化的模型目录，静态厂商使用内置目录。
  merged.models = getProviderModels(merged, provider.id);

  // 确保当前选中的模型属于当前 provider
  if (!merged.models.find(m => m.id === merged.api.model)) {
    merged.api.model = merged.models[0]?.id || '';
  }
  updateImageGenerationConfig(merged);

  merged.skills = getMergedSkills(merged);
  merged.mcpServers = ensureDefaultMcp(merged.mcpServers || []);
  merged.codeMap = normalizeCodeMapConfig(merged.codeMap);
  merged.remoteControl = normalizeRemoteControlConfig(merged.remoteControl);

  return merged;
}

const CODE_MAP_DEFAULT_MODEL = 'deepseek-v4-flash';

function findModelMeta(modelId) {
  for (const provider of Object.values(MODEL_PROVIDERS)) {
    const model = provider.models.find(item => item.id === modelId);
    if (model) {
      return {
        ...model,
        providerId: provider.id,
        providerName: provider.name,
        baseUrl: provider.baseUrl
      };
    }
  }
  return null;
}

function listAllModelsFlat() {
  const out = [];
  for (const provider of Object.values(MODEL_PROVIDERS)) {
    for (const model of provider.models) {
      out.push({
        id: model.id,
        name: model.name,
        price: model.price || '',
        providerId: provider.id,
        providerName: provider.name
      });
    }
  }
  return out;
}

function normalizeCodeMapConfig(codeMap = {}) {
  const next = { ...(codeMap || {}) };
  if (!next.model || !findModelMeta(next.model)) next.model = CODE_MAP_DEFAULT_MODEL;
  return next;
}

function normalizeRemoteControlConfig(remoteControl = {}) {
  const next = { ...(remoteControl || {}) };
  if (next.enabled === undefined) next.enabled = true;
  const port = Number(next.port);
  next.port = Number.isFinite(port) && port >= 0 ? Math.floor(port) : 0;
  if (!next.password && next.token) next.password = String(next.token);
  delete next.token;
  next.password = String(next.password || '');
  return next;
}

function isRemotePasswordSet(cfg) {
  const pwd = String(cfg?.remoteControl?.password || '');
  return pwd.length >= 4;
}

function verifyRemotePassword(input) {
  const expected = String(loadConfig().remoteControl?.password || '');
  if (expected.length < 4) return false;
  const given = String(input || '');
  if (given.length < 4) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function resolveCodeMapApi(cfg) {
  const modelId = cfg?.codeMap?.model || CODE_MAP_DEFAULT_MODEL;
  const meta = findModelMeta(modelId);
  if (!meta) {
    return {
      modelId: CODE_MAP_DEFAULT_MODEL,
      modelName: 'DeepSeek V4 Flash',
      error: '未找到解读模型。'
    };
  }
  const apiKey = cfg?.api?.apiKeys?.[meta.providerId] || '';
  if (!apiKey) {
    return {
      modelId,
      modelName: meta.name,
      providerId: meta.providerId,
      providerName: meta.providerName,
      error: `请先在设置中配置 ${meta.providerName} API Key。`
    };
  }
  return {
    modelId,
    modelName: meta.name,
    providerId: meta.providerId,
    providerName: meta.providerName,
    api: { apiKey, baseUrl: meta.baseUrl, model: modelId }
  };
}

function saveConfig(cfg) {
  ensureDirs();
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

function notifySkillsChanged(detail = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('skills:changed', detail);
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
const lightWindowIconPngPath = path.join(__dirname, 'renderer', 'assets', 'logo-light.png');
const lightWindowIconIcoPath = path.join(__dirname, 'renderer', 'assets', 'logo-light.ico');

function loadLightAppIcon() {
  let icon = nativeImage.createFromPath(lightWindowIconPngPath);
  if (icon.isEmpty()) icon = nativeImage.createFromPath(lightWindowIconIcoPath);
  return icon;
}

function applyLightWindowIcon(win) {
  if (!win || win.isDestroyed()) return;
  const icon = loadLightAppIcon();
  if (!icon.isEmpty()) win.setIcon(icon);
}

function createWindow() {
  mainRendererReady = false;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    show: false,
    titleBarStyle: 'hidden',
    frame: false,
    autoHideMenuBar: true,
    icon: lightWindowIconPngPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      // 窗口隐藏到托盘时不节流定时器，保证自动化任务准时触发
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.on('did-start-loading', () => { mainRendererReady = false; });
  mainWindow.webContents.on('did-finish-load', () => { mainRendererReady = true; });
  mainWindow.once('ready-to-show', () => {
    applyLightWindowIcon(mainWindow);
    mainWindow.show();
    if (pendingFocusMainFromYanxi) {
      mainWindow.focus();
      pendingFocusMainFromYanxi = false;
    }
  });
  mainWindow.on('show', () => applyLightWindowIcon(mainWindow));

  // Sync maximize state to renderer (for toggling the maximize button icon)
  mainWindow.on('maximize', () => mainWindow.webContents.send('win:maximize-changed', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('win:maximize-changed', false));

  // Forward renderer console to terminal for debugging
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = ['LOG', 'WARN', 'ERROR'][level] || 'LOG';
    console.log(`[renderer ${tag}] ${message}  (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.log('[renderer gone]', JSON.stringify(details));
    terminalManager.destroyOwner(mainWindow?.webContents?.id);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log('[did-fail-load]', code, desc, url);
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // 关闭窗口时最小化到托盘，而非真正退出
  mainWindow.on('close', (e) => {
    if (!isQuiting) {
      e.preventDefault();
      mainWindow.hide();
      return;
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function openGeneratedImageViewer(assetId) {
  const asset = getGeneratedImageAsset(assetId);
  if (!asset) return { error: '会话图片已失效，请重新生成' };
  const existing = generatedImageViewers.get(asset.assetId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return { ok: true };
  }

  const viewer = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 560,
    minHeight: 420,
    title: '图片预览',
    backgroundColor: '#111111',
    show: false,
    autoHideMenuBar: true,
    icon: lightWindowIconPngPath,
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'image-viewer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  generatedImageViewers.set(asset.assetId, viewer);
  viewer.loadFile(path.join(__dirname, 'renderer', 'image-viewer', 'index.html'), {
    query: { assetId: asset.assetId }
  });
  viewer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  viewer.once('ready-to-show', () => {
    applyLightWindowIcon(viewer);
    viewer.show();
  });
  viewer.on('closed', () => generatedImageViewers.delete(asset.assetId));
  return { ok: true };
}

const PET_COLLAPSED_SIZE = { width: 176, height: 190 };
const PET_EXPANDED_SIZE = { width: 324, height: 340 };

function getInitialPetBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    width: PET_COLLAPSED_SIZE.width,
    height: PET_COLLAPSED_SIZE.height,
    x: workArea.x + workArea.width - PET_COLLAPSED_SIZE.width - 18,
    y: workArea.y + workArea.height - PET_COLLAPSED_SIZE.height - 18
  };
}

function resizePetWindow(expanded) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const current = petWindow.getBounds();
  const nextSize = expanded ? PET_EXPANDED_SIZE : PET_COLLAPSED_SIZE;
  const display = screen.getDisplayMatching(current);
  const area = display.workArea;
  const right = current.x + current.width;
  const bottom = current.y + current.height;
  const next = {
    width: nextSize.width,
    height: nextSize.height,
    x: right - nextSize.width,
    y: bottom - nextSize.height
  };
  next.x = Math.max(area.x, Math.min(next.x, area.x + area.width - next.width));
  next.y = Math.max(area.y, Math.min(next.y, area.y + area.height - next.height));
  petWindow.setBounds(next, true);
}

function sendPetState() {
  if (!petWindow || petWindow.isDestroyed() || petWindow.webContents.isDestroyed()) return;
  petWindow.webContents.send('pet:state', petState);
}

function notifyPetVisibility() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('pet:visibility', {
    visible: !!(petWindow && !petWindow.isDestroyed() && petWindow.isVisible())
  });
}

function destroyPetWindow() {
  if (!petWindow || petWindow.isDestroyed()) {
    petWindow = null;
    notifyPetVisibility();
    return;
  }
  petWindow.destroy();
}

function togglePetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    destroyPetWindow();
    return false;
  }
  createPetWindow();
  return true;
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.showInactive();
    return petWindow;
  }

  petWindow = new BrowserWindow({
    ...getInitialPetBounds(),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'pet', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true
    }
  });

  petWindow.setAlwaysOnTop(true, 'floating');
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  petWindow.loadFile(path.join(__dirname, 'renderer', 'pet', 'index.html'));
  petWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  petWindow.once('ready-to-show', () => {
    petWindow.showInactive();
    sendPetState();
    notifyPetVisibility();
  });
  petWindow.on('close', (event) => {
    if (!isQuiting) {
      event.preventDefault();
      petWindow.hide();
    }
  });
  petWindow.on('closed', () => {
    petWindow = null;
    notifyPetVisibility();
  });
  return petWindow;
}

function showMainWindowForPet(sessionId) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (sessionId) {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pet:action', { type: 'open-task', sessionId });
      }
    }, 0);
  }
}

function normalizePetState(payload = {}) {
  const allowedStates = new Set(['idle', 'observing', 'warning', 'paused', 'completed', 'error']);
  const stats = payload.stats || {};
  return {
    status: allowedStates.has(payload.status) ? payload.status : 'observing',
    sessionId: payload.sessionId ? String(payload.sessionId) : null,
    running: !!payload.running,
    title: String(payload.title || 'Yan Agent').slice(0, 80),
    message: String(payload.message || '正在监督任务').slice(0, 140),
    assessment: String(payload.assessment || '未发现异常').slice(0, 180),
    stats: {
      iteration: Math.max(0, Number(stats.iteration) || 0),
      toolCalls: Math.max(0, Number(stats.toolCalls) || 0),
      changes: Math.max(0, Number(stats.changes) || 0)
    },
    updatedAt: Date.now()
  };
}

// ---------------------------------------------------------------------------
// Tray (后台保活)
// ---------------------------------------------------------------------------
function createTray() {
  const icon = loadLightAppIcon();
  let trayIcon = icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 });
  if (trayIcon.isEmpty()) return;
  tray = new Tray(trayIcon);
  tray.setToolTip('Yan Agent');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主界面',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: '打开/关闭桌宠',
      click: () => togglePetWindow()
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuiting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  // 单击托盘图标：显示/隐藏主窗口
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  // 双击托盘图标：显示主窗口
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// IPC: Config / API / Models
// ---------------------------------------------------------------------------
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('yanxi:consume-pending-workspace', () => yanxiReceiver.consumePendingWorkspaceForRenderer());
ipcMain.handle('config:set', (_e, partial) => {
  const cfg = loadConfig();
  const merged = deepMerge(cfg, partial);

  // 确保 apiKeys 结构完整
  if (!merged.api.apiKeys) merged.api.apiKeys = buildDefaultApiKeys();
  for (const id of Object.keys(MODEL_PROVIDERS)) {
    if (merged.api.apiKeys[id] === undefined) merged.api.apiKeys[id] = '';
  }

  // 确保 provider 有效
  if (!merged.api.provider || !MODEL_PROVIDERS[merged.api.provider]) {
    merged.api.provider = 'deepseek';
  }

  const provider = MODEL_PROVIDERS[merged.api.provider];
  merged.api.baseUrl = provider.baseUrl;
  merged.api.apiKey = merged.api.apiKeys[merged.api.provider] || '';
  merged.models = getProviderModels(merged, provider.id);

  // 确保当前选中的模型属于当前 provider
  if (!merged.models.find(m => m.id === merged.api.model)) {
    merged.api.model = merged.models[0]?.id || '';
  }
  updateImageGenerationConfig(merged);

  merged.skills = getMergedSkills(merged);
  merged.mcpServers = ensureDefaultMcp(merged.mcpServers || []);
  merged.codeMap = normalizeCodeMapConfig(merged.codeMap);
  merged.remoteControl = normalizeRemoteControlConfig(merged.remoteControl);
  if (partial && Object.prototype.hasOwnProperty.call(partial, 'workspace')) {
    startWorkspaceWatcher(merged.workspace);
  }
  saveConfig(merged);
  if (partial?.remoteControl) {
    restartRemoteServer().catch((e) => console.error('[remote] restart failed:', e.message));
  }
  return merged;
});

ipcMain.handle('providers:list', () => {
  const cfg = loadConfig();
  const list = [];
  for (const id of Object.keys(MODEL_PROVIDERS)) {
    const p = MODEL_PROVIDERS[id];
    list.push({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKeyPlaceholder: p.apiKeyPlaceholder,
      modelCount: getProviderModels(cfg, p.id).length,
      dynamicModels: !!p.dynamicModels
    });
  }
  return list;
});

ipcMain.handle('external:open', async (_e, url) => {
  const allowedUrl = 'https://ai8.my/';
  if (String(url || '') !== allowedUrl) return { error: '不允许打开该链接' };
  try {
    await shell.openExternal(allowedUrl);
    return { ok: true };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('provider:set', (_e, providerId) => {
  const cfg = loadConfig();
  if (!MODEL_PROVIDERS[providerId]) return { error: '未知厂商: ' + providerId };
  cfg.api.provider = providerId;
  const provider = MODEL_PROVIDERS[providerId];
  cfg.api.baseUrl = provider.baseUrl;
  cfg.api.apiKey = cfg.api.apiKeys?.[providerId] || '';
  cfg.models = getProviderModels(cfg, providerId);
  cfg.api.model = cfg.models[0]?.id || '';
  updateImageGenerationConfig(cfg);
  saveConfig(cfg);
  publishModelState(cfg);
  return cfg;
});

ipcMain.handle('provider:configure', async (_e, { providerId, apiKey } = {}) => {
  const provider = MODEL_PROVIDERS[providerId];
  if (!provider) return { error: '未知厂商: ' + providerId };
  const key = String(apiKey || '').trim();
  let models = provider.models;
  if (provider.dynamicModels) {
    if (!key) {
      models = [];
    } else {
      try {
        models = await fetchRemoteModelCatalog({ baseUrl: provider.baseUrl, apiKey: key });
      } catch (error) {
        return { error: `模型加载失败：${error.message}` };
      }
    }
  }

  const cfg = loadConfig();
  if (!cfg.providerModels) cfg.providerModels = {};
  if (provider.dynamicModels) cfg.providerModels[providerId] = models;
  applyProviderSelection(cfg, providerId, key, models);
  saveConfig(cfg);
  publishModelState(cfg);
  return { ok: true, config: cfg, modelCount: models.length };
});

ipcMain.handle('provider:models:refresh', async (_e, providerId) => {
  const provider = MODEL_PROVIDERS[providerId];
  if (!provider?.dynamicModels) return { error: '该厂商不使用动态模型目录' };
  const cfg = loadConfig();
  const apiKey = cfg.api.apiKeys?.[providerId] || '';
  try {
    const models = await fetchRemoteModelCatalog({ baseUrl: provider.baseUrl, apiKey });
    if (!cfg.providerModels) cfg.providerModels = {};
    cfg.providerModels[providerId] = models;
    if (cfg.api.provider === providerId) {
      applyProviderSelection(cfg, providerId, apiKey, models);
    }
    saveConfig(cfg);
    if (cfg.api.provider === providerId) publishModelState(cfg);
    return { ok: true, config: cfg, modelCount: models.length };
  } catch (error) {
    return { error: `模型加载失败：${error.message}` };
  }
});

ipcMain.handle('models:list', () => loadConfig().models);
ipcMain.handle('model:set', (_e, modelId) => setActiveModel(modelId));

ipcMain.handle('skills:list', () => getMergedSkills(loadConfig()));

ipcMain.handle('skills:add-custom', (_e, skill) => {
  const cfg = loadConfig();
  if (!cfg.customSkills) cfg.customSkills = [];
  const item = {
    id: String(skill.id || '').trim(),
    name: String(skill.name || skill.id || 'Custom Skill').trim(),
    desc: String(skill.desc || '').trim(),
    prompt: String(skill.prompt || '').trim(),
    source: skill.source || 'custom',
    installedAt: Date.now()
  };
  if (!item.id || !item.prompt) return { error: 'id 和 prompt 为必填项' };
  if (DEFAULT_SKILLS.find(s => s.id === item.id)) return { error: '与内置 Skill 冲突' };
  const idx = cfg.customSkills.findIndex(s => s.id === item.id);
  if (idx >= 0) cfg.customSkills[idx] = item;
  else cfg.customSkills.push(item);
  saveConfig(cfg);
  return item;
});

ipcMain.handle('skills:remove-custom', (_e, id) => {
  const cfg = loadConfig();
  cfg.customSkills = (cfg.customSkills || []).filter(s => s.id !== id);
  saveConfig(cfg);
  return true;
});

ipcMain.handle('skills:get-custom', () => loadConfig().customSkills || []);

ipcMain.handle('skills:market', () => skillRegistry.getMarketSkills(appRoot, dataDir));

ipcMain.handle('skills:catalog', () =>
  skillRegistry.getSkillCatalog(loadConfig(), appRoot, dataDir));

ipcMain.handle('skills:prompt-section', () =>
  skillRegistry.formatCatalogForPrompt(loadConfig(), appRoot, dataDir));

ipcMain.handle('skills:read', (_e, payload) => {
  const { id, taskContext } = payload || {};
  const cfg = loadConfig();
  const result = skillRegistry.readSkill(id, taskContext, cfg, appRoot, dataDir, saveConfig);
  if (result?.autoInstalled) notifySkillsChanged({ id: result.id, action: 'install', source: 'agent' });
  return result;
});

ipcMain.handle('skills:ensure', (_e, { id } = {}) => {
  const cfg = loadConfig();
  const result = skillRegistry.ensureSkill(id, cfg, appRoot, dataDir, saveConfig);
  if (result?.autoInstalled) notifySkillsChanged({ id: result.skill?.id, action: 'install', source: 'ensure' });
  return result;
});

ipcMain.handle('skills:sync', async () => {
  const cfg = loadConfig();
  return skillRegistry.syncMarketFromGitHub(cfg, appRoot, dataDir, saveConfig);
});

ipcMain.handle('ui-kits:list', () => uiKitRegistry.listKits(appRoot));

ipcMain.handle('ui-kits:catalog', (_e, { kit, query } = {}) =>
  uiKitRegistry.listUiKit(appRoot, kit, query));

ipcMain.handle('ui-kits:prompt-section', () => uiKitRegistry.formatPromptSection(appRoot));

ipcMain.handle('ui-kits:read', (_e, { kit, component, variant } = {}) =>
  uiKitRegistry.readUiKit(appRoot, kit, component, variant));

// ---------------------------------------------------------------------------
// IPC: Workspace
// ---------------------------------------------------------------------------
let workspaceWatcher = null;
let workspaceNotifyTimer = null;
const pendingWorkspaceChanges = new Map();

function shouldIgnoreWorkspaceWatch(filename) {
  if (!filename) return false;
  const norm = String(filename).replace(/\\/g, '/');
  return norm === YANAGENT_DIR || norm.startsWith(YANAGENT_DIR + '/');
}

function notifyWorkspaceChanged(detail = {}) {
  if (detail.path) {
    pendingWorkspaceChanges.set(detail.path, {
      path: detail.path,
      eventType: detail.eventType || 'change'
    });
  }
  if (workspaceNotifyTimer) clearTimeout(workspaceNotifyTimer);
  workspaceNotifyTimer = setTimeout(() => {
    workspaceNotifyTimer = null;
    const payload = {
      workspace: detail.workspace || loadConfig().workspace,
      changes: [...pendingWorkspaceChanges.values()].slice(0, 100),
      timestamp: Date.now()
    };
    pendingWorkspaceChanges.clear();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('workspace:changed', payload);
    }
  }, 300);
}

function stopWorkspaceWatcher() {
  if (workspaceWatcher) {
    workspaceWatcher.close();
    workspaceWatcher = null;
  }
  pendingWorkspaceChanges.clear();
}

function startWorkspaceWatcher(workspace) {
  stopWorkspaceWatcher();
  if (!workspace || !fs.existsSync(workspace)) return;
  try {
    workspaceWatcher = fs.watch(workspace, { recursive: true }, (eventType, filename) => {
      if (shouldIgnoreWorkspaceWatch(filename)) return;
      const relPath = String(filename || '').replace(/\\/g, '/');
      notifyWorkspaceChanged({
        workspace,
        eventType,
        path: relPath ? path.join(workspace, relPath) : workspace
      });
    });
    workspaceWatcher.on('error', () => stopWorkspaceWatcher());
  } catch {
    stopWorkspaceWatcher();
  }
}

const pendingYanxiWorkspace = parseOpenWorkspaceArg();
const pendingYanxiRequestId = parseYanxiRequestIdArg();
let pendingFocusMainFromYanxi = process.argv.includes('--show-main') || pendingYanxiWorkspace !== undefined;

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingFocusMainFromYanxi = true;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const yanxiReceiver = createYanxiCodeReceiver({
  dataDir,
  loadConfig,
  saveConfig,
  startWorkspaceWatcher,
  getMainWindow: () => mainWindow,
  isRendererReady: () => mainRendererReady,
  focusMainWindow,
});

ipcMain.handle('workspace:get', () => loadConfig().workspace);
function activateWorkspace(workspace) {
  const ws = workspace || '';
  const cfg = loadConfig();
  cfg.workspace = ws;
  saveConfig(cfg);
  if (ws) {
    migrateMemoryToWorkspace(ws);
    ensureYanagent(ws);
  }
  startWorkspaceWatcher(ws);
  return cfg;
}
ipcMain.handle('workspace:activate', (_e, workspace) => activateWorkspace(workspace));
ipcMain.handle('workspace:clear', () => {
  const cfg = loadConfig();
  cfg.workspace = '';
  saveConfig(cfg);
  stopWorkspaceWatcher();
  return true;
});
ipcMain.handle('workspace:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length) {
    const cfg = loadConfig();
    cfg.workspace = result.filePaths[0];
    saveConfig(cfg);
    startWorkspaceWatcher(cfg.workspace);
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('workspace:list', async (_e, dirPath) => {
  const root = dirPath || loadConfig().workspace;
  if (!fs.existsSync(root)) return [];
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    return entries.map(e => ({
      name: e.name,
      path: path.join(root, e.name),
      isDirectory: e.isDirectory()
    })).filter(e => e.name !== YANAGENT_DIR).sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch (e) {
    return [];
  }
});

// ---------------------------------------------------------------------------
// IPC: Sessions (CRUD)
// ---------------------------------------------------------------------------
function sessionPath(id) { return path.join(sessionsDir, `${id}.json`); }

function sortSessionRecords(list) {
  return list.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

async function readSessionRecords() {
  ensureDirs();
  const files = await fsp.readdir(sessionsDir);
  const list = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      list.push(JSON.parse(await fsp.readFile(path.join(sessionsDir, file), 'utf8')));
    } catch { /* skip invalid session files */ }
  }
  return sortSessionRecords(list);
}

function toSessionSummary(data) {
  return {
    id: data.id,
    title: data.title,
    workspace: data.workspace || '',
    pinned: !!data.pinned,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    messageCount: (data.messages || []).length
  };
}

async function listSessionSummaries() {
  return (await readSessionRecords()).map(toSessionSummary);
}

function broadcastSessionUpdate(detail) {
  remoteServer?.broadcast('session-updated', detail || {});
}

function notifyDesktopSessionUpdate(detail) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('session:changed', detail || {});
}

let createSessionPromise = null;

async function createFreshSessionRecord() {
  ensureDirs();
  const id = 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const session = {
    id, title: '新对话', messages: [], pinned: false, workspace: '',
    createdAt: Date.now(), updatedAt: Date.now()
  };
  await fsp.writeFile(sessionPath(id), JSON.stringify(session, null, 2));
  return session;
}

async function createOrReuseSessionRecord() {
  if (createSessionPromise) return createSessionPromise;
  createSessionPromise = (async () => {
    const sessions = await readSessionRecords();
    const existing = findReusableBlankSession(sessions);
    if (existing) return { session: existing, reused: true };
    return { session: await createFreshSessionRecord(), reused: false };
  })();
  try {
    return await createSessionPromise;
  } finally {
    createSessionPromise = null;
  }
}

async function renameSessionRecord(id, title) {
  const p = sessionPath(id);
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(await fsp.readFile(p, 'utf8'));
  const nextTitle = String(title || '').trim().slice(0, 80);
  if (!nextTitle) return null;
  data.title = nextTitle;
  data.updatedAt = Date.now();
  await fsp.writeFile(p, JSON.stringify(data, null, 2));
  return data;
}

async function setSessionPinnedRecord(id, pinned) {
  const p = sessionPath(id);
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(await fsp.readFile(p, 'utf8'));
  data.pinned = !!pinned;
  data.updatedAt = Date.now();
  await fsp.writeFile(p, JSON.stringify(data, null, 2));
  return data;
}

async function deleteSessionRecord(id, options = {}) {
  const sessions = await readSessionRecords();
  const session = sessions.find(item => item.id === id);
  const decision = evaluateSessionDeletion(session, sessions.length, options);
  if (!decision.ok) return decision;
  await fsp.unlink(sessionPath(id));
  return { ok: true, id };
}

ipcMain.handle('session:list', () => listSessionSummaries());

ipcMain.handle('session:get', async (_e, id) => {
  const p = sessionPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(await fsp.readFile(p, 'utf8'));
});

ipcMain.handle('session:create', async (_e, options = {}) => {
  const result = options.forceNew
    ? { session: await createFreshSessionRecord(), reused: false }
    : await createOrReuseSessionRecord();
  if (!result.reused) broadcastSessionUpdate({ type: 'created', id: result.session.id });
  return result.session;
});

ipcMain.handle('session:save', async (_e, session) => {
  ensureDirs();
  session.updatedAt = Date.now();
  await fsp.writeFile(sessionPath(session.id), JSON.stringify(session, null, 2));
  broadcastSessionUpdate({ type: 'updated', id: session.id });
  return session;
});

// 会话级工作区：存储在 session 对象中，而非全局 config，实现会话隔离
ipcMain.handle('session:set-workspace', async (_e, { id, workspace, activate = true }) => {
  const p = sessionPath(id);
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(await fsp.readFile(p, 'utf8'));
  data.workspace = workspace || '';
  data.updatedAt = Date.now();
  await fsp.writeFile(p, JSON.stringify(data, null, 2));
  if (activate !== false) {
    activateWorkspace(workspace || '');
  } else if (workspace) {
    migrateMemoryToWorkspace(workspace);
    ensureYanagent(workspace);
  }
  broadcastSessionUpdate({ type: 'workspace', id });
  return data;
});

ipcMain.handle('session:rename', async (_e, { id, title }) => {
  const data = await renameSessionRecord(id, title);
  if (data) broadcastSessionUpdate({ type: 'renamed', id });
  return data;
});

ipcMain.handle('session:set-pinned', async (_e, { id, pinned }) => {
  const data = await setSessionPinnedRecord(id, pinned);
  if (data) broadcastSessionUpdate({ type: 'pinned', id, pinned: !!pinned });
  return data;
});

ipcMain.handle('session:delete', async (_e, payload) => {
  const id = typeof payload === 'string' ? payload : payload?.id;
  const confirmed = typeof payload === 'object' && !!payload?.confirmed;
  const result = await deleteSessionRecord(id, { confirmed });
  if (result.ok) broadcastSessionUpdate({ type: 'deleted', id });
  return result;
});

// ---------------------------------------------------------------------------
// IPC: Long-term memory (global, cross-session)
// ---------------------------------------------------------------------------
function loadMemory() {
  try {
    const p = resolveMemoryPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) { console.error('loadMemory error:', e); }
  return { facts: [], updatedAt: 0 };
}

function saveMemory(mem) {
  ensureDirs();
  const ws = loadConfig().workspace;
  if (ws) migrateMemoryToWorkspace(ws);
  mem.updatedAt = Date.now();
  const p = resolveMemoryPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(mem, null, 2));
  return mem;
}

ipcMain.handle('memory:get', () => loadMemory());
ipcMain.handle('memory:save', (_e, mem) => saveMemory(mem));
ipcMain.handle('memory:add-fact', (_e, fact) => {
  const mem = loadMemory();
  if (!mem.facts) mem.facts = [];
  // 去重：相同文本不再添加
  const exists = mem.facts.some(f => f.content === fact.content);
  if (!exists) {
    mem.facts.push({ ...fact, ts: Date.now() });
    saveMemory(mem);
  }
  return mem;
});
ipcMain.handle('memory:clear', () => {
  saveMemory({ facts: [], updatedAt: 0 });
  return true;
});

// ---------------------------------------------------------------------------
// IPC: .yanagent (snapshots, rollback, logs)
// ---------------------------------------------------------------------------
ipcMain.handle('yanagent:ensure', async (_e, workspace) => {
  const ws = workspace || loadConfig().workspace;
  if (!ws) return { ok: false, error: '未设置工作区' };
  const root = ensureYanagent(ws);
  return { ok: true, path: root };
});

ipcMain.handle('yanagent:log', async (_e, { message, workspace }) => {
  const ws = workspace || loadConfig().workspace;
  if (!ws) return { ok: false };
  appendYanagentLog(ws, String(message || ''));
  return { ok: true };
});

ipcMain.handle('yanagent:record-change', async (_e, { sessionId, runId, filePath, before, op, workspace }) => {
  const ws = workspace || loadConfig().workspace;
  if (!ws || !sessionId || !runId || !filePath) return { ok: false, error: 'missing params' };
  if (isYanagentPath(filePath)) return { ok: true, skipped: true };
  const snapPath = runSnapshotPath(ws, sessionId, runId);
  let data = { sessionId, runId, changes: [] };
  try {
    if (fs.existsSync(snapPath)) {
      data = JSON.parse(await fsp.readFile(snapPath, 'utf8'));
    }
  } catch {}
  const key = filePath.toLowerCase();
  if (data.changes.some(c => c.path.toLowerCase() === key)) {
    return { ok: true, count: data.changes.length, deduped: true };
  }
  data.changes.push({
    path: filePath,
    before: before !== undefined ? before : null,
    op: op || 'write',
    ts: Date.now()
  });
  await fsp.writeFile(snapPath, JSON.stringify(data, null, 2));
  appendYanagentLog(ws, `[snapshot] ${op || 'write'} ${filePath} (run ${runId})`);
  return { ok: true, count: data.changes.length };
});

ipcMain.handle('yanagent:run-changes', async (_e, { sessionId, runId, workspace }) => {
  const ws = workspace || loadConfig().workspace;
  if (!ws || !sessionId || !runId) return { count: 0, additions: 0, deletions: 0, files: [] };
  const snapPath = runSnapshotPath(ws, sessionId, runId);
  if (!fs.existsSync(snapPath)) return { count: 0, additions: 0, deletions: 0, files: [] };
  try {
    const data = JSON.parse(await fsp.readFile(snapPath, 'utf8'));
    return summarizeRunChanges(ws, data.changes || []);
  } catch {
    return { count: 0, additions: 0, deletions: 0, files: [] };
  }
});

ipcMain.handle('yanagent:rollback-run', async (_e, { sessionId, runId, workspace }) => {
  const ws = workspace || loadConfig().workspace;
  if (!ws || !sessionId || !runId) return { ok: false, error: '未设置工作区、会话或 runId' };
  const snapPath = runSnapshotPath(ws, sessionId, runId);
  if (!fs.existsSync(snapPath)) return { ok: false, error: '该轮对话没有可撤销的文件改动' };
  let data;
  try {
    data = JSON.parse(await fsp.readFile(snapPath, 'utf8'));
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const changes = data.changes || [];
  const results = await applySnapshotRollback(changes);
  try { await fsp.unlink(snapPath); } catch {}
  appendYanagentLog(ws, `[rollback] run ${runId} (session ${sessionId}): ${results.length} file(s)`);
  return { ok: true, results, count: changes.length, runId };
});

// ---------------------------------------------------------------------------
// IPC: File operations (read/write/list/upload)
// ---------------------------------------------------------------------------
ipcMain.handle('file:read', async (_e, filePath) => {
  const cfg = loadConfig();
  if (!cfg.permissions.allowFileRead) {
    return { error: 'File read is disabled in permissions.' };
  }
  try {
    const stat = await fsp.stat(filePath);
    // Detect binary: read first 4KB as buffer and check for null bytes
    const handle = await fsp.open(filePath, 'r');
    const buf = Buffer.alloc(Math.min(4096, stat.size));
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    await handle.close();
    const sample = buf.subarray(0, bytesRead);
    const isBinary = sample.includes(0);
    if (isBinary) {
      return { path: filePath, isBinary: true, size: stat.size, mtime: stat.mtimeMs };
    }
    // 小文件直接复用已读 buffer，避免重复 I/O；大文件再完整读取
    let content;
    if (stat.size <= bytesRead) {
      content = sample.toString('utf8');
    } else {
      content = await fsp.readFile(filePath, 'utf8');
    }
    return { path: filePath, content, isBinary: false, size: stat.size, mtime: stat.mtimeMs };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('file:read-range', async (_e, { filePath, start_line, end_line }) => {
  const cfg = loadConfig();
  if (!cfg.permissions.allowFileRead) {
    return { error: 'File read is disabled in permissions.' };
  }
  try {
    const stat = await fsp.stat(filePath);
    if (stat.size > 2 * 1024 * 1024) {
      return { error: 'File too large for read_file_range (max 2MB). Use get_file_outline first.' };
    }
    const content = await fsp.readFile(filePath, 'utf8');
    const range = codeIndex.readFileRange(content, start_line, end_line);
    if (range.error) return { error: range.error, path: filePath };
    return {
      path: filePath,
      start: range.start,
      end: range.end,
      lineCount: range.lineCount,
      content: range.content
    };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('file:write', async (_e, { filePath, content }) => {
  const cfg = loadConfig();
  if (!cfg.permissions.allowFileWrite) {
    return { error: 'File write is disabled in permissions.' };
  }
  try {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, content, 'utf8');
    const stat = await fsp.stat(filePath);
    return { path: filePath, size: stat.size, mtime: stat.mtimeMs };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('file:choose-open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths.length) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('file:choose-save', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {});
  if (!result.canceled) return result.filePath;
  return null;
});

function resolveStoredUploadPath(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  const relative = path.relative(path.resolve(filesDir), resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function sanitizeUploadName(name) {
  const base = path.basename(String(name || 'attachment'));
  return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'attachment';
}

function findRemoteUploadedImage(uploadId) {
  const id = String(uploadId || '').trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  for (const extension of ['png', 'jpg', 'webp', 'gif']) {
    const filePath = path.join(filesDir, `${id}.${extension}`);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

async function storeRemoteUploadedImage({ name, data, mimeType }) {
  const raw = String(data || '');
  if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) return { error: '图片数据格式无效' };
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) return { error: '图片内容为空' };
  if (buffer.length > 20 * 1024 * 1024) return { error: '图片不能超过 20MB' };
  let type;
  try { type = detectImageType(buffer, String(mimeType || '')); }
  catch { return { error: '仅支持 PNG、JPEG、WebP 或 GIF 图片' }; }
  ensureDirs();
  const uploadId = crypto.randomBytes(16).toString('hex');
  const filePath = path.join(filesDir, `${uploadId}.${type.extension}`);
  await fsp.writeFile(filePath, buffer);
  const originalBase = path.parse(sanitizeUploadName(name || '手机图片')).name.slice(0, 80) || '手机图片';
  return {
    uploadId,
    name: `${originalBase}.${type.extension}`,
    size: buffer.length,
    mimeType: type.mimeType,
    kind: 'image'
  };
}

async function resolveRemoteUploadedImages(items) {
  const attachments = [];
  for (const item of (Array.isArray(items) ? items : []).slice(0, 4)) {
    const filePath = findRemoteUploadedImage(item?.uploadId);
    if (!filePath) continue;
    try {
      const buffer = await fsp.readFile(filePath);
      const type = detectImageType(buffer);
      attachments.push({
        uploadId: String(item.uploadId).toLowerCase(),
        name: sanitizeUploadName(item.name || path.basename(filePath)),
        path: filePath,
        size: buffer.length,
        mimeType: type.mimeType,
        kind: 'image'
      });
    } catch {}
  }
  return attachments;
}

// Upload: copy a file into the uploads dir & return metadata
ipcMain.handle('file:upload', async (_e, { name, data: b64, mimeType = '' }) => {
  ensureDirs();
  const safeName = sanitizeUploadName(name);
  const buffer = Buffer.from(String(b64 || ''), 'base64');
  if (buffer.length > 50 * 1024 * 1024) return { error: '附件不能超过 50MB' };
  const target = path.join(filesDir, Date.now() + '_' + safeName);
  await fsp.writeFile(target, buffer);
  const stat = await fsp.stat(target);
  return { path: target, name: safeName, size: stat.size, mimeType: String(mimeType || '') };
});

ipcMain.handle('file:image-data', async (_e, filePath) => {
  const cfg = loadConfig();
  if (!cfg.permissions.allowFileRead) return { error: '文件读取权限已关闭' };
  const storedPath = resolveStoredUploadPath(filePath);
  if (!storedPath) return { error: '只能读取 Yan Agent 保存的图片附件' };
  try {
    const stat = await fsp.stat(storedPath);
    if (stat.size > 20 * 1024 * 1024) return { error: '图片不能超过 20MB' };
    const buffer = await fsp.readFile(storedPath);
    const type = detectImageType(buffer);
    return {
      path: storedPath,
      size: stat.size,
      mimeType: type.mimeType,
      dataUrl: `data:${type.mimeType};base64,${buffer.toString('base64')}`
    };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('image:generate', async (_e, payload = {}) => {
  const cfg = loadConfig();
  if (!cfg.permissions.allowNetwork) return { error: '网络访问权限已关闭，无法生成图片' };
  const imageConfig = updateImageGenerationConfig(cfg);
  if (!imageConfig.available) return { error: '当前模型配置没有可用的图片生成能力' };
  const prompt = String(payload.prompt || '').trim();
  const requestId = String(payload.requestId || '').trim().slice(0, 160);
  if (!prompt) return { error: '生图提示词不能为空' };
  if (prompt.length > 4000) return { error: '生图提示词不能超过 4000 个字符' };
  if (!requestId) return { error: '生图请求缺少任务标识' };
  if (activeImageGenerations.has(requestId)) return { error: '该生图任务正在执行，请勿重复提交' };
  let sourceImage = null;
  if (payload.sourceImagePath) {
    if (!cfg.permissions.allowFileRead) return { error: '文件读取权限已关闭，无法编辑图片' };
    const sourcePath = resolveStoredUploadPath(payload.sourceImagePath);
    if (!sourcePath) return { error: '只能编辑 Yan Agent 保存的图片附件' };
    try {
      const stat = await fsp.stat(sourcePath);
      if (stat.size > 20 * 1024 * 1024) return { error: '输入图片不能超过 20MB' };
      const buffer = await fsp.readFile(sourcePath);
      const type = detectImageType(buffer);
      sourceImage = { buffer, mimeType: type.mimeType, name: path.basename(sourcePath) };
    } catch (error) {
      return { error: `无法读取输入图片：${error.message}` };
    }
  }
  const controller = new AbortController();
  const activeRequest = { controller, ownerId: _e.sender.id };
  activeImageGenerations.set(requestId, activeRequest);
  try {
    const result = await generateImage({
      baseUrl: cfg.api.baseUrl,
      apiKey: cfg.api.apiKey,
      providerId: imageConfig.providerId,
      strategy: imageConfig.strategy,
      model: imageConfig.model,
      prompt,
      aspectRatio: payload.aspectRatio || '1:1',
      signal: controller.signal,
      sourceImage
    });
    const asset = await registerGeneratedImage(result);
    return {
      ok: true,
      assetId: asset.assetId,
      name: asset.name,
      size: result.buffer.length,
      mimeType: result.mimeType,
      model: imageConfig.model,
      strategy: imageConfig.strategy,
      edited: !!result.edited,
      revisedPrompt: result.revisedPrompt || ''
    };
  } catch (error) {
    return { error: error.message, code: error.code || undefined };
  } finally {
    if (activeImageGenerations.get(requestId) === activeRequest) {
      activeImageGenerations.delete(requestId);
    }
  }
});

ipcMain.handle('image:cancel', (_e, requestId) => {
  const id = String(requestId || '').trim();
  const activeRequest = activeImageGenerations.get(id);
  if (!activeRequest || activeRequest.ownerId !== _e.sender.id) return { ok: false };
  activeRequest.controller.abort();
  return { ok: true };
});

ipcMain.handle('image:generated-read', async (_e, assetId) => {
  const asset = getGeneratedImageAsset(assetId);
  if (!asset) return { error: '会话图片已失效，请重新生成' };
  try {
    const buffer = await fsp.readFile(asset.filePath);
    return {
      assetId: asset.assetId,
      name: asset.name,
      size: asset.size,
      mimeType: asset.mimeType,
      dataUrl: `data:${asset.mimeType};base64,${buffer.toString('base64')}`
    };
  } catch (error) {
    generatedImages.delete(asset.assetId);
    return { error: error.message };
  }
});

ipcMain.handle('image:generated-open', (_e, assetId) => openGeneratedImageViewer(assetId));

ipcMain.handle('image:generated-download', async (_e, assetId) => {
  const asset = getGeneratedImageAsset(assetId);
  if (!asset) return { error: '会话图片已失效，请重新生成' };
  const owner = BrowserWindow.fromWebContents(_e.sender);
  const extension = path.extname(asset.name).slice(1).toLowerCase() || 'png';
  const result = await dialog.showSaveDialog(owner && !owner.isDestroyed() ? owner : mainWindow, {
    title: '下载图片',
    buttonLabel: '下载',
    defaultPath: path.join(app.getPath('downloads'), asset.name),
    filters: [{ name: '图片', extensions: [extension] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    await fsp.copyFile(asset.filePath, result.filePath);
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { error: `下载失败：${error.message}` };
  }
});

ipcMain.handle('file:reveal', async (_e, filePath) => {
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('yanxi:launch', async (_e, { workspace, mode = 'workspace' } = {}) => {
  const cfg = loadConfig();
  const ws = workspace || cfg.workspace;
  return launchYanxiCode(appRoot, cfg, ws, mode);
});

ipcMain.handle('file:delete', async (_e, filePath) => {
  const cfg = loadConfig();
  if (!cfg.permissions.allowFileWrite) return { error: 'Permission denied.' };
  try {
    await fsp.unlink(filePath);
    return { ok: true };
  } catch (e) { return { error: e.message }; }
});

// ---------------------------------------------------------------------------
// IPC: Shell execution
// ---------------------------------------------------------------------------
ipcMain.handle('shell:execute', async (_e, { command, cwd, oneShot }) => {
  const cfg = loadConfig();
  if (!cfg.permissions.allowShell && !oneShot) {
    return { error: 'Shell execution is disabled in permissions.', needsPermission: true };
  }
  const ws = cfg.workspace;
  if (ws) appendYanagentLog(ws, `[shell] ${String(command || '').slice(0, 200)}`);
  return new Promise((resolve) => {
    const options = {
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 5,
      cwd: cwd || cfg.workspace || undefined,
      env: { ...process.env }
    };
    exec(command, options, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: err ? (err.code || 1) : 0,
        error: err ? err.message : null
      });
    });
  });
});

// ---------------------------------------------------------------------------
// IPC: Built-in terminal (persistent, independent from Agent workspaces)
// ---------------------------------------------------------------------------
ipcMain.handle('terminal:create', (event) => terminalManager.create(event.sender.id));

ipcMain.handle('terminal:execute', (event, { sessionId, command } = {}) => (
  terminalManager.execute(event.sender.id, sessionId, command)
));

ipcMain.handle('terminal:write', (event, { sessionId, data } = {}) => (
  terminalManager.write(event.sender.id, sessionId, data)
));

ipcMain.handle('terminal:interrupt', (event, sessionId) => (
  terminalManager.interrupt(event.sender.id, sessionId)
));

ipcMain.handle('terminal:restart', (event, sessionId) => (
  terminalManager.restart(event.sender.id, sessionId)
));

ipcMain.handle('terminal:destroy', (event, sessionId) => (
  terminalManager.destroy(event.sender.id, sessionId)
));

// ---------------------------------------------------------------------------
// MCP (Model Context Protocol) — manage external tool servers via stdio
// ---------------------------------------------------------------------------
const mcpServers = new Map(); // id -> { process, tools, pending, buffer, nextId }

function mcpSend(proc, msg) {
  proc.stdin.write(JSON.stringify(msg) + '\n');
}

function mcpRequest(server, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = server.nextId++;
    const timer = setTimeout(() => {
      if (server.pending.has(id)) {
        server.pending.delete(id);
        reject(new Error('MCP 请求超时: ' + method));
      }
    }, 30000);
    server.pending.set(id, { resolve, reject, timer });
    mcpSend(server.process, { jsonrpc: '2.0', id, method, params });
  });
}

async function mcpStart(serverCfg) {
  const { id, command, args = [] } = serverCfg;
  if (mcpServers.has(id)) return { error: '已在运行' };

  // Windows 上 npx/node 需要通过 cmd /c 调用，且不能用 shell:true
  // 否则 shell 的额外输出会污染 JSON-RPC stdio 流
  // 对含空格的参数加双引号保护，避免 cmd 再次拆分
  let finalCommand = command;
  let finalArgs = args;
  if (process.platform === 'win32' && (command === 'npx' || command === 'node' || command === 'uvx' || command === 'uv')) {
    finalCommand = process.env.ComSpec || 'cmd.exe';
    // 仅对含空格的参数加双引号，防止 cmd.exe 按空格拆分
    // 不含空格的参数不加引号，否则 npm/npx 会把引号当作包名的一部分
    const quotedArgs = args.map(a => a.includes(' ') ? `"${a}"` : a);
    finalArgs = ['/c', command, ...quotedArgs];
  }

  try {
    const proc = spawn(finalCommand, finalArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      shell: false
    });

    // spawn 错误（如命令不存在）通过 error 事件触发，不是 try/catch
    // 使用可移除的监听器避免 Promise 泄漏
    let errHandler;
    const spawnError = new Promise((_, reject) => {
      errHandler = (err) => reject(err);
      proc.on('error', errHandler);
    });

    const server = { process: proc, tools: [], pending: new Map(), buffer: '', nextId: 1, decoder: new TextDecoder('utf-8') };
    mcpServers.set(id, server);

    proc.stdout.on('data', (data) => {
      // 使用 TextDecoder 流式解码，避免多字节 UTF-8 字符在 data 边界被截断
      server.buffer += server.decoder.decode(data, { stream: true });
      let idx;
      while ((idx = server.buffer.indexOf('\n')) >= 0) {
        const line = server.buffer.slice(0, idx).trim();
        server.buffer = server.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id != null && server.pending.has(msg.id)) {
            const { resolve, reject, timer } = server.pending.get(msg.id);
            server.pending.delete(msg.id);
            if (timer) clearTimeout(timer);
            if (msg.error) reject(new Error(msg.error.message || 'MCP 错误'));
            else resolve(msg.result);
          } else if (msg.method) {
            // 处理通知消息（无 id），至少记录日志
            console.log(`[MCP ${id}] 通知:`, msg.method);
          }
        } catch (e) {
          console.log(`[MCP ${id}] 非 JSON 行:`, line.slice(0, 200));
        }
      }
    });

    proc.stderr.on('data', (data) => {
      console.log(`[MCP ${id}] stderr:`, data.toString().trim());
    });

    proc.on('exit', (code) => {
      console.log(`[MCP ${id}] 进程退出，代码 ${code}`);
      // 通知渲染进程服务器已崩溃
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mcp:status', { id, status: 'crashed', code });
      }
      // 拒绝所有 pending 请求
      for (const [pid, { reject, timer }] of server.pending) {
        if (timer) clearTimeout(timer);
        reject(new Error(`进程退出 (code ${code})`));
      }
      server.pending.clear();
      mcpServers.delete(id);
    });

    // 初始化握手（与 spawn 错误竞争，先到先处理）
    const initPromise = mcpRequest(server, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'Yan Agent', version: '1.3.0' }
    });

    await Promise.race([initPromise, spawnError]);
    // race 结束后移除 error 监听器，避免内存泄漏
    proc.off('error', errHandler);

    // 发送 initialized 通知
    mcpSend(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });

    // 列出工具
    const toolsResult = await mcpRequest(server, 'tools/list', {});
    server.tools = toolsResult.tools || [];

    return { ok: true, tools: server.tools };
  } catch (e) {
    mcpServers.delete(id);
    return { error: e.message };
  }
}

function mcpStop(id) {
  const server = mcpServers.get(id);
  if (!server) return;
  try { server.process.kill(); } catch {}
  // 拒绝所有 pending 请求，清理 timer
  for (const [pid, { reject, timer }] of server.pending) {
    if (timer) clearTimeout(timer);
    reject(new Error('服务器已停止'));
  }
  server.pending.clear();
  mcpServers.delete(id);
}

// MCP 配置管理
ipcMain.handle('mcp:list', () => loadConfig().mcpServers || []);
ipcMain.handle('mcp:add', (_e, { name, command, args }) => {
  const cfg = loadConfig();
  if (!cfg.mcpServers) cfg.mcpServers = [];
  const server = { id: 'mcp_' + Date.now(), name, command, args: args || [], enabled: true };
  cfg.mcpServers.push(server);
  saveConfig(cfg);
  return server;
});
ipcMain.handle('mcp:remove', (_e, id) => {
  const cfg = loadConfig();
  const target = (cfg.mcpServers || []).find(s => s.id === id);
  if (target?.builtin) return { error: '预装 MCP 服务器不可删除' };
  mcpStop(id);
  cfg.mcpServers = (cfg.mcpServers || []).filter(s => s.id !== id);
  saveConfig(cfg);
  return true;
});
ipcMain.handle('mcp:update', (_e, { id, ...changes }) => {
  const cfg = loadConfig();
  const servers = cfg.mcpServers || [];
  const idx = servers.findIndex(s => s.id === id);
  if (idx >= 0) {
    servers[idx] = { ...servers[idx], ...changes };
    saveConfig(cfg);
    return servers[idx];
  }
  return null;
});

// MCP 运行时
ipcMain.handle('mcp:start', async (_e, id) => {
  const cfg = loadConfig();
  const serverCfg = (cfg.mcpServers || []).find(s => s.id === id);
  if (!serverCfg) return { error: '未找到服务器配置' };
  return mcpStart(serverCfg);
});
ipcMain.handle('mcp:stop', (_e, id) => {
  mcpStop(id);
  return { ok: true };
});
ipcMain.handle('mcp:list-tools', async () => {
  const cfg = loadConfig();
  const servers = (cfg.mcpServers || []).filter(s => s.enabled);
  const allTools = [];
  // 并行启动所有服务器，避免串行阻塞 Agent 响应
  const startPromises = servers.map(async (s) => {
    if (!mcpServers.has(s.id)) {
      const res = await mcpStart(s);
      if (res.error) {
        return { serverId: s.id, serverName: s.name, error: res.error };
      }
    }
    const server = mcpServers.get(s.id);
    if (server) {
      return server.tools.map(tool => ({ serverId: s.id, serverName: s.name, tool }));
    }
    return { serverId: s.id, serverName: s.name, error: '服务器未运行' };
  });
  const results = await Promise.allSettled(startPromises);
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (Array.isArray(r.value)) {
        allTools.push(...r.value);
      } else if (r.value?.error) {
        // 将错误信息作为特殊"工具"返回，供 UI 显示
        allTools.push({ serverId: r.value.serverId, serverName: r.value.serverName, error: r.value.error });
      }
    }
  }
  return allTools;
});
ipcMain.handle('mcp:call-tool', async (_e, serverId, toolName, args) => {
  const server = mcpServers.get(serverId);
  if (!server) return { error: '服务器未运行' };
  try {
    const result = await mcpRequest(server, 'tools/call', {
      name: toolName,
      arguments: args || {}
    });
    if (result && result.content) {
      const text = result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
      return { result: text, isError: result.isError };
    }
    return { result: JSON.stringify(result) };
  } catch (e) {
    return { error: e.message };
  }
});

// ---------------------------------------------------------------------------
// IPC: Automations (定时自动任务)
// ---------------------------------------------------------------------------
ipcMain.handle('auto:list', () => loadConfig().automations || []);

ipcMain.handle('auto:add', (_e, { name, prompt, schedule }) => {
  const cfg = loadConfig();
  if (!cfg.automations) cfg.automations = [];
  const auto = {
    id: 'auto_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: String(name || '未命名任务'),
    prompt: String(prompt || ''),
    schedule: schedule || { type: 'interval', everyMinutes: 60 },
    enabled: true,
    createdAt: Date.now(),
    lastRun: 0,
    lastStatus: ''
  };
  cfg.automations.push(auto);
  saveConfig(cfg);
  return auto;
});

ipcMain.handle('auto:update', (_e, { id, ...changes }) => {
  const cfg = loadConfig();
  const list = cfg.automations || [];
  const idx = list.findIndex(a => a.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...changes };
  saveConfig(cfg);
  return list[idx];
});

ipcMain.handle('auto:remove', (_e, id) => {
  const cfg = loadConfig();
  cfg.automations = (cfg.automations || []).filter(a => a.id !== id);
  saveConfig(cfg);
  return true;
});

// ---------------------------------------------------------------------------
// IPC: File search (ripgrep-style, workspace-scoped)
// ---------------------------------------------------------------------------
function lineMatchesQuery(line, query, opts) {
  return codeIndex.lineMatchesQuery(line, query, opts);
}

ipcMain.handle('search:files', async (_e, opts) => {
  const {
    query,
    directory,
    extensions,
    regex = false,
    caseSensitive = false,
    maxResults = 80,
    maxDepth = 8,
    contextLines = 0
  } = opts || {};

  const root = directory || loadConfig().workspace;
  if (!root || !fs.existsSync(root) || !query) return [];

  const results = [];
  const exts = (extensions || []).map(e => String(e).replace(/^\./, '').toLowerCase()).filter(Boolean);
  const ctx = Math.min(5, Math.max(0, parseInt(contextLines, 10) || 0));

  async function walk(dir, depth) {
    if (depth > maxDepth || results.length >= maxResults) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (results.length >= maxResults) break;
      const name = entry.name;
      if (entry.isDirectory()) {
        if (codeIndex.SEARCH_SKIP_DIRS.has(name)) continue;
        if (name.startsWith('.') && name !== '.github') continue;
        await walk(path.join(dir, name), depth + 1);
        continue;
      }

      if (codeIndex.SEARCH_SKIP_FILES.has(name)) continue;
      if (exts.length > 0) {
        const ext = path.extname(name).slice(1).toLowerCase();
        if (!exts.includes(ext)) continue;
      }

      const fullPath = path.join(dir, name);
      try {
        const stat = await fsp.stat(fullPath);
        if (stat.size > 1024 * 1024) continue;
        const content = await fsp.readFile(fullPath, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          if (!lineMatchesQuery(lines[i], query, { regex, caseSensitive })) continue;
          const item = {
            path: fullPath,
            file: name,
            line: i + 1,
            content: lines[i].trim().slice(0, 240)
          };
          if (ctx > 0) {
            const before = [];
            const after = [];
            for (let b = 1; b <= ctx && i - b >= 0; b++) before.unshift(lines[i - b].trim().slice(0, 160));
            for (let a = 1; a <= ctx && i + a < lines.length; a++) after.push(lines[i + a].trim().slice(0, 160));
            item.contextBefore = before;
            item.contextAfter = after;
          }
          results.push(item);
        }
      } catch { /* skip binary / unreadable */ }
    }
  }

  await walk(root, 0);
  return results;
});

// ---------------------------------------------------------------------------
// IPC: Code understanding (index, symbols, references, project scan)
// ---------------------------------------------------------------------------
ipcMain.handle('code:build-index', async (_e, { workspace, force } = {}) => {
  const ws = workspace || loadConfig().workspace;
  if (!ws || !fs.existsSync(ws)) return { error: 'No workspace selected.' };
  if (!force) {
    const existing = await loadPersistedCodeIndex(ws);
    if (existing && Date.now() - existing.builtAt < 5 * 60 * 1000) {
      return { ok: true, cached: true, ...summarizeIndex(existing) };
    }
  }
  const index = await codeIndex.buildWorkspaceIndex(ws);
  await persistCodeIndex(index);
  return { ok: true, cached: false, ...summarizeIndex(index) };
});

function summarizeIndex(index) {
  return {
    builtAt: index.builtAt,
    fileCount: index.fileCount,
    symbolCount: index.symbolCount,
    workspace: index.workspace
  };
}

ipcMain.handle('code:index-status', async (_e, workspace) => {
  const ws = workspace || loadConfig().workspace;
  if (!ws) return { exists: false };
  const index = await loadPersistedCodeIndex(ws);
  if (!index) return { exists: false, workspace: ws };
  return { exists: true, ...summarizeIndex(index) };
});

ipcMain.handle('code:search-symbols', async (_e, { query, kind, limit, regex, case_sensitive, workspace }) => {
  const ws = workspace || loadConfig().workspace;
  let index = await loadPersistedCodeIndex(ws);
  if (!index) {
    index = await codeIndex.buildWorkspaceIndex(ws);
    await persistCodeIndex(index);
  }
  const hits = codeIndex.searchSymbols(index, query, { kind, limit, regex, caseSensitive: case_sensitive });
  return { hits, indexAge: index.builtAt, fileCount: index.fileCount, symbolCount: index.symbolCount };
});

ipcMain.handle('code:find-symbol', async (_e, { name, kind, workspace, fallback_search }) => {
  const ws = workspace || loadConfig().workspace;
  const key = String(name || '').trim();
  if (!key) return { hits: [], error: 'name is required' };

  let index = await loadPersistedCodeIndex(ws);
  if (!index) {
    index = await codeIndex.buildWorkspaceIndex(ws);
    await persistCodeIndex(index);
  }

  let hits = codeIndex.findSymbolInIndex(index, key, { kind });
  if (!hits.length && fallback_search !== false) {
    hits = await codeIndex.searchDefinitions(ws, key, { maxResults: 20 });
    if (kind) hits = hits.filter(h => h.kind === kind);
  }
  return { hits, fromIndex: true, symbolCount: index.symbolCount };
});

ipcMain.handle('code:find-references', async (_e, { name, workspace, max_results }) => {
  const ws = workspace || loadConfig().workspace;
  const key = String(name || '').trim();
  if (!key) return { hits: [], error: 'name is required' };
  const hits = await codeIndex.searchReferences(ws, key, { maxResults: max_results || 60 });
  return { hits, count: hits.length };
});

ipcMain.handle('code:find-related', async (_e, { path: filePath, workspace }) => {
  const ws = workspace || loadConfig().workspace;
  if (!filePath) return { error: 'path is required' };
  let index = await loadPersistedCodeIndex(ws);
  if (!index) {
    index = await codeIndex.buildWorkspaceIndex(ws);
    await persistCodeIndex(index);
  }
  const related = codeIndex.findRelatedFiles(index, ws, filePath);
  return related;
});

ipcMain.handle('code:file-imports', async (_e, { path: filePath }) => {
  if (!filePath) return { error: 'path is required' };
  try {
    const content = await fsp.readFile(filePath, 'utf8');
    const ie = codeIndex.extractImportsExports(content, filePath);
    const outline = codeIndex.outlineFile(content, filePath);
    return { path: filePath, ...ie, language: outline.language, lineCount: outline.lineCount, symbolCount: outline.symbols.length };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('code:scan-project', async (_e, { workspace } = {}) => {
  const ws = workspace || loadConfig().workspace;
  if (!ws || !fs.existsSync(ws)) return { error: 'No workspace selected.' };
  const meta = await codeIndex.enrichProjectScan(ws);
  return { meta, summary: codeIndex.formatProjectScan(meta) };
});

ipcMain.handle('code:trace-symbol', async (_e, { name, workspace }) => {
  const ws = workspace || loadConfig().workspace;
  const key = String(name || '').trim();
  if (!key) return { error: 'name is required' };
  let index = await loadPersistedCodeIndex(ws);
  if (!index) {
    index = await codeIndex.buildWorkspaceIndex(ws);
    await persistCodeIndex(index);
  }
  const definitions = codeIndex.findSymbolInIndex(index, key);
  const references = await codeIndex.searchReferences(ws, key, { maxResults: 40 });
  return {
    name: key,
    definitions,
    references,
    definitionCount: definitions.length,
    referenceCount: references.length
  };
});

// ---------------------------------------------------------------------------
// IPC: Code map (incremental workspace visualization)
// ---------------------------------------------------------------------------
ipcMain.handle('code-map:get', async (_e, { workspace, force } = {}) => {
  const ws = workspace || loadConfig().workspace;
  if (!ws || !fs.existsSync(ws)) return { error: '请先选择有效的工作区。' };
  try {
    const map = await codeMap.buildCodeMap(ws, { force: !!force });
    const cfg = loadConfig();
    const codeMapApi = resolveCodeMapApi(cfg);
    return {
      ok: true,
      aiAvailable: !!codeMapApi.api,
      analysisModel: codeMapApi.modelId,
      analysisModelName: codeMapApi.modelName,
      analysisProvider: codeMapApi.providerName || null,
      analysisError: codeMapApi.error || null,
      ...map
    };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('code-map:enrich', async (_e, { workspace, limit } = {}) => {
  const ws = workspace || loadConfig().workspace;
  if (!ws || !fs.existsSync(ws)) return { error: '请先选择有效的工作区。' };
  const sendProgress = progress => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('code-map:progress', { workspace: ws, ...progress });
    }
  };
  try {
    const cfg = loadConfig();
    const codeMapApi = resolveCodeMapApi(cfg);
    const result = await codeMap.enrichCodeMap(ws, cfg, {
      limit,
      onProgress: sendProgress,
      codeMapApi
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('code-map:changed', {
        workspace: ws,
        updated: result.updated || 0,
        timestamp: Date.now()
      });
    }
    return result;
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('code-map:clear-cache', async (_e, workspace) => {
  const ws = workspace || loadConfig().workspace;
  if (!ws) return { error: '请先选择工作区。' };
  try {
    await codeMap.clearCodeMapCache(ws);
    return { ok: true };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('code-map:models:list', () => {
  const cfg = loadConfig();
  return listAllModelsFlat().map(model => ({
    ...model,
    hasKey: !!cfg.api?.apiKeys?.[model.providerId]
  }));
});

ipcMain.handle('code-map:model:get', () => {
  const cfg = loadConfig();
  const codeMapApi = resolveCodeMapApi(cfg);
  return {
    modelId: codeMapApi.modelId,
    modelName: codeMapApi.modelName,
    providerId: codeMapApi.providerId || null,
    providerName: codeMapApi.providerName || null,
    aiAvailable: !!codeMapApi.api,
    error: codeMapApi.error || null
  };
});

ipcMain.handle('code-map:model:set', (_e, modelId) => {
  const cfg = loadConfig();
  const meta = findModelMeta(String(modelId || ''));
  if (!meta) return { error: '未知解读模型。' };
  cfg.codeMap = normalizeCodeMapConfig({ ...(cfg.codeMap || {}), model: meta.id });
  saveConfig(cfg);
  const codeMapApi = resolveCodeMapApi(cfg);
  return {
    ok: true,
    modelId: codeMapApi.modelId,
    modelName: codeMapApi.modelName,
    providerId: codeMapApi.providerId || null,
    providerName: codeMapApi.providerName || null,
    aiAvailable: !!codeMapApi.api,
    error: codeMapApi.error || null
  };
});

// ---------------------------------------------------------------------------
// IPC: Workspace tree (flat file list)
// ---------------------------------------------------------------------------
ipcMain.handle('workspace:tree', async (_e, { directory, maxDepth }) => {
  const root = directory || loadConfig().workspace;
  if (!root || !fs.existsSync(root)) return [];
  const files = [];
  const max = maxDepth || 4;

  async function walk(dir, depth, rel) {
    if (depth > max || files.length >= 200) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === YANAGENT_DIR) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push({ name: entry.name, path: path.join(dir, entry.name), relPath, isDirectory: true });
        await walk(path.join(dir, entry.name), depth + 1, relPath);
      } else {
        files.push({ name: entry.name, path: path.join(dir, entry.name), relPath, isDirectory: false });
      }
    }
  }

  await walk(root, 0, '');
  return files;
});

// ---------------------------------------------------------------------------
// IPC: Git operations
// ---------------------------------------------------------------------------
ipcMain.handle('git:status', async (_e, dirPath) => {
  const root = dirPath || loadConfig().workspace;
  return execGitArgs(['status', '--porcelain=v2', '--branch'], root);
});

ipcMain.handle('git:diff', async (_e, { dirPath, staged }) => {
  const root = dirPath || loadConfig().workspace;
  const args = staged ? ['diff', '--cached'] : ['diff'];
  return execGitArgs(args, root);
});

ipcMain.handle('git:log', async (_e, { dirPath, limit }) => {
  const root = dirPath || loadConfig().workspace;
  const n = Number.parseInt(limit, 10);
  const count = Number.isFinite(n) && n > 0 ? n : 20;
  return execGitArgs(['log', '--oneline', '--decorate', `-${count}`], root);
});

ipcMain.handle('git:commit', async (_e, { message, dirPath }) => {
  const root = dirPath || loadConfig().workspace;
  // 安全方案：add -A 和 commit 分两步执行，commit 用数组参数避免 shell 解析
  await execGitArgs(['add', '-A'], root);
  return execGitArgs(['commit', '-m', String(message || '')], root);
});

ipcMain.handle('git:push', async (_e, { dirPath, remote, branch }) => {
  const root = dirPath || loadConfig().workspace;
  const r = remote || 'origin';
  const args = ['push', r];
  if (branch) args.push(branch);
  return execGitArgs(args, root);
});

ipcMain.handle('git:pull', async (_e, { dirPath, remote, branch }) => {
  const root = dirPath || loadConfig().workspace;
  const r = remote || 'origin';
  const args = ['pull', r];
  if (branch) args.push(branch);
  return execGitArgs(args, root);
});

ipcMain.handle('git:clone', async (_e, { url, dirPath }) => {
  const root = dirPath || loadConfig().workspace;
  return execGitArgs(['clone', String(url || '')], root);
});

ipcMain.handle('git:branch', async (_e, dirPath) => {
  const root = dirPath || loadConfig().workspace;
  return execGitArgs(['branch', '-a'], root);
});

// 通过参数数组调用 git，彻底避免 shell 命令注入
async function execGitArgs(args, cwd) {
  if (!cwd || !String(cwd).trim()) {
    return { stdout: '', stderr: '', exitCode: 1, error: '未设置工作区，请先在设置或任务栏中选择文件夹' };
  }
  return new Promise((resolve) => {
    execFile('git', args, {
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 5,
      cwd: cwd || undefined,
      env: { ...process.env },
      windowsHide: true
    }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: err ? (err.code || 1) : 0,
        error: err ? err.message : null
      });
    });
  });
}

// ---------------------------------------------------------------------------
// IPC: Permissions
// ---------------------------------------------------------------------------
ipcMain.handle('permissions:get', () => loadConfig().permissions);
ipcMain.handle('permissions:set', (_e, perms) => {
  const cfg = loadConfig();
  cfg.permissions = { ...cfg.permissions, ...perms };
  saveConfig(cfg);
  return cfg.permissions;
});

// ---------------------------------------------------------------------------
// IPC: Window controls (custom title bar)
// ---------------------------------------------------------------------------
ipcMain.on('pet:update', (event, payload = {}) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return;
  petState = normalizePetState(payload);
  sendPetState();
});

ipcMain.on('pet:ready', (event) => {
  if (!petWindow || petWindow.isDestroyed() || event.sender.id !== petWindow.webContents.id) return;
  sendPetState();
});

ipcMain.handle('pet:set-expanded', (event, expanded) => {
  if (!petWindow || petWindow.isDestroyed() || event.sender.id !== petWindow.webContents.id) return false;
  resizePetWindow(!!expanded);
  return true;
});

ipcMain.handle('pet:get-metrics', (event) => {
  if (!petWindow || petWindow.isDestroyed() || event.sender.id !== petWindow.webContents.id) return null;
  const pid = petWindow.webContents.getOSProcessId();
  const metric = app.getAppMetrics().find(item => item.pid === pid);
  if (!metric) return { pid, memoryMb: null, cpuPercent: null };
  return {
    pid,
    memoryMb: Math.round((Number(metric.memory?.workingSetSize) || 0) / 1024 * 10) / 10,
    cpuPercent: Math.round((Number(metric.cpu?.percentCPUUsage) || 0) * 10) / 10
  };
});

ipcMain.handle('pet:get-visible', (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return false;
  return !!(petWindow && !petWindow.isDestroyed() && petWindow.isVisible());
});

ipcMain.handle('pet:toggle-window', (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return false;
  return togglePetWindow();
});

ipcMain.on('pet:move-by', (event, payload = {}) => {
  if (!petWindow || petWindow.isDestroyed() || event.sender.id !== petWindow.webContents.id) return;
  const dx = Math.max(-120, Math.min(120, Number(payload.dx) || 0));
  const dy = Math.max(-120, Math.min(120, Number(payload.dy) || 0));
  if (!dx && !dy) return;
  const bounds = petWindow.getBounds();
  petWindow.setPosition(Math.round(bounds.x + dx), Math.round(bounds.y + dy), false);
});

ipcMain.on('pet:open-task', (event, sessionId) => {
  if (!petWindow || petWindow.isDestroyed() || event.sender.id !== petWindow.webContents.id) return;
  showMainWindowForPet(sessionId);
});

ipcMain.on('pet:stop-task', (event, sessionId) => {
  if (!petWindow || petWindow.isDestroyed() || event.sender.id !== petWindow.webContents.id) return;
  if (!mainWindow || mainWindow.isDestroyed() || !sessionId) return;
  mainWindow.webContents.send('pet:action', { type: 'stop-task', sessionId: String(sessionId) });
});

ipcMain.on('pet:close', (event) => {
  if (!petWindow || petWindow.isDestroyed() || event.sender.id !== petWindow.webContents.id) return;
  destroyPetWindow();
});

ipcMain.on('win:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('win:toggle-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('win:close', () => {
  // 点击标题栏关闭按钮时，最小化到托盘而非退出
  if (mainWindow) mainWindow.hide();
});
ipcMain.handle('win:is-maximized', () => (mainWindow ? mainWindow.isMaximized() : false));

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function deepMerge(target, source) {
  if (typeof source !== 'object' || source === null) return source;
  if (typeof target !== 'object' || target === null) return source;
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const key of Object.keys(source)) {
    if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
      out[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bundled agent skills (OfficeCLI, CubeSandbox, …)
// ---------------------------------------------------------------------------
function ensureBundledAgentSkills(cfg) {
  const bundledDir = path.join(appRoot, 'lib', 'skills', 'bundled');
  if (!fs.existsSync(bundledDir)) return false;
  if (!cfg.customSkills) cfg.customSkills = [];
  const files = fs.readdirSync(bundledDir).filter(f => f.endsWith('.json'));
  let changed = false;
  for (const file of files) {
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(bundledDir, file), 'utf8'));
    } catch { continue; }
    if (!meta?.id) continue;
    let prompt = String(meta.prompt || '').trim();
    if (meta.promptFile) {
      const promptPath = path.join(bundledDir, meta.promptFile);
      if (fs.existsSync(promptPath)) {
        prompt = fs.readFileSync(promptPath, 'utf8');
      }
    }
    if (!prompt) continue;
    const item = {
      id: meta.id,
      name: meta.name || meta.id,
      desc: meta.desc || '',
      prompt,
      tags: meta.tags || [],
      triggers: meta.triggers || [],
      source: meta.source || 'bundled',
      installedAt: Date.now(),
      updatedAt: Date.now()
    };
    const idx = cfg.customSkills.findIndex(s => s.id === item.id);
    if (idx < 0) {
      cfg.customSkills.push(item);
      changed = true;
    } else if (!cfg.customSkills[idx].prompt) {
      cfg.customSkills[idx] = { ...cfg.customSkills[idx], ...item };
      changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Mobile remote control (HTTP + Web UI)
// ---------------------------------------------------------------------------
function invokeRendererRemote(payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      reject(new Error('app not ready'));
      return;
    }
    const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      remotePending.delete(requestId);
      reject(new Error('renderer timeout'));
    }, timeoutMs);
    remotePending.set(requestId, { resolve, reject, timer });
    mainWindow.webContents.send('remote:invoke', { ...payload, requestId });
  });
}

async function listSessionsBrief() {
  return listSessionSummaries();
}

function buildRemoteDeps() {
  return {
    listSessions: () => listSessionsBrief(),
    getSession: async (id) => {
      const p = sessionPath(id);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(await fsp.readFile(p, 'utf8'));
    },
    createSession: () => createOrReuseSessionRecord(),
    deleteSession: async (id, options = {}) => {
      const status = await buildRemoteDeps().getSessionStatus(id);
      return deleteSessionRecord(id, { ...options, running: !!status.running });
    },
    renameSession: (id, title) => renameSessionRecord(id, title),
    setSessionPinned: (id, pinned) => setSessionPinnedRecord(id, pinned),
    onSessionChanged: (detail) => notifyDesktopSessionUpdate(detail),
    uploadImage: (payload) => storeRemoteUploadedImage(payload),
    resolveUploadedImages: (items) => resolveRemoteUploadedImages(items),
    readUploadedImage: async (uploadId) => {
      const filePath = findRemoteUploadedImage(uploadId);
      if (!filePath) return null;
      try {
        const buffer = await fsp.readFile(filePath);
        const type = detectImageType(buffer);
        return {
          buffer,
          mimeType: type.mimeType,
          name: path.basename(filePath),
          size: buffer.length
        };
      } catch {
        return null;
      }
    },
    sendMessage: async (sessionId, text, attachments = []) => {
      const session = await buildRemoteDeps().getSession(sessionId);
      if (!session) return { ok: false, error: 'not found' };
      try {
        const result = await invokeRendererRemote({ type: 'send-message', sessionId, text, attachments });
        return result || { ok: true };
      } catch (e) {
        return { ok: false, error: e.message || 'invoke failed' };
      }
    },
    abortSession: async (sessionId) => {
      try {
        return await invokeRendererRemote({ type: 'abort', sessionId }, 10000);
      } catch (e) {
        return { ok: false, error: e.message || 'invoke failed' };
      }
    },
    getSessionStatus: async (sessionId) => {
      try {
        return await invokeRendererRemote({ type: 'get-status', sessionId }, 5000);
      } catch {
        return { running: false };
      }
    },
    getRunningSessions: async () => {
      try {
        const result = await invokeRendererRemote({ type: 'get-running' }, 5000);
        return result?.ids || [];
      } catch {
        return [];
      }
    },
    readGeneratedImage: async (assetId) => {
      const asset = getGeneratedImageAsset(assetId);
      if (!asset) return null;
      try {
        return {
          buffer: await fsp.readFile(asset.filePath),
          mimeType: asset.mimeType,
          name: asset.name,
          size: asset.size,
        };
      } catch {
        generatedImages.delete(asset.assetId);
        return null;
      }
    },
    getModelState: () => buildPublicModelState(),
    setModel: (modelId) => setActiveModel(modelId),
    getPublicConfig: () => {
      const cfg = loadConfig();
      return {
        model: cfg.api?.model || '',
        provider: cfg.api?.provider || '',
        hasWorkspace: !!cfg.workspace,
      };
    },
    getAuthState: () => ({
      passwordSet: isRemotePasswordSet(loadConfig()),
    }),
  };
}

async function stopRemoteServer() {
  if (!remoteServer) return;
  const srv = remoteServer;
  remoteServer = null;
  await srv.stop();
}

async function startRemoteServer() {
  const cfg = loadConfig();
  const rc = normalizeRemoteControlConfig(cfg.remoteControl);
  if (!rc.enabled) {
    await stopRemoteServer();
    return null;
  }
  if (remoteServer) return remoteServer.getInfo();

  remoteServer = new RemoteServer({
    rootDir: appRoot,
    uiDir: path.join(appRoot, 'renderer', 'remote'),
    getToken: () => loadConfig().remoteControl?.password || '',
    verifyPassword: (value) => verifyRemotePassword(value),
    deps: buildRemoteDeps(),
  });

  const info = await remoteServer.start(rc.port || 0);
  if (!rc.port && info.port) {
    const next = loadConfig();
    next.remoteControl = { ...normalizeRemoteControlConfig(next.remoteControl), port: info.port };
    saveConfig(next);
  }
  return info;
}

async function restartRemoteServer() {
  await stopRemoteServer();
  return startRemoteServer();
}

ipcMain.on('remote:result', (_e, payload = {}) => {
  const { requestId, result, error } = payload;
  const pending = remotePending.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timer);
  remotePending.delete(requestId);
  if (error) pending.reject(new Error(error));
  else pending.resolve(result);
});

ipcMain.on('remote:notify', (_e, payload = {}) => {
  if (!payload?.event || !remoteServer) return;
  remoteServer.broadcast(payload.event, payload.data || {});
});

ipcMain.handle('remote:get-info', async () => {
  const cfg = loadConfig();
  const rc = normalizeRemoteControlConfig(cfg.remoteControl);
  const info = remoteServer?.getInfo() || { running: false, port: rc.port || null, urls: [], addresses: [] };
  return {
    ...info,
    enabled: !!rc.enabled,
    passwordSet: isRemotePasswordSet(cfg),
  };
});

ipcMain.handle('remote:restart', async () => {
  const info = await restartRemoteServer();
  const cfg = loadConfig();
  return {
    ...(info || remoteServer?.getInfo() || {}),
    enabled: !!cfg.remoteControl?.enabled,
    passwordSet: isRemotePasswordSet(cfg),
  };
});

ipcMain.handle('remote:set-password', async (_e, { password }) => {
  const pwd = String(password || '');
  if (pwd.length < 4) return { ok: false, error: '密码至少 4 位' };
  const cfg = loadConfig();
  cfg.remoteControl = normalizeRemoteControlConfig(cfg.remoteControl);
  cfg.remoteControl.password = pwd;
  saveConfig(cfg);
  return { ok: true, passwordSet: true };
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const ws = parseOpenWorkspaceArg(argv);
    const requestId = parseYanxiRequestIdArg(argv);
    if (ws !== undefined) {
      yanxiReceiver.applyWorkspaceFromYanxiCode(ws, { requestId }).catch((e) => {
        console.error('[yanxi-sync]', e.message);
      });
    }
    if (argv.includes('--show-main') || ws !== undefined) {
      focusMainWindow();
    }
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.yan.agent');
  migrateLegacyDataDir();
  ensureDirs();
  loadGeneratedImageStore();
  const preferredLanguages = app.getPreferredSystemLanguages?.() || [];
  terminalManager.setLocale(preferredLanguages[0] || app.getLocale());
  const cfg = loadConfig();
  ensureBundledAgentSkills(cfg);
  saveConfig(cfg);
  startWorkspaceWatcher(cfg.workspace);
  yanxiReceiver.watchYanxiSyncFile();
  // 仅响应 Yanxi Code 显式传入的 --open-workspace；不在每次冷启动时重放 yanxi-sync.json
  if (pendingYanxiWorkspace !== undefined) {
    await yanxiReceiver.applyWorkspaceFromYanxiCode(pendingYanxiWorkspace, { requestId: pendingYanxiRequestId });
  }
  skillRegistry.scheduleSkillSync(cfg, appRoot, dataDir, saveConfig, (res) => {
    if (res.ok) {
      console.log(`[skills] synced market: ${res.total} items (+${res.added} new, ~${res.updated} updated)`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('skills:synced', res);
      }
    } else if (res.error) {
      console.log('[skills] sync skipped/failed:', res.error);
    }
  });
  createWindow();
  applyLightWindowIcon(mainWindow);
  createPetWindow();
  createTray();
  mainWindow.webContents.once('did-finish-load', () => {
    startRemoteServer().catch((e) => console.error('[remote] start failed:', e.message));
  });
  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else applyLightWindowIcon(mainWindow);
  });
});

// 有托盘保活时，所有窗口关闭不退出应用
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

// 真正退出时清理托盘和 MCP 服务器
app.on('before-quit', () => {
  isQuiting = true;
  for (const request of activeImageGenerations.values()) request.controller.abort();
  activeImageGenerations.clear();
  closeGeneratedImageViewers();
  skillRegistry.stopSkillSync();
  stopWorkspaceWatcher();
  terminalManager.dispose();
  stopRemoteServer().catch(() => {});
  if (petWindow && !petWindow.isDestroyed()) petWindow.destroy();
  if (tray) tray.destroy();
  // 停止所有 MCP 服务器
  for (const id of mcpServers.keys()) mcpStop(id);
});
