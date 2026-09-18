(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // lib/vendor/dsh-code-review/src/diff-parse.ts
  var diff_parse_exports = {};
  __export(diff_parse_exports, {
    countStats: () => countStats,
    displayPath: () => displayPath,
    isDiffText: () => isDiffText,
    parseGitDiff: () => parseGitDiff
  });
  function displayPath(path) {
    if (path === "/dev/null") return path;
    return path.replace(/^[ab]\//, "");
  }
  function isDiffText(text) {
    const lines = text.split("\n");
    if (lines.some((line) => line.startsWith("diff --git "))) return true;
    const hasHunk = lines.some((line) => /^@@ -\d+/.test(line));
    const hasFileMark = lines.some((line) => /^(---|\+\+\+) \S/.test(line));
    return hasHunk && hasFileMark;
  }
  function parseGitDiff(text) {
    const lines = text.split(/\r?\n/);
    const files = [];
    let inHunk = false;
    let oldNo = 0;
    let newNo = 0;
    let pendingDels = [];
    let lastKind = null;
    let lastNewRow = null;
    function current() {
      return files.length > 0 ? files[files.length - 1] : null;
    }
    function flushPending() {
      const file = current();
      if (file === null || pendingDels.length === 0) return;
      for (const del of pendingDels) {
        file.rows.push({
          kind: "del",
          oldNo: del.no,
          oldText: del.text,
          oldNoEol: del.noEol
        });
        lastNewRow = null;
      }
      pendingDels = [];
    }
    function startFile(oldPath, newPath) {
      flushPending();
      inHunk = false;
      lastKind = null;
      lastNewRow = null;
      files.push({
        oldPath,
        newPath,
        status: "modified",
        meta: [],
        rows: []
      });
    }
    function openHunk(line) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
      if (match === null) return false;
      flushPending();
      oldNo = Number(match[1]);
      newNo = Number(match[3]);
      inHunk = true;
      lastKind = null;
      lastNewRow = null;
      current()?.rows.push({ kind: "gap", gapText: line });
      return true;
    }
    function emitContext(text2) {
      const file = current();
      if (file === null) return;
      const row = { kind: "ctx", oldNo, newNo, oldText: text2, newText: text2 };
      file.rows.push(row);
      oldNo += 1;
      newNo += 1;
      lastKind = "ctx";
      lastNewRow = row;
    }
    function emitChange(del, addText) {
      const file = current();
      if (file === null) return;
      const row = {
        kind: "change",
        oldNo: del.no,
        newNo,
        oldText: del.text,
        newText: addText,
        oldNoEol: del.noEol
      };
      file.rows.push(row);
      newNo += 1;
      lastKind = "add";
      lastNewRow = row;
    }
    function emitAdd(text2) {
      const file = current();
      if (file === null) return;
      const row = { kind: "add", newNo, newText: text2 };
      file.rows.push(row);
      newNo += 1;
      lastKind = "add";
      lastNewRow = row;
    }
    function markNoEol() {
      if (lastKind === "del") {
        const last = pendingDels[pendingDels.length - 1];
        if (last !== void 0) {
          last.noEol = true;
        } else {
          const file = current();
          if (file !== null && file.rows.length > 0) {
            const row = file.rows[file.rows.length - 1];
            if (row.kind === "del") row.oldNoEol = true;
          }
        }
      } else if (lastKind === "add") {
        if (lastNewRow !== null) lastNewRow.newNoEol = true;
      } else if (lastKind === "ctx") {
        const file = current();
        if (file !== null && file.rows.length > 0) {
          const row = file.rows[file.rows.length - 1];
          if (row.kind === "ctx") {
            row.oldNoEol = true;
            row.newNoEol = true;
          }
        }
      }
    }
    for (const line of lines) {
      if (line === "") continue;
      if (line.startsWith("diff --git ")) {
        const match = /^diff --git (?:a\/)?(\S+) (?:b\/)?(\S+)$/.exec(line);
        startFile(match?.[1] ?? "", match?.[2] ?? "");
        continue;
      }
      if (line.startsWith("@@ ")) {
        openHunk(line);
        continue;
      }
      const cur = current();
      if (cur === null) {
        if (line.startsWith("--- ") && line.length > 4) startFile(line.slice(4), "");
        continue;
      }
      if (!inHunk) {
        if (line.startsWith("--- ") && line.length > 4) {
          cur.oldPath = line.slice(4);
        } else if (line.startsWith("+++ ") && line.length > 4) {
          cur.newPath = line.slice(4);
        } else if (line.startsWith("new file mode ")) {
          cur.status = "added";
          cur.meta.push(line);
        } else if (line.startsWith("deleted file mode ")) {
          cur.status = "deleted";
          cur.meta.push(line);
        } else if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
          cur.status = "renamed";
          cur.meta.push(line);
        } else if (line.startsWith("old mode ") || line.startsWith("new mode ") || line.startsWith("similarity index ") || line.startsWith("dissimilarity index ") || line.startsWith("copy from ") || line.startsWith("copy to ")) {
          cur.meta.push(line);
        } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
          cur.status = "binary";
          cur.meta.push(line);
        } else if (line.startsWith("index ")) {
          cur.meta.push(line);
        }
        continue;
      }
      const kind = line[0];
      const body = line.slice(1);
      if (kind === " ") {
        flushPending();
        emitContext(body);
      } else if (kind === "-") {
        pendingDels.push({ text: body, no: oldNo, noEol: false });
        oldNo += 1;
        lastKind = "del";
      } else if (kind === "+") {
        const del = pendingDels.shift();
        if (del !== void 0) {
          emitChange(del, body);
        } else {
          emitAdd(body);
        }
      } else if (kind === "\\" && line.startsWith("\\ No newline at end of file")) {
        markNoEol();
      } else {
        flushPending();
        emitContext(line);
      }
    }
    flushPending();
    return files;
  }
  function countStats(files) {
    let added = 0;
    let removed = 0;
    for (const file of files) {
      for (const row of file.rows) {
        if (row.kind === "add" || row.kind === "change") added += 1;
        if (row.kind === "del" || row.kind === "change") removed += 1;
      }
    }
    return { added, removed, files: files.length };
  }

  // lib/vendor/dsh-code-review/src/diff-view.ts
  var diff_view_exports = {};
  __export(diff_view_exports, {
    CR_TEXTS: () => CR_TEXTS,
    buildCommentReport: () => buildCommentReport,
    buildStandaloneHtml: () => buildStandaloneHtml
  });

  // lib/vendor/dsh-code-review/src/diff-highlight.ts
  var KEYWORDS = /* @__PURE__ */ new Set([
    // JS/TS
    "const",
    "let",
    "var",
    "function",
    "class",
    "extends",
    "super",
    "new",
    "delete",
    "typeof",
    "instanceof",
    "in",
    "of",
    "this",
    "static",
    "get",
    "set",
    "async",
    "await",
    "yield",
    "return",
    "if",
    "else",
    "switch",
    "case",
    "default",
    "break",
    "continue",
    "try",
    "catch",
    "finally",
    "throw",
    "for",
    "while",
    "do",
    "import",
    "export",
    "from",
    "as",
    "interface",
    "type",
    "enum",
    "namespace",
    "module",
    "implements",
    "public",
    "private",
    "protected",
    "readonly",
    "abstract",
    "declare",
    "keyof",
    "infer",
    "never",
    "unknown",
    "any",
    "void",
    "null",
    "undefined",
    "true",
    "false",
    "NaN",
    "Infinity",
    "require",
    // Python
    "def",
    "lambda",
    "pass",
    "raise",
    "elif",
    "not",
    "and",
    "or",
    "is",
    "None",
    "True",
    "False",
    "print",
    "with",
    "global",
    "nonlocal",
    "assert",
    "del",
    // Go
    "go",
    "func",
    "package",
    "struct",
    "map",
    "chan",
    "select",
    "defer",
    "range",
    "nil",
    "goto",
    "fallthrough",
    // Rust
    "fn",
    "let",
    "mut",
    "pub",
    "impl",
    "trait",
    "match",
    "use",
    "mod",
    "self",
    "crate",
    "unsafe",
    "where",
    "loop",
    "move",
    "ref",
    "dyn",
    // Java / C 系
    "int",
    "float",
    "double",
    "char",
    "boolean",
    "byte",
    "short",
    "long",
    "signed",
    "unsigned",
    "auto",
    "register",
    "extern",
    "volatile",
    "constexpr",
    "sizeof",
    "template",
    "typename"
  ]);
  var HIGHLIGHT_EXTS = /* @__PURE__ */ new Set([
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "json",
    "py",
    "rb",
    "go",
    "rs",
    "java",
    "c",
    "h",
    "cpp",
    "cc",
    "cs",
    "css",
    "scss",
    "less",
    "html",
    "htm",
    "vue",
    "xml",
    "sql",
    "md",
    "yml",
    "yaml",
    "toml",
    "sh",
    "bash",
    "zsh",
    "ini"
  ]);
  var HASH_COMMENT_EXTS = /* @__PURE__ */ new Set(["py", "rb", "sh", "bash", "zsh", "yml", "yaml", "toml", "ini"]);
  function langFor(path) {
    const dot = path.lastIndexOf(".");
    const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
    if (ext === "" || !HIGHLIGHT_EXTS.has(ext)) return null;
    return { hashComment: HASH_COMMENT_EXTS.has(ext) };
  }
  function isIdentStart(ch) {
    return /[A-Za-z_]/.test(ch);
  }
  function isIdentPart(ch) {
    return /[A-Za-z0-9_]/.test(ch);
  }
  function isDigitStart(ch) {
    return /[0-9]/.test(ch);
  }
  function isDigitPart(ch) {
    return /[0-9a-fA-FxXbBoO._]/.test(ch);
  }
  function tokenizeLine(text, lang) {
    const tokens = [];
    let plain = "";
    const flushPlain = () => {
      if (plain !== "") {
        tokens.push({ text: plain, cls: null });
        plain = "";
      }
    };
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        let j = i + 1;
        while (j < text.length) {
          if (text[j] === "\\") {
            j += 2;
            continue;
          }
          if (text[j] === ch) break;
          j += 1;
        }
        flushPlain();
        tokens.push({ text: text.slice(i, Math.min(j + 1, text.length)), cls: "tok-str" });
        i = Math.min(j + 1, text.length);
        continue;
      }
      if (ch === "/" && text[i + 1] === "/") {
        flushPlain();
        tokens.push({ text: text.slice(i), cls: "tok-com" });
        break;
      }
      if (ch === "/" && text[i + 1] === "*") {
        const close = text.indexOf("*/", i + 2);
        const end = close === -1 ? text.length : close + 2;
        flushPlain();
        tokens.push({ text: text.slice(i, end), cls: "tok-com" });
        i = end;
        continue;
      }
      if (lang.hashComment && ch === "#") {
        flushPlain();
        tokens.push({ text: text.slice(i), cls: "tok-com" });
        break;
      }
      if (isDigitStart(ch)) {
        let j = i + 1;
        while (j < text.length && isDigitPart(text[j])) j += 1;
        flushPlain();
        tokens.push({ text: text.slice(i, j), cls: "tok-num" });
        i = j;
        continue;
      }
      if (isIdentStart(ch)) {
        let j = i + 1;
        while (j < text.length && isIdentPart(text[j])) j += 1;
        const word = text.slice(i, j);
        flushPlain();
        tokens.push({ text: word, cls: KEYWORDS.has(word) ? "tok-kw" : null });
        i = j;
        continue;
      }
      plain += ch;
      i += 1;
    }
    flushPlain();
    return tokens;
  }
  function diffMidRange(oldText, newText) {
    const a = Array.from(oldText);
    const b = Array.from(newText);
    let pre = 0;
    const minLen = Math.min(a.length, b.length);
    while (pre < minLen && a[pre] === b[pre]) pre += 1;
    let oldEnd = a.length;
    let newEnd = b.length;
    while (oldEnd > pre && newEnd > pre && a[oldEnd - 1] === b[newEnd - 1]) {
      oldEnd -= 1;
      newEnd -= 1;
    }
    if (pre === a.length && pre === b.length) return null;
    return { oldStart: pre, oldEnd, newStart: pre, newEnd };
  }

  // lib/vendor/dsh-code-review/src/diff-view.ts
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  var STANDALONE_CSS = `
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 13px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  background: var(--dsw-alias-markdown-code-block);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.stats { font-size: 13px; color: var(--dsw-alias-label-secondary); }
.topbar-actions { display: flex; gap: 8px; }
.btn {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 2px 10px;
  cursor: pointer;
  font-family: inherit;
}
.btn:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l3); }
.sidenav {
  position: fixed;
  left: 0;
  top: 36px;
  bottom: 0;
  width: 220px;
  overflow-y: auto;
  padding: 12px 8px;
  background: var(--dsw-alias-markdown-code-block);
  border-right: 1px solid var(--dsw-alias-border-l2);
}
.navitem {
  display: block;
  padding: 4px 12px;
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  text-decoration: none;
  border-radius: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.navitem:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); }
main { margin-left: 220px; padding: 16px 24px 60px; }
.file { margin-bottom: 24px; background: var(--dsw-alias-markdown-code-block); border-radius: 12px; overflow: hidden; }
.filehead {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px 4px;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
  user-select: none;
}
.badge {
  flex: none;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  padding: 0 6px;
}
.path { overflow-wrap: anywhere; }
.meta { flex-basis: 100%; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dsh-cr-grid {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content minmax(0, 1fr);
}
.dsh-cr-row { display: contents; }
.dsh-cr-num {
  padding: 0 10px 0 4px;
  text-align: right;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
  user-select: none;
  white-space: nowrap;
}
.dsh-cr-cell {
  padding: 0 12px 0 4px;
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
  /* \u5236\u8868\u7B26\u6309 4 \u4E2A\u5B57\u7B26\u5BBD\u5EA6\u6E32\u67D3(\u6D4F\u89C8\u5668\u9ED8\u8BA4 8,\u4EE3\u7801\u9605\u8BFB\u592A\u677E) */
  tab-size: 4;
}
.dsh-cr-del .dsh-cr-num-old, .dsh-cr-del .dsh-cr-cell-old,
.dsh-cr-change .dsh-cr-num-old, .dsh-cr-change .dsh-cr-cell-old {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
}
.dsh-cr-add .dsh-cr-num-new, .dsh-cr-add .dsh-cr-cell-new,
.dsh-cr-change .dsh-cr-num-new, .dsh-cr-change .dsh-cr-cell-new {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);
}
.dsh-cr-gaprow {
  grid-column: 1 / -1;
  padding: 2px 12px;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);
  user-select: none;
}
.dsh-cr-nonl { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
/* \u8BED\u6CD5\u9AD8\u4EAE:\u989C\u8272\u590D\u7528\u5B98\u65B9 shiki \u53D8\u91CF(\u4E0E DSH \u6DF1\u6D45\u4E3B\u9898\u4E00\u81F4,\u53D6\u4E0D\u5230\u65F6\u515C\u5E95) */
.tok-kw { color: var(--shiki-token-keyword, #7c3aed); }
.tok-str { color: var(--shiki-token-string, #16a34a); }
.tok-com { color: var(--shiki-token-comment, #9aa0a6); font-style: italic; }
.tok-num { color: var(--shiki-token-constant, #d97706); }
/* \u884C\u5185\u5B57\u7B26\u7EA7\u5DEE\u5F02:change \u884C\u4E2D\u6BB5\u52A0\u6DF1\u80CC\u666F(\u65E7\u4FA7\u7EA2/\u65B0\u4FA7\u7EFF) */
.dihl-mid-old {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 32%, transparent);
  border-radius: 2px;
}
.dihl-mid-new {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 32%, transparent);
  border-radius: 2px;
}
/* \u884C\u5185\u8BC4\u8BBA:\u884C\u53F7\u683C\u53EF\u70B9\u51FB,hover \u51FA\u73B0 + \u53F7 */
.dsh-cr-num[data-cr-line] {
  cursor: pointer;
  position: relative;
}
.dsh-cr-num[data-cr-line]:hover {
  color: var(--dsw-alias-label-primary);
}
.dsh-cr-num[data-cr-line]:hover::after {
  content: '+';
  position: absolute;
  left: 2px;
  top: 0;
  color: var(--dsw-alias-state-business-primary);
  font-weight: 700;
}
.cc {
  margin-left: 5px;
  font-size: 10px;
  line-height: 15px;
  color: #fff;
  background: var(--dsw-alias-state-business-primary);
  border-radius: 8px;
  padding: 0 5px;
  user-select: none;
}
.comment-draft {
  grid-column: 1 / -1;
  padding: 8px 12px;
  background: var(--dsw-alias-bg-layer-1);
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.comment-list { margin-bottom: 8px; }
.comment-item {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-markdown-code-block);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 4px;
  white-space: pre-wrap;
  word-break: break-word;
}
.comment-input {
  width: 100%;
  min-height: 60px;
  resize: vertical;
  box-sizing: border-box;
  font: inherit;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-markdown-code-block);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 6px 10px;
}
.comment-actions { display: flex; gap: 8px; margin-top: 8px; }
.submit-panel {
  position: fixed;
  top: 44px;
  right: 16px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--dsw-alias-markdown-code-block);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}
.submit-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.rawwrap { margin: 16px 24px; }
.rawsummary { font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.rawpre { white-space: pre-wrap; word-break: break-word; font: inherit; margin: 8px 0 0; tab-size: 4; }
`;
  var STANDALONE_STATUS_LABEL = {
    modified: "\u4FEE\u6539",
    added: "\u65B0\u589E\u6587\u4EF6",
    deleted: "\u5220\u9664\u6587\u4EF6",
    renamed: "\u91CD\u547D\u540D",
    binary: "\u4E8C\u8FDB\u5236",
    mode: "\u6743\u9650\u53D8\u66F4"
  };
  var CR_TEXTS = {
    zh: {
      openTab: "\u29C9 \u65B0\u6807\u7B7E\u9875\u6253\u5F00",
      openTabTitle: "\u5728\u72EC\u7ACB\u7684\u6D4F\u89C8\u5668\u6807\u7B7E\u9875\u4E2D\u6253\u5F00 Code Review \u89C6\u56FE",
      expand: "\u5C55\u5F00",
      collapse: "\u6536\u8D77",
      expandTitle: "\u5C55\u5F00\u539F\u59CB diff \u6587\u672C",
      collapseTitle: "\u6536\u8D77\u539F\u59CB diff \u6587\u672C",
      reportLgtmHeader: (count) => `Looks good to me \u2713 \u2014 Code Review \u5171 ${count} \u6761\u8BC4\u8BBA:`,
      reportCommentHeader: (count) => `Code Review \u610F\u89C1,\u5171 ${count} \u6761:`,
      reportLgtmBare: "Looks good to me \u2713",
      stats: (added, removed, files) => `+${added} \u2212${removed} \xB7 ${files} \u4E2A\u6587\u4EF6`,
      submitComments: "\u63D0\u4EA4\u8BC4\u8BBA",
      copyRaw: "\u590D\u5236\u539F\u59CB diff",
      copied: "\u5DF2\u590D\u5236",
      sent: "\u5DF2\u53D1\u9001 \u2713",
      submitHint: "\u628A\u5168\u90E8\u8BC4\u8BBA\u63D0\u4EA4\u5230 DSH \u5BF9\u8BDD\u6846:",
      submitLgtm: "Looks Good To Me \u2713",
      submitPlain: "\u4EC5\u63D0\u4EA4\u8BC4\u8BBA",
      rawSummary: "\u539F\u59CB diff \u6587\u672C",
      commentPlaceholder: "\u5728\u6B64\u884C\u6DFB\u52A0\u8BC4\u8BBA\u2026",
      addComment: "\u6DFB\u52A0\u8BC4\u8BBA",
      cancel: "\u53D6\u6D88",
      noNewlineTitle: "\u8BE5\u4FA7\u6587\u4EF6\u672B\u5C3E\u65E0\u6362\u884C\u7B26",
      openerClosed: "\u539F\u6765\u7684 DSH \u9875\u9762\u5DF2\u5173\u95ED,\u65E0\u6CD5\u56DE\u4F20\u8BC4\u8BBA",
      noSession: "\u672A\u80FD\u5199\u5165 DSH \u5BF9\u8BDD\u6846:\u5F53\u524D\u6CA1\u6709\u6253\u5F00\u4E2D\u7684\u4F1A\u8BDD",
      status: STANDALONE_STATUS_LABEL
    },
    en: {
      openTab: "\u29C9 Open in new tab",
      openTabTitle: "Open the code review view in a separate browser tab",
      expand: "Expand",
      collapse: "Collapse",
      expandTitle: "Show raw diff text",
      collapseTitle: "Hide raw diff text",
      reportLgtmHeader: (count) => `Looks good to me \u2713 \u2014 Code Review with ${count} comment${count === 1 ? "" : "s"}:`,
      reportCommentHeader: (count) => `Code Review comments (${count}):`,
      reportLgtmBare: "Looks good to me \u2713",
      stats: (added, removed, files) => `+${added} \u2212${removed} \xB7 ${files} file${files === 1 ? "" : "s"}`,
      submitComments: "Submit comments",
      copyRaw: "Copy raw diff",
      copied: "Copied",
      sent: "Sent \u2713",
      submitHint: "Submit all comments to the DSH composer:",
      submitLgtm: "Looks Good To Me \u2713",
      submitPlain: "Comments only",
      rawSummary: "Raw diff text",
      commentPlaceholder: "Add a comment on this line\u2026",
      addComment: "Add comment",
      cancel: "Cancel",
      noNewlineTitle: "No newline at end of file",
      openerClosed: "The original DSH page was closed; comments cannot be sent back",
      noSession: "Could not write to the DSH composer: no open session",
      status: {
        modified: "modified",
        added: "new file",
        deleted: "deleted",
        renamed: "renamed",
        binary: "binary",
        mode: "mode change"
      }
    }
  };
  function stringTexts(texts) {
    return {
      submitComments: texts.submitComments,
      copyRaw: texts.copyRaw,
      copied: texts.copied,
      sent: texts.sent,
      submitHint: texts.submitHint,
      submitLgtm: texts.submitLgtm,
      submitPlain: texts.submitPlain,
      rawSummary: texts.rawSummary,
      commentPlaceholder: texts.commentPlaceholder,
      addComment: texts.addComment,
      cancel: texts.cancel,
      noNewlineTitle: texts.noNewlineTitle,
      openerClosed: texts.openerClosed,
      noSession: texts.noSession
    };
  }
  function buildCommentReport(comments, kind, lang = "zh") {
    const texts = CR_TEXTS[lang];
    if (kind === "lgtm" && comments.length === 0) return texts.reportLgtmBare;
    const header = kind === "lgtm" ? texts.reportLgtmHeader(comments.length) : texts.reportCommentHeader(comments.length);
    const items = comments.map((comment, index) => {
      const lines = comment.text.split("\n");
      const first = `${index + 1}. ${comment.path}:${comment.lineNo} \u2014 ${lines[0]}`;
      const rest = lines.slice(1).map((line) => `   ${line}`);
      return [first, ...rest].join("\n");
    });
    return [header, "", ...items].join("\n");
  }
  function tokensToHtml(tokens) {
    let out = "";
    for (const token of tokens) {
      const escaped = escapeHtml(token.text);
      out += token.cls === null ? escaped : `<span class="${token.cls}">${escaped}</span>`;
    }
    return out;
  }
  function cellHtml(text, side, noEol, diffRange, lang, noNewlineTitle) {
    if (text === void 0) return `<div class="dsh-cr-cell dsh-cr-cell-${side}"></div>`;
    const mark = noEol === true ? `<span class="dsh-cr-nonl" title="${escapeHtml(noNewlineTitle)}">\u23CE</span>` : "";
    let body;
    if (diffRange === null) {
      body = lang === null ? escapeHtml(text) : tokensToHtml(tokenizeLine(text, lang));
    } else {
      const chars = Array.from(text);
      const start = side === "old" ? diffRange.oldStart : diffRange.newStart;
      const end = side === "old" ? diffRange.oldEnd : diffRange.newEnd;
      const prefix = chars.slice(0, start).join("");
      const mid = chars.slice(start, end).join("");
      const suffix = chars.slice(end).join("");
      const seg = (segText) => lang === null ? escapeHtml(segText) : tokensToHtml(tokenizeLine(segText, lang));
      body = seg(prefix) + (mid !== "" ? `<span class="dihl-mid-${side}">${seg(mid)}</span>` : "") + seg(suffix);
    }
    return `<div class="dsh-cr-cell dsh-cr-cell-${side}">${body}${mark}</div>`;
  }
  function rowHtml(row, lang, path, noNewlineTitle) {
    if (row.kind === "gap") {
      return `<div class="dsh-cr-gaprow">${escapeHtml(row.gapText ?? "")}</div>`;
    }
    const num = (no, side) => {
      if (no === void 0) return `<div class="dsh-cr-num dsh-cr-num-${side}"></div>`;
      return `<div class="dsh-cr-num dsh-cr-num-${side}" data-cr-path="${escapeHtml(path)}" data-cr-line="${no}" data-cr-side="${side}">${no}</div>`;
    };
    const line = `<div class="dsh-cr-row dsh-cr-${row.kind}">`;
    if (row.kind === "ctx") {
      return line + num(row.oldNo, "old") + cellHtml(row.oldText, "old", row.oldNoEol, null, lang, noNewlineTitle) + num(row.newNo, "new") + cellHtml(row.newText, "new", row.newNoEol, null, lang, noNewlineTitle) + "</div>";
    }
    if (row.kind === "del") {
      return line + num(row.oldNo, "old") + cellHtml(row.oldText, "old", row.oldNoEol, null, lang, noNewlineTitle) + num(void 0, "new") + cellHtml(void 0, "new", void 0, null, lang, noNewlineTitle) + "</div>";
    }
    if (row.kind === "add") {
      return line + num(void 0, "old") + cellHtml(void 0, "old", void 0, null, lang, noNewlineTitle) + num(row.newNo, "new") + cellHtml(row.newText, "new", row.newNoEol, null, lang, noNewlineTitle) + "</div>";
    }
    const range = diffMidRange(row.oldText ?? "", row.newText ?? "");
    return line + num(row.oldNo, "old") + cellHtml(row.oldText, "old", row.oldNoEol, range, lang, noNewlineTitle) + num(row.newNo, "new") + cellHtml(row.newText, "new", row.newNoEol, range, lang, noNewlineTitle) + "</div>";
  }
  function buildStandaloneHtml(files, theme, rawText, lang = "zh") {
    const texts = CR_TEXTS[lang];
    const stats = countStats(files);
    const statsText = texts.stats(stats.added, stats.removed, stats.files);
    const rootVars = Object.entries(theme).map(([name, value]) => `${name}: ${value};`).join(" ");
    const rawJson = JSON.stringify(rawText).replace(/</g, "\\u003c");
    const nav = files.map((file, index) => `<a class="navitem" href="#file-${index}">${escapeHtml(displayPath(file.newPath) || displayPath(file.oldPath))}</a>`).join("");
    const sections = files.map((file, index) => {
      const oldPath = displayPath(file.oldPath);
      const newPath = displayPath(file.newPath);
      const path = oldPath !== "" && oldPath !== newPath ? `${oldPath} \u2192 ${newPath}` : newPath === "" ? oldPath : newPath;
      const meta = file.meta.filter((m) => !m.startsWith("index "));
      const lang2 = langFor(newPath) ?? langFor(oldPath);
      const commentPath = newPath !== "" && newPath !== "/dev/null" ? newPath : oldPath;
      const rows = file.rows.length === 0 ? `<div class="dsh-cr-gaprow">${escapeHtml(file.meta.join(" \xB7 ") || file.status)}</div>` : file.rows.map((row) => rowHtml(row, lang2, commentPath, texts.noNewlineTitle)).join("");
      const head = `<header class="filehead"><span class="badge">${texts.status[file.status]}</span><span class="path">${escapeHtml(path)}</span>` + (meta.length > 0 ? `<span class="meta">${escapeHtml(meta.join(" \xB7 "))}</span>` : "") + "</header>";
      return `<section class="file" id="file-${index}">${head}<div class="dsh-cr-grid">${rows}</div></section>`;
    }).join("");
    return `<!doctype html>
<html lang="${lang === "zh" ? "zh-CN" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Code Review \xB7 ${statsText}</title>
<style>
:root { ${rootVars} }
${STANDALONE_CSS}
</style>
</head>
<body>
<header class="topbar">
  <span class="stats">${statsText}</span>
  <span class="topbar-actions">
    <button class="btn" id="submit-comments" type="button">${texts.submitComments}</button>
    <button class="btn" id="copy-raw" type="button">${texts.copyRaw}</button>
  </span>
</header>
<div class="submit-panel" id="submit-panel" hidden>
  <span class="submit-hint">${texts.submitHint}</span>
  <button class="btn" id="submit-lgtm" type="button">${texts.submitLgtm}</button>
  <button class="btn" id="submit-plain" type="button">${texts.submitPlain}</button>
</div>
<nav class="sidenav">${nav}</nav>
<main>${sections}</main>
<div class="rawwrap">
  <details><summary class="rawsummary">${texts.rawSummary}</summary>
  <pre class="rawpre">${escapeHtml(rawText)}</pre>
  </details>
</div>
<script>
document.getElementById('copy-raw').addEventListener('click', function (event) {
  var raw = ${rawJson}
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(raw).then(function () {
      var btn = event.currentTarget
      btn.textContent = T.copied
      setTimeout(function () { btn.textContent = T.copyRaw }, 1200)
    })
  }
})
<\/script>
<script>
/* \u884C\u5185\u8BC4\u8BBA:\u70B9\u51FB\u884C\u53F7\u683C\u63D0\u8BC4\u8BBA,\u6512\u9F50\u540E\u63D0\u4EA4\u56DE DSH \u5BF9\u8BDD\u6846(postMessage)\u3002 */
(function () {
  var T = ${JSON.stringify(stringTexts(texts))}
  var comments = []
  var draft = null
  var submitBtn = document.getElementById('submit-comments')
  var panel = document.getElementById('submit-panel')

  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  function syncSubmit() {
    if (!submitBtn) return
    submitBtn.textContent = comments.length === 0 ? T.submitComments : T.submitComments + ' (' + comments.length + ')'
  }
  function sameLine(a, b) {
    return a.path === b.path && a.lineNo === b.lineNo && a.side === b.side
  }
  function lineOf(num) {
    return {
      path: num.getAttribute('data-cr-path'),
      lineNo: Number(num.getAttribute('data-cr-line')),
      side: num.getAttribute('data-cr-side'),
    }
  }
  function commentsOn(line) {
    return comments.filter(function (c) { return sameLine(c, line) })
  }
  function closeDraft() {
    if (draft && draft.parentNode) draft.parentNode.removeChild(draft)
    draft = null
  }
  function findNum(line) {
    var nums = document.querySelectorAll('.dsh-cr-num[data-cr-line]')
    for (var i = 0; i < nums.length; i += 1) {
      if (sameLine(lineOf(nums[i]), line)) return nums[i]
    }
    return null
  }
  function updateBadge(num) {
    var badge = num.querySelector('.cc')
    if (badge) badge.parentNode.removeChild(badge)
    var n = commentsOn(lineOf(num)).length
    if (n > 0) {
      var span = document.createElement('span')
      span.className = 'cc'
      span.textContent = String(n)
      num.appendChild(span)
    }
  }
  function openDraft(num) {
    closeDraft()
    var line = lineOf(num)
    var existing = commentsOn(line)
    draft = document.createElement('div')
    draft.className = 'comment-draft'
    var html = ''
    if (existing.length > 0) {
      html += '<div class="comment-list">'
      existing.forEach(function (c) { html += '<div class="comment-item">' + esc(c.text) + '</div>' })
      html += '</div>'
    }
    html += '<textarea class="comment-input" placeholder="' + T.commentPlaceholder + '"></textarea>'
    html += '<div class="comment-actions">'
      + '<button class="btn" type="button" data-act="save">' + T.addComment + '</button>'
      + '<button class="btn" type="button" data-act="cancel">' + T.cancel + '</button>'
      + '</div>'
    draft.innerHTML = html
    num.parentElement.insertAdjacentElement('afterend', draft)
    var ta = draft.querySelector('.comment-input')
    ta.focus()
    ta.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) saveDraft(line)
    })
    draft.querySelector('[data-act="save"]').addEventListener('click', function () { saveDraft(line) })
    draft.querySelector('[data-act="cancel"]').addEventListener('click', closeDraft)
  }
  function saveDraft(line) {
    if (!draft) return
    var ta = draft.querySelector('.comment-input')
    var text = ta.value.trim()
    closeDraft()
    if (text === '') return
    comments.push({ path: line.path, lineNo: line.lineNo, side: line.side, text: text })
    var num = findNum(line)
    if (num) updateBadge(num)
    syncSubmit()
  }
  function send(kind) {
    // \u7EAF\u8BC4\u8BBA\u8981\u6C42\u81F3\u5C11\u4E00\u6761;\u7EAF LGTM(0 \u6761\u8BC4\u8BBA)\u5141\u8BB8\u76F4\u63A5\u63D0\u4EA4\u6279\u51C6\u3002
    if (comments.length === 0 && kind !== 'lgtm') return
    var target = window.opener
    if (!target) {
      alert(T.openerClosed)
      return
    }
    target.postMessage({
      type: 'dsh-code-review-comments',
      kind: kind,
      comments: comments.map(function (c) {
        return { path: c.path, lineNo: c.lineNo, side: c.side, text: c.text }
      }),
    }, '*')
    if (panel) panel.hidden = true
  }
  document.addEventListener('click', function (event) {
    var target = event.target
    var num = target && target.closest ? target.closest('.dsh-cr-num[data-cr-line]') : null
    if (num) {
      openDraft(num)
      return
    }
    if (draft && !draft.contains(target)) closeDraft()
    if (panel && target && target.closest && !panel.contains(target) && !target.closest('#submit-comments')) {
      panel.hidden = true
    }
  })
  submitBtn.addEventListener('click', function () {
    // 0 \u6761\u8BC4\u8BBA\u65F6\u4E5F\u5141\u8BB8\u6253\u5F00\u9762\u677F(\u7EAF LGTM \u573A\u666F)\u3002
    panel.hidden = !panel.hidden
  })
  document.getElementById('submit-lgtm').addEventListener('click', function () { send('lgtm') })
  document.getElementById('submit-plain').addEventListener('click', function () { send('comment') })
  window.addEventListener('message', function (event) {
    if (event.source !== window.opener) return
    var data = event.data
    if (!data || data.type !== 'dsh-code-review-ack') return
    if (data.ok === false) {
      alert(T.noSession)
    } else {
      if (submitBtn) submitBtn.textContent = T.sent
      setTimeout(syncSubmit, 3000)
    }
  })
  syncSubmit()
})()
<\/script>
</body>
</html>
`;
  }

  // lib/vendor/dsh-code-review/src/yan-bridge.ts
  var REVIEW_MESSAGE_TYPE = "dsh-code-review-comments";
  var REVIEW_ACK_TYPE = "dsh-code-review-ack";
  var THEME_VARS = [
    "--dsw-alias-bg-base",
    "--dsw-alias-bg-layer-1",
    "--dsw-alias-markdown-code-block",
    "--dsw-alias-label-primary",
    "--dsw-alias-label-secondary",
    "--dsw-alias-label-tertiary",
    "--dsw-alias-border-l2",
    "--dsw-alias-border-l3",
    "--dsw-alias-state-error-primary",
    "--dsw-alias-state-success-primary",
    "--dsw-alias-state-business-primary",
    "--ds-font-family-code",
    "--shiki-token-keyword",
    "--shiki-token-string",
    "--shiki-token-comment",
    "--shiki-token-constant",
    "--shiki-token-function"
  ];
  var OPENER_COMPAT_PATCHES = [
    {
      from: "var target = window.opener",
      to: "var target = window.opener || (window.parent !== window ? window.parent : null)"
    },
    {
      from: "if (event.source !== window.opener) return",
      to: "if (event.source !== (window.opener || window.parent)) return"
    }
  ];
  var DshCodeReviewCore = Object.freeze({
    ...diff_parse_exports,
    ...diff_view_exports,
    THEME_VARS,
    rawDiffFromSummary,
    sanitizeComments,
    applyEmbeddingCompat,
    OPENER_COMPAT_PATCHES
  });
  globalThis.DshCodeReviewCore = DshCodeReviewCore;
  var yan_bridge_default = DshCodeReviewCore;
  function applyEmbeddingCompat(html) {
    let patched = html;
    const applied = [];
    for (const patch of OPENER_COMPAT_PATCHES) {
      const count = patched.split(patch.from).length - 1;
      if (count === 1) {
        patched = patched.replace(patch.from, patch.to);
        applied.push(true);
      } else {
        applied.push(false);
      }
    }
    return { html: patched, applied };
  }
  function sanitizeComments(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const record = item;
      if (typeof record.path !== "string" || typeof record.lineNo !== "number" || typeof record.text !== "string") continue;
      if (record.text.trim() === "") continue;
      out.push({
        path: record.path,
        lineNo: Math.trunc(record.lineNo),
        side: typeof record.side === "string" ? record.side : void 0,
        text: record.text
      });
    }
    return out;
  }
  function relativePath(value) {
    return String(value ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  }
  function rowsToPatch(file) {
    const rows = Array.isArray(file?.diff?.rows) ? file.diff.rows : [];
    const lines = [];
    let hunk = null;
    const flush = () => {
      if (hunk === null) return;
      lines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
      for (const line of hunk.lines) lines.push(line);
      hunk = null;
    };
    for (const row of rows) {
      const type = String(row?.type ?? row?.kind ?? "");
      if (type === "skip" || type === "truncate" || type === "gap") {
        flush();
        continue;
      }
      const hasOld = row?.oldLine != null;
      const hasNew = row?.newLine != null;
      if (!hasOld && !hasNew) {
        flush();
        continue;
      }
      if (hunk === null) {
        hunk = {
          oldStart: Math.max(1, Number(row?.oldLine) || 0),
          newStart: Math.max(1, Number(row?.newLine) || 0),
          oldCount: 0,
          newCount: 0,
          lines: []
        };
      }
      if (type === "add") {
        hunk.lines.push(`+${String(row?.text ?? row?.newText ?? "")}`);
        hunk.newCount += 1;
      } else if (type === "del" || type === "remove") {
        hunk.lines.push(`-${String(row?.text ?? row?.oldText ?? "")}`);
        hunk.oldCount += 1;
      } else if (type === "change") {
        hunk.lines.push(`-${String(row?.oldText ?? "")}`, `+${String(row?.newText ?? "")}`);
        hunk.oldCount += 1;
        hunk.newCount += 1;
      } else {
        const text = String(row?.text ?? row?.oldText ?? row?.newText ?? "");
        hunk.lines.push(` ${text}`);
        hunk.oldCount += 1;
        hunk.newCount += 1;
      }
    }
    flush();
    return lines.join("\n");
  }
  function rawDiffFromSummary(summary) {
    const files = Array.isArray(summary?.files) ? summary.files : [];
    const chunks = [];
    for (const file of files) {
      const filePath = relativePath(file?.path ?? file?.newPath ?? file?.oldPath);
      if (!filePath) continue;
      const status = String(file?.status ?? "modified");
      const header = [`diff --git a/${filePath} b/${filePath}`];
      if (status === "added") header.push("new file mode 100644");
      if (status === "deleted") header.push("deleted file mode 100644");
      if (status === "renamed") {
        header.push(`rename from ${relativePath(file?.oldPath) || filePath}`);
        header.push(`rename to ${relativePath(file?.newPath) || filePath}`);
      }
      if (file?.binary === true) header.push(`Binary files a/${filePath} and b/${filePath} differ`);
      const patch = typeof file?.patch === "string" && file.patch.trim() !== "" ? file.patch.trimEnd() : "";
      if (patch.startsWith("diff --git ")) {
        const patchLines = patch.split("\n");
        const extras = [];
        const hasLine = (prefix) => patchLines.some((line) => line.startsWith(prefix));
        if (status === "added" && !hasLine("new file mode")) extras.push("new file mode 100644");
        if (status === "deleted" && !hasLine("deleted file mode")) extras.push("deleted file mode 100644");
        if (status === "renamed" && !hasLine("rename from ")) {
          extras.push(`rename from ${relativePath(file?.oldPath) || filePath}`, `rename to ${relativePath(file?.newPath) || filePath}`);
        }
        patchLines.splice(1, 0, ...extras);
        chunks.push(patchLines.join("\n"));
        continue;
      }
      const body = patch || rowsToPatch(file);
      if (body) header.push(body);
      chunks.push(header.join("\n"));
    }
    return chunks.join("\n");
  }
})();
