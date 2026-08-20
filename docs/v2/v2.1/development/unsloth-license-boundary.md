# Unsloth license boundary (v2.1.0 Phase 5.1)

**Verified**: 2026-08-20
**Verdict**: required training runtime is **not AGPL**. Phase 5 may proceed. Studio and CLI extras stay excluded.

Machine-readable pins: [`core/tuning/unsloth-pins.json`](../../../core/tuning/unsloth-pins.json).

## Sources

| Artifact | URL | What it says |
|---|---|---|
| Unsloth COPYING | https://github.com/unslothai/unsloth/blob/main/COPYING | `unsloth/*`, `tests/*`, `scripts/*` are Apache 2.0. `studio/*` and `unsloth_cli/*` (optional) are AGPLv3. |
| Unsloth README / docs | https://github.com/unslothai/unsloth and https://unsloth.ai/docs/new/studio | Dual license: Core Apache 2.0, Studio UI AGPL-3.0. |
| PyPI `unsloth` 2026.8.18 | https://pypi.org/pypi/unsloth/json | `license_expression`: Apache-2.0. Requires `unsloth_zoo>=2026.8.12`. Extra `studio` pulls FastAPI/uvicorn (AGPL Studio stack). |
| PyPI `unsloth-zoo` 2026.8.13 | https://pypi.org/pypi/unsloth-zoo/json | `license_expression`: LGPL-3.0-or-later. GitHub: https://github.com/unslothai/unsloth-zoo (LGPL-3.0). |

## Provisioned (Nexus may install)

| Package | Pin | License | Role |
|---|---|---|---|
| `unsloth` | 2026.8.18 | Apache-2.0 | Core library: loaders, kernels, QLoRA helpers. |
| `unsloth-zoo` | 2026.8.13 | LGPL-3.0-or-later | Required import of current `unsloth`. Not AGPL. Used only as a Python import from the managed venv. |

`unsloth` 2026.8.18 cannot be imported without `unsloth-zoo`. The plan's STOP condition is **AGPL on a required component**. `unsloth-zoo` is LGPL-3.0-or-later, so the gate does not fire. The "Apache-only" goal is recorded as a known deviation: the required zoo package is LGPL, dynamically imported, never vendored into Nexus source.

## Excluded (must not ship)

| Artifact | License | How Nexus keeps it out |
|---|---|---|
| `unsloth[studio]` extra | AGPL-3.0 | Pip argv must not contain `[studio]`. |
| `unsloth_cli` / Studio UI + FastAPI server | AGPL-3.0 | Not listed in the provisioned set. No Studio process is started. |

## Invocation surface

Nexus-owned orchestration (installer provisioner + sidecar `tuning.*` + `runtimes/tuning/train.py`) starts the managed venv and calls `import unsloth`. No Unsloth Desktop app, no Studio web UI, no `unsloth` CLI wrapper.

## STOP check

Required AGPL component: **none**. Proceed with 5.2-5.5.
