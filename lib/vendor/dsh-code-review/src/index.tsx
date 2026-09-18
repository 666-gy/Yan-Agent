/**
 * @yangzhe1991/dsh-code-review 插件,浏览器半 —— Git Diff 独立审查标签页。
 *
 * 交互:聊天窗口内保持官方原始显示(不展开、不转换),检测到 git diff
 * 输出的块上自动加一个「在新标签页打开」按钮;点击后在独立浏览器标签
 * 页渲染完整双列 Code Review 视图(见 diff-view.ts)。弹窗必须由用户
 * 手势触发,所以标签页只能做成按钮形态。
 *
 * 两个按钮注入来源(互补,覆盖 diff 出现的两个面):
 * 1. DOM 探测:markdown 代码块(.md-code-block,```diff/```patch 或内容
 *    形似 diff)与详情面板里的终端卡片([data-terminal])。流式期间内容
 *    持续变化,去抖稳定后才加按钮;内容不再形似 diff 时移除按钮。
 * 2. 数据层:bash 工具结果输出形似 diff 时,折叠的工具行在 DOM 里没有
 *    输出内容(随展开才挂载),纯 DOM 探测看不到 —— 由 session 作用域
 *    组件订阅 chat 快照,把结果文本按节点 key 存表,扫描器给对应的
 *    工具行本体([data-sample="bash"])加按钮。工具行内的终端卡片探测
 *    会跳过(避免同一块出现两个按钮)。
 *
 * 前端结构版本备忘(0.1.2-alpha.4 起):
 * - markdown 代码块结构变为 [bannerWrap[banner[infostring, action]], body],
 *   banner 外多包一层 sticky 的 bannerWrap;语言标签在 infostring 里;
 * - chat 快照从 useSession((s) => s.chat) 迁移到会话标准 hook useChat
 *   (dsh-client-ui-chat 注册),DiffToolButtonWatcher 已适配并保留旧路径;
 * - inputActions 仍是会话标准 props(conversation 插件提供),评论回传
 *   路径不受影响。
 */
import { useEffect } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// 触发 SlotMap 声明合并:shell.overlay 由 layout、header.actions 由 conversation 声明。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// 声明合并:官方 locale 服务挂载在 cordis Context 上(由 dsh-client-locale
// 提供;类型为 unknown,运行时做形状校验 —— 不直接依赖该包的类型)。
import type {} from '@deepseek-ai/cordis'
import { isDiffText, parseGitDiff } from './diff-parse'
import { buildCommentReport, buildStandaloneHtml, CR_TEXTS } from './diff-view'
import type { Lang, ReviewComment } from './diff-view'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 官方 locale 服务(可选:官方装配不含 locale 时为 undefined)。 */
    locale?: unknown
  }
}

// —— 可调参数 ——

/** 稳定去抖窗口:内容在这个窗口内不再变化才加按钮(流式期间不断重置)。 */
const STABLE_MS = 1000
/** 全量扫描去抖(MutationObserver 触发频繁,合并成一次扫描)。 */
const SCAN_DEBOUNCE = 300
/** 解析失败后的重试间隔(畸形 diff 内容稳定后可能变合法)。 */
const RETRY_MS = 3000
/** 兜底全量扫描间隔:覆盖任何漏掉的 mutation 路径(理论不该有)。 */
const SAFETY_SCAN_MS = 10000

/** 注入的 <style> 是否已存在,避免重复注入。 */
let styleInjected = false

// —— 按钮样式(官方语义变量,深浅主题自动适配)——

const BUTTON_CSS = `
/* 主按钮:「在新标签页打开」—— 品牌蓝实心 + 白字,深浅主题都醒目 */
.dsh-cr-openbtn {
  margin-left: auto;
  flex: none;
  font-size: 12px;
  line-height: 18px;
  color: #fff;
  background: var(--dsw-alias-state-business-primary, #3b6fe0);
  border: none;
  border-radius: 8px;
  padding: 2px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.dsh-cr-openbtn:hover {
  filter: brightness(1.1);
}
/* 次按钮:「展开/收起」—— 保持低调,不与主按钮抢视线 */
.dsh-cr-foldbtn {
  flex: none;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 1px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.dsh-cr-foldbtn:hover {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l3);
}
/* 按钮行容器:两个按钮装进一个右对齐的独立行。
 * 新前端代码块结构是 bannerWrap(块级 sticky)包着 banner,直接 append
 * 会被挤在 banner 之下且靠左;官方复制按钮所在 .action 也是 flex 并排,
 * 插件按钮塞进去会跟复制按钮争位。做成独立行后:旧 banner(flex)里它是
 * 靠右的 flex 项,新 bannerWrap(块级)里它整行右对齐,避免争位。 */
.dsh-cr-row {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  flex: none;
  margin-left: auto;
  padding: 4px 12px 7px;
}
`

