# Session history: v1.4.0 Phase 4 -- Safety Config SSOT

**Date**: 2026-05-30
**Cycle**: v1.4.0
**Phase**: 4 (Safety config SSOT, claude-code-harness adoption track)
**Plan reference**: [docs/versions/v1/v1.4.0/plans/adoption-claude-code-harness.md](../../plans/adoption-claude-code-harness.md)
**Source comparison**: [docs/versions/v1/v1.3.0/comparison-claude-code-harness.md](../../../v1.3.0/comparison-claude-code-harness.md)
**Acceptance scope**: adopt A1 (the harness `harness.toml` + `bin/harness sync` SSOT-generates-safety-files pattern), reimplemented as `nexus.security.toml` + an extended `scripts/generate-tool-permission-table.mjs`. Stability gate: the generator is idempotent; the CI drift gate fails on hand-edits; generated surfaces match the runtime guards.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T012 (A1 SSOT + generator) | New `nexus.security.toml` SSOT: AUTHORED `[network] egress_denylist` (A4) and `[secrets] path_denylist`, plus a GENERATED `[permissions]` mirror of `src/guardrails/PermissionTiers.ts` between `# BEGIN/END:GENERATED-PERMISSIONS` markers. Extended `scripts/generate-tool-permission-table.mjs` (now the safety-surface generator) to regenerate four artifacts from the SSOT + `PermissionTiers.ts`: the architecture-doc permission table (unchanged behavior), the TOML perms mirror, `modules/coding/utils/generated/safetyConfig.generated.ts` (egress + secret-path arrays), and the `SECRET_PATH_PATTERNS` array in `scripts/hooks/lib/secret-paths.mjs`. Added a minimal zero-dependency TOML string-array reader, a `--check` drift mode reporting all out-of-sync artifacts, and an "invoked-directly" guard so the module is importable by tests without side effects. | Closed |
| T013 (wire runtime + CI drift gate) | `modules/coding/utils/ssrf.ts` now sets `DEFAULT_DENIED_DESTINATIONS = DEFAULT_EGRESS_DENYLIST` (imported from the generated artifact); `modules/coding/utils/secretPaths.ts` imports + re-exports `SECRET_PATH_PATTERNS` from the generated artifact; the harness-hook `secret-paths.mjs` array is now generator-owned (markers added). Added `security:gen` / `security:check` npm aliases; relabeled the existing `.github/workflows/ci.yml` `perm-tier:check` step to `npm run security:check` (the drift gate now covers all three safety surfaces, not just the permission table). | Closed |
| T014 (tests + stabilization) | New `tests/unit/scripts/security-ssot-generator.test.ts` (11 assertions): `readTomlStringArray` round-trip vs. the runtime guards + comment handling + missing-key throw; `parseToolMap` tier numbers; `renderTomlPermissions` matches the committed SSOT block; `renderGeneratedTs` reproduces the committed artifact byte-for-byte (idempotency) and is deterministic; `renderArrayBody` env-marker behavior; and an end-to-end drift gate (mutate the SSOT perms mirror -> `--check` exit 1 -> regenerate -> exit 0, with a `finally` restore). All gates green; see section 4. | Closed |

## 2. Deviations from the plan text

