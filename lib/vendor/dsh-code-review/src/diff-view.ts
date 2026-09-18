/**
 * 独立 Code Review 标签页的 HTML 构建(纯字符串,可在 Node 里单测)。
 *
 * 聊天窗口内不再做双列转换 —— 只在检测到 git diff 的块上加一个
 * 「在新标签页打开」按钮;点击后在独立浏览器标签页(Blob URL,自包含)
 * 渲染完整双列视图:左侧文件导航、全宽、整页滚动、无高度限制。
 *
 * 布局(与官方 DiffBlock 同源的双列语义):
 * - ctx    上下文行:两侧同文、无底色;
 * - del    删除行:仅旧侧,红底;
 * - add    新增行:仅新侧,绿底;
 * - change 变更对:旧侧红底 + 新侧绿底(连续 - 与 + 的配对,见 diff-parse);
 * - gap    @@ hunk 头,横跨四列。
 */

import type { DiffRow, FileDiff } from './diff-parse'
import { countStats, displayPath } from './diff-parse'
import { diffMidRange, langFor, tokenizeLine } from './diff-highlight'
import type { DiffMidRange, LineLang, Token } from './diff-highlight'

/** HTML 转义:diff 行内容是不可信文本,直接拼 HTML 必须先转义。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 独立页的 CSS:自包含,颜色全部走注入的主题变量(与 DSH 主题一致)。 */
const STANDALONE_CSS = `
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
  /* 制表符按 4 个字符宽度渲染(浏览器默认 8,代码阅读太松) */
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
/* 语法高亮:颜色复用官方 shiki 变量(与 DSH 深浅主题一致,取不到时兜底) */
.tok-kw { color: var(--shiki-token-keyword, #7c3aed); }
.tok-str { color: var(--shiki-token-string, #16a34a); }
.tok-com { color: var(--shiki-token-comment, #9aa0a6); font-style: italic; }
.tok-num { color: var(--shiki-token-constant, #d97706); }
/* 行内字符级差异:change 行中段加深背景(旧侧红/新侧绿) */
.dihl-mid-old {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 32%, transparent);
  border-radius: 2px;
}
.dihl-mid-new {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 32%, transparent);
  border-radius: 2px;
}
/* 行内评论:行号格可点击,hover 出现 + 号 */
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
`

/** 变更类型的徽章文案(中文默认,由 CR_TEXTS 覆盖)。 */
const STANDALONE_STATUS_LABEL: Record<FileDiff['status'], string> = {
  modified: '修改',
  added: '新增文件',
  deleted: '删除文件',
  renamed: '重命名',
  binary: '二进制',
  mode: '权限变更',
}

/** 界面语言(DSH 页面 lang 以 zh 开头算中文,其余一律英文)。 */
export type Lang = 'zh' | 'en'

/**
 * 全部用户可见文案的中/英词典。聊天内按钮、独立标签页、评论报告
 * 三处共用;独立标签页脱离 DSH 页面拿不到官方 locale,由生成时把
 * 语言连同词典一起传入。函数字段仅供 TS 侧求值,注入标签页脚本时
 * 只挑字符串字段(JSON 序列化会丢函数)。
 */
export interface CrTexts {
  // —— 聊天内按钮 ——
  openTab: string
  openTabTitle: string
  expand: string
  collapse: string
  expandTitle: string
  collapseTitle: string
  // —— 评论报告(提交到 DSH 对话框)——
  reportLgtmHeader: (count: number) => string
  reportCommentHeader: (count: number) => string
  /** 纯 LGTM(0 条评论)时提交的报告文本,不带计数后缀。 */
  reportLgtmBare: string
  // —— 独立标签页 ——
  stats: (added: number, removed: number, files: number) => string
  submitComments: string
  copyRaw: string
  copied: string
  sent: string
  submitHint: string
  submitLgtm: string
  submitPlain: string
  rawSummary: string
  commentPlaceholder: string
  addComment: string
  cancel: string
  noNewlineTitle: string
  openerClosed: string
  noSession: string
  status: Record<FileDiff['status'], string>
}

