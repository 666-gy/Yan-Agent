const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { _electron } = require('playwright');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-archives-ui-'));
fs.mkdirSync(path.join(profile,'YanData'),{recursive:true}); fs.writeFileSync(path.join(profile,'YanData','config.json'),'{}');
const workspace = path.join(profile,'project'); fs.mkdirSync(workspace);
const output = path.resolve('output/playwright/archives'); fs.mkdirSync(output,{recursive:true});
let app;
async function launch() {
 const env={...process.env,YAN_E2E_USER_DATA_DIR:profile,YAN_DISABLE_SINGLE_INSTANCE:'1'};delete env.YAN_E2E_MODE;
 app=await _electron.launch({executablePath:require('electron'),args:[process.cwd()],env});
 let page;for(let i=0;i<100;i++){page=app.windows().find(p=>p.url().includes('/renderer/index.html'));if(page)break;await new Promise(r=>setTimeout(r,200));}
 assert.ok(page);await page.waitForFunction(()=>window.__YAN_APP_READY__);return page;
}
(async()=>{try{
 let page=await launch();
 const ids=await page.evaluate(async workspace=>{
  const result=[];for(const title of ['归档测试一','归档测试二']){const s=await api.createSession(true,workspace);s.title=title;s.messages=[{role:'user',content:'保留完整历史'},{role:'assistant',content:'已完成'}];await api.saveSession(s);result.push(s.id);}await refreshSessions();return result;
 },workspace);
 const staleRecords=await page.evaluate(ids=>Promise.all(ids.map(id=>api.getSession(id))),ids);
 await page.locator(`.session-item[data-id="${ids[0]}"]`).first().click({button:'right'});
 await page.getByRole('menuitem',{name:'归档',exact:true}).click();
 await page.waitForFunction(async id=>(await api.listArchivedSessions()).some(s=>s.id===id),ids[0]);
 assert.equal((await page.evaluate(id=>api.getSession(id),ids[0])).messages.length,2);
 await page.evaluate(id=>{const row=document.querySelector(`.session-item[data-id="${id}"]`); const container=row?.closest('.workspace-group'); if(!container) throw new Error('workspace group missing');container.querySelector('[data-workspace-menu-toggle]').click();},ids[1]);
 await page.getByRole('menuitem',{name:'归档聊天',exact:true}).click();
 await page.waitForFunction(async()=> (await api.listArchivedSessions()).length===2);
 await page.locator('#settingsBtn').click();await page.locator('#settings-tab-archived').click();await page.locator('.archive-chat').first().waitFor();
 assert.equal(await page.locator('.archive-chat').count(),2);
 await page.locator('#archiveSearch').fill('测试一');assert.equal(await page.locator('.archive-chat').count(),1);await page.locator('#archiveSearch').fill('');
 await page.locator('#archiveProject').click(); await page.locator('#archiveProjectOptions').getByRole('button',{name:'project',exact:true}).click();
 for(const theme of ['light','dark']) {
  await page.evaluate(async theme=>{state.config=await api.setConfig({theme});applyTheme(theme);},theme);
  await page.locator('#archiveProject').click();
  await page.waitForTimeout(350); await page.screenshot({path:path.join(output,theme+'.png')});
  await page.locator('#archiveProject').click();
 }

 await page.locator(`#archivedChatList [data-session-id="${ids[0]}"]`).getByRole('button',{name:'取消归档',exact:true}).click();
 await page.waitForFunction(async id=>(await api.listSessions()).some(s=>s.id===id),ids[0]);
 await app.close();app=null;page=await launch();
 assert.deepEqual((await page.evaluate(()=>api.listArchivedSessions())).map(s=>s.id),[ids[1]]);
 await page.locator('#settingsBtn').click();await page.locator('#settings-tab-archived').click();
 await page.locator('.archive-chat').getByRole('button',{name:'永久删除',exact:true}).click();await page.locator('#genericConfirmAccept').click();
 await page.waitForFunction(async()=>!(await api.listArchivedSessions()).length);
 assert.equal(await page.evaluate(id=>api.getSession(id),ids[1]),null);
 assert.ok(await page.evaluate(id=>api.getSession(id),ids[0]));
 await page.evaluate(async id=>{await api.setSessionsArchived([id],true);await YanArchiveSettings.refresh();},ids[0]);
 await page.locator('.archive-group-header').getByRole('button',{name:'项目操作'}).click();
 assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['永久删除该项目的所有归档聊天']);
 await page.locator('#archiveSearch').click();
 await page.locator('#archiveDeleteAll').click();await page.locator('#genericConfirmAccept').click();
 await page.waitForFunction(async()=>!(await api.listArchivedSessions()).length);
 assert.equal(await page.evaluate(id=>api.getSession(id),ids[0]),null);
 assert.ok((await page.evaluate(()=>api.listSessions())).length,'unarchived chats survive delete all');
 for(const record of staleRecords) assert.equal((await page.evaluate(s=>api.saveSession(s),record)).code,'SESSION_DELETED');
 await app.close();app=null;page=await launch();
 for(const record of staleRecords) {
  assert.equal(await page.evaluate(id=>api.getSession(id),record.id),null);
  assert.equal((await page.evaluate(s=>api.saveSession(s),record)).code,'SESSION_DELETED');
  assert.equal(fs.existsSync(path.join(profile,'YanData','sessions',record.id+'.json')),false);
 }
 assert.equal((await page.evaluate(()=>api.listArchivedSessions())).length,0);
 console.log('PASS normal Electron startup: task/folder archive, retained history, search, restore, confirmed permanent deletion, stale IPC saves blocked before and after restart');
}finally{try{await app?.close();}finally{fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});}}})().catch(e=>{console.error(e);process.exitCode=1});
