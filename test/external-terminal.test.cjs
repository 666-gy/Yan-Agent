const assert=require('node:assert/strict');const cp=require('node:child_process');const path=require('node:path');
const {registerToolsIpc}=require('../lib/main/ipc-tools');
const original=cp.execFile; const launches=[];
cp.execFile=(exe,args,options,cb)=>{launches.push(options.env);cb(null,'12345','')};
delete require.cache[require.resolve('../lib/external-terminal')];
const handlers=new Map(); const opened=[];
const shell={openPath:async target=>{opened.push(target);return ''},showItemInFolder:()=>{}};
registerToolsIpc({ipcMain:{handle:(n,h)=>handlers.set(n,h)},shell,config:{load:()=>({general:{terminalShell:'git-bash'}})},paths:{dataDir:__dirname}});
(async()=>{try {
const a=await handlers.get('powershell:open-external')({}, {workspace:__dirname});
const b=await handlers.get('vscode:launch')({}, {workspace:__dirname,useDefault:true});
assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(launches.length,1);assert.deepEqual(opened,[__dirname]);
for(const env of launches){assert.equal(path.basename(env.YAN_TERMINAL_EXE).toLowerCase(),'powershell.exe');assert.deepEqual(JSON.parse(env.YAN_TERMINAL_ARGS),['-NoLogo','-NoProfile','-NoExit']);assert.equal(env.YAN_TERMINAL_CWD,__dirname);}
console.log('PASS: PowerShell button opens the external terminal; default file open uses the OS association');
}finally{cp.execFile=original}})().catch(e=>{console.error(e);process.exitCode=1});
