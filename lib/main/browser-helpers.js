'use strict';

// Browser guest helpers (plan T6.3): page-URL classification, the webview
// context menu, guest hardening and the proxy/session reset. Split out of
// lib/main/bridges.js to stay inside the 800-line domain-module budget.

function createBrowserHelpers(ctx, deps) {
  const { shell, clipboard, Menu, session } = ctx;
  const { getMainWindow } = deps;

  function isBrowserPageUrl(url) {
    return /^(?:https?|file):/i.test(String(url || '').trim());
  }

  function isExternalBrowserUrl(url) {
    return /^https?:/i.test(String(url || '').trim());
  }

  function sendBrowserNewTab(url) {
    const targetUrl = String(url || '').trim();
    if (!isBrowserPageUrl(targetUrl) || !getMainWindow() || getMainWindow().isDestroyed()) return false;
    getMainWindow().webContents.send('browser:new-tab-request', { url: targetUrl });
    return true;
  }

  function getBrowserNavigationState(contents) {
    const history = contents.navigationHistory;
    return {
      canGoBack: history?.canGoBack?.() ?? contents.canGoBack?.() ?? false,
      canGoForward: history?.canGoForward?.() ?? contents.canGoForward?.() ?? false,
      goBack: () => {
        if (typeof history?.goBack === 'function') return history.goBack();
        return contents.goBack?.();
      },
      goForward: () => {
        if (typeof history?.goForward === 'function') return history.goForward();
        return contents.goForward?.();
      }
    };
  }

  function runBrowserMediaAction(contents, params, action) {
    const x = Math.round(Number(params.x) || 0);
    const y = Math.round(Number(params.y) || 0);
    contents.executeJavaScript(`(() => {
      const target = document.elementFromPoint(${x}, ${y});
      const media = target?.closest?.('video, audio') || (target instanceof HTMLMediaElement ? target : null);
      if (!media) return false;
      switch (${JSON.stringify(action)}) {
        case 'toggle-play': media.paused ? media.play() : media.pause(); break;
        case 'toggle-mute': media.muted = !media.muted; break;
        case 'toggle-loop': media.loop = !media.loop; break;
        case 'toggle-controls': media.controls = !media.controls; break;
        default: return false;
      }
      return true;
    })()`, true).catch(() => {});
  }

  function buildBrowserContextMenu(contents, params) {
    const template = [];
    const addSeparator = () => {
      if (template.length && template.at(-1)?.type !== 'separator') template.push({ type: 'separator' });
    };
    const pageUrl = String(params.pageURL || contents.getURL?.() || '').trim();
    const linkUrl = String(params.linkURL || '').trim();
    const mediaUrl = String(params.srcURL || '').trim();
    const selection = String(params.selectionText || '').replace(/\s+/g, ' ').trim();
    const editFlags = params.editFlags || {};

    if (isBrowserPageUrl(linkUrl)) {
      template.push(
        { label: '在新标签页中打开链接', click: () => sendBrowserNewTab(linkUrl) },
        ...(isExternalBrowserUrl(linkUrl)
          ? [{ label: '在系统浏览器中打开链接', click: () => shell.openExternal(linkUrl).catch(() => {}) }]
          : []),
        { label: '复制链接地址', click: () => clipboard.writeText(linkUrl) }
      );
    }

    if (params.mediaType === 'image' && isBrowserPageUrl(mediaUrl)) {
      addSeparator();
      template.push(
        { label: '在新标签页中打开图片', click: () => sendBrowserNewTab(mediaUrl) },
        { label: '复制图片', click: () => contents.copyImageAt(params.x, params.y) },
        { label: '复制图片地址', click: () => clipboard.writeText(mediaUrl) }
      );
    }

    if (['audio', 'video'].includes(params.mediaType)) {
      const mediaFlags = params.mediaFlags || {};
      addSeparator();
      template.push({
        label: mediaFlags.isPaused ? '播放' : '暂停',
        enabled: !mediaFlags.inError,
        click: () => runBrowserMediaAction(contents, params, 'toggle-play')
      });
      if (mediaFlags.hasAudio) {
        template.push({
          label: mediaFlags.isMuted ? '取消静音' : '静音',
          click: () => runBrowserMediaAction(contents, params, 'toggle-mute')
        });
      }
      template.push({
        label: '循环播放',
        type: 'checkbox',
        checked: !!mediaFlags.isLooping,
        click: () => runBrowserMediaAction(contents, params, 'toggle-loop')
      });
      if (params.mediaType === 'video' && mediaFlags.canToggleControls !== false) {
        template.push({
          label: '显示控件',
          type: 'checkbox',
          checked: !!mediaFlags.isControlsVisible,
          click: () => runBrowserMediaAction(contents, params, 'toggle-controls')
        });
      }
      if (isBrowserPageUrl(mediaUrl)) {
        template.push(
          { label: `在新标签页中打开${params.mediaType === 'video' ? '视频' : '音频'}`, click: () => sendBrowserNewTab(mediaUrl) },
          { label: '复制媒体地址', click: () => clipboard.writeText(mediaUrl) }
        );
      }
    }

    if (params.isEditable) {
      addSeparator();
      const suggestions = Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions.slice(0, 5) : [];
      for (const suggestion of suggestions) {
        template.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
      }
      if (suggestions.length) addSeparator();
      template.push(
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', enabled: !!editFlags.canUndo, click: () => contents.undo() },
        { label: '重做', accelerator: 'CmdOrCtrl+Y', enabled: !!editFlags.canRedo, click: () => contents.redo() },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', enabled: !!editFlags.canCut, click: () => contents.cut() },
        { label: '复制', accelerator: 'CmdOrCtrl+C', enabled: !!editFlags.canCopy, click: () => contents.copy() },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', enabled: !!editFlags.canPaste, click: () => contents.paste() },
        { label: '删除', enabled: !!editFlags.canDelete, click: () => contents.delete() },
        { type: 'separator' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', enabled: editFlags.canSelectAll !== false, click: () => contents.selectAll() }
      );
      if (params.misspelledWord && contents.session.getSpellCheckerEnabled?.()) {
        template.push({
          label: '添加到词典',
          click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
        });
      }
    } else if (selection) {
      addSeparator();
      const displaySelection = selection.length > 28 ? `${selection.slice(0, 28)}…` : selection;
      template.push(
        { label: '复制', accelerator: 'CmdOrCtrl+C', click: () => contents.copy() },
        {
          label: `使用 Bing 搜索“${displaySelection}”`,
          click: () => sendBrowserNewTab(`https://www.bing.com/search?q=${encodeURIComponent(selection)}`)
        }
      );
    }

    addSeparator();
    const navigation = getBrowserNavigationState(contents);
    template.push(
      { label: '后退', enabled: !!navigation.canGoBack, click: navigation.goBack },
      { label: '前进', enabled: !!navigation.canGoForward, click: navigation.goForward },
      contents.isLoading()
        ? { label: '停止加载', click: () => contents.stop() }
        : { label: '刷新', accelerator: 'CmdOrCtrl+R', click: () => contents.reload() }
    );

    if (isBrowserPageUrl(pageUrl)) {
      addSeparator();
      template.push({ label: '复制页面地址', click: () => clipboard.writeText(pageUrl) });
      if (isExternalBrowserUrl(pageUrl)) {
        template.push({ label: '在系统浏览器中打开页面', click: () => shell.openExternal(pageUrl).catch(() => {}) });
      }
      template.push({
        label: '打印页面',
        click: () => contents.print({ printBackground: true }, (success, reason) => {
          if (!success) console.warn('[browser] print failed:', reason);
        })
      });
    }

    addSeparator();
    template.push({ label: '检查元素', click: () => contents.inspectElement(params.x, params.y) });
    while (template.at(-1)?.type === 'separator') template.pop();
    return template;
  }

  return {
    isBrowserPageUrl,
    isExternalBrowserUrl,
    sendBrowserNewTab,
    getBrowserNavigationState,
    runBrowserMediaAction,
    buildBrowserContextMenu,
  };
}

module.exports = { createBrowserHelpers };
