const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{_electron:electron}=require('playwright');
(async()=>{let app;const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'yan-annotations-'));try{
app=await electron.launch({executablePath:require('electron'),args:[root],cwd:root,env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:data}});
const page=await app.firstWindow();await page.waitForFunction(()=>typeof createRightSidebarTab==='function'&&state.currentSession);
const id=await page.evaluate(async url=>{const tab=createRightSidebarTab('browser');activateRightSidebarTab(tab.id);const c=browserTabControllers.get(tab.id);await c.navigate(url,{waitForLoad:true});return tab.id;},pathToFileURL(path.join(root,'test/fixtures/browser-agent.html')).href);
const panel=page.locator('[data-browser-tab-id="'+id+'"]');
page.on('pageerror',e=>console.error(e.message));
await page.evaluate(()=>{window.annotationSent=[];validateQueuedModelPayload=()=>true;submitMessage=async (text,a,b,options)=>{window.annotationSent.push(text);window.annotationOptions=options;return {ok:!window.annotationFail,error:'test failure'};};document.querySelector('#composerInput').textContent='保留原草稿';});
await page.evaluate(()=>{if(typeof expandRightSidebarForAgentBrowser==='function')expandRightSidebarForAgentBrowser();});
for(const focus of [false,true,false]){
await page.evaluate(value=>setBrowserFocusMode(value),focus);await page.waitForTimeout(150);
const a=await panel.getByRole('button',{name:'注释网页',exact:true}).boundingBox(),b=await panel.getByRole('button',{name:'浏览器设置',exact:true}).boundingBox();
assert.ok(Math.abs(a.y-b.y)<3,'annotation and menu must stay on same row');assert.ok(b.x>a.x&&b.x-a.x-a.width<16,'annotation must immediately precede menu');
}
await page.evaluate(id=>{const c=browserTabControllers.get(id);c.manualZoom=.8;applyBrowserZoom(c,.8);},id);
await panel.getByRole('button',{name:'注释网页',exact:true}).click();
const layer=panel.locator('.browser-annotation-layer');await layer.waitFor({state:'visible'});
const point=await page.evaluate(async id=>{const c=browserTabControllers.get(id),r=c.webview.getBoundingClientRect();const p=await c.webview.executeJavaScript(`(()=>{const e=document.querySelector('button');const r=e.getBoundingClientRect();return {x:(r.x+r.width/2)/innerWidth,y:(r.y+r.height/2)/innerHeight}})()`);return {x:r.x+p.x*r.width,y:r.y+p.y*r.height};},id);
await page.mouse.move(point.x,point.y);await page.waitForTimeout(250);
assert.equal(await panel.locator('.browser-annotation-info>div').count(),3);
await page.mouse.click(point.x,point.y);
await panel.getByRole('textbox',{name:'网页注释内容'}).fill('请把这个按钮改成圆角');
assert.equal(await page.evaluate(id=>browserTabControllers.get(id).webview.executeJavaScript('document.getElementById("actionState").textContent'),id),'idle');
await panel.getByRole('button',{name:'注释参数设置'}).click();await panel.getByLabel('字号',{exact:true}).fill('20');
const before=await panel.locator('form.browser-annotation-editor').boundingBox();const header=await panel.locator('.annotation-options header').boundingBox();
await page.mouse.move(header.x+60,header.y+15);await page.mouse.down();await page.mouse.move(header.x-20,header.y-40,{steps:5});await page.mouse.up();
const after=await panel.locator('form.browser-annotation-editor').boundingBox();assert.ok(Math.abs(after.x-before.x)>30&&Math.abs(after.y-before.y)>20,'expanded parameters must drag');
fs.mkdirSync(path.join(root,'output/browser'),{recursive:true});await page.screenshot({path:path.join(root,'output/browser/annotation.png')});
await page.evaluate(()=>window.annotationFail=true);
await panel.getByRole('button',{name:'确认参数',exact:true}).click();
await page.screenshot({path:path.join(root,'output/browser/annotation-pill.png')});
const note=panel.getByRole('textbox',{name:'网页注释内容'});await note.press('End');await note.press('Shift+Enter');await note.press('x');assert.match(await note.inputValue(),/\nx/);assert.equal(await page.evaluate(()=>window.annotationSent.length),1);
await page.evaluate(()=>window.annotationFail=true);await note.press('Enter');await page.waitForTimeout(100);assert.equal(await note.isVisible(),true);assert.match(await note.inputValue(),/圆角/);
await page.evaluate(()=>window.annotationFail=false);await note.press('Enter');await panel.locator('form.browser-annotation-editor').waitFor({state:'hidden'});
assert.match(await page.evaluate(()=>window.annotationSent.at(-1)),/20px/);assert.equal(await page.locator('#composerInput').innerText(),'保留原草稿');
await page.mouse.move(point.x,point.y+220);await page.mouse.click(point.x,point.y+220);await page.waitForTimeout(150);
assert.equal(await panel.locator('.browser-annotation-editor').isVisible(),true);
const pill=await panel.locator('.annotation-pill').boundingBox();await page.mouse.move(pill.x+180,pill.y+8);await page.mouse.down();await page.mouse.move(pill.x+220,pill.y+38);await page.mouse.up();
await panel.getByRole('button',{name:'刷新',exact:true}).click();await layer.waitFor({state:'hidden'});assert.equal(await panel.getByRole('button',{name:'注释网页',exact:true}).getAttribute('aria-pressed'),'false');
await panel.getByRole('button',{name:'注释网页',exact:true}).click();await layer.waitFor({state:'visible'});
await page.evaluate(id=>setBrowserAgentControl(browserTabControllers.get(id),true,{runId:'test-annotation'}),id);await layer.waitFor({state:'hidden'});
await page.evaluate(id=>setBrowserAgentControl(browserTabControllers.get(id),false),id);
// Parameters-only submission must carry a live target into the run, then mutate that original tab.
await panel.getByRole('button',{name:'注释网页',exact:true}).click();
await page.mouse.click(point.x,point.y);
await panel.getByRole('button',{name:'注释参数设置'}).click();
await panel.getByLabel('字号',{exact:true}).fill('23');
await panel.getByRole('button',{name:'确认参数',exact:true}).click();
await panel.locator('form.browser-annotation-editor').waitFor({state:'hidden'});
assert.match(await page.evaluate(()=>window.annotationSent.at(-1)),/fontSize: 23px/);
const applied=await page.evaluate(async id=>{
 const annotation=window.annotationOptions.browserAnnotation;
 const runId='test-annotation-apply',sessionId=state.currentSession.id;
 state.activeRuns.set(sessionId,{runCtx:{runId,sessionId,workspace:'',browserAnnotation:annotation}});
 try {
  const count=browserTabControllers.size;
  const opened=await executeBrowserAgentCommand({action:'open',params:{yan_run_id:runId,url_or_path:annotation.url}});
  const c=browserTabControllers.get(id);
  await c.webview.executeJavaScript(`document.querySelector('#actionButton').innerHTML='<span>Run action</span><svg aria-hidden="true"></svg>'`);
  const result=await executeBrowserAgentCommand({action:'apply_annotation',params:{yan_run_id:runId,text:'老妹你真美'}});
  const dom=await c.webview.executeJavaScript(`({text:document.querySelector('#actionButton span').textContent,size:getComputedStyle(document.querySelector('#actionButton')).fontSize,svg:!!document.querySelector('#actionButton svg'),clicked:document.querySelector('#actionState').textContent})`);
  await c.webview.executeJavaScript(`document.querySelector('#actionButton').remove()`);
  const stale=await executeBrowserAgentCommand({action:'apply_annotation',params:{yan_run_id:runId,text:'stale'}});
  return {result,dom,stale,sameTab:opened.tabId===id,noExtraTab:count===browserTabControllers.size};
 } finally {state.activeRuns.delete(sessionId);setBrowserAgentControl(browserTabControllers.get(id),false);}
},id);
assert.equal(applied.result.ok,true);assert.equal(applied.sameTab,true);assert.equal(applied.noExtraTab,true);
assert.deepEqual(applied.dom,{text:'老妹你真美',size:'23px',svg:true,clicked:'idle'});
assert.equal(applied.stale.ok,false);
console.log('PASS browser annotation: element selection, parameters, composer handoff, navigation cleanup');
}finally{await app?.close();fs.rmSync(data,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
