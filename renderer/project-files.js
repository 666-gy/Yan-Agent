'use strict';

(() => {
  const caches = new Map();
  let current = null;
  let panel;
  let breadcrumb;
  let menuVersion = 0;
  let selectedApp = 'explorer';
  let closePending = false;
  const folderIcon = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 9.268C3.3812 9.6253 3 10.2855 3 11V19C3 20.1046 3.8954 21 5 21H14C14.7145 21 15.3747 20.6188 15.732 20M8 5C8 3.8954 8.8954 3 10 3L11.1716 3C11.702 3 12.2107 3.2107 12.5858 3.5858L13.4142 4.4142C13.7893 4.7893 14.298 5 14.8284 5L19 5C20.1046 5 21 5.8954 21 7L21 14C21 15.1046 20.1046 16 19 16L10 16C8.8954 16 8 15.1046 8 14Z\"/></svg>";
  let tabCounter = 0;
  const refreshIcon = () => document.querySelector('[data-browser-action="reload"] svg')?.outerHTML || document.querySelector('#browserTabTemplate')?.content.querySelector('[data-browser-action="reload"] svg')?.outerHTML || '';
  const chevron = expanded => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (expanded ? 'M6 9L12 15L18 9' : 'M9 6L15 12L9 18') + '"/></svg>';
  const notice = (title, message) => '<div class="pf-welcome">' + folderIcon + '<h2>' + esc(title) + '</h2><p>' + esc(message) + '</p></div>';
  const welcome = () => '<div class="pf-welcome">' + folderIcon + '<h2>打开文件</h2><p>从工作区目录树中选择文件</p></div>';
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = selector => panel.querySelector(selector);
  const status = message => { el('.pf-status').textContent = message; };
  function mount() {
    if (panel) return;
    panel = document.createElement('section');
    panel.id = 'rs-files';
    panel.className = 'rs-panel pf-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-label', '文件');
    panel.innerHTML = `<header class="pf-toolbar"><div class="pf-breadcrumb"></div><button type="button" data-pf="save-edits" hidden title="保存文件 (Ctrl+S)" aria-label="保存文件">保存</button><button type="button" data-pf="source" hidden title="显示源代码以继续编辑/更改" aria-label="显示源代码以继续编辑/更改"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-16-2 20"/></svg><span>查看源代码</span></button><button type="button" data-pf="refresh" title="刷新" aria-label="刷新">${refreshIcon()}</button><button type="button" data-pf="tree" title="展开/关闭文件树" aria-label="展开/关闭文件树" aria-expanded="true">${folderIcon}</button><div class="pf-open-wrap" hidden><div class="pf-open-pill"><button type="button" data-pf="open-default" title="在资源管理器中显示"><img src="assets/file-explorer.png" alt=""><span>打开</span></button><button type="button" data-pf="open-menu" aria-label="打开方式" aria-haspopup="menu" aria-expanded="false">${chevron(true)}</button></div><div class="pf-open-menu" role="menu" hidden></div></div></header><div class="pf-layout"><main class="pf-main"><div class="pf-preview">${welcome()}</div></main><div class="pf-resizer" role="separator" tabindex="0" aria-label="调整文件树宽度" aria-orientation="vertical"></div><aside class="pf-tree"><div class="pf-status" role="status"></div><div class="pf-entries" aria-label="项目文件树"></div></aside></div>`;
    document.querySelector('#rightSidebar .rs-content').append(panel);
    window.createProjectFileFind(panel);
    breadcrumb = window.createProjectFileBreadcrumb({ host: el('.pf-breadcrumb'), getCache: () => current, loadDirectory, openFile, icon, folderIcon, chevron });
    panel.addEventListener('click', async event => {
      const button = event.target.closest('button');
      if (!button || !current) return;
      const cache = current;
      const action = button.dataset.pf;
      if (action === 'tree') {
        cache.treeOpen = !cache.treeOpen;
        renderTreeVisibility();
        if (cache.treeOpen) void refresh(cache);
      } else if (action === 'refresh') {
        const path = cache.selected;
        toast('正在刷新文件…');
        await refresh(cache);
        if (path && !isDirty(cache, path)) await openFile(cache, path, true);
        toast(cache.error || (cache.files.get(path)?.kind === 'error' ? '文件刷新失败：' + cache.files.get(path).message : isDirty(cache, path) ? '文件树已刷新，已保留未保存的编辑' : '刷新完成'));
      } else if (action === 'save-edits') {
        await saveEdits(cache, cache.selected);
      } else if (action === 'open-menu') {
        const opening = el('.pf-open-menu').hidden;
        setMenuOpen(false);
        if (opening) {
          const requestedPath = cache.selected;
          const request = menuVersion;
          await refreshVsCodeAvailability();
          if (current !== cache || !cache.selected || cache.selected !== requestedPath || request !== menuVersion) return;
          el('.pf-open-menu').innerHTML = (vsCodeStatus.available ? '<button role="menuitem" data-file-action="vscode"><img src="' + esc(vsCodeStatus.iconDataUrl || 'assets/code-editor.svg') + '" alt="">VS Code</button>' : '') + '<button role="menuitem" data-file-action="explorer"><img src="assets/file-explorer.png" alt="">资源管理器</button><button role="menuitem" data-file-action="terminal"><img src="assets/terminal.svg" alt="">终端</button><div role="separator"></div><button role="menuitem" data-file-action="save">另存为…</button>';
          setMenuOpen(true);
          el('.pf-open-menu button')?.focus();
        }
      } else if (action === 'open-default' || button.dataset.fileAction) {
        setMenuOpen(false);
        if (button.dataset.fileAction && button.dataset.fileAction !== 'save') {
          selectedApp = button.dataset.fileAction;
          const asset = selectedApp === 'vscode' ? (vsCodeStatus.iconDataUrl || 'assets/code-editor.svg') : selectedApp === 'terminal' ? 'assets/terminal.svg' : 'assets/file-explorer.png';
          el('[data-pf="open-default"] img').src = asset;
          el('[data-pf="open-default"]').title = '打开 · ' + button.textContent.trim();
          return;
        }
        const result = await api.projectFileAction({ sessionId: cache.sessionId, rootToken: cache.rootToken, path: cache.selected, action: button.dataset.fileAction || selectedApp }).catch(error => ({ error: error.message }));
        if (result.error || result.result?.error) toast(result.error || result.result.error);
      } else if (action === 'source') {
        const file = cache.files.get(cache.selected);
        if (file) { file.sourceMode = !file.sourceMode; renderDocument(true); }
      }
      else if (button.dataset.folder !== undefined) {
        const path = button.dataset.folder;
        if (cache.expanded.has(path)) cache.expanded.delete(path);
        else { cache.expanded.add(path); void loadDirectory(cache, path); }
        renderTree();
      } else if (button.dataset.file !== undefined) void openFile(cache, button.dataset.file);
    });
    const resize = el('.pf-resizer');
    const clampWidth = width => Math.max(140, Math.min(window.innerWidth / 2, el('.pf-layout').clientWidth - 120, width));
    const setWidth = width => { if (current) { current.treeWidth = clampWidth(width); el('.pf-tree').style.width = current.treeWidth + 'px'; resize.setAttribute('aria-valuenow', String(Math.round(current.treeWidth))); } };
    resize.addEventListener('pointerdown', event => { resize.setPointerCapture(event.pointerId); resize.dataset.dragging = 'true'; event.preventDefault(); });
    resize.addEventListener('pointermove', event => { if (resize.dataset.dragging) setWidth(el('.pf-layout').getBoundingClientRect().right - event.clientX); });
    const stopResize = () => { delete resize.dataset.dragging; };
    resize.addEventListener('pointerup', stopResize); resize.addEventListener('lostpointercapture', stopResize);
    resize.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setWidth(el('.pf-tree').clientWidth + (event.key === 'ArrowLeft' ? 20 : -20)); } });
    new ResizeObserver(() => { if (current?.treeWidth) setWidth(current.treeWidth); }).observe(el('.pf-layout'));
    document.addEventListener('click', event => { if (!event.target.closest('.pf-open-wrap')) setMenuOpen(false); });
    panel.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveEdits(current, current.selected); }
      if (event.key === 'Escape' && !el('.pf-open-menu').hidden) {
        event.stopPropagation();
        setMenuOpen(false);
        el('[data-pf="open-menu"]').focus();
      }
      if (event.target.closest('.pf-open-menu') && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const items = [...el('.pf-open-menu').querySelectorAll('button')];
        const index = items.indexOf(document.activeElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }
    });
  }
  function setMenuOpen(open) {
    menuVersion++;
    el('.pf-open-menu').hidden = !open;
    el('[data-pf="open-menu"]').setAttribute('aria-expanded', String(open));
  }
  async function loadDirectory(cache, path) {
    if (cache.dirs.has(path)) return cache.dirs.get(path);
    if (cache.pending.has(path)) return cache.pending.get(path);
    const generation = cache.generation;
    const request = (async () => {
      try {
        const response = await api.listProjectFiles({ sessionId: cache.sessionId, rootToken: cache.rootToken, path });
        if (generation !== cache.generation) return;
        if (!response.ok) throw new Error(response.error);
        const rootChanged = cache.root !== response.root;
        cache.root = response.root;
        if (rootChanged && current === cache) breadcrumb.render();
        cache.dirs.set(path, response.result);
        if (current === cache) renderTree();
        return response.result;
      } catch (error) {
        if (generation === cache.generation) cache.error = error.message;
        if (current === cache && generation === cache.generation) status(error.message);
      }
      finally { if (generation === cache.generation) cache.pending.delete(path); }
    })();
    cache.pending.set(path, request);
    return request;
  }
  async function refresh(cache) {
    if (cache.refreshing) return cache.refreshing;
    cache.generation++;
    cache.error = '';
    cache.dirs.clear();
    cache.pending.clear();
    if (current === cache) status('正在刷新…');
    cache.refreshing = (async () => {
      await loadDirectory(cache, '');
      // Only reload expanded directories still reachable in the new tree.
      const visit = async path => {
        for (const entry of cache.dirs.get(path) || []) {
          if (entry.directory && cache.expanded.has(entry.path)) { await loadDirectory(cache, entry.path); await visit(entry.path); }
        }
      };
      await visit('');
      if (current === cache && cache.dirs.has('')) status(cache.error || '');
    })().finally(() => { cache.refreshing = null; });
    return cache.refreshing;
  }
  function icon(path) {
    const ext = path.split('.').pop().toLowerCase();
    const type = /^(avif|bmp|gif|heic|heif|ico|jpeg|jpg|png|svg|tif|tiff|webp)$/.test(ext) ? 'image' : /^(avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv)$/.test(ext) ? 'square-play' : /^(c|cc|cpp|cs|css|cxx|dart|ex|exs|go|h|hpp|htm|html|java|js|jsx|kt|kts|less|lua|mjs|cjs|php|pl|ps1|py|r|rb|rs|sass|scala|scss|sh|sql|svelte|swift|ts|tsx|vue|xml|json|jsonc|yaml|yml|toml|bat|cmd)$/.test(ext) ? 'code-xml' : 'file';
    return '<span class="pf-file-icon">' + (window.YanReviewFileIcons?.[type] || '') + '</span>';
  }
  function renderTreeVisibility() {
    el('.pf-tree').hidden = !current.treeOpen;
    el('.pf-resizer').hidden = !current.treeOpen;
    el('.pf-tree').style.width = current.treeWidth ? current.treeWidth + 'px' : '';
    el('[data-pf="tree"]').setAttribute('aria-expanded', String(current.treeOpen));
  }
  function renderTree() {
    if (!current) return;
    const cache = current;
    const row = (entry, depth) => `<button type="button" class="pf-entry${cache.selected === entry.path ? ' selected' : ''}" style="--depth:${depth}" ${entry.directory ? `data-folder="${esc(entry.path)}" aria-expanded="${cache.expanded.has(entry.path)}"` : `data-file="${esc(entry.path)}"`} title="${esc(entry.path)}"><span class="pf-chevron">${entry.directory ? chevron(cache.expanded.has(entry.path)) : ''}</span>${entry.directory ? folderIcon : icon(entry.path)}<span>${esc(entry.name)}</span></button>`;
    const branch = (path, depth) => (cache.dirs.get(path) || []).map(entry => row(entry, depth) + (entry.directory && cache.expanded.has(entry.path) ? `<div class="pf-children" style="--depth:${depth}">${branch(entry.path, depth + 1)}</div>` : '')).join('');
    const html = branch('', 0);
    el('.pf-entries').innerHTML = html || `<div class="pf-empty">${cache.dirs.has('') ? '此目录为空' : '正在加载…'}</div>`;
  }
  async function openFile(cache, path, force = false) {
    cache.selected = path;
    if (!cache.open.includes(path)) cache.open.push(path);
    let tab = openRightSidebarTabs.find(tab => tab.type === 'files' && tab.filePath === path && tab.fileCacheKey === cache.key && (!tab.ownerSessionId || tab.ownerSessionId === cache.sessionId));
    if (tab && !tab.ownerSessionId) tab.ownerSessionId = cache.sessionId;
    if (!tab) {
      tab = { id: 'project-file-' + (++tabCounter), type: 'files', label: path.split('/').pop(), filePath: path, fileCacheKey: cache.key, ownerSessionId: cache.sessionId };
      openRightSidebarTabs.push(tab);
    }
    if (activeRightSidebarTab !== tab.id) activateRightSidebarTab(tab.id);
    if (force) cache.files.delete(path);
    if (!cache.files.has(path)) {
      if (!cache.reads.has(path)) {
        const request = api.readProjectFile({ sessionId: cache.sessionId, rootToken: cache.rootToken, path }).then(async response => {
          if (!response.ok) throw new Error(response.error);
          const result = response.result;
          if (result.kind === 'text' && result.hasMore) {
            const chunks = [result.content];
            let page = result;
            while (page.hasMore) {
              const next = await api.readProjectFile({ sessionId: cache.sessionId, rootToken: cache.rootToken, path, offset: page.nextOffset, version: result.version });
              if (!next.ok || next.result?.kind !== 'text' || next.result.nextOffset <= page.nextOffset) throw new Error(next.error || next.result?.message || '文件读取失败，请刷新后重试');
              page = next.result;
              chunks.push(page.content);
            }
            result.content = chunks.join('');
            result.nextOffset = page.nextOffset;
            result.hasMore = false;
          }
          const firstPage = { ...result, firstLine: 1 };
          cache.files.set(path, result.kind === 'text' ? { ...firstPage, pages: [firstPage], pageIndex: 0 } : result);
        }).catch(error => { cache.files.set(path, { kind: 'error', message: error.message }); })
          .finally(() => { cache.reads.delete(path); });
        cache.reads.set(path, request);
      }
      if (current === cache) renderDocument();
      await cache.reads.get(path);
    }
    if (current === cache && cache.selected === path) { renderDocument(); renderTree(); }
  }
  function videoPlayer(video) {
    const player = document.createElement('div'); player.className = 'pf-video-player';
    const bar = document.createElement('div'); bar.className = 'pf-video-bar';
    const button = (label, paths) => {
      const node = document.createElement('button'); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label);
      node.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
      return node;
    };
    const play = button('播放', '<path d="m8 5 11 7-11 7Z"/>');
    play.onclick = async () => { if (!video.paused) video.pause(); else try { await video.play(); } catch (error) { toast(error.message); } };
    const syncPlay = () => { play.title = video.paused ? '播放' : '暂停'; play.setAttribute('aria-label', play.title); play.innerHTML = video.paused ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m8 5 11 7-11 7Z"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>'; };
    video.addEventListener('play', syncPlay); video.addEventListener('pause', syncPlay); video.addEventListener('ended', syncPlay);
    const seek = document.createElement('input'); seek.type = 'range'; seek.min = '0'; seek.max = '0'; seek.step = '0.1'; seek.value = '0'; seek.className = 'pf-video-seek'; seek.setAttribute('aria-label', '播放进度');
    const time = document.createElement('span'); time.className = 'pf-video-time';
    const clock = value => { const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'); };
    const syncTime = () => { seek.max = String(Number.isFinite(video.duration) ? video.duration : 0); seek.value = String(video.currentTime); time.textContent = clock(video.currentTime) + ' / ' + clock(video.duration); };
    for (const event of ['loadedmetadata', 'durationchange', 'timeupdate']) video.addEventListener(event, syncTime);
    seek.oninput = () => { if (Number.isFinite(video.duration)) video.currentTime = Number(seek.value); };
    const volume = document.createElement('div'); volume.className = 'pf-video-volume';
    const mute = button('静音', '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path class="pf-volume-waves" d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="pf-volume-cross" d="m16 9 6 6m0-6-6 6"/>');
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.01'; slider.value = '1'; slider.setAttribute('aria-label', '音量');
    let lastVolume = 1;
    mute.onclick = () => {
      if (video.muted || video.volume === 0) { video.volume = lastVolume || 1; video.muted = false; }
      else { lastVolume = video.volume; video.muted = true; }
    };
    slider.oninput = () => { video.volume = Number(slider.value); video.muted = video.volume === 0; if (video.volume) lastVolume = video.volume; };
    const syncVolume = () => {
      const silent = video.muted || video.volume === 0;
      slider.value = String(video.muted ? 0 : video.volume);
      mute.setAttribute('aria-pressed', String(silent)); mute.title = silent ? '取消静音' : '静音'; mute.setAttribute('aria-label', mute.title);
    };
    video.addEventListener('volumechange', syncVolume); syncVolume();
    volume.append(mute, slider);
    const fullscreen = button('全屏', '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>');
    fullscreen.onclick = async () => { try { if (document.fullscreenElement === player) await document.exitFullscreen(); else await player.requestFullscreen(); } catch (error) { toast(error.message); } };
    bar.append(play, seek, time, volume, fullscreen);
    player.append(video, bar); syncPlay(); syncTime();
    return player;
  }

  function renderDocument(force = false) {
    const cache = current;
    const preview = el('.pf-preview');
    if (!force && preview.firstChild && preview.dataset.path) {
      cache.views.set(preview.dataset.path, { node: preview.firstChild, top: preview.scrollTop, left: preview.scrollLeft, source: preview._source, mode: preview._mode });
    }
    const path = cache.selected;
    if (force || preview.dataset.path !== path) preview.querySelector('video')?.pause();
    const file = cache.files.get(path);
    setMenuOpen(false);
    el('.pf-open-wrap').hidden = !path;
    el('[data-pf="save-edits"]').hidden = !isDirty(cache, path);
    el('[data-pf="save-edits"]').disabled = !isDirty(cache, path);
    const markdown = file?.kind === 'text' && /\.(md|markdown)$/i.test(path);
    const sourceButton = el('[data-pf="source"]');
    sourceButton.hidden = !markdown;
    sourceButton.setAttribute('aria-pressed', String(!!file?.sourceMode));
    sourceButton.title = sourceButton.ariaLabel = file?.sourceMode ? '查看预览' : '查看源代码';
    sourceButton.querySelector('span').textContent = sourceButton.ariaLabel;
    const sourceIcon = sourceButton.querySelector('svg');
    sourceIcon.setAttribute('stroke-linecap', 'round');
    sourceIcon.setAttribute('stroke-linejoin', 'round');
    sourceIcon.querySelector('path').setAttribute('d', file?.sourceMode
      ? 'M14 2H8C5.79086 2 4 3.79086 4 6V18C4 20.2091 5.79086 22 8 22H16C18.2091 22 20 20.2091 20 18V8L14 2ZM14 2V5C14 6.65685 15.3431 8 17 8H20M8 13H12M8 17H16'
      : 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-16-2 20');
    breadcrumb.render();
    preview.replaceChildren();
    preview.dataset.path = path;
    preview._source = file;
    preview._mode = !!file?.sourceMode;
    const saved = cache.views.get(path);
    if (!force && file && saved?.source === file && saved.mode === !!file.sourceMode) { preview.append(saved.node); preview.scrollTop = saved.top; preview.scrollLeft = saved.left; return; }
    let body = document.createElement('div');
    if (markdown && !file.sourceMode) {
      body.className = 'pf-markdown msg-body';
      body.innerHTML = renderMarkdown(file.drafts?.[0] ?? file.content, { softBreaks: true });
    } else if (file?.kind === 'text') {
      const original = file.content.replace(/\r\n/g, '\n');
      const firstLine = () => (file.firstLine || 1) + Object.entries(file.drafts || {}).reduce((delta, [index, text]) => Number(index) < file.pageIndex ? delta + (text.match(/\n/g) || []).length - (file.pages[index].content.match(/\n/g) || []).length : delta, 0);
      body = window.createProjectFileEditor({
        value: file.drafts?.[file.pageIndex] ?? original, path, firstLine,
        onChange(value) {
          if (file.saving) return;
          file.drafts ||= {};
          if (value === original) delete file.drafts[file.pageIndex]; else file.drafts[file.pageIndex] = value;
          el('[data-pf="save-edits"]').hidden = !isDirty(cache, path);
          el('[data-pf="save-edits"]').disabled = !isDirty(cache, path);
          const tab = openRightSidebarTabs.find(tab => tab.filePath === path && tab.fileCacheKey === cache.key);
          if (tab) {
            tab.label = path.split('/').pop();
            const label = document.querySelector('[data-rs-tab="' + tab.id + '"] .rs-work-tab-label');
            if (label) {
              label.textContent = path.split('/').pop();
              label.closest('.rs-work-tab').classList.toggle('pf-dirty', isDirty(cache, path));
            }
            scheduleRightSidebarTabLayoutSync();
          }
        },
        onReference: selection => referenceSelection(cache, path, selection)
      });
    } else if (file?.kind === 'image') { body.className = 'pf-image'; const image = document.createElement('img'); image.src = file.content; image.alt = path; image.onerror = () => { body.className = 'pf-welcome-host'; body.innerHTML = notice('无法预览此图片', '图片格式无法识别或图片已损坏，请在其他应用中打开。'); }; body.append(image); }
    else if (file?.kind === 'video') {
      body.className = 'pf-video';
      const video = document.createElement('video');
      video.controls = false;
      video.preload = 'metadata';
      video.playsInline = true;
      video.disablePictureInPicture = true;
      video.disableRemotePlayback = true;
      video.setAttribute('controlslist', 'noplaybackrate noremoteplayback');
      video.src = file.content;
      video.addEventListener('contextmenu', event => event.preventDefault());
      const controls = document.createElement('div');
      controls.className = 'pf-video-tools';
      const speeds = document.createElement('div');
      speeds.className = 'pf-video-speeds'; speeds.setAttribute('role', 'group'); speeds.setAttribute('aria-label', '播放速度');
      const label = document.createElement('span'); label.textContent = '播放速度'; speeds.append(label);
      const segments = document.createElement('div'); segments.className = 'pf-video-speed-segments';
      speeds.append(segments);
      for (const rate of [0.5, 1, 1.25, 1.5, 2]) {
        const option = document.createElement('button'); option.type = 'button'; option.textContent = rate + 'x';
        option.setAttribute('aria-pressed', String(rate === 1));
        option.onclick = () => { video.playbackRate = rate; };
        video.addEventListener('ratechange', () => option.setAttribute('aria-pressed', String(video.playbackRate === rate)));
        segments.append(option);
      }
      const download = document.createElement('button');
      download.type = 'button'; download.className = 'pf-video-circle'; download.setAttribute('aria-label', '下载视频'); download.title = '下载视频';
      download.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/></svg>';
      download.onclick = async () => {
        download.disabled = true;
        try {
          const result = await api.projectFileAction({ sessionId: cache.sessionId, rootToken: cache.rootToken, path, action: 'save' });
          if (result.error || result.result?.error) toast(result.error || result.result.error);
        } catch (error) { toast(error.message); }
        finally { download.disabled = false; }
      };
      controls.append(speeds, download);
      video.addEventListener('error', () => {
        video.pause(); body.className = 'pf-welcome-host';
        body.innerHTML = notice('暂不支持播放此视频', '视频编码不受支持或文件已损坏，请在其他应用中打开。');
      });
      body.append(videoPlayer(video), controls);
    }
    else if (!path) { body.className = 'pf-welcome-host'; body.innerHTML = welcome(); }
    else { body.className = 'pf-welcome-host'; body.innerHTML = notice(file?.title || (file ? '无法打开此文件' : '正在打开文件'), file?.message || '请稍候…'); }
    preview.append(body);
    preview.scrollTop = preview.scrollLeft = 0;
  }
  function makeCache(key, session, root, rootToken = '') {
    return { key, scopeKey: key, sessionId: session.id, ownerSessionId: rootToken ? session.id : '', root, rootToken, dirs: new Map(), pending: new Map(), files: new Map(), reads: new Map(), views: new Map(), expanded: new Set(), open: [], selected: '', treeOpen: true, generation: 0 };
  }
  async function openLocal(path, { sessionId = state.currentSession?.id } = {}) {
    if (!sessionId || state.currentSession?.id !== sessionId) return false;
    const resolved = await api.resolveProjectFile({ sessionId, path });
    if (state.currentSession?.id !== sessionId) return false;
    if (!resolved.ok) { toast(resolved.error || '无法打开文件'); return false; }
    sync();
    const session = state.currentSession;
    // File caches and their tab lists belong to one task, never to a shared
    // workspace, so two tasks cannot inherit each other's open files.
    const base = `session:${session.id}`;
    const key = resolved.rootToken ? `${base}:external:${resolved.rootToken}` : base;
    if (!caches.has(key)) caches.set(key, makeCache(key, session, resolved.root, resolved.rootToken));
    const cache = caches.get(key);
    cache.scopeKey = base;
    cache.sessionId = sessionId;
    await openFile(cache, resolved.path);
    return true;
  }
  function sync({ reopen = false } = {}) {
    mount();
    const session = state.currentSession;
    const scopeKey = session ? `session:${session.id}` : '';
    if (!scopeKey) {
      if (current) renderDocument();
      current = null;
      el('.pf-preview').replaceChildren(); el('.pf-preview').dataset.path = '';
      el('.pf-entries').replaceChildren(); breadcrumb.render(); return;
    }
    if (!caches.has(scopeKey)) caches.set(scopeKey, makeCache(scopeKey, session, session.workspace || ''));
    const scopeChanged = current && (current.scopeKey !== scopeKey || (current.ownerSessionId && current.ownerSessionId !== session.id));
    if (scopeChanged) {
      const wasFile = getActiveRightSidebarTab()?.type === 'files';
      const outgoing = current;
      for (let i = openRightSidebarTabs.length - 1; i >= 0; i--) {
        const tab = openRightSidebarTabs[i];
        if (!tab.filePath) continue;
        if (!outgoing || tab.fileCacheKey === outgoing.key || (tab.ownerSessionId && tab.ownerSessionId === outgoing.sessionId)) {
          openRightSidebarTabs.splice(i, 1);
        }
      }
      for (const cache of caches.values()) {
        if (cache.scopeKey !== scopeKey || (cache.ownerSessionId && cache.ownerSessionId !== session.id)) continue;
        for (const path of cache.open) openRightSidebarTabs.push({ id: 'project-file-' + (++tabCounter), type: 'files', label: path.split('/').pop(), filePath: path, fileCacheKey: cache.key, ownerSessionId: session.id });
      }
      if (wasFile) {
        const selected = caches.get(scopeKey).selected;
        activeRightSidebarTab = openRightSidebarTabs.find(tab => tab.filePath === selected && tab.fileCacheKey === scopeKey && tab.ownerSessionId === session.id)?.id || createRightSidebarTab('files').id;
      }
    }
    const active = getActiveRightSidebarTab();
    if (active?.type !== 'files') el('.pf-preview').querySelector('video')?.pause();
    const activeCache = caches.get(active?.fileCacheKey);
    const next = activeCache?.scopeKey === scopeKey && (!activeCache.ownerSessionId || activeCache.ownerSessionId === session.id) ? activeCache : caches.get(scopeKey);
    if (current !== next) {
      el('.pf-preview').querySelector('video')?.pause();
      if (current) renderDocument();
      el('.pf-preview').replaceChildren(); el('.pf-preview').dataset.path = '';
      current = next; current.sessionId = session.id;
      status(''); renderTreeVisibility(); renderTree(); renderDocument();
      if (!current.dirs.has('')) void refresh(current);
    }
    current.sessionId = session.id;
    if (active?.type === 'files' && current.selected !== (active.filePath || '')) {
      current.selected = active.filePath || ''; renderDocument(); renderTree();
    }
    if (reopen && current.treeOpen) void refresh(current);
  }
  function closeTab(tab) {
    const cache = caches.get(tab.fileCacheKey);
    if (cache && tab.filePath) cache.open = cache.open.filter(path => path !== tab.filePath);
  }
  async function referenceSelection(cache, path, selection) {
    const sessionId = state.currentSession?.id;
    if (current !== cache || !sessionId) return;
    const fullPath = cache.root.replace(/[\\/]+$/, '') + '/' + path;
    try {
      const inspected = await api.inspectAttachmentPath(fullPath);
      if (state.currentSession?.id !== sessionId || current !== cache) return;
      if (!inspected?.ok || !inspected.isFile) throw new Error(inspected?.error || '无法附加此文件');
      const key = value => String(value).replaceAll('\\', '/').toLowerCase();
      if (!state.attachments.some(item => key(item.path) === key(inspected.path))) {
        state.attachments.push({ name: inspected.name, path: inspected.path, size: inspected.size, kind: 'file', mimeType: '' });
      }
      const range = selection.startLine === selection.endLine ? '第 ' + selection.startLine + ' 行' : '第 ' + selection.startLine + '–' + selection.endLine + ' 行';
      const intro = selection.kind === 'lines' ? '请结合已附加的文件，帮我分析以下选中行：' : '请结合已附加文件的上下文，帮我分析这段选中文字：';
      const draftNote = isDirty(cache, path) ? '\n以下内容来自尚未保存的编辑，附件仍是磁盘上的版本。' : '';
      const prompt = intro + '\n文件：' + path + '\n位置：' + range + draftNote + '\n\n' + selection.text.split('\n').map(line => '> ' + line).join('\n') + '\n\n';
      const existing = getComposerText();
      setComposerCaretByTextOffset(existing.length);
      insertComposerPlainText((existing.trim() ? '\n\n' : '') + prompt);
      renderAttachments(); updateSendState();
      document.querySelector('#composerInput')?.dispatchEvent(new Event('input', { bubbles: true }));
      captureComposerDraftForSession(sessionId);
      toast('已添加文件与选中内容至对话');
    } catch (error) { toast('添加失败：' + error.message); }
  }
  function isDirty(cache, path) { return !!Object.keys(cache?.files.get(path)?.drafts || {}).length; }
  async function saveEdits(cache, path) {
    const file = cache?.files.get(path);
    if (!isDirty(cache, path) || file.saving) return !isDirty(cache, path);
    file.saving = true;
    const editor = current === cache && cache.selected === path ? el('.pf-editor') : null;
    if (editor) editor.readOnly = true;
    const drafts = { ...file.drafts };
    try {
      const edits = Object.entries(drafts).map(([index, content]) => {
        const page = file.pages[index];
        return { offset: page.offset, end: page.nextOffset, content: page.content.includes('\r\n') ? content.replace(/\n/g, '\r\n') : content };
      });
      const response = await api.projectFileAction({ sessionId: cache.sessionId, rootToken: cache.rootToken, path, action: 'write', version: file.version, edits });
      if (!response.ok || response.result?.error) throw new Error(response.error || response.result.error);
      cache.files.delete(path); cache.views.delete(path);
      const tab = openRightSidebarTabs.find(tab => tab.filePath === path && tab.fileCacheKey === cache.key);
      if (tab) tab.label = path.split('/').pop();
      if (current === cache && cache.selected === path) await openFile(cache, path);
      renderRightSidebarTabs(); toast('文件已保存'); return true;
    } catch (error) { toast('保存失败：' + error.message); return false; }
    finally { file.saving = false; if (editor) editor.readOnly = false; }
  }
  async function confirmClose(tab) {
    const cache = caches.get(tab.fileCacheKey);
    if (!isDirty(cache, tab.filePath)) return true;
    if (closePending) return false;
    closePending = true;
    const overlay = document.createElement('div'); overlay.className = 'overlay pf-unsaved-modal';
    overlay.innerHTML = '<div class="perm-dialog generic-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="pfUnsavedTitle" aria-describedby="pfUnsavedDesc"><h3 id="pfUnsavedTitle" class="perm-dialog-title">你尚未保存你改动的文件</h3><p id="pfUnsavedDesc" class="perm-dialog-desc">如果你现在关闭，可能导致你的项目崩溃。</p><div class="perm-dialog-actions"><button class="primary-btn" data-choice="save">保存</button><button class="secondary-btn" data-choice="discard">不保存</button><button class="secondary-btn" data-choice="cancel">取消</button></div></div>';
    document.body.append(overlay);
    const previous = document.activeElement;
    overlay.querySelector('[data-choice="cancel"]').focus();
    const choice = await new Promise(resolve => {
      overlay.addEventListener('click', event => { const action = event.target.closest('[data-choice]'); if (action) resolve(action.dataset.choice); });
      overlay.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Escape') resolve('cancel');
        if (event.key === 'Tab') { event.preventDefault(); const buttons = [...overlay.querySelectorAll('button')]; const i = buttons.indexOf(document.activeElement); buttons[(i + (event.shiftKey ? 2 : 1)) % 3].focus(); }
      });
    });
    overlay.remove(); previous?.focus();
    let allowed = false;
    if (choice === 'save') allowed = await saveEdits(cache, tab.filePath);
    if (choice === 'discard') {
      const file = cache.files.get(tab.filePath);
      file.drafts = {};
      cache.views.delete(tab.filePath);
      if (current === cache && el('.pf-preview').dataset.path === tab.filePath) el('.pf-preview')._source = null;
      allowed = true;
    }
    closePending = false; return allowed;
  }
  window.YanProjectFiles = { sync, openLocal, folderIcon, chevron, closeTab, icon, confirmClose, isTabDirty: tab => isDirty(caches.get(tab.fileCacheKey), tab.filePath) };
})();
