# Yan Computer Use 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Yan Agent 中实现 **Yan Computer Use**：Agent 可操控用户电脑上的任意 Windows 软件，不锁定用户键鼠；用户可按 `Esc` 退出；进入模式前通过复用现有高危命令面板询问是否启用视觉中继；前端提供全屏渲染层（边缘蓝光、顶部提示面板、被操控软件边框跑马灯）。同时提供 **MCP + Skill 双链路**供主模型调用。

**Architecture:** Yan Computer Use 拆分为四个独立模块：
1. **调度与渲染层（主进程 + 渲染进程）**：负责模式进入/退出、`Esc` 热键、视觉状态覆盖层、被操控窗口高亮跟踪，以及通过复用 `agentPermissionPanel` 询问视觉中继开关。
2. **控制后端（主进程 Node.js）**：基于 nuphus-mcp/UIBrowser 二次封装，负责窗口发现、截图、键鼠模拟、UIA 元素读取；采用“不抢键鼠”策略，每次操作前检查目标窗口是否仍在前台，被覆盖则自动 `SetForegroundWindow` 找回。
3. **MCP 协议层**：将电脑操控动作封装为 MCP 工具（`computer_start_control`, `computer_click`, `computer_type`, `computer_screenshot`, `computer_stop_control`），供主模型通过 MCP 调用。
4. **Skill 协议层**：新增一个内置 Skill `yan-computer-use`，让主模型通过 Skill 调用直接启动/停止电脑操控；Skill 内部复用同一套渲染层与宿主逻辑。

**Tech Stack:** Electron 31、Node.js、Windows UIAutomation/UIA、Windows API（通过 node-ffi-napi / @officecli/officecli / nuphus-mcp）、JSON-RPC MCP、Yan Skill 运行时、CSS 动画/Canvas。

---

## 文件结构

### 新增文件
- `lib/computer-control-host.js`：电脑操控主进程宿主。管理模式生命周期、窗口跟踪、Esc 热键注册、截图/键鼠命令派发、视觉中继开关状态。
- `lib/computer-control-bridge.js`：连接 nuphus-mcp/UIBrowser 的桥接层，将 MCP/IPC 调用翻译为 Windows 底层操作。
- `lib/mcp-computer-control-server.js`：向 Yan Agent 主模型暴露的 MCP 服务器，注册 `computer_*` 工具。
- `lib/skills/yan-computer-use/SKILL.md`：Yan Computer Use Skill 定义，包含触发词与 prompt 模板。
- `lib/skills/yan-computer-use/yan-computer-use-runtime.js`：Skill 运行时脚本，通过 stdio JSON-RPC 与 Yan Skills MCP 通信，将 Skill 调用转发到 `lib/computer-control-host.js`。
- `renderer/computer-control-overlay.html`：覆盖层页面，渲染边缘蓝光、顶部提示面板、被操控窗口跑马灯边框。
- `renderer/computer-control-overlay.js`：覆盖层内部逻辑：接收主进程 IPC 消息更新提示文本、边框位置、蓝光动画开关。

### 修改文件
- `main.js`：
  - 引入 `lib/computer-control-host.js`。
  - 新增 IPC：`computer:start`, `computer:stop`, `computer:status`, `computer:requestVisionRelay`, `computer:updateOverlayBounds`, `computer:registerEsc`, `computer:unregisterEsc`。
  - 在 `app.on('ready')` 后初始化电脑操控宿主，并在 `app.on('will-quit')` 时清理热键。
- `preload.js`：
  - 暴露 `yan.computerStart(opts)`, `yan.computerStop()`, `yan.computerStatus()`, `yan.computerRequestVisionRelay()` 给渲染进程。
- `renderer/index.html`：
  - 在 `agentPermissionPanel` 内新增一个可隐藏的可选项 `#agentPermissionVisionRelayOption`（复选框 + 描述文字），用于视觉中继开关。
- `renderer/styles.css`：
  - 为 `#agentPermissionVisionRelayOption` 添加 pill 形开关/复选框样式。
  - 新增 `.computer-control-overlay-glow` 等动画关键帧（边缘蓝光向内扩散）。
- `renderer/renderer.js`：
  - 扩展 `requestAgentPermission` 的入参，支持 `visionRelay: { show: true, checked: false, label, description }`。
  - 当用户点击确认后，返回 `{ decision, useVisionRelay }`。
  - 新增 `enterComputerControl({ targetHwnd, targetTitle })` 渲染层入口，调用 `window.yan.computerStart(...)` 并打开覆盖层。
  - 监听 `computer:overlay:update` 消息同步覆盖层状态。
- `lib/skills/builtin.json`：
  - 注册 `yan-computer-use` 内置 Skill，关联 `lib/skills/yan-computer-use/SKILL.md`。

---

## Task 1: 可复用的视觉中继开关 UI

**目标：** 让现有高危命令面板支持“视觉中继开关”选项，进入电脑操控时询问用户。

**Files:**
- Modify: `renderer/index.html:182-201`
- Modify: `renderer/styles.css:2329-2428`
- Modify: `renderer/renderer.js:6190-6248`

- [ ] **Step 1: 在 HTML 中新增视觉中继选项 DOM**

在 `agentPermissionPanel` 的 `.agent-permission-body` 内、描述文字之后、命令详情之前插入可隐藏的视觉中继选项。

```html
<!-- 插入到 agentPermissionBody 中，描述 <p> 之后，<pre> 之前 -->
<div id="agentPermissionVisionRelayOption" class="agent-permission-vision-relay hidden">
  <label class="vision-relay-switch">
    <input id="agentPermissionVisionRelayCheck" type="checkbox" checked />
    <span class="vision-relay-slider" aria-hidden="true"></span>
    <span class="vision-relay-text">
      <strong>使用视觉中继</strong>
      <span id="agentPermissionVisionRelayDesc">开启后 Yan Agent 会调用免费视觉中继模型辅助定位按钮与理解界面。</span>
    </span>
  </label>
</div>
```

