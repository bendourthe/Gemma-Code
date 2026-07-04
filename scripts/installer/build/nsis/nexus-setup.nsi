; ============================================================================
; NexusSetup.exe -- NSIS outer shell around the PyQt wizard (v1.8.0 Phase 6)
; ============================================================================
;
; The wizard (`nexus-installer.exe`, PyInstaller onefile) provisions
; everything at install time -- GPU runtime, Node, Ollama, ffmpeg, diffusion
; venv, models, VS Code extension, and the Nexus desktop app fetched from the
; pinned GitHub release (operator decision, 2026-07-03). The NSIS outer is
; therefore a SLIM shell; its only responsibilities are:
;
;   - Extract the wizard to a stable per-user location ($LOCALAPPDATA\Nexus\Setup)
;   - Launch the wizard after install (interactive runs; the Finish page
;     checkbox) so "download one file, double-click, answer questions" holds
;   - Start Menu shortcut so the wizard can be re-run later
;   - HKCU uninstall entry + uninstaller (with a ~\.nexus data-preservation
;     prompt; silent uninstalls always preserve data)
;   - Silent mode (/S [/D=dir]) for the CI packaging smoke: extract-only,
;     no wizard launch (the full provisioning flow is exercised by the
;     headless smoke scripts and the T602/T604 VM rehearsals)
;
; The v1.0.0-era payload tree (CUDA/Python/wheels/Ollama/ffmpeg baked into
; the exe, ~6 GB) is NOT embedded by default -- every engine provisioner
; downloads (SHA-256-verified) or degrades gracefully when payload/ is
; absent. An offline/air-gapped build can still embed one by passing
; /DPAYLOAD_DIR=<abs path to build\payload> (see installer-build.yml's
; include_payload input; blocked on the versions.lock.json pin rotation).
;
; Build (from the repo root; build-windows.ps1 does this):
;   makensis /DAPP_VERSION=<x.y.z> scripts\installer\build\nsis\nexus-setup.nsi
;
; Inputs  (relative to this .nsi): ..\..\pyqt\dist\nexus-installer.exe
; Output  (relative to this .nsi): ..\..\pyqt\dist\NexusSetup.exe
; ============================================================================

Unicode true

!ifndef APP_VERSION
  !define APP_VERSION "0.0.0"
!endif

!define APP_NAME        "Nexus Setup"
!define APP_PUBLISHER   "Nexus"
!define APP_HOMEPAGE    "https://github.com/bendourthe/Nexus-AI"
!define WIZARD_EXE      "nexus-installer.exe"
!define APP_REG_UNINST  "Software\Microsoft\Windows\CurrentVersion\Uninstall\NexusSetup"

Name       "${APP_NAME} ${APP_VERSION}"
OutFile    "..\..\pyqt\dist\NexusSetup.exe"
InstallDir "$LOCALAPPDATA\Nexus\Setup"
; Per-user install: the wizard provisions into user-space (~\.nexus,
; %LOCALAPPDATA%) and elevates its own sub-installers only where they
; require it, so the outer shell needs no UAC prompt.
RequestExecutionLevel user
SetCompressor /SOLID lzma

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName"     "${APP_NAME}"
VIAddVersionKey "ProductVersion"  "${APP_VERSION}"
VIAddVersionKey "CompanyName"     "${APP_PUBLISHER}"
VIAddVersionKey "FileDescription" "Nexus one-shot installer"
VIAddVersionKey "FileVersion"     "${APP_VERSION}"
VIAddVersionKey "LegalCopyright"  "${APP_HOMEPAGE}"

; ----------------------------------------------------------------------------
; Pages
; ----------------------------------------------------------------------------
!include "MUI2.nsh"
!include "FileFunc.nsh"

!define MUI_ABORTWARNING
; Installer + uninstaller icon (the NexusSetup.exe file icon in Explorer);
; generated from assets/nexus-ai-primary.png (v1.8.0 Phase 6 follow-up).
!define MUI_ICON "..\..\..\..\assets\icon.ico"
!define MUI_UNICON "..\..\..\..\assets\icon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${WIZARD_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Run the Nexus Setup wizard now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\..\..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ----------------------------------------------------------------------------
; Install
; ----------------------------------------------------------------------------
Section "Nexus Setup wizard (required)" SEC_WIZARD
  SectionIn RO
  SetOutPath "$INSTDIR"

  File "..\..\pyqt\dist\${WIZARD_EXE}"

!ifdef PAYLOAD_DIR
  ; Optional offline payload (air-gapped builds only; see header).
  SetOutPath "$INSTDIR\payload"
  File /r "${PAYLOAD_DIR}\*.*"
  SetOutPath "$INSTDIR"
!endif

  ; Start Menu shortcut (folder shared with the desktop app's own "Nexus.lnk")
  CreateDirectory "$SMPROGRAMS\Nexus"
  CreateShortcut "$SMPROGRAMS\Nexus\Nexus Setup.lnk" "$INSTDIR\${WIZARD_EXE}"

  ; Uninstall registry entry (HKCU -- per-user install)
  WriteRegStr HKCU "${APP_REG_UNINST}" "DisplayName"     "${APP_NAME}"
  WriteRegStr HKCU "${APP_REG_UNINST}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr HKCU "${APP_REG_UNINST}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr HKCU "${APP_REG_UNINST}" "URLInfoAbout"    "${APP_HOMEPAGE}"
  WriteRegStr HKCU "${APP_REG_UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${APP_REG_UNINST}" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegDWORD HKCU "${APP_REG_UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${APP_REG_UNINST}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${APP_REG_UNINST}" "EstimatedSize" "$0"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

; ----------------------------------------------------------------------------
; Uninstall
; ----------------------------------------------------------------------------
Section "Uninstall"
  ; ~\.nexus holds the user's models, skills, settings, and sessions. Ask
  ; before touching it; silent uninstalls (CI smoke) always preserve it.
  IfSilent keep_user_data
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 \
    "Keep your Nexus data ($PROFILE\.nexus)?$\r$\nThis includes downloaded models, skills, and settings.$\r$\n$\r$\nYes: keep the data.  No: delete it." \
    IDYES keep_user_data
  RMDir /r "$PROFILE\.nexus"
  keep_user_data:

  Delete "$INSTDIR\${WIZARD_EXE}"
  RMDir /r "$INSTDIR\payload"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\Nexus\Nexus Setup.lnk"
  RMDir "$SMPROGRAMS\Nexus"   ; removed only when empty (desktop app may own it)

  DeleteRegKey HKCU "${APP_REG_UNINST}"
SectionEnd
