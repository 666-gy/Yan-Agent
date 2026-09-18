'use strict';

/*
 * Yan Agent 审阅面板 ↔ dsh-code-review 集成（上游 MIT）：
 * https://github.com/yangzhe1991/dsh-code-review
 *
 * 本文件不含任何审阅界面：UI 完全由上游 diff-view.ts 的 buildStandaloneHtml
 * 生成（逐字 vendor，见 lib/vendor/dsh-code-review/ 与 VENDOR.md）。
 * 这里只做宿主编排：
 *   1) 主题变量现读（dsh-review.css 已把 DSW 变量名映射到 Yan 主题 token）；
 *   2) 生成原版页面 → iframe 兼容补丁 → 经 IPC 落临时文件后以 file: 文档
 *      加载（应用 CSP 禁 blob:/srcdoc 的内联脚本，故不能内嵌）；
 *   3) 按上游 postMessage 协议接收行内评论，回传写入 Yan 输入框；
 *   4) showError 供宿主在读取改动失败时展示错误（非审阅 UI）。
 */
(() => {
  const core = () => globalThis.DshCodeReviewCore || null;

  // The upstream page is designed for a full browser tab.  Its visual language
  // stays intact here, but the fixed 220px rail and 24px page gutters need a
  // host-aware breakpoint when the review is mounted in Yan's narrow sidebar.
  // Keep this as an embedding adapter instead of changing the vendored source.
  const EMBED_CSS = `
html, body { min-width: 0 !important; }
html { --yan-review-filebar-width: 220px; }
html { scroll-padding-top: 44px; }
body { overflow: auto !important; }
/* Yan's review surface uses the same modern sans family everywhere, including
   code rows. This keeps the embedded panel visually consistent with the
   composer and the rest of the workbench. */
body, button, input, textarea { font-family: var(--yan-font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif) !important; }
.dsh-cr-grid, .dsh-cr-grid .dsh-cr-num, .dsh-cr-grid .dsh-cr-cell, .rawpre { font-family: var(--yan-font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif) !important; }
html, body, .sidenav, .dsh-cr-grid, .rawpre { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--dsw-alias-label-tertiary) 46%, transparent) transparent; }
html::-webkit-scrollbar, body::-webkit-scrollbar, .sidenav::-webkit-scrollbar, .dsh-cr-grid::-webkit-scrollbar, .rawpre::-webkit-scrollbar { width: 9px; height: 9px; }
html::-webkit-scrollbar-track, body::-webkit-scrollbar-track, .sidenav::-webkit-scrollbar-track, .dsh-cr-grid::-webkit-scrollbar-track, .rawpre::-webkit-scrollbar-track { background: transparent; }
html::-webkit-scrollbar-thumb, body::-webkit-scrollbar-thumb, .sidenav::-webkit-scrollbar-thumb, .dsh-cr-grid::-webkit-scrollbar-thumb, .rawpre::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 46%, transparent); border: 2px solid transparent; border-radius: 999px; background-clip: padding-box; }
html::-webkit-scrollbar-thumb:hover, body::-webkit-scrollbar-thumb:hover, .sidenav::-webkit-scrollbar-thumb:hover, .dsh-cr-grid::-webkit-scrollbar-thumb:hover, .rawpre::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 68%, transparent); border-width: 1px; }
.stats { display: inline-flex !important; align-items: baseline; gap: 8px; min-width: 0; white-space: nowrap; }
.stats-label { color: var(--dsw-alias-label-secondary); }
.stats-add, .file-add { color: var(--dsw-alias-state-success-primary); }
.stats-del, .file-del { color: var(--dsw-alias-state-error-primary); }
.yan-review-tools { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; }
.yan-review-tool { width: 28px; height: 24px; display: inline-grid; place-items: center; padding: 2px; border: 0; border-radius: 6px; color: var(--dsw-alias-label-secondary); background: transparent; }
.yan-review-tool:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); }
.yan-review-tool:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
.yan-review-tool svg { width: 16px; height: 16px; display: block; }
.yan-review-tool[aria-pressed="true"] { color: var(--dsw-alias-label-primary); }
.yan-review-tool.is-busy svg { animation: yan-review-spin 800ms linear infinite; }
@keyframes yan-review-spin { to { transform: rotate(360deg); } }
.yan-filebar-hidden .sidenav { display: none !important; }
.yan-filebar-hidden main { margin-right: 0 !important; }
.yan-filebar-hidden .yan-filebar-resizer { display: none !important; }
.sidenav { left: auto !important; right: 0 !important; width: var(--yan-review-filebar-width) !important; border-right: 0 !important; border-left: 1px solid var(--dsw-alias-border-l2) !important; overflow-x: hidden !important; }
.yan-review-folder { margin: 2px 0; min-width: 0; }
.yan-review-folder > summary { cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 5px; color: var(--dsw-alias-label-secondary); font-size: 12px; list-style: none; }
.yan-review-folder > summary::-webkit-details-marker { display: none; }
.yan-review-folder-icon { display: inline-flex; width: 16px; height: 16px; flex: 0 0 16px; }
.yan-review-folder-icon svg { width: 16px; height: 16px; }
.yan-review-folder .yan-folder-open { display: none; }
.yan-review-folder[open] > summary .yan-folder-open { display: inline-flex; }
.yan-review-folder[open] > summary .yan-folder-closed { display: none; }
.yan-review-folder > summary:hover { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.yan-review-folder > summary:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
.yan-review-folder-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yan-review-folder-children { margin-left: 10px; padding-left: 5px; border-left: 1px solid var(--dsw-alias-border-l2); }
.sidenav .navitem { padding-left: 10px; }
.sidenav .navitem[aria-current="true"] { color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-bg-layer-1); }
.yan-review-notice { grid-column: 1 / -1; min-width: 0; overflow-wrap: anywhere; padding: 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: normal; }
.yan-filebar-zero .sidenav { padding: 0 !important; border-left: 0 !important; }
main { margin-left: 0 !important; margin-right: var(--yan-review-filebar-width) !important; }
.filehead { flex-wrap: wrap !important; min-width: 0; }
.file { scroll-margin-top: 44px; }
.file-type-logo { display: block; width: 14px; height: 18px; flex: 0 0 14px; background: var(--dsw-alias-label-secondary); opacity: .92; -webkit-mask-image: var(--file-type-logo); mask-image: var(--file-type-logo); -webkit-mask-position: center; mask-position: center; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-size: contain; mask-size: contain; }
.filehead .path { min-width: 0; max-width: 100%; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.filehead .badge { display: none !important; }
.file-stats { display: inline-flex; align-items: baseline; gap: 8px; margin-left: 4px; flex: 0 0 auto; white-space: nowrap; font: 500 12px/1 var(--yan-font-ui, system-ui, sans-serif); }
.file-stats .file-add, .file-stats .file-del { font-weight: 500; }
.file-actions { display: inline-flex; align-items: center; gap: 2px; margin-left: 3px; flex: 0 0 auto; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 120ms ease; }
.filehead:hover .file-actions, .filehead:focus-within .file-actions { opacity: 1; visibility: visible; pointer-events: auto; }
.file-action { display: inline-grid; place-items: center; width: 24px; height: 22px; padding: 2px; border: 0; border-radius: 5px; color: var(--dsw-alias-label-tertiary); background: transparent; font: 450 11px/18px var(--yan-font-ui, system-ui, sans-serif); white-space: nowrap; }
.file-action svg { width: 14px; height: 14px; display: block; }
.file-action:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); }
.file-action:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
.yan-file-collapsed .dsh-cr-grid { display: none !important; }
.yan-no-wrap .file { overflow: hidden !important; }
.yan-no-wrap .dsh-cr-grid { width: 100%; min-width: 0; max-width: 100%; grid-template-columns: max-content max-content max-content max-content; overflow-x: auto; overflow-y: hidden; }
.yan-no-wrap .dsh-cr-cell { white-space: pre !important; overflow-wrap: normal !important; word-break: normal !important; }
.yan-no-wrap .rawpre { white-space: pre !important; overflow-x: auto; }
.rawwrap { display: none !important; }
.filehead.yan-file-add-only + .dsh-cr-grid { grid-template-columns: max-content minmax(0, 1fr) !important; }
.yan-no-wrap .filehead.yan-file-add-only + .dsh-cr-grid { grid-template-columns: max-content max-content !important; }
.filehead.yan-file-add-only ~ .dsh-cr-grid .dsh-cr-num-old,
.filehead.yan-file-add-only ~ .dsh-cr-grid .dsh-cr-cell-old { display: none !important; }
.topbar { position: sticky !important; top: 0 !important; z-index: 30 !important; }
.topbar::after { content: ""; position: absolute; top: 0; bottom: 0; right: var(--yan-review-filebar-width); border-left: 1px solid var(--dsw-alias-border-l2); pointer-events: none; }
.sidenav { z-index: 20 !important; }
.yan-filebar-resizer { position: fixed; top: 36px; right: var(--yan-review-filebar-width); bottom: 0; width: 7px; transform: translateX(50%); z-index: 25; cursor: col-resize; background: transparent; border-left: 1px solid transparent; touch-action: none; }
.yan-filebar-resizer:hover, html.yan-review-resizing .yan-filebar-resizer { border-left-color: var(--dsw-alias-border-l3); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent); }
html.yan-review-resizing, html.yan-review-resizing * { cursor: col-resize !important; user-select: none !important; }
/* 评论入口使用实心圆形加号，悬停时替换数字，而不是额外画一条线。 */
.dsh-cr-num[data-cr-line]:hover { color: transparent !important; }
.dsh-cr-num[data-cr-line]:hover::after { content: '+'; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 17px; height: 17px; display: grid; place-items: center; border-radius: 50%; background: var(--dsw-alias-state-business-primary); color: #fff; font: 600 12px/17px var(--yan-font-ui, system-ui, sans-serif); }
#yan-review-undo:disabled { opacity: .5; cursor: default; }
@media (max-width: 760px) {
  html { --yan-review-filebar-width: 154px; }
  .topbar { height: 40px !important; padding: 0 10px !important; gap: 6px !important; }
  .stats { min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; font-size: 12px !important; }
  .topbar-actions { min-width: 0 !important; gap: 4px !important; }
  .topbar-actions .btn { padding: 2px 7px !important; font-size: 11px !important; }
  .yan-review-tool { width: 25px !important; height: 23px !important; }
  .sidenav { top: 40px !important; width: var(--yan-review-filebar-width) !important; padding: 10px 6px !important; }
  .navitem { padding: 4px 8px !important; font-size: 11px !important; line-height: 18px !important; }
  main { margin-left: 0 !important; margin-right: var(--yan-review-filebar-width) !important; padding: 12px 10px 36px !important; }
  .yan-filebar-resizer { top: 40px; right: var(--yan-review-filebar-width); }
  .file { margin-bottom: 14px !important; border-radius: 9px !important; }
  .filehead { gap: 6px !important; padding: 7px 9px 4px !important; font-size: 12px !important; }
  .file-stats { gap: 5px !important; font-size: 11px !important; }
  .file-action { padding-inline: 3px !important; font-size: 10px !important; }
  .badge { font-size: 10px !important; padding: 0 5px !important; }
  .meta { font-size: 10px !important; }
  .dsh-cr-grid { grid-template-columns: 32px minmax(165px, 1fr) 32px minmax(165px, 1fr) !important; }
  .filehead.yan-file-add-only + .dsh-cr-grid { grid-template-columns: 32px minmax(165px, 1fr) !important; }
  .dsh-cr-num { padding: 0 7px 0 3px !important; font-size: 11px !important; }
  .dsh-cr-cell { padding: 0 8px 0 4px !important; font-size: 11px !important; line-height: 20px !important; }
  .submit-panel { top: 46px !important; right: 8px !important; max-width: calc(100vw - 16px) !important; flex-wrap: wrap !important; }
  .rawwrap { margin: 12px 10px 28px !important; }
}
@media (max-width: 430px) {
  html { --yan-review-filebar-width: 132px; }
  .sidenav { width: var(--yan-review-filebar-width) !important; }
  main { margin-left: 0 !important; margin-right: var(--yan-review-filebar-width) !important; }
  .dsh-cr-grid { grid-template-columns: 30px minmax(150px, 1fr) 30px minmax(150px, 1fr) !important; }
  .filehead.yan-file-add-only + .dsh-cr-grid { grid-template-columns: 30px minmax(150px, 1fr) !important; }
  .topbar-actions .btn { padding-inline: 5px !important; }
}
`;

  function adaptForSidebar(html, lang = 'zh', files = [], rawText = '', options = {}) {
    const source = String(html || '');
    const styleEnd = source.indexOf('</style>');
    let adapted = styleEnd < 0 ? source : source.slice(0, styleEnd) + EMBED_CSS + source.slice(styleEnd);
    const undoLabel = lang === 'en' ? 'Undo' : '撤销';
    const coreApi = core();
    // Lazy mode ships a manifest whose files carry no rows yet; their line
    // counts must come from the host summary so the header never reads +0 -0.
    const statsForFile = file => {
      if (Array.isArray(file?.rows) && file.rows.length) {
        return coreApi?.countStats?.([file]) || { added: 0, removed: 0, files: 1 };
      }
      return {
        added: Math.max(0, Number(file?.additions) || 0),
        removed: Math.max(0, Number(file?.deletions) || 0),
        files: 1
      };
    };
    const stats = files.reduce((total, file) => {
      const fileStats = statsForFile(file);
      return {
        added: total.added + fileStats.added,
        removed: total.removed + fileStats.removed,
        files: total.files + 1
      };
    }, { added: 0, removed: 0, files: 0 });
    const topLabel = lang === 'en'
      ? `Edited ${stats.files} file${stats.files === 1 ? '' : 's'}`
      : `已修改${stats.files}个文件`;
    const topStatsMarkup = `<span class="stats-label">${topLabel}</span><span class="stats-add">+${stats.added}</span><span class="stats-del">-${stats.removed}</span>`;
    const controlText = lang === 'en'
      ? { refresh: 'Refresh', collapseAll: 'Collapse all diffs', expandAll: 'Expand all diffs', disableWrap: 'Disable word wrap', enableWrap: 'Enable word wrap', hideFilebar: 'Hide file bar', showFilebar: 'Show file bar', copyTitle: 'Copy file diff', collapseTitle: 'Collapse diff', expandTitle: 'Expand diff', collapse: 'Collapse', expand: 'Expand', copied: 'Copied', loadHint: 'Click to load changes', loading: 'Loading changes…', loadFailed: 'Failed to load changes' }
      : { refresh: '刷新', collapseAll: '折叠全部差异', expandAll: '展开全部差异', disableWrap: '禁用自动换行', enableWrap: '启用自动换行', hideFilebar: '隐藏文件栏', showFilebar: '打开文件栏', copyTitle: '复制文件差异', collapseTitle: '收起差异', expandTitle: '展开差异', collapse: '收起', expand: '展开', copied: '已复制', loadHint: '点击加载改动', loading: '正在加载改动…', loadFailed: '加载改动失败' };
    const svg = (content, label) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${label ? `><title>${label}</title>${content}</svg>` : `>${content}</svg>`}`;
    const refreshIcon = svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>');
    const expandIcon = svg('<path d="M3 5h8"/><path d="M3 12h8"/><path d="M3 19h8"/><path d="m15 8 3-3 3 3"/><path d="m15 16 3 3 3-3"/>');
    const collapseIcon = svg('<path d="M3 5h8"/><path d="M3 12h8"/><path d="M3 19h8"/><path d="m15 5 3 3 3-3"/><path d="m15 19 3-3 3 3"/>');
    const wrapEnableIcon = svg('<path d="M3 5v14"/><path d="M21 12H7"/><path d="m15 18 6-6-6-6"/>');
    const wrapDisableIcon = svg('<path d="m9 6-6 6 6 6"/><path d="M3 12h14"/><path d="M21 19V5"/>');
    const folderClosedIcon = svg('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M2 10h20"/>');
    const folderOpenIcon = svg('<path d="M6 15L7.4472 12.1056C7.786 11.428 8.4785 11 9.2361 11L19.9978 11C21.4451 11 22.4132 12.4897 21.8254 13.8123L19.6032 18.8123C19.2822 19.5345 18.5659 20 17.7756 20L4 20C2.8954 20 2 19.1046 2 18L2 6C2 4.8954 2.8954 4 4 4L7.3787 4C7.7765 4 8.158 4.158 8.4393 4.4393L9.5607 5.5607C9.842 5.84199 10.2235 6 10.6213 6L17 6C18.1046 6 19 6.8954 19 8L19 11"/>');
    const copyIcon = svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');
    const fileExpandIcon = svg('<path d="m6 9 6 6 6-6"/>');
    const fileCollapseIcon = svg('<path d="m18 15-6-6-6 6"/>');
    // Keep the upstream topbar shell, but replace its removed review actions
    // with the four compact controls used by the embedded sidebar.
    const topControls = [
      `<button class="btn yan-review-tool" id="yan-review-refresh" type="button" title="${controlText.refresh}" aria-label="${controlText.refresh}">${refreshIcon}</button>`,
      `<button class="btn yan-review-tool" id="yan-review-expand" type="button" title="${controlText.collapseAll}" aria-label="${controlText.collapseAll}">${collapseIcon}</button>`,
      `<button class="btn yan-review-tool" id="yan-review-wrap" type="button" title="${controlText.disableWrap}" aria-label="${controlText.disableWrap}">${wrapDisableIcon}</button>`,
      `<button class="btn yan-review-tool" id="yan-review-filebar" type="button" title="${controlText.hideFilebar}" aria-label="${controlText.hideFilebar}" aria-pressed="false">${folderClosedIcon}</button>`,
      `<button class="btn" id="yan-review-undo" type="button">${undoLabel}</button>`
    ].join('');
    adapted = adapted.replace(/<span class="stats">[\s\S]*?<\/span>/, `<span class="stats">${topStatsMarkup}</span>`);
    adapted = adapted.replace(
      /<span class="topbar-actions">[\s\S]*?<\/span>/,
      `<span class="topbar-actions yan-review-tools">${topControls}</span>`
    );
    adapted = adapted.replace(/\s*<div class="submit-panel" id="submit-panel"[\s\S]*?<\/div>\s*/, '');
    // The embedded sidebar is the review surface; the upstream raw unified
    // diff appendix only duplicates the content and becomes visible when the
    // file tree is collapsed. Remove it from the generated document entirely.
    adapted = adapted.replace(/\s*<div class="rawwrap">[\s\S]*?<\/div>\s*/, '');
    // The copy handler is a standalone script in the upstream page. Remove it
    // with the button so no dead query throws while the iframe boots.
    adapted = adapted.replace(/<script>\s*document\.getElementById\('copy-raw'\)[\s\S]*?<\/script>\s*/, '');
    const rawChunks = String(rawText || '')
      .split(/\r?\n(?=diff --git )/)
      .map(chunk => chunk.trim())
      .filter(Boolean);
    const fileCopies = files.map((_, index) => rawChunks[index] || '');
    // File type artwork is bundled from Simple Icons. Unknown or unsupported
    // extensions fail closed and simply render without a logo.
    const fileTypeLogo = (file = {}) => {
      const rawPath = String(file.newPath || file.oldPath || '').replace(/\\/g, '/');
      const iconApi = globalThis.YanSimpleFileIcons;
      const iconKey = iconApi?.slugForFile?.(rawPath) || '';
      const src = iconApi?.urlForSlug?.(iconKey) || '';
      if (!src) return '';
      return `<span class="file-type-logo" style="--file-type-logo:url(&quot;${src}&quot;)" aria-hidden="true"></span>`;
    };
    let fileIndex = 0;
    adapted = adapted.replace('<nav class="sidenav">', '<div class="yan-filebar-resizer" id="yan-review-filebar-resizer" role="separator" aria-orientation="vertical" aria-label="调整文件栏宽度" tabindex="0"></div><nav class="sidenav">');
    adapted = adapted.replace(/<header class="filehead">[\s\S]*?<\/header>/g, header => {
      const index = fileIndex++;
      const file = files[index] || {};
      const fileStats = statsForFile(file);
      const statsMarkup = `<span class="file-stats"><span class="file-add">+${fileStats.added}</span><span class="file-del">-${fileStats.removed}</span></span>`;
      const onlyAdded = Number(fileStats.added) > 0 && Number(fileStats.removed) === 0;
      const actionsMarkup = `<span class="file-actions"><button class="file-action" type="button" data-copy-file="${index}" title="${controlText.copyTitle}" aria-label="${controlText.copyTitle}">${copyIcon}</button><button class="file-action" type="button" data-toggle-file="${index}" title="${controlText.collapseTitle}" aria-label="${controlText.collapseTitle}">${fileCollapseIcon}</button></span>`;
      let withoutStatus = header.replace(/<span class="badge">[\s\S]*?<\/span>/, '');
      if (onlyAdded) withoutStatus = withoutStatus.replace('<header class="filehead">', '<header class="filehead yan-file-add-only">');
      return withoutStatus.replace(/(<span class="path">[\s\S]*?<\/span>)/, `${fileTypeLogo(file)}$1${statsMarkup}${actionsMarkup}`);
    });
    // Lazy contract: a file without rows is pending and stays collapsed until
    // the host answers a load request with its rendered rows.
    const lazyEnabled = options.lazy === true;
    adapted = adapted.replace(/<section class="file" id="file-(\d+)">/g, (match, id) => {
      const index = Number(id);
      const file = files[index] || {};
      const isLoaded = Array.isArray(file.rows) && file.rows.length > 0;
      const path = String(file.newPath || file.oldPath || '').replace(/^[ab]\//, '');
      return `<section class="file" id="file-${index}" data-yan-path="${escapeAttr(path)}" data-yan-state="${isLoaded ? 'loaded' : 'pending'}">`;
    });
    // The upstream comment script remains available for line annotations, but
    // its removed topbar controls must be optional in the embedded variant.
    adapted = adapted.replace(
      /submitBtn\.addEventListener\('click', function \(\) \{/g,
      `if (submitBtn) submitBtn.addEventListener('click', function () {`
    );
    adapted = adapted.replace(
      /document\.getElementById\('submit-lgtm'\)\.addEventListener/g,
      `document.getElementById('submit-lgtm')?.addEventListener`
    );
    adapted = adapted.replace(
      /document\.getElementById\('submit-plain'\)\.addEventListener/g,
      `document.getElementById('submit-plain')?.addEventListener`
    );
    const fileCopiesJson = JSON.stringify(fileCopies).replace(/</g, '\\u003c');
    const controlTextJson = JSON.stringify(controlText);
    const controlsScript = `<script>(function(){
      var root=document.documentElement;
      var refresh=document.getElementById('yan-review-refresh');
      var expand=document.getElementById('yan-review-expand');
      var wrap=document.getElementById('yan-review-wrap');
      var filebar=document.getElementById('yan-review-filebar');
      var resizer=document.getElementById('yan-review-filebar-resizer');
      var files=[].slice.call(document.querySelectorAll('main .file'));
      var copies=${fileCopiesJson};
      var labels=${controlTextJson};
      var lazy=${lazyEnabled ? 'true' : 'false'};
      var generation=${Number(options.generation) || 0};
      var collapsedFolders=new Set(${JSON.stringify(options.collapsedFolders || []).replace(/</g, '\\u003c')});
      var nav=document.querySelector('.sidenav');
      var folders=new Map();
      if(nav){
        var links=[].slice.call(nav.querySelectorAll('.navitem'));
        var fragment=document.createDocumentFragment();
        links.forEach(function(link){
          var path=link.textContent.replace(/\\\\/g,'/');
          var parts=path.split('/').filter(Boolean);
          var container=fragment,key='';
          parts.slice(0,-1).forEach(function(name){
            key+=(key?'/':'')+name;
            var group=folders.get(key);
            if(!group){
              var details=document.createElement('details');details.className='yan-review-folder';details.dataset.folder=key;details.open=!collapsedFolders.has(key);
              var summary=document.createElement('summary');summary.title=key;
              var label=document.createElement('span');label.className='yan-review-folder-name';label.textContent=name;
              var closedIcon=document.createElement('span');closedIcon.className='yan-review-folder-icon yan-folder-closed';closedIcon.innerHTML=${JSON.stringify(folderClosedIcon)};
              var openIcon=document.createElement('span');openIcon.className='yan-review-folder-icon yan-folder-open';openIcon.innerHTML=${JSON.stringify(folderOpenIcon)};
              summary.append(closedIcon,openIcon,label);details.appendChild(summary);
              var children=document.createElement('div');children.className='yan-review-folder-children';details.appendChild(children);
              container.appendChild(details);group={details:details,children:children};folders.set(key,group);
              details.addEventListener('toggle',function(){window.parent.postMessage({type:'yan-dsh-review-folder',generation:generation,path:details.dataset.folder,collapsed:!details.open},'*');});
              summary.addEventListener('keydown',function(event){if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();details.open=event.key==='ArrowRight';}});
            }
            container=group.children;
          });
          link.title=path;link.textContent=parts[parts.length-1]||path;container.appendChild(link);
        });
        nav.replaceChildren(fragment);
      }
      var loaded=files.map(function(file){return file.getAttribute('data-yan-state')==='loaded';});
      var expanded=true;
      var wrapped=true;
      var filebarVisible=true;
      var initialFilebarWidth=parseFloat(getComputedStyle(root).getPropertyValue('--yan-review-filebar-width'))||220;
      var lastFilebarWidth=initialFilebarWidth;
      function setWrap(next){
        wrapped=!!next;
        root.classList.toggle('yan-no-wrap',!wrapped);
        if(wrap){wrap.innerHTML=wrapped?${JSON.stringify(wrapDisableIcon)}:${JSON.stringify(wrapEnableIcon)};wrap.title=wrapped?labels.disableWrap:labels.enableWrap;wrap.setAttribute('aria-label',wrap.title);wrap.setAttribute('aria-pressed',String(!wrapped));}
      }
      function setExpanded(next){
        expanded=!!next;
        files.forEach(function(file,index){
          if(lazy&&!loaded[index]){file.classList.add('yan-file-collapsed');return;}
          file.classList.toggle('yan-file-collapsed',!expanded);
          var button=file.querySelector('[data-toggle-file]');
          if(button){var label=button.querySelector('span');if(label)label.textContent=expanded?labels.collapse:labels.expand;button.setAttribute('aria-label',expanded?labels.collapseTitle:labels.expandTitle);button.title=expanded?labels.collapseTitle:labels.expandTitle;}
        });
        if(expand){expand.innerHTML=expanded?${JSON.stringify(collapseIcon)}:${JSON.stringify(expandIcon)};expand.title=expanded?labels.collapseAll:labels.expandAll;expand.setAttribute('aria-label',expand.title);expand.setAttribute('aria-pressed',String(!expanded));}
      }
      function setFileCollapsed(file,next){
        file.classList.toggle('yan-file-collapsed',!!next);
        var toggle=file.querySelector('[data-toggle-file]');
        if(toggle){toggle.innerHTML=next?${JSON.stringify(fileExpandIcon)}:${JSON.stringify(fileCollapseIcon)};toggle.setAttribute('aria-label',next?labels.expandTitle:labels.collapseTitle);toggle.title=next?labels.expandTitle:labels.collapseTitle;}
      }
      function syncExpandAll(){
        expanded=files.every(function(file,index){return (lazy&&!loaded[index])||!file.classList.contains('yan-file-collapsed');});
        if(expand){expand.innerHTML=expanded?${JSON.stringify(collapseIcon)}:${JSON.stringify(expandIcon)};expand.title=expanded?labels.collapseAll:labels.expandAll;expand.setAttribute('aria-label',expand.title);expand.setAttribute('aria-pressed',String(!expanded));}
      }
      function requestFile(index){
        if(!lazy)return;
        var file=files[index];
        if(!file||loaded[index])return;
        if(file.getAttribute('data-yan-state')==='loading')return;
        file.setAttribute('data-yan-state','loading');
        var grid=file.querySelector('.dsh-cr-grid');
        if(grid)grid.innerHTML='<div class="dsh-cr-gaprow">'+labels.loading+'</div>';
        window.parent.postMessage({type:'yan-dsh-review-load-file',generation:generation,index:index,path:file.getAttribute('data-yan-path')||''},'*');
      }
      window.addEventListener('message',function(event){
        if(event.source!==window.parent)return;
        var data=event.data||{};
        if(data.generation!==undefined&&data.generation!==generation)return;
        if(data.type==='yan-dsh-review-file-rows'){
          var index=Number(data.index);
          var file=files[index];
          if(!file)return;
          var grid=file.querySelector('.dsh-cr-grid');
          if(grid)grid.innerHTML=String(data.html||'');
          loaded[index]=true;
          file.setAttribute('data-yan-state','loaded');
          if(data.rawText)copies[index]=String(data.rawText);
          var copyButton=file.querySelector('[data-copy-file]');
          if(copyButton&&data.partial){copyButton.disabled=true;copyButton.title=${JSON.stringify(lang === 'en' ? 'Partial preview; open the file in an editor for the complete diff' : '当前为部分预览，请在编辑器中查看完整差异')};}
          setFileCollapsed(file,false);
          syncExpandAll();
          return;
        }
        if(data.type==='yan-dsh-review-file-error'){
          var failedIndex=Number(data.index);
          var failed=files[failedIndex];
          if(!failed)return;
          failed.setAttribute('data-yan-state','error');
          var failedGrid=failed.querySelector('.dsh-cr-grid');
          if(failedGrid){failedGrid.replaceChildren();var errorText=document.createElement('div');errorText.className='yan-review-notice';errorText.textContent=data.message||labels.loadFailed;failedGrid.appendChild(errorText);}
          setFileCollapsed(failed,false);
          return;
        }
        if(data.type==='yan-dsh-review-load-file'){requestFile(Number(data.index));focusFile('file-'+Number(data.index));}
      });
      function setFilebarVisible(next){
        filebarVisible=!!next;
        var current=parseFloat(getComputedStyle(root).getPropertyValue('--yan-review-filebar-width'))||0;
        if(filebarVisible&&current<=16){
          var restored=lastFilebarWidth>16?lastFilebarWidth:initialFilebarWidth;
          root.style.setProperty('--yan-review-filebar-width',restored+'px');
          root.classList.remove('yan-filebar-zero');
          if(resizer)resizer.setAttribute('aria-valuenow',String(restored));
        }
        root.classList.toggle('yan-filebar-hidden',!filebarVisible);
        if(filebar){filebar.innerHTML=filebarVisible?${JSON.stringify(folderClosedIcon)}:${JSON.stringify(folderOpenIcon)};filebar.title=filebarVisible?labels.hideFilebar:labels.showFilebar;filebar.setAttribute('aria-label',filebar.title);filebar.setAttribute('aria-pressed',String(!filebarVisible));}
      }
      function setFilebarWidth(next){
        var viewport=Math.max(0,window.innerWidth||document.documentElement.clientWidth||0);
        /* The iframe can execute while its host tab is still mounting, in
           which case innerWidth is temporarily zero. Keep the CSS default
           width in that first pass; clamp only once a real viewport exists. */
        var max=viewport>0?Math.max(0,Math.min(520,Math.floor(viewport*0.65))):520;
        var clamped=Math.max(0,Math.min(max,Number(next)||0));
        /* A few pixels of padding/border are not a usable file tree. Snap the
           final drag segment to a true zero-width state so dragging to the
           edge really hides the tree instead of leaving a sliver behind. */
        var width=clamped<=16?0:clamped;
        if(width>16)lastFilebarWidth=width;
        root.style.setProperty('--yan-review-filebar-width',width+'px');
        root.classList.toggle('yan-filebar-zero',width<=0.5);
        if(width===0){
          filebarVisible=false;
          /* A zero-width drag is already the hidden visual state. Do not add
             yan-filebar-hidden here, otherwise the resize handle disappears
             before the pointer gesture finishes. */
          root.classList.remove('yan-filebar-hidden');
          if(filebar){filebar.innerHTML=${JSON.stringify(folderOpenIcon)};filebar.title=labels.showFilebar;filebar.setAttribute('aria-label',filebar.title);filebar.setAttribute('aria-pressed','true');}
        }
        if(resizer){resizer.setAttribute('aria-valuemin','0');resizer.setAttribute('aria-valuemax',String(max));resizer.setAttribute('aria-valuenow',String(width));}
      }
      var resizing=false;
      function resizeFromClientX(clientX){setFilebarWidth((window.innerWidth||0)-clientX);}
      if(resizer){
        resizer.addEventListener('pointerdown',function(event){resizing=true;root.classList.add('yan-review-resizing');try{resizer.setPointerCapture?.(event.pointerId);}catch(e){}resizeFromClientX(event.clientX);event.preventDefault();});
        resizer.addEventListener('pointermove',function(event){if(resizing)resizeFromClientX(event.clientX);});
        var stopResize=function(event){if(!resizing)return;resizing=false;root.classList.remove('yan-review-resizing');try{resizer.releasePointerCapture?.(event.pointerId);}catch(e){}};
        resizer.addEventListener('pointerup',stopResize);resizer.addEventListener('pointercancel',stopResize);resizer.addEventListener('lostpointercapture',function(){resizing=false;root.classList.remove('yan-review-resizing');});
        resizer.addEventListener('keydown',function(event){var current=parseFloat(getComputedStyle(root).getPropertyValue('--yan-review-filebar-width'))||0;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setFilebarWidth(current+(event.key==='ArrowLeft'?-16:16));}});
      }
      function focusFile(id){
        var target=document.getElementById(id);
        if(!target)return;
        document.querySelectorAll('.navitem').forEach(function(link){var active=link.getAttribute('href')==='#'+id;link.setAttribute('aria-current',String(active));if(active){var parent=link.parentElement;while(parent&&parent!==nav){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}}});
        var topbar=document.querySelector('.topbar');
        var offset=(topbar?topbar.getBoundingClientRect().height:0)+8;
        var scrollTop=window.scrollY||document.documentElement.scrollTop||document.body.scrollTop||0;
        var targetTop=target.getBoundingClientRect().top+scrollTop-offset;
        window.scrollTo(0,Math.max(0,targetTop));
      }
      function copyText(text,button){
        var done=function(){if(!button)return;var oldTitle=button.getAttribute('title')||'';var oldAria=button.getAttribute('aria-label')||'';button.title=labels.copied;button.setAttribute('aria-label',labels.copied);setTimeout(function(){button.title=oldTitle;button.setAttribute('aria-label',oldAria);},1200);};
        if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(done).catch(function(){});return;}
        var area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();try{document.execCommand('copy');done();}catch(e){}area.remove();
      }
      refresh&&refresh.addEventListener('click',function(){refresh.classList.add('is-busy');if(window.parent!==window){window.parent.postMessage({type:'yan-dsh-review-refresh'},'*');}else{window.location.reload();}});
      wrap&&wrap.addEventListener('click',function(){setWrap(!wrapped);});
      expand&&expand.addEventListener('click',function(){setExpanded(!expanded);});
      filebar&&filebar.addEventListener('click',function(){setFilebarVisible(!filebarVisible);});
      document.querySelectorAll('.navitem').forEach(function(link){link.addEventListener('click',function(event){
        var href=link.getAttribute('href')||'';
        var id=href.charAt(0)==='#'?href.slice(1):'';
        if(!id||!document.getElementById(id))return;
        event.preventDefault();
        requestFile(Number(id.replace('file-','')));
        focusFile(id);
        try{window.history.replaceState(null,'','#'+id);}catch(e){}
      });});
      document.addEventListener('click',function(event){
        var copy=event.target&&event.target.closest?event.target.closest('[data-copy-file]'):null;
        if(copy){var index=Number(copy.getAttribute('data-copy-file'));if(lazy&&!loaded[index]){requestFile(index);return;}copyText(copies[index]||'',copy);return;}
        var toggle=event.target&&event.target.closest?event.target.closest('[data-toggle-file]'):null;
        if(toggle){var file=toggle.closest('.file');if(!file)return;var fileIndex=files.indexOf(file);if(lazy&&!loaded[fileIndex]){requestFile(fileIndex);return;}setFileCollapsed(file,!file.classList.contains('yan-file-collapsed'));syncExpandAll();return;}
        var head=event.target&&event.target.closest?event.target.closest('.filehead'):null;
        if(!head)return;
        var owner=head.closest('.file');if(!owner)return;
        var ownerIndex=files.indexOf(owner);if(ownerIndex<0)return;
        if(lazy&&!loaded[ownerIndex]){requestFile(ownerIndex);return;}
        if(owner.classList.contains('yan-file-collapsed')){setFileCollapsed(owner,false);syncExpandAll();}
      });
      files.forEach(function(file,index){
        if(!lazy||loaded[index])return;
        file.classList.add('yan-file-collapsed');
        var hint=file.querySelector('.dsh-cr-grid > .dsh-cr-gaprow');
        if(hint)hint.textContent=labels.loadHint;
      });
      setWrap(true);setExpanded(!lazy);setFilebarWidth(initialFilebarWidth);setFilebarVisible(true);
    })()<\/script>`;
    const rollbackScript = `<script>(function(){var b=document.getElementById('yan-review-undo');if(!b)return;b.addEventListener('click',function(){b.disabled=true;window.parent.postMessage({type:'yan-dsh-review-rollback'},'*')})})()<\/script>`;
    adapted = adapted.replace('</body>', controlsScript + rollbackScript + '</body>');
    return adapted;
  }

  function detectLang() {
    // renderer.js 的顶层 state 位于全局词法环境（非 globalThis 属性），
    // 本脚本在 renderer.js 之后执行，调用时可安全引用。
    try {
      const language = String(state?.config?.language || document.documentElement.lang || '').toLowerCase();
      return language.startsWith('en') ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  }

  function collectThemeVars() {
    // Older cached bundles did not expose THEME_VARS on the global core
    // object. Keep the adapter self-healing so an embedded review never falls
    // back to browser-default black text on a dark Yan theme while a bundle is
    // being rebuilt.
    const names = core()?.THEME_VARS || [
      '--dsw-alias-bg-base',
      '--dsw-alias-bg-layer-1',
      '--dsw-alias-markdown-code-block',
      '--dsw-alias-label-primary',
      '--dsw-alias-label-secondary',
      '--dsw-alias-label-tertiary',
      '--dsw-alias-border-l2',
      '--dsw-alias-border-l3',
      '--dsw-alias-state-error-primary',
      '--dsw-alias-state-success-primary',
      '--dsw-alias-state-business-primary',
      '--ds-font-family-code',
      '--shiki-token-keyword',
      '--shiki-token-string',
      '--shiki-token-comment',
      '--shiki-token-constant',
      '--shiki-token-function'
    ];
    const styles = getComputedStyle(document.body);
    const yanTokens = {
      '--dsw-alias-bg-base': '--bg',
      '--dsw-alias-bg-layer-1': '--bg-elev',
      '--dsw-alias-markdown-code-block': '--bg-elev2',
      '--dsw-alias-label-primary': '--text',
      '--dsw-alias-label-secondary': '--text-dim',
      '--dsw-alias-label-tertiary': '--text-faint',
      '--dsw-alias-border-l2': '--border-soft',
      '--dsw-alias-border-l3': '--border-strong',
      '--dsw-alias-state-error-primary': '--danger',
      '--dsw-alias-state-success-primary': '--success',
      '--dsw-alias-state-business-primary': '--accent',
      '--ds-font-family-code': '--font-mono'
    };
    const out = {};
    for (const name of names) {
      // Reading the mapped --dsw variable directly can return the literal
      // `var(--bg)` expression.  That expression has no meaning in the file:
      // iframe, so resolve the corresponding Yan token before serializing the
      // standalone page.
      const value = styles.getPropertyValue(yanTokens[name] || name).trim()
        || styles.getPropertyValue(name).trim();
      if (value) out[name] = value;
    }
    const uiFont = styles.getPropertyValue('--font-sans').trim();
    if (uiFont) out['--yan-font-ui'] = uiFont;
    return out;
  }

  // —— 上游协议：行内评论回传（iframe 场景 source 校验等价于上游 reviewWindows）——

  function handleReviewMessage(event) {
    if (event.data?.type === 'yan-dsh-review-folder') {
      if (event.source !== surface.iframe?.contentWindow || event.data.generation !== surface.loading) return;
      const path = String(event.data.path || '');
      if (event.data.collapsed) surface.collapsedFolders.add(path);
      else surface.collapsedFolders.delete(path);
      return;
    }
    const data = event.data;
    if (typeof data !== 'object' || data === null) return;
    if (data.type === 'yan-dsh-review-rollback') {
      if (!surface.iframe || event.source !== surface.iframe.contentWindow) return;
      surface.onRollback?.();
      return;
    }
    if (data.type === 'yan-dsh-review-refresh') {
      if (!surface.iframe || event.source !== surface.iframe.contentWindow) return;
      surface.onRefresh?.();
      return;
    }
    if (data.type === 'yan-dsh-review-load-file') {
      if (!surface.iframe || event.source !== surface.iframe.contentWindow) return;
      if (data.generation !== surface.loading) return;
      void loadFileIntoPage(Number(data.index), String(data.path || ''));
      return;
    }
    if (data.type !== 'dsh-code-review-comments') return;
    const coreApi = core();
    if (!coreApi || !surface.iframe || event.source !== surface.iframe.contentWindow) return;
    const comments = coreApi.sanitizeComments(data.comments);
    const kind = data.kind === 'lgtm' ? 'lgtm' : 'comment';
    if (comments.length === 0 && kind !== 'lgtm') return;
    const report = coreApi.buildCommentReport(comments, kind, detectLang());
    if (typeof setComposerText === 'function') {
      setComposerText(report, { preserveSkills: true });
      event.source.postMessage({ type: 'dsh-code-review-ack', ok: true }, '*');
    } else {
      event.source.postMessage({ type: 'dsh-code-review-ack', ok: false }, '*');
    }
  }

  // —— 宿主区域（容器 + iframe，即全部宿主 DOM）——

  const surface = { root: null, iframe: null, loading: 0, onRollback: null, onRefresh: null, loadFile: null, lazy: false, pendingLoads: new Set(), files: [], collapsedFolders: new Set(), renderedRows: 0, renderedChars: 0, loadedIndexes: new Set() };

  // Bounds apply before syntax highlighting/HTML creation and before DOM
  // insertion. Laziness alone does not bound one giant line or accumulated rows.
  const MAX_FILE_CHARS = 600_000;
  const MAX_LINE_CHARS = 8_000;
  const MAX_FILE_ROWS = 1_200;
  const MAX_PAGE_ROWS = 12_000;
  const MAX_PAGE_HTML_CHARS = 12_000_000;

  function checkFileBudget(file) {
    const rows = file?.diff?.rows;
    if (Array.isArray(rows)) {
      if (rows.length > 20_000) throw new Error('该文件差异过大，请在编辑器中查看。');
      let chars = 0;
      for (const row of rows) {
        for (const key of ['text', 'oldText', 'newText']) {
          const size = typeof row?.[key] === 'string' ? row[key].length : 0;
          chars += size;
          if (size > MAX_LINE_CHARS || chars > MAX_FILE_CHARS) throw new Error('该文件包含超长行或过大的差异，请在编辑器中查看。');
        }
      }
    }
    for (const key of ['patch', 'diff']) {
      const value = file?.[key];
      if (typeof value !== 'string') continue;
      if (value.length > MAX_FILE_CHARS || value.split('\n').some(line => line.length > MAX_LINE_CHARS)) {
        throw new Error('该文件包含超长行或过大的差异，请在编辑器中查看。');
      }
    }
  }

  function ensure() {
    if (surface.root) return surface.root;
    const root = document.createElement('div');
    root.id = 'yanDshReviewPanel';
    root.className = 'hidden';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', '代码审阅');
    const iframe = document.createElement('iframe');
    iframe.id = 'yanDshReviewFrame';
    iframe.title = 'Code Review';
    root.appendChild(iframe);
    document.querySelector('#yanDshReviewMount')?.appendChild(root);
    surface.root = root;
    surface.iframe = iframe;
    // The migrated page owns its own top bar.  The legacy refresh control is
    // kept in the host markup for the fallback renderer, but must not consume
    // space or leave an orphan arrow above the embedded review page.
    document.querySelector('#reviewRefreshBtn')?.classList.add('hidden');
    window.addEventListener('message', handleReviewMessage);
    return root;
  }

  function showError(message) {
    const root = ensure();
    surface.loading += 1;
    surface.iframe.src = 'about:blank';
    // Keep the error state readable: an about:blank iframe otherwise consumes
    // the entire flex surface and pushes the diagnostic below the fold.
    surface.iframe.style.display = 'none';
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    let error = root.querySelector('.yan-dsh-review-error');
    if (!error) {
      error = document.createElement('div');
      error.className = 'yan-dsh-review-error';
      root.appendChild(error);
    }
    error.textContent = String(message ?? '');
  }

  function hideError() {
    surface.root?.querySelector('.yan-dsh-review-error')?.remove();
  }

  function normalizedReviewPath(file = {}) {
    return String(file.newPath || file.oldPath || '')
      .replace(/^[ab]\//, '')
      .replace(/\\/g, '/');
  }

  function escapeAttr(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // —— 懒加载：清单先行，按需渲染单个文件的改动 ——
  // The initial document only carries the file manifest.  Clicking a file asks
  // the host for that file's rows, which are rendered on their own so a huge
  // change set never builds every diff row up front.

  function extractGridInnerHtml(html) {
    const open = '<div class="dsh-cr-grid">';
    const start = html.indexOf(open);
    if (start < 0) return '';
    const end = html.lastIndexOf('</div></section>');
    if (end < start) return '';
    return html.slice(start + open.length, end);
  }

  async function loadFileIntoPage(index, filePath) {
    if (!surface.lazy || !surface.loadFile || !Number.isInteger(index) || index < 0) return;
    if (normalizedReviewPath(surface.files[index]) !== filePath) return;
    if (surface.loadedIndexes.has(index)) return;
    const token = surface.loading;
    const key = `${token}:${index}:${filePath}`;
    if (surface.pendingLoads.has(key)) return;
    surface.pendingLoads.add(key);
    const post = message => surface.iframe?.contentWindow?.postMessage({ ...message, generation: token }, '*');
    try {
      let timer;
      let file;
      try {
        file = await Promise.race([
          surface.loadFile(filePath),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('加载超时，请点击文件重试。')), 30_000); })
        ]);
      } finally { clearTimeout(timer); }
      if (token !== surface.loading) return;
      if (!file) throw new Error('没有可显示的改动');
      checkFileBudget(file);
      // Paint loading feedback before bounded synchronous parsing/highlighting.
      await new Promise(resolve => setTimeout(resolve, 0));
      if (token !== surface.loading) return;
      const coreApi = core();
      const rawText = coreApi.rawDiffFromSummary({ files: [file] });
      const parsed = coreApi.parseGitDiff(rawText)[0];
      if (!parsed) throw new Error('无法解析该文件的改动');
      const partial = parsed.rows.length > MAX_FILE_ROWS || file.diff?.truncated === true || file.truncated === true;
      const preview = { ...parsed, rows: parsed.rows.slice(0, MAX_FILE_ROWS) };
      if (surface.renderedRows + preview.rows.length > MAX_PAGE_ROWS) throw new Error('已达到本次审阅的显示上限。请刷新审阅后选择需要查看的文件。');
      const html = coreApi.buildStandaloneHtml([preview], collectThemeVars(), '', detectLang());
      const grid = extractGridInnerHtml(html);
      if (surface.renderedChars + grid.length > MAX_PAGE_HTML_CHARS) throw new Error('已达到本次审阅的显示上限。请刷新审阅后选择需要查看的文件。');
      surface.renderedRows += preview.rows.length;
      surface.renderedChars += grid.length;
      surface.loadedIndexes.add(index);
      post({
        type: 'yan-dsh-review-file-rows',
        index,
        html: grid + (partial ? '<div class="yan-review-notice">当前仅显示部分差异（最多 1200 行）；完整内容请在编辑器中查看。</div>' : ''),
        rawText: partial ? '' : rawText,
        partial
      });
    } catch (error) {
      if (token !== surface.loading) return;
      post({ type: 'yan-dsh-review-file-error', index, message: String(error?.message || error) });
    } finally {
      surface.pendingLoads.delete(key);
    }
  }

  async function open(options = {}) {
    const token = ++surface.loading;
    surface.pendingLoads.clear();
    surface.loadedIndexes.clear();
    surface.renderedRows = 0;
    surface.renderedChars = 0;
    const coreApi = core();
    const root = ensure();
    if (!coreApi) {
      showError('审阅核心未加载：renderer/vendor/dsh-code-review/core.js');
      return false;
    }
    const summary = options.summary || { count: 0, additions: 0, deletions: 0, files: [] };
    surface.onRollback = typeof options.onRollback === 'function' ? options.onRollback : null;
    surface.onRefresh = typeof options.onRefresh === 'function' ? options.onRefresh : null;
    surface.loadFile = typeof options.loadFile === 'function' ? options.loadFile : null;
    surface.lazy = options.lazy !== false && !!surface.loadFile;
    // Lazy mode never renders rows in the first pass: strip any row payload a
    // caller may still carry so the manifest document stays lightweight.
    const manifestSummary = surface.lazy
      ? (globalThis.YanReviewData.projectReviewSummary(summary) || { files: [] })
      : summary;
    const rawText = coreApi.rawDiffFromSummary(manifestSummary);
    const files = coreApi.parseGitDiff(rawText);
    surface.files = files;
    // Manifest files carry line counts even when their rows were never built.
    const manifestByPath = new Map((Array.isArray(summary.files) ? summary.files : [])
      .map(file => [String(file?.path || '').replace(/\\/g, '/'), file]));
    files.forEach(file => {
      const manifestFile = manifestByPath.get(normalizedReviewPath(file));
      if (!manifestFile) return;
      file.additions = Math.max(0, Number(manifestFile.additions) || 0);
      file.deletions = Math.max(0, Number(manifestFile.deletions) || 0);
    });
    const selectedPath = String(options.selectedPath || '').replace(/\\/g, '/');
    const selectedIndex = selectedPath
      ? files.findIndex(file => normalizedReviewPath(file) === selectedPath)
      : -1;
    const generated = coreApi.buildStandaloneHtml(files, collectThemeVars(), rawText, detectLang());
    const compat = coreApi.applyEmbeddingCompat(generated);
    const embeddedHtml = adaptForSidebar(compat.html, detectLang(), files, rawText, { lazy: surface.lazy, generation: token, collapsedFolders: [...surface.collapsedFolders] });
    let written = null;
    try {
      let timer;
      try {
        written = await Promise.race([
          globalThis.yan?.dshReviewWriteHtml?.(embeddedHtml),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('审阅页面加载超时，请重试。')), 30_000); })
        ]);
      } finally { clearTimeout(timer); }
    } catch (error) {
      written = { ok: false, error: error?.message || String(error) };
    }
    if (token !== surface.loading) return true;
    if (!written?.ok || !written.url) {
      showError(written?.error || '无法写入审阅页面临时文件');
      return false;
    }
    hideError();
    surface.iframe.style.display = '';
    // Native fragment navigation can scroll the iframe's ancestors as well.
    // Restore the selected file strictly within the embedded document.
    surface.iframe.onload = () => requestAnimationFrame(() => {
      if (token !== surface.loading) return;
      if (surface.lazy && selectedIndex >= 0 && !(files[selectedIndex]?.rows || []).length) {
        surface.iframe.contentWindow?.postMessage({ type: 'yan-dsh-review-load-file', generation: token, index: selectedIndex }, '*');
      }
      if (selectedIndex < 0) return;
      const frameWindow = surface.iframe.contentWindow;
      const doc = surface.iframe.contentDocument;
      const target = doc?.getElementById(`file-${selectedIndex}`);
      if (!frameWindow || !target) return;
      const offset = (doc.querySelector('.topbar')?.getBoundingClientRect().height || 0) + 8;
      frameWindow.scrollTo(0, Math.max(0, target.getBoundingClientRect().top + frameWindow.scrollY - offset));
    });
    surface.iframe.src = written.url;
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    return true;
  }

  function close() {
    surface.loading += 1;
    if (!surface.root) return;
    surface.pendingLoads.clear();
    surface.loadedIndexes.clear();
    surface.collapsedFolders.clear();
    surface.renderedRows = 0;
    surface.renderedChars = 0;
    surface.files = [];
    surface.loadFile = null;
    surface.onRollback = null;
    surface.onRefresh = null;
    surface.iframe.onload = null;
    surface.iframe.src = 'about:blank';
    surface.iframe.style.display = '';
    surface.root.classList.add('hidden');
    surface.root.setAttribute('aria-hidden', 'true');
    // Keep the legacy host refresh control hidden across reopen cycles. The
    // migrated page owns its own top bar; revealing this button would leave a
    // stray arrow above the iframe after the first tab close/reopen.
  }

  globalThis.YanDshReview = {
    open,
    close,
    showError,
    // 兼容旧调用面:文件内导航由插件页面自身的侧栏承担,不再由宿主驱动。
    select() {},
    render() {}
  };
})();
