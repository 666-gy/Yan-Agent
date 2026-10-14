'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {_electron} = require('playwright');
const root = path.resolve(__dirname,'..');
(async()=>{
  assert.equal(process.platform,'win32');
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'yan-taskbar-icon-'));
  const helper=path.join(profile,'probe.exe');
  execFileSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:exe','/platform:x64','/reference:System.Web.Extensions.dll','/reference:System.Drawing.dll','/out:'+helper,path.join(__dirname,'fixtures/window-icon-probe.cs')],{windowsHide:true});
  let app, testShortcut;
  try {
    const source=process.env.YAN_ICON_SOURCE==='1';
    const executablePath=source?require('electron'):path.resolve(process.env.YAN_BETA1_SMOKE_EXE||path.join(root,'dist/win-unpacked/Yan Agent.exe'));
    app=await _electron.launch({executablePath,args:source?[root]:[],cwd:root,env:{...process.env,YAN_E2E_MODE:'1',YAN_E2E_USER_DATA_DIR:profile}});
    const page=await app.firstWindow(); await page.waitForFunction(()=>window.__YAN_APP_READY__);
    const info=await app.evaluate(({app,BrowserWindow,nativeTheme})=>{const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('renderer/index.html'));const buf=win.getNativeWindowHandle();return {packaged:app.isPackaged,version:app.getVersion(),darkSystem:nativeTheme.shouldUseDarkColorsForSystemIntegratedUI,hwnd:(buf.length===8?buf.readBigUInt64LE().toString():buf.readUInt32LE().toString())};});
    const logoName=info.darkSystem?'logo-light':'logo-dark';
    const probe=JSON.parse(execFileSync(helper,[info.hwnd,profile,path.join(root,`renderer/assets/${logoName}.ico`)],{encoding:'utf8',windowsHide:true}));
    assert.equal(probe.appId,require('../lib/main/windows/app-identity').getWindowsAppId({isPackaged:!source,isE2EMode:true}));
    assert.equal(probe.displayName,'Yan Agent');
    assert.ok(probe.bigIcon && probe.smallIcon,'Native window must expose both icon sizes');
    const pixels = await app.evaluate(({nativeImage}, paths) => paths.map(file => Array.from(nativeImage.createFromPath(file).resize({width:48,height:48}).toBitmap())), [path.join(root,`renderer/assets/${logoName}.png`),...['big','small'].map(size=>path.join(profile,`${info.hwnd}-${size}.png`))]);
    const expected = pixels[0];
    const pixelErrors = pixels.slice(1).map(actual => {
      let error=0;
      for(let i=0;i<expected.length;i+=4){const a=expected[i+3]/255;for(let c=0;c<3;c++)error+=Math.abs(actual[i+c]-(expected[i+c]+32*(1-a)));}
      return error/(48*48*3);
    });
    for(const error of pixelErrors) assert.ok(error<20,`Native icon must visually match Yan, mean pixel error was ${error}`);
    const iconFile=probe.iconResource.replace(/,0$/,'');
    assert.equal(fs.existsSync(iconFile),true,'Shell icon must exist on disk, outside ASAR');
    assert.deepEqual(fs.readFileSync(iconFile),fs.readFileSync(path.join(root,`renderer/assets/${logoName}.ico`)));
    if(source){
      // Override only this isolated Electron instance, never the user's OS theme.
      // Emitting the real event exercises main.js's live window/tray refresh wiring.
      for(const darkSystem of [false,true]){
        await app.evaluate(({nativeTheme},dark)=>{
          Object.defineProperty(nativeTheme,'shouldUseDarkColorsForSystemIntegratedUI',{configurable:true,value:dark});
          nativeTheme.emit('updated');
        },darkSystem);
        const themedIco=path.join(root,`renderer/assets/logo-${darkSystem?'light':'dark'}.ico`);
        const refreshed=JSON.parse(execFileSync(helper,[info.hwnd,profile,themedIco],{encoding:'utf8',windowsHide:true}));
        assert.equal(refreshed.iconResource,`${themedIco},0`,'Theme updates must reach the Windows Shell identity');
        if(darkSystem!==info.darkSystem) assert.notEqual(refreshed.fingerprints.big,probe.fingerprints.big,'Opposite theme must replace the native icon');
        else assert.equal(refreshed.fingerprints.big,probe.fingerprints.big,'Switching back must restore the original native icon');
      }
    }
    if(!source){assert.match(iconFile,/app\.asar\.unpacked/);assert.equal(probe.relaunchCommand,`"${executablePath}"`);}
    let shellPixelError;
    if(!source){
      // Exercise the same shortcut -> AppUserModelID -> AppsFolder lookup used
      // by an installed application, without registering the production ID.
      testShortcut=path.join(process.env.APPDATA,'Microsoft/Windows/Start Menu/Programs',`Yan Agent Icon Test ${process.pid}.lnk`);
      assert.equal(fs.existsSync(testShortcut),false);
      const shortcut=await app.evaluate(({shell},details)=>{
        if(!shell.writeShortcutLink(details.file,'create',{target:details.exe,icon:details.exe,iconIndex:0,appUserModelId:details.appId,description:'Temporary Yan taskbar icon verification'})) throw Error('Test shortcut creation failed');
        return shell.readShortcutLink(details.file);
      },{file:testShortcut,exe:executablePath,appId:probe.appId});
      assert.equal(shortcut.appUserModelId,probe.appId);
      assert.equal(shortcut.target,executablePath);
      let shell, shellError;
      for(let attempt=0;attempt<20;attempt++){
        try {shell=JSON.parse(execFileSync(helper,[`shell:${probe.appId}`,profile],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}));break;}
        catch(error){shellError=error;await new Promise(resolve=>setTimeout(resolve,500));}
      }
      if(!shell)throw shellError;
      const reference=JSON.parse(execFileSync(helper,[`image:${path.join(root,'renderer/assets/logo-light.ico')}`,profile],{encoding:'utf8',windowsHide:true}));
      const [shellPixels,referencePixels]=await app.evaluate(({nativeImage},files)=>files.map(file=>Array.from(nativeImage.createFromPath(file).resize({width:48,height:48}).toBitmap())),[shell.shellIcon,reference.shellIcon]);
      let error=0;
      for(let i=0;i<referencePixels.length;i+=4){for(let c=0;c<3;c++)error+=Math.abs(shellPixels[i+c]-referencePixels[i+c]);}
      shellPixelError=error/(48*48*3);
      assert.ok(shellPixelError<3,`Windows AppsFolder identity must resolve to Yan, mean pixel error was ${shellPixelError}`);
    }
    console.log(JSON.stringify({ok:true,...info,...probe,pixelErrors,shellPixelError},null,2));
  } finally {if(testShortcut && fs.existsSync(testShortcut))fs.unlinkSync(testShortcut);await app?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
