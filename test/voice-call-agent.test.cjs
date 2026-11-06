'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {OpenCodeV2Adapter}=require('../lib/kernel-v2/adapter');
const {buildOpenCodeConfig}=require('../lib/kernel-policy');
const staging=require('../lib/provider-staging');
test('voice profile exposes only allowed tools and replaces coding system', {timeout:45000}, async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yan-question-flow-'));
 const appRoot=path.resolve(__dirname,'..');
 const adapter=new OpenCodeV2Adapter({appRoot,dataDir:root});
 let asked=false;const requests=[],replies=[];
 const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
  const body=JSON.parse(raw);requests.push(body);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const send=(delta,finish=null)=>res.write(`data: ${JSON.stringify({id:'fixture',model:'fixture',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);
  send({role:'assistant',content:'晚上好呀！'});send({},'stop');
  res.end('data: [DONE]\n\n');
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await adapter.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});});
 const options={providerId:'fixture',modelId:'fixture',apiKey:'local',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,deepSeekProviderModule:staging.stageDeepSeekProviderModule({appRoot,dataDir:root}),dsml:false,accessMode:'full',enableSubagents:false,capabilities:{imageInput:true}};
 const screen=path.join(root,'screen.png');
 fs.writeFileSync(screen,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=','base64'));
 const result=await adapter.run({...options,attachments:[{path:screen,name:'screen.png',mimeType:'image/png',kind:'image'}],runId:'question',workspace:root,hasUserWorkspace:false,customInstructions:'PERSONAL_CONTEXT_MARKER_123',prompt:'Ask me a question, then continue.',utility:true,utilityKind:'voice-call',openCodeConfig:{...buildOpenCodeConfig(options),yanVoiceCall:true,agent:{build:{prompt:require('../lib/voice-call-agent').system}}}},event=>{
  const data=event.properties||event.data;
  if(event.type==='question.asked') replies.push(adapter.replyQuestion({runId:'question',requestId:data.id,answers:[['Yes']]}));
  if(event.type==='permission.asked') { const wait = replies.length ? 150 : 0; replies.push(new Promise(r=>setTimeout(r,wait)).then(()=>adapter.replyPermission({runId:'question',requestId:data.id,reply:'always'}))); }
 });
 await Promise.all(replies);
 assert.equal(result.status,'done',JSON.stringify(result));
 const first=requests[0];
 assert.ok(first.messages.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url'&&part.image_url?.url?.startsWith('data:image/png;base64,'))), 'shared screen must reach the voice provider as an image');
 const names=(first.tools||[]).map(t=>t.function.name);
 assert.ok(names.includes('shell'),JSON.stringify(names));
 assert.ok(names.includes('websearch'),JSON.stringify(names));
 assert.ok(names.every(require('../lib/voice-call-agent').toolAllowed),JSON.stringify(names));
 const system=first.messages.filter(m=>m.role==='system').map(m=>m.content).join(' ');
 assert.match(system,/妍宝/);
 assert.ok(!system.includes('PERSONAL_CONTEXT_MARKER_123'));
 assert.ok(!system.includes('coding agent'));
});

