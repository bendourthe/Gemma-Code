# CI/CD Pipeline (v0.3.0)

## Overview

```
                                       ┌──────────────┐
                                       │  PR / push   │
                                       └──────┬───────┘
                                              │
                ┌─────────────────────────────┴──────────────────────┐
                │                                                    │
                ▼                                                    ▼
        .github/workflows/ci.yml                       .github/workflows/release.yml
        (lint + test + build)                          (triggered on tag v*)
                │
                │
                └──► coverage-gate (80% threshold)
                └──► test-installer (PyQt5 unit tests, offscreen)

                                       ┌────────────────────────┐
                                       │ Manual / cron triggers │
                                       └──────┬─────────────────┘
                                              │
                 ┌────────────────────────────┼────────────────────────────┐
                 ▼                            ▼                            ▼
       nightly.yml                 golden-tasks.yml              installer-smoke.yml
       (integration w/ Ollama)     (weekly Sunday 04:00)         (weekly Sunday 05:00)
```

## Per-workflow summary

### `ci.yml`

Runs on every push and PR.

| Job | Purpose | Gate |
| --- | --- | --- |
| `lint-ts` | ESLint over `src/` | blocks merge |
| `test-ts` | Vitest unit + integration | blocks merge |
| `build-ts` | `tsc` build | blocks merge |
| `lint-py` | ruff check + format + mypy on backend | blocks merge |
| `test-py` | pytest for backend | blocks merge |
| `coverage-gate` | enforces >= 80% line coverage on TS + Python | blocks merge |
| `test-installer` | PyQt5 unit tests, `QT_QPA_PLATFORM=offscreen` | blocks merge |

### `release.yml`

Triggered by pushing a tag matching `v*`. Produces the GitHub Release with all packaged artifacts (VSIX + platform installers).

The v0.3.0 cross-platform installer builds are gated behind the `ENABLE_CROSSPLATFORM_INSTALLER` repository variable; leave unset to preserve v0.2.0 VSIX-only releases.

### `nightly.yml`

Runs daily at 02:00 UTC. Integration tests against a real Ollama process; does **not** include golden tasks or smoke tests by default (those are dedicated workflows).

### `golden-tasks.yml` (new in v0.3.0)

Runs on manual dispatch and every Sunday at 04:00 UTC. Pulls the requested Gemma 4 tier and runs the golden task suite in framework-test mode (full live runs consume runner time and GPUs that free CI does not have).

Outputs:

- `tests/golden/baselines/` as an artifact.
- A regression report when run against the previous baseline.

### `installer-smoke.yml` (new in v0.3.0)

Runs on manual dispatch and every Sunday at 05:00 UTC. Installs VS Code + Ollama on a fresh runner, executes the headless installer, verifies components, and cleans up. One job per platform: `smoke-windows`, `smoke-macos`, `smoke-linux`.

## Quality gates

| Gate | Threshold | Enforced in |
| --- | --- | --- |
| Lint errors | 0 | `ci.yml` |
| TS coverage | >= 80% lines | `ci.yml:coverage-gate` |
| Python coverage | >= 80% lines | `ci.yml:coverage-gate` |
| Build compile | `tsc` clean | `ci.yml:build-ts` |
| Golden task pass rate (E2B) | >= 90% | `golden-tasks.yml` |
| Golden task pass rate (E4B) | >= 95% | `golden-tasks.yml` |
| Installer smoke pass rate | 100% of 3 platforms | `installer-smoke.yml` |

## Secret requirements

| Secret | Used by | Required? |
| --- | --- | --- |
| `GITHUB_TOKEN` | `gh` CLI in all workflows | built-in, always set |
| `SLACK_WEBHOOK_URL` | regression-check job in `nightly.yml` | optional (post to Slack on regression) |
| `APPLE_CODESIGN_CERT` | `release.yml:build-installer-macos` | optional (notarization) |
| `WIN_CODESIGN_CERT` | `release.yml:build-installer-windows` | optional (sign .exe) |

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `coverage-gate` fails with "below 80%" | new module not covered by tests | add targeted unit tests; see [docs/archive/versions/v0/v0.3.0/performance-benchmarks.md](performance-benchmarks.md) for patterns |
| `test-installer` fails with `xcb` error | PyQt5 system deps missing | add `libxcb-xinerama0 libxkbcommon-x11-0` to the runner install step |
| `golden-tasks.yml` times out | model pull too slow on free runner | downgrade to `gemma4:e2b`, or attach a self-hosted GPU runner |
| `installer-smoke-windows` can't find `code` | `choco install vscode` finished but PATH not updated | add `refreshenv` before the smoke step |

## Where to look first when a workflow fails

1. **PR check failed?** Click the failed job, view the log, and search for the first `error` line.
2. **Nightly failed overnight?** Check `actions/artifact` for the `py-coverage` / `ts-coverage` artifact, then grep for `FAIL` in the pytest output.
3. **Golden task regression?** Download the `golden-tasks-results` artifact and inspect `baselines/<version>-<tier>.json`; run `framework/regression.py` locally against the prior baseline.
4. **Installer smoke failed?** Download the `smoke-<platform>-results` artifact; check `installer.json` for step failures and `verify.json` for component check failures.
