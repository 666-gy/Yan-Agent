'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const enc = new TextEncoder();
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const packet = (delta, finish_reason = null, usage) => ({id:'fixture',model:'fixture',choices:[{index:0,delta,finish_reason}],...(usage?{usage}:{})});
const prompt = [{role:'user',content:[{type:'text',text:'create code'}]}];
const tools = [{type:'function',name:'save',inputSchema:{type:'object',properties:{content:{type:'string'}}}}];
const drain = async stream => {const parts=[];for await(const p of stream)parts.push(p);return parts;};
async function create(adapter,fetch,extra={}) {const module=await import(`../lib/opencode-${adapter}-provider.bundle.mjs`);return module[Object.keys(module).find(k=>k.startsWith('create'))]({name:'custom',baseURL:'https://relay.invalid/v1',apiKey:'test',apiFormat:'openai',fetch,...extra});}

test('GPTL accepts empty continuation IDs, placeholder objects and terminal message snapshots', async()=>{
 const args='{"content":"Chinese 中文 and braces {}"}';
 const cases=[
  [packet({tool_calls:[{id:'c',function:{name:'save',arguments:args.slice(0,12)}}]}),
   packet({tool_calls:[{id:'',function:{arguments:args.slice(12)}}]},'tool_calls')],
  [packet({tool_calls:[{index:0,id:'c',function:{name:'save',arguments:'{}'}}]}),
   packet({tool_calls:[{index:0,function:{arguments:args.slice(0,12)}}]}),
   packet({tool_calls:[{index:0,function:{arguments:args.slice(12)}}]},'tool_calls')],
  [packet({tool_calls:[{index:0,id:'c',function:{name:'save',arguments:''}}]}),
   {choices:[{index:0,delta:{},message:{tool_calls:[{id:'c',function:{name:'save',arguments:args}}]},finish_reason:'tool_calls'}]}]
 ];
 for(const chunks of cases) {
  const provider=await create('gptl',async()=>new Response(chunks.map(event).join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}));
  const rows=await drain((await provider('gpt-5.5').doStream({prompt,tools})).stream);
  assert.deepEqual(rows.filter(p=>p.type==='error'),[]);
  const calls=rows.filter(p=>p.type==='tool-call');
  assert.equal(calls.length,1);assert.equal(calls[0].toolCallId,'c');assert.equal(calls[0].input,args);
  assert.equal(rows.filter(p=>p.type==='tool-input-delta').map(p=>p.delta).join(''),args);
 }
});

test('relay invalid argument diagnostics omit content and do not invent missing parameters',async()=>{
 const {relayChatStream}=await import('../lib/relay-chat-stream.mjs');
 for(const args of ['', '{"content":"PRIVATE_UNFINISHED', '{}garbage']) {
  const wire=event(packet({tool_calls:[{index:0,id:'c',function:{name:'save',arguments:args}}]},'tool_calls'));
  await assert.rejects(relayChatStream(new Response(wire,{headers:{'content-type':'text/event-stream'}})).text(),error=>{
   assert.match(error.message,/Incomplete or invalid tool arguments \(tool=save, index=0, characters=\d+\)/);
   assert.doesNotMatch(error.message,/PRIVATE_UNFINISHED|garbage/);return true;
  });
 }
});

test('empty continuation IDs cannot merge ambiguous parallel calls',async()=>{
 const {relayChatStream}=await import('../lib/relay-chat-stream.mjs');
 const wire=event(packet({tool_calls:['a','b'].map(id=>({id,function:{name:'save',arguments:'{"content":"'}}))}))
  +event(packet({tool_calls:[{id:'',function:{arguments:'x"}'}}]},'tool_calls'));
 await assert.rejects(relayChatStream(new Response(wire,{headers:{'content-type':'text/event-stream'}})).text(),/Ambiguous tool delta/);
});

