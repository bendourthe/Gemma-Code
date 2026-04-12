; ============================================================================
; Gemma Code - Windows Installer
; Built with NSIS (Nullsoft Scriptable Install System)
; ============================================================================

Unicode True
SetCompressor /SOLID lzma

!define PRODUCT_NAME        "Gemma Code"
!ifndef PRODUCT_VERSION
  !define PRODUCT_VERSION   "0.1.0"
!endif
!define PRODUCT_PUBLISHER   "Gemma Code"
!define PRODUCT_EXT_ID      "gemma-code.gemma-code"
!define PRODUCT_VSIX        "gemma-code-${PRODUCT_VERSION}.vsix"
!define VENV_SUBDIR         "GemmaCode\venv"
!define REG_UNINSTALL       "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
!define REG_OLLAMA_PATH     "Software\Ollama"

; NSIS modern UI
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"

; -- String contains helper --------------------------------------------------
; ${StrContains} $result "needle" $haystack
; Sets $result to "needle" if found, or "" if not found.
!macro _StrContainsConstructor RESULT NEEDLE HAYSTACK
    Push "${HAYSTACK}"
    Push "${NEEDLE}"
    Call StrContainsFunc
    Pop "${RESULT}"
!macroend
!define StrContains '!insertmacro "_StrContainsConstructor"'

; -- Metadata ----------------------------------------------------------------

Name                    "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile                 "setup.exe"
InstallDir              "$PROGRAMFILES64\GemmaCode"
InstallDirRegKey        HKLM "${REG_UNINSTALL}" "InstallLocation"
RequestExecutionLevel   admin
ShowInstDetails         show
ShowUninstDetails       show

; -- MUI configuration -------------------------------------------------------

!define MUI_ABORTWARNING
!define MUI_ICON          "..\..\assets\icon.ico"
!define MUI_UNICON        "..\..\assets\icon.ico"
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${PRODUCT_NAME} Setup"
!define MUI_WELCOMEPAGE_TEXT  "This wizard will install ${PRODUCT_NAME} ${PRODUCT_VERSION}, a local agentic coding assistant powered by Gemma 4 via Ollama.$\n$\nAll components run entirely offline - no external API calls or data leaves your machine."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\LICENSE"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; -- Installer sections -------------------------------------------------------

Section "VS Code Extension" SecExtension
    SectionIn RO  ; required, cannot be deselected

    ; Prerequisite: Windows 10 1903+
    ${IfNot} ${AtLeastWin10}
        MessageBox MB_ICONSTOP "Gemma Code requires Windows 10 version 1903 or later.$\nPlease upgrade your operating system and try again."
        Abort
    ${EndIf}

    ; Prerequisite: VS Code installed
    DetailPrint "Checking for Visual Studio Code..."
    Call FindVSCode
    Pop $0  ; path to code.cmd or ""
    ${If} $0 == ""
        MessageBox MB_ICONSTOP "Visual Studio Code was not found on this machine.$\n$\nPlease install VS Code from https://code.visualstudio.com and run this installer again."
        Abort
    ${EndIf}
    StrCpy $1 $0  ; store code path

    ; Install the VSIX and icon
    DetailPrint "Installing VS Code extension..."
    SetOutPath "$INSTDIR"
    File "${PRODUCT_VSIX}"
    File "..\..\assets\icon.ico"
    ExecWait '"$1" --install-extension "$INSTDIR\${PRODUCT_VSIX}"' $0
    ${If} $0 != 0
        MessageBox MB_ICONSTOP "Failed to install the VS Code extension (exit code $0)."
        Abort
    ${EndIf}
    DetailPrint "Extension installed successfully."

    ; Write uninstall registry entry
    WriteRegStr   HKLM "${REG_UNINSTALL}" "DisplayName"      "${PRODUCT_NAME}"
    WriteRegStr   HKLM "${REG_UNINSTALL}" "DisplayVersion"   "${PRODUCT_VERSION}"
    WriteRegStr   HKLM "${REG_UNINSTALL}" "Publisher"        "${PRODUCT_PUBLISHER}"
    WriteRegStr   HKLM "${REG_UNINSTALL}" "InstallLocation"  "$INSTDIR"
    WriteRegStr   HKLM "${REG_UNINSTALL}" "UninstallString"  '"$INSTDIR\uninstall.exe"'
    WriteRegDWORD HKLM "${REG_UNINSTALL}" "NoModify"         1
    WriteRegDWORD HKLM "${REG_UNINSTALL}" "NoRepair"         1

    WriteUninstaller "$INSTDIR\uninstall.exe"

    ; Start Menu shortcut
    CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
    CreateShortcut  "$SMPROGRAMS\${PRODUCT_NAME}\Open in VS Code.lnk" \
                    "$1" "" "$INSTDIR\icon.ico"
    CreateShortcut  "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk" \
                    "$INSTDIR\uninstall.exe"

