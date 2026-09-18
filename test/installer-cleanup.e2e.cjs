'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'yan-uninstaller-test-'));
const nsis=path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis/nsis-3.0.4.1/makensis.exe');
const source=fs.readFileSync(path.join(__dirname,'../build/installer.nsh'),'utf8');
const clear=source.match(/  Function un\.YanClearData\r?\n[\s\S]*?  FunctionEnd/)[0];
assert.ok(clear.indexOf('SetShellVarContext current') < clear.indexOf('Push "$APPDATA'));
assert.match(source,/Call un\.YanClearData\s+\$\{If\} \$installMode == "all"\s+SetShellVarContext all/);
assert.match(source,/SetFont "Microsoft YaHei UI" 9/);
// Never run the real uninstaller: all filesystem targets are redirected to this
// isolated fixture; process killing and PATH modifications are not invoked.
const isolated=source.replaceAll('$APPDATA',root+'\\roaming').replaceAll('$LOCALAPPDATA',root+'\\local').replaceAll('$TEMP',root+'\\temp').replace('Call un.YanStopProcesses','DetailPrint "Test: no process termination"').replaceAll('!insertmacro RunYanPathUpdate "remove"','DetailPrint "Test: no PATH modification"');
const include=path.join(root,'fixture.nsh');fs.writeFileSync(include,isolated);
const q=s=>s.replaceAll('$','$$');
const script=`Unicode true
Name "Yan uninstall regression fixture"
OutFile "${q(root)}\\fixture.exe"
RequestExecutionLevel user
SilentInstall silent
!define BUILD_UNINSTALLER
Var installMode
!include "${q(include)}"
!insertmacro customHeader
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Function un.onInit
 !insertmacro customUnInit
 StrCpy $installMode "all"
 SetShellVarContext all
FunctionEnd
Section
 WriteUninstaller "${q(root)}\\uninstall.exe"
SectionEnd
Section "Uninstall"
 StrCpy $YanClearDataRequested "1"
 IfFileExists "${q(root)}\\preserve-test" 0 +2
 StrCpy $YanClearDataRequested "0"
 IfFileExists "${q(root)}\\lock-test" 0 +2
 System::Call 'Kernel32::CreateFileW(w "${q(root)}\\roaming\\yan-agent\\locked.txt", i 0x80000000, i 0, p 0, i 3, i 0, p 0) p.r9'
 !insertmacro customUnInstall
 IfFileExists "${q(root)}\\lock-test" 0 +2
 System::Call 'Kernel32::CloseHandle(p r9)'
SectionEnd
`;
fs.writeFileSync(path.join(root,'fixture.nsi'),script);
function run(exe,args){const r=spawnSync(exe,args,{encoding:'utf8',windowsHide:true,timeout:30000});if(r.error)throw r.error;return r;}
try {
 const compile=run(nsis,['/V2',path.join(root,'fixture.nsi')]);assert.equal(compile.status,0,compile.stdout+compile.stderr);
 assert.equal(run(path.join(root,'fixture.exe'),['/S']).status,0);
 const targets=['roaming/yan-agent','roaming/Yan Agent','local/yan-agent','local/Yan Agent','local/yan-agent-updater','temp/YanAgent','temp/yan-agent-update','temp/yan-dsh-code-review'];
 for(const rel of [...targets,'workspace/project','roaming/OtherApp']){fs.mkdirSync(path.join(root,rel),{recursive:true});fs.writeFileSync(path.join(root,rel,'keep-or-delete.txt'),'fixture');}
 const result=run(path.join(root,'uninstall.exe'),['/S',`_?=${root}`]);assert.equal(result.status,0,JSON.stringify({files:fs.readdirSync(root,{recursive:true}),status:result.status}));
 for(const rel of targets)assert.equal(fs.existsSync(path.join(root,rel)),false,rel+' must be removed');
 assert.ok(fs.existsSync(path.join(root,'workspace/project/keep-or-delete.txt')));
 assert.ok(fs.existsSync(path.join(root,'roaming/OtherApp/keep-or-delete.txt')));
 assert.equal(run(path.join(root,'uninstall.exe'),['/S',`_?=${root}`]).status,0,'missing paths should not fail');
 const retained=path.join(root,'roaming/yan-agent');fs.mkdirSync(retained,{recursive:true});fs.writeFileSync(path.join(retained,'locked.txt'),'fixture');
 fs.writeFileSync(path.join(root,'preserve-test'),'');
 assert.equal(run(path.join(root,'uninstall.exe'),['/S',`_?=${root}`]).status,0);
 assert.ok(fs.existsSync(path.join(retained,'locked.txt')),'unchecked must preserve data');
 fs.unlinkSync(path.join(root,'preserve-test'));fs.writeFileSync(path.join(root,'lock-test'),'');
 assert.equal(run(path.join(root,'uninstall.exe'),['/S',`_?=${root}`]).status,1,'locked file must report failure');
 assert.ok(fs.existsSync(path.join(retained,'locked.txt')));
 console.log('NSIS compile + cleanup passed: 8 paths, unrelated data preserved, unchecked retained, missing skipped, locked file reported failure.');
} finally {
 const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('yan-uninstaller-test-'));
 fs.rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