test('four adapters expose incremental code before terminal, execute once, and preserve signatures', {timeout:5000}, async()=>{
 for(const adapter of ['gptl','agnl','geml','grol']) {
  let source;
  const body=new ReadableStream({start(c){source=c;c.enqueue(enc.encode(event(packet({role:"assistant"}))));}});
  const provider=await create(adapter,async()=>new Response(body,{headers:{'content-type':'text/event-stream'}}));
  const streaming=provider('fixture').doStream({prompt,tools});
  source.enqueue(enc.encode(event(packet({tool_calls:[{index:0,id:'call',function:{name:'sa',arguments:''}}]}))));
  source.enqueue(enc.encode(event(packet({tool_calls:[{index:0,function:{name:'ve',arguments:'{"content":"line1'},extra_content:{google:{thought_signature:'signed'}}}]}))));
  const reader=(await streaming).stream.getReader();
  const seen=[];while(!seen.some(p=>p.type==='tool-input-delta'))seen.push((await reader.read()).value);
  assert.equal(seen.some(p=>p.type==='tool-call'),false,adapter);
  source.enqueue(enc.encode(event(packet({tool_calls:[{index:0,id:'call',function:{name:'save',arguments:'line2"}'}}]}))));
  source.enqueue(enc.encode(event(packet({},'tool_calls'))));
  source.enqueue(enc.encode(event({choices:[],usage:{prompt_tokens:100,completion_tokens:20,cached_tokens:90}})+'data: [DONE]\n\n'));source.close();
  while(true){const next=await reader.read();if(next.done)break;seen.push(next.value);}
  assert.deepEqual(seen.filter(p=>p.type==='error'),[],adapter);
  const calls=seen.filter(p=>p.type==='tool-call');assert.equal(calls.length,1);assert.equal(calls[0].input,'{"content":"line1line2"}');
  assert.equal(seen.filter(p=>p.type==='tool-input-delta').map(p=>p.delta).join(''),calls[0].input);
  if(adapter==='geml')assert.equal(calls[0].providerMetadata.google.thoughtSignature,'signed');
  assert.equal(seen.find(p=>p.type==='finish').usage.inputTokens.cacheRead,90);
 }
});

test('SSE framing handles split UTF-8, CR, CRLF, comments, BOM and multi-line JSON',async()=>{
 const {relayChatStream}=await import('../lib/relay-chat-stream.mjs');
 for(const sep of ['\r','\r\n','\n']) {
  const text='\uFEFF: heartbeat'+sep+sep+'data: {"id":"x",'+sep+'data: "choices":[{"index":0,"delta":{"content":"中文"},"finish_reason":"stop"}]}'+sep+sep+'data: [DONE]'+sep+sep;
  const bytes=enc.encode(text);const body=new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}});
  const output=await relayChatStream(new Response(body,{headers:{'content-type':'text/event-stream'}})).text();
  assert.match(output,/中文/);assert.match(output,/\[DONE\]/);
 }
});

test('Chat finish_reason tolerates missing DONE and held-open tail, preserving late usage', {timeout:2000},async()=>{
 const {relayChatStream}=await import('../lib/relay-chat-stream.mjs');let cancelled=false;
 const body=new ReadableStream({start(c){c.enqueue(enc.encode(event(packet({content:'ok'},'stop'))));setTimeout(()=>c.enqueue(enc.encode(event({choices:[],usage:{prompt_tokens:100,prompt_cache_hit_tokens:90}}))),5);},cancel(){cancelled=true;}});
 const before=Date.now();const output=await relayChatStream(new Response(body,{headers:{'content-type':'text/event-stream'}}),{terminalGraceMs:30}).text();
 assert.match(output,/"cached_tokens":90/);assert.match(output,/\[DONE\]/);assert.ok(Date.now()-before<1000);assert.equal(cancelled,true);
});

