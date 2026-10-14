# ViaTum Lab 网站

公司首页位于 `index.html`，原有 Yan Agent 产品介绍保留为 `product-intro.html`。网站为静态 HTML / CSS / JavaScript，不依赖 Electron、构建工具或远程字体；首页可直接打开，也可部署到静态网站托管服务。

## 本地预览

在仓库根目录运行：

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory docs
```

浏览器访问 `http://127.0.0.1:4173`。邮箱复制需要浏览器允许剪贴板访问；被拒绝时页面提示手动复制，邮箱链接仍可使用。

## 内容与维护

- `index.html`：品牌定位、ViaHarness 产品、跨场景迁移、Harness 研究、YAgent 开源客户端与联系信息。
- `assets/viatum.css`：响应式布局与视觉样式；支持系统减少动态效果设置。
- `assets/viatum.js`：手机导航、独立的任务路由、跨场景与研究能力选项卡（支持方向键、Home、End）、邮箱复制。
- `assets/viatum-logo.svg`：用户提供的蓝灰渐变 ViaTum Logo，内嵌原图，以视口收紧留白，用于导航、页脚与浏览器图标。
- `product-intro.html`：保留的 Yan Agent 产品详情。
- `yagent/`：YAgent 独立技术文档站，包含固定目录、移动端导航、章节过滤和代码复制。
- `technical-reference.md`：文档站的 Markdown 内容源。

全站采用纯白背景与中性黑灰配色，YAgent 详情页同步使用白色主题。

ViaHarness 是 ViaTum Lab 的多场景统一 Harness 基础设施。产品区展示任务内智能路由，以及金融、医疗、教育、科研和政务五类目标场景的能力迁移方式；这些内容是能力架构与目标场景说明，不代表已落地客户案例。示意不调用真实模型或展示虚构价格。接入配置默认折叠，示例域名不代表线上服务，实际接入通过咨询邮箱联系。

公司定位与研究方向来自用户提供的《Harness Factory 商业计划书》，按 ViaTum Lab 品牌重新组织。YAgent 能力基于仓库 README，不把 BP 中的规划描述为已经发布的 API 或服务。客户端配图为工作流示意，并非实际产品截图。官网联系邮箱为 `axiom@viatumlab.com`；修改时同步更新 HTML 与 JavaScript 中的邮箱。

## 发布

将本目录作为静态站点根目录发布即可，例如 GitHub Pages 选择分支的 `/docs` 目录。保留 `assets` 和 `product-intro.html` 的相对位置。当前线上地址为 `https://viatumlab.com`。

## 人工验证

已检查桌面、768px 平板、390px 手机及 320px 窄屏无横向溢出；验证了选项卡点击与键盘切换、手机菜单展开与点击收起、邮箱复制及 YAgent 详情链接。
