/* In-scene workbench. Data comes exclusively from Yan's local Electron bridge. */
(() => {
  'use strict';
  const $=s=>document.querySelector(s),titles={hall:['天工殿','主任务 · 实现与编排'],east:['协作东阙','子代理 · 委派与进展'],library:['藏经阁','Skill · MCP'],gate:['南天门','任务接收 · 开始新的工作'],return:['归卷台','成果 · 文件改动']};
  let bridge=null,active='',generation=0,lastFocus=null,unsubscribe=null,timer=0,busy=false;
  try { bridge=window.parent!==window?window.parent.YanTiangongHost:null; } catch {}
  const dialog=document.createElement('dialog');dialog.className='palace-panel';dialog.setAttribute('aria-labelledby','palace-title');
  dialog.innerHTML='<header class="palace-heading"><div><p class="eyebrow" id="palace-kicker"></p><h2 id="palace-title"></h2></div><button class="palace-close" aria-label="关闭阁楼面板">×</button></header><nav class="palace-nav" aria-label="阁楼入口"></nav><div class="palace-toolbar"><span id="palace-connection"></span><button id="palace-refresh">刷新</button></div><div class="palace-content" aria-live="polite"></div><footer class="palace-footer">云阙之间，诸事有序。<span>ESC 返回天宫</span></footer>';
  document.body.append(dialog);const content=dialog.querySelector('.palace-content');
  function el(tag,text,cls){const n=document.createElement(tag);n.textContent=text??'';if(cls)n.className=cls;return n;}
  function action(text,fn){const b=el('button',text,'palace-action');b.type='button';b.addEventListener('click',async()=>{if(b.disabled)return;b.disabled=true;try{await fn();}catch(e){notice(e.message,true);}finally{b.disabled=false;}});return b;}
  function notice(text,error=false){const n=el('p',text,error?'palace-error':'palace-notice');n.setAttribute('role',error?'alert':'status');content.prepend(n);}
  function empty(text){content.append(el('p',text,'palace-empty'));}
  const status=s=>({running:'执行中',working:'执行中',completed:'已完成',done:'已完成',failed:'失败',error:'异常',aborted:'已停止',idle:'空闲',connected:'已连接',stopped:'已停止',starting:'启动中'}[s]||s||'未报告');
  function row(title,desc,meta){const n=el('article','','palace-row');const body=el('div','','palace-row-body');body.append(el('h3',title),el('p',desc));n.append(body);if(meta)n.append(el('span',meta,'palace-badge'));content.append(n);return n;}
  function section(title){content.append(el('h3',title,'palace-section-title'));}
  async function load(quiet=false){
    if(!active||!dialog.open)return;const id=active,token=++generation;
    if(!quiet)content.replaceChildren(el('p','正在读取…','palace-empty'));
    $('#palace-connection').textContent=bridge?'已连接 Yan Agent · 本地数据':'独立预览 · 未连接 Yan Agent';
    if(!bridge){content.replaceChildren();empty('请在 Yan Agent 的 Work GUI 中使用真实任务、Skill 和 MCP。此独立预览不填充模拟数据。');return;}
    try{
      const data=await bridge.read(id);if(token!==generation||id!==active||!dialog.open)return;
      if(quiet&&document.activeElement?.closest('.palace-content'))return;
      content.replaceChildren();
      if(id==='library'){
        section('Skills');for(const s of data.skills||[])row(s.name||s.id,s.description||'暂无说明',s.enabled===false?'未启用':'可用');if(!data.skills?.length)empty('暂无已安装 Skill');
        section('MCP 服务');for(const m of data.mcp||[]){const n=row(m.name||m.id,m.description||m.type||'MCP',status(m.status));if(!m.builtin&&!m.native)n.append(action(m.type==='remote'?'测试连接':m.status==='connected'||m.status==='running'?'停止':'启动',async()=>{const r=await bridge.mcp(m.id,m.status==='connected'||m.status==='running'?'stop':'start');if(r?.error||r?.ok===false||r?.success===false)throw Error(r.error||'操作失败');await load();if(m.type==='remote')notice('远程 MCP 连接测试通过。');}));}if(!data.mcp?.length)empty('暂无 MCP 服务');
      }else if(id==='hall'){
        const runs=data.runs||[];for(const r of runs){const n=row(r.title||'未命名任务',r.textTail||r.prompt||'等待任务进展',status(r.status));n.append(el('small',`${r.model||'未报告模型'} · 工具调用 ${Number(r.toolCalls)||0}`));if(!r.finishedAt)n.append(action('停止任务',async()=>{const result=await bridge.cancel(r.runId);if(result?.ok===false)throw Error(result.error||'停止失败');await load();}));}if(!runs.length)empty('当前没有运行记录。可在南天门创建任务。');
      }else if(id==='east'){
        const agents=(data.agents||[]).filter(a=>a.kind==='sub'||a.id?.startsWith('sub:'));for(const a of agents)row(a.name||a.id,[a.role,a.tool,a.text].filter(Boolean).join(' · ')||'尚未报告进展',status(a.state));if(!agents.length)empty('当前没有子代理委派记录。');
      }else if(id==='return'){
        const runs=data.runs||[];for(const r of runs){const n=row(r.title||'任务成果',r.textTail||'尚无成果摘要',status(r.status));n.append(action('查看文件改动',async()=>{const d=await bridge.changes(r.sessionId,r.runId);const old=n.querySelector('.palace-files');old?.remove();const list=el('div','','palace-files');for(const f of d.files||[])list.append(el('p',`${f.path||f.filePath||f.file||'文件'}  +${f.additions||0} −${f.deletions||0}`));if(!d.files?.length)list.append(el('p','本轮未记录文件改动'));n.append(list);}));}if(!runs.length)empty('暂无可归档的运行记录。');
      }else if(id==='gate'){
        content.append(el('p','写下目标，让天工殿开始工作。','palace-lead'));
        const form=el('form','','palace-form'),label=el('label','任务目标'),input=el('textarea');input.name='prompt';input.required=true;input.maxLength=16000;input.rows=5;input.placeholder='例如：检查当前项目的登录流程，修复错误并验证。';label.append(input);
        const model=el('select');model.name='model';for(const m of data.models||[]){const o=el('option',m.name||m.modelId||m.id);o.value=JSON.stringify(m);model.append(o);}const ml=el('label','模型');ml.append(model);
        const workspace=el('p',`工作目录：${data.workspace||'未选择'}`,'palace-workspace');let selectedWorkspace=data.workspace||'';
        const pick=action('选择工作目录',async()=>{const w=await bridge.pickWorkspace();if(w){selectedWorkspace=typeof w==='string'?w:w.path||w.workspace||'';workspace.textContent='工作目录：'+selectedWorkspace;}});
        const submit=el('button','开始工作','palace-primary');submit.type='submit';submit.disabled=!model.options.length;form.append(label,ml,workspace,pick,submit);if(!model.options.length)form.append(el('p','尚无可用模型，请先在 API 配置中添加。','palace-notice'));
        form.addEventListener('submit',async e=>{e.preventDefault();if(busy||!input.value.trim())return;busy=true;submit.disabled=true;submit.textContent='正在提交…';try{const r=await bridge.submit({prompt:input.value.trim(),workspace:selectedWorkspace,model:JSON.parse(model.value)});if(!r?.ok)throw Error(r?.error||'任务未能提交');input.value='';notice('任务已提交。可在天工殿查看进展。');}catch(err){notice(err.message,true);}finally{busy=false;submit.disabled=false;submit.textContent='开始工作';}});content.append(form);
      }
    }catch(e){if(token!==generation)return;content.replaceChildren();notice('读取失败：'+e.message,true);content.append(action('重试',()=>load()));}
  }
  function open(id){if(!titles[id])return;if(!dialog.open){lastFocus=document.activeElement;dialog.showModal();}active=id;$('#palace-title').textContent=titles[id][0];$('#palace-kicker').textContent=titles[id][1];dialog.querySelectorAll('[data-palace]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.palace===id)));void load();if(!unsubscribe&&bridge)unsubscribe=bridge.subscribe(()=>{if(active==='gate'||active==='library'||timer)return;timer=setTimeout(()=>{timer=0;void load(true);},1600);});}
  for(const [id,[name]] of Object.entries(titles)){const b=action(name,()=>open(id));b.dataset.palace=id;dialog.querySelector('nav').append(b);}
  dialog.querySelector('.palace-close').onclick=()=>dialog.close();$('#palace-refresh').onclick=()=>load();dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{active='';generation++;clearTimeout(timer);timer=0;unsubscribe?.();unsubscribe=null;lastFocus?.focus();});
  window.TiangongPanels={open,close:()=>dialog.close(),isOpen:()=>dialog.open};
  window.addEventListener('pagehide',()=>{unsubscribe?.();clearTimeout(timer);});
})();