test('premature EOF and truncated tool arguments cannot execute a tool',async()=>{
 const {relayChatStream}=await import('../lib/relay-chat-stream.mjs');
 for(const ending of ['',event(packet({},'length')),event(packet({},'tool_calls'))]){
  const text=event(packet({tool_calls:[{index:0,id:'c',function:{name:'save',arguments:'{"content":"unfinished'}}]}))+ending;
  await assert.rejects(relayChatStream(new Response(text,{headers:{'content-type':'text/event-stream'}})).text(),/Incomplete|closed before/);
 }
});

test('cumulative relay arguments, repeated names and parallel IDs are not duplicated',async()=>{
 const provider=await create('agnl',async()=>new Response([
  event(packet({tool_calls:[{id:'a',function:{name:'save',arguments:'{"content":"a'}}]})),
  event(packet({tool_calls:[{id:'b',function:{name:'save',arguments:'{"content":"b'}}]})),
  event(packet({tool_calls:[{id:'a',function:{name:'save',arguments:'{"content":"aaa"}'}},{id:'b',function:{name:'save',arguments:'{"content":"bbb"}'}}]})),
  event(packet({},'tool_calls')),'data: [DONE]\n\n'].join(''),{headers:{'content-type':'text/event-stream'}}));
 const rows=await drain((await provider('fixture').doStream({prompt,tools})).stream);
 assert.deepEqual(rows.filter(p=>p.type==='error'),[]);
 assert.deepEqual(rows.filter(p=>p.type==='tool-call').map(p=>[p.toolCallId,JSON.parse(p.input).content]),[['a','aaa'],['b','bbb']]);
});

test('relay JSON response to stream request retains tool calls, aliases and usage',async()=>{
 for(const adapter of ['gptl','agnl','geml','grol']) {
  const provider=await create(adapter,async()=>Response.json({id:'a',choices:[{index:0,message:{role:'assistant',content:null,tool_calls:[{id:'call',type:'function',function:{name:'save',arguments:'{}'},extra_content:{google:{thought_signature:'sig'}}}]},finish_reason:'tool_calls'}],usage:{input_tokens:100,output_tokens:2,prompt_cache_hit_tokens:80}}));
  const rows=await drain((await provider('fixture').doStream({prompt,tools})).stream);
  assert.equal(rows.filter(p=>p.type==='tool-call').length,1,adapter);assert.equal(rows.find(p=>p.type==='finish').usage.inputTokens.cacheRead,80);
 }
});

test('stream_options rejection retries only validation, then remembers capability',async()=>{
 const {relayCompatibleFetch}=await import('../lib/relay-compatible-fetch.mjs');const bodies=[];
 const fetch=relayCompatibleFetch(async(_url,init)=>{const body=JSON.parse(init.body);bodies.push(body);return body.stream_options?Response.json({error:{param:'stream_options',message:'unknown'}},{status:400}):Response.json({choices:[]});});
 for(let i=0;i<2;i++)await fetch('https://fixture/v1',{body:JSON.stringify({model:'m',stream:true,stream_options:{include_usage:true},messages:[]})});
 assert.equal(bodies.length,3);assert.equal(bodies[0].stream_options.include_usage,true);assert.equal(bodies[2].stream_options,undefined);
 let requests=0;const denied=relayCompatibleFetch(async()=>{requests++;return Response.json({error:{message:'invalid key'}},{status:401});});
 await denied('https://fixture/v1',{body:JSON.stringify({stream_options:{include_usage:true}})});assert.equal(requests,1);
});

test('tool schemas stabilize despite discovery and property order, preserving schema arrays',async()=>{
 const {stableToolBody}=await import('../lib/relay-compatible-fetch.mjs');
 const a={tools:[{type:'function',function:{name:'b',parameters:{required:['z','a'],properties:{z:{type:'string'},a:{type:'number'}}}}},{type:'function',function:{name:'a'}}]};
 const b={tools:[a.tools[1],{function:{parameters:{properties:{a:{type:'number'},z:{type:'string'}},required:['z','a']},name:'b'},type:'function'}]};
 assert.equal(JSON.stringify(stableToolBody(a)),JSON.stringify(stableToolBody(b)));assert.deepEqual(stableToolBody(a).tools[1].function.parameters.required,['z','a']);
});