- [ ] **Step 2: 添加 CSS 开关样式**

在 `styles.css` 的 `.agent-permission-panel` 区块末尾添加：

```css
.agent-permission-vision-relay {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: color-mix(in srgb, var(--bg-elev) 80%, transparent);
}
.agent-permission-vision-relay.hidden { display: none; }
.vision-relay-switch {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  cursor: pointer;
}
.vision-relay-switch input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.vision-relay-slider {
  flex: 0 0 44px;
  width: 44px;
  height: 24px;
  border-radius: var(--r-pill);
  background: var(--text-muted);
  position: relative;
  transition: background var(--dur-micro) var(--ease-out);
}
.vision-relay-slider::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform var(--dur-micro) var(--ease-out);
}
.vision-relay-switch input:checked + .vision-relay-slider { background: var(--accent); }
.vision-relay-switch input:checked + .vision-relay-slider::after { transform: translateX(20px); }
.vision-relay-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text);
}
.vision-relay-text strong { font-weight: 600; }
.vision-relay-text span { color: var(--text-dim); font-size: 12px; }
```

- [ ] **Step 3: 扩展 `requestAgentPermission` 接口并处理返回值**

修改 `renderer/renderer.js` 中的 `requestAgentPermission`：

```javascript
function requestAgentPermission({ requestId = '', title, description, detail, sessionId, allowAlways = true, visionRelay = null }, runCtx) {
  return new Promise((resolve) => {
    if (agentPermissionRequest) settleAgentPermission('deny');
    const panel = $('#agentPermissionPanel');
    const titleEl = $('#agentPermissionTitle');
    const descriptionEl = $('#agentPermissionDescription');
    const detailEl = $('#agentPermissionDetail');
    const alwaysButton = $('#agentPermissionAlways');
    const visionRelayOption = $('#agentPermissionVisionRelayOption');
    const visionRelayCheck = $('#agentPermissionVisionRelayCheck');
    const visionRelayDesc = $('#agentPermissionVisionRelayDesc');
    if (!panel || !titleEl || !descriptionEl || !detailEl) {
      resolve({ decision: 'deny', useVisionRelay: false });
      return;
    }

    titleEl.textContent = title || '权限确认';
    descriptionEl.textContent = description || 'Agent 请求执行受限操作，是否允许：';
    detailEl.textContent = detail || '(empty)';
    alwaysButton?.classList.toggle('hidden', allowAlways === false);

    const showVisionRelay = !!visionRelay?.show;
    visionRelayOption?.classList.toggle('hidden', !showVisionRelay);
    if (showVisionRelay && visionRelayCheck) {
      visionRelayCheck.checked = visionRelay.checked !== false;
      visionRelayCheck.disabled = visionRelay.readOnly === true;
      if (visionRelayDesc && visionRelay.description) {
        visionRelayDesc.textContent = visionRelay.description;
      }
    }

    panel.classList.remove('hidden', 'collapsed');
    $('#agentPermissionToggle')?.setAttribute('aria-expanded', 'true');
    $('#chatMainColumn')?.classList.add('permission-pending');

    agentPermissionRequest = {
      resolve: (decision, extras = {}) => {
        const useVisionRelay = showVisionRelay ? (visionRelayCheck?.checked ?? false) : false;
        resolve({ decision, useVisionRelay, ...extras });
      },
      runCtx,
      sessionId,
      requestId: String(requestId || '')
    };
    requestAnimationFrame(positionAgentPermissionPanel);
  });
}
```

- [ ] **Step 4: 更新所有现有 `requestAgentPermission` 调用以兼容新返回结构**

将现有调用从 `const decision = await requestAgentPermission(...)` 改为解构：

```javascript
const { decision } = await requestAgentPermission({ ... });
```

需要修改的位置（使用 Grep 确认）：
- `renderer/renderer.js:5068`
- `renderer/renderer.js:5085`
- `renderer/renderer.js:5098`
- `renderer/renderer.js:6258`

- [ ] **Step 5: 手动验证面板 UI**

运行 `npm run dev`，在 DevTools Console 执行：

```javascript
requestAgentPermission({
  title: '进入电脑操控模式',
  description: 'Agent 即将开始操控你的电脑。是否允许：',
  detail: '目标软件: 记事本',
  visionRelay: {
    show: true,
    checked: true,
    description: '若模型支持多模态，可关闭视觉中继以节省调用。'
  }
}, { runId: 'test' }).then(console.log);
```

Expected: 面板显示“使用视觉中继”开关，点击“总是允许”后控制台输出 `{ decision: 'always', useVisionRelay: true }`。

- [ ] **Step 6: Commit**

```bash
git add renderer/index.html renderer/styles.css renderer/renderer.js
git commit -m "feat: add vision-relay toggle to agent permission panel"
```

---

## Task 2: 电脑操控主进程宿主与 Esc 热键

**目标：** 在主进程中建立模式生命周期，进入电脑操控时注册 `Esc` 退出热键，退出时注销。

**Files:**
- Create: `lib/computer-control-host.js`
- Modify: `main.js:1-2`（仅 import 区）、`main.js` 中 `app.on('ready')` 附近、`main.js` 中 `app.on('will-quit')` 附近
- Modify: `preload.js`

- [ ] **Step 1: 创建 `lib/computer-control-host.js` 基础宿主**

