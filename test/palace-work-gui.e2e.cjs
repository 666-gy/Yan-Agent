'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const { _electron:electron }=require('playwright');
const root=path.resolve(__dirname,'..');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'yan-palace-e2e-'));
(async()=>{
  let app;
  try{
    app=await electron.launch({executablePath:require('electron'),args:[root],cwd:root,env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:data}});
    const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>typeof showWindowView==='function'&&window.YanTiangongHost&&typeof state!=='undefined'&&state.currentSession);
    await page.evaluate(()=>showWindowView('work-gui'));
    const f=page.frameLocator('.yan-palace-frame');
    const evidence=path.join(root,'output','palace');fs.mkdirSync(evidence,{recursive:true});
    await f.getByRole('button',{name:'推 门 入 阙',exact:false}).waitFor();
    await page.screenshot({path:path.join(evidence,'electron-gate.png')});
    await f.getByRole('button',{name:'推 门 入 阙',exact:false}).click();
    await f.locator('#palace-entry').waitFor({state:'detached'});
    await f.getByRole('button',{name:'查看藏经阁',exact:true}).click();
    await f.getByText('已连接 Yan Agent · 本地数据',{exact:true}).waitFor();
    await f.getByRole('heading',{name:'Skills',exact:true}).waitFor();
    assert.equal(await f.getByText('读取失败：',{exact:false}).count(),0);
    // Real IPC result must arrive without commands, arguments, credentials or headers.
    const catalog=await page.evaluate(()=>window.YanTiangongHost.read('library'));
    assert(Array.isArray(catalog.skills));assert(Array.isArray(catalog.mcp));
    for(const m of catalog.mcp){assert(!('headers' in m));assert(!('command' in m));assert(!('args' in m));}
    for(const [name,title] of [['天工殿','天工殿'],['协作东阙','协作东阙'],['归卷台','归卷台'],['南天门','南天门']]){
      await f.getByRole('button',{name,exact:true}).click();
      await f.getByRole('heading',{name:title,exact:true}).waitFor();
    }
    await f.getByLabel('任务目标',{exact:true}).waitFor();
    assert.equal(await f.getByRole('button',{name:'开始工作',exact:true}).isDisabled(),true,'No fake models in a clean profile');
    const gate=await page.evaluate(()=>window.YanTiangongHost.read('gate'));assert(Array.isArray(gate.models));
    // Isolated IPC fixtures exercise mutations without model requests or user MCP processes.
    await app.evaluate(({ipcMain})=>{
      const model={id:'test-model',providerId:'test-provider',supplierId:'test-supplier',name:'测试模型',modelType:'text'};
      ipcMain.removeHandler('models:quick-list');ipcMain.handle('models:quick-list',()=>({models:[model]}));
      ipcMain.removeHandler('work-gui:snapshot');ipcMain.handle('work-gui:snapshot',()=>({runs:[{runId:'test-run',sessionId:'test-session',title:'测试任务',status:'running',toolCalls:2}],agents:[{id:'sub:test',kind:'sub',name:'测试子代理',state:'working',text:'读取文件'}]}));
      ipcMain.removeHandler('opencode:session-changes');ipcMain.handle('opencode:session-changes',(_e,p)=>{if(p.yanSessionId!=='test-session'||p.runId!=='test-run')throw Error('bad run selection');return {files:[{path:'src/example.js',additions:3,deletions:1}]};});
      ipcMain.removeHandler('opencode:cancel-run');ipcMain.handle('opencode:cancel-run',(_e,id)=>{if(id!=='test-run')throw Error('bad cancellation');return {ok:true};});
      let connected=false;
      ipcMain.removeHandler('mcp:list');ipcMain.handle('mcp:list',()=>[{id:'palace-test',name:'测试 MCP',status:connected?'connected':'stopped'}]);
      ipcMain.removeHandler('mcp:start');ipcMain.handle('mcp:start',(_e,id)=>{if(id!=='palace-test')throw Error('bad mcp id');connected=true;return {ok:true};});
      ipcMain.removeHandler('mcp:stop');ipcMain.handle('mcp:stop',(_e,id)=>{if(id!=='palace-test')throw Error('bad mcp id');connected=false;return {ok:true};});
    });
    await page.evaluate(()=>{window.palaceTestSubmission=null;submitMessage=async(text,attachments,skills,options)=>{window.palaceTestSubmission={text,sessionId:options.session.id,model:options.modelSelection};return {ok:true};};});
    await f.getByRole('button',{name:'刷新',exact:true}).click();
    await f.getByLabel('任务目标',{exact:true}).fill('验收测试：不调用模型');
    await f.getByRole('button',{name:'开始工作',exact:true}).click();
    await f.getByText('任务已提交。可在天工殿查看进展。',{exact:true}).waitFor();
    const submitted=await page.evaluate(()=>window.palaceTestSubmission);assert.equal(submitted.text,'验收测试：不调用模型');assert(submitted.sessionId);assert.equal(submitted.model.modelId,'test-model');
    await f.getByRole('button',{name:'天工殿',exact:true}).click();
    await f.getByRole('button',{name:'停止任务',exact:true}).click();
    await f.getByRole('button',{name:'协作东阙',exact:true}).click();await f.getByRole('heading',{name:'测试子代理',exact:true}).waitFor();
    await f.getByRole('button',{name:'归卷台',exact:true}).click();await f.getByRole('button',{name:'查看文件改动',exact:true}).click();
    await f.getByText('src/example.js  +3 −1',{exact:true}).waitFor();
    await f.getByRole('button',{name:'藏经阁',exact:true}).click();await f.getByRole('button',{name:'启动',exact:true}).click();await f.getByRole('button',{name:'停止',exact:true}).click();await f.getByRole('button',{name:'启动',exact:true}).waitFor();
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('work-gui:snapshot');ipcMain.handle('work-gui:snapshot',()=>{throw Error('测试读取错误');});});
    await f.getByRole('button',{name:'天工殿',exact:true}).click();await f.getByRole('alert').filter({hasText:'读取失败'}).waitFor();
    await f.getByRole('button',{name:'南天门',exact:true}).click();
    await page.screenshot({path:path.join(evidence,'electron-panel.png')});
    for(const width of [320,375,414,768]){
      await page.evaluate(w=>{const f=document.querySelector('.yan-palace-frame');f.style.width=w+'px';},width);
      const overflow=await f.locator('html').evaluate(e=>({w:e.clientWidth,scroll:e.scrollWidth}));
      assert(overflow.scroll<=overflow.w+1,`horizontal overflow at ${width}`);
    }
    await page.evaluate(()=>document.querySelector('.yan-palace-frame').style.width='100%');
    await f.getByRole('button',{name:'关闭阁楼面板',exact:true}).click();
    await f.getByRole('button',{name:'观荷',exact:true}).click();
    await f.getByRole('heading',{name:'风过莲池',exact:true}).waitFor();
    await page.evaluate(()=>showWindowView('agent'));
    await page.evaluate(()=>showWindowView('work-gui'));
    assert.equal(await f.locator('#palace-entry').count(),0,'Existing scene resumes without rebuilding gate');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,skills:catalog.skills.length,mcp:catalog.mcp.length,widths:[320,375,414,768],userData:data}));
  }finally{await app?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
