'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'yan-iu-size-'));let app;
 try{
  app=await _electron.launch({executablePath:require('electron'),args:[process.cwd()],env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:profile}});
  const page=await app.firstWindow();await page.waitForFunction(()=>window.__YAN_APP_READY__&&window.YanIntelligentUi);
  await page.evaluate(async()=>{
   if(!state.currentSession)await newSession();setEmptyState(false);
   const panel=YanIntelligentUi.create();panel.id='sizing-panel';appendMessage('assistant','').querySelector('.msg-body').append(panel);
   YanIntelligentUi.update(panel,{id:'sizing-test',revision:1,title:'自然高度测试',purpose:'',status:'ready',format:'html',html:'<style>body{padding:8px;margin:0}.content{height:410px;background:#eef2ee;border-radius:16px;padding:16px;box-sizing:border-box}</style><div class="content">内容随面板自然展开</div>',resources:null});
  });
  const outer=page.locator('#sizing-panel .intelligent-ui-frame');
  const host=page.frameLocator('#sizing-panel .intelligent-ui-frame');
  const inner=host.frameLocator('iframe');await inner.locator('.content').waitFor();
  for(const width of [1100,1600]){
   await page.setViewportSize({width,height:1000});
   const bounds=await page.locator('#sizing-panel').evaluate(el=>({panel:el.getBoundingClientRect().width,parent:el.parentElement.getBoundingClientRect().width,frame:el.querySelector('iframe').getBoundingClientRect().width}));
   assert.ok(Math.abs(bounds.panel-bounds.parent)<1,'IU fills the answer column');
   assert.ok(Math.abs(bounds.frame-bounds.parent)<1,'sandbox fills the answer column');
  }
  for(const height of [410,1530,80]){
   await inner.locator('.content').evaluate((el,h)=>{el.style.height=h+'px';},height);
   await page.waitForFunction(({height})=>{const el=document.querySelector('#sizing-panel .intelligent-ui-frame');return Math.abs(parseFloat(el.style.height)-Math.max(160,height+18))<=2;},{height});
   assert.ok(await inner.locator('html').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'inner content must fit viewport');
   assert.ok(await host.locator('html').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'outer host must not add scrollbar');
   assert.ok((await outer.boundingBox()).height>=height,'content remains reachable above old 1200px cap');
  }
  assert.equal(await page.locator('#sizing-panel .intelligent-ui-handoff').count(),0);
  console.log('PASS iframe growth, shrink, content above 1200px, no nested viewport overflow, no generic footer.');
 }finally{await app?.close();await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:30,retryDelay:200}).catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
