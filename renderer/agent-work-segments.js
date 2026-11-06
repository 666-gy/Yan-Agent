/* One replace-in-place work row; full execution history stays on the run. */
window.YanWorkSegments = (() => {
  const liveToolRows = new WeakMap();
  function statistics(timeline) {
    const results = new Map(timeline.filter(i => i.type === 'tool_result').map(i => [i.callId, i]));
    const seen = new Set(), files = new Map(), mcps = new Set();
    let commands = 0, failed = 0, browser = false, computer = false;
    for (const item of timeline) {
      if (item.type !== 'tool_call') continue;
      if (isSubagentToolCall(item.name)) continue;
      const key = item.callId || item.openCodeKey || item;
      if (seen.has(key)) continue;
      seen.add(key);
      const result = results.get(item.callId);
      const bad = result && (normalizeToolBoolean(result.ok) === false || (result.ok == null && toolResultDetails(result.output).ok === false));
      const action = mutationToolAction(item.name);
      browser ||= resolveToolUi(item.name).groupKey === 'server:yan-browser';
      computer ||= isComputerControlCall(item);
      const mcp = genericMcpName(item.name); if (mcp) mcps.add(mcp);
      commands++; if (bad) failed++;
      if (!['write','edit','patch'].includes(action) || !result || bad || result.interrupted) continue;
      for (const file of mutationFileRows(item.name,item.args,result.output,result.metadata,true)) {
        const path = file.path.replace(/\\/g,'/');
        const normalized = /^[A-Za-z]:/.test(path) ? path.toLowerCase() : path;
        const old = files.get(normalized) || {additions:0,deletions:0};
        old.additions += Number(file.additions) || 0; old.deletions += Number(file.deletions) || 0;
        files.set(normalized,old);
      }
    }
    return {commands,failed,browser,computer,mcps:[...mcps],files:files.size,additions:[...files.values()].reduce((n,f)=>n+f.additions,0),deletions:[...files.values()].reduce((n,f)=>n+f.deletions,0)};
  }
  function statsMarkup(stats, final = false) {
    const parts = [`运行了${stats.commands}条命令（${stats.failed}个失败）`];
    if (final && stats.browser) parts.push('使用了内置浏览器');
    if (final && stats.computer) parts.push('操控了电脑');
    if (final && stats.mcps.length) parts.push('调用了' + stats.mcps.map(escapeHtml).join('、') + ' MCP');
    if (stats.files) parts.push(`写入或更改了${stats.files}个文件`);
    let html = parts.join('，');
    if (stats.files && stats.additions) html += `，<span class="run-change-add">+${stats.additions}</span>`;
    if (stats.files && stats.deletions) html += ` <span class="run-change-del">-${stats.deletions}</span>`;
    return html;
  }
  function render(body, timeline, status, fallback, summaryStarted, mode, fullTimeline = timeline) {
    body.dataset.workSegments = 'true';
    const stats = statistics(fullTimeline);
    // Creator output is answer content even while tool history is collapsed.
    fullTimeline = window.YanIntelligentUi?.projectTimeline(fullTimeline, status) || fullTimeline;
    timeline = window.YanIntelligentUi?.projectTimeline(timeline, status) || timeline;
    const working = status === 'working';
    // Preserve model-authored narration even when the tool history projection is capped.
    const visible = fullTimeline.filter(i=>['text','question','permission','intelligent_ui'].includes(i.type));
    const work = fullTimeline.filter(i=>!['text','question','permission','intelligent_ui','tool_result'].includes(i.type) && !(i.type==='progress' && i.variant==='agent-loader') && !(i.type==='tool_call' && isSubagentToolCall(i.name)));
    const existing = new Map([...body.children].filter(e=>e.dataset.segmentKey).map(e=>[e.dataset.segmentKey,e]));
    const desired = [];
    const expanded = body.closest('.agent-run-header')?.dataset.workExpanded === 'true';
    if (expanded || !working || visible.length || work.some(i => ['subagent_status', 'workflow_orchestration'].includes(i.type)) || (work.some(i => i.type === 'thinking') && !work.some(i => i.type === 'tool_call'))) {
      // Work narration and compact tool batches are one optional projection.
      // Final replies and interactive requests remain visible independently.
      let batch = [];
      let batchIndex = 0;
      const results = new Map(fullTimeline.filter(item => item.type === 'tool_result').map(item => [item.callId, item]));
      const flush = () => {
        const calls = batch.filter(item => item.type === 'tool_call' && !isSubagentToolCall(item.name));
        const hasThinking = batch.some(item => item.type === 'thinking');
        // A reasoning-only stretch is already a disclosure. Nesting it in a
        // second details container adds an unnecessary intrinsic sizing layer.
        if (!calls.length && hasThinking) {
          if (expanded || working) {
            for (const item of batch) {
              if (item.type === 'thinking') append(item, item.openCodeKey || 'thinking:' + fullTimeline.indexOf(item), false);
            }
          }
          batch = [];
          return;
        }
        if ((expanded || working) && (calls.length || hasThinking)) {
          const key = 'work-batch:' + batchIndex++;
          let row = existing.get(key);
          if (row?.tagName !== 'DETAILS') {
            row?.remove(); row = document.createElement('details');
            row.open = false;
          }
          row.dataset.segmentKey = key;
          // Live summaries remain alongside narration when details are hidden.
          row.dataset.agentStage = working ? 'summary' : 'work';
          // Live batches own their disclosure state. Stream updates must not
          // undo a user's click; a settled, collapsed work process still folds them.
          if (!expanded && !working) row.open = false;
          row.className = 'agent-work-batch';
          if (!row.firstElementChild) {
            const summary = document.createElement('summary');
            summary.className = 'agent-work-status';
            const details = document.createElement('div');
            details.className = 'segment-details agent-work-history';
            row.append(summary, details);
          }
          const html = calls.length
            ? statsMarkup(statistics([...calls, ...calls.map(call => results.get(call.callId)).filter(Boolean)]), true)
            : '思考过程';
          if (row.firstElementChild.innerHTML !== html) row.firstElementChild.innerHTML = html;
          const batchItems = [...batch];
          const projectedKeys = new Set(timeline.map(item => item.openCodeKey || (item.callId ? item.type + ':' + item.callId : item)));
          const retained = batchItems.filter(item => projectedKeys.has(item.openCodeKey || (item.callId ? item.type + ':' + item.callId : item)));
          const history = [...retained, ...retained.filter(item => item.type === 'tool_call').map(call => results.get(call.callId)).filter(Boolean)];
          const updateDetails = () => {
            const content = row.lastElementChild;
            if (!row.open) { content.replaceChildren(); return; }
            syncAgentTimelineParts(content, history, status, '', summaryStarted, true, mode);
          };
          row.ontoggle = () => {
            if (row.open && !working) {
              const header = body.closest('.agent-run-header');
              if (header) {
                header.dataset.workToggleTouched = 'true';
                header.dataset.workExpanded = 'true';
                syncAgentWorkVisibility(header);
              }
            }
            updateDetails();
          };
          updateDetails();
          desired.push(row);
        }
        batch = [];
      };
      const append = (item, key, final) => {
        const el = existing.get(key) || createAgentTimelinePartElement(item, mode);
        if (!el) return;
        updateAgentTimelinePartElement(el, item, null, working ? 'running' : 'done', mode);
        el.dataset.segmentKey = key;
        el.dataset.agentStage = final || working ? 'summary' : 'work';
        desired.push(el);
      };
      fullTimeline.forEach((item, index) => {
        if (item.type === 'subagent_status' || item.type === 'workflow_orchestration') {
          flush();
          // A delegated child is the run's live activity, so its row stays
          // visible while the parent works and folds back once the run settles.
          if (expanded || working) append(item, item.openCodeKey || 'subagent:' + index, false);
        } else if (['text', 'question', 'permission', 'intelligent_ui'].includes(item.type)) {
          flush();
          const final = item.stage === 'summary' || item.type !== 'text';
          if (expanded || working || final) append(item, item.openCodeKey || 'content:' + index, final);
        } else batch.push(item);
      });
      flush();
      if (fallback && !fullTimeline.some(item => item.type === 'text' && item.stage === 'summary') && !working) {
        // Some saved runs only carry the final reply outside their timeline.
        append({type:'text', content:fallback}, 'fallback', true);
      }
      const keep = new Set(desired);
      for (const el of [...body.children]) if (el.dataset.segmentKey && !keep.has(el)) el.remove();
      let next = body.firstElementChild;
      for (const el of desired) { if (el !== next) body.insertBefore(el, next); next = el.nextElementSibling; }
      return;
    }
    for (const [index,item] of visible.entries()) {
      const key = item.openCodeKey || 'content:'+index;
      const el = existing.get(key) || createAgentTimelinePartElement(item,mode);
      if (!el) continue;
      updateAgentTimelinePartElement(el,item,null,working?'running':'done',mode);
      el.dataset.segmentKey=key;el.dataset.agentStage='summary';desired.push(el);
    }
    if (fallback && !visible.some(i=>i.type==='text')) {
      const el=existing.get('fallback') || createAgentTimelinePartElement({type:'text'},mode);
      updateAgentTimelinePartElement(el,{type:'text',content:fallback,streaming:working},null,working?'running':'done',mode);
      el.dataset.segmentKey='fallback';el.dataset.agentStage='summary';desired.push(el);
    }
    if (work.length) {
      const expanded = body.closest('.agent-run-header')?.dataset.workExpanded === 'true';
      const el=existing.get('work-status') || document.createElement('div');
      el.dataset.segmentKey='work-status';el.dataset.agentStage='work';
      el.className='agent-work-status';el.setAttribute('role','button');
      // The row stays a toggle while the run is still working, so the work
      // process can be opened at any point instead of only after it settles.
      el.tabIndex=0;
      el.setAttribute('aria-expanded',String(expanded));
      el.title=expanded?'隐藏工作过程':'查看工作过程';
      el.onkeydown=event=>{
        if(event.key==='Enter' || event.key===' ') { event.preventDefault();el.click(); }
      };
      const last=work.at(-1);
      const controls=work.filter(i=>i.type==='tool_call' && (resolveToolUi(i.name).groupKey==='server:yan-browser' || isComputerControlCall(i) || genericMcpName(i.name) || isExternalAgentToolCall(i.name)));
      // Work-stage narration is rendered as its own row, so it never appears in
      // `work`; a control call followed by narration has still finished.
      const lastWorkIndex=fullTimeline.indexOf(last);
      const narrationAfter=lastWorkIndex>=0 && fullTimeline.some((item,index)=>index>lastWorkIndex
        && item.type==='text' && String(item.content || '').trim());
      let html;
      if (!working) html=statsMarkup(stats,true);
      else if (controls.includes(last) && !narrationAfter && parseToolIdentity(last.name).action !== 'nested_sessions' && !pluginWorkUi(last.name, last.args)) {
        const call=controls.at(-1), ui=resolveToolUi(call.name);
        const external=isExternalAgentToolCall(call.name);
        const externalMeta=external ? EXTERNAL_AGENT_UI[externalAgentProvider(call.name, call.args)
          || externalAgentProviderFromCalls(controls.filter(i=>isExternalAgentToolCall(i.name)))] : null;
        const label=external ? `${externalMeta?.name || '外部智能体'} 正在处理 Yan Agent 的派发任务…`
          : ui.groupKey==='server:yan-browser'?'我正在操控内置浏览器进行工作补充':isComputerControlCall(call)?'我正在操控你的电脑':`我正在调用 ${genericMcpName(call.name)} MCP`;
        const start=fullTimeline.indexOf(controls[0]);
        const controlStats=statistics(fullTimeline.slice(start));
        const iconMarkup=external ? (externalMeta ? `<img src="${externalMeta.logo}" alt="">` : TOOL_ICON_SVG.monitor) : ui.icon;
        html=`<span class="tc-icon-svg${external ? ' external-agent-work-logo' : ''}">${iconMarkup}</span><span class="agent-shine-text">${escapeHtml(label)} · ${statsMarkup(controlStats)}</span>`;
      } else if (last.type==='thinking') html=`<span>思考 · ${escapeHtml(String(last.content || '').replace(/\s+/g,' '))}</span>`;
      else if (last.type==='tool_call') {
        const result=fullTimeline.findLast(i=>i.type==='tool_result' && i.callId===last.callId);
        let tool=liveToolRows.get(el);
        if (!tool || tool.dataset.liveCallKey !== String(last.callId || last.openCodeKey || last.name)) {
          tool=createAgentTimelinePartElement(last,mode);
          tool.dataset.liveCallKey=String(last.callId || last.openCodeKey || last.name);
          liveToolRows.set(el,tool);
        }
        updateAgentTimelinePartElement(tool,last,result || null,result?'done':'running',mode);
        html=tool.querySelector('.tc-header')?.innerHTML || escapeHtml(last.name);
        if (parseToolIdentity(last.name).action === 'nested_sessions' || pluginWorkUi(last.name, last.args)?.static) {
          el.setAttribute('role','status'); el.removeAttribute('tabindex');
          el.removeAttribute('aria-expanded'); el.removeAttribute('title'); el.onkeydown=null;
        }
      } else html=escapeHtml(last.content || '工作中');
      if (working && last.type === 'thinking') {
        // Keep the preview node alive while its text streams.
        if (el.dataset.previewKind !== 'thinking') el.replaceChildren(document.createElement('span'));
        const text = '思考 · ' + String(last.content || '').replace(/\s+/g, ' ');
        if (el.firstChild.textContent !== text) el.firstChild.textContent = text;
        el.dataset.previewKind = 'thinking';
      } else {
        delete el.dataset.previewKind;
        if(el.innerHTML!==html) el.innerHTML=html;
      }
      // No file links or disclosure controls in the single status line.
      el.querySelectorAll('button,a').forEach(link=>{const span=document.createElement('span');span.textContent=link.textContent;link.replaceWith(span);});
      const summaryAt=visible.findIndex(i=>i.type==='text' && i.stage==='summary');
      if(!working && summaryAt>=0) desired.splice(summaryAt,0,el);
      else desired.push(el);

    }
    const keep=new Set(desired);
    for(const el of [...body.children]) if(el.dataset.segmentKey && !keep.has(el)) el.remove();
    let next=body.firstElementChild;
    for(const el of desired){if(el!==next)body.insertBefore(el,next);next=el.nextElementSibling;}
  }
  return {render,statistics,statsMarkup};
})();
