/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;
const BUILT_IN_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'todo_write',
      description: '创建或更新任务计划清单（会实时展示给用户）。任何需要 3 步以上的任务，动手前先调用它列出计划；之后每完成一步就再次调用更新状态。每次必须传完整清单。同一时刻只能有一项 in_progress。',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: '完整的任务清单',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: '任务描述（简短）' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: '任务状态' }
              },
              required: ['text', 'status']
            }
          }
        },
        required: ['todos']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取文件内容。可以传入绝对路径或相对于工作区的路径。编辑文件前必须先读取它。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '精确编辑已存在的文件：把 old_string 替换为 new_string。old_string 必须与文件内容逐字符完全一致（含缩进/换行），且在文件中只出现一次。单点修改用它；多处修改优先用 apply_patch。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          old_string: { type: 'string', description: '要被替换的原文（必须唯一匹配）' },
          new_string: { type: 'string', description: '替换后的新文本' }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'apply_patch',
      description: '对同一个已存在文件执行多段精确替换。每个 edit 都是 old_string -> new_string，按顺序应用；每个 old_string 在应用时必须唯一匹配。适合一次完成同一文件的多处修改，写入后会自动回读校验。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          edits: {
            type: 'array',
            description: '按顺序执行的替换列表',
            items: {
              type: 'object',
              properties: {
                old_string: { type: 'string', description: '要被替换的原文（必须唯一匹配）' },
                new_string: { type: 'string', description: '替换后的新文本' }
              },
              required: ['old_string', 'new_string']
            }
          }
        },
        required: ['path', 'edits']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '将内容写入文件（不存在则创建，存在则整体覆盖，自动创建目录）。仅用于新建文件或彻底重写；修改已有文件请用 edit_file 或 apply_patch。写入后会自动回读校验。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '要写入的内容' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出指定目录下的文件和子目录。不传 path 则列出工作区根目录。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径（默认为工作区根目录）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_shell',
      description: '执行 Shell 命令并返回输出。可用于运行脚本、安装依赖、编译代码等。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: '在工作区搜索代码文本。支持正则、扩展名过滤、目录范围。改代码前先用它定位相关文件，再配合 get_file_outline / find_symbol 理解结构。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索文本或正则表达式' },
          path: { type: 'string', description: '限定搜索目录（默认工作区根目录）' },
          extensions: {
            type: 'array',
            items: { type: 'string' },
            description: '扩展名过滤，如 ["js","ts","py"]，不含点号'
          },
          regex: { type: 'boolean', description: '将 query 视为正则表达式（默认 false）' },
          case_sensitive: { type: 'boolean', description: '区分大小写（默认 false）' },
          context_lines: { type: 'number', description: '匹配行前后附加上下文行数（0-5，默认 0）' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_file_outline',
      description: '提取单个源文件的符号大纲（函数、类、常量、接口等）及行号。大文件或陌生文件请先调此工具再 read_file，避免盲目通读。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_symbol',
      description: '在工作区查找符号（函数/类/变量等）的定义位置，返回路径与行号。用于追踪调用链、定位实现，比纯文本搜索更精准。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '符号名，如 initKernel、UserService' },
          path: { type: 'string', description: '限定搜索目录（可选）' },
          extensions: {
            type: 'array',
            items: { type: 'string' },
            description: '扩展名过滤（可选）'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file_range',
      description: '按行号范围读取文件（1-based）。大文件请先 get_file_outline 定位，再精读相关行，避免一次 read_file 全文。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          start_line: { type: 'number', description: '起始行（含）' },
          end_line: { type: 'number', description: '结束行（含），单次最多 250 行' }
        },
        required: ['path', 'start_line', 'end_line']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_file_imports',
      description: '分析单文件的 import/require 与 export 列表，理解模块依赖时使用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_references',
      description: '查找符号在代码库中的引用位置（非定义）。改函数签名或重命名前必用。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '符号名' },
          max_results: { type: 'number', description: '最大结果数（默认 50）' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_related_files',
      description: '根据 import 关系查找与某文件相关的上下游模块（它 import 谁、谁 import 它）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_symbols',
      description: '在代码索引中模糊搜索符号名（函数/类/常量）。比 search_files 更快更准，需先 build_code_index（会自动构建）。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '符号名片段，如 Agent、execute' },
          kind: { type: 'string', description: '过滤类型：function/class/const/interface 等' },
          limit: { type: 'number', description: '最大结果数（默认 40）' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'build_code_index',
      description: '构建/刷新工作区代码索引（符号表 + import 图），存入 .yanagent/code-index.json。大项目首次理解代码时调用。',
      parameters: {
        type: 'object',
        properties: {
          force: { type: 'boolean', description: '强制重建（默认 false，5 分钟内用缓存）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scan_project',
      description: '扫描项目结构：入口文件、技术栈、目录分布、npm scripts。接手新项目时第一步调用。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'trace_symbol',
      description: '一次性追踪符号：列出所有定义 + 引用样本。比分别调 find_symbol + find_references 更高效。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '符号名' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: '查看当前工作区的 Git 状态（修改、暂存、未跟踪的文件等）。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: '查看 Git 差异（未暂存或已暂存的改动）。',
      parameters: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: '是否查看已暂存的差异' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: '查看 Git 提交历史。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '显示的提交数量（默认20）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: '将所有改动添加到暂存区并提交。',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: '提交信息' }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_push',
      description: '将本地提交推送到远程仓库。',
      parameters: {
        type: 'object',
        properties: {
          remote: { type: 'string', description: '远程仓库名（默认 origin）' },
          branch: { type: 'string', description: '分支名（可选）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_pull',
      description: '从远程仓库拉取最新代码。',
      parameters: {
        type: 'object',
        properties: {
          remote: { type: 'string', description: '远程仓库名（默认 origin）' },
          branch: { type: 'string', description: '分支名（可选）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_clone',
      description: '克隆远程仓库到当前工作区。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '仓库 URL' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_branch',
      description: '列出所有本地和远程分支。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'spawn_subagent',
      description: '委派子 Agent 完成子任务，结果以摘要返回主 Agent。类型：explore(只读调研)、shell(命令)、review(代码审查)、edit(专注改动)、ui(前端/HTML)、doc(文档/报告)。子 Agent 不能嵌套。',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['explore', 'shell', 'review', 'edit', 'ui', 'doc'],
            description: '子 Agent 类型'
          },
          task: { type: 'string', description: '子任务描述' },
          context: { type: 'string', description: '可选补充上下文' }
        },
        required: ['type', 'task']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'spawn_subagents',
      description: '并行启动多个辅助子 Agent（最多 3 个），适合同时摸底不同目录/模块。返回合并摘要。不能嵌套。',
      parameters: {
        type: 'object',
        properties: {
          agents: {
            type: 'array',
            description: '子 Agent 列表',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['explore', 'shell', 'review', 'edit', 'ui', 'doc'] },
                task: { type: 'string' },
                context: { type: 'string' }
              },
              required: ['type', 'task']
            }
          }
        },
        required: ['agents']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_builtin_browser',
      description: '打开 Yan Agent 内置浏览器面板并导航到 URL 或本地 HTML 文件，供用户预览。写完 HTML/网页/Canvas 游戏等前端页面后，必须调用此工具在内置浏览器中打开验证；不要只用 read_file 代替视觉测试。支持 https URL 或文件路径（相对工作区或绝对路径，如 snake.html）。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '网址 (https://...) 或 HTML 文件路径' }
        },
        required: ['url']
      }
    }
  }
];

// Dynamic TOOLS: built-in + MCP tools (refreshed at the start of each agent run)
let TOOLS = [...BUILT_IN_TOOLS];
// Map: full tool name -> { serverId, toolName } for MCP tool routing
const mcpToolMap = new Map();
let mcpToolsRefreshPromise = null;

// 加载所有已启用的 MCP 服务器工具，合并进 TOOLS
async function refreshMcpTools() {
  if (mcpToolsRefreshPromise) return mcpToolsRefreshPromise;
  mcpToolsRefreshPromise = (async () => {
    mcpToolMap.clear();
    const errors = [];
    try {
      const mcpTools = await api().mcpListTools();
      if (!mcpTools || mcpTools.length === 0) {
        TOOLS = [...BUILT_IN_TOOLS];
        return;
      }
      const mcpToolDefs = [];
      for (const t of mcpTools) {
        if (t.error) {
          errors.push(`${t.serverName}: ${t.error}`);
          continue;
        }
        if (!t.tool) continue;
        const fullName = `mcp__${t.serverId}__${t.tool.name}`;
        mcpToolMap.set(fullName, { serverId: t.serverId, toolName: t.tool.name });
        mcpToolDefs.push({
          type: 'function',
          function: {
            name: fullName,
            description: `[MCP:${t.serverName}] ${t.tool.description || t.tool.name}`,
            parameters: t.tool.inputSchema || { type: 'object', properties: {} }
          }
        });
      }
      TOOLS = [...BUILT_IN_TOOLS, ...mcpToolDefs];
      console.log(`[MCP] 已加载 ${mcpToolDefs.length} 个 MCP 工具${errors.length ? '，' + errors.length + ' 个服务器失败' : ''}`);
      if (errors.length > 0) {
        deps().toast('MCP 启动失败: ' + errors[0] + (errors.length > 1 ? ` 等 ${errors.length} 个` : ''));
      }
    } catch (e) {
      console.log('[MCP] 加载工具失败:', e.message);
      TOOLS = [...BUILT_IN_TOOLS];
      deps().toast('MCP 加载失败: ' + e.message);
    }
  })();
  try {
    await mcpToolsRefreshPromise;
  } finally {
    mcpToolsRefreshPromise = null;
  }
}

function snapshotTools() {
  return [...TOOLS];
}
const TOOL_ICONS = {
  todo_write: '📋', read_file: '📄', edit_file: '🪄', apply_patch: '🧩', write_file: '✏️',
  list_directory: '📁', execute_shell: '⚡', search_files: '🔍',
  get_file_outline: '📑', find_symbol: '🔗',
  read_file_range: '📖', get_file_imports: '🔀', find_references: '↩️',
  find_related_files: '🕸️', search_symbols: '🔎', build_code_index: '🗂️',
  scan_project: '🗺️', trace_symbol: '🧵',
  open_builtin_browser: '🌐',
  git_status: '📊', git_diff: '📋', git_log: '📝', git_commit: '✅',
  git_push: '⬆️', git_pull: '⬇️', git_clone: '📦', git_branch: '🌿',
  spawn_subagent: '🧭', spawn_subagents: '🧭',
};

  K.BUILT_IN_TOOLS = BUILT_IN_TOOLS;
  K.TOOL_ICONS = TOOL_ICONS;
  K.refreshMcpTools = refreshMcpTools;
  K.snapshotTools = snapshotTools;
  K.getMcpToolMap = () => mcpToolMap;

})(window.YanKernel);
