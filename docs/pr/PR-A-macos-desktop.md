# PR A — Mac 能从源码出包 + 桌面壳

**base:** `666-gy/Yan-Agent` `main` (`a8ba36b`)  
**head:** `pr/a-macos-desktop`  
**版本号:** 保持 `1.6.0`，不另打 tag / 不另开产品线。

本机 Apple Silicon（M1/M2/M3）架构名是 **arm64**。Intel Mac 是 **x64**。安装包文件名用 `${arch}`，不要写死成 arm64，以免 Intel 用户下错包。

**不在本 PR：** 空回复续写、流式开关、HTTP 400/503、个人安装教程、证书、`dist/*.dmg`、`-V4-mod` 文件名。

点击开 PR（推送后）：

- 上游：https://github.com/666-gy/Yan-Agent/compare/main...atom30260-jpg:Yan-Agent-Macos:pr/a-macos-desktop?expand=1
- 备份仓：https://github.com/atom30260-jpg/Goose-Mod-/tree/pr/a-macos-desktop

## 为什么

上游 1.6 只有 Windows nsis。Mac 从源码出不了包；红绿灯压顶栏；Dock 点击不前置；packaged 缺 Darwin CodeGraph / UA viewer dist。

## 改了什么（对照工作树）

| 文件 | 改哪里 | 为什么 |
| --- | --- | --- |
| `package.json` | 增 `scripts.build:mac`：bundle 后 `electron-builder --mac dmg --arm64 --publish never` | Mac 可从源码出包 |
| `package.json` `build.files` / `asarUnpack` | 排除 darwin codegraph；unpack `opencode-darwin-*` | 体积与运行时解包 |
| `package.json` `build.win.extraResources` | **保留** win32 codegraph（从顶层挪回 win） | 避免 Mac 配置冲掉 Windows 资源 |
| `package.json` `build.mac` | `identity: null`，hardenedRuntime，entitlements，icon，target dmg **arm64**；extraResources：`codegraph-darwin-arm64`、`vendor/officecli-runtime` | builder 不代签；Darwin sidecar；Office 内置预览二进制 |
| `package.json` `build.dmg.artifactName` | `Yan.Agent-${arch}-v${version}.${ext}` | 架构进文件名；**没有** `-V4-mod` |
| `build/entitlements.mac.plist` | **新文件** jit / 网络 / 用户文件 | codesign `--options runtime` |
| `build/icon.icns` | **新文件** | Mac 图标 |
| `vendor/officecli-runtime/officecli` | **新文件** ~32MB Mach-O arm64 | `npm ci --ignore-scripts` 不会带；Mac extraResources 指向这里 |
| `lib/codegraph-runtime.js` | 可执行名 win32=`node.exe` 否则 `node`；packaged `resourcesPath` | 上游只找 `node.exe` |
| `lib/opencode-runtime.js` | `platform !== 'win32'` 跳过 SHA runtime-patch | darwin OpenCode SHA 不在 patch 清单 |
| `lib/opencode-sidecar.js` | `STARTUP_TIMEOUT_MS = 90_000`；spawn 前 `chmod` + `xattr -dr com.apple.quarantine`；`HOME`/`OPENCODE_TEST_HOME` 隔离 | 上游 20s 会 timeout；隔离属性 + 不污染用户 HOME |
| `main.js` 窗口 | darwin `hiddenInset` + `trafficLightPosition {x:16,y:18}`；height 740 / minHeight 560；`backgroundThrottling: !isMac` | 红绿灯、小屏、Dock 卡顿 |
| `main.js` `app.on('activate')` | `focusMainWindow()` | Dock 点图标前置 |
| `main.js` `powershell:open-external` | darwin `open -a Terminal` | 上游按 PowerShell 走，Mac 终端按钮无效 |
| `main.js` `file:preview-local` | Office 走 officecli `view html -o`，25s；安装包/压缩包访达；文本/图片/pdf 应用内 | Office **必须 App 内**预览 |
| `renderer/styles.css` | `body.is-mac .titlebar`；`.chat-scroll` 左 padding；toolbar **flex** 36px nowrap；wallpaper+busy 关 blur；50ms 量级过渡 | 壳、工具栏漂移、GPU |
| `renderer/renderer.js` | `OPEN_CODE_RENDER_MIN_INTERVAL_MS = 50`；thinking_group 只改最后一行；UA `close({silent})`；`is-mac` class | 流式卡死、切页黑屏 |
| `renderer/understand-anything/*` | status 层 `hidden`；卡片可拖 | 透明层吃拖拽 |
| `.gitignore` | `!lib/understand-anything/viewer/{,bin/}dist/**` | 否则根 `dist/` 规则丢掉 dashboard |
| `lib/understand-anything/viewer/dist/**` + `bin/dist/staleness.js` | **新目录** | packaged 否则 `embedded dashboard build not found` / `ERR_MODULE_NOT_FOUND` |

## 验收

```bash
npm run build:mac
```

出未签名 dmg，文件名形如 `Yan.Agent-arm64-v1.6.0.dmg`（Apple Silicon）。Intel 构建机应变为 `x64`。本机 Development 补签后「仍要打开」能启动；Understand Anything 不再缺 dist。

## 明确不提交

- `dist/**`、本机 `*.dmg` / `.app`
- Apple 证书、Team ID、`CSC_*`
- 个人安装教程 markdown
- 空回复续写、流式开关（见 PR B / C）
