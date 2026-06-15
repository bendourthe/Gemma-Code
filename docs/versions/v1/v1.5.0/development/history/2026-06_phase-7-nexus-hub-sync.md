# v1.5.0 Phase 7 (FINAL) -- Nexus-Hub Sync + 6-Surface Integration + Acceptance Gate

**Date**: 2026-06-15
**Plan**: [../../plans/adoption-ecosystem-2026-06.md](../../plans/adoption-ecosystem-2026-06.md) (T023-T024)
**Branch**: `feat/v1.5.0-phase-3-inbound-security`

## Summary

Closed the v1.5.0 cycle: published the two Phase 2 skills to Nexus-Hub `develop`, integrated all four net-new Hub surfaces the v1.4.0 delta had routed forward (`HUB.P3.DATA / RULES / AGENT / CMD / HOOK / MCPCFG`), and verified the whole-plan acceptance gate. Also fixed the failing v1.5.0-branch CI/Nightly/Installer-smoke workflows and a Dependabot CI-hygiene issue surfaced mid-phase.

## Steps

1. **Resolved Phase 7 + reviewed state** against the plan, known-gaps, and the v1.4.0 integration delta (which had inventoried the Hub surfaces and routed the net-new ones to v1.5.0 as `HUB.P3.*`).
2. **CI firefight** (operator-flagged, prerequisite to release). Diagnosed from run logs and fixed, then confirmed green on the branch:
   - CI docs-sync: regenerated `docs/index.md` (stale `tools` module LOC).
   - Nightly installer package check: real `[dev]` optional-dependencies extra + `importlib.metadata.version` import check (editable-install namespace quirk).
   - Installer-smoke: `--skip-extension` (no VSIX in a source checkout), `--skip-backend`-gated venv check (backend removed in v0.4.0), correct extension id; Windows -- detect winget's auto-started Ollama instead of starting a second one, poll `127.0.0.1` (not `localhost` -> `::1`), add the missing `httpx` install step.
   - Dependabot: `fix/dependabot-ci-hygiene` (ignore `@types/vscode` minor bumps that exceed `engines.vscode`; exempt `dependabot[bot]` from the PR checklist gate).
3. **T023 -- skill publish**: re-applied the two skills onto a branch off Hub `origin/develop` (isolated worktree -- the Hub's main tree was mid-WIP), validated with `validate_skills.py`, fast-forwarded onto `develop` (`fe8eb68`). No release tag (operator decision; the Hub is mid-cycle on an unfinished v3.4.0). Generated `data/` left to a clean Hub `build-catalog`.
4. **T023 -- six Hub consumption surfaces** (each reads the active devai-hub bundle, inert when none synced):
   - `HUB.P3.DATA` (committed `04a0c43`), `HUB.P3.RULES` (`04a0c43`), `HUB.P3.AGENT` (`55833d9`), `HUB.P3.CMD` (`5641009`), `HUB.P3.HOOK` + `HUB.P3.MCPCFG` (`3e918a1`). Detail in [../nexus-hub-integration-delta.md](../nexus-hub-integration-delta.md).
5. **T024 -- acceptance gate**: lint 0, root suite 4080 / 5 skipped / 0 failed (+43), desktop 445 / 0, `tsc -b` clean, check-architecture 0 errors, check:tampering 0, check:prompts 0 errors, security:check in sync, check:audit-prod 0 blocking.
6. **Docs**: integration delta, known-gaps recompute (T023-T024 Resolved + 4 forward-tier follow-ups), DEVLOG, todos.

## Troubleshooting

- **Workflows "still failing" after the fix push**: the operator's `workflow_dispatch` ran against `main` (the default branch), which lacked the branch-only fixes. Re-dispatching against the feature branch was the resolution.
- **Windows smoke recurred twice**: PATH-not-refreshed -> then `ollama serve` "address already in use" (winget auto-starts it) + `localhost`/`::1` mismatch -> then `ModuleNotFoundError: httpx` (the Windows job lacked the deps-install step the macOS/Linux jobs had). Captured serve stdout/stderr made each cause visible.
- **CI/PR-Quality "also red"**: those runs were on a Dependabot PR (`@types/vscode` -> 1.120 breaking VSIX + no PR checklist), not the v1.5.0 line; addressed separately.
- **Hub data drift**: a fresh `build-catalog` on the Hub diverged from its committed `data/` (templates.json would have lost 46 entries); left to the Hub cycle and published SKILL.md only.

## Result

All 7 v1.5.0 phases complete; the whole-plan Definition of pass is satisfied. v1.5.0 is ready for release (merge to `main` + version bump + changelog + tag). The v1.5.0 work is not yet merged to `main`.

## Next steps

- Run `/update release` to cut v1.5.0 (merge to `main`, version bump, changelog, tag, push) -- which also greens `main` + the scheduled Nightly + the Dependabot branch.
- After a Hub release containing `develop`, run `nexus skills sync --apply` to surface the two new skills (`T023.P3.A`).
- Merge `fix/dependabot-ci-hygiene` and close/recreate the stale Dependabot PRs.
