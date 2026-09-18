// Yan Agent adapter glue for the vendored dsh-code-review pipeline.
//
// This file contains NO UI. It re-exports the verbatim upstream pure modules
// (diff-parse / diff-view / diff-highlight) and adds Yan's pure data-side
// adapters: review-summary → unified diff text reconstruction, and the two
// documented opener→parent compatibility patches that let the upstream page
// run inside an iframe (upstream targets window.opener for comment posts).
// All review markup, styles, and interaction strings keep coming from the
// untouched upstream sources; see ../VENDOR.md for provenance.

import * as diffParse from './diff-parse'
import * as diffView from './diff-view'

// —— 上游消息协议常量（见上游 index.tsx handleReviewMessage / diff-view.ts send）——

export const REVIEW_MESSAGE_TYPE = 'dsh-code-review-comments'
export const REVIEW_ACK_TYPE = 'dsh-code-review-ack'

// Upstream index.tsx THEME_VAR_DEFAULTS key list (single source of truth is
// the vendored index.tsx). Values are provisioned by dsh-review.css on Yan
// theme tokens and read at page-build time.
export const THEME_VARS = [
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
]

// iframe 嵌入兼容补丁:上游评论回传/回执校验只认 window.opener(弹窗场景)。
// 嵌进侧边栏时 opener 为 null,回退 window.parent;页面 UI 与其余行为不变,
// 上游源码保持逐字原样,补丁仅作用于生成的 HTML 字符串(见 applyEmbeddingCompat)。
export const OPENER_COMPAT_PATCHES = [
  {
    from: 'var target = window.opener',
    to: 'var target = window.opener || (window.parent !== window ? window.parent : null)'
  },
  {
    from: 'if (event.source !== window.opener) return',
    to: 'if (event.source !== (window.opener || window.parent)) return'
  }
] as const

// The IIFE build drops ESM exports, so expose the API explicitly for both the
// renderer (window) and Node tests (globalThis).  Keep this object below the
// theme/compat constants so the browser bundle receives their initialized
// values rather than an early `undefined` snapshot.
const DshCodeReviewCore = Object.freeze({
  ...diffParse,
  ...diffView,
  THEME_VARS,
  rawDiffFromSummary,
  sanitizeComments,
  applyEmbeddingCompat,
  OPENER_COMPAT_PATCHES
})
;(globalThis as Record<string, unknown>).DshCodeReviewCore = DshCodeReviewCore

export default DshCodeReviewCore

/** 应用 iframe 嵌入兼容补丁;每个补丁必须恰好命中一次才算应用成功。 */
export function applyEmbeddingCompat(html: string): { html: string; applied: boolean[] } {
  let patched = html
  const applied: boolean[] = []
  for (const patch of OPENER_COMPAT_PATCHES) {
    const count = patched.split(patch.from).length - 1
    if (count === 1) {
      patched = patched.replace(patch.from, patch.to)
      applied.push(true)
    } else {
      applied.push(false)
    }
  }
  return { html: patched, applied }
}

/** 校验上游页面回传的评论形状(跨文档数据不可信,规则同上游 sanitizeComments)。 */
export function sanitizeComments(raw: unknown): Array<{ path: string; lineNo: number; side?: string; text: string }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ path: string; lineNo: number; side?: string; text: string }> = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as { path?: unknown; lineNo?: unknown; side?: unknown; text?: unknown }
    if (typeof record.path !== 'string' || typeof record.lineNo !== 'number' || typeof record.text !== 'string') continue
    if (record.text.trim() === '') continue
    out.push({
      path: record.path,
      lineNo: Math.trunc(record.lineNo),
      side: typeof record.side === 'string' ? record.side : undefined,
      text: record.text
    })
  }
  return out
}

function relativePath(value: unknown): string {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
}

/**
 * 上游解析器要求内容行位于 @@ hunk 区内;把 Yan 行模型(diff.rows)重组为
 * 连续 hunk。skip/gap 行视为 hunk 边界(被省略的行不参与行号连续性)。
 */
