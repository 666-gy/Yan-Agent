/* Hallmark · reference-led component / Yan tokens · P5 H5 E5 S5 R5 V4 */
window.YanPluginExamples = (() => {
  const examples = {
    'yan-computer-use': [
      '播放一个歌单，帮我进入专注状态。',
      '在 Visual Studio 中构建并运行我已经打开的项目。',
      '打开记事本，把我提供的要点整理成一份清晰的草稿。'
    ],
    remotion: [
      '制作一个包含 5 根柱子的动态柱状图。',
      '为我的视频频道制作一个带动画的订阅按钮。',
      '为一段视频添加逐字字幕、背景音乐和片尾动画。'
    ],
    hyperframes: [
      '把当前项目做成一段 20 秒的产品介绍视频。',
      '制作一段带字幕、配音和转场的竖屏短视频。',
      '用现有素材制作一个可预览的动画开场。'
    ],
    figma: [
      '根据我提供的 Figma 设计，在当前项目中实现对应页面。',
      '对照 Figma 设计检查当前页面的布局、字体和间距。',
      '把项目中的组件与 Figma 组件建立 Code Connect 映射。'
    ],
    canva: [
      '把产品介绍整理成一份符合品牌风格的演示文稿。',
      '将现有设计调整为适合多个社交平台的尺寸。',
      '根据表格中的内容，批量生成一组宣传海报。'
    ],
    'game-studio': [
      '制作一个可以直接试玩的 2D 平台跳跃小游戏。',
      '为当前游戏添加计分、暂停菜单和重新开始功能。',
      '试玩当前游戏，检查操作反馈和界面问题并修复。'
    ],
    circleci: [
      '检查当前项目最近失败的 CircleCI 流水线，定位失败原因。',
      '检查 CircleCI 配置，优化重复步骤和依赖缓存。'
    ],
    'build-ios-apps': [
      '为当前 iOS 项目实现一个 SwiftUI 设置页。',
      '检查当前 SwiftUI 页面，定位滚动卡顿和不必要的刷新。',
      '为应用添加 App Intents，让常用操作可以通过快捷指令调用。'
    ],
    'build-macos-apps': [
      '为当前 macOS 应用实现一个带侧边栏的设置窗口。',
      '检查应用的窗口管理与键盘快捷键，并修复交互问题。',
      '检查 macOS 应用的打包、签名和公证配置。'
    ]
  };
  const arrow = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
  function prompts(item) { return examples[item.id] || ['结合当前工作区，帮我完成一个适合此插件的任务。']; }
  function renderExamples(item, items, actionAttribute) {
    return `<section class="plugin-examples${item.id === 'yan-computer-use' ? ' plugin-examples-computer' : ''}" aria-label="${escapeAttr(item.name)} 使用示例">${items.map((prompt, index) => `
      <div class="plugin-example-row"><p class="plugin-example-copy"><span class="plugin-example-brand">${skillLogoHtml(item)}<span>${escapeHtml(item.name)}</span></span> <span class="plugin-example-prompt">${escapeHtml(prompt)}</span></p><button type="button" class="plugin-example-send icon-btn" ${actionAttribute}="example" data-example-index="${index}" title="在新任务中填入，不发送" aria-label="使用示例 ${index + 1}：在新任务中填入，不发送">${arrow}</button></div>`).join('')}</section>`;
  }
  async function createDraft(prompt, selectCapability) {
    if (!prompt) throw new Error('示例不存在');
    // Finish any existing creation before requesting a genuinely new task.
    if (newSessionPromise) await newSessionPromise;
    const previousId = state.currentSession?.id;
    await newSession({ forceNew: true });
    if (!state.currentSession?.id || state.currentSession.id === previousId) throw new Error('未能创建新任务，请重试');
    const text = prompt;
    setComposerText(text, { preserveSkills: false });
    selectCapability();
    autoGrow(); updateSendState();
    input.focus({ preventScroll: true });
    setComposerCaretByTextOffset(text.length);
    captureComposerDraftForSession();
  }
  let draftPromise = null;
  function openDraft(prompt, selectCapability) {
    if (draftPromise) return draftPromise;
    draftPromise = createDraft(prompt, selectCapability).finally(() => { draftPromise = null; });
    return draftPromise;
  }
  // Skills and plugins share the panel and new-session/draft path. Only the
  // selected capability token differs; neither path activates or sends it.
  window.YanCapabilityExamples = { render: renderExamples, openDraft };
  return {
    render: item => renderExamples(item, prompts(item), 'data-plugin-action'),
    openDraft: (item, index) => openDraft(prompts(item)[index], () => window.YanComposerPlugins.set([item]))
  };
})();
