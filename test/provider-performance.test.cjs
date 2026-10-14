'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const data=x=>'data: '+JSON.stringify(x)+'\n\n';
const enc=new TextEncoder();

test('all Chat adapters deliver complete tool arguments before delayed usage and DONE', {timeout:5000},async()=>{
 for(const adapter of ['dsml','glmm','kiml','qwem','agnl','geml','grol']) {
  const module=await import(`../lib/opencode-${adapter}-provider.bundle.mjs`);
  const create=module[Object.keys(module).find(k=>k.startsWith('create'))];
  let upstream;
  const body=new ReadableStream({start(c){upstream=c;c.enqueue(enc.encode(data({id:'a',model:'fixture',choices:[{index:0,delta:{tool_calls:[{index:0,id:'call1',type:'function',function:{name:'save',arguments:'{"content":"ok"}'},extra_content:{google:{thought_signature:'signature'}}}]},finish_reason:null}]})));c.enqueue(enc.encode(data({id:'a',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})));}});
  const model=create({name:'fixture',baseURL:'https://fixture.test/v1',fetch:async()=>new Response(body,{headers:{'content-type':'text/event-stream'}})})('fixture');
  const result=await model.doStream({prompt:[{role:'user',content:[{type:'text',text:'save'}]}],tools:[{type:'function',name:'save',inputSchema:{type:'object',properties:{content:{type:'string'}}}}]});
  const reader=result.stream.getReader();
  let call;
  try{
   while(!call){const next=await reader.read();assert.equal(next.done,false);assert.notEqual(next.value.type,'error');if(next.value.type==='tool-call')call=next.value;}
   assert.equal(call.input,'{"content":"ok"}');
   if(adapter==='geml')assert.equal(call.providerMetadata.google.thoughtSignature,'signature');
  }finally{
   upstream.enqueue(enc.encode(data({id:'a',choices:[],usage:{prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:80}}})+'data: [DONE]\n\n'));upstream.close();
  }
  let usage;while(true){const n=await reader.read();if(n.done)break;if(n.value.type==='finish')usage=n.value.usage;}
  assert.equal(usage.inputTokens.cacheRead,80,adapter);
 }
});

test('telemetry distinguishes missing cache data from a reported zero',async()=>{
 const {usageMetrics}=await import('../lib/provider-telemetry.mjs');
 assert.equal(usageMetrics({prompt_tokens:100}).cacheReported,false);
 assert.equal(usageMetrics({prompt_tokens:100}).cacheHitRate,null);
 assert.equal(usageMetrics({prompt_tokens:100,prompt_tokens_details:{cached_tokens:0}}).cacheHitRate,0);
 assert.equal(usageMetrics({input_tokens:100,input_tokens_details:{cached_tokens:90}}).cacheHitRate,.9);
 assert.equal(usageMetrics({input_tokens:100,cached_tokens:80}).cacheHitRate,.8);
});

test('DSML normalizes relay cache aliases before the SDK consumes usage', async () => {
 const {createYanDsmlProvider}=await import('../lib/opencode-dsml-provider.mjs');
 const payload={id:'fixture',choices:[{index:0,message:{role:'assistant',content:'ok'},finish_reason:'stop'}],
  usage:{prompt_tokens:100,completion_tokens:2,prompt_cache_hit_tokens:80}};
 const model=createYanDsmlProvider({name:'fixture',baseURL:'https://fixture.test/v1',fetch:async()=>Response.json(payload)})('fixture');
 const result=await model.doGenerate({prompt:[{role:'user',content:[{type:'text',text:'hello'}]}]});
 assert.equal(result.usage.inputTokens.cacheRead,80);
 assert.equal(result.usage.inputTokens.noCache,20);
});

test('DSML keeps tool schema prefixes stable across discovery and property order',async()=>{
 const {createYanProviderFetch}=await import('../lib/opencode-dsml-provider.mjs');
 const bodies=[];const fetch=createYanProviderFetch(async(_url,init)=>{bodies.push(init.body);return Response.json({choices:[]});});
 const a={type:'function',function:{name:'alpha',parameters:{type:'object',properties:{x:{type:'string'}}}}};
 const b={function:{parameters:{properties:{x:{type:'string'}},type:'object'},name:'beta'},type:'function'};
 await fetch('https://fixture.test',{body:JSON.stringify({model:'fixture',messages:[],tools:[b,a]})});
 await fetch('https://fixture.test',{body:JSON.stringify({model:'fixture',messages:[],tools:[a,{type:'function',function:{name:'beta',parameters:{type:'object',properties:{x:{type:'string'}}}}}]})});
 assert.equal(bodies[0],bodies[1]);
});

