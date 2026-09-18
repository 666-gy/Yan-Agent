const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
test('create uses noninteractive gh, exact body file, fixed head and cleans temporary files; view preserves body',async()=>{
 const calls=[];let bodyFile;
 const spawn=(exe,args,options)=>{
  calls.push({args,options});const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>{};
  process.nextTick(()=>{
   let out='';
   if(args[0]==='repo')out=JSON.stringify({nameWithOwner:'o/r'});
   else if(args[1]==='create'){
    bodyFile=args[args.indexOf('--body-file')+1];
    assert.equal(fs.readFileSync(bodyFile,'utf8'),'line 1\n`literal` $value\n第二行');
    assert.equal(args[args.indexOf('--head')+1],'feature');out='https://enterprise.test/o/r/pull/7';
   }else out=JSON.stringify({number:7,title:'T',body:'full body'});
   c.stdout.emit('data',out);c.emit('close',0);
  });return c;
 };
 const fakeChild={spawn,execFile:(exe,args,options,cb)=>cb(null,'feature\n','')};
 const module={exports:{}};
 const ctx={module,exports:module.exports,process,Buffer,setTimeout,clearTimeout,require:id=>['child_process','node:child_process'].includes(id)?fakeChild:id==='node:util'?{promisify:fn=>(...args)=>new Promise((resolve,reject)=>fn(...args,(e,stdout,stderr)=>e?reject(e):resolve({stdout,stderr})))}:require(id)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/gh-service.js'),'utf8'),ctx);
 const service=module.exports;
 const result=await service.prCreate({cwd:os.tmpdir(),title:'T',body:'line 1\n`literal` $value\n第二行'});
 assert.equal(result.created,true);assert.equal(result.url,'https://enterprise.test/o/r/pull/7');assert.equal(fs.existsSync(bodyFile),false);
 assert.equal(calls[1].options.env.GH_PROMPT_DISABLED,'1');assert.equal(calls[1].options.stdio[0],'ignore');
 const view=await service.prView({cwd:os.tmpdir(),number:7});assert.equal(view.body,'full body');
 await assert.rejects(()=>service.prList({}),/工作区/);
});
