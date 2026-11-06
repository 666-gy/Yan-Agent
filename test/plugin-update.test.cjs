'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPluginStore}=require('../lib/plugins/store');
const {createPluginCatalog}=require('../lib/plugins/catalog');
const {inventory}=require('../lib/plugins/manifest');
test('catalog update preserves settings, reports progress, is idempotent, and hot activation uses new revision',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yan-plugin-upgrade-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=path.join(dir,'old');fs.cpSync(path.resolve(__dirname,'../lib/plugins/catalog/serena'),source,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(source,'yan-plugin.json')));manifest.version='1.0.0';fs.writeFileSync(path.join(source,'yan-plugin.json'),JSON.stringify(manifest));
 const store=createPluginStore(dir);store.install(source,inventory(source).digest);store.update('serena',{enabled:true});
 const sessions=require('../lib/plugins/sessions').createPluginSessions(dir,dir,'session');
 const before=sessions.activate('serena');const events=[];const updater=require('../lib/plugins/official-updates').makeUpdater({store,fetcher:async()=>({ok:true,json:async()=>({info:{version:'2.1.0'}})}),run:async()=>({stdout:''}),onProgress:e=>events.push(e)});const catalog=createPluginCatalog(store,{onProgress:e=>events.push(e),officialUpdater:updater});
 const result=await catalog.updateInstalled('serena');assert.equal(result.updated,true);assert.equal(result.plugin.version,'2.1.0');assert.equal(result.plugin.enabled,true);
 assert.deepEqual(events.map(e=>e.percent),[0,80,90,100]);const after=sessions.activate('serena');assert.notEqual(after.digest,before.digest);assert.notEqual(after.token,before.token);
 const again=await catalog.updateInstalled('serena');assert.equal(again.updated,false);
});
test('missing update source fails without changing installed package',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yan-plugin-upgrade-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=path.join(dir,'custom');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'yan-plugin.json'),JSON.stringify({schemaVersion:1,id:'custom-test',name:'Custom',version:'1.0.0',description:'test',skills:[],resources:[],mcpServers:[]}));
 const store=createPluginStore(dir);store.install(source,inventory(source).digest);const before=store.get('custom-test');
 await assert.rejects(createPluginCatalog(store).updateInstalled('custom-test'),/更新来源/);assert.deepEqual(store.get('custom-test'),before);
});

test('official network failure never falls back to the bundled version',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yan-official-failure-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=createPluginStore(dir);const catalog=createPluginCatalog(store,{fetcher:async()=>({ok:false,status:503})});catalog.install('serena');const before=store.get('serena');
 await assert.rejects(catalog.updateInstalled('serena'),/官方版本检查失败/);assert.deepEqual(store.get('serena'),before);
});
test('failed official runtime preparation preserves installed version and settings',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yan-official-prepare-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=createPluginStore(dir);createPluginCatalog(store).install('serena');store.update('serena',{enabled:true});const before=store.get('serena');
 const updater=require('../lib/plugins/official-updates').makeUpdater({store,fetcher:async()=>({ok:true,json:async()=>({info:{version:'9.0.0'}})}),run:async()=>{throw Error('runtime download failed');}});
 await assert.rejects(createPluginCatalog(store,{officialUpdater:updater}).updateInstalled('serena'),/runtime download failed/);assert.deepEqual(store.get('serena'),before);
});
test('custom market update refreshes the original source before comparing',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yan-market-update-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=path.join(dir,'source');fs.mkdirSync(source);const manifest={schemaVersion:1,id:'custom-refresh',name:'Custom',version:'1.0.0',description:'test',skills:[],resources:[],mcpServers:[]};
 fs.writeFileSync(path.join(source,'yan-plugin.json'),JSON.stringify(manifest));const store=createPluginStore(path.join(dir,'data'));const catalog=createPluginCatalog(store);
 await catalog.addMarketplace({source});await catalog.install(manifest.id);manifest.version='2.0.0';fs.writeFileSync(path.join(source,'yan-plugin.json'),JSON.stringify(manifest));
 const updated=await catalog.updateInstalled(manifest.id);assert.equal(updated.plugin.version,'2.0.0');assert.equal(updated.updated,true);assert.equal((await catalog.updateInstalled(manifest.id)).updated,false);
});
test('official release asset hash failure cannot replace the installed Office plugin',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yan-office-hash-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=createPluginStore(dir);createPluginCatalog(store).install('office');const before=store.get('office');const assetName=require('../lib/officecli-runtime').assetName();
 const fetcher=async url=>url.includes('/releases/latest')?{ok:true,json:async()=>({tag_name:'v9.0.0',assets:[{name:assetName,size:3,digest:'sha256:'+'0'.repeat(64),browser_download_url:'https://github.com/iOfficeAI/OfficeCLI/releases/download/v9.0.0/'+assetName}]})}:{ok:true,body:(async function*(){yield Buffer.from('bad');})()};
 await assert.rejects(createPluginCatalog(store,{fetcher}).updateInstalled('office'),/摘要校验失败/);assert.deepEqual(store.get('office'),before);
});
