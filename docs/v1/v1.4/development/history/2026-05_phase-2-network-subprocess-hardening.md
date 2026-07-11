# Session history: v1.4.0 Phase 2 -- Network & Subprocess Hardening

**Date**: 2026-05-30
**Cycle**: v1.4.0
**Phase**: 2 (Network & subprocess hardening, claude-code-harness adoption track)
**Plan reference**: [docs/versions/v1/v1.4.0/plans/adoption-claude-code-harness.md](../../plans/adoption-claude-code-harness.md)
**Source comparison**: [docs/versions/v1/v1.3.0/comparison-claude-code-harness.md](../../../v1.3/comparison-claude-code-harness.md)
**Acceptance scope**: adopt A4 (a named outbound-egress denylist layered onto the existing SSRF guard) and A5 (secret-bearing environment-variable scrubbing for `run_terminal` child processes), both reimplemented in Nexus's TS/Node stack. Stability gate: `npm run test`, `npm run lint`, `npm run check-architecture` clean; new SSRF and terminal tests pass; existing terminal behaviour preserved under the env-scrub allowlist.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T006 (A4) | Egress denylist in `modules/coding/utils/ssrf.ts`: `DEFAULT_DENIED_DESTINATIONS` (cloud-metadata endpoints 169.254.169.254 / metadata.google.internal / metadata.azure.com; paste/file-drop hosts pastebin.com / transfer.sh / 0x0.st / paste.ee / termbin.com / ix.io) + `isDeniedDestination` (exact-or-sub-domain, bracket/case-normalized), wired into `isSsrfBlockedSync` and `isSsrfBlocked`. Because `fetchWithSsrfGuard` re-runs `isSsrfBlocked` per redirect hop, the denylist is enforced pre- and post-redirect across all three guard consumers (`OtlpExporter`, `webSearch`/fetch_page, `webCache`). Extensible per-call (`deniedDestinations` option) and at runtime via `configureDeniedDestinations`, seeded from the new `nexus.coding.egressDenyExtra` setting at the `NexusCodingRuntime` composition root. | Closed |
| T007 (A5) | New `core/observability/scrubEnv.ts`: `scrubEnv(baseEnv, { allowlist })` drops secret-bearing variables by NAME (`isSensitiveEnvName`) and by VALUE (`valueLooksLikeSecret`, reusing `detectSecretCategories` from `redactSecrets.ts`). `src/tools/handlers/terminal.ts` now passes `env: this._childEnv()` to `spawn`; scrubbing is on by default (`nexus.coding.terminalEnvScrub`), reversible, with an opt-in passthrough allowlist (`nexus.coding.terminalEnvScrubAllowlist`). Non-sensitive vars (PATH, HOME, ...) still flow through. | Closed |
| T008 | Tests + stabilization: extended `tests/unit/utils/ssrf.test.ts` (egress-denylist suite), added `tests/unit/core/observability/scrubEnv.test.ts`, extended `tests/unit/tools/handlers/terminal.test.ts` (child-env assertions via the mocked spawn). All gates green; see section 4. | Closed |

## 2. Deviations from the plan text

| # | Deviation | Resolution |
|---|---|---|
| D1 | The plan prompts cite `src/utils/ssrf.ts` (A4) but that path no longer exists. | The `src/utils/` sub-tree was migrated to `modules/coding/utils/` in v1.1.0 Phase 3 (the partial-move state tracked by gap `1.4.P1.B`, due to close in Phase 7). The denylist was implemented at the live path `modules/coding/utils/ssrf.ts`; its test already imported from there. Informational only; no new gap. |
| D2 | A4 requires the denylist to "apply to FetchPageTool, WebSearchTool, and the OTLP exporter". | Satisfied structurally by adding the check inside the shared guard functions (`isSsrfBlockedSync` / `isSsrfBlocked`) rather than editing each consumer, since all three already route through the guard. This also guarantees the per-redirect-hop re-check for free via `fetchWithSsrfGuard`. |
| D3 | An unrelated benchmark fixture (`tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json`) appeared modified after the suite run. | The diff was only host-dependent timing values (`ingestMs` / `compactMs`) rewritten by a benchmark test, not part of this phase. Reverted with `git checkout --` to keep the commit scoped to the A4/A5 changes. |

## 3. Open items added to known-gaps

None. A4 and A5 both landed with full test coverage and no bypassed gate. The v1.4.0 [known-gaps.md](../../known-gaps.md) was updated: the adoption ledger marks T006-T008 resolved (A4, A5), a Phase 2 Open-Items entry records "no new gap" with the D1/D2 deviations, the summary counts move to 6-of-12 adoption items landed, and the status line advances to "Next: Phase 3".

## 4. Verification evidence

- `npx tsc --noEmit` -> clean (no output, exit 0).
- `npm run lint` (`eslint src`) -> clean, exit 0.
- `npm run check-architecture` (depcruise over `src core modules`) -> 0 errors, 11 pre-existing warnings (no-orphans / no-circular on prior-cycle files; none on the files this phase touched). `scrubEnv.ts` is consumed by `terminal.ts`, so it is not an orphan.
- Targeted run (`vitest run` on the three touched test files) -> 144 passed (ssrf 69, scrubEnv 38, terminal 37).
- Full suite (`npm run test -- --coverage`) -> 3782 passed, 5 skipped, 0 failed (333 files); overall coverage 87.05% lines / 82.92% branches / 90.48% functions; `core/observability/scrubEnv.ts` 100% all metrics; `src/tools/handlers/terminal.ts` 87.79% lines.
- Behaviour preservation: the existing terminal tests (mocked `spawn`) stay green; the new env passthrough keeps PATH and non-sensitive vars, so git/npm/node/test commands are unaffected.

## 5. Next steps

- Advance to Phase 3 (Static-analysis & CI gates): A2 (test-tampering detection rules under `lib/checks/` for `nexus-check`) and A9 (OpenSSF Scorecard CI workflow at `.github/workflows/scorecard.yml`).
- The `nexus.coding.egressDenyExtra` setting is now the operator surface for extending the egress denylist; the A4 denylist and A5 env-scrub become standing protections for every later phase that spawns commands or makes outbound requests.
- Phase 7 (`1.4.P1.B`) will complete the `src/` -> `modules/coding/` move; once `terminal.ts` migrates, the A5 wiring moves with it (no logic change expected).
