const { createImageViewer } = require('./lib/main/windows/image-viewer');
const { createOpenCodeRuntime } = require('./lib/main/opencode-runtime');
const { normalizeQuickLaunchConfig: normalizeQuickLaunch, deepMerge } = require('./lib/main/config-helpers');
const { createRuntimeDefaults } = require('./lib/main/runtime-defaults');
const { registerYanagentIpc } = require('./lib/main/ipc-yanagent');
const { registerBrowserIpc } = require('./lib/main/ipc-browser');
const { registerConfigIpc } = require('./lib/main/ipc-config');
const { registerOpenCodeIpc } = require('./lib/main/ipc-opencode');
const { createHangGuard } = require('./lib/main/hang-guard');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage, nativeTheme, webContents, screen, session, clipboard, globalShortcut, safeStorage, net: electronNet } = require('electron');
const path = require('path');

const fs = require('fs');
const fsp = require('fs/promises');

const { normalizeRemoteModels } = require('./lib/model-catalog');
const { buildSelectableModelCatalog } = require('./lib/provider-model-catalog');
const { decorateModels } = require('./lib/model-capabilities');
const { DEFAULT_MODEL_ROLES, getModelType } = require('./lib/model-roles');

const { normalizeVoice, normalizeRate } = require('./lib/text-to-speech');

const skillRegistry = require('./lib/skill-registry');

const { LongTermMemoryStore } = require('./lib/long-term-memory');
const { SkillEvolutionStore } = require('./lib/skill-evolution');
const { ContinualHarnessStore } = require('./lib/continual-harness');

const { extractExplicitPolicyInstruction } = require('./lib/behavior-policy');
const crypto = require('crypto');
const workspaceSandbox = require('./lib/workspace-sandbox');

const { DEFAULT_INPUT_TOKENS_PER_SECOND, normalizeInputTokensPerSecond } = require('./lib/opencode-sidecar');

const { resolveConnectionApiFormat, resolveConnectionPreset } = require('./lib/connection-presets');
const { OpenCodeEventBatcher } = require('./lib/open-code-stream');
const { normalizeReasoningSpeed, reasoningSpeedEnablesThinking } = require('./lib/reasoning-effort');

const gitService = require('./lib/git-service');

const { runReviewTask } = require('./lib/review-worker');
const worktreeService = require('./lib/worktree-service');
const ghService = require('./lib/gh-service');

const { YanCore, ResourceLockManager } = require('./lib/yan-core');
const { writeAtomic } = require('./lib/yan-core/store');

const { createMainContext, stateCell } = require('./lib/main/context');
const { createUploadStore } = require('./lib/main/upload-store');
const { registerGeneratedMediaStore, GENERATED_IMAGE_MIME_BY_EXTENSION } = require('./lib/main/generated-media-store');
const { registerYanagentStore } = require('./lib/main/yanagent-store');
const { registerWorkspaceRuntime } = require('./lib/main/workspace-runtime');
const { registerMemoryRuntime } = require('./lib/main/memory-runtime');
const { registerSessionIpc } = require('./lib/main/ipc-session');
const { registerTaskDeepLinks } = require('./lib/main/task-deep-links');
const { createProviderConfig } = require('./lib/main/provider-config');
const { createVisionRelayRuntime } = require('./lib/main/vision-relay-runtime');
const { createConfigStore } = require('./lib/main/config');
const { createModelState } = require('./lib/main/model-state');
const { createMcpServers } = require('./lib/main/mcp-servers');
const { createMcpRuntimeConfig } = require('./lib/main/mcp-runtime-config');
const { createHarnessBridge } = require('./lib/main/harness-bridge');
const { createHarnessPolicy } = require('./lib/main/harness-policy');
const { registerMcpManagement } = require('./lib/main/mcp-management');
const { registerSkillsRuntime } = require('./lib/main/skills-runtime');
const { createRecoveryRuntime } = require('./lib/main/recovery');
const { registerBridges } = require('./lib/main/bridges');
const { createBrowserHelpers } = require('./lib/main/browser-helpers');
const { registerProviderIpc } = require('./lib/main/provider-ipc');
const { createSessionStore } = require('./lib/session-store');
const { registerGitIpc } = require('./lib/main/ipc-git');
const { registerGhIpc } = require('./lib/main/ipc-gh');
const { registerFilesMediaIpc } = require('./lib/main/ipc-files-media');
const { registerToolsIpc } = require('./lib/main/ipc-tools');
const { registerPlanIpc } = require('./lib/main/ipc-plan');
// Splash removed: the app opens directly to the main window.
const { registerMainWindow } = require('./lib/main/windows/main-window');
const { registerQuickInput } = require('./lib/main/windows/quick-input');
const { registerPetWindow } = require('./lib/main/windows/pet');
const { registerTray } = require('./lib/main/windows/tray');

const appRoot = __dirname;

// Real desktop E2E runs must never read or mutate the user's live sessions.
// This opt-in hook is inert in production and is set before any storage path
// is captured below, so Electron, YanData, and Chromium partitions are all
// isolated together.
const e2eUserDataDir = String(process.env.YAN_E2E_USER_DATA_DIR || '').trim();
if (e2eUserDataDir) {
  fs.mkdirSync(e2eUserDataDir, { recursive: true });
  app.setPath('userData', path.resolve(e2eUserDataDir));
}

const isE2EMode = process.env.YAN_E2E_MODE === '1';
// Only zh-CN.pak ships (electronLanguages), so pin the Chromium locale to it
// instead of letting a non-Chinese system locale pick a missing pak.
if (!app.commandLine.hasSwitch('lang')) app.commandLine.appendSwitch('lang', 'zh-CN');
const { getWindowsAppId } = require('./lib/main/windows/app-identity');
const windowsAppId = getWindowsAppId({ isPackaged: app.isPackaged, isE2EMode });
if (process.platform === 'win32') app.setAppUserModelId(windowsAppId);
const e2eParentPid = isE2EMode
  ? Number.parseInt(process.env.YAN_E2E_PARENT_PID || String(process.ppid), 10)
  : 0;
let e2eParentWatchdog = null;
let e2eOrphanShutdownStarted = false;

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but cannot be signalled by this process.
    return error?.code === 'EPERM';
  }
}

