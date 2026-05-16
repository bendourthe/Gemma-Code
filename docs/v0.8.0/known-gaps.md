# v0.8.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: in-progress
**Audience**: v0.8.0 phase authors, code reviewer, security reviewer, ops engineer running the live-Ollama capture
**Sibling reviews**: [docs/v0.7.0/known-gaps.md](../v0.7.0/known-gaps.md) (the v0.7.0 carryover catalog that drives v0.8.0); [docs/v0.8.0/plans/v0.8.0-cycle.md](plans/v0.8.0-cycle.md).
**Context**: This is the in-cycle gap log for v0.8.0. It catalogs every item that lands only partially, every pre-existing bug or warning observed but not fixed, every operator-action item that has to land before the cycle is fully closed, and every out-of-scope item explicitly recorded for v0.9.0+. The catalog is appended phase-by-phase. The terminal `Resolved` table and `Summary` are recomputed each pass.

Each entry has a severity tag:

- **P0** -- release-blocker for v0.8.0 (must close)
- **P1** -- should-fix in v0.8.0
- **P2** -- nice-to-have; documented for completeness
- **P3** -- out-of-scope for v0.8.0; explicitly recorded for future planning

Each entry has a category tag:

- **NI** (not implemented) -- a plan sub-task that was skipped
- **DF** (deferred) -- a plan sub-task explicitly deferred to a later phase / cycle
- **BG** (bug) -- a deviation that revealed a real defect
- **MT** (missing tests) -- a coverage shortfall
- **WN** (warning) -- a suppressed lint or runtime warning
- **QG** (quality gate) -- a Phase 7 gate the cycle author bypassed with "Proceed anyway"

---

## 1. Operator-action items that must close v0.8.0

These items require an authorized operator on a quiescent dev workstation (with `ollama serve` and `gemma4:e4b` pulled) or in a fresh worktree. The agent is not authorized to run them autonomously. They are tracked in Section 10 with the matching `10.O.N` row.

### 1.1 Live-Ollama golden + benchmark baseline capture (v0.4.0, v0.6.0, v0.7.0)

**Severity**: P1
**Source**: Plan sub-task 0.2; carried from v0.7.0 known-gaps Section 10.O.14 + 10.O.15
**Files**: `tests/benchmarks/baselines/v0.7.0.json`, `tests/golden/baselines/v0.7.0.json`, `tests/golden/baselines/v0.4.0.json`, `tests/golden/baselines/v0.6.0.json` (if missing)

Procedure documented in `docs/v0.6.0/development/history/phase-08.md` Section 3.1 and Plan sub-task 0.2. Three captures plus optional v0.6.0 re-capture; requires `ollama serve` running with `gemma4:e4b` pulled on a quiescent workstation. Tracked as 10.O.A in Section 10.1.

### 1.2 v0.7.0 post-tag exit verification

**Severity**: P1
**Source**: Plan sub-task 0.6; carried from v0.6.0 operator-action 1.2

Check out the v0.7.0 tag in a fresh worktree; run the full gate (`npm ci && npm run lint && npm run build && npm run test && npm run test:integration && npm run bench && npm run deps:check && npm run catalog:check && npm run perm-tier:check && npm audit --production --audit-level=moderate`); verify GitHub release artifact contains the VSIX; re-run pen-test Attack Path A simulation against the v0.7.0 source. Tracked as 10.O.B in Section 10.1.

### 1.3 `package-lock.json` regeneration with hnswlib-node resolution

**Severity**: P3
**Source**: Plan sub-task 0.10; carried from v0.7.0 known-gaps Section 10.O.13 + 10.O.11

Run `npm install` (NOT `npm ci`) to let the `hnswlib-node@^3.0.0` optionalDependency resolve cleanly; commit the resulting `package-lock.json`. Then on Linux x64 or macOS, run the previously-skipped `runIf(HNSW_AVAILABLE)` tests. Partial cross-platform action; tracked as 10.O.C in Section 10.1.

---

## 2-9. (placeholders for end-of-cycle audit)

These sections mirror `docs/v0.7.0/known-gaps.md` Sections 2-9 and will be populated as the cycle nears Phase 7 close. For the in-cycle log of items surfaced phase-by-phase, see Section 10 below.

