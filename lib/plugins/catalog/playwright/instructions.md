# Playwright for Yan Agent

安装本插件即启用 Yan 内置的 Playwright MCP 服务：Chromium 会在安装时从 Playwright 官方下载源获取，并在安装完成后按构建期记录的哈希逐一校验，因此不需要单独安装 Node.js、npm 或浏览器。

插件本身不包含技能和资源，它提供的是 MCP 工具。工具以 `mcp_default_playwright` 下的名字出现（例如 `browser_navigate`、`browser_click`、`browser_take_screenshot`）。在设置中关闭该 MCP 服务器或卸载本插件，即可停用这些工具。

使用方式：直接按任务需要调用这些工具。浏览器以隔离配置启动，每次会话的文件保存在插件的输出目录中，不会读写用户的日常浏览器配置。

离线或内网环境：可通过 `PLAYWRIGHT_DOWNLOAD_HOST` 指向内部镜像后重新安装插件；下载仍会按哈希校验，镜像内容必须完全一致。

Upstream: https://github.com/microsoft/playwright-mcp
