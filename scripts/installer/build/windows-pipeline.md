# Windows installer build pipeline (v1.0.0)

**Owner**: Phase 9.1
**Status**: design + CI placeholder (live job lands in Phase 9.2-9.6)

Produces `Nexus-1.0.0-Setup.exe` -- the NSIS-wrapped single-binary Windows installer described in [docs/versions/v1/v1.0.0/installer-architecture.md](../../../docs/versions/v1/v1.0.0/installer-architecture.md).

## High-level steps

```
+----------------------------------------------------------+
| 1. Resolve pinned versions                               |
|    - read scripts/installer/devai-hub-baseline.json      |
|    - read scripts/installer/pyqt/pyproject.toml          |
|    - read .nvmrc / package.json for Node 22              |
+----------------------------------------------------------+
                              |
+----------------------------------------------------------+
| 2. Hydrate the payload tree (under build/payload/)       |
|    - download CUDA 12.1 runtime libraries                |
|    - download Python 3.11 embeddable distribution        |
|    - pip download wheels --platform win_amd64            |
|    - download Node 22 portable .zip                      |
|    - download Ollama Windows installer                   |
|    - download ffmpeg + ffprobe                           |
|    - clone DevAI-Hub at pinned tag -> tarball            |
+----------------------------------------------------------+
                              |
+----------------------------------------------------------+
| 3. Compute manifest.json (SHA-256 of every payload file) |
+----------------------------------------------------------+
                              |
+----------------------------------------------------------+
| 4. Freeze the wizard (PyInstaller)                       |
|    pyinstaller --onefile --windowed                      |
|       --name nexus-installer                             |
|       scripts/installer/pyqt/src/nexus_installer/main.py |
+----------------------------------------------------------+
                              |
+----------------------------------------------------------+
| 5. Compile the NSIS outer                                |
|    makensis scripts/installer/build/nsis/nexus-setup.nsi |
|    output: build/Nexus-1.0.0-Setup.exe                   |
+----------------------------------------------------------+
                              |
+----------------------------------------------------------+
| 6. Sign + verify                                         |
|    signtool sign /fd sha256 /tr <ts-server>              |
|       /td sha256 /a Nexus-1.0.0-Setup.exe                |
+----------------------------------------------------------+
                              |
+----------------------------------------------------------+
| 7. Upload as GitHub release artifact                     |
+----------------------------------------------------------+
```

## Pinned versions

| Component | Version | Source URL pattern |
|---|---|---|
| CUDA runtime | 12.1.1 | `https://developer.download.nvidia.com/compute/cuda/12.1.1/local_installers/cuda_12.1.1_windows.exe` (we extract only the runtime libs, not the full toolkit) |
| Python embeddable | 3.11.9 | `https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip` |
| Node portable | 22.x LTS | `https://nodejs.org/dist/v22.x.0/node-v22.x.0-win-x64.zip` |
| Ollama Windows | latest stable | `https://ollama.com/download/OllamaSetup.exe` |
| ffmpeg | 7.x release | `https://github.com/BtbN/FFmpeg-Builds/releases/download/<tag>/ffmpeg-master-latest-win64-gpl.zip` |
| DevAI-Hub | from `scripts/installer/devai-hub-baseline.json` | `https://github.com/bendourthe/DevAI-Hub.git` |

Pinned versions are written to `scripts/installer/build/versions.lock.json` and consumed by `scripts/installer/build/fetch-payload.py` (Phase 9.2-9.6 add this script).

## Disk + bandwidth budget

| Item | Size |
|---|---|
| CUDA runtime libs | ~1.5 GB |
| Python embeddable | ~30 MB |
| Wheels (torch+cu121, diffusers, transformers, accelerate, xformers, ...) | ~3-4 GB |
| Node 22 portable | ~50 MB |
| Ollama installer | ~700 MB |
| ffmpeg | ~150 MB |
| DevAI-Hub baseline tarball | ~5 MB |
| Wizard exe | ~80 MB |
| Total payload | ~5.5-6.5 GB |

The installer .exe is therefore ~5.5-6.5 GB. Bandwidth cost is one-time per user.

## Reproducibility

- Every payload file's SHA-256 lives in `manifest.json` shipped inside the .exe.
- The NSIS outer verifies the manifest before launching the wizard.
- The CI job records the manifest in the release notes for audit.

## Local dev build

```powershell
# from repository root
python scripts/installer/build/fetch-payload.py --out build/payload/
pyinstaller --onefile --windowed `
    --name nexus-installer `
    --distpath build/wizard/ `
    scripts/installer/pyqt/src/nexus_installer/main.py
makensis scripts/installer/build/nsis/nexus-setup.nsi
# build/Nexus-1.0.0-Setup.exe is the artifact
```

The local build skips the signing step. The CI job adds signing once a code-signing certificate is provisioned (tracked as Phase 11 hardening).
