# Nexus - Progress Dashboard

**Project:** Nexus (renamed from Gemma Code at v1.0.0). **Release branch:** `main`. **Active branch:** `feat/v1.5.0-phase-3-inbound-security`.

> **Current state (2026-07-02):** the live development line is the **v1.x cycle series** summarized in the "v1.x line" section near the end of this file. The detailed per-task boards below (v0.1.0 - v0.7.0) are retained as history and predate the rename. Latest work: **v1.7.0 post-cycle -- vscode-free headless agent runtime + optimizer production wiring (2026-07-02)**: built the deferred `modules/coding/runtime/` (workdir-scoped headless tool set + `HeadlessAgentSession` loop reusing the pure `Gemma4ToolFormat` codec + `HeadlessAgentDriver`) and the production optimizer seams (`HeadlessOptimizerRollout`, `HeadlessCandidateProducer`/`Scorer`/`Promoter`) + a `nexus golden run` CLI -- resolving five forward-tier gaps (`SO001.P1.A` real AgentDriver, `SO003.P3.B` production rollout, `SO005.P4.A` producer+scorer, `SO005.P4.B` promoter, `SO001.P1.B` golden-run CLI). 35 new tests; full suite **4533 passed / 6 skipped / 0 failed**; lint + `tsc -b` + check-architecture (0 errors / 10 pre-existing warnings) + security:check + check:tampering + catalog + prod-audit all green. Deferred (v1.7.0 known-gaps): `RT.P7.A` desktop-sidecar wiring (blocked on `RT.P7.B` relocating the shared tool-call primitives into `modules/coding` so the desktop typecheck stays `src/`-free, + the Rust toolchain for the Tauri e2e), `RT.P7.C` optimize/frontier CLIs. Commits `b2ba301`/`5240fa9`/`2fb0a75`. Prior: **v1.7.0 (`adoption-self-optimizing-skills`) COMPLETE -- Phase 6 FINAL closed 2026-07-02** (SO007-SO009): the whole-plan acceptance gate passed with **no feature-code change** (verification + close-out only). All seven Definition-of-pass items verified -- the six delivered modules (S1 golden-task live runner; S4 split + held-out gate + rejected-edit buffer; S2+S6 bounded-edit optimizer + A/B; S3 Pareto frontier; O-A shell introspection) confirmed physically present, item 7 (testing + docs) delivered. Gate green: root suite **4498 passed / 6 skipped / 0 failed**; coverage lines 88.22% / branches 84.01% / functions 91.35% (all above the 80/75/80 CI gate); `tsc -b` + lint (0 errors) + check-architecture (0 errors / 10 pre-existing warnings) + security:check (in sync) + check:tampering (0 findings) all clean. Docs finalized (known-gaps ledger flipped to COMPLETE 6/6, DEVLOG, todos, plan); README/ARCHITECTURE/CHANGELOG narrative + the npm version tag remain semantic-release-owned (cut on merge to `main`). Demand-gated backlog recorded (S5; opencode O-B/O-D/O-E). Nexus-Hub touchpoint assessed **not warranted** as an in-repo change (`SO009.P6.A`; precedent v1.6.0 `OF015.P5.A`/`AS010.P6.A`). See the [v1.7.0 plan](versions/v1/v1.7.0/plans/adoption-self-optimizing-skills.md) and [known-gaps](versions/v1/v1.7.0/known-gaps.md). Prior: **v1.7.0 (`adoption-self-optimizing-skills`) Phase 5 landed 2026-07-01** -- O-A tree-sitter shell-command introspection for permission gating (SO006): the terminal permission gate now enumerates the paths/cwd a shell command will touch (bash/PowerShell/cmd) via the vscode-free, dependency-free [shellIntrospection.ts](../modules/coding/guardrails/shellIntrospection.ts) `introspectShellCommand` -- a quote-aware structural parser (redirection detection + per-dialect file-command tables + `cd`-family cwd changes) reverse-engineered per the MCP Registry Policy with **no new dependency** (the bundled `tree-sitter-wasms` ships a bash grammar only; PowerShell/cmd have none, so the structural tokenizer is the always-available core) -- and matches each write/delete/read path against the `.nexus/permissions.deny` file-tool rules in the [ToolRegistry](../src/tools/ToolRegistry.ts) deny gate (`_denyByTouchedPath`: write->`write_file`, delete->`delete_file`, read->`read_file`, blanket `*:` honored), so `write_file: secrets/**` now also blocks `echo x > secrets/prod.env`, not just a literal `write_file` call. The gate **fails closed**: an un-parseable command (command/process substitution, `$`/`%` variable expansion, backtick, `Invoke-Expression`, an unbalanced quote) logs the fallback and fabricates no path rule -- the DANGEROUS-tier confirmation + command-string denylist still gate, never auto-allowing -- so the introspection only ever *tightens* the surface; the `run_terminal` dry-run report gains a `Touched paths:` line. 37 new tests; root suite **4498 passed / 6 skipped / 0 failed**; new-module coverage shellIntrospection 100% lines / 92.59% branches / 100% functions; lint + `tsc -b` + check-architecture (0 errors / 10 pre-existing warnings) + check:tampering (0) + security:check all clean. Forward-tier carryovers `SO006.P5.A` (tree-sitter-bash AST upgrade over the bundled grammar), `SO006.P5.B` (opt-in workspace-escape hard-block), `SO006.P5.C` (glob-expansion / read-scope precision) in [v1.7.0 known-gaps](versions/v1/v1.7.0/known-gaps.md). See the [v1.7.0 plan](versions/v1/v1.7.0/plans/adoption-self-optimizing-skills.md). Prior: **v1.7.0 (`adoption-self-optimizing-skills`) Phase 4 landed 2026-07-01** -- S3 the evolutionary layer (SO005): a **`CandidateFrontier`** (three vscode-free [`modules/coding/skilloptimizer/`](../modules/coding/skilloptimizer/) modules) reverse-engineers the GEPA/EvoSkill genetic-Pareto selector as a lean local module (no DSPy/EvoSkill dependency) on the Phase 3 spine -- the pure [pareto.ts](../modules/coding/skilloptimizer/pareto.ts) selector (`dominates` / `paretoFrontier` non-dominated set / deterministic held-out extremes) plus the [CandidateFrontier.ts](../modules/coding/skilloptimizer/CandidateFrontier.ts) orchestrator: produce >= 2 candidates -> materialize each on its **own git branch** (the real [frontierWorktree.ts](../modules/coding/skilloptimizer/frontierWorktree.ts) `WorktreeCandidateManager`, reusing the v1.5.0 worktree-swarm `GitRunner` contract) -> score across the diverse tasks -> auto-clean each ephemeral worktree (one live at a time, the single-GPU discipline; the branch ref survives) -> keep a **bounded population under a hard candidate cap** (the EvoSkill replacement rule: a challenger displaces the lowest-held-out incumbent only when it strictly beats it on the held-out split) -> select the non-dominated (Pareto) set -> surface the winner for **explicit human approval**, reusing the Phase 3 `SkillEditApprovalGate` (a winning branch is **never** auto-merged -- the `CandidatePromoter` is structurally unreachable without approval). 30 new tests; root suite **4461 passed / 6 skipped / 0 failed**; new-module coverage pareto 100/100/100, CandidateFrontier 100/94.11/100, frontierWorktree 96.61/90/100 (skilloptimizer subtree 99.47/91.51/100); lint + `tsc -b` + check-architecture (0 errors / 10 pre-existing warnings) + check:tampering (0) + security:check all clean. Forward-tier carryovers `SO005.P4.A` (production candidate producer + scorer over the real agent, deferred behind `SO001.P1.A`/`SO003.P3.B`), `SO005.P4.B` (live branch->catalog promoter over `GitSafetyNet`), `SO005.P4.C` (no frontier CLI + tier-cap wiring) in [v1.7.0 known-gaps](versions/v1/v1.7.0/known-gaps.md). See the [v1.7.0 plan](versions/v1/v1.7.0/plans/adoption-self-optimizing-skills.md). Prior: **v1.7.0 (`adoption-self-optimizing-skills`) Phase 3 landed 2026-06-30** -- S2 + S6 the headline capability (SO003 + SO004): the bounded-edit **`SkillOptimizer`** (eight vscode-free [`modules/coding/skilloptimizer/`](../modules/coding/skilloptimizer/) modules) runs the reverse-engineered SkillOpt/GEPA loop -- rollout the train split -> reflect on failing trajectories via the existing `ReflexionEngine`/`CriticAgent` (trajectories `redactSecrets`-scanned) -> propose a **bounded** add/delete/replace skill edit under a textual learning-rate budget -> accept ONLY on the Phase 2 held-out `validationGate` -> buffer rejects in the `RejectedEditBuffer` -> overwrite the skill file **only after explicit human approval** (`classifyAction` + a fail-closed catalog-root path resolver gate the write; the loop is capped by the v0.3.0 runaway `BudgetMiddleware`) -- plus the **optimizer-quality A/B** ([SkillOptimizerAb.ts](../modules/coding/skilloptimizer/SkillOptimizerAb.ts) reusing the v1.6.0 Fusion F4 `PanelAbHarness` + `decideSkillOptimizerDefault`). New opt-in flag `nexus.coding.skillOptimizer.enabled` ships **default off** (no live local A/B run here, so no measured net win to flip it; `SO003.P3.A`). 48 new tests; root suite **4431 passed / 6 skipped / 0 failed**; new-module coverage 99.62% lines / 89.61% branches / 100% functions across the `skilloptimizer` subtree; lint + `tsc -b` + check-architecture (0 errors / 10 pre-existing warnings) + check:tampering (0) + security:check all clean. Forward-tier carryovers `SO003.P3.A` (opt-in default-off pending a live A/B), `SO003.P3.B` (production rollout over the real `AgentLoop`, deferred behind `SO001.P1.A`), `SO003.P3.C` (live `ConfirmationGate`/`pathGuard` adapters), `SO003.P3.D` (no optimize CLI) in [v1.7.0 known-gaps](versions/v1/v1.7.0/known-gaps.md). See the [v1.7.0 plan](versions/v1/v1.7.0/plans/adoption-self-optimizing-skills.md). Prior: **v1.7.0 (`adoption-self-optimizing-skills`) Phase 2 landed 2026-06-30** -- S4 regression-safety scaffolding (SO002): a locked train/validation/test **split** (additive `split` field on `GoldenTaskSpec` + a deterministic default-by-category assignment in [goldenSplit.ts](../modules/coding/evaluation/goldenSplit.ts)) whose **test** split is structurally unreachable from the optimizer loader (`optimizerVisibleTasks` + `assertNoTestSplit` guard); a pure held-out **validation gate** ([validationGate.ts](../modules/coding/evaluation/validationGate.ts) -- accepts only on a strict aggregate validation-pass-rate improvement with per-task regressions within tolerance, reusing `RegressionReport`); and a content-addressed, redaction-on-write **rejected-edit buffer** ([core/memory/RejectedEditBuffer.ts](../core/memory/RejectedEditBuffer.ts), keyed by `skillId + editHash`, edit/trajectory text stored via `ArtifactStore` so it never lands on disk unredacted). 29 new tests; root suite **4382 passed / 6 skipped / 0 failed**; new-module coverage 100% lines/branches/functions across goldenSplit / validationGate / RejectedEditBuffer; lint + `tsc -b` + check-architecture (0 errors / 10 pre-existing warnings) + check:tampering (0) + security:check all clean. Forward-tier carryovers `SO002.P2.A` (latency/token regression gating), `SO002.P2.B` (buffer orphan GC), `SO002.P2.C` (difficulty-stratified splits) in [v1.7.0 known-gaps](versions/v1/v1.7.0/known-gaps.md). Phases 3-6 pending. See the [v1.7.0 plan](versions/v1/v1.7.0/plans/adoption-self-optimizing-skills.md). Prior: **v1.7.0 Phase 1 landed 2026-06-29** -- S1 TS-native golden-task **live runner** (SO001): four vscode-free [`modules/coding/evaluation/`](../modules/coding/evaluation/) modules -- a declarative `success_criteria` evaluator ([goldenCriteria.ts](../modules/coding/evaluation/goldenCriteria.ts), TS port of `evaluator.py`), a copy-into-temp + `git init` snapshot materializer ([goldenSnapshot.ts](../modules/coding/evaluation/goldenSnapshot.ts)), a dependency-free YAML-subset task loader ([goldenTaskLoader.ts](../modules/coding/evaluation/goldenTaskLoader.ts)), and a runner that materializes -> runs the agent via an injected `AgentDriver` seam (kept vscode-free per `no-llm-outside-llm-folder`) -> evaluates -> emits a scored `GoldenTaskResult` ([GoldenTaskRunner.ts](../modules/coding/evaluation/GoldenTaskRunner.ts)), with a per-task timeout. Revives the live golden runs deleted by ADR-0001 (the Python `_run_live()` returned "backend call failed" since v0.4.0). 45 new tests (unit + real-snapshot dry/mock-live integration + env-gated Ollama live smoke); root suite **4354 passed / 6 skipped / 0 failed**; new-module coverage 97.11% lines / 83.25% branches / 100% functions; lint + `tsc -b` + check-architecture (0 errors / 10 pre-existing warnings) + check:tampering (0) + security:check all clean. Forward-tier carryovers (`SO001.P1.A` full-loop driver, `SO001.P1.B` `nexus golden run` CLI, `SO001.P1.C` Windows shell criteria) in [v1.7.0 known-gaps](versions/v1/v1.7.0/known-gaps.md). Prior: **v1.6.0 companion plan `adoption-openrouter-fusion` COMPLETE -- Phase 5 FINAL closed 2026-06-17** (all 5 phases). The whole-plan acceptance gate passed: all six definition-of-pass items verified, no feature code changed (verification + close-out, OF013-OF015). Routing default ships opt-in (off) per the no-degradation gate (the A/B was not run on live models here, `OF010.P4.A`); live route wiring deferred (`OF011.P4.A`); Nexus-Hub touchpoint assessed not-warranted (`OF015.P5.A`); pre-existing `dompurify`/`protobufjs` prod advisories recorded as not-owned by this plan (`ENV.P5.A`). Full suite 4291 passed / 5 skipped / 0 failed; lint + `tsc -b` + check-architecture (0 errors) + security:check + check:tampering (0) all clean. README/ARCHITECTURE/CHANGELOG narrative + the npm version tag are semantic-release-owned and cut on merge to `main`. Prior: **Phase 4 landed 2026-06-17** -- F4 budget-panel routing + local A/B: a [`PanelAbHarness`](../modules/coding/orchestration/PanelAbHarness.ts) (pure aggregation + `decidePanelRoutingDefault` gate + the `scripts/run-panel-ab.mjs` live runner) that measures a small-model panel against the single best resident model on coding tasks; an opt-in [`PanelRouter`](../modules/coding/llm/PanelRouter.ts) heuristic (`nexus.llm.panelRouting`, default off) that escalates a reliability-flagged task to the panel; and the Phase 3 co-residency primitive wired into [`PanelExecutor`](../modules/coding/orchestration/PanelExecutor.ts) (optional `concurrency` backend through `GpuScheduler.enqueuePanel`, closing `OF007.P3.A`) (OF010-OF012). Routing default ships **opt-in (off)** per the no-degradation gate -- the A/B was not run on live models in this environment, so no measured net win exists to flip it (`OF010.P4.A`); the live composition-root route wiring is deferred (`OF011.P4.A`). Full suite 4291 passed / 5 skipped / 0 failed; `tsc -b` + lint + check:tampering (0) clean; check-architecture 0 errors (10 pre-existing warnings); new-module coverage PanelRouter 100% / 100%, PanelAbHarness 100% / 100%, PanelExecutor 100% lines / 100% funcs. Phase 5 (FINAL acceptance gate + docs + Hub sync) pending. Prior: **Phase 3 landed 2026-06-16** -- F3 concurrent multi-model VRAM residency: [`GpuScheduler.enqueuePanel`](../core/scheduler/GpuScheduler.ts) admits a bounded panel as one scheduler job that runs its members concurrently when their summed VRAM fits free VRAM and degrades to sequential fan-out (peaking at the largest single member, never the sum) when it does not -- no OOM, no rejection, single-active-job ceiling preserved for non-panel workloads; a hard panel-size cap (`DEFAULT_PANEL_SIZE_CAP = 3`, overridable) bounds co-residency; [`ModelPinRegistry.holdForPanel`](../core/registry/ModelPinRegistry.ts) keep-alive-holds the panel's models (ref-counted, in-memory, never persisted) for the run and releases them after, leaving a user's explicit pin untouched (OF007-OF009). Full suite 4256 passed / 5 skipped / 0 failed; `tsc -b` + check:tampering (0) clean; new-code coverage GpuScheduler 99.07% lines / 100% funcs, ModelPinRegistry 100% / 100%; check-architecture 0 errors (10 pre-existing warnings). Scheduler primitive + keep-alive are built ahead of their PanelExecutor/route consumer (Phase 4 routing wires them; `OF007.P3.A`). Prior: **Phase 2 landed 2026-06-16** -- F2 + F5 local multi-model panel orchestration + eval-integrity hardening: a [`FusionAgent`](../modules/coding/orchestration/FusionAgent.ts) (the judge, consuming the Phase 1 `fuse` schema, hardened as an untrusted-input boundary -- candidates redacted + treated as data, single-judge SPOF documented) and a [`PanelExecutor`](../modules/coding/orchestration/PanelExecutor.ts) that fans one prompt across N distinct registry models (sequential fan-out MVP), collects labeled candidates, survives a panelist failing, and fuses the survivors; panelists get no per-panelist tools (OF004-OF006). Routing + A/B (F4) is Phase 4. Prior: **Phase 1 landed 2026-06-16** -- F1 structured judge-fusion synthesis: the [`fuse` skill](../modules/coding/skills/catalog/fuse/SKILL.md) emitting the consensus / contradictions / partial-coverage / unique-insights / blind-spots -> grounded-answer schema + `council` synthesis upgrade + an 8-case conformance test. See the [openrouter-fusion plan](versions/v1/v1.6.0/plans/adoption-openrouter-fusion.md) and its [known-gaps](versions/v1/v1.6.0/known-gaps-openrouter-fusion.md). Prior: **v1.6.0 (aisuite-harness) cycle COMPLETE -- all 6 phases closed (Phase 6 FINAL whole-plan acceptance gate passed 2026-06-16)**: every quality gate is green (root suite 4197 passed / 5 skipped / 0 failed, desktop 449 passed / 0 failed, `tsc -b` + lint + check-architecture (0 errors / 10 pre-existing warnings) + security:check + check:tampering all clean) and all six definition-of-pass items are verified; no feature code changed (verification + cycle closure). The Nexus-Hub touchpoint was assessed and judged not warranted (carried as `AS010.P6.A`). README/ARCHITECTURE/CHANGELOG narrative sync + the npm version tag are semantic-release-owned and cut on merge to `main`. Phases 4 (A2 hierarchical sub-run trace nesting) and 5 (A3 manifest-driven loopback-only local-runtime adapter registry) also closed 2026-06-15. Earlier in the cycle: **Phase 3 (A1 session-state artifact dehydration) closed 2026-06-15** -- large session message fields (>20KB) are now moved out-of-line to a content-addressed, redaction-on-write artifact store under `<nexusHome>/session-artifacts/` ([core/memory/ArtifactStore.ts](../core/memory/ArtifactStore.ts) + [sessionArtifacts.ts](../core/memory/sessionArtifacts.ts) + a one-way v1->v2 migration [migrateSessionsDehydrate.ts](../core/memory/migrateSessionsDehydrate.ts) + `.mjs` wrapper) and rehydrated on resume, wired into the sidecar [JsonFileSessionStore](../desktop/sidecar/src/coding/sessionStore.ts) at the disk I/O boundary (public `messages: string[]` unchanged; pre-v2 files load verbatim); 26 core + 4 sidecar tests + a size-delta benchmark, new-module coverage 97.81% lines, root suite 4155 passed / 5 skipped, desktop 449 passed / 0 failed. Prior: **v1.6.0 Phase 2 (A4 session/trace viewer) closed 2026-06-15** -- a standalone shareable, self-contained HTML trace export ([modules/coding/observability/TraceHtmlExport.ts](../modules/coding/observability/TraceHtmlExport.ts) + a vscode-free [TraceDbReader.ts](../modules/coding/observability/TraceDbReader.ts) + a `nexus trace export` CLI) reusing the Phase 1 design tokens and the `InteractiveArtifact` sanitisation rules; static-first timeline + inline JSON, verified by [TraceHtmlExport.test.ts](../tests/unit/observability/TraceHtmlExport.test.ts) (26 cases) + [TraceDbReader.test.ts](../tests/unit/observability/TraceDbReader.test.ts) (5 cases); root suite 4130 passed / 5 skipped / 0 failed, new-module coverage 100% lines. Prior: **v1.6.0 Phase 1 (interactive guide) closed 2026-06-15** -- the AS003 offline-integrity + reduced-motion Vitest test ([tests/unit/guides/nexus-ai-guide.offline.test.ts](../tests/unit/guides/nexus-ai-guide.offline.test.ts), 18 cases) closed the self-contained Nexus-AI interactive guide (AS001/AS002 delivered 2026-06-14). See the [v1.6.0 plan](versions/v1/v1.6.0/plans/adoption-aisuite-harness.md) and [known-gaps](versions/v1/v1.6.0/known-gaps.md). Prior: **v1.5.0 "Local Agent Maturity" Phase 7 (FINAL) landed 2026-06-15** -- Nexus-Hub sync + whole-plan acceptance gate (T023-T024): published the 2 Phase 2 skills to Hub `develop` and integrated all six Hub consumption surfaces (skills + data-index + rules + agents + commands + hooks + MCP-registry-policy-filter); also fixed the failing v1.5.0 CI/Nightly/Installer-smoke workflows + Dependabot CI hygiene. Whole-plan acceptance gate green (root suite 4080, desktop 445, all static gates clean). v1.5.0 complete across all 7 phases; ready for release. Prior: **Phase 5 landed 2026-06-14** -- the Bucket 4 `re-partial` desktop / model-layer set (T015-T020): multimodal image input gated by `isVisionCapableModel` at both prompt-assembly sites (item 33), the `PreviewPane` side-by-side renderer reusing `InteractiveArtifact` (item 24), the vault-only `CredentialsSettings` surface over new `credentials.*` sidecar IPC (item 25), and cross-surface session resume via a persistent `JsonFileSessionStore` + resume-with-history (item 26); the local cron scheduler (item 38) was deferred on the demand gate (`T019.P3.A`). Root suite 4035 / desktop suite 445, all gates clean. Prior: **Phase 4 landed 2026-06-12** -- the Bucket 3 `re-full` planner/critic/worker swarm orchestration (item 36, opt-in default off); closed three v1.4.0 P3 deferrals (`T018.P3.A`, `T018.P3.B`, `T016.P3.A`). Prior: **Phase 3 landed 2026-06-10** -- the inbound prompt-injection classifier (warn-then-allow). Prior: **Phase 2 landed 2026-06-10** -- the two Bucket 2 `skill-native` adoptions. Prior: **Phase 1 landed 2026-06-10** -- the three Bucket 1 `local-only` foundations; see the [v1.5.0 plan](versions/v1/v1.5.0/plans/adoption-ecosystem-2026-06.md) and [known-gaps](versions/v1/v1.5.0/known-gaps.md). Prior: **v1.4.0 complete (Phases 1-9)**, closed 2026-06-09. (v1.4.0 + v1.5.0 work is not yet merged to `main`.)

