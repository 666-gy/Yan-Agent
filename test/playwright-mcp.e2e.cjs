'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const root = path.resolve(__dirname, '..');
const source = process.env.YAN_PLAYWRIGHT_SOURCE === '1';
const packaged = path.resolve(process.env.YAN_PACKAGED_APP_DIR || path.join(root, 'dist/win-unpacked'));
const appRoot = source ? root : path.join(packaged, 'resources/app.asar.unpacked');
const runtimeModule = require(path.join(appRoot, 'lib/playwright-runtime'));

// Chromium is not packaged; the plugin installs it into user data. The build
// keeps the pinned tree it inventoried, and installing from it replays the same
// hash verification and swap as a CDN download, just without the network.
const browserSource = path.resolve(process.env.YAN_PLAYWRIGHT_BROWSERS_SOURCE || path.join(root, 'output/playwright-browsers'));

(async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-playwright-offline-'));
  const dataDir = path.join(workspace, 'YanData');
  const before = runtimeModule.resolveRuntime(appRoot, dataDir);
  assert.equal(before.ok, false, 'A fresh data directory must not resolve a Playwright runtime');
  await runtimeModule.installFrom(browserSource, { appRoot, dataDir });
  assert.equal(runtimeModule.isInstalled(dataDir), true);
  const resolved = runtimeModule.resolveServer(runtimeModule.createPlaywrightServer(), appRoot, dataDir);
  assert.equal(resolved.ok, true, resolved.error);
  assert.ok(path.isAbsolute(resolved.server.command));
  // Electron in node mode when run from Yan; plain node when this script runs.
  assert.equal(resolved.server.command, process.execPath);
  assert.ok(resolved.server.args[2].startsWith(runtimeModule.browsersDir(dataDir) + path.sep), 'Chromium must come from the plugin download');
  if (!source) {
    const resourcesPrefix = path.join(packaged, 'resources') + path.sep;
    assert.ok(resolved.server.args[0].startsWith(resourcesPrefix), 'MCP must come from the packaged resources');
    assert.equal(fs.existsSync(path.join(packaged, 'resources/playwright-runtime/browsers')), false, 'Chromium must not be packaged');
  }
  const server = http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><title>Yan bundled Playwright verified</title><h1>Offline browser runtime works</h1><button onclick="this.textContent=\'Clicked\'">Test button</button>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  // No system Node/npm/npx or global Playwright browser cache on PATH. Only
  // a loopback fixture is visited; browser/server executables must be bundled.
  const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,
    PATH:path.join(process.env.SystemRoot,'System32'),TEMP:workspace,TMP:workspace,
    USERPROFILE:workspace,HOME:workspace,LOCALAPPDATA:workspace,APPDATA:workspace,
    npm_config_cache:path.join(workspace,'empty-npm-cache'),npm_config_offline:'true',
    ...resolved.server.env};
  const transport=new StdioClientTransport({command:resolved.server.command,args:[...resolved.server.args,'--headless'],cwd:workspace,env,stderr:'pipe'});
  const client=new Client({name:'Yan packaged Playwright check',version:'1.7.0-beta.1'});
  let diagnostics='';
  try {
    transport.stderr?.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-8192);});
    await client.connect(transport,{timeout:30000});
    const tools=(await client.listTools()).tools;
    assert.ok(tools.some(tool=>tool.name==='browser_navigate'));
    const call=async(name,args)=>{const result=await client.callTool({name,arguments:args},undefined,{timeout:60000});assert.notEqual(result.isError,true,JSON.stringify(result));return result;};
    const result=await call('browser_navigate',{url:`http://127.0.0.1:${server.address().port}/`});
    assert.match(JSON.stringify(result),/Yan bundled Playwright verified/);
    const title=await call('browser_evaluate',{function:'() => document.title'});
    assert.match(JSON.stringify(title),/Yan bundled Playwright verified/);
    await call('browser_take_screenshot',{});
    const screenshotDir=path.join(workspace,'.yanagent/playwright');
    assert.ok(fs.readdirSync(screenshotDir).some(name=>name.endsWith('.png')),'Screenshot must be saved in the isolated output directory');
    await call('browser_close',{});
    console.log(JSON.stringify({ok:true,packaged:!source,mcpVersion:runtimeModule.MCP_VERSION,tools:tools.length,
      handshake:true,navigation:true,evaluation:true,screenshot:true,systemNodeRequired:false,globalBrowserCacheRequired:false,workspace}));
  } catch(error){if(diagnostics)console.error(diagnostics);throw error;}
  finally {
    await client.close();await transport.close();await new Promise(resolve=>server.close(resolve));
    // The installed browser is a 440 MB copy; the workspace with its screenshot stays for inspection.
    await runtimeModule.remove(dataDir);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
