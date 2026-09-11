# 小白教程：自己打一颗 Yan Agent 的 macOS DMG

给 **第一次在 Mac 上从源码装 Yan Agent** 的人。  
不需要作者的 Apple ID，不能多人登录任何人的账号。你打出来的包只表示「这台 Mac / 你的开发者身份签的」。

源码仓短文（可进 PR）：`Yan-Agent/docs/macos-dmg.md`  
通用 Gatekeeper 原理（Goose 本体库，别和 Goose 魔改步骤混）：`macOS本地DMG打包与Gatekeeper-2026-09-11`

本篇补的是 **Yan 实测踩过的坑** 和 **按顺序点哪里**。

---

## 0. 先建立预期（不看完这一节会白打）

| 你以为 | 实际 |
| --- | --- |
| 免费下载 Xcode 就能做出「别人双击零提示」的安装包 | 只能做出 **你自己这台** 能装的包。系统会说「无法验证开发者」，你点 **仍要打开** |
| GitHub 上的 `v1.6.0-Beta2.exe` 就是 Mac 源码 | **只有 Windows 安装包。** tag 可能仍指 v1.5.0。Mac 按 `package.json` 的 version 打，现在是 **1.5.0** |
| 把别人签好的 200MB DMG 推进 PR，大家就能装 | 那是某台机器的产物，体积巨大，且用的是那人的 Development 证。别人机器照样拦。**DMG 不要进 git** |
| 弹「恶意软件并移到废纸篓」= 病毒 | 多半是 **没签上名**。这条路径 **没有**「仍要打开」按钮 |
| 关掉 SIP / 允许任何来源就一劳永逸 | 禁止。那不是打包方法 |
| `identity: null` 打出来也能给朋友 | Sequoia 经常直接扔废纸篓 |

免费路线的合格标准只有一句：

> 拖进「应用程序」后，能走到「无法验证开发者」→ **仍要打开** → 能启动。

---

## 1. 你要准备的东西

1. 一台 **Apple 芯片** Mac（本仓库的 `build:mac` 打的是 **arm64**。Intel Mac 不要照抄这一条，需要改 arch，本教程不覆盖）。
2. Apple ID（免费即可，建议就是你平时的；非常用号也行，**不能**拿别人的号登录 Xcode）。
3. Xcode（App Store）**或** 只装命令行工具：

```bash
xcode-select --install
```

