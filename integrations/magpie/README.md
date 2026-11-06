# Yan Agent × Magpie

Windows Yan Agent v1.8.0 的第三方 **Magpie Agent 插件**，不是 Yan 原生插件。
已集成到当前源码工作区并通过隔离测试；尚未安装、发布、重新打包应用或进行真实网关联调。

## 配置入口与安装

Yan 从 Electron `app.getPath('userData')/YanData/magpie.json` 读取配置。
标准 Windows 安装对应 `%APPDATA%/yan-agent/YanData/magpie.json`，与主 `config.json` 同目录。

1. 使用包含本次改动的 Yan 源码版本启动应用，确保数据目录已存在。已有安装版需要后续构建更新才包含此入口。
2. 在安装了 Magpie 的终端手动运行：`magpie plugin add "<本目录的绝对路径>"`。
   也可使用官方支持的单文件入口 `yan.agent.js`。本任务没有执行安装命令。
3. Magpie 的 Agents 页通过上述目录识别 **Yan Agent**；选模型后写入独立配置。
4. 在 Yan 启动新运行。连接期间 Magpie 选择优先于主任务的 Yan 模型选择。
5. 在 Magpie 关闭 Yan 连接即可恢复逐字段备份。也可将独立文件的 `enabled` 设为 `false`，
   或删除该文件；下一次运行恢复 Yan 原选择。

如自定义了 Electron userData 路径，需要手动修改插件的 `dir` 和 `config` 为同一实际目录；
此插件不自动探测非标准路径，不宣称支持 macOS/Linux。

## 文件格式 v1

```json
{
  "version": 1,
  "enabled": true,
  "apiFormat": "openai",
  "baseUrl": "http://127.0.0.1:8080/v1",
  "apiKey": "<Magpie 分配的 Yan 专属 key>",
  "model": "provider/model-or-group/path",
  "models": [{ "id": "provider/model-or-group/path", "name": "Example", "images": false, "efforts": [] }]
}
```

由 Magpie 写入，不需要手改主配置。`models` 中可提供正整数 `context`、`output` 和推理档位
`efforts`。仅 `images: true` 开启图片输入；未知路由组不会被标成视觉/推理全能。
未声明上下文时沿用 Yan 的默认预算策略；目录变化由 Magpie 再调用 `connect` 更新。
完整模型 ID（包括多层 `/`）直接传给网关，不剥离 provider/group 前缀。
支持 Magpie OpenAI-compatible 网关，由 Magpie 做供应商协议转换；禁用 Yan 的模型名称供应商适配推断。
当前不提供生图、生视频角色绑定或 Library 配置写入。

## 生效、恢复及错误处理

- 主任务在准入时读取一次独立快照，提示词模型身份、事件元数据及内核配置使用同一选择。
  修改文件不热切换正在运行的任务。预热会读取最新配置；Side Chat 保留自身独立模型选择。
  请求指定的推理档位继续生效；手动压缩上下文使用运行配置中的实际 provider 与完整模型 ID。
- `loadConfig`、`saveConfig`、设置页连接清单保持原有语义，运行覆盖不进入它们；设置页仍展示原模型。
  专用运行 provider ID 为 `magpie-runtime`，不注册或覆盖用户的 `conn-*` 连接。
- 缺失文件、空对象或 `enabled:false` 表示关闭；恢复后使用 Yan 原有模型归一化与回退规则。
  原选择已删除/禁用时走原有回退，并以实际运行模型身份为准；没有可用模型时仍按原路径报错。
- 非法 JSON、未知版本/协议、失效模型、超大文件或非法 URL 会阻止新运行并返回固定中文错误；
  不悄悄使用上一次 Magpie 模型，也不将解析错误中的密钥、URL 或文件内容写入错误消息。
- Magpie 按逐字段备份恢复；连接前已有有效独立配置时，断开会恢复该配置，可能仍启用覆盖。
  要确定完全关闭，可删除该文件或设置 `enabled:false`。
- 独立文件中的专属 key 是 Magpie 管理的明文凭据，不经过 Yan 主配置加密；请保留 Windows 用户目录访问权限，
  不将该文件纳入版本控制。Yan 不复制该 key 到主配置或设置页公共投影。

## 官方协议证据

2026-11-04 重新获取并核对：

- https://usemagpie.ai/docs/plugins#agents ：`magpie.agent`、`dir/config` 的 `$VAR` 展开、
  `model` 字段路径、`connect({gateway, model, models, agent})`、1 秒嵌入式 JS 限制和逐字段恢复。
- https://raw.githubusercontent.com/magpie-community/plugins/main/packages/kilo/kilo.agent.js ：
  `gateway.v1/key`、`models[].id/name/images/context/output/efforts` 的实际示例。

Yan Web 抓取超时；随后用 curl 单进程 `--proxy` 通过本机已有代理成功获取官方原文，
没有修改系统/Git 代理配置。插件无 Node API、外部依赖或网络调用。

## 验证和联调边界

```sh
node --test test/magpie-config.test.cjs test/connections.test.cjs test/provider-configure.test.cjs test/run-orchestrator.test.cjs test/main-opencode-runtime.test.cjs
```

新增测试覆盖插件输出→文件读取、模型切换、快照稳定、关闭/删除恢复、无能力路由组、非法配置脱敏、
真实运行配置生成、主配置保存不污染、主运行准入模型身份、推理档位与手动压缩模型一致性。
使用隔离目录和假 key，不调用模型或网关。

父工作区集成后运行上述组合：**47/47 通过**（其中 Magpie 专项 5 项）。三个主链路修改文件、
配置读取模块及插件入口的 `node --check` 均通过。测试临时目录已自动清理。

尚待人工真实联调：Magpie 当前版本的目录发现、嵌入式 JS 执行、逐字段备份恢复、实际网关的
流式文本/工具调用、多层路由 ID、长上下文，以及已运行内核与后续新运行的进程切换。
Node ESM 测试不等价于 moejs 验证；官方文档兼容也不等价于已安装验证。
