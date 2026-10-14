const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {_electron}=require('playwright');const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'yan-autofill-'));
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<form onsubmit="event.preventDefault();document.body.dataset.submitted=\"yes\""><input autocomplete="username" name="username"><input type="password" autocomplete="current-password" name="password"><button type="submit">登录</button></form><script>document.querySelector("form").onsubmit=e=>{e.preventDefault();document.body.dataset.submitted="yes"}</script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 const app=await _electron.launch({executablePath:require('electron'),args:[root],cwd:root,env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:profile}});
 try{
 const page=await app.firstWindow();await page.waitForFunction(()=>window.__YAN_APP_READY__);
 await app.evaluate(({dialog})=>{global.passwordPrompts=[];global.passwordResponse=1;dialog.showMessageBox=async(_win,opts)=>{global.passwordPrompts.push(opts.title);return {response:global.passwordResponse}};});
 await page.evaluate(async url=>{await window.yan.browserPasswordSave({url,username:'alice',password:'correct-secret'});openBrowserUrlInNewTab(url+'/login');},url);
 const guestEval=async code=>app.evaluate(({webContents},code)=>{const guest=webContents.getAllWebContents().find(w=>w.getType()==='webview'&&w.getURL().includes('/login'));if(!guest)return null;return guest.executeJavaScript(code);},code);
 const until=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw new Error('wait timed out')};
 await until(async()=>await guestEval('document.querySelector("input[type=password]")?.value')==='correct-secret');
 await until(async()=>await guestEval('document.body.dataset.submitted')==='yes');assert.equal((await app.evaluate(()=>global.passwordPrompts)).length,0);
 await page.evaluate(async()=>{await window.yan.setConfig({browserPasswords:{autoLogin:false}})});
 await guestEval('location.reload()');await until(async()=>(await app.evaluate(()=>global.passwordPrompts)).length===1);
 await until(async()=>await guestEval('document.querySelector("input[type=password]")?.value')==='correct-secret');assert.notEqual(await guestEval('document.body.dataset.submitted'),'yes');
 await guestEval('document.querySelector("input[type=password]").value="new-secret";document.querySelector("form").requestSubmit()');
 await until(async()=>(await app.evaluate(()=>global.passwordPrompts)).includes('更新密码？'));
 const items=await page.evaluate(()=>window.yan.browserPasswordList());assert.equal((await page.evaluate(id=>window.yan.browserPasswordGet(id),items[0].id)).password,'new-secret');
 await page.evaluate(()=>window.yan.setConfig({browserPasswords:{offerSave:false}}));const count=(await app.evaluate(()=>global.passwordPrompts)).length;
 await guestEval('document.querySelector("input[type=password]").value="should-not-save";document.querySelector("form").requestSubmit()');await new Promise(r=>setTimeout(r,300));assert.equal((await app.evaluate(()=>global.passwordPrompts)).length,count);
 await app.evaluate(()=>{global.passwordResponse=0});await guestEval('location.reload()');await until(async()=>(await app.evaluate(()=>global.passwordPrompts)).length>count);assert.equal(await guestEval('document.querySelector("input[type=password]").value'),'');
 await guestEval('document.querySelector("form").action="https://other.example/login"');
 const prior=(await app.evaluate(()=>global.passwordPrompts)).length;
 await guestEval('document.querySelector("input[type=password]").value="cross-origin-secret";document.querySelector("form").requestSubmit()');await new Promise(r=>setTimeout(r,300));assert.equal((await app.evaluate(()=>global.passwordPrompts)).length,prior);
 const capabilities=await guestEval(`(async()=>JSON.stringify({capabilities:typeof PublicKeyCredential.getClientCapabilities === 'function' ? await PublicKeyCredential.getClientCapabilities() : null,conditionalMediation:await PublicKeyCredential.isConditionalMediationAvailable(),platformAuthenticator:await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()}))()`);console.log('WebAuthn API:',capabilities);
 console.log('Actual webview password fill, automatic login, confirmation mode, update save, disabled saving and denied fill passed.');
 }finally{await app.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
