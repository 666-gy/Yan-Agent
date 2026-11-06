const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron:electron}=require('playwright');
(async()=>{const profile=fs.mkdtempSync(path.join(os.tmpdir(),'yan-work-visibility-'));let app;
try{
app=await electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:profile}});
const page=await app.firstWindow();await page.waitForFunction(()=>window.__YAN_APP_READY__);
const result=await page.evaluate(async()=>{
window.YanStartupHello?.skip();if(!state.currentSession)await newSession();clearMessages();setEmptyState(false);
const body=appendMessage('assistant','').querySelector('.msg-body');
const run={status:'done',summaryStarted:true,timeline:[
{type:'text',content:'我先查一下模型',openCodeKey:'intro'},
{type:'tool_call',name:'bash',callId:'one',args:{command:'ls'}},
{type:'tool_result',callId:'one',ok:true,output:'ok'},
{type:'text',content:'现在核对结果',openCodeKey:'middle'},
{type:'tool_call',name:'bash',callId:'two',args:{command:'pwd'}},
{type:'tool_result',callId:'two',ok:false,output:'error'},
{type:'text',stage:'summary',content:'最终回复',openCodeKey:'final'}]};
renderAgentRunBody(body,run);
const activity=body.querySelector('.agent-activity-body');
const hidden=activity.textContent;
const toggle=body.closest('.msg').querySelector('.agent-work-toggle');toggle.click();
const rows=[...activity.children].map(el=>el.textContent);
const noDetails=!activity.querySelector('.tool-step,.agent-work-phase');
const summaries=activity.querySelectorAll('.agent-work-batch > summary');
summaries[0].click();await new Promise(resolve=>setTimeout(resolve,20));
const first=activity.querySelector('.agent-work-batch');
const opened=first.open && first.querySelector('.agent-work-history').textContent.includes('ls') && !first.querySelector('.agent-work-history').textContent.includes('pwd');
summaries[0].click();await new Promise(resolve=>setTimeout(resolve,20));
const closed=!first.open && !first.querySelector('.agent-work-history').children.length;
toggle.click();const hiddenAgain=activity.textContent;
return {hidden,rows,noDetails,hiddenAgain,opened,closed};
});
assert.equal(result.hidden,'最终回复');assert.equal(result.hiddenAgain,'最终回复');assert.equal(result.noDetails,true);
assert.equal(result.opened,true);assert.equal(result.closed,true);assert.equal(result.rows.length,5);assert.equal(result.rows[0],'我先查一下模型');assert.match(result.rows[1],/运行了1条命令（0个失败）/);assert.equal(result.rows[2],'现在核对结果');assert.match(result.rows[3],/运行了1条命令（1个失败）/);assert.equal(result.rows[4],'最终回复');
console.log('Final-only collapsed view and alternating narration/tool summaries passed.');
}finally{await app?.close();fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
})().catch(e=>{console.error(e);process.exitCode=1});
