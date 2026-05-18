; ============================================================================
; Nexus 1.0.0 -- NSIS outer installer (Phase 9.7)
; ============================================================================
;
; Builds Nexus-1.0.0-Setup.exe -- the Windows-shell layer around the PyQt5
; wizard. Responsibilities:
;
;   - UAC elevation
;   - Payload extraction to %TEMP%\Nexus-Setup\
;   - Manifest verification before launching the wizard
;   - Wizard launch (nexus-installer.exe)
;   - HKLM Uninstall registry entry
;   - Start Menu / Desktop shortcuts
;   - .nexus-workflow.json file association
;   - nexus:// URL handler
;   - Uninstaller with data-preservation prompt
;
; All cross-platform provisioning logic (CUDA, Python venv, Node, Ollama,
; recommended models, DevAI-Hub baseline) lives inside the PyQt wizard. NSIS
; is the Windows shell only.
;
; Build:
;   makensis scripts/installer/build/nsis/nexus-setup.nsi
;
; Inputs (relative to this .nsi file, set by build pipeline):
;   ..\..\..\build\wizard\nexus-installer.exe
;   ..\..\..\build\payload\
; Output:
;   ..\..\..\build\Nexus-1.0.0-Setup.exe
; ============================================================================

!define APP_NAME       "Nexus"
!define APP_VERSION    "1.0.0"
!define APP_PUBLISHER  "Nexus"
!define APP_HOMEPAGE   "https://github.com/bendourthe/Nexus-AI"
!define APP_EXE        "nexus.exe"
!define APP_INSTALL_DIR "$LOCALAPPDATA\Nexus"
!define APP_REG_UNINST  "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nexus"
!define APP_URL_SCHEME  "nexus"
!define APP_DOC_EXT     ".nexus-workflow.json"
!define APP_DOC_PROGID  "Nexus.Workflow"

Name              "${APP_NAME} ${APP_VERSION}"
OutFile           "..\..\..\..\build\Nexus-1.0.0-Setup.exe"
InstallDir        "${APP_INSTALL_DIR}"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

; ----------------------------------------------------------------------------
; Pages
; ----------------------------------------------------------------------------
!include "MUI2.nsh"

