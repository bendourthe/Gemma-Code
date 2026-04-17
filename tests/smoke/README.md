# Installer smoke tests

Cross-platform smoke tests that exercise the Gemma Code PyQt5 installer in headless mode, then verify the installed components respond correctly.

## Prerequisites

| Platform | Required before running |
| --- | --- |
| Windows | Python 3.11+, VS Code, PowerShell 5.1+ |
| macOS | Python 3.11+, VS Code (`/Applications/Visual Studio Code.app`) |
| Linux | Python 3.11+, VS Code (`which code`), `libxcb-xinerama0 libxkbcommon-x11-0` |

The smoke tests will install Ollama automatically if it is not already present.

## Running locally

```bash
# Windows
pwsh -File tests/smoke/smoke-windows.ps1

# macOS
bash tests/smoke/smoke-macos.sh

# Linux
bash tests/smoke/smoke-linux.sh
```

Each script writes a JSON report to `tests/smoke/results/smoke-<platform>.json`. The reports summarize:

- Which installer steps ran and which failed
- Whether each component verification (VS Code extension, Ollama, backend, venv) passed
- Total elapsed time

## Interpreting results

- `success: true` in the installer JSON means all requested steps completed.
- `checks` in `verify-components.py` output contains one entry per component with `passed: true/false`.
- Any failure exits with code 1 and causes the CI job to fail.

## Arguments and flags

All smoke scripts pass `--skip-model` to the installer by default (avoids the multi-gigabyte model pull in CI). Pass `GEMMA_SMOKE_WITH_MODEL=1` to include the model step.

## CI integration

`.github/workflows/installer-smoke.yml` runs all three smoke tests on `workflow_dispatch` and on a weekly cron (Sunday 05:00 UTC). Results are uploaded as build artifacts.

## Troubleshooting

- **"VS Code not found"**: install it via your package manager before running the smoke test. The scripts do not install VS Code automatically because it requires sudo or admin privileges.
- **"Ollama already running"**: the smoke scripts reuse the existing Ollama process if it is healthy.
- **Left-over venv after a crash**: run `python tests/smoke/cleanup.py --install-path <path>` manually.
