'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const http = require('node:http');
const { EventEmitter, once } = require('node:events');
const { registerWebuiBridge } = require('../lib/main/webui-bridge');

test('WebUI sends once through desktop admission and receives work before completion and after reconnect', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'yan-webui-live-'));
  const ipcMain = new EventEmitter();
  let requestHandler, watchHandler, publishTick, submissions = 0, finish;
  const session = {id:'sess_webui_test',title:'Live test',messages:[]};
  const state = {config:{},activeRuns:new Map(),currentSession:null};
  const webContents = {send:(channel,request) => channel === 'webui:watch' ? watchHandler(request) : requestHandler(request)};
  const desktopWindow = {webContents,isDestroyed:()=>false};
  const server = registerWebuiBridge({ipcMain,getMainWindow:()=>desktopWindow,dataDir:directory});
  await once(server,'listening');
  t.after(async () => {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const api = {
    onWebuiRequest:handler=>{requestHandler=handler;},
    onWebuiWatch:handler=>{watchHandler=handler;},
    webuiReply:(id,result)=>ipcMain.emit('webui:reply',{sender:webContents},{id,result}),
    webuiSnapshots:tasks=>ipcMain.emit('webui:snapshots',{sender:webContents},JSON.parse(JSON.stringify(tasks))),
    createSession:async()=>session, getSession:async()=>session
  };
  vm.runInNewContext(await fs.readFile(path.join(__dirname,'../renderer/webui-bridge.js'),'utf8'),{
    api,state,console,setInterval:fn=>{publishTick=fn;},flushOpenCodeStreamDeltas:()=>{},
    isSessionExecutionActive:id=>state.activeRuns.has(id),canStartRun:()=>true,
    submitMessage:async(text,attachments,skills,options)=>{
      submissions++;
      session.messages.push({role:'user',content:text,intentId:options.intentId});
      state.activeRuns.set(session.id,{sessionRef:session,runCtx:{runId:'run1',partialContent:'',activeAgentRun:{runId:'run1',timeline:[]}}});
      options.onAccepted();
      await new Promise(resolve=>{finish=resolve;});
      session.messages.push({role:'assistant',content:'完成',agentRun:{runId:'run1',status:'done'}});
      state.activeRuns.clear();
      return {ok:true};
    }
  });
  await fs.writeFile(path.join(directory,'config.json'),'{}');
  const routeModule = {exports:{}};
  const fakeModel = {key:'model-key',modelId:'text',providerId:'provider',supplierId:'supplier'};
  vm.runInNewContext(await fs.readFile(path.join(__dirname,'../scripts/webui-live.cjs'),'utf8'),{
    module:routeModule,fetch,AbortSignal,Buffer,URL,setTimeout,clearTimeout,console,
    require:name=> name === './webui-projects.cjs' ? {readProjects:async()=>[{tasks:[{id:session.id}]}]} :
      name === './webui-models.cjs' ? {readComposerModels:()=>({models:[fakeModel]})} :
      name === './webui-additions.cjs' ? {readSkills:async()=>[]} : require(name)
  });
  const routes = routeModule.exports.createLiveRoutes(directory,{prepareWorkImages:async task=>task});
  const host = http.createServer((req,res)=>routes(req,res,new URL(req.url,'http://localhost')));
  host.listen(0,'127.0.0.1');await once(host,'listening');
  t.after(()=>{host.closeAllConnections();host.close();});
  const base=`http://127.0.0.1:${host.address().port}`;
  const payload={intentId:'web_test_intent_0001',text:'测试同步',model:fakeModel,skills:[],photos:[],projectFiles:[]};
  const send=(body,headers={})=>fetch(base+'/api/send',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await send(payload,{Origin:'http://evil.example'})).status,403);
  assert.equal((await send({...payload,model:{key:'unknown'}})).status,400);
  const accepted=await (await send(payload)).json();
  assert.equal(accepted.ok,true);assert.equal(accepted.taskId,session.id);
  assert.equal((await (await send(payload)).json()).ok,true);
  assert.equal(submissions,1,'retry must not create another task/run');
  await fs.mkdir(path.join(directory,'sessions'),{recursive:true});
  await fs.writeFile(path.join(directory,'sessions',session.id+'.json'),JSON.stringify(session));
  const recovered=await (await send(payload)).json();
  assert.equal(recovered.deduped,true);assert.equal(submissions,1,'persisted intent survives a lost ACK');
  const blocked=await (await send({...payload,intentId:'web_test_intent_0002',taskId:session.id})).json();
  assert.equal(blocked.ok,false);assert.equal(submissions,1);
  const controller=new AbortController();
  t.after(()=>controller.abort());
  const response=await fetch(base+'/api/events?id='+session.id,{signal:controller.signal});
  const reader=response.body.getReader();let pending='';
  async function nextSnapshot() {
    while(true) {
      const end=pending.indexOf('\n\n');
      if(end>=0){const frame=pending.slice(0,end);pending=pending.slice(end+2);if(frame.startsWith('data: ')) return JSON.parse(frame.slice(6));continue;}
      const {value,done}=await reader.read();assert.equal(done,false);pending+=Buffer.from(value).toString();
    }
  }
  const initial=await nextSnapshot();
  assert.equal(initial.running,true);assert.equal(initial.messages[0].content,'测试同步');
  assert.deepEqual((await (await fetch(base+'/api/running')).json()).ids,[session.id]);
  state.activeRuns.get(session.id).runCtx.partialContent='先检查第一步';publishTick();
  const partial=await nextSnapshot();assert.equal(partial.running,true);assert.equal(partial.messages.at(-1).content,'先检查第一步');
  finish();
  const complete=await nextSnapshot();assert.equal(complete.running,false);assert.equal(complete.messages.at(-1).content,'完成');assert.equal(complete.messages.length,2);
  assert.deepEqual((await (await fetch(base+'/api/running')).json()).ids,[]);
  controller.abort();
  const reconnect=new AbortController();t.after(()=>reconnect.abort());
  const reconnected=await fetch(base+'/api/events?id='+session.id,{signal:reconnect.signal});
  const reconnectReader=reconnected.body.getReader();let restored='';
  while(!restored.includes('data: ')) restored+=Buffer.from((await reconnectReader.read()).value).toString();
  assert.match(restored,/完成/);reconnect.abort();
  state.currentSession={id:'sess_desktop_test',title:'Desktop',messages:[{role:'user',content:'来自桌面'}]};watchHandler('sess_desktop_test');publishTick();
  const descriptor=JSON.parse(await fs.readFile(path.join(directory,'webui-bridge.json'),'utf8'));
  const snap=await (await fetch(`http://127.0.0.1:${descriptor.port}/snapshot?id=sess_desktop_test`,{headers:{Authorization:`Bearer ${descriptor.token}`}})).json();
  assert.equal(snap.messages[0].content,'来自桌面');
  assert.equal((await fetch(`http://127.0.0.1:${descriptor.port}/snapshot?id=sess_desktop_test`)).status,403);
});
