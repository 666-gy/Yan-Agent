'use strict';
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const assert=require('node:assert/strict');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const source=process.env.YAN_PLAYWRIGHT_SOURCE==='1';
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'yan-playwright-connection-'));
  fs.mkdirSync(path.join(profile,'YanData'));
  fs.writeFileSync(path.join(profile,'YanData/config.json'),JSON.stringify({mcpServers:[{id:'mcp_default_playwright',name:'Playwright',command:'npx',args:['-y','@playwright/mcp@latest','--output-dir','.yanagent/playwright'],enabled:true,builtin:true}]}));
  // Chromium ships through the Playwright plugin, so the profile is seeded with
  // the runtime the plugin would have installed (same verification, no network).
  const appRoot=source?root:path.join(path.resolve(process.env.YAN_PACKAGED_APP_DIR||path.join(root,'dist/win-unpacked')),'resources/app.asar.unpacked');
  const runtime=require(path.join(appRoot,'lib/playwright-runtime'));
  await runtime.installFrom(path.resolve(process.env.YAN_PLAYWRIGHT_BROWSERS_SOURCE||path.join(root,'output/playwright-browsers')),{appRoot,dataDir:path.join(profile,'YanData')});
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='path'));
  Object.assign(env,{PATH:path.join(process.env.SystemRoot,'System32'),YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:profile,npm_config_offline:'true',npm_config_cache:path.join(profile,'empty-npm-cache')});
  let app;
  try {
    app=await _electron.launch({executablePath:source?require('electron'):path.join(path.resolve(process.env.YAN_PACKAGED_APP_DIR||path.join(root,'dist/win-unpacked')),'Yan Agent.exe'),args:source?[root]:[],cwd:path.join(process.env.SystemRoot,'System32'),env});
    const page=await app.firstWindow();await page.waitForFunction(()=>window.__YAN_APP_READY__);
    const result=await page.evaluate(async()=>{
      const config=(await window.yan.mcpList()).find(s=>s.id==='mcp_default_playwright');
      const test=await window.yan.mcpStart(config.id);
      await window.yan.mcpStop(config.id);
      return {config,ok:test.ok,error:test.error,tools:test.tools?.map(t=>t.name)};
    });
    assert.equal(result.ok,true,result.error);
    assert.equal(result.config.runtime,'playwright');
    assert.ok(path.isAbsolute(result.config.command));
    assert.ok(result.tools.includes('browser_navigate'));
    assert.ok(fs.existsSync(path.join(profile,'YanData/mcp/playwright')));
    console.log(JSON.stringify({ok:true,packaged:!source,legacyConfigMigrated:true,connectionTest:true,tools:result.tools.length,launchDirectory:'System32',systemNodeOnPath:false}));
  } finally {await app?.close();fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:500});}
})().catch(error=>{console.error(error);process.exitCode=1;});
