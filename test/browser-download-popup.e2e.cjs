const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'yan-download-popup-'));
(async()=>{
 const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.end('<title>Download test</title>');return;}
  if(req.url==='/stall'){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename=stall.txt','Content-Length':131072});res.write(Buffer.alloc(65536));const timer=setTimeout(()=>res.end(Buffer.alloc(65536)),5500);res.on('close',()=>clearTimeout(timer));return;}
  if(req.url==='/small'){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename=small.txt'});res.end('complete');return;}
  res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="large-file.zip"','Content-Length':104857600});
  const timer=setInterval(()=>res.write(Buffer.alloc(65536)),100);res.on('close',()=>clearInterval(timer));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 const app=await _electron.launch({executablePath:require('electron'),args:[root],cwd:root,env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:profile}});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>window.__YAN_APP_READY__);await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(async dir=>{state.config=await window.yan.setConfig({browser:{downloadDirectory:dir}});},profile);
  await page.evaluate(url=>openBrowserUrlInNewTab(url),url);
  await page.locator('.browser-annotate-btn').first().waitFor();
  await page.evaluate(()=>applyAppearance({...state.config.appearance,accent:'#8855cc'}));
  await app.evaluate(({session},url)=>session.fromPartition('persist:yan-browser').downloadURL(url+'/large'),url);
  const trigger=page.locator('.bd-trigger:visible').first();await trigger.waitFor();await trigger.click();
  await page.getByRole('button',{name:'暂停下载',exact:true}).waitFor();
  await trigger.click();assert.equal(await page.locator('.bd-panel').isVisible(),false);await trigger.click();assert.equal(await page.locator('.bd-panel').isVisible(),true);
  assert.equal(await trigger.locator('.bd-ring-value').evaluate(el=>getComputedStyle(el).stroke),'rgb(136, 85, 204)');
  assert.equal(await trigger.evaluate(el=>getComputedStyle(el).borderRadius),'50%');
  assert.ok(await trigger.locator('.bd-ring').isVisible());
  const positions=await trigger.evaluate(el=>({previous:el.previousElementSibling.className,next:el.nextElementSibling.className}));
  assert.match(positions.previous,/browser-annotate-btn/);assert.match(positions.next,/browser-settings-wrap/);
  fs.mkdirSync(path.join(root,'output/playwright/browser-downloads'),{recursive:true});
  await page.screenshot({path:path.join(root,'output/playwright/browser-downloads/active-popup.png')});
  await page.getByRole('button',{name:'暂停下载',exact:true}).click();
  const beforeResume=(await page.evaluate(()=>window.yan.browserDownloads()))[0].received;
  await page.getByRole('button',{name:'继续下载',exact:true}).click();
  let advanced=false;for(let i=0;i<60;i++){if((await page.evaluate(()=>window.yan.browserDownloads()))[0].received>beforeResume){advanced=true;break;}await new Promise(r=>setTimeout(r,100));}assert.ok(advanced,'resumed download receives more bytes');
  await page.getByRole('button',{name:'暂停下载',exact:true}).waitFor();
  const resumed=await page.evaluate(()=>window.yan.browserDownloads());assert.equal(resumed[0].status,'progressing');
  await page.getByRole('button',{name:'暂停下载',exact:true}).click();
  await page.getByRole('button',{name:'更多下载操作',exact:true}).click();
  assert.deepEqual(await page.locator('.bd-menu button').allTextContents(),['从列表中删除']);
  const items=await page.evaluate(()=>window.yan.browserDownloads());assert.equal(items[0].status,'paused');
  await page.screenshot({path:path.join(root,'output/playwright/browser-downloads/paused-popup.png')});
  await page.getByRole('button',{name:'从列表中删除',exact:true}).click();
  await trigger.waitFor({state:'hidden'});
  assert.equal((await page.evaluate(()=>window.yan.browserDownloads())).length,0);
  await app.evaluate(({session},url)=>session.fromPartition('persist:yan-browser').downloadURL(url+'/small'),url);
  await trigger.waitFor();await trigger.click();
  const open=page.locator('.bd-panel').getByRole('button',{name:'打开文件',exact:true});await open.waitFor();
  assert.equal(await open.evaluate(el=>el.nextElementSibling.getAttribute('aria-label')),'更多下载操作');
  await page.screenshot({path:path.join(root,'output/playwright/browser-downloads/completed-popup.png')});
  await app.evaluate(({session},url)=>session.fromPartition('persist:yan-browser').downloadURL(url+'/stall'),url);
  let sawStall=false,finished=false;for(let i=0;i<120;i++){const records=await page.evaluate(()=>window.yan.browserDownloads());const item=records.find(x=>x.name==='stall.txt');if(item?.stalled){sawStall=true;assert.equal(item.status,'progressing');}if(item?.status==='completed'&&item.exists){finished=true;break;}await new Promise(r=>setTimeout(r,100));}assert.ok(sawStall,'real HTTP stall remains active');assert.ok(finished,'real HTTP transfer recovers after stall');
  console.log('Download popup passed: real HTTP stall/recovery and toggle; resume, completed open icon, custom accent and progress ring; toolbar placement, actual transfer progress, pause, paused menu only removes record, removal.');
 }finally{await app.close();server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