- **Section 2**: v0.8.0 plan items deferred to v0.9.0+ (filled at Phase 7 close).
- **Section 3**: Definition-of-Done partial deviations (filled at Phase 7 close).
- **Section 4**: Mutation-testing gaps (filled after Stryker quarterly run, Phase 7).
- **Section 5**: Pre-existing bugs and warnings observed but not fixed.
- **Section 6**: Documented-but-not-implemented items closed in v0.8.0 (audit trail).
- **Section 7**: Out-of-scope items (recorded for v0.9.0+ planning).
- **Section 8**: v0.9.0 plan starter.
- **Section 9**: Severity roll-up (recomputed at Phase 7 close).

---

## 10. v0.8.0 in-cycle gap log

This section is appended phase-by-phase as v0.8.0 lands. Each entry records the source phase, plan reference, category, severity, reason, and suggested next step. Items are moved to `## Resolved` when closed in a later phase, and the `## Summary` at the bottom of the section is recomputed each pass.

**Last updated**: 2026-05-16 (Phase 4 close).

### 10.1 Open Items

| ID | Source phase | Plan reference | Category | Severity | Reason | Suggested next step |
|---|---|---|---|---|---|---|
| 10.O.A | Phase 0 | docs/v0.8.0/plans/v0.8.0-cycle.md sub-task 0.2 + 0.12 | DF | P1 | Live-Ollama golden + benchmark baseline capture (v0.4.0, v0.6.0, v0.7.0) requires `ollama serve` running with `gemma4:e4b` pulled on a quiescent workstation; the agent is not authorized to run live inference. Carries v0.7.0 items 10.O.14 + 10.O.15. | Operator: run the three captures per sub-task 0.2 procedure; document deltas in this file Section 1. |
| 10.O.B | Phase 0 | docs/v0.8.0/plans/v0.8.0-cycle.md sub-task 0.6 | DF | P1 | v0.7.0 post-tag exit verification requires a fresh worktree (`git worktree add`) and the full gate run; the agent should not modify worktree state autonomously. | Operator: run sub-task 0.6 procedure; document result in this file Section 1. |
| 10.O.C | Phase 0 | docs/v0.8.0/plans/v0.8.0-cycle.md sub-task 0.10 | DF | P3 | `package-lock.json` regeneration with `hnswlib-node` resolved + cross-platform HNSW test run. The lockfile regen runs locally; the cross-platform test run requires Linux x64 or macOS access. Carries v0.7.0 items 10.O.13 + 10.O.11. | Operator: run `npm install` locally; commit `package-lock.json`; run gated HNSW tests on Linux/macOS host (CI runner counts). |
| 10.O.D | Phase 1 | (discovered) | BG | P2 | `tests/unit/cli/gemma-check.test.ts` and `tests/unit/scripts/package-skills.test.ts` fail to load under `npm run test` with `SyntaxError: Invalid or unexpected token` thrown from `node:vm new Script`. Neither file was modified during Phase 1; both predate the v0.8.0 cycle and the suites pointed at the same files in isolation produce the same error. Probable cause: vitest 1.6.1 Node-vm transform path on Windows mis-handles certain non-ASCII characters in the docstring or import list. | Phase 5 sub-task tied to `bin/gemma-check.mjs` rule expansion (5.9) should reproduce on Linux to confirm cross-platform; if Linux-only fix is viable, treat as a vitest config/version bump; otherwise temporarily move the two suites behind an env-gate while the upstream issue is filed. |
| 10.O.E | Phase 1 | (discovered) | BG | P2 | `tests/integration/memory-consolidator-large.test.ts` "consolidates 10K episodic events in under 5 seconds" times out at ~11s on the dev workstation (assertion: `expected 11255.9 to be less than 5000`). The 5 s budget was set in v0.7.0 and appears unrelated to Phase 1 changes (no consolidator code paths touched). | Phase 6 sub-task 6.3 (Reflect Job) will refactor the consolidator stress path; bump the threshold to a measured + headroom value during that work, or split the stress test into a separate `bench:integration` mode. |
| 10.O.F | Phase 2 | docs/v0.8.0/plans/v0.8.0-cycle.md sub-task 2.4 | NI | P3 | Pass-state gating disabled at the sub-agent layer to avoid a verification deadlock (a verification sub-agent cannot run another verification tool to satisfy its own gate). The user-visible parent loop still enforces the gate. A future refinement could track per-sub-agent-type verification credit (e.g. count `success: true` audit-worker output as gate satisfaction) so sub-agents also benefit. | Phase 5 sub-task tied to per-skill metrics (5.1) is the natural place to extend `VERIFICATION_TOOLS` semantics with sub-agent return values; or land a follow-on ADR in v0.9.0. |
| 10.O.G | Phase 2 | docs/v0.8.0/plans/v0.8.0-cycle.md sub-task 2.8 | MT | P2 | The four new SkillLoader round-trip tests landed in `tests/unit/scripts/package-skills.test.ts` (carrying the `parseSkill.normalized` shape through every harness adapter) cannot run on the dev workstation because the file collides with the pre-existing 10.O.D vitest 1.6.1 Node-vm parse error. The new tests load cleanly when the upstream issue is resolved; SkillLoader's own unit suite (`tests/unit/skills/SkillLoader.test.ts`) covers the same shape end-to-end and is green. | Resolve once 10.O.D ships; no Phase 2 follow-up required. |
| 10.O.H | Phase 3 | docs/v0.8.0/plans/v0.8.0-cycle.md sub-task 3.4 | NI | P3 | The improvement-hook file is read with no prompt-injection scan; the v0.8.0 Phase 2.7 scanner only guards `Memory.md` / `Context.md`. Rationale: the user authored the file themselves, so the threat model is shell-rc parity, not third-party content. Documented in `docs/v0.8.0/improvement-hooks.md` Safety section. | If a future hook ingests text from an external source (e.g. a workspace-checked-in hook file), extend the scanner to cover `~/.gemma-code/hooks/*.md` before that hook ships. |
| 10.O.I | Phase 3 | docs/v0.8.0/plans/v0.8.0-cycle.md sub-task 3.2 | WN | P3 | The `clean` diff mode wraps additions whose payload includes a trailing newline as `**text\n**`, so the closing `**` sits on the next line. The webview's downstream markdown renderer still highlights the run correctly, but the raw classic+raw modes are unaffected. Behaviour matches the `diff` package's `diffWordsWithSpace` semantics. | If a richer inline-diff renderer lands later (Phase 6+), revisit whether to post-process the clean output to strip trailing newlines from add/del runs. |
| 10.O.J | Phase 4 | docs/v0.8.0/plans/v0.8.0-cycle.md sub-task 4.2 | DF | P2 | LM Studio live integration test (an opt-in test that connects to a running LM Studio server on `127.0.0.1:1234` and exercises a real `streamChat` round-trip) was not landed. The mocked-fetch suite (`tests/unit/llm/LmStudioClient.test.ts`) covers the OpenAI SSE parsing, error paths, and probe semantics; a live test would only add value for the auto-detect path on macOS. | Phase 7 polish: add a `runIf(LMSTUDIO_LIVE === "1")` integration test under `tests/integration/llm/` that does one streamed completion against the local server. |
| 10.O.K | Phase 4 | docs/v0.8.0/plans/v0.8.0-cycle.md sub-task 4.3 | DF | P3 | The Gemma 4 channel parser is shipped as a pure module with full unit-test coverage but is **not yet wired** into `StreamingPipeline` and `ConversationManager.replayForCompaction`. Reason: wiring `Gemma4Parser` into the streaming hot path before the LM Studio backend stream parity tests land risks regressing the existing Ollama path. The pure module + tests is the v0.8.0 commitment; the wiring is staged for v0.9.0 alongside replayForCompaction's broader compaction-prompt refactor. | v0.9.0: add `parseChannel` after `MemoryContextScrubber.feed()` in `StreamingPipeline._attemptStream`; add `stripLeadingThinkBlocks` to the compaction replay path. |
| 10.O.L | Phase 4 | docs/v0.8.0/plans/v0.8.0-cycle.md sub-task 4.4 | DF | P3 | The `/thinking-mode` command updates the user setting but does not yet rewrite the active streaming pipeline's `ollamaOptions` mid-flight. The next streaming request picks up the new preset automatically (via the panel's settings-change listener); an already-in-flight stream keeps the prior preset. | Acceptable v0.8.0 behaviour. v0.9.0: emit a one-line `[Thinking mode]` chat affordance when the change applies for clarity. |
| 10.O.M | Phase 4 | docs/v0.8.0/plans/v0.8.0-cycle.md sub-task 4.6 | DF | P2 | `HybridRanker` is wired into a new `MemoryStore.searchHybrid` method but is not yet the default for `MemoryStore.retrieve` or `UnifiedMemoryRetriever.retrieve`. Reason: the existing path is the v0.7.0-stable retrieval used by tools/agent-loop on every turn; an opt-in `searchHybrid` lets v0.8.0 evaluate the fusion quality on real workloads before flipping the default in v0.9.0. | v0.9.0: route `UnifiedMemoryRetriever.retrieve` through `searchHybrid` once the per-result `reason` UI lands in MemoryPanel. |
| 10.O.N | Phase 4 | (discovered, carryover from 10.O.D) | BG | P2 | The full `npm run test` run terminates with a Windows segmentation fault after `MemoryStore.migration.test.ts` completes. All test results emitted before the segfault show as passing; the crash happens in vitest's teardown path, not in test execution. Two pre-existing test files (`tests/unit/scripts/package-skills.test.ts`, `tests/unit/cli/gemma-check.test.ts`) still show `(0 test)` in the run summary due to the v0.7.0 10.O.D vitest 1.6.1 vm-transform parse error. | Carryover from 10.O.D. Phase 5 sub-task 5.9 (gemma-check rule expansion) is the natural place to reproduce on Linux; if Linux-only fix viable, treat as a vitest config/version bump. |

