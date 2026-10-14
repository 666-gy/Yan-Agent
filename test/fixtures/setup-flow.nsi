Unicode true
Name "Yan Setup Flow Test"
OutFile "${YAN_TEST_DIR}\setup-flow-test.exe"
InstallDir "${YAN_TEST_DIR}\selected-folder"
RequestExecutionLevel user
!include LogicLib.nsh
!define VERSION "1.7.0-beta.1"
!define APP_64_UNPACKED_SIZE 1024
!define APP_EXECUTABLE_FILENAME "test-marker.exe"
!define PRODUCT_FILENAME "test-marker"
Var YanAddToPathRequested
!macro TestLaunch RESULT FILE VERB ARGS
  StrCpy ${RESULT} 0
  FileOpen $1 "${YAN_TEST_DIR}\launch-requested.txt" w
  FileWrite $1 "${FILE}"
  FileClose $1
!macroend
!define StdUtils.ExecShellAsUser '!insertmacro TestLaunch'
!include "${BUILD_RESOURCES_DIR}\setup-ui\setup-ui.nsh"
!insertmacro YanSetupFunctions
Page instfiles
Function .onInit
  StrCpy $YanAddToPathRequested 1
  Call YanSetupStart
FunctionEnd
Section
  IfFileExists "${YAN_TEST_DIR}\fail-next.txt" 0 +2
    Abort "Expected fixture failure"
  SetOutPath "$PLUGINSDIR\7z-out"
  File "${YAN_TEST_DIR}\fixture.bin"
  Sleep 3500
  CreateDirectory "$INSTDIR"
  FileOpen $0 "$INSTDIR\installed-test.txt" w
  FileWrite $0 "PATH=$YanAddToPathRequested"
  FileClose $0
  WriteINIStr "$YanUiFile" "Setup" "Phase" "configuring"
  Sleep 1500
SectionEnd
