# Installer field review - 2026-08-28

**Mode**: software (installer-scoped)
**Target**: `scripts/installer/` plus `core/registry/catalog.json` and the VS Code `engines.vscode` pin
**Trigger**: operator screenshots of the v2.2.9 Windows wizard (model catalog, chat catalog, VS Code step, installing progress, then a process close)
**Verdict**: **NO-GO** for treating the current wizard as a complete first-run. The shipped catalog chrome, RAM gating, VS Code step, and GUI install thread each fail in ways a first-time operator can see. Remediation is [plans/v2.3.1-installer-field-repair.md](../plans/v2.3.1-installer-field-repair.md).
**Lenses**: structure, quality, coverage, security, changes (working-tree installer delta: none)

This review is read-only. It does not mutate installer code.

## 1. Executive Summary

The Windows wizard is a PyQt5 application frozen as a windowed PyInstaller onefile (`NexusSetup.exe`). It can detect NVIDIA VRAM, recommend a large default model set, and start Ollama. It still paints unnamed child widgets with the window background (the black bars in screenshots 1, 2, and 4), reports RAM as 0 for every RAM-gated card, hides the VS Code extension checkbox when the host is not exactly 1.134.0, parks Unsloth Core on that same page, and can close during the model step because the GUI install thread has no top-level exception handler.

Those defects are in tagged v2.2.9 installer sources, not in the in-flight Video Lab diff.

## 2. Project Health

| Surface | Status | Detail |
|---|---|---|
| Git version control | OK | Repo present; HEAD `40174cd` on `feat/v2.3.0-qwen-video2x-openworker`; latest tag `v2.2.9` |
| Version number | OK | `package.json` 2.2.9; CHANGELOG unreleased post-cut; in-flight product work is v2.3.0 |
| Branch model | OK | `main` and `develop` both exist; active work is a feature branch |
| Baseline docs | OK | README, CHANGELOG, DEVLOG have real content |
| Per-version docs tree | OK | Legacy `docs/v2/v2.3/` with `plans/` and `comparisons/` (not the canonical `docs/releases/` layout) |

Project health: all governance surfaces present (legacy version-docs path).

## 3. Structure

```text
scripts/installer/src/nexus_installer/
  pages/          10-step wizard (Welcome ... Complete)
  engine/         provisioners + InstallEngine QThread
  widgets/        chrome, PhaseGroup, ModelCheckBox
  background/     crash resume + tray (state file, not a crash dialog)
  theme.py        global QSS (QWidget { background: BG_WINDOW })
  installer_state.py   shared dataclass (VRAM yes, RAM no)
core/registry/catalog.json   shared catalog (installer + Settings)
```

Wizard route in `main.py` `_register_gui_pages`: Welcome, Prerequisites, GPU Detection, Install Path, Models, Configuration, VS Code, Review, Installing, Complete.

`StoragePage` exists and is not on that route. Disk is shown on Install Path as `disk_space_gb` and never copied onto `free_disk_gb` until the Review-time install guard. The Models page then uses `free_disk_gb` as a stand-in for RAM.

Module boundary: installer code stays under `scripts/installer/` and reads `core/registry/`. That is clean. The HostProfile produced by `host_detect.detect_host()` is not the object the catalog page reads.

## 4. Quality

Highest-severity defects, mapped to the operator screenshots.

### F1. Black bars on catalog cards and the installing list (screenshots 1, 2, 4)

`theme.py` sets every `QWidget` to `BG_WINDOW` (`#0a0d14`). Cards set `QWidget#modelCard` to `BG_CARD` (`#181d2a`). Nested widgets that do not opt out keep the window fill.

The name-row host is `QWidget#cardHeaderRow` with no transparent background. Labels inside it are transparent, so the dark strip sits behind the title and pills. The installing-page details pane is an unnamed `QWidget` (`PhaseGroup._details`) with the same inheritance, which is the large black rectangle around the per-model list.

This is not a missing asset. It is an over-broad QSS rule plus missing child-surface tokens.

### F2. Inkling-Small shows "you have 0" RAM while Gemma 4 26B shows 16 GB VRAM (screenshot 2)

