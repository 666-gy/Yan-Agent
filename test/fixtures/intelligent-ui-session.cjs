'use strict';
const {TOOL,createIntelligentUi}=require('../../lib/intelligent-ui-creator');
const active={intelligentUiAllowed:true,intelligentUiNetworkAllowed:false};
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line);if(request.id===undefined)return;
 try {
  let result={};
  if(request.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'ui-session-fixture',version:'1'}};
  if(request.method==='tools/list')result={tools:[TOOL,{name:'nested_sessions',description:'Must stay unavailable in daily mode',inputSchema:{type:'object'}}]};
  if(request.method==='tools/call') {
   if(request.params.name!==TOOL.name)throw new Error('Unexpected session tool');
   const input=request.params.arguments;
   result={content:[{type:'text',text:JSON.stringify(createIntelligentUi(active,input.task_id,input))}]};
  }
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
 }catch(error){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32000,message:error.message}})+'\n');}
});
