<div align="center">
  <img src="docs/assets/yagent-logo.svg" width="88" height="88" alt="YAgent Y 字形 Logo">
  <h1>YAgent</h1>
  <p><strong>让想法，真正运行起来。</strong></p>
  <p>面向真实工作区的开源桌面 Agent<br><sub>Built by ViaTum Lab</sub></p>
  <p>
    <a href="https://github.com/ViaTumLab/YAgent/releases"><img src="https://img.shields.io/badge/Download-2563EB?style=for-the-badge" height="28" alt="下载安装"></a>
    <a href="https://viatumlab.com/yagent/"><img src="https://img.shields.io/badge/Docs-334155?style=for-the-badge" height="28" alt="技术文档"></a>
    <a href="https://github.com/ViaTumLab/YAgent"><img src="https://img.shields.io/badge/GitHub-334155?style=for-the-badge" height="28" alt="GitHub 源码"></a>
  </p>
  <p>
    <img src="docs/assets/badge-version.svg" height="22" alt="版本 v1.6.1">
    <img src="docs/assets/badge-windows.svg" height="22" alt="支持 Windows x64">
    <img src="docs/assets/badge-macos.svg" height="22" alt="支持 macOS Apple Silicon">
    <a href="LICENSE"><img src="docs/assets/badge-license.svg" height="22" alt="MIT License"></a>
  </p>
</div>

## 你的桌面 Agent 工作区

YAgent（Yan-Agent）是 ViaTum Lab 孵化出的一个开源客户端。连接你选择的模型，在同一个工作区内探索项目、实现功能、运行测试，并审阅最终的文件变化。

从本地代码到浏览器，从单个任务到多 Agent 协作，让执行过程与交付结果都清晰可见。

<a id="start"></a>
## 快速开始

