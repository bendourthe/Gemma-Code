# v1.1.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: live (cycle opened at Phase 1, 2026-05-18; Phase 2 rebrand + core extraction landed 2026-05-19)
**Audience**: v1.1.0 phase authors, code reviewer, security reviewer, ops engineer, future-cycle planners
**Last updated**: 2026-05-19
**Sibling reviews**: [docs/v1.0.0/known-gaps.md](../v1.0.0/known-gaps.md) (the upstream cycle gap log this file inherits from); [docs/v1.1.0/plans/v1.1.0-cycle.md](plans/v1.1.0-cycle.md) (the active plan); [docs/v1.1.0/plans/phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) (Phase 1 detail); [docs/v1.1.0/plans/phase-02-rebrand-and-core-extraction.md](plans/phase-02-rebrand-and-core-extraction.md) (Phase 2 detail).

**Cycle context**: v1.1.0 is the stabilization-plus-expansion cycle. Phase 1 (commit `ec3ff0e`) opened the carryforward closure sweep with bounded items (storage-path rename, deprecationMessage injection, curator-cadence delete, CRLF/LF snapshot normalization, shared-core decision document). Phase 2 (this commit) closes the rebrand + sidecar core-extraction half of the deferred Phase 1 work (manifest IDs, npm package rename, sidecar duplicate model catalogs). The heavier deferred items (TypeScript project-references wiring, wholesale `src/` -> `modules/coding/` move, `NexusCodingRuntime` wiring, Tailwind v4) stay open as a future Phase 1c follow-up cluster. The remaining cycle phases (3-15) then layer agentmemory + SANA adoptions plus the cross-OS installer and Nexus VS Code extension on top of the v1.0.0 four-pillar app. The known-gaps file is appended phase-by-phase; items move to `## 2. Resolved` when closed in a later phase, and the `## 3. Summary` at the bottom is recomputed each pass. The file is finalized at v1.1.0 release (Phase 15 RTM).

Each entry has a severity tag:

- **P0** -- release-blocker for v1.1.0 (must close)
- **P1** -- should-fix in v1.1.0
- **P2** -- nice-to-have; documented for completeness
- **P3** -- out-of-scope for v1.1.0; explicitly recorded for future planning

Each entry has a category tag:

- **NI** (not implemented) -- a plan sub-task that was skipped
- **DF** (deferred) -- a plan sub-task explicitly deferred to a later phase / cycle
- **BG** (bug) -- a deviation that revealed a real defect
- **MT** (missing tests) -- a coverage shortfall
- **WN** (warning) -- a suppressed lint or runtime warning
- **QG** (quality gate) -- a Phase 7 gate the cycle author bypassed with "Proceed anyway"

---

## 1. Open Items

### 1.1.P1.A -- TypeScript project-references wiring deferred (DF, P1)

- **Source phase**: Phase 1 (1.1)
- **Plan reference**: [phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) sub-task 1.1 ("Land the TypeScript project-references infrastructure ... `tsc -b` from the repo root builds `core/`, `src/`, and `desktop/sidecar/` in dependency order").
- **Reason**: The decision document at [docs/v1.1.0/development/decisions/shared-core-build.md](development/decisions/shared-core-build.md) records option (a) -- project references with `composite: true` on `core/` -- as the chosen strategy. The actual wiring (new `core/tsconfig.json`, `references` arrays in the root and `desktop/tsconfig.json`, switching `npm run build` to `tsc -b`) was not landed in the Phase 1 commit because it interacts with the sub-task 1.4 wholesale `src/` -> `modules/coding/` move: the root tsconfig's `include` set currently emits `core/` into `out/core` AND `core/tsconfig.json` with `composite: true, outDir: "../out/core"` would emit to the same location, producing a double-emit conflict until either the root tsconfig is narrowed to `src/` only (which requires 1.4 to land first so the `modules/coding/` reference is the canonical entry point) or the build script is split into `build:core` + `build:src` chains. Doing it in the wrong order would either break `npm run build` on day one or leave a broken intermediate state that other phases would have to step around.
- **Suggested next step**: Land 1.1's wiring as the first commit cluster of the 1.4 follow-up (the wholesale `src/` move). The pre-req sequence is: (a) narrow root `tsconfig.json` `include` to only the moved `modules/coding/**/*` and `src/extension.ts` (if it still exists post-move), (b) add `core/tsconfig.json` with `composite: true`, (c) add `references: [{ "path": "./core" }]` to the root and to `desktop/tsconfig.json`, (d) rename `npm run build` to invoke `tsc -b`, (e) verify `npm run check-architecture` still passes against the new reference graph.

