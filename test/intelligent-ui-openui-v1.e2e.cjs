'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright');
const {createIntelligentUi}=require('../lib/intelligent-ui-creator');
const {dashboard}=require('./fixtures/intelligent-ui-openui.cjs');
(async()=>{
 let app;const userData=fs.mkdtempSync(path.join(os.tmpdir(),'yan-openui-v1-'));
 try{
  require('./helpers/intelligent-ui-profile.cjs')(userData);
  app=await _electron.launch({executablePath:require('electron'),args:[process.cwd()],env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:userData}});
  const page=await app.firstWindow();page.on('pageerror',e=>console.log('PAGEERROR',e.message));
  await page.setViewportSize({width:1100,height:900});
  await page.context().route('https://**/*',route=>route.abort());
  await page.waitForFunction(()=>window.__YAN_APP_READY__&&window.YanIntelligentUi);
  const active={intelligentUiAllowed:true};const task_id='openui-v1-test';
  const startArgs={task_id,action:'start',title:'OpenUI 1.x 组件',purpose:'比较方案并填写信息',placement:'final'};
  createIntelligentUi(active,task_id,startArgs);
  const args={task_id,action:'render',format:'openui',code:dashboard,resources:{map:false,images:[]}};
  const result=createIntelligentUi(active,task_id,args);
  await page.evaluate(async({startArgs,args,result,started})=>{
   if(!state.currentSession)await newSession();setEmptyState(false);document.documentElement.dataset.theme='light';document.documentElement.dataset.language='zh-CN';
   document.getElementById('openui-v1-test')?.remove();
   window.openUiV1Body=appendMessage('assistant','').querySelector('.msg-body');openUiV1Body.id='openui-v1-test';
   window.openUiV1Item=YanIntelligentUi.fromCall({args},{ok:true,output:JSON.stringify(result)},'done');
   window.openUiV1Timeline=[
    {type:'tool_call',callId:'v1-start',name:'yan_session_intelligent_ui_creator',args:startArgs},
    {type:'tool_result',callId:'v1-start',name:'yan_session_intelligent_ui_creator',ok:true,output:JSON.stringify(started)},
    {type:'tool_call',callId:'v1-render',name:'yan_session_intelligent_ui_creator',args},
    {type:'tool_result',callId:'v1-render',name:'yan_session_intelligent_ui_creator',ok:true,output:JSON.stringify(result)}
   ];
   renderAgentRunBody(openUiV1Body,{status:'done',summaryStarted:true,timeline:openUiV1Timeline,modelId:'deepseek-v4'});
  },{startArgs,args,result,started:{ok:true,intelligent_ui:{...active.intelligentUi,status:'creating',revision:0}}});
  const panel=page.locator('#openui-v1-test .intelligent-ui-output');
  const ui=page.frameLocator('#openui-v1-test .intelligent-ui-frame').frameLocator('iframe');
  await ui.locator('.oi-table table').waitFor({timeout:15000});
  assert.equal(await ui.locator('.oi-table tbody tr').count(),2);
  assert.equal(await ui.locator('.oi-table thead th').count(),3);
  assert.equal(await ui.locator('.oi-chart-bar').count(),2);
  assert.match(await ui.locator('.oi-chart svg').getAttribute('aria-label'),/响应时间/);
  assert.equal(await ui.locator('.oi-stack-row > *').count(),2);
  assert.match(await ui.locator('.oi-form-head small').textContent(),/已填写 2\/4/);
  await ui.getByLabel('项目名称').fill('官网改版');
  assert.match(await ui.locator('.oi-form-head small').textContent(),/已填写 3\/4/);
  await ui.getByLabel('方案').selectOption('专业');
  assert.equal(await ui.getByLabel('方案').inputValue(),'专业');
  await page.waitForFunction(()=>{const saved=JSON.stringify(localStorage.getItem('yan.intelligent-ui.state.v1'));return saved.includes('官网改版')&&saved.includes('专业');});
  await page.evaluate(()=>{const p=YanIntelligentUi.create();openUiV1Body.replaceChildren(p);YanIntelligentUi.update(p,openUiV1Item);});
  await ui.getByLabel('项目名称').waitFor();
  assert.equal(await ui.getByLabel('项目名称').inputValue(),'官网改版');
  assert.equal(await ui.getByLabel('方案').inputValue(),'专业');
  await page.evaluate(()=>{document.documentElement.dataset.language='en';const p=document.querySelector('#openui-v1-test .intelligent-ui-output');YanIntelligentUi.update(p,openUiV1Item);});
  await ui.locator('.oi-form-head small').filter({hasText:'3 of 4 filled'}).waitFor({timeout:15000});
  assert.equal(await panel.locator('.intelligent-ui-status').textContent(),'Interactive');
  assert.equal(await ui.getByLabel('项目名称').inputValue(),'官网改版');
  for(const width of [320,760]){await panel.evaluate((p,w)=>p.style.width=w+'px',width);assert.ok(await ui.locator('body').evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));}
  fs.mkdirSync('output/playwright/intelligent-ui',{recursive:true});await panel.screenshot({path:'output/playwright/intelligent-ui/openui-v1-components.png'});
  console.log('OpenUI 1.x E2E passed: table, chart, form, stack, persistence, live language switch, narrow layout.');
 }finally{await app?.close();try{fs.rmSync(userData,{recursive:true,force:true,maxRetries:3,retryDelay:200});}catch{console.log('Temporary Electron profile remains locked: '+userData);}}
})().catch(error=>{console.error(error);process.exitCode=1;});