test('DSML keeps kernel environment facts after stable system instructions',async()=>{
 const {createYanProviderFetch}=await import('../lib/opencode-dsml-provider.mjs');
 const sent=[];
 const fetch=createYanProviderFetch(async(_url,init)=>{sent.push(JSON.parse(init.body));return Response.json({choices:[]});});
 const env=directory=>`You are powered by the model named fixture. The exact model ID is fixture/fixture\nHere is some useful information about the environment you are running in:\n<env>\n  Working directory: ${directory}\n  Workspace root folder: /\n  Is directory a git repo: no\n  Platform: win32\n  Today's date: Tue Oct 06 2026\n</env>`;
 for(const directory of ['blank-A','blank-B']) await fetch('https://fixture.test',{body:JSON.stringify({messages:[
  {role:'system',content:'You are opencode, baseline\n\n'+env(directory)},
  {role:'system',content:'Stable Yan rules'}, {role:'user',content:'hello'}
 ]})});
 assert.equal(sent[0].messages[0].content,sent[1].messages[0].content);
 assert.equal(sent[0].messages[0].content,'You are opencode, baseline');
 assert.equal(sent[0].messages[1].content,'Stable Yan rules\n\n'+env('blank-A'));
 assert.deepEqual(sent[0].messages[2],{role:'user',content:'hello'});
 const {deferKernelEnvironment}=await import('../lib/provider-cache-prefix.mjs');
 assert.deepEqual(deferKernelEnvironment(sent[0]),sent[0]);
 for(const messages of [
  [{role:'system',content:'You are opencode, baseline\n\n'+env('A')}],
  [{role:'system',content:'Custom prompt\n\n'+env('A')},{role:'system',content:'Keep order'}],
  [{role:'system',content:'You are opencode, baseline\n\n'+env('A')+'\nAdditional instructions'},{role:'system',content:'Keep order'}],
  [{role:'system',content:'You are opencode, baseline\n\n'+env('A')},{role:'user',content:'hello'},{role:'system',content:'Later rules'}]
 ]) {const body={messages};assert.equal(deferKernelEnvironment(body),body);}
});

test('telemetry counts inline image bytes without persisting image contents',async()=>{
 const {requestFingerprint}=await import('../lib/provider-telemetry.mjs');
 const bytes=Buffer.from('private-image');
 const body={model:'fixture',messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+bytes.toString('base64')}}]}]};
 const fingerprint=requestFingerprint(body,'image-fixture');
 assert.equal(fingerprint.imageCount,1);assert.equal(fingerprint.inlineImageBytes,bytes.length);
 assert.equal(fingerprint.requestBytes,Buffer.byteLength(JSON.stringify(body)));
 assert.doesNotMatch(JSON.stringify(fingerprint),/private|data:image|base64/);
});

test('telemetry observes CR-framed Responses event names and cache data without changing bytes',async()=>{
 const {observeProviderFetch}=await import('../lib/provider-telemetry.mjs');const rows=[];
 const text='\uFEFF: heartbeat\r\revent: response.completed\rdata: {"response":\rdata: {"usage":{"input_tokens":100,"cached_tokens":90}}}\r\r';
 const response=await observeProviderFetch(async()=>new Response(new ReadableStream({start(c){for(const byte of enc.encode(text))c.enqueue(Uint8Array.of(byte));c.close();}}),{headers:{'content-type':'text/event-stream'}}),{adapter:'test',emit:r=>rows.push(r)})('https://fixture',{body:JSON.stringify({model:'m',input:[]})});
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),enc.encode(text));
 assert.equal(rows.at(-1).cacheHitRate,.9);assert.equal(rows.at(-1).status,'complete');
});

