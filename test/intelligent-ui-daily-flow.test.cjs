'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {OpenCodeV2Adapter}=require('../lib/kernel-v2/adapter');
const {buildOpenCodeConfig}=require('../lib/kernel-policy');
const staging=require('../lib/provider-staging');

test('daily native OpenUI traverses actual provider, plugin and MCP transport with other session tools hidden',{timeout:60000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yan-ui-daily-flow-')),appRoot=path.resolve(__dirname,'..');
 const adapter=new OpenCodeV2Adapter({appRoot,dataDir:root}),requests=[];
 const server=http.createServer((req,res)=>{let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
  const body=JSON.parse(raw);requests.push(body);res.writeHead(200,{'content-type':'text/event-stream'});
  const send=(delta,finish)=>res.write('data: '+JSON.stringify({id:'ui-fixture',model:'fixture',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason:finish || null}]})+'\n\n');
  const index=requests.length;
  if(index<=2) {
   const args=index===1?{task_id:'daily-ui-flow',action:'start',title:'预算比较',purpose:'调整数量比较预算',placement:'final'}:{task_id:'daily-ui-flow',action:'render',format:'openui',code:'root = Stack([TextContent("总计 " + ($qty * 280)), Input("quantity", "", "number", null, $qty)])\n$qty = "3"'};
   send({role:'assistant',tool_calls:[{index:0,id:'ui-'+index,type:'function',function:{name:'yan_session_intelligent_ui_creator',arguments:JSON.stringify(args)}}]});send({},'tool_calls');
  } else {send({role:'assistant',content:'可以调整数量比较预算。'});send({},'stop');}
  res.end('data: [DONE]\n\n');
 });});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await adapter.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
 const options={providerId:'fixture',modelId:'fixture',apiKey:'local',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',deepSeekProviderModule:staging.stageDeepSeekProviderModule({appRoot,dataDir:root}),dsml:false,accessMode:'full',enableSubagents:false};
 options.mcpServers=[{id:'yan_session',enabled:true,command:process.execPath,args:[path.join(__dirname,'fixtures/intelligent-ui-session.cjs')]}];
 const result=await adapter.run({...options,runId:'daily-ui-flow',workspace:root,hasUserWorkspace:false,prompt:'调整一下预算',agentPreset:'daily',intelligentUiEnabled:true,intelligentUiAvailable:true,openCodeConfig:buildOpenCodeConfig(options)});
 assert.equal(result.status,'done',JSON.stringify(result));
 const tools=requests[0].tools.map(tool=>tool.function.name);
 assert.ok(tools.includes('yan_session_intelligent_ui_creator'),JSON.stringify(tools));
 assert.ok(!tools.includes('yan_session_nested_sessions'));
 assert.ok(!tools.includes('shell'));assert.ok(!tools.includes('write'));
 assert.ok(requests.length>=3);
 const history=JSON.stringify(requests.at(-1).messages);
 assert.match(history,/official OpenUI|Root is Stack/);
 assert.match(history,/ready/);
 assert.match(JSON.stringify(requests[0].messages),/way of expressing an answer/);
});
