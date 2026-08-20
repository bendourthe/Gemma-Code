# Nexus AI Studio installer

The PyQt5 setup wizard that installs Nexus AI Studio: the VS Code extension, the Ollama runtime, Python venvs, the selected local models, and the desktop app. Built into a one-file `NexusSetup.exe` via PyInstaller (`build/build-windows.ps1`).

## Running from source

```bash
# from repo root, using the installer venv
scripts/installer/.venv/Scripts/python -m nexus_installer            # launch the wizard
```

## Diagnostic / preflight commands

The catalog the wizard offers is verified with two model-source checks (`nexus_installer.engine.model_preflight`):

- **`nexus-installer --reachability`** - fast, no-download probe that classifies every catalog model's source as OK / GATED / DEAD / UNKNOWN (a HEAD on the Hugging Face `resolve` URL, or an Ollama registry manifest check). Safe to run on every change; use it to catch catalog rot (a withdrawn or moved repo) before a release. Runs in well under a minute.
- **`nexus-installer --preflight [TIER]`** - the live pull+load verification: for a hardware tier's default models (`cpu` / `8` / `12` / `16` / `24`, or all tiers when omitted) it pulls each model and then LOADS it (a one-token Ollama generation, or a Hugging Face weights integrity check). This downloads multi-GB weights and writes them into your Ollama / models root, so it is an operator action on a target box, gated behind `NEXUS_MODEL_PREFLIGHT=1`. Its CI leg is deferred under the GitHub Actions budget freeze.

```bash
scripts/installer/.venv/Scripts/python -m nexus_installer --reachability
NEXUS_MODEL_PREFLIGHT=1 scripts/installer/.venv/Scripts/python -m nexus_installer --preflight 16
```

## Gated (license) models

A few offered models are open-weight but sit behind a Hugging Face license click-through (`gated: true` + `requiresLicense` in `core/registry/catalog.json`): currently `svd`, `stable-audio-open-1.0`, and `sana-1.6b-int4`. The installer makes them work rather than skipping them:

1. **Automatic** - it resolves a Hugging Face token from `HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN` or the `huggingface-cli login` cache (`engine.hf_auth.discover_hf_token`) and uses it silently.
2. **Guided (last resort)** - if no token is found and you selected a gated model, a one-time dialog (`widgets.gated_auth_dialog`) opens the model's license page, lets you paste a free read token, validates it against the repo, and proceeds. Declining removes that model from the install queue so nothing fails mid-download.

The default (recommended) model set is 100% public, so a normal install never needs a token. The guided dialog explains what a gated model is, links directly to the Hugging Face token settings, and makes clear that Skip omits only that one model and continues.

## Model catalog

The models the wizard offers come from `core/registry/catalog.json` (shared with the desktop app). The PyInstaller spec bundles this file straight from the repo, so a fresh build always ships the current catalog. To stop a *stale* catalog from shipping (an older build was the root of the v1.13/v1.14 install-reliability defects - a broken Gemma Ollama pull target and an unflagged gated model), the catalog is guarded by content invariants (`nexus_installer.catalog_invariants`):

- The build FAILS CLOSED (`build/nexus-installer.spec`) if `catalog.json` is missing or violates an invariant.
- `test_catalog_invariants.py` runs the same checks in CI (the installer pytest job) - the always-on gate.
- `python build/check-catalog.py` runs them ad hoc against `core/registry/catalog.json`.

The invariants encode the fixes: no model may use the known-broken `unsloth/gemma-4-12b-it-GGUF` Ollama reference, and known access-gated models (e.g. `sana-1.6b-int4`) must stay flagged `gated` with a reason / license URL so the guided token step can explain it and offer a clean skip.

v2.1.0: Muse Glimmer and Nemotron Lightning pair-invariants (both quant tiers must ship together). Entries with `hideBelowVramGB` are omitted from the picker when the host is below that floor, not merely grayed. `minOllamaVersion` shows a "Requires Ollama X+" badge; the catalog page does not hide on unknown Ollama version because that page often runs before Ollama is installed.

## Build

```powershell
scripts\installer\build\build-windows.ps1 -SkipSign   # -> dist\NexusSetup.exe
```

See `VERSIONS.md` for the pinned Ollama / payload versions and the minimum Ollama floor.
