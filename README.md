# Yan Agent

[中文](README.md) · [English](README.en.md)

**开源 AI 智能体，让模型在真实工作区中完成任务。**

Yan Agent 是 Windows 桌面应用。连接你选择的模型服务，理解项目、修改代码、操作浏览器与桌面应用，并在同一处跟踪进度、引导任务和审阅结果。

## 下载与开始使用

当前版本：**v1.7.0 · Windows x64**。

- [Windows 安装包](https://github.com/ViaTumLab/Yan-Agent/releases/download/v1.7.0/Yan.Agent.Setup.v1.7.0.exe)
- [百度网盘](https://pan.baidu.com/s/1KZIFg29V7Ks89pvEWiY4mw?pwd=code)，提取码：`code`
- [全部发布版本](https://github.com/ViaTumLab/Yan-Agent/releases)

1. 安装并启动应用，在模型服务配置中填写服务地址、API Key 和对应协议。
2. 刷新模型列表，启用模型，并选择任务使用的主模型。
3. 选择工作区，描述目标、约束和验收要求，可附加文件、图片或应用快照。
4. 跟踪执行进度，追加引导并处理权限请求；完成后审阅文件差异和测试结果。

## 主要功能

| 能力 | 用途 |
| --- | --- |
| 工程任务 | 理解项目、定位错误、修改代码、开发功能，并使用工具执行测试与验收。 |
| 子代理 | 并行委派任务、配置子代理模型、跟踪进度与审阅结果。 |
| 外部智能体 | 对接 Codex、Claude 和 Reasonix Studio，派发任务并读取协作结果。 |
| 工作区与 Git | 管理项目、分支和 worktree，查看差异、处理代码审阅与 PR 任务。 |
| 内置浏览器 | 浏览、登录、下载、网页批注、导出 PDF，以及宽屏与窄屏验收。 |
| 电脑操控 | 操作 Windows 应用、管理允许名单与使用经验，下载经验为 Markdown 文件以分享。 |
| 应用快照 | 捕获外部应用窗口，将图片及应用上下文加入聊天。 |
| 插件、技能与 MCP | 安装扩展、连接账号、导入技能和接入工具，支持 Playwright 浏览器自动化等插件。 |
| 多模态 | 配置文本、图像和视频服务，查看与标注图片，使用语音输入和朗读。 |
| 局域网 WebUI | 同一局域网内通过手机或另一设备管理、续跑桌面任务。 |
| 聊天与个性化 | 管理归档、引用与导出，设置记忆、字体、壁纸、提示音和权限偏好。 |

## 模型与服务

项目包含 OpenAI、Anthropic、Gemini、DeepSeek、Qwen、GLM、Kimi 等适配路径，支持为不同任务选择模型。实际模型、工具调用与多模态能力以所配置服务为准，模型服务费用由供应商收取。

插件和外部智能体可能需要额外安装、账号或凭据。连接成功不代表全部工具和媒体接口均可用。局域网 WebUI 需要运行 Yan Agent 的电脑保持在线。

## 从源码运行

使用 Windows x64、Node.js 和 npm：

```powershell
git clone https://github.com/ViaTumLab/Yan-Agent.git
cd Yan-Agent
npm ci
npm start
```

开发模式：`npm run dev`。桌面桥接、电脑操控与 Playwright 运行时可通过 `npm run build:desktop-bridge`、`npm run build:cua-driver`、`npm run build:playwright` 准备；构建脚本可能联网下载组件。

## 测试与构建

```powershell
npm test
npm run build
```

`npm run build` 生成 Windows 安装包并执行打包运行时检查；`npm run build:release` 还生成便携包，产物位于 `dist/`。构建需要 Windows 和相应系统工具。`test/` 中的端到端测试可能需要桌面应用、账号或模型服务。

## 数据与权限

聊天、配置、工作区状态和使用经验保存在本机。调用模型与第三方工具时，任务所需内容会发送给对应服务。通过权限提示和允许名单管理工具访问；分享聊天、截图或经验文件前请检查隐私信息。WebUI 用于局域网访问，不要直接将端口暴露到公网。

## 反馈与贡献

通过 [Issues](https://github.com/ViaTumLab/Yan-Agent/issues) 提交问题，附上版本、复现步骤、预期与实际结果，以及脱敏日志或截图。欢迎提交 Pull Request；请运行相关检查并说明验证结果，不提交凭据、个人数据或构建缓存。

## 许可

使用 [MIT License](LICENSE)。第三方组件与插件遵循各自许可，见 [第三方致谢](lib/THIRD_PARTY_NOTICES.md) 和 [技能致谢](lib/skills/THIRD_PARTY_NOTICES.md)。
