'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {OpenCodeV2Adapter}=require('../lib/kernel-v2/adapter');
const {buildOpenCodeConfig}=require('../lib/kernel-policy');
const staging=require('../lib/provider-staging');
test('real V2 parallel grep always approvals are idempotent and personalization reaches provider', {timeout:45000}, async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yan-question-flow-'));
 const appRoot=path.resolve(__dirname,'..');
 const adapter=new OpenCodeV2Adapter({appRoot,dataDir:root});
 let asked=false;const requests=[],replies=[];
 const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
  const body=JSON.parse(raw);requests.push(body);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const send=(delta,finish=null)=>res.write(`data: ${JSON.stringify({id:'fixture',model:'fixture',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);
  if(body.tools?.length&&!asked){asked=true;send({role:'assistant',tool_calls:[{index:0,id:'call_question',type:'function',function:{name:'grep',arguments:JSON.stringify({pattern:'needle',path:root,limit:20})}}]});send({tool_calls:[{index:1,id:'second_grep',type:'function',function:{name:'grep',arguments:JSON.stringify({pattern:'needle',path:root,limit:20})}}]});send({},'tool_calls');}
  else {send({role:'assistant',content:'QUESTION_RESUMED_OK'});send({},'stop');}
  res.end('data: [DONE]\n\n');
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await adapter.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});});
 const options={providerId:'fixture',modelId:'fixture',apiKey:'local',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,deepSeekProviderModule:staging.stageDeepSeekProviderModule({appRoot,dataDir:root}),dsml:false,accessMode:'full',enableSubagents:false};
 const result=await adapter.run({...options,runId:'question',workspace:root,hasUserWorkspace:false,customInstructions:'PERSONAL_CONTEXT_MARKER_123',prompt:'Ask me a question, then continue.',openCodeConfig:buildOpenCodeConfig(options)},event=>{
  const data=event.properties||event.data;
  if(event.type==='question.asked') replies.push(adapter.replyQuestion({runId:'question',requestId:data.id,answers:[['Yes']]}));
  if(event.type==='permission.asked') { const wait = replies.length ? 150 : 0; replies.push(new Promise(r=>setTimeout(r,wait)).then(()=>adapter.replyPermission({runId:'question',requestId:data.id,reply:'always'}))); }
 });
 await Promise.all(replies);
 assert.equal(result.status,'done',JSON.stringify(result)); assert.ok(replies.length >= 2); assert.ok((await Promise.all(replies)).every(reply=>reply.ok));
 
 assert.ok(requests.length > 1, 'tool result must return to model'); assert.ok(JSON.stringify(requests[0]).includes('PERSONAL_CONTEXT_MARKER_123')); assert.equal(result.toolCalls.length,2); assert.ok(result.toolCalls.every(call=>call.ok),JSON.stringify(result.toolCalls));
 assert.match(JSON.stringify(result),/QUESTION_RESUMED_OK/);
});