### 10.2 Resolved

| ID | Source phase | Plan reference | Category | Resolved in | Notes |
|---|---|---|---|---|---|
| 10.O.1 (v0.7.0) | v0.7.0 Phase 4 | docs/v0.7.0/plans/v0.7.0-cycle.md Phase 4 stability gate | NI | v0.8.0 Phase 0.3 | Queued-message-field swap wired in `ChatWebviewHost` from streaming start/end events; new `renderQueuedMessageField` message type emitted by host. Regression test added to `tests/unit/panels/ChatWebviewHost.test.ts`. |
| 10.O.2 (v0.7.0) | v0.7.0 Phase 4 | docs/v0.7.0/plans/v0.7.0-cycle.md Phase 4 stability gate | NI | v0.8.0 Phase 0.4 | `permissionPromptResponse` case added to `ChatMessageRouter` and resolves via `ConfirmationGate.resolvePrompt`. Integration test at `tests/integration/panels/permissionPrompt.test.ts`. |
| 10.O.3 (v0.7.0) | v0.7.0 Phase 4 | docs/v0.7.0/plans/v0.7.0-cycle.md Phase 4 stability gate | NI | v0.8.0 Phase 0.5 | `todos` wiring added to `ChatPanelBootstrap`: `TodoState` constructed and passed to `buildToolRegistry`; `update_todos` tool registered. Regression test at `tests/unit/panels/ChatPanelBootstrap.test.ts`. |
| 10.O.17 (v0.7.0) | v0.7.0 Phase 8 | docs/v0.7.0/plans/v0.7.0-cycle.md sub-task 8.1 | NI | v0.8.0 Phase 0.13 | Python golden runner canonised via ADR-0017; the TS-native rewrite was explicitly rejected as not cost-effective. README + CONTRIBUTING golden-suite sections updated. |
| 10.O.18 (v0.7.0) | v0.7.0 Phase 8 hotfix | docs/v0.7.0/plans/v0.7.0-cycle.md Phase 7 sub-task 7.1 | BG | v0.8.0 Phase 0.8 | HNSW persist/reload bug investigated. Root cause: hnswlib-node `readIndexSync(path, allowReplaceDeleted)` requires the second argument to be `true` to honour the saved labels on reload (third-arg `maxElements` default of 0 is fine; the label-preservation flag is what was missing). Fix lands in `src/storage/MemoryHnswIndex.ts.tryCreate`; `HNSW_RUN_PERSIST` env-gate removed from `tests/unit/storage/MemoryHnswIndex.test.ts`. |
| 10.O.19 (v0.7.0) | v0.7.0 hotfix | docs/v0.7.0/known-gaps.md item 2.1 resolution | BG | v0.8.0 Phase 0.9 | `marked` v12 renderer perf regression mitigated by caching a single configured `marked` instance (rather than reconfiguring per call) and skipping `walkTokens` when the document has no link/code tokens. Renderer benches re-included in the nightly bench gate by removing the `--exclude` rule. Post-fix bench numbers captured in `docs/v0.8.0/performance-baselines.md`. |
| 10.O.12 (v0.7.0) | v0.7.0 Phase 7 | docs/v0.7.0/plans/v0.7.0-cycle.md Phase 7 sub-task 7.2 | MT | v0.8.0 Phase 0.11 | Background-workers E2E integration test landed at `tests/integration/background-workers-end-to-end.test.ts` exercising the AgentLoop -> SubAgentManager -> BackgroundWorkers -> spawn `node bin/gemma-check.mjs --json` path against fixture files. |