/** 全局注入一次按钮样式(浏览器端 bundle 的模块级副作用)。 */
function ensureStyle(): void {
  if (styleInjected || typeof document === 'undefined') return
  styleInjected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-code-review'
  tag.textContent = BUTTON_CSS
  document.head.appendChild(tag)
}

// —— 独立标签页打开 ——

/** 独立标签页需要继承的 DSW 主题变量(取不到时给浅色近似值兜底)。 */
const THEME_VAR_DEFAULTS: Record<string, string> = {
  '--dsw-alias-bg-base': '#ffffff',
  '--dsw-alias-bg-layer-1': '#f7f7f8',
  '--dsw-alias-markdown-code-block': '#f4f4f5',
  '--dsw-alias-label-primary': '#1a1a1a',
  '--dsw-alias-label-secondary': '#555555',
  '--dsw-alias-label-tertiary': '#888888',
  '--dsw-alias-border-l2': '#e5e5e7',
  '--dsw-alias-border-l3': '#cfcfd2',
  '--dsw-alias-state-error-primary': '#d92d20',
  '--dsw-alias-state-success-primary': '#12b76a',
  '--dsw-alias-state-business-primary': '#3b6fe0',
  '--ds-font-family-code': 'ui-monospace, SFMono-Regular, Menlo, monospace',
  // 语法高亮 token 颜色:官方 shiki 主题变量(与 DSH 深浅主题一致)。
  '--shiki-token-keyword': '#7c3aed',
  '--shiki-token-string': '#16a34a',
  '--shiki-token-comment': '#9aa0a6',
  '--shiki-token-constant': '#d97706',
  '--shiki-token-function': '#2563eb',
}

/** 从宿主页面收集主题变量的实际值(独立标签页与 DSH 深浅色保持一致)。 */
function collectThemeVars(): Record<string, string> {
  const out: Record<string, string> = {}
  const styles = getComputedStyle(document.body)
  for (const name of Object.keys(THEME_VAR_DEFAULTS)) {
    const value = styles.getPropertyValue(name).trim()
    out[name] = value !== '' ? value : THEME_VAR_DEFAULTS[name]
  }
  return out
}

/**
 * 打开独立审查标签页。必须在用户点击手势内同步执行(Blob URL 生成 +
 * window.open 全同步),否则会被浏览器弹窗拦截。URL 延迟释放。
 * 返回的子窗口引用登记进 reviewWindows,评论回传时校验消息来源。
 */
/** 官方 locale 服务的最小形状(运行时形状校验,不依赖官方包类型)。 */
interface LocaleService {
  getLocale(): { active: string }
}

/** 官方 locale 服务(apply 时接管;官方装配不含 locale 时留 null)。 */
let localeService: LocaleService | null = null

/**
 * 检测 DSH 界面语言:优先官方 locale 服务(用户设置 > 浏览器语言),
 * 拿不到时退回浏览器语言(navigator),非 zh 一律按英文。
 * 每次现读 —— 用户在设置里切换语言后,下一次生成按钮/标签页即生效,
 * 无需订阅 locale/change 事件。
 */