test('GPTL session cache key is stable, explicit wins, unsupported relay safely downgrades',async()=>{
 const module=await import('../lib/opencode-gptl-provider.mjs');const bodies=[];
 const fetch=module.makeGptlFetch(async(_url,init)=>{const b=JSON.parse(init.body);bodies.push(b);return Response.json({choices:[]});},{apiKey:'secret'});
 const base={model:'gpt-6-astra',messages:[{role:'user',content:'private'}]};
 await fetch('https://fixture/chat/completions',{body:JSON.stringify(base)});await fetch('https://fixture/chat/completions',{body:JSON.stringify({...base,messages:[...base.messages,{role:'assistant',content:'ok'}]})});
 await fetch('https://fixture/chat/completions',{body:JSON.stringify({...base,prompt_cache_key:'explicit'})});
 assert.equal(bodies[0].prompt_cache_key,bodies[1].prompt_cache_key);assert.doesNotMatch(bodies[0].prompt_cache_key,/secret|private/);assert.equal(bodies[2].prompt_cache_key,'explicit');
 let count=0;const fallback=module.makeGptlFetch(async(_url,init)=>{count++;return JSON.parse(init.body).prompt_cache_key?Response.json({error:{param:'prompt_cache_key'}},{status:400}):Response.json({choices:[]});});
 await fallback('https://fixture/chat/completions',{body:JSON.stringify(base)});await fallback('https://fixture/chat/completions',{body:JSON.stringify(base)});assert.equal(count,3);
});

test('Responses event types from event header survive, terminal errors stay errors, EOF is not success',async()=>{
 const {finishGptlEventStream}=await import('../lib/gptl-stream.mjs');
 const completed='event: response.completed\rdata: {"response":{"usage":{"input_tokens":10}}}\r\r';
 const output=await finishGptlEventStream(new Response(completed,{headers:{'content-type':'text/event-stream'}})).text();assert.match(output,/"type":"response.completed"/);
 for(const type of ['response.failed','response.incomplete','error']) {
  const text=await finishGptlEventStream(new Response(`event: ${type}\ndata: {}\n\n`,{headers:{'content-type':'text/event-stream'}})).text();assert.match(text,new RegExp(type));
 }
 await assert.rejects(finishGptlEventStream(new Response(event({type:'response.created'}),{headers:{'content-type':'text/event-stream'}})).text(),/closed before/);
});

