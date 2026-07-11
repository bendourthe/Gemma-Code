# Session history: v1.4.0 Phase 5 -- Operator Tooling & Lifecycle

**Date**: 2026-05-30
**Cycle**: v1.4.0
**Phase**: 5 (Operator tooling & lifecycle, claude-code-harness adoption track)
**Plan reference**: [docs/versions/v1/v1.4.0/plans/adoption-claude-code-harness.md](../../plans/adoption-claude-code-harness.md)
**Source comparison**: [docs/versions/v1/v1.3.0/comparison-claude-code-harness.md](../../../v1.3/comparison-claude-code-harness.md)
**Acceptance scope**: adopt A6 (the harness `bin/harness doctor --migration-report` non-destructive stale-state inventory) and A8 (the harness `hooks.json` PreCompact/PostCompact handlers -- warn on in-flight work before context compaction plus a restorable checkpoint). Stability gate: `nexus doctor --migration-report` runs read-only; the PreCompact hook fires on the lifecycle bus and warns on WIP without blocking compaction.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T015 (A6 -- `nexus doctor`) | New pure inventory module [core/diagnostics/DoctorReport.ts](../../../../core/diagnostics/DoctorReport.ts): `buildDoctorReport(inputs)` walks five stale-state surfaces -- legacy `~/.gemma-code/` (warn when a real dir, info when a symlink), the migration marker, known cache dirs under `~/.nexus/` (stale when older than a threshold, default 30 days), duplicate skill names across roots, dangling/live symlinks, and memory state -- using only read APIs (`existsSync`/`readdirSync`/`statSync`/`lstatSync`/`readFileSync`). `formatDoctorReport` renders grouped sections; `--migration-report` widens detail to per-entry paths + suggestions. Wired into [bin/nexus.mjs](../../../../bin/nexus.mjs) as `nexus doctor [--migration-report] [--json] [--home] [--legacy-home] [--skills-root] [--stale-days]`, reusing the existing `skillRootsFor` resolver. Read-only by contract; exits 0 regardless of findings. | Closed |
| T016 (A8 -- PreCompact WIP hook) | New [core/lifecycle/PreCompactHook.ts](../../../../core/lifecycle/PreCompactHook.ts) mirroring the `attachSessionReflectionHook` reference shape: `attachPreCompactWipHook(bus, opts)` subscribes to the EXISTING `lifecycle.context.preCompact` event (no new event kind, honoring "reuse the existing 13-event bus"). On each event it runs `detectWip` (uncommitted git edits via `git status --porcelain` + caller-supplied in-flight tasks), persists a `CompactionCheckpoint` to `~/.nexus/checkpoints/<sessionId>.json`, and -- only when WIP is present -- emits a non-blocking `lifecycle.notification` (severity "warning"). `readCompactionCheckpoint(sessionId)` is the PostCompact restore primitive. The hook never throws (a failing git probe, checkpoint write, or notification must not block compaction). | Closed |
| T017 (tests + stabilization) | New [tests/unit/core/diagnostics/DoctorReport.test.ts](../../../../tests/unit/core/diagnostics/DoctorReport.test.ts) (11 assertions: empty/clean report, legacy warn, migration marker, stale-vs-fresh cache, cross-root duplicate skills, memory state, symlink live/dangling via injected fs, migration-report rendering, `formatBytes`, read-only re-run), [tests/integration/doctor-cli.test.ts](../../../../tests/integration/doctor-cli.test.ts) (4 tests: section rendering, `--json` shape, `--migration-report` detail, and a before/after tree snapshot proving the read-only contract end-to-end against the compiled artifact), and [tests/unit/core/lifecycle/PreCompactHook.test.ts](../../../../tests/unit/core/lifecycle/PreCompactHook.test.ts) (20 tests: porcelain parsing incl. rename arrow, WIP detection + degradation, checkpoint build, warning render + file cap, hook fires/writes/warns, clean-tree no-warning, wrong-kind no-fire, never-throws on write failure, dispose unsubscribes, checkpoint round-trip + null paths). | Closed |

## 2. Deviations from the plan text