```javascript
'use strict';

const { globalShortcut, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

const ESCAPE_KEY = 'Escape';

let mainWindowRef = null;
let isControlling = false;
let controlState = {
  targetHwnd: null,
  targetTitle: '',
  useVisionRelay: false,
  startTime: null,
  overlayWindow: null
};

function setMainWindow(win) { mainWindowRef = win; }

function sendToRenderer(channel, payload) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, payload);
  }
}

function registerEscapeHotkey() {
  try {
    if (globalShortcut.isRegistered(ESCAPE_KEY)) return true;
    const ok = globalShortcut.register(ESCAPE_KEY, () => {
      if (isControlling) {
        sendToRenderer('computer:stop-requested', { reason: 'esc' });
        stopComputerControl();
      }
    });
    return ok;
  } catch (err) {
    console.error('[computer-control] register Esc failed:', err);
    return false;
  }
}

function unregisterEscapeHotkey() {
  try {
    globalShortcut.unregister(ESCAPE_KEY);
  } catch (err) {
    console.error('[computer-control] unregister Esc failed:', err);
  }
}

async function startComputerControl({ targetHwnd = null, targetTitle = '', useVisionRelay = false }) {
  if (isControlling) await stopComputerControl();

  isControlling = true;
  controlState = {
    targetHwnd,
    targetTitle,
    useVisionRelay,
    startTime: Date.now(),
    overlayWindow: null
  };

  const hotkeyOk = registerEscapeHotkey();
  if (!hotkeyOk) {
    console.warn('[computer-control] Esc hotkey registration failed, continuing without global Esc.');
  }

  sendToRenderer('computer:state-changed', { active: true, ...controlState });
  return { ok: true, hotkeyRegistered: hotkeyOk };
}

async function stopComputerControl() {
  if (!isControlling) return { ok: true };
  isControlling = false;
  unregisterEscapeHotkey();
  closeOverlayWindow();
  sendToRenderer('computer:state-changed', { active: false });
  return { ok: true };
}

function getComputerControlStatus() {
  return { active: isControlling, ...controlState };
}

// Overlay window management (used later by Task 3)
function createOverlayWindow() {
  closeOverlayWindow();
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workAreaSize;
  controlState.overlayWindow = new BrowserWindow({
    width,
    height,
    x: primary.workArea.x,
    y: primary.workArea.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  controlState.overlayWindow.loadFile(path.join(__dirname, '..', 'renderer', 'computer-control-overlay.html'));
  controlState.overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  controlState.overlayWindow.on('ready-to-show', () => controlState.overlayWindow?.show());
  return controlState.overlayWindow;
}

function closeOverlayWindow() {
  if (controlState.overlayWindow && !controlState.overlayWindow.isDestroyed()) {
    controlState.overlayWindow.close();
  }
  controlState.overlayWindow = null;
}

function setupComputerControlIpc() {
  ipcMain.handle('computer:start', async (_event, opts) => startComputerControl(opts || {}));
  ipcMain.handle('computer:stop', async () => stopComputerControl());
  ipcMain.handle('computer:status', () => getComputerControlStatus());
  ipcMain.on('computer:overlay:bounds', (_event, bounds) => {
    if (controlState.overlayWindow && !controlState.overlayWindow.isDestroyed()) {
      controlState.overlayWindow.webContents.send('computer:overlay:bounds', bounds);
    }
  });
}

module.exports = {
  setMainWindow,
  setupComputerControlIpc,
  startComputerControl,
  stopComputerControl,
  getComputerControlStatus,
  createOverlayWindow,
  closeOverlayWindow,
  isControlling: () => isControlling
};
```

- [ ] **Step 2: 在 `main.js` 中初始化电脑操控宿主**

在 `main.js` 顶部引入：

```javascript
const computerControlHost = require('./lib/computer-control-host');
```

在创建 `mainWindow` 之后（例如在 `createWindow` 函数内 `mainWindow = new BrowserWindow(...)` 之后）调用：

```javascript
computerControlHost.setMainWindow(mainWindow);
computerControlHost.setupComputerControlIpc();
```

在 `app.on('will-quit', () => { ... })` 中加入：

```javascript
computerControlHost.stopComputerControl();
```

- [ ] **Step 3: 在 `preload.js` 暴露 API**

在 `contextBridge.exposeInMainWorld('yan', { ... })` 中添加：

```javascript
computerStart: (opts) => ipcRenderer.invoke('computer:start', opts),
computerStop: () => ipcRenderer.invoke('computer:stop'),
computerStatus: () => ipcRenderer.invoke('computer:status'),
```

- [ ] **Step 4: 编写最小化 E2E 测试验证 Esc 热键**

创建 `test/computer-control.e2e.cjs`（若不存在则新增）：

```javascript
const { test, expect } = require('@playwright/test');

test('computer control registers Esc hotkey and stops on Esc', async () => {
  // 该测试需在已启动的 Electron 应用上下文中运行，或复用现有测试启动逻辑
  const { electronApp, page } = await startElectronApp(); // 已有测试辅助函数
  await page.evaluate(() => window.yan.computerStart({ targetTitle: 'Notepad' }));
  const status1 = await page.evaluate(() => window.yan.computerStatus());
  expect(status1.active).toBe(true);

  // 模拟 Esc：通过 IPC 触发 stop（真实热键在 Playwright 中难以跨进程断言，先验证 API 行为）
  await page.evaluate(() => window.yan.computerStop());
  const status2 = await page.evaluate(() => window.yan.computerStatus());
  expect(status2.active).toBe(false);
});
```

- [ ] **Step 5: 手动验证 Esc 热键**

运行 `npm run dev`，在 DevTools 执行：

```javascript
await window.yan.computerStart({ targetTitle: 'Test' });
console.log(await window.yan.computerStatus());
// 按 Esc
setTimeout(async () => console.log(await window.yan.computerStatus()), 1000);
```

