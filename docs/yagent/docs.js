(() => {
  const SOURCE = "../technical-reference.md";
  const REPO = "https://github.com/ViaTumLab/YAgent";
  const content = document.querySelector("#doc-content");
  const toc = document.querySelector("#toc");
  const filter = document.querySelector("#chapter-filter");
  const menuButton = document.querySelector("#menu-button");
  const scrim = document.querySelector("#sidebar-scrim");
  const progress = document.querySelector("#reading-progress");

  const escapeHtml = (value) => value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  function resolveLink(url) {
    const clean = url.replaceAll("https://github.com/666-gy/Yan-Agent", REPO);
    if (/^(https?:|mailto:|#)/.test(clean)) return clean;
    if (clean === "index.html") return "https://viatumlab.com";
    if (clean === "product-intro.html") return "../product-intro.html";
    const path = clean.replace(/^\.\.\//, "").replace(/^\.\//, "");
    const looksLikeDirectory = !/\.[a-z0-9]+(?:#.*)?$/i.test(path);
    return `${REPO}/${looksLikeDirectory ? "tree" : "blob"}/main/${path}`;
  }

  function inline(source) {
    const stash = [];
    const hold = (html) => `\u0000${stash.push(html) - 1}\u0000`;
    let value = escapeHtml(source);
    value = value.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${code}</code>`));
    value = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => hold(`<img src="${escapeHtml(resolveLink(url))}" alt="${alt}">`));
    value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const href = resolveLink(url);
      const external = /^https?:/.test(href) ? ' target="_blank" rel="noopener noreferrer"' : "";
      return hold(`<a href="${escapeHtml(href)}"${external}>${label}</a>`);
    });
    value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    value = value.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
    return value.replace(/\u0000(\d+)\u0000/g, (_, index) => stash[Number(index)]);
  }

  function slug(text) {
    return text.toLowerCase().replace(/<[^>]*>/g, "").replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "") || "section";
  }

  function isTableRule(line) {
    return /^\s*\|?\s*:?-{3,}/.test(line) && line.includes("|");
  }

  function cells(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  }

  function isBlockStart(lines, index) {
    const line = lines[index] || "";
    const next = lines[index + 1] || "";
    return !line.trim() || /^```/.test(line) || /^#{2,4}\s/.test(line) || /^<a id=/.test(line) || /^>\s?/.test(line) || /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line) || (line.includes("|") && isTableRule(next));
  }

  function renderMarkdown(markdown) {
    const start = markdown.indexOf('<a id="start"></a>');
    const source = start >= 0 ? markdown.slice(start) : markdown;
    const lines = source.replaceAll("\r\n", "\n").split("\n");
    const out = [];
    let index = 0;
    let pendingId = "";
    let sectionOpen = false;
    let sectionNumber = 0;

    while (index < lines.length) {
      const line = lines[index];
      const anchor = line.match(/^<a id="([^"]+)"><\/a>$/);
      if (anchor) { pendingId = anchor[1]; index += 1; continue; }
      if (!line.trim()) { index += 1; continue; }

      const fence = line.match(/^```([^\s]*)/);
      if (fence) {
        const language = fence[1] || "text";
        const code = [];
        index += 1;
        while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
        index += 1;
        out.push(`<div class="code-block"><div class="code-head"><span>${escapeHtml(language)}</span><button class="copy-code" type="button">\u590d\u5236</button></div><pre><code>${escapeHtml(code.join("\n"))}</code></pre></div>`);
        continue;
      }

      const heading = line.match(/^(#{2,4})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        const title = inline(heading[2]);
        const id = pendingId || slug(heading[2]);
        pendingId = "";
        if (level === 2) {
          if (sectionOpen) out.push("</section>");
          sectionOpen = true;
          sectionNumber += 1;
          out.push(`<section class="doc-section" data-section="${escapeHtml(id)}"><h2 id="${escapeHtml(id)}"><span class="section-number">${String(sectionNumber).padStart(2, "0")} / SECTION</span>${title}</h2>`);
        } else {
          out.push(`<h${level} id="${escapeHtml(id)}">${title}</h${level}>`);
        }
        index += 1;
        continue;
      }

      if (line.includes("|") && isTableRule(lines[index + 1] || "")) {
        const head = cells(line);
        index += 2;
        const rows = [];
        while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(cells(lines[index++]));
        out.push(`<div class="table-wrap"><table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
        out.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
        continue;
      }

      const list = line.match(/^\s*([-*]|\d+\.)\s+(.+)$/);
      if (list) {
        const ordered = /\d+\./.test(list[1]);
        const tag = ordered ? "ol" : "ul";
        const items = [];
        while (index < lines.length) {
          const item = lines[index].match(/^\s*([-*]|\d+\.)\s+(.+)$/);
          if (!item || /\d+\./.test(item[1]) !== ordered) break;
          items.push(item[2]);
          index += 1;
        }
        out.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`);
        continue;
      }

      const paragraph = [line.trim()];
      index += 1;
      while (index < lines.length && !isBlockStart(lines, index)) paragraph.push(lines[index++].trim());
      out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    }
    if (sectionOpen) out.push("</section>");
    return out.join("\n");
  }

  function buildToc() {
    const headings = [...content.querySelectorAll("h2")];
    toc.innerHTML = headings.map((heading, index) => `<a href="#${heading.id}" data-target="${heading.id}"><span class="toc-index">${String(index + 1).padStart(2, "0")}</span><span>${heading.childNodes[heading.childNodes.length - 1].textContent}</span></a>`).join("");
    return headings;
  }

  function closeMenu() {
    document.body.classList.remove("menu-open");
    menuButton.setAttribute("aria-expanded", "false");
  }

  function enhance(headings) {
    document.querySelectorAll(".copy-code").forEach((button) => {
      button.addEventListener("click", async () => {
        const code = button.closest(".code-block").querySelector("code").textContent;
        await navigator.clipboard.writeText(code);
        button.textContent = "\u5df2\u590d\u5236";
        window.setTimeout(() => { button.textContent = "\u590d\u5236"; }, 1400);
      });
    });

    const links = [...toc.querySelectorAll("a")];
    links.forEach((link) => link.addEventListener("click", closeMenu));
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      links.forEach((link) => link.classList.toggle("active", link.dataset.target === visible.target.id));
    }, { rootMargin: "-18% 0px -70% 0px" });
    headings.forEach((heading) => observer.observe(heading));

    if (location.hash) requestAnimationFrame(() => document.querySelector(location.hash)?.scrollIntoView());
  }

  filter.addEventListener("input", () => {
    const query = filter.value.trim().toLowerCase();
    let shown = 0;
    toc.querySelectorAll("a").forEach((link) => {
      const match = link.textContent.toLowerCase().includes(query);
      link.hidden = !match;
      if (match) shown += 1;
    });
    toc.querySelector(".toc-empty")?.remove();
    if (!shown) toc.insertAdjacentHTML("beforeend", '<div class="toc-empty">\u6ca1\u6709\u5339\u914d\u7684\u7ae0\u8282</div>');
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== filter) {
      event.preventDefault();
      filter.focus();
    }
    if (event.key === "Escape") closeMenu();
  });
  menuButton.addEventListener("click", () => {
    const open = document.body.classList.toggle("menu-open");
    menuButton.setAttribute("aria-expanded", String(open));
  });
  scrim.addEventListener("click", closeMenu);
  window.addEventListener("scroll", () => {
    const total = document.documentElement.scrollHeight - innerHeight;
    progress.style.width = `${total > 0 ? Math.min(100, scrollY / total * 100) : 0}%`;
  }, { passive: true });

  fetch(SOURCE)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    })
    .then((markdown) => {
      content.innerHTML = renderMarkdown(markdown);
      enhance(buildToc());
    })
    .catch(() => {
      toc.innerHTML = "";
      content.innerHTML = `<div class="doc-error"><strong>\u6280\u672f\u6587\u6863\u52a0\u8f7d\u5931\u8d25\u3002</strong><p>\u8bf7\u5237\u65b0\u9875\u9762\uff0c\u6216\u76f4\u63a5<a href="${SOURCE}">\u6253\u5f00 Markdown \u539f\u6587</a>\u3002</p></div>`;
    });
})();
