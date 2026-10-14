"use strict";
(() => {
  const docs = window.YanDocs;
  const release = window.YanSiteRelease;
  const shots = window.YanSiteShots || {};
  const repo = "https://github.com/666-gy/Yan-Agent";
  // Published Windows installer and mirror download destinations.
  const downloadLinks = { github: "https://github.com/666-gy/Yan-Agent/releases/download/v1.7.0/Yan.Agent.Setup.v1.7.0.exe", baidu: "https://pan.baidu.com/s/1KZIFg29V7Ks89pvEWiY4mw?pwd=code" };
  const page = document.getElementById("page");
  const dialog = document.getElementById("search-dialog");
  const input = document.getElementById("search-input");
  const escape = (text) =>
    String(text).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const plain = (html) => {
    const element = document.createElement("div");
    element.innerHTML = html.replace(/<\/(?:p|li|td|th|tr|h[1-6])>/gi, "$& ");
    return element.textContent.replace(/\s+/g, " ").trim();
  };
  const updates = {
    id: "updates",
    title: "更新日志",
    group: "版本与资源",
    description: `${release.label} · 了解新功能、改进与版本迁移。`,
    sections: release.pages
      .map((item, index) => ({
        id: `release-${index}`,
        title: index === 0 ? `最新版本号： Yan Agent v${release.label}` : item.title,
        html: index === 0 ? "" :
          (item.paragraphs || [])
            .map((text) => `<p>${escape(text)}</p>`)
            .join("") +
          (item.bullets?.length
            ? `<ul>${item.bullets.map((text) => `<li>${escape(text)}</li>`).join("")}</ul>`
            : ""),
      }))
,
  };
  const allDocs = [...docs, updates];
  const groups = [
    "开始使用",
    "工作与协作",
    "扩展能力",
    "配置与安全",
    "版本与资源",
  ];
  let observer;
  let renderedId;
  let currentDoc;
  const aliases = {
    top: "home",
    flow: "workspace",
    systems: "workspace",
    analysis: "workspace",
    subagent: "agents",
    modes: "modes",
    ext: "plugins",
    limits: "permissions",
    start: "quickstart",
  };
  function sidebar(id) {
    return `<aside class="toc guide-navigation" aria-label="文档导航"><p class="toc-title">帮助目录</p><nav>${groups
      .map(
        (group) =>
          `<p class="toc-title guide-group">${group}</p>${allDocs
            .filter((item) => item.group === group)
            .map(
              (item) =>
                `<a href="#${item.id}" ${item.id === id ? 'aria-current="page"' : ""}>${item.title}</a>`,
            )
            .join("")}`,
      )
      .join(
        "",
      )}<a href="#resources">资源与开源</a></nav></aside>`;
  }
  // Screenshot slot. Drop assets/shots/<id>.webp in place and run sync-site-content to fill it.
  const shot = (id, caption, className = "") => {
    const src = shots[id];
    return `<figure class="shot ${src ? "has-image" : ""} ${className}" data-shot="${id}">${src ? `<img src="${src}" alt="${escape(caption)}" loading="lazy" decoding="async">` : ""}<figcaption>${src ? escape(caption) : `截图位 · ${id}`}</figcaption></figure>`;
  };
  const providers = [
    ["openai.png", "OpenAI", "GPTL"],
    ["claude.svg", "Anthropic", "ANTL"],
    ["gemini.svg", "Gemini", "GEML"],
    ["deepseek.png", "DeepSeek", "DSML"],
    ["qwen.png", "Qwen", "QWEM"],
    ["glm.png", "智谱 GLM", "GLMM"],
    ["moonshot.png", "Kimi", "KIML"],
    ["agnes.png", "Agnes", "AGNL"],
  ];
  const icon = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  function home() {
    const features = [
      ["workspace", "高效处理你的工程任务", "将困扰你的工作难题交给 Yan Agent，包括深藏不露的错误、复杂项目修改以及新功能的开发。Yan Agent 可高效完成工作，并通过强大的前端验收和后端端到端测试功能向你交付严谨且质量的成果。", "了解工作区", "home-workspace", "Yan Agent 桌面工作区与任务输入界面"],
      ["agents", "子代理并行工作支持", "Yan Agent 会并行运行多个子代理，并利用计算机和浏览器工具验证工作成果，直至满足你的要求。在一处跟踪进度、引导智能体并审查结果。", "了解智能体协作", "home-agents", "Yan Agent 子代理并行工作与进度界面"],
      ["browser", "通过WebUI继续你的任务", "即使暂时不便使用电脑，也不影响你进入WebUI继续管理和续跑任务（限同一局域网）", "", "home-webui", "Yan Agent 手机 WebUI 任务界面"],
      ["review", "从容扩展代码审查规模", "随着团队开发速度加快，让代码变更持续推进。Yan Agent 会自动审查 PR (Pull Request)、指出发现的问题并解答疑问，让你能够专注于最需要自己判断的环节。", "", "home-pr-review", "Yan Agent PR 列表、代码差异与审查提问界面"],
    ];
    const integrations = [
      ["Codex", "codex.svg"], ["Claude", "claude.svg"],
      ["Reasonix Studio", "reasonix.svg"], ["Computer Use", "computer-use.png"],
      ["GitHub", "github.svg"], ["Figma", "figma-color.svg"],
      ["Notion", "notion.svg"], ["Canva", "canva.png"],
      ["Gmail", "gmail-color.svg"], ["Outlook", "outlook-color.svg"],
    ];
    const guides = [
      ["workspace", "工作区与项目", "home-guide-workspace"],
      ["agents", "桌面智能体协作", "home-guide-agents"],
      ["media", "设置和全模态链路", "home-guide-media"],
      ["plugins", "插件与技能", "home-guide-plugins"],
    ];
    return `<main id="main" class="home" tabindex="-1">
      <section class="product-hero" aria-labelledby="hero-title">
        <div class="hero-backdrop" aria-hidden="true"><div id="hero-pixel-blast"></div></div>
        <div class="hero-copy"><img class="hero-mark" src="assets/product/yan-logo-dark.png" alt="" width="88" height="88"><h1 id="hero-title">借助 Yan Agent，<br>构建你想要的一切</h1><p>与你选择的模型一起，把想法变成真实的工作成果。</p><div class="hero-actions"><a class="button primary" href="#download">下载 Windows 版</a><a class="button github-button" href="${repo}">Github <img src="assets/logos/github.svg" alt="" width="18" height="18" aria-hidden="true"></a></div>
        <div class="model-proof"><p>选择、接入你中意的模型，并搭配 Yan Agent 的 8 大适配器以高效工作或编码</p><ul class="provider-row" aria-label="可配置的模型提供商及其适配器">${providers.map(([file, name, adapter]) => `<li><img src="assets/logos/${file}" alt="" width="26" height="26" loading="lazy"><span>${name} · ${adapter}</span></li>`).join("")}</ul></div></div>
        ${shot("home-hero", "Yan Agent 桌面应用：项目、任务与模型选择", "hero-product")}
      </section>
      <section class="product-section feature-section" aria-labelledby="feature-title"><h2 id="feature-title">使用智能体进行构建的最佳方式</h2><div class="feature-rows">${features.map(([id, title, description, label, shotId, alt], i) => `<article class="feature-row ${i === 0 ? "workspace-feature" : ""} ${i % 2 ? "reversed" : ""}"><div class="feature-copy"><h3>${title}</h3><p>${description}</p>${i <= 3 ? "" : `<a class="text-link" href="#${id}">${label} <span aria-hidden="true">→</span></a>`}</div><div class="feature-media media-${i}">${shotId === "home-workspace" ? `<div class="workspace-composite"><img class="workspace-review" src="assets/shots/workspace-review.png" alt="Yan Agent 代码差异审阅" loading="lazy" decoding="async"><img class="workspace-chat" src="assets/shots/workspace-chat-detail.png" alt="Yan Agent 任务对话与修复结果" loading="lazy" decoding="async"></div>` : shotId === "home-webui" ? `<div class="webui-phone"><div class="webui-phone-screen"><img src="assets/shots/webui-mobile.jpg" alt="Yan Agent 手机 WebUI 任务与验证结果" loading="lazy" decoding="async"><span class="webui-phone-island" aria-hidden="true"></span></div></div>` : shot(shotId, alt)}</div></article>`).join("")}</div></section>
      <section class="product-section integrations" aria-labelledby="integration-title"><h2 id="integration-title">将 Yan Agent 直接融入你的工作流</h2><p class="product-intro">连接工具，并通过插件添加专业功能。为 Yan Agent 提供所需的上下文信息和访问权限，使其能够跨应用执行操作，替你完成更多工作。</p><div class="integration-carousel" role="img" aria-label="Codex、Claude、Reasonix Studio、Computer Use、GitHub、Figma、Notion、Canva、Gmail、Outlook">${integrations.slice(0, 5).map((item, index) => `<div class="integration-column" aria-hidden="true"><div class="integration-column-track" style="--roll-delay: ${index * 0.8}s">${[item, integrations[index + 5], item].map(([name, file]) => `<div class="integration-logo"><img src="assets/logos/${file}" alt="" title="${name}" width="52" height="52"></div>`).join("")}</div></div>`).join("")}</div></section>
      <section class="product-section guide-section" aria-labelledby="guide-title"><h2 id="guide-title">轻松上手 Yan Agent</h2><p class="product-intro">从理解项目、浏览网页，到扩展能力和审阅结果。</p><div class="guide-grid">${guides.map(([id, title, shotId], i) => `<article class="guide-card"><div class="guide-media media-${i}">${shot(shotId, title + "界面")}</div><h3>${title}</h3><a class="button" href="#${id}">阅读指南 <span aria-hidden="true">→</span></a></article>`).join("")}</div><div class="guide-actions"><a class="button primary" href="#quickstart">查看完整使用指南 <span aria-hidden="true">→</span></a></div></section>
      ${closingCta()}

    </main>`;
  }
  function closingCta() {
    return `<section class="closing-cta"><div id="closing-pixel-blast" aria-hidden="true"></div><div class="closing-copy"><img src="assets/product/yan-logo-dark.png" alt="" width="68" height="68"><h2>开始使用 Yan Agent 进行构建</h2><div class="hero-actions"><a class="button github-button" href="${repo}">Github·MIT <img src="assets/logos/github.svg" alt="" width="18" height="18" aria-hidden="true"></a></div></div></section>`;
  }
  let unmountPixelBlast = () => {};
  function setupHeroPixelBlast() {
    unmountPixelBlast();
    const cleanups = [];
    const hero = page.querySelector("#hero-pixel-blast");
    const closing = page.querySelector("#closing-pixel-blast");
    if (window.YanPixelBlast) {
      if (hero) cleanups.push(window.YanPixelBlast.mount(hero));
      if (closing) cleanups.push(window.YanPixelBlast.mount(closing, { color: "#408098", patternDensity: 1.2 }));
    }
    unmountPixelBlast = () => cleanups.forEach(cleanup => cleanup());
  }
  function download() {
    const channels = [
      ["github", "GitHub 下载", "通过 GitHub 获取 Yan Agent Windows 安装包。"],
      ["baidu", "百度网盘下载", "通过百度网盘获取 Yan Agent Windows 安装包。"],
    ];
    const downloadIcon = icon('<path d="M12 3V15M8 11L12 15L16 11M4 19H20"/>');
    return `<main id="main" class="download-view" tabindex="-1"><div class="resource-page download-page"><header class="download-heading"><h1>下载 Yan Agent</h1><p>选择适合你的下载方式，开始构建。</p><span class="download-version">Yan Agent v${escape(release.label)} · Windows x64</span></header><div class="download-grid">${channels.map(([id, title, description]) => {
      const url = downloadLinks[id];
      return `<section class="download-card"><div class="download-card-copy"><h2>${title}</h2><p>${description}</p></div>${url ? `<a class="download-icon-button" href="${escape(url)}" ${id === "github" ? 'download="Yan.Agent.Setup.v1.7.0.exe"' : 'target="_blank" rel="noopener noreferrer"'} aria-label="${title}" title="${title}">${downloadIcon}</a>` : `<button class="download-icon-button" type="button" disabled aria-label="${title}，链接待更新" title="下载链接待更新">${downloadIcon}</button>`}</section>`;
    }).join("")}</div></div>${closingCta()}</main>`;
  }
  function resources() {
    return `<main id="main" class="resource-page article" tabindex="-1"><div class="breadcrumb">Yan Agent / 资源</div><h1>资源与开源</h1><p class="lead">查阅源码、获取已发布版本，或把你的问题反馈给项目。</p><div class="home-links">${[
      [repo, "GitHub 仓库", "源代码与项目 README"],
      [`${repo}/releases`, "下载与发布记录", "Windows x64 安装包与版本资产"],
      [`${repo}/issues`, "问题反馈", "报告错误或提出功能建议"],
      [
        `${repo}/blob/main/lib/THIRD_PARTY_NOTICES.md`,
        "第三方致谢",
        "依赖来源与相关许可",
      ],
      ["#quickstart", "使用指南", "从第一条任务开始"],
      ["#updates", "更新日志", "当前版本与迁移说明"],
    ]
      .map(
        ([url, title, description]) =>
          `<a href="${url}"><span><strong>${title}</strong><small>${description}</small></span><span>↗</span></a>`,
      )
      .join(
        "",
      )}</div><section><h2>开源与许可</h2><p>Yan Agent 采用 MIT License。第三方组件、技能与插件各自适用的许可，请查阅仓库中的第三方致谢和对应插件信息。</p></section><aside class="callout">当前开发版本为 <strong>${escape(release.label)}</strong>。可下载的版本以 Releases 中实际发布的安装包为准。</aside></main>`;
  }
  const guideIllustrations = {
    interface: [["help-interface", "Yan Agent 主界面"], ["help-interface-tools", "Yan Agent 对话、输入菜单与右侧浏览器面板"]],
    plugins: [["help-plugins", "Remotion 插件详情与技能开关"]],
    skills: [["help-skills", "Hallmark 技能详情与使用示例"]],
    computer: [["help-computer", "Yan Computer Use 插件与使用示例"], ["help-snapshot", "应用快照设置"]],
  };
  const guideImages = (id) => (guideIllustrations[id] || [])
    .map(([shotId, caption]) => `<div class="feature-media media-0 guide-illustration">${shot(shotId, caption)}</div>`)
    .join("");
  function article(doc) {
    if (doc.id === "updates") {
      return `<div class="layout document-layout updates-layout"><aside class="toc section-directory" aria-label="更新日志目录"><p class="toc-title">更新日志目录</p><nav>${doc.sections.map((section, i) => `<a href="#updates/${section.id}" ${i === 0 ? 'aria-current="location"' : ""}>${escape(section.title)}</a>`).join("")}</nav></aside><main id="main" class="article" tabindex="-1"><h1>更新日志</h1>${doc.sections.map(section => `<section id="${section.id}"><h2>${escape(section.title)}</h2>${section.html}</section>`).join("")}</main></div>`;
    }

    const index = allDocs.indexOf(doc),
      prev = allDocs[index - 1],
      next = allDocs[index + 1];
    return `<div class="layout document-layout help-layout">${sidebar(doc.id)}<main id="main" class="article" tabindex="-1"><div class="breadcrumb">使用指南 / ${doc.group}</div><h1>${doc.title}</h1><p class="lead">${escape(doc.description)}</p>${guideImages(doc.id)}${doc.sections.map((section) => `<section id="${section.id}"><h2>${escape(section.title)}</h2>${section.html}</section>`).join("")}<nav class="page-turn" aria-label="相邻文档"><div>${prev ? `<small>上一篇</small><a href="#${prev.id}">← ${prev.title}</a>` : ""}</div><div>${next ? `<small>下一篇</small><a href="#${next.id}">${next.title} →</a>` : ""}</div></nav></main><aside class="toc section-directory page-toc" aria-label="本页目录"><p class="toc-title">本页内容</p><nav>${doc.sections.map((section, i) => `<a href="#${doc.id}/${section.id}" ${i === 0 ? 'aria-current="location"' : ""}>${escape(section.title)}</a>`).join("")}</nav></aside></div>`;
  }
  function setCurrent(selector, value, attribute) {
    document.querySelectorAll(selector).forEach((link) => {
      link.removeAttribute("aria-current");
      if (link.getAttribute(attribute) === value)
        link.setAttribute("aria-current", "page");
    });
  }
  function route() {
    const raw = location.hash.slice(1),
      [requested, anchor] = raw.split("/");
    const id = aliases[requested] || requested || "home";
    const doc = allDocs.find((item) => item.id === id);
    const validId = doc || id === "home" || id === "resources" || id === "download";
    observer?.disconnect();
    if (renderedId !== id) {
      currentDoc = doc;
      document.body.dataset.view = doc
        ? id === "updates"
          ? "updates"
          : "docs"
        : id === "download"
          ? "download"
          : id === "resources"
          ? "resources"
          : "home";
      page.innerHTML = doc
        ? article(doc)
        : id === "download"
          ? download()
          : id === "resources"
          ? resources()
          : validId
            ? home()
            : `<main id="main" class="resource-page article" tabindex="-1"><h1>没有找到这篇文档</h1><p>地址可能已变更。可以搜索关键词，或回到快速开始。</p><a class="button" href="#quickstart">查看使用指南 →</a></main>`;
      document.title = id === "home" ? "Yan Agent | 开源AI智能体" : `${doc ? doc.title : id === "download" ? "下载" : id === "resources" ? "资源与开源" : "文档未找到"} · Yan Agent`;
      renderedId = id;
      setCurrent(
        "[data-nav]",
        doc ? (id === "updates" ? "updates" : "docs") : id,
        "data-nav",
      );
      setCurrent("[data-category]", doc?.group, "data-category");
      page.querySelector("#menu-toggle")?.addEventListener("click", (event) => {
        const open = page
          .querySelector(".layout")
          .classList.toggle("menu-open");
        event.currentTarget.setAttribute("aria-expanded", String(open));
      });
      page
        .querySelectorAll("[data-copy]")
        .forEach((button) =>
          button.addEventListener("click", () => copyPage(button)),
        );
      setupHeroPixelBlast();
      document.getElementById("header-menu").setAttribute("aria-expanded", "false");
      document.querySelector(".header").classList.remove("nav-open");
      window.scrollTo(0, 0);
    }
    if (doc) {
      observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort(
              (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
            );
          if (visible[0]) {
            page.querySelectorAll(".section-directory a").forEach((link) => {
              link.removeAttribute("aria-current");
              if (link.hash === `#${id}/${visible[0].target.id}`)
                link.setAttribute("aria-current", "location");
            });
          }
        },
        { rootMargin: "-145px 0px -55% 0px", threshold: 0 },
      );
      page
        .querySelectorAll(".article section")
        .forEach((section) => observer.observe(section));
    }
    if (anchor && doc?.sections.some((section) => section.id === anchor))
      requestAnimationFrame(() =>
        document.getElementById(anchor)?.scrollIntoView(),
      );
    else if (!anchor) window.scrollTo(0, 0);
  }
  async function copyPage(button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "正在复制…";
    const content = `# ${currentDoc.title}\n\n${currentDoc.description}\n\n${currentDoc.sections.map((section) => `## ${section.title}\n\n${plain(section.html)}`).join("\n\n")}\n\n${location.href}`;
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(content);
      button.textContent = "已复制 ✓";
    } catch {
      button.textContent = "复制失败，请选择正文复制";
    }
    button.disabled = false;
    setTimeout(() => {
      if (button.isConnected) button.textContent = original;
    }, 2500);
  }
  const searchIndex = allDocs.flatMap((doc) => [
    {
      id: doc.id,
      title: doc.title,
      description: doc.description,
      text: `${doc.title} ${doc.description}`,
    },
    ...doc.sections.map((section) => ({
      id: `${doc.id}/${section.id}`,
      title: `${doc.title} · ${section.title}`,
      description: plain(section.html).slice(0, 90),
      text: `${doc.title} ${section.title} ${plain(section.html)}`,
    })),
  ]);
  function search() {
    const query = input.value.trim().toLocaleLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    const results = query
      ? searchIndex
          .filter((item) =>
            tokens.every((token) =>
              item.text.toLocaleLowerCase().includes(token),
            ),
          )
          .slice(0, 16)
      : docs
          .slice(0, 6)
          .map((doc) => ({
            id: doc.id,
            title: doc.title,
            description: doc.description,
          }));
    document.getElementById("search-results").innerHTML = results.length
      ? results
          .map(
            (item) =>
              `<a class="search-result" href="#${escape(item.id)}"><strong>${escape(item.title)}</strong><small>${escape(item.description)}</small></a>`,
          )
          .join("")
      : `<p class="empty-results">没有找到“${escape(input.value)}”。试试“模型”“插件”或“工作区”。</p>`;
  }
  function openSearch() {
    dialog.showModal();
    input.value = "";
    search();
    input.focus();
  }
  document.getElementById("search-open")?.addEventListener("click", openSearch);
  document
    .getElementById("search-close")
    .addEventListener("click", () => dialog.close());
  input.addEventListener("input", search);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      dialog.querySelector(".search-result")?.focus();
    }
    if (event.key === "Enter") {
      dialog.querySelector(".search-result")?.click();
    }
  });
  dialog.addEventListener("click", (event) => {
    if (event.target.closest(".search-result")) dialog.close();
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    }
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dialog.close();
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key) || event.target === input)
      return;
    const links = [...dialog.querySelectorAll(".search-result")];
    const index = links.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    if (event.key === "ArrowUp" && index === 0) input.focus();
    else
      links[
        (index + (event.key === "ArrowDown" ? 1 : -1) + links.length) %
          links.length
      ]?.focus();
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      dialog.open ? dialog.close() : openSearch();
    }
  });
  document.documentElement.dataset.theme = "dark";
  document.querySelector(".skip-link").addEventListener("click", (event) => {
    event.preventDefault();
    document.getElementById("main")?.focus();
  });
  document.getElementById("header-menu").addEventListener("click", (event) => {
    const expanded = document.querySelector(".header").classList.toggle("nav-open");
    event.currentTarget.setAttribute("aria-expanded", String(expanded));
  });
  const updateHeader = () => document.querySelector(".header").classList.toggle("header-scrolled", window.scrollY > 24);
  window.addEventListener("scroll", updateHeader, { passive: true });
  updateHeader();
  window.addEventListener("hashchange", route);
  route();
})();