---

## Scores (update after each sprint)

| Metric | Current | Target | Delta |
|--------|---------|--------|-------|
| Tasks done (v0.1.0) | 13 / 21 | 21 / 21 | -8 |
| Tasks done (v0.2.0) | 44 / 44 | 44 / 44 | 0 |
| Tasks done (v0.3.0) | 55 / 55 | 55 / 55 | 0 |
| Tasks done (v0.4.0) | 16 (P1) + 17 (P2) + 21 (P3) + 21 (P4) + 22 (P5) | ~135 / ~135 | in-progress |

---

## Sprint 1 — Completed Work [DONE]

- [x] Bootstrap VS Code extension scaffold with TypeScript, tsconfig, ESLint, and Vitest (Phase 1)
- [x] Implement OllamaClient with streaming chat, health check, and model listing (Phase 1)
- [x] Build chat engine with ConversationManager and streaming webview UI (Phase 2)
- [x] Implement agentic tool layer with 10 tool handlers and confirmation gate (Phase 3)
- [x] Add skill loader, command router, and plan mode with slash command autocomplete (Phase 4)
- [x] Add persistent SQLite chat history, auto-compact, and edit modes (Phase 5)
- [x] Implement Python inference backend with FastAPI and Gemma chat template (Phase 6)
- [x] Build BackendManager with auto-start and graceful fallback to direct Ollama (Phase 6)
- [x] Build Windows NSIS installer with Ollama, VSIX, venv, and model download (Phase 7)
- [x] Set up CI/CD workflows: ci.yml, release.yml, nightly.yml (Phase 7)
- [x] Fix SSRF vulnerability in FetchPageTool and harden terminal blocklist (Phase 8)
- [x] Add performance benchmark suite and error handling hardening (Phase 8)
- [x] Write comprehensive README, CHANGELOG, and architecture documentation (Phase 8)

