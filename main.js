const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { exec, execFile, spawn } = require('child_process');

let mainWindow = null;
let tray = null;
let isQuiting = false;

// ---------------------------------------------------------------------------
// Paths & storage
// ---------------------------------------------------------------------------
// 数据目录按「构建」隔离：每次打包生成的可执行文件（app.asar）的修改时间不同，
// 据此派生唯一的数据文件夹名。这样每个打包版本首次运行时都是全新状态，
// 且启动时会清除其它构建（含旧的全局 YanData）遗留的数据 —— 实现「打包后无残留」。
// 开发模式使用固定标签，避免每次改代码都清空本地调试数据。
const userDataDir = app.getPath('userData');

function currentBuildTag() {
  if (!app.isPackaged) return 'dev';
  try {
    const target = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    const stat = fs.statSync(target);
    return 'build-' + Math.floor(stat.mtimeMs).toString(36);
  } catch {
    return 'build-unknown';
  }
}

const BUILD_TAG = currentBuildTag();
const dataDir = path.join(userDataDir, 'YanData-' + BUILD_TAG);
const configPath = path.join(dataDir, 'config.json');
const sessionsDir = path.join(dataDir, 'sessions');
const filesDir = path.join(dataDir, 'uploads');
const memoryPath = path.join(dataDir, 'memory.json');
const YANAGENT_DIR = '.yanagent';
// ---------------------------------------------------------------------------
// .yanagent — workspace-local memory, logs, session snapshots (safe to delete)
// ---------------------------------------------------------------------------
function yanagentRoot(workspace) {
  if (!workspace) return null;
  return path.join(workspace, YANAGENT_DIR);
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


// 删除不属于当前构建的历史数据目录（旧版 YanData 及其它构建的 YanData-*）
function cleanupStaleData() {
  const keep = path.basename(dataDir);
  let names = [];
  try { names = fs.readdirSync(userDataDir); } catch { return; }
  for (const name of names) {
    if (name === keep) continue;
    if (name === 'YanData' || name.startsWith('YanData-')) {
      try { fs.rmSync(path.join(userDataDir, name), { recursive: true, force: true }); }
      catch (e) { console.error('cleanupStaleData error:', name, e.message); }
    }
  }
}

function ensureDirs() {
  for (const dir of [dataDir, sessionsDir, filesDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

const DEFAULT_MODELS = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', price: '¥0.27/百万 tokens' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', price: '¥2.7/百万 tokens' }
];

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

function getMergedSkills(cfg) {
  const custom = Array.isArray(cfg.customSkills) ? cfg.customSkills : [];
  const ids = new Set(DEFAULT_SKILLS.map(s => s.id));
  const merged = [...DEFAULT_SKILLS];
  for (const s of custom) {
    if (s && s.id && !ids.has(s.id)) {
      merged.push(s);
      ids.add(s.id);
    }
  }
  return merged;
}

const DEFAULT_SKILLS = [
  // 代码类
  { id: 'code-review', name: 'Code Review', desc: '审查代码，给出可读性/性能/安全/最佳实践改进建议' },
  { id: 'refactor', name: 'Refactor', desc: '重构代码，保持功能不变但提升结构与可读性' },
  { id: 'gen-test', name: 'Gen Tests', desc: '为代码生成单元测试，覆盖主要分支和边界' },
  { id: 'explain-code', name: 'Explain Code', desc: '解释代码功能、工作原理和关键逻辑' },
  { id: 'fix-bug', name: 'Fix Bug', desc: '定位并修复代码中的 Bug' },
  { id: 'add-comments', name: 'Add Comments', desc: '为代码添加清晰的注释与文档字符串' },
  { id: 'gen-docs', name: 'Gen Docs', desc: '为代码生成 API 文档（Markdown 含示例）' },
  { id: 'optimize', name: 'Optimize', desc: '优化代码性能（时间/空间复杂度、I/O、内存）' },
  { id: 'security-audit', name: 'Security Audit', desc: '安全审计，找出注入/XSS/CSRF/越权等漏洞' },
  { id: 'convert-lang', name: 'Convert Lang', desc: '将代码从一种语言转换为另一种语言' },
  // Git 类
  { id: 'commit-msg', name: 'Commit Msg', desc: '为代码改动生成 Conventional Commits 提交信息' },
  { id: 'pr-desc', name: 'PR Description', desc: '根据改动生成 PR 描述（摘要/影响/测试建议）' },
  // 文本类
  { id: 'summarize', name: 'Summarize', desc: '总结长文档或对话的要点' },
  { id: 'translate', name: 'Translate', desc: '在多种语言之间翻译文本' },
  { id: 'rewrite', name: 'Rewrite', desc: '重写或润色文本，使其更清晰专业' }
];

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
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
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
    mcpServers: ensureDefaultMcp([]),
    skills: DEFAULT_SKILLS,
    customSkills: [],
    automations: []
  };

  if (!cfg) return defaults;

  const merged = deepMerge(defaults, cfg);
  // 强制使用默认模型列表（自定义模型功能已移除）
  merged.models = DEFAULT_MODELS;
  merged.skills = getMergedSkills(merged);
  merged.mcpServers = ensureDefaultMcp(merged.mcpServers || []);
  // 强制使用 DeepSeek 的 Base URL 和模型，清除旧配置残留
  merged.api.baseUrl = 'https://api.deepseek.com/v1';
  delete merged.api.provider;
  if (!DEFAULT_MODELS.find(m => m.id === merged.api.model)) {
    merged.api.model = 'deepseek-v4-flash';
  }
  return merged;
}

