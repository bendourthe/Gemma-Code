# Installer clean-machine test harness

v1.11.0 Phase 2 (T201-T205). One-command install verification on machines
that have NONE of the prerequisites -- the non-technical user's reality.

## The contract

Every harness drives the same headless engine mode and reads the same result:

```
NexusSetup.exe --headless-smoke <profile.json> --smoke-output <result.json>
```

- **Profile** (`testing/profiles/*.json`): which components run, which models
  are selected, and where things land. Schema in
  [`src/nexus_installer/smoke.py`](../src/nexus_installer/smoke.py).
- **Result** (`nexus-smoke-result/v1`): `success`, `steps_done`,
  `steps_failed`, `failed_models`, and the full leveled log. Exit code 0 only
  when every step succeeded.

## Windows Sandbox (primary iterate loop)

A factory-fresh Windows on every boot (Win10/11 Pro; enable the "Windows
Sandbox" feature). Fresh = no Ollama, no Python, no VS Code.

```powershell
# from scripts/installer/testing/
./run-sandbox-test.ps1                        # sandbox-minimal profile
./run-sandbox-test.ps1 -ProfileName sandbox-default   # + a small real model
```

The runner builds a `.wsb` mapping `dist/` (read-only), this folder
(read-only), and a temp output dir (writable); launches the sandbox; polls for
`result.json`; prints the summary; exits with the smoke's status. Build
`dist/NexusSetup.exe` first (`build/build-windows.ps1 -SkipSign`). The sandbox
window stays open for inspection -- close it manually.

## Docker (Linux install path)

```bash
# from scripts/installer/testing/
./run-docker-test.sh                # docker-linux profile
```

Builds a no-deps `python:3.12-slim` image (the headless path is Qt-free; only
httpx is needed), mounts the repo read-only, and runs the engine in source
mode with the same result contract.

## macOS

No virtualization path exists on the Windows host: use the manual checklist at
[`docs/v1/v1.11/testing/macos-install-checklist.md`](../../../docs/v1/v1.11/testing/macos-install-checklist.md)
on a physical Mac.

## Profiles

| Profile | Components | Models | Purpose |
|---|---|---|---|
| `sandbox-minimal` | ollama, venv | none | fastest clean-machine dependency check |
| `sandbox-default` | ollama, venv, model | nomic-embed-text | + a small real download |
| `docker-linux` | ollama, venv | none | the Linux dependency path |

Add a profile = add a JSON file; no code changes.

## Background continuation (Phase 7)

Tray detach / reattach / resume is a GUI flow, so its end-to-end checks are
operator-driven scenarios that script-verify the persisted state file. See
[`scenarios/README.md`](scenarios/README.md):

```powershell
# from scripts/installer/
./testing/scenarios/background-continuation.ps1 -Scenario close-to-tray
```

## Reading a failure

`result.json` is the truth: `steps_failed` names the step, `failed_models`
names models, and `logs` carries the plain-language reasons the engine
emitted. `console.log` (sandbox) captures raw stdout/stderr. Expected failures
on a genuinely clean machine are the harness working as intended -- file them
as known-gaps rows (e.g. the pinned-Ollama checksum gap `IO.P1.B` this harness
exists to catch).
