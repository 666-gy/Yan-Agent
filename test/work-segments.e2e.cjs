'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-work-segments-'));
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '..')], env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow();
    page.on('pageerror', error => console.error(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      clearMessages();setEmptyState(false);
      const body=appendMessage('assistant','').querySelector('.msg-body');
      const run={status:'working',timeline:[],todos:[]};
      const render=()=>{run.uiTimelineRevision=(run.uiTimelineRevision||0)+1;renderAgentRunBody(body,run);};
      const check=(condition,message)=>{if(!condition)throw new Error(message);};
      for (const [name,icon,label,error] of [
        ['yan_runtime_log','file-cog','我正在读取运行时日志','读取时遇到了错误'],
        ['yan_web_list_page_assets','cloud-check','我正在查阅网页资源列表','出错'],
        ['yan_skills_create_plugin','puzzle','我正在创建新插件','创建创建时出错'],
        ['yan_session_fire_confetti','party-popper','我正在请求放礼炮','请求时遇到错误']
      ]) {
        const identity = parseToolIdentity(name);
        const aliases = identity.server ? [name, `mcp__${identity.server}__${identity.action}`] : [name];
        for (const alias of aliases) {
          for (const [phase,ok] of [['running',null],['done',true],['done',false]]) {
            const tool=buildToolStepElement(alias,{},ok===false?'Example error':'{}',ok,phase);
            check(tool.querySelector('.tc-name')?.textContent===label,'Work tool label '+alias);
            check(tool.querySelector('[data-icon]')?.dataset.icon===icon,'Work tool icon '+alias);
            check(tool.tagName==='DETAILS' && !tool.open,'Work tool stays collapsed '+alias);
            check(ok===false ? tool.querySelector('.tc-command-failure')?.textContent===error : !tool.querySelector('.tc-command-failure'),'Work tool failure '+alias);
            tool.open=true; renderToolStepDetails(tool);
            check(!!tool.querySelector('.tool-result-panel'),'Work tool can open details '+alias);
          }
        }
        const call={type:'tool_call',callId:'work-tool',name,args:{}};
        const host=document.createElement('div');
        YanWorkSegments.render(host,[call],'working','',false,'standard');
        check(host.textContent.includes(label),'Live work tool label '+name);
        YanWorkSegments.render(host,[call,{type:'tool_result',callId:call.callId,name,ok:false,output:'Example error'}],'working','',false,'standard');
        check(host.textContent.includes(error),'Live work tool failure '+name);
        const step=buildToolStepElement(name,{},'',null,'running');
        const result={type:'tool_result',callId:call.callId,name,ok:false,output:'Example error'};
        syncToolRow(step,{item:call,result,phase:'done'});
        check(!step.open && step.textContent.includes(error),'Failed update stays collapsed '+name);
        step.open=true;
        syncToolRow(step,{item:{...call},result:{...result},phase:'done'});
        check(step.open,'User-opened work detail stays open '+name);
      }
      for (const [name,label,error,staticRow] of [
        ['plugins_inspect','我正在读取Example的介绍与运行时','读取该插件资源时遇到了错误',true],
        ['plugins_read_resource','我正在读取Example的介绍与运行时','读取该插件资源时遇到了错误',true],
        ['plugins_list','让我列出当前环境下可用的插件','列出可用插件时遇到了错误',false],
        ['plugins_activate','我正在尝试激活Example','激活该插件时遇到错误',true],
        ['plugins_deactivate','我现在在尝试停用Example','关闭该插件时遇到了问题',false],
        ['yan_harness_record','我正在总结与强化记忆','构建或总结记忆时出错',false],
        ['mcp__yan_continual_harness__record','我正在总结与强化记忆','构建或总结记忆时出错',false]
      ]) {
        for (const [phase,ok] of [['running',null],['done',true],['done',false]]) {
          const tool=buildToolStepElement(name,{id:'Example'},'',ok,phase);
          check(tool.querySelector('.tc-name').textContent===label,'Plugin/Harness label '+name);
          if (name.includes('harness')) check(tool.querySelector('svg path')?.getAttribute('d')?.startsWith('M12 4.75'), 'Harness Keyline brain icon '+name);
          check((tool.tagName==='DIV')===staticRow && !tool.open,'Plugin disclosure '+name);
          check(ok===false ? tool.querySelector('.tc-command-failure')?.textContent===error : !tool.querySelector('.tc-command-failure'),'Plugin failure '+name);
          if (staticRow) check(!tool.querySelector('summary,.tc-body'),'Plugin static details '+name);
        }
        const host=document.createElement('div');
        const timeline=[{type:'tool_call',callId:'plugin',name,args:{id:'Example'}},{type:'tool_result',callId:'plugin',name,ok:false,output:'error'}];
        window.YanWorkSegments.render(host,timeline,'working','',false,'standard');
        check(host.textContent.includes(label) && host.textContent.includes(error),'Plugin live presentation '+name);
        if (name.includes('harness')) check(host.querySelector('svg path')?.getAttribute('d')?.startsWith('M12 4.75'), 'Live harness Keyline brain icon '+name);
        if (staticRow) check(host.querySelector('.agent-work-status').getAttribute('role')==='status','Plugin live interaction '+name);
      }
      for (const operation of ['dispatch','list','send','suspend','integrate']) {
        const args={operation, ...(operation==='dispatch'?{tasks:[{},{}]}:operation==='send'||operation==='integrate'?{session_id:'child'}:{})};
        for (const [phase,ok] of [['running',null],['done',true],['done',false]]) {
          const nested=buildToolStepElement('yan_session_nested_sessions',args,JSON.stringify({children:[{},{}]}),ok,phase);
          check(nested.tagName==='DIV' && !nested.querySelector('summary,details,.tc-body,button,a'),'Nested session must be static');
          check(nested.textContent.includes('我正在请求 Nested Session（'+(['send','integrate'].includes(operation)?1:2)+'个）'),'Nested count');
          check(!!nested.querySelector('.tc-command-failure')===(ok===false),'Nested failure');
          check(nested.querySelector('[data-icon="grid-circles-check"]'),'Nested icon');
        }
      }
      const nestedHost=document.createElement('div');
      window.YanWorkSegments.render(nestedHost,[{type:'tool_call',callId:'n',name:'yan_session_nested_sessions',args:{operation:'dispatch',tasks:[{},{}]}}],'working','',false,'standard');
      check(nestedHost.querySelector('.agent-work-status').getAttribute('role')==='status','Nested live row must not open panel');
      check(nestedHost.textContent.includes('Nested Session（2个）') && !nestedHost.textContent.includes('MCP'),'Nested live label');
      render();check(!body.querySelector('.agent-work-status'),'Empty waiting state');
      run.timeline.push({type:'thinking',content:'检查问题',openCodeKey:'r1'});render();
      const thinking=body.querySelector('.thinking-block');
      thinking.querySelector('summary').click();
      check(!body.querySelector('.agent-work-batch'),'Pure thinking has no nested work batch');
      run.timeline[0].content += '，继续分析';render();
      check(thinking.open && thinking.textContent.includes('继续分析'),'Open thinking updates while working');
      check(!body.closest('.msg').querySelector('.agent-work-toggle'),'No global work toggle while running');
      run.timeline.push({type:'tool_call',name:'bash',callId:'b',args:{command:'rg bug'}});render();
      run.timeline.push({type:'tool_result',name:'bash',callId:'b',output:'ok',ok:true});render();
      const row=body.querySelector('.agent-work-status');
      check(row.textContent.includes('已运行'),'Command');
      run.timeline.push({type:'thinking',content:'下一步',openCodeKey:'r2'});render();
      check(body.querySelector('.agent-work-status')===row && row.textContent.includes('下一步'),'In-place reasoning');
      run.timeline.push({type:'tool_call',name:'browser_click',callId:'br',args:{}});render();
      run.timeline.push({type:'tool_result',name:'browser_click',callId:'br',ok:false,output:'error'});
      run.timeline.push({type:'tool_call',name:'edit',callId:'e',args:{filePath:'a.py'}});
      run.timeline.push({type:'tool_result',name:'edit',callId:'e',ok:true,output:'ok',metadata:{files:[{file:'a.py',additions:3,deletions:2}]}});render();
      check(!row.textContent.includes('操控内置浏览器') && row.textContent.includes('a.py'),'Root row follows the edit after browser work');
      check(!row.textContent.includes('操控浏览器时遇到错误'),'Whole activity labelled failure');
      run.timeline.push({type:'tool_call',name:'mcp__demo__lookup',callId:'m',args:{}});render();
      check(row.textContent.includes('demo MCP') && row.querySelector('.agent-shine-text'),'MCP status');
      run.status='done';run.summaryStarted=true;run.timeline.push({type:'text',stage:'summary',content:'已完成',openCodeKey:'final'});render();
      const openHistory = async host => {
        const footer = host.closest('.msg').querySelector('.agent-work-toggle');
        if (footer.getAttribute('aria-expanded') !== 'true') footer.click();
        const group = host.querySelector('.agent-work-batch');
        if (!group.open) group.querySelector('summary').click();
        await new Promise(resolve=>setTimeout(resolve,20));
        return group.querySelector('.agent-work-history');
      };
      check(!body.querySelector('.agent-work-status') && body.textContent.includes('已完成'),'Collapsed view contains final reply only');
      const toggle=body.closest('.msg').querySelector('.msg-actions .agent-work-toggle');
      check(toggle && !toggle.hidden,'History action available');
      let history=await openHistory(body);
      const total=body.querySelector('summary.agent-work-status');
      check(total.textContent.includes('运行了4条命令（1个失败）') && total.textContent.includes('使用了内置浏览器') && total.querySelector('.run-change-add').textContent==='+3','Final totals');
      check(history.textContent.includes('检查问题') && history.textContent.includes('rg bug'),'Summary opens real history');
      check(!total.querySelector('.agent-shine-text'),'Final shimmer');
      render();check(body.querySelector('.agent-work-batch').open,'Expansion persists on render');
      toggle.click();check(!body.querySelector('.agent-work-history'),'Footer hides narration, summaries and details');
      run.status='interrupted';render();await openHistory(body);
      check(body.querySelector('.agent-work-batch').open,'Interrupted history available');
      toggle.click();
      const restored=appendMessage('assistant','').querySelector('.msg-body');
      renderAgentRunBody(restored,JSON.parse(JSON.stringify(run)));
      check(!restored.querySelector('.agent-work-history'),'Restored history starts collapsed');
      await openHistory(restored);
      check(restored.querySelector('.agent-work-batch').open,'Restored history opens');
      const browserBody=appendMessage('assistant','').querySelector('.msg-body');
      const browserRun={status:'done',timeline:[
        {type:'thinking',content:'浏览器之前',openCodeKey:'before'},
        {type:'tool_call',name:'browser_click',callId:'first',args:{}},
        {type:'tool_result',callId:'first',ok:true,output:'ok'},
        {type:'thinking',content:'不应该散开的中间思考',openCodeKey:'middle'},
        {type:'tool_call',name:'edit',callId:'change',args:{filePath:'a.py'}},
        {type:'tool_result',callId:'change',ok:true,output:'ok',metadata:{files:[{file:'a.py',additions:5,deletions:5}]}},
        {type:'tool_call',name:'browser_screenshot',callId:'last',args:{}},
        {type:'thinking',content:'浏览器之后',openCodeKey:'after'},
        {type:'tool_result',callId:'last',ok:false,output:'error'}
      ]};
      renderAgentRunBody(browserBody,browserRun);await openHistory(browserBody);
      const browserHistory=browserBody.querySelector('.agent-work-history');
      const browserRows=browserHistory.querySelectorAll('.browser-work-row');
      check(browserRows.length===1,'Browser span stays one row across reasoning and edits');
      check(browserRows[0].textContent.includes('运行了3条命令（1个失败）') && browserRows[0].textContent.includes('1个文件') && browserRows[0].textContent.includes('+5'),'Browser span counts commands, late failure and file changes');
      check(!browserHistory.textContent.includes('不应该散开的中间思考') && !browserHistory.querySelector('.work-mutation-row'),'Intermediate work is folded into browser span');
      check(browserHistory.textContent.includes('浏览器之前') && browserHistory.textContent.includes('浏览器之后'),'Work outside browser span preserved');
      check(!browserRows[0].querySelector('summary,button,details') && !browserRows[0].textContent.includes('操控浏览器时遇到错误'),'Browser row noninteractive and failure only counted');
      const cachedHeader=browserRows[0].firstElementChild;
      const observer=new MutationObserver(()=>{});
      observer.observe(browserRows[0],{childList:true,subtree:true,characterData:true});
      renderAgentRunBody(browserBody,browserRun);
      check(browserHistory.querySelector('.browser-work-row').firstElementChild===cachedHeader && !observer.takeRecords().length,'Unchanged browser row reuses its rendered subtree');
      browserRun.timeline.push({type:'thinking',content:'后续新增',openCodeKey:'new'});
      browserRun.uiTimelineRevision=1;renderAgentRunBody(browserBody,browserRun);
      check(browserHistory.textContent.includes('后续新增') && browserRows[0].firstElementChild===cachedHeader,'Append renders new content and preserves existing DOM');
      observer.disconnect();
      const computerBody=appendMessage('assistant','').querySelector('.msg-body');
      const computerRun={status:'done',timeline:[
        {type:'tool_call',name:'plugins_activate',callId:'p',args:{id:'yan-computer-use'},openCodeKey:'p'},
        {type:'tool_result',callId:'p',ok:true,output:'ok'},
        {type:'tool_call',name:'plugins_read_resource',callId:'r',args:{id:'yan-computer-use',resource:'skill:computer-use'},openCodeKey:'r'},
        {type:'tool_result',callId:'r',ok:true,output:'ok'},
        {type:'tool_call',name:'yanp_0123456789abcdef_0123456789_computer_list_windows',callId:'w',args:{on_screen_only:true},openCodeKey:'w'},
        {type:'tool_result',callId:'w',ok:true,output:'{"ok":true}'},
        {type:'text',stage:'summary',content:'完成',openCodeKey:'computer-final'}
      ]};
      renderAgentRunBody(computerBody,computerRun);await openHistory(computerBody);
      const computerHistory=computerBody.querySelector('.agent-work-history');
      const computerRows=computerHistory.querySelectorAll('.computer-work-row');
      check(computerRows.length===1,'Parallel plugin activation and the first control call fold into one computer row');
      check(!/Yan Computer Use/i.test(computerHistory.textContent),'No bare computer tool row remains');
      check(computerRows[0].textContent.includes('运行了3条命令（0个失败）'),'Computer row reports command statistics');
      check(!computerRows[0].querySelector('summary,button,details'),'Computer row stays noninteractive');
      const streaming={type:'thinking',content:'a'.repeat(10000),streaming:true};
      const streamingElement=createAgentTimelinePartElement(streaming,'standard');
      updateAgentTimelinePartElement(streamingElement,streaming,null,'running');
      streaming.content=streaming.content.slice(0,5000)+'b'+streaming.content.slice(5001);
      updateAgentTimelinePartElement(streamingElement,streaming,null,'running');
      check(streamingElement.querySelector('.thinking-text').textContent[5000]==='b','Cache detects in-place streaming changes, including long content');
      const toolCall={type:'tool_call',name:'bash',callId:'late',args:{command:'echo cache'}};
      const toolElement=createAgentTimelinePartElement(toolCall,'standard');
      updateAgentTimelinePartElement(toolElement,toolCall,null,'running');
      const lateResult={type:'tool_result',callId:'late',ok:false,output:'failed'};
      updateAgentTimelinePartElement(toolElement,toolCall,lateResult,'done');
      check(toolElement.textContent.includes('运行失败'),'Late result invalidates running cache');
      const completedHeader=toolElement.firstElementChild;
      updateAgentTimelinePartElement(toolElement,JSON.parse(JSON.stringify(toolCall)),JSON.parse(JSON.stringify(lateResult)),'done');
      check(toolElement.firstElementChild===completedHeader,'Equivalent restored data reuses rendered tool');
      check(formatRunElapsed(3661000)==='1时1分1秒' && formatRunElapsed(61000)==='1分1秒' && formatRunElapsed(9000)==='9秒' && formatRunElapsed(0)==='0秒','Elapsed duration format');
      check(browserBody.querySelector('.run-status-label').textContent==='用时','Elapsed label');
      check(!YanWorkSegments.statsMarkup(YanWorkSegments.statistics([])).includes('文件'),'Empty files');
      const boundedBody=appendMessage('assistant','').querySelector('.msg-body');
      const fullTimeline=[
        {type:'text',stage:'work',content:'模型自行生成的处理中间正文',openCodeKey:'old-narration'},
        {type:'tool_call',name:'read',callId:'bounded-call',args:{path:'a.js'},openCodeKey:'bounded-call'},
        {type:'text',stage:'summary',content:'最终答复',openCodeKey:'bounded-summary'}
      ];
      const boundedTimeline=[
        {type:'progress',variant:'work-trim',omitted:20,openCodeKey:'timeline:trimmed'},
        ...fullTimeline.slice(-2)
      ];
      const boundedActivity=ensureAgentActivity(boundedBody).querySelector('.agent-activity-body');
      YanWorkSegments.render(boundedActivity,boundedTimeline,'done','',true,'standard',fullTimeline);
      check(!boundedBody.querySelector('.agent-work-status'),'Collapsed work hides summaries');
      check(!boundedBody.textContent.includes('模型自行生成的处理中间正文'),'Collapsed work hides intermediate narration');
      boundedBody.querySelector('.agent-run-header').dataset.workExpanded='true';
      YanWorkSegments.render(boundedActivity,boundedTimeline,'done','',true,'standard',fullTimeline);
      check(boundedBody.textContent.includes('模型自行生成的处理中间正文'),'Expanded work preserves narration outside bounded tool history');
      boundedBody.querySelector('summary.agent-work-status').click();
      await new Promise(resolve=>setTimeout(resolve,20));
      check(boundedBody.querySelector('.agent-work-history').textContent.includes('a.js'),'Summary opens retained tool history');
      boundedBody.querySelector('.agent-run-header').dataset.workExpanded='false';
      YanWorkSegments.render(boundedActivity,boundedTimeline,'done','',true,'standard',fullTimeline);
      check(!boundedBody.querySelector('.agent-work-history'),'Collapsing releases details');

    });
    console.log('Single work row, control/MCP statistics and animation removal passed');
  } finally { await app?.close(); fs.rmSync(profile,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
