/* Trusted local palace frame; existing preload IPC remains the only backend. */
(() => {
  'use strict';
  const backend=window.yan;let frame=null,opened=false;
  const list=value=>Array.isArray(value)?value:[];
  window.YanTiangongHost=Object.freeze({
    async read(place){
      if(!backend)throw Error('Yan Agent 本地接口不可用');
      if(place==='library'){
        const [skills,mcp]=await Promise.all([backend.listSkills(),backend.mcpList()]);
        return {skills:list(skills).map(s=>({id:s.id,name:s.name,description:s.description,enabled:s.enabled})),mcp:list(mcp).map(m=>({id:m.id,name:m.name,description:m.description,type:m.type,status:m.status||m.connectionStatus||(m.enabled?'待连接':'未启用'),builtin:m.builtin||m.systemManaged,native:m.native}))};
      }
      if(place==='gate'){
        const [models,workspace]=await Promise.all([backend.listQuickModels(),backend.getWorkspace()]);
        return {models:list(models?.models||models).filter(m=>!m.modelType||m.modelType==='text').map(m=>({id:m.id,modelId:m.modelId||m.id,name:m.name,providerId:m.providerId,supplierId:m.supplierId,modelType:m.modelType})),workspace};
      }
      if(['hall','east','return'].includes(place))return backend.workGuiSnapshot();
      throw Error('未知阁楼');
    },
    subscribe(callback){return backend?.onWorkGuiEvent(()=>callback())||(()=>{});},
    cancel(runId){return backend.openCodeCancelRun(runId);},
    mcp(id,action){if(action==='start')return backend.mcpStart(id);if(action==='stop')return backend.mcpStop(id);throw Error('未知操作');},
    changes(sessionId,runId){return backend.openCodeSessionChanges(sessionId,runId,{includeDiff:false});},
    pickWorkspace(){return backend.pickWorkspace();},
    submit(payload){if(typeof window.YanPalaceSubmit!=='function')throw Error('任务入口尚未就绪');return window.YanPalaceSubmit(payload);}
  });
  function open(){const host=document.getElementById('pageWorkGui');if(!host)return;opened=true;
    if(!frame){frame=document.createElement('iframe');frame.className='yan-palace-frame';frame.title='云顶天宫工作台';frame.src='work-gui/palace/index.html';frame.style.cssText='width:100%;height:100%;border:0;display:block;background:#131d1c';host.replaceChildren(frame);}
    else frame.contentWindow?.postMessage({source:'yan-palace-host',kind:'resume'},'*');
  }
  function close(){opened=false;frame?.contentWindow?.postMessage({source:'yan-palace-host',kind:'pause'},'*');}
  window.YanWorkGui={open,close,isOpen:()=>opened,refresh:()=>{},getState:()=>({opened,scene:'palace'})};
})();