VRAM comes from `GpuDetectionPage` into `InstallerState.vram_mb`. That path works (16 GB).

RAM does not. `InstallerState` has no `total_ram_gb`. `host_detect.py` does measure RAM, including a Windows PowerShell CIM probe, but the catalog never reads it.

```1211:1211:scripts/installer/src/nexus_installer/pages/typed_catalog.py
            host_ram_gb = state.free_disk_gb  # placeholder until HostProfile threaded
```

`free_disk_gb` defaults to 0. Install Path writes `disk_space_gb` only. Inkling-Small is the chat-tab entry with `requiredRamGB: 8` and `requiredVramGB: 0`, so the badge is "Requires 8 GB RAM (you have 0)". Gemma 4 26B is VRAM-gated (18 vs 16), so it looks "correct" next to a card that is not.

On a machine with enough system RAM, Inkling-Small should be Compatible (patient-tier, disk-offload). The 0 is a wiring bug, not a probe of 0 RAM.

### F3. VS Code step: missing checkbox, Unsloth on the wrong page, exact 1.134.0 pin (screenshot 3)

The extension checkbox exists in `VsCodeExtensionPage`. It is disabled when `inspect_vscode_cli` does not report Microsoft stable `code` **exactly** `1.134.0`. Disabled indicator QSS uses `BG_CARD` on a `BG_CARD` card, so the box disappears. Unsloth stays enabled, so only that control is visible. That matches the screenshot.

The exact pin is intentional ABI policy from v2.2.9 (`better-sqlite3` 12.11.1 rebuilt for Electron 42.8.1). It also makes the whole page a dead end on VS Code 1.135.0, which is what the operator had.

`ExtensionInstaller` runs `code --install-extension <vsix>` and a test asserts `--force` is absent. An already-installed extension is not offered as replace/upgrade.

Unsloth Core is an optional NVIDIA 16 GB+ QLoRA venv (`install_unsloth`, LGPL `unsloth-zoo`). It does not belong on the VS Code page. Configuration already has Components and Features.

### F4. Wizard closes during the model step (screenshot 4)

Headless install wraps each step in `try/except`. The GUI path does not:

```247:248:scripts/installer/src/nexus_installer/engine/installer.py
    def run(self) -> None:
        self._engine.run(self._state)
```

The binary is windowed (no console). An uncaught exception in that QThread never reaches `install_finished`, has nowhere to print, and can take the process down.

`ModelStepRouter.install` then emits Qt signals (`model_started.emit`, progress, completed, failed) from `ThreadPoolExecutor` workers (up to 3). Those are not QThreads. Emitting PyQt5 signals from arbitrary Python threads is a documented crash class, and screenshot 4 is exactly the moment those workers would first fire: Dependencies Done, Models "Installing...", every row still "Waiting to start".

Resume state is written on transitions, so a relaunch may offer Resume. That is not a crash dialog, and it does not keep the window alive.

### F5. Required embedder is Nomic Embed Text by design, not by age

`CatalogModel.is_required` is hardcoded to `nomic-embed-text`. Catalog copy says swapping embedders invalidates the on-disk memory index. EmbeddingGemma is **300M** (not 300B), 2K context, Gemma Terms of Use, 0.62 GB. Nomic is Apache-2.0, 8K context, 0.27 GB.

Newer is not automatically the required default. A switch without a reindex migrator would break existing semantic memory.

## 5. Coverage

Installer pytest was 1160 passed / 3 skipped at v2.2.9 release. The field bugs are untested or locked in by tests:

| Gap | Evidence |
|---|---|
| Catalog RAM uses `free_disk_gb` | Card tests pass `host_ram_gb=16` directly; no page test asserts `InstallerState.total_ram_gb` |
| Disk field split | Install Path sets `disk_space_gb`; catalog and footer read `free_disk_gb` |
| Header chrome | `test_model_pills.py` finds `#cardHeaderRow` for pill content, not background |
| Disabled VS Code checkbox visibility | Tests check copy and enablement, not that the indicator remains visible |
| `--force` replace | `test_extension_installer.py` asserts `--force` is **not** in the argv |
| GUI thread exceptions | Headless `run_step` is guarded; `_InstallThread.run` is not |
| Qt signals from thread-pool workers | Router tests exercise pull routing, not GUI-thread affinity |