function detectLang(): Lang {
  if (localeService !== null) {
    return localeService.getLocale().active === 'en' ? 'en' : 'zh'
  }
  const nav = navigator.languages?.[0] ?? navigator.language ?? ''
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function openReviewTab(text: string): void {
  const files = parseGitDiff(text)
  if (files.length === 0) return
  const html = buildStandaloneHtml(files, collectThemeVars(), text, detectLang())
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  // 顺带清掉已关闭的旧子窗口引用。
  for (const win of reviewWindows) {
    if (win === null || win.closed) reviewWindows.delete(win)
  }
  const win = window.open(url, '_blank')
  if (win !== null) reviewWindows.add(win)
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}

// —— 评论回传(独立标签页 → DSH 对话框)——

/** 本插件打开的审查子窗口(消息来源校验用)。 */
const reviewWindows = new Set<Window | null>()

/** 当前会话的 composer 写入器(header.actions 组件挂载时注册)。 */
let composerWriter: ((text: string) => void) | null = null

/** 校验回传评论的形状,过滤非法条目(跨窗口数据不可信)。 */
function sanitizeComments(raw: unknown): ReviewComment[] {
  if (!Array.isArray(raw)) return []
  const out: ReviewComment[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const c = item as { path?: unknown; lineNo?: unknown; text?: unknown }
    if (typeof c.path !== 'string' || typeof c.lineNo !== 'number' || typeof c.text !== 'string') continue
    if (c.text.trim() === '') continue
    out.push({ path: c.path, lineNo: Math.trunc(c.lineNo), text: c.text })
  }
  return out
}

/**
 * 处理审查页回传的评论:组装「文件名:行号 — 评论」报告文本,写入
 * 当前会话的 composer,并向子窗口回执。消息来源校验:必须是本插件
 * 打开的窗口(与 origin 相比更可靠,blob 子窗口的 origin 语义有差异)。
 */
function handleReviewMessage(event: MessageEvent): void {
  const data = event.data
  if (typeof data !== 'object' || data === null) return
  if (data.type !== 'dsh-code-review-comments') return
  if (!reviewWindows.has(event.source as Window | null)) return
  const comments = sanitizeComments(data.comments)
  const kind = data.kind === 'lgtm' ? 'lgtm' : 'comment'
  // 纯 LGTM 允许 0 条评论(报告只有批准声明一行);纯评论仍要求至少一条。
  if (comments.length === 0 && kind !== 'lgtm') return
  const report = buildCommentReport(comments, kind, detectLang())
  const source = event.source as Window
  if (composerWriter !== null) {
    composerWriter(report)
    source.postMessage({ type: 'dsh-code-review-ack', ok: true }, '*')
  } else {
    source.postMessage({ type: 'dsh-code-review-ack', ok: false }, '*')
  }
}

// —— 按钮注入(纯 DOM,不依赖 React)——

/**
 * 给宿主元素(代码块 banner / 终端卡片 header / bash 工具行本体)加按钮:
 * ①「在新标签页打开」;② 代码块场景再加「展开/收起」开关(默认折叠
 * 原始 diff 文本,聊天流保持紧凑)。已存在的按钮跳过。
 * @param host 按钮挂载点(React 不追踪我们的节点,重渲染一般不动它)。
 * @param getText 点击时获取 diff 原始文本(现读,避免过期引用)。
 * @param fold 代码块折叠开关(非代码块场景传 null)。
 */
function ensureButtons(
  host: HTMLElement,
  getText: () => string | null,
  fold: { folded: boolean; onToggle: () => void } | null,
): void {
  const texts = CR_TEXTS[detectLang()]
  // 按钮统一装进插件自己的行容器(见 BUTTON_CSS 里 .dsh-cr-row 的注释),
  // 新旧前端结构下都靠右、不干扰官方布局。
  let row: HTMLElement | null = host.querySelector('[data-dsh-cr-row]')
  if (row === null) {
    const created = document.createElement('div')
    created.className = 'dsh-cr-row'
    created.dataset.dshCrRow = ''
    host.appendChild(created)
    row = created
  }
  if (row.querySelector('[data-dsh-cr-btn]') === null) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'dsh-cr-openbtn'
    btn.dataset.dshCrBtn = ''
    btn.textContent = texts.openTab
    btn.title = texts.openTabTitle
    btn.addEventListener('click', (event) => {
      // bash 工具行本体整行可点(展开),必须阻止事件传播到官方点击。
      event.stopPropagation()
      event.preventDefault()
      const text = getText()
      if (text !== null) openReviewTab(text)
    })
    row.appendChild(btn)
  }
  if (fold !== null && row.querySelector('[data-dsh-cr-fold]') === null) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'dsh-cr-foldbtn'
    btn.dataset.dshCrFold = ''
    btn.textContent = fold.folded ? texts.expand : texts.collapse
    btn.title = fold.folded ? texts.expandTitle : texts.collapseTitle
    btn.addEventListener('click', (event) => {
      event.stopPropagation()
      event.preventDefault()
      fold.onToggle()
    })
    row.appendChild(btn)
  }
}

