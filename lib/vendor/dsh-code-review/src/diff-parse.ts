/**
 * unified diff 文本解析器(纯逻辑,不依赖 DOM,可在 Node 里单测)。
 *
 * 输入是 `git diff` / `git show` / `git diff --no-index` 等产生的
 * unified diff 文本,输出按文件拆分的结构化数据,供双列视图渲染。
 *
 * 行模型说明:
 * - ctx  上下文行:旧/新两侧都有,行号各自递增;
 * - del  删除行:只在旧侧;
 * - add  新增行:只在新侧;
 * - change 变更对:连续「-」块后紧跟连续「+」块时,两两配对成同一行
 *   (GitHub split view 的对齐方式),旧行号取 - 行、新行号取 + 行,
 *   两侧数量不等时,多出的行退化为单侧 del/add;
 * - gap  间隙行:@@ hunk 头,或折叠后的「⋯ 展开」占位(渲染层用),
 *   不占行号。
 *
 * 实现注意:不把「当前文件」存成被闭包捕获赋值的局部变量 ——
 * TypeScript 对「闭包内赋值的 let」会做保守控制流分析,外层窄化会失效
 * (甚至窄化成 never);统一用 current() 从 files 栈顶取,避免踩坑。
 */

/** 双列视图里的一行。 */
export interface DiffRow {
  kind: 'ctx' | 'del' | 'add' | 'change' | 'gap'
  /** 旧侧行号(ctx/del/change 有值)。 */
  oldNo?: number
  /** 新侧行号(ctx/add/change 有值)。 */
  newNo?: number
  /** 旧侧文本(已去掉行首的 - / 空格前缀)。 */
  oldText?: string
  /** 新侧文本(已去掉行首的 + / 空格前缀)。 */
  newText?: string
  /** gap 行的显示文本(@@ 头原文)。 */
  gapText?: string
  /** 旧侧该行是文件最后一行且末尾无换行符(\ No newline 标记)。 */
  oldNoEol?: boolean
  /** 新侧该行是文件最后一行且末尾无换行符。 */
  newNoEol?: boolean
}

/** 一个文件的变更。 */
export interface FileDiff {
  /** 变更前路径(原始文本,可能带 a/ 前缀;/dev/null 表示新建)。 */
  oldPath: string
  /** 变更后路径(原始文本,可能带 b/ 前缀;/dev/null 表示删除)。 */
  newPath: string
  /** 变更类型。 */
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'binary' | 'mode'
  /** 文件级元信息行(new file mode / rename from / similarity index 等)。 */
  meta: string[]
  /** 渲染行序列(含 hunk 间隙行)。 */
  rows: DiffRow[]
}

