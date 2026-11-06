const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron:electron}=require('playwright');
(async()=>{let app;const profile=fs.mkdtempSync(path.join(os.tmpdir(),'yan-startup-preferences-'));
try{
const launch=()=>electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:profile}});
app=await launch();let page=await app.firstWindow();await page.waitForFunction(()=>window.__YAN_APP_READY__);await page.evaluate(()=>window.YanStartupHello?.skip());
await page.locator('#yanStartupHello').waitFor({state:'detached'});
await page.locator('#settingsBtn').click();await page.locator('#settings-tab-general').click();
assert.equal(await page.locator('#generalStartupAnimation').isChecked(),true);
await page.locator('#generalStartupAnimation').uncheck();await page.waitForFunction(()=>state.config.general.startupAnimation===false);
await page.locator('#generalAutoArchiveDays-trigger').click();
for(const label of ['永不','1天','7天','14天','30天','90天'])assert.equal(await page.getByRole('option',{name:label,exact:true}).count(),1);
await page.getByRole('option',{name:'7天',exact:true}).click();await page.waitForFunction(()=>state.config.general.autoArchiveDays===7);
await app.close();app=await launch();page=await app.firstWindow();await page.waitForFunction(()=>window.__YAN_APP_READY__);
await page.locator('#yanStartupHello').waitFor({state:'detached'});
assert.equal(await page.locator('#app').evaluate(e=>e.inert),false);
const cfg=await page.evaluate(()=>api.getConfig());assert.equal(cfg.general.startupAnimation,false);assert.equal(cfg.general.autoArchiveDays,7);
console.log('Settings pickers, defaults, persistence and disabled startup animation passed.');
}finally{await app?.close();fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});}})().catch(e=>{console.error(e);process.exitCode=1});