## Sprint 2 — v0.1.x maintenance [SUPERSEDED]

*Pre-rename (Gemma Code) maintenance backlog, superseded by the v1.0.0 four-pillar Nexus rebuild. Retained as history; not active work. The unchecked items below were never shipped under the v0.1.x line.*

- [ ] Implement ripgrep-backed GrepCodebaseTool to replace slow workspace.findFiles approach (CHANGELOG Known Limitations)
- [x] Build macOS and Linux installer packages (resolved in v0.3.0 Phase 7 PyQt5 installer)
- [ ] Publish extension to VS Code Marketplace (CHANGELOG Unreleased)
- [ ] Implement Rust performance components for file indexing and grep (CHANGELOG Unreleased)
- [ ] Implement Go CLI tooling for project scaffolding (CHANGELOG Unreleased)

## v0.2.0 — Planned (local Claude Code equivalent)

Full plan: `docs/archive/versions/v0/v0.2.0/development/implementation-plan.md`

### Phase 0 — Gemma 4 Native Protocol Migration
- [x] Create `src/tools/Gemma4ToolFormat.ts` (tool declaration serializer, tool call parser, result formatter)
- [x] Migrate `ToolCallParser.ts` from XML `<tool_call>` regex to Gemma 4 native `<|tool_call>` tokens
- [x] Update `AgentLoop.ts` tool result injection to use `<|tool_result>` format
- [x] Update `ConversationManager.ts` system prompt for native system role
- [x] Update `settings.ts` defaults: model `gemma4:e4b`, maxTokens 131072, temperature 1.0, topP 0.95, topK 64
- [x] Update `prompt.py` to use native system role and Gemma 4 turn tokens
- [x] Update `client.ts` to pass `tools` parameter in Ollama API requests
- [x] Add thinking mode support (`<|think|>` token in system prompt)