/** 展示用的路径:去掉 a/ b/ 前缀(仅当确实带前缀时)。 */
export function displayPath(path: string): string {
  if (path === '/dev/null') return path
  return path.replace(/^[ab]\//, '')
}

/** 文本是否形似 git diff(检测用,先于完整解析)。 */
export function isDiffText(text: string): boolean {
  const lines = text.split('\n')
  // git 标准头;没有它时,退而要求「hunk 头 + 文件标记」同时出现,
  // 避免把普通带 @@ 的文本误判成 diff。
  if (lines.some((line) => line.startsWith('diff --git '))) return true
  const hasHunk = lines.some((line) => /^@@ -\d+/.test(line))
  const hasFileMark = lines.some((line) => /^(---|\+\+\+) \S/.test(line))
  return hasHunk && hasFileMark
}

/** 解析整段 unified diff 文本。 */
export function parseGitDiff(text: string): FileDiff[] {
  const lines = text.split(/\r?\n/)
  const files: FileDiff[] = []
  // 当前是否处于某个 hunk 的正文区(路径行 ---/+++ 只在 hunk 外出现)。
  let inHunk = false
  // 当前 hunk 的旧/新行号游标(从 hunk 头声明的起点开始递增)。
  let oldNo = 0
  let newNo = 0
  // 等待配对的删除行:连续「-」块会先缓存,遇到「+」时逐对配对成
  // change 行;hunk 结束或遇到上下文行时,剩余缓存按 del 行输出。
  // noEol 标记可能紧跟「-」行出现(\ No newline at end of file),
  // 所以要缓存进待配对条目,配对时才能带到 change 行的旧侧。
  let pendingDels: Array<{ text: string; no: number; noEol: boolean }> = []
  // 最近一条内容行(非 gap)的类型,用于把 \ No newline 标记挂到正确的一侧。
  let lastKind: 'ctx' | 'del' | 'add' | null = null
  // 最近一条已输出(或已配对)的、带新侧的行,用于给新侧挂 noEol。
  let lastNewRow: DiffRow | null = null

  /** 当前正在累积的文件(栈顶);还没有 diff 头时为 null。 */
  function current(): FileDiff | null {
    return files.length > 0 ? files[files.length - 1] : null
  }

  /** 把待配对缓存按 del 行刷出(遇上下文、新 hunk、文件切换、文本结束时调用)。 */
  function flushPending(): void {
    const file = current()
    if (file === null || pendingDels.length === 0) return
    for (const del of pendingDels) {
      file.rows.push({
        kind: 'del',
        oldNo: del.no,
        oldText: del.text,
        oldNoEol: del.noEol,
      })
      lastNewRow = null
    }
    pendingDels = []
  }

  /** 新建文件并接管游标(自动刷出上一个文件的待配对缓存)。 */
  function startFile(oldPath: string, newPath: string): void {
    flushPending()
    inHunk = false
    lastKind = null
    lastNewRow = null
    files.push({
      oldPath,
      newPath,
      status: 'modified',
      meta: [],
      rows: [],
    })
  }

  /** 解析 @@ hunk 头,返回是否成功(失败行原样当正文处理)。 */
  function openHunk(line: string): boolean {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line)
    if (match === null) return false
    flushPending()
    oldNo = Number(match[1])
    newNo = Number(match[3])
    inHunk = true
    lastKind = null
    lastNewRow = null
    // 保留整个 hunk 头原文(含尾部 section 名),渲染成间隙行。
    current()?.rows.push({ kind: 'gap', gapText: line })
    return true
  }

  /** 输出一条 ctx 行(带两侧行号与文本)。 */
  function emitContext(text: string): void {
    const file = current()
    if (file === null) return
    const row: DiffRow = { kind: 'ctx', oldNo, newNo, oldText: text, newText: text }
    file.rows.push(row)
    oldNo += 1
    newNo += 1
    lastKind = 'ctx'
    lastNewRow = row
  }

  /** 输出一条 change 行(旧侧 del 与 新侧 add 配对)。 */
  function emitChange(del: { text: string; no: number; noEol: boolean }, addText: string): void {
    const file = current()
    if (file === null) return
    const row: DiffRow = {
      kind: 'change',
      oldNo: del.no,
      newNo,
      oldText: del.text,
      newText: addText,
      oldNoEol: del.noEol,
    }
    file.rows.push(row)
    newNo += 1
    lastKind = 'add'
    lastNewRow = row
  }

  /** 输出一条 add 行。 */
  function emitAdd(text: string): void {
    const file = current()
    if (file === null) return
    const row: DiffRow = { kind: 'add', newNo, newText: text }
    file.rows.push(row)
    newNo += 1
    lastKind = 'add'
    lastNewRow = row
  }

  /** 处理 \ No newline at end of file 标记:挂到上一行对应的一侧。 */
  function markNoEol(): void {
    if (lastKind === 'del') {
      // 上一个「-」可能还在待配对缓存里(还没遇到配对/刷出)。
      const last = pendingDels[pendingDels.length - 1]
      if (last !== undefined) {
        last.noEol = true
      } else {
        const file = current()
        if (file !== null && file.rows.length > 0) {
          // 已被刷成 del 行:标记旧侧。
          const row = file.rows[file.rows.length - 1]
          if (row.kind === 'del') row.oldNoEol = true
        }
      }
    } else if (lastKind === 'add') {
      // 上一行是 change 或 add:标记新侧。
      if (lastNewRow !== null) lastNewRow.newNoEol = true
    } else if (lastKind === 'ctx') {
      const file = current()
      if (file !== null && file.rows.length > 0) {
        const row = file.rows[file.rows.length - 1]
        if (row.kind === 'ctx') {
          row.oldNoEol = true
          row.newNoEol = true
        }
      }
    }
  }

  for (const line of lines) {
    // 空行:文本末尾换行符的拆分产物(unified diff 的内容行都带前缀
    // 字符,真正的空内容行是 " " 而不是 ""),直接跳过。
    if (line === '') continue
    if (line.startsWith('diff --git ')) {
      // 新文件头:尝试从 a/X b/Y 提取路径,提取失败也不阻塞解析。
      const match = /^diff --git (?:a\/)?(\S+) (?:b\/)?(\S+)$/.exec(line)
      startFile(match?.[1] ?? '', match?.[2] ?? '')
      continue
    }
    if (line.startsWith('@@ ')) {
      openHunk(line)
      continue
    }
    const cur = current()
    if (cur === null) {
      // diff 头之前的前导内容(提交信息等)跳过;裸 patch(无 diff --git
      // 头,如 git diff --no-index 的合并格式)以 --- 行直接开文件。
      if (line.startsWith('--- ') && line.length > 4) startFile(line.slice(4), '')
      continue
    }
    if (!inHunk) {
      // —— hunk 外的元信息行 ——
      if (line.startsWith('--- ') && line.length > 4) {
        cur.oldPath = line.slice(4)
      } else if (line.startsWith('+++ ') && line.length > 4) {
        cur.newPath = line.slice(4)
      } else if (line.startsWith('new file mode ')) {
        cur.status = 'added'
        cur.meta.push(line)
      } else if (line.startsWith('deleted file mode ')) {
        cur.status = 'deleted'
        cur.meta.push(line)
      } else if (line.startsWith('rename from ') || line.startsWith('rename to ')) {
        cur.status = 'renamed'
        cur.meta.push(line)
      } else if (
        line.startsWith('old mode ') ||
        line.startsWith('new mode ') ||
        line.startsWith('similarity index ') ||
        line.startsWith('dissimilarity index ') ||
        line.startsWith('copy from ') ||
        line.startsWith('copy to ')
      ) {
        cur.meta.push(line)
      } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
        // 二进制文件:没有 hunk,渲染成信息行。
        cur.status = 'binary'
        cur.meta.push(line)
      } else if (line.startsWith('index ')) {
        // index 行(blob 哈希)信息量低,收进 meta 但渲染层选择忽略。
        cur.meta.push(line)
      }
      // 其他(空行等)忽略。
      continue
    }
    // —— hunk 正文 ——
    const kind = line[0]
    const body = line.slice(1)
    if (kind === ' ') {
      flushPending()
      emitContext(body)
    } else if (kind === '-') {
      pendingDels.push({ text: body, no: oldNo, noEol: false })
      oldNo += 1
      lastKind = 'del'
    } else if (kind === '+') {
      const del = pendingDels.shift()
      if (del !== undefined) {
        emitChange(del, body)
      } else {
        emitAdd(body)
      }
    } else if (kind === '\\' && line.startsWith('\\ No newline at end of file')) {
      markNoEol()
    } else {
      // 无法识别的行(畸形 diff):按上下文宽容处理,保证视图不错位。
      flushPending()
      emitContext(line)
    }
  }
  flushPending()
  return files
}

/**
 * 统计整个解析结果:新增行数 / 删除行数(change 行两侧各计一次)。
 * 供工具栏「+N −M · F 个文件」使用。
 */
export function countStats(files: FileDiff[]): { added: number; removed: number; files: number } {
  let added = 0
  let removed = 0
  for (const file of files) {
    for (const row of file.rows) {
      if (row.kind === 'add' || row.kind === 'change') added += 1
      if (row.kind === 'del' || row.kind === 'change') removed += 1
    }
  }
  return { added, removed, files: files.length }
}
