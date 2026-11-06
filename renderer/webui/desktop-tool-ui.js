// Generated desktop tool names and icons.
(() => {
const TOOL_UI = {
  yan_runtime_log: {"label":"我正在读取运行时日志","icon":"file-cog","error":"读取时遇到了错误","workRow":true},
  list_page_assets: {"label":"我正在查阅网页资源列表","icon":"cloud-check","error":"出错","workRow":true},
  create_plugin: {"label":"我正在创建新插件","icon":"puzzle","error":"创建创建时出错","workRow":true},
  fire_confetti: {"label":"我正在请求放礼炮","icon":"party-popper","error":"请求时遇到错误","workRow":true},
  plugins_list: { label: '查找插件', icon: 'square-more-horizontal' },
  plugins_inspect: { label: '查看插件', icon: 'file-text' },
  plugins_activate: { label: '激活插件', icon: 'square-more-horizontal' },
  plugins_read_resource: { label: '读取插件资源', icon: 'file-text' },
  plugins_deactivate: { label: '停用会话插件', icon: 'square-more-horizontal' },
  read: { label: '读取了文件', icon: 'file-text' },
  read_file: { label: '读取了文件', icon: 'file-text' },
  read_file_range: { label: '读取了文件', icon: 'file-text' },
  glob: { label: '匹配文件', icon: 'file-arrow-left' },
  list_directory: { label: '列出目录', icon: 'file-arrow-left' },
  grep: { label: '搜索内容', icon: 'file-arrow-up' },
  search_files: { label: '搜索代码', icon: 'file-arrow-up' },
  write: { label: '已新建文件', icon: 'file-plus' },
  write_file: { label: '已新建文件', icon: 'file-plus' },
  edit: { label: '编辑文件', icon: 'circle-pen' },
  edit_file: { label: '编辑文件', icon: 'circle-pen' },
  apply_patch: { label: '应用了文件补丁', icon: 'pen-line' },
  patch: { label: '应用了文件补丁', icon: 'pen-line' },
  bash: { label: '执行命令', icon: 'square-terminal' },
  shell: { label: '执行命令', icon: 'square-terminal' },
  command: { label: '执行命令', icon: 'square-terminal' },
  run_command: { label: '执行命令', icon: 'square-terminal' },
  execute_command: { label: '执行命令', icon: 'square-terminal' },
  execute_shell: { label: '执行命令', icon: 'square-terminal' },
  powershell: { label: '执行命令', icon: 'square-terminal' },
  pwsh: { label: '执行命令', icon: 'square-terminal' },
  cmd: { label: '执行命令', icon: 'square-terminal' },
  webfetch: { label: '获取网页', icon: 'globe-plus' },
  web_fetch: { label: '获取网页', icon: 'globe-plus' },
  websearch: { label: '搜索网页', icon: 'globe' },
  web_search: { label: '搜索网页', icon: 'globe' },
  fetch: { label: '读取网页', icon: 'globe-plus' },
  download_file: { label: '下载资源到工作区', icon: 'download' },
  question: { label: '向用户提问', icon: 'message-plus' },
  todowrite: { label: '更新计划', icon: 'circle-more-horizontal' },
  todo_write: { label: '更新计划', icon: 'circle-more-horizontal' },
  task: { label: 'Sub Agent', icon: 'square-more-horizontal' },
  find_skills: { label: '查找 Skill', icon: 'eye' },
  install_skill: { label: '安装 Skill', icon: 'download' },
  read_skill: { label: '参考了技能', icon: 'book-check' },
  read_skill_resource: { label: '参考了技能', icon: 'book-check' },
  read_skill_resources: { label: '参考了技能', icon: 'book-check' },
  remove_skill: { label: '删除 Skill', icon: 'bin' },
  read_image: { label: '读取图片', icon: 'image-check' },
  generate_image: { label: '生成图片', icon: 'image-plus' },
  generate_video: { label: '生成视频', icon: 'list-video' },
  create_handoff: { label: '创建工作区交接', icon: 'folder-arrow-left' },
  read_source_context: { label: '读取来源上下文', icon: 'folder-arrow-up' },
  change_workspace: { label: '切换工作区', icon: 'folder-arrow-left' },
  open_builtin_browser: { category: 'yan-browser' },
  browser_observe: { category: 'yan-browser' },
  browser_fill: { category: 'yan-browser' },
  browser_snapshot: { category: 'yan-browser' },
  browser_read_page: { category: 'yan-browser' },
  browser_click: { category: 'yan-browser' },
  browser_type: { category: 'yan-browser' },
  browser_press: { category: 'yan-browser' },
  browser_scroll: { category: 'yan-browser' },
  browser_wait: { category: 'yan-browser' },
  browser_screenshot: { category: 'yan-browser' },
  browser_history: { category: 'yan-browser' },
  browser_status: { category: 'yan-browser' },
  browser_inspect_page: { category: 'yan-browser' },
  browser_apply_annotation: { category: 'yan-browser' },
  browser_select: { category: 'yan-browser' },
  browser_check: { category: 'yan-browser' },
  browser_hover: { category: 'yan-browser' },
  browser_focus: { category: 'yan-browser' },
  browser_drag: { category: 'yan-browser' },
  search_symbols: { category: 'serena' },
  get_file_outline: { category: 'serena' },
  get_file_imports: { category: 'serena' },
  find_symbol: { category: 'serena' },
  find_references: { category: 'serena' },
  find_related_files: { category: 'serena' },
  scan_project: { category: 'serena' },
  trace_symbol: { category: 'serena' },
  build_code_index: { category: 'codegraph' },
  codegraph_explore: { category: 'codegraph' },
  git_status: { label: 'Git 状态', icon: 'terminal' },
  git_diff: { label: 'Git 差异', icon: 'terminal' },
  git_log: { label: 'Git 日志', icon: 'terminal' },
  git_commit: { label: 'Git 提交', icon: 'terminal' },
  git_push: { label: 'Git 推送', icon: 'terminal' },
  git_pull: { label: 'Git 拉取', icon: 'terminal' },
  git_clone: { label: 'Git 克隆', icon: 'terminal' },
  git_branch: { label: 'Git 分支', icon: 'terminal' }
};

const TOOL_ICON_SVG = {
  // Keyline file-cog, cloud-check, puzzle; Lucide party-popper.
  "file-cog": "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20 10L20 8L14 2L8 2C5.7909 2 4 3.7909 4 6L4 18C4 20.2091 5.7909 22 8 22M14 2L14 5C14 6.6569 15.3431 8 17 8L20 8M18.6667 18C18.6667 19.4728 17.4728 20.6667 16 20.6667C14.5272 20.6667 13.3333 19.4728 13.3333 18C13.3333 16.5272 14.5272 15.3333 16 15.3333C17.4728 15.3333 18.6667 16.5272 18.6667 18ZM19.5417 18L20 18M18.5043 20.5043L18.8284 20.8284M16 21.5417L16 22M13.4957 20.5043L13.1716 20.8284M12.4583 18L12 18M13.4957 15.4957L13.1716 15.1716M16 14.4583L16 14M18.5043 15.4957L18.8284 15.1716\"/></svg>",
  "cloud-check": "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M9 19L11 21L15 17M5 16.874C3.2748 16.4299 2 14.8638 2 13C2 10.7909 3.7909 9 6 9C6 5.6863 8.6863 3 12 3C15.3137 3 18 5.6863 18 9C20.2091 9 22 10.7909 22 13C22 14.8638 20.7252 16.4299 19 16.874\"/></svg>",
  "puzzle": "<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M7 6L7 6.5C7 6.7761 6.7761 7 6.5 7L5 7C3.8954 7 3 7.8954 3 9L3 10.5C3 10.7761 3.2239 11 3.5 11L4 11C5.6569 11 7 12.3431 7 14C7 15.6569 5.6569 17 4 17L3.5 17C3.2239 17 3 17.2239 3 17.5L3 19C3 20.1046 3.8954 21 5 21L15 21C16.1046 21 17 20.1046 17 19L17 17.5C17 17.2239 17.2239 17 17.5 17L18 17C19.6569 17 21 15.6569 21 14C21 12.3431 19.6569 11 18 11L17.5 11C17.2239 11 17 10.7761 17 10.5L17 9C17 7.8954 16.1046 7 15 7L13.5 7C13.2239 7 13 6.7761 13 6.5L13 6C13 4.3431 11.6569 3 10 3C8.3431 3 7 4.3431 7 6Z\"/></svg>",
  "party-popper": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" > <path d=\"M5.8 11.3 2 22l10.7-3.79\" /> <path d=\"M4 3h.01\" /> <path d=\"M22 8h.01\" /> <path d=\"M15 2h.01\" /> <path d=\"M22 20h.01\" /> <path d=\"m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10\" /> <path d=\"m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17\" /> <path d=\"m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7\" /> <path d=\"M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z\" /> </svg>",
  'file-plus': '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H8C5.79086 2 4 3.79086 4 6V18C4 20.2091 5.79086 22 8 22H10M14 2L20 8V12M14 2V5C14 6.65685 15.3431 8 17 8H20M17 16V22M14 19H20"/></svg>',
  'book-check': '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12L20 5C20 3.3431 18.6569 2 17 2L7 2C5.3431 2 4 3.3431 4 5L4 20M10 22L6 22C4.8954 22 4 21.1046 4 20C4 18.8954 4.8954 18 6 18L10 18M8 6L8 14M14 19L16 21L20 17" fill="none"/></svg>',
  'square-terminal': '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3H18C19.6569 3 21 4.34315 21 6V18C21 19.6569 19.6569 21 18 21H6C4.34315 21 3 19.6569 3 18V6C3 4.34315 4.34315 3 6 3Z"/><path d="M7 7L11 11L7 15M13 17H17"/></svg>',
  // Task working voice icons: Lucide bot + Keyline-style handshake geometry,
  // kept on the shared 24px grid with the app's 1.5px rounded stroke.
  bot: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/></svg>',
  handshake: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3M3 4h8"/></svg>',
  'badge-check': '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m16 9-5.5 5.5L8 12"/></svg>',
  'file-text': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H8C5.79086 2 4 3.79086 4 6V18C4 20.2091 5.79086 22 8 22H16C18.2091 22 20 20.2091 20 18V8L14 2ZM14 2V5C14 6.65685 15.3431 8 17 8H20M8 13H12M8 17H16"/></svg>',
  'file-arrow-left': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H8C5.79086 2 4 3.79086 4 6V18C4 20.2091 5.79086 22 8 22H10M14 2L20 8V12M14 2V5C14 6.65685 15.3431 8 17 8H20M20 19H14M17 16L14 19L17 22"/></svg>',
  'file-arrow-up': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H8C5.79086 2 4 3.79086 4 6V18C4 20.2091 5.79086 22 8 22H10M14 2L20 8V12M14 2V5C14 6.65685 15.3431 8 17 8H20M17 22V16M14 19L17 16L20 19"/></svg>',
  'pen-line': '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.0237 7.6904L9.8567 18.8573L2 22L5.1427 14.1433L16.3096 2.9763C16.9348 2.3512 17.7826 2 18.6667 2C19.5507 2 20.3986 2.3512 21.0237 2.9763C21.6488 3.6014 22 4.4493 22 5.3333C22 6.2174 21.6488 7.0652 21.0237 7.6904ZM15.0638 4.2222L19.7778 8.9362M13.1111 22L22 22" fill="none"/></svg>',
  'circle-pen': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12M10.5 13.5L14.6248 11.8501L20.4874 5.9874C21.1709 5.304 21.1709 4.196 20.4874 3.5126C19.804 2.8291 18.696 2.8291 18.0126 3.5126L12.1499 9.3752Z"/></svg>',
  'square-pen': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H6C4.34315 3 3 4.34315 3 6V18C3 19.6569 4.34315 21 6 21H18C19.6569 21 21 19.6569 21 18V12M10.5 13.5L14.6248 11.8501L20.4874 5.9874C21.1709 5.304 21.1709 4.196 20.4874 3.5126C19.804 2.8291 18.696 2.8291 18.0126 3.5126L12.1499 9.3752Z"/></svg>',
  terminal: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5L10.5571 10.6204C10.7899 10.8199 10.7899 11.1801 10.5571 11.3796L4 17M20 19H13"/></svg>',
  'globe-plus': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12M2 12H22M12 2C14.6667 5 16 8.5 16 12M12 2C9.33333 5 8 8.5 8 12C8 15.5 9.33333 19 12 22M19 16V22M22 19H16"/></svg>',
  globe: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM2 12H22M12 2C14.6667 5 16 8.5 16 12C16 15.5 14.6667 19 12 22C9.33333 19 8 15.5 8 12C8 8.5 9.33333 5 12 2Z"/></svg>',
  'message-plus': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5686 16.353 C2.915 14.8839 2 12.9769 2 11 C2 6.5817 6.4772 3 12 3 C17.5228 3 22 6.5817 22 11 C22 15.4183 17.5228 19 12 19 C11.1845 19 10.3721 18.9202 9.5808 18.7624 L5 21 L4.5686 16.353 ZM12 8 L12 14 M9 11 L15 11" fill="none"/></svg>',
  'circle-more-horizontal': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2Z"/><path d="M7.3333 10.6667C8.0697 10.6667 8.6666 11.2636 8.6666 12C8.6666 12.7364 8.0697 13.3333 7.3333 13.3333C6.5969 13.3333 6 12.7364 6 12C6 11.2636 6.5969 10.6667 7.3333 10.6667ZM12 10.6667C12.7364 10.6667 13.3333 11.2636 13.3333 12C13.3333 12.7364 12.7364 13.3333 12 13.3333C11.2636 13.3333 10.6667 12.7364 10.6667 12C10.6667 11.2636 11.2636 10.6667 12 10.6667ZM16.6667 10.6667C17.4031 10.6667 18 11.2636 18 12C18 12.7364 17.4031 13.3333 16.6667 13.3333C15.9303 13.3333 15.3334 12.7364 15.3334 12C15.3334 11.2636 15.9303 10.6667 16.6667 10.6667Z" fill="currentColor" stroke="none"/></svg>',
  'square-more-horizontal': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3H18C19.6569 3 21 4.34315 21 6V18C21 19.6569 19.6569 21 18 21H6C4.34315 21 3 19.6569 3 18V6C3 4.34315 4.34315 3 6 3Z"/><path d="M7.3333 10.6667C8.0697 10.6667 8.6666 11.2636 8.6666 12C8.6666 12.7364 8.0697 13.3333 7.3333 13.3333C6.5969 13.3333 6 12.7364 6 12C6 11.2636 6.5969 10.6667 7.3333 10.6667ZM12 10.6667C12.7364 10.6667 13.3333 11.2636 13.3333 12C13.3333 12.7364 12.7364 13.3333 12 13.3333C11.2636 13.3333 10.6667 12.7364 10.6667 12C10.6667 11.2636 11.2636 10.6667 12 10.6667ZM16.6667 10.6667C17.4031 10.6667 18 11.2636 18 12C18 12.7364 17.4031 13.3333 16.6667 13.3333C15.9303 13.3333 15.3334 12.7364 15.3334 12C15.3334 11.2636 15.9303 10.6667 16.6667 10.6667Z" fill="currentColor" stroke="none"/></svg>',
  eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12C3.0523 7.3229 7.206 4 12 4C16.794 4 20.9477 7.3229 22 12C20.9477 16.6771 16.794 20 12 20C7.206 20 3.0523 16.6771 2 12ZM15 12C15 13.6569 13.6569 15 12 15C10.3431 15 9 13.6569 9 12C9 10.3431 10.3431 9 12 9C13.6569 9 15 10.3431 15 12Z"/></svg>',
  download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3V14M8 10L12 14L16 10M4 18V19C4 20.1046 4.89543 21 6 21H18C19.1046 21 20 20.1046 20 19V18"/></svg>',
  filter: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2903 4.7025C2.6666 4.0707 3.1142 3 4.002 3L19.998 3C20.8858 3 21.3334 4.0707 20.7097 4.7025L14.2883 11.2079C14.1036 11.3951 14 11.6474 14 11.9104L14 18.4997C14 18.8146 13.8516 19.1112 13.5996 19.3L11.5996 20.7985C10.9403 21.2925 10 20.822 10 19.9982L10 11.9104C10 11.6474 9.8964 11.3951 9.7117 11.2079L3.2903 4.7025C2.6666 4.0707 3.1142 3 4.002 3Z" fill="none"/></svg>',
  file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H8C5.79086 2 4 3.79086 4 6V18C4 20.2091 5.79086 22 8 22H16C18.2091 22 20 20.2091 20 18V8L14 2ZM14 2V5C14 6.65685 15.3431 8 17 8H20"/></svg>',
  bin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2H14M4 7H20M6 7H18V19C18 20.6569 16.6569 22 15 22H9C7.34315 22 6 20.6569 6 19V7Z"/></svg>',
  'image-check': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3L6 3C4.3431 3 3 4.3431 3 6L3 18C3 19.6569 4.3431 21 6 21L18 21C19.6569 21 21 19.6569 21 18L21 13M3 18L7.9393 13.0607C8.5251 12.4749 9.4749 12.4749 10.0607 13.0607L12.0801 15.0801C12.6079 15.6079 13.4436 15.6673 14.0408 15.2194L15.9592 13.7806C16.5564 13.3327 17.3921 13.3921 17.9199 13.9199L21 17M15 6L17 8L21 4"/><path d="M9.5 7.5C9.5 8.3284 8.8284 9 8 9C7.1716 9 6.5 8.3284 6.5 7.5C6.5 6.6716 7.1716 6 8 6C8.8284 6 9.5 6.6716 9.5 7.5Z" fill="currentColor" stroke="none"/></svg>',
  'image-plus': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3L6 3C4.3431 3 3 4.3431 3 6L3 18C3 19.6569 4.3431 21 6 21L18 21C19.6569 21 21 19.6569 21 18L21 13M3 18L7.9393 13.0607C8.5251 12.4749 9.4749 12.4749 10.0607 13.0607L12.0801 15.0801C12.6079 15.6079 13.4436 15.6673 14.0408 15.2194L15.9592 13.7806C16.5564 13.3327 17.3921 13.3921 17.9199 13.9199L21 17M18 3V9M15 6H21"/><path d="M9.5 7.5C9.5 8.3284 8.8284 9 8 9C7.1716 9 6.5 8.3284 6.5 7.5C6.5 6.6716 7.1716 6 8 6C8.8284 6 9.5 6.6716 9.5 7.5Z" fill="currentColor" stroke="none"/></svg>',
  'list-video': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6H16M2 12H12M2 18H12M17.59977 10.20164L21.59977 13.19983C22.13341 13.59982 22.13341 14.40018 21.59977 14.80017L17.59977 17.79836C16.94049 18.29251 16 17.8221 16 16.99818L16 11.00182C16 10.1779 16.94049 9.70749 17.59977 10.20164Z"/></svg>',
  'globe-cursor': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12M2 12H22M12 2C14.6667 5 16 8.5 16 12M12 2C9.33333 5 8 8.5 8 12C8 15.5 9.33333 19 12 22M17.7728 21.8371L16.0114 16.3046C15.9534 16.1226 16.1272 15.9519 16.3089 16.0124L21.8399 17.8539C22.0454 17.9223 22.0557 18.2081 21.8557 18.2911L19.4925 19.2715C19.4385 19.2939 19.3949 19.3355 19.3702 19.3882L18.2085 21.8653C18.118 22.058 17.8374 22.0398 17.7728 21.8371Z"/></svg>',
  'folder-arrow-left': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 20L6 20C4.3431 20 3 18.6569 3 17L3 7C3 5.3431 4.3431 4 6 4L8.6716 4C9.202 4 9.7107 4.2107 10.0858 4.5858L11.4142 5.9142C11.7893 6.2893 12.298 6.5 12.8284 6.5L18 6.5C19.6569 6.5 21 7.8431 21 9.5L21 10M21 17H15M18 14L15 17L18 20"/></svg>',
  'folder-arrow-up': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 20L6 20C4.3431 20 3 18.6569 3 17L3 7C3 5.3431 4.3431 4 6 4L8.6716 4C9.202 4 9.7107 4.2107 10.0858 4.5858L11.4142 5.9142C11.7893 6.2893 12.298 6.5 12.8284 6.5L18 6.5C19.6569 6.5 21 7.8431 21 9.5L21 10M18 20V14M15 17L18 14L21 17"/></svg>',
  'file-check': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H8C5.79086 2 4 3.79086 4 6V18C4 20.2091 5.79086 22 8 22H10M14 2L20 8V12M14 2V5C14 6.65685 15.3431 8 17 8H20M14 19L16 21L20 17"/></svg>',
  'folder-check': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 20L6 20C4.3431 20 3 18.6569 3 17L3 7C3 5.3431 4.3431 4 6 4L8.6716 4C9.202 4 9.7107 4.2107 10.0858 4.5858L11.4142 5.9142C11.7893 6.2893 12.298 6.5 12.8284 6.5L18 6.5C19.6569 6.5 21 7.8431 21 9.5L21 10M15 17L17 19L21 15"/></svg>',
  monitor: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4H19C20.65685 4 22 5.34315 22 7V13C22 14.65685 20.65685 16 19 16H5C3.34315 16 2 14.65685 2 13V7C2 5.34315 3.34315 4 5 4ZM12 16V20M8 20H16"/></svg>',
  'terminal-cursor': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 18.9999H13M14.7026 5.35175L11.5789 14.9795C11.4412 15.4136 10.8422 15.4525 10.6494 15.04L8.61378 10.6858C8.56101 10.573 8.46799 10.4838 8.35296 10.436L4.30741 8.72095C3.88071 8.54335 3.90275 7.93152 4.34114 7.78509L14.0677 4.72626C14.4554 4.59674 14.8263 4.96206 14.7026 5.35175Z"/></svg>',
  'sliders-horizontal': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5H21M3 12H21M3 19H21M16 3V7M8 10V14M14 17V21"/></svg>'
};

const TOOL_SERVER_UI = {
  'yan-computer': { label: 'Yan Computer Use', toolName: 'Yan Computer Use', icon: 'terminal-cursor' },
  'yan-browser': { label: 'Yan 内置浏览器', toolName: 'Yan-builtin-browser-Control', icon: 'globe-cursor' },
  serena: { label: 'Yan Serena', toolName: 'Yan-Serena-MCP', icon: 'file-check' },
  codegraph: { label: 'Yan CodeGraph', toolName: 'Yan-CodeGraph-MCP', icon: 'folder-check' },
  playwright: { label: 'Yan Playwright', toolName: 'Yan-Playwright-MCP', icon: 'terminal-cursor' },
  harness: { label: 'Yan Continual Harness', toolName: 'Yan-Continual-Harness', icon: 'sliders-horizontal' }
};

function parseToolIdentity(toolName) {
  const raw = String(toolName || 'tool').trim();
  const legacyMcp = raw.match(/^mcp__(.+?)__(.+)$/i);
  if (legacyMcp) {
    return { raw, server: legacyMcp[1].toLowerCase(), action: legacyMcp[2].toLowerCase() };
  }
  const normalized = raw.replace(/\./g, '_').toLowerCase();
  const computerPlugin = normalized.match(/^yanp_[a-f0-9]{16}_[a-f0-9]{10}_computer_(.+)$/);
  if (computerPlugin) return { raw, server: 'yan_computer', action: computerPlugin[1] };
  const prefixes = [
    'mcp_default_playwright',
    'mcp_default_codegraph',
    'mcp_default_serena',
    'yan_continual_harness',
    'yan_harness',
    'yan_browser',
    'yan_web',
    'yan_session',
    'yan_skills',
    'yan_media'
  ];
  const server = prefixes.find(prefix => normalized.startsWith(prefix + '_'));
  if (server) return { raw, server, action: normalized.slice(server.length + 1) };
  return { raw, server: '', action: normalized };
}
function toolServerCategory(server) {
  const key = String(server || '').replace(/-/g, '_').toLowerCase();
  if (key.includes('yan_computer')) return 'yan-computer';
  if (key.includes('yan_browser')) return 'yan-browser';
  if (key.includes('playwright')) return 'playwright';
  if (key.includes('serena')) return 'serena';
  if (key.includes('codegraph')) return 'codegraph';
  if (key.includes('yan_harness') || key.includes('continual_harness')) return 'harness';
  return '';
}
window.YanWebToolUI = { TOOL_UI, TOOL_ICON_SVG, TOOL_SERVER_UI, parseToolIdentity, toolServerCategory };
})();
