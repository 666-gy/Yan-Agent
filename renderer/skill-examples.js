/* Skill prompts use the existing plugin example panel and composer draft flow. */
window.YanSkillExamples = (() => {
  const examples = {
    'yan-computer-use': [
      '播放一个歌单，帮我进入专注状态。',
      '在 Visual Studio 中构建并运行我已经打开的项目。',
      '打开记事本，把我提供的要点整理成一份清晰的草稿。'
    ],
    'yan-uiverse': [
      '为当前页面添加一组风格统一的按钮、输入框和卡片。',
      '用现有 Uiverse 组件完善页面的导航和空状态。'
    ],
    'market-anysearch': [
      '搜索当前项目所用技术的官方文档，整理实现下一步功能所需的资料。',
      '对比三个解决当前问题的开源项目，附上来源和适用场景。'
    ],
    'andrej-karpathy-skills': [
      '检查当前改动是否包含多余假设或无关修改，提出最小修正方案。',
      '先梳理需求、约束和验收标准，再完成当前任务。'
    ],
    'awesome-design-md': [
      '为当前产品挑选一种合适的品牌视觉参考，并整理成设计规范。',
      '参考一个简洁的品牌设计体系，改善当前页面的字体、颜色和间距。'
    ],
    'code-simplifier': [
      '简化当前未提交的代码改动，保持功能与行为不变。',
      '找出当前模块中重复的逻辑，用更清晰的实现整理它。'
    ],
    'codebase-design': [
      '梳理当前代码库的模块边界，指出耦合最严重的位置。',
      '为当前功能设计一个清晰、可测试的接口，并说明取舍。'
    ],
    'diagnosing-bugs': [
      '调查当前项目启动失败的原因，先复现并收集证据，再修复。',
      '定位当前页面卡顿的原因，验证最小修复是否有效。'
    ],
    'domml-creator': [
      '制作一只像素风橘猫桌面宠物，包含待机、走路和开心动作。',
      '制作一只圆滚滚的小企鹅桌面宠物，完成后安装到 Yan。'
    ],
    hallmark: [
      '检查当前页面的视觉层级和布局，给出具体改进并落地。',
      '为当前产品制作一个有鲜明视觉风格的首页。'
    ],
    hyperframes: [
      '把当前项目做成一段 20 秒的产品介绍视频。',
      '制作一段带字幕、配音和转场的竖屏短视频。',
      '用现有素材制作一个可预览的动画开场。'
    ],
    'hyperframes-cli': [
      '检查当前 HyperFrames 项目，修复校验错误并生成预览。',
      '将当前 HyperFrames 视频渲染为 MP4，并检查输出。'
    ],
    gsap: ['为当前 HyperFrames 视频添加可精确定位时间的标题入场动画。'],
    'hyperframes-registry': ['为当前视频选择并接入一个合适的 HyperFrames 转场区块。'],
    'website-to-hyperframes': ['把当前项目的网站做成一段包含分镜、配音和字幕的产品演示视频。'],
    'mcp-puller': [
      '帮我接入官方 GitHub MCP，先核对来源和安装要求。',
      '为当前项目寻找合适的 MCP 服务，说明用途和配置步骤。'
    ],
    officecli: [
      '把当前项目整理成一份包含架构、功能和使用方法的 Word 文档。',
      '制作一份 Excel 项目进度表，包含任务、负责人、截止日期和完成率。',
      '把当前产品的核心功能做成一份 6 页的 PowerPoint 演示文稿。'
    ],
    'ponytail-audit': [
      '审计当前仓库的复杂度，按收益列出可以删除、简化或替换的部分。',
      '找出仓库里维护成本最高的抽象，给出有代码依据的精简建议。'
    ],
    'ponytail-review': [
      '审阅当前未提交的差异，找出过度设计和可以省掉的代码。',
      '检查当前改动是否引入了不必要的封装、配置或依赖。'
    ],
    'protocol-reverse': [
      '分析工作区中的二进制样本，找出可能的字段边界和编码规律。',
      '根据现有协议样本编写解析器，并用样本回放验证结果。'
    ],
    'remotion-best-practices': [
      '制作一个包含 5 根柱子的动态柱状图。',
      '为我的视频频道制作一个带动画的订阅按钮。',
      '为一段视频添加逐字字幕、背景音乐和片尾动画。'
    ],
    'skill-creator': [
      '把我反复执行的代码审查流程整理成一个可复用的技能。',
      '为当前项目创建一个技能，涵盖启动、测试和常见故障排查。'
    ],
    tasteskill: [
      '改善当前页面的排版、颜色和留白，让视觉风格更完整。',
      '为当前产品设计并实现一个有辨识度的响应式首页。',
      '检查当前界面的交互状态和移动端布局，并修复问题。'
    ],
    'tasteskill-brandkit': ['为当前产品制定品牌配色、字体和图像方向，整理成品牌套件。'],
    'tasteskill-brutalist': ['将当前页面改造成高对比、强排版的粗野主义界面。'],
    'tasteskill-gpt-taste': ['为当前网站首页设计鲜明的视觉层级和细腻的交互动效。'],
    'tasteskill-image-to-code': ['先为当前产品生成视觉参考，再据此实现响应式页面。'],
    'tasteskill-imagegen-mobile': ['为当前产品生成一组风格统一的移动端界面参考图。'],
    'tasteskill-imagegen-web': ['按页面区块为当前网站生成完整的视觉参考图。'],
    'tasteskill-minimalist': ['用克制的黑白配色和编辑式排版改进当前页面。'],
    'tasteskill-output': ['完整实现当前页面，补齐交互和状态，交付可运行代码。'],
    'tasteskill-redesign': ['审计并修复当前页面的视觉层级、间距和响应式问题。'],
    'tasteskill-soft': ['为当前界面设计柔和配色、分明层次和流畅的交互动效。'],
    'tasteskill-stitch': ['为当前产品编写可用于 Google Stitch 的 DESIGN.md 设计规范。'],
    'writing-for-agents': [
      '检查当前项目的 AGENTS.md，精简重复规则并消除冲突。',
      '为当前项目编写一份清晰、精简且可执行的 Agent 工作说明。'
    ],
    'yan-codegraph': [
      '梳理当前项目的入口、核心模块和依赖关系。',
      '追踪当前功能的调用链，指出修改它可能影响的模块。'
    ],
    'yan-prompt-optimizer': [
      '把这个需求整理成清晰的执行提示词：检查项目，修复问题，再补齐验证。',
      '优化这段提示词，保持原意和范围：帮我改好首页，让手机上也好用。'
    ],
    'yan-serena': [
      '定位当前项目的核心入口符号，解释它们的调用关系。',
      '找出当前模块的引用关系，并提出最小范围的重构方案。'
    ]
  };
  function prompts(item) {
    return examples[item.id] || [`阅读技能说明，给出一个适合 ${item.name || item.id} 的具体用例，并带我完成。`];
  }
  function render(item) {
    return window.YanCapabilityExamples.render(item, prompts(item), 'data-skill-example-action');
  }
  let busy = false;
  function bind(content, item) {
    content.querySelectorAll('[data-skill-example-action]').forEach(button => {
      button.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        try {
          await window.YanCapabilityExamples.openDraft(prompts(item)[Number(button.dataset.exampleIndex)], () => setComposerSkills([item]));
        } catch (error) { toast(error.message || String(error)); }
        finally {
          busy = false;
          button.disabled = false;
          button.removeAttribute('aria-busy');
        }
      });
    });
  }
  return { prompts, render, bind };
})();
