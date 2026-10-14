const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');const {_electron}=require('playwright');
(async()=>{let app;const userData=fs.mkdtempSync(path.join(os.tmpdir(),'yan-settings-nav-'));try{
app=await _electron.launch({executablePath:require('electron'),args:[process.cwd()],env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:userData}});
const page=await app.firstWindow();await page.waitForFunction(()=>window.__YAN_APP_READY__);await page.locator('#settingsBtn').click();
assert.deepEqual(await page.locator('#settingsSidebarNav .sheet-nav-text').allTextContents(),['常规','外观','壁纸','配置','存储','已归档的聊天','个性化','Domml与虚拟宠物','语音功能','电脑操控','应用快照','浏览器','远程操控','子代理','代码审查','Git','Worktrees','服务商配置','主模型','次模型','多模态链路','用量显示','Intelligent UI']);
assert.deepEqual(await page.locator('.settings-nav-group-label').allTextContents(),['个人','集成','编码','模型服务','实验室功能']);
await page.locator('#settings-tab-intelligent-ui').click();
assert.equal(await page.locator('#intelligentUiEnabled').isChecked(), false);
await page.locator('#intelligentUiEnabled').check();
await page.waitForFunction(()=>state.config.experiments?.intelligentUi===true);
assert.equal(await page.evaluate(async()=> (await api.getConfig()).experiments.intelligentUi), true);
await page.evaluate(()=>{state.config.experiments.intelligentUi=false;});
await page.evaluate(async()=>{state.config=await api.getConfig();syncGeneralPreferences();});
assert.equal(await page.locator('#intelligentUiEnabled').isChecked(), true);
fs.mkdirSync('output/playwright/settings-nav',{recursive:true});
await page.screenshot({path:'output/playwright/settings-nav/intelligent-ui.png'});
await page.locator('#intelligentUiEnabled').uncheck();
await page.waitForFunction(()=>state.config.experiments?.intelligentUi===false);
for(const [id,title] of [['memory','个性化'],['pet','Domml与虚拟宠物'],['api','服务商配置'],['main-model','主模型'],['vision-relay','多模态链路']]) {await page.locator('#settings-tab-'+id).click();assert.equal(await page.locator('.settings-page-heading h1').textContent(),title);}
await page.locator('#settings-tab-general').click();
fs.mkdirSync('output/playwright/settings-nav',{recursive:true});
for(const theme of ['light','dark']){
 await page.evaluate(async theme=>{state.config=await api.setConfig({theme});applyTheme(theme);},theme);
 await page.waitForTimeout(350);
 await page.screenshot({path:'output/playwright/settings-nav/'+theme+'.png'});
 await page.evaluate(async()=>{state.config=await api.setConfig({wallpaper:{id:'night-sky',path:'',custom:[],removed:[]},themeCompat:{materialStrength:.6}});applyWallpaperConfig(state.config);await applyWallpaperCompat(state.config);});
 const colors=await page.evaluate(()=>['.settings-sidebar','.settings-page-shell','.sheet-content'].map(sel=>getComputedStyle(document.querySelector('#settingsOverlay '+sel)).backgroundColor));
 assert.deepEqual(colors,['rgba(0, 0, 0, 0)','rgba(0, 0, 0, 0)','rgba(0, 0, 0, 0)'],'settings chrome stays transparent on wallpaper');
 const alphaOf=value=>{const rgba=value.match(/^rgba?\(\d+,\s*\d+,\s*\d+(?:,\s*([\d.]+))?\)$/);const srgb=value.match(/^color\(srgb\s+[\d.]+\s+[\d.]+\s+[\d.]+(?:\s*\/\s*([\d.]+))?\)$/);const m=rgba||srgb;if(!m)throw new Error('unexpected color: '+value);return m[1]===undefined?1:Number(m[1]);};
 const group=await page.evaluate(()=>getComputedStyle(document.querySelector('#settingsOverlay #tab-general .general-settings-group')).backgroundColor);
 const groupAlpha=alphaOf(group);
 assert.ok(groupAlpha>0&&groupAlpha<1,`settings content panel must be semi-transparent on wallpaper, got ${group}`);
 await page.waitForTimeout(350);
 await page.screenshot({path:'output/playwright/settings-nav/'+theme+'-wallpaper.png'});
}
console.log('PASS grouped order, renamed destinations, unified wallpaper material');
// A retained companion must reopen inside Yan, including paths with spaces.
const companion=path.join(userData,'lab space & data','.yanagent','intelligent-ui','sample','index.html');
fs.mkdirSync(path.dirname(companion),{recursive:true});
fs.writeFileSync(companion,'<!doctype html><title>Lab companion</title><button id="adjust" onclick="document.getElementById(\'result\').textContent=42">调整</button><output id="result">0</output>');
await page.evaluate(file=>{closeSettings();const host=document.createElement('div');host.className='msg-body';host.style='position:fixed;top:80px;left:450px;z-index:99999';const link=document.createElement('a');link.id='labReopen';link.href=file;link.textContent='打开交互界面';host.append(link);document.body.append(host);},companion);
await page.locator('#labReopen').click();
await page.waitForFunction(()=>[...browserTabControllers.values()].some(c=>c.webview?.getURL?.().includes('intelligent-ui/sample/index.html')));
const result=await page.evaluate(async()=>{const c=[...browserTabControllers.values()].find(c=>c.webview?.getURL?.().includes('intelligent-ui/sample/index.html'));return c.webview.executeJavaScript("document.getElementById('adjust').click();document.getElementById('result').textContent",true);});
assert.equal(result,'42');
console.log('PASS companion link reopens in Yan and local interaction works');
}finally{try{await app?.close();}finally{await fs.promises.rm(userData,{recursive:true,force:true,maxRetries:30,retryDelay:200});}}})().catch(e=>{console.error(e);process.exitCode=1});
