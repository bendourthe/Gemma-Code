# v1.12.0 Known Gaps -- `adoption-ecosystem-2026-07`

Tracks unfinished work, deferrals, and coordination for the v1.12.0 ecosystem adoption ([plan](plans/adoption-ecosystem-2026-07.md), [comparison](comparison-ecosystem-2026-07.md)). One row per gap.

**Severity:** P0 (blocker) / P1 (high) / P2 (medium) / P3 (low).
**Category:** NI (note/info) / DF (deferred) / BG (bug) / MT (migration) / WN (warning) / QG (quality-gate) / CO (coordination).

---

## 1. Phase 1 -- per-model harness selector (H1) + low-cost-model skill (H2) (landed 2026-07-16)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| EM.P1.A | P2 | DF | **The selector is not yet wired into the live prompt path.** [`HarnessSelector`](../../modules/coding/orchestration/HarnessSelector.ts) + its golden A/B ([`HarnessSelectorAb.ts`](../../modules/coding/orchestration/HarnessSelectorAb.ts)) ship and are unit-tested, but nothing yet spreads `overlayForModel()` into a live `PromptContext`. The overlay is composition-root-ready by construction (its keys/types match `PromptContext` exactly, so `{ ...base, ...overlay }` typechecks). | Wire at the composition root: apply `defaultHarnessSelector.overlayForModel(modelName)` in [`ToolActivationContext.buildPromptContext`](../../src/panels/ToolActivationContext.ts) gated on `settings.harnessSelectorEnabled`. Follow the `SO001.P1.A` deferral pattern (mechanism first, composition-root wiring second). |
| EM.P1.B | P2 | QG | **No live weak-model A/B has been run.** The A/B harness + `decideHarnessDefault` gate exist, but measuring a real weak/quantized model needs Ollama + a real `AgentDriver` (unavailable in CI). So `HARNESS_SELECTOR_SHIPPED_DEFAULT = false` and `nexus.coding.harnessSelector.enabled` defaults off -- the SO003.P3.A / no-degradation discipline. | Run `runHarnessAb` over the golden validation split with the live driver on a weak model (e.g. `llama3.2:3b`); flip the default only on a `decideHarnessDefault` net win, and record the measured result either way. |
| EM.P1.C | P3 | DF | **Deeper scaffold knobs are documented but not modeled.** Tool-exposure verbosity and retry / step granularity per tier are described in [docs/reference/low-cost-model-optimization.md](../../docs/reference/low-cost-model-optimization.md) but the `HarnessProfile` drives only the three knobs `PromptContext` already consumes (promptStyle, thinkingMode, systemPromptBudgetPercent). | Extend `HarnessProfile` + `PromptBuilder`/`PromptContext` once EM.P1.A lands (the profile is the natural home; persona text is still hardcoded to 3 styles in `PromptBuilder`, so a fourth requires a `PromptBuilder` change, not just a profile). |
| EM.P1.D | P3 | CO | **H2 shipped as an in-repo guidance doc, not a portable Hub skill.** [docs/reference/low-cost-model-optimization.md](../../docs/reference/low-cost-model-optimization.md) is the technique guidance `HarnessSelector` references; authoring the portable Nexus-Hub `low-cost-model-optimization` skill (or folding it into `model-routing`) is a Hub-repo change, not a Nexus-AI one. | Demand-gated Hub touchpoint (the SO009 precedent: build the runtime here, keep the reusable method in the Hub). Propose on the next `nexus skills sync` / Hub PR. |

## 2. Phase 2 -- surface the v1.7 skill optimizer (L1) (partial, landed 2026-07-16)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| EM.P2.A | P2 | DF | **The desktop-sidecar optimizer method is not built.** `nexus skills optimize` (CLI) landed on the new composition root [HeadlessOptimizerFactory.ts](../../modules/coding/skilloptimizer/HeadlessOptimizerFactory.ts), but the app cannot yet launch/approve an optimization run: the pre-implementation review confirmed the Node sidecar transport is one-shot JSON-RPC request/response with **no server-push channel**, so surfacing the interactive human-approval-before-overwrite requires a multi-call protocol (start -> pending-approval token -> approve) plus a React approval UI. | Deferred to preserve the guardrail (do not ship a half-built approval path). Build as: `skills.optimize` in `IPC_METHODS` + `METHOD_SCHEMAS` + `handlers` (`desktop/sidecar/src/{protocol,handlers}.ts`), reusing the composition root through `HandlerContext`, with approval modeled as a two-call round-trip and a diff-review UI. |
| EM.P2.B | P2 | DF | **`nexus skills frontier` is not built.** Only `nexus skills optimize` (the bounded-edit loop) landed. The Pareto-frontier CLI needs a `CandidateFrontier` composition root wiring the shipped `HeadlessCandidateProducer/Scorer/Promoter` + the `WorktreeCandidateManager` git materializer + candidate-diagnosis seeding. | Follow-up: add `createHeadlessCandidateFrontier` (sibling of `createHeadlessSkillOptimizer`) + a `runSkillsFrontier` CLI command mirroring `runSkillsOptimize`, with a child_process `GitRunner` for the worktree manager (fail-closed when git is absent). |
| EM.P2.C | P3 | NI | **The CLI opt-in is by explicit invocation, not the vscode `skillOptimizer.enabled` setting.** The review confirmed no headless settings reader ships (`getSettings()` imports vscode); peers gate on env/flags. `nexus skills optimize` treats running the command as the opt-in and requires `--apply` (+ per-edit confirm) before any write. | Acceptable and safer than a headless vscode-settings reader. Revisit only if a headless settings path is added for another reason. |

## 3. Plan-level deferrals (recorded so the next plan picks them up)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| EM.L2 | P2 | DF | **Background autonomous self-optimization (= v1.7 S5)** remains demand-gated / off by default -- the one item where autonomy meets self-modification of skill files. Unchanged by this cycle. | If ever built: explicit opt-in, local-compute budget cap, human approval before any write, proposals queued for review. Not a v1.12.0 phase. |
| EM.C1 | P3 | DF | **Open Interpreter computer-use / desktop-vision QA** (browser + native-app driving) deferred -- large surface + GPU-vision cost, out of the Coding pillar's scope. | Revisit as a possible cross-pillar capability, not a Coding-pillar item. |
| EM.PENDING | P3 | NI | **Phases 2-6 not yet started** (L1 surface the v1.7 optimizer; Q1 extreme-low-bit tier; E1/E3/E2 disk-offload patient tier; H3 sandbox audit; FINAL). Q1/E1 are hard-gated on a runtime-capability audit + an independent benchmark and can cleanly no-op. | Sequenced per the [plan](plans/adoption-ecosystem-2026-07.md) Phases-at-a-Glance. |
