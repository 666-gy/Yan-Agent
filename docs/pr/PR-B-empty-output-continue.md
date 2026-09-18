# PR B — 空回复 / 截断续写 1 次（Win/Mac 都受益）

**base:** `pr/a-macos-desktop`（或直接 `main`，本提交不依赖 Mac 壳）  
**head:** `pr/b-empty-output-continue`

**不要**把 tyas 400 / Grok 503 写进这个 PR。不改 API path、不改请求头、不抬 32k output cap。

点击开 PR（推送后）：

- https://github.com/666-gy/Yan-Agent/compare/main...atom30260-jpg:Yan-Agent-Macos:pr/b-empty-output-continue?expand=1

## 为什么

部分供应商回合以 `finish=stop/other/缺 finish` 结束且没有可见正文，或 `finish=length` 截断。用户只看到空回复。安全过滤（`content-filter`）不得自动续写。

## 改了什么

| 文件 | 改哪里 | 为什么 |
| --- | --- | --- |
| `lib/opencode-sidecar.js` | `assistantFinishedByLength` / `isLengthFinishReason`（`length` \| `max_output_tokens` \| `max_tokens`） | Responses 截断被当成 generic empty-answer |
| 同上 | `truncatedOutputError` / `emptyCompletedOutputError` | 文案区分截断 vs 空完成 |
| 同上 | `EMPTY_OUTPUT_FINISH_DENY`（`content-filter` / `content_filter`） | 安全过滤不续写 |
| 同上 | `assistantHasVisibleWork` / `assistantCompletedWithoutVisibleOutput` / `turnNeedsEmptyOutputContinuation` | 有正文或 tool 不续；纯 thinking / 空白 / 缺 finish / `stop` / `other` 才续 |
| 同上 | `outputTruncationContinuePrompt` / `emptyOutputContinuePrompt`（`YAN OUTPUT CONTINUATION`） | 同一任务续写，禁止重开 |
| 同上 `sendPrompt` | `emptyCompleted` 且续写次数 `< 1` → 事件 `yan.model.truncated` 或 `yan.model.empty-output`，再 `return sendPrompt(...)` | **只续 1 次** |
| 同上 `collectRunResult` | 截断且无最终正文且非 tool-only → 截断文案 | UI/FAQ 可解释 |
| `renderer/renderer.js` | 时间线处理上述两事件；`ABOUT_ERROR_PAGES` 增加 truncation 页 | 用户看见「正在续写」而不是莫名失败 |
| `test/opencode-finalization.test.cjs` | length 续写、stop 空白、finish=other、thinking-only、content-filter 不续、已有正文不续、续写仍空则报命名错误 | **71/71** |

## 验收

```bash
node --test test/opencode-finalization.test.cjs
```

## 明确不在本 PR

- HTTP 400/503 网关错误自动重试
- 改 `/v1/responses` 路径或请求头
- 流式开关（PR C）
- 个人安装教程 / 证书 / DMG