### Phase 1 — Dynamic PromptBuilder with Token Budgeting
- [x] Create `src/chat/PromptBuilder.ts` with section-based assembly and greedy packing
- [x] Create `src/chat/PromptBuilder.types.ts` (PromptContext, PromptSection, PromptStyle)
- [x] Create `src/config/PromptBudget.ts` (centralized budget calculator)
- [x] Refactor `ConversationManager.ts` to use PromptBuilder instead of static SYSTEM_PROMPT
- [x] Wire PromptBuilder into `GemmaCodePanel.ts`
- [x] Add `promptStyle` and `systemPromptBudgetPercent` settings

### Phase 2 — Multi-Strategy Context Compaction
- [x] Create `src/chat/CompactionStrategy.ts` with interface and 5 strategy implementations
- [x] Implement ToolResultClearing strategy (regex-based, zero LLM cost)
- [x] Implement SlidingWindow strategy (keep anchors + recent messages)
- [x] Implement CodeBlockTruncation strategy (replace large code blocks with placeholders)
- [x] Refactor `ContextCompactor.ts` to use CompactionPipeline
- [x] Add pre-compaction save hook (wires to MemoryStore in Phase 3)

### Phase 3 — Persistent Memory System
- [x] Create `src/storage/MemoryStore.ts` with SQLite FTS5 schema
- [x] Create `src/storage/EmbeddingClient.ts` wrapping Ollama `/api/embed`
- [x] Add FTS5 virtual table and sync triggers to `ChatHistoryStore.ts`
- [x] Add `buildMemorySection()` to PromptBuilder with budget cap
- [x] Wire memory retrieval into chat flow (GemmaCodePanel)
- [x] Implement pre-compaction memory extraction (`extractAndSave`)
- [x] Add `/memory` slash command (search, save, clear, status)

### Phase 4 — Conditional Tool Activation and MCP Support
- [x] Add enabled/disabled state to `ToolRegistry.ts`
- [x] Update PromptBuilder to only declare enabled tools
- [x] Create `src/mcp/McpServer.ts` (expose tools via MCP stdio)
- [x] Create `src/mcp/McpClient.ts` (consume external MCP servers)
- [x] Create `src/mcp/McpManager.ts` (lifecycle, config from mcp.json)
- [x] Add `/mcp` slash command (status, connect, disconnect)

### Phase 5 — Sub-Agent Orchestration [COMPLETED]
- [x] Create `src/agents/SubAgentManager.ts` (isolated ConversationManager + AgentLoop)
- [x] Create `src/agents/SubAgentPrompts.ts` (verification, research, planning templates)
- [x] Add file-edit counter and auto-verification trigger to AgentLoop
- [x] Add `buildForSubAgent()` to PromptBuilder
- [x] Wire sub-agent status to webview
- [x] Add `/verify` and `/research` slash commands

### Phase 6 — Integration, Polish, and Backend Alignment [COMPLETED]
- [x] Align Python backend prompt.py with multi-strategy compaction
- [x] Update webview UI (memory status, sub-agent spinner, MCP badge)
- [x] Create root-level `SECURITY.md` and `ARCHITECTURE.md`
- [x] Run end-to-end verification checklist (11 items in plan)
- [x] Bump version to 0.2.0, update CHANGELOG

## v0.3.0 — Harness Engineering Infrastructure

Full plan: `docs/archive/versions/v0/v0.3.0/implementation-plan.md`

### Phase 1 — GPU Detection & Hardware-Aware Foundation [COMPLETED]
- [x] GPU/VRAM detection service (nvidia-smi, rocm-smi, system_profiler, WMI fallbacks)
- [x] Hardware tier classification (3 tiers: constrained/balanced/full)
- [x] Tier-aware context budget calculator (expanded BudgetOverrides, calculateTierBudget)
- [x] Token and iteration budget middleware (BudgetMiddleware in AgentLoop)
- [x] Wire GPU detection into extension lifecycle (status bar, detectGpu command, panel integration)

### Phase 2 — Advanced Context Engineering [COMPLETED]
- [x] Lazy tool loading with progressive disclosure
- [x] Output redirection for large tool results
- [x] Enhanced compaction with regenerate-from-source
- [x] Context budget middleware chain
- [x] Token estimation accuracy improvements

### Phase 3 — Graph-Vector Hybrid Memory [COMPLETED]
- [x] 4-layer memory stack (working/episodic/semantic/graph)
- [x] Entity extraction and provenance tracking
- [x] Memory-aware context assembly
- [x] Memory pruning and consolidation

### Phase 4 — Safety, Budgeting & Runaway Prevention [COMPLETED]
- [x] Hash-based loop detection
- [x] Irreversible action classification
- [x] Git safety net
- [x] Permission escalation system

### Phase 5 — Plan-and-Execute Orchestration [COMPLETED]
- [x] Task DAG data model and PlannerAgent (LLM-based request decomposition)
- [x] DAG executor with GPU-aware semaphore scheduling
- [x] Reflexion pattern for error recovery (analyze, constrain, retry)
- [x] Structured output contracts for sub-agent communication
- [x] Orchestrator integration with GemmaCodePanel (plan mode + complexity heuristic)
- [x] Dynamic replanning on divergence (>30% failure threshold)

### Phase 6 — Local Observability & Trace Dashboard [COMPLETED]
- [x] SQLite trace store (TraceStore with spans, traces, events)
- [x] Tracer singleton with no-op mode and core component instrumentation
- [x] Metrics collector and golden task evaluation framework
- [x] Webview-based trace dashboard with waterfall visualization
- [x] Optional OTLP export (off by default, minimal fetch-based exporter)

### Phase 7 — Cross-Platform PyQt5 Installer [COMPLETED]
- [x] PyQt5 project scaffold with dark theme engine and custom widgets (7.1)
- [x] Welcome, Prerequisites, GPU Detection wizard pages with background detection (7.2)
- [x] Install Path, Model Selection, Configuration, Review wizard pages (7.3)
- [x] Installation engine with Ollama/extension/venv/model installers and real-time log (7.4)
- [x] Completion page with services table, management commands, and navigation polish (7.5)
- [x] Cross-platform packaging: PyInstaller for Windows/macOS/Linux (7.6)
- [x] Comprehensive test suite (184 tests, 83% coverage) and NSIS migration to legacy (7.7)
- [x] Testing stabilization to 80%+ coverage (7.T)

### Phase 8 — Golden Task Suite & Integration Stabilization [COMPLETED]
- [x] Golden task framework: types, loader, runner, evaluator, reporter, snapshot (8.1)
- [x] 24 golden task YAMLs + snapshots across 5 categories (8.2)
- [x] Per-tier model-matrix, memory-recall, and golden-task-perf benchmarks (8.3)
- [x] Baseline save/load + regression detection framework (8.3)
- [x] Installer CLI flags (`--headless`, `--model`, `--install-path`, `--skip-model`, `--json-output`) (8.4)
- [x] Cross-platform smoke tests (Windows PowerShell, macOS/Linux bash) with verify + cleanup helpers (8.4)
- [x] E2E integration tests: full-pipeline, memory-across-sessions, compaction-under-load, sub-agent, MCP, prompt-budget (8.5)
- [x] Comparison framework (`compare_versions` + markdown report) (8.6)
- [x] v0.3.0 architecture doc, performance benchmarks, performance comparison template (8.6)
- [x] `.github/workflows/golden-tasks.yml` + `installer-smoke.yml` (conservative, workflow_dispatch + weekly cron) (8.7)
- [x] Release checklist and CI pipeline documentation (8.7)
- [x] ARCHITECTURE.md, CHANGELOG.md, docs/todos.md updates (8.6)

