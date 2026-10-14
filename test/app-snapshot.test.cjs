'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {registerAppSnapshotIpc}=require('../lib/main/app-snapshot');
const { normalize: normalizeSnapshotSettings } = require('../lib/app-snapshot-settings');
function setup(captureText = async handle => `Window: ${handle}\n  0 Window fixture`) {
 const handlers=new Map(), sent=[], life=new Map(); let callbacks, stored={appSnapshot:{shortcut:'Alt+Alt',destination:'auto',sound:false}}, stopped=false;
 const image={isEmpty:()=>false,toPNG:()=>Buffer.from('png'),toDataURL:()=> 'data:image/png;base64,cG5n',resize(){return this;}};
 const sources=[{id:'window:9:0',name:'Yan Agent',thumbnail:image},{id:'window:1:0',name:'QQ',thumbnail:image,appIcon:image},{id:'window:2:0',name:'Browser',thumbnail:image}];
 const contents={mainFrame:{},send:(channel,data)=>sent.push({channel,data})};
 const win={webContents:contents,isDestroyed:()=>false,getMediaSourceId:()=> 'window:9:0',isMinimized:()=>false,show(){},focus(){}};
 registerAppSnapshotIpc({ipcMain:{handle:(k,v)=>handlers.set(k,v)},windows:{getMainWindow:()=>win},BrowserWindow:{getAllWindows:()=>[win]},app:{whenReady:()=>Promise.resolve(),once:(k,v)=>life.set(k,v)},config:{load:()=>structuredClone(stored),save:v=>{stored=v;}}},{getSources:async()=>sources},{captureText,createMonitor:cb=>{callbacks=cb;return{start(){cb.onState(true);},stop(){stopped=true;}};}});
 const event={sender:contents,senderFrame:contents.mainFrame};
 return {call:(name,...args)=>handlers.get('app-snapshot:'+name)(event,...args),handlers,event,sources,sent,cb:()=>callbacks,life,get stopped(){return stopped;}};
}
const target=(handle,name)=>({handle,name,pid:98765});

test('snapshot sound is locked to the ding tone and volume is clamped', () => {
 for (const id of ['bell','chime','drop','custom','none','old-bell',undefined]) assert.equal(normalizeSnapshotSettings({soundId:id}).soundId,'ding');
 assert.equal(normalizeSnapshotSettings({soundVolume:120}).soundVolume,100);
 assert.equal(normalizeSnapshotSettings({customSound:'abc',customSoundName:'tone.wav'}).customSoundName,'tone.wav');
});
test('capture freezes window text and text failure retains the image',async()=>{
 const c=setup(); c.cb().onTargets([target('1','QQ')]);
 assert.equal((await c.call('capture','1')).snapshot.text,'Window: 1\n  0 Window fixture');
 const failed=setup(async()=>{throw new Error('unavailable');}); failed.cb().onTargets([target('1','QQ')]);
 const result=await failed.call('capture','1');
 assert.ok(result.data); assert.equal(result.snapshot.text,''); assert.match(result.snapshot.textError,/无法读取/);
});
test('excludes every Yan window while retaining the most recent external target',async()=>{
 const c=setup(); await Promise.resolve(); c.cb().onTargets([target('9','Yan Agent'),target('1','QQ'),target('2','Browser')]);
 assert.equal((await c.call('target')).name,'QQ');
 assert.equal((await c.call('capture','1')).snapshot.name,'QQ');
 c.sources.splice(1,1); assert.equal((await c.call('capture')).snapshot.name,'Browser');
 c.cb().onTargets([]); assert.equal((await c.call('target')).available,false); assert.match((await c.call('capture')).error,/没有/);
});
test('stale menu identity cannot capture a different app',async()=>{
 const c=setup(); c.cb().onTargets([target('2','Browser')]); assert.match((await c.call('capture','1')).error,/变化/);
});
test('only selected double-modifier gesture delivers and settings persist',async()=>{
 const c=setup(); await Promise.resolve(); c.cb().onTargets([target('1','QQ')]);
 await c.cb().onGesture('Shift+Shift'); assert.equal(c.sent.filter(x=>x.channel==='app-snapshot:received').length,0);
 await c.cb().onGesture('Alt+Alt'); assert.equal(c.sent.find(x=>x.channel==='app-snapshot:received').data.snapshot.name,'QQ');
 assert.equal(c.call('update',{shortcut:'Shift+Shift',destination:'new'}).settings.shortcut,'Shift+Shift');
 assert.match(c.call('update',{shortcut:'Control+Shift+S'}).error,/请选择/);
 c.life.get('will-quit')(); assert.equal(c.stopped,true);
});
test('other windows and subframes cannot enumerate or capture',async()=>{
 const c=setup(); assert.match(c.handlers.get('app-snapshot:target')({sender:{}}).error,/无权/);
 assert.match(c.handlers.get('app-snapshot:capture')({...c.event,senderFrame:{}},'1').error,/无权/);
});