`StoragePage` has tests and is not in the live wizard, so disk-accounting coverage does not protect the Models page.

## 6. Security

Installer-owned component inventory (this review's denominator):

| Component | Kind | Status | Review action |
|---|---|---|---|
| Wizard shell (`main`, `window`, `theme`) | UI | COVERED | Global QSS, windowed entry, no `sys.excepthook` |
| Catalog UI (`typed_catalog`, pills, checkbox) | UI | COVERED | RAM placeholder, card chrome, rich-text license notes escaped |
| Host detection | probe | COVERED | Subprocess timeouts; RAM unused by catalog |
| VS Code step + `ExtensionInstaller` | provisioner | COVERED | Exact-version skip; no `--force`; CLI argv is installer-controlled |
| `InstallEngine` / `_InstallThread` | runtime | COVERED | No top-level except; signals from pool threads |
| Model router + pullers | download | COVERED | SHA-256 on HF files; ollama protocol; parallel pool |
| HF auth / gated dialog | secrets | COVERED | Token documented as header-only, not in `_RESULT_FIELDS` snapshot |
| Background state / resume | persistence | COVERED | Resume after death; no crash UX |
| Unsloth provisioner | opt-in venv | COVERED | Placement and LGPL copy, not AGPL extras |
| Ollama / venv / desktop / CUDA / ROCm / Metal / Node / ffmpeg / Hub | provisioners | OMITTED | Screenshot scope is catalog, VS Code step, model-step crash |
| Legacy NSIS | retired | OMITTED | Under `scripts/installer/legacy/` |
| Smoke harness | test | OMITTED | CI profiles, not the GUI thread |
| `StoragePage` | dead route | UNCOVERED | Implemented, not registered; disk-field split not fully traced beyond Models |

**8 of 14 components covered; 5 omitted for the reasons above; 1 remains UNCOVERED.**

P2 findings (not exploit recipes):

- Windowed process + uncaught thread exception: availability failure, not an injection finding.
- `hf_token` is in-memory on `InstallerState`. Recorder snapshot fields omit it. Logs must stay that way when crash dumps are added.
- Extension install argv is built from a detected CLI path plus a bundled VSIX glob. Do not interpolate raw operator strings into the command list.
- License notes on cards use `html.escape` before rich text.

The installer does not spawn AI agents. Agent-execution-isolation triage does not apply.

## 7. Changes

Working tree at review time is v2.3.0 Video Lab enhancement (desktop video files, todos, v2.3.0 plan). No installer sources are dirty. The `changes` lens therefore has no installer diff to persona-review. Findings above are in the current installer tree (v2.2.9 tag and develop), not introduced by the video branch.

## 8. Severity-ranked findings

| ID | Severity | Screenshot | Finding |
|---|---|---|---|
| F4 | P0 | 4 | GUI install thread can kill the process at model start |
| F2 | P1 | 2 | RAM-gated models always see 0 GB RAM |
| F3a | P1 | 3 | Extension checkbox hidden / disabled on any VS Code other than 1.134.0 |
| F1 | P2 | 1, 2, 4 | Window-color child widgets look like unstyled black bars |
| F3b | P2 | 3 | Unsloth Core on the VS Code page, unexplained |
| F3c | P2 | 3 | No replace/upgrade path for an already-installed VSIX |
| F5 | P3 | 1 | Required embedder is Nomic by index-compat policy; do not silently swap to EmbeddingGemma |

## 9. Verdict

**NO-GO** for a clean first-run installer experience until F4, F2, and F3a are fixed and re-proven on a packaged Windows build.

v2.3.0 video work can continue on its own branch. Do not fold these repairs into that plan's remaining phases.

Roadmap: [v2.3.1-installer-field-repair.md](../plans/v2.3.1-installer-field-repair.md).