function startE2EParentWatchdog() {
  if (!isE2EMode || e2eParentWatchdog || !Number.isInteger(e2eParentPid) || e2eParentPid <= 0) return;
  e2eParentWatchdog = setInterval(() => {
    if (e2eOrphanShutdownStarted || isProcessAlive(e2eParentPid)) return;
    e2eOrphanShutdownStarted = true;
    clearInterval(e2eParentWatchdog);
    e2eParentWatchdog = null;
    console.error(`[E2E] Parent process ${e2eParentPid} exited; shutting down orphaned Yan runtime.`);
    app.quit();
    const forcedExit = setTimeout(() => app.exit(0), 3_000);
    forcedExit.unref?.();
  }, 1_000);
  e2eParentWatchdog.unref?.();
}

startE2EParentWatchdog();

let openCodeSidecar = null;
const openCodeActiveRuns = new Map();
// Runs reserve a slot before the async admission path creates the active-run
// record. Keep the target session with that reservation so session deletion
// cannot race through this short but real window.
const openCodeRunAdmissions = new Map(); // runId -> yanSessionId
const MAX_CONCURRENT_AGENT_RUNS = 3;
// Idle teardown window. While it holds, the kernel AND its per-directory
// OpenCode instance stay warm, so a follow-up turn skips the instance
// bootstrap (config load + git snapshot + MCP connect, ~5s before the first
// token). Measured this session: turns <5 min apart replied in ~2.8s, turns
// >5 min apart in ~7.5s, so the old 5-minute default made ordinary
// think-pauses pay a full cold start. Override with YAN_OPENCODE_IDLE_RELEASE_MS.
const OPENCODE_IDLE_RELEASE_MS = Math.max(1_000, Number(process.env.YAN_OPENCODE_IDLE_RELEASE_MS) || 30 * 60_000);
let openCodeIdleReleaseTimer = null;
let openCodePrewarmPromise = null;
let openCodeBackgroundLeases = 0;
const browserAgentToolClaims = new Map();
const sessionAgentToolClaims = new Map();
let yanCore = null;
let openCodeProviderAdapter = null;
const resourceLocks = new ResourceLockManager({ maxWaiters: 256 });

let mainWindow = null;
const openCodeEventBatcher = new OpenCodeEventBatcher({
  flushIntervalMs: 16,
  onBatch(runId, events) {
    if (!mainWindow || mainWindow.isDestroyed() || !events.length) return;
    mainWindow.webContents.send('opencode:event-batch', { runId, events });
  },
  onSlowConsumer(runId, info) {
    console.warn(`[opencode] slow renderer consumer for run ${runId}: dropped ${info.droppedTotal} buffered delta(s)`);
    try { yanCore?.recordBackpressure(runId, info); } catch (error) {
      console.warn('[yan-core] backpressure telemetry failed:', error?.message || error);
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('opencode:event', {
      runId,
      event: { type: 'yan.opencode.slow-consumer', data: info }
    });
  }
});

// ---------------------------------------------------------------------------
// Interrupted-run recovery (lib/main/recovery.js)
// ---------------------------------------------------------------------------
const recovery = createRecoveryRuntime({
  openCodeEventBatcher,
  getYanCore: () => yanCore,
  getMainWindow: () => mainWindow
});
let mainRendererReady = false;
let pendingFocusMain = process.argv.includes('--show-main');
let quickInputWindow = null;
let quickInputGlowWindow = null;
let quickInputGlowDisplayId = null;
let quickInputActive = false;
let registeredQuickInputShortcut = '';
const DEFAULT_QUICK_INPUT_SHORTCUT = 'CommandOrControl+Shift+Y';
const normalizeQuickLaunchConfig = value => normalizeQuickLaunch(value, DEFAULT_QUICK_INPUT_SHORTCUT);
let petWindow = null;
let tray = null;
let isQuiting = false;
let petState = {
  status: 'idle',
  sessionId: null,
  running: false,
  title: 'Yan Agent',
  message: '随时待命'
};
const PET_IDS = Object.freeze(['orb', 'deepseek', 'claude']);
let activePetId = 'orb';
const activeImageGenerations = new Map();
const activeVideoGenerations = new Map();
const generatedImages = new Map();
const generatedImageViewers = new Map();
const BROWSER_PARTITION = 'persist:yan-browser';
const configuredBrowserGuestIds = new Set();
const browserAgentBridgeToken = crypto.randomBytes(32).toString('hex');
const browserAgentBridgePending = new Map();
const BROWSER_AGENT_BRIDGE_MAX_BYTES = 16 * 1024 * 1024;
const BROWSER_AGENT_BRIDGE_ACTIONS = new Set([
  'set_viewport',
  'query_history',
  'open',
  'snapshot',
  'read_page',
  'click',
  'type',
  'select',
  'check',
  'hover',
  'focus',
  'drag',
  'pointer',
  'press',
  'scroll',
  'wait',
  'screenshot',
  'inspect_page',
  'apply_annotation',
  'back',
  'forward',
  'reload',
  'status'
]);
let browserAgentBridgeServer = null;
let browserAgentBridgePort = 0;
const sessionAgentBridgeToken = crypto.randomBytes(32).toString('hex');
const sessionAgentBridgePending = new Map();
const SESSION_AGENT_BRIDGE_MAX_BYTES = 8 * 1024 * 1024;
const SESSION_AGENT_ACTIONS = new Set(['create_handoff', 'read_source_context']);
const OPEN_CODE_SESSION_TOOL_ACTIONS = Object.freeze({
  yan_session_create_handoff: 'create_handoff',
  yan_session_read_source_context: 'read_source_context'
});
let sessionAgentBridgeServer = null;
let sessionAgentBridgePort = 0;

// ---------------------------------------------------------------------------
// Paths & storage
// ---------------------------------------------------------------------------
// 用户数据统一存放在固定目录 YanData，更新/重装后保留会话、配置与记忆。
// 首次从旧版「按构建隔离」目录（YanData-*）自动迁移。
const userDataDir = app.getPath('userData');
const STABLE_DATA_DIR = path.join(userDataDir, 'YanData');

async function migrateLegacyDataDir() {
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
    // 异步拷贝:旧目录可能包含全部会话与上 GB 的图片缓存,同步 cpSync 会让启动
    // 界面冻结数分钟;await 保证后续启动流程仍在迁移完成后才开始
    await fsp.cp(bestDir, STABLE_DATA_DIR, { recursive: true, force: true });
    console.log('[data] migrated legacy data from', path.basename(bestDir), 'to YanData');
  } catch (e) {
    console.error('[data] migrate legacy data failed:', e.message);
  }
}

const dataDir = STABLE_DATA_DIR;

