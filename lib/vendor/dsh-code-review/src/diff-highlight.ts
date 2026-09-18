/**
 * 代码高亮的纯逻辑(不依赖 DOM,可在 Node 里单测)。
 *
 * 一、基础语法高亮:轻量单行 tokenizer(不引入高亮库,独立页零依赖),
 * 切出 关键字/字符串/注释/数字 四类 token,渲染层映射成官方
 * --shiki-token-* 颜色(与 DSH 深浅主题一致)。
 * 支持注释风格:双斜杠、斜杠星号(行内)、井号(Python/shell 系,
 * 按扩展名开启)。块注释不跨行(基础版取舍,单行渲染场景影响很小)。
 *
 * 二、行内字符级 diff:对 change 行(同一行旧/新配对)做公共前缀/后缀
 * 剥离,中间不同的字符段就是「只改了几个字符」的精确范围,渲染层用
 * 加深背景色高亮。索引按 code point(Array.from)计算,渲染层同样按
 * code point 切片,代理对不会从中间断开。
 */

/** 语法 token(纯文本切分,HTML 转义由渲染层做)。 */
export interface Token {
  text: string
  /** null = 普通文本;其余为语法类别,映射到 .tok-* 样式。 */
  cls: 'tok-kw' | 'tok-str' | 'tok-com' | 'tok-num' | null
}

/** 行内差异的中段范围(code point 索引,前闭后开;null = 无差异)。 */
export interface DiffMidRange {
  oldStart: number
  oldEnd: number
  newStart: number
  newEnd: number
}

/** 单行高亮配置:是否支持 # 注释(Python/shell/YAML 等)。 */
export interface LineLang {
  hashComment: boolean
}

/**
 * 合并常见语言的关键字表(基础高亮不按语言细分,一套通用词表覆盖
 * JS/TS、Python、Go、Rust、Java/C 系的绝大多数关键字)。
 */
const KEYWORDS = new Set([
  // JS/TS
  'const', 'let', 'var', 'function', 'class', 'extends', 'super', 'new', 'delete',
  'typeof', 'instanceof', 'in', 'of', 'this', 'static', 'get', 'set', 'async',
  'await', 'yield', 'return', 'if', 'else', 'switch', 'case', 'default', 'break',
  'continue', 'try', 'catch', 'finally', 'throw', 'for', 'while', 'do', 'import',
  'export', 'from', 'as', 'interface', 'type', 'enum', 'namespace', 'module',
  'implements', 'public', 'private', 'protected', 'readonly', 'abstract',
  'declare', 'keyof', 'infer', 'never', 'unknown', 'any', 'void', 'null',
  'undefined', 'true', 'false', 'NaN', 'Infinity', 'require',
  // Python
  'def', 'lambda', 'pass', 'raise', 'elif', 'not', 'and', 'or', 'is', 'None',
  'True', 'False', 'print', 'with', 'global', 'nonlocal', 'assert', 'del',
  // Go
  'go', 'func', 'package', 'struct', 'map', 'chan', 'select', 'defer', 'range',
  'nil', 'goto', 'fallthrough',
  // Rust
  'fn', 'let', 'mut', 'pub', 'impl', 'trait', 'match', 'use', 'mod', 'self',
  'crate', 'unsafe', 'where', 'loop', 'move', 'ref', 'dyn',
  // Java / C 系
  'int', 'float', 'double', 'char', 'boolean', 'byte', 'short', 'long', 'signed',
  'unsigned', 'auto', 'register', 'extern', 'volatile', 'constexpr', 'sizeof',
  'template', 'typename',
])

/** 做语法高亮的扩展名集合(其余扩展名不做语法高亮,只做字符级 diff)。 */
const HIGHLIGHT_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'py', 'rb', 'go', 'rs',
  'java', 'c', 'h', 'cpp', 'cc', 'cs', 'css', 'scss', 'less', 'html', 'htm',
  'vue', 'xml', 'sql', 'md', 'yml', 'yaml', 'toml', 'sh', 'bash', 'zsh', 'ini',
])

