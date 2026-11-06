'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-manual-compression-'));
(async () => {
 let app;
 try {
  app = await electron.launch({executablePath:require('electron'),args:[root],cwd:root,env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:userData}});
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof setupContextRing === 'function' && state.currentSession);
  await page.evaluate(() => window.YanStartupHello?.skip());
  await page.locator('#yanStartupHello').waitFor({ state: 'detached' });
  await app.evaluate(({ipcMain}) => {
   globalThis.compressionCalls = 0;
   ipcMain.removeHandler('opencode:compress-session');
   ipcMain.handle('opencode:compress-session', async () => {
    globalThis.compressionCalls++;
    await new Promise(resolve=>setTimeout(resolve,300));
    if(globalThis.compressionFailure) return {ok:false,error:'测试供应商不可用'};
    if(globalThis.compressionUnmeasured) return {ok:true,compacted:true,completedAt:Date.now()};
    return {ok:true,compacted:true,beforeTokens:45000,afterTokens:1200,completedAt:Date.now(),budget:{contextWindow:100000,softThreshold:70000}};
   });
  });
  await page.evaluate(async () => {
   state.currentSession.openCodeSessionId = 'test-kernel-session';
   state.currentSession.messages = [{role:'user',content:'测试任务',ts:Date.now()},{role:'assistant',content:'历史'.repeat(20000),ts:Date.now()}];
   await saveCurrentSession();
   setEmptyState(false);
   updateContextInfo();
   setContextRingPanelOpen(true);
  });
  await page.locator('#contextCompressBtn').click();
  await page.waitForFunction(()=>document.querySelector('#contextCompressBtn').textContent==='压缩中…');
  assert.equal(await page.locator('#contextCompressBtn').isDisabled(),true);
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('上下文已压缩'));
  assert.equal(await page.locator('#toast').textContent(),'上下文已压缩：45K → 1.2K');
  assert.equal(await app.evaluate(()=>globalThis.compressionCalls),1);
  assert.match(await page.locator('#contextRingValue').textContent(), /^~1\.2K \/ /, 'idle context must show the compacted size');
  await page.evaluate(()=>updateContextInfo());
  assert.match(await page.locator('#contextRingValue').textContent(), /^~1\.2K \/ /);
  await page.reload();
  await page.waitForFunction(()=>state.currentSession?.openCodeSessionId==='test-kernel-session');
  await page.evaluate(()=>{setEmptyState(false);updateContextInfo();setContextRingPanelOpen(true);});
  assert.match(await page.locator('#contextRingValue').textContent(), /^~1\.2K \/ /, 'compacted size must survive reload');
  await app.evaluate(()=>{globalThis.compressionUnmeasured=true;});
  await page.locator('#contextCompressBtn').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('未测得压缩后大小'));
  await page.evaluate(()=>updateContextInfo());
  assert.doesNotMatch(await page.locator('#contextRingValue').textContent(), /^~0 /, 'an unmeasured result must not fake a zero readout');
  await app.evaluate(()=>{globalThis.compressionUnmeasured=false;globalThis.compressionFailure=true;});
  await page.locator('#contextCompressBtn').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('测试供应商不可用'));
  assert.equal(await page.locator('#contextCompressBtn').isDisabled(),false);
  await page.evaluate(()=>{state.activeRuns.set(state.currentSession.id,{});updateContextCompressButton();});
  assert.equal(await page.locator('#contextCompressBtn').isDisabled(),true,'working tasks cannot compact');
  console.log('Manual compression: click/IPC, busy lock, idle readout, reload, unmeasured result, error and execution guard passed');
 } finally {await app?.close();fs.rmSync(userData,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
