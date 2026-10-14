# 官网维护

官网是 `docs/` 中的静态站点，可直接部署到 GitHub Pages（从 `/docs` 发布），不需要前端构建或第三方 CDN。

- `index.html`：网站入口、全局导航和搜索弹窗。
- `site.css` / `tokens.css`：官网专用排版与固定深色主题，不影响桌面应用。
- `site-content.js`：指南内容组件；`guides/00-help.js` 到 `05-settings-support.js` 为帮助中心与专题正文。增加页面时填写唯一 `id`、分组、简介与章节，并在 `index.html` 加载对应文件；导航、搜索、目录和相邻文章自动生成。
- `site.js`：路由、搜索、目录和复制交互。
- `site-release.js`：生成文件，禁止手改。

应用更新后运行：

```powershell
node scripts/sync-site-content.cjs
```

脚本默认从 `package.json` 与 `renderer/release-notes.js` 同步版本；存在对应版本的 `releases/v<版本号>.md` 时采用官网编辑版更新说明。指南需要根据实际产品变化人工更新，避免将开发实现误写成使用承诺。安装包链接始终指向 Releases，不假设开发版本已发布。

本地预览可使用任意静态 HTTP 服务，根目录设为 `docs/`。直接用浏览器打开 `docs/index.html` 也能浏览，复制功能需要浏览器允许剪贴板访问。

文档链接采用 `#quickstart`，章节采用 `#quickstart/install`，支持直接访问和浏览器前进/后退。保留旧产品页常用锚点的映射。

## 版式与图片

首页按 Codex 官方产品页的实测布局制作，参考链接为 https://openai.com/zh-Hans-CN/codex/ 。按钮与操作控件统一为药丸或圆形；内容表面使用较大的圆角。

`assets/product/` 包含真实 Yan 应用截图、Logo、首屏背景及静态封面，具体来源见同目录的 `README.md`。新增功能展示优先重新截取实际应用界面。不要直接把外部产品的价格、客户评价或能力承诺替换为 Yan 品牌。

应用截图使用隔离 E2E 档案。官网固定使用深色，已移除浅色模式及主题切换。首屏使用 React Bits Pixel Blast（WebGL），滚出视口或页面隐藏时卸载并释放 GPU 资源。

Pixel Blast 源码及构建入口位于 `scripts/site-pixel-blast/`。参数与指定预览一致：`color=#97cdcf`、`patternScale=8`、`patternDensity=1.25`、`speed=1`，其余沿用原版演示默认值。修改后运行 `npm ci --prefix scripts/site-pixel-blast` 和 `node scripts/site-pixel-blast/build.cjs`，生成可独立部署的本地 JS/CSS，无运行时 CDN 依赖。

## 发布与仓库

当前仓库为 `https://github.com/666-gy/Yan-Agent`。Cloudflare Pages 项目为 `yanagent`，目前采用直接上传；推送 GitHub 不会自动更新 Pages。部署目录为 `docs/`，官网域名为 `yanagent.top`（需完成 DNS 激活与 Pages 自定义域关联）。下载地址集中维护在 `site.js` 的 `downloadLinks` 中。
