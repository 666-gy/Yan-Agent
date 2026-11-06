'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron:electron}=require('playwright');
(async()=>{let app;const profile=fs.mkdtempSync(path.join(os.tmpdir(),'yan-plugin-update-ui-'));
try{
 app=await electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:profile}});
 const page=await app.firstWindow();await page.waitForFunction(()=>window.__YAN_APP_READY__);await page.evaluate(()=>window.YanStartupHello?.skip());
 await page.evaluate(async()=>{await api.pluginsInstallCatalog('office');switchSidebarNav('packages');await window.YanPluginsPage.show();});
 await page.locator('[data-plugin-open="office"]').first().click();
 await page.locator('[data-plugin-action="check-update"]').waitFor();
 await app.evaluate(({ipcMain},root)=>{
  let count=0;ipcMain.removeHandler('plugins:check-update');ipcMain.handle('plugins:check-update',async(event,{id})=>{
    count++;if(count===1)return {ok:true,updated:false};if(count===3)return {ok:false,error:'官方版本检查失败：测试网络断开'};
    event.sender.send('plugins:progress',{id,phase:'update',percent:42});await new Promise(r=>setTimeout(r,800));
    return {ok:true,updated:true,plugin:{version:'9.0.0'}};
  });
 },path.resolve(__dirname,'..'));
 await page.locator('[data-plugin-action="check-update"]').click();await page.getByText('Office 已为最新版本',{exact:true}).waitFor();
 await page.locator('[data-plugin-action="check-update"]').click();await page.getByRole('button',{name:'正在更新 42%',exact:true}).waitFor();
 await page.getByText('Office 已更新至 9.0.0',{exact:true}).waitFor();
 await page.locator('[data-plugin-action="check-update"]').click();await page.getByText('更新失败：官方版本检查失败：测试网络断开',{exact:true}).waitFor();
 assert.equal(await page.locator('[data-plugin-action="check-update"]').isEnabled(),true);
 console.log('Version pill, progress, current-version notice, update notice and failure retry passed.');
}finally{await app?.close();fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});}})().catch(e=>{console.error(e);process.exitCode=1});

