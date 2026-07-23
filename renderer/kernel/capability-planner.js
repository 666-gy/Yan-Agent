/* Yan Agent - task-aware capability planner */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;

  const WORKSPACE_READ_TOOLS = new Set(['read_file', 'list_directory', 'search_files']);
  const WORKSPACE_WRITE_TOOLS = new Set([
    'todo_write', 'edit_file', 'apply_patch', 'write_file', 'execute_shell'
  ]);
  const CODE_ANALYSIS_TOOLS = new Set([
    'get_file_outline', 'read_file_range', 'get_file_imports',
    'find_references', 'find_related_files', 'find_symbol', 'search_symbols',
    'build_code_index', 'scan_project', 'trace_symbol'
  ]);
  const GIT_READ_TOOLS = new Set(['git_status', 'git_diff', 'git_log', 'git_branch']);
  const UI_KIT_TOOLS = new Set(['list_ui_kit', 'read_ui_kit']);
  const SUBAGENT_TOOLS = new Set(['spawn_subagent', 'spawn_subagents']);
  // Skills are indexed as skill:<id>. Keep the legacy native helpers internal so
  // search results expose one canonical entry and cannot bypass discovery.
  const INTERNAL_NATIVE_TOOLS = new Set(['list_skills', 'read_skill']);
  const CONTINUATION_RE = /^(?:继续|接着|继续做|继续工作|上个|刚才|然后|那就|好的|好|开始|再来|下一步)/i;
  const CONTEXT_DEPENDENT_RE = /^(?:不行|不是|不好|不太|不够|还是|又|现在|结果|这个|那个|它|上述|上面|刚才)|不可用|不能用|用不了|没反应|没(?:有)?|看不到|有问题|异常|报错|失败|卡住|太(?:快|慢|大|小|丑|难|简单)|修一下|修复一下|加一|再加|换成|优化一下/i;
  const GIT_RE = /\b(?:git|commit|push|pull|branch|merge|rebase|diff|pr|pull request)\b|版本控制|提交(?:代码|改动)?|推送(?:代码)?|拉取(?:代码)?|分支|仓库|提交记录|差异|合并请求/i;
  const DESKTOP_RE = /Yan\s*Computer\s*Use|computer[\s-]*use|操作(?:电脑|Windows)|控制(?:电脑|桌面|Windows)|桌面自动化|(?:打开|启动|运行|进入|切换到|点击|输入|搜索).{0,24}(?:系统浏览器|外部浏览器|Chrome|Google\s*Chrome|Edge|Firefox|抖音|微信|软件|应用|窗口)/i;
  const BROWSER_AUTOMATION_RE = /(?:使用|调用|用).{0,12}playwright|playwright.{0,12}(?:打开|访问|点击|填写|截图|测试|验证|自动化)|\be2e\b|端到端|浏览器自动化|自动化(?:测试|点击|填写)|(?:登录|表单|点击).{0,12}(?:测试|验证|自动化)/i;
  const WEB_RE = /\b(?:html|css|javascript|typescript|react|vue|svelte|canvas|webgl)\b|网页|网站|前端|页面|小游戏|游戏|界面|UI/i;
  const UI_KIT_RE = /react[\s-]*bits|uiverse|universe\s*ui|组件库|设计系统/i;
  const CODE_ANALYSIS_RE = /代码库|项目(?:结构|代码|里)|现有(?:代码|项目)|重构|调试|报错|错误|bug|函数|类|接口|依赖|调用链|引用|模块/i;
  const ACTION_RE = /帮我|请|把|给(?:我)?|使用|调用|做(?:个|一|好|出)?|新建|创建|制作|实现|修改|改(?:成|一下|好)|修复|删除|更新|添加|运行|测试|调试|打开|安装|搜索|查(?:看|一下)?|检查|审查|生成|写(?:一个|个|入|好)?|开发|构建|部署|提交|推送|拉取|控制|操作|点击|输入|截图/i;
  const WORKSPACE_CONTEXT_RE = /文件|代码|项目|工作区|目录|文件夹|仓库|函数|类|接口|依赖|模块|脚本|程序|服务端|服务器|数据库|readme|package\.json|\b(?:html|css|javascript|typescript|python|node|react|vue|svelte|express|canvas|webgl|json|yaml|toml)\b|网页|网站|前端|页面|小游戏|游戏/i;
  const READ_ONLY_RE = /(?:先|暂时)?(?:别|不要|不用).{0,8}(?:改|修改|写|编辑|动).{0,8}(?:代码|文件)?|只(?:分析|看看|检查|审查|讨论)|先(?:分析|看看|检查|审查|讨论)/i;
  const INSPECTION_RE = /分析|看看|查看|检查|审查|review|解释|为什么|定位|诊断/i;
  const MUTATION_RE = /修复|修改|改(?:成|一下|好)|实现|创建|新建|制作|删除|更新|添加|写(?:入|个|一个)?|重构|安装|部署|提交|推送|拉取/i;
  const ONLINE_SEARCH_RE = /网上|联网|网络搜索|搜索.{0,8}(?:资料|信息|定价|新闻)|查.{0,8}(?:资料|信息|定价|新闻)/i;
  const IMAGE_GENERATION_RE = /生成|制作|画|绘制|生图|修图|改图|图片编辑|图像编辑/i;
  const IMAGE_SUBJECT_RE = /图片|图像|照片|插画|海报|封面|头像|素材|壁纸|logo|图标/i;
  const GENERIC_SKILL_TRIGGERS = new Set(['code', 'pro', 'test', 'ui', 'web']);
  const NEGATED_MCP_RE = /(?:不要|不用|别|禁止|无需).{0,16}(?:\bmcp\b|computer[\s-]*use|yan\s*computer\s*use|playwright|桌面自动化|浏览器自动化)/i;
  const NEGATED_GIT_RE = /(?:不要|不用|别|禁止|无需).{0,12}(?:\bgit\b|提交|推送|拉取|分支|版本控制)/i;
  const NEGATED_COMPUTER_RE = /(?:不要|不用|别|禁止|无需).{0,16}(?:computer[\s-]*use|yan\s*computer\s*use|操作电脑|控制电脑|桌面自动化)/i;
  const NEGATED_BROWSER_AUTOMATION_RE = /(?:不要|不用|别|禁止|无需).{0,16}(?:playwright|浏览器自动化|自动化测试)/i;
  const NEGATED_MEDIA_RE = /(?:不要|不用|别|禁止|无需).{0,16}(?:生图|修图|改图|图片生成|图像生成)/i;
  const EXPLICIT_WORKSPACE_TARGETS = [
    { id: 'desktop', re: /(?:进入|在|到|去|使用|切换到)\s*(?:我的)?(?:桌面|desktop)(?:目录|文件夹)?|(?:保存|创建|新建|写).{0,12}(?:到|在|进)?\s*(?:我的)?桌面/i },
    { id: 'documents', re: /(?:进入|在|到|去|使用|切换到)\s*(?:我的)?(?:文档|documents)(?:目录|文件夹)?/i },
    { id: 'downloads', re: /(?:进入|在|到|去|使用|切换到)\s*(?:我的)?(?:下载|downloads)(?:目录|文件夹)?/i }
  ];

  const CAPABILITY_CATEGORY_BY_TOOL = Object.freeze({
    get_file_imports: 'code', find_references: 'code', find_related_files: 'code',
    search_symbols: 'code', build_code_index: 'code', scan_project: 'code', trace_symbol: 'code',
    git_status: 'git', git_diff: 'git', git_log: 'git', git_commit: 'git',
    git_push: 'git', git_pull: 'git', git_clone: 'git', git_branch: 'git',
    list_ui_kit: 'ui', read_ui_kit: 'ui',
    spawn_subagent: 'subagent', spawn_subagents: 'subagent',
    list_skills: 'skill', read_skill: 'skill',
    generate_image: 'media'
  });

  const CAPABILITY_SEARCH_ALIASES = Object.freeze({
    code: '代码分析 符号 引用 依赖 调用链 索引 扫描 项目结构 debug refactor',
    git: 'git 仓库 版本控制 状态 差异 日志 提交 推送 拉取 克隆 分支 commit push pull branch diff',
    ui: '界面 前端 ui 组件 动画 react bits uiverse 设计系统',
    subagent: '子 agent 委派 并行 调研 审查 shell review explore',
    skill: 'skill 技能 工作流 playbook 插件',
    mcp: 'mcp 集成 外部工具 computer use 桌面 自动化 playwright windows',
    media: '图片 生图 修图 image generation edit'
  });

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function getTaskText(messages) {
    const users = (messages || []).filter(message => message?.role === 'user')
      .map(message => String(message.content || '').trim())
      .filter(Boolean);
    const latest = users.at(-1) || '';
    if (users.length > 1 && (CONTINUATION_RE.test(latest) || CONTEXT_DEPENDENT_RE.test(latest))) {
      const chain = [latest];
      for (let index = users.length - 2; index >= 0 && chain.length < 4; index--) {
        chain.unshift(users[index]);
        if (!CONTINUATION_RE.test(users[index])) break;
      }
      return chain.join('\n');
    }
    return latest;
  }

  function detectExplicitWorkspaceTarget(text) {
    return EXPLICIT_WORKSPACE_TARGETS.find(target => target.re.test(String(text || '')))?.id || '';
  }

  async function assignRunWorkspace(runCtx, workspace, source = 'agent') {
    const value = String(workspace || '').trim();
    if (!runCtx || !value) return { ok: false, error: '工作区路径为空' };
    runCtx.workspace = value;
    runCtx.workspaceGrant = { source, workspace: value, ts: Date.now() };
    if (runCtx.sessionRef) runCtx.sessionRef.workspace = value;
    let updated = null;
    if (runCtx.sessionId && api().setSessionWorkspace) {
      updated = await api().setSessionWorkspace(runCtx.sessionId, value, runCtx.ui !== false);
      if (updated?.workspace && runCtx.sessionRef) {
        runCtx.sessionRef.workspace = updated.workspace;
        runCtx.workspace = updated.workspace;
      }
    }
    await deps().hooks?.onWorkspaceAssigned?.(runCtx.workspace, runCtx, source);
    return { ok: true, workspace: runCtx.workspace, updated };
  }

  function hasOperationalAction(text) {
    const normalized = String(text || '').trim();
    if (!normalized) return false;
    return ACTION_RE.test(normalized) || INSPECTION_RE.test(normalized);
  }

  function hasWorkspaceAction(text) {
    const normalized = String(text || '').trim();
    if (!hasOperationalAction(normalized)) return false;
    if (WORKSPACE_CONTEXT_RE.test(normalized)) return true;
    return /安装|卸载|运行|测试|构建|编译|部署/i.test(normalized) && !/浏览器自动化|桌面自动化/i.test(normalized);
  }

  function isReadOnlyTask(text) {
    if (READ_ONLY_RE.test(String(text || ''))) return true;
    return INSPECTION_RE.test(String(text || '')) && !MUTATION_RE.test(String(text || ''));
  }

  function hasWorkspaceHistoryFrom(ctx) {
    const hist = ctx?.sessionRef?.messages || [];
    return hist.some(message => (
      message?.role === 'assistant'
      && message?.agentRun
      && (message.agentRun.changeCount > 0 || message.agentRun.iteration > 0)
    ));
  }

  function addGitTools(plan, taskText) {
    addTools(plan, GIT_READ_TOOLS);
    if (/\bcommit\b|提交(?:代码|改动)?/i.test(taskText) && !/(?:不要|不用|别|禁止).{0,8}(?:commit|提交)/i.test(taskText)) addTools(plan, ['git_commit']);
    if (/\bpush\b|推送(?:代码)?/i.test(taskText) && !/(?:不要|不用|别|禁止).{0,8}(?:push|推送)/i.test(taskText)) addTools(plan, ['git_push']);
    if (/\bpull\b|拉取(?:代码)?/i.test(taskText) && !/(?:不要|不用|别|禁止).{0,8}(?:pull|拉取)/i.test(taskText)) addTools(plan, ['git_pull']);
    if (/\bclone\b|克隆/i.test(taskText) && !/(?:不要|不用|别|禁止).{0,8}(?:clone|克隆)/i.test(taskText)) addTools(plan, ['git_clone']);
  }

  function isWebTask(text) {
    return WEB_RE.test(String(text || ''));
  }

  function listMcpTools(allTools, predicate) {
    return (allTools || [])
      .filter(tool => {
        const name = String(tool?.function?.name || '');
        if (!name.startsWith('mcp__')) return false;
        return predicate(`${name} ${tool?.function?.description || ''}`);
      })
      .map(tool => tool.function.name);
  }

  function scoreSkill(skill, taskText) {
    const text = normalizeText(taskText);
    if (!text) return 0;
    const id = normalizeText(skill?.id);
    const name = normalizeText(skill?.name);
    if (isReadOnlyTask(taskText) && ['fix-bug', 'refactor', 'gen-test', 'add-comments', 'optimize', 'convert-lang'].includes(id)) return 0;
    let score = text.includes(id) || (name.length > 3 && text.includes(name)) ? 30 : 0;
    if (id === 'yan-computer-use' && hasOperationalAction(taskText) && DESKTOP_RE.test(taskText)) score = Math.max(score, 40);
    if (id === 'fix-bug' && !READ_ONLY_RE.test(taskText) && /bug|报错|错误|修复/i.test(taskText)) score = Math.max(score, 24);
    if (id === 'code-review' && /代码审查|code\s*review|审查代码/i.test(taskText)) score = Math.max(score, 24);
    if (id === 'gen-docs' && /readme|api\s*文档|生成.{0,6}文档|写.{0,6}文档/i.test(taskText)) score = Math.max(score, 24);
    if (/anysearch/.test(id) && hasOperationalAction(taskText) && ONLINE_SEARCH_RE.test(taskText)) score = Math.max(score, 24);
    for (const rawTrigger of skill?.triggers || []) {
      const trigger = normalizeText(rawTrigger);
      if (!trigger || GENERIC_SKILL_TRIGGERS.has(trigger)) continue;
      if (text.includes(trigger)) score = Math.max(score, 12 + Math.min(trigger.length, 12));
    }
    if (id === 'gen-test' && !/(?:生成|新增|补(?:充)?|编写|写).{0,8}(?:测试|test)|unit\s*test/i.test(taskText)) return 0;
    if (id === 'optimize' && !/性能|performance|复杂度|内存|i\/o/i.test(taskText)) return 0;
    if (id === 'yan-uiverse' && !UI_KIT_RE.test(taskText)) return 0;
    if (id === 'yan-react-bits' && !UI_KIT_RE.test(taskText)) return 0;
    return score;
  }

  function selectSkills(catalog, taskText, limit = 2) {
    return (catalog?.installed || [])
      .map(skill => ({ skill, score: scoreSkill(skill, taskText) }))
      .filter(item => item.score >= 12)
      .sort((a, b) => b.score - a.score || String(a.skill.name).localeCompare(String(b.skill.name)))
      .slice(0, limit)
      .map(item => item.skill);
  }

  async function loadSkillPlaybooks(skills, taskText) {
    const loaded = [];
    for (const skill of skills || []) {
      try {
        const res = await api().readSkill?.(skill.id, String(taskText || '').slice(0, 1200));
        if (res?.ok && res.prompt) loaded.push({ id: res.id, name: res.name, prompt: res.prompt });
      } catch { /* Skills are optional routing hints. */ }
    }
    return loaded;
  }

  function addTools(plan, names) {
    for (const name of names || []) plan.allowedToolNames.add(name);
  }

  function makePlanDescription(plan) {
    const labels = [];
    if (plan.workspace) {
      if (!plan.workspaceAvailable) labels.push('工作区待申请');
      else if (plan.readOnly || !plan.allowMutation) labels.push('本地工作区只读 (L1)');
      else labels.push('本地工作区可写 (L2+)');
    }
    if (plan.webPreview) labels.push('内置网页预览');
    if (plan.git) labels.push('Git');
    if (plan.desktop) labels.push('Yan Computer Use');
    if (plan.browserAutomation) labels.push('浏览器自动化');
    if (plan.uiKit) labels.push('UI 组件库');
    return labels.length ? labels.join('、') : '无需外部能力的对话';
  }

  async function planRunCapabilities(messages, allTools, runCtx) {
    const taskText = getTaskText(messages);
    const operational = hasOperationalAction(taskText);
    const explicitWorkspaceTarget = detectExplicitWorkspaceTarget(taskText);
    if (explicitWorkspaceTarget && api().getKnownWorkspacePath) {
      try {
        const result = await api().getKnownWorkspacePath(explicitWorkspaceTarget);
        if (result?.workspace && String(runCtx?.workspace || '').toLowerCase() !== String(result.workspace).toLowerCase()) {
          await assignRunWorkspace(runCtx, result.workspace, `user:${explicitWorkspaceTarget}`);
        }
      } catch { /* explicit target remains unavailable; model will receive the request tool */ }
    }
    let workspacePath = '';
    try { workspacePath = String(await K.getRunWorkspace?.(runCtx) || '').trim(); } catch { /* no workspace */ }
    let workspaceAvailable = !!workspacePath;
    let workspace = hasWorkspaceAction(taskText) || workspaceAvailable;
    const readOnly = workspace && isReadOnlyTask(taskText);
    let webPreview = workspace && isWebTask(taskText);
    const git = GIT_RE.test(taskText) && !NEGATED_GIT_RE.test(taskText);
    const desktop = operational && DESKTOP_RE.test(taskText) && !NEGATED_COMPUTER_RE.test(taskText);
    const browserAutomation = operational
      && BROWSER_AUTOMATION_RE.test(taskText)
      && !NEGATED_BROWSER_AUTOMATION_RE.test(taskText);
    const mcpRequested = operational
      && !NEGATED_MCP_RE.test(taskText)
      && /(?:使用|调用|连接|启动|测试).{0,12}\bmcp\b|\bmcp\b.{0,12}(?:工具|服务器).{0,8}(?:运行|启动|连接|测试)/i.test(taskText);
    const uiKit = UI_KIT_RE.test(taskText);
    const mediaRequested = IMAGE_GENERATION_RE.test(taskText)
      && IMAGE_SUBJECT_RE.test(taskText)
      && !NEGATED_MEDIA_RE.test(taskText);
    let codeAnalysis = workspace && CODE_ANALYSIS_RE.test(taskText);

    // === 智能路由：基于上下文证据而非纯正则 ===
    // 核心原则：正则只是 hint，真正的决策依据是上下文证据。
    // 1. 上下文继承：会话历史里有过 agentRun（干过活），说明这是延续性任务。
    //    无论最新消息的正则怎么判，都给基础工作区工具。
    //    这覆盖"做一个优化"、"这个太卡了"、"再加个功能"、"游戏崩溃了"等所有正则盲区。
    if (!workspace) {
      const session = runCtx?.sessionRef;
      const history = session?.messages || [];
      const hasWorkspaceHistory = history.some(message => (
        message?.role === 'assistant'
        && message?.agentRun
        && (message.agentRun.changeCount > 0 || message.agentRun.iteration > 0)
      ));
      if (hasWorkspaceHistory) {
        workspace = true;
        codeAnalysis = CODE_ANALYSIS_RE.test(taskText) || /优化|改进|调整|完善|打磨|重构|性能|bug|卡|慢|崩溃|闪退|报错|错误/i.test(taskText);
      }
    }

    // 2. Workspace existence fallback is READ-ONLY (L1).
    //    Having a workspace selected must not auto-unlock write/shell (L2/L3).
    //    Mutation requires operational action verbs or continuation of a prior edit run.
    let workspaceReadFallback = false;
    if (!workspace && runCtx?.workspace === undefined) {
      try {
        const ws = await api().getWorkspace?.();
        if (ws) {
          workspace = true;
          workspaceAvailable = true;
          workspacePath = String(ws);
          workspaceReadFallback = !hasOperationalAction(taskText) && !hasWorkspaceHistoryFrom(runCtx);
          codeAnalysis = codeAnalysis || CODE_ANALYSIS_RE.test(taskText) || workspaceReadFallback;
        }
      } catch { /* getWorkspace 不可用时静默 */ }
    }

    // 3. webPreview 继承：workspace 触发后，如果历史或当前消息有 web 任务也一并继承
    if (workspace && !webPreview) {
      const session = runCtx?.sessionRef;
      const history = session?.messages || [];
      const hasWebHistory = history.some(message => (
        message?.role === 'assistant'
        && message?.agentRun
        && WEB_RE.test(String(message.agentRun.outcome || '') + ' ' + String(message.content || ''))
      ));
      if (hasWebHistory || WEB_RE.test(taskText)) webPreview = true;
    }

    // Mutation unlock: operational workspace action, or history that already changed files.
    const session = runCtx?.sessionRef;
    const history = session?.messages || [];
    const hadMutatingRun = history.some(message => (
      message?.role === 'assistant'
      && message?.agentRun
      && Number(message.agentRun.changeCount || 0) > 0
    ));
    const allowMutation = workspace && !readOnly && (
      hasWorkspaceAction(taskText)
      || (hadMutatingRun && (CONTINUATION_RE.test(taskText) || CONTEXT_DEPENDENT_RE.test(taskText) || hasOperationalAction(taskText)))
      || (operational && MUTATION_RE.test(taskText) && WORKSPACE_CONTEXT_RE.test(taskText))
    );

    let catalog = { installed: [] };
    try { catalog = await api().getSkillCatalog?.() || catalog; } catch { /* optional */ }
    // operational for completion gate: require plan when we may mutate or use external actuators
    const effectiveOperational = !!(
      operational
      && (allowMutation || desktop || browserAutomation || git || webPreview || runCtx?.workMode === 'plan')
    );

    const plan = {
      taskText,
      operational: effectiveOperational,
      workspace,
      workspaceAvailable,
      workspacePath,
      explicitWorkspaceTarget,
      readOnly: readOnly || (workspace && !allowMutation),
      webPreview,
      git,
      desktop,
      browserAutomation,
      mcpRequested,
      uiKit,
      mediaRequested,
      codeAnalysis,
      catalog,
      selectedSkills: [],
      allowedToolNames: new Set(),
      knownToolNames: new Set((allTools || []).map(tool => tool?.function?.name).filter(Boolean)),
      requestedToolNames: new Set(),
      deniedCapabilities: new Set(),
      grantedCapabilities: new Set(),
      notes: [],
      allowMutation: !!allowMutation,
      workspaceReadFallback: !!workspaceReadFallback
    };

    for (const tool of K.snapshotTools?.() || []) {
      const name = tool?.function?.name;
      if (name) plan.allowedToolNames.add(name);
    }
    if (git) addGitTools({ allowedToolNames: plan.requestedToolNames }, taskText);
    if (NEGATED_GIT_RE.test(taskText)) plan.deniedCapabilities.add('git');
    if (NEGATED_MCP_RE.test(taskText)) plan.deniedCapabilities.add('mcp');
    if (NEGATED_COMPUTER_RE.test(taskText)) plan.deniedCapabilities.add('computer_use');
    if (NEGATED_BROWSER_AUTOMATION_RE.test(taskText)) plan.deniedCapabilities.add('browser_automation');
    if (NEGATED_MEDIA_RE.test(taskText)) plan.deniedCapabilities.add('media');
    plan.notes.push('stable_core_with_hidden_capabilities');

    plan.summary = makePlanDescription(plan);
    if (runCtx) runCtx.capabilityPlan = plan;
    return plan;
  }

  function getToolsForRun(runCtx, allTools) {
    // `allTools` is the stable core. Optional native/MCP/Skill schemas are discovered
    // through search_capabilities and invoked through use_capability.
    return allTools || [];
  }

  function getCapabilityPlanPrompt(runCtx) {
    const plan = runCtx?.capabilityPlan;
    if (!plan) return '';
    const lines = [
      '# Tool usage guidance',
      'A stable core toolset is available directly. Optional capabilities stay hidden until needed:',
      '- Prefer the smallest capable tool: read/search/outline before shell; edit_file before write_file rewrites.',
      '- When the task genuinely needs Git, advanced code analysis, UI kits, subagents, an installed Skill, MCP, Computer Use, Playwright, or image generation, call search_capabilities once with a concrete action, then call use_capability with one returned capability_id.',
      '- Never invent a capability_id and never search merely to browse what is installed. Search results are limited and task-specific.',
      '- Do not reach for Git, desktop automation, Playwright, MCP, UI kits, or subagents unless the task explicitly calls for them. Being thorough is not a reason.',
      '- When the user names a visible Windows application, system browser, Chrome/Edge/Firefox, Douyin/TikTok, WeChat, or asks to click/type/search in an app, this is Yan Computer Use: never launch it with execute_shell. First call search_capabilities(category="mcp", query="Yan Computer Use Windows app observe click type") and then use one returned Windows-MCP capability at a time, observing again after every action.',
      '- When the user says to enter a newly created folder, create it inside the current workspace, then call change_workspace with that folder path. Do not keep issuing shell commands while claiming the workspace changed; verify the change_workspace result before continuing.',
      '- For local HTML, web UI, or games, open_builtin_browser is the normal verification endpoint. After it loads, use browser_snapshot and only the minimal browser_* interactions needed to verify the visible page. Computer Use and Playwright are not substitutes for it.',
      '- Destructive or system-changing shell commands require user approval at execution time; prefer non-destructive alternatives when equivalent.'
    ];
    const accessMode = String(runCtx?.accessMode || 'request');
    if (accessMode === 'delegate') {
      lines.push('- The user selected “替我审批”: normal Shell operations and concrete workspace requests are pre-approved. Stay within the assigned workspace; do not widen scope or use destructive commands.');
    } else if (accessMode === 'full') {
      lines.push('- The user selected “完全访问”: normal operations are pre-approved and explicit absolute paths may be used when needed. Remain task-scoped, respect disabled settings, and do not run destructive or system-changing commands.');
    } else {
      lines.push('- The user selected “请求批准”: request approval before Shell execution or assigning a new workspace.');
    }
    if (plan.readOnly) {
      lines.push('- The user asked for analysis/review only: do not modify files unless they explicitly ask for changes.');
    }
    if (plan.workspace && !plan.workspaceAvailable) {
      lines.push('- This task may need files, but no workspace is assigned. Before any file or shell action, call request_workspace with a concrete reason and suggested location. Do not guess an absolute path or silently use an old/global workspace.');
    } else if (!plan.workspaceAvailable) {
      lines.push('- No workspace is assigned. Continue in chat unless a durable file artifact becomes necessary; if you decide one is necessary, call request_workspace and wait for user approval first.');
    }
    if (plan.webPreview && !plan.browserAutomation) {
      lines.push('- This is a normal web-preview task, not external browser automation. Run syntax/build checks, then open the real HTML/HTTP page with open_builtin_browser. Use browser_snapshot and minimal browser_* interactions on that visible page for real verification. Do not create Playwright/Puppeteer/Selenium scripts, launch an external browser, or treat an image screenshot as a loaded page.');
    }
    if (plan.deniedCapabilities?.size) {
      lines.push(`- Explicit user exclusions for this run: ${[...plan.deniedCapabilities].join(', ')}. Do not search for or invoke them.`);
    }
    return lines.join('\n');
  }

  function capabilityCategoryForTool(name) {
    return CAPABILITY_CATEGORY_BY_TOOL[String(name || '')] || 'code';
  }

  function tokenizeCapabilityText(value) {
    const text = normalizeText(value);
    const tokens = text.match(/[a-z0-9_.:-]+|[\u3400-\u4dbf\u4e00-\u9fff]+/g) || [];
    const out = [];
    for (const token of tokens) {
      if (/^[\u3400-\u4dbf\u4e00-\u9fff]+$/.test(token)) {
        for (const char of token) out.push(char);
        for (let i = 0; i < token.length - 1; i++) out.push(token.slice(i, i + 2));
      } else {
        out.push(token);
        for (const part of token.split(/[_.:-]+/)) if (part && part !== token) out.push(part);
      }
    }
    return out.filter(Boolean);
  }

  function makeCapabilityEntry({ id, kind, category, name, description, inputSchema, searchText, target }) {
    return {
      id,
      kind,
      category,
      name,
      description: String(description || name || '').replace(/\s+/g, ' ').trim(),
      inputSchema: inputSchema || { type: 'object', properties: {} },
      searchText: `${name || ''} ${description || ''} ${CAPABILITY_SEARCH_ALIASES[category] || ''} ${searchText || ''}`,
      target
    };
  }

  function buildCapabilityIndex(runCtx) {
    const entries = [];
    const core = K.CORE_TOOL_NAMES || new Set();
    for (const tool of K.snapshotAllNativeTools?.() || []) {
      const name = String(tool?.function?.name || '');
      if (!name || core.has(name) || name === 'request_capability' || INTERNAL_NATIVE_TOOLS.has(name)) continue;
      const category = capabilityCategoryForTool(name);
      entries.push(makeCapabilityEntry({
        id: `native:${name}`,
        kind: 'native',
        category,
        name,
        description: tool.function.description,
        inputSchema: tool.function.parameters,
        target: { toolName: name, definition: tool }
      }));
    }

    for (const skill of runCtx?.capabilityPlan?.catalog?.installed || []) {
      const id = String(skill?.id || '').trim();
      if (!id) continue;
      entries.push(makeCapabilityEntry({
        id: `skill:${id}`,
        kind: 'skill',
        category: 'skill',
        name: String(skill.name || id),
        description: String(skill.desc || 'Installed Skill playbook'),
        inputSchema: {
          type: 'object',
          properties: {
            task_context: { type: 'string', description: '传给 Skill 的当前任务上下文（可选）' }
          }
        },
        searchText: `${id} ${(skill.tags || []).join(' ')} ${(skill.triggers || []).join(' ')}`,
        target: { skillId: id }
      }));
    }

    for (const [fullName, route] of K.getMcpToolMap?.() || []) {
      entries.push(makeCapabilityEntry({
        id: `mcp:${fullName}`,
        kind: 'mcp',
        category: 'mcp',
        name: `${route.serverName || route.serverId} / ${route.toolName}`,
        description: route.description || route.toolName,
        inputSchema: route.inputSchema,
        searchText: `${fullName} ${route.serverId || ''} ${route.serverName || ''}`,
        target: { toolName: fullName, route }
      }));
    }

    const index = new Map(entries.map(entry => [entry.id, entry]));
    if (runCtx) runCtx.capabilityIndex = index;
    return entries;
  }

  function rankCapabilities(entries, query) {
    const queryText = normalizeText(query);
    const queryTokens = [...new Set(tokenizeCapabilityText(queryText))];
    const docs = entries.map(entry => tokenizeCapabilityText(entry.searchText));
    const documentFrequency = new Map();
    for (const tokens of docs) {
      for (const token of new Set(tokens)) {
        documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
      }
    }
    const averageLength = docs.length
      ? docs.reduce((sum, tokens) => sum + tokens.length, 0) / docs.length
      : 1;
    const total = Math.max(1, docs.length);
    return entries.map((entry, index) => {
      const tokens = docs[index];
      const frequencies = new Map();
      for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
      let score = 0;
      for (const token of queryTokens) {
        const frequency = frequencies.get(token) || 0;
        if (!frequency) continue;
        const df = documentFrequency.get(token) || 0;
        const idf = Math.log(1 + ((total - df + 0.5) / (df + 0.5)));
        const denominator = frequency + 1.2 * (0.25 + 0.75 * (tokens.length / Math.max(1, averageLength)));
        score += idf * ((frequency * 2.2) / denominator);
      }
      const haystack = normalizeText(entry.searchText);
      if (queryText && haystack.includes(queryText)) score += 8;
      if (queryText === normalizeText(entry.name) || queryText === normalizeText(entry.id)) score += 20;
      return { entry, score };
    }).sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  }

  function capabilityIsDenied(entry, plan) {
    const denied = plan?.deniedCapabilities;
    if (!(denied instanceof Set)) return '';
    if (entry.category === 'git' && denied.has('git')) return '用户明确禁止本次任务使用 Git。';
    if (entry.kind === 'mcp') {
      if (denied.has('mcp')) return '用户明确禁止本次任务使用 MCP。';
      if (entry.target?.route?.isWindowsMcp && denied.has('computer_use')) return '用户明确禁止本次任务使用 Computer Use。';
      if (entry.target?.route?.isPlaywright && denied.has('browser_automation')) return '用户明确禁止本次任务使用浏览器自动化。';
    }
    if (entry.category === 'media' && denied.has('media')) return '用户明确禁止本次任务使用图片生成或编辑能力。';
    return '';
  }

  function capabilityIntentGate(entry, plan) {
    const denied = capabilityIsDenied(entry, plan);
    if (denied) return { ok: false, message: denied, code: 'CAPABILITY_DENIED_BY_USER' };
    if (entry.category === 'git') {
      const toolName = entry.target?.toolName || '';
      if (!plan?.git) {
        return { ok: false, message: '用户没有要求本次任务使用 Git。', code: 'GIT_NOT_REQUESTED' };
      }
      if (['git_commit', 'git_push', 'git_pull', 'git_clone'].includes(toolName)
          && !(plan.requestedToolNames instanceof Set && plan.requestedToolNames.has(toolName))) {
        return { ok: false, message: `用户没有要求执行 ${toolName}。`, code: 'GIT_ACTION_NOT_REQUESTED' };
      }
    }
    if (entry.category === 'media' && !plan?.mediaRequested) {
      return { ok: false, message: '用户没有要求生成或编辑图片。', code: 'MEDIA_NOT_REQUESTED' };
    }
    if (entry.kind === 'mcp') {
      const route = entry.target?.route || {};
      if (route.isWindowsMcp && !plan?.desktop) {
        return { ok: false, message: '用户没有要求控制桌面。', code: 'COMPUTER_USE_NOT_REQUESTED' };
      }
      if (route.isPlaywright && !plan?.browserAutomation) {
        return { ok: false, message: '用户没有要求浏览器自动化。', code: 'BROWSER_AUTOMATION_NOT_REQUESTED' };
      }
      if (!route.isWindowsMcp && !route.isPlaywright && !plan?.mcpRequested) {
        const task = normalizeText(plan?.taskText);
        const server = normalizeText(route.serverName || route.serverId);
        if (!server || !task.includes(server)) {
          return { ok: false, message: '用户没有明确要求调用该外部 MCP 集成。', code: 'MCP_NOT_REQUESTED' };
        }
      }
    }
    return { ok: true };
  }

  async function searchCapabilities(runCtx, args = {}) {
    const query = String(args.query || '').trim();
    const category = String(args.category || 'all').trim().toLowerCase();
    const limit = Math.max(1, Math.min(8, Number(args.limit) || 5));
    if (!query) return { ok: false, message: 'query is required.' };

    let refresh = null;
    const wantsMcp = category === 'mcp'
      || /\bmcp\b|computer[\s-]*use|yan\s*computer|playwright|windows|桌面|电脑|应用|窗口|浏览器自动化/i.test(query);
    const plan = runCtx?.capabilityPlan;
    const mcpIntentAllowed = !!(plan?.desktop || plan?.browserAutomation || plan?.mcpRequested);
    if (wantsMcp && mcpIntentAllowed && !plan?.deniedCapabilities?.has('mcp')) {
      refresh = await K.refreshMcpTools?.();
      if (runCtx) runCtx.mcpToolMapSnapshot = new Map(K.getMcpToolMap?.() || []);
    }

    const allEntries = buildCapabilityIndex(runCtx);
    const candidates = allEntries.filter(entry => (
      (category === 'all' || entry.category === category)
      && capabilityIntentGate(entry, plan).ok
    ));
    const ranked = rankCapabilities(candidates, query);
    const positive = ranked.filter(item => item.score > 0);
    const selected = positive.slice(0, limit).map(item => item.entry);
    if (runCtx) {
      if (!(runCtx.discoveredCapabilityIds instanceof Set)) runCtx.discoveredCapabilityIds = new Set();
      for (const entry of selected) runCtx.discoveredCapabilityIds.add(entry.id);
    }

    return {
      ok: true,
      results: selected.map(entry => ({
        capability_id: entry.id,
        kind: entry.kind,
        category: entry.category,
        name: entry.name,
        description: entry.description.slice(0, 600),
        input_schema: entry.inputSchema
      })),
      total_hidden_capabilities: allEntries.length,
      status: refresh?.errors?.length ? 'partial' : 'ready',
      note: refresh?.errors?.length
        ? `部分 MCP 服务器连接失败：${refresh.errors.map(error => `${error.serverName}: ${error.error}`).join('；')}`
        : undefined
    };
  }

  function getCapabilityEntry(runCtx, capabilityId) {
    return runCtx?.capabilityIndex instanceof Map
      ? runCtx.capabilityIndex.get(String(capabilityId || '').trim()) || null
      : null;
  }

  function validateCapabilityUse(runCtx, entry) {
    if (!entry) return { ok: false, message: '能力不存在或索引已失效，请重新调用 search_capabilities。', code: 'CAPABILITY_NOT_FOUND' };
    if (!(runCtx?.discoveredCapabilityIds instanceof Set) || !runCtx.discoveredCapabilityIds.has(entry.id)) {
      return { ok: false, message: '该能力尚未在本轮通过 search_capabilities 发现，禁止直接猜测 capability_id。', code: 'CAPABILITY_NOT_DISCOVERED' };
    }
    const intent = capabilityIntentGate(entry, runCtx?.capabilityPlan);
    if (!intent.ok) return intent;

    const plan = runCtx?.capabilityPlan;
    if (entry.category === 'git') {
      const toolName = entry.target?.toolName || '';
      const requested = plan?.requestedToolNames instanceof Set && plan.requestedToolNames.has(toolName);
      if (['git_commit', 'git_push', 'git_pull', 'git_clone'].includes(toolName) && !requested) {
        return { ok: false, message: `用户没有明确要求本次任务执行 ${toolName || 'Git'}；请继续使用工作区工具，不要擅自进行版本控制操作。`, code: 'GIT_NOT_REQUESTED' };
      }
    }
    return { ok: true };
  }

  function getCapabilityToolBlock() {
    return null;
  }

  async function refreshMcpCapabilityTools(runCtx) {
    await K.refreshMcpTools();
    const allTools = K.snapshotTools();
    const plan = runCtx?.capabilityPlan;
    if (plan) {
      plan.knownToolNames = new Set(allTools.map(tool => tool?.function?.name).filter(Boolean));
      runCtx.mcpToolMapSnapshot = new Map(K.getMcpToolMap());
    }
    return allTools;
  }

  function findInstalledSkill(plan, idOrQuery) {
    const query = normalizeText(idOrQuery);
    if (!query) return null;
    const installed = plan?.catalog?.installed || [];
    return installed.find(skill => normalizeText(skill.id) === query)
      || installed.find(skill => normalizeText(skill.name) === query)
      || selectSkills({ installed }, query, 1)[0]
      || null;
  }

  async function grantCapability(runCtx, args = {}) {
    const plan = runCtx?.capabilityPlan;
    const capability = String(args.capability || '').trim();
    const reason = String(args.reason || '').trim();
    if (!plan) return { ok: false, nonFatal: true, message: 'This run does not have a capability plan. Use the stable core tools.' };
    if (!reason) return { ok: false, nonFatal: true, message: 'Explain the concrete blocker before requesting a capability.' };
    const taskText = plan.taskText || '';

    // Skill loading is a real grant: it injects a playbook the model doesn't have.
    if (capability === 'skill') {
      const skill = findInstalledSkill(plan, args.skill_id || args.query);
      if (!skill) return { ok: false, nonFatal: true, message: 'No installed Skill matches this need. Continue without one or ask the user to install it from the Skill market.' };
      const loaded = await loadSkillPlaybooks([skill], taskText);
      if (!loaded.length) return { ok: false, nonFatal: true, message: `Unable to load installed Skill: ${skill.id}. Continue without it.` };
      if (!plan.selectedSkills.some(item => item.id === loaded[0].id)) plan.selectedSkills.push(loaded[0]);
      plan.grantedCapabilities.add(`skill:${loaded[0].id}`);
      return { ok: true, message: `Skill loaded: ${loaded[0].name} (${loaded[0].id}). Follow this playbook:\n\n${loaded[0].prompt}`, meta: { skillId: loaded[0].id } };
    }

    // Legacy MCP refresh only refreshes the hidden catalog. Individual schemas
    // remain behind search_capabilities/use_capability.
    if (capability === 'mcp' || capability === 'computer_use' || capability === 'browser_automation') {
      if (plan.deniedCapabilities?.has('mcp')) {
        return { ok: false, nonFatal: true, message: '用户已明确禁止本次任务使用 MCP。', meta: { code: 'CAPABILITY_DENIED_BY_USER' } };
      }
      await refreshMcpCapabilityTools(runCtx);
      plan.grantedCapabilities.add(capability);
      return { ok: true, message: `已刷新 ${capability} 的隐藏能力目录。请调用 search_capabilities 查找具体能力，再通过 use_capability 调用。`, meta: { capability } };
    }

    if (capability === 'workspace_write' || capability === 'edit') {
      return {
        ok: false,
        nonFatal: true,
        message: '模型不能自行把只读任务升级为可写任务。只有用户明确要求修改，且设置中的文件写入权限已开启时，内核才允许写入。',
        meta: { code: 'CAPABILITY_REQUIRES_USER' }
      };
    }
    plan.grantedCapabilities.add(capability || 'unknown');
    return { ok: false, nonFatal: true, message: '请改用 search_capabilities 查找具体能力；运行时不会通过模糊类别解锁工具。', meta: { capability, code: 'USE_CAPABILITY_SEARCH' } };
  }

  function taskMayNeedMcp(messages) {
    const taskText = getTaskText(messages);
    if (!hasOperationalAction(taskText)) return false;
    if (NEGATED_MCP_RE.test(taskText)) return false;
    return DESKTOP_RE.test(taskText)
      || BROWSER_AUTOMATION_RE.test(taskText)
      || /(?:使用|调用|连接|启动|测试).{0,12}\bmcp\b|\bmcp\b.{0,12}(?:工具|服务器).{0,8}(?:运行|启动|连接|测试)/i.test(taskText);
  }

  function taskRequiresWindowsMcp(messages) {
    const taskText = getTaskText(messages);
    return hasOperationalAction(taskText)
      && DESKTOP_RE.test(taskText)
      && !NEGATED_COMPUTER_RE.test(taskText)
      && !NEGATED_MCP_RE.test(taskText);
  }

  K.getTaskText = getTaskText;
  K.detectExplicitWorkspaceTarget = detectExplicitWorkspaceTarget;
  K.assignRunWorkspace = assignRunWorkspace;
  K.planRunCapabilities = planRunCapabilities;
  K.getToolsForRun = getToolsForRun;
  K.getCapabilityPlanPrompt = getCapabilityPlanPrompt;
  K.buildCapabilityIndex = buildCapabilityIndex;
  K.searchCapabilities = searchCapabilities;
  K.getCapabilityEntry = getCapabilityEntry;
  K.validateCapabilityUse = validateCapabilityUse;
  K.getCapabilityToolBlock = getCapabilityToolBlock;
  K.grantCapability = grantCapability;
  K.taskMayNeedMcp = taskMayNeedMcp;
  K.taskRequiresWindowsMcp = taskRequiresWindowsMcp;
})(window.YanKernel);
