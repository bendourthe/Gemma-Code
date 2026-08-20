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

## After you install (v1.20.0)

- **Document attach**: Chat and Coding accept PDF, images, Word, PowerPoint, and Excel. Parsed text is shown locally; it does not auto-enter a prompt. First file only this cycle.
- **`parse_document`**: off until you set `nexus.coding.parseDocument.enabled` (VS Code) or `NEXUS_PARSE_DOCUMENT=1` / `~/.nexus/settings.json` (sidecar). CONFIRM still wraps the tool. Office files do not need RapidOCR or Unlimited-OCR.
- **No Docling**: layout-aware Docling was deferred (DF-5). Portable OCR requirements still exclude torch.

## After you install (v1.19.2)

- **Hermes 3**: `hermes3:8b` is an Agentic catalog pick (Ollama library). Enable `nexus.coding.harnessSelector.enabled` to apply `hermes-agentic` (llama3-json). The live coding loop still parses Gemma XML (DF-3). `hermes3:70b` is listed but is not a recommended default.
- **Inkling-Small**: hidden unless the patient tier is on (`nexus.llm.patientTier.enabled` or installer `NEXUS_PATIENT_TIER=1`). 74.8 GB GGUF, Apache-2.0, text-only at this quant (DF-2). Never auto-selected.
- **Weight variants**: models with `weights.variants` install one official line. Override with `NEXUS_WEIGHTS_VARIANT=<variant-id>`. Unofficial quants are rejected. sha256 still required.
- **Patient-tier copy**: warning floor is ~0.03 tok/s. `nexus.llm.patientTier.ramPreset` (`laptop` / `workstation` / `max`) is expectation copy; Nexus does not bundle the offload runtime.

## After you install (v1.19.1)

- **Security posture**: Settings > Security, or `"nexus.coding.securityPosture"`. Default `standard`. `unattended` skips CONFIRM-tier prompts only; `run_terminal` still confirms; hard-denied commands (`rm -rf`, `git push --force`, `DROP TABLE`) never run. This is not a no-floor mode.
- **LoopGuards**: auto-mode stops after five identical consecutive tool calls, an error burst, a bounded extra-call queue, or 60 iterations. Headless sidecar does not yet construct LoopGuards (DF-3).
- **watch_path / hash_file**: read-only workspace tools. Paths outside the project root are rejected.
- **Hub skills**: grounded-citation, persona-card, and avatar-prep prose live on Nexus-Hub branch `feat/v1.19.1-skill-native-wins`. Merge that branch, then `nexus skills sync --apply` (DF-2). Mapping: [skill-native-adoptions-v1.19.1.md](reference/skill-native-adoptions-v1.19.1.md).

## After you install (v1.19.0)

- **LFM2.5-2.6B**: on CPU and 8 GB agentic recommended lists as `lfm2.5:2.6b`. The installer pulls it through Ollama from `hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M`. The card shows LFM Open License v1.0 (USD 10M commercial cap) as a use restriction, not a download gate.
- **8B-A1B is not in the catalog.** A quality-per-GB bake-off vs Qwen 14B and DeepSeek 16B was not completed; the row stays out until a dated local table shows a win.
- **Harness**: if you enable the existing `nexus.coding.harnessSelector.enabled` toggle, LFM uses the `lfm-agentic` profile. The live coding loop still parses Gemma XML (DF-6); listing the model does not by itself execute pythonic tool calls.

## After you install (v1.18.0)

