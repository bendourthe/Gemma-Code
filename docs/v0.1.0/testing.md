# Testing Guide — Gemma Code v0.1.0

## Overview

The test suite is organized into four tiers:

| Tier | Location | Runner | Requires Ollama |
|---|---|---|---|
| Unit (TypeScript) | `tests/unit/` | Vitest | No |
| Unit (Python) | `src/backend/tests/unit/` | pytest | No |
| Integration | `tests/integration/`, `src/backend/tests/integration/` | Vitest / pytest | Optional |
| E2E | `tests/e2e/` | @vscode/test-electron + Playwright | No |
| Installer (unit) | `tests/unit/installer/` | PowerShell | No |
| Installer (integration) | `tests/integration/installer/` | PowerShell | No |

---

## Running the Standard Test Suites

```bash
# TypeScript unit tests (fast, no external services)
npm run test

# Python backend unit tests
cd src/backend
uv run pytest tests/unit -q

# TypeScript integration tests (set OLLAMA_URL to skip Ollama-gated tests)
npm run test:integration

# Python backend integration tests
cd src/backend
uv run pytest tests/integration -q
```

---

## Running Installer Tests

### Unit tests (no installer required)

The installer unit tests validate the PowerShell prerequisite-detection logic
(VS Code, Ollama, Python) against the current machine environment. They run on
any Windows machine without NSIS or a built installer.

```powershell
# From the repo root
pwsh -NonInteractive -File tests\unit\installer\nsis-logic.test.ps1
```

Expected output on a developer machine with VS Code and Python installed:

```
=== VS Code Detection Tests ===
[PASS] Find-VSCode returns a non-empty string when VS Code is installed
[PASS] Find-VSCode result is a .cmd file or empty string

=== Ollama Detection Tests ===
[PASS] Find-Ollama returns "found" or empty string (never throws)
...

Results: 8 passed, 0 failed
```

### Integration tests (requires a built installer)

The integration tests simulate the full install sequence and must run on a
machine (or VM) where you can safely create and delete a Python venv and install
the VS Code extension.

**Recommended environments:**

- Windows Sandbox (free, built into Windows 10/11 Pro): provides a disposable
  fresh Windows environment that is destroyed on close.
- Docker Desktop with a Windows container image (e.g., `mcr.microsoft.com/windows/servercore:ltsc2022`).

**Steps:**

1. Build the VSIX and installer:
   ```powershell
   pwsh -NonInteractive -File scripts\installer\build-installer.ps1 -SkipSign
   ```
2. Install VS Code inside the sandbox (download from https://code.visualstudio.com).
3. Copy the built `.vsix` file to the sandbox.
4. Run the integration test:
   ```powershell
   pwsh -NonInteractive -File tests\integration\installer\test-install-sequence.ps1
   ```

The test script:
- Installs the extension via `code --install-extension`
- Verifies the extension appears in `code --list-extensions`
- Creates a Python venv at `%LOCALAPPDATA%\GemmaCode\venv`
- Installs backend dependencies from `scripts/installer/backend-requirements.txt`
- Verifies the venv and extension are cleanly removed by the uninstaller logic

---

## Running E2E Tests

The E2E tests use `@vscode/test-electron` to launch a real VS Code instance and
Playwright to inspect the rendered workbench.

### Setup

```bash
# Install E2E dependencies (one-time)
npm install --save-dev @vscode/test-electron playwright
npx playwright install chromium
```

### Running

```bash
# Build the extension first
npm run build

# Launch E2E tests (downloads VS Code stable if not cached)
node tests/e2e/extension-load.test.js
```

The test:
1. Downloads VS Code stable (cached in `~/.vscode-test/` after first run).
2. Launches VS Code with the extension loaded from `EXTENSION_ROOT` and remote
   debugging enabled on port 9229.
3. Connects Playwright to VS Code's Chromium layer.
4. Asserts that the Gemma Code activity bar icon is visible.
5. Opens the chat panel and verifies it renders even without Ollama running.
6. Sends `/help` to the chat input and checks for help-related output.

### Environment notes

- The test intentionally does **not** start Ollama. The extension should degrade
  gracefully by showing an "Ollama unreachable" status message.
- If Ollama happens to be running locally, the `/help` assertion will exercise
  the live command routing path.

---

## CI Integration

| Workflow | Tests run | Ollama available |
|---|---|---|
| `ci.yml` (every push) | Unit + mocked integration | No |
| `nightly.yml` (daily) | Full integration + E2E (gemma4:e2b) | Yes |
| Manual `workflow_dispatch` | Full integration + E2E | Yes |

The nightly workflow installs Ollama and pulls `gemma4:e2b` (the smallest Gemma 4 variant) to keep download times reasonable. The full `gemma4` model is only used in the installer's optional model-download section.