function saveConfig(cfg) {
  ensureDirs();
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
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
    icon: path.join(__dirname, 'renderer', 'assets', 'logo.png'),
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
  mainWindow.once('ready-to-show', () => mainWindow.show());

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

// ---------------------------------------------------------------------------
// Tray (后台保活)
// ---------------------------------------------------------------------------
function createTray() {
  const iconPath = path.join(__dirname, 'renderer', 'assets', 'logo.png');
  let trayIcon = nativeImage.createFromPath(iconPath);
  // 缩放到托盘图标合适尺寸
  if (!trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  }
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
ipcMain.handle('config:set', (_e, partial) => {
  const cfg = loadConfig();
  const merged = deepMerge(cfg, partial);
  // 应用与 loadConfig 相同的强制覆盖逻辑，确保返回值与下次加载一致
  merged.api.baseUrl = 'https://api.deepseek.com/v1';
  delete merged.api.provider;
  if (!DEFAULT_MODELS.find(m => m.id === merged.api.model)) {
    merged.api.model = 'deepseek-v4-flash';
  }
  merged.models = DEFAULT_MODELS;
  merged.skills = getMergedSkills(merged);
  merged.mcpServers = ensureDefaultMcp(merged.mcpServers || []);
  saveConfig(merged);
  return merged;
});

ipcMain.handle('models:list', () => loadConfig().models);
ipcMain.handle('model:set', (_e, modelId) => {
  const cfg = loadConfig();
  cfg.api.model = modelId;
  saveConfig(cfg);
  return cfg;
});

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

// ---------------------------------------------------------------------------
// IPC: Workspace
// ---------------------------------------------------------------------------
ipcMain.handle('workspace:get', () => loadConfig().workspace);
ipcMain.handle('workspace:clear', () => {
  const cfg = loadConfig();
  cfg.workspace = '';
  saveConfig(cfg);
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

ipcMain.handle('session:list', async () => {
  ensureDirs();
  const files = await fsp.readdir(sessionsDir);
  const list = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(await fsp.readFile(path.join(sessionsDir, f), 'utf8'));
      list.push({
        id: data.id,
        title: data.title,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        messageCount: (data.messages || []).length
      });
    } catch (e) { /* skip */ }
  }
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
});

ipcMain.handle('session:get', async (_e, id) => {
  const p = sessionPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(await fsp.readFile(p, 'utf8'));
});

ipcMain.handle('session:create', async () => {
  ensureDirs();
  const id = 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const session = {
    id, title: 'New chat', messages: [],
    createdAt: Date.now(), updatedAt: Date.now()
  };
  await fsp.writeFile(sessionPath(id), JSON.stringify(session, null, 2));
  return session;
});

ipcMain.handle('session:save', async (_e, session) => {
  ensureDirs();
  session.updatedAt = Date.now();
  await fsp.writeFile(sessionPath(session.id), JSON.stringify(session, null, 2));
  return session;
});

// 会话级工作区：存储在 session 对象中，而非全局 config，实现会话隔离
ipcMain.handle('session:set-workspace', async (_e, { id, workspace }) => {
  const p = sessionPath(id);
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(await fsp.readFile(p, 'utf8'));
  data.workspace = workspace || '';
  data.updatedAt = Date.now();
  await fsp.writeFile(p, JSON.stringify(data, null, 2));
  const cfg = loadConfig();
  cfg.workspace = workspace || '';
  saveConfig(cfg);
  if (workspace) {
    migrateMemoryToWorkspace(workspace);
    ensureYanagent(workspace);
  }
  return data;
});

ipcMain.handle('session:rename', async (_e, { id, title }) => {
  const p = sessionPath(id);
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(await fsp.readFile(p, 'utf8'));
  data.title = title;
  data.updatedAt = Date.now();
  await fsp.writeFile(p, JSON.stringify(data, null, 2));
  return data;
});

ipcMain.handle('session:delete', async (_e, id) => {
  const p = sessionPath(id);
  if (fs.existsSync(p)) await fsp.unlink(p);
  return true;
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
  if (!ws || !sessionId || !runId) return { count: 0, changes: [] };
  const snapPath = runSnapshotPath(ws, sessionId, runId);
  if (!fs.existsSync(snapPath)) return { count: 0, changes: [] };
  try {
    const data = JSON.parse(await fsp.readFile(snapPath, 'utf8'));
    return { count: (data.changes || []).length, changes: data.changes || [] };
  } catch {
    return { count: 0, changes: [] };
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

// Upload: copy a file into the uploads dir & return metadata
ipcMain.handle('file:upload', async (_e, { name, data: b64 }) => {
  ensureDirs();
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const target = path.join(filesDir, Date.now() + '_' + safeName);
  await fsp.writeFile(target, Buffer.from(b64, 'base64'));
  const stat = await fsp.stat(target);
  return { path: target, name: safeName, size: stat.size };
});

ipcMain.handle('file:reveal', async (_e, filePath) => {
  shell.showItemInFolder(filePath);
  return true;
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
      clientInfo: { name: 'Yan Agent', version: '1.0.0' }
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
// IPC: File search
// ---------------------------------------------------------------------------
ipcMain.handle('search:files', async (_e, { query, directory, extensions }) => {
  const root = directory || loadConfig().workspace;
  if (!root || !fs.existsSync(root)) return [];
  const results = [];
  const maxResults = 50;
  const exts = extensions || [];
  const queryLower = query.toLowerCase();

  async function walk(dir, depth) {
    if (depth > 5 || results.length >= maxResults) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else {
        if (exts.length > 0) {
          const ext = path.extname(entry.name).slice(1).toLowerCase();
          if (!exts.includes(ext)) continue;
        }
        try {
          const content = await fsp.readFile(fullPath, 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length && results.length < maxResults; i++) {
            if (lines[i].toLowerCase().includes(queryLower)) {
              results.push({
                path: fullPath,
                file: entry.name,
                line: i + 1,
                content: lines[i].trim().slice(0, 200)
              });
            }
          }
        } catch { /* skip binary */ }
      }
    }
  }

  await walk(root, 0);
  return results;
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
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  cleanupStaleData();
  ensureDirs();
  saveConfig(loadConfig());
  createWindow();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 有托盘保活时，所有窗口关闭不退出应用
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

// 真正退出时清理托盘和 MCP 服务器
app.on('before-quit', () => {
  if (tray) tray.destroy();
  // 停止所有 MCP 服务器
  for (const id of mcpServers.keys()) mcpStop(id);
});