- **llama.cpp on loopback**: Nexus does not bundle llama.cpp. If you already run `llama-server` on `127.0.0.1`, register it as `nexus.llm.localAdapters` and set `nexus.llm.backend` to the manifest name. Recipe: [llamacpp-loopback-adapter.md](reference/llamacpp-loopback-adapter.md). This does not enable the patient-tier catalog gate.
- **Skill-native mappings**: morning-brief *content* is the Hub `agent-presets` `morning-briefing` preset; browser GUI QA is Hub `browser-testing-with-devtools`. No new skill ships in this repo. See [skill-native-adoptions-v1.18.md](reference/skill-native-adoptions-v1.18.md).
- **Harness selector**: off by default. Enable `nexus.coding.harnessSelector.enabled` to apply a per-model scaffold overlay (prompt style, thinking mode, system-prompt budget). Inspect or switch with `/harness`. Named profiles are documented in [low-cost-model-optimization.md](reference/low-cost-model-optimization.md).
- **Catalog governance**: the desktop model picker badges models with in-repo `toolCallingVerified` provenance. MoE rows may list `activeParams` / `totalParams`; harness compute uses active params when present, residency never substitutes active for total. Unsloth UD / MXFP4-style labels are recognized as extreme-low-bit and stay blocked (`EXTREME_LOW_BIT_MIN_OLLAMA_VERSION` remains `999.0.0`).
- **MCP per-tool deny**: Settings > MCP lets you deny individual tools on allowed servers. Denies only tighten Hub policy; a toggle cannot enable a dropped server or a policy-denied tool. Persisted at `.nexus/mcp-tool-deny.json`.
- **Exec sandbox**: off by default (`nexus.coding.execSandbox`; sidecar `NEXUS_EXEC_SANDBOX=1`). When on, `run_terminal` is wrapped in Seatbelt (macOS), Landlock+seccomp (Linux, needs python3), or a Windows job object. Off or missing backend prints **unconfined**. Windows does not kernel-enforce filesystem or network.
- **ACP agent**: same Settings > Local API server section, separate toggle (`nexus.acp.enabled` or `NEXUS_ACP_ENABLED=1`). Uses the shared loopback listener and token at `POST /acp`. Off by default. Unattended CONFIRM/DANGEROUS calls park in Ask inbox.
- **Ask inbox and scheduler**: Admin > Ask inbox lists parked approvals. Approve replays the permission gate. The built-in morning-brief schedule is off until you enable it in that panel. There is no auto-approve path.

## After you install (v1.17.0)

The desktop shell now uses orbs, a surface-liveness beam, and a metal ring on Send / Generate / New session. If your OS has reduced-motion enabled, every effect **halts** (static fallbacks) instead of slowing down. Tokens: [design-tokens.md](v1/v1.17/design-tokens.md).

## After you install (v1.16.0)

- **Local API server**: off by default. In Nexus, open Settings > Local API server, turn it on, and copy the base URL plus token into Claude Code / Codex / Cursor. The server binds loopback only and serves model inference, never files or tools. See [README](../README.md#local-api-server-opt-in).
- **ACP agent** (v1.18.0): same Settings section, separate toggle. Uses the same loopback listener and token at `POST /acp`. Off by default. Unattended confirmations park in the ask inbox (or fail-closed if no inbox is configured).
- **Document parsing**: Settings > Models, install **RapidOCR PP-OCRv4** (CPU, every OS) and optionally **Unlimited-OCR 3B** (NVIDIA) for PDFs and images. Word, PowerPoint, and Excel (`.docx` / `.pptx` / `.xlsx`) parse with native libraries and do not require those OCR models or Docling. Attach in Local Chatbot or Agentic AI Coding. Parsed text is shown in the thread and is not auto-sent to a model. Neither OCR model is auto-installed.
- **MLX on Apple Silicon**: Nexus does not bundle MLX. Register an existing loopback server as described in [MLX via localAdapters](v1/v1.16/guides/mlx-via-local-adapters.md).

## Uninstalling

The installer itself does not register an uninstaller or a Start-menu entry -- it is a run-once setup tool, so once the Nexus desktop app is installed you can simply delete `NexusSetup.exe`. The product's own uninstaller ships with the desktop app.

- **Windows**: "Nexus" appears under Settings > Apps (installed by the desktop-app bundle); use it to remove the app. Delete `NexusSetup.exe` when you no longer need to re-run setup. `~/.nexus` (models, skills, settings) is preserved unless you remove it manually.
- **macOS**: drag the apps out of Applications; remove `~/.nexus` if you also want the data gone.
- **Linux**: delete the AppImage, `~/.local/bin/Nexus.AppImage`, the `~/.local/share/applications/nexus.desktop` entry, and optionally `~/.nexus`.

## A note on the security warnings

The Windows executable and the macOS app are **not yet code-signed or notarized** (the certificates are a recorded, deliberate deferral for this cycle), so SmartScreen and Gatekeeper flag them as from an unidentified developer. The mitigations are the checksum file above and the fact that every payload the installer fetches is SHA-256-pinned. If a future release ships signed binaries, these warnings disappear and this page will be updated.