Expected: 状态从 `active: true` 变为 `active: false`。

- [ ] **Step 6: Commit**

```bash
git add lib/computer-control-host.js preload.js main.js test/computer-control.e2e.cjs
git commit -m "feat: computer control host with Esc hotkey"
```

---

## Task 3: 前端渲染层（蓝光、顶部面板、窗口跑马灯）

**目标：** 进入电脑操控后，显示全屏透明覆盖层：屏幕边缘蓝色光晕向内扩散；顶部中心显示“Yan Agent正在操控你的电脑，按Esc退出”；被操控软件窗口四周有蓝色跑马灯边框。

**Files:**
- Create: `renderer/computer-control-overlay.html`
- Create: `renderer/computer-control-overlay.js`
- Modify: `renderer/styles.css`
- Modify: `lib/computer-control-host.js`
- Modify: `renderer/renderer.js`

- [ ] **Step 1: 创建覆盖层页面**

`renderer/computer-control-overlay.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="styles.css" />
  <title>Yan Agent 电脑操控覆盖层</title>
</head>
<body class="computer-control-overlay">
  <div id="overlayGlow" class="computer-control-overlay-glow" aria-hidden="true"></div>
  <div id="overlayTopPanel" class="computer-control-overlay-top-panel">
    <span class="overlay-pulse-dot"></span>
    <span id="overlayTopText">Yan Agent 正在操控你的电脑，按 Esc 退出</span>
  </div>
  <div id="overlayTargetBorder" class="computer-control-overlay-target-border" aria-hidden="true">
    <div class="target-border-corner target-border-tl"></div>
    <div class="target-border-corner target-border-tr"></div>
    <div class="target-border-corner target-border-bl"></div>
    <div class="target-border-corner target-border-br"></div>
  </div>
  <script src="computer-control-overlay.js"></script>
</body>
</html>
```

- [ ] **Step 2: 创建覆盖层 JS**

`renderer/computer-control-overlay.js`：

```javascript
'use strict';

const $ = (sel) => document.querySelector(sel);

function setGlow(active) {
  $('#overlayGlow').classList.toggle('hidden', !active);
}

function setTopText(text) {
  const el = $('#overlayTopText');
  if (el && text) el.textContent = text;
}

function setTargetBounds(bounds) {
  const border = $('#overlayTargetBorder');
  if (!bounds || !bounds.visible) {
    border.classList.add('hidden');
    return;
  }
  border.classList.remove('hidden');
  border.style.left = `${bounds.x}px`;
  border.style.top = `${bounds.y}px`;
  border.style.width = `${bounds.width}px`;
  border.style.height = `${bounds.height}px`;
}

window.electronAPI?.receive('computer:overlay:bounds', (bounds) => {
  setTargetBounds(bounds);
});

window.electronAPI?.receive('computer:overlay:state', (state) => {
  setGlow(state.glow !== false);
  setTopText(state.text || '');
  setTargetBounds(state.bounds);
});

setGlow(true);
```

- [ ] **Step 3: 添加 CSS 动画样式**

在 `renderer/styles.css` 末尾追加：

```css
/* ===== Computer Control Overlay ===== */
.computer-control-overlay {
  margin: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: transparent;
  pointer-events: none;
  user-select: none;
}
.computer-control-overlay-glow {
  position: fixed;
  inset: 0;
  box-shadow: inset 0 0 0 0 rgba(59, 130, 246, 0);
  animation: computer-control-glow-pulse 2.4s ease-in-out infinite;
  pointer-events: none;
}
@keyframes computer-control-glow-pulse {
  0%, 100% { box-shadow: inset 0 0 0 0 rgba(59, 130, 246, 0); }
  50% { box-shadow: inset 0 0 80px 20px rgba(59, 130, 246, 0.35); }
}
.computer-control-overlay-top-panel {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 18px;
  border-radius: var(--r-pill);
  background: color-mix(in srgb, var(--bg-elev) 88%, transparent);
  border: 1px solid var(--border);
  backdrop-filter: blur(14px) saturate(120%);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 8px 30px rgba(0,0,0,0.25);
  pointer-events: auto;
  z-index: 10000;
}
.overlay-pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #3b82f6;
  animation: overlay-dot-pulse 1.2s ease-in-out infinite;
}
@keyframes overlay-dot-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.4); }
}
.computer-control-overlay-target-border {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  border-radius: 10px;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.85);
  overflow: hidden;
}
.computer-control-overlay-target-border::before {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 14px;
  padding: 4px;
  background: conic-gradient(from 0deg, #3b82f6, #60a5fa, #93c5fd, #3b82f6);
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  animation: target-border-rotate 2s linear infinite;
}
@keyframes target-border-rotate {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 4: 在宿主中创建覆盖层并同步窗口边界**

修改 `lib/computer-control-host.js` 的 `startComputerControl`，在注册 Esc 后创建覆盖层：

```javascript
const overlay = computerControlHost.createOverlayWindow();
// 启动一个定时器跟踪目标窗口位置（后续 Task 4 用真实句柄替换）
controlState.trackingInterval = setInterval(() => {
  if (!isControlling) return;
  // 占位：后续从 bridge 获取目标窗口 bounds
  const bounds = { visible: false };
  if (controlState.overlayWindow && !controlState.overlayWindow.isDestroyed()) {
    controlState.overlayWindow.webContents.send('computer:overlay:state', {
      glow: true,
      text: 'Yan Agent 正在操控你的电脑，按 Esc 退出',
      bounds
    });
  }
}, 500);
```

在 `stopComputerControl` 中清理定时器：

```javascript
if (controlState.trackingInterval) {
  clearInterval(controlState.trackingInterval);
  controlState.trackingInterval = null;
}
```

- [ ] **Step 5: 在 `renderer/renderer.js` 中新增进入电脑操控入口**

```javascript
async function enterComputerControl({ targetHwnd, targetTitle }) {
  const { decision, useVisionRelay } = await requestAgentPermission({
    title: '进入电脑操控模式',
    description: `Agent 即将开始操控窗口：${targetTitle || '未命名窗口'}。你可以随时移动鼠标、操作其他软件，Agent 会自行找回该窗口继续工作。`,
    detail: `窗口句柄: ${targetHwnd || '自动选择'}`,
    allowAlways: false,
    visionRelay: {
      show: true,
      checked: true,
      description: 'Yan Agent 视觉中继完全免费。若当前模型支持多模态，可关闭以直接由主模型看图。'
    }
  }, { runId: 'computer-control' });

  if (decision !== 'once' && decision !== 'always') return { ok: false, reason: 'denied' };

  const result = await window.yan.computerStart({ targetHwnd, targetTitle, useVisionRelay });
  return { ok: result.ok, useVisionRelay };
}

window.enterComputerControl = enterComputerControl;
```

- [ ] **Step 6: 手动验证覆盖层**

运行 `npm run dev`，在 DevTools 执行：

```javascript
await enterComputerControl({ targetTitle: '记事本' });
```

Expected: 屏幕边缘出现蓝色光晕脉冲动画，顶部中心出现提示面板，按 Esc 后覆盖层消失。

- [ ] **Step 7: Commit**

```bash
git add renderer/computer-control-overlay.html renderer/computer-control-overlay.js renderer/styles.css renderer/renderer.js lib/computer-control-host.js
git commit -m "feat: computer control overlay with glow, top panel, and target border"
```

---

## Task 4: 不抢键鼠的键鼠方案与窗口找回

**目标：** Agent 操控时不锁定用户键鼠；当用户把目标软件覆盖下去后，Agent 能自动将其重新置前并继续工作。

**Files:**
- Create: `lib/computer-control-bridge.js`
- Modify: `lib/computer-control-host.js`
- Modify: `lib/mcp-computer-control-server.js`（Task 5 创建，本 Task 预留接口）

- [ ] **Step 1: 创建桥接层骨架**

`lib/computer-control-bridge.js`：

```javascript
'use strict';

const { spawn } = require('child_process');
const path = require('path');

let nuphusProcess = null;

function startNuphusMcp() {
  // 默认从项目 node_modules 或用户配置的 nuphus-mcp 路径启动
  const nuphusCommand = process.env.NUPHUS_MCP_COMMAND || 'npx';
  const nuphusArgs = process.env.NUPHUS_MCP_ARGS
    ? process.env.NUPHUS_MCP_ARGS.split(' ')
    : ['-y', 'github:mrpulor-gh/nuphus-mcp'];

  nuphusProcess = spawn(nuphusCommand, nuphusArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });

  nuphusProcess.stderr.on('data', (d) => console.error('[nuphus-mcp]', d.toString()));
  nuphusProcess.on('exit', (code) => {
    console.log('[nuphus-mcp] exited', code);
    nuphusProcess = null;
  });

  return nuphusProcess;
}

function stopNuphusMcp() {
  if (nuphusProcess) {
    try { nuphusProcess.kill(); } catch {}
    nuphusProcess = null;
  }
}

// 占位：调用 Windows API 或 nuphus-mcp 实现具体功能
async function findWindow(title) { return { hwnd: null, title }; }
async function setForeground(hwnd) { return { ok: false }; }
async function getWindowBounds(hwnd) { return { x: 0, y: 0, width: 0, height: 0, visible: false }; }
async function sendClick(hwnd, x, y) { return { ok: false }; }
async function sendType(hwnd, text) { return { ok: false }; }
async function sendKey(hwnd, key) { return { ok: false }; }
async function takeScreenshot(hwnd) { return { ok: false, image: null }; }

module.exports = {
  startNuphusMcp,
  stopNuphusMcp,
  findWindow,
  setForeground,
  getWindowBounds,
  sendClick,
  sendType,
  sendKey,
  takeScreenshot
};
```

- [ ] **Step 2: 在宿主中集成桥接层实现窗口找回**

修改 `lib/computer-control-host.js`：

```javascript
const bridge = require('./computer-control-bridge');

async function startComputerControl({ targetHwnd = null, targetTitle = '', useVisionRelay = false }) {
  if (isControlling) await stopComputerControl();

  let hwnd = targetHwnd;
  if (!hwnd && targetTitle) {
    const found = await bridge.findWindow(targetTitle);
    hwnd = found.hwnd;
  }

  isControlling = true;
  controlState = {
    targetHwnd: hwnd,
    targetTitle,
    useVisionRelay,
    startTime: Date.now(),
    overlayWindow: null,
    trackingInterval: null
  };

  bridge.startNuphusMcp();
  registerEscapeHotkey();
  createOverlayWindow();

  controlState.trackingInterval = setInterval(async () => {
    if (!isControlling || !controlState.targetHwnd) return;
    const bounds = await bridge.getWindowBounds(controlState.targetHwnd);
    if (controlState.overlayWindow && !controlState.overlayWindow.isDestroyed()) {
      controlState.overlayWindow.webContents.send('computer:overlay:state', {
        glow: true,
        text: 'Yan Agent 正在操控你的电脑，按 Esc 退出',
        bounds
      });
    }
  }, 500);

  sendToRenderer('computer:state-changed', { active: true, ...controlState });
  return { ok: true };
}

async function ensureTargetForeground() {
  if (!controlState.targetHwnd) return { ok: false };
  return bridge.setForeground(controlState.targetHwnd);
}

module.exports = {
  ...module.exports,
  ensureTargetForeground
};
```

- [ ] **Step 3: 在桥接层加入“执行前检查窗口是否在前台”的包装**

`lib/computer-control-bridge.js` 新增：

```javascript
let activeHwnd = null;

function setActiveHwnd(hwnd) { activeHwnd = hwnd; }

async function guardedExec(execFn) {
  if (!activeHwnd) return { ok: false, error: 'no active hwnd' };
  const foreground = await isForeground(activeHwnd);
  if (!foreground) {
    await setForeground(activeHwnd);
    await sleep(150);
  }
  return execFn();
}

async function isForeground(hwnd) {
  // 占位：调用 Windows API GetForegroundWindow 比较
  return true;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
```

- [ ] **Step 4: 手动验证窗口找回逻辑**

运行 `npm run dev` 并打开记事本：

```javascript
await window.yan.computerStart({ targetTitle: '无标题 - 记事本' });
// 手动把记事本最小化或覆盖
// 预期：定时器仍在跟踪，后续 sendClick 前会调用 setForeground 恢复记事本
```

- [ ] **Step 5: Commit**

```bash
git add lib/computer-control-bridge.js lib/computer-control-host.js
git commit -m "feat: non-blocking mouse/keyboard and window recovery"
```

---

## Task 5: 封装为 MCP 工具供主模型调用

**目标：** 让 Yan Agent 主模型通过 MCP 调用启动/停止电脑操控、执行键鼠操作、获取截图。

**Files:**
- Create: `lib/mcp-computer-control-server.js`
- Modify: `main.js`（在 MCP 服务器注册处添加该服务器）
- Modify: `preload.js`（若需要）

- [ ] **Step 1: 创建 MCP 服务器文件**

```javascript
'use strict';

const host = require('./computer-control-host');

const TOOLS = [
  {
    name: 'computer_start_control',
    description: '启动电脑操控模式，指定目标窗口标题或句柄，询问用户视觉中继开关。',
    inputSchema: {
      type: 'object',
      properties: {
        targetTitle: { type: 'string', description: '目标窗口标题' },
        targetHwnd: { type: 'string', description: '目标窗口句柄（可选）' }
      },
      required: ['targetTitle']
    }
  },
  {
    name: 'computer_stop_control',
    description: '停止电脑操控模式并清理覆盖层与热键。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'computer_click',
    description: '在目标窗口内点击指定坐标。',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'computer_type',
    description: '在目标窗口输入文本。',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
  },
  {
    name: 'computer_screenshot',
    description: '截取目标窗口或全屏并返回 base64 图片。',
    inputSchema: {
      type: 'object',
      properties: { fullScreen: { type: 'boolean' } }
    }
  }
];

async function handleToolCall(name, args) {
  const bridge = require('./computer-control-bridge');
  switch (name) {
    case 'computer_start_control': {
      // 通过渲染进程询问用户，主进程不能直接弹 UI；这里先返回需要前端确认的标记
      return {
        ok: false,
        needsUserConfirmation: true,
        confirmationType: 'vision-relay',
        targetTitle: args.targetTitle,
        targetHwnd: args.targetHwnd
      };
    }
    case 'computer_stop_control': {
      await host.stopComputerControl();
      return { ok: true };
    }
    case 'computer_click': {
      await host.ensureTargetForeground();
      return bridge.sendClick(host.getComputerControlStatus().targetHwnd, args.x, args.y);
    }
    case 'computer_type': {
      await host.ensureTargetForeground();
      return bridge.sendType(host.getComputerControlStatus().targetHwnd, args.text);
    }
    case 'computer_screenshot': {
      await host.ensureTargetForeground();
      return bridge.takeScreenshot(args.fullScreen ? null : host.getComputerControlStatus().targetHwnd);
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function startServer() {
  process.stdin.on('data', (chunk) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'yan-computer-control' } } }) + '\n');
        } else if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }) + '\n');
        } else if (msg.method === 'tools/call') {
          handleToolCall(msg.params.name, msg.params.arguments || {}).then((result) => {
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } }) + '\n');
          });
        }
      } catch (err) {
        console.error('[mcp-computer-control] parse error', err);
      }
    }
  });
}

module.exports = { startServer, TOOLS, handleToolCall };

if (require.main === module) startServer();
```

- [ ] **Step 2: 在 `main.js` 注册 MCP 服务器**

在 `main.js` 中已有 MCP 服务器管理逻辑处（如 `mcpStart` 附近），将 `yan-computer-control` 作为内置服务器加入：

```javascript
function getBuiltinMcpServers() {
  return [
    // ... 其他内置服务器
    {
      id: 'yan-computer-control',
      command: process.execPath,
      args: [path.join(__dirname, 'lib', 'mcp-computer-control-server.js')]
    }
  ];
}
```

- [ ] **Step 3: 处理 `needsUserConfirmation` 返回**

在 `renderer/renderer.js` 中，当收到 `computer_start_control` 工具的确认请求时，调用 `enterComputerControl`：

```javascript
window.yan.onComputerControlConfirmation = async (payload) => {
  return enterComputerControl({ targetHwnd: payload.targetHwnd, targetTitle: payload.targetTitle });
};
```

- [ ] **Step 4: Commit**

```bash
git add lib/mcp-computer-control-server.js main.js renderer/renderer.js
git commit -m "feat: expose computer control as MCP tools"
```

---

## Task 6: Yan Computer Use Skill 链路

**目标：** 新增内置 Skill `yan-computer-use`，让主模型通过 Skill 调用启动/停止电脑操控，与 MCP 链路共用同一套宿主逻辑。

**Files:**
- Create: `lib/skills/yan-computer-use/SKILL.md`
- Create: `lib/skills/yan-computer-use/yan-computer-use-runtime.js`
- Modify: `lib/skills/builtin.json`
- Modify: `lib/computer-control-host.js`（若 Skill 运行时需要额外 IPC 入口）

- [ ] **Step 1: 创建 Skill 定义文件**

`lib/skills/yan-computer-use/SKILL.md`：

```markdown
# Yan Computer Use

