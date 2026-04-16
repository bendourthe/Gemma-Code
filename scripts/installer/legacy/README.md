# Legacy NSIS Installer

These files are deprecated v0.1.0/v0.2.0 artifacts from the original Windows-only NSIS installer. They are retained for reference but are no longer used in the build pipeline.

The current installer is the cross-platform PyQt5 wizard at `scripts/installer/pyqt/`.

## Files

- `setup.nsi` - NSIS installer script (Windows only)
- `build-installer.ps1` - PowerShell build orchestration script
- `backend-requirements.txt` - Exported Python dependencies for the backend venv
- `setup.exe` - Pre-built NSIS installer executable
- `gemma-code-0.2.0.vsix` - Compiled VSIX artifact (v0.2.0)