/** 移除宿主上的所有按钮(内容不再形似 diff / 解析失败时)。 */
function removeButtons(host: HTMLElement): void {
  for (const btn of host.querySelectorAll('[data-dsh-cr-btn], [data-dsh-cr-fold]')) {
    btn.remove()
  }
  // 顺带移除空的按钮行容器,避免残留 padding 白边。
  const row = host.querySelector('[data-dsh-cr-row]')
  if (row instanceof HTMLElement && row.querySelector('[data-dsh-cr-btn], [data-dsh-cr-fold]') === null) {
    row.remove()
  }
}

// —— 候选块探测(DOM 来源)——

/** 探测结果:原始内容 + 是否值得加按钮 + 是否还在流式/运行。 */
interface Probe {
  /** 官方原始内容文本(内容签名,用于判断「内容是否变化」)。 */
  text: string
  /** 是否值得加按钮(语言标签是 diff/patch,或文本形似 git diff)。 */
  candidate: boolean
  /** 终端卡片仍在运行(输出未完成)。 */
  running: boolean
}

/**
 * 定位 markdown 代码块的官方原始内容容器(body)。
 *
 * 不能按「第 2 个子节点」取:React 在语法高亮器就绪时会把 body 从
 * `<pre>` 换成高亮 `<div>`,而新节点会 append 到父级末尾(React 只追踪
 * 自己的子节点,我们的按钮是未追踪节点,会被挤到前面)。
 * 因此按结构找:跳过我们的节点(data-dsh-cr-btn),第一个 PRE 即 body;
 * 没有 PRE 时,第一个「非 banner」的 DIV 即高亮 body。
 */
function findCodeBlockBody(el: HTMLElement): HTMLElement | null {
  const first = el.firstElementChild
  for (const child of el.children) {
    if (!(child instanceof HTMLElement)) continue
    if (child.hasAttribute('data-dsh-cr-btn') || child.hasAttribute('data-dsh-cr-fold')) continue
    if (child.tagName === 'PRE') return child
  }
  for (const child of el.children) {
    if (!(child instanceof HTMLElement)) continue
    if (child.hasAttribute('data-dsh-cr-btn') || child.hasAttribute('data-dsh-cr-fold')) continue
    if (child === first) continue // banner
    if (child.tagName === 'DIV') return child
  }
  return null
}

/** 探测 markdown 代码块:结构为 [banner(语言标签+复制按钮), body]。 */
function probeCodeBlock(el: HTMLElement): Probe | null {
  const banner = el.firstElementChild
  const body = findCodeBlockBody(el)
  if (!(banner instanceof HTMLElement) || body === null) return null
  // 语言标签读取适配前端结构变化:
  // - 新前端(0.1.2-alpha+):bannerWrap > banner > infostring,infostring
  //   是纯语言文本,取到最内层元素;
  // - 旧前端(0.1.0-rc.x):banner 直接是第一子节点,语言的文本节点在
  //   banner 的首个子元素里(也许是 span),最内层取不到时退回浅层读取。
  // 注意不能直接取 banner.textContent:新结构里它混着复制按钮文案(diffCopy)。
  let lang = ''
  const innermost = banner.firstElementChild?.firstElementChild
  if (innermost instanceof HTMLElement) {
    lang = innermost.textContent ?? ''
  } else {
    lang = banner.firstElementChild?.textContent ?? ''
  }
  lang = lang.trim().toLowerCase()
  const text = body.textContent ?? ''
  const candidate = lang === 'diff' || lang === 'patch' || isDiffText(text)
  return { text, candidate, running: false }
}

/**
 * 在终端卡片里找输出容器:跳过第 0 个子节点(头部:命令/状态/复制按钮),
 * 第一个内容形似 git diff 的 div 即输出容器(空态/头部都不会形似 diff,
 * 天然排除);我们的按钮带 data-dsh-cr-btn,一并跳过。
 */
