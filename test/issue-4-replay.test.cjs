'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {YanEventProjector}=require('../lib/yan-core/projector');
const {YanCoreStore}=require('../lib/yan-core/store');

test('batch replay avoids per-event snapshots and accepts an iterator',()=>{
  const p=new YanEventProjector();let clones=0;
  const snapshot=p.snapshot.bind(p);p.snapshot=()=>{clones++;return snapshot();};
  function* events(){yield {eventId:'a',sequence:1,type:'thread.created',threadId:'t',payload:{thread:{id:'t',title:'恢复'}}};yield {eventId:'a',sequence:1};yield null;}
  const results=p.applyAll(events());
  assert.equal(clones,0);assert.deepEqual(results,[{applied:true},{applied:false,reason:'duplicate'},{applied:false,reason:'invalid_event'}]);
  const one=p.apply({eventId:'b',sequence:2,type:'thread.updated',threadId:'t',payload:{title:'新标题'}});
  assert.equal(clones,1);one.state.threads.t.title='external';assert.equal(p.snapshot().threads.t.title,'新标题');
});

test('NUL snapshot and 25,000-event / 100 MB journal recover under a 96 MB V8 heap',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'yan-issue4-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const log=path.join(root,'events.jsonl'),fd=fs.openSync(log,'w');
  try {
    fs.writeSync(fd,JSON.stringify({sequence:1,eventId:'e1',type:'thread.created',threadId:'t',payload:{thread:{id:'t',title:'中文会话'}}})+'\n');
    for(let i=2;i<=25000;i++)fs.writeSync(fd,JSON.stringify({sequence:i,eventId:`e${i}`,threadId:'t',type:'item.updated',payload:{item:{id:`item-${i%947}`,threadId:'t',payload:{text:'x'.repeat(4096),value:i}}}})+'\n');
    fs.writeSync(fd,'{"sequence":25001,"type":');
  }finally{fs.closeSync(fd);}
  fs.writeFileSync(path.join(root,'state.json'),Buffer.alloc(2359346));
  const run=spawnSync(process.execPath,['--max-old-space-size=96','-e',`
    const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
    const {YanCoreStore}=require(${JSON.stringify(require.resolve('../lib/yan-core/store'))});
    const root=${JSON.stringify(root)};const store=new YanCoreStore({rootDir:root,logger:{warn(){}}});
    store.readEvents=()=>{throw Error('must not buffer journal');};
    const state=store.load();assert.equal(state.threads.t.title,'中文会话');assert.equal(Object.keys(state.items).length,947);assert.equal(state.nextEventSequence,25000);
    assert.equal(state.items['item-'+(25000%947)].payload.value,25000);
    assert.equal(fs.readdirSync(root).filter(n=>n.startsWith('state.json.corrupt-')).length,1);
    const second=new YanCoreStore({rootDir:root});second.iterateEvents=()=>{throw Error('must use repaired snapshot');};assert.equal(second.load().nextEventSequence,25000);
    console.log('recovered 25000 events, 947 items; heap limit 96 MB');
  `],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
  assert.equal(run.status,0,`${run.error||''}\n${run.stderr}\n${run.stdout}`);
});

test('oversized malformed line is discarded without losing later valid UTF-8 events',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'yan-longline-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'events.jsonl'),fd=fs.openSync(file,'w');
  try{const block=Buffer.alloc(1024*1024,120);for(let i=0;i<66;i++)fs.writeSync(fd,block);fs.writeSync(fd,'\nnull\n{broken}\n'+JSON.stringify({sequence:2,payload:'云河恢复'})+'\r\n'+JSON.stringify({sequence:3,payload:'末行'}));}finally{fs.closeSync(fd);}
  const store=new YanCoreStore({rootDir:root});assert.deepEqual(store.readEvents(),[{sequence:2,payload:'云河恢复'},{sequence:3,payload:'末行'}]);
  assert.deepEqual(store.readEvents({limit:1}),[{sequence:2,payload:'云河恢复'}]);
});
