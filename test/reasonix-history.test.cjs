'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ExternalAgentService } = require('../lib/external-agents/service');
const { run } = require('../lib/external-agents/reasonix-worker');
function fixture(t, scenario = 'open') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-rs-history-'));
  const executable = path.join(root, 'Reasonix Studio.exe');
  fs.mkdirSync(path.join(root, 'resources/bin'), {recursive:true});
  for (const name of [executable, path.join(root, 'resources/app.asar'), path.join(root, 'resources/bin/reasonix-studio-host.exe')]) fs.writeFileSync(name, 'fixture');
  const sessions = path.join(root, 'sessions'); fs.mkdirSync(sessions);
  const journal = path.join(sessions, 'history.jsonl');
  const old = [{role:'system',content:'private system'}, {role:'user',content:'原来的任务😀'},
    {role:'assistant',content:'旧答案😀',reasoning:'hidden'}, {role:'tool',content:'工具输出'}];
  fs.writeFileSync(journal, old.map(x=>JSON.stringify(x)).join('\n')+'\n');
  fs.writeFileSync(path.join(sessions,'history.events.jsonl'), JSON.stringify({role:'user',content:'duplicate events'}));
  const tree = [{root,sessions:[{path:journal,name:'history',title:'历史测试',archived:scenario==='archived'}]}];
  let sent, listener, resumed = false, submits = 0;
  const connect = async () => ({close(){},events:async (_base,cb)=>{listener=cb;return {finished:new Promise(()=>{})};},request:async(route,body)=>{
    if(route==='/tree')return tree;
    if(route==='/runtimes')return [{id:'r1',base:'/rt/r1',root}];
    if(route.endsWith('/status'))return {workspaceRoot:root,running:scenario==='busy',sessionPath:scenario==='empty'&&!resumed?'':journal};
    if(route.endsWith('/history'))return scenario==='empty'&&!resumed?[old[0]]:sent?[...old,{role:'user',content:sent},{role:'assistant',content:'本轮答案😀'}]:old;
    if(route.endsWith('/resume')){assert.equal(body.path,journal);resumed=true;return null;}
    if(route.endsWith('/submit')){submits++;sent=body.input;listener({kind:'turn_done'});return null;}
    throw Error(route);
  }});
  const config={externalAgents:{enabled:true,providers:{reasonix:{enabled:true,executable}}}};
  const service=new ExternalAgentService({dataDir:root,loadConfig:()=>config,historyOptions:{roots:[]},reasonixConnect:connect,launch:()=>process.pid});service.close();
  t.after(()=>{service.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,journal,service,connect,context:{sessionId:'yan-rs',workspace:root},submits:()=>submits,resumed:()=>resumed};
}
test('Reasonix history discovers only desktop-listed transcripts, pages Unicode and enforces scope',async t=>{
  const f=fixture(t);const listed=await f.service.listHistory(f.context,{provider:'reasonix'});
  assert.equal(listed.total,1);assert.equal(f.service.records().length,0);
  let cursor, text=''; do {const page=await f.service.readHistory(f.context,{history_id:listed.sessions[0].history_id,limit:3,cursor});text+=page.messages.map(x=>x.text).join('');cursor=page.next_cursor;}while(cursor);
  assert.equal(text,'原来的任务😀旧答案😀');
  const tools=await f.service.readHistory(f.context,{history_id:listed.sessions[0].history_id,include_tools:true});assert.ok(tools.messages.some(m=>m.role==='tool'));
  const other={...f.context,workspace:os.tmpdir()};assert.equal((await f.service.listHistory(other,{provider:'reasonix'})).total,0);
  assert.equal((await f.service.listHistory(other,{provider:'reasonix',scope:'all'})).total,1);
  await assert.rejects(f.service.readHistory(other,{history_id:listed.sessions[0].history_id}),/范围/);
  assert.equal(f.submits(),0);
});
for(const scenario of ['open','empty','busy','archived','replaced'])test(`Reasonix historical continuation: ${scenario}`,async t=>{
  const f=fixture(t,scenario);const listed=await f.service.listHistory(f.context,{provider:'reasonix'});
  const params={provider:'reasonix',session_mode:'history',history_id:listed.sessions[0].history_id,request_key:'continue',prompt:'继续只读检查'};
  if(scenario==='archived'){await assert.rejects(f.service.delegate(f.context,params),/归档/);return;}
  await assert.rejects(f.service.delegate({...f.context,workspace:os.tmpdir()},params),/工作区/);
  const job=await f.service.delegate(f.context,params);assert.equal(job.reused_session,true);
  if(scenario==='replaced')fs.writeFileSync(f.journal,'{}\n');
  const dir=path.join(f.service.root,job.job_id);await run(dir,{connectHost:f.connect,interval:1});
  const result=f.service.result(f.context,job.job_id);
  assert.equal(result.status,['busy','replaced'].includes(scenario)?'blocked':'succeeded');
  if(result.status==='succeeded'){assert.equal(result.output,'本轮答案😀');assert.equal(f.submits(),1);}else assert.equal(f.submits(),0);
  assert.equal(f.resumed(),scenario==='empty');
  assert.equal((await f.service.delegate(f.context,params)).job_id,job.job_id);
  await run(dir,{connectHost:()=>assert.fail('must not reconnect/resend')});
});
