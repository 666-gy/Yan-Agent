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
  !macro customUnInstall
    !insertmacro RunYanPathUpdate "remove"
  !macroend
!endif