当前支持 **Windows x64** 与 **macOS Apple Silicon（arm64）**。安装包可从 [Releases](https://github.com/ViaTumLab/YAgent/releases) 下载；本文对应源码版本 `1.6.1`，可下载资产以发布页为准。

macOS 安装包名称为 `YAgent-arm64-v1.6.1.dmg`。当前构建尚未进行 Apple 代码签名与公证，首次打开时 macOS 可能显示安全提示；请仅从本仓库 Releases 下载，并在确认来源后通过“系统设置 → 隐私与安全性”允许打开。Intel Mac 安装包尚未配置。

1. **连接模型**：在 API 配置中填写 Base URL 和 API Key，选择服务实际支持的协议、适配预设与模型，测试连接。
2. **打开工作区**：选择一个本地项目；不涉及项目文件的问答和网页阅读可以从 Blank 任务开始。
3. **发起任务**：选择工作模式与访问权限，描述你希望完成的事情。
4. **查看交付**：跟踪工具调用与子代理进度，在审阅面板检查文件差异和验证结果。

可以从这条请求开始：

> 先梳理这个项目的入口、主要模块和测试方式，再给我一份带源码依据的说明。

YAgent 可独立连接兼容的模型服务。协议、模型能力与额度以你实际连接的服务为准。

<a id="features"></a>
## 从任务到交付

| 能力 | 你可以怎样使用 |
| --- | --- |
| **理解真实项目** | 通过仓库地图、代码大纲、符号检索与调用关系，定位需要阅读和修改的代码。 |
| **执行与工具** | 读取和编辑文件、执行命令、运行测试，通过工具结果推进任务。 |
| **多 Agent 协作** | 将探索、实现、研究、测试与审查交给不同角色，跟踪依赖、进度和交付。 |
| **长任务与上下文** | 保存任务状态、执行日志与快照，管理上下文预算，为中断后的恢复提供依据。 |
| **变更审阅** | 在工作区内查看文件差异，结合 Git 与任务级 worktree 组织和审阅修改。 |
| **浏览器与网页注释** | 阅读网页、操作内置浏览器，并把页面上的反馈转化为具体任务。 |
| **Skills 与 MCP** | 接入领域知识、执行规范和外部工具，扩展到不同工作流。 |
| **多模型适配** | 支持 Chat Completions、Messages、Responses 兼容链，以及 DeepSeek、GLM、GPT、Qwen、Kimi 专用适配。 |

客户端基于 **Electron + OpenCode** 构建，Yan Core 管理任务状态与持久化。桌面中还提供云顶天宫 Work GUI，将任务和协作状态呈现在可交互场景中。

<details>
<summary>工作模式：常规、计划、目标与自进化</summary>

| 模式 | 适用方式 |
| --- | --- |
| 常规 | 日常问答、代码修改与工具执行。 |
| 计划 | 先做只读调查，整理方案和实施步骤。 |
| 目标（Goal） | 围绕明确目标持续推进，在适用条件下进行有界验收与修复。 |
| 自进化 | 使用相关经验，记录有执行证据支持的规则与策略改进。 |
| AGI（实验性） | 探索轨迹学习、经验整理、协作拓扑与评估等研究能力。 |

</details>

更多实现细节见 [YAgent 技术文档](https://viatumlab.com/yagent/)，包括权限边界、模型协议、任务恢复与故障排查。

<a id="viaharness"></a>
## 与 ViaHarness 配合

<p align="center">
  <img src="docs/assets/viaharness-logo.png" width="420" alt="ViaHarness 独立产品 Logo">
</p>

ViaHarness 正在开发中，YAgent 现在即可独立使用。

模型负责推理，YAgent 负责本地执行与结果审阅。ViaHarness 计划在两者之间，根据任务、执行阶段与预算，选择合适的模型和 Skill 策略。它将任务编排、上下文、记忆、评测与权限控制沉淀为统一底座，再面向金融、医疗、教育、科研、政务等场景定制领域知识、专业工具和规则，让经过验证的 Harness 能力跨场景复用，并以接近零成本的方式迁移到新场景。

未来搭配使用，发挥 MAX 效果。后续会发布相应配置与使用说明。

<a id="development"></a>
## 参与开发

### 从源码运行

当前构建目标为 **Windows x64** 与 **macOS Apple Silicon（arm64）**。准备 Git、Node.js 与 npm；CI 使用 Node.js 22。

```bash
git clone https://github.com/ViaTumLab/YAgent.git
cd YAgent
npm ci
npm start
```

开发模式使用 `npm run dev`。Serena、GitHub CLI 等外部工具按所需功能另行配置。

### 测试与构建

```bash
npm test                  # 单元与模块测试
npm run build             # Windows 安装包
npm run build:portable    # Windows 便携包
npm run build:mac         # macOS Apple Silicon DMG（需在 macOS 上运行）
```

产物位于 `dist/`。macOS 输出为 `YAgent-arm64-v1.6.1.dmg`（版本号以 `package.json` 为准），当前未签名、未公证，Intel Mac 安装包尚未配置。Windows 构建包含运行时资源准备和打包校验；Electron E2E 与真实 API 测试需单独运行。修改模型适配器等源码后，需更新对应 bundle，详见 [YAgent 技术文档](https://viatumlab.com/yagent/#development)。

<details>
<summary>代码导航与贡献说明</summary>

| 路径 | 内容 |
| --- | --- |
| [lib/yan-core/](lib/yan-core/) | 任务状态、事件与持久化 |
| [lib/opencode-sidecar.js](lib/opencode-sidecar.js) | 模型回合、工具与子代理执行 |
| [lib/analysis/](lib/analysis/) | 项目结构、符号与代码分析 |
| [lib/subagent/](lib/subagent/) | 子代理角色、依赖与调度 |
| [lib/agi/](lib/agi/) | 自进化相关实验模块 |
| [renderer/](renderer/) | 桌面界面、浏览器与审阅交互 |
| [test/](test/) | 模块测试、交互测试与运行时验证 |

欢迎通过 [Issues](https://github.com/ViaTumLab/YAgent/issues) 反馈问题，或提交 Pull Request 改进模型适配、工具连接、交互、文档与评测。问题报告请附版本、系统、连接类型、复现步骤和脱敏日志；功能修改请说明使用场景及实际验证结果。

</details>

任务、配置与运行记录主要保存在本地应用数据目录，工作区 `.yanagent` 还可能包含快照和未合并的 worktree。模型请求会发送到你配置的服务，MCP 等工具也可能访问外部系统。数据位置与权限说明见 [YAgent 技术文档](https://viatumlab.com/yagent/#data)。

## 关于 ViaTum Lab

[ViaTum Lab](https://viatumlab.com) 是一家构建 Harness 中间层的前沿实验室，致力于构建跨场景智能基础设施。YAgent 是我们孵化出的一个开源客户端。

创始团队来自北京大学与清华大学，汇聚多名顶尖基础模型团队成员，团队孵化于国家重点实验室。

## 许可证与致谢

YAgent 主项目采用 [MIT License](LICENSE)。感谢 OpenCode、Electron，以及模型 SDK、Serena、CodeGraph、Tree-sitter 等开源项目提供的基础能力。

第三方代码、技能、字体与素材遵循各自许可证，详见[第三方说明](lib/THIRD_PARTY_NOTICES.md)。