| # | Deviation | Resolution |
|---|---|---|
| D1 | The plan prompt cites `src/utils/ssrf.ts`. | That sub-tree lives at `modules/coding/utils/ssrf.ts` (the partial-move state tracked by `1.4.P1.B`, due to close in Phase 7). Same note as Phase 2; implemented at the live paths. Informational only; no new gap. |
| D2 | The plan offered "keep `PermissionTiers.ts` canonical OR generate it from the SSOT -- pick one and document it". | Section 13 of the source comparison decides it ("avoid two sources of truth for permissions"). Decision: `PermissionTiers.ts` stays the canonical permission-tier source; the SSOT carries the tiers as a GENERATED, drift-gated mirror (not an authored second source). The egress + secret-path denylists are AUTHORED in the SSOT. Documented in the SSOT header, the generator header, and the rewired guards. Confirmed with the user before implementation. |
| D3 | The plan (T013) names `core/observability/redactSecrets.ts` among the surfaces the SSOT might drive. | The secret *value* redaction regexes there are intentionally left outside the SSOT (regexes do not round-trip cleanly through TOML and are bound to the scrubber's own logic). The plan's three named surfaces (permission tiers, egress denylist, secret-path denylist) are all covered; value-pattern SSOT integration is `future`-tier and not required by A1. Documented in the SSOT header. |
| D4 | The plan does not name the generator filename to use. | Kept the existing `scripts/generate-tool-permission-table.mjs` filename (extended, not renamed) to avoid breaking the `perm-tier` / `perm-tier:check` scripts, the CI reference, and any external callers. Added `security:gen` / `security:check` aliases for the broadened responsibility. |

## 3. Open items added to known-gaps

None. A1 landed as a behavior-preserving refactor (every current safety value is reproduced exactly, so all pre-existing `ssrf.test.ts` / `secretPaths.test.ts` / `secret-paths-sync.test.ts` assertions stay green) with full new test coverage and no bypassed gate. The v1.4.0 [known-gaps.md](../../known-gaps.md) was updated: the adoption ledger splits out T012-T014 as Resolved (A1), a Phase 4 Open-Items entry records "no new gap" with the D1-D3 deviations, a Resolved row is added, and the summary moves to 9-of-12 adoption items landed with the status line advancing to "Next: Phase 5".

## 4. Verification evidence

- `node scripts/generate-tool-permission-table.mjs --check` (`npm run security:check`) -> "All safety surfaces in sync." (exit 0): the committed doc table, TOML perms mirror, generated TS artifact, and `.mjs` secret-paths array all match a fresh regeneration -> proves idempotency.
- Drift gate negative path (covered by the new test): injecting a stray line into the SSOT `[permissions]` mirror makes `--check` exit 1; running the generator restores it and `--check` returns to exit 0.
- `npx tsc --noEmit` and `npm run build` (`tsc` emit) -> clean: the runtime guards type-check against the new generated module.
- `npm run lint` (`eslint src`) -> clean, exit 0 (no `src/*.ts` changed; the generated module lives under `modules/` and the generator is `.mjs`).
- `npm run check-architecture` (depcruise over `src core modules`) -> 0 errors, 11 pre-existing warnings (none in files this phase touched; the new generated module is a leaf data import, so it adds no orphan/boundary warning).
- `npm run check:tampering` -> 0 findings over `tests/` + `.github/workflows/` (the relabeled CI step is clean).
- `npm run check src/` (the pre-push static gate) -> 0 errors (1 pre-existing `review-pr/SKILL.md` oversized warning, unrelated).
- Targeted run (`vitest run` on the three affected suites) -> 98 passed (ssrf 69, secretPaths 28, secret-paths-sync 1): the rewiring is behavior-preserving.
- New suite (`vitest run` on `security-ssot-generator.test.ts`) -> 11 passed.
- Full suite (`npm run test --coverage`) -> 333 test files passed, 2 skipped (pre-existing), 0 failed; coverage 87.05% lines / 82.92% branches / 90.48% functions.
- A non-deterministic benchmark fixture (`tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json`) was overwritten by an unrelated memory-tier benchmark test during the full-suite run and restored with `git checkout --`, keeping the commit scoped to Phase 4.

## 5. Next steps

- Advance to Phase 5 (Operator tooling & lifecycle, A6 + A8): a non-destructive `nexus doctor --migration-report` inventory and a PreCompact WIP-detection hook on the lifecycle bus.
- The SSOT is now the standing source for the egress denylist and secret-path denylist: future changes to either surface are made in `nexus.security.toml` followed by `npm run security:gen`, and the CI drift gate (`security:check`) prevents the runtime artifacts and the harness-hook copy from drifting apart.
- When Phase 7 completes the `src/ -> modules/coding/` move (`1.4.P1.B`), the generator's `permTiersPath` may need its path updated if `PermissionTiers.ts` relocates; the generator centralizes that path in one constant.
