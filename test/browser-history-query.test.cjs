const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {registerBrowserSettings}=require('../lib/main/browser-settings');
const {registerBridges}=require('../lib/main/bridges');
test('history query applies policy, approval, revocation, search and pagination without a tab',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yan-history-query-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'browser-history.json'),JSON.stringify({history:[{title:'Alpha',url:'https://a.test',time:1000},{title:'Beta',url:'https://b.test',time:2000}]}));
 let policy='deny',response=0,asked=0,active=true,revoke=false;
 const partition=new EventEmitter(),app=Object.assign(new EventEmitter(),{getPath:()=>dir,whenReady:async()=>{}});
 const service=registerBrowserSettings({app,ipcMain:{handle:()=>{}},session:{fromPartition:()=>partition},dialog:{showMessageBox:async()=>{asked++;if(revoke)active=false;return {response};}}},{BROWSER_PARTITION:'test',getMainWindow:()=>({isDestroyed:()=>false}),configStore:{loadConfig:()=>({browser:{historyPolicy:policy}})}});
 const query=(p={})=>service.queryAgentHistory(p,()=>active);
 assert.equal((await query()).code,'BROWSER_HISTORY_DISABLED');assert.equal(asked,0);
 policy='ask';assert.equal((await query()).code,'BROWSER_HISTORY_DENIED');response=1;
 assert.equal((await query({query:'alpha'})).entries[0].title,'Alpha');await query();assert.equal(asked,3);
 policy='allow';const page=await query({limit:1});assert.equal(page.entries[0].title,'Beta');assert.equal(page.hasMore,true);assert.equal((await query({offset:1})).entries[0].title,'Alpha');assert.equal(asked,3);
 policy='ask';revoke=true;assert.equal((await query()).code,'BROWSER_HISTORY_DENIED');
});
test('MCP history action reaches store before browser tab dispatch',async()=>{
 let called=false;
 const bridges=registerBridges({app:new EventEmitter()},{browserHelpers:{},BROWSER_AGENT_BRIDGE_ACTIONS:new Set(['query_history']),configStore:{loadConfig:()=>({browser:{}})},browserAgentToolClaims:new Map(),openCodeActiveRuns:new Map([['run',{}]]),queryBrowserHistory:async(params,isActive)=>{called=true;assert.equal(isActive(),true);assert.equal(params.query,'alpha');return {ok:true,entries:[]};}});
 assert.equal(bridges.browserActionForOpenCodeTool('browser_search_history'),'query_history');
 assert.equal((await bridges.dispatchBrowserAgentCommand('query_history',{query:'alpha'})).ok,true);assert.equal(called,true);
});