### 1.4.P1.B -- src/ -> modules/coding/ wholesale move deferred (DF, P1)

- **Source phase**: Phase 1 (1.4)
- **Plan reference**: [phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) sub-task 1.4 ("Perform the wholesale move with `git mv`: `src/llm/` -> `core/llm/` (already exists -- merge) ... [13 source sub-tree moves listed]"); closes v1.0.0 carryforward 2.P2.I.
- **Reason**: The wholesale move is a 192-source-file + 537-test-import operation that cannot be validated in a single session without per-step CI runs. Each `git mv` cluster (a single sub-tree, e.g. `src/agents/` -> `modules/coding/agents/`) needs its own `npm test` + `npm run check-architecture` pass before the next sub-tree moves, otherwise compounding import-rewrite errors are hard to bisect. Landing all 13 moves plus the `scripts/dev/rewrite-imports.mjs` codemod plus the 537 test-file rewrites in one diff would produce a single commit that is essentially unreviewable. The Phase 1 commit therefore lands the bounded carryforward closures (1.1 decision doc, 1.2 storage-path renames, 1.3 deprecationMessage injection, 1.7 curator fallback delete, 1.8 CRLF + SHA-pin) and defers the move to a dedicated follow-up commit cluster ("Phase 1b") that lands it sub-tree by sub-tree.
- **Suggested next step**: Open a follow-up branch `phase-1b-modules-coding-move` and land each `git mv <sub-tree>` as its own commit + CI run, in this order (lowest-dependency first): (1) `src/llm/` -> merge into `core/llm/`, (2) `src/storage/` -> merge into `core/storage/`, (3) `src/utils/` -> `modules/coding/utils/`, (4) the rest of the leaf sub-trees, (5) `src/extension.ts` -> `modules/coding/extension.ts` last (this triggers the manifest path rewrite for sub-task 1.5). The codemod `scripts/dev/rewrite-imports.mjs` lands as its own commit before the first move, so each subsequent `git mv` is a near-pure rename.

### 1.10.P1.F -- NexusCodingRuntime wiring into sidecar sessionManager deferred (DF, P1)

- **Source phase**: Phase 1 (1.10)
- **Plan reference**: [phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) sub-task 1.10 ("Replace the placeholder `sendMessage` body in `desktop/sidecar/src/coding/sessionManager.ts` with: instantiate `NexusCodingRuntime` once per session ..."); closes v1.0.0 carryforward 3.P1.M.
- **Reason**: `NexusCodingRuntime` is defined in `src/runtime/NexusCodingRuntime.ts`, which moves into `modules/coding/runtime/` as part of 1.4. Wiring it into the sidecar before the move would create an `import "../../../src/runtime/NexusCodingRuntime"` from `desktop/sidecar/`, which is exactly the brittle relative-path pattern 1.1 is designed to eliminate.
- **Suggested next step**: Land after 1.4 in "Phase 1b"; the wiring is one constructor call + one event-stream pump.

### 1.11.P1.G -- Tailwind v4 wiring deferred (DF, P2)

- **Source phase**: Phase 1 (1.11)
- **Plan reference**: [phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) sub-task 1.11 ("Add Tailwind v4 to `desktop/package.json` ..."); v1.0.0 carryforward 1.P2.B.
- **Reason**: The desktop workspace currently consumes CSS variables directly (`var(--token)`). Adding Tailwind v4 + PostCSS would re-expose the same variables as utility classes, but the build-pipeline change interacts with Phase 11 (the Nexus VS Code extension) since its webview also consumes these tokens. Doing it in Phase 1 would force a re-run of every visual-regression snapshot for net-zero behavioural change.
- **Suggested next step**: Fold into Phase 11 (Nexus VS Code extension) when the webview build pipeline is otherwise touched.

### 1.12.P2.H -- Phase 1 regression test for curator IdleTimeScheduler exclusivity deferred (MT, P2)