test('request fingerprints localize schema/control/history changes without storing content',async()=>{
 const {requestFingerprint}=await import('../lib/provider-telemetry.mjs');
 const a={model:'m',messages:[{role:'system',content:'private system'},{role:'user',content:'private question'}],tools:[{name:'a'}]};
 requestFingerprint(a,'unit');
 const b=requestFingerprint({...a,messages:[...a.messages,{role:'assistant',content:'private answer'}]},'unit');
 assert.equal(b.unchangedItems,2);assert.equal(b.schemaChanged,false);
 const c=requestFingerprint({...a,tools:[{name:'b'}],reasoning_effort:'high'},'unit');
 assert.equal(c.schemaChanged,true);assert.equal(c.controlsChanged,true);
 assert.doesNotMatch(JSON.stringify(c),/private|question|answer/);
});

test('raw telemetry preserves bytes, records timing/usage, and propagates cancellation',async()=>{
 const {observeProviderFetch}=await import('../lib/provider-telemetry.mjs');
 const rows=[];let cancelled=false;
 const text=data({choices:[{delta:{tool_calls:[{function:{arguments:'{}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:100,prompt_tokens_details:{cached_tokens:80}}})+'data: [DONE]\n\n';
 const response=await observeProviderFetch(async()=>new Response(new ReadableStream({start(c){c.enqueue(enc.encode(text));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}}),{adapter:'test',emit:r=>rows.push(r)})('https://private.test',{body:JSON.stringify({model:'m',messages:[]})});
 const reader=response.body.getReader();assert.equal(new TextDecoder().decode((await reader.read()).value),text);await reader.cancel();
 assert.equal(cancelled,true);assert.equal(rows.length,2);assert.equal(rows[1].cachedInputTokens,80);assert.equal(rows[1].status,'complete');assert.ok(rows[1].generationFinishedMs>=0);assert.doesNotMatch(JSON.stringify(rows),/private.test|arguments/);
});

test('project instruction timestamps do not invalidate the rendered system prefix',()=>{
 const {renderProjectInstructions}=require('../lib/project-instructions');
 const base={path:'C:/fixture/AGENTS.md',scope:'.',text:'Use narrow tests.',truncated:false};
 assert.equal(renderProjectInstructions([{...base,version:'mtime-a'}]),renderProjectInstructions([{...base,version:'mtime-b'}]));
 assert.notEqual(renderProjectInstructions([base]),renderProjectInstructions([{...base,text:'Use full tests.'}]));
});

test('GPTL cancellation while upstream read is pending closes cleanly and releases its lock',async()=>{
 const {finishGptlEventStream}=await import('../lib/gptl-stream.mjs');
 let cancelled;
 const source=new ReadableStream({cancel(reason){cancelled=reason;}});
 const response=finishGptlEventStream(new Response(source,{headers:{'content-type':'text/event-stream'}}));
 const reader=response.body.getReader();const pending=reader.read();
 await reader.cancel('stop');assert.equal((await pending).done,true);assert.equal(cancelled,'stop');assert.equal(source.locked,false);
});

test('GROL uses stable xAI routing across growing history and respects explicit IDs',async()=>{
 const {createYanGrolProvider}=await import('../lib/opencode-grol-provider.mjs');
 const ids=[];
 const fetch=async(_url,init)=>{ids.push(new Headers(init.headers).get('x-grok-conv-id'));return Response.json({id:'a',choices:[{index:0,message:{role:'assistant',content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:1}});};
 const provider=createYanGrolProvider({baseURL:'https://example.test/v1',apiKey:'private-key',fetch});
 const prompt=[{role:'user',content:[{type:'text',text:'private question'}]}];
 await provider('grok-4.6').doGenerate({prompt});
 await provider('grok-4.6').doGenerate({prompt:[...prompt,{role:'assistant',content:[{type:'text',text:'ok'}]},{role:'user',content:[{type:'text',text:'continue'}]}]});
 await provider('grok-4.6').doGenerate({prompt:[{role:'user',content:[{type:'text',text:'different question'}]}]});
 await createYanGrolProvider({baseURL:'https://example.test/v1',headers:{'x-grok-conv-id':'chosen-id'},fetch})('grok-4.6').doGenerate({prompt});
 assert.equal(ids[0],ids[1]);assert.notEqual(ids[0],ids[2]);assert.equal(ids[3],'chosen-id');assert.doesNotMatch(ids[0],/private/);
});
