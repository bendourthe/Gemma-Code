# Session History — Phase 8: Golden Task Suite & Integration Stabilization

**Date:** 2026-04-16
**Plan reference:** [docs/v0.3.0/implementation-plan.md §Phase 8](../../implementation-plan.md)
**Branch:** `main`
**Scope decision:** Full 24-task plan accepted (vs reduced subset); installer CLI flags added in Phase 8; CI changes conservative; E2E tests fully mocked.

---

## Subtasks completed

| Sub-task | Deliverable | Status |
| --- | --- | --- |
| 8.1 | Golden task framework (types, loader, runner, evaluator, reporter, snapshot) | Complete |
| 8.2 | 24 golden task YAMLs + 24 self-contained snapshot directories | Complete |
| 8.3 | Per-tier benchmarks (TS) + baseline/regression framework (Python) | Complete |
| 8.4 | Installer CLI flags (`--headless`, `--model`, `--install-path`, `--skip-model`, `--json-output`) + cross-platform smoke scripts + helpers | Complete |
| 8.5 | 6 E2E integration tests with full mocks | Complete |
| 8.6 | `comparison.py` + v0.3.0 architecture doc + performance-comparison template + ARCHITECTURE/CHANGELOG/README/docs/todos updates | Complete |
| 8.7 | `golden-tasks.yml` + `installer-smoke.yml` + release checklist + CI pipeline doc | Complete |
| 8.T | Lint pass on new Python code, all new tests green, no regressions on existing suite | Complete |

---

## Artifacts created

### Python

- `tests/golden/framework/__init__.py`, `types.py`, `task_loader.py`, `task_runner.py`, `evaluator.py`, `reporter.py`, `snapshot.py`, `baseline.py`, `regression.py`, `comparison.py`
- `tests/golden/framework/test_task_loader.py`, `test_evaluator.py`, `test_reporter.py`, `test_snapshot.py`, `test_task_runner.py`, `test_baseline.py`, `test_regression.py`, `test_comparison.py`
- `tests/golden/conftest.py`, `tests/golden/pyproject.toml`, `tests/golden/README.md`
- `tests/golden/snapshots/_scaffold.py` (lazy git-init helper, idempotent)
- `tests/golden/baselines/v0.3.0-{e2b,e4b}.json` (stub files)
- `tests/smoke/verify-components.py`, `cleanup.py`, `test_verify_components.py`, `test_cleanup.py`

### YAML + snapshots

- `tests/golden/tasks/*.yaml` x 24
- `tests/golden/snapshots/*/` x 24 (each with `package.json`, `tsconfig.json`, `.gitignore`, `README.md`, `src/` files, optional `tests/` files)

### TypeScript

- `tests/benchmarks/model-tier-matrix.bench.ts`, `memory-recall.bench.ts`, `golden-task-perf.bench.ts`
- `tests/integration/e2e/full-pipeline.test.ts`, `memory-across-sessions.test.ts`, `compaction-under-load.test.ts`, `sub-agent-verification.test.ts`, `mcp-tool-integration.test.ts`, `prompt-budget-compliance.test.ts`

### Shell

- `tests/smoke/smoke-windows.ps1`, `smoke-macos.sh`, `smoke-linux.sh`, `tests/smoke/README.md`

### Workflows

- `.github/workflows/golden-tasks.yml`
- `.github/workflows/installer-smoke.yml`

### Docs

- `docs/v0.3.0/architecture.md`
- `docs/v0.3.0/performance-benchmarks.md`
- `docs/v0.3.0/performance-comparison.md`
- `docs/v0.3.0/release-checklist.md`
- `docs/v0.3.0/ci-pipeline.md`

---

## Artifacts modified

- `scripts/installer/pyqt/src/gemma_installer/main.py` — 5 new CLI flags + `_run_headless()` path
- `ARCHITECTURE.md` — new v0.3.0 additions table
- `CHANGELOG.md` — `## [0.3.0]` section (Phase 7 + Phase 8)
- `README.md` — cross-platform installer docs, headless mode, golden task testing, troubleshooting entries
- `docs/todos.md` — Phase 8 marked complete, metrics updated to 55/55
- `.gitignore` — added `tests/golden/.worktrees/`, `tests/smoke/results/`, snapshot `.git/` and `node_modules/`

---

## Test results

| Suite | Pass | Fail | Notes |
| --- | --- | --- | --- |
| Golden framework (Python) | 44 | 0 | loader / evaluator / reporter / snapshot / runner / baseline / regression / comparison |
| Smoke helpers (Python) | 7 | 0 | cleanup + verify-components unit tests |
| E2E integration (TypeScript) | 26 | 0 | full-pipeline, memory, compaction, sub-agent, mcp, prompt-budget |
| TypeScript full suite | 952 | 5 pre-existing | failures in GraphMemory/GraphQueryEngine/extension pre-date Phase 8, confirmed via `git stash` |
| TypeScript build | Clean | — | `tsc` no errors |
| Workflow YAML parse | 5/5 | 0 | ci, release, nightly, golden-tasks, installer-smoke |
| Python ruff | Clean | — | all new code passes |

Coverage of the golden framework by its own unit tests is above 80% on the pure-Python modules. The `task_runner.py` live path is not covered by unit tests (requires a real backend); this is intentional and documented in the plan.

---

## Deviations from the original plan

1. **CI scope reduced** per user direction: new workflows are `workflow_dispatch` + weekly cron only; `ci.yml`/`release.yml`/`nightly.yml` were not modified for Phase 8. This preserves existing CI stability. Release packaging for cross-platform installers remains behind `ENABLE_CROSSPLATFORM_INSTALLER` as designed in Phase 7.
2. **E2E tests use full mocks** rather than requiring Ollama, per user choice. Live integration is exercised by the weekly `golden-tasks.yml` workflow instead of per-PR CI.
3. **Snapshot git initialization is lazy** via `_scaffold.py` rather than pre-committing each snapshot's `.git/` directory, because nested git repos inside the main repo would cause untracked/submodule confusion.
4. **Pre-existing lint errors** in `src/safety/` and `src/tools/ToolRegistry.ts` (from Phases 4/6) were **not** cleaned up, following the "every changed line must trace to the user's request" rule.
5. **`ci.yml`** was found to already include installer unit tests (from Phase 7), so no additional modification was needed for Phase 8.

---

## Known limitations and follow-ups

- The live `task_runner.py` path talks to a Gemma Code backend endpoint (`/chat`) that does not yet accept a `workdir` parameter. Phase 8 ships the integration contract; the backend enhancement is deferred until first live golden-task run.
- The installer Windows/macOS/Linux PyInstaller builds are not exercised end-to-end in Phase 8 CI; `installer-smoke.yml` runs the headless CLI against source, which catches the same surface but not packaging regressions. Phase 7's release workflow still owns that path.
- `docs/v0.3.0/performance-comparison.md` is a template; numbers fill in once baselines exist for both v0.2.0 and v0.3.0.
- Pre-existing TypeScript test failures (GraphMemory prune / GraphQueryEngine query / extension.ts activation) predate Phase 8. Suggested follow-up: triage in a dedicated fix PR after v0.3.0 release.

---

## Next steps toward v0.3.0 release

1. Review [docs/v0.3.0/release-checklist.md](../../release-checklist.md) and triage any outstanding CI failures.
2. Run `python tests/golden/snapshots/_scaffold.py` to initialize per-snapshot git repos before first live run.
3. Execute `golden-tasks.yml` workflow manually against E2B to validate end-to-end; save the baseline.
4. Ship v0.3.0 per the release checklist once quality gates are green.