- **Source phase**: Phase 1 (1.7)
- **Plan reference**: [phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) sub-task 1.7 acceptance ("Add a regression test ... that asserts no curator runs occur outside `IdleTimeScheduler` invocations.").
- **Reason**: The Phase 1 commit removed the `_runOneIteration` curator block; an explicit regression test asserting "AgentLoop never dispatches a `curator-worker` sub-agent regardless of `curatorWorkerEnabled`" was not added because the field was made dead (`void options?.curatorWorkerEnabled`) and the existing test suite has no test that fires the curator from AgentLoop. The risk of regression therefore stems from a future re-introduction of the block, which a code review would catch.
- **Suggested next step**: Add `tests/integration/curator-scheduler-only-entry.test.ts` in "Phase 1b" with two cases: (a) construct AgentLoop with `curatorWorkerEnabled: true`, run 100 turns, assert `subAgentManager.run` is never called with `type: "curator-worker"`; (b) instantiate an `IdleTimeScheduler`, register a curator task gated by `nexus.curator.enabled`, advance the fake clock, assert it fires.

### 1.12.P2.I -- Operator action items inherited from v1.0.0 (DF, P2)

- **Source phase**: Phase 1 (carryforward)
- **Plan reference**: [docs/v1.0.0/operator-actions.md](../v1.0.0/operator-actions.md) OA-01 through OA-12; the v1.1.0 cycle plan defers their resolution to Phase 15 (release hardening).
- **Reason**: 12 operator-driven items (Authenticode signing, macOS notarization, AppImage assembly, DevAI-Hub baseline SHA rotation, final brand icons, live golden-task replay, GPU bench, live DevAI-Hub sync smoke, RTM smoke checklists, plus four others) require external infrastructure that is operator-procured (EV certs) or hardware-bound (RTX 4070 rig). Phase 1 inherits them as carryforward.
- **Suggested next step**: They surface in Phase 15's stability gate. No code change required in Phase 1.

---

## 2. Resolved

### Phase 1 closures (commit `ec3ff0e`)

| v1.0.0 source | v1.1.0 phase | Item | Resolved in |
|---|---|---|---|
| 2.P1.G | 1 (1.2) | Storage-path call-site rename to `~/.nexus/` / `.nexus/` | Phase 1 commit `ec3ff0e` |
| 2.P1.H | 1 (1.3) | `deprecationMessage` injected into every legacy `gemma-code.*` key in `package.json` | Phase 1 commit `ec3ff0e` |
| 2.P3.L | 1 (1.8) | CRLF/LF snapshot normalization via `.gitattributes` | Phase 1 commit `ec3ff0e` |
| 5.P3.FF | 1 (1.8) | (subsumed by 2.P3.L) | Phase 1 commit `ec3ff0e` |
| 3.P1.P | 1 (1.7) | Legacy curator-cadence fallback deleted from `AgentLoop._runOneIteration`; `nexus.curator.enabled` setting declared | Phase 1 commit `ec3ff0e` |
| -- | 1 (1.1, decision-only) | Shared-core build decision document landed at `docs/v1.1.0/development/decisions/shared-core-build.md` (actual project-references wiring tracked at 1.1.P1.A) | Phase 1 commit `ec3ff0e` |

### Phase 2 closures (this commit)

| v1.0.0 source | v1.1.0 phase | Item | Resolved in |
|---|---|---|---|
| 2.P1.J (manifest portion) | 2 (2.1) | VS Code extension manifest IDs renamed: `gemma-code-sidebar` -> `nexus-coding-sidebar`, every `gemma-code.<cmd>` / `gemma-code.<viewId>` -> `nexus.coding.<...>`; `COMPAT_COMMAND_MAP` programmatic shim translates legacy keybindings to the new IDs with a single deprecation log per invocation | This commit |
| 2.P2.K (npm portion) | 2 (2.2) | npm `name` + `publisher` renamed `gemma-code` -> `nexus-coding`; `package-lock.json` synced; `.npmignore` created to exclude tests / docs / desktop / runtimes / coverage / .github / scripts/installer / AI-assistant configs; installer-side `EXTENSION_ID` / `_find_vsix` glob / `setup.nsi` PRODUCT_* / Complete-page strings flipped to the new ID in lock-step | This commit |
| 3.P2.S | 2 (2.3) | Sidecar + frontend model catalogs (`desktop/sidecar/src/coding/models.ts`, `desktop/src/modules/coding/models.ts`) now derive from `core/registry/ModelCatalog` via the desktop tsconfig's `include` array; the parity test (`desktop/tests/coding-models.test.ts`) asserts positional equality against the canonical catalog | This commit |

