'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright');
const {createIntelligentUi}=require('../lib/intelligent-ui-creator');
const {budget,trip}=require('./fixtures/intelligent-ui-openui.cjs');
(async()=>{
 let app;const userData=fs.mkdtempSync(path.join(os.tmpdir(),'yan-openui-'));
 try{
  app=await _electron.launch({executablePath:require('electron'),args:[process.cwd()],env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:userData}});
  const page=await app.firstWindow();page.on('pageerror',e=>console.log('PAGEERROR',e.message));
  await page.setViewportSize({width:1100,height:900});
  await page.context().route('https://**/*',route=>route.request().url()==='https://tiles.openfreemap.org/styles/positron'?route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e5ece7'}}]})}):route.abort());
  await page.waitForFunction(()=>window.__YAN_APP_READY__&&window.YanIntelligentUi);
  async function render(code,resources={}){
   const active={intelligentUiAllowed:true};const task_id='openui-test';
   createIntelligentUi(active,task_id,{task_id,action:'start',title:'OpenUI 小程序',purpose:'调整并保留方案',placement:'final'});
   const args={task_id,action:'render',format:'openui',code,resources,...(code===budget?{handoff:true}:{})};const result=createIntelligentUi(active,task_id,args);
   await page.evaluate(async({args,result})=>{
    if(!state.currentSession)await newSession();setEmptyState(false);document.documentElement.dataset.theme='light';
    document.getElementById('openui-test')?.remove();
    window.openUiBody=appendMessage('assistant','').querySelector('.msg-body');openUiBody.id='openui-test';
    window.openUiItem=YanIntelligentUi.fromCall({args},{ok:true,output:JSON.stringify(result)},'done');
    window.openUiTimeline=[
     {type:'tool_call',callId:'render-openui',name:'yan_session_intelligent_ui_creator',args},
     {type:'tool_result',callId:'render-openui',name:'yan_session_intelligent_ui_creator',ok:true,output:JSON.stringify(result)},
     {type:'tool_call',callId:'pending-openui',name:'yan_session_intelligent_ui_creator',args:{...args,code:'root = App(['}}
    ];
    renderAgentRunBody(openUiBody,{status:'working',summaryStarted:true,timeline:openUiTimeline,modelId:'deepseek-v4'});
    setComposerText('保留的草稿');
   },{args,result});
  }
  await render(budget);
  const panel=page.locator('#openui-test .intelligent-ui-output');
  const ui=page.frameLocator('#openui-test .intelligent-ui-frame').frameLocator('iframe');
  await ui.locator('[data-total]').waitFor({timeout:15000});
  assert.match(await ui.locator('[data-total]').textContent(),/1,680/);
  await ui.getByLabel('墙面涂料数量').fill('5');
  assert.match(await ui.locator('[data-total]').textContent(),/2,240/);
  await ui.getByRole('button',{name:'亮面',exact:true}).click();
  await ui.locator('.oi-save[data-saved=true]').waitFor({state:'attached'});
  await page.waitForFunction(()=>JSON.stringify(localStorage.getItem('yan.intelligent-ui.state.v1')).includes('gloss'));
  assert.equal(await page.evaluate(()=>getComposerText()),'保留的草稿','interaction never sends or changes draft');
  await panel.getByRole('button',{name:'带回对话'}).click();
  const draft=await page.evaluate(()=>getComposerText());assert.match(draft,/保留的草稿/);assert.match(draft,/2,240/);assert.match(draft,/亮面/);
  await page.evaluate(()=>{const p=YanIntelligentUi.create();openUiBody.replaceChildren(p);YanIntelligentUi.update(p,openUiItem);});
  await ui.getByRole('button',{name:'亮面',exact:true}).waitFor();
  assert.equal(await ui.getByRole('button',{name:'亮面',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await ui.getByLabel('墙面涂料数量').inputValue(),'5');
  await page.setViewportSize({width:1600,height:1000});
  await panel.evaluate(p=>{p.style.width='';});
  const widths=await panel.evaluate(p=>({panel:p.getBoundingClientRect().width,parent:p.parentElement.getBoundingClientRect().width}));
  assert.ok(widths.parent>760,'wide layout exercises the old cap');
  assert.ok(Math.abs(widths.panel-widths.parent)<1,'OpenUI fills answer width');
  assert.ok(await ui.locator('.oi-app').evaluate(el=>Math.abs(el.getBoundingClientRect().width-document.body.clientWidth+8)<2),'OpenUI root fills sandbox content width');
  console.log('OpenUI widths:',JSON.stringify(widths));
  for(const width of [320,760]){await panel.evaluate((p,w)=>p.style.width=w+'px',width);assert.ok(await ui.locator('body').evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));}
  fs.mkdirSync('output/playwright/intelligent-ui',{recursive:true});await panel.screenshot({path:'output/playwright/intelligent-ui/openui-budget.png'});
  await render(trip,{map:true});
  assert.equal(await panel.locator('.intelligent-ui-handoff').count(),0,'no default completion button');
  await ui.locator('.yan-mini-map[data-loaded=true]').waitFor({timeout:15000});
  await ui.locator('.oi-places').getByRole('button',{name:'科伊特塔',exact:true}).click();await ui.getByRole('button',{name:'加入行程',exact:true}).click();
  await ui.locator('.oi-places').getByRole('button',{name:'渡轮大厦',exact:true}).click();await ui.getByRole('button',{name:'加入行程',exact:true}).click();
  await ui.getByRole('button',{name:'上移渡轮大厦',exact:true}).click();
  assert.match(await ui.locator('.oi-itinerary').textContent(),/^1\. 渡轮大厦/);
  await ui.getByRole('button',{name:'总览',exact:true}).click();await ui.locator('.yan-map-marker-icon[title="华盛顿广场"]').click();assert.equal(await ui.locator('[data-place-name]').textContent(),'华盛顿广场');
  await page.waitForFunction(()=>JSON.stringify(localStorage.getItem('yan.intelligent-ui.state.v1')).includes('park'));
  await page.evaluate(()=>{const p=YanIntelligentUi.create();openUiBody.replaceChildren(p);YanIntelligentUi.update(p,openUiItem);});
  await ui.locator('[data-place-name]').waitFor();assert.equal(await ui.locator('[data-place-name]').textContent(),'华盛顿广场');
  assert.match(await ui.locator('.oi-itinerary').textContent(),/^1\. 渡轮大厦/);
  await panel.screenshot({path:'output/playwright/intelligent-ui/openui-trip.png'});
  assert.equal(await panel.locator('.intelligent-ui-status').textContent(),'可交互');
  console.log('OpenUI Electron E2E passed: budget, choices, map selection, itinerary reorder, persistence, draft handoff, narrow layout.');
 }finally{await app?.close();try{fs.rmSync(userData,{recursive:true,force:true,maxRetries:3,retryDelay:200});}catch{console.log('Temporary Electron profile remains locked: '+userData);}}
})().catch(error=>{console.error(error);process.exitCode=1;});
