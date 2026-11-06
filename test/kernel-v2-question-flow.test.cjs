'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {OpenCodeV2Adapter}=require('../lib/kernel-v2/adapter');
const {buildOpenCodeConfig}=require('../lib/kernel-policy');
const staging=require('../lib/provider-staging');
test('real V2 question tool resumes after a user answer', {timeout:45000}, async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yan-question-flow-'));
 const appRoot=path.resolve(__dirname,'..');
 const adapter=new OpenCodeV2Adapter({appRoot,dataDir:root});
 let asked=0;const requests=[],replies=[],questions=[];
 const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
  const body=JSON.parse(raw);requests.push(body);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const send=(delta,finish=null)=>res.write(`data: ${JSON.stringify({id:'fixture',model:'fixture',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);
  if(body.tools?.length&&asked<2){asked++;send({role:'assistant',tool_calls:[{index:0,id:`call_question_${asked}`,type:'function',function:{name:'question',arguments:JSON.stringify({questions:[{header:'Pick',question:asked===1?'Choose one':'Choose a different action',options:[{label:'Yes',description:'continue'},{label:'No',description:'skip'}]}]})}}]});send({},'tool_calls');}
  else {send({role:'assistant',content:'QUESTION_RESUMED_OK'});send({},'stop');}
  res.end('data: [DONE]\n\n');
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await adapter.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});});
 const options={providerId:'fixture',modelId:'fixture',apiKey:'local',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,deepSeekProviderModule:staging.stageDeepSeekProviderModule({appRoot,dataDir:root}),dsml:false,accessMode:'full',enableSubagents:false};
 const result=await adapter.run({...options,runId:'question',workspace:root,hasUserWorkspace:true,prompt:'Ask me a question, then continue.',openCodeConfig:buildOpenCodeConfig(options)},event=>{
  const data=event.properties||event.data;
  if(event.type==='question.asked') {questions.push(data.questions[0].question);replies.push(adapter.replyQuestion({runId:'question',requestId:data.id,answers:[[questions.length===1?'Yes':'No']]}));}
  if(event.type==='permission.asked') replies.push(adapter.replyPermission({runId:'question',requestId:data.id,reply:'once'}));
 });
 await Promise.all(replies);
 assert.equal(result.status,'done',JSON.stringify(result));
 assert.ok(replies.length,'question was emitted');
 assert.ok(requests.some(b=>b.messages?.some(m=>m.role==='tool'&&JSON.stringify(m).includes('Yes'))),'answer reached next model step');
 assert.deepEqual(questions,['Choose one','Choose a different action']);
 assert.ok(requests.some(b=>b.messages?.some(m=>m.role==='tool'&&JSON.stringify(m).includes('No'))),'second answer reached next model step');
 assert.match(JSON.stringify(result),/QUESTION_RESUMED_OK/);
});