---

## 3. Summary

| Severity | Open | Resolved | Total |
|---|---|---|---|
| P0 | 0 | 0 | 0 |
| P1 | 3 | 3 | 6 |
| P2 | 3 | 0 | 3 |
| P3 | 0 | 0 | 0 |
| **Total** | **6** | **9** | **15** |

By category (open items only):
- **DF** (deferred): 5
- **MT** (missing tests): 1
- **NI / BG / WN / QG**: 0

By phase (open items only):
- Phase 1: 6 (deferred sub-tasks 1.1 wiring + 1.4 wholesale move + 1.10 NexusCodingRuntime + 1.11 Tailwind v4 + 1.12.P2.H + 1.12.P2.I) -- all queued for the future Phase 1c follow-up

---

## 4. Carryforward map (v1.0.0 -> v1.1.0)

This table mirrors the cycle plan's [Carryforward Map](plans/v1.1.0-cycle.md#carryforward-map-v100---v110). Items in **Phase 1** are closed here (see `## 2. Resolved` above) or recorded as open items in `## 1` when deferred to "Phase 1b". Items in later phases are open and tracked against their target phase.

| v1.0.0 code | v1.1.0 phase | Status (as of 2026-05-19) |
|---|---|---|
| 2.P1.G | 1 | Closed (Phase 1 commit `ec3ff0e`, sub-task 1.2) |
| 2.P1.H | 1 | Closed (Phase 1 commit `ec3ff0e`, sub-task 1.3) |
| 2.P2.I | 1 | Deferred to Phase 1c (open item 1.4.P1.B) -- wholesale `src/` move |
| 2.P1.J | 1 (manifest) + 10 | Closed-manifest-portion (Phase 2 commit, sub-task 2.1); Marketplace re-publish targets cycle Phase 10 |
| 2.P2.K | 1 (npm) + 10 | Closed-npm-portion (Phase 2 commit, sub-task 2.2); Marketplace re-publish targets cycle Phase 10 |
| 2.P3.L | 1 | Closed (Phase 1 commit `ec3ff0e`, sub-task 1.8) |
| 3.P1.M | 1 | Deferred to Phase 1c (open item 1.10.P1.F) -- waits for the 1.4 wholesale move |
| 3.P1.P | 1 | Closed (Phase 1 commit `ec3ff0e`, sub-task 1.7) |
| 3.P2.S | 1 | Closed (Phase 2 commit, sub-task 2.3) |
| 5.P3.FF | 1 (subsumed by 2.P3.L) | Closed (Phase 1 commit `ec3ff0e`) |
| 1.P2.B | 1 | Deferred (open item 1.11.P1.G) -- folds into cycle Phase 11 webview-build pipeline change |
| 1.P2.C | 15 (OA-07) | Open (operator action, target Phase 15) |
| 1.P2.D | 1 / 15 | Open (target Phase 15 RTM) |
| All remaining v1.0.0 carryforwards (Phases 2-15) | 2-15 | Open, tracked in cycle plan |

---

## References

- [docs/v1.0.0/known-gaps.md](../v1.0.0/known-gaps.md) -- upstream cycle gap log
- [docs/v1.0.0/operator-actions.md](../v1.0.0/operator-actions.md) -- OA-01 through OA-12
- [docs/v1.1.0/plans/v1.1.0-cycle.md](plans/v1.1.0-cycle.md) -- active plan
- [docs/v1.1.0/plans/phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) -- Phase 1 detail
- [docs/v1.1.0/plans/phase-02-rebrand-and-core-extraction.md](plans/phase-02-rebrand-and-core-extraction.md) -- Phase 2 detail (rebrand + sidecar core extraction)
- [docs/v1.1.0/development/decisions/shared-core-build.md](development/decisions/shared-core-build.md) -- ADR for sub-task 1.1
