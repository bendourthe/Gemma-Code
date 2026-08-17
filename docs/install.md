# Installing Nexus

Nexus ships as a **one-file installer** per platform. Download it, run it, answer a few questions, and you end up with the Nexus desktop app, the VS Code extension (optional), and local AI models matched to your hardware. No terminal, no manual dependency setup.

The installers are attached to each [GitHub release](https://github.com/bendourthe/Nexus-AI/releases), alongside a `SHA256SUMS.txt` you can use to verify your download. Tag-triggered `release.yml` builds the desktop bundles; the GitHub Actions budget freeze that delayed those jobs lifted 2026-08-01.

| Platform | Download | Size class |
|---|---|---|
| Windows 10/11 (x64) | `NexusSetup.exe` | ~65 MB |
| macOS 12+ (Apple Silicon) | `NexusSetup.dmg` | ~70 MB |
| Linux x86_64 (glibc 2.31+) | `NexusSetup-x86_64.AppImage` | ~70 MB |

The installer itself is small; it downloads what you select (models, GPU runtime, the desktop app) during installation, verifying every download against pinned SHA-256 checksums. Expect 5-60 GB of downloads depending on the models you pick, so plan for disk space and a decent connection.

## Windows

1. Download `NexusSetup.exe` from the latest release.
2. Double-click it. It opens a single modern branded window (no generic pre-wizard dialog). **You will see a SmartScreen warning** ("Windows protected your PC") because the binary is not yet code-signed (signing is planned; see the note below). Click **More info**, then **Run anyway**.
3. The setup wizard walks you through: hardware detection, install location, model selection (chat, coding, image, video), the VS Code extension, and the Nexus desktop app. Progress is shown per phase; everything is downloaded checksum-verified.
4. When it finishes, the Nexus desktop app is installed and launched. To change your setup later (add models, reinstall components), just run `NexusSetup.exe` again.

Scripted / headless installs (`NexusSetup.exe` is the wizard itself -- there is no separate extract step):

```powershell
# Run the installer without a GUI, emitting a machine-parseable JSON summary:
NexusSetup.exe --headless --json-output
```

`NexusSetup.exe --help` lists the headless flags (`--model`, `--skip-model`, `--skip-extension`, `--skip-desktop`, `--install-path`).

## macOS

1. Download `NexusSetup.dmg`, open it, and drag **Nexus AI Studio Setup** to Applications.
2. **Gatekeeper will block the first launch** ("cannot be opened because the developer cannot be verified") because it is not yet notarized. Right-click (Control-click) it and choose **Open**, then **Open** again in the dialog. You only need to do this once.
   - Alternative from a terminal: `xattr -d com.apple.quarantine "/Applications/Nexus AI Studio Setup"`
3. Follow the wizard. Apple Silicon Macs use the Metal GPU path automatically.
4. To drive an MLX model you already run (mlx-vlm, LM Studio MLX, or nativ) through Nexus, register it as a loopback adapter. See [MLX via localAdapters](v1/v1.16/guides/mlx-via-local-adapters.md).

## Linux

1. Download `NexusSetup-x86_64.AppImage` and make it executable:

   ```bash
   chmod +x NexusSetup-x86_64.AppImage
   ./NexusSetup-x86_64.AppImage
   ```

2. AppImages need FUSE. On Ubuntu 22.04+ / Debian 12+, install it once with `sudo apt install libfuse2`. If FUSE is unavailable (containers, some minimal distros), extract and run instead:

   ```bash
   ./NexusSetup-x86_64.AppImage --appimage-extract
   ./squashfs-root/AppRun
   ```

3. Requires glibc 2.31+ (Ubuntu 20.04+, Debian 11+, Fedora 32+). Older distros are unsupported.

## Verifying your download

Each release attaches a `SHA256SUMS.txt` covering every asset:

```bash
# Linux / macOS
sha256sum -c --ignore-missing SHA256SUMS.txt
```

```powershell
# Windows
(Get-FileHash NexusSetup.exe -Algorithm SHA256).Hash
# compare against the NexusSetup.exe line in SHA256SUMS.txt
```

## What the installer actually does

1. **Dependencies**: GPU runtime for your hardware (CUDA / ROCm / Metal, or CPU-only), Node runtime, Ollama, ffmpeg, and the diffusion Python environment.
2. **VS Code extension** (optional, on by default when VS Code is present).
3. **Models**: your selection from the typed catalog (Chat, Agentic Coding, Image, Video, Audio), downloaded with live progress; image/video weights come from Hugging Face, text models via Ollama.
4. **Nexus desktop app**: fetched from the matching GitHub release, checksum-verified against `SHA256SUMS.txt`, installed and health-checked, then launched from the finish page.

Everything lands under your user account (no admin rights needed for the wizard itself); user data lives in `~/.nexus`.

## After you install (v1.18.0)

- **llama.cpp on loopback**: Nexus does not bundle llama.cpp. If you already run `llama-server` on `127.0.0.1`, register it as `nexus.llm.localAdapters` and set `nexus.llm.backend` to the manifest name. Recipe: [llamacpp-loopback-adapter.md](reference/llamacpp-loopback-adapter.md). This does not enable the patient-tier catalog gate.
- **Skill-native mappings**: morning-brief *content* is the Hub `agent-presets` `morning-briefing` preset; browser GUI QA is Hub `browser-testing-with-devtools`. No new skill ships in this repo. See [skill-native-adoptions-v1.18.md](reference/skill-native-adoptions-v1.18.md).

## After you install (v1.17.0)

The desktop shell now uses orbs, a surface-liveness beam, and a metal ring on Send / Generate / New session. If your OS has reduced-motion enabled, every effect **halts** (static fallbacks) instead of slowing down. Tokens: [design-tokens.md](v1/v1.17/design-tokens.md).

## After you install (v1.16.0)

- **Local API server**: off by default. In Nexus, open Settings > Local API server, turn it on, and copy the base URL plus token into Claude Code / Codex / Cursor. The server binds loopback only and serves model inference, never files or tools. See [README](../README.md#local-api-server-opt-in).
- **Document parsing**: Settings > Models, install **RapidOCR PP-OCRv4** (CPU, every OS) and optionally **Unlimited-OCR 3B** (NVIDIA). Then attach a PDF or image in Local Chatbot. Neither model is auto-installed.
- **MLX on Apple Silicon**: Nexus does not bundle MLX. Register an existing loopback server as described in [MLX via localAdapters](v1/v1.16/guides/mlx-via-local-adapters.md).

## Uninstalling

The installer itself does not register an uninstaller or a Start-menu entry -- it is a run-once setup tool, so once the Nexus desktop app is installed you can simply delete `NexusSetup.exe`. The product's own uninstaller ships with the desktop app.

- **Windows**: "Nexus" appears under Settings > Apps (installed by the desktop-app bundle); use it to remove the app. Delete `NexusSetup.exe` when you no longer need to re-run setup. `~/.nexus` (models, skills, settings) is preserved unless you remove it manually.
- **macOS**: drag the apps out of Applications; remove `~/.nexus` if you also want the data gone.
- **Linux**: delete the AppImage, `~/.local/bin/Nexus.AppImage`, the `~/.local/share/applications/nexus.desktop` entry, and optionally `~/.nexus`.

## A note on the security warnings

The Windows executable and the macOS app are **not yet code-signed or notarized** (the certificates are a recorded, deliberate deferral for this cycle), so SmartScreen and Gatekeeper flag them as from an unidentified developer. The mitigations are the checksum file above and the fact that every payload the installer fetches is SHA-256-pinned. If a future release ships signed binaries, these warnings disappear and this page will be updated.
