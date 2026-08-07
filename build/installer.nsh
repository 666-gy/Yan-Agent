!include "LogicLib.nsh"
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

!define YAN_PATH_SCRIPT "JABFAHIAcgBvAHIAQQBjAHQAaQBvAG4AUAByAGUAZgBlAHIAZQBuAGMAZQA9ACcAUwB0AG8AcAAnAAoAJABzAGMAbwBwAGUAPQAkAGUAbgB2ADoAWQBBAE4AXwBBAEcARQBOAFQAXwBQAEEAVABIAF8AUwBDAE8AUABFAAoAJABkAGkAcgA9AFsASQBPAC4AUABhAHQAaABdADoAOgBHAGUAdABGAHUAbABsAFAAYQB0AGgAKAAkAGUAbgB2ADoAWQBBAE4AXwBBAEcARQBOAFQAXwBQAEEAVABIAF8ARABJAFIAKQAuAFQAcgBpAG0ARQBuAGQAKAAnAFwAJwApAAoAJABhAGMAdABpAG8AbgA9ACQAZQBuAHYAOgBZAEEATgBfAEEARwBFAE4AVABfAFAAQQBUAEgAXwBBAEMAVABJAE8ATgAKACQAYwB1AHIAcgBlAG4AdAA9AFsARQBuAHYAaQByAG8AbgBtAGUAbgB0AF0AOgA6AEcAZQB0AEUAbgB2AGkAcgBvAG4AbQBlAG4AdABWAGEAcgBpAGEAYgBsAGUAKAAnAFAAYQB0AGgAJwAsACQAcwBjAG8AcABlACkACgAkAGkAdABlAG0AcwA9AEAAKAAkAGMAdQByAHIAZQBuAHQAIAAtAHMAcABsAGkAdAAgACcAOwAnACAAfAAgAFcAaABlAHIAZQAtAE8AYgBqAGUAYwB0ACAAewAgAC0AbgBvAHQAIABbAHMAdAByAGkAbgBnAF0AOgA6AEkAcwBOAHUAbABsAE8AcgBXAGgAaQB0AGUAUwBwAGEAYwBlACgAJABfACkAIAB9ACkACgAkAG0AYQB0AGMAaABlAHMAPQBAACgAJABpAHQAZQBtAHMAIAB8ACAAVwBoAGUAcgBlAC0ATwBiAGoAZQBjAHQAIAB7ACAAJABfAC4AVAByAGkAbQAoACkALgBUAHIAaQBtACgAJwAiACcAKQAuAFQAcgBpAG0ARQBuAGQAKAAnAFwAJwApACAALQBpAGUAcQAgACQAZABpAHIAIAB9ACkACgBpAGYAKAAkAGEAYwB0AGkAbwBuACAALQBlAHEAIAAnAGEAZABkACcAIAAtAGEAbgBkACAAJABtAGEAdABjAGgAZQBzAC4AQwBvAHUAbgB0ACAALQBlAHEAIAAwACkAewAKACAAIAAkAG4AZQB4AHQAPQBpAGYAKABbAHMAdAByAGkAbgBnAF0AOgA6AEkAcwBOAHUAbABsAE8AcgBXAGgAaQB0AGUAUwBwAGEAYwBlACgAJABjAHUAcgByAGUAbgB0ACkAKQB7ACQAZABpAHIAfQBlAGwAcwBlAHsAJABjAHUAcgByAGUAbgB0AC4AVAByAGkAbQBFAG4AZAAoACcAOwAnACkAKwAnADsAJwArACQAZABpAHIAfQAKACAAIABbAEUAbgB2AGkAcgBvAG4AbQBlAG4AdABdADoAOgBTAGUAdABFAG4AdgBpAHIAbwBuAG0AZQBuAHQAVgBhAHIAaQBhAGIAbABlACgAJwBQAGEAdABoACcALAAkAG4AZQB4AHQALAAkAHMAYwBvAHAAZQApAAoAfQBlAGwAcwBlAGkAZgAoACQAYQBjAHQAaQBvAG4AIAAtAGUAcQAgACcAcgBlAG0AbwB2AGUAJwAgAC0AYQBuAGQAIAAkAG0AYQB0AGMAaABlAHMALgBDAG8AdQBuAHQAIAAtAGcAdAAgADAAKQB7AAoAIAAgACQAbgBlAHgAdAA9AEAAKAAkAGkAdABlAG0AcwAgAHwAIABXAGgAZQByAGUALQBPAGIAagBlAGMAdAAgAHsAIAAkAF8ALgBUAHIAaQBtACgAKQAuAFQAcgBpAG0AKAAnACIAJwApAC4AVAByAGkAbQBFAG4AZAAoACcAXAAnACkAIAAtAGkAbgBlACAAJABkAGkAcgAgAH0AKQAgAC0AagBvAGkAbgAgACcAOwAnAAoAIAAgAFsARQBuAHYAaQByAG8AbgBtAGUAbgB0AF0AOgA6AFMAZQB0AEUAbgB2AGkAcgBvAG4AbQBlAG4AdABWAGEAcgBpAGEAYgBsAGUAKAAnAFAAYQB0AGgAJwAsACQAbgBlAHgAdAAsACQAcwBjAG8AcABlACkACgB9AA=="