## Backlog

- [ ] *(suggested)* Improve web search backend to reduce rate-limiting and improve result quality
- [ ] *(suggested)* Add E2E test suite to the standard CI matrix for pre-merge validation
- [ ] *(deferred)* Tree-sitter AST parsing for semantic code understanding (from Graphify comparison)
- [ ] *(deferred)* Knowledge graph generation (from Graphify/MemPalace comparisons)
- [ ] *(deferred)* Chat format normalization for importing Claude/ChatGPT history (from MemPalace comparison)
- [ ] *(deferred)* Retrieval quality benchmarks (from MemPalace comparison)

### v0.5 follow-ups (deferred from v0.4.0 Phase 6)

- [ ] Complete the GemmaCodePanel split: extract `ChatController` (agent loop + orchestration mediator) and `ChatWebviewHost` (webview provider + message translation) from `src/panels/GemmaCodePanel.ts`. Reduce the panel to <100 lines or delete it; thin `extension.ts` to a lifecycle adapter. Seam already in place via `GemmaRuntime`.
- [ ] Finish settings injection: eliminate the 12 `_getSettings()` reads inside `panels/GemmaCodePanel.ts` and the activation-time `getSettings()` in `extension.ts`. Reach the strict acceptance criterion of "exactly one `getSettings()` call, in `GemmaRuntime`."
- [ ] Expand Zod adoption beyond the LLM boundary: `panels/messages.ts` (webview payloads), `storage/GraphMemory.ts` (persisted entity attributes), `observability/TraceStore.ts` (persisted span attributes).
- [ ] Upgrade `marked` from v4 to v12: adapt the renderer API break, snapshot-test the rendered HTML against the existing fixture set, keep DOMPurify in the pipeline. See the `NOTE(v0.5)` comment in `src/utils/MarkdownRenderer.ts:1`.

---

## Functionality Matrix

### Tool Handlers

| Feature | Status | File/Location | Sprint |
|---------|--------|---------------|--------|
| read_file | Done | `src/tools/handlers/` | -- |
| write_file | Done | `src/tools/handlers/` | -- |
| create_file | Done | `src/tools/handlers/` | -- |
| delete_file | Done | `src/tools/handlers/` | -- |
| edit_file | Done | `src/tools/handlers/` | -- |
| list_directory | Done | `src/tools/handlers/` | -- |
| grep_codebase | Partial | `src/tools/handlers/` | Sprint 2 |
| run_terminal | Done | `src/tools/handlers/terminal.ts` | -- |
| web_search | Done | `src/tools/handlers/webSearch.ts` | Sprint 3 |
| fetch_page | Done | `src/tools/handlers/webSearch.ts` | -- |

### Platform Installers

| Platform | Status | File/Location | Sprint |
|----------|--------|---------------|--------|
| Windows (NSIS) | Done | `scripts/installer/setup.nsi` | -- |
| macOS | Missing | -- | Sprint 2 |
| Linux | Missing | -- | Sprint 2 |
| VS Code Marketplace | Missing | -- | Sprint 2 |

---

## v0.4.0 — Code Review Remediation

Driven by [docs/archive/versions/v0/v0.3.0/review.md](archive/versions/v0/v0.3.0/review.md) (129 findings: 14 P0, 46 P1, 42 P2, 27 P3). Plan: [docs/archive/versions/v0/v0.4.0/implementation-plan.md](archive/versions/v0/v0.4.0/implementation-plan.md).

### Phase 1 — Critical Hotfix (P0 Unblock) [COMPLETED 2026-04-18]

All 14 P0 findings closed plus version bump. See [docs/DEVLOG.md](DEVLOG.md) and [docs/adr/0001-python-backend-disposition.md](adr/0001-python-backend-disposition.md) for detail.