SectionEnd

Section "Ollama (local AI runtime)" SecOllama

    DetailPrint "Checking for Ollama..."
    Call FindOllama
    Pop $0  ; "found" or ""
    ${If} $0 == "found"
        DetailPrint "Ollama is already installed - skipping."
    ${Else}
        DetailPrint "Downloading OllamaSetup.exe (~1.9 GB, this may take several minutes)..."
        ExecWait 'powershell -NoProfile -WindowStyle Hidden -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri https://github.com/ollama/ollama/releases/latest/download/OllamaSetup.exe -OutFile $env:TEMP\OllamaSetup.exe -UseBasicParsing"' $0
        ${IfNot} ${FileExists} "$TEMP\OllamaSetup.exe"
            MessageBox MB_ICONSTOP "Failed to download Ollama (download incomplete).$\nPlease install Ollama manually from https://ollama.com and re-run setup."
            Abort
        ${EndIf}
        DetailPrint "Installing Ollama silently..."
        ExecWait '"$TEMP\OllamaSetup.exe" /SILENT /AUTOSTART=0' $0
        ${If} $0 != 0
            MessageBox MB_ICONSTOP "Ollama installation failed (exit $0)."
            Abort
        ${EndIf}
        DetailPrint "Ollama installed."
        Delete "$TEMP\OllamaSetup.exe"
    ${EndIf}

SectionEnd

Section "Python Backend" SecPython

    DetailPrint "Locating Python 3.11+..."
    Call FindPython
    Pop $0  ; python executable path or "NONE"
    ${IfNot} ${FileExists} "$0"
        DetailPrint "Python 3.11+ not found - downloading Python 3.12..."
        ExecWait 'powershell -NoProfile -WindowStyle Hidden -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri https://www.python.org/ftp/python/3.12.3/python-3.12.3-amd64.exe -OutFile $env:TEMP\python-installer.exe -UseBasicParsing"' $R0
        ${IfNot} ${FileExists} "$TEMP\python-installer.exe"
            MessageBox MB_ICONSTOP "Failed to download Python."
            Abort
        ${EndIf}
        ExecWait '"$TEMP\python-installer.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0' $R0
        ${If} $R0 != 0
            MessageBox MB_ICONSTOP "Python installation failed (exit $R0)."
            Abort
        ${EndIf}
        Delete "$TEMP\python-installer.exe"
        ; Re-locate after install
        Call FindPython
        Pop $0
    ${EndIf}
    DetailPrint "Using Python: $0"

    ; Create virtual environment
    StrCpy $1 "$LOCALAPPDATA\${VENV_SUBDIR}"
    DetailPrint "Creating venv at $1..."
    ExecWait '"$0" -m venv "$1"' $R0
    ${If} $R0 != 0
        MessageBox MB_ICONSTOP "Failed to create Python virtual environment."
        Abort
    ${EndIf}

    ; Install backend dependencies
    SetOutPath "$INSTDIR"
    File "backend-requirements.txt"
    DetailPrint "Installing backend dependencies..."
    ExecWait '"$1\Scripts\pip.exe" install -r "$INSTDIR\backend-requirements.txt" --quiet' $R0
    ${If} $R0 != 0
        MessageBox MB_ICONSTOP "Failed to install Python backend dependencies."
        Abort
    ${EndIf}
    DetailPrint "Python backend ready."

SectionEnd

Section /o "Download Gemma 4 model (9.6 GB)" SecModel

    DetailPrint "Pulling Gemma 4 model - this may take a long time depending on your connection..."
    nsExec::ExecToLog 'ollama pull gemma4'
    Pop $0
    ${If} $0 != 0
        MessageBox MB_ICONEXCLAMATION "Model download failed or was interrupted (exit $0).$\nYou can pull it later by running: ollama pull gemma4"
    ${Else}
        DetailPrint "Gemma 4 model downloaded successfully."
    ${EndIf}

SectionEnd

; -- Section descriptions -----------------------------------------------------

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${SecExtension} "Installs the Gemma Code VS Code extension. Required."
    !insertmacro MUI_DESCRIPTION_TEXT ${SecOllama}    "Installs the Ollama local AI runtime. Skipped if Ollama is already present."
    !insertmacro MUI_DESCRIPTION_TEXT ${SecPython}    "Creates a Python virtual environment and installs the inference backend dependencies."
    !insertmacro MUI_DESCRIPTION_TEXT ${SecModel}     "Downloads the Gemma 4 model from Ollama Hub (~9.6 GB). You can defer this and run 'ollama pull gemma4' later."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; -- Uninstaller --------------------------------------------------------------

