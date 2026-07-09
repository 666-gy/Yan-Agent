# Yan Agent

> **Yanxi Code 的桌面端 Agent 伴侣** — 让想法真正落地

[Yanxi Code](https://github.com/666-gy/Yanxi-Code) 帮你读懂代码，Yan Agent 帮你**动手实现**。在 Windows 桌面上自主读写文件、执行命令、操作浏览器、管理 Git — 从「有个想法」到「跑起来了」，全程由 Agent 完成。

---

## 📢 更新公告 · v1.0.0

**发布日期：2026-07-09**

Yan Agent 1.0.0 正式发布，这是 Yanxi Code 生态的首个桌面 Agent 伴侣版本。

### 本版本亮点

- **完整 Agent 内核** — 最多 40 轮工具循环，todo 计划、写后验证、失败重试
- **17 个内置工具** — 文件读写/编辑、Shell、Git 全套、内置浏览器预览
- **MCP 扩展** — 预装 Playwright、Windows-MCP，支持自定义 MCP 服务
- **Skill 市场** — 51 个精选 Skill（代码 / UI / 网站），一键注入对话
- **定时自动化** — 后台并行运行（最多 3 个），不抢占当前会话
- **会话持久化** — 工具调用时间线 + apiTrace 跨轮回放
- **上下文压缩 & 长期记忆** — 长对话不丢工具链，跨会话记住关键事实
- **现代化 UI** — 暗/亮主题、四页侧边栏（任务 / Skill / MCP / 自动化）、系统托盘保活

### 下载

| 版本      | 说明              | 下载                                                                                                                        |
| ------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **安装版** | NSIS 安装包，推荐日常使用 | [Yan.Agent.Setup.1.0.0.exe](https://github.com/666-gy/Yan-Agent/releases/latest/download/Yan.Agent.Setup.1.0.0.exe)       |
| **便携版** | 免安装，双击即用        | [Yan.Agent.Portable.1.0.0.exe](https://github.com/666-gy/Yan-Agent/releases/latest/download/Yan.Agent.Portable.1.0.0.exe) |

[查看全部 Releases →](https://github.com/666-gy/Yan-Agent/releases)

### 快速开始

1. 下载并运行 Yan Agent
2. **设置 → API 配置** — 填入 [DeepSeek API Key](https://platform.deepseek.com/api_keys)
3. **工作区** — 选择你的项目文件夹
4. 输入指令，Agent 开始自主执行

---

## 与 Yanxi Code 的关系

|        | Yanxi Code                                                | Yan Agent                                               |
| ------ | --------------------------------------------------------- | ------------------------------------------------------- |
| **定位** | 代码编辑器                                                     | 桌面 Agent 伴侣                                             |
| **核心** | 边写边译，读懂每一行                                                | 动手执行，交付结果                                               |
| **仓库** | [666-gy/Yanxi-Code](https://github.com/666-gy/Yanxi-Code) | [666-gy/Yan-Agent](https://github.com/666-gy/Yan-Agent) |

---

## 核心能力

**Agent 循环** — 接收指令 → 制定计划 → 逐步执行 → 验证结果 → 交付

**内置工具** — `read_file` · `write_file` · `edit_file` · `apply_patch` · `list_directory` · `search_files` · `execute_shell` · `todo_write` · `open_builtin_browser` · `git_status` · `git_diff` · `git_log` · `git_commit` · `git_push` · `git_pull` · `git_clone` · `git_branch`

**MCP** — Playwright 浏览器自动化、Windows 桌面操控，可接入任意 MCP Server

**自动化** — 间隔 / 每日 / 一次性调度，后台 `[自动]` 会话独立运行

**Skill 市场** — 代码审查、TDD、重构、安全审计、UI 设计、网站搭建等 51 个模板

---

## 开发

```bash
git clone https://github.com/666-gy/Yan-Agent.git
cd Yan-Agent
npm install
npm start        # 开发运行
npm run build    # 打包安装版
npm run build:portable  # 打包便携版
```

### 权限（设置 → 权限）

| 权限   | 默认  | 说明             |
| ---- | --- | -------------- |
| 读取文件 | ✅   | 读取工作区与附件       |
| 写入文件 | ✅   | 创建或修改文件        |
| 执行命令 | ❌   | Shell 命令（谨慎开启） |
| 网络访问 | ✅   | 调用 AI API      |

> ⚠️ Agent 具备真实文件系统访问能力，请在可信工作区中使用。

---

## 技术栈

Electron 31 · DeepSeek V4 (Flash / Pro) · MCP · electron-builder

---

## License

MIT
