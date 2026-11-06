'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createMcpRuntimeConfig}=require('../lib/main/mcp-runtime-config');
const {skillAvailability}=require('../lib/skill-availability');
const root=require('node:path').resolve(__dirname,'..');
test('Serena and Office are installable plugins; legacy MCP entries are absent',()=>{
 const {createPluginStore}=require('../lib/plugins/store');
 const {createPluginCatalog}=require('../lib/plugins/catalog');
 const fs=require('node:fs'), os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yan-plugin-move-'));
 try {
 const store=createPluginStore(dir);const catalog=createPluginCatalog(store);
 const items=catalog.list();assert.equal(items[items.findIndex(s=>s.id==='yan-computer-use')+1].id,'office');
 assert.equal(items.find(s=>s.id==='serena').category,'developer-tools');
 assert.equal(store.get('office'),null);catalog.install('office');catalog.install('serena');
 assert.equal(store.manifest(store.get('office')).skills[0].name,'Office');
 assert.equal(store.manifest(store.get('serena')).mcpServers[0].id,'serena');
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
 const builders=Object.fromEntries(['Media','Skills','Browser','Web','Session','Harness','Analysis','Workspace','Mcp','Plugin'].map(name=>['buildYan'+name+'McpServer',()=>null]));builders.buildYanMcpServer=()=>null;
 const runtime=createMcpRuntimeConfig({dataDir:root,appRoot:root,providerConfig:{getChildReadableAppRoot:()=>root},mcpServerBuilders:builders});
 assert.ok(!runtime.getOpenCodeMcpServers({mcpServers:[{id:'mcp_default_serena',runtime:'serena',enabled:true}]},{workspace:root}).some(s=>s?.id==='mcp_default_serena'||s?.id==='yan_media'));
});
test('legacy disabled preference cannot turn off prompt enhancement',()=>{
 assert.equal(skillAvailability({disabledSkills:['yan-prompt-optimizer']},[{id:'yan-prompt-optimizer'}])('yan-prompt-optimizer'),true);
});

test('Office activation resolves its packaged runner and revokes reads when disabled', async t => {
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yan-office-plugin-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=require('../lib/plugins/store').createPluginStore(dir);
 require('../lib/plugins/catalog').createPluginCatalog(store).install('office');store.update('office',{enabled:true});
 const {createPluginTools}=await import('../lib/plugins/kernel-tools.mjs');
 const client={session:{get:async()=>({data:{permission:[{permission:'*',pattern:'*',action:'allow'}]}}),update:async()=>({data:{}})}};
 const runtime=createPluginTools({client,directory:dir,dataDir:dir});const context={sessionID:'office-test'};
 await runtime.tools.plugins_activate.execute({id:'office'},context);
 const loaded=JSON.parse(await runtime.tools.plugins_read_resource.execute({id:'office',resource:'skill:office'},context));
 assert.ok(loaded.text.includes(store.packageRoot(store.get('office'))));assert.doesNotMatch(loaded.text,/\$\{pluginRoot\}/);
 assert.ok(fs.existsSync(path.join(store.packageRoot(store.get('office')),'scripts/officecli-runner.js')));
 store.update('office',{enabled:false});
 await assert.rejects(runtime.tools.plugins_read_resource.execute({id:'office',resource:'skill:office'},context));
});

test('Serena gateway binds the workspace and strips unrelated process secrets',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yan-serena-plugin-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=require('../lib/plugins/store').createPluginStore(dir);require('../lib/plugins/catalog').createPluginCatalog(store).install('serena');
 const record=store.get('serena');const server=store.manifest(record).mcpServers[0];
 const {resolvedConfig}=require('../lib/plugins/gateway');
 process.env.YAN_PLUGIN_TEST_SECRET='must-not-leak';
 try {const config=resolvedConfig(store,{...record,directory:dir},server,process.execPath);
 assert.ok(config.args.includes(dir));assert.equal(config.env.YAN_PLUGIN_TEST_SECRET,undefined);assert.ok(config.env.SERENA_HOME.startsWith(dir));}
 finally {delete process.env.YAN_PLUGIN_TEST_SECRET;}
});