- [x] 1.1 DOMPurify-sanitize markdown + tighten webview CSP
- [x] 1.2 Restrict `run_terminal` cwd to workspace root (via `src/tools/handlers/pathGuard.ts`)
- [x] 1.3 Add AFTER UPDATE FTS5 trigger to ChatHistoryStore + switch `saveMessage` to UPDATE-or-INSERT
- [x] 1.4 Delete dead in-degree loop in TaskDAG.hasCycle
- [x] 1.5 Fix GraphQueryEngine path reconstruction
- [x] 1.6 Add Float32 embedding cache + FTS5 candidate filter to MemoryStore.searchSemantic
- [x] 1.7 Batch tracer writes; eliminate SELECT in endSpan
- [x] 1.8 Add end-to-end safety-pipeline integration test
- [x] 1.9 Add McpToolHandler unit tests
- [x] 1.10 Add SessionListPanel unit tests + attribute-context escaping (closes #87)
- [x] 1.11 Wire benchmark threshold gating in nightly.yml
- [x] 1.12 Wire golden-task live-Ollama matrix CI (e2b + e4b)
- [x] 1.13 Delete Python backend; record ADR-0001
- [x] 1.14 Extract MemorySubsystem factory from GemmaCodePanel (-84 LOC)
- [x] 1.15 Version bump to 0.4.0 + CHANGELOG seed
- [x] 1.16 Testing & stabilization (build + lint + test green on touched files)

### Phase 2 — Security Hardening [COMPLETED 2026-04-19]

20 non-P0 security findings closed (6 P1 + 9 P2 + 5 P3). 2.2 and 2.13 closed N/A per ADR-0001. See [docs/archive/versions/v0/v0.4.0/development/history/2026-04_phase-2-security-hardening.md](archive/versions/v0/v0.4.0/development/history/2026-04_phase-2-security-hardening.md).

### Phase 3 — Correctness & Code Quality [COMPLETED 2026-04-19]

24 findings closed (8 P1 + 10 P2 + 6 P3). See [docs/archive/versions/v0/v0.4.0/development/history/2026-04_phase-3-correctness.md](archive/versions/v0/v0.4.0/development/history/2026-04_phase-3-correctness.md).

### Phase 4 — Performance Optimization [COMPLETED 2026-04-19]

20 findings closed across seven waves; 5 closed N/A. See [docs/archive/versions/v0/v0.4.0/development/history/2026-04_phase-4-performance.md](archive/versions/v0/v0.4.0/development/history/2026-04_phase-4-performance.md).

### Phase 5 — Testing Pipeline Completeness [COMPLETED 2026-04-19]

22 findings closed; 2 closed N/A. 1166 Vitest cases at 89.07% line / 82.78% branch coverage. See [docs/archive/versions/v0/v0.4.0/development/history/2026-04_phase-5-testing-pipeline.md](archive/versions/v0/v0.4.0/development/history/2026-04_phase-5-testing-pipeline.md).

### Phase 6 — Restructuring (Architecture) [COMPLETED 2026-04-24]

14 of 17 sub-tasks landed; 3 scoped down with documented v0.5 deferrals (panel split, full settings injection, full Zod boundary coverage). See the [DEVLOG entry](DEVLOG.md) for the full breakdown.

- [x] 6.1 Record ADR-0001 Python backend disposition
- [x] 6.2 GemmaRuntime composition root extracted (full ChatController / ChatWebviewHost split deferred to v0.5)
- [x] 6.3 src/safety/ -> src/guardrails/ (all 5 modules + BLOCKED_PATTERNS extracted to policy.ts)
- [x] 6.4 src/llm/ port with vendor-neutral types + OllamaClient driver (10 consumers migrated; src/ollama/ deleted)
- [x] 6.5 src/llm/OllamaHttp.ts shared client; OllamaClient + EmbeddingClient compose over it
- [x] 6.6 GoldenTaskSuite + goldenTasksYaml.generated.ts moved to src/evaluation/
- [x] 6.7 src/modes/PlanMode.ts inlined into src/chat/PlanMode.ts; src/modes/ deleted
- [x] 6.8 Tracer singleton retired; constructor injection via GemmaRuntime; tests parallel-safe
- [x] 6.9 Settings injection in ContextCompactor + RegenerateFromSource (panel reads deferred)
- [x] 6.10 src/utils/logger.ts (vscode.OutputChannel wrapper); 25 console.* calls migrated; ESLint no-console -> error
- [x] 6.11 src/utils/errors.ts (formatForUser with redaction; formatForLog); 21 ad-hoc patterns replaced
- [x] 6.12 Zod schemas at LLM boundary (stream chunks + listModels); webview/storage/observability deferred
- [x] 6.13 docs/adr/ scaffolding (README index + MADR template)
- [x] 6.14 scripts/dev-setup.{sh,ps1} + CONTRIBUTING.md + npm run dev
- [x] 6.15 Already satisfied via Phase 5 sub-task 5.19 (no-op)
- [x] 6.16 marked v12 deferred with NOTE(v0.5) (renderer API break; DOMPurify already provides sanitization)
- [x] 6.17 Lint + test + build stabilization (1165 pass / 0 fail; 0 lint errors)

### Phase 7 — Simplification & Release [SUPERSEDED]

*Never shipped under v0.4.0: the release + simplification work rolled into the v0.5.0 Unified Adoption Release (tag `v0.5.4`). Retained as history; not active work.*

17 simplification findings; ~800 LOC target deletion; v0.4.0 tag + VSIX publish.

---

## v0.5.0 — Unified Adoption Release [SHIPPED 2026-04-26]

12-phase consolidation cycle adopting five external comparisons (Claude Code, Routa, Foundry Vault, Token Optimizer MCP, agent-friendly CLI rubric). All phases landed; tag `v0.5.4` cut. Plan: [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](archive/versions/v0/v0.5.0/plans/implementation-plan.md). Architecture: [docs/archive/versions/v0/v0.5.0/architecture.md](archive/versions/v0/v0.5.0/architecture.md).

- [x] Phase 1 — Identity & Naming (AGENTS.md canonical; CLAUDE.md removed)
- [x] Phase 2 — Tool Surface Hardening (max_bytes, range_start/end, next_offset)
- [x] Phase 3 — Compression Foundation
- [x] Phase 4 — Persistent Cache + Diff-Based Reads
- [x] Phase 5 — Semantic Recall + Budgeting
- [x] Phase 6 — Mutation Safety + Structured Outputs (dry_run, format=json)
- [x] Phase 7 — Memory Hygiene + Corroboration
- [x] Phase 8 — Generic Harness + Specialist Externalization
- [x] Phase 9 — Coverage + Observability
- [x] Phase 10 — Local-Dev Hygiene + CI Hardening
- [x] Phase 11 — Documentation Discipline (ADRs, catalog, governance)
- [x] Phase 12 — Advanced Fallbacks (PredictiveCache, eviction strategies, HeuristicEmbedder, semantic-release)

---

## v0.6.0 — Review-Driven Cycle [SUPERSEDED]

*Closed out by the v1.0.0 four-pillar Nexus rebuild, which superseded the remaining v0.x roadmap. Phases 1, 5, and 6 landed (below); Phases 2, 3, 4, 7, and 8 were never shipped under v0.6.0. Retained as history; not active work.*

Hygiene/ratchet cycle closing the v0.6.0 review pass (1 P0, 6 P1, 9 P2, 11 P3). No new product surface; pays down v0.5.0 technical debt. Plan: [docs/archive/versions/v0/v0.6.0/plans/v0.6.0-cycle.md](archive/versions/v0/v0.6.0/plans/v0.6.0-cycle.md).

### Phase 1 — Security chain closure [COMPLETED 2026-04-26]

Closes pen-test F-001, F-003, F-004; both legs of Attack Path A refuse the operation. See [docs/archive/versions/v0/v0.6.0/development/history/2026-04_phase-1-security-chain-closure.md](archive/versions/v0/v0.6.0/development/history/2026-04_phase-1-security-chain-closure.md).

- [x] 1.1 Unify path resolution behind realpath-aware `pathGuard.resolveInsideWorkspace` (with ancestor walk for non-existent leaves) + 7-tool symlink regression test
- [x] 1.2 Clamp `permissionOverrides` so confirmation-tier tools cannot drop to AUTO_APPROVE (with logger warning + dedupe)
- [x] 1.3 Tag MCP-originated tool calls with `source: "mcp"` peer attribution in ConfirmationGate; add `gemma-code.mcpExposedTools` allowlist (read-only by default)
- [x] 1.4 Phase 1 testing and stabilization (17 new tests + lint + deps:check + catalog:check green)

### Phase 2 — Test pipeline reliability + release-gate baselines [SUPERSEDED]
### Phase 3 — Defense-in-depth ratchets [SUPERSEDED]
### Phase 4 — Module-boundary ratchet [SUPERSEDED]

### Phase 5 — Doc/code drift + dead-code cleanup [COMPLETED 2026-05-03]

Closes pen-test F-007, F-008, F-014; known-gaps 4.2, 4.3, 5.1, 5.3, 5.4, sections 8 + 9.7; codebase-review #4, #7, #13, #20. See [docs/archive/versions/v0/v0.6.0/development/history/2026-05_phase-5-doc-code-drift.md](archive/versions/v0/v0.6.0/development/history/2026-05_phase-5-doc-code-drift.md).

- [x] 5.1 Decide PredictiveCache: deleted (Option B). Hard constraint #1 forbids new product surface; setting was unwired; bench measured latency, not hit-rate.
- [x] 5.2 Decide threshold elevation: implemented (Option A). Per-row provenance threshold in `searchByEmbedding`; `gemma-code.ollamaEmbeddingThreshold` (0.85) + `gemma-code.heuristicEmbeddingThreshold` (0.95) settings; 3 real heuristic-fallback tests replace the `it.todo`.
- [x] 5.3 Delete legacy `gemma-code.gpuTier` setting fallback; CHANGELOG `### Removed` entry.
- [x] 5.4 Architecture-doc inaccuracies: meta-test path corrected; v0.4.0 ship date bumped to 2026-04-25; permission-tier table now generated from `PermissionTiers.ts` via `scripts/generate-tool-permission-table.mjs` and CI-gated in `catalog-sync` (also fixed two inverted tier rows -- delete_file is tier 1, web_search is tier 2).
- [x] 5.5 FIFO-vs-LRU reconciled: `accessed_at` column + index added; `lookup()` bumps it; `_enforceCapacity()` orders by it; hot-vs-cold regression test.
- [x] 5.6 Migration-ordering regression test (4 cases) seeds v0.4.0 schema, asserts all four migrations land cleanly + are idempotent.
- [x] 5.7 Lint + test + build + deps stabilization (1579 pass / 0 fail; 0 lint errors).

### Phase 6 — Panel decomposition [COMPLETED 2026-05-03]

Closes codebase-review #2, #3, #16 (deferred), #23. See [docs/archive/versions/v0/v0.6.0/development/history/2026-05_phase-6-panel-decomposition.md](archive/versions/v0/v0.6.0/development/history/2026-05_phase-6-panel-decomposition.md).

- [x] 6.1 Extract `ChatController.ts` (agent-loop wiring + slash-command dispatch composition). Routes `submitUserMessage`, `cancelInFlight`, `approveStep`, plan detection, and pre-prompt memory injection. Tests: 12 cases, 90% coverage.
- [x] 6.2 Extract `ChatWebviewHost.ts` (sidebar view + editor panel + postMessage routing + focus tracking). Tests: 7 cases, 99% coverage.
- [x] 6.3 Extract `ChatCommandHandlers.ts` (12 slash commands moved out of the panel). Tests: 33 cases, 86% coverage.
- [x] 6.4 Source-level webview split (Option B): `scaffold.ts` / `bodyMarkup.ts` / `runtime.ts` / `styles.ts`. `index.ts` shrank from 1,573 to 12 lines. Tests: 9 scaffold + 4 CSP cases.
- [ ] 6.5 Optional: split `filesystem.ts` per-tool. **Deferred per plan note** ("Lower-priority; defer if Phase 6 is already large").
- [x] 6.6 Stabilization: lint clean, typecheck clean, deps:check clean, catalog regenerated. Manual flow verification (5 paths) is on the operator -- see history file section 4.

**Partial deviation**: `GemmaCodePanel.ts` is 935 lines (down from 1,724); the plan's < 400 target requires further factory work (PanelComposition + post-helper move) tracked as v0.7.0 follow-up. See history file section 3.1.

### Phase 7 — Polish + simplification [SUPERSEDED]
### Phase 8 — Release gate + ADRs + CHANGELOG [SUPERSEDED]

---

## v0.7.0 — Multi-Source Adoption Cycle [SUPERSEDED]

*Closed out by the v1.0.0 four-pillar Nexus rebuild, which superseded the remaining v0.x roadmap. Phases 0-5 landed (below); Phases 6, 7, and 8 were never shipped under v0.7.0. Retained as history; not active work.*

Phased adoption of comparison-multi-source findings across skills, memory architecture, compaction, render protocol, and per-model context overrides. Plan: [docs/archive/versions/v0/v0.7.0/plans/v0.7.0-cycle.md](archive/versions/v0/v0.7.0/plans/v0.7.0-cycle.md).

### Phase 0 — Close-out + carryovers [COMPLETED 2026-05-05]
### Phase 1 — Skill expansion (zero-code first) [COMPLETED 2026-05-05]
### Phase 2 — Memory file architecture [COMPLETED 2026-05-05]

### Phase 3 — Compaction stack expansion [COMPLETED 2026-05-05]

Adopts C12 / C13 / C14 / C15 / C16. Adds two deterministic strategies (deduplication, purgeErrors), a model-callable compress tool with two modes (range, message-experimental), per-session CompressionState, six `/compact` verbs, per-model context overrides, and ADR-0012. See [docs/DEVLOG.md](DEVLOG.md) for details.

- [x] 3.1 Deduplication compaction strategy (`src/chat/strategies/deduplication.ts` + 8 tests)
- [x] 3.2 Purge-errors compaction strategy (`src/chat/strategies/purgeErrors.ts` + 5 tests)
- [x] 3.3 CompressionState module + block ID allocation (`src/chat/state/CompressionState.ts` + 6 tests)
- [x] 3.4 `compress_range` tool handler (`src/tools/handlers/compress.ts` + prompt md + 6 tests)
- [x] 3.5 `compress_message` tool handler (experimental, flag-gated; 3 tests)
- [x] 3.6 `/compact <verb>` commands (`src/commands/compactCommand.ts` + 9 tests; sweep auto-issue deferred to Phase 4)
- [x] 3.7 Per-model context-limit overrides (`gemma-code.contextLimitsPerModel` + `resolveModelContextLimit` + 6 tests)
- [x] 3.8 ADR-0012 model-callable compress tool design (renumbered from plan's ADR-0006 because 0006 is taken)

### Phase 4 — Webview render protocol expansion [COMPLETED 2026-05-06]

Adopt the seven Claude-Code-style chat-UI primitives (S7 / C21-C27): inline diff cards, action-type tags, numbered permission prompts, structured todo blocks, "Thought for Ns" meta-rows, queued-message fields, and end-of-task completion reports. History: [docs/archive/versions/v0/v0.7.0/development/history/2026-05_phase-4-webview-render-protocol.md](archive/versions/v0/v0.7.0/development/history/2026-05_phase-4-webview-render-protocol.md).

- [x] 4.1 Inline diff card (`src/panels/webview/render/diffCard.ts` + 6 tests)
- [x] 4.2 Action-type tag (`src/panels/webview/render/actionTag.ts` + 10 tests)
- [x] 4.3 Numbered permission prompt (`src/panels/webview/render/permissionPrompt.ts` + 10 tests; `ConfirmationGate.requestPrompt`)
- [x] 4.4 Todo block + `update_todos` tool (5 + 4 tests; `src/tools/handlers/todos.ts` permission tier 0)
- [x] 4.5 Thought-for-Ns meta-row (`src/panels/webview/render/thoughtMetaRow.ts` + 5 tests; StreamingPipeline emits)
- [x] 4.6 Queued-message field (renderer 6 tests + ConversationManager queue 4 tests; UX wiring deferred to v0.8.0)
- [x] 4.7 Completion-report block (`src/panels/webview/render/completionReport.ts` + 7 tests; `buildCompletionReport`)
- [x] 4.8 ADR-0013 webview render protocol (renumbered from plan's ADR-0008 because 0006-0012 are taken)

**Follow-ups (deferred to v0.8.0 Phase 1)**: panel-host adoption of the new render protocol -- (a) replace input row with queued-message field during streaming, (b) route `permissionPromptResponse` through `ChatMessageRouter` to `gate.resolvePrompt`, (c) wire `ToolRegistryBuilder.todos` in the panel bootstrap. All three share the same surface; bundling is intentional.

### Phase 5 — Memory commands + manual memory page UI + per-model context limits [COMPLETED 2026-05-07]

Polish the memory experience: complete `/memory` slash-command surface, ship a sidebar `MemoryPanel` webview, and confirm the per-model context-limit override is wired. Plan: [docs/archive/versions/v0/v0.7.0/plans/v0.7.0-cycle.md](archive/versions/v0/v0.7.0/plans/v0.7.0-cycle.md) Phase 5.

- [x] 5.1 `/memory forget`, `/memory export`, `/memory import` slash commands (extends `ChatCommandHandlers.dispatch("memory", ...)`; new helpers `parseForgetArgs`, `parseImportArgs`, `forgetMatchingSqlRows`; new `MemoryStore.deleteById`; 13 cases + 4 parser cases in `tests/unit/panels/ChatCommandHandlers.test.ts`)
- [x] 5.2 MemoryPanel webview tab (`src/panels/MemoryPanel.ts`, `src/panels/webview/memoryView.ts`, view registered in `package.json`, wired in `src/extension.ts` via `chatPanel.getMemoryFiles()` / `chatPanel.getMemoryStore()`; 13 cases in `tests/unit/panels/MemoryPanel.test.ts`)
- [x] 5.3 ADR-0014 memory file architecture (renumbered from plan's ADR-0007 because 0007 is taken; same pattern as ADR-0013)
- [x] Per-model context limits finalised (no new code; Phase 3 sub-task 3.7 already shipped `resolveModelContextLimit` + 6 tests; tracked as in-cycle gap 10.O.6 for the audit trail)

**Follow-ups carried into v0.8.0**: same three Phase 4 panel-host items (queued-field swap, permissionPromptResponse routing, todos opt-in wiring); no new follow-ups from Phase 5.

### Phase 6 — Multi-harness skill packaging [SUPERSEDED]
### Phase 7 — HNSW vector index (optional) [SUPERSEDED]
### Phase 8 — Release gate + ADRs + CHANGELOG [SUPERSEDED]

---

## v1.x line - Nexus (post-rename)

The project was renamed from Gemma Code to Nexus at v1.0.0 (the four-pillar desktop AI Studio pivot). The detailed boards above (v0.1.0 - v0.7.0) are retained as history. The v1.x cycles are tracked here at cycle/phase altitude; per-task detail lives in each cycle's plan and `known-gaps.md` under `docs/versions/v1/<version>/`.

| Cycle | Theme | Status | Source plan |
|---|---|---|---|
| v1.0.0 | Four-pillar desktop pivot (Coding/Chat/Image/Video) + cross-OS installer + MCP harness + skill catalog | Shipped | `versions/v1/v1.0.0/` |
| v1.1.0 | Stabilization + expansion (hybrid retrieval, memory CLI, session replay, SANA image tier) | Closed 2026-05-26 | `versions/v1/v1.1.0/` |
| v1.2.0 | 2026-05 ecosystem adoption (code-graph MCP, command compressor, AST chunker, PrunedDenseIndex, LSP) | Phases 1-7 landed | `versions/v1/v1.2.0/plans/adoption-ecosystem-2026-05.md` |
| v1.3.0 | skill-cleaner adoption (`nexus skills audit` token-budget report) | All 7 phases landed 2026-05-29 | `versions/v1/v1.3.0/plans/adoption-skill-cleaner.md` |
| v1.4.0 | claude-code-harness adoption + known-gaps closure + Nexus-Hub sync | **Complete (Phases 1-9)**; closed 2026-06-09 | `versions/v1/v1.4.0/plans/adoption-claude-code-harness.md` |
| v1.5.0 | Local Agent Maturity (2026-06 scan: energy telemetry, credential vault, swarm orchestration, multimodal input) + Nexus-Hub surface integration | **Complete (Phases 1-7)** -- Phases 1-3 landed 2026-06-10, Phase 4 2026-06-12, Phases 5-6 2026-06-14, Phase 7 (Nexus-Hub sync + 6-surface integration + acceptance gate) 2026-06-15; ready for release | `versions/v1/v1.5.0/plans/adoption-ecosystem-2026-06.md` |
| v1.6.0 | aisuite harness adoptions + Nexus-AI interactive guide (H1 guide, A4 session viewer, A1 dehydration, A2 trace nesting, A3 adapter registry) | **Complete (Phases 1-6)** -- Phases 1-5 closed 2026-06-15 (H1 interactive guide AS001-AS003; A4 session/trace viewer AS004; A1 session-state artifact dehydration AS005; A2 hierarchical sub-run trace nesting AS006; A3 manifest-driven local-runtime adapter registry AS007 -- demand-gated forward-looking refactor, ADR-0019); Phase 6 FINAL (whole-plan acceptance gate + Hub-sync assessment, AS008-AS010) closed 2026-06-16, all gates green, all 6 definition-of-pass items verified; ready for release | `versions/v1/v1.6.0/plans/adoption-aisuite-harness.md` |
| v1.6.0 (companion) | OpenRouter Fusion technique reverse-engineered local-only (F1 fuse skill, F2 panel executor, F3 VRAM co-residency, F4 budget-panel routing + A/B) | **Complete (Phases 1-5)** -- Phase 1 (F1 `fuse` skill + `council` synthesis upgrade + schema-conformance test, OF001-OF003) landed 2026-06-16; Phase 2 (F2 `PanelExecutor`/`FusionAgent` distinct-model fan-out + F5 untrusted-input/tool-isolation hardening, OF004-OF006) landed 2026-06-16; Phase 3 (F3 `GpuScheduler.enqueuePanel` VRAM-gated panel co-residency + degrade-to-sequential + `ModelPinRegistry.holdForPanel` keep-alive, OF007-OF009) landed 2026-06-16; Phase 4 (F4 `PanelAbHarness` local A/B + opt-in `PanelRouter`/`nexus.llm.panelRouting` heuristic + `PanelExecutor` `GpuScheduler.enqueuePanel` concurrency wiring, OF010-OF012) landed 2026-06-17; Phase 5 FINAL (whole-plan acceptance gate + close-out, OF013-OF015) closed 2026-06-17 -- all six definition-of-pass items verified, no feature code changed. Routing default ships opt-in (off) per the no-degradation gate since the A/B was not run on live models here (`OF010.P4.A`); live route wiring deferred (`OF011.P4.A`); Hub touchpoint not warranted (`OF015.P5.A`); pre-existing `dompurify`/`protobufjs` prod advisories recorded as not-owned (`ENV.P5.A`). README/ARCHITECTURE/CHANGELOG narrative + version tag are semantic-release-owned at merge to `main` | `versions/v1/v1.6.0/plans/adoption-openrouter-fusion.md` |

### v1.4.0 status (COMPLETE -- closed 2026-06-09)

- Adoptions A1-A12: all 12 landed (Phases 1-6).
- Carryforward: 34 of 36 gaps resolved (6 in Phase 7, 22 in Phase 8, 2 in Phase 9: `1.1.P2.A` + `1.1.P3.B`). Re-justified as Hub-owned (open against the Nexus-Hub repo, not closeable from Nexus-AI): `T017.P3.E`, `T002.P2.A`.
- Phase 9 (FINAL, `T032-T035`) complete: Nexus-Hub integration delta written ([development/nexus-hub-integration-delta.md](versions/v1/v1.4.0/development/nexus-hub-integration-delta.md)); `DEFAULT_UPSTREAM` fixed `bendourthe/DevAI-Hub` -> `bendourthe/Nexus-Hub`; whole-plan acceptance gate green (build/lint/arch/check/audit-prod/test+coverage; 87.19% lines; the `hono` prod advisory fixed in-phase to 4.12.25); known-gaps finalized; [RELEASE_NOTES.md](versions/v1/v1.4.0/RELEASE_NOTES.md) written; desktop product version bumped 1.3.0 -> 1.4.0.
- Carried to v1.5.0: P3 deferrals `T016.P3.A`, `T018.P3.A`, `T018.P3.B`, `T022.P3.A` (all four now closed -- the first three in v1.5.0 Phase 4, `T022.P3.A` in Phase 6); the `HUB.P3.*` Hub-v3.x integration items; `T034.P2.A` (dev-only npm advisories).

### v1.5.0 plan (newly filed this session, 2026-06-09)

Derived from the [2026-06 ecosystem comparison](versions/v1/v1.5.0/comparison-ecosystem-2026-06.md) (8 sources; the scan largely validated the existing v1.x direction). RE-first ordered; 7 phases:

- [x] Phase 1 - Local-only foundations: Gemma 4 GGUF quant ladder, OS-keychain credential vault, intelligence-per-watt telemetry (landed 2026-06-10; T001-T004; [known-gaps](versions/v1/v1.5.0/known-gaps.md), [session history](versions/v1/v1.5.0/development/history/2026-06_phase-1-local-only-foundations.md))
- [x] Phase 2 - Skill-native: DCI search-discipline skill + agent presets (landed 2026-06-10; T005-T007; authored in Nexus-Hub on branch `feat/dci-discipline-and-agent-presets` -- `developer-experience/direct-corpus-interaction` + `workflow/agent-presets`; merge/publish/`nexus skills sync` deferred to Phase 7/T023; [session history](versions/v1/v1.5.0/development/history/2026-06_phase-2-skill-native.md))
- [x] Phase 3 - Inbound security: prompt-injection classifier (warn-then-allow) (landed 2026-06-10; T008-T009; `modules/coding/security/InboundClassifier.ts` routed over `fetch_page`/`web_search` in `AgentLoop`; toggles `nexus.coding.inboundClassifier.enabled`/`.deepScan`; [session history](versions/v1/v1.5.0/development/history/2026-06_phase-3-inbound-security.md))
- [x] Phase 4 - Swarm/DAG orchestration over worktree sub-agents (landed 2026-06-12; T010-T014; `CriticAgent` + `DAGExecutor` isolate/critic options + `Orchestrator` `swarmEnabled` flag + read-tool worktree rooting + live PreCompact hook; opt-in `nexus.coding.swarmOrchestration.enabled` default off; closes v1.4.0 `T018.P3.A`, `T018.P3.B`, `T016.P3.A`; [session history](versions/v1/v1.5.0/development/history/2026-06_phase-4-swarm-orchestration.md))
- [x] Phase 5 - Model-layer & desktop re-partials (landed 2026-06-14; T015-T020; multimodal image input + `isVisionCapableModel` vision gate (item 33), `PreviewPane` side-by-side pane (item 24), vault-only `CredentialsSettings` + `credentials.*` IPC (item 25), persistent `JsonFileSessionStore` + resume-with-history (item 26); item 38 local cron DEFERRED -- `T019.P3.A`; partially closes `T001.P3.A`; [session history](versions/v1/v1.5.0/development/history/2026-06_phase-5-desktop-re-partials.md))
- [x] Phase 6 - Carryforward: Tree-sitter `.wasm` packaging (landed 2026-06-14; T021-T022; scanner bundled-wasm-dir override `setTreeSitterWasmDir` + `Parser.init({locateFile})`, `build:sidecar` esbuild config copies the 4 grammar `.wasm` + web-tree-sitter runtime `.wasm` into `sidecar/dist/wasm` with a CJS dist marker + startup warm-up, VSIX `.vscodeignore` grammar trim; closes v1.4.0 `T022.P3.A`; full Tauri `build:shell` not run here (cargo absent) -- `T021.P3.A`; [session history](versions/v1/v1.5.0/development/history/2026-06_phase-6-tree-sitter-packaging.md))
- [x] Phase 7 - FINAL: Nexus-Hub sync + whole-plan acceptance gate (landed 2026-06-15; T023-T024; published the 2 Phase 2 skills to Hub `develop` (`fe8eb68`, no tag); integrated all four net-new non-skill Hub surfaces -- `HUB.P3.DATA` (sync index enrichment), `HUB.P3.RULES` (language rules -> prompt), `HUB.P3.AGENT` (persona dispatch), `HUB.P3.CMD` (hub-command routing), `HUB.P3.HOOK` (sparse-checkout + installer), `HUB.P3.MCPCFG` (policy-gated registry filter); whole-plan acceptance gate green (root 4080 / desktop 445 / lint / tsc / arch / tampering / prompts / security / audit-prod all clean); see [integration delta](versions/v1/v1.5.0/development/nexus-hub-integration-delta.md). Also fixed the v1.5.0 CI/Nightly/Installer-smoke workflows (docs-sync regen, installer `[dev]` extra + importlib.metadata, smoke `--skip-extension` + venv/extension drift, Windows ollama auto-start/IPv4 + missing httpx dep) and the Dependabot CI hygiene (branch `fix/dependabot-ci-hygiene`).)

**Branch**: `feat/v1.5.0-phase-3-inbound-security` (chained off the Phase 2 branch; v1.5.0 not yet merged to `main`). All 7 phases complete; ready for release.

---

## Recurring Obligations

- [ ] Review AGENTS.md against current model behavior every 6 months -- next review due 2026-11-26. (Older prompt workarounds may now block beneficial new model behaviors; see the `## AGENTS.md review cadence` section in [AGENTS.md](../AGENTS.md). This date is the canonical source referenced by AGENTS.md. Added in v1.2.0 Phase 1.4.)