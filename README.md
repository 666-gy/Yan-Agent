# Yan Agent

> **桌面端自主 Agent** — 从「有个想法」到「跑起来了」，全程由 Agent 完成

在 Windows 桌面上自主读写文件、执行命令、操作浏览器、管理 Git。Yan Agent 不是聊天助手，而是一个能真正动手干活的 Agent。

---

## v1.1.0 — 内核重构

本次更新对 Agent 内核进行了全面拆分与重构，核心变化：

### 5 任务完全独立并行

旧架构（1 前台 + 3 后台，共享全局状态）已彻底重写为 **5 个平等并行任务**模型：

| 特性     | 旧架构                 | 新架构                         |
| ------ | ------------------- | --------------------------- |
| 并发上限   | 1 前台 + 3 后台         | **5 个任务完全平等**               |
| 状态隔离   | 全局 `agentState` 共享  | **每个 runCtx 独立 agentState** |
| 中止控制   | 全局 `shouldAbort` 串扰 | **每个任务独立 AbortController**  |
| 会话切换   | detach 前台→后台（竞态）    | **pauseUi 仅停 DOM，任务继续**     |
| MCP 工具 | 全局 map 并发覆盖         | **runCtx 级别快照**             |
| 侧边栏    | 无运行状态指示             | **实时转圈 + 标题高亮**             |

任务 A 运行中切换到任务 B 发起新任务，两者互不影响，各自独立完成。

### 内核模块化拆分

单文件内核拆分为 15 个独立模块，位于 `renderer/kernel/`：

```
renderer/kernel/
├── index.js            # 内核引导 & 依赖注入
├── constants.js        # 迭代上限、上下文阈值
├── tool-protocol.js    # 统一工具返回协议 { ok, output, error, meta }
├── path.js             # 工作区路径解析
├── edits.js            # 精确编辑引擎 + 写后验证
├── tools-registry.js   # 18 个内置工具 + MCP 动态注册
├── prompt.js           # 系统提示词构建
├── context.js          # 上下文压缩 + 长期记忆提取
├── policies.js         # 运行时策略（读后编辑、完成门控）
├── run-state.js        # 每个 runCtx 的独立状态管理
├── tool-executor.js    # 工具执行器
├── tool-retry.js       # 自动重试（最多 4 次，指数退避）
├── subagent.js         # 子 Agent（explore / shell 专家）
├── stream.js           # SSE 流式 API 调用
└── agent-loop.js       # 核心循环：计划 → 执行 → 验证
```

### 新增：子 Agent 系统

主 Agent 可通过 `spawn_subagent` 工具委派子任务：

- **explore** — 只读调研（读文件、搜代码、查 Git），返回结构化摘要
- **shell** — 专注跑命令，报告退出码和输出

子 Agent 拥有独立 runCtx，最多 12 轮迭代，不能嵌套。

### 新增：运行时策略引擎

不再依赖提示词「请求」模型遵守规则，而是**强制执行**：

- **读后编辑** — `edit_file` / `apply_patch` 前必须先 `read_file`，否则直接拒绝
- **完成门控** — 有 `in_progress` 的 todo 时，Agent 不能提前结束循环
- **非必要 todo 延迟** — 非关键 pending 项自动延迟到下次会话

### 新增：工具自动重试

工具失败时自动重试（最多 4 次，250ms 指数退避），策略/权限错误不重试。

---

## 核心能力

### Agent 循环

```
用户指令 → 制定计划(todo_write) → 逐步执行(工具调用) → 验证结果(写后回读) → 交付
```

- 最多 **40 轮** 工具循环
- 每轮支持多工具并行调用
- 三处中止检查点（API 调用前、工具执行前、循环体内）

### 18 个内置工具

| 工具                                     | 说明                            |
| -------------------------------------- | ----------------------------- |
| `todo_write`                           | 任务计划清单（实时展示，单 in_progress 约束） |
| `read_file`                            | 读取文件（二进制检测、编辑前必须先读）           |
| `edit_file`                            | 精确单点编辑（old_string 必须唯一匹配）     |
| `apply_patch`                          | 多段精确替换（按顺序应用，写后回读验证）          |
| `write_file`                           | 写入文件（写后回读验证）                  |
| `list_directory`                       | 目录浏览                          |
| `search_files`                         | 文本搜索（扩展名过滤）                   |
| `execute_shell`                        | Shell 执行（30s 超时、权限控制）         |
| `spawn_subagent`                       | 委派子 Agent（explore / shell）    |
| `git_status` / `git_diff` / `git_log`  | Git 查看                        |
| `git_commit` / `git_push` / `git_pull` | Git 操作                        |
| `git_clone` / `git_branch`             | Git 仓库管理                      |
| `open_builtin_browser`                 | 内置浏览器预览                       |

### 精确编辑引擎

- `old_string` 必须与文件内容**逐字符完全一致**（含缩进/换行）
- 必须在文件中**唯一匹配**，否则拒绝执行
- 写入后**立即回读校验**，确保文件系统操作正确性
- 自动记录变更前内容，支持变更溯源

### MCP 扩展

支持 JSON-RPC 2.0 over stdio 协议接入任意 MCP Server：

- **Playwright** — 浏览器自动化（点击、填表、E2E）
- **Windows-MCP** — Windows 桌面操控
- **Filesystem** — 文件系统访问
- 自定义 MCP Server 即插即用

工具命名格式：`mcp__{serverId}__{toolName}`，每个 runCtx 持有独立快照防止并发竞态。

### Skill 市场

51 个精选 Skill 模板，一键注入对话：

- **代码** — 代码审查、TDD、重构、安全审计
- **UI** — 设计系统、组件库、主题工厂
- **网站** — 落地页、全栈应用、部署

### 上下文管理

- **上下文压缩** — 超过 60K tokens 自动压缩早期消息为摘要，保留最近 12 条 + 工具调用链
- **长期记忆** — 任务完成后自动提取跨会话有用事实（用户偏好、项目约定）
- **apiTrace 回放** — 工具调用时间线 + 完整 API 消息历史跨轮回放

### 自动化任务

- 间隔 / 每日 / 一次性调度
- 后台创建独立 `[自动]` 会话
- 与手动任务共享 5 并发上限

---

## 快速开始

1. 下载并运行 Yan Agent
2. **设置 → API 配置** — 填入 [DeepSeek API Key](https://platform.deepseek.com/api_keys)
3. **工作区** — 选择你的项目文件夹
4. 输入指令，Agent 开始自主执行

### 下载

| 版本      | 说明              | 下载                                                                                                                        |
| ------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **安装版** | NSIS 安装包，推荐日常使用 | [Yan.Agent.Setup.1.1.0.exe](https://github.com/666-gy/Yan-Agent/releases/latest/download/Yan.Agent.Setup.1.1.0.exe)       |
| **便携版** | 免安装，双击即用        | [Yan.Agent.Portable.1.1.0.exe](https://github.com/666-gy/Yan-Agent/releases/latest/download/Yan.Agent.Portable.1.1.0.exe) |

[查看全部 Releases →](https://github.com/666-gy/Yan-Agent/releases)

---

## 架构

```
┌─────────────────────────────────────────────────┐
│                  Electron 主进程                  │
│  文件系统 · Shell · Git · MCP Server · 系统托盘     │
└──────────────────────┬──────────────────────────┘
                       │ IPC (preload.js)
┌──────────────────────┴──────────────────────────┐
│                   渲染进程                        │
│  ┌─────────────────────────────────────────────┐ │
│  │            renderer/kernel/                  │ │
│  │  agent-loop · tool-executor · subagent       │ │
│  │  edits · policies · context · stream         │ │
│  │  tools-registry · prompt · run-state         │ │
│  └──────────────────┬──────────────────────────┘ │
│  ┌──────────────────┴──────────────────────────┐ │
│  │            renderer.js (UI 层)               │ │
│  │  5 并发任务管理 · 会话切换 · DOM 渲染          │ │
│  └─────────────────────────────────────────────┘ │
│         skill-market.js · styles.css              │
└──────────────────────────────────────────────────┘
```

### 并发模型

```
activeRuns: Map<sessionId, { runCtx, sessionRef, assistantEl }>
                        │
           ┌────────────┼────────────┐
           ▼            ▼            ▼
      任务 A         任务 B         任务 C
   (独立 runCtx)  (独立 runCtx)  (独立 runCtx)
   独立 agentState  独立 agentState  独立 agentState
   独立 abortCtrl   独立 abortCtrl   独立 abortCtrl
   独立 MCP快照     独立 MCP快照     独立 MCP快照
```

每个任务拥有完全隔离的 `runCtx`，包括 agentState、abortController、MCP 工具映射快照、策略状态。切换会话仅暂停 DOM 渲染（`pauseUi`），任务继续后台运行。

### 内核依赖注入

内核通过 `YanKernel.init(deps)` 接收渲染层注入的 API 和 hooks，实现内核与 UI 的解耦：

```javascript
YanKernel.init({
  api,                    // IPC 桥接
  getConfig,              // 配置访问
  getCurrentSession,      // 当前会话
  hooks: {                // UI 回调
    renderTodos, updateContextInfo, buildToolStepElement, ...
  }
});
```

---

## 开发

```bash
git clone https://github.com/666-gy/Yan-Agent.git
cd Yan-Agent
npm install
npm start              # 开发运行
npm run build          # 打包安装版 (NSIS)
npm run build:portable # 打包便携版
```

### 权限

| 权限   | 默认  | 说明              |
| ---- | --- | --------------- |
| 读取文件 | ✅   | 读取工作区与附件        |
| 写入文件 | ✅   | 创建或修改文件         |
| 执行命令 | ❌   | Shell 命令（需手动开启） |
| 网络访问 | ✅   | 调用 AI API       |

> ⚠️ Agent 具备真实文件系统访问能力，请在可信工作区中使用。

### 项目结构

```
Yan-Agent/
├── main.js                 # Electron 主进程
├── preload.js              # IPC 安全桥接
├── renderer/
│   ├── index.html          # 应用 UI
│   ├── renderer.js         # 渲染层（并发管理、UI、会话）
│   ├── skill-market.js     # Skill 市场
│   ├── styles.css          # 样式
│   ├── kernel/             # Agent 内核（15 个模块）
│   └── assets/             # 图标资源
└── package.json
```

---

## 技术栈

Electron 31 · DeepSeek V4 (Flash / Pro) · MCP (JSON-RPC 2.0) · electron-builder

---

## License

MIT