// GitHub CLI 只认一个配置目录。主进程原本读 %APPDATA%\GitHub CLI,而内核给子进程
// 设了 XDG_CONFIG_HOME(指向 runtimeRoot),于是在 Yan 终端里 gh auth login 写进了
// 内核私有目录,GitHub 面板却去 AppData 找,一直显示未连接。这里启动时定一次:
// 把内核目录里已有的登录复制过去(不覆盖、不删源),再把结果钉进 GH_CONFIG_DIR。
// GH_CONFIG_DIR 优先级高于 XDG_CONFIG_HOME,所以内核和它开出来的终端会继承同一个
// 目录,以后在哪登录都写到同一处。详见 lib/gh-config-dir.js。
const ghConfigDir = require('./lib/gh-config-dir');
try {
  const adopt = ghConfigDir.adoptKernelGhConfig(dataDir);
  if (adopt.adopted) console.log('[gh] 已接管内核目录中的 GitHub CLI 登录信息');
} catch (error) {
  console.error('[gh] 接管 GitHub CLI 配置失败(忽略):', error.message);
}
if (!String(process.env.GH_CONFIG_DIR || '').trim()) {
  process.env.GH_CONFIG_DIR = ghConfigDir.resolveGhConfigDir();
}

process.env.YAN_OFFICECLI_DATA_DIR = path.join(dataDir, 'runtimes', 'officecli');
process.env.YAN_ELECTRON_RUNTIME = process.execPath;
const configPath = path.join(dataDir, 'config.json');
const sessionsDir = path.join(dataDir, 'sessions');
const filesDir = path.join(dataDir, 'uploads');

// Uploads and attachment paths (lib/main/upload-store.js)
const uploadStore = createUploadStore({ filesDir });

// 进程级兜底:主进程没有任何未捕获异常处理时,单个 EPIPE/类型错误就会让整个应用
// 直接消失。这里记录崩溃现场(文件+控制台)但保持存活,让用户有机会保存会话。
let lastCrashLogAt = 0;
function reportProcessError(kind, error) {
  const message = `[${kind}] ${new Date().toISOString()} ${error && error.stack ? error.stack : String(error)}`;
  console.error(message);
  const now = Date.now();
  if (now - lastCrashLogAt < 1000) return; // 风暴限流:每秒最多落盘一次
  lastCrashLogAt = now;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(path.join(dataDir, 'main-crash.log'), `${message}\n`, 'utf8');
  } catch { /* 日志失败不能再引发异常 */ }
}

process.on('uncaughtException', (error) => reportProcessError('uncaughtException', error));
process.on('unhandledRejection', (reason) => reportProcessError('unhandledRejection', reason));

// 主进程停滞哨兵:主线程卡死时它自己写不了日志,所以观测放在独立 worker 线程,
// 主线程只每秒往共享内存写一次心跳(见 lib/main/hang-guard.js)。
const hangGuard = createHangGuard({ app, dataDir });

// 子进程(GPU / 网络 / 工具服务)退出过去完全无痕。GPU 进程重启后,已最小化或被
// 遮挡的窗口可能停在旧帧上,主动要求重绘一次。
app.on('child-process-gone', (_event, details) => {
  hangGuard.note('child-process-gone', details);
  if (details?.type !== 'GPU' || isQuiting) return;
  setTimeout(() => {
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.invalidate(); } catch { /* 窗口正在销毁 */ }
  }, 500).unref?.();
});
// 覆盖所有渲染进程(含内置浏览器 webview);主窗口自己的恢复逻辑在 main-window.js。
app.on('render-process-gone', (_event, contents, details) => {
  let kind = 'unknown';
  try { kind = contents.getType(); } catch { /* 已销毁 */ }
  hangGuard.note('render-process-gone', { kind, ...details });
});

function initializeYanCore() {
  if (yanCore) return yanCore;
  yanCore = new YanCore({
    rootDir: path.join(dataDir, 'yan-core'),
    logger: console
  });
  yanCore.on('event', event => {
    // Renderer consumes raw provider streaming over the OpenCode path; only
    // lifecycle, tool, context, and queue events are useful over this channel.
    if (['message.delta', 'reasoning.delta', 'provider.event'].includes(event?.type)) return;
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('yan:core-event', event);
  });
  return yanCore;
}
// Generated media store (lib/main/generated-media-store.js)
const generatedMedia = registerGeneratedMediaStore({ app, dataDir, generatedImages, generatedImageViewers });

const skillsDir = skillRegistry.getYanSkillDirectory(dataDir);
const memoryPath = path.join(dataDir, 'memory.json');
const skillEvolutionPath = path.join(dataDir, 'skill-evolution.json');
const continualHarnessPath = path.join(dataDir, 'harness', 'harness-state.json');
const YANAGENT_DIR = '.yanagent';
const longTermMemory = new LongTermMemoryStore({ globalPath: memoryPath, yanagentDir: YANAGENT_DIR });
const skillEvolution = new SkillEvolutionStore({ filePath: skillEvolutionPath });
const continualHarness = new ContinualHarnessStore({ globalPath: continualHarnessPath, yanagentDir: YANAGENT_DIR });
// 恢复流程已异步化(锁等待不能阻塞事件循环),模块加载阶段用 Promise 链兜底
continualHarness.recoverRejectedAgentRefinements({ scope: 'global' })
  .then((recovered) => {
    if (recovered.length) console.log(`[harness] recovered ${recovered.length} explicit user policy record(s)`);
  })
  .catch((error) => console.warn('[harness] explicit policy recovery failed:', error?.message || error));

// ---------------------------------------------------------------------------
// .yanagent workspace store (lib/main/yanagent-store.js)
// ---------------------------------------------------------------------------
const yanagent = registerYanagentStore({ resourceLocks, yanagentDir: YANAGENT_DIR, sessionsDir });