function rowsToPatch(file: { diff?: { rows?: Array<Record<string, unknown>> } }): string {
  const rows = Array.isArray(file?.diff?.rows) ? file.diff.rows : []
  const lines: string[] = []
  let hunk: { oldStart: number; newStart: number; oldCount: number; newCount: number; lines: string[] } | null = null
  const flush = () => {
    if (hunk === null) return
    lines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`)
    for (const line of hunk.lines) lines.push(line)
    hunk = null
  }
  for (const row of rows) {
    const type = String(row?.type ?? row?.kind ?? '')
    if (type === 'skip' || type === 'truncate' || type === 'gap') {
      flush()
      continue
    }
    const hasOld = row?.oldLine != null
    const hasNew = row?.newLine != null
    if (!hasOld && !hasNew) {
      flush()
      continue
    }
    if (hunk === null) {
      hunk = {
        oldStart: Math.max(1, Number(row?.oldLine) || 0),
        newStart: Math.max(1, Number(row?.newLine) || 0),
        oldCount: 0,
        newCount: 0,
        lines: []
      }
    }
    if (type === 'add') {
      hunk.lines.push(`+${String(row?.text ?? row?.newText ?? '')}`)
      hunk.newCount += 1
    } else if (type === 'del' || type === 'remove') {
      hunk.lines.push(`-${String(row?.text ?? row?.oldText ?? '')}`)
      hunk.oldCount += 1
    } else if (type === 'change') {
      hunk.lines.push(`-${String(row?.oldText ?? '')}`, `+${String(row?.newText ?? '')}`)
      hunk.oldCount += 1
      hunk.newCount += 1
    } else {
      const text = String(row?.text ?? row?.oldText ?? row?.newText ?? '')
      hunk.lines.push(` ${text}`)
      hunk.oldCount += 1
      hunk.newCount += 1
    }
  }
  flush()
  return lines.join('\n')
}

/**
 * Yan 审阅 summary → 上游 parseGitDiff 可解析的 unified diff 文本。
 * 有真实 patch 文本就用它;否则从行模型重建;二进制/重命名补 git 头元信息,
 * 让上游渲染出对应状态徽标。每文件都补 diff --git 头:上游解析器在缺少
 * 该头的裸 patch 下会把第二个文件的 --- 行当作第一个文件的路径覆盖。
 */
export function rawDiffFromSummary(summary: { files?: Array<Record<string, unknown>> }): string {
  const files = Array.isArray(summary?.files) ? summary.files : []
  const chunks: string[] = []
  for (const file of files) {
    const filePath = relativePath(file?.path ?? file?.newPath ?? file?.oldPath)
    if (!filePath) continue
    const status = String(file?.status ?? 'modified')
    const header: string[] = [`diff --git a/${filePath} b/${filePath}`]
    if (status === 'added') header.push('new file mode 100644')
    if (status === 'deleted') header.push('deleted file mode 100644')
    if (status === 'renamed') {
      header.push(`rename from ${relativePath(file?.oldPath) || filePath}`)
      header.push(`rename to ${relativePath(file?.newPath) || filePath}`)
    }
    if (file?.binary === true) header.push(`Binary files a/${filePath} and b/${filePath} differ`)
    const patch = typeof file?.patch === 'string' && file.patch.trim() !== ''
      ? file.patch.trimEnd()
      : ''
    if (patch.startsWith('diff --git ')) {
      // patch 自带完整 git 头(git-service 审阅的真实形态):原样输出,
      // 仅当 summary 状态与 patch 元信息不一致时补状态行,让上游徽标正确。
      const patchLines = patch.split('\n')
      const extras: string[] = []
      const hasLine = (prefix: string) => patchLines.some(line => line.startsWith(prefix))
      if (status === 'added' && !hasLine('new file mode')) extras.push('new file mode 100644')
      if (status === 'deleted' && !hasLine('deleted file mode')) extras.push('deleted file mode 100644')
      if (status === 'renamed' && !hasLine('rename from ')) {
        extras.push(`rename from ${relativePath(file?.oldPath) || filePath}`, `rename to ${relativePath(file?.newPath) || filePath}`)
      }
      patchLines.splice(1, 0, ...extras)
      chunks.push(patchLines.join('\n'))
      continue
    }
    const body = patch || rowsToPatch(file as { diff?: { rows?: Array<Record<string, unknown>> } })
    if (body) header.push(body)
    chunks.push(header.join('\n'))
  }
  return chunks.join('\n')
}
