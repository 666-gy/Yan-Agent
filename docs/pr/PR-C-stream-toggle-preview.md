# PR C — 流式开关 + 预览/访达

**base:** `pr/b-empty-output-continue`  
**head:** `pr/c-stream-toggle-preview`

**产品说明（请保留在 PR body）：** 流式开关 **不改变** API 格式。tyas 选 Responses 仍打 `/v1/responses`；中转 400 `upstream_error` 要用户改成 Messages `/v1/messages` 或 Completions，**不是缺 `/v1`、也不是请求头**。

点击开 PR（推送后）：

- https://github.com/666-gy/Yan-Agent/compare/main...atom30260-jpg:Yan-Agent-Macos:pr/c-stream-toggle-preview?expand=1

## 为什么

部分中转在强制 SSE 时不稳定，需要按连接关闭流式，但 OpenCode 只走 `doStream`，关流式仍需合法 SSE。地址栏右箭头把缩短后的文件名丢给 Bing；`.app` 因是目录报「不是文件」。

## 改了什么

| 文件 | 改哪里 | 为什么 |
| --- | --- | --- |
| `lib/supplier-stream.mjs` | **新文件** `applySupplierStreamPreference`（body `stream:false`）+ `coerceProviderStreamResponse`（JSON→一次性 SSE） | 关流式仍要合法 SSE |
| `lib/supplier-stream.cjs` | **新文件** CJS 孪生 + `wrapFetch` | sidecar Anthropic/`@ai-sdk` 是 CJS require |
| `lib/opencode-dsml-provider.mjs` 及 glmm/qwem/kiml/gptl/openai-responses | `createYanProviderFetch` / `makeGptlFetch` 吃 `streamEnabled` | 各厂商否则仍强制 stream |
| 对应 `*.bundle.mjs` | 随 `bundle:opencode-provider` 重生 | packaged 跑 bundle |
| `lib/opencode-sidecar.js` `buildOpenCodeConfig` | `streamEnabled`；false 时注入 `wrapFetch` | Anthropic npm 路径不走 mjs fetch |
| `main.js` 连接 save/summary/register | `connection.streamEnabled = payload.streamEnabled !== false` 写入 OpenCode options | **必须进出站**，不能只改 UI |
| `renderer/index.html` | `#connFormatGrid` 下 `#connStreamGrid` 两枚 pill | 用户指定：格式页、格式 pills 下方 |
| `renderer/renderer.js` | `connectionDraft.streamEnabled`；摘要「流式 开启/关闭」；`goFromAddressBar` 用完整 URL | 编辑回显；右箭头不再 Bing |
| `renderer/styles.css` | `.conn-stream-row { margin-top: 14px }` | 与格式网格分开 |
| `preload.js` | `previewLocalFile` → `file:preview-local` | 渲染层调用 |
| `main.js` `file:preview-local` | 已在 PR A 落地 `IN_APP_PREVIEW_EXTS` / `REVEAL_EXTS`；本 PR 接上地址栏与连接开关 | `.app`/安装包访达；txt 应用内 |

## 验收

- 连接对话框格式页 pills **下方**出现「开启/关闭流式」，保存后摘要显示。
- 关闭流式：协议仍是用户选的 Messages/Completions/Responses，只是 `stream:false`。
- 地址栏对 `file://` 走应用内预览，不用缩短文件名。

## 明确不在本 PR

- tyas 400 / Grok 503 自动改路径
- 个人安装教程 markdown、证书、`dist/*.dmg`