!macro RunYanPathUpdateForScope ACTION SCOPE
  System::Call 'Kernel32::SetEnvironmentVariable(t "YAN_AGENT_PATH_SCOPE", t "${SCOPE}") i.r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t "YAN_AGENT_PATH_DIR", t "$INSTDIR") i.r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t "YAN_AGENT_PATH_ACTION", t "${ACTION}") i.r0'
  nsExec::ExecToLog 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${YAN_PATH_SCRIPT}'
  Pop $R9
!macroend

!macro RunYanPathUpdate ACTION
  !insertmacro RunYanPathUpdateForScope "${ACTION}" "User"
  !insertmacro RunYanPathUpdateForScope "${ACTION}" "Machine"

  System::Call 'Kernel32::SetEnvironmentVariable(t "YAN_AGENT_PATH_SCOPE", p 0) i.r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t "YAN_AGENT_PATH_DIR", p 0) i.r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t "YAN_AGENT_PATH_ACTION", p 0) i.r0'
  System::Call 'User32::SendMessageTimeout(i ${HWND_BROADCAST}, i ${WM_SETTINGCHANGE}, i 0, t "Environment", i 0x0002, i 5000, *i .r0)'
!macroend

!ifndef BUILD_UNINSTALLER
  Var YanAddToPathCheckbox
  Var YanAddToPathRequested

  !macro customInit
    StrCpy $YanAddToPathRequested "1"
    ClearErrors
    ReadRegDWORD $R8 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "AddToPath"
    ${IfNot} ${Errors}
      StrCpy $YanAddToPathRequested $R8
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    Page custom YanPathPageCreate YanPathPageLeave
  !macroend

  Function YanPathPageCreate
    !insertmacro MUI_HEADER_TEXT "环境配置" "让 IDE 和终端能够找到 Yan Agent"
    nsDialogs::Create 1018
    Pop $R8
    ${If} $R8 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 22u "选择是否将 Yan Agent 的安装目录同时加入用户与系统 PATH。"
    Pop $R8
    ${NSD_CreateCheckbox} 0 32u 100% 18u "加入 PATH（推荐）"
    Pop $YanAddToPathCheckbox
    ${If} $YanAddToPathRequested == "1"
      ${NSD_Check} $YanAddToPathCheckbox
    ${EndIf}
    ${NSD_CreateLabel} 18u 54u 94% 34u "启用后，IDE、PowerShell 和命令提示符可以直接定位并启动 Yan Agent。安装程序将请求管理员权限，新终端窗口会自动生效。"
    Pop $R8

    nsDialogs::Show
  FunctionEnd

  Function YanPathPageLeave
    ${NSD_GetState} $YanAddToPathCheckbox $R8
    ${If} $R8 == ${BST_CHECKED}
      StrCpy $YanAddToPathRequested "1"
    ${Else}
      StrCpy $YanAddToPathRequested "0"
    ${EndIf}
  FunctionEnd

  !macro customInstall
    WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "AddToPath" $YanAddToPathRequested
    ${If} $YanAddToPathRequested == "1"
      !insertmacro RunYanPathUpdate "add"
    ${Else}
      !insertmacro RunYanPathUpdate "remove"
    ${EndIf}
  !macroend