### 10.3 Summary (v0.8.0 in-cycle)

| Category | Open | Resolved |
|---|---|---|
| NI (not implemented) | 2 | 4 |
| DF (deferred) | 7 | 0 |
| BG (bug) | 3 | 2 |
| MT (missing tests) | 1 | 1 |
| WN (warning) | 1 | 0 |
| QG (gate bypass) | 0 | 0 |
| **Total** | **14** | **7** |

**Status (Phase 4 close)**: Fourteen open items. Three operator-action (10.O.A/B/C) blocked on environment access. Two pre-existing bugs from Phase 1 (10.O.D vitest vm transform on two test files; 10.O.E memory-consolidator stress test exceeds its 5 s budget) remain queued for their natural target phases (5.9 and 6.3 respectively). One pass-state gating carve-out from Phase 2 (10.O.F) and one round-trip-test blocker (10.O.G) carry forward. Phase 3 added 10.O.H (improvement-hook injection scan, scoped to shell-rc threat model) and 10.O.I (clean-diff trailing-newline). Phase 4 added five entries: 10.O.J (LM Studio live integration test deferred), 10.O.K (Gemma 4 channel parser pure module shipped; streaming-pipeline wiring deferred to v0.9.0 to avoid Ollama-path regression risk), 10.O.L (`/thinking-mode` applies on next stream, not mid-stream), 10.O.M (hybrid scoring opt-in via `searchHybrid`; default `retrieve` path unchanged for v0.7.0 parity), and 10.O.N (Windows segfault during vitest teardown -- carryover from 10.O.D).

