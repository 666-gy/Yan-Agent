'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright');
const {createIntelligentUi}=require('../lib/intelligent-ui-creator');
const code=`root = Stack([TextContent("涂料预算", "small"), FormControl("涂料桶数", Input("quantity", "", "number", null, $qty)), TextContent("合计 ¥" + ($qty * 280), "large-heavy"), TextContent($qty < 5 ? "预算内" : "超出预算"), BarChart(["涂料", "灯具"], [Series("费用", [$qty * 280, 840])], "grouped", "项目", "元", 180), TextContent("示例估算：每桶 280 元"), FormControl("备注", Input("note", "", "text", null, $note)), Buttons([Button("恢复初始", @Set($qty, "3"))])])
$qty = "3"
$note = ""`;
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'yan-native-ui-'));let app;
 try {
  require('./helpers/intelligent-ui-profile.cjs')(profile);
  app=await _electron.launch({executablePath:require('electron'),args:[process.cwd()],env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:profile}});
  const page=await app.firstWindow();page.on('pageerror',error=>console.log('PAGEERROR',error.message));
  await page.setViewportSize({width:1100,height:950});
  await page.context().route('https://**/*',route=>route.abort());
  await page.waitForFunction(()=>window.__YAN_APP_READY__&&window.YanIntelligentUi);
  const active={intelligentUiAllowed:true};const task_id='native-ui-test';
  createIntelligentUi(active,task_id,{task_id,action:'start',title:'预算 <比较> </script>',purpose:'调整数量，观察预算和图表',placement:'final'});
  const args={task_id,action:'render',format:'openui',code,handoff:true};
  const result=createIntelligentUi(active,task_id,args);
  await page.evaluate(async({args,result})=>{
   if(!state.currentSession)await newSession();setEmptyState(false);
   document.documentElement.dataset.theme='light';document.documentElement.dataset.language='zh';
   window.nativeUiItem=YanIntelligentUi.fromCall({args},{ok:true,output:JSON.stringify(result)},'done');
   window.nativeUiBody=appendMessage('assistant','').querySelector('.msg-body');nativeUiBody.id='native-ui-test';
   const panel=YanIntelligentUi.create();nativeUiBody.append(panel);YanIntelligentUi.update(panel,nativeUiItem);
   setComposerText('已有草稿');
  },{args,result});
  const panel=page.locator('#native-ui-test .intelligent-ui-output');
  const ui=page.frameLocator('#native-ui-test .intelligent-ui-frame').frameLocator('iframe');
  await ui.getByText('合计 ¥840',{exact:true}).waitFor({timeout:20000});
  const quantity=ui.getByRole('spinbutton');
  assert.equal(await quantity.inputValue(),'3');
  await quantity.fill('6');
  await ui.getByText('合计 ¥1680',{exact:true}).waitFor();
  await ui.getByText('超出预算',{exact:true}).waitFor();
  assert.ok(await ui.locator('svg').count()>0,'official chart rendered');
  await page.waitForFunction(()=>localStorage.getItem('yan.intelligent-ui.state.v1')?.includes('1680') || localStorage.getItem('yan.intelligent-ui.state.v1')?.includes('\\"6\\"'));
  assert.equal(await page.evaluate(()=>getComposerText()),'已有草稿');
  await panel.getByRole('button',{name:'带回对话'}).click();
  assert.match(await page.evaluate(()=>getComposerText()),/已有草稿[\s\S]*qty: 6/);
  // Timeline refresh keeps the current iframe alive.
  await page.evaluate(()=>YanIntelligentUi.update(document.querySelector('#native-ui-test .intelligent-ui-output'),nativeUiItem));
  assert.equal(await quantity.inputValue(),'6');
  // Reopening the same content restores official runtime state.
  await page.evaluate(()=>{const panel=YanIntelligentUi.create();nativeUiBody.replaceChildren(panel);YanIntelligentUi.update(panel,nativeUiItem);});
  await ui.getByText('合计 ¥1680',{exact:true}).waitFor();
  assert.equal(await quantity.inputValue(),'6');
  await ui.getByRole('button',{name:'恢复初始'}).click();
  await ui.getByText('合计 ¥840',{exact:true}).waitFor();
  assert.equal(await quantity.inputValue(),'3');
  // State serialization preserves markup characters, not escaped text or executable tags.
  const literal='<tag></script>\u2028';
  await quantity.fill('4');
  await ui.getByRole('textbox').fill(literal);
  await page.waitForFunction(literal=>JSON.parse(localStorage.getItem('yan.intelligent-ui.state.v1') || '[]').some(record=>{const values=JSON.parse(record.json).values;return values?.$qty==='4' && values?.$note===literal;}),literal);
  await page.evaluate(()=>{const panel=YanIntelligentUi.create();nativeUiBody.replaceChildren(panel);YanIntelligentUi.update(panel,nativeUiItem);});
  await ui.getByText('合计 ¥1120',{exact:true}).waitFor();
  assert.equal(await ui.getByRole('textbox').inputValue(),literal);
  assert.equal(await ui.locator('body').evaluate(()=>window.yanUi.getState().values.$note),literal);
  const isolation=await ui.locator('body').evaluate(async()=>{let parentBlocked=false,networkBlocked=false;try{void parent.document;}catch{parentBlocked=true;}try{await fetch('https://example.com');}catch{networkBlocked=true;}return {parentBlocked,networkBlocked,node:typeof require,yan:typeof window.yan};});
  assert.deepEqual(isolation,{parentBlocked:true,networkBlocked:true,node:'undefined',yan:'undefined'});
  fs.mkdirSync('output/playwright/intelligent-ui',{recursive:true});
  for(const theme of ['light','dark']) {
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;YanIntelligentUi.update(document.querySelector('#native-ui-test .intelligent-ui-output'),nativeUiItem);},theme);
   await ui.getByRole('spinbutton').waitFor();
   for(const width of [320,414,760]) {
    await panel.evaluate((element,width)=>element.style.width=width+'px',width);
    await ui.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.ok(await ui.locator('body').evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),theme+' '+width+'px overflow');
   }
   await panel.screenshot({path:`output/playwright/intelligent-ui/native-${theme}.png`});
  }
  // A new accepted revision must not inherit the old variable state.
  await page.evaluate(()=>YanIntelligentUi.update(document.querySelector('#native-ui-test .intelligent-ui-output'),{...nativeUiItem,revision:2}));
  await ui.getByText('合计 ¥840',{exact:true}).waitFor();
  // The new map adapter uses the same sandbox grants and official runtime state.
  await page.context().route('https://tiles.openfreemap.org/styles/positron',route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e5ece7'}}]})}));
  const mapArgs={task_id,action:'render',format:'openui',code:'root = Stack([Map("weekend", [{id:"ferry",name:"渡轮大厦",lat:37.7955,lng:-122.3937,detail:"已核实的地点"},{id:"tower",name:"科伊特塔",lat:37.8024,lng:-122.4058,detail:"已核实的地点"}], [])])',resources:{map:true}};
  const mapResult=createIntelligentUi(active,task_id,mapArgs);
  await page.evaluate(({args,result})=>{window.nativeMapItem=YanIntelligentUi.fromCall({args},{ok:true,output:JSON.stringify(result)},'done');YanIntelligentUi.update(document.querySelector('#native-ui-test .intelligent-ui-output'),nativeMapItem);},{args:mapArgs,result:mapResult});
  await ui.locator('.yan-mini-map[data-loaded=true]').waitFor({timeout:20000});
  await ui.locator('nav').getByRole('button',{name:'科伊特塔',exact:true}).click();
  await ui.getByRole('button',{name:'加入行程',exact:true}).click();
  assert.match(await ui.locator('.yan-ui-itinerary').innerText(),/科伊特塔/);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('yan.intelligent-ui.state.v1') || '[]').some(record=>JSON.parse(record.json).values?.weekend?.value?.kept?.includes('tower')));
  await page.evaluate(()=>{const panel=YanIntelligentUi.create();nativeUiBody.replaceChildren(panel);YanIntelligentUi.update(panel,nativeMapItem);});
  await ui.getByRole('button',{name:'移出行程',exact:true}).waitFor();
  assert.match(await ui.locator('.yan-ui-itinerary').innerText(),/科伊特塔/);
  console.log('Native OpenUI E2E passed: official input/chart/actions, reactive expressions, persistence, draft handoff, script-safe literals, sandbox, revision isolation, themes, 320/414/760px and map selection/itinerary restoration.');
 } catch(error) {
  if(app){const page=await app.firstWindow();console.log('PANEL',await page.locator('.intelligent-ui-output').allTextContents());for(const frame of page.frames().slice(1))console.log('FRAME',frame.url(),await frame.evaluate(()=>document.body.innerText.slice(0,800)).catch(()=>''));}
  throw error;
 } finally {
  await app?.close();try{fs.rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:200});}catch{console.log('Temporary test profile is locked: '+profile);}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