export const CR_TEXTS: Record<Lang, CrTexts> = {
  zh: {
    openTab: '⧉ 新标签页打开',
    openTabTitle: '在独立的浏览器标签页中打开 Code Review 视图',
    expand: '展开',
    collapse: '收起',
    expandTitle: '展开原始 diff 文本',
    collapseTitle: '收起原始 diff 文本',
    reportLgtmHeader: (count) => `Looks good to me ✓ — Code Review 共 ${count} 条评论:`,
    reportCommentHeader: (count) => `Code Review 意见,共 ${count} 条:`,
    reportLgtmBare: 'Looks good to me ✓',
    stats: (added, removed, files) => `+${added} −${removed} · ${files} 个文件`,
    submitComments: '提交评论',
    copyRaw: '复制原始 diff',
    copied: '已复制',
    sent: '已发送 ✓',
    submitHint: '把全部评论提交到 DSH 对话框:',
    submitLgtm: 'Looks Good To Me ✓',
    submitPlain: '仅提交评论',
    rawSummary: '原始 diff 文本',
    commentPlaceholder: '在此行添加评论…',
    addComment: '添加评论',
    cancel: '取消',
    noNewlineTitle: '该侧文件末尾无换行符',
    openerClosed: '原来的 DSH 页面已关闭,无法回传评论',
    noSession: '未能写入 DSH 对话框:当前没有打开中的会话',
    status: STANDALONE_STATUS_LABEL,
  },
  en: {
    openTab: '⧉ Open in new tab',
    openTabTitle: 'Open the code review view in a separate browser tab',
    expand: 'Expand',
    collapse: 'Collapse',
    expandTitle: 'Show raw diff text',
    collapseTitle: 'Hide raw diff text',
    reportLgtmHeader: (count) => `Looks good to me ✓ — Code Review with ${count} comment${count === 1 ? '' : 's'}:`,
    reportCommentHeader: (count) => `Code Review comments (${count}):`,
    reportLgtmBare: 'Looks good to me ✓',
    stats: (added, removed, files) => `+${added} −${removed} · ${files} file${files === 1 ? '' : 's'}`,
    submitComments: 'Submit comments',
    copyRaw: 'Copy raw diff',
    copied: 'Copied',
    sent: 'Sent ✓',
    submitHint: 'Submit all comments to the DSH composer:',
    submitLgtm: 'Looks Good To Me ✓',
    submitPlain: 'Comments only',
    rawSummary: 'Raw diff text',
    commentPlaceholder: 'Add a comment on this line…',
    addComment: 'Add comment',
    cancel: 'Cancel',
    noNewlineTitle: 'No newline at end of file',
    openerClosed: 'The original DSH page was closed; comments cannot be sent back',
    noSession: 'Could not write to the DSH composer: no open session',
    status: {
      modified: 'modified',
      added: 'new file',
      deleted: 'deleted',
      renamed: 'renamed',
      binary: 'binary',
      mode: 'mode change',
    },
  },
}

/** 只挑字符串字段,序列化进独立页脚本(JSON 会丢函数字段)。 */
function stringTexts(texts: CrTexts): Record<string, string> {
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
    noSession: texts.noSession,
  }
}

/** 标签页回传的一条行内评论(经 postMessage,形状由插件侧校验)。 */
export interface ReviewComment {
  path: string
  lineNo: number
  side?: string
  text: string
}

/**
 * 组装提交到 DSH 对话框的 Code Review 报告文本(纯函数,单测覆盖)。
 * 格式:文件名:行号 — 评论,逐条编号;LGTM 时头部加批准声明。
 * 评论文本含换行时,续行缩进三格与条目内容对齐,不破坏编号结构。
 * @param comments 行内评论列表。
 * @param kind 提交类型:lgtm(批准)/ comment(纯评论)。
 * @param lang 报告语言(默认中文)。
 */