/** # 注释语言的扩展名(Python/shell/YAML 系;JS 的 # 是私有字段,不开)。 */
const HASH_COMMENT_EXTS = new Set(['py', 'rb', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'toml', 'ini'])

/** 按文件路径推断高亮配置;无法识别时返回 null(只做字符级 diff)。 */
export function langFor(path: string): LineLang | null {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : ''
  if (ext === '' || !HIGHLIGHT_EXTS.has(ext)) return null
  return { hashComment: HASH_COMMENT_EXTS.has(ext) }
}

/** 是否标识符起始字符。 */
function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch)
}

/** 是否标识符后续字符。 */
function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch)
}

/** 是否数字起始字符。 */
function isDigitStart(ch: string): boolean {
  return /[0-9]/.test(ch)
}

/** 是否数字后续字符(含十六进制/二进制前缀与小数点)。 */
function isDigitPart(ch: string): boolean {
  return /[0-9a-fA-FxXbBoO._]/.test(ch)
}

/**
 * 单行 tokenize:按 字符串 → 注释 → 数字 → 标识符 的顺序扫描,
 * 其余字符归入普通文本。行内 token 状态不跨行(基础版取舍)。
 */
export function tokenizeLine(text: string, lang: LineLang): Token[] {
  const tokens: Token[] = []
  let plain = ''
  const flushPlain = (): void => {
    if (plain !== '') {
      tokens.push({ text: plain, cls: null })
      plain = ''
    }
  }
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    // 字符串:三种引号,反斜杠转义跳两格;行尾未闭合则到行尾。
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2
          continue
        }
        if (text[j] === ch) break
        j += 1
      }
      flushPlain()
      tokens.push({ text: text.slice(i, Math.min(j + 1, text.length)), cls: 'tok-str' })
      i = Math.min(j + 1, text.length)
      continue
    }
    // 行注释 // 或 /* */(行内;未闭合到行尾)
    if (ch === '/' && text[i + 1] === '/') {
      flushPlain()
      tokens.push({ text: text.slice(i), cls: 'tok-com' })
      break
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      const end = close === -1 ? text.length : close + 2
      flushPlain()
      tokens.push({ text: text.slice(i, end), cls: 'tok-com' })
      i = end
      continue
    }
    if (lang.hashComment && ch === '#') {
      flushPlain()
      tokens.push({ text: text.slice(i), cls: 'tok-com' })
      break
    }
    // 数字(前缀字母/小数点/下划线都算数字片段)
    if (isDigitStart(ch)) {
      let j = i + 1
      while (j < text.length && isDigitPart(text[j])) j += 1
      flushPlain()
      tokens.push({ text: text.slice(i, j), cls: 'tok-num' })
      i = j
      continue
    }
    // 标识符 → 命中关键字表则标 tok-kw
    if (isIdentStart(ch)) {
      let j = i + 1
      while (j < text.length && isIdentPart(text[j])) j += 1
      const word = text.slice(i, j)
      flushPlain()
      tokens.push({ text: word, cls: KEYWORDS.has(word) ? 'tok-kw' : null })
      i = j
      continue
    }
    plain += ch
    i += 1
  }
  flushPlain()
  return tokens
}

/**
 * 行内字符级差异范围:公共前缀/后缀剥离,中间剩余部分即差异段。
 * 覆盖「一行只改几个字符」的精确高亮;整行重写时中间段接近整行,
 * 效果与整行高亮一致(可接受)。相同文本返回 null。
 */
export function diffMidRange(oldText: string, newText: string): DiffMidRange | null {
  const a = Array.from(oldText)
  const b = Array.from(newText)
  // 公共前缀
  let pre = 0
  const minLen = Math.min(a.length, b.length)
  while (pre < minLen && a[pre] === b[pre]) pre += 1
  // 公共后缀(不回退进前缀区)
  let oldEnd = a.length
  let newEnd = b.length
  while (oldEnd > pre && newEnd > pre && a[oldEnd - 1] === b[newEnd - 1]) {
    oldEnd -= 1
    newEnd -= 1
  }
  if (pre === a.length && pre === b.length) return null
  return { oldStart: pre, oldEnd, newStart: pre, newEnd }
}
