# Session history: v1.4.0 Phase 8 -- Wiring, Deferrals & the P1 CVE

**Date**: 2026-06-02
**Cycle**: v1.4.0
**Phase**: 8 (Known-gaps closure -- wiring, deferrals & the P1 CVE)
**Plan reference**: [docs/versions/v1/v1.4.0/plans/adoption-claude-code-harness.md](../../plans/adoption-claude-code-harness.md)
**Acceptance scope**: resolve every remaining open known-gap that is not blocked on Nexus-Hub -- the lone P1 protobufjs CVE (`7.x.P1.D`), the unwired parsers/hooks, the documented deferrals, and the benchmarks. Stability gate: `npm run check:audit-prod` clean with no remaining inherited high/critical advisory; all referenced gap IDs marked resolved; full suite green.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T025 (`7.x.P1.D` -- protobufjs CVE) | Migrated [core/memory/LocalEmbedder.ts](../../../../core/memory/LocalEmbedder.ts) off the abandoned `@xenova/transformers@2.17.2` to `@huggingface/transformers@4.2.0` (onnxruntime-web@1.26 drops onnx-proto, pulls patched protobufjs@^7.2.4); `quantized: true`->`dtype: "q8"`. Allowlist in [scripts/check-prod-audit.mjs](../../../../scripts/check-prod-audit.mjs) reduced to `brace-expansion`. `check:audit-prod`: 0 critical / 0 high / 1 moderate (was 1 critical + 3 high + 1 moderate). Commit `b048438`. | Closed |
| T026 (`5.3.P2.R`, `5.3.P3.S`, `6.1.P3.W`) | Central deny-first gate in [src/tools/ToolRegistry.ts](../../../../src/tools/ToolRegistry.ts) (`setPermissionsDeny` + `DENY_SUBJECT_PARAM`), loaded from `.nexus/permissions.deny` at [src/panels/ChatPanelBootstrap.ts](../../../../src/panels/ChatPanelBootstrap.ts) via [src/tools/ToolRegistryBuilder.ts](../../../../src/tools/ToolRegistryBuilder.ts); [core/codegraph/scanner/RepoScanner.ts](../../../../core/codegraph/scanner/RepoScanner.ts) ignore parsing unified onto `core/storage/NexusIgnore`. `no-orphans` on PermissionsDeny cleared. Commit `a076f0d`. | Closed |
| T027 (`5.4.P3.T`, `5.2.P3.Q`, `5.1.P2.P`, `5.1.P2.O`) | Session `HookBus` + `attachSessionReflectionHook` wired at bootstrap; [src/tools/AgentLoop.ts](../../../../src/tools/AgentLoop.ts) emits `lifecycle.session.reflection` at end + `reevaluateSkillsForPath` on focus change ([modules/coding/skills/SkillLoader.ts](../../../../modules/coding/skills/SkillLoader.ts) parses `pathScope`); `mcpToolLooksReadOnly` in [core/coding/SubAgentPolicy.ts](../../../../core/coding/SubAgentPolicy.ts) wired into [modules/coding/agents/SubAgentManager.ts](../../../../modules/coding/agents/SubAgentManager.ts) explore filter. Commit `3a2852f`. | Closed |
| T028 (`6.2.P2.X`, `6.2.P3.Y`, `6.3.P2.Z`) | `lspInstallInstructions` + enriched missing-server error in [core/coding/lsp/LspClient.ts](../../../../core/coding/lsp/LspClient.ts); definition/references subset documented closed; `isomorphic-dompurify` adopted in [desktop/src/components/InteractiveArtifact.tsx](../../../../desktop/src/components/InteractiveArtifact.tsx). Commit `fd04d4e`. | Closed |
| T029 (`2.4.P2.E`, `2.4.P3.F`, `4.3.P3.M`, `4.x.P3.N`, `3.4.P3.H`, `3.5.P3.I`, `6.1.P3.U`) | Deleted dead `preToolHook` + test; codegraph-trim notice (`computeToolActivation.trimmedCodegraph` -> `PromptContext.toolCapNotice`, rendered by [PromptBuilder.ts](../../../../modules/coding/chat/PromptBuilder.ts)); five closures-with-rationale documented at each site. Commit `0672871`. | Closed |
| T030 (`4.4.P2.L`, `7.1.P2.A`, `T012.P2.C`, `T013.P3.D`) | Published [benchmarks/memory-storage-size-2026-06-02.md](../../benchmarks/memory-storage-size-2026-06-02.md) (100k sweep, `lastBuildMethod: hnsw`, recall 96.5%); `scanUsage` widened to multi-root in [core/skills/SkillUsageScanner.ts](../../../../core/skills/SkillUsageScanner.ts); token-benchmark + MinHash closed with rationale. Commit `dcd843f`. | Closed |
| T031 (tests + stabilization + ledger) | Full gate battery green; 22 carryforward gaps marked resolved in [known-gaps.md](../../known-gaps.md); plan checkboxes ticked; DEVLOG + this file. | Closed |

