# Windows installer build pipeline

**Owner**: installer (PyQt wizard)
**Status**: single-onefile pipeline (v1.9.0 Phase 1)

Produces `dist/NexusSetup.exe` -- the Windows one-shot installer. Since v1.9.0 Phase 1 the PyInstaller onefile IS the distributable: there is no NSIS outer shell and no separate wizard exe, so double-clicking `NexusSetup.exe` opens exactly one modern branded window (no generic pre-wizard dialog). The exe is slim by design -- the wizard downloads dependencies, models, the VS Code extension, and the desktop app at install time, each SHA-256-verified.

## High-level steps

```
+----------------------------------------------------------+
| 1. Resolve pinned versions                               |
|    - read package.json for the release version           |
+----------------------------------------------------------+
                              |
+----------------------------------------------------------+
| 2. Build the VSIX (bundled into the exe by PyInstaller)  |
|    npm ci && npm run build && npx vsce package           |
+----------------------------------------------------------+
                              |
+----------------------------------------------------------+
| 3. Freeze the wizard (PyInstaller onefile, windowed)     |
|    pyinstaller build/nexus-installer.spec                |
|       --distpath <repo>/dist --workpath build/work       |
|    -> dist/NexusSetup.exe  (APP_NAME = "NexusSetup")     |
+----------------------------------------------------------+
                              |
+----------------------------------------------------------+
| 4. Smoke: assert one artifact, boot the frozen exe       |
|    smoke-windows-exe.ps1 (--version, --check-registry)   |
+----------------------------------------------------------+
                              |
+----------------------------------------------------------+
| 5. (release only) sign + upload as a GitHub release asset|
|    signtool sign /fd sha256 ...  (deferred; unsigned now)|
+----------------------------------------------------------+
```

`scripts/installer/build/build-windows.ps1` runs steps 1-5. The macOS
(`build-macos.sh`) and Linux (`build-linux.sh`) scripts follow the same
contract: one PyInstaller onefile, packaged into exactly one artifact at the
repo-root `dist/` (`NexusSetup.dmg` / `NexusSetup-x86_64.AppImage`).

## Output contract

| OS | Artifact | Location |
|---|---|---|
| Windows | `NexusSetup.exe` | repo-root `dist/` (gitignored) |
| macOS | `NexusSetup.dmg` | repo-root `dist/` |
| Linux | `NexusSetup-x86_64.AppImage` | repo-root `dist/` |

Exactly one artifact per OS, from one build command, in one easy-to-find
location. CI uploads each from `dist/` (see `.github/workflows/installer-*.yml`
and `release.yml`).

## Local dev build

```powershell
# from the repository root
pwsh -File scripts/installer/build/build-windows.ps1 -SkipSign
pwsh -File scripts/installer/build/smoke-windows-exe.ps1
# dist/NexusSetup.exe is the artifact
```

The local build skips signing. Code signing is a recorded deferral for this
cycle (unsigned SmartScreen/Gatekeeper warnings are documented in
[docs/install.md](../../../docs/install.md)); the CI job adds signing once a
certificate is provisioned.

## History

The v1.0.0-era design baked a ~6 GB payload (CUDA/Python/wheels/Ollama/ffmpeg)
into the exe behind an NSIS outer shell. The 2026-07-03 operator decision
switched to fetch-at-install-time (slim exe), and v1.9.0 Phase 1 dropped the
NSIS layer entirely. The retired NSIS shell lives in
`scripts/installer/legacy/nexus-setup.nsi`; the offline-payload embed was an
NSIS-only capability and is not carried forward (recorded in the v1.9.0
known-gaps).
