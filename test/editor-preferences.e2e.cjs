const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright'); const root=path.resolve(__dirname,'..');
(async()=>{let app;try{
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'yan-editor-')); const selected=path.join(temp,'chosen');fs.mkdirSync(selected);
app=await _electron.launch({executablePath:require('electron'),args:[root],cwd:root,env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:temp}});
const page=await app.firstWindow();await page.waitForFunction(()=>window.__YAN_APP_READY__);const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.waitForFunction(()=>!document.getElementById('settingsOverlay'));
await page.locator('#settingsBtn').click();
const previous=await page.evaluate(()=>state.config.general.blankWorkspace);assert.ok(path.isAbsolute(previous));
await app.evaluate(({dialog},selected)=>{global.pickedOptions=[];dialog.showOpenDialog=async(_win,options)=>{global.pickedOptions.push(options);return {canceled:false,filePaths:[selected]}}},selected);
await page.locator('#generalBlankWorkspaceChange').click();await page.waitForFunction(p=>state.config.general.blankWorkspace===p,selected);
await page.locator('#generalBlankWorkspaceChange').click();
await page.waitForFunction(()=>document.querySelector('#generalBlankWorkspacePath').title===state.config.general.blankWorkspace);
const picks=await app.evaluate(()=>global.pickedOptions);assert.equal(picks[0].defaultPath,previous);assert.equal(picks[1].defaultPath,selected);
const directory=await page.evaluate(async()=>{const session=await api.createSession(true,'');return api.getSessionDirectory(session.id)});assert.equal(path.dirname(directory),selected);assert.equal(fs.statSync(directory).isDirectory(),true);
assert.equal(await page.locator('#generalContextUsage').isChecked(),false);
await page.locator('#generalContextUsage').check();await page.waitForFunction(()=>state.config.general.showContextUsage===true);
assert.equal(await page.evaluate(()=>document.getElementById('contextRingWrap').classList.contains('hidden')),false);
await page.locator('[data-follow-up-mode="guide"]').click();await page.waitForFunction(()=>state.config.general.followUpMode==='guide');
assert.equal(await page.evaluate(async()=>(await api.getConfig()).general.followUpMode),'guide');
await page.locator('#appRail [data-nav="tasks"]').click();
await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('opencode:interject');ipcMain.handle('opencode:interject',(_e,p)=>{global.guidancePayload=p;return {ok:true,delivered:true}})});
const delivered=await page.evaluate(async()=>{

 const id=state.currentSession.id; const run=createRunCtx(id,false,'');run.runId='fixture-run';run.sessionRef=state.currentSession;
 state.activeRuns.set(id,{runCtx:run,sessionRef:state.currentSession});setComposerText('调整当前任务');
 try{await sendMessage();return {queued:state.queuedTurns.has(id),text:getComposerText()};}finally{state.activeRuns.delete(id);}
});delivered.payload=await app.evaluate(()=>global.guidancePayload);assert.equal(delivered.payload.directGuidance,true);assert.equal(delivered.payload.text,'调整当前任务');assert.equal(delivered.queued,false);assert.equal(delivered.text,'');
await page.locator('#settingsBtn').click();await page.locator('[data-follow-up-mode="queue"]').click();await page.waitForFunction(()=>state.config.general.followUpMode==='queue');
await page.locator('#appRail [data-nav="tasks"]').click();
const queued=await page.evaluate(async()=>{
 const id=state.currentSession.id;const run=createRunCtx(id,false,'');run.runId='queue-fixture';run.sessionRef=state.currentSession;
 state.activeRuns.set(id,{runCtx:run,sessionRef:state.currentSession});setComposerText('下一轮处理');
 try {await sendMessage();return state.queuedTurns.get(id)?.text;} finally {removeCurrentQueuedTurn();state.activeRuns.delete(id);}
});assert.equal(queued,'下一轮处理');
await page.locator('#settingsBtn').click();

await page.setViewportSize({width:1280,height:1000});fs.mkdirSync(path.join(root,'output/playwright/editor-settings'),{recursive:true});await page.screenshot({path:path.join(root,'output/playwright/editor-settings/general.png')});assert.deepEqual(errors,[]);
console.log('PASS folder picker current path, persistence, context toggle, guide dispatch, editor UI');
}finally{await app?.close()}})().catch(e=>{console.error(e);process.exitCode=1});
