!ifndef YAN_SETUP_UI_INCLUDED
!define YAN_SETUP_UI_INCLUDED
!include LogicLib.nsh

Var YanUiFile
Var YanUiProcess
Var YanUiRequest
Var YanUiPid
Var YanUiTries

; The native frontend owns only presentation. NSIS continues to own elevation,
; upgrade/uninstall, payload extraction, registry, shortcuts and PATH changes.
; Expand after electron-builder registers its plugin search directories.
!macro YanSetupFunctions
Function YanSetupStart
  ${If} ${Silent}
    Return
  ${EndIf}
  InitPluginsDir
  File /oname=$PLUGINSDIR\YanSetupUI.exe "${BUILD_RESOURCES_DIR}\setup-ui\YanSetupUI.exe"
  StrCpy $YanUiFile "$PLUGINSDIR\yan-setup.ini"
  FileOpen $0 "$YanUiFile" w
  FileWriteWord $0 0xFEFF
  FileClose $0
  WriteINIStr "$YanUiFile" "Setup" "InstallDir" "$INSTDIR"
  WriteINIStr "$YanUiFile" "Setup" "Version" "${VERSION}"
  WriteINIStr "$YanUiFile" "Setup" "AddToPath" "$YanAddToPathRequested"
  WriteINIStr "$YanUiFile" "Setup" "UnpackedKB" "${APP_64_UNPACKED_SIZE}"
  System::Call 'kernel32::GetCurrentProcessId() i.r0'
  WriteINIStr "$YanUiFile" "Setup" "ParentPid" "$0"
  Exec '"$PLUGINSDIR\YanSetupUI.exe" "$YanUiFile"'
  IfErrors yan_ui_launch_failed
  StrCpy $YanUiTries 0
  yan_ui_wait_ready:
    ReadINIStr $YanUiRequest "$YanUiFile" "Setup" "Request"
    ${If} $YanUiRequest == "cancel"
      SetErrorLevel 1
      Quit
    ${EndIf}
    ReadINIStr $0 "$YanUiFile" "Setup" "Ready"
    ${If} $0 == "1"
      Goto yan_ui_ready
    ${EndIf}
    IntOp $YanUiTries $YanUiTries + 1
    ${If} $YanUiTries > 300
      Goto yan_ui_launch_failed
    ${EndIf}
    Sleep 100
    Goto yan_ui_wait_ready
  yan_ui_ready:
    ReadINIStr $YanUiPid "$YanUiFile" "Setup" "Pid"
    System::Call 'kernel32::OpenProcess(i 0x100000, i 0, i $YanUiPid) p.r0'
    StrCpy $YanUiProcess $0
    ${If} $YanUiProcess == 0
      Goto yan_ui_launch_failed
    ${EndIf}
  yan_ui_wait_choice:
    ReadINIStr $YanUiRequest "$YanUiFile" "Setup" "Request"
    ${If} $YanUiRequest == "install"
      ReadINIStr $INSTDIR "$YanUiFile" "Setup" "InstallDir"
      ReadINIStr $YanAddToPathRequested "$YanUiFile" "Setup" "AddToPath"
      WriteINIStr "$YanUiFile" "Setup" "Phase" "preparing"
      SetSilent silent
      Return
    ${EndIf}
    ${If} $YanUiRequest == "cancel"
      System::Call 'kernel32::CloseHandle(p $YanUiProcess)'
      SetErrorLevel 1
      Quit
    ${EndIf}
    System::Call 'kernel32::WaitForSingleObject(p $YanUiProcess, i 0) i.r0'
    ${If} $0 != 258
      System::Call 'kernel32::CloseHandle(p $YanUiProcess)'
      SetErrorLevel 1
      Quit
    ${EndIf}
    Sleep 100
    Goto yan_ui_wait_choice
  yan_ui_launch_failed:
    MessageBox MB_OK|MB_ICONEXCLAMATION "Yan Agent 安装界面无法启动。请确认系统中的 .NET Framework 4.8 可用，然后重新运行安装程序。"
    SetErrorLevel 1
    Quit
FunctionEnd

Function YanSetupWaitForClose
  ${If} $YanUiFile == ""
    Return
  ${EndIf}
  yan_ui_wait_close:
    System::Call 'kernel32::WaitForSingleObject(p $YanUiProcess, i 100) i.r0'
    ${If} $0 == 258
      Goto yan_ui_wait_close
    ${EndIf}
  System::Call 'kernel32::CloseHandle(p $YanUiProcess)'
  StrCpy $YanUiProcess 0
FunctionEnd

Function .onInstSuccess
  ${If} $YanUiFile != ""
    WriteINIStr "$YanUiFile" "Setup" "Phase" "complete"
    Call YanSetupWaitForClose
    ReadINIStr $0 "$YanUiFile" "Setup" "Launch"
    ${If} $0 == "1"
      ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${PRODUCT_FILENAME}.exe" "open" ""
    ${EndIf}
  ${EndIf}
FunctionEnd

Function .onInstFailed
  ${If} $YanUiFile != ""
    WriteINIStr "$YanUiFile" "Setup" "Phase" "failed"
    Call YanSetupWaitForClose
  ${EndIf}
FunctionEnd
!macroend
!endif