Section "Uninstall"

    ; Remove VS Code extension
    Call un.FindVSCode
    Pop $0
    ${If} $0 != ""
        ExecWait '"$0" --uninstall-extension ${PRODUCT_EXT_ID}'
    ${EndIf}

    ; Remove Python venv
    StrCpy $1 "$LOCALAPPDATA\${VENV_SUBDIR}"
    ${If} ${FileExists} "$1\*"
        RMDir /r "$1"
    ${EndIf}

    ; Remove install directory contents
    Delete "$INSTDIR\${PRODUCT_VSIX}"
    Delete "$INSTDIR\backend-requirements.txt"
    Delete "$INSTDIR\icon.ico"
    Delete "$INSTDIR\uninstall.exe"
    RMDir  "$INSTDIR"

    ; Remove Start Menu shortcuts
    Delete "$SMPROGRAMS\${PRODUCT_NAME}\Open in VS Code.lnk"
    Delete "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk"
    RMDir  "$SMPROGRAMS\${PRODUCT_NAME}"

    ; Remove registry entry
    DeleteRegKey HKLM "${REG_UNINSTALL}"

SectionEnd

; -- Helper functions ---------------------------------------------------------

Function FindVSCode
    ; Try HKLM first, then HKCU, then PATH
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Code.exe" ""
    ${If} $R0 != ""
        ; Resolve to code.cmd in the same directory for CLI usage
        ${GetParent} $R0 $R1
        StrCpy $R0 "$R1\bin\code.cmd"
        ${If} ${FileExists} $R0
            Push $R0
            Return
        ${EndIf}
    ${EndIf}
    ReadRegStr $R0 HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Code.exe" ""
    ${If} $R0 != ""
        ${GetParent} $R0 $R1
        StrCpy $R0 "$R1\bin\code.cmd"
        ${If} ${FileExists} $R0
            Push $R0
            Return
        ${EndIf}
    ${EndIf}
    ; Fallback: try well-known install locations
    ${If} ${FileExists} "$LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
        Push "$LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
        Return
    ${EndIf}
    ${If} ${FileExists} "$PROGRAMFILES64\Microsoft VS Code\bin\code.cmd"
        Push "$PROGRAMFILES64\Microsoft VS Code\bin\code.cmd"
        Return
    ${EndIf}
    Push ""
FunctionEnd

Function un.FindVSCode
    ; Same logic as FindVSCode for the uninstaller section
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Code.exe" ""
    ${If} $R0 != ""
        ${GetParent} $R0 $R1
        StrCpy $R0 "$R1\bin\code.cmd"
        ${If} ${FileExists} $R0
            Push $R0
            Return
        ${EndIf}
    ${EndIf}
    ${If} ${FileExists} "$LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
        Push "$LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd"
        Return
    ${EndIf}
    Push ""
FunctionEnd

Function StrContainsFunc
    ; Stack: needle, haystack
    Exch $R1  ; needle
    Exch
    Exch $R2  ; haystack
    Push $R3
    Push $R4
    Push $R5
    StrLen $R3 $R1  ; needle length
    StrLen $R4 $R2  ; haystack length
    StrCpy $R5 0
    loop:
        IntCmp $R5 $R4 done done
        StrCpy $0 $R2 $R3 $R5
        StrCmp $0 $R1 found
        IntOp $R5 $R5 + 1
        Goto loop
    found:
        Pop $R5
        Pop $R4
        Pop $R3
        Pop $R2
        Exch $R1  ; return needle (found)
        Return
    done:
        Pop $R5
        Pop $R4
        Pop $R3
        Pop $R2
        Push ""
        Exch
        Pop $R1
        Return
FunctionEnd

Function FindOllama
    ; Check PATH-based lookup via where command
    nsExec::ExecToStack 'where ollama'
    Pop $0  ; exit code
    Pop $1  ; stdout
    ${If} $0 == 0
        Push "found"
        Return
    ${EndIf}
    ; Check default install path
    ${If} ${FileExists} "$LOCALAPPDATA\Programs\Ollama\ollama.exe"
        Push "found"
        Return
    ${EndIf}
    Push ""
FunctionEnd

Function FindPython
    ; Use PowerShell to find a suitable Python 3.11+ that is NOT the
    ; Microsoft Store stub (WindowsApps), which has sandboxed permissions
    ; that break venv creation.  Outputs "NONE" if no suitable Python found.
    nsExec::ExecToStack 'powershell -NoProfile -Command "foreach ($$cmd in @(\"py\",\"python3\",\"python\")) { try { $$p = & $$cmd -c \"import sys; print(sys.executable)\" 2>$$null; if ($$p -and $$p -notmatch \"WindowsApps\") { $$v = & $$cmd -c \"import sys; print(sys.version_info.minor)\" 2>$$null; if ([int]$$v -ge 11) { Write-Output $$p.Trim(); exit 0 } } } catch {} } Write-Output NONE"'
    Pop $0  ; exit code
    Pop $1  ; stdout (python path or "NONE")
    Push $1
FunctionEnd