export function buildCommentReport(
  comments: readonly ReviewComment[],
  kind: 'lgtm' | 'comment',
  lang: Lang = 'zh',
): string {
  const texts = CR_TEXTS[lang]
  // 纯 LGTM(0 条评论)只输出批准声明一行,不带空计数头。
  if (kind === 'lgtm' && comments.length === 0) return texts.reportLgtmBare
  const header = kind === 'lgtm' ? texts.reportLgtmHeader(comments.length) : texts.reportCommentHeader(comments.length)
  const items = comments.map((comment, index) => {
    const lines = comment.text.split('\n')
    const first = `${index + 1}. ${comment.path}:${comment.lineNo} — ${lines[0]}`
    // 续行缩进三格(与 "N. " 前缀等宽),避免与下一条编号混淆。
    const rest = lines.slice(1).map((line) => `   ${line}`)
    return [first, ...rest].join('\n')
  })
  return [header, '', ...items].join('\n')
}

/** 把 token 序列渲染成 HTML(转义在 token 级做,保证安全)。 */
function tokensToHtml(tokens: Token[]): string {
  let out = ''
  for (const token of tokens) {
    const escaped = escapeHtml(token.text)
    out += token.cls === null ? escaped : `<span class="${token.cls}">${escaped}</span>`
  }
  return out
}

/**
 * 渲染一个内容格:基础语法高亮 + 可选的行内字符级差异高亮。
 * @param text 内容文本(可能为空)。
 * @param side 旧/新侧(决定中段背景用红还是绿)。
 * @param noEol 末尾无换行标记。
 * @param diffRange 行内差异范围(仅 change 行;null = 不做字符级高亮)。
 * @param lang 语法高亮配置(无法识别语言时 null)。
 */
function cellHtml(
  text: string | undefined,
  side: 'old' | 'new',
  noEol: boolean | undefined,
  diffRange: DiffMidRange | null,
  lang: LineLang | null,
  noNewlineTitle: string,
): string {
  if (text === undefined) return `<div class="dsh-cr-cell dsh-cr-cell-${side}"></div>`
  const mark = noEol === true ? `<span class="dsh-cr-nonl" title="${escapeHtml(noNewlineTitle)}">⏎</span>` : ''
  let body: string
  if (diffRange === null) {
    // 无字符级高亮:整行一个语法段。
    body = lang === null ? escapeHtml(text) : tokensToHtml(tokenizeLine(text, lang))
  } else {
    // 按 code point 切前/中/后三段(索引来自 diffMidRange 的
    // Array.from 计算,切片同样按 code point,代理对不会断裂)。
    const chars = Array.from(text)
    const start = side === 'old' ? diffRange.oldStart : diffRange.newStart
    const end = side === 'old' ? diffRange.oldEnd : diffRange.newEnd
    const prefix = chars.slice(0, start).join('')
    const mid = chars.slice(start, end).join('')
    const suffix = chars.slice(end).join('')
    const seg = (segText: string): string =>
      lang === null ? escapeHtml(segText) : tokensToHtml(tokenizeLine(segText, lang))
    body = seg(prefix)
      + (mid !== '' ? `<span class="dihl-mid-${side}">${seg(mid)}</span>` : '')
      + seg(suffix)
  }
  return `<div class="dsh-cr-cell dsh-cr-cell-${side}">${body}${mark}</div>`
}

/** 渲染一行(双列 4 格结构,直接产 HTML 字符串)。 */
function rowHtml(row: DiffRow, lang: LineLang | null, path: string, noNewlineTitle: string): string {
  if (row.kind === 'gap') {
    return `<div class="dsh-cr-gaprow">${escapeHtml(row.gapText ?? '')}</div>`
  }
  // 行号格带评论定位信息(文件路径/行号/侧别),标签页脚本据此挂行内评论。
  const num = (no: number | undefined, side: string): string => {
    if (no === undefined) return `<div class="dsh-cr-num dsh-cr-num-${side}"></div>`
    return `<div class="dsh-cr-num dsh-cr-num-${side}" data-cr-path="${escapeHtml(path)}" data-cr-line="${no}" data-cr-side="${side}">${no}</div>`
  }
  const line = `<div class="dsh-cr-row dsh-cr-${row.kind}">`
  if (row.kind === 'ctx') {
    return line + num(row.oldNo, 'old') + cellHtml(row.oldText, 'old', row.oldNoEol, null, lang, noNewlineTitle)
      + num(row.newNo, 'new') + cellHtml(row.newText, 'new', row.newNoEol, null, lang, noNewlineTitle) + '</div>'
  }
  if (row.kind === 'del') {
    return line + num(row.oldNo, 'old') + cellHtml(row.oldText, 'old', row.oldNoEol, null, lang, noNewlineTitle)
      + num(undefined, 'new') + cellHtml(undefined, 'new', undefined, null, lang, noNewlineTitle) + '</div>'
  }
  if (row.kind === 'add') {
    return line + num(undefined, 'old') + cellHtml(undefined, 'old', undefined, null, lang, noNewlineTitle)
      + num(row.newNo, 'new') + cellHtml(row.newText, 'new', row.newNoEol, null, lang, noNewlineTitle) + '</div>'
  }
  // change 行:算行内字符级差异范围,两侧中段各自加深背景。
  const range = diffMidRange(row.oldText ?? '', row.newText ?? '')
  return line + num(row.oldNo, 'old') + cellHtml(row.oldText, 'old', row.oldNoEol, range, lang, noNewlineTitle)
    + num(row.newNo, 'new') + cellHtml(row.newText, 'new', row.newNoEol, range, lang, noNewlineTitle) + '</div>'
}

