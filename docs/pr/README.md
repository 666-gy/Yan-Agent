# Yan Agent 1.6-V4-mod → 上游 PR

对照工作树：`Yan-Agent-1.6-V1-mod`（相对上游 `main` = `a8ba36b`）。

提交顺序：先 A，再 B，再 C。每个 PR 点上面的 compare 链接即可。

| PR | 分支 | 说明 |
| --- | --- | --- |
| A | `pr/a-macos-desktop` | [Mac 出包 + 桌面壳](./PR-A-macos-desktop.md) |
| B | `pr/b-empty-output-continue` | [空回复续写 1 次](./PR-B-empty-output-continue.md) |
| C | `pr/c-stream-toggle-preview` | [流式开关 + 预览](./PR-C-stream-toggle-preview.md) |

全量源码快照（A+B+C）：`snapshot/v4-source`（无 DMG、无证书、无安装教程）。

## 禁止进仓

- `dist/**`、本机 dmg/app
- `CSC_*` / Apple 证书 / Team ID
- **个人安装教程 markdown**（含本机签名步骤与个人身份信息）——只留本机 Obsidian / 本地盘
- artifact 名里的 `-V4-mod`（已改为 `Yan.Agent-${arch}-v${version}.${ext}`）
