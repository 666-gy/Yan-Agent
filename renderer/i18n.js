/* Yan Agent UI localization. The source language remains Chinese so existing
 * sessions and user-authored content are never rewritten in storage. */
(function installYanI18n(global) {
  const ZH_EN = Object.freeze({
    '主界面': 'Main', '新建任务': 'New task', 'Skill 市场': 'Skill market', 'MCP 服务': 'MCP services',
    '设置': 'Settings', '宠物': 'Pet', '用户': 'User', '新对话': 'New conversation', '关于Yan Agent v1.6.0': 'About Yan Agent v1.6.0',
    '选择文件夹': 'Choose folder', '分支': 'Branch', '搜索分支': 'Search branches',
    '创建并检出新分支…': 'Create and checkout branch…', 'Git 图谱': 'Git graph', '置顶任务': 'Pin task',
    '重命名任务': 'Rename task', 'Git 工具': 'Git tools', 'Git 不可用': 'Git unavailable',
    '请先选择 Git 工作区': 'Select a Git workspace first', '更改': 'Changes', '提交或推送': 'Commit or push',
    '打开并同步当前工作区': 'Open and sync current workspace',
    '终端': 'Terminal', '打开电脑上的终端': 'Open the system terminal', '资源管理器': 'Explorer',
    '在文件夹中查看工作区': 'Show workspace in folder', '最近一条': 'Latest', '随时待命': 'Standing by',
    '权限确认': 'Permission required', '使用视觉中继': 'Use vision relay',
    '开启后 Yan Agent 会调用免费视觉中继模型辅助定位按钮与理解界面。': 'When enabled, Yan Agent can use free vision-relay models to locate controls and understand the interface.',
    '总是允许': 'Always allow', '本次允许': 'Allow once', '拒绝': 'Deny', '待办': 'Todo',
    '编辑了文件': 'Edited files', '已编辑文件': 'Edited files', '查看已编辑文件': 'View edited files',
    '当前文件暂时无法打开审阅': 'This file cannot be opened in Review yet',
    '请求批准': 'Approval requested', '权限访问': 'Permission access',
    '替我审批': 'Approve for me',
    '完全访问': 'Full access', '操作将不再逐一询问': 'Actions will run without asking each time',
    '添加': 'Add', '文件': 'File', '文件夹': 'Folder', '优化prompt': 'Optimize prompt', '优化当前输入': 'Optimize current input',
    '添加附件': 'Add attachment', '优化你的prompt': 'Optimize your prompt', '使用/选择技能或工作方式': 'Use/select a Skill or work mode', '工作方式': 'Work mode',
    '目标': 'Goal', '设置要持续追求的目标': 'Set the outcome to pursue', '设置要追求的目标': 'Set the goal to pursue', '计划': 'Plan', '计划模式': 'Plan mode', '开启计划模式': 'Enable plan mode', '使用/选择工作方式': 'Use/select a work mode', '使用$选择技能': 'Use $ to select a skill',
    '技能': 'Skills', '查找、安装并管理 Agent 可调用的能力。': 'Find, install, and manage capabilities available to the Agent.',
    '全部': 'All', '个人': 'Personal', '添加自定义 Skill': 'Add custom Skill',
    '打开资源管理器': 'Open Explorer', '尚未选择文件': 'No file selected', '服务注册表': 'Service registry',
    '测试连接、启停服务并查看启动命令。': 'Test connections, start or stop services, and inspect launch commands.',
    '服务与命令': 'Services and commands', '操作': 'Actions', '添加服务器': 'Add server',
    '名称': 'Name', '启动命令': 'Launch command', '命令参数': 'Command arguments', '返回': 'Back', '下一页': 'Next',
    '媒体生成': 'Media generation', '就绪': 'Ready', '模型与 API': 'Models and API', '图片': 'Image', '视频': 'Video',
    '提示词': 'Prompt', '比例': 'Aspect ratio', '时长': 'Duration', '3 秒': '3 sec', '5 秒': '5 sec',
    '10 秒': '10 sec', '18 秒': '18 sec', '分辨率': 'Resolution', '更多设置': 'More settings',
    '反向提示词': 'Negative prompt', '随机种子': 'Random seed', '添加参考图': 'Add reference image',
    '生成图片': 'Generate image', '等待生成': 'Waiting to generate', '正在生成图片': 'Generating image',
    '生成失败': 'Generation failed', '浏览器': 'Browser', '审阅': 'Review', '辅助对话': 'Auxiliary chat', '临时对话': 'Temporary chat',
    '侧边面板': 'Side panel', '改动审阅': 'Review changes', '当前任务': 'Current task',
    '暂无可审阅的改动': 'No reviewable changes', 'Agent 修改文件后会显示在这里': 'Changes made by the Agent will appear here',
    'Yan Agent工作期间，提问以辅助工作': 'Ask questions while Yan Agent is working', 'Yan Agent正在操控Browser': 'Yan Agent is controlling Browser',
    '缩放': 'Zoom', '自动': 'Auto', '清除缓存': 'Clear cache', '清除 Cookie': 'Clear cookies', '输入URL以浏览': 'Enter a URL to browse',
    'Git 操作': 'Git operations', '取消': 'Cancel', '确认': 'Confirm', '提交信息': 'Commit message',
    '包含未暂存的更改': 'Include unstaged changes', '提交': 'Commit', '提交并推送': 'Commit and push', '推送': 'Push',
    '图': 'Graph', '描述': 'Description', '日期': 'Date', '作者': 'Author', '空闲': 'Idle',
    '关于': 'About', '关于Yan Agent': 'About Yan Agent', '版本信息与本次更新': 'Version and release notes', '版本信息与更新文档': 'Version information and release notes', '常规': 'General', '视觉中继': 'Vision relay',
    '可能的错误': 'Possible errors', '右侧“常见报错”涵盖已发现的内核报错，工作出错时可查询检查': 'The Common errors guide covers discovered kernel errors. Check it when work fails.', '常见报错': 'Common errors', '关于Yan Agent v1.5.0': 'About Yan Agent v1.5.0', '更新文档': 'Release notes', '检查更新': 'Check for updates', '检查当前版本并更新': 'Check current version and update', 'Yan Agent的': 'Yan Agent', '抖音群': 'Douyin group', 'QQ群': 'QQ group', '邮箱': 'Email', '选择联系方式': 'Choose a contact method', '已发现的内核报错': 'Discovered kernel errors', '复制联系方式': 'Copy contact', '已发现的内核报错，排除网络与服务商问题。': 'Discovered kernel errors, excluding network and provider issues.', '关闭常见报错': 'Close Common errors', '任务运行期间修改了模型配置': 'Model configuration was changed while a task was running', 'A：任务期间请勿随意更改模型 configuration': 'A: Do not change model configuration during a task', 'OpenAI 兼容工具流的首个 tool-call 增量缺少字符串 “id”': 'The first tool-call delta in the OpenAI-compatible stream is missing a string “id”', 'A：属上游响应形状问题，请反馈至Yan Agent抖音/QQ群': 'A: This is an upstream response-shape issue. Report it through the Yan Agent Douyin/QQ group.', 'OpenAI 兼容工具流的首个 tool-call 增量缺少函数名': 'The first tool-call delta in the OpenAI-compatible stream is missing a function name', 'ConfigInvalidError / Invalid input: expected …': 'ConfigInvalidError / Invalid input: expected …', 'provider、model 或权限对象不符合 SDK schema（例如 provider/model id 不是字符串）': 'The provider, model, or permission object does not match the SDK schema (for example, a provider/model id is not a string)', 'A：provider-ID / model-ID有误，请检查API配置': 'A: The provider ID or model ID is invalid. Check the API configuration.', '有 assistant 消息，但没有可展示的最终文本': 'An assistant message exists, but it has no user-facing text', 'A：此为偶发性问题，请尝试重新发送prompt': 'A: This is intermittent. Try sending the prompt again.', '未知证书配置错误': 'Unknown certificate configuration error', '除以上报错，如果你在使用Yan Agent中遇到其他错误，请及时反馈至我们的抖音/QQ群': 'If you encounter another error while using Yan Agent, report it through our Douyin/QQ group.',
    '引导': 'Guide', '滚动到最新内容': 'Scroll to latest content', '权限': 'Permissions', '主界面': 'Main interface', '辅助对话': 'Auxiliary chat', '输入框': 'Composer', '工作区': 'Workspace',
    '上手指南': 'Getting started', 'Yan Agent 上手指南': 'Yan Agent getting started', '按页渐进了解全部功能；随时可以点左下角「引导」重新打开。': 'Go page by page to learn every feature. Reopen this guide anytime from “Guide” at the bottom left.',
    '欢迎使用 Yan Agent': 'Welcome to Yan Agent', 'Yan Agent 是运行在桌面上的真实工作 Agent：它能读写工作区文件、执行命令、操控内置浏览器、生成图片与视频，并用可复核的证据向你交付结果。这份引导会逐页介绍全部功能。': 'Yan Agent is a real desktop work agent: it reads and writes workspace files, runs commands, controls the built-in browser, generates images and videos, and delivers results backed by verifiable evidence. This guide walks through every feature page by page.',
    '三步完成初始配置': 'Three quick setup steps', '第一次使用，建议先完成下面三件事，之后就可以直接新建任务。': 'For first-time use, complete the three steps below; after that you can start creating tasks directly.', '配置 API：进入 设置 → API →「新建连接」，按页填写名称、兼容预设、Base URL 与 API Key，测试连接并拉取模型。': 'Set up API: open Settings → API → New connection, fill in the name, preset, Base URL, and API key page by page, then test the connection and fetch models.', '选择模型：点击输入框底部工具条的模型按钮，选择主模型并拖动“推理强度”滑块。': 'Choose a model: select the model button in the composer toolbar, pick the primary model, and drag the Reasoning strength slider.', '设置权限：把输入框底部工具条的权限滑块调到「替我审批」或「完全访问」，Agent 才能顺畅地读写文件与执行命令。': 'Set permissions: move the permission slider in the composer toolbar to “Approve for me” or “Full access” so the agent can read, write, and run commands smoothly.',
    '任务与工作区': 'Tasks and workspaces', '新建任务默认不在任何项目中（Blank），可以先对话和查询；涉及写入、构建或 Git 的任务，需要先选择工作区。': 'New tasks start outside any project (Blank), where you can chat and run read-only queries; tasks that write files, build, or use Git need a workspace first.', '新建任务：点击左侧「新建任务」，开始一条新对话。': 'New task: select New task on the left to start a new conversation.', '选择工作区：点击任务栏的「选择工作区」，可以选一个文件夹，或选「不在项目中工作」。': 'Choose a workspace: select Choose workspace in the task bar to pick a folder or work outside a project.', '任务列表：左侧中间列出历史任务；任务栏的「⋯」菜单可置顶或重命名任务。': 'Task list: past tasks are listed on the left; use the “⋯” menu in the task bar to pin or rename a task.', 'Git 分支：任务栏可以直接搜索并切换分支，Agent 会在同一分支上工作。': 'Git branch: search and switch branches from the task bar; the agent works on the same branch.', '每个任务独立保存消息、工作区与权限上下文，互不干扰。': 'Each task keeps its own messages, workspace, and permission context without interfering with others.',
    '输入框：把要求说清楚': 'Composer: state your request clearly', '输入框是任务的起点：按 Enter 发送，按 Shift+Enter 换行。': 'The composer is where every task starts: press Enter to send and Shift+Enter for a new line.', '添加附件：点「+」→「添加附件」，也可以把文件或图片直接粘贴进输入框。': 'Add attachments: select “+” → Add attachment, or paste files and images straight into the composer.', '优化 prompt：点「+」→「优化你的prompt」，Yan Prompt Optimizer 会重写你的输入，按 Ctrl+Z 可以回退。': 'Optimize prompt: select “+” → Optimize your prompt. Yan Prompt Optimizer rewrites your input, and Ctrl+Z reverts it.', '排队对话：Agent 工作时仍可继续输入，消息会先排队，再在合适时机送达。': 'Queued turns: keep typing while the agent works; messages queue and are delivered at the right moment.', '工具条：输入框底部集中了「+」、权限滑块、工作方式、模型与发送按钮。': 'Toolbar: the bottom of the composer holds “+”, the permission slider, work mode, model, and send controls.',
    '工作方式：目标 / 计划 / 自进化 / AGI': 'Work modes: Goal / Plan / Evolution / AGI', '在输入框按「/」，或点「+」→「使用/选择工作方式」，就能给这轮任务换一种推进方式；开启后底部会出现工作方式标识，点它即可退出。': 'Press “/” in the composer, or select “+” → Use/select a work mode, to change how this task proceeds. Once enabled, a work-mode badge appears in the toolbar; select it to exit.', '目标：给出一条可验收的目标，Agent 会分轮推进、自我验收并给出证据，直到达成或明确说明阻塞原因。': 'Goal: give an acceptance-checkable goal; the agent advances in rounds, self-checks, and shows evidence until it succeeds or clearly states what blocks it.', '计划：先把计划文档写入右侧「计划文档」面板，方案确认后再开始执行。': 'Plan: the plan is written to the Plan document panel on the right first, and execution starts after the plan is confirmed.', '自进化：本轮结束后把重复失败与可复用经验沉淀为长期演进，不会打断当前工作。': 'Evolution: after the turn ends, repeated failures and reusable tactics are distilled into long-term improvements without interrupting current work.', 'AGI：实验性能力，叠加推理侧路与自进化双链路。': 'AGI: experimental; combines a reasoning side path with the evolution loop.',
    '技能（Skill）': 'Skills', '在输入框按「$」，或点「+」→「使用$选择技能」，可以把技能绑定到本轮任务；不手动选择时，Agent 也会按需自动调用。': 'Press “$” in the composer, or select “+” → Use $ to select a Skill, to bind Skills to this task. When you do not choose, the agent still calls the Skills it needs.', '预装技能：覆盖网页设计、动效、代码理解、Office 文档、逆向工程、视频生成等常用场景，开箱即用。': 'Bundled Skills: ready to use for web design, motion, code understanding, Office documents, reverse engineering, video generation, and more.', 'Skill 市场：左侧「Skill 市场」可以搜索、筛选、查看详情并安装。': 'Skill market: use Skill market on the left to search, filter, view details, and install.', '个人技能：市场右上角「+」可以导入自定义 Skill JSON，文件需要包含 id、name、desc、prompt 字段。': 'Personal Skills: select “+” at the top right of the market to import a custom Skill JSON containing id, name, desc, and prompt fields.', '也可以直接对 Agent 说「安装某某 Skill」或「新建一个 Skill」，它会用 Yan Skills 完成。': 'You can also tell the agent to install or create a Skill directly; it handles that through Yan Skills.',
    'MCP 服务': 'MCP services', 'MCP 是 Agent 的工具来源：左侧「MCP 服务」列出全部服务，点击卡片可以查看包含的工具。': 'MCP servers provide the agent’s tools: MCP services on the left lists them all, and selecting a card shows the tools it provides.', '测试连接：在服务详情里点「测试连接」，成功后显示可用的工具数量。': 'Test connection: select Test connection in the service details; a success message shows the number of available tools.', '启停服务：普通服务可以「启用 / 禁用」；系统内置的 MCP 显示「始终启用」，由 Yan 统一管理。': 'Start or stop: regular services can be enabled or disabled; built-in MCP servers show Always enabled and are managed by Yan.', '添加服务器：按名称、启动命令与命令参数接入自己的 MCP 服务。': 'Add server: connect your own MCP server with a name, launch command, and command arguments.', '内置能力：内置 CodeGraph（代码图）、Serena（符号定位）、Built-in Browser、Yan Media、Skills 等 MCP，覆盖代码理解、浏览器操作与媒体生成。': 'Built-ins: CodeGraph, Serena, Built-in Browser, Yan Media, and Skills cover code intelligence, browser control, and media generation.',
    '子代理与并行工作': 'Subagents and parallel work', '在输入框按「￥」，或点「+」→「使用￥调用子代理」，把适合并行的部分交给子代理；主代理负责编排、汇总与最终交付。': 'Press “￥” in the composer, or select “+” → Use ￥ to call a subagent, to delegate parallel work. The main agent orchestrates, merges, and delivers the final result.', '角色分工：探索、研究、测试、审阅、构建、测绘、追踪、逆向等子代理各司其职。': 'Roles: explore, research, test, review, build, map, trace, and reverse-engineer subagents each have a focused job.', '子智能体面板：右侧面板可以查看每个子代理的实时进度与产出。': 'Subagents panel: watch each subagent’s live progress and output in the right panel.', '任务工作树：Git 工具 →「任务工作树」为并行构建创建隔离的 git worktree，完成后合并回当前分支。': 'Task worktrees: Git tools → Task worktrees creates isolated git worktrees for parallel builds and merges them back when done.',
    '权限与访问模式': 'Permissions and access modes', '权限滑块位于输入框底部工具条，共三档；Agent 触发受限操作时会弹出确认卡片。': 'The permission slider in the composer toolbar has three levels, and the agent asks for confirmation whenever it reaches a restricted action.', '请求批准：每次受限操作都先询问，最稳妥。': 'Request approval: every restricted action asks first; the safest option.', '替我审批：常见操作自动放行，高危命令仍会停下来请你确认。': 'Approve for me: common operations are auto-approved, while high-risk commands still stop for your confirmation.', '完全访问：不再逐次询问，适合你信任的任务。': 'Full access: no more per-action prompts; best for tasks you trust.', '逐项开关：设置 → 常规 → 权限，可分别控制读取文件、写入文件、执行命令与网络访问。': 'Individual switches: Settings → General → Permissions controls file reads, file writes, command execution, and network access separately.', '确认卡片：出现时可以选择「本次允许」「总是允许」或「拒绝」。': 'Confirmation card: choose Allow once, Always allow, or Deny when it appears.',
    'API 与模型': 'API and models', '进入 设置 → API 可以自建任意数量的连接，凭据只保存在本机。': 'Open Settings → API to create as many connections as you need; credentials stay on this device.', '新建连接：按页填写 配置名称 → 兼容预设 → Base URL → 接口格式 → API Key，可选填写生成图像 / 编辑图片 / 生成视频 POST 与自定义模型 ID。': 'New connection: fill in Name → Preset → Base URL → Protocol → API key page by page, with optional image generation, image editing, and video generation POST URLs plus custom model IDs.', '测试与拉取：一键测试连接，成功后返回该连接的全部可用模型。': 'Test and fetch: test the connection in one click and get every model the connection returns.', '图像与视频模型：在 API 页底部选择生成图像/生成视频模型，之后就能让 Agent 生成或编辑图片与视频。': 'Image and video models: choose the image and video generation models at the bottom of the API page, then let the agent create or edit images and videos.', '兼容预设：内置 GLM、通义、豆包、硅基流动、日日新等预设，不确定时保持「自动识别」即可。': 'Presets: GLM, Qwen, Doubao, SiliconFlow, SenseNova, and more are built in; keep Auto-detect when unsure.',
    '视觉中继（多模态）': 'Vision relay (multimodal)', '主模型不支持多模态时，视觉中继会从侧路调用视觉模型读图，再把内容转告主模型，让任意主模型都能完成多模态工作。': 'When the primary model cannot handle images, vision relay calls a vision model on the side, reads the image, and tells the primary model what it contains, so any primary model becomes multimodal.', '免费来源：GLM、SenseNova、Agnes、硅基流动，配置任意一家即可。': 'Free sources: GLM, SenseNova, Agnes, and SiliconFlow; configuring any one is enough.', '教学文档：设置 → 视觉中继，每个来源都有分步教学、配置状态检查与开关。': 'Tutorials: Settings → Vision relay offers step-by-step tutorials, status checks, and a switch for each source.', '关闭后，图片会直接发送给主模型；需要时随时可以打开。': 'When disabled, images go straight to the primary model; you can turn it on again at any time.',
    '上下文与长期记忆': 'Context and long-term memory', '长任务要关注上下文占用：Yan Agent 会自动压缩，也允许你手动干预。': 'Long tasks depend on context usage: Yan Agent compacts automatically and also lets you intervene manually.', '上下文配置：设置 → 常规 →「配置上下文」，按模型能力设置最大上下文与压缩阈值。': 'Context settings: Settings → General → Configure context lets you set the maximum context and compaction threshold for your model.', '状态环：右侧面板工具条的圆环显示上下文占用，点击可以查看已用 / 上限与压缩提示。': 'Status ring: the ring in the right panel toolbar shows context usage; select it to see used versus limit and compaction hints.', '手动压缩：在状态环面板点「我来压缩」，立即压缩早期对话。': 'Manual compaction: select “Compact now” in the status ring panel to compact early turns immediately.', '长期记忆：Agent 会把稳定偏好与可复用经验沉淀下来，在后续任务中继续生效。': 'Long-term memory: the agent distills stable preferences and reusable experience and applies them to later tasks.',
    '右侧面板：审阅 / 浏览器 / 临时对话': 'Right panel: Review / Browser / Temporary chat', '右侧工具条可以一键打开面板，支持多个标签页并行；全屏按钮让面板铺满工作区，Agent 仍会继续工作。': 'The right toolbar opens panels in one click and supports several tabs at once; the full-screen button expands the panel while the agent keeps working.', '审阅：Agent 修改文件后显示逐行 diff，可以刷新、折叠 / 展开、复制差异，并一键撤销本轮改动。': 'Review: line-by-line diffs appear after the agent edits files; refresh, collapse or expand, copy a diff, or undo this run’s changes in one click.', '浏览器：打开网页交给 Agent 阅读与操作，也支持你随时接管。': 'Browser: open pages for the agent to read and operate, and take over yourself at any time.', '临时对话：询问当前进度或注入新要求，不会打断 Agent 正在做的事。': 'Temporary chat: ask about progress or add requirements without interrupting what the agent is doing.', '计划文档与子智能体：运行计划模式或派出子代理时，会显示对应标签页。': 'Plan document and Subagents: the matching tabs appear when plan mode runs or subagents are dispatched.',
    '内置浏览器': 'Built-in browser', 'Yan Agent 优先使用内置浏览器完成网页阅读、交互与视觉验收。': 'Yan Agent prefers the built-in browser for reading, interacting with, and visually verifying web pages.', 'Agent 控制：打开、点击、输入、滚动、截图、读取页面等操作都能由 Agent 执行。': 'Agent control: the agent can open, click, type, scroll, take screenshots, read pages, and more.', '用户接管：点击浏览器工具栏的手势按钮，就可以自己接管鼠标与键盘。': 'User takeover: select the gesture button in the browser toolbar to take over mouse and keyboard yourself.', '导航与缩放：前进、后退、刷新、缩放（自动或手动），也可以直接输入 URL。': 'Navigation and zoom: back, forward, reload, and zoom (auto or manual); you can also type a URL directly.', '隐私清理：浏览器设置里可以单独清除缓存或 Cookie。': 'Privacy cleanup: clear cache or cookies separately from the browser settings menu.', '联网搜索：Agent 会优先使用 AnySearch 技能检索实时信息。': 'Web search: the agent prefers the AnySearch Skill for real-time information.',
    'Git 工具': 'Git tools', '任务栏右侧的 Git 工具覆盖日常版本控制操作。': 'The Git tools on the right of the task bar cover everyday version control.', '更改：查看当前工作区改动与 + / − 统计。': 'Changes: review current workspace changes with + / − statistics.', '分支：搜索、切换，或创建并检出新分支。': 'Branch: search, switch, or create and check out a new branch.', '提交或推送：填写提交信息，一键提交，也可以直接提交并推送。': 'Commit or push: write a commit message and commit in one click, or commit and push directly.', '任务工作树：创建与合并隔离工作树，配合并行子代理使用。': 'Task worktrees: create and merge isolated worktrees for parallel subagents.', 'GitHub PR：查看与当前分支关联的 PR，或把分支发成 Pull Request（需要 gh CLI）。': 'GitHub PR: view the PR linked to the current branch, or open a pull request from it (requires the gh CLI).', 'Git 图谱：可视化查看提交历史与分支关系。': 'Git graph: visualize commit history and branch relationships.',
    '媒体生成': 'Media generation', '配置好图像 / 视频模型后，直接用自然语言描述画面，Agent 会调用 Yan Media 完成生成。': 'Once image and video models are configured, describe the scene in natural language and the agent uses Yan Media to generate it.', '图片：生成图片，也可以带参考图进行图像编辑。': 'Images: generate images, or edit an image with a reference.', '视频：支持画面比例、时长、分辨率、反向提示词与随机种子等参数。': 'Videos: aspect ratio, duration, resolution, negative prompt, and random seed are all supported.', '生成结果可以直接预览与打开，也可以继续交给 Agent 加工。': 'Results can be previewed and opened directly, or passed back to the agent for further work.',
    '桌宠、快速启动与外观': 'Desktop pets, Quick launch, and appearance', '个性化与效率选项集中在 设置 → 常规。': 'Personalization and productivity options live in Settings → General.', '桌宠：共四种可选；Yan Agent Orb 是监督型桌宠，会在你忙碌时帮你盯住 Agent 的工作状态。': 'Desktop pets: four choices; Yan Agent Orb is a supervisory pet that keeps an eye on the agent while you are busy.', '快速启动：开启后按 Ctrl+Shift+Y（可以自定义）在任意软件上方呼出快速输入。': 'Quick launch: enable it and press Ctrl+Shift+Y (customizable) to summon quick input over any application.', '主题、语言与正文字体：深浅色与中英界面随时切换；不喜欢 Agent 输出的衬线宋体观感时，可在「正文字体」改为无衬线。': 'Theme, language, and body font: switch light or dark and Chinese or English anytime; if you dislike the serif look of Agent output, switch Body font to sans-serif.', '壁纸市场：内置多款壁纸，支持上传自定义壁纸并调节材质强度。': 'Wallpaper market: several built-in wallpapers, custom uploads, and a material strength control.', '正文朗读：选择音色与语速，试听满意后可以让 Agent 朗读正文。': 'Read aloud: choose a voice and speed, preview it, and let the agent read replies aloud.', '极速文件写入：写入时不逐次格式化，任务收尾统一格式化本次改动的文件，适合大批量修改。': 'Fast file writes: skip per-edit formatting and format only the files changed in this run at the end; ideal for bulk edits.',
    '三种工作视图': 'Three work views', '标题栏左侧可以切换三个工作视图，任务会在后台继续运行。': 'The title bar switches between three work views while tasks keep running in the background.', '主界面：日常对话与工作的主场景。': 'Main: the primary surface for daily conversation and work.', 'Understand Anything：基于本地代码图谱浏览项目结构、文件职责、符号关系与改动影响。': 'Understand Anything: browse project structure, file responsibilities, symbol relationships, and change impact from the local code graph.', 'Yan Work GUI：用可视化方式查看 Agent 的工作过程与工作区状态。': 'Yan Work GUI: a visual view of the agent’s work process and workspace state.',
    '关于与帮助': 'About and help', '遇到问题或有建议，随时联系我们；这份引导也可以随时重看。': 'Reach out anytime with problems or suggestions; this guide can also be reopened whenever you like.', '现在，点击「新建任务」，向 Yan Agent 说出你的第一个目标吧。': 'Now select New task and tell Yan Agent your first goal.', '常见报错：设置 → 关于 →「常见报错」，覆盖已发现的内核报错与处理建议。': 'Common errors: Settings → About → Common errors lists known kernel errors and what to do.', '检查更新：一键检查当前版本并更新。': 'Check for updates: check the current version and update in one click.', '联系方式：抖音群、QQ 群与邮箱，欢迎反馈问题与建议。': 'Contact: Douyin group, QQ group, and email; feedback is welcome.', '重看引导：点击左下角「引导」按钮，或用 ← → 方向键翻页。': 'Reopen this guide: select Guide at the bottom left, or use the ← → arrow keys to page through.',
    '让灵感浮于纸面': 'Let inspiration float onto the page.',
    'API 连接': 'API connections', '我的连接': 'My connections', '图像/视频模型选择': 'Image/video model selection',
    '生成图像模型选择': 'Image generation model', '生成视频模型选择': 'Video generation model', '未选择': 'Not selected',
    '选择': 'Select', '选择供应商': 'Select provider', '选择模型': 'Select model', '← 上一页': '← Previous',
    '下一页 →': 'Next →', '新建连接': 'New connection', '配置名称': 'Connection name', '兼容预设': 'Compatibility preset',
    '格式': 'Format', '选择接口线路协议；不确定就保留自动识别。': 'Choose the wire protocol; keep auto-detect when unsure.',
    '自动识别': 'Auto-detect', 'OpenAI 通用': 'OpenAI compatible', 'glm·GLMM': 'glm·GLMM',
    '自动识别（按预设与 URL 推断）': 'Auto-detect (inferred from preset and URL)',
    'Chat Completions（/chat/completions）': 'Chat Completions (/chat/completions)',
    'Anthropic Messages（/v1/messages）': 'Anthropic Messages (/v1/messages)',
    'Responses（/responses）': 'Responses (/responses)',
    '通义 · DashScope': 'Qwen · DashScope', '豆包 · 火山方舟': 'Doubao · Volcengine Ark', '阶跃 · StepFun': 'StepFun',
    '混元 · Hunyuan': 'Hunyuan', '硅基流动': 'SiliconFlow', '日日新': 'SenseNova', '基元律动': 'Jiyuan',
    '生成图像 POST': 'Image generation POST', '编辑图片 POST': 'Image editing POST', '生成视频 POST': 'Video generation POST',
    '自定义模型 ID': 'Custom model ID', '测试连接': 'Test connection', '返回模型': 'Returned models',
    '以下为API返回的全部模型': 'All models returned by the API', '完成': 'Finish', '添加壁纸': 'Add wallpaper',
    '选择添加照片': 'Choose photo', '填写壁纸昵称': 'Wallpaper name', '确认操作': 'Confirm action', '可用模型': 'Available models',
    '允许任意主模型读取和理解图像内容，实现完全多模态': 'Let any primary model read and understand images for full multimodality',
    '中': 'Medium', '配置当前主模型与推理强度。': 'Configure the primary model and reasoning strength.', '选择当前配置下所有模型之一': 'Choose one of the models in the current configuration', '推理强度': 'Reasoning strength', '已安装的 Skill': 'Installed Skills', 'Model：No model selected · 推理强度：中': 'Model: No model selected · Reasoning strength: Medium', '当前Model No model selected，推理强度 中，点击切换': 'Current model: No model selected, reasoning strength: Medium. Select to switch', 'Model：No model selected · Reasoning strength：中': 'Model: No model selected · Reasoning strength: Medium', '当前Model No model selected，Reasoning strength 中，点击切换': 'Current model: No model selected, reasoning strength: Medium. Select to switch',
    '使用文档': 'User guide', '查看说明': 'View guide', '当前支持': 'Supported providers', '教学文档': 'Tutorial',
    '启用视觉中继': 'Enable vision relay', '启用或关闭视觉中继': 'Enable or disable vision relay', 'Yan Agent 可能把支持多模态的主模型误判为不支持，所以将决定权还给你：关闭后图片将直接发给主模型。': 'Yan Agent may misclassify a multimodal primary model as text-only, so the choice is yours: when the relay is off, images go straight to the primary model.',
    '检查配置状态': 'Check configuration', '视觉中继使用说明': 'Vision relay guide', '只读说明，按页查看。': 'Read-only guide. View it page by page.',
    '外观与语言': 'Appearance and language', '主题': 'Theme', '选择 Yan Agent 的界面外观': 'Choose the Yan Agent appearance',
    '语言': 'Language', '选择 Yan Agent 的界面语言': 'Choose the Yan Agent interface language', '中文': 'Chinese',
    '正文字体': 'Body font', 'Agent 输出与长文阅读使用的字体，不喜欢宋体观感可切换': 'Font used for Agent output and long-form reading; switch it if you dislike the serif look',
    '衬线': 'Serif', '无衬线': 'Sans-serif',
    '用户名': 'Username', '让 Yan Agent 记住你的名字': 'Let Yan Agent remember your name', '权限': 'Permissions',
    '上下文': 'Context', '最大上下文与压缩': 'Maximum context and compaction',
    '不同模型最大上下文与压缩阈值不同，请手动配置': 'Maximum context and compaction thresholds vary by model. Configure them manually.',
    '配置上下文': 'Configure context', '按当前环境的模型能力手动设置。': 'Set values manually for the current environment and model capabilities.',
    '最大上下文': 'Maximum context', '设置当前环境最大上下文长度': 'Set the maximum context length for the current environment',
    '压缩阈值': 'Compaction threshold', '设置当前环境的压缩阈值': 'Set the compaction threshold for the current environment',
    '关闭上下文配置': 'Close context settings', '请输入有效的最大上下文长度': 'Enter a valid maximum context length',
    '请输入有效的压缩阈值': 'Enter a valid compaction threshold', '压缩阈值必须小于最大上下文': 'The compaction threshold must be lower than the maximum context',
    '正在保存上下文配置': 'Saving context settings', '上下文配置已保存': 'Context settings saved', '上下文配置保存失败': 'Failed to save context settings',
    '读取文件': 'Read files', '允许读取工作区与上传的文件': 'Allow reading workspace and uploaded files',
    '写入文件': 'Write files', '允许创建或修改文件': 'Allow creating or modifying files', '执行命令': 'Run commands',
    '允许运行 Shell 命令（谨慎）': 'Allow running shell commands (careful)', '网络访问': 'Network access', '允许调用外部 API': 'Allow calling external APIs',
    '应用': 'Application', '显示桌宠': 'Show desktop pet', '在桌面显示 Yan 宠物窗口': 'Show the Yan pet window on the desktop',
    '快速启动': 'Quick launch', '在其他软件或桌面上直接呼出快速输入': 'Open quick input from other apps or the desktop',
    '子代理': 'Subagents', '选择本轮可以参与协作的角色': 'Choose roles that can collaborate this turn',
    '定位文件、符号与工作区事实': 'Locate files, symbols, and workspace facts', '审阅实现并指出具体风险': 'Review implementation and identify concrete risks',
    '查阅文档、资料与外部来源': 'Read docs, references, and external sources', '运行非变更测试与诊断': 'Run non-mutating tests and diagnostics',
    '壁纸市场': 'Wallpaper market', '不透明度': 'Opacity', '剑与樱': 'Sword and Sakura', '中式园林': 'Chinese Garden',
    '月之暗面': 'Dark Side of the Moon', '侧脸回眸': 'Looking Back', '幽邃山洞': 'Deep Cave', '自定义壁纸': 'Custom wallpaper',
    '选择 JPG / PNG': 'Choose JPG / PNG',
    '任务名称': 'Task name', '保存': 'Save', '删除': 'Delete', '有什么我可以帮你的吗？': 'What can I help you with?', '输入需求': 'Enter a request', '提交需求': 'Submit request',
    '正文朗读': 'Read aloud', '朗读音色': 'Reading voice', '朗读语速': 'Reading speed', '语速': 'Speed', '试听': 'Preview', '试听失败': 'Preview failed', '朗读': 'Read aloud',
    '选择朗读音色': 'Choose reading voice',
    '晓晓 · 女声温柔': 'Xiaoxiao · warm female', '晓伊 · 女声活泼': 'Xiaoyi · lively female', '云希 · 男声阳光': 'Yunxi · sunny male', '云健 · 男声沉稳': 'Yunjian · steady male', '云扬 · 男声播报': 'Yunyang · news male', '云夏 · 男声少年': 'Yunxia · youthful male', '晓北 · 女声东北': 'Xiaobei · Northeastern female', '晓妮 · 女声陕西': 'Xiaoni · Shaanxi female',
    '这条消息没有可朗读的正文': 'This message has no readable text', '朗读失败': 'Read-aloud failed', '朗读音色已更新': 'Reading voice updated', '朗读音色保存失败': 'Failed to save reading voice', '语速保存失败': 'Failed to save reading speed',
    '删除任务？': 'Delete task?', '删除任务': 'Delete task', '移除工作区？': 'Remove workspace?', '移除工作区': 'Remove workspace',
    '删除 Skill？': 'Delete Skill?', '删除 Skill': 'Delete Skill',
    'Yan Agent': 'Yan Agent', 'Yan Kernel（基于 OpenCode 二次开发）': 'Yan Kernel (based on OpenCode)',
    '工作区与目标模式': 'Workspaces and goal mode', 'Skill、MCP 与浏览器': 'Skills, MCP, and Browser',
    '多模态与可靠交付': 'Multimodality and reliable delivery', '记忆、设置与生态': 'Memory, settings, and ecosystem',
    '版本信息与本次更新': 'Version and release notes', 'v1.4.0 完整更新': 'v1.4.0 complete update',
    '已处理': 'Handled', '回包中': 'Replying', '回包时间': 'Reply time', '回复时间': 'Response time', '缓存命中': 'Cache hit', '缓存命中显示': 'Cache-hit display',
    '撤销': 'Undo', '本轮改动已撤销': 'Changes from this run have been undone',
    '工作中': 'Working', '处理中': 'Processing', '运行失败': 'Run failed', '已暂停': 'Paused', '任务已中断': 'Task interrupted', 'Yan Kernel 已完成执行并返回真实会话结果。': 'Yan Kernel completed execution and returned the real session result.', '等待你的回答': 'Waiting for your answer', '等待操作权限': 'Waiting for permission',
    '操作权限等待确认': 'Awaiting operation permission', '任务已完成': 'Task completed', '任务已停止': 'Task stopped', '任务出现异常': 'Task failed',
    '加载中': 'Loading', '检查中': 'Checking', '测试中': 'Testing', '测试失败': 'Test failed', '连接失败': 'Connection failed',
    '连接成功': 'Connection successful', '保存失败': 'Save failed', '操作失败': 'Operation failed', '下载图片': 'Download image', '正在加载图片…': 'Loading image…', 'Agent 生成的图片': 'Image generated by Agent', '无法读取会话图片': 'Unable to read session image', '会话图片已失效': 'Session image is no longer available', '图片数据无法解码': 'Image data could not be decoded', '正在选择保存位置…': 'Choosing save location…', '下载失败': 'Download failed', '图片加载失败': 'Image loading failed', '暂无对话 · 点击上方开始': 'No conversations · click above to start', '本轮缓存读取': 'Cache read this run', '输入总量': 'Total input', '输入': 'Input', '输出': 'Output', '新增': 'Added', '已编辑': 'Edited', '已撤销': 'Reverted', '已删除': 'Deleted', '未知': 'Unknown', '在审阅面板中查看': 'View in Review panel', '正在压缩上下文': 'Compacting context', '上下文压缩已完成': 'Context compaction completed', '正在验收目标': 'Validating goal', '已修复问题，准备再次验收': 'Issue fixed; preparing another validation', '验收通过，正在完成回复': 'Validation passed; finishing reply', '验收未通过': 'Validation failed', '正在读取图片': 'Reading image', '正在切换读图模型': 'Switching vision model', '思考推理': 'Reasoning', '正在恢复模型工具调用': 'Restoring model tool call', '子代理数量已达上限': 'Subagent limit reached', '子代理正在生成回复': 'Subagent is generating a reply', '子代理正在思考': 'Subagent is thinking', '任务出现异常': 'Task failed', '内核事件流出现异常': 'Kernel event stream failed', '正在收尾': 'Finalizing', '等待用户回答': 'Waiting for user answer', '模型请求重试': 'Retrying model request', '问题拒绝': 'Question denied', '问题回复': 'Question answered', '任务等待用户选择工作区。': 'Task is waiting for a workspace selection.',
    '没有匹配的 Skill': 'No matching Skills', '正在读取 Skill': 'Reading Skill', '未能读取 Skill': 'Unable to read Skill',
    '重新加载': 'Reload', '代码已复制': 'Code copied', '复制失败': 'Copy failed',
    '已撤回，可编辑后重发': 'Withdrawn; edit and resend', '已中断': 'Interrupted', '权限确认': 'Permission required',
    '上一步': 'Previous', '不回答': 'Skip', '跳过': 'Skip', '发送回答': 'Send answer', '下一题': 'Next question', '上一题': 'Previous question', '关闭问题': 'Close question', '其他回答': 'Other answer', '你的回答': 'Your answer', '自拟回答': 'Custom answer', '告诉 Yan Agent 你的想法': 'Tell Yan Agent what you have in mind', '请输入你的回答': 'Enter your answer', '否，并告诉 Yan Agent 应该如何做不同': 'No, and tell Yan Agent how it should be different',
    '请先选择工作区': 'Select a workspace first', '未知错误': 'Unknown error', '未配置': 'Not configured', '尚未配置对应连接': 'No corresponding connection configured', '当前不可用': 'Unavailable',
    '官方': 'Official', '国内': 'China', '国际': 'International', '连接': 'Connection', '模型': 'Model', '供应商': 'Provider', '和': 'and', 'Yan Agent正在操控你的电脑，按Esc退出': 'Yan Agent is controlling your computer. Press Esc to exit',
    '项目': 'Projects', '娱乐桌宠': 'Entertainment pet', '当前工作区没有可用分支': 'No branches available in the current workspace', '未设置工作区': 'Workspace not set',
    '先为当前任务选择一个文件夹。': 'Choose a folder for this task first.', '深色模式': 'Dark mode',
    'Yan Prompt Optimizer正在优化你的输入，按Ctrl+Z以回退优化': 'Yan Prompt Optimizer is refining your input. Press Ctrl+Z to revert.',
    '启用': 'Enable', '停用': 'Disable', '默认': 'Default', '可选': 'Optional', '标准': 'Standard', '目标模式': 'Goal mode',
    '随时待命': 'Standing by', '推理速度': 'Reasoning speed', '未选择模型': 'No model selected',
    '上下文状态': 'Context status', '自动压缩阈值': 'automatic compaction threshold', '距离自动压缩还有': 'Compaction in',
    '已完成': 'Completed', '尚未选择照片': 'No photo selected', '← 上一步': '← Previous',
    'glm（国内）': 'glm (China)', 'sensenova（国内）': 'sensenova (China)', 'Agnes（国际）': 'Agnes (International)', '硅基流动（国内）': 'SiliconFlow (China)',
    '月薪猫': 'Monthly Cat', '大烧货': 'Big Burner', '准备一个 Skill JSON 文件，然后从资源管理器选择它。': 'Prepare a Skill JSON file, then choose it from Explorer.',
    '文件至少包含': 'Each file must include', '字段。导入后会出现在“个人”筛选中，也可以从输入框上方的“技能”调用。': 'fields. After import, it appears under the Personal filter and can be called from Skills above the composer.',
    '连接本地或远程工具，让 Agent 获得可验证的执行能力。': 'Connect local or remote tools so the Agent can perform verifiable actions.',
    '先给这个 MCP 服务起一个容易识别的名称。': 'Give this MCP service an easy-to-recognize name first.',
    '稍后可在服务注册表中识别它': 'It will be identifiable in the service registry later',
    '填写可在本机终端中运行的命令': 'Enter a command that can run in the local terminal',
    '可留空；多个参数用空格分隔，路径含空格时使用引号': 'Optional; separate multiple arguments with spaces and quote paths containing spaces',
    '选择目标分支并处理当前工作区的更改。': 'Choose a target branch and handle the current workspace changes.',
    '自建任意数量的 API 连接。填写名称、Base URL 和 API Key，一键测试并拉取模型列表。': 'Create any number of API connections. Enter a name, Base URL, and API key, then test and fetch models in one click.',
    '先选择一个已配置连接，再选择模型。': 'Choose a configured connection first, then choose a model.',
    '仅显示含生成图像模型的 API 连接。': 'Only show API connections with image-generation models.',
    '默认可选择“不选择”，用于取消当前模型。': 'Choose Not selected by default to clear the current model.',
    '一页一项，按步填写；随时可测试或保存。': 'One item per page. Follow the steps and test or save at any time.',
    '给这条连接起一个名字，例如 DeepSeek 官方、我的中转站。': 'Give this connection a name, for example DeepSeek Official or My Relay.',
    '默认按名称和 URL 自动识别接口形状；不对时手动指定。': 'The interface shape is detected from the name and URL by default; choose one manually if needed.',
    'OpenAI 兼容网关、官方 API 或中转站均可。': 'An OpenAI-compatible gateway, official API, or relay all work.',
    '请妥善保管你的API key，Yan Agent不会泄露它': 'Keep your API key safe. Yan Agent will not disclose it.',
    '自定义生图端点；留空按预设形状从 Base URL 推导。': 'Custom image-generation endpoint; leave blank to derive it from Base URL.',
    '图片编辑端点；留空按预设形状推导。': 'Image-editing endpoint; leave blank to derive it from the preset.',
    '生视频端点；留空按预设形状推导。': 'Video-generation endpoint; leave blank to derive it from the preset.',
    '目录接口拉不到模型时手填；随后测试连接验证。': 'Enter it manually when the catalog endpoint cannot return models, then test the connection.',
    '确认以下信息，按“完成”保存连接。': 'Review the information below and select Finish to save the connection.',
    '一页一项，保存后会保留在壁纸市场。': 'One item per page. It will remain in the wallpaper market after saving.',
    '支持 JPG 与 PNG 图片，保存后可在壁纸市场重复使用。': 'JPG and PNG images are supported and can be reused from the wallpaper market after saving.',
    '给这张壁纸起一个容易识别的名字。': 'Give this wallpaper an easy-to-recognize name.',
    '已配置厂商的模型会按用途归类显示。': 'Models from configured providers are grouped by purpose.',
    '关于视觉中继，你可以点击右侧“查看说明”': 'For vision relay details, select View guide on the right.',
    '在明确范围内编写代码并做轻量验收，最多 3 个并发槽位': 'Write code within the assigned scope and perform lightweight checks, with up to 3 concurrent slots.',
    'Yan Agent提供多种壁纸供你选择，也支持上传你喜欢的壁纸': 'Yan Agent provides wallpapers to choose from and supports uploading your own.',
    '面向真实工作区的桌面端自主 Agent': 'An autonomous desktop Agent for real workspaces',
    '全新 Yan Kernel 成为唯一执行权威，统一处理事件流、权限、提问、错误收尾、上下文压缩与最终回复': 'Yan Kernel is now the sole execution authority, handling event streams, permissions, questions, error finalization, context compaction, and final replies.',
    '新增 DeepSeek DSML 适配，协议片段不会泄露到用户正文；重复错误会熔断并给出可见原因': 'Added DeepSeek DSML support; protocol fragments stay out of user messages, and repeated errors are stopped with a visible reason.',
    '直接采用模型原生最终回复，不再二次总结；完成后可从输出底部展开同一套正文 UI 查看工作过程': 'Use the model-native final reply without a second summary; after completion, expand the work log from the bottom of the output.',
    'Blank 可进行问答、浏览、应用操作、媒体生成和 Yan Skill 安装；用户文件写入必须先选择工作区': 'Blank supports Q&A, browsing, app actions, media generation, and Yan Skill installation; select a workspace before writing user files.',
    '常规、计划、目标三种工作方式落地；目标模式只按原始要求定点验收和最小修复，最多 6 轮': 'General, Plan, and Goal modes are available; Goal mode validates only the original requirements and makes minimal repairs for up to 6 rounds.',
    '工作区、任务和工具快照隔离；跨工作区/跨会话交接需要授权并复用目标工作区最近任务': 'Workspace, task, and tool snapshots are isolated; cross-workspace and cross-session handoff requires authorization and reuses the latest task in the target workspace.',
    'Yan Skills、Yan Media、Yan Session、CodeGraph、Serena 和 Yan 内置浏览器按任务需要暴露': 'Yan Skills, Yan Media, Yan Session, CodeGraph, Serena, and the built-in Yan Browser are exposed as needed.',
    'Skill 的查找、安装、调用和删除锁定在 Yan 自己的 Skill 根目录；内置浏览器优先，Playwright 只作后备': 'Skill discovery, installation, invocation, and removal are confined to Yan storage; the built-in Browser is preferred and Playwright is a fallback.',
    '内置浏览器按 ChatGPT 内置浏览器范式重做，支持专属标签页、完整交互操控、截图、显式等待、页面检查和交互证据': 'The built-in Browser follows the ChatGPT Browser pattern with dedicated tabs, full interaction control, screenshots, explicit waits, page inspection, and interaction evidence.',
    'Canvas/WebGL/3D 不再只看 DOM 或像素变化，Agent 控制状态会显示在页面和标签上': 'Canvas/WebGL/3D is no longer judged only by DOM or pixel changes; Agent control status is shown on the page and tab.',
    '主文本模型与图片/视频次模型共存，文件、视觉中继、媒体生成、编辑和上下文修改组成完整多模态链路': 'Primary text models coexist with image/video models; files, vision relay, media generation, editing, and context changes form a complete multimodal pipeline.',
    '支持会话内媒体修改和 9 种图片比例；成功生成不会默认再次读图，图片/视频结果会进入最终输出': 'Sessions support media revisions and 9 image aspect ratios; successful generations are not reread by default and image/video results enter the final output.',
    '主模型不能读图时，可按 glm、sensenova、Agnes、硅基流动顺序使用视觉中继把截图事实转告主模型': 'When the primary model cannot read images, vision relay passes screenshot facts in the order glm, sensenova, Agnes, then SiliconFlow.',
    '审阅面板支持实时/持久化 diff、单文件打开、刷新恢复和回滚，并过滤图片、视频等二进制文件': 'The Review panel supports live and persistent diffs, opening individual files, refresh recovery, rollback, and binary-file filtering.',
    '输入框上下文状态线实时同步模型、模式、预算和运行阶段；完成头部展示真实缓存 token 与命中率': 'The composer context line syncs the model, mode, budget, and run phase; the completed header shows real cached tokens and hit rate.',
    '新增模型感知的上下文压缩、长期记忆、缓存命中显示和跨会话有限交接': 'Added model-aware context compaction, long-term memory, cache-hit display, and limited cross-session handoff.',
    '设置页加入视觉中继、快速启动（默认 Ctrl+Shift+Y）和移动端 LAN 指引': 'Settings now include vision relay, Quick launch (Ctrl+Shift+Y by default), and mobile LAN guidance.',
    '二代 Yan Agent Pet 实时同步当前任务、状态灯、工作阶段，支持拖动、展开、打开任务和结束任务': 'The second-generation Yan Agent Pet syncs the current task, status light, and work phase, with drag, expand, open-task, and end-task actions.',
    '加入 Yan Prompt Optimizer，用户主动点击时只优化表达，不扩张原始任务': 'Yan Prompt Optimizer improves wording only when explicitly requested and never expands the original task.',
    '旧代码地图能力已进化为开箱即用的 Understand Anything；CodeGraph 作为其底层项目索引继续工作': 'The former code-map capability is now the ready-to-use Understand Anything experience, with CodeGraph as its project index.',
    'Yan Computer Use 已在 v1.6.0 提供；Web UI 不是主要桌面控制面，不建议替代桌面端使用': 'Yan Computer Use is available in v1.6.0; the Web UI is not the primary desktop control surface and should not replace the desktop app.',
    '删除后无法恢复该任务及其对话记录。': 'This task and its conversation cannot be restored after deletion.',
    '仅从左侧任务列表移除，不会删除本机文件或任务记录。': 'Remove it from the task list only; local files and task records will not be deleted.',
    '删除后 Agent 将无法继续调用它，需要重新安装才能恢复。': 'The Agent cannot call it after deletion; reinstall it to restore access.',
    'Agent 将不再为常规操作请求确认，并可使用绝对路径访问本机文件。仅在你完全信任当前任务、模型和工作区时开启。': 'The Agent will stop asking for routine-operation confirmation and can access local files by absolute path. Enable this only when you fully trust the task, model, and workspace.',
    '你在设置中关闭的文件读写与网络权限仍然生效；高风险系统命令仍会被拦截。': 'File, write, and network permissions disabled in Settings still apply; high-risk system commands remain blocked.'
    , '代码辅助': 'Code assistance', 'UI美化': 'UI polish', '网页设计': 'Web design', 'Agent规则': 'Agent rules', '办公辅助': 'Office assistance',
    '编写、理解、审阅与维护代码库': 'Write, understand, review, and maintain codebases',
    '减少错误假设、过度工程化和无关修改的编码 Agent 行为准则': 'Coding Agent guidance that reduces wrong assumptions, over-engineering, and unrelated changes',
    '简化并精炼代码：提升清晰度、一致性与可维护性，严格保持功能不变；默认聚焦最近改动': 'Simplify and refine code for clarity, consistency, and maintainability while preserving behavior; focus on recent changes by default',
    '以深模块、清晰接口和可测试边界设计或改善代码库结构': 'Design or improve codebase structure with deep modules, clear interfaces, and testable boundaries',
    '用本地增量代码图快速理解架构、依赖、调用链、符号关系与改动影响，减少反复搜索和通读文件': 'Use a local incremental code graph to understand architecture, dependencies, call chains, symbols, and change impact without repeated searching',
    '面向疑难故障与性能回退的证据化诊断循环，先定位根因再决定修复': 'Evidence-driven diagnosis for difficult failures and regressions: locate the root cause before fixing',
    '仅在用户明确选择时扫描整个仓库，按收益排序列出可删除、简化或替换的复杂度': 'Scan the entire repository only when selected, then rank complexity that can be removed, simplified, or replaced',
    '仅在用户明确选择时审阅当前差异中的过度设计，并给出可删除或替换项': 'Review over-engineering in the current diff only when selected and list removable or replaceable parts',
    '用 LSP 符号、引用、诊断与符号级编辑完成更小、更准确的代码修改': 'Use LSP symbols, references, diagnostics, and symbol edits for smaller, more accurate code changes',
    '用本地 CodeGraph 图谱浏览项目结构、文件职责、符号关系和影响范围': 'Browse project structure, file responsibilities, symbol relationships, and impact with the local CodeGraph',
    '动效、交互和界面质量提升': 'Motion, interaction, and interface quality',
    '高品质界面动效入口，按任务加载动画实现、动效审阅、机会发现或 Apple 交互模块': 'High-quality interface motion entry point for animation implementation, review, opportunity discovery, or Apple interaction modules',
    'GreenSock 官方 GSAP 动画套装入口，按任务只加载时间线、框架、滚动、插件或性能模块': 'Official GreenSock GSAP motion suite with task-scoped timeline, framework, scroll, plugin, and performance modules',
    'rdev Liquid Glass React 的本地实现参考与接入规则，按需读取源码，不自动安装依赖': 'Local implementation reference and integration rules for rdev Liquid Glass React; read source as needed without installing dependencies',
    '调用 Yan Agent 预装的 React Bits 组件库，为 React 界面加入可复用的文字、背景与交互动效': 'Use the preinstalled React Bits library to add reusable text, background, and interaction motion to React interfaces',
    '反模板的高质量前端设计入口，覆盖布局、排版、颜色、动效与视觉实现质量': 'Anti-template frontend design entry point covering layout, typography, color, motion, and visual quality',
    'NextLevelBuilder 的 UI/UX 设计智能数据库，覆盖样式、色彩、字体、UX 规范、动效、图表和 22 类技术栈': 'NextLevelBuilder UI/UX design intelligence database covering styles, colors, fonts, UX rules, motion, charts, and 22 technology stacks',
    '网页结构、视觉语言与组件实现': 'Web structure, visual language, and component implementation',
    '按品牌单项读取 74 套 DESIGN.md 视觉语言参考，避免把整库塞入上下文': 'Read 74 DESIGN.md visual-language references one brand at a time instead of loading the entire library',
    '调用 Yan Agent 预装的 Uiverse HTML/CSS 片段，为网页加入可直接落地的按钮、卡片、导航与页面区块': 'Use preinstalled Uiverse HTML/CSS snippets for production-ready buttons, cards, navigation, and page sections',
    '搜索、提示词与 Agent 工作规范': 'Search, prompts, and Agent operating rules',
    '通过统一搜索运行时完成实时检索、并行搜索与 URL 内容提取，为 Agent 提供可核验的外部信息': 'Use the unified search runtime for live and parallel search plus URL extraction, giving the Agent verifiable external information',
    '编写稳定、精确且节省上下文的 Skill、AGENTS.md 与 Agent 指令文档': 'Write stable, precise, context-efficient Skills, AGENTS.md files, and Agent instructions',
    '在不扩张意图与任务范围的前提下，让用户 Prompt 更清晰、更可执行': 'Make user prompts clearer and more executable without expanding intent or scope',
    '文档、演示、图表与媒体制作': 'Documents, presentations, charts, and media',
    '用 HTML、CSS 与 GSAP 创建、检查、预览并渲染视频，支持字幕、配音、音频响应和网站转视频': 'Create, inspect, preview, and render videos with HTML, CSS, and GSAP, including captions, voiceover, audio response, and site capture',
    '创建/编辑 Word、Excel、PowerPoint（.docx/.xlsx/.pptx），本地 CLI，无需安装 Office': 'Create and edit Word, Excel, and PowerPoint files locally with CLI tools; Office is not required',
    '用 React 程序化生成视频，覆盖动画、音频、字幕、图表、3D、转场与渲染': 'Programmatically create videos with React, including animation, audio, captions, charts, 3D, transitions, and rendering',
    '内置': 'Built-in', '内置 · 系统托管': 'Built-in · system-managed',
    '隔离式网页自动化与端到端测试。Yan 内置浏览器无法满足脚本化测试需求时再使用。': 'Isolated web automation and end-to-end testing. Use only when the built-in Yan Browser is insufficient for scripted tests.',
    '为当前工作区建立代码图并执行结构化代码检索与理解。': 'Build a code graph for the current workspace and perform structured code search and understanding.',
    '以 LSP 符号、引用、诊断和符号级编辑完成精确的代码定位与修改。': 'Use LSP symbols, references, diagnostics, and symbol edits for precise code location and changes.',
    '通过视觉中继读取本地或历史生成图片，并调用当前会话选定的生图与生视频次模型。': 'Read local or previously generated images through vision relay and call the image/video models selected for this session.',
    '由 Yan Kernel 按当前会话配置托管': 'Managed by Yan Kernel using the current session configuration',
    '查找、安装、列出、读取和删除 Yan 自有 Skill；Blank 中也可使用。': 'Find, install, list, read, and remove Yan-owned Skills; available in Blank too.',
    '控制 Yan 右侧可见的内置浏览器，用于网页阅读、交互与视觉验收。': 'Control the built-in Browser visible in Yan’s right panel for web reading, interaction, and visual acceptance.',
    '在用户明确授权后进入另一工作区的最新 Yan 任务；目标工作区没有任务时才创建并交接上下文。': 'After explicit authorization, enter the latest Yan task in another workspace; create and hand off context only when none exists.',
    '将重复失败、可复用策略或子智能体角色排队，在本轮完成后进行证据化演进；运行中不会改写当前提示。': 'Queue repeated failures, reusable tactics, or subagent roles for evidence-based refinement after this turn; never rewrite the current prompt while running.',
    '文本': 'Text', '暂无已配置的文本模型': 'No configured text models', '生图': 'Image generation', '暂无已配置的生图模型': 'No configured image models',
    '生视频': 'Video generation', '暂无已配置的生视频模型': 'No configured video models', '主题、语言、权限等基础设置': 'Basic theme, language, and permission settings',
    '模型厂商、凭据与兼容端点': 'Model providers, credentials, and compatible endpoints', '选择当前任务默认使用的模型': 'Choose the default model for the current task', 'API 配置': 'API settings',
    '切换侧边栏 (Ctrl+B)': 'Toggle sidebar (Ctrl+B)', '切换侧边栏': 'Toggle sidebar', 'Yan 工作区视图': 'Yan workspace view', '最小化': 'Minimize', '最大化': 'Maximize', '关闭': 'Close',
    '项目视图操作': 'Project view actions', '折叠所有工作区': 'Collapse all workspaces', '未选择工作区': 'No workspace selected', '工作区操作': 'Workspace actions', '任务操作': 'Task actions',
    '打开设置': 'Open settings', '打开桌宠': 'Open pet', '切换浅色模式': 'Switch to light mode', '进入设置页面': 'Open Settings page', '用户设置': 'User settings',
    '选择工作区文件夹': 'Choose workspace folder', '切换 Git 分支': 'Switch Git branch', 'Git 分支': 'Git branch', '刷新 Git 状态': 'Refresh Git status',
    '打开工作区工具 · 终端': 'Open workspace tool · Terminal', '选择工作区工具': 'Choose workspace tool', '工作区工具': 'Workspace tools',
    '在 VS Code 中打开当前工作区': 'Open the current workspace in VS Code', '打开终端': 'Open terminal', '在文件资源管理器中打开': 'Open in File Explorer', '双击重命名任务': 'Double-click to rename task',
    '随时待命，单击展开输入框': 'Standing by; click to expand composer', '展开输入框': 'Expand composer', '对话回合导航': 'Conversation turn navigation', '查看任务待办': 'View task todos', '任务待办': 'Task todos',
    '添加内容': 'Add content', '打开添加面板': 'Open add menu', '添加文件、工作方式或 Skill': 'Add a file, work mode, or Skill', '权限访问：请求批准': 'Permission access: approval required', '当前为常规模式': 'Current mode: General',
    '模型：未选择模型 · 推理速度：标准': 'Model: No model selected · Reasoning speed: Standard', '当前模型 未选择模型，推理速度 标准，点击切换': 'Current model: No model selected, reasoning speed: Standard; click to switch', '模型与推理速度选择': 'Model and reasoning speed selection', '展开模型选择': 'Expand model selection', '返回推理速度滑块': 'Back to reasoning speed', '返回模型选择': 'Back to model selection', '发送': 'Send', '排队对话': 'Queued message', '编辑排队对话': 'Edit queued message', '删除排队对话': 'Delete queued message', '排队发送': 'Queue message', '更新排队对话': 'Update queued message',
    '添加与插件': 'Add-ons and plugins', '选择 Skill': 'Choose Skill', '消息输入': 'Message input', '将输入框收至底部': 'Dock composer at bottom', 'Understand Anything 本地图谱': 'Understand Anything local graph',
    'Skill 市场筛选工具': 'Skill market filters', '搜索 Skill': 'Search Skills', '搜索名称、说明或 ID': 'Search name, description, or ID', 'Skill 分类': 'Skill categories', '创建个人 Skill': 'Create personal Skill', 'Skill 功能分组': 'Skill capability groups', '设置页固定显示侧边栏': 'Keep the sidebar fixed on the Settings page', 'Settings页固定显示侧边栏': 'Keep the sidebar fixed on the Settings page',
    '快捷工具': 'Quick tools', '搜索分支': 'Search branches', '打开 Git 工具': 'Open Git tools', '切换到深色主题': 'Switch to dark theme', '切换到浅色主题': 'Switch to light theme', '关闭桌宠': 'Close pet', '关闭设置': 'Close settings', '打开右侧面板': 'Open right panel', '关闭右侧面板': 'Close right panel', '查看全部': 'View all', '搜索': 'Search', '选择文件夹': 'Choose folder', '选择工作区': 'Choose workspace',
    '关闭添加 Skill 弹窗': 'Close Add Skill dialog', '添加所选 Skill': 'Add selected Skill', '关闭添加服务器弹窗': 'Close Add Server dialog',
    '例如 Playwright': 'For example, Playwright', '例如 npx 或 uvx': 'For example, npx or uvx', '例如 -y @playwright/mcp@latest': 'For example, -y @playwright/mcp@latest',
    '右侧面板标签页': 'Right-panel tabs', '新建标签页': 'New tab', '新建右侧面板标签页': 'New right-panel tab', '全屏显示右侧面板': 'Show right panel full screen', '打开右侧工具': 'Open right-panel tools',
    '打开审阅': 'Open Review', '打开浏览器': 'Open Browser', '打开临时对话': 'Open temporary chat', '关闭侧边面板': 'Close side panel', '侧边面板工具': 'Side panel tools', '刷新审阅': 'Refresh Review', '改动文件': 'Changed files', '文件差异': 'File diff', '行级差异': 'Line diff',
    '辅助对话内容': 'Auxiliary chat content', '临时对话内容': 'Temporary chat content', '当前任务未在工作': 'Current task is not running', '关闭 Git 弹窗': 'Close Git dialog', '关闭提交弹窗': 'Close Commit dialog',
    '留空将自动生成': 'Leave blank to generate automatically', '智能生成提交信息': 'Generate commit message with AI', '刷新 Git 图谱': 'Refresh Git graph', '上下文 token 使用率': 'Context token usage', '设置分类': 'Settings categories',
    '生成图像模型，当前未选择': 'Image generation model, currently not selected', '生成视频模型，当前未选择': 'Video generation model, currently not selected',
    '关闭连接配置': 'Close connection settings', '显示 API Key': 'Show API key', '例如 deepseek-chat': 'For example, deepseek-chat', '测试连接并拉取模型目录': 'Test connection and fetch model catalog',
    '壁纸昵称': 'Wallpaper nickname', '关闭视觉中继说明': 'Close vision relay guide', '让Yan Agent记住你的名字': 'Let Yan Agent remember your name',
    '允许读取文件': 'Allow reading files', '允许写入文件': 'Allow writing files', '允许执行命令': 'Allow running commands', '允许网络访问': 'Allow network access', '选择桌宠': 'Choose desktop pet',
    '修改快速启动快捷键': 'Change Quick launch shortcut', '删除壁纸': 'Delete wallpaper',
    '材质强度': 'Material strength',
    '例如：爽快': 'For example: Direct', '例如：没素质，爽快': 'For example: Blunt and direct',
    'A：任务期间请勿随意更改模型配置': 'A: Do not change model configuration during a task',
    '深度求索中……': 'Deep Diving……',
    '健康': 'Health', '本地健康管理，数据只保存在本机': 'Local health tracking. Data stays on this device.',
    '今日概览': "Today's overview", '快速记录': 'Quick log', '日期': 'Date', '7 天趋势': '7-day trend',
    '饮水': 'Water', '睡眠': 'Sleep', '体重': 'Weight', '运动': 'Exercise', '心情': 'Mood', '目标': 'Goals',
    '饮食': 'Meals', '备注': 'Note',
    '保存目标': 'Save goals', '导出数据': 'Export data', '记录': 'Save', '添加': 'Add', '保存': 'Save',
    '很差': 'Awful', '较差': 'Poor', '一般': 'Okay', '不错': 'Good', '很好': 'Great',
    '清空今日': 'Clear today', '确定清空今天的记录？': "Clear today's records?",
    '还没有记录，从下面记第一笔开始': 'No records yet. Start with a quick log below.',
    '也可以直接对 Agent 说：记录我今天喝了 500ml 水': 'You can also tell the Agent: log 500ml of water for today',
    '数据目录': 'Data folder', '加载中……': 'Loading…', '已记录': 'Saved', '已导出数据': 'Exported',
    '目标已更新': 'Goals updated', '操作失败': 'Action failed', '请输入有效数值': 'Enter a valid number',
    '例如：燕麦粥 + 鸡蛋': 'e.g. oatmeal + eggs', '今天身体感觉如何': 'How does your body feel today',
    '周日': 'Sun', '周一': 'Mon', '周二': 'Tue', '周三': 'Wed', '周四': 'Thu', '周五': 'Fri', '周六': 'Sat',
    '点击左侧边栏': 'Click', '查看引导': 'in the left sidebar to open the guide'
  });
  const attributeFragments = Object.freeze(Object.keys(ZH_EN)
    .filter(key => key.length >= 2)
    .sort((a, b) => b.length - a.length));

  const textState = new WeakMap();
  const attrState = new WeakMap();
  let language = 'zh-CN';
  let applying = false;
  let observer = null;

  function normalize(value) {
    return String(value || '').trim().toLowerCase() === 'en' ? 'en' : 'zh-CN';
  }

  function translate(value, target = language) {
    const source = String(value ?? '');
    if (normalize(target) !== 'en' || !/[\u3400-\u9fff]/u.test(source)) return source;
    const exact = ZH_EN[source.trim()];
    if (exact) return source.replace(source.trim(), exact);
    const context = source.match(/^上下文约\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*tokens（自动压缩阈值）$/u);
    if (context) return `Context ${context[1]} / ${context[2]} tokens (automatic compaction threshold)`;
    const remaining = source.match(/^距离自动压缩还有\s*(.+)$/u);
    if (remaining) return `Compaction in ${remaining[1]}`;
    const reachedLine = source.match(/^已达到自动压缩线\s*(.+)$/u);
    if (reachedLine) return `Compaction line ${reachedLine[1]} reached`;
    const beyondLine = source.match(/^已超过安全线\s*(.+)，下次请求会先压缩早期对话$/u);
    if (beyondLine) return `Beyond the safety line ${beyondLine[1]}; the next request compacts early turns first`;
    const replying = source.match(/^回包中\s*(.+)$/u);
    if (replying) return `Replying ${replying[1]}`;
    const handled = source.match(/^已处理\s*(.+)$/u);
    if (handled) return `Handled ${handled[1]}`;
    const response = source.match(/^回包时间\s*(.+)$/u);
    if (response) return `Reply time ${response[1]}`;
    const childTool = source.match(/^子代理正在执行\s*(.+)$/u);
    if (childTool) return `Subagent executing ${childTool[1]}`;
    const childStarted = source.match(/^(.+)已开始工作$/u);
    if (childStarted) return `${childStarted[1]} started working`;
    const completed = source.match(/^已完成\s*(\d+\/\d+)$/u);
    if (completed) return `Completed ${completed[1]}`;
    const todoProgress = source.match(/^第\s*(\d+\/\d+)\s*已完成$/u);
    if (todoProgress) return `Completed ${todoProgress[1]}`;
    const changed = source.match(/^(已编辑|已撤销)\s*(\d+)\s*个文件$/u);
    if (changed) return `${changed[1] === '已撤销' ? 'Reverted' : 'Edited'} ${changed[2]} file${changed[2] === '1' ? '' : 's'}`;
    const moreChangedFiles = source.match(/^(再显示|收起)\s*(\d+)\s*个文件$/u);
    if (moreChangedFiles) return `${moreChangedFiles[1] === '收起' ? 'Show fewer' : 'Show'} ${moreChangedFiles[2]} file${moreChangedFiles[2] === '1' ? '' : 's'}`;
    const changedLines = source.match(/^新增\s*(\d+)\s*行[，,]\s*删除\s*(\d+)\s*行$/u);
    if (changedLines) return `Added ${changedLines[1]} line${changedLines[1] === '1' ? '' : 's'}, deleted ${changedLines[2]} line${changedLines[2] === '1' ? '' : 's'}`;
    const files = source.match(/^(\d+)\s*个文件$/u);
    if (files) return `${files[1]} file${files[1] === '1' ? '' : 's'}`;
    return source;
  }

  function translateAttribute(value) {
    const source = String(value ?? '');
    const exact = translate(source);
    if (!/[\u3400-\u9fff]/u.test(exact)) return exact;
    const skillDetail = source.match(/^查看\s+(.+)\s+的 Skill 详情$/u);
    if (skillDetail) return `View ${skillDetail[1]} Skill details`;
    const skillInstalled = source.match(/^(.+)\s+已安装$/u);
    if (skillInstalled) return `${skillInstalled[1]} installed`;
    const rollbackRun = source.match(/^撤销本轮\s*(\d+)\s*个文件改动$/u);
    if (rollbackRun) return `Undo changes to ${rollbackRun[1]} file${rollbackRun[1] === '1' ? '' : 's'} from this run`;
    const mediaSelection = source.match(/^(生成图像模型选择|生成视频模型选择)[，,]\s*当前(.+)$/u);
    if (mediaSelection) return `${mediaSelection[1] === '生成图像模型选择' ? 'Image generation model' : 'Video generation model'}, current ${translate(mediaSelection[2]).trim()}`;
    const testConnection = source.match(/^测试\s+(.+)\s+连接$/u);
    if (testConnection) return `Test ${testConnection[1]} connection`;
    const relayCheck = source.match(/^检查(.+)配置状态，当前(.+)$/u);
    if (relayCheck) return `Check ${translate(relayCheck[1]).trim()} configuration, currently ${translate(relayCheck[2]).trim()}`;
    const deleteLabel = source.match(/^删除(.+)$/u);
    if (deleteLabel) return `Delete ${translate(deleteLabel[1]).trim()}`;
    let result = source;
    for (const key of attributeFragments) {
      if (result.includes(key)) result = result.split(key).join(ZH_EN[key]);
    }
    return result;
  }

  function shouldSkip(node) {
    const parent = node.parentElement;
    if (!parent) return true;
    if (parent.closest('script, style, noscript, pre, code, textarea, input, select')) return true;
    if (parent.closest('.msg.user .msg-body, .user-message, .agent-markdown, [data-preserve-language]')) return true;
    return false;
  }

  function applyText(node) {
    if (!node?.nodeValue || shouldSkip(node)) return;
    let record = textState.get(node);
    const current = node.nodeValue;
    if (!record || current !== record.translated) {
      record = { source: current, translated: current };
      textState.set(node, record);
    }
    const next = language === 'en' ? translate(record.source) : record.source;
    if (next !== current) {
      record.translated = next;
      applying = true;
      node.nodeValue = next;
      applying = false;
    } else {
      record.translated = current;
    }
  }

  function applyAttribute(element, name) {
    if (!element || element.closest?.('script, style, pre, code, [data-preserve-language]')) return;
    const value = element.getAttribute(name);
    if (value == null || !/[\u3400-\u9fff]/u.test(value)) return;
    let record = attrState.get(element);
    if (!record) { record = {}; attrState.set(element, record); }
    if (!record[name] || value !== record[name].translated) record[name] = { source: value, translated: value };
    const next = language === 'en' ? translateAttribute(record[name].source) : record[name].source;
    if (next !== value) {
      record[name].translated = next;
      applying = true;
      element.setAttribute(name, next);
      applying = false;
    } else record[name].translated = value;
  }

  function visit(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(applyText);
    const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll('*')];
    elements.forEach(element => ['title', 'aria-label', 'placeholder', 'alt', 'data-placeholder'].forEach(name => applyAttribute(element, name)));
  }

  function apply(nextLanguage, root = document) {
    language = normalize(nextLanguage);
    visit(root);
    if (language === 'en' && !observer && root?.body) {
      observer = new MutationObserver(records => {
        if (applying) return;
        for (const record of records) {
          if (record.type === 'characterData') applyText(record.target);
          else record.addedNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) applyText(node);
            else if (node.nodeType === Node.ELEMENT_NODE) visit(node);
          });
          if (record.type === 'attributes') applyAttribute(record.target, record.attributeName);
        }
      });
      observer.observe(root.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder', 'alt', 'data-placeholder'] });
    }
    if (language !== 'en' && observer) {
      observer.disconnect();
      observer = null;
    }
    return language;
  }

  global.YanI18n = Object.freeze({ apply, normalize, translate, dictionary: ZH_EN });
  const initialLanguage = new URLSearchParams(global.location?.search || '').get('lang');
  if (initialLanguage) {
    document.documentElement.lang = normalize(initialLanguage);
    document.documentElement.dataset.language = normalize(initialLanguage);
    if (document.body) apply(initialLanguage, document);
    else document.addEventListener('DOMContentLoaded', () => apply(initialLanguage, document), { once: true });
  }
})(window);