## 2. Decisions confirmed with the user before coding

- **Run scope**: full phase, committing per sub-task (pause only for blockers).
- **T025 CVE strategy**: attempt migrating to `@huggingface/transformers@4.x` (plan option (a) was infeasible -- 2.17.2 is the final `@xenova` release), falling back to a re-justified allowlist if the embedder broke. The migration succeeded; no fallback needed.

## 3. Deviations / scope decisions (no new correctness gaps)

| # | Deviation | Resolution |
|---|---|---|
| D1 | T025 plan option (a) "upgrade `@xenova/transformers`". | Infeasible (2.17.2 is its final release). Resolved via option (b), the maintained `@huggingface/transformers@4.x`; the entire protobufjs chain disappears from the prod audit. |
| D2 | T026 plan says deny-check "after the existing path-guard and ALLOWED_COMMANDS checks (start with run_terminal)". | Implemented as a central pre-dispatch gate in `ToolRegistry` covering every write-capable tool (run_terminal + file tools), which is deny-first and additive to (does not bypass) the in-handler guards. More complete than run_terminal-only and DRY. |
| D3 | T027 `5.2.P3.Q` had no production seam (SkillLoader carried no path-scope; no SkillCatalog in the loop). | Built the real mechanism end-to-end (loader frontmatter parse + AgentLoop focus-change reevaluation + skill.entry emit), unit-tested. Visible activation scales with how many skills author `pathScope` frontmatter (a content choice). Mechanism is `supported`. |
| D4 | T029 `2.4.P3.F` / `4.3.P3.M` / `4.x.P3.N` / `3.4.P3.H` / `6.1.P3.U` + T030 `7.1.P2.A` / `T013.P3.D`. | Closed with documented rationale (the plan offered "document closure" for several). Each rationale is a code-site comment; the canonical record is the known-gaps Resolved table. |
| D5 | T016.P3.A (A8 PreCompact daemon wiring) not closed despite the bootstrap now creating a HookBus. | `attachPreCompactWipHook` is not attached because no production code emits `lifecycle.context.preCompact` on that bus yet -- attaching it would be inert. Left open; the bootstrap HookBus makes the future wiring trivial. |

## 4. Open items added to known-gaps

**None.** Phase 8 introduced 0 new gaps. The only carryforward still open is the 4 Nexus-Hub-dependent items (`1.1.P2.A`, `1.1.P3.B`, `T017.P3.E`, `T002.P2.A`) handled in Phase 9. Three v1.2.0 items outside the plan's Phase 8 scope are dispositioned in the ledger: `7.x.P3.B` / `7.x.P3.C` (self-documented no-action path typos) and `1.3.P2.C` (satisfied by the existing `.claude/` harness hooks -- Phase 9 confirm-and-close).

## 5. Verification evidence

- `npm run test` -> 339 files passed, 2 skipped; 3901 tests passed, 5 skipped, 0 failed (was 3888 pre-phase; +13 new).
- `npm run test:shell` (desktop) -> 47 files, 418 tests passed, 0 failed.
- `npm run check:audit-prod` -> 0 high/critical; 1 allowlisted moderate (`brace-expansion`). `npm run check:tampering` -> 0 findings. `npm run security:check` -> all safety surfaces in sync.
- `npm run build` (`tsc -b`) clean; `npm run lint` (`eslint src modules`) + `npm run lint:shell` clean; `npm run check-architecture` -> 0 errors / 10 warnings (down from 11; the `PermissionsDeny.ts` no-orphans warning cleared).
- New/updated tests: ToolRegistry deny gate (4), AgentLoop reflection + reevaluate (4), SubAgentPolicy MCP classifier (11), SkillLoader pathScope (2), ToolActivationRules trim flag (2), LspClient install instructions (1), SkillUsageScanner multi-root (2). 6 dead `preToolHook` tests removed.
- 100k memory benchmark captured via a temporary long-timeout runner (deleted after the run); numbers published in the benchmark doc.

## 6. Next steps

- Advance to Phase 9 (FINAL, T032-T035): inspect the latest Nexus-Hub, integrate its catalog, close the 4 Hub-dependent gaps (`1.1.P2.A`, `1.1.P3.B`, `T017.P3.E`, `T002.P2.A`; confirm-and-close `1.3.P2.C`), and run the whole-plan acceptance gate + version bump.
- Carry the four v1.4.0-introduced opt-in/wiring deferrals (`T016.P3.A`, `T018.P3.A`, `T018.P3.B`, `T022.P3.A`) per their existing suggested next steps; none is a release blocker.
