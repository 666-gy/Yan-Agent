'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeSidecar, buildOpenCodeConfig } = require('../lib/opencode-sidecar');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-compact-kernel-'));
const requests = [];
const server = http.createServer((req,res)=>{
 let raw=''; req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
  const body=JSON.parse(raw||'{}');requests.push(body);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const emit=(delta,finish=null)=>res.write(`data: ${JSON.stringify({id:'compact-fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);
  emit({role:'assistant',content:'COMPACT_SUMMARY: preserve the original objective and continue only when asked.'});emit({},'stop');res.end('data: [DONE]\n\n');
 });
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const sidecar=new OpenCodeSidecar({appRoot:path.resolve(__dirname,'..'),dataDir:path.join(root,'data'),maxKernels:2});
 try{
  const config=buildOpenCodeConfig({providerId:'fixture',modelId:'compact-fixture',apiKey:'local',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,mcpServers:[],enableSubagents:false,accessMode:'full'});
  const request={providerId:'fixture',modelId:'compact-fixture',workspace:root,hasUserWorkspace:true,workMode:'normal',accessMode:'full',openCodeConfig:config};
  const run=await sidecar.run({...request,runId:'compact-fixture-run',prompt:'Explain this task without tools. '+ 'Historic context to preserve. '.repeat(1000)});
  assert.equal(run.status,'done',run.error);
  const before=requests.length;
  const result=await sidecar.compressSession({...request,openCodeSessionId:run.openCodeSessionId});
  assert.equal(result.compacted,true,result.error);
  assert.ok(requests.length>before,'manual compaction must invoke the model');
  const kernel=[...sidecar.kernels.values()][0];
  const history=await kernel.client.session.messages({sessionID:run.openCodeSessionId,directory:root});
  assert.ok(history.data.some(m=>m.info.summary && m.parts.some(p=>p.text?.includes('COMPACT_SUMMARY'))),'summary must be persisted');
  assert.equal(requests.slice(before).filter(r=>r.tools?.length).length,0,'manual compaction must not resume tool execution');
  assert.ok(result.afterTokens>0 && result.afterTokens<result.beforeTokens,JSON.stringify(result));
  console.log(JSON.stringify({ok:true,beforeTokens:result.beforeTokens,afterTokens:result.afterTokens,summaryRequests:requests.length-before}));
 }finally{
  const exits=[...sidecar.kernels.values()].map(k=>k.server?.child).filter(c=>c && c.exitCode===null).map(c=>new Promise(resolve=>c.once('exit',resolve))); sidecar.close(); await Promise.all(exits);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});