!else
  Var YanClearDataCheckbox
  Var YanClearDataRequested
  Var YanClearDataFailed

  !macro customUnInit
    StrCpy $YanClearDataRequested "0"
    StrCpy $YanClearDataFailed "0"
  !macroend

  !macro customUnWelcomePage
    UninstPage custom un.YanDataPageCreate un.YanDataPageLeave
  !macroend

  Function un.YanDataPageCreate
    !insertmacro MUI_HEADER_TEXT "卸载选项" "选择是否同时清除本机保存的 Yan Agent 数据"
    nsDialogs::Create 1018
    Pop $R8
    ${If} $R8 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 34u "普通卸载会保留配置、会话、技能和媒体缓存，方便以后重新安装后继续使用。"
    Pop $R8
    ${NSD_CreateCheckbox} 0 46u 100% 18u "清除本机所有 Yan Agent 数据"
    Pop $YanClearDataCheckbox
    ${NSD_Uncheck} $YanClearDataCheckbox
    ${NSD_CreateLabel} 18u 70u 94% 44u "勾选后将删除 Yan Agent 的本机用户数据目录、浏览器缓存、运行时缓存、技能存储和临时媒体文件。不会删除工作区、桌面文件或其他项目文件。"
    Pop $R8

    nsDialogs::Show
  FunctionEnd

  Function un.YanDataPageLeave
    ${NSD_GetState} $YanClearDataCheckbox $R8
    ${If} $R8 == ${BST_CHECKED}
      StrCpy $YanClearDataRequested "1"
    ${Else}
      StrCpy $YanClearDataRequested "0"
    ${EndIf}
  FunctionEnd

  Function un.YanStopProcesses
    nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "Yan Agent.exe"'
    Pop $R8
    nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "yan-agent.exe"'
    Pop $R8
    Sleep 500
  FunctionEnd

  Function un.YanRemoveDataPath
    Exch $R0
    ClearErrors
    RMDir /r "$R0"
    ${If} ${Errors}
      StrCpy $YanClearDataFailed "1"
      DetailPrint "无法清除：$R0"
    ${Else}
      DetailPrint "已清除：$R0"
    ${EndIf}
    Pop $R0
  FunctionEnd

  Function un.YanClearData
    Call un.YanStopProcesses

    Push "$APPDATA\yan-agent"
    Call un.YanRemoveDataPath
    Push "$APPDATA\Yan Agent"
    Call un.YanRemoveDataPath
    Push "$LOCALAPPDATA\yan-agent"
    Call un.YanRemoveDataPath
    Push "$LOCALAPPDATA\Yan Agent"
    Call un.YanRemoveDataPath
    Push "$LOCALAPPDATA\yan-agent-updater"
    Call un.YanRemoveDataPath
    Push "$TEMP\YanAgent"
    Call un.YanRemoveDataPath
    Delete "$TEMP\yan-agent-yanxi-code-workspace.json"

    ${If} $YanClearDataFailed == "1"
      MessageBox MB_OK|MB_ICONEXCLAMATION "部分 Yan Agent 数据未能删除，可能仍被其他进程占用。请关闭相关进程后手动删除残留目录。"
    ${Else}
      DetailPrint "Yan Agent 本机数据清理完成。"
    ${EndIf}
  FunctionEnd

  !macro customUnInstall
    !insertmacro RunYanPathUpdate "remove"
    ${If} $YanClearDataRequested == "1"
      Call un.YanClearData
    ${EndIf}
  !macroend
!endif
