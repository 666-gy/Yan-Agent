# Yan Agent

> 面向真实工作区的 Windows 桌面 Agent。它可以理解任务、调用工具、修改项目、验证结果，并把可核对的结果交付给用户。

![Version](https://img.shields.io/badge/version-1.4.0-111111)
![Platform](https://img.shields.io/badge/platform-Windows-2563eb)
![Electron](https://img.shields.io/badge/Electron-31-47848f)
![License](https://img.shields.io/badge/license-MIT-16a34a)

[English README](README_EN.md)

## 版本定位

1.4.0 是从 1.3.2 到 **Yan Kernel** 的一次完整运行时升级，而不是单纯的 UI 或模型目录更新。Yan Kernel 是 Yan Agent 的正式内核，基于 OpenCode 内核二次开发，并加入 Yan 自己的工作区、权限、Skill、MCP、内置浏览器、多模态、记忆、审阅和桌面交互能力。

当前仓库描述的是 1.4.0 代码状态。模型是否可用、接口是否收费、是否需要 VPN，始终以用户配置的真实 API 和网络环境为准；README 不把目录中的模型名、价格或免费额度当成服务承诺。

## Yan Agent 是什么

Yan Agent 是一个面向真实工作区的 Windows 桌面 Agent：主文本模型负责理解用户、规划和交付，Yan Kernel 负责把模型连接到受权限约束的工具、工作区和验证流程。它不是某一个厂商模型的别名，也不是 OpenCode 的原样包装。

Yan Agent 的产品定位可以概括为：

- **是谁：** Yan Agent；运行内核是 Yan Kernel，基于 OpenCode 二次开发；当前对话模型仍按真实的厂商和模型 ID 说明。
- **能做什么：** 读写选定工作区、运行终端命令、使用 Yan Skills 和 MCP、操控 Yan 内置浏览器、理解图片、生成/编辑图片和视频、进行目标验收、保留记忆并展示审阅结果。
- **长处是什么：** 工具和权限有明确边界，浏览器优先使用 Yan 内置浏览器，媒体模型不抢走文本上下文，目标模式只做原始要求内的定点验收，最终回答以工具证据和工作区事实为准。
- **不能假装什么：** 没有配置的模型、MCP、Skill、余额、网络或 VPN 不会被声称为可用；无法验证的结果会明确标为未验证或失败。

当用户问“你是谁”“Yan Agent 是什么”“你用了什么内核”时，产品身份、内核身份和当前实际使用的厂商模型会分别说明；上游 OpenCode 只作为实现基础出现。

## 1.4.0 完整更新

### 1. Yan Kernel 运行时

- **全新 Yan Kernel。** Yan Kernel 是 Yan Agent 的唯一执行权威，基于 OpenCode 内核二次开发；`lib/opencode-sidecar.js` 负责会话、工具、权限、验收和总结，旧的 `renderer/kernel/*` Agent 循环不再参与任务执行。
- **运行时事件结构化。** 模型消息、工具调用、工具结果、权限请求、提问、压缩、目标验收、中间插话、媒体生成和错误都以事件流传给桌面端，避免 UI 只显示静态“正在工作”。
- **DeepSeek DSML 兼容。** Yan Kernel 可以接收 DeepSeek 的 DSML 工具调用，经过 provider 适配、恢复和校验后转换为真实工具调用；协议标记不会泄露到用户正文中。
- **权限与提问可回传。** 用户可以在任务中批准、拒绝或回答 Agent 的请求；权限策略和任务状态由主进程持有，不由渲染层自行猜测。
- **最终总结独立生成。** 工作阶段完成后，内核使用无工具的总结阶段，只依据当前会话、工具结果和工作区的已验证事实生成交付文本，不把内部工作日志冒充最终答案。
- **错误收尾和重复错误熔断。** 断流、空响应、MCP 启动失败、工具错误和模型错误会结束为可见的错误状态；同类错误持续重复时会停止继续消耗，而不是无限重试。
- **上下文压缩接入内核。** OpenCode 按当前模型上下文窗口管理预算，在接近软阈值时压缩会话；压缩前后 token、阈值、上下文窗口和压缩次数会被记录并可在 UI 中看到。
- **运行结果可审计。** 每次运行保留 OpenCode 会话 ID、工具事件、用量、变更摘要和最终状态，方便刷新、恢复和审阅。

当前 Yan Kernel 使用 OpenCode `1.18.11` 作为底层运行时组件。OpenCode 是实现基础，不是 Yan Agent 的产品身份；工作区、权限、工具暴露、输出和 UI 状态均由 Yan Kernel 管理。

### 2. 三种工作方式与目标验收

| 模式 | 行为 | 适用场景 |
| --- | --- | --- |
| 常规 | 直接理解、调用工具并交付 | 问答、查资料、一次性修改 |
| 计划 | 先形成只读计划，用户确认后再执行 | 多步骤改造、需要先审方案 |
| 目标 | 第一轮完成后按原始要求进行定点验收；有证据证明问题才修复，再次验收 | 小游戏、网页、项目级任务 |

目标模式的验收约束：

- 只检查用户明确提出的要求和必要的可运行性，不主动扩展玩法、重做 UI、增加功能或进行无关重构。
- 只在存在具体失败证据时进入修复轮；修复优先定位到相关文件和位置，使用最小修改，不把整个项目重写一遍。
- 通过浏览器或命令获得可复核证据后才结束；“命令执行成功”“像素数量变化”或模型自己的猜测都不能单独作为网页、Canvas、WebGL、动画或 3D 任务的验收证据。
- 最多进行 6 轮目标验收。达到稳定通过、用户要求结束，或达到上限后，都会进入最终总结并说明证据和未解决项。

### 3. 工作区、Blank 与跨会话

- 每个任务拥有独立的工作区、终端目录、OpenCode 会话、工具映射快照和运行状态。
- **Blank 任务允许无磁盘写入的工作。** 问答、网页阅读、打开软件、内置浏览器操作、媒体生成和 Yan Skill 安装可以在 Blank 中进行。
- **涉及用户文件写入时必须先选工作区。** 创建、修改、删除、下载、保存代码或文档等操作在 Blank 中会直接结束并提示选择工作区，不会把 Blank 偷偷切到某个已有目录，也不会影响其他 Blank 任务。
- Yan Skill 安装是例外：Skill 只允许写入 Yan 自己管理的 Skill 根目录，Blank 不会阻止安装、查找、调用或删除 Yan Skill。
- 任务工作区内的路径解析、Shell 执行和审阅变更都受工作区沙箱约束。跨出工作区需要对应权限和明确路径。
- 从 Blank 进入工作区需要用户选择并授权；从工作区 A 切到 B 也需要显式授权。跨工作区不会复用另一工作区的权限。
- 跨会话交接使用 `Yan Session` MCP。交接会带入有限的历史消息、目标和结果，但不会带入权限、运行中的工具、审批结果或文件系统授权。
- 回到父级或子级工作区时，优先进入该工作区最近更新的已有任务；只有目标工作区没有任务时才创建新任务。

### 4. 权限与高风险命令

输入框提供三种访问策略：

- **请求批准：** 需要副作用操作时向用户请求批准。
- **替我审批：** 常规命令按策略自动通过，高风险命令仍在右侧权限面板中询问用户。
- **完全访问：** 在用户确认后放宽常规读写和命令审批，但仍保留工作区边界、高风险命令分类和系统安全限制。

权限请求使用折叠面板而不是强制弹窗，显示即将执行的命令，并提供“总是允许 / 本次允许 / 拒绝”。权限状态由主进程与当前运行绑定，下一轮对话不会因为工具列表重新生成而失去已授权能力。

### 5. Yan Agent Interrupt

任务工作期间可以点击输入框任务栏中的 **Yan Agent Interrupt**，在不停止主任务的情况下发送一条插话。内核会让隔离的观察者判断这条插话属于：

- **检查类：** 询问当前是否仍在下载、等待、运行或发生错误；主任务继续工作，观察结果只报告真实状态。
- **引导类：** 提醒 Agent 换方向、换工具、查看页面或缩短验收；指导会在下一个检查点交给当前运行。
- **结束类：** 用户明确要求交付或停止可选工作时，主任务会优雅地结束可选步骤并进入总结，不会被普通询问误杀。

插话不会把主会话改造成第二个独立任务，也不会绕过当前权限和工作区规则。

### 6. 工具、MCP 与 Skill

内核会根据任务需要暴露能力；没有被需要或没有配置的服务不会伪装成可用工具。

| 内置能力 | 用途 |
| --- | --- |
| Yan Built-in Browser | 打开、读取、点击、输入、选择、勾选、悬停、拖拽、滚动、等待、截图、检查页面、历史和状态 |
| Playwright | 仅在内置浏览器无法满足隔离脚本自动化时作为后备 |
| Yan Skills | 查找、读取、安装、列出、移除 Yan 管理的 Skill 和设计参考 |
| CodeGraph | 工作区代码图、索引和结构关系 |
| Serena | 工作区代码定位和定点编辑辅助；按工作区、目标模式或用户明确选择启用 |
| Yan Media | 读图、生成图片、生成视频 |
| Yan Session | 跨工作区和跨会话交接 |
| Understand Anything | 开箱即用地打开 CodeGraph 生成的项目知识图谱 |
| OfficeCLI / AnySearch | 办公文档流程和联网搜索 Skill；是否可用取决于安装与网络配置 |

用户添加的 MCP 服务可以在设置页填写启动命令与参数，测试连接、启用/停用并删除。MCP 通过 JSON-RPC 2.0 over stdio 接入，每个任务保存自己的工具快照，任务之间不会互相覆盖 MCP 配置。

#### Yan Skill 目录规则

Yan Agent 的 Skill 查找、安装、调用和删除只使用 Yan 自己的 Skill 根目录。不会自动读取 `.codex/skills`、外部应用的 `.agents/skills` 或其他 Agent 的目录。用户若要为其他软件安装 Skill，必须在提示中提供目标软件和目标目录等信息；这不等同于安装 Yan Skill。

Skill 市场的分类和当前目录以应用内市场为准，当前包括：

- 代码辅助
- UI 美化
- 网页设计
- Agent 规则
- 办公辅助

内置 Skill、已安装 Skill、可导入的自定义 Skill 分开显示。Skill 选择会作为输入正文中的可移除 token 进入任务；按 Backspace 可以移除，Skill 不会被无条件置顶到系统提示中。当前实际可用目录以 `lib/skills/bundled` 和应用 Skill 市场为准，不在 README 固定数量。

### 7. 内置浏览器与网页验收

- **ChatGPT 风格的内置浏览器工作面板。** 右侧浏览器按“用户标签页 / Agent 标签页 / 当前控制状态 / 页面工具栏”的交互范式重做，Agent 不会抢走用户正在看的页面。
- 内置浏览器位于 Yan 右侧栏，Agent 会新开自己的标签页，不抢占用户正在看的页面。
- 浏览器 MCP 是普通研究、URL 阅读、本地 HTML 预览、交互和视觉验收的首选。只有确实需要隔离脚本或内置浏览器无法完成的操作时，才降级到 Playwright；外部 Chrome 不是默认验收路径。
- Agent 浏览器调用会携带当前运行归属，避免多个任务并行时工具串线。
- 浏览器支持显式等待、页面检查、截图和交互证据。等待网络页面时应使用页面状态和合理等待，而不是用一次过短延迟判断“没有打开”。
- **完整页面操控。** Agent 可以打开 URL、读取页面、查看快照、点击、输入、选择、勾选、聚焦、悬停、拖拽、移动专属指针、按键、滚动、等待、截图、检查页面、读取历史和查询状态；这些操作都通过 Yan 内置浏览器 MCP 暴露给内核。
- Agent 接管页面时显示控制态和底部提示，用户可按 Esc 退出控制；当前标签页在控制期间限制普通用户操作，但允许刷新或关闭。
- Canvas、WebGL、动画和 3D 页面必须结合真实点击/键盘交互、截图和可见状态验收；DOM 存在、控制台干净、哈希变化、颜色数量变化或单帧像素变化都不足以证明页面真的可玩或正在渲染。

1.4.0 **不包含完整的 Windows Computer Use**。旧的本机鼠标宿主、电脑操控覆盖层和相关 Skill 已移除；完整的 Yan Computer Use 计划在后续版本以独立后端/MCP 重新实现，不能把本版本的浏览器自动化误认为整机操控。

### 8. 文本、视觉、图片和视频模型

Yan 将模型角色拆为三类，互不抢占上下文：

1. **主模型 / 文本模型：** 负责理解用户、规划、工具调用、代码修改和最终回答。
2. **生图模型：** 负责生成或编辑图片，结果回到主模型上下文，由主模型向用户解释和交付。
3. **生视频模型：** 负责生成或编辑视频，结果同样回到主模型上下文。

图片和视频次模型可以不选。对话中修改此前生成的媒体时，优先复用当前会话保存的资源 ID，无需用户下载再上传。支持的图片比例包括 `auto`、`1:1`、`4:3`、`3:4`、`3:2`、`2:3`、`16:9`、`9:16`、`21:9`。

生成图片或视频后不会因为“结果存在”而自动调用 `read_image` 再读一遍；只有任务确实需要视觉理解、主模型不能读图或用户明确要求时，才会走视觉中继或读图工具。

模型目录和能力判断：

- OpenAI、Grok、Agnes、GLM、SiliconFlow 会尽量从已配置 API 动态读取模型目录。
- 其他厂商可以使用内置回退目录，并在实现支持时刷新；回退目录只用于配置界面，不等于远端一定提供该模型。
- 模型会按文本、视觉输入、图片输出、视频输出等能力分类。模型 ID 的推断不能替代真实接口验证，厂商端点、请求格式、余额、配额和网络仍可能导致调用失败。
- 应用不展示模型价格、免费额度或长期可用性承诺；实际账单、限流和访问地区以服务商为准。
- GLM 的媒体模型会单独合并到媒体目录，因为某些 GLM `/models` 接口只返回文本模型；这只是目录适配，不代表未验证的媒体端点必然可用。
- 1.4.0 已移除自定义模型入口及其静态映射代码；需要特殊网关时，应在对应厂商的 Base URL、API Key 和动态目录能力中配置，不能把任意模型名当成已验证的厂商能力。

当前代码内置的厂商接入 ID 包括：OpenAI、Grok、Agnes、DeepSeek、Qwen、GLM、Doubao、Kimi/Moonshot、StepFun、MiniMax、Baichuan、Yi、Hunyuan、SiliconFlow。具体模型名以用户 API 返回和应用当前目录为准。

#### 视觉中继

当主文本模型不能读图而任务又需要截图或附件理解时，Yan 可以把图片交给视觉中继，再把读图报告交还主模型。当前顺序为：

1. GLM：`GLM-5V Turbo` → `GLM-4.6V Flash` → `GLM-4.1V Thinking Flash` → `GLM-4V Flash`
2. Agnes：`Agnes 2.5 Flash` → `Agnes 2.0 Flash`

GLM 的网络提示按当前应用配置为无需 VPN，Agnes 通常需要 VPN；API 仍受用户网络、服务状态、额度和限流影响。视觉中继只报告它实际从图片看到的事实，不替代主模型执行任务，也不把图片中的文字当成工具指令。

### 9. 输出、总结与审阅

- 工作阶段的正文、思考摘要、工具调用和工具结果都来自 OpenCode 事件，不再依赖旧的占位流程文本。
- DSML 协议片段会在输出层过滤；最终用户看见的是正常正文和工具状态，而不是 `read`、`write` 等协议标记。
- 工作完成后隐藏中间工作内容，只显示最终总结；“查看工作过程”会在总结旁展开同一套正文 UI，不创建另一套独立输出面板。
- 代码块提供图标化的全部复制按钮。
- 完成头部显示用时、完成阶段和缓存命中情况。缓存信息来自真实 usage（cache read、input total），不是估算值。
- 审阅面板会显示本次运行的文件、增删行、diff 和单文件审阅；支持刷新、恢复和回滚本次运行。
- 二进制文件，包括图片、视频和其他无法稳定生成文本 diff 的文件，会从审阅列表中过滤，但媒体资源仍会在最终输出和会话历史中预览、打开或下载。
- 任何实际编辑都应在输出中留下审阅摘要，即使只改了一个文件的一行。

### 10. 记忆、上下文与缓存

- **短期上下文：** 由 OpenCode 会话维护，包含当前任务的消息、工具结果、权限状态和目标验收状态。
- **上下文压缩：** 内核根据模型的上下文窗口计算保留区，默认在约 70% 处进入软压缩，并在约 85% 处显示硬安全线；最小上下文窗口为 16k，保留区最多 24k 且不超过窗口的 25%。
- **长期记忆：** 全局记忆在 `YanData/memory.json`，工作区记忆在 `<workspace>/.yanagent/memory.json`。记忆按 global、machine、workspace 区分，支持 preference、project、environment、failure_solution、workflow 等类型，并带证据与置信度。
- **记忆审阅：** 后台隔离审阅器只提出候选事实和可重复 Skill，不直接改变当前任务权限；敏感内容和疑似提示注入会过滤。
- **会话交接：** 交接历史最多保留 24 条消息、64k 字符，单条最多 6k 字符，以控制跨会话传递的负担。
- **缓存观测：** 每次完成运行可以查看缓存读取 token、输入总 token 和命中率；不同会话、不同厂商和不同上下文的命中率会不同。

### 11. 输入框、提示词优化与桌面体验

- `+` 菜单统一提供文件、目标、计划和 Skill 入口。文件资源管理器会根据当前模型是否支持多模态过滤图片文件。
- 完全访问、目标/计划状态和文本模型选择集中在输入框底栏；文本、图片、视频模型角色可以分别选择。
- 推理速度保留 `标准 / 高效 / 更智能` 三档，并使用原有拖拉式交互；当前配置会实时回写输入框状态线。
- **Yan Prompt Optimizer。** 输入框的“优化 prompt”按钮调用内置 `yan-prompt-optimizer` Skill，只在用户主动使用或明确选择时介入。它会保留原始意图、语气、路径、URL、代码、数字、模型名和约束，只修正歧义、顺序和可执行性，不凭空添加功能、依赖、工具或验收标准。
- 设置页包括 API 配置、模型库存、视觉中继、权限、口吻、快速启动、移动端远程和关于。
- 口吻支持最多 4 个用户配置，每个配置有昵称和具体语气。用户可以设置直接、戏谑或其他表达方式；口吻只控制表达，不改变权限、安全边界或事实要求。删除口吻后自动回到前一个可用口吻。
- 快速启动通过系统托盘和全局快捷键唤醒 Yan，默认快捷键为 `Ctrl+Shift+Y`，支持自定义。
- 移动端提供 LAN 控制页、密码、任务切换、图片上传和结果预览；页面显示 `http://你的电脑ip:3847`，并说明如何使用 `Win+R -> cmd -> ipconfig` 查询 IPv4 地址。
- 桌面宠物显示待命、工作中、需要注意、已暂停、已完成和运行异常等状态，可展开当前任务或停止任务。
- 内置终端使用真实 PTY；当前界面标签为 PowerShell。PowerShell 7 专属运行时不属于 1.4.0 的承诺范围。

#### 二代 Yan Agent Pet

1.4.0 的桌面宠物是第二代 Yan Agent Pet，不再是与内核脱节的静态装饰：

- 桌宠名称后跟随实时状态灯，状态来自当前 Yan Kernel 任务，而不是旧内核的固定文案。
- 支持待命、工作中、需要注意、已暂停、已完成和运行异常，并同步当前任务标题与当前阶段。
- 单击桌宠展开/收起状态面板，拖动桌宠可移动位置；面板提供图标化的打开任务和结束任务按钮。
- 工作状态由真实 workflow 映射，例如理解请求、读取、思考、写入、编译/测试、浏览器验收和总结，不把“正在理解任务”当成所有阶段的万能占位。

#### 完整多模态链路

多模态不是“切换一次模型就丢上下文”：

- 文件入口按主模型能力决定是否显示图像资源；支持视觉输入的主模型可以直接收到图片，文本模型则走 Yan 视觉中继。
- 主文本模型、次图像模型、次视频模型可以同时存在。次模型负责媒体，主模型继续负责对话、工具和最终解释。
- 生成、编辑、预览、打开、下载和会话持久化是一条链路；同一会话后续修改媒体时复用资源 ID，不要求用户下载后重新上传。
- 视觉中继、图片生成和视频生成的结果会进入工作结果与最终总结，成功生成图片不会自动再调用 `read_image` 消耗一次读图请求。

#### 上下文状态与缓存 UI

- 输入框上下文状态线实时反映当前模型、工作模式、上下文预算和运行状态，不依赖用户刷新任务。
- 上下文接近软阈值时，Yan Kernel 触发模型感知压缩；压缩事件显示前后 token、阈值、上下文窗口和次数。
- 已完成运行的头部展示真实缓存读取量、输入总量和缓存命中率，用户可以按会话比较实际命中情况；不会用固定百分比伪造省度数据。

### 12. 代码理解与 Yan 生态

- **Understand Anything：** 旧代码地图能力已经进化为开箱即用的 Understand Anything。工作区初始化 CodeGraph 后，Yan 会把项目结构转换为 `.ua/knowledge-graph.json`、`config.json` 和 `meta.json`，并在应用内打开可视化知识图谱。
- **CodeGraph：** 作为 Understand Anything 的底层项目索引和关系数据源，数据库位于 `.codegraph/codegraph.db`，用户无需再手动维护旧版代码地图 UI。
- **Yanxi Code：** 可以把当前工作区交接给 Yanxi Code；交接在冷启动和已运行状态下都保留工作区回执。

## 内置 MCP 参考

以下是 1.4.0 代码内置或由 Yan 管理的主要 MCP。实际暴露给某次运行的工具集合还会受任务类型、工作区、权限、Skill 和 API 配置影响。

| MCP | 主要工具/能力 |
| --- | --- |
| Yan Built-in Browser | `open_builtin_browser`、`browser_snapshot`、`browser_read_page`、`browser_click`、`browser_type`、`browser_select`、`browser_check`、`browser_hover`、`browser_focus`、`browser_drag`、`browser_pointer`、`browser_press`、`browser_scroll`、`browser_wait`、`browser_screenshot`、`browser_inspect_page`、`browser_history`、`browser_status` |
| Yan Skills | `find_skills`、`install_skill`、`list_installed_skills`、`read_skill`、`list_design_references`、`read_design_reference`、`remove_skill` |
| Yan Media | `read_image`、`generate_image`、`generate_video` |
| Yan Session | `create_handoff`、`read_source_context` |
| CodeGraph | 工作区代码图和索引 |
| Serena | 代码定位和定点编辑，按条件启用 |
| Playwright | 内置浏览器不足时的隔离脚本后备 |

MCP Server 的状态、连接测试、启用/停用和自定义配置都在设置页完成。服务不可用时，Yan 会显示连接错误，不会把未连接服务伪装成可调用工具。

## 内置 Skill 参考

Skill 的完整名称、版本、来源、标签和安装状态以应用 Skill 市场为准。当前仓库包含的主要能力包包括：

- **代码辅助：** `code-simplifier`、`yan-serena`、`yan-prompt-optimizer`、`diagnosing-bugs`、`codebase-design`、`yan-codegraph`、`yan-understand-anything`、Andrej Karpathy skills 等。
- **UI 美化：** Hallmark、TasteSkill 系列、`liquid-glass-react`、Apple Design、Ponytail 审阅/审计等。
- **网页设计与动效：** Awesome Design MD、`animate`、GSAP 系列、`review-animations`、`find-animation-opportunities`、Emil Motion 等。
- **视频与媒体：** HyperFrames、HyperFrames CLI、Registry、Website to HyperFrames、Remotion best practices。
- **办公辅助与搜索：** OfficeCLI、AnySearch。
- **Agent 规则与扩展：** `writing-for-agents`、`skill-creator` 及相关规则包。

第三方 Skill 会保留来源和许可说明，详见 `lib/skills/THIRD_PARTY_NOTICES.md`。不要把 Skill 的存在当成当前任务自动加载；只有模型使用、用户选择或能力判断需要时，才会把它暴露给运行。

## 快速开始

### 运行源码

环境要求：

- Windows 10/11
- Node.js 18 或更高版本
- npm 9 或更高版本
- 可选：Git、编译工具，以及用户需要的 MCP/Skill 运行依赖

```powershell
git clone https://github.com/666-gy/Yan-Agent.git
cd Yan-Agent
npm install
npm start
```

首次使用：

1. 打开 `设置 -> API 配置`，选择真实厂商并填写 API Key、Base URL（如服务商要求）。
2. 在 `设置 -> 模型` 检查动态目录和模型能力分类。
3. 新建任务。问答、浏览和 Skill 安装可留在 Blank；要创建或修改用户文件时先选择工作区。
4. 在输入框选择常规、计划或目标模式，按需选择 Skill、推理速度和访问策略。
5. 等待工作阶段、验证阶段和最终总结；需要时展开工作过程或打开审阅。

### 构建

```powershell
npm run bundle:opencode-provider
npm run build              # Windows 安装包
npm run build:portable     # Windows 便携包
```

构建脚本会打包 DeepSeek DSML provider，并运行 provider/codegraph 运行时校验。发布包中的 API 可用性仍需在目标电脑配置真实凭据和网络环境后确认。

### 发布包

1.4.0 的安装版和便携版应以项目的 GitHub Releases 页面为准；在正式发布前不要使用 README 中旧版本的下载地址：

<https://github.com/666-gy/Yan-Agent/releases>

## 数据与目录

| 位置 | 内容 |
| --- | --- |
| Electron 用户数据目录下 `YanData/` | API 配置、会话、任务日志、生成媒体、全局记忆和 Skill 状态 |
| `YanData/memory.json` | 全局长期记忆 |
| `<workspace>/.yanagent/memory.json` | 工作区长期记忆和相关运行数据 |
| `<workspace>/.codegraph/codegraph.db` | CodeGraph 数据库 |
| `<workspace>/.ua/` | Understand Anything 知识图谱桥接文件 |
| Yan Skill 根目录 | Yan 管理的内置、已安装和用户导入 Skill |

删除任务不会自动删除整个工作区。卸载器中的“清除本机所有 Yan Agent 数据”会清理 Yan 的用户数据、会话、配置、记忆和本地 Skill；清理前请确认没有需要保留的媒体或配置。工作区代码、用户自建目录和外部软件数据不属于 YanData，不会因为删除 Yan 数据而自动清除。

## 安全边界

- 真实文件写入、删除、下载和命令执行应在明确工作区内进行。
- API Key、MCP 凭据和环境变量只应提供给可信服务。
- “完全访问”不是绕过所有系统安全措施的超级权限；高风险命令仍可能需要用户确认。
- 图片中的文字、网页中的提示和 Skill 文档都被视为不可信数据，不能直接覆盖用户权限或系统规则。
- Agent 的最终总结只报告已观察到的工具结果和工作区事实；无法验证的内容会标为未验证或失败。

## 已知限制与后续方向

1.4.0 仍有明确边界：

- **Yan Computer Use 正在开发中，计划随 v1.5.0 上线。** 它将覆盖独立桌面、隔离鼠标键盘、跨应用截图和软件内控件操作；1.4.0 的完整操控能力目前只针对 Yan 内置浏览器。
- **Web UI 暂未完成 1.4.0 同步，不建议使用。** 这里指移动端/HTTP 远程控制页；桌面端主界面和内置浏览器不受此提示影响。
- **Yan Agent GUI 正在开发中，计划随 v1.5.0 上线。** 当前 `Yan Work GUI` 入口是开发占位，不建议把它当成可交付的生产界面。
- 常驻子 Agent、动态并发调度和更完整的 Git 生态尚未纳入 1.4.0 的稳定承诺。
- PowerShell 7 专属运行时安装与切换计划在后续版本；当前终端保留 Windows 可用的 PowerShell 入口。
- 动态模型目录只说明服务商返回了模型信息，不保证所有媒体模型的端点、请求格式、余额、限流或地区访问均可用。
- 视觉中继、联网搜索和第三方 MCP 依赖用户的 API、VPN、网络和服务状态。
- `test/skill-catalog.test.cjs` 等旧测试可能仍固定旧 Skill 列表；它们需要随着目录演进更新，不能用旧断言推断运行时目录。

## 开发说明

项目主要组成：

```text
main.js                  Electron 主进程、IPC、权限、MCP 和本地服务
preload.js               渲染进程安全桥接
lib/opencode-sidecar.js  Yan Kernel 的 OpenCode 执行、目标、总结和事件流
lib/*-mcp.js             Yan 内置 MCP
lib/skills/              内置 Skill 与 Skill 市场目录
renderer/index.html      主界面结构和设置页
renderer/renderer.js     会话、任务、输入框、输出、浏览器和审阅协调
renderer/browser-agent.js   内置浏览器控制 UI 与状态
renderer/pet/             桌面宠物
renderer/remote/          移动端控制页
```

修改运行时后请至少检查：

- `node --check main.js`
- `node --check lib/opencode-sidecar.js`
- `node --check renderer/renderer.js`
- `npm run bundle:opencode-provider`
- 与修改范围对应的 provider、CodeGraph、Skill 或浏览器验证脚本

## 许可证

Yan Agent 使用 MIT License。第三方 Skill、MCP、模型服务和外部工具拥有各自的许可证、服务条款和计费规则；随仓库分发的第三方说明见 `lib/skills/THIRD_PARTY_NOTICES.md`。