## 描述
让 Yan Agent 能够操控用户本地 Windows 电脑上的软件。不锁定用户键鼠；被操控窗口被覆盖时，Agent 会自动找回；用户可随时按 Esc 退出。

## 触发词
- 电脑操控
- Computer Use
- 控制我的电脑
- 帮我操作记事本/浏览器/...

## 用法
当用户要求操控某个软件时，调用 `start_computer_use({ targetTitle })`。若返回需要用户确认，则等待用户在高危命令面板中选择是否使用视觉中继。

## 可用动作
- `start_computer_use({ targetTitle, targetHwnd?, useVisionRelay? })`：启动电脑操控。
- `stop_computer_use()`：停止电脑操控。
- `computer_click({ x, y })`：在目标窗口内点击。
- `computer_type({ text })`：在目标窗口输入文本。
- `computer_screenshot()`：截取目标窗口截图。
```

- [ ] **Step 2: 创建 Skill 运行时脚本**

`lib/skills/yan-computer-use/yan-computer-use-runtime.js`：

```javascript
'use strict';

const path = require('path');

// 与 Yan Skills MCP 通信的 stdio JSON-RPC 协议
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan Computer Use error') } });
}

// 通过 IPC 与主进程通信：Skill 进程本身没有 Electron 主进程权限，需要委托给主进程
const { ipcRenderer } = require('electron');

