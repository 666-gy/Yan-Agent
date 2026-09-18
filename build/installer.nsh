!include "LogicLib.nsh"
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

; Apply to both the installer and generated uninstaller, including nsDialogs.
!macro customHeader
  SetFont "Microsoft YaHei UI" 9
!macroend

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
    ${NSD_CreateCheckbox} 0 46u 100% 18u "清除当前 Windows 用户的 Yan Agent 数据"
    Pop $YanClearDataCheckbox
    ${If} $YanClearDataRequested == "1"
      ${NSD_Check} $YanClearDataCheckbox
    ${Else}
      ${NSD_Uncheck} $YanClearDataCheckbox
    ${EndIf}
    ${NSD_CreateLabel} 18u 70u 94% 56u "勾选后删除当前 Windows 用户的配置、会话、浏览器缓存、运行时、技能存储和临时媒体。保留工作区及其他用户的数据；若使用另一管理员账号运行，请在原账号下卸载。"
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
    Push $R1
    Push $R2
    System::Call 'Kernel32::GetFileAttributes(t "$R0") i.R1'
    ${If} $R1 == -1
      DetailPrint "目录不存在，跳过：$R0"
      Goto yan_remove_done
    ${EndIf}
    StrCpy $R2 0
    yan_remove_retry:
      ClearErrors
      RMDir /r "$R0"
      System::Call 'Kernel32::GetFileAttributes(t "$R0") i.R1'
      ${If} $R1 == -1
        DetailPrint "已清除：$R0"
        Goto yan_remove_done
      ${EndIf}
      IntOp $R2 $R2 + 1
      ${If} $R2 < 3
        Sleep 500
        Goto yan_remove_retry
      ${EndIf}
      StrCpy $YanClearDataFailed "1"
      DetailPrint "清理失败，仍有残留：$R0"
    yan_remove_done:
    Pop $R2
    Pop $R1
    Pop $R0
  FunctionEnd

  Function un.YanClearData
    Call un.YanStopProcesses

    ; Electron data is per-user even when the application is installed for
    ; all users. In 'all' context APPDATA resolves to ProgramData instead.
    SetShellVarContext current
    StrCpy $YanClearDataFailed "0"

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
    Push "$TEMP\yan-agent-update"
    Call un.YanRemoveDataPath
    Push "$TEMP\yan-dsh-code-review"
    Call un.YanRemoveDataPath
    Delete "$TEMP\yan-agent-yanxi-code-workspace.json"

    ${If} $YanClearDataFailed == "1"
      SetErrorLevel 1
      MessageBox MB_OK|MB_ICONEXCLAMATION "部分 Yan Agent 数据未能删除，可能仍被其他进程占用。请在卸载详情中查看残留路径。" /SD IDOK
    ${Else}
      DetailPrint "Yan Agent 本机数据清理完成。"
    ${EndIf}
  FunctionEnd

  !macro customUnInstall
    !insertmacro RunYanPathUpdate "remove"
    ${If} $YanClearDataRequested == "1"
      Call un.YanClearData
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  !macroend
!endif
