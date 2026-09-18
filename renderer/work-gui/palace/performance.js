// Readable diagnostics. Reports actual browser frame cadence, not estimated GPU time.
(() => {
  window.TiangongGpuTimer=function(renderer){
    const gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),render=renderer.render.bind(renderer);let pending=null,frame=0,cpu=0,gpu=null;
    renderer.render=function(...args){
      if(pending&&gl.getQueryParameter(pending,gl.QUERY_RESULT_AVAILABLE)){if(!gl.getParameter(ext.GPU_DISJOINT_EXT)){const ms=gl.getQueryParameter(pending,gl.QUERY_RESULT)/1e6;gpu=gpu===null?ms:gpu*.8+ms*.2;}gl.deleteQuery(pending);pending=null;}
      const query=ext&&!pending&&frame++%8===0?gl.createQuery():null;if(query)gl.beginQuery(ext.TIME_ELAPSED_EXT,query);
      const begin=performance.now();try{return render(...args);}finally{cpu=cpu*.9+(performance.now()-begin)*.1;if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);pending=query;}}
    };
    return {stats:()=>({cpuMs:cpu,gpuMs:gpu}),dispose(){if(pending)gl.deleteQuery(pending);pending=null;}};
  };
  const original=Tiangong.create;
  Tiangong.create=function(...args){
    const api=original.apply(this,args),panel=document.createElement('output');
    panel.id='performance';panel.setAttribute('aria-label','渲染性能');
    panel.style.cssText='position:fixed;z-index:50;left:16px;bottom:12px;background:#152326ed;color:#eee6cf;border:1px solid #776b4b;padding:8px 12px;font:11px/1.6 Consolas,monospace;pointer-events:none;white-space:pre';
    panel.hidden=!new URLSearchParams(location.search).has('profile');document.body.append(panel);
    const samples=[];let previous=0,lastReport=0,frame=0,disposed=false;
    function tick(now){if(disposed)return;frame=requestAnimationFrame(tick);if(document.hidden){previous=0;return;}if(previous){const ms=now-previous;if(ms>0&&ms<2000)samples.push(ms);if(samples.length>240)samples.shift();}previous=now;
      if(now-lastReport<1000)return;lastReport=now;if(!samples.length)return;
      const sorted=[...samples].sort((a,b)=>a-b),avg=samples.reduce((a,b)=>a+b,0)/samples.length,s=api.stats();
      panel.textContent=`${(1000/avg).toFixed(1)} FPS · p95 ${sorted[Math.floor(sorted.length*.95)].toFixed(1)} ms\n${s.calls} draws · ${s.triangles.toLocaleString()} triangles · DPR ${s.dpr??'1.6 cap'}\nCPU submit ${s.cpuMs?.toFixed(2)??'—'} ms · GPU ${s.gpuMs?.toFixed(2)??'unavailable'} ms\n${s.quality||'V1 baseline'} · ${samples.length} frames · P 隐藏`;
    }
    frame=requestAnimationFrame(tick);const key=e=>{if(e.key.toLowerCase()==='p'&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))panel.hidden=!panel.hidden;};window.addEventListener('keydown',key);
    const dispose=api.dispose;api.dispose=()=>{disposed=true;cancelAnimationFrame(frame);window.removeEventListener('keydown',key);panel.remove();dispose();};return api;
  };
})();