async function handleTool(name, args) {
  switch (name) {
    case 'start_computer_use':
      return ipcRenderer.invoke('computer:start', args || {});
    case 'stop_computer_use':
      return ipcRenderer.invoke('computer:stop');
    case 'computer_click':
      return ipcRenderer.invoke('computer:click', args);
    case 'computer_type':
      return ipcRenderer.invoke('computer:type', args);
    case 'computer_screenshot':
      return ipcRenderer.invoke('computer:screenshot', args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

process.stdin.on('data', (chunk) => {
  const lines = chunk.toString().split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      if (msg.method === 'initialize') {
        success(msg.id, { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'yan-computer-use' } });
      } else if (msg.method === 'tools/list') {
        success(msg.id, { tools: [
          { name: 'start_computer_use', description: '启动电脑操控', inputSchema: { type: 'object', properties: { targetTitle: { type: 'string' }, targetHwnd: { type: 'string' }, useVisionRelay: { type: 'boolean' } } } },
          { name: 'stop_computer_use', description: '停止电脑操控', inputSchema: { type: 'object', properties: {} } },
          { name: 'computer_click', description: '点击目标窗口坐标', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } },
          { name: 'computer_type', description: '在目标窗口输入文本', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
          { name: 'computer_screenshot', description: '截取目标窗口截图', inputSchema: { type: 'object', properties: {} } }
        ]});
      } else if (msg.method === 'tools/call') {
        handleTool(msg.params.name, msg.params.arguments || {}).then(
          (result) => success(msg.id, { content: [{ type: 'text', text: JSON.stringify(result) }] }),
          (err) => failure(msg.id, -32603, err.message)
        );
      }
    } catch (err) {
      console.error('[yan-computer-use-runtime] parse error', err);
    }
  }
});
```

- [ ] **Step 3: 注册到 `lib/skills/builtin.json`**

在 `lib/skills/builtin.json` 的 `skills` 数组中新增一项：

```json
{
  "id": "yan-computer-use",
  "name": "Yan Computer Use",
  "desc": "让 Yan Agent 操控用户本地 Windows 电脑上的软件，不锁定键鼠，支持 Esc 退出。",
  "prompt": "用户使用 Yan Computer Use 时请调用 start_computer_use 启动电脑操控。启动前会通过高危命令面板询问是否使用视觉中继。操控期间不锁定用户键鼠；若目标窗口被覆盖，系统会自动找回。用户按 Esc 即可退出。",
  "tags": ["computer-use", "windows", "automation"],
  "triggers": ["电脑操控", "Computer Use", "控制我的电脑", "帮我操作"],
  "tier": "builtin",
  "version": 1,
  "updatedAt": 1785945600000
}
```

- [ ] **Step 4: 在 `lib/computer-control-host.js` 中补充 Skill 所需 IPC**

新增 IPC handler：

```javascript
ipcMain.handle('computer:click', async (_event, { x, y }) => {
  await ensureTargetForeground();
  const bridge = require('./computer-control-bridge');
  return bridge.sendClick(getComputerControlStatus().targetHwnd, x, y);
});
ipcMain.handle('computer:type', async (_event, { text }) => {
  await ensureTargetForeground();
  const bridge = require('./computer-control-bridge');
  return bridge.sendType(getComputerControlStatus().targetHwnd, text);
});
ipcMain.handle('computer:screenshot', async () => {
  await ensureTargetForeground();
  const bridge = require('./computer-control-bridge');
  return bridge.takeScreenshot(getComputerControlStatus().targetHwnd);
});
```

- [ ] **Step 5: Commit**

```bash
git add lib/skills/yan-computer-use/ lib/skills/builtin.json lib/computer-control-host.js
git commit -m "feat: add yan-computer-use skill runtime and registration"
```

---

## Task 7: 集成 nuphus-mcp 调研结论与适配

**目标：** 根据 nuphus-mcp 的实际能力，填充桥接层中的占位函数。

**Files:**
- Modify: `lib/computer-control-bridge.js`
- Modify: `lib/computer-control-host.js`（若 nuphus-mcp 的启动参数需要调整）
- Modify: `.env.example`（若需要新增 `NUPHUS_MCP_COMMAND` 配置）

- [ ] **Step 1: 安装或引用 nuphus-mcp**

若 nuphus-mcp 可 npm 安装：

```bash
npm install --save-dev nuphus-mcp
```

否则通过 `NUPHUS_MCP_COMMAND` 环境变量指向本地克隆目录的启动脚本。

- [ ] **Step 2: 阅读 nuphus-mcp 的 stdio 协议**

读取 `node_modules/nuphus-mcp` 或本地克隆的 README，列出其工具名、参数、返回结构，并映射到本计划的 `computer_*` 工具。

- [ ] **Step 3: 实现桥接函数**

根据 nuphus-mcp 的工具实现 `findWindow`、`setForeground`、`getWindowBounds`、`sendClick`、`sendType`、`sendKey`、`takeScreenshot`。

示例（假设 nuphus-mcp 提供 JSON-RPC stdio）：

```javascript
async function callNuphus(method, params) {
  return new Promise((resolve, reject) => {
    if (!nuphusProcess) return reject(new Error('nuphus-mcp not running'));
    const id = Date.now();
    const handler = (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            nuphusProcess.stdout.off('data', handler);
            resolve(msg.result || msg.error);
          }
        } catch {}
      }
    };
    nuphusProcess.stdout.on('data', handler);
    nuphusProcess.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      nuphusProcess.stdout.off('data', handler);
      reject(new Error('nuphus-mcp timeout'));
    }, 10000);
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/computer-control-bridge.js .env.example package*.json
git commit -m "feat: integrate nuphus-mcp bridge for Windows control"
```

---

## Task 8: 端到端联调与用户验收清单

**目标：** 完成代码后提供清晰的验收清单，由用户进行手动测试。本 Task 不编写自动化 E2E 测试（用户负责测试）。

**Files:**
- 无需新增或修改文件（如用户后续需要 E2E 测试，可再补充 `test/computer-control.e2e.cjs`）。

- [ ] **Step 1: 本地启动验证**

运行 `npm run dev`，确认应用正常启动且控制台无报错。

- [ ] **Step 2: 用户验收清单（由用户执行）**

1. 打开记事本。
2. 在 Yan Agent 聊天中让 Agent 操控记事本（可通过 MCP 工具 `computer_start_control` 或 Skill `yan-computer-use`）。
3. 验证出现视觉中继询问面板，且开关可用。
4. 进入电脑操控后，屏幕边缘出现蓝光脉冲，顶部中心出现提示面板“Yan Agent 正在操控你的电脑，按 Esc 退出”，记事本窗口四周出现蓝色跑马灯边框。
5. 把记事本最小化或被其他窗口覆盖，让 Agent 执行点击/输入，验证记事本被自动置前并继续工作。
6. 用户主动移动鼠标、敲击键盘，验证 Agent 未锁定用户键鼠。
7. 按 Esc，验证覆盖层消失、热键注销、模式停止。
8. 分别通过 MCP 链路和 Skill 链路各跑一次，验证双链路均可启动电脑操控。

- [ ] **Step 3: Commit 验收状态记录（可选）**

若用户反馈问题，可在本 Task 后追加修复 commit；若无问题，可直接标记 Task 完成。

```bash
# 用户验收通过后打 tag 或空提交标记
# git tag -a yan-computer-use-v1 -m "Yan Computer Use ready for user testing"
```

---

## 执行状态

| Task | 状态 | Commit |
|---|---|---|
| Task 1 视觉中继开关 UI | 已完成 | c2c1580 |
| Task 2 电脑操控宿主 + Esc 热键 | 已完成 | （文件已在早期提交中，具体 hash 需查 git log） |
| Task 3 前端渲染层 | 已完成 | 1f1782a |
| Task 4 桥接层 + 窗口找回 | 已完成 | 8240b12 |
| Task 5 MCP 协议层 | 已完成 | d391fe4 |
| Task 6 Yan Computer Use Skill 链路 | 已完成 | 306e85b |
| Task 7 nuphus-mcp 集成 | 已完成 | a5a46ea |
| Task 8 用户验收 | 待用户执行 | - |

---

## 自检清单

**1. Spec coverage:**
- `Esc` 退出热键：Task 2 完整覆盖。
- 视觉中继开关复用高危命令面板：Task 1 覆盖。
- 不锁用户键鼠、用户是主人、Agent 自行纠正：Task 4 覆盖（`guardedExec` + `setForeground` 找回）。
- 前端渲染层（蓝光、顶部面板、跑马灯边框）：Task 3 覆盖。
- MCP 协议层：Task 5 覆盖。
- Yan Computer Use Skill 链路：Task 6 覆盖。
- nuphus-mcp 集成：Task 7 覆盖。
- 用户验收：Task 8 覆盖。

**2. Placeholder scan:**
- 本计划中的“占位”函数集中在 `lib/computer-control-bridge.js`，因为 nuphus-mcp 具体协议需在 Task 7 调研后填充。所有占位均有明确后续任务。
- 无 TBD/TODO 等未完成的计划步骤描述。

**3. Type consistency：**
- `requestAgentPermission` 返回统一为 `{ decision, useVisionRelay }`。
- `computer:start` IPC 入参统一为 `{ targetHwnd, targetTitle, useVisionRelay }`。
- 覆盖层状态消息统一为 `{ glow, text, bounds }`。

---

## 执行方式建议

**Plan complete and saved to `docs/superpowers/plans/2026-08-12-computer-control-plan.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach would you like?**
