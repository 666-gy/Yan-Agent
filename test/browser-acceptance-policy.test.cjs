const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {registerBridges}=require('../lib/main/bridges');
const {browserPrioritySystem}=require('../lib/kernel-policy/prompts');
function fixture(){
 let config={browser:{acceptanceLevel:'quick'},agent:{accessMode:'full'}},decision='deny',asked=0;
 const runs=new Map([['a',{}],['b',{}]]),pending=new Map();
 const win={isDestroyed:()=>false,webContents:{id:1,isDestroyed:()=>false,send:(_channel,msg)=>{
 if(msg.action!=='request_acceptance_upgrade')return;
 asked++;queueMicrotask(()=>{const p=pending.get(msg.requestId);if(!p)return;clearTimeout(p.timer);pending.delete(msg.requestId);p.resolve({ok:decision!=='deny',decision});});
 }}};
 const bridge=registerBridges({app:new EventEmitter()},{browserHelpers:{},BROWSER_AGENT_BRIDGE_ACTIONS:new Set(['request_acceptance_upgrade','status']),configStore:{loadConfig:()=>config,saveConfig:c=>{config=c;}},browserAgentToolClaims:new Map(),openCodeActiveRuns:runs,browserAgentBridgePending:pending,getMainWindow:()=>win,isMainRendererReady:()=>true});
 return {bridge,runs,get config(){return config},get asked(){return asked},set decision(v){decision=v},request:(run='a')=>bridge.dispatchBrowserAgentCommand('request_acceptance_upgrade',{yan_run_id:run,reason:'权限边界需要详细检查'}),check:(run='a')=>bridge.dispatchBrowserAgentCommand('status',{yan_run_id:run,purpose:'frontend_acceptance',acceptance_level:'rigorous'})};
}
test('quick requires explicit approval even under full access; denied request stays quick',async()=>{const f=fixture();assert.equal((await f.check()).code,'BROWSER_ACCEPTANCE_APPROVAL_REQUIRED');assert.equal((await f.request()).code,'BROWSER_ACCEPTANCE_UPGRADE_DENIED');assert.equal(f.asked,1);assert.equal((await f.check()).code,'BROWSER_ACCEPTANCE_APPROVAL_REQUIRED');});
test('once is run-scoped; always persists; reselecting quick revokes persistent grant',async()=>{const f=fixture();f.decision='once';assert.equal((await f.request()).scope,'current_run');assert.equal((await f.request()).alreadyAllowed,true);assert.equal((await f.check('b')).code,'BROWSER_ACCEPTANCE_APPROVAL_REQUIRED');f.decision='always';assert.equal((await f.request('b')).scope,'always');assert.equal(f.config.browser.acceptanceUpgradeAlways,true);f.runs.set('c',{});assert.equal((await f.request('c')).alreadyAllowed,true);f.config.browser.acceptanceUpgradeAlways=false;f.decision='deny';assert.equal((await f.request('c')).code,'BROWSER_ACCEPTANCE_UPGRADE_DENIED');});
test('missing or stale run cannot acquire permission',async()=>{const f=fixture();f.runs.clear();assert.equal((await f.request()).ok,false);assert.equal(f.asked,0);});
test('quick and rigorous prompts differ and search routing retains approval policy',()=>{for(const level of ['quick','rigorous']){const text=browserPrioritySystem({yanBrowserAvailable:true,browserAcceptanceLevel:level});assert.match(text,new RegExp('mode: '+level.toUpperCase()));if(level==='quick')assert.match(text,/WAIT for explicit approval/);}});