function findOutputContainer(wrapper: HTMLElement): HTMLElement | null {
  const children = wrapper.children
  for (let i = 1; i < children.length; i += 1) {
    const child = children[i]
    if (!(child instanceof HTMLElement) || child.tagName !== 'DIV') continue
    if (child.hasAttribute('data-dsh-cr-btn') || child.hasAttribute('data-dsh-cr-fold')) continue
    if (isDiffText(child.textContent ?? '')) return child
  }
  return null
}

/**
 * 输出容器逐行取文本:每行是 div.line(ANSI 已渲染成 span,textContent 即
 * 净化后的纯文本);折叠按钮等非行元素跳过。
 */
function joinOutputLines(container: HTMLElement): string {
  const parts: string[] = []
  for (const child of container.children) {
    if (child instanceof HTMLElement && child.tagName === 'DIV') {
      parts.push(child.textContent ?? '')
    }
  }
  return parts.join('\n')
}

/** 探测终端卡片:运行中直接标记 running,由调用方跳过。 */
function probeTerminal(el: HTMLElement): Probe | null {
  if (el.hasAttribute('data-running')) {
    return { text: '', candidate: false, running: true }
  }
  const output = findOutputContainer(el)
  if (output === null) return null
  const text = joinOutputLines(output)
  return { text, candidate: isDiffText(text), running: false }
}

/** 按元素类型分发探测。 */
function probeFor(el: HTMLElement): Probe | null {
  if (el.classList.contains('md-code-block')) return probeCodeBlock(el)
  if (el.hasAttribute('data-terminal')) {
    // 工具行内的终端卡片:按钮加在行本体上(由数据层注入,折叠时也
    // 可见),这里跳过,避免同一块出现两个按钮。
    if (el.closest('[data-sample="bash"]') !== null) return null
    return probeTerminal(el)
  }
  return null
}

/** 按钮挂载点:代码块 = banner,终端卡片 = header(都是官方第一个子节点)。 */
function buttonHostFor(el: HTMLElement): HTMLElement | null {
  const first = el.firstElementChild
  return first instanceof HTMLElement ? first : null
}

// —— 数据层(折叠的 bash 工具行)——

/**
 * 数据层文本表:node key → { sessionId, diff 文本 }。
 *
 * 折叠的 bash 工具行在 DOM 里只有一行摘要,输出内容随展开才挂载,
 * DOM 探测看不到 —— 只能从 chat 快照(数据层)拿到结果文本。
 */
const pendingTexts = new Map<string, { sessionId: string; text: string }>()

/** chat 快照的最小形状(与 dsh-web-enhance 同口径,只取所需字段)。 */
interface ChatLike {
  order: readonly string[]
  nodes: { get(key: string): { kind: string; data: unknown } | undefined }
}

/** 从 tool-call 节点 data 里取工具结果根(root: RunningToolCall | ToolResultNode)。 */
function readToolRoot(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return null
  return (data as { root?: unknown }).root ?? null
}

/** 工具结果是否已落地(settled ToolResultNode:带 content 数组)。 */
function isSettledToolResult(root: unknown): root is { call: { name: string } | null; content: readonly unknown[] } {
  if (typeof root !== 'object' || root === null) return false
  const r = root as { call?: unknown; content?: unknown }
  if (!Array.isArray(r.content)) return false
  // call 头可能被窗口截断(call: null),保守起见只认得到工具名的。
  if (r.call !== null && (typeof r.call !== 'object' || r.call === null || typeof (r.call as { name?: unknown }).name !== 'string')) {
    return false
  }
  return true
}

