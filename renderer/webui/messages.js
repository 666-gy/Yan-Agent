'use strict';
window.YanWebConversation = (() => {
  const desktop = window.YanWebMessages;
  const { escapeHtml, ICONS } = desktop;
  const pane = document.querySelector('#taskMessages');
  const track = document.querySelector('#messageScrollTrack');
  const thumb = document.querySelector('#messageScrollThumb');
  function textOf(content) {
    if (typeof content === 'string') return content;
    return Array.isArray(content) ? content.map(part => typeof part === 'string' ? part : part?.type === 'text' ? part.text : '[附件]').join('\n') : '';
  }
  function buildWorkImageContent(content, builder = desktop.buildTextRoundElement) {
    const images = [];
    const text = String(content || '').replace(/```[\s\S]*?```|`[^`\n]*`|!\[([^\]\n]*)\]\s*\((\/media\/work-image\?id=[a-f0-9]{64})\)/g, (match, name, src) => {
      if (!src) return match;
      images.push({ name, src });
      return `\uE000WORKIMAGE${images.length - 1}\uE001`;
    });
    const element = builder(text);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (!node.textContent.includes('\uE000WORKIMAGE')) continue;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const match of node.textContent.matchAll(/\uE000WORKIMAGE(\d+)\uE001/g)) {
        const asset = images[Number(match[1])];
        if (!asset) continue;
        fragment.append(document.createTextNode(node.textContent.slice(offset, match.index)));
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'web-media-button';
        button.innerHTML = '<img src="vendor/keyline-image.svg" alt="" aria-hidden="true"><span>查看工作截图</span>';
        button.addEventListener('click', () => openImagePreview(asset.src, asset.name || '工作截图', button));
        fragment.append(button);
        offset = match.index + match[0].length;
      }
      fragment.append(document.createTextNode(node.textContent.slice(offset)));
      node.replaceWith(fragment);
    }
    return element;
  }
  function mediaAssets(message, run) {
    const assets = Array.isArray(message?.mediaAssets) ? message.mediaAssets : [];
    const timeline = Array.isArray(run?.timeline) ? run.timeline : [];
    for (const item of timeline) {
      if (item?.type !== 'tool_result' || !item.output) continue;
      try {
        const parsed = typeof item.output === 'string' ? JSON.parse(item.output) : item.output;
        const meta = parsed?.meta || parsed?.structuredContent?.meta || {};
        if (meta.generatedImageId) assets.push({ type:'image', assetId:String(meta.generatedImageId), name:meta.name || '生成的图片' });
        if (meta.generatedVideoId) assets.push({ type:'video', assetId:String(meta.generatedVideoId), url:meta.generatedVideoUrl || '' , name:meta.name || '生成的视频' });
      } catch {}
    }
    return assets.filter((asset, index, all) => asset && (asset.assetId || asset.url) && all.findIndex(item => item.assetId ? item.assetId === asset.assetId : item.url === asset.url) === index);
  }
  function addMedia(body, assets) {
    for (const asset of assets) {
      if (asset.type === 'image' && asset.assetId) {
        const button = document.createElement('button'); button.type='button'; button.className='web-media-button';
        button.innerHTML='<img src="vendor/keyline-image.svg" alt="" aria-hidden="true"><span>查看'+(asset.name?.includes('截图')?'工作截图':'生成的图片')+'</span>';
        const source='/media/image?id='+encodeURIComponent(asset.assetId);
        button.addEventListener('click',()=>openImagePreview(source,asset.name || '图片', button));
        body.append(button);
      } else if (asset.type === 'video' && (asset.url || asset.assetId)) {
        const video=document.createElement('video'); video.className='web-generated-video'; video.controls=true; video.playsInline=true; video.preload='metadata'; video.src=asset.assetId ? '/media/video?id='+encodeURIComponent(asset.assetId) : asset.url; video.setAttribute('aria-label',asset.name || '生成的视频'); body.append(video);
      }
    }
  }
  function openImagePreview(src, name, trigger) {
    const dialog=document.createElement('dialog'); dialog.className='web-image-preview';
    dialog.innerHTML='<div class="web-image-preview-actions"><a class="web-image-download" download>下载</a><button type="button" aria-label="关闭图片预览">×</button></div><img alt="">';
    const image=dialog.querySelector('img'); image.src=src; image.alt=name; const download=dialog.querySelector('a'); download.href=src; download.download=name || 'image';
    dialog.querySelector('button').addEventListener('click',()=>dialog.close()); dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    dialog.addEventListener('close',()=>{
      dialog.remove();
      if (trigger?.isConnected) trigger.focus({ preventScroll:true });
    });
    document.body.append(dialog); dialog.showModal();
  }
  function toolPresentation(name) {
    const ui = window.YanWebToolUI;
    const identity = ui.parseToolIdentity(name);
    const native = ui.TOOL_UI[identity.action];
    const category = ui.toolServerCategory(identity.server || native?.category);
    const server = ui.TOOL_SERVER_UI[category];
    if (server) return { label: '调用' + server.label, icon: ui.TOOL_ICON_SVG[server.icon] };
    if (native?.label) return { label: native.label === 'Sub Agent' ? '调用子代理' : native.label.replace(/Skill/g, '技能'), icon: ui.TOOL_ICON_SVG[native.icon] };
    const aliases = {
      bash_status: '查看命令状态', exec_command: '执行命令', write_stdin: '继续命令', read_file: '读取文件',
      yan_analysis_repo_map: '查看项目结构', yan_analysis_code_outline: '读取代码大纲', yan_analysis_code_search: '搜索代码',
      yan_analysis_code_symbol: '读取代码符号', yan_analysis_calltree: '查看调用关系'
    };
    return { label: aliases[identity.action] || '调用扩展工具', icon: ui.TOOL_ICON_SVG['square-more-horizontal'] };
  }
  function buildTool(item) {
    const ui = toolPresentation(item.name);
    const row = document.createElement('div'); row.className = 'web-tool-row';
    const icon = document.createElement('span'); icon.className = 'web-tool-icon'; icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = ui.icon || '';
    const label = document.createElement('span'); label.textContent = ui.label;
    row.append(icon, label); return row;
  }
  function buildToolGroup() {
    const group = document.createElement('details'); group.className = 'web-tool-group'; group.dataset.agentStage = 'work';
    const summary = document.createElement('summary');
    summary.innerHTML = '<img src="vendor/keyline-wrench.svg" alt="" aria-hidden="true"><span>调用工具</span>';
    const body = document.createElement('div'); body.className = 'web-tool-flow'; group.append(summary, body);
    return group;
  }
  // Compare visible prose, ignoring Markdown emphasis/code markers and wrapping.
  function proseKey(content) {
    return textOf(content).normalize('NFKC').replace(/[`*_~]/g, '').replace(/\s+/g, '').trim();
  }
  function buildWork(run, finalContent) {
    const timeline = Array.isArray(run.timeline) ? run.timeline : [];
    const work = timeline.filter(item => item && (item.stage || 'work') === 'work');
    if (!work.length && run.thinkingContent) work.push({ type: 'thinking', content: run.thinkingContent });
    if (!work.length) return null;
    const header = document.createElement('div');
    header.className = 'agent-run-header agent-work-collapsed';
    const activity = document.createElement('div'); activity.className = 'agent-activity-body';
    const outerProse = new Set(work.filter(item => item.type === 'thinking').map(item => proseKey(item.summary || item.content)).filter(Boolean));
    const seenProse = new Set([proseKey(finalContent)].filter(Boolean));
    let toolGroup = null;
    const duration = run.durationMs;
    if (Number.isFinite(duration)) {
      const meta = document.createElement('div'); meta.className = 'work-run-meta'; meta.dataset.agentStage = 'work';
      meta.textContent = '任务耗时 ' + desktop.formatDuration(duration); activity.append(meta);
    }
    for (const item of work) {
      if (item.type === 'tool_call' || item.type === 'tool_result') {
        // Results already belong to their call; never expose an execution panel.
        if (item.type === 'tool_result' && timeline.some(call => call.type === 'tool_call' && (item.callId ? call.callId === item.callId : call.name === item.name))) continue;
        if (!toolGroup) { toolGroup = buildToolGroup(); activity.append(toolGroup); }
        toolGroup.querySelector('.web-tool-flow').append(buildTool(item));
        continue;
      }
      const key = proseKey(item.type === 'thinking' ? item.summary || item.content : item.content);
      if (key && (seenProse.has(key) || (item.type !== 'thinking' && outerProse.has(key)))) continue;
      if (key) seenProse.add(key);
      toolGroup = null;
      let part;
      if (item.type === 'thinking') {
        part = buildWorkImageContent(textOf(item.content), desktop.buildThinkingElement);
        part.querySelector('.thinking-label').textContent = item.summary || '思考过程';
        if (item.summary) part.classList.add('has-progress-summary');
        // If the outer summary repeats the full content, keep only the outer text.
        if (item.summary && proseKey(item.summary) === proseKey(item.content)) {
          const outer = document.createElement('div'); outer.className = 'web-work-note';
          const summary = part.querySelector('summary');
          while (summary.firstChild) outer.append(summary.firstChild);
          part = outer;
        }
      } else if (item.content) {
        part = buildWorkImageContent(textOf(item.content));
        part.classList.add('agent-work-narration');
      } else continue;
      part.dataset.agentStage = 'work'; activity.append(part);
    }
    header.append(activity); return header;
  }
  function addCopy(actions, content) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'msg-action-btn';
    button.title = '复制'; button.setAttribute('aria-label', '复制消息'); button.innerHTML = ICONS.copy;
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(content); button.innerHTML = ICONS.check; button.setAttribute('aria-label', '已复制消息'); }
      catch { button.setAttribute('aria-label', '复制失败，请重试'); button.title = '复制失败，请重试'; }
      setTimeout(() => { if (button.isConnected) { button.innerHTML = ICONS.copy; button.setAttribute('aria-label', '复制消息'); button.title = '复制'; } }, 1400);
    });
    actions.append(button);
  }
  function addTime(actions, value) {
    const clock = desktop.formatMessageClock(value);
    if (!clock) return;
    const time = document.createElement('time'); time.className = 'msg-response-time'; time.textContent = clock;
    const numeric = Number(value), date = new Date(Number.isFinite(numeric) && numeric > 0 ? numeric : value);
    time.dateTime = date.toISOString(); time.title = date.toLocaleString(); actions.append(time);
  }
  function render(messages, preserve = false) {
    const oldTop = pane.scrollTop;
    const follow = !preserve || pane.scrollHeight - pane.clientHeight - oldTop < 60;
    const expanded = preserve ? [...pane.children].map(row => ({work:row.querySelector('.agent-work-toggle')?.getAttribute('aria-expanded') === 'true', groups:[...row.querySelectorAll('details')].map(d => d.open)})) : [];
    const oldRows = preserve ? [...pane.children] : [];
    if (!preserve) { desktop.clearFoldedMessages(); pane.replaceChildren(); }
    let rowIndex = 0;
    for (const message of messages) {
      const selections = message.webSelections || [
        ...(message.skillCalls || []).map(s=>({type:'skill',name:s.name || s.id})),
        ...(message.attachments || []).map(a=>({type:a.mimeType?.startsWith('image/') ? 'photo' : 'file',name:a.name || '附件'}))
      ];
      const run = message.agentRun;
      let content = textOf(message.content);
      if (message.role === 'assistant') {
        const summaries = (run?.timeline || []).filter(item => item?.type === 'text' && item.stage === 'summary').map(item => textOf(item.content)).filter(Boolean);
        content = run?.status === 'working'
          ? content || summaries.join('\n\n') || run?.textContent || ''
          : summaries.length ? summaries.join('\n\n') : content || run?.textContent || '';
      }
      if (!content && !run && !selections.length) continue;
      const signature = JSON.stringify(message);
      if (oldRows[rowIndex]?._webMessageSignature === signature) { rowIndex++; continue; }
      const row = document.createElement('div'); row.className = 'msg ' + message.role;
      row._webMessageSignature = signature;
      const body = document.createElement('div'); body.className = 'msg-body' + (message.role === 'assistant' ? ' agent-output' : '');
      const actions = document.createElement('div'); actions.className = 'msg-actions';
      if (message.role === 'user') {
        if(selections.length){
          const items=document.createElement('div');items.className='web-message-selections';
          for(const item of selections){const label=document.createElement('span');const image=document.createElement('img');image.src='/webui/vendor/keyline-'+({skill:'book-open',photo:'image',file:'file'}[item.type]||'file')+'.svg';image.alt='';label.append(image,document.createTextNode(item.name));items.append(label);}body.append(items);
        }
        const prose=document.createElement('span');prose.innerHTML=desktop.renderInlineEmphasis(escapeHtml(content));body.append(prose);
      }
      else {
        if (run?.status === 'working' && !content) {
          const status = document.createElement('div'); status.className = 'web-run-status';
          status.setAttribute('role','status'); status.setAttribute('aria-label','Yan Agent is Starting up');
          const gear = document.createElement('i'); gear.dataset.lucide = 'settings'; gear.className = 'web-run-gear';
          const label = document.createElement('span'); label.textContent = 'Yan Agent is Starting up';
          status.append(gear, label); body.append(status);
        }
        const work = run ? buildWork(run, content) : null;
        if (work) {
          body.append(work);
          const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'agent-work-toggle';
          toggle.textContent = '查看工作过程'; toggle.setAttribute('aria-expanded', 'false');
          toggle.addEventListener('click', () => {
            const expanded = work.classList.toggle('agent-work-collapsed') === false;
            toggle.textContent = expanded ? '收起工作过程' : '查看工作过程'; toggle.setAttribute('aria-expanded', String(expanded)); syncScrollbar();
          }); actions.append(toggle);
        }
        if (content) body.append(buildWorkImageContent(content));
        if (run?.error) { const error = document.createElement('div'); error.className = 'msg-error'; error.textContent = run.error; body.append(error); }
        addMedia(body, mediaAssets(message, run));
      }
      if (message.role === 'assistant') {
        addCopy(actions, content); addTime(actions, message.ts ?? run?.completedAt);
      }
      row.append(body, actions);
      const existing = pane.children[rowIndex];
      let mounted = row;
      if (existing && existing.className === row.className) {
        // Keep the message's identity and entry animation across stream updates.
        // Reuse the spinner as well so its rotation is never restarted by deltas.
        const oldStatus = existing.querySelector('.web-run-status');
        const newStatus = row.querySelector('.web-run-status');
        if (oldStatus && newStatus) newStatus.replaceWith(oldStatus);
        existing.replaceChildren(...row.childNodes);
        existing._webMessageSignature = signature;
        mounted = existing;
      } else if (existing) pane.replaceChild(row,existing); else pane.append(row);
      if (expanded[rowIndex]?.work) mounted.querySelector('.agent-work-toggle')?.click();
      [...mounted.querySelectorAll('details')].forEach((d,i) => {d.open=!!expanded[rowIndex]?.groups[i];});
      rowIndex++;
      if (message.role === 'user') desktop.foldUserMessage(mounted);
    }
    while (pane.children.length > rowIndex) pane.lastElementChild.remove();
    window.lucide?.createIcons();
    requestAnimationFrame(() => { pane.scrollTop = follow ? pane.scrollHeight : oldTop; syncScrollbar(); });
  }
  pane.addEventListener('click', async event => {
    const button = event.target.closest('.md-code-copy');
    if (!button || button.disabled) return;
    button.disabled = true;
    try { await navigator.clipboard.writeText(button.closest('.md-code-block').querySelector('code').textContent); button.innerHTML = ICONS.check; button.dataset.state = 'success'; button.setAttribute('aria-label', '代码已复制'); }
    catch { button.dataset.state = 'error'; button.setAttribute('aria-label', '代码复制失败'); }
    setTimeout(() => { if (button.isConnected) { button.disabled = false; button.innerHTML = ICONS.copy; button.dataset.state = 'idle'; button.setAttribute('aria-label', '复制整段代码'); } }, 1400);
  });
  function syncScrollbar() {
    const max = pane.scrollHeight - pane.clientHeight;
    track.hidden = max <= 1 || !pane.clientHeight;
    if (track.hidden) return;
    const height = track.clientHeight;
    const thumbHeight = Math.min(height, Math.max(24, height * pane.clientHeight / pane.scrollHeight));
    thumb.style.height = thumbHeight + 'px'; thumb.style.top = ((height - thumbHeight) * pane.scrollTop / max) + 'px';
    thumb.setAttribute('aria-valuenow', String(Math.round(100 * pane.scrollTop / max)));
  }
  let drag = null;
  thumb.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); drag = { y: event.clientY, scroll: pane.scrollTop }; thumb.setPointerCapture(event.pointerId); thumb.classList.add('is-dragging');
  });
  thumb.addEventListener('pointermove', event => {
    if (!drag) return;
    const travel = track.clientHeight - thumb.clientHeight;
    if (travel > 0) pane.scrollTop = drag.scroll + (event.clientY - drag.y) * (pane.scrollHeight - pane.clientHeight) / travel;
  });
  const endDrag = () => { drag = null; thumb.classList.remove('is-dragging'); };
  thumb.addEventListener('pointerup', endDrag); thumb.addEventListener('lostpointercapture', endDrag);
  track.addEventListener('pointerdown', event => {
    if (event.target === thumb) return;
    pane.scrollTop += (event.clientY < thumb.getBoundingClientRect().top ? -1 : 1) * pane.clientHeight * .8;
  });
  thumb.addEventListener('keydown', event => {
    const movements = { ArrowDown: 40, ArrowUp: -40, PageDown: pane.clientHeight * .8, PageUp: -pane.clientHeight * .8, Home: -pane.scrollHeight, End: pane.scrollHeight };
    if (event.key in movements) { event.preventDefault(); pane.scrollTop += movements[event.key]; }
  });
  pane.addEventListener('scroll', syncScrollbar, {passive:true}); pane.addEventListener('toggle', syncScrollbar, true);
  const resize = new ResizeObserver(syncScrollbar); resize.observe(pane);
  const mutation = new MutationObserver(records => {
    for (const record of records) {
      for (const row of record.removedNodes) if (row.nodeType === 1) resize.unobserve(row);
      for (const row of record.addedNodes) if (row.nodeType === 1) resize.observe(row);
    }
    syncScrollbar();
  });
  mutation.observe(pane, {childList:true});
  return { render, syncScrollbar };
})();