All seven Phase 4 sub-tasks (4.1 `/trace` primitive, 4.2 LM Studio adapter + auto-detect, 4.3 Gemma 4 channel parser, 4.4 sampler presets + `/thinking-mode`, 4.5 locked prefix prompt order, 4.6 hybrid RRF ranker + why-retrieved, 4.7 evaluator-rubric + handoff/progress writers) landed with passing tests. `npm run lint` and `npm run build` both green. New source files: `src/observability/TraceFile.ts`, `src/llm/LmStudioClient.ts`, `src/llm/Gemma4Parser.ts`, `src/config/SamplerPresets.ts`, `src/storage/HybridRanker.ts`, `src/chat/SessionDocs.ts`. New test files: `tests/unit/observability/TraceFile.test.ts` (10 cases), `tests/unit/llm/LmStudioClient.test.ts` (7 cases), `tests/unit/llm/Gemma4Parser.test.ts` (10 cases), `tests/unit/config/SamplerPresets.test.ts` (9 cases), `tests/unit/storage/HybridRanker.test.ts` (7 cases), `tests/unit/storage/MemoryStore.searchHybrid.test.ts` (4 cases), `tests/unit/chat/PromptBuilder.prefix.test.ts` (3 cases), `tests/unit/chat/SessionDocs.test.ts` (3 cases). Two new ADRs: ADR-0016 (second LLM backend), ADR-0018 (hybrid scoring over HNSW). Two new doc templates: `docs/v0.8.0/review/evaluator-rubric.md`, `docs/v0.8.0/review/quality-document.md`.