!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\..\..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
Var DESKTOP_SHORTCUT
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ----------------------------------------------------------------------------
; Sections
; ----------------------------------------------------------------------------
Section "Nexus Runtime (required)" SEC_RUNTIME
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; Frozen PyQt wizard exe (drives the rest of the install). Placed under
  ; %TEMP%\Nexus-Setup\ so the user can re-run it later if needed.
  CreateDirectory "$TEMP\Nexus-Setup"
  SetOutPath "$TEMP\Nexus-Setup"
  File "..\..\..\..\build\wizard\nexus-installer.exe"
  File /r "..\..\..\..\build\payload\"

  ; Verify the payload manifest before launching the wizard. The manifest
  ; lists SHA-256 for every file; the wizard re-verifies on its side, but
  ; this gives us a fast-fail if the .exe was tampered with in transit.
  ExecWait '"$TEMP\Nexus-Setup\nexus-installer.exe" --verify-only' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Installer payload verification failed. Aborting."
    Abort
  ${EndIf}

  ; Launch the wizard in interactive mode. The wizard handles CUDA, Python
  ; venv, Node, Ollama, recommended models, DevAI-Hub baseline. We pass our
  ; install dir so the wizard installs the program executable into the
  ; matching location.
  ExecWait '"$TEMP\Nexus-Setup\nexus-installer.exe" --install-dir "$INSTDIR"' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Installer wizard failed. Rolling back."
    Abort
  ${EndIf}

  ; Uninstall registry entry
  WriteRegStr HKLM "${APP_REG_UNINST}" "DisplayName"     "${APP_NAME}"
  WriteRegStr HKLM "${APP_REG_UNINST}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr HKLM "${APP_REG_UNINST}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr HKLM "${APP_REG_UNINST}" "URLInfoAbout"    "${APP_HOMEPAGE}"
  WriteRegStr HKLM "${APP_REG_UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${APP_REG_UNINST}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKLM "${APP_REG_UNINST}" "NoModify"       1
  WriteRegDWORD HKLM "${APP_REG_UNINST}" "NoRepair"       0

  ; Compute and record EstimatedSize (KB). NSIS does not have a native size
  ; helper, so the wizard writes the rounded size to manifest-size.txt.
  Push $0
  ClearErrors
  FileOpen $0 "$INSTDIR\manifest-size.txt" r
  ${If} ${Errors}
    WriteRegDWORD HKLM "${APP_REG_UNINST}" "EstimatedSize" 6000000
  ${Else}
    FileRead $0 $1
    FileClose $0
    WriteRegStr HKLM "${APP_REG_UNINST}" "EstimatedSize" $1
  ${EndIf}
  Pop $0

  ; Start Menu shortcut
  CreateDirectory "$SMPROGRAMS\Nexus"
  CreateShortcut "$SMPROGRAMS\Nexus\Nexus.lnk" "$INSTDIR\${APP_EXE}"

  ; Desktop shortcut (optional)
  ${If} $DESKTOP_SHORTCUT == "1"
    CreateShortcut "$DESKTOP\Nexus.lnk" "$INSTDIR\${APP_EXE}"
  ${EndIf}

  ; File association: .nexus-workflow.json -> Nexus
  WriteRegStr HKCR "${APP_DOC_EXT}" "" "${APP_DOC_PROGID}"
  WriteRegStr HKCR "${APP_DOC_PROGID}" "" "Nexus Workflow"
  WriteRegStr HKCR "${APP_DOC_PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'

  ; URL handler: nexus://
  WriteRegStr HKCR "${APP_URL_SCHEME}" "" "URL: Nexus Protocol"
  WriteRegStr HKCR "${APP_URL_SCHEME}" "URL Protocol" ""
  WriteRegStr HKCR "${APP_URL_SCHEME}\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'

  ; Write the uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section /o "Desktop Shortcut" SEC_DESKTOP
  StrCpy $DESKTOP_SHORTCUT "1"
SectionEnd

LangString DESC_SEC_RUNTIME ${LANG_ENGLISH} "Nexus desktop runtime: CUDA, Python venv, Node 22, Ollama, recommended models, DevAI-Hub baseline."
LangString DESC_SEC_DESKTOP ${LANG_ENGLISH} "Add a Nexus icon to your Desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_RUNTIME} $(DESC_SEC_RUNTIME)
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESKTOP} $(DESC_SEC_DESKTOP)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ----------------------------------------------------------------------------
; Uninstaller
; ----------------------------------------------------------------------------
Section "Uninstall"
  ; Confirm data preservation: keep ~\.nexus (models, skills, settings) by
  ; default; user can opt to nuke it explicitly.
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Keep your Nexus data ($PROFILE\.nexus\)?$\r$\nThis includes models, skills, and settings.$\r$\nYes: preserve.  No: delete." \
    IDYES skip_user_data
    RMDir /r "$PROFILE\.nexus"
  skip_user_data:

  ; Remove the program runtime
  RMDir /r "$INSTDIR"

  ; Remove the wizard cache
  RMDir /r "$TEMP\Nexus-Setup"

  ; Remove shortcuts
  Delete "$SMPROGRAMS\Nexus\Nexus.lnk"
  RMDir  "$SMPROGRAMS\Nexus"
  Delete "$DESKTOP\Nexus.lnk"

  ; Remove file association + URL handler
  DeleteRegKey HKCR "${APP_DOC_EXT}"
  DeleteRegKey HKCR "${APP_DOC_PROGID}"
  DeleteRegKey HKCR "${APP_URL_SCHEME}"

  ; Remove the Uninstall registry entry
  DeleteRegKey HKLM "${APP_REG_UNINST}"
SectionEnd