| # | Deviation | Resolution |
|---|---|---|
| D1 | The A8 prompt says "plus a state checkpoint that PostCompact can restore", but the lifecycle bus has only a `lifecycle.context.preCompact` event (which already carries both `beforeTokens` and `afterTokens`); there is no `postCompact` event. | Honored "reuse the existing 13-event lifecycle bus" literally: did NOT add a 14th event kind. The "PostCompact can restore" half is satisfied by persisting the checkpoint on `preCompact` and exposing `readCompactionCheckpoint(sessionId)` as the restore primitive a post-compaction caller invokes. Informational; no new gap. |
| D2 | A8 ships as an attachable hook (`attachPreCompactWipHook`) that is unit-tested but not yet called at daemon session construction. | This mirrors the existing `attachSessionReflectionHook`, whose live daemon wiring is itself the open gap `5.4.P3.T`. A8's acceptance (the hook fires on the PreCompact event and warns without blocking) is met without daemon wiring. Recorded as `T016.P3.A` (P3/DF) so Phase 8 (T027) live-wires both hooks together. |
| D3 | The plan's testing sub-task suggests `tests/unit/lifecycle/`; the repo's lifecycle unit tests live at `tests/unit/core/lifecycle/`. | Placed the new hook test alongside `HookBus.test.ts` / `SessionReflectionHook.test.ts` at the established `tests/unit/core/lifecycle/` path. Informational; no new gap. |

## 3. Open items added to known-gaps

One: `T016.P3.A` (P3 / DF) -- the A8 PreCompact hook's live daemon wiring, deferred to Phase 8 (T027) alongside the parallel reflection-hook wiring gap `5.4.P3.T`. A6 landed fully live-wired (reachable from the CLI `main()` switch). The v1.4.0 [known-gaps.md](../../known-gaps.md) was updated: the adoption ledger splits T015-T017 as Resolved (A6, A8), a Phase 5 Open-Items section records the single deferral with all four required fields, two Resolved rows are added, and the summary advances to 11-of-12 adoption items landed (only A10 remains, Phase 6).

## 4. Verification evidence

- `npm run build` (`tsc` emit) -> clean: the new `core/diagnostics/` and `core/lifecycle/` modules type-check and emit to `out/` (the integration test imports the compiled artifact).
- Targeted run (`vitest run` on the three new suites + adjacent `HookBus.test.ts`, `SessionReflectionHook.test.ts`, `nexus-cli.test.ts`) -> 58 passed.
- `npm run lint` (`eslint src`) -> clean, exit 0 (no `src/*.ts` changed; the new modules live under `core/` and the CLI surface is `.mjs`, both outside the `eslint src` scope by project convention).
- `npm run check-architecture` (depcruise over `src core modules`) -> 0 errors, 11 pre-existing warnings (none in files this phase touched; neither new module is flagged -- CLI-only `core` modules follow the established `SkillAuditor`/`SessionReflectionHook` pattern).
- `npm run check:tampering` -> 0 findings over `tests/` + `.github/workflows/` (the three new test files pass the anti-tampering rules: no `.only`, no unjustified `.skip`, no tautological/commented-out assertions).
- `npm run check src/` (the pre-push static gate) -> 0 errors (1 pre-existing `review-pr/SKILL.md` oversized warning, unrelated).
- New-file coverage (scoped run): `core/diagnostics/DoctorReport.ts` 90.25% lines / 81.55% branches / 100% functions; `core/lifecycle` dir 92.22% lines.
- Full suite (`npm run test --coverage`) -> 336 test files passed, 2 skipped (pre-existing), 0 failed; 3863 tests passed, 5 skipped; coverage 87.09% lines / 82.84% branches / 90.52% functions (all above the 80/75/80 gates).
- A non-deterministic benchmark fixture (`tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json`) was overwritten by an unrelated memory-tier benchmark test during a full-suite run and restored with `git checkout --`, keeping the commit scoped to Phase 5.

## 5. Next steps

- Advance to Phase 6 (Parallel agent execution, A10): optional git-worktree isolation for concurrently-dispatched write-capable sub-agents in `src/agents/SubAgentManager.ts`, opt-in / default-off, with worktree cleanup when unchanged.
- Phase 8 (T027) should live-wire both `attachPreCompactWipHook(hookBus)` and `attachSessionReflectionHook(hookBus)` at session construction (closing `T016.P3.A` and `5.4.P3.T`) and add an integration test proving the PreCompact warning fires on a real compaction.
- The `nexus doctor` inventory is read-only by design; a future, separately-gated `--fix` surface (or `nexus doctor clean`) could act on the warn-level findings, but that is out of scope for A6 and not currently planned.
