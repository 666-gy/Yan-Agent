const {test}=require('node:test');const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {resolveBlankDirectory}=require('../lib/blank-workspace');
test('blank directories follow selected root for new chats and retain existing files',()=>{
const data=fs.mkdtempSync(path.join(os.tmpdir(),'yan-blank-test-'));const old=path.join(data,'opencode-runtime/no-workspace/old');fs.mkdirSync(old,{recursive:true});fs.writeFileSync(path.join(old,'keep.txt'),'keep');
const root=path.join(data,'chosen'),next=path.join(data,'next');
assert.equal(resolveBlankDirectory(data,root,'old'),old);assert.equal(resolveBlankDirectory(data,root,'new'),path.join(root,'new'));assert.equal(resolveBlankDirectory(data,next,'new'),path.join(root,'new'));assert.equal(resolveBlankDirectory(data,next,'newer'),path.join(next,'newer'));assert.equal(fs.readFileSync(path.join(old,'keep.txt'),'utf8'),'keep');
fs.rmSync(data,{recursive:true,force:true});
});
const {registerOpenCodeIpc}=require('../lib/main/ipc-opencode');
test('direct guidance reaches the current kernel without an auxiliary model or queued turn',async()=>{
const handlers=new Map();let call;registerOpenCodeIpc({ipcMain:{handle:(n,h)=>handlers.set(n,h)}},{openCodeActiveRuns:new Map([['run',{}]]),getCurrentSidecar:()=>({deliverInterjection:async(id,a)=>{call={id,a};return {ok:true,delivered:true}}})});
const r=await handlers.get('opencode:interject')({}, {runId:'run',text:'change direction',directGuidance:true});assert.equal(r.delivered,true);assert.deepEqual(call,{id:'run',a:{kind:'guidance',guidance:'change direction',requestFinish:false}});
assert.equal((await handlers.get('opencode:interject')({}, {runId:'gone',text:'x',directGuidance:true})).ok,false);
});