function ensureDirs() {
  for (const dir of [dataDir, sessionsDir, filesDir, skillsDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

const {
  EMPTY_MEDIA_CAPABILITIES,
  PROVIDER_MEDIA_CAPABILITIES,
  PROVIDER_MEDIA_ADAPTERS,
  STATIC_PROVIDER_SUPPLEMENTAL_MODELS,
  MODEL_PROVIDERS,
  DEFAULT_MODELS,
  ensureDefaultMcp
} = createRuntimeDefaults({ dataDir });

const DEFAULT_SKILLS = skillRegistry.getBuiltinSkills(appRoot);

function getMergedSkills(cfg) {
  return skillRegistry.getMergedSkillsForList(cfg, appRoot, dataDir);
}

// ---------------------------------------------------------------------------
// Provider configuration (lib/main/provider-config.js)
// ---------------------------------------------------------------------------
const providerConfig = createProviderConfig({
  MODEL_PROVIDERS,
  STATIC_PROVIDER_SUPPLEMENTAL_MODELS,
  DEFAULT_MODEL_ROLES,
  appRoot,
  normalizeRemoteModels,
  buildSelectableModelCatalog,
  decorateModels,
  getModelType,
  resolveConnectionPreset,
  resolveConnectionApiFormat,
  updateImageGenerationConfig: (...args) => modelState.updateImageGenerationConfig(...args)
});

// ---------------------------------------------------------------------------
// Vision relay runtime (lib/main/vision-relay-runtime.js)
// ---------------------------------------------------------------------------
const visionRelay = createVisionRelayRuntime({
  MODEL_PROVIDERS,
  providerConfig,
  uploadStore
});

// ---------------------------------------------------------------------------
// Model state (lib/main/model-state.js)
// ---------------------------------------------------------------------------
const modelState = createModelState({
  MODEL_PROVIDERS,
  providerConfig,
  configStore: {
    loadConfig: (...args) => configStore.loadConfig(...args),
    saveConfig: (...args) => configStore.saveConfig(...args)
  },
  getMainWindow: () => mainWindow
});

// ---------------------------------------------------------------------------
// Config store (lib/main/config.js)
// ---------------------------------------------------------------------------
const configStore = createConfigStore({
  app,
  safeStorage,
  configPath,
  MODEL_PROVIDERS,
  providerConfig,
  PET_IDS,
  DEFAULT_MODELS,
  DEFAULT_SKILLS,
  DEFAULT_QUICK_INPUT_SHORTCUT,
  ensureDefaultMcp,
  normalizeAgentModelSelection: modelState.normalizeAgentModelSelection,
  updateImageGenerationConfig: modelState.updateImageGenerationConfig,
  normalizeQuickLaunchConfig,
  getFirstTextModel: modelState.getFirstTextModel,
  ensureBundledAgentSkills: (...args) => skillsRuntime.ensureBundledAgentSkills(...args),
  getMergedSkills,
  deepMerge,
  ensureDirs,
  writeAtomic,
  normalizeReasoningSpeed,
  reasoningSpeedEnablesThinking,
  normalizeVoice,
  normalizeRate
});

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
const lightWindowIconPngPath = path.join(__dirname, 'renderer', 'assets', 'logo-light.png');
const lightWindowIconIcoPath = path.join(__dirname, 'renderer', 'assets', 'logo-light.ico');
const darkWindowIconPngPath = path.join(__dirname, 'renderer', 'assets', 'logo-dark.png');
const darkWindowIconIcoPath = path.join(__dirname, 'renderer', 'assets', 'logo-dark.ico');

const { loadAppIcon, applyWindowIcon, showImageViewerWindow, windowIconPngPath } = createImageViewer({
  BrowserWindow, nativeImage, nativeTheme, appRoot,
  lightWindowIconPngPath, lightWindowIconIcoPath, darkWindowIconPngPath, darkWindowIconIcoPath,
  generatedImageViewers, windowsAppId
});

// ---------------------------------------------------------------------------
// IPC: Config / API / Models
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main context (plan T1.0): injected into every lib/main/* registration module
// ---------------------------------------------------------------------------
let mainContextCache = null;
function getMainContext() {
  if (!mainContextCache) {
    mainContextCache = createMainContext({
      electron: { ipcMain, app, dialog, shell, session, screen, clipboard, globalShortcut, webContents, BrowserWindow, Menu, Tray, nativeImage, nativeTheme },
      windows: {
        getMainWindow: () => mainWindow,
        getQuickInputWindow: () => quickInputWindow,
        getPetWindow: () => petWindow,
        getTray: () => tray,
        fromWebContents: contents => BrowserWindow.fromWebContents(contents)
      },
      config: { load: configStore.loadConfig, save: configStore.saveConfig },
      paths: { dataDir, stableDataDir: STABLE_DATA_DIR, filesDir, appRoot, lightWindowIconPngPath, lightWindowIconIcoPath, darkWindowIconPngPath, darkWindowIconIcoPath },
      services: {
        gitService,
        worktreeService,
        ghService,
        runReviewTask,
        ensureDirs,
        resolveStoredUploadPath: uploadStore.resolveStoredUploadPath,
        registerGeneratedImage: generatedMedia.registerGeneratedImage,
        getGeneratedImageAsset: generatedMedia.getGeneratedImageAsset,
        cacheAuthorizedGeneratedVideo: generatedMedia.cacheAuthorizedGeneratedVideo,
        showImageViewerWindow,
        updateImageGenerationConfig: modelState.updateImageGenerationConfig,
        resolveRequestedGenerationConfig: modelState.resolveRequestedGenerationConfig,
        getProviderConnectionForSupplier: providerConfig.getProviderConnectionForSupplier,
        providerAdapterPreset: providerConfig.providerAdapterPreset,
        normalizeLanguage: configStore.normalizeLanguage,
        modelProviders: MODEL_PROVIDERS,
        generatedImageMimeByExtension: GENERATED_IMAGE_MIME_BY_EXTENSION
      },
      stores: { activeImageGenerations, activeVideoGenerations, generatedImages },
      state: {
        mainWindow: stateCell(() => mainWindow, value => { mainWindow = value; }),
        mainRendererReady: stateCell(() => mainRendererReady, value => { mainRendererReady = value; }),
        pendingFocusMain: stateCell(() => pendingFocusMain, value => { pendingFocusMain = value; }),
        isQuiting: stateCell(() => isQuiting, value => { isQuiting = value; }),
        quickInputWindow: stateCell(() => quickInputWindow, value => { quickInputWindow = value; }),
        quickInputGlowWindow: stateCell(() => quickInputGlowWindow, value => { quickInputGlowWindow = value; }),
        quickInputGlowDisplayId: stateCell(() => quickInputGlowDisplayId, value => { quickInputGlowDisplayId = value; }),
        quickInputActive: stateCell(() => quickInputActive, value => { quickInputActive = value; }),
        registeredQuickInputShortcut: stateCell(() => registeredQuickInputShortcut, value => { registeredQuickInputShortcut = value; }),
        petWindow: stateCell(() => petWindow, value => { petWindow = value; }),
        activePetId: stateCell(() => activePetId, value => { activePetId = value; }),
        petState: stateCell(() => petState, value => { petState = value; }),
        tray: stateCell(() => tray, value => { tray = value; })
      }
    });
  }
  return mainContextCache;
}

// ---------------------------------------------------------------------------
// Browser guest helpers (lib/main/browser-helpers.js)
// ---------------------------------------------------------------------------
const browserHelpers = createBrowserHelpers(getMainContext(), { getMainWindow: () => mainWindow });

// ---------------------------------------------------------------------------
// Browser + session agent bridges (lib/main/bridges.js)
// ---------------------------------------------------------------------------
const bridges = registerBridges(getMainContext(), {
  externalAgents: () => externalAgents,
  queryBrowserHistory: (...args) => browserSettings.queryAgentHistory(...args),
  electronNet,
  resourceLocks,
  getMainWindow: () => mainWindow,
  isMainRendererReady: () => mainRendererReady,
  openCodeActiveRuns,
  browserAgentToolClaims,
  sessionAgentToolClaims,
  configuredBrowserGuestIds,
  browserAgentBridgePending,
  sessionAgentBridgePending,
  browserAgentBridgeToken,
  sessionAgentBridgeToken,
  BROWSER_PARTITION,
  BROWSER_AGENT_BRIDGE_ACTIONS,
  BROWSER_AGENT_BRIDGE_MAX_BYTES,
  SESSION_AGENT_BRIDGE_MAX_BYTES,
  SESSION_AGENT_ACTIONS,
  OPEN_CODE_SESSION_TOOL_ACTIONS,
  bridgeServer: stateCell(() => browserAgentBridgeServer, value => { browserAgentBridgeServer = value; }),
  bridgePort: stateCell(() => browserAgentBridgePort, value => { browserAgentBridgePort = value; }),
  sessionBridgeServer: stateCell(() => sessionAgentBridgeServer, value => { sessionAgentBridgeServer = value; }),
  sessionBridgePort: stateCell(() => sessionAgentBridgePort, value => { sessionAgentBridgePort = value; }),
  sessionStore: {
    readBoundSourceContext: (...args) => sessionStore.readBoundSourceContext(...args),
    readSessionRecord: (...args) => sessionStore.readSessionRecord(...args),
    validateHandoffTarget: (...args) => sessionStore.validateHandoffTarget(...args),
    resolveWorkspaceSessionForHandoff: (...args) => sessionStore.resolveWorkspaceSessionForHandoff(...args)
  },
  configStore: { loadConfig: (...args) => configStore.loadConfig(...args) },
  modelState: { normalizeAgentModelSelection: (...args) => modelState.normalizeAgentModelSelection(...args) },
  visionRelay: { getVisionRelayModels: (...args) => visionRelay.getVisionRelayModels(...args) },
  browserHelpers,
  hangGuard
});

const externalAgents = new (require('./lib/external-agents/service').ExternalAgentService)({
  dataDir: STABLE_DATA_DIR, loadConfig: () => configStore.loadConfig(),
  workerPath: path.join(providerConfig.getChildReadableAppRoot(), 'lib', 'external-agents', 'worker.js')
});
require('./lib/main/external-agents').registerExternalAgents({ ipcMain, dialog, getMainWindow: () => mainWindow, service: externalAgents });
const voiceInput = require('./lib/main/voice-input').registerVoiceInput({
  app, ipcMain, getMainWindow: () => mainWindow, configStore,
  appRoot: providerConfig.getChildReadableAppRoot(), dataDir
});

// ---------------------------------------------------------------------------
// Skills runtime (lib/main/skills-runtime.js)
// ---------------------------------------------------------------------------
const skillsRuntime = registerSkillsRuntime(getMainContext(), {
  appRoot,
  dataDir,
  skillsDir,
  skillRegistry,
  configStore,
  getMergedSkills,
  skillEvolution,
  continualHarness,

  DEFAULT_SKILLS,
  // mcpRuntimeConfig is created further down, so forward lazily. Every method
  // skills-runtime calls must be listed here (test/main-skills-wiring.test.cjs).
  mcpRuntimeConfig: {
    selectedSkillIds: (...args) => mcpRuntimeConfig.selectedSkillIds(...args),
    unmetSkillRequirements: (...args) => mcpRuntimeConfig.unmetSkillRequirements(...args)
  },
  getMainWindow: () => mainWindow,
  invalidateSidecar: () => openCodeSidecar?.invalidate?.()
});
require('./lib/main/plugins-runtime').registerPluginsRuntime(getMainContext(), {
  dataDir,
  appRoot,
  safeStorage,
  fetcher: (url, options) => electronNet.fetch(String(url), options),
  // A runtime-backed plugin (Playwright) registers and retires its own MCP
  // server, so it needs the same config + invalidation pair as mcp:* IPC.
  config: { load: configStore.loadConfig, save: configStore.saveConfig, ensureDefaultMcp },
  invalidateSidecar: () => openCodeSidecar?.invalidate?.()
});

// ---------------------------------------------------------------------------
// IPC: Text-to-speech, updates, VS Code, PowerShell, review host
// (lib/main/ipc-tools.js)
// ---------------------------------------------------------------------------
registerToolsIpc(getMainContext());

// ---------------------------------------------------------------------------
// Window runtime (lib/main/windows/*) — plan T2.2-T2.5
// ---------------------------------------------------------------------------
const mainWindows = registerMainWindow(getMainContext(), {
  configureBrowserGuest: bridges.configureBrowserGuest,
  applyWindowIcon,
  windowIconPngPath,
  hangGuard
});
const quickInput = registerQuickInput(getMainContext(), {
  focusMainWindow,
  normalizeQuickLaunchConfig,
  defaultShortcut: DEFAULT_QUICK_INPUT_SHORTCUT
});
const petWindows = registerPetWindow(getMainContext(), {
  normalizePetConfig: configStore.normalizePetConfig,
  createMainWindow: () => mainWindows.createWindow()
});
const trayRuntime = registerTray(getMainContext(), {
  togglePetWindow: petWindows.togglePetWindow,
  loadAppIcon
});

// Keep the window, taskbar, tray and image-viewer icons in step with OS light/dark changes.
nativeTheme.on('updated', () => {
  if (mainWindow && !mainWindow.isDestroyed()) applyWindowIcon(mainWindow);
  trayRuntime.refreshTrayIcon();
  for (const viewer of generatedImageViewers.values()) {
    if (viewer && !viewer.isDestroyed()) applyWindowIcon(viewer);
  }
});

// ---------------------------------------------------------------------------
// Provider / connections / models IPC (lib/main/provider-ipc.js)
// ---------------------------------------------------------------------------
const providerIpc = registerProviderIpc(getMainContext(), {
  MODEL_PROVIDERS,
  providerConfig,
  configStore,
  modelState,
  EMPTY_MEDIA_CAPABILITIES,
  PROVIDER_MEDIA_CAPABILITIES,
  PROVIDER_MEDIA_ADAPTERS,
  STATIC_PROVIDER_SUPPLEMENTAL_MODELS
});

// ---------------------------------------------------------------------------
// Workspace runtime (lib/main/workspace-runtime.js)
// ---------------------------------------------------------------------------
const workspaceRuntime = registerWorkspaceRuntime(getMainContext(), { yanagent, yanagentDir: YANAGENT_DIR });

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingFocusMain = true;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---------------------------------------------------------------------------
// IPC: Git, worktrees and GitHub (lib/main/ipc-git.js, lib/main/ipc-gh.js)
// ---------------------------------------------------------------------------
registerGitIpc(getMainContext());
registerGhIpc(getMainContext());

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Session store (lib/session-store.js, lib/main/ipc-session.js)
// ---------------------------------------------------------------------------
const sessionStore = createSessionStore({
  sessionsDir,
  ensureDirs,
  mainWindow: stateCell(() => mainWindow, value => { mainWindow = value; }),
  yanagent,
  activateWorkspace: workspace => workspaceRuntime.activateWorkspace(workspace),
  activeRuns: openCodeActiveRuns,
  runAdmissions: openCodeRunAdmissions,
  filesDir,
  onDeleting: id => {
    backgroundBash.purgeSession(id);
    for (const [runId, entry] of recovery.openCodeRunReconcile) {
      if (entry.meta.yanSessionId === id) recovery.openCodeRunReconcile.delete(runId);
    }
  },
  deleteCoreThread: id => yanCore?.deleteThread(id, { force: true }),
  deleteKernelSessions: ({ yanSessionId, sessionIds, directory }) => require('./lib/kernel-session-deletion').deleteKernelConversation({
    dataDir, yanSessionId, sessionIds,
    directory: workspaceSandbox.normalizeWorkspace(directory) || skillsRuntime.getNoWorkspaceAgentDirectory(yanSessionId),
    sidecar: openCodeSidecar, lease: withOpenCodeBackgroundLease
  })
});
registerSessionIpc(getMainContext(), sessionStore, skillsRuntime, { onDeleted: id => backgroundBash.cancelSession(id) });
const localHistorySettings = require('./lib/main/local-history-settings').createLocalHistorySettings({
  app, shell, configStore, sessionsDir, isSessionRunActive: sessionStore.isSessionRunActive
});
ipcMain.handle('general:local-status', () => localHistorySettings.status());
ipcMain.handle('general:local-update', (_event, key, enabled) => localHistorySettings.update(key, enabled));
ipcMain.handle('general:startup-apps', () => localHistorySettings.openStartupApps());
app.on('before-quit', () => localHistorySettings.stop());
require('./lib/main/ipc-usage').registerUsageIpc(getMainContext());
require('./lib/main/ipc-storage').registerStorageIpc(getMainContext());

// ---------------------------------------------------------------------------
// Long-term memory (lib/main/memory-runtime.js)
// ---------------------------------------------------------------------------
const memoryRuntime = registerMemoryRuntime({
  longTermMemory,

  consumeHarnessRefinementRequest: (...args) => harnessBridge.consumeHarnessRefinementRequest(...args),
  continualHarness,
  rollbackHarnessProjection: (...args) => harnessBridge.rollbackHarnessProjection(...args),
  extractExplicitPolicyInstruction,
  persistExplicitUserPolicy: (...args) => harnessPolicy.persistExplicitUserPolicy(...args),
  applyReviewedHarnessState: (...args) => harnessPolicy.applyReviewedHarnessState(...args),
  recordReviewedRefinementOutcomes: (...args) => harnessPolicy.recordReviewedRefinementOutcomes(...args),
  recordLearningReview: skillsRuntime.recordLearningReview,
  attributeHarnessUsage: (...args) => harnessBridge.attributeHarnessUsage(...args),
  loadConfig: configStore.loadConfig,
  dataDir: STABLE_DATA_DIR,

});
const reviewCompletedRunMemory = memoryRuntime.reviewCompletedRunMemory;
require('./lib/main/memory-settings').registerMemorySettings({ ipcMain, getMainWindow: () => mainWindow, configStore, sessionStore,
  longTermMemory, continualHarness, memoryRuntime, activeRuns: openCodeActiveRuns, admissions: openCodeRunAdmissions });

// ---------------------------------------------------------------------------
// IPC: .yanagent (snapshots, rollback, logs)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// IPC: File uploads and generated media (lib/main/ipc-files-media.js)
// ---------------------------------------------------------------------------
registerFilesMediaIpc(getMainContext());

// ---------------------------------------------------------------------------
// MCP (Model Context Protocol) — manage external tool servers via stdio
// ---------------------------------------------------------------------------
const mcpServers = new Map(); // id -> { process, tools, pending, buffer, nextId }

// ---------------------------------------------------------------------------
// Bundled MCP servers + runtime config (lib/main/mcp-servers.js,
// lib/main/mcp-runtime-config.js)
// ---------------------------------------------------------------------------
const mcpServerBuilders = createMcpServers({
  dataDir,
  providerConfig,
  visionRelay,
  generatedMedia,
  skillsDir,
  configPath,
  browserAgentBridgeToken,
  getBrowserAgentBridgePort: () => browserAgentBridgePort,
  sessionAgentBridgeToken,
  getSessionAgentBridgePort: () => sessionAgentBridgePort,
  continualHarnessPath,
  DEFAULT_INPUT_TOKENS_PER_SECOND,
  normalizeInputTokensPerSecond
});
const mcpRuntimeConfig = createMcpRuntimeConfig({
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
});

// ---------------------------------------------------------------------------
// Harness bridge and shared policy persistence
// ---------------------------------------------------------------------------
const harnessBridge = createHarnessBridge({
  dataDir,
  configStore,
  continualHarness,
  longTermMemory,
  skillRegistry,
  skillEvolution,
  workspaceSandbox,

  refreshYanSkillRegistry: skillsRuntime.refreshYanSkillRegistry
});
const harnessPolicy = createHarnessPolicy({ continualHarness, configStore });

// ---------------------------------------------------------------------------
// MCP server management (lib/main/mcp-management.js)
// ---------------------------------------------------------------------------
const mcpManagement = registerMcpManagement(getMainContext(), {
  app,
  appRoot,
  configPath,
  mcpServers,
  configStore,
  mcpRuntimeConfig,
  harnessBridge,
  getMainWindow: () => mainWindow,
  // Lazy like the skills runtime's wiring: the sidecar singleton is created
  // further down this file, so the thunk must resolve it per call.
  invalidateSidecar: () => openCodeSidecar?.invalidate?.()
});
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
const { getOpenCodeSidecar, getOpenCodeProviderAdapter, ensureOpenCodeSidecar, refreshAgentRuntimeActivity, prewarmOpenCodeSidecar, withOpenCodeBackgroundLease } = createOpenCodeRuntime({
  appRoot,
  dataDir,
  MAX_CONCURRENT_AGENT_RUNS,
  OPENCODE_IDLE_RELEASE_MS,
  openCodeActiveRuns,
  configStore,
  mcpRuntimeConfig,
  openCodeSidecar: stateCell(() => openCodeSidecar, value => { openCodeSidecar = value; }),
  openCodeProviderAdapter: stateCell(() => openCodeProviderAdapter, value => { openCodeProviderAdapter = value; }),
  openCodeIdleReleaseTimer: stateCell(() => openCodeIdleReleaseTimer, value => { openCodeIdleReleaseTimer = value; }),
  openCodePrewarmPromise: stateCell(() => openCodePrewarmPromise, value => { openCodePrewarmPromise = value; }),
  openCodeBackgroundLeases: stateCell(() => openCodeBackgroundLeases, value => { openCodeBackgroundLeases = value; }),
  getMainWindow: () => mainWindow,
  isQuitting: () => isQuiting
});

const manualContextCompressions = new Set();

const runContext = {
  manualContextCompressions,
  configStore,
  modelState,
  openCodeActiveRuns,
  openCodeRunAdmissions,
  MAX_CONCURRENT_AGENT_RUNS,
  skillsRuntime,
  harnessPolicy,
  longTermMemory,

  harnessBridge,
  continualHarness,
  sessionStore,
  refreshAgentRuntimeActivity,
  recovery,
  generatedMedia,
  workspaceRuntime,

  getYanCore: () => yanCore,
  mcpRuntimeConfig,
  visionRelay,
  getOpenCodeSidecar,
  getOpenCodeProviderAdapter,
  providerConfig,
  bridges,
  skillsDir,
  yanagent,
  STABLE_DATA_DIR,
  getMainWindow: () => mainWindow,
  withOpenCodeBackgroundLease,
  reviewCompletedRunMemory
};

const backgroundBash = require('./lib/main/background-bash').registerBackgroundBash({ ipcMain, getMainWindow: () => mainWindow, runContext });
runContext.backgroundBash = backgroundBash;
require('./lib/main/webui-bridge').registerWebuiBridge({ ipcMain, getMainWindow: () => mainWindow, dataDir: STABLE_DATA_DIR });
const remoteControl = require('./lib/main/remote-control').createRemoteControl({ ipcMain, dataDir: STABLE_DATA_DIR, appRoot });

// The renderer confirms a recovered run only after its replayed content is
// persisted into the session. Settling the Core Turn afterwards keeps the next
// startup from re-running recovery for the same Turn.

// Plan documents (lib/main/ipc-plan.js)
registerPlanIpc(getMainContext());

registerOpenCodeIpc(getMainContext(), {
  prewarmOpenCodeSidecar,
  sessionStore,
  manualContextCompressions,
  withOpenCodeBackgroundLease,
  configStore,
  modelState,
  skillsRuntime,
  ensureOpenCodeSidecar,
  mcpRuntimeConfig,
  runContext,
  recovery,
  openCodeActiveRuns,
  getYanCore: () => yanCore,
  getCurrentSidecar: () => openCodeSidecar,
  getOpenCodeProviderAdapter,
  openCodeRunAdmissions,
  bridges
});

registerConfigIpc(getMainContext(), {
  configStore,
  appRoot,
  dataDir,
  visionRelay,
  deepMerge,
  normalizeQuickLaunchConfig,
  providerConfig,
  MODEL_PROVIDERS,
  modelState,
  getMergedSkills,
  ensureDefaultMcp,
  workspaceRuntime,
  petWindows
});

registerBrowserIpc(getMainContext(), {
  bridges,
  BROWSER_PARTITION,
  getMainWindow: () => mainWindow,
  browserAgentBridgePending,
  sessionAgentBridgePending
});
require('./lib/main/browser-passwords').registerBrowserPasswords({ app, ipcMain, safeStorage, session, dialog, webContents }, { getMainWindow: () => mainWindow, configStore, BROWSER_PARTITION });
const browserSettings = require('./lib/main/browser-settings').registerBrowserSettings(getMainContext(), { BROWSER_PARTITION, getMainWindow: () => mainWindow, configStore, hangGuard });
require('./lib/main/browser-lifecycle').registerBrowserLifecycle(getMainContext(), { BROWSER_PARTITION, getMainWindow: () => mainWindow });

registerYanagentIpc(getMainContext(), {
  configStore,
  yanagent,
  sessionStore
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
const gotSingleInstanceLock = (process.env.YAN_E2E_MODE === '1' || process.env.YAN_DISABLE_SINGLE_INSTANCE === '1')
  ? true
  : app.requestSingleInstanceLock();
const taskDeepLinks = gotSingleInstanceLock ? registerTaskDeepLinks(getMainContext(), {
  store: sessionStore, createWindow: () => mainWindows.createWindow(), focusWindow: focusMainWindow
}) : null;
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (taskDeepLinks.acceptArgs(commandLine || [])) return;
    // A normal second launch must always surface the existing app. The
    // process survives window close (tray/pet keep-alive), so the main window
    // may not exist anymore — recreate it instead of only focusing, otherwise
    // the second launch looks exactly like a failed npm start.
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindows.createWindow();
      return;
    }
    focusMainWindow();
  });
}

// Use Chromium's GPU compatibility decisions; the removed 3D island no longer
// needs globally forced software WebGL or a bypass of the driver blocklist.

app.whenReady().then(async () => {
  if (e2eOrphanShutdownStarted || !gotSingleInstanceLock) return;
  try {
    if (taskDeepLinks.registerProtocol() === false) console.warn('[task-link] Protocol registration failed');
  } catch (error) { console.warn('[task-link] Protocol registration failed:', error.message); }
  // The Chromium spellchecker re-segments a contenteditable on every edit and
  // is a constant per-keystroke cost under CJK IME input — the composer's
  // typing lag. The app is Chinese-first; disable it at the session level.
  try { session.defaultSession.setSpellCheckerEnabled(false); } catch {}
  await migrateLegacyDataDir();
  ensureDirs();
  hangGuard.start();
  hangGuard.mark('startup');
  initializeYanCore();
  try {
    const recoveredTurns = yanCore.recoverInterruptedTurns();
    if (recoveredTurns.length) {
      console.warn(`[yan-core] recovered ${recoveredTurns.length} interrupted Turn(s) from the previous process.`);
    }
  } catch (error) {
    console.warn('[yan-core] startup recovery failed:', error?.message || error);
  }
  await bridges.refreshBrowserNetworkSession('https://example.com', { resetConnections: false })
    .catch(error => console.warn(`[browser network] setup failed: ${error.message}`));
  generatedMedia.loadGeneratedImageStore();
  const cfg = configStore.loadConfig();
  skillRegistry.hydrateInstalledSkillMetadata(cfg, appRoot, dataDir);
  skillRegistry.syncYanUserSkills(cfg, appRoot, dataDir);
  const skillStoreResult = skillRegistry.syncSkillStore(cfg, appRoot, dataDir);
  if (!skillStoreResult.ok) console.warn(`[SkillStore] ${skillStoreResult.error}`);
  configStore.saveConfig(cfg);
  try {
    await bridges.startBrowserAgentBridge();
    if (e2eOrphanShutdownStarted) return;
    await bridges.startSessionAgentBridge();
    if (e2eOrphanShutdownStarted) return;
  } catch (error) {
    if (e2eOrphanShutdownStarted) return;
    const message = error && error.message ? error.message : String(error);
    hangGuard.whileBlocking('kernel-start-error', () => dialog.showErrorBox('Yan Kernel 启动失败', `Yan Kernel 无法启动。\n\n${message}`));
    app.quit();
    return;
  }
  skillsRuntime.startYanSkillWatcher();
  workspaceRuntime.startWorkspaceWatcher(cfg.workspace);
  mainWindows.createWindow();
  localHistorySettings.start();
  applyWindowIcon(mainWindow);
  hangGuard.mark('ready');
  providerIpc.refreshConfiguredProviderModelCache('agnes')
    .catch(error => console.warn(`[Agnes models] background refresh failed: ${error.message}`));
  if (process.env.YAN_E2E_MODE !== '1') {
    activePetId = cfg.pet.selected;
    if (cfg.pet.enabled) petWindows.createPetWindow();
    trayRuntime.createTray();
    const quickLaunchRegistration = quickInput.registerQuickInputShortcut(cfg.quickLaunch);
    if (!quickLaunchRegistration.ok) {
      console.warn(`[quick-input] startup registration failed: ${quickLaunchRegistration.error}`);
    }
  }
  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) mainWindows.createWindow();
    else applyWindowIcon(mainWindow);
  });
});

// 有托盘保活时，所有窗口关闭不退出应用
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

// 真正退出时清理托盘和 MCP 服务器
app.on('before-quit', () => {
  isQuiting = true;
  backgroundBash.close();
  remoteControl.stop();
  // 退出流程里的同步清理可能耗时数秒,不能被记成卡死。
  hangGuard.stop();
  if (e2eParentWatchdog) {
    clearInterval(e2eParentWatchdog);
    e2eParentWatchdog = null;
  }
  openCodeEventBatcher.close();
  // Flush a debounced Core snapshot before the process exits.
  try { yanCore?.persist?.(); } catch {}
  // Give a pending event-log compaction a chance to finish during shutdown.
  // Best effort: the process may exit before the promise resolves, in which
  // case the bounded log is simply compacted on the next launch.
  try { yanCore?.store?.flushCompaction?.()?.catch?.(() => {}); } catch {}
  if (openCodeIdleReleaseTimer) clearTimeout(openCodeIdleReleaseTimer);
  openCodeIdleReleaseTimer = null;
  quickInput.unregisterQuickInputShortcut();
  quickInput.destroyQuickInputWindows();
  for (const request of activeImageGenerations.values()) request.controller.abort();
  activeImageGenerations.clear();
  generatedMedia.closeGeneratedImageViewers();
  workspaceRuntime.stopWorkspaceWatcher();
  skillsRuntime.stopYanSkillWatcher();
  bridges.stopBrowserAgentBridge();
  bridges.stopSessionAgentBridge();
  openCodeSidecar?.close();
  openCodeSidecar = null;
  openCodeProviderAdapter = null;
  if (petWindow && !petWindow.isDestroyed()) petWindow.destroy();
  if (tray) tray.destroy();
  // 停止所有 MCP 服务器
  for (const id of mcpServers.keys()) mcpManagement.mcpStop(id);
});

// Test-only exports: loaded under a stubbed Electron (see
// test/opencode-config-signature.test.cjs) to verify that per-run values
// never leak into the OpenCode config signature.
if (process.env.YAN_MAIN_TEST_EXPORTS === '1') {
  module.exports = {
    __test: {
      getOpenCodeMcpServers: mcpRuntimeConfig.getOpenCodeMcpServers,
      getOpenCodeRuntimeConfig: mcpRuntimeConfig.getOpenCodeRuntimeConfig,
      buildYanMediaMcpServer: mcpServerBuilders.buildYanMediaMcpServer,
      buildYanWebMcpServer: mcpServerBuilders.buildYanWebMcpServer,
      buildYanMcpServer: mcpServerBuilders.buildYanMcpServer,
      configStore,
      getMergedSkills,
      inferMcpTaskCapabilities: mcpRuntimeConfig.inferMcpTaskCapabilities,
      applyReviewedHarnessState: (...args) => harnessPolicy.applyReviewedHarnessState(...args),
      persistExplicitUserPolicy: (...args) => harnessPolicy.persistExplicitUserPolicy(...args),
      reviewCompletedRunMemory,
      attributeHarnessUsage: (...args) => harnessBridge.attributeHarnessUsage(...args),
      consumeHarnessUsage: harnessBridge.consumeHarnessUsage,
      harnessRunOutcome: harnessBridge.harnessRunOutcome,
      registerHarnessUsage: harnessBridge.registerHarnessUsage,
      continualHarness,
      buildRecoveredRunDescriptors: recovery.buildRecoveredRunDescriptors,
      recoveryRendererEvent: recovery.recoveryRendererEvent,
      recoveringCoreTurns: recovery.recoveringCoreTurns
    }
  };
}
