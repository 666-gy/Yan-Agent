# v1.7.0 Linux / macOS 测试版

以当前 v1.7.0 源码为基线。Linux x64 输出 AppImage 和 tar.gz；macOS Intel x64、Apple Silicon arm64 输出 dmg 和 zip。每个目标必须在对应系统与架构上构建。

```sh
npm ci --no-audit --no-fund
npm run build:linux   # Linux x64
npm run build:mac     # macOS，按当前机器架构构建
```

产物位于 `dist/linux-x64`、`dist/darwin-x64`、`dist/darwin-arm64`。GitHub Actions 的 `Linux and macOS portability builds` 工作流可手动运行三个原生构建任务，并执行安装包启动检查。

OpenCode 使用固定版本与 SHA-256 校验，构建时应用工具过滤补丁；macOS 在修改后进行 ad-hoc 签名。CodeGraph 使用对应系统的 Node 运行时。Playwright 服务随包提供，Chromium 在安装插件时下载并校验。OfficeCLI 在首次使用时按系统下载，需要能够访问 GitHub Releases。

此阶段语音识别、电脑操控、应用快照快捷键仍依赖 Windows；Linux/macOS 不支持这些功能。自动更新暂时关闭，需下载对应系统的新安装包。macOS 产物尚未配置 Developer ID 签名与公证，属于测试版。

Linux 使用桌面环境启动，先赋予 AppImage 执行权限；缺少 FUSE 时可使用 `--appimage-extract-and-run`。tar.gz 解压后运行 `yan-agent`。外部终端需安装系统终端模拟器。

验证命令：

```sh
npm run verify:platform
node --test test/platform-runtime.test.cjs
YAN_PLATFORM_EXECUTABLE="$PWD/dist/linux-x64/linux-unpacked/yan-agent" xvfb-run -a node test/platform-startup.e2e.cjs
```

Linux 无图形构建机需要安装 xvfb 及 Electron 的 GTK/NSS/音频系统库。自动测试使用独立用户目录，不读取现有账号配置。实际模型请求、所有插件与各桌面发行版仍需要后续实机验证。