test('four adapters retain query parameters on actual endpoints and accept explicit completion URLs',async()=>{
 for(const adapter of ['gptl','agnl','geml','grol']) {
  let url;
  const provider=await create(adapter,async(input)=>{url=String(input);return Response.json({id:'x',choices:[{index:0,message:{role:'assistant',content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}});},{baseURL:'https://relay.invalid/gateway/v1/chat/completions?route=blue&key=fixture'});
  await provider('fixture').doGenerate({prompt});const parsed=new URL(url);
  assert.equal(parsed.pathname,'/gateway/v1/chat/completions');assert.equal(parsed.searchParams.get('route'),'blue');assert.equal(parsed.searchParams.get('key'),'fixture');
 }
});

test('DONE without finish_reason releases only valid complete calls',async()=>{
 const {relayChatStream}=await import('../lib/relay-chat-stream.mjs');
 const response=args=>new Response(event(packet({tool_calls:[{index:0,id:'c',function:{name:'save',arguments:args}}]}))+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 assert.match(await relayChatStream(response('{}')).text(),/"finish_reason":"tool_calls"/);
 await assert.rejects(relayChatStream(response('{')).text(),/Incomplete/);
});

test('GEML waits for a late signature but forwards signed chunks as soon as available',async()=>{
 let source;const provider=await create('geml',async()=>new Response(new ReadableStream({start(c){source=c;}}),{headers:{'content-type':'text/event-stream'}}));
 const streaming=provider('fixture').doStream({prompt,tools});
 const {stream}=await streaming;const reader=stream.getReader();
 // Compatible SDK stream-start is independent of model output.
 assert.equal((await reader.read()).value.type,'stream-start');
 source.enqueue(enc.encode(event(packet({tool_calls:[{index:0,id:'c',function:{name:'save',arguments:'{"content":"code'}}]}))));
 source.enqueue(enc.encode(event(packet({tool_calls:[{index:0,extra_content:{google:{thought_signature:'late'}}}]}))));
 let seen;do {seen=(await reader.read()).value;}while(seen.type!=='tool-input-delta');assert.ok(seen.delta.length>0);
 source.enqueue(enc.encode(event(packet({tool_calls:[{index:0,function:{arguments:'"}'}}]},'tool_calls'))+'data: [DONE]\n\n'));source.close();
 let call;while(true){const next=await reader.read();if(next.done)break;if(next.value.type==='tool-call')call=next.value;}
 assert.equal(call.providerMetadata.google.thoughtSignature,'late');assert.equal(call.input,'{"content":"code"}');
});

test('GPTL relay retains exact reasoning and replays it alongside tool results',async()=>{
 const wires=[];const thought='  exact relay thought\n保留换行\n';
 const provider=await create('gptl',async(_url,init)=>{wires.push(JSON.parse(init.body));return new Response(event(packet({reasoning_content:thought}))+event(packet({tool_calls:[{index:0,id:'c',function:{name:'save',arguments:'{}'}}]},'tool_calls'))+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});});
 const rows=await drain((await provider('gpt-6-astra').doStream({prompt,tools})).stream);
 assert.equal(rows.filter(p=>p.type==='reasoning-delta').map(p=>p.delta).join(''),thought);
 const call=rows.find(p=>p.type==='tool-call');
 await drain((await provider('gpt-6-astra').doStream({prompt:[...prompt,
  {role:'assistant',content:[{type:'reasoning',text:thought},{type:'tool-call',toolCallId:call.toolCallId,toolName:'save',input:{}}]},
  {role:'tool',content:[{type:'tool-result',toolCallId:call.toolCallId,toolName:'save',output:{type:'text',value:'ok'}}]}
 ],tools,providerOptions:{custom:{promptCacheKey:'chosen',maxCompletionTokens:4000,reasoningEffort:'low'}}})).stream);
 assert.equal(wires[1].messages.find(m=>m.role==='assistant').reasoning_content,thought);
 assert.equal(wires[1].prompt_cache_key,'chosen');assert.equal(wires[1].max_completion_tokens,4000);assert.equal(wires[1].maxCompletionTokens,undefined);
});

test('JSON relay tool argument objects and numeric IDs normalize without changing semantics',async()=>{
 for(const adapter of ['gptl','agnl','geml','grol']) {
  const provider=await create(adapter,async()=>Response.json({id:'x',choices:[{message:{role:'assistant',tool_calls:[{id:42,type:'function',function:{name:'save',arguments:{content:'中文'}}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:1,completion_tokens:1}}));
  const result=await provider('fixture').doGenerate({prompt,tools});const call=result.content.find(p=>p.type==='tool-call');
  assert.equal(call.toolCallId,'42');assert.deepEqual(JSON.parse(call.input),{content:'中文'});
 }
});

test('generic Responses override also settles on the terminal event and preserves query routing', {timeout:2000},async()=>{
 const {createYanOpenAIResponsesProvider}=await import('../lib/opencode-openai-responses-provider.mjs');let cancelled=false,url;
 const provider=createYanOpenAIResponsesProvider({apiKey:'test',baseURL:'https://relay.invalid/v1/responses?route=blue',fetch:async(input)=>{
  url=String(input);return new Response(new ReadableStream({start(c){c.enqueue(enc.encode(event({type:'response.completed',response:{id:'r',created_at:1,model:'grok-4.6',status:'completed',output:[],usage:{input_tokens:100,output_tokens:0,input_tokens_details:{cached_tokens:90}}}})));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
 }});
 const rows=await drain((await provider('grok-4.6').doStream({prompt})).stream);
 assert.equal(rows.find(p=>p.type==='finish').usage.inputTokens.cacheRead,90);assert.equal(cancelled,true);
 assert.equal(new URL(url).pathname,'/v1/responses');assert.equal(new URL(url).searchParams.get('route'),'blue');
});

test('graceful tail timeout is distinguished from user cancellation in diagnostics',async()=>{
 const {observeProviderFetch}=await import('../lib/provider-telemetry.mjs');const {relayChatStream}=await import('../lib/relay-chat-stream.mjs');const records=[];
 const fetch=observeProviderFetch(async()=>new Response(new ReadableStream({start(c){c.enqueue(enc.encode(event(packet({content:'ok'},'stop'))));}}),{headers:{'content-type':'text/event-stream'}}),{adapter:'fixture',emit:r=>records.push(r)});
 const response=await fetch('https://fixture',{body:JSON.stringify({model:'m',messages:[]})});
 await relayChatStream(response,{terminalGraceMs:5}).text();
 assert.equal(records.at(-1).status,'complete-without-done');
});

test('complete tool JSON with trailing whitespace cannot execute before an authoritative finish', {timeout:5000},async()=>{
 for(const adapter of ['gptl','agnl','geml','grol']) for(const invalid of [false,true]) {
  let source;
  const provider=await create(adapter,async()=>new Response(new ReadableStream({start(c){source=c;}}),{headers:{'content-type':'text/event-stream'}}));
  const reader=(await provider('fixture').doStream({prompt,tools})).stream.getReader();
  const args=JSON.stringify({content:'a quoted " bracket } and 😀'})+'\r\n\t ';
  source.enqueue(enc.encode(event(packet({tool_calls:[{index:0,id:'c',function:{name:'save',arguments:args},extra_content:{google:{thought_signature:'sig'}}}]}))));
  source.enqueue(enc.encode(event(packet({tool_calls:[{index:0,function:{arguments:invalid?'x':'  '}}],content:'still generating'}))));
  const rows=[];
  do { rows.push((await reader.read()).value); } while(!rows.some(p=>p.type==='text-delta'));
  assert.equal(rows.some(p=>p.type==='tool-call'),false,adapter);
  source.enqueue(enc.encode(event(packet({},'tool_calls'))+'data: [DONE]\n\n'));source.close();
  if(invalid) {
   await assert.rejects(async()=>{while(true){const next=await reader.read();if(next.done)break;rows.push(next.value);}},/Incomplete or invalid/);
   assert.equal(rows.some(p=>p.type==='tool-call'),false,adapter);
  } else {
   while(true){const next=await reader.read();if(next.done)break;rows.push(next.value);}
   assert.equal(rows.filter(p=>p.type==='tool-call').length,1,adapter);
   assert.equal(rows.find(p=>p.type==='tool-call').input,args+'  ');
  }
 }
});

test('relay cumulative argument snapshots can start with a single opening brace',async()=>{
 const provider=await create('agnl',async()=>new Response([
  event(packet({tool_calls:[{index:0,id:'c',function:{name:'save',arguments:'{'}}]})),
  event(packet({tool_calls:[{index:0,function:{arguments:'{"content":"code"}'}}]},'tool_calls')),
  'data: [DONE]\n\n'].join(''),{headers:{'content-type':'text/event-stream'}}));
 const rows=await drain((await provider('fixture').doStream({prompt,tools})).stream);
 assert.equal(rows.find(p=>p.type==='tool-call').input,'{"content":"code"}');
});