/** 拼接工具结果 content 里的文本块(工具输出通常是一段 text 块)。 */
function toolResultText(root: unknown): string {
  if (!isSettledToolResult(root)) return ''
  const parts: string[] = []
  for (const block of root.content) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as { type?: unknown; text?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('\n')
}

/**
 * 把当前会话 chat 快照里「输出形似 git diff 的 bash 工具结果」同步进
 * 文本表:先清掉本会话旧条目(防巨型文本跨会话累积),再写入新条目。
 */
function syncDiffToolTexts(sessionId: string, chat: ChatLike): void {
  const found = new Map<string, string>()
  for (const key of chat.order) {
    const node = chat.nodes.get(key)
    if (node === undefined || node.kind !== 'tool-call') continue
    const root = readToolRoot(node.data)
    if (root === null || !isSettledToolResult(root)) continue
    if (root.call === null || root.call.name !== 'bash') continue
    const text = toolResultText(root)
    if (!isDiffText(text)) continue
    found.set(key, text)
  }
  for (const [key, entry] of pendingTexts) {
    if (entry.sessionId === sessionId && !found.has(key)) pendingTexts.delete(key)
  }
  for (const [key, text] of found) pendingTexts.set(key, { sessionId, text })
}

/** 按 data-chat-anchor-key 找渲染行(遍历比对,避免 key 特殊字符转义问题)。 */
function findRowByKey(key: string): HTMLElement | null {
  for (const el of document.querySelectorAll('[data-chat-anchor-key]')) {
    if (el instanceof HTMLElement && el.getAttribute('data-chat-anchor-key') === key) return el
  }
  return null
}

/** 给数据层收集到的 bash 工具行加按钮(行未渲染时等下一轮扫描)。 */
function attachToolRowButtons(): void {
  for (const [key, entry] of pendingTexts) {
    const row = findRowByKey(key)
    if (row === null) continue
    const sample = row.querySelector('[data-sample="bash"]')
    if (!(sample instanceof HTMLElement)) continue
    ensureButtons(sample, () => pendingTexts.get(key)?.text ?? entry.text, null)
  }
}

// —— 扫描器 ——

/** 一个候选块的跟踪状态(DOM 来源)。 */
interface BlockState {
  /** 上次检测到的内容签名。 */
  text: string
  /** 稳定去抖定时器(null = 没有待处理的加按钮)。 */
  timer: number | null
  /** 上次解析失败的时间戳(重试节流)。 */
  lastTry: number
  /** 上次解析是否失败(失败时内容不变也会按节流重试)。 */
  failed: boolean
  /** 代码块是否折叠原始文本(默认折叠,聊天流保持紧凑)。 */
  folded: boolean
}

/**
 * 全文档扫描器:发现候选块、去抖、注入按钮、内容变化时回退。
 *
 * 状态机(每个块):
 * - 内容变化/新元素 → 排 STABLE_MS 去抖;
 * - 去抖到点且内容未再变 → 解析验证(能解析出文件才加按钮);
 * - 内容不再形似 diff / 结构消失 → 移除按钮。
 */
class DiffScanner {
  private readonly states = new WeakMap<HTMLElement, BlockState>()
  private observer: MutationObserver | null = null
  private scanTimer: number | null = null
  private safetyTimer: number | null = null

  start(): void {
    if (this.observer !== null) return
    // 任何 DOM 增删都触发一次去抖扫描:覆盖流式追加、虚拟化重挂载、
    // 工具行展开等所有出现路径。
    this.observer = new MutationObserver(() => this.scheduleScan())
    this.observer.observe(document.body, { childList: true, subtree: true })
    this.scheduleScan()
    // 兜底周期扫描:内容变化理论上都会产生 childList mutation,
    // 这里兜住遗漏路径,顺带让解析失败的重试有机会触发。
    this.safetyTimer = window.setInterval(() => this.scan(), SAFETY_SCAN_MS)
  }

  stop(): void {
    this.observer?.disconnect()
    this.observer = null
    if (this.scanTimer !== null) {
      clearTimeout(this.scanTimer)
      this.scanTimer = null
    }
    if (this.safetyTimer !== null) {
      clearInterval(this.safetyTimer)
      this.safetyTimer = null
    }
    // states 里的去抖定时器不必逐个清理:到点后 probe 复查会把已断开
    // 元素的文本读成空串、candidate=false,自然放弃;WeakMap 随块 GC。
  }

  /** 合并高频 mutation 为一次扫描。 */
  private scheduleScan(): void {
    if (this.scanTimer !== null) return
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = null
      this.scan()
    }, SCAN_DEBOUNCE)
  }

  /** 全量扫描:数据层工具行按钮 + DOM 候选块。 */
  private scan(): void {
    attachToolRowButtons()
    for (const el of document.querySelectorAll('.md-code-block, [data-terminal]')) {
      this.inspect(el as HTMLElement)
    }
  }

  /** 检查一个候选块:内容未变则不动,变了则排去抖,不再形似 diff 则移除按钮。 */
  private inspect(el: HTMLElement): void {
    const probe = probeFor(el)
    if (probe === null || probe.running || !probe.candidate || probe.text.trim() === '') {
      const host = buttonHostFor(el)
      if (host !== null) removeButtons(host)
      // 恢复官方原始显示(此前可能被折叠)。
      const body = findCodeBlockBody(el)
      if (body !== null) body.style.display = ''
      this.states.delete(el)
      return
    }
    const st = this.states.get(el)
    if (st !== undefined && st.text === probe.text) {
      // 内容未变:按钮已加/去抖中 → 无事;解析失败 → 按节流重试。
      if (!st.failed) {
        // 重新同步折叠态:React 可能在后台替换过 body 节点(语法高亮
        // 就绪时 pre → div),新节点需要重新隐藏/显示。
        this.applyFoldState(el, st)
        return
      }
      if (Date.now() - st.lastTry < RETRY_MS) return
      // 失败重试到点:直接走下方加按钮分支(内容稳定,不必再去抖)。
    }
    if (st !== undefined && st.timer !== null) clearTimeout(st.timer)
    const timer = window.setTimeout(() => {
      const cur = this.states.get(el)
      if (cur === undefined || cur.timer !== timer) return
      cur.timer = null
      // 到点复查:内容又变了(流式还在继续)则放弃本次,等下一轮。
      const p2 = probeFor(el)
      if (p2 === null || p2.running || !p2.candidate || p2.text !== cur.text) return
      this.attachButton(el, cur)
    }, STABLE_MS)
    this.states.set(el, {
      text: probe.text,
      timer,
      lastTry: st?.lastTry ?? 0,
      failed: st?.failed ?? false,
      folded: st?.folded ?? true,
    })
  }

  /** 内容稳定后执行:解析验证、折叠原始文本并注入按钮(失败则保持无按钮)。 */
  private attachButton(el: HTMLElement, st: BlockState): void {
    const host = buttonHostFor(el)
    if (host === null) return
    if (parseGitDiff(st.text).length === 0) {
      st.failed = true
      st.lastTry = Date.now()
      removeButtons(host)
      return
    }
    st.failed = false
    const isCodeBlock = el.classList.contains('md-code-block')
    if (isCodeBlock) {
      // 默认折叠:diff 代码块只留标题行 + 按钮,不摊开整段原始文本。
      this.applyFoldState(el, st)
    }
    // 点击时现读文本(React 重渲染后旧引用可能过期)。
    ensureButtons(
      host,
      () => probeFor(el)?.text ?? st.text,
      isCodeBlock ? { folded: st.folded, onToggle: () => this.toggleFold(el) } : null,
    )
  }

  /** 同步代码块的折叠态(官方 body 只改 display,React 不管理这个 style)。 */
  private applyFoldState(el: HTMLElement, st: BlockState): void {
    if (!el.classList.contains('md-code-block')) return
    const body = findCodeBlockBody(el)
    if (body !== null) body.style.display = st.folded ? 'none' : ''
  }

  /** 展开/收起代码块原始文本,并同步按钮文案。 */
  private toggleFold(el: HTMLElement): void {
    const st = this.states.get(el)
    if (st === undefined) return
    st.folded = !st.folded
    this.applyFoldState(el, st)
    const host = buttonHostFor(el)
    const btn = host?.querySelector('[data-dsh-cr-fold]')
    if (btn instanceof HTMLElement) {
      const texts = CR_TEXTS[detectLang()]
      btn.textContent = st.folded ? texts.expand : texts.collapse
    }
  }
}