4. [Node.js 18+](https://nodejs.org/)（LTS）。装完终端里 `node -v`、`npm -v` 有版本号。
5. Git。磁盘至少空出 **8GB**（`node_modules` + Electron 下载 + 中间 .app）。Data 盘很满就准备一块外置盘。

不要：把作者机器上的证书、`.p12`、Team ID 要过来用。

---

## 2. 拿到源码

有 macOS 魔改的那份（PR 合并前用 fork / 外置备份里的 `Yan-Agent/`；合并后用上游）：

```bash
git clone https://github.com/666-gy/Yan-Agent.git
cd Yan-Agent
git status
```

打开 `package.json` 看第一屏的 `"version"`。  
**打出来的 DMG 文件名必须跟这个 version 走。** 不要因为 GitHub Release 写了 1.6 就把包改名成 1.6。

---

## 3. 让 Xcode 给你一张「开发证」（一次）

1. 打开 **Xcode** → Settings（或 Preferences）→ **Accounts**。
2. 左下角 **+** → 用 **你的** Apple ID 登录。
3. 选中账号 → **Manage Certificates** → 若没有 iOS/macOS Development，点 **+** → **Apple Development**。
4. 关掉 Xcode，终端检查：

```bash
security find-identity -v -p codesigning
```

你要看到 **至少一行** 类似：

```text
1) 0123ABCD… "Apple Development: 张三 (AB12CD34EF)"
```

把 **引号里面整串** 复制下来，后面当 `CSC_NAME`。差一个空格都会签失败。

**避雷：**

- 看到的是 `Apple Distribution` / `Developer ID` 却没有 Development：免费号通常只有 Development，用那张。
- 一行都没有：多半没登录 Xcode，或没点 + 创建证。不要继续 `npm run build:mac`。
- 不要把这串姓名写进 `package.json` 再提交。仓库里 `build.mac.identity` 应保持 `null`，用环境变量。

---

## 4. 装依赖

仍在 `Yan-Agent` 根目录（能看见 `package.json`、`main.js` 的那层）：

```bash
npm ci
```

很慢、会占约 1GB+，正常。  
`npm run rebuild:pty` 失败可以先忽略：聊天能用，内置终端可能不行。

**避雷：**

- 不要用 cnpm 乱改 electron 镜像除非你知道在干什么；electron 没下全，打包后半段会炸。
- 不要提交 `node_modules`。
- Data 盘只剩几百 MB：停。把整个 clone 放到外置盘再 `npm ci`。

---

## 5. 打包（核心四行）

把下面第二行 **整段换成你第 3 步复制的证书名**：

```bash
cd /你的路径/Yan-Agent

export CSC_NAME="Apple Development: 张三 (AB12CD34EF)"
export CSC_IDENTITY_AUTO_DISCOVERY=false

npm run build:mac
```

第一次会再下一颗 Electron，可能要十几分钟。成功时大致会出现：

```text
dist/Yan.Agent.Setup.v1.5.0.dmg
```

（version 以你的 `package.json` 为准。）

磁盘不够时，**不要**改仓库里的 output 再去 PR。临时：

```bash
npx electron-builder --mac dmg --arm64 --publish never \
  --config.directories.output="/Volumes/你的外置盘/Yan-Agent-build"
```

打完把那颗 `.dmg` 拷走即可。

---

## 6. 安装（不要在 DMG 窗口里双击开）

```bash
hdiutil attach "/完整/路径/Yan.Agent.Setup.v1.5.0.dmg"
```

Finder 里把 **Yan Agent.app** 拖到「应用程序」。然后：

```bash
xattr -cr "/Applications/Yan Agent.app"
open "/Applications/Yan Agent.app"
```

弹出「无法验证开发者」：

1. 系统设置 → 隐私与安全性 → 往下翻 → **仍要打开**
2. 或按住 Control 点图标 → 打开 → 打开

**避雷：**

- 路径有空格必须加引号。错写成 `hdiutil attach/Users/...` 会失败。
- 已经挂载再 attach 会「资源忙」：直接用 `/Volumes/Yan Agent …`，或先 `hdiutil detach`。
- 弹 **「已阻止恶意软件并移到废纸篓」**：签名没套上。回到第 3 步，确认 `echo $CSC_NAME` 和 `find-identity` **逐字符相同**，删掉 `dist/` 重打。这条 **没有**「仍要打开」。
- 不要在 DMG 里直接运行（隔离属性、写不了数据目录）。
- `spctl --assess` 对 Development 包会 `rejected`，**正常**，不要据此以为失败。

---

## 7. 打包时 Yan 项目已经踩过、你可能会再踩的雷

干净上游若还没 Mac 相关补丁，先合本分支再打包。

| 现象 | 原因 | 你该怎么做 |
| --- | --- | --- |
| 废纸篓，没有「仍要打开」 | `identity` 空，electron-builder 没签 | 设 `CSC_NAME`，禁止依赖仓库里的 `null` 去公开装 |
| `codesign` 失败，提到某个 `.app` | skills 素材目录名叫 `linear.app` 之类，被当成 bundle | 仓库 `files` 里已有 `"!lib/skills/**/*.app"`；不要删 |
| 图谱 / Understand Anything 打不开 | extraResources 只带了 Windows 的 `node.exe` | 必须有 darwin-arm64 → `codegraph-runtime`；运行时找 `node` 不是 `node.exe` |
| 转换器 / viewer 起不来 | 文件困在 asar 里，`spawn` 失败 | `asarUnpack` 含 `lib/understand-anything/**` |
| 文件名是 1.6、里面是 1.5 | 有人改了 `version` 去对齐 exe | **改回源码真实版本再打** |
| `The timestamp service is not available` | 苹果时间戳服务器抽风 | 等几分钟重试；本机自用才考虑跳过 timestamp，不要当正式发布默认 |
| 打到一半磁盘满 | Electron 中间产物很大 | 输出到外置盘；不要关 SIP 腾系统盘乱删 |
| 左上红绿灯挡住按钮、图谱切走黑屏 | 那是 UI 魔改，不是签名问题 | 见本夹对照手册，不是重签能好 |

验签（可选）：

```bash
codesign -dv --verbose=2 "/Applications/Yan Agent.app"
# 期望看到 Authority=Apple Development: …
# 以及 flags 里有 runtime
```

---

## 8. 明确不要做

- 不要关 SIP、不要 `spctl --master-disable`
- 不要把 `.p12`、证书、App 专用密码、Team ID 写进仓库或教程截图对外发
- 不要把 DMG / `.app` 推进源码 PR
- 不要用作者的 `CSC_NAME` 去签（签出来也不等于你能登录他的账号，只是身份错配，别人照样拦）
- 不要对整颗 `.app` 再跑一遍 `codesign --deep`「补签」（Goose 上炸过 Electron Framework / ffmpeg Team ID 不一致；Yan 交给 electron-builder）
- 不要 Intel 机器硬打 arm64 包还指望能开

---

## 9. 想给网友「双击就能开」时

免费号做不到。需要：

1. 付费 [Apple Developer Program](https://developer.apple.com/programs/)（**可以用非常用 Apple ID，只要这个号交了年费**）
2. 证书是 **Developer ID Application**，不是 Apple Development
3. `notarytool submit` + `stapler staple`

没有公证的 Development 包，换一台 Mac 仍会拦。  
安装包放 **GitHub Release 资产** 或网盘，**不要**放进 git 树。

---

## 10. 打完对照清单（小白验收）

- [ ] `package.json` version 和 DMG 文件名一致
- [ ] `security find-identity` 看得到你的 Development 证
- [ ] `CSC_NAME` 与那一行完全一致
- [ ] `npm run build:mac` 结束没有 codesign error
- [ ] App 在 `/Applications`，不是还在 DMG 里
- [ ] 能走到「仍要打开」并启动
- [ ] 没把证书和 DMG 提交进 git