/**
 * 构建独立标签页的完整 HTML(自包含:样式 + 主题变量 + 双列内容)。
 * 必须由「在新标签页打开」按钮的点击处理器在用户手势内同步调用
 * (window.open 才不会被浏览器拦截)。
 * @param files 解析结果。
 * @param theme 从宿主页面收集的 DSW 主题变量(name → value)。
 * @param rawText 原始 diff 文本(复制/保底查看用)。
 */
export function buildStandaloneHtml(
  files: FileDiff[],
  theme: Record<string, string>,
  rawText: string,
  lang: Lang = 'zh',
): string {
  const texts = CR_TEXTS[lang]
  const stats = countStats(files)
  const statsText = texts.stats(stats.added, stats.removed, stats.files)
  const rootVars = Object.entries(theme)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ')
  // 原始文本要内嵌进 <script> 的 JSON 字符串:JSON.stringify 不转义 `<`,
  // diff 内容里一旦出现 `</script>` 会提前终止标签(经典解析陷阱),
  // 统一把 `<` 写成 \u003c(JSON 语义等价,解析安全)。
  const rawJson = JSON.stringify(rawText).replace(/</g, '\\u003c')
  const nav = files
    .map((file, index) => `<a class="navitem" href="#file-${index}">${escapeHtml(displayPath(file.newPath) || displayPath(file.oldPath))}</a>`)
    .join('')
  const sections = files.map((file, index) => {
    const oldPath = displayPath(file.oldPath)
    const newPath = displayPath(file.newPath)
    const path = oldPath !== '' && oldPath !== newPath ? `${oldPath} → ${newPath}` : (newPath === '' ? oldPath : newPath)
    const meta = file.meta.filter((m) => !m.startsWith('index '))
    // 语言推断:新路径优先(新增文件没有旧路径);/dev/null 时回退旧路径。
    const lang = langFor(newPath) ?? langFor(oldPath)
    const commentPath = newPath !== '' && newPath !== '/dev/null' ? newPath : oldPath
    const rows = file.rows.length === 0
      ? `<div class="dsh-cr-gaprow">${escapeHtml(file.meta.join(' · ') || file.status)}</div>`
      : file.rows.map((row) => rowHtml(row, lang, commentPath, texts.noNewlineTitle)).join('')
    const head = `<header class="filehead"><span class="badge">${texts.status[file.status]}</span><span class="path">${escapeHtml(path)}</span>`
      + (meta.length > 0 ? `<span class="meta">${escapeHtml(meta.join(' · '))}</span>` : '')
      + '</header>'
    return `<section class="file" id="file-${index}">${head}<div class="dsh-cr-grid">${rows}</div></section>`
  }).join('')
  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Code Review · ${statsText}</title>
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
</script>
<script>
/* 行内评论:点击行号格提评论,攒齐后提交回 DSH 对话框(postMessage)。 */
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
    // 纯评论要求至少一条;纯 LGTM(0 条评论)允许直接提交批准。
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
    // 0 条评论时也允许打开面板(纯 LGTM 场景)。
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
</script>
</body>
</html>
`
}