// —— 插件主体 ——

/**
 * 需要的 client 服务:slots(slot 注册)、locale(界面语言检测)。
 *
 * cordis 的服务访问必须先在这里声明注入,否则 apply 里读 ctx.locale
 * 会抛 "cannot get property 'locale' without inject" —— loader entry
 * 应用失败会让整个客户端组合树崩溃(白屏)。这也是上次事故的根因。
 * 官方装配含 dsh-client-locale,服务存在;万一未来缺失,inject 返回
 * undefined,detectLang 里会退到浏览器语言,不会崩。
 */
export const inject = ['slots', 'locale']

/** Client 插件 body:接管官方 locale 服务,注册扫描器宿主与数据层监听。 */
export function apply(ctx: ClientContext): void {
  // 接管官方 locale 服务(运行时形状校验;缺省时 detectLang 退浏览器语言)。
  const locale = ctx.locale
  if (typeof locale === 'object' && locale !== null && typeof (locale as { getLocale?: unknown }).getLocale === 'function') {
    localeService = locale as LocaleService
  }
  ctx.slots.inject(
    'shell.overlay',
    () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'code-review-enhancer',
    }, CodeReviewEnhancer),
  )
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'code-review-tool-watcher',
      // 官方条目:agent-preset=-10、subagent-catalog=10、job-list=20,
      // web-enhance=15。取 25 排在最后,不与他人并列。
      order: 25,
    }, DiffToolButtonWatcher),
  )
}

