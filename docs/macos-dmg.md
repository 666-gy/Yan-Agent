# macOS：自己打一颗能用的 DMG

给 **clone 了本仓库的人**。不需要作者的 Apple ID，也不需要把别人签好的安装包推进 git。

逐步避雷（小白）：[macos-dmg-beginner.md](macos-dmg-beginner.md)。

免费 Apple ID + Xcode（或只装 Command Line Tools）就可以给 **你自己这台 Mac** 打出可安装的包。  
给网上所有人「双击零提示」需要付费 **Developer ID + 公证**，见文末；那是可选项。

## 你能得到什么

| 你有什么 | 别人（或你）双击 DMG 之后 |
| --- | --- |
| 免费 Apple ID，Xcode / CLT 里的 **Apple Development** 证书 | 「无法验证开发者」→ 系统设置里 **仍要打开**。本机可长期用 |
| 不签名（`identity` 为空且没设 `CSC_NAME`） | Sequoia 常直接当恶意软件进废纸篓，**没有**「仍要打开」 |
| 付费账号的 **Developer ID Application** + `notarytool` 公证 | 别人一般可直接打开 |

本仓库 `package.json` 的 `build.mac.identity` 是 `null`，避免把某台机器的证书名写进源码。打包时用环境变量提供 **你自己的** 证书。

## 0. 机器准备（一次）

1. 安装 [Xcode](https://developer.apple.com/xcode/) 或：

   ```bash
   xcode-select --install
   ```

2. 打开一次 Xcode，用 **你的** Apple ID 登录（Xcode → Settings → Accounts → 加账号）。  
   免费号即可。让 Xcode 自动管理证书，或在 Acccounts 里 Download Manual Profiles。

3. 确认本机有开发证：

   ```bash
   security find-identity -v -p codesigning
   ```

   应看到类似：

   ```text
   1) ABCDEF... "Apple Development: 你的邮箱或姓名 (TEAMID)"
   ```

   没有这一行：回到 Xcode 登录并让它创建 Development 证书，不要继续打包。

4. Node.js 18+、Git。在仓库根目录：

   ```bash
   npm ci
   ```

   缺原生模块时再 `npm run rebuild:pty`（失败不致命，终端功能可能不可用）。

## 1. 打 DMG

在仓库根（有 `package.json` 的那层）：

```bash
# 换成你刚才 find-identity 看到的那一整串引号内名称
export CSC_NAME="Apple Development: 你的姓名或邮箱 (TEAMID)"
export CSC_IDENTITY_AUTO_DISCOVERY=false

npm run build:mac
```

产物默认：

```text
dist/Yan.Agent.Setup.v1.5.0.dmg
```

版本号跟 `package.json` 的 `version` 走，不要手改文件名冒充别的版本。

本机 Data 盘很满时，可把 `package.json` → `build.directories.output` 临时改到外置盘，打完再改回 `dist`。不要把外置盘路径提交进 git。

### Apple 时间戳服务挂了

偶发 `The timestamp service is not available`。本机自用可以跳过时间戳：

```bash
# 只对这一次打包
export CSC_NAME="Apple Development: 你的姓名或邮箱 (TEAMID)"
# electron-builder 24 把 mac.timestamp 写成 none 可跳过；不要把个人证书名写回仓库
```

或等几分钟重试。公开分发不要长期关时间戳。

## 2. 安装你刚打的包

```bash
hdiutil attach "dist/Yan.Agent.Setup.v1.5.0.dmg"
# 把 "Yan Agent.app" 拖进「应用程序」，不要在 DMG 窗口里直接打开
hdiutil detach "/Volumes/Yan Agent 1.5.0"   # 卷名以实际为准
xattr -cr "/Applications/Yan Agent.app"
open "/Applications/Yan Agent.app"
```

若仍提示「无法验证开发者」：系统设置 → 隐私与安全性 → **仍要打开**。  
若提示「恶意软件并移到废纸篓」：多半没签上 Development 证，回到第 0 步检查 `CSC_NAME` 是否和 `find-identity` 完全一致。

不要关 SIP，不要 `spctl --master-disable`。

## 3. 源码里和 Mac 包有关、但你不必改的部分

这些已经在仓库里，clone 即可：

- `npm run build:mac` → arm64 DMG
- `build/entitlements.mac.plist`、`build/icon.icns`
- `build.mac.extraResources`：darwin-arm64 CodeGraph → `codegraph-runtime`
- `asarUnpack`：Understand Anything viewer / 转换器（必须能 `spawn`）
- `files` 排除 `*.app` 素材，避免 `codesign --deep` 把假 bundle 签爆

Windows 的 `node.exe` extraResources **不会**打进 Mac 包。

## 4. 不要做的事

- 不要把 `.p12`、证书、`CSC_LINK` 密码、Apple ID、Team ID 提交进 git
- 不要把 200MB+ 的 DMG 推进源码 PR（体积 + 那是某台机器的产物）
- 不要用别人的 `CSC_NAME` 去签；签出来只对那人的开发者身份有意义
- 不要把 `identity` 写死成某一台 Mac 上的 `"Apple Development: …"` 再开 PR

安装包要给网友下：用 **你自己的 GitHub Release 资产** 挂 DMG，或让他们按本文自打。

## 5. （可选）给所有人双击即开

需要：

1. 付费 [Apple Developer Program](https://developer.apple.com/programs/)（可用非常用 Apple ID，只要这个号交了年费）
2. 证书类型是 **Developer ID Application**，不是 Apple Development
3. 打包后公证：

```bash
xcrun notarytool submit dist/Yan.Agent.Setup.v1.5.0.dmg \
  --apple-id "账号邮箱" --team-id "TEAMID" --password "app-specific-password" \
  --wait
xcrun stapler staple dist/Yan.Agent.Setup.v1.5.0.dmg
```

没有这一步，Development 签的包只能「仍要打开」，不能当正式分发。
