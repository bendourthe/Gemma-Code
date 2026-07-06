# Legacy NSIS Installer

These files are deprecated artifacts from NSIS-based Windows installers. They are retained for reference but are no longer used in the build pipeline.

The current installer is the cross-platform PyQt5 wizard at `scripts/installer/`. Since v1.9.0 Phase 1 the PyInstaller onefile IS the distributable (`NexusSetup.exe`); there is no NSIS outer shell -- double-clicking the installer opens exactly one modern branded window.

## Files

- `setup.nsi` - v0.1.0/v0.2.0 NSIS installer script (Windows only)
- `nexus-setup.nsi` - v1.8.0 NSIS outer shell that wrapped the PyQt wizard as `NexusSetup.exe`; retired in v1.9.0 Phase 1 (T103) when the onefile became the distributable directly
- `build-installer.ps1` - PowerShell build orchestration script (v0.x)
- `backend-requirements.txt` - Exported Python dependencies for the backend venv
- `setup.exe` - Pre-built NSIS installer executable
- `gemma-code-0.2.0.vsix` - Compiled VSIX artifact (v0.2.0)