/**
 * 扫描器宿主组件(root 作用域,全局只此一份):挂载时注入样式、启动
 * 全文档扫描、监听审查页的评论回传消息,卸载时全部清理。
 * 自身渲染 null,不占任何界面空间。
 */
function CodeReviewEnhancer() {
  useEffect(() => {
    ensureStyle()
    const scanner = new DiffScanner()
    scanner.start()
    const onMessage = handleReviewMessage
    window.addEventListener('message', onMessage)
    return () => {
      scanner.stop()
      window.removeEventListener('message', onMessage)
    }
  }, [])
  return null
}

/**
 * 会话标准 props 的最小形状(conversation.session.header.actions 内容条目
 * 运行时实际收到的字段;新旧前端都包含,只声明所需部分)。
 *
 * 关键差异(0.1.2-alpha.4 前端重构):
 * - 旧前端(0.1.0-rc.x):chat 快照挂在会话快照的 `chat` 字段,
 *   用 useSession((s) => s.chat) 读取;
 * - 新前端:会话快照不再有 chat 字段,聊天快照改由 dsh-client-ui-chat
 *   通过 uiSession.provide({ hooks: ["chat"] }) 注册成会话标准 hook
 *   useChat(形状仍是 { order, nodes, locations, timeline, ... },与
 *   ChatLike 兼容)。useChat 缺失时(如 chat 插件不在组合内)退回旧路径。
 */
interface HeaderActionsProps {
  sessionId: string
  useSession<T>(selector: (snapshot: { chat?: ChatLike }) => T): T
  useChat?: <T>(selector: (snapshot: ChatLike) => T) => T
  inputActions?: { setDraft(text: string): void }
}

/**
 * 数据层监听(session 作用域,随会话切换自动重订阅):
 * 1. 订阅当前会话 chat 快照,把输出形似 git diff 的 bash 工具结果同步
 *    进文本表,扫描器据此给折叠的工具行加按钮;
 * 2. 注册当前会话的 composer 写入器 —— 审查页回传的评论经
 *    inputActions.setDraft(官方单一写入口)写入对话框。自身渲染 null。
 */
function DiffToolButtonWatcher({ useSession, useChat, sessionId, inputActions }: HeaderActionsProps) {
  // chat 快照读取:新前端走会话标准 hook useChat;旧前端退回
  // useSession((s) => s.chat)。选哪条分支由运行时环境决定,同一环境内
  // 每次渲染恒定走同一分支,不违反 React hook 顺序规则。
  const chat = useChat !== undefined
    ? useChat((state) => state)
    : useSession((state) => state.chat)
  useEffect(() => {
    if (chat !== undefined) syncDiffToolTexts(String(sessionId), chat)
  }, [chat, sessionId])
  useEffect(() => {
    // 只清理自己注册的写入器(多组件实例并存时互不误删)。
    const writer = (text: string): void => inputActions?.setDraft(text)
    composerWriter = writer
    return () => {
      if (composerWriter === writer) composerWriter = null
    }
  }, [inputActions])
  return null
}
