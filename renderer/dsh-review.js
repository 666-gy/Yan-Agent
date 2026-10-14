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
  // Keyline Icons stroke artwork: https://keylineicons.com/icons
  const REVIEW_FILE_ICONS = {"file": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M14 2H8C5.79086 2 4 3.79086 4 6V18C4 20.2091 5.79086 22 8 22H16C18.2091 22 20 20.2091 20 18V8L14 2ZM14 2V5C14 6.65685 15.3431 8 17 8H20\"/></svg>", "code-xml": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M6 7L2 12L6 17M18 7L22 12L18 17M10 19L14 5\"/></svg>", "image": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M6 3L18 3C19.6569 3 21 4.3431 21 6L21 18C21 19.6569 19.6569 21 18 21L6 21C4.3431 21 3 19.6569 3 18L3 6C3 4.3431 4.3431 3 6 3ZM3 18L7.9393 13.0607C8.5251 12.4749 9.4749 12.4749 10.0607 13.0607L12.0801 15.0801C12.6079 15.6079 13.4436 15.6673 14.0408 15.2194L15.9592 13.7806C16.5564 13.3327 17.3921 13.3921 17.9199 13.9199L21 17\"/>\n  <path d=\"M9.5 7.5C9.5 8.3284 8.8284 9 8 9C7.1716 9 6.5 8.3284 6.5 7.5C6.5 6.6716 7.1716 6 8 6C8.8284 6 9.5 6.6716 9.5 7.5Z\" fill=\"currentColor\" stroke=\"none\"/></svg>", "square-play": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 6C3 4.343146 4.343146 3 6 3L18 3C19.656854 3 21 4.343146 21 6L21 18C21 19.656854 19.656854 21 18 21L6 21C4.343146 21 3 19.656854 3 18ZM8.962734 9.105541C8.962734 8.320105 9.826684 7.841262 10.492732 8.257542L15.802266 11.576001C16.1156 11.771835 16.1156 12.228165 15.802266 12.423999L10.492732 15.742458C9.826684 16.158738 8.962734 15.679895 8.962734 14.894459Z\"/></svg>"};

  const EMBED_CSS = `
html, body { min-width: 0 !important; }
html { --yan-review-filebar-width: 220px; }
html { scroll-padding-top: 44px; }
body { overflow: auto !important; }
/* Yan's review surface uses the same modern sans family everywhere, including
   code rows. This keeps the embedded panel visually consistent with the
   composer and the rest of the workbench. */
.yan-comment-editor { position: relative; }
.comment-input { display: block; height: 32px; min-height: 32px; max-height: 52px; line-height: 20px; padding: 5px 38px 5px 10px; border-radius: 0; resize: none; overflow-y: auto; }
.comment-input:focus, .comment-input:focus-visible { outline: none !important; box-shadow: none !important; border-color: var(--dsw-alias-border-l2) !important; }
.yan-comment-send { position: absolute; right: 5px; bottom: 3px; width: 26px; height: 26px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
.yan-comment-send svg { width: 16px; height: 16px; }
body, button, input, textarea { font-family: var(--yan-font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif) !important; }
.dsh-cr-grid, .dsh-cr-grid .dsh-cr-num, .dsh-cr-grid .dsh-cr-cell, .rawpre { font-family: var(--ds-font-family-code, monospace) !important; font-size: var(--yan-code-size, 12px) !important; font-weight: var(--yan-code-weight, 400) !important; }
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
.yan-filebar-hidden main { margin-left: 0 !important; }
.yan-filebar-hidden .yan-filebar-resizer { display: none !important; }
.sidenav { left: 0 !important; right: auto !important; width: var(--yan-review-filebar-width) !important; border-left: 0 !important; border-right: 1px solid var(--dsw-alias-border-l2) !important; overflow-x: hidden !important; }
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
.sidenav .navitem { padding-left: 10px; display: flex; align-items: center; gap: 6px; }
.sidenav .navitem[aria-current="true"] { color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-bg-layer-1); }
.yan-review-notice { grid-column: 1 / -1; min-width: 0; overflow-wrap: anywhere; padding: 12px; color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: normal; }
.yan-filebar-zero .sidenav { padding: 0 !important; border-right: 0 !important; }
main { margin-left: var(--yan-review-filebar-width) !important; margin-right: 0 !important; padding: 0 0 36px !important; }
.filehead { flex-wrap: nowrap !important; min-width: 0; min-height: 38px; padding: 8px 12px !important; cursor: pointer; }
.file { scroll-margin-top: 44px; margin: 0 !important; border-radius: 0 !important; }
/* Hallmark · component scope · existing theme · pre-emit critique: P5 H5 E4 S5 R5 V4 */
.file-type-icon, .file-disclosure { display: inline-flex; align-items: center; width: 14px; height: 18px; flex: 0 0 14px; color: var(--dsw-alias-label-tertiary); pointer-events: none; }
.file-type-icon svg, .file-disclosure svg { width: 14px; height: 14px; }
.file-disclosure { transform: rotate(90deg); }
.yan-file-collapsed .file-disclosure { transform: rotate(0); }
.yan-file-empty .file-disclosure { visibility: hidden; }
.yan-file-empty-head { cursor: default; }
.filehead:not(.yan-file-empty-head):hover { background: var(--dsw-alias-bg-layer-1); }
.filehead[role="button"]:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
.filehead[role="button"]:active { background: var(--dsw-alias-bg-layer-1); }
.filehead .path { min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); }
.file-directory { min-width: 0; flex: 0 2 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); }
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
.topbar::after { content: ""; position: absolute; top: 0; bottom: 0; left: var(--yan-review-filebar-width); border-left: 1px solid var(--dsw-alias-border-l2); pointer-events: none; }
.sidenav { z-index: 20 !important; animation: yan-project-open 140ms ease-out; }
@keyframes yan-project-open { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
@media (prefers-reduced-motion: reduce) { .sidenav { animation: none; } }
.yan-filebar-resizer { position: fixed; top: 36px; left: var(--yan-review-filebar-width); bottom: 0; width: 7px; transform: translateX(-50%); z-index: 25; cursor: col-resize; background: transparent; border-left: 1px solid transparent; touch-action: none; }
.yan-filebar-resizer:hover, html.yan-review-resizing .yan-filebar-resizer { border-left-color: var(--dsw-alias-border-l3); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent); }
html.yan-review-resizing, html.yan-review-resizing * { cursor: col-resize !important; user-select: none !important; }
/* 评论入口使用实心圆形加号，悬停时替换数字，而不是额外画一条线。 */
.dsh-cr-num[data-cr-line]:hover { color: transparent !important; }
.dsh-cr-num[data-cr-line]:hover::after { content: '+'; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 17px; height: 17px; display: grid; place-items: center; border-radius: 50%; background: var(--dsw-alias-state-business-primary); color: #fff; font: 600 12px/17px var(--yan-font-ui, system-ui, sans-serif); }
.yan-filebar-hidden .topbar::after, .yan-filebar-zero .topbar::after { display: none; }
.topbar { gap: 10px; }
.yan-review-leading { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1 1 auto; }
 .yan-review-scope-wrap { min-width: 0; position: relative; }
.yan-review-scope-button { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; height: 28px; padding: 3px 9px; border: 0; border-radius: 7px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); white-space: nowrap; cursor: pointer; font-size: 13px; }
.yan-review-scope-button > span { overflow: hidden; text-overflow: ellipsis; }
.yan-review-scope-button svg { width: 13px; height: 13px; flex: 0 0 13px; color: var(--dsw-alias-label-tertiary); }
.yan-review-scope-button:hover, .yan-review-scope-button[aria-expanded="true"] { background: var(--dsw-alias-bg-layer-2); }
.yan-review-scope-button:focus-visible, .yan-review-scope-option:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
.yan-review-scope-menu { position: fixed; z-index: 45; width: 260px; padding: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.yan-review-scope-menu[hidden], .yan-review-branch-menu[hidden] { display: none !important; }
.yan-review-pr-scope-menu > :not([data-review-mode="all"]) { display: none !important; }
.yan-review-scope-option { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 6px 9px; border: 0; border-radius: 6px; color: inherit; background: transparent; text-align: left; cursor: pointer; font-size: 13px; }
.yan-review-scope-option:hover, .yan-review-scope-option[aria-expanded="true"] { background: var(--dsw-alias-bg-layer-2); }
.yan-review-scope-option:disabled { opacity: .5; cursor: default; }
.yan-review-scope-option svg { display: block; width: 14px; height: 14px; flex: 0 0 14px; }
.yan-review-scope-option > .yan-review-option-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yan-review-scope-option .yan-review-option-meta { min-width: 0; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.yan-review-option-check { width: 14px; height: 14px; color: var(--dsw-alias-state-business-primary); flex: 0 0 14px; visibility: hidden; }
.yan-review-scope-option[aria-checked="true"] .yan-review-option-check { visibility: visible; }
.yan-review-scope-separator { height: 1px; margin: 5px 10px; background: var(--dsw-alias-border-l2); }
.yan-review-branch-menu { position: fixed; z-index: 46; width: 290px; max-width: calc(100vw - 16px); padding: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.yan-review-branch-search { width: 100%; min-width: 0; box-sizing: border-box; padding: 8px 10px; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l2); background: transparent; color: inherit; font-size: 13px; outline-offset: -2px; }
.yan-review-branch-search:focus-visible { outline: 1px solid var(--dsw-alias-state-business-primary); border-radius: 5px; }
.yan-review-branch-list { max-height: min(280px, 50vh); overflow-y: auto; margin-top: 4px; }
.yan-review-branch-empty { padding: 10px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
@media (max-width: 430px) { .yan-review-scope-button { max-width: 165px; gap: 5px; font-size: 12px; } }

.yan-review-pill { display: inline-flex; align-items: center; gap: 0; padding: 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); }
.yan-review-pill .yan-review-tool { border-radius: 999px; }
.yan-review-pill .yan-review-tool + .yan-review-tool { position: relative; }
.yan-review-pill .yan-review-tool + .yan-review-tool::before { content: ""; position: absolute; left: 0; top: 5px; bottom: 5px; border-left: 1px solid var(--dsw-alias-border-l2); }
#yan-review-filebar[aria-pressed="true"] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-state-business-primary); }
.yan-review-search-panel { position: fixed; top: 44px; right: 12px; z-index: 40; display: flex; align-items: center; gap: 8px; width: min(360px, calc(100vw - 24px)); padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.yan-review-search-panel[hidden], .file[hidden] { display: none !important; }
.yan-review-search-panel input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12px; padding: 4px; }
.yan-review-search-panel input:focus-visible { outline: 1px solid var(--dsw-alias-state-business-primary); border-radius: 3px; }
.yan-review-search-count { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.yan-review-search-empty { padding: 24px 12px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.yan-review-search-empty[hidden] { display: none; }
@media (max-width: 760px) {
  html { --yan-review-filebar-width: 154px; }
  .topbar { height: 40px !important; padding: 0 10px !important; gap: 6px !important; }
  .stats { min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; font-size: 12px !important; }
  .topbar-actions { min-width: 0 !important; gap: 4px !important; }
  .topbar-actions .btn { padding: 2px 7px !important; font-size: 11px !important; }
  .yan-review-tool { width: 25px !important; height: 23px !important; }
  .sidenav { top: 40px !important; width: var(--yan-review-filebar-width) !important; padding: 10px 6px !important; }
  .navitem { padding: 4px 8px !important; font-size: 11px !important; line-height: 18px !important; }
  main { margin-left: var(--yan-review-filebar-width) !important; margin-right: 0 !important; padding: 0 0 36px !important; }
  .yan-filebar-resizer { top: 40px; left: var(--yan-review-filebar-width); }
  .file { margin: 0 !important; border-radius: 0 !important; }
  .filehead { gap: 6px !important; padding: 8px 9px !important; font-size: 12px !important; }
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
  main { margin-left: var(--yan-review-filebar-width) !important; margin-right: 0 !important; }
  .dsh-cr-grid { grid-template-columns: 30px minmax(150px, 1fr) 30px minmax(150px, 1fr) !important; }
  .filehead.yan-file-add-only + .dsh-cr-grid { grid-template-columns: 30px minmax(150px, 1fr) !important; }
  .topbar-actions .btn { padding-inline: 5px !important; }
}
`;

  function adaptForSidebar(html, lang = 'zh', files = [], rawText = '', options = {}) {
    // Adapt upstream UI copy only; keep code, diff contents and bridge IDs intact.
    const source = String(html || '').replace(/(var T = )(\{[^\r\n]*\})/g, (match, prefix, json) => {
      try {
        const texts = JSON.parse(json);
        for (const key of ['submitHint', 'openerClosed', 'noSession']) {
          if (typeof texts[key] === 'string') texts[key] = texts[key].replace(/\bDSH\b/g, 'Yan Agent');
        }
        return prefix + JSON.stringify(texts);
      } catch { return match; }
    });
    const styleEnd = source.indexOf('</style>');
    let adapted = styleEnd < 0 ? source : source.slice(0, styleEnd) + EMBED_CSS + source.slice(styleEnd);
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
    const scope = options.comparison || {};
    const branchNames = [...new Set((Array.isArray(scope.branches) ? scope.branches : [])
      .map(branch => String(typeof branch === 'string' ? branch : branch?.name || '')).filter(Boolean))];
    const currentBranch = String(scope.currentBranch || (lang === 'en' ? 'Current task' : '当前任务'));
    const defaultBranch = String(scope.defaultBranch || branchNames.find(name => name === 'main') || branchNames.find(name => name === 'master') || branchNames[0] || '');
    const comparison = { currentBranch, defaultBranch, branches: branchNames,
      mode: scope.mode === 'uncommitted' ? 'uncommitted' : 'all', baseBranch: String(scope.baseBranch || defaultBranch) };
    const controlText = lang === 'en'
      ? { refresh: 'Refresh', collapseAll: 'Collapse all diffs', expandAll: 'Expand all diffs', disableWrap: 'Disable word wrap', enableWrap: 'Enable word wrap', hideFilebar: 'Hide file bar', showFilebar: 'Show file bar', copyTitle: 'Copy file diff', collapseTitle: 'Collapse diff', expandTitle: 'Expand diff', collapse: 'Collapse', expand: 'Expand', copied: 'Copied', loadHint: 'Click to load changes', loading: 'Loading changes…', loadFailed: 'Failed to load changes' }
      : { refresh: '刷新', collapseAll: '折叠全部差异', expandAll: '展开全部差异', disableWrap: '禁用自动换行', enableWrap: '启用自动换行', hideFilebar: '隐藏文件栏', showFilebar: '打开文件栏', copyTitle: '复制文件差异', collapseTitle: '收起差异', expandTitle: '展开差异', collapse: '收起', expand: '展开', copied: '已复制', loadHint: '点击加载改动', loading: '正在加载改动…', loadFailed: '加载改动失败' };
    const svg = (content, label) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${label ? `><title>${label}</title>${content}</svg>` : `>${content}</svg>`}`;
    const refreshIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.7883 13.9407C20.929 13.3034 21 12.6527 21 12C21 7.0294 16.9706 3 12 3C9.5169 3 7.1441 4.0259 5.4432 5.8349M4.2857 3L4.7293 6.105C4.7683 6.3784 5.0216 6.5683 5.295 6.5293L8.4 6.0857M3.2117 10.0593C3.071 10.6966 3 11.3473 3 12C3 16.9706 7.0294 21 12 21C14.4831 21 16.8559 19.9741 18.5568 18.1651M19.7143 21L19.2707 17.895C19.2317 17.6216 18.9784 17.4317 18.705 17.4707L15.6 17.9143"/></svg>';
    const wrapEnableIcon = svg('<path d="M3 5v14"/><path d="M21 12H7"/><path d="m15 18 6-6-6-6"/>');
    const wrapDisableIcon = svg('<path d="m9 6-6 6 6 6"/><path d="M3 12h14"/><path d="M21 19V5"/>');
    const folderClosedIcon = svg('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M2 10h20"/>');
    const folderOpenIcon = svg('<path d="M6 15L7.4472 12.1056C7.786 11.428 8.4785 11 9.2361 11L19.9978 11C21.4451 11 22.4132 12.4897 21.8254 13.8123L19.6032 18.8123C19.2822 19.5345 18.5659 20 17.7756 20L4 20C2.8954 20 2 19.1046 2 18L2 6C2 4.8954 2.8954 4 4 4L7.3787 4C7.7765 4 8.158 4.158 8.4393 4.4393L9.5607 5.5607C9.842 5.84199 10.2235 6 10.6213 6L17 6C18.1046 6 19 6.8954 19 8L19 11"/>');
    const copyIcon = svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');
    const projectIcon = svg('<path d="M5 5C5 5.8284 4.3284 6.5 3.5 6.5C2.6716 6.5 2 5.8284 2 5C2 4.1716 2.6716 3.5 3.5 3.5C4.3284 3.5 5 4.1716 5 5ZM5 12C5 12.8284 4.3284 13.5 3.5 13.5C2.6716 13.5 2 12.8284 2 12C2 11.1716 2.6716 10.5 3.5 10.5C4.3284 10.5 5 11.1716 5 12ZM5 19C5 19.8284 4.3284 20.5 3.5 20.5C2.6716 20.5 2 19.8284 2 19C2 18.1716 2.6716 17.5 3.5 17.5C4.3284 17.5 5 18.1716 5 19Z" fill="currentColor" stroke="none"/><path d="M8 5H21M8 12H21M8 19H21" fill="none"/>');
    const searchIcon = svg('<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>');
    const closeIcon = svg('<path d="m6 6 12 12M18 6 6 18"/>');
    const searchText = lang === 'en'
      ? { search: 'Search', placeholder: 'Search files or loaded diffs', close: 'Close search', empty: 'No matching files' }
      : { search: '搜索', placeholder: '搜索文件或已加载的差异', close: '关闭搜索', empty: '没有匹配的文件' };
    const fileExpandIcon = svg('<path d="m9 6 6 6-6 6"/>');
    const projectButton = `<button class="btn yan-review-tool" id="yan-review-filebar" type="button" title="${lang === 'en' ? 'Show project' : '显示项目'}" aria-label="${lang === 'en' ? 'Project' : '项目'}" aria-controls="yan-review-project" aria-expanded="false" aria-pressed="false">${projectIcon}</button>`;
    const topControls = `<button class="btn yan-review-tool" id="yan-review-search" type="button" title="${searchText.search}" aria-label="${searchText.search}" aria-controls="yan-review-search-panel" aria-expanded="false">${searchIcon}</button><span class="yan-review-pill"><button class="btn yan-review-tool" id="yan-review-wrap" type="button" title="${controlText.disableWrap}" aria-label="${controlText.disableWrap}">${wrapDisableIcon}</button><button class="btn yan-review-tool" id="yan-review-refresh" type="button" title="${controlText.refresh}" aria-label="${controlText.refresh}">${refreshIcon}</button>${options.pr ? `<button class="btn yan-review-tool" id="yan-review-close" type="button" title="关闭审阅" aria-label="关闭审阅">${svg('<path d="M6 6L18 18M18 6L6 18"/>')}</button>` : ''}</span>`;
    const rangeText = lang === 'en'
      ? { worktree: 'working tree', all: 'All changes', uncommitted: 'Uncommitted changes', compare: 'Compare against', search: 'Search branches', default: 'default', noBranches: 'No matching branches', range: 'Change range' }
      : { worktree: '工作区', all: '全部改动', uncommitted: '未提交的改动', compare: '与分支比较', search: '搜索分支', default: '默认', noBranches: '没有匹配的分支', range: '改动范围' };
    const checkIcon = svg('<path d="m5 12 4 4L19 6"/>');
    const rightIcon = svg('<path d="m9 6 6 6-6 6"/>');
    const scopeMarkup = `<div class="yan-review-scope-wrap"><button id="yan-review-scope" class="yan-review-scope-button" type="button" aria-label="${rangeText.range}" aria-haspopup="menu" aria-expanded="false" aria-controls="yan-review-scope-menu"><span data-review-range-base>${escapeAttr(comparison.mode === 'all' ? (comparison.baseBranch || currentBranch) : currentBranch)}</span>${svg('<path d="M5 12h14m-5-5 5 5-5 5"/>')}<span>${options.pr ? escapeAttr(currentBranch) : rangeText.worktree}</span>${svg('<path d="m6 9 6 6 6-6"/>')}</button></div>`;
    const scopeMenus = `<div class="yan-review-scope-menu" id="yan-review-scope-menu" role="menu" aria-label="${rangeText.range}" hidden><button class="yan-review-scope-option" id="yan-review-scope-all" role="menuitemradio" aria-checked="true" data-review-mode="all"><span class="yan-review-option-label">${rangeText.all}</span><span class="yan-review-option-check">${checkIcon}</span><span class="yan-review-option-meta" data-review-base></span></button><button class="yan-review-scope-option" id="yan-review-scope-uncommitted" role="menuitemradio" aria-checked="false" data-review-mode="uncommitted"><span class="yan-review-option-label">${rangeText.uncommitted}</span><span class="yan-review-option-check">${checkIcon}</span></button><div class="yan-review-scope-separator" role="separator"></div><button class="yan-review-scope-option" id="yan-review-compare" role="menuitem" aria-haspopup="menu" aria-expanded="false" aria-controls="yan-review-branch-menu" ${branchNames.length ? '' : 'disabled'}><span class="yan-review-option-label">${rangeText.compare}</span><span class="yan-review-option-meta" data-review-base></span>${rightIcon}</button></div><div class="yan-review-branch-menu" id="yan-review-branch-menu" hidden><input class="yan-review-branch-search" id="yan-review-branch-search" type="search" placeholder="${rangeText.search}" aria-label="${rangeText.search}" autocomplete="off"><div class="yan-review-branch-list" id="yan-review-branch-list" role="menu" aria-label="${rangeText.compare}"></div></div>`;
    adapted = adapted.replace(/<span class="stats">[\s\S]*?<\/span>/, `<div class="yan-review-leading">${projectButton}${scopeMarkup}</div>`);
    adapted = adapted.replace('</body>', scopeMenus + '</body>');
    adapted = adapted.replace(/<span class="topbar-actions">[\s\S]*?<\/span>/, `<span class="topbar-actions yan-review-tools">${topControls}</span>`);
    adapted = adapted.replace('<html ', '<html class="yan-filebar-hidden" ');
    adapted = adapted.replace('</header>', `</header><div class="yan-review-search-panel" id="yan-review-search-panel" role="search" hidden><input id="yan-review-search-input" type="search" autocomplete="off" placeholder="${searchText.placeholder}" aria-label="${searchText.placeholder}"><span class="yan-review-search-count" id="yan-review-search-count" role="status" aria-live="polite"></span><button class="yan-review-tool" id="yan-review-search-close" type="button" title="${searchText.close}" aria-label="${searchText.close}">${closeIcon}</button></div>`);
    adapted = adapted.replace('<main>', `<main><div class="yan-review-search-empty" id="yan-review-search-empty" role="status" hidden>${searchText.empty}</div>`);
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
    const fileTypeLogo = (file = {}) => {
      const path = String(file.newPath || file.oldPath || '').toLowerCase();
      const extension = path.split('/').pop().split('.').pop();
      const image = /^(avif|bmp|gif|heic|heif|ico|jpeg|jpg|png|svg|tif|tiff|webp)$/;
      const video = /^(avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)$/;
      const code = /^(c|cc|cpp|cs|css|cxx|dart|ex|exs|go|h|hpp|htm|html|java|js|jsx|kt|kts|less|lua|mjs|cjs|php|pl|ps1|py|r|rb|rs|sass|scala|scss|sh|sql|svelte|swift|ts|tsx|vue|xml|json|jsonc|yaml|yml|toml|bat|cmd)$/;
      const type = image.test(extension) ? 'image' : video.test(extension) ? 'square-play'
        : code.test(extension) ? 'code-xml' : 'file';
      return `<span class="file-type-icon" data-file-icon="${type}" aria-hidden="true">${REVIEW_FILE_ICONS[type]}</span>`;
    };
    let fileIndex = 0;
    adapted = adapted.replace('<nav class="sidenav">', '<div class="yan-filebar-resizer" id="yan-review-filebar-resizer" role="separator" aria-orientation="vertical" aria-label="调整文件栏宽度" tabindex="0"></div><nav class="sidenav" id="yan-review-project">');
    adapted = adapted.replace(/<header class="filehead">[\s\S]*?<\/header>/g, header => {
      const index = fileIndex++;
      const file = files[index] || {};
      const fileStats = statsForFile(file);
      const statsMarkup = `<span class="file-stats"><span class="file-add">+${fileStats.added}</span><span class="file-del">-${fileStats.removed}</span></span>`;
      const onlyAdded = Number(fileStats.added) > 0 && Number(fileStats.removed) === 0;
      const empty = fileStats.added === 0 && fileStats.removed === 0;
      const rawPath = String(file.newPath || file.oldPath || '').replace(/\\/g, '/').replace(/^[ab]\//, '');
      const slash = rawPath.lastIndexOf('/');
      const name = rawPath.slice(slash + 1);
      const directory = slash < 0 ? '' : rawPath.slice(0, slash);
      const actionsMarkup = `<span class="file-actions"><button class="file-action" type="button" data-copy-file="${index}" title="${controlText.copyTitle}" aria-label="${controlText.copyTitle}">${copyIcon}</button><button class="file-action" type="button" data-reference-file="${index}" title="引用文件" aria-label="引用文件">${svg('<path d="M16 12C16 14.2091 14.2091 16 12 16C9.7909 16 8 14.2091 8 12C8 9.7909 9.7909 8 12 8C14.2091 8 16 9.7909 16 12ZM16 8L16 13C16 14.6569 17.3431 16 19 16C20.6569 16 22 14.6569 22 13L22 12C22 6.4772 17.5228 2 12 2C6.4772 2 2 6.4772 2 12C2 17.5228 6.4772 22 12 22C13.7554 22 15.4798 21.5379 17 20.6603"/>')}</button></span>`;
      const classes = ['filehead', onlyAdded ? 'yan-file-add-only' : '', empty ? 'yan-file-empty-head' : ''].filter(Boolean).join(' ');
      const interaction = empty ? 'aria-disabled="true"' : `role="button" tabindex="0" aria-expanded="true" aria-controls="file-grid-${index}"`;
      return `<header class="${classes}" ${interaction} title="${escapeAttr(rawPath)}"><span class="file-disclosure" aria-hidden="true">${fileExpandIcon}</span>${fileTypeLogo(file)}<span class="path">${escapeAttr(name)}</span>${directory ? `<span class="file-directory">${escapeAttr(directory)}</span>` : ''}${statsMarkup}${actionsMarkup}</header>`;
    });
    // Lazy contract: a file without rows is pending and stays collapsed until
    // the host answers a load request with its rendered rows.
    const lazyEnabled = options.lazy === true;
    adapted = adapted.replace(/<section class="file" id="file-(\d+)">/g, (match, id) => {
      const index = Number(id);
      const file = files[index] || {};
      const isLoaded = Array.isArray(file.rows) && file.rows.length > 0;
      const path = String(file.newPath || file.oldPath || '').replace(/^[ab]\//, '');
      const counts = statsForFile(file);
      const empty = counts.added === 0 && counts.removed === 0;
      return `<section class="file${empty ? ' yan-file-empty yan-file-collapsed' : ''}" id="file-${index}" data-yan-path="${escapeAttr(path)}" data-yan-state="${isLoaded ? 'loaded' : 'pending'}">`;
    });
    const commentSendIcon = document.getElementById('sendBtn')?.querySelector('svg')?.outerHTML || svg('<path d="M12 19V5m-6 6 6-6 6 6"/>');
    adapted = adapted.replace(/    html \+= '<textarea class="comment-input"[\s\S]*?      \+ '<\/div>'/, `    html += '<div class="yan-comment-editor"><textarea class="comment-input" rows="1" placeholder="在第' + line.lineNo + '行添加评论"></textarea><button class="yan-comment-send" type="button" data-act="save" title="发送" aria-label="发送">${commentSendIcon}</button></div>'`);
    adapted = adapted.replace("    draft.querySelector('[data-act=\"cancel\"]').addEventListener('click', closeDraft)", '');
    adapted = adapted.replace('    ta.focus()', `    ta.focus()
    function resizeComment() { ta.style.height = '32px'; ta.style.height = Math.min(52, ta.scrollHeight + 2) + 'px'; }
    ta.addEventListener('input', resizeComment)
    ta.addEventListener('keydown', function(event) { if (event.key === 'Escape') closeDraft(); })`);
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
      var comparison=${JSON.stringify(comparison).replace(/</g, '\\u003c')};
      var rangeText=${JSON.stringify(rangeText)};
      var scopeButton=document.getElementById('yan-review-scope');
      var scopeMenu=document.getElementById('yan-review-scope-menu');
      var compareButton=document.getElementById('yan-review-compare');
      var branchMenu=document.getElementById('yan-review-branch-menu');
      var branchSearch=document.getElementById('yan-review-branch-search');

      var refresh=document.getElementById('yan-review-refresh');
      var close=document.getElementById('yan-review-close');
      close&&close.addEventListener('click',function(){window.parent.postMessage({type:'yan-dsh-review-close',generation:generation},'*');});
      var search=document.getElementById('yan-review-search');
      var searchPanel=document.getElementById('yan-review-search-panel');
      var searchInput=document.getElementById('yan-review-search-input');
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
          link.title=path;link.textContent=parts[parts.length-1]||path;
          var fileId=(link.getAttribute('href')||'').slice(1);
          var fileIcon=document.getElementById(fileId)?.querySelector('.file-type-icon');
          if(fileIcon)link.prepend(fileIcon.cloneNode(true));
          container.appendChild(link);
        });
        nav.replaceChildren(fragment);
      }
      var loaded=files.map(function(file){return file.getAttribute('data-yan-state')==='loaded';});
      var wrapped=true;
      var filebarVisible=false;
      var initialFilebarWidth=parseFloat(getComputedStyle(root).getPropertyValue('--yan-review-filebar-width'))||220;
      var lastFilebarWidth=initialFilebarWidth;
      function setWrap(next){
        wrapped=!!next;
        root.classList.toggle('yan-no-wrap',!wrapped);
        if(wrap){wrap.innerHTML=wrapped?${JSON.stringify(wrapDisableIcon)}:${JSON.stringify(wrapEnableIcon)};wrap.title=wrapped?labels.disableWrap:labels.enableWrap;wrap.setAttribute('aria-label',wrap.title);wrap.setAttribute('aria-pressed',String(!wrapped));}
      }
      function setFileCollapsed(file,next){
        next=!!next||file.classList.contains('yan-file-empty');
        file.classList.toggle('yan-file-collapsed',next);
        var head=file.querySelector('.filehead');
        if(head&&!file.classList.contains('yan-file-empty'))head.setAttribute('aria-expanded',String(!next));
      }
      function requestFile(index){
        if(!lazy)return;
        var file=files[index];
        if(!file||loaded[index]||file.classList.contains('yan-file-empty'))return;
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
          applySearch();
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
        if(filebar){filebar.title=filebarVisible?${JSON.stringify(lang === 'en' ? 'Hide project' : '隐藏项目')}:${JSON.stringify(lang === 'en' ? 'Show project' : '显示项目')};filebar.setAttribute('aria-expanded',String(filebarVisible));filebar.setAttribute('aria-pressed',String(filebarVisible));}
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
          if(filebar){filebar.title=${JSON.stringify(lang === 'en' ? 'Show project' : '显示项目')};filebar.setAttribute('aria-expanded','false');filebar.setAttribute('aria-pressed','false');}
        }
        if(resizer){resizer.setAttribute('aria-valuemin','0');resizer.setAttribute('aria-valuemax',String(max));resizer.setAttribute('aria-valuenow',String(width));}
      }
      var resizing=false;
      function resizeFromClientX(clientX){setFilebarWidth(clientX);}
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
        if(target.hidden&&searchInput){searchInput.value='';applySearch();}
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

      filebar&&filebar.addEventListener('click',function(){setFilebarVisible(!filebarVisible);});
      function applySearch(){
        var query=(searchInput?.value||'').trim().toLocaleLowerCase();
        var count=0;
        files.forEach(function(file){
          var content=(file.getAttribute('data-yan-path')||'')+' '+(file.querySelector('.dsh-cr-grid')?.textContent||'');
          var match=!query||content.toLocaleLowerCase().includes(query);
          file.hidden=!match;if(match)count++;
        });
        var counter=document.getElementById('yan-review-search-count');
        if(counter)counter.textContent=count+' / '+files.length;
        var empty=document.getElementById('yan-review-search-empty');
        if(empty)empty.hidden=count>0;
      }
      function setSearchOpen(open){
        searchPanel.hidden=!open;search.setAttribute('aria-expanded',String(open));
        if(open){applySearch();searchInput.focus();searchInput.select();}
        else{searchInput.value='';applySearch();search.focus();}
      }
      function updateComparison(){
        var rangeBase=scopeButton.querySelector('[data-review-range-base]');
        if(rangeBase)rangeBase.textContent=comparison.mode==='all'?(comparison.baseBranch||comparison.currentBranch):comparison.currentBranch;
        document.querySelectorAll('[data-review-mode]').forEach(function(button){button.setAttribute('aria-checked',String(button.dataset.reviewMode===comparison.mode));});
        document.querySelectorAll('[data-review-base]').forEach(function(label){label.textContent=comparison.baseBranch?((label.closest('[data-review-mode]')?${JSON.stringify(lang === 'en' ? 'vs ' : '相对 ')}:'')+comparison.baseBranch):'';});
      }
      function positionScopeMenus(){
        var rect=scopeButton.getBoundingClientRect();
        scopeMenu.style.left=Math.max(8,Math.min(rect.left,innerWidth-268))+'px';
        scopeMenu.style.top=(rect.bottom+6)+'px';
        var parent=scopeMenu.getBoundingClientRect();
        var row=compareButton.getBoundingClientRect();
        var submenuWidth=Math.min(290,innerWidth-16);
        var left=parent.right+4;
        var top=row.top;
        if(left+submenuWidth>innerWidth-8){
          left=parent.left-submenuWidth-4;
          if(left<8){left=Math.max(8,Math.min(parent.left,innerWidth-submenuWidth-8));top=parent.bottom+4;}
        }
        branchMenu.style.left=left+'px';
        branchMenu.style.top=Math.max(8,Math.min(top,innerHeight-branchMenu.offsetHeight-8))+'px';
      }
      function setCompareOpen(open,focus){
        branchMenu.hidden=!open;compareButton.setAttribute('aria-expanded',String(open));
        if(open){renderBranches();positionScopeMenus();if(focus)branchSearch.focus();}
      }
      function setScopeOpen(open,focus){
        scopeMenu.hidden=!open;scopeButton.setAttribute('aria-expanded',String(open));
        if(open){positionScopeMenus();if(focus)scopeMenu.querySelector('[data-review-mode]').focus();}
        else{setCompareOpen(false);if(focus)scopeButton.focus();}
      }
      function publishComparison(){
        window.parent.postMessage({type:'yan-dsh-review-comparison',generation:generation,mode:comparison.mode,baseBranch:comparison.baseBranch},'*');
      }
      function renderBranches(){
        var list=document.getElementById('yan-review-branch-list');list.replaceChildren();
        var query=branchSearch.value.trim().toLocaleLowerCase();
        comparison.branches.filter(function(name){return !query||name.toLocaleLowerCase().includes(query);}).forEach(function(name){
          var option=document.createElement('button');option.type='button';option.className='yan-review-scope-option';
          option.setAttribute('role','menuitemradio');option.setAttribute('aria-checked',String(name===comparison.baseBranch));
          var label=document.createElement('span');label.className='yan-review-option-label';label.textContent=name;
          var check=document.createElement('span');check.className='yan-review-option-check';check.innerHTML=${JSON.stringify(checkIcon)};
          option.append(label,check);
          if(name===comparison.defaultBranch){var meta=document.createElement('span');meta.className='yan-review-option-meta';meta.textContent=rangeText.default;option.appendChild(meta);}
          option.addEventListener('click',function(){comparison.baseBranch=name;comparison.mode='all';updateComparison();publishComparison();setScopeOpen(false,true);});
          list.appendChild(option);
        });
        if(!list.children.length){var empty=document.createElement('div');empty.className='yan-review-branch-empty';empty.textContent=rangeText.noBranches;list.appendChild(empty);}
      }
      scopeButton.addEventListener('click',function(){setScopeOpen(scopeMenu.hidden);});
      scopeButton.addEventListener('keydown',function(event){if(event.key==='ArrowDown'){event.preventDefault();setScopeOpen(true,true);}});
      document.querySelectorAll('[data-review-mode]').forEach(function(button){button.addEventListener('click',function(){comparison.mode=button.dataset.reviewMode;updateComparison();publishComparison();setScopeOpen(false,true);});});
      compareButton.addEventListener('click',function(){setCompareOpen(true,true);});
      compareButton.addEventListener('pointerenter',function(){if(!compareButton.disabled)setCompareOpen(true,false);});
      branchSearch.addEventListener('input',function(){renderBranches();positionScopeMenus();});
      document.addEventListener('click',function(event){if(!scopeMenu.hidden&&!event.target.closest('#yan-review-scope, #yan-review-scope-menu, #yan-review-branch-menu'))setScopeOpen(false);});
      document.addEventListener('keydown',function(event){
        if(scopeMenu.hidden)return;
        if(event.key==='Escape'){event.preventDefault();if(!branchMenu.hidden){setCompareOpen(false);compareButton.focus();}else setScopeOpen(false,true);return;}
        if(event.key==='ArrowRight'&&event.target===compareButton){event.preventDefault();setCompareOpen(true,true);return;}
        if(event.key==='ArrowLeft'&&event.target.closest('#yan-review-branch-menu')){event.preventDefault();setCompareOpen(false);compareButton.focus();return;}
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){
          var container=event.target.closest('#yan-review-branch-menu')||scopeMenu;
          var buttons=[].slice.call(container.querySelectorAll('button:not(:disabled)')).filter(function(button){return button.getClientRects().length>0;});
          if(!buttons.length)return;event.preventDefault();var current=buttons.indexOf(document.activeElement);
          buttons[(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();
        }
      });
      window.addEventListener('resize',function(){if(!scopeMenu.hidden)positionScopeMenus();});
      updateComparison();
      search.addEventListener('click',function(){setSearchOpen(searchPanel.hidden);});
      searchInput.addEventListener('input',applySearch);
      document.getElementById('yan-review-search-close').addEventListener('click',function(){setSearchOpen(false);});
      document.addEventListener('keydown',function(event){
        if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){event.preventDefault();setSearchOpen(true);}
        else if(event.key==='Escape'&&!searchPanel.hidden){event.preventDefault();setSearchOpen(false);}
      });

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
        var reference=event.target&&event.target.closest?event.target.closest('[data-reference-file]'):null;
        if(reference){window.parent.postMessage({type:'yan-dsh-review-reference-file',generation:generation,index:Number(reference.getAttribute('data-reference-file'))},'*');return;}
        var copy=event.target&&event.target.closest?event.target.closest('[data-copy-file]'):null;
        if(copy){var index=Number(copy.getAttribute('data-copy-file'));if(lazy&&!loaded[index]){requestFile(index);return;}copyText(copies[index]||'',copy);return;}
        var head=event.target&&event.target.closest?event.target.closest('.filehead'):null;
        if(head)toggleFileHead(head);
      });
      function toggleFileHead(head){
        var owner=head.closest('.file');if(!owner||owner.classList.contains('yan-file-empty'))return;
        var ownerIndex=files.indexOf(owner);if(ownerIndex<0)return;
        if(lazy&&!loaded[ownerIndex]){requestFile(ownerIndex);return;}
        setFileCollapsed(owner,!owner.classList.contains('yan-file-collapsed'));
      }
      document.addEventListener('keydown',function(event){
        if((event.key==='Enter'||event.key===' ')&&event.target.matches('.filehead[role="button"]')){
          event.preventDefault();toggleFileHead(event.target);
        }
      });
      files.forEach(function(file,index){var grid=file.querySelector('.dsh-cr-grid');if(grid)grid.id='file-grid-'+index;});
      files.forEach(function(file,index){
        if(!lazy||loaded[index])return;
        file.classList.add('yan-file-collapsed');
        var hint=file.querySelector('.dsh-cr-grid > .dsh-cr-gaprow');
        if(hint)hint.textContent=labels.loadHint;
      });
      files.forEach(function(file,index){setFileCollapsed(file,file.classList.contains('yan-file-empty')||(lazy&&!loaded[index]));});
      setWrap(true);setFilebarWidth(initialFilebarWidth);setFilebarVisible(false);
    })()<\/script>`;
    adapted = adapted.replace('</body>', controlsScript + '</body>');
    if (options.pr) {
      adapted = adapted.replace('id="yan-review-scope"', 'title="PR 分支差异" id="yan-review-scope"');
      adapted = adapted.replace('class="yan-review-scope-menu"', 'class="yan-review-scope-menu yan-review-pr-scope-menu"');
      adapted = adapted.replace(`<span class="yan-review-option-label">${rangeText.all}</span>`, `<span class="yan-review-option-label">${lang === 'en' ? 'PR branch diff' : 'PR 分支差异'}</span>`);
      adapted = adapted.replace(/<button[^>]*data-reference-file=[\s\S]*?<\/button>/g, '');
    }
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
    if (document.getElementById('app')?.classList.contains('wallpaper-enabled')) {
      out['--dsw-alias-bg-base'] = 'transparent';
      out['--dsw-alias-bg-layer-1'] = 'transparent';
      out['--dsw-alias-markdown-code-block'] = 'transparent';
    }
    const uiFont = styles.getPropertyValue('--font-sans').trim();
    if (uiFont) out['--yan-font-ui'] = uiFont;
    out['--yan-code-size'] = styles.getPropertyValue('--code-scale').trim() || '12px';
    out['--yan-code-weight'] = styles.getPropertyValue('--code-weight').trim() || '400';
    return out;
  }

  function wallpaperSurfaceActive() {
    return document.getElementById('app')?.classList.contains('wallpaper-enabled') === true;
  }

  // While a wallpaper is active the review must be see-through so the host
  // material shows. Stylesheet rules proved fragile: a re-render could land in a
  // moment where the cascade no longer matched and the panel fell back to its
  // opaque paper fill until the user re-applied the wallpaper. Pin the value
  // inline on the host surfaces (inline wins over any stylesheet) and mirror it
  // into the iframe document.
  function enforceWallpaperSurface() {
    const on = wallpaperSurfaceActive();
    for (const el of [surface.root, surface.iframe, document.getElementById('rs-review')]) {
      if (!el) continue;
      if (on) el.style.setProperty('background', 'transparent', 'important');
      else el.style.removeProperty('background');
    }
    const doc = surface.iframe?.contentDocument;
    if (!doc?.documentElement) return;
    let style = doc.getElementById('yan-wallpaper-transparent');
    if (on) {
      if (!style) {
        style = doc.createElement('style');
        style.id = 'yan-wallpaper-transparent';
        doc.head?.appendChild(style);
      }
      style.textContent = 'html, body { background: transparent !important; }';
    } else if (style) {
      style.remove();
    }
  }

  function syncAppearance() {
    const doc = surface.iframe?.contentDocument;
    if (!doc?.documentElement) return;
    for (const [name, value] of Object.entries(collectThemeVars())) doc.documentElement.style.setProperty(name, value);
    enforceWallpaperSurface();
    if (!doc.getElementById('yan-appearance-fonts')) {
      const style = doc.createElement('style');
      style.id = 'yan-appearance-fonts';
      const url = name => JSON.stringify(new URL(`assets/${name}`, document.baseURI).href);
      style.textContent = `@font-face { font-family: "Yan Reading Serif"; src: url(${url('NotoSerifSC.ttf')}); font-weight: 200 900; }`;
      for (const weight of [300, 400, 500, 600, 700]) {
        style.textContent += `@font-face { font-family: "Source Serif 4"; src: url(${url(`fonts/source-serif-4-latin-${weight}-normal.woff2`)}); font-weight: ${weight}; }`;
      }
      doc.head?.append(style);
    }
  }
  window.addEventListener('yan-appearance-change', syncAppearance);
  new MutationObserver(syncAppearance).observe(document.getElementById('app'), { attributes: true, attributeFilter: ['class'] });

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
    if (data.type === 'yan-dsh-review-close') {
      if (event.source !== surface.iframe?.contentWindow || data.generation !== surface.loading) return;
      surface.onClose?.();
      return;
    }
    if (data.type === 'yan-dsh-review-refresh') {
      if (!surface.iframe || event.source !== surface.iframe.contentWindow) return;
      surface.onRefresh?.();
      return;
    }
    if (data.type === 'yan-dsh-review-reference-file') {
      if (event.source !== surface.iframe?.contentWindow || data.generation !== surface.loading) return;
      const file = surface.files[Number(data.index)];
      if (file) surface.onReferenceFile?.(normalizedReviewPath(file));
      return;
    }
    if (data.type === 'yan-dsh-review-comparison') {
      if (event.source !== surface.iframe?.contentWindow || data.generation !== surface.loading) return;
      const mode = data.mode === 'uncommitted' ? 'uncommitted' : 'all';
      const baseBranch = String(data.baseBranch || '');
      if (baseBranch && !(surface.comparison?.branches || []).some(branch => String(typeof branch === 'string' ? branch : branch?.name || '') === baseBranch)) return;
      surface.comparison = { ...surface.comparison, mode, baseBranch };
      surface.onComparisonChange?.({ mode, baseBranch });
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

  const surface = { root: null, iframe: null, loading: 0, onRollback: null, onClose: null, onRefresh: null, onReferenceFile: null, onComparisonChange: null, comparison: null, loadFile: null, lazy: false, pendingLoads: new Set(), files: [], collapsedFolders: new Set(), renderedRows: 0, renderedChars: 0, loadedIndexes: new Set() };

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
    document.getElementById('rs-review')?.setAttribute('data-state', 'error');
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
    const manifest = surface.files[index];
    if (!(Number(manifest?.additions) > 0 || Number(manifest?.deletions) > 0)) return;
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
      showError('审阅组件未加载，请重新启动 Yan Agent');
      return false;
    }
    const summary = options.summary || { count: 0, additions: 0, deletions: 0, files: [] };
    surface.onRollback = typeof options.onRollback === 'function' ? options.onRollback : null;
    surface.onClose = typeof options.onClose === 'function' ? options.onClose : null;
    surface.onRefresh = typeof options.onRefresh === 'function' ? options.onRefresh : null;
    surface.onReferenceFile = typeof options.onReferenceFile === 'function' ? options.onReferenceFile : null;
    surface.onComparisonChange = typeof options.onComparisonChange === 'function' ? options.onComparisonChange : null;
    surface.comparison = options.comparison || {};
    surface.loadFile = typeof options.loadFile === 'function' ? options.loadFile : null;
    surface.lazy = options.lazy !== false && !!surface.loadFile;
    // Lazy mode never renders rows in the first pass: strip any row payload a
    // caller may still carry so the manifest document stays lightweight.
    const manifestSummary = surface.lazy
      ? (globalThis.YanReviewData.projectReviewSummary(summary) || { files: [] })
      : summary;
    const rawText = typeof options.rawDiff === 'string' ? options.rawDiff : coreApi.rawDiffFromSummary(manifestSummary);
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
    const embeddedHtml = adaptForSidebar(compat.html, detectLang(), files, rawText, { lazy: surface.lazy, generation: token, collapsedFolders: [...surface.collapsedFolders], comparison: surface.comparison, pr: options.pr });
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
    // Hide any previous document while the fresh one loads: a reloading iframe
    // paints an un-wired intermediate that looks interactive but ignores input
    // until its inline script finishes (and, before the theme is applied, reads
    // as a white sheet). Reveal only on load, with the reading hint standing in.
    root.classList.add('hidden');
    document.getElementById('rs-review')?.setAttribute('data-state', 'loading');
    enforceWallpaperSurface();
    const revealRoot = () => {
      if (token !== surface.loading) return;
      if (!root.classList.contains('hidden')) return;
      syncAppearance();
      root.classList.remove('hidden');
      root.setAttribute('aria-hidden', 'false');
      document.getElementById('rs-review')?.setAttribute('data-state', 'success');
    };
    // Native fragment navigation can scroll the iframe's ancestors as well.
    // Restore the selected file strictly within the embedded document.
    surface.iframe.onload = () => requestAnimationFrame(() => {
      if (token !== surface.loading) return;
      revealRoot();
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
    // Keep the review hidden until the iframe has actually loaded. Revealing a
    // half-loaded file document creates a white flash and leaves the guest
    // document in a transient state where clicks can be swallowed.
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
    surface.onClose = null;
    surface.onComparisonChange = null;
    surface.onReferenceFile = null;
    surface.comparison = null;
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
