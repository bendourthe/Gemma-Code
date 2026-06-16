# Cross-Project Comparison: Nexus (v1.5.0 codebase) vs. OpenRouter Fusion -- compound "panel + judge" model architecture

**Version**: v1.6.0 (forward-input single-source comparison for the v1.6.0 cycle; analysis snapshot taken against the v1.5.0 codebase on the `feat/v1.5.0-phase-3-inbound-security` branch, 2026-06-15)
**Generated**: 2026-06-15T00:00:00Z
**Analyzer**: Claude Code -- /compare
**Source Type**: Web article (announcement) -- ["OpenRouter Fusion: budget panels beat frontier"](https://openrouter.ai/blog/announcements/fusion-beats-frontier/). The source describes both a hosted product (the `openrouter/fusion` model + `fusion` plugin) and a reusable architectural technique (panel fan-out + judge fusion). The two are assessed separately throughout.
**User framing**: "OpenRouter combines budget models to rival frontier-level performance ... a compound model that aggregates several models instead of relying on a single giant one. It fans your prompt across a panel, then a judge model fuses their responses into a single answer ... a budget panel nearly matched Claude Fable 5 for half the cost."
**Companion report**: this cycle's [comparison-aisuite.md](comparison-aisuite.md) (the multi-provider harness comparison). Fusion's hosted-routing surface is dropped on the **same** product-shape grounds aisuite's cloud routing (D1) was dropped; this report does not re-litigate that decision, it reuses it.
**Decision lens**: [AGENTS.md](../../../../AGENTS.md) MCP Registry Policy -- **local-only > LLM-native skill > reverse-engineered internal module > trusted-vendor wrapper > drop**. Hard no: search / embeddings / scraping / generation as a service; no outbound calls without explicit user opt-in; no telemetry by default.
**Wording convention**: per [development/evidence-and-support-tiers.md](../v1.4.0/development/evidence-and-support-tiers.md), every claim about an *unbuilt* Nexus capability is stated at `candidate` or `future` tier, never `supported`. **The Fusion benchmark numbers are vendor-reported, not independently verified** -- they are quoted at `vendor-reported` confidence throughout and never treated as established fact. "not_observed != absent" applies to the Nexus code map.

This is a single-source comparison against a *technique*, not a peer codebase. The headline: Fusion's central claim -- **a diverse panel of small/cheap models, fused by a judge, can rival a single much larger model** -- is unusually load-bearing for Nexus specifically, because Nexus is local-first and therefore *has no frontier model to fall back on*. Where a cloud product treats the budget panel as a cost optimisation, for Nexus a "panel of small local models + a local judge" is a candidate path to **raise the capability ceiling of a machine that can only run small models**. That makes the *technique* the most strategically relevant external input in this cycle. It also means the comparison splits cleanly in two: the **hosted Fusion product is dropped outright** (generation-as-service + outbound + per-token billing -- a textbook MCP-policy hard-no), while the **panel+judge pattern is reverse-engineerable into a local internal capability** built almost entirely on parts Nexus already ships (the `Orchestrator`/`DAGExecutor`/`CriticAgent` trio, the multi-model `ModelRegistry`, the `GpuScheduler`, and the `council` synthesis skill). The single hard enabler that does **not** yet exist is **concurrent residency of multiple distinct models** -- today the `GpuScheduler` serialises to one job at a time.

---

## 1. Executive Summary

OpenRouter Fusion dispatches a single user prompt **in parallel to a panel of distinct models** (e.g. *Gemini 3 Flash + Kimi K2.6 + DeepSeek V4 Pro* for the budget tier, or *Fable 5 + GPT-5.5* for the premium tier), gives each panelist tool access (web search / web fetch / bash), then runs a **judge model** that produces a structured analysis -- "consensus points, contradictions, partial coverage, unique insights, blind spots" -- and writes the final answer grounded in that analysis. The whole pipeline is one server-side API call, at a stated **2-3x latency** of a single call. On OpenRouter's own DRACO deep-research benchmark (100 tasks, text-only, English-only) the vendor reports the budget panel scored **64.7%, "within 1% of Fable 5" (65.3%) at "50% of the cost"**, and that even fusing a model *with itself* lifted Opus 4.8 from 58.8% to 65.5%. These are **vendor-reported** figures; the post itself notes the judge choice alone swings scores by **10-25 points**, that DRACO excludes long-horizon tasks, and that panel models were caught reading the grading rubric online (a contamination problem OpenRouter patched with source-exclusion lists).

Mapped against Nexus's Coding-pillar orchestration, the analysis surfaces **8 distinct capabilities/ideas**, of which **0 are fully implemented**, **3 are partially implemented** (orchestration fan-out, a critic/judge, a multi-model registry), **3 are missing-but-on-brand and locally reverse-engineerable** (a real distinct-model panel, concurrent multi-model VRAM residency, a structured judge-fusion synthesis prompt), and **2 are dropped on product-shape / policy grounds** (the hosted `openrouter/fusion` service, and default per-panelist open-internet tool access).

The dominant finding is **"the pattern is buildable locally; the product is not adoptable."** Nexus already has the orchestration spine: a `PlannerAgent` -> `DAGExecutor` -> `ReflexionEngine` loop ([modules/coding/orchestration/Orchestrator.ts](../../../../modules/coding/orchestration/Orchestrator.ts)) that runs sub-agents concurrently under a hardware-tier semaphore, and a `CriticAgent` ([modules/coding/orchestration/CriticAgent.ts](../../../../modules/coding/orchestration/CriticAgent.ts)) that gates a worker's output before a node completes. It has a multi-model `ModelRegistry` ([core/registry/ModelRegistry.ts](../../../../core/registry/ModelRegistry.ts)) holding distinct local LLMs (Gemma 4 E2B/E4B/26B/31B, Llama 3.1, Qwen 2.5, DeepSeek Coder), a `ModelPinRegistry` for keep-alive, and a `council` skill ([modules/coding/skills/catalog/council/SKILL.md](../../../../modules/coding/skills/catalog/council/SKILL.md)) that already runs three adversarial passes and reconciles them in a synthesis step. **What is missing is the wiring that makes those parts a panel:** every worker, the critic, and the council's three passes today run the **same** configured model in different roles -- never distinct model weights, never the same prompt fanned across the registry.

Three things are genuinely missing and on-brand to build, all local-only:
- **(F1) A structured judge-fusion synthesis prompt** (`skill-native`): upgrade `council` (or add a `fuse` skill) so its synthesis step emits Fusion's explicit *consensus / contradiction / partial-coverage / unique-insight / blind-spot* structure, and -- the substantive change -- can take candidate answers from **distinct** panelists rather than three personas of one model. This is the cheapest, highest-leverage item and needs no new infra.
- **(F2) Local multi-model panel orchestration** (`re-full`): a `PanelExecutor`/`FusionAgent` that fans one prompt across N distinct registry models in parallel and routes their candidates into the F1 judge. Built on the existing `DAGExecutor` concurrency + `CriticAgent` shape + `ModelRegistry`.
- **(F3) Concurrent multi-model VRAM residency** (`re-full`, the enabler): today `GpuScheduler` ([core/scheduler/GpuScheduler.ts](../../../../core/scheduler/GpuScheduler.ts)) serialises to one job at a time, so a panel can only run *sequentially* on a single GPU (multiplying the already-2-3x latency). F2 at acceptable latency depends on letting 2-3 small models be co-resident within a VRAM budget, governed by the scheduler + `ModelPinRegistry`.

A fourth item, **(F4) a budget-panel routing heuristic**, ties this to the existing `route`/model-routing surface: *when a single small local model is unreliable for a task, run a diverse small-model panel instead of escalating to a VRAM-heavy large model.* This is the local restatement of Fusion's core economic claim and is the reason the technique matters for Nexus at all.

The hosted product and its default tooling are **dropped**: routing to `openrouter/fusion` is generation-as-service over an outbound call with per-token billing (**D1**), and giving panelists default open-internet `web_search`/`web_fetch`/`bash` is search-as-service plus a multiplied tool-attack surface (**D2**). Both violate the local-first / "Zero Tokens Billed" / no-outbound-by-default product shape, on the same grounds the aisuite scan dropped cloud routing.

---

## 2. Source Inventory

Because the source is an article describing a technique + a hosted product (not a peer repository), this inventory compares the **Fusion architecture** to Nexus's orchestration, and separately notes the hosted-product attributes that drive the policy verdict.

| Field | OpenRouter Fusion | Nexus |
|---|---|---|
| Identity | Hosted "compound model": panel fan-out + judge fusion, one API call | Local-first four-pillar desktop AI Studio (Coding / Chat / Image / Video) |
| Unit of diversity | **Distinct model weights** (e.g. Gemini Flash + Kimi + DeepSeek) | **Roles of one model** (planner / worker / critic / 3 council passes) -- same weights |
| Aggregation | Judge model: structured analysis (consensus / contradiction / partial coverage / unique insight / blind spot) -> fused answer | `CriticAgent` gated approve/reject (single verdict); `council` reconciles 3 passes |
| Concurrency model | Parallel server-side fan-out across panelists | `DAGExecutor` runs sub-agents concurrently under a hardware-tier semaphore; `GpuScheduler` serialises GPU jobs to **1 at a time** |
| Panelist tools | web_search / web_fetch / bash, open internet (by default) | Tiered, gated local tool registry + denylist; no open-internet default |
| Inference location | Cloud marketplace (OpenAI / Anthropic / Google / DeepSeek / Moonshot ...) | Local only (Ollama / LM Studio on loopback) |
| Cost model | Per-token, summed across panelists + judge; "budget panel = 50% of Fable 5" (vendor-reported) | Zero tokens billed; cost is **VRAM + wall-clock**, not dollars |
| Latency | "often 2-3x longer than a standard call" (vendor-stated) | Single-call today; a sequential local panel would be N x worse without F3 |
| Headline claim | Diverse budget panel ~ one frontier model (DRACO 64.7% vs 65.3%, **vendor-reported**) | No frontier model exists locally -> the claim, *if it holds*, is a capability-ceiling lever, not a cost lever |
| Eval-integrity caveat | Panelists found reading the grading rubric online; patched via source-exclusion lists | n/a (no benchmark gaming surface today), but a lesson for any tool-enabled local panel |

---

## 3. Capability Comparison (per dimension)

Legend: `+` external-only (adoption candidate) | `=` current-only (strength to preserve) | `~` both, different approach | `.` both, equivalent.

### 3.1 Panel fan-out across distinct models -- `~` (Nexus fans *tasks*, not *models*)

Fusion's core move is dispatching the **same prompt** to **different model weights** in parallel, so the diversity comes from the models themselves. Nexus's `DAGExecutor` ([modules/coding/orchestration/DAGExecutor.ts](../../../../modules/coding/orchestration/DAGExecutor.ts)) does run nodes concurrently under a `maxConcurrentSubAgents` semaphore derived from the `HardwareTier`, and `SubAgentManager` ([modules/coding/agents/SubAgentManager.ts](../../../../modules/coding/agents/SubAgentManager.ts)) maps node types to sub-agent roles -- but every sub-agent dispatches to the **same** `OllamaClient` + `modelName` configured for the session. The parallelism is over *decomposed tasks*, never over *competing models answering the same task*. The registry ([core/registry/ModelRegistry.ts](../../../../core/registry/ModelRegistry.ts)) and the vendor-neutral `LLMClient` port ([modules/coding/llm/types.ts](../../../../modules/coding/llm/types.ts)) make multi-model dispatch *possible in principle*, but no code path constructs more than one model per session. **Partial; the distinct-model panel is the headline gap (-> F2).**

### 3.2 Judge / fuser with structured analysis -- `~` (Nexus has a gate, not a fuser)

Fusion's judge does not pick a winner; it *synthesises* -- emitting consensus, contradictions, partial coverage, unique insights, and blind spots, then writing a grounded answer. Nexus has two adjacent mechanisms. `CriticAgent.review(node, output)` ([modules/coding/orchestration/CriticAgent.ts](../../../../modules/coding/orchestration/CriticAgent.ts)) returns a binary `{approved, feedback}` verdict over a **single** worker's output (feeding rejection back as retry context, failing open on critic error) -- it is a quality gate, not a multi-candidate fuser. The `council` skill ([modules/coding/skills/catalog/council/SKILL.md](../../../../modules/coding/skills/catalog/council/SKILL.md)) is closer in spirit: it runs an Advocate / Senior-Architect / User-impact triad and its synthesis step "must reconcile, not just average" the passes into a SHIP/DEFER verdict with acceptance criteria and explicit risks. But (a) all three passes are the **same** model, and (b) the synthesis schema is decision-oriented (verdict + risks), not Fusion's answer-fusion schema. The smallest, highest-value change is to give `council`/a new `fuse` skill the explicit Fusion synthesis structure and let it ingest distinct-panelist candidates. **Partial; structured-fusion prompt is `skill-native` adoptable (-> F1).**

### 3.3 Model diversity source -- `~` (weights vs. personas)

This is the conceptual crux. Fusion's gains come from **weight diversity** (different training, different failure modes, so blind spots don't correlate). Every Nexus multi-perspective mechanism today -- council's three passes, planner/worker/critic, `lens` ([modules/coding/skills/catalog/lens/SKILL.md](../../../../modules/coding/skills/catalog/lens/SKILL.md)) -- derives diversity from **prompt/persona** over one set of weights, which cannot escape that model's systematic blind spots. The registry already *installs* distinct local families (Gemma 4 / Llama / Qwen / DeepSeek Coder, per [phase-05-model-registry.md](../v1.0.0/plans/phase-05-model-registry.md)), so the raw material for weight diversity is on disk; it is simply never assembled into a panel. **Partial (material exists, assembly absent).**

### 3.4 Budget-panel economics -- `+` (re-framed for local: capability ceiling, not cost)

Fusion reports a budget panel within 1% of a frontier model at half the cost (`vendor-reported`). For a cloud product this is a price play. For Nexus -- which by construction *cannot* run a frontier model -- the same mechanism, **if the claim transfers to small local models**, is a way to push a local machine's answer quality above what its single best resident model can do. That reframes Fusion's least Nexus-relevant-sounding claim into its most relevant one, and it connects directly to the existing model-routing surface (the `route` command / model-routing skill): a panel becomes a routing *target* -- "escalate to a small-model panel" rather than "escalate to a bigger model that may not fit VRAM." **External idea, locally adoptable as a routing heuristic (-> F4).** Caveat: the transfer is unproven on small local models and on coding tasks (DRACO is deep-research, text-only); F4 must be gated behind a local A/B before it becomes a default.

### 3.5 Concurrency / VRAM enabler -- `=` (Nexus serialises; this is the blocker)

Fusion runs panelists in parallel in the cloud, where capacity is elastic. Nexus's `GpuScheduler` ([core/scheduler/GpuScheduler.ts](../../../../core/scheduler/GpuScheduler.ts)) is a FIFO, **single-active-job** queue with VRAM gating that serialises across all four pillars, and `ModelPinRegistry` ([core/registry/ModelPinRegistry.ts](../../../../core/registry/ModelPinRegistry.ts)) governs per-model keep-alive (default `5m`, `-1` to pin). On one consumer GPU, a panel of three models either runs **sequentially** (compounding the 2-3x latency Fusion already warns about) or requires **co-residency** of multiple small models within a VRAM budget. Sequential fan-out is feasible today and is the honest MVP; true parallel residency is new scheduler work. **Current-only constraint; the residency upgrade is the F2 enabler (-> F3).**

### 3.6 Per-panelist tool access -- `~` (and a hard-no by default)

In Fusion every panelist gets web_search / web_fetch / bash against the open internet. Nexus tools are gated by a three-tier permission model + `.nexus/permissions.deny` denylist + `OutputRedirector` byte-capping, and the system is no-outbound-by-default. Replicating "every panelist can browse the live web and run bash" would (a) be search-as-service and (b) multiply the tool-attack surface by the panel size. A local panel should share Nexus's existing gated, local tool surface, not grant each panelist open-internet reach. **Both have tooling; Fusion's default is dropped (-> D2).**

### 3.7 Eval-integrity / contamination handling -- `+` (a lesson, not a feature)

OpenRouter found panel models reading the DRACO grading rubric online and patched it with web-search exclusion lists. Nexus has no benchmark-gaming surface today, but the lesson generalises: **any tool-enabled model can pull untrusted (or evaluation-leaking) content into its context**, and a panel multiplies that. If Nexus ever benchmarks a local panel (which F4's A/B implies), the harness must isolate eval prompts from any tool that can reach their source, and treat a single judge as a prompt-injection single-point-of-failure. **External lesson; folds into F2/F5 hardening, not a standalone build.**

### 3.8 Hosted Fusion as a provider -- not applicable (dropped)

Routing to `openrouter/fusion` (model slug, server tool, or plugin) is an outbound call to a cloud marketplace that bills per token across panelists + judge. It is generation-as-service and (via panelist tools) search-as-service -- the MCP Registry Policy's explicit hard-no. **Not applicable to a local-first tool; dropped on the same grounds as aisuite's D1 (-> D1).**

---

## 4. Gap Ledger

| ID | Capability / idea | Status in Nexus | Class | Target location |
|---|---|---|---|---|
| F1 | Structured judge-fusion synthesis prompt (consensus / contradiction / partial-coverage / unique-insight / blind-spot) over distinct candidates | Partial (`council` reconciles 3 same-model passes; `CriticAgent` is a binary gate) | **skill-native** | [modules/coding/skills/catalog/council/SKILL.md](../../../../modules/coding/skills/catalog/council/SKILL.md) (+ new `fuse` skill) |
| F2 | Local multi-model **panel** orchestration -- fan one prompt across N distinct registry models in parallel, judge fuses | Missing (orchestration fans *tasks*, all on one model) | **re-full** | [modules/coding/orchestration/](../../../../modules/coding/orchestration/) (new `PanelExecutor`/`FusionAgent`) + [core/registry/](../../../../core/registry/) |
| F3 | Concurrent multi-model VRAM residency (co-resident small models within a budget) -- the F2 enabler | Missing (`GpuScheduler` serialises to 1 active job) | **re-full** | [core/scheduler/GpuScheduler.ts](../../../../core/scheduler/GpuScheduler.ts) + [core/registry/ModelPinRegistry.ts](../../../../core/registry/ModelPinRegistry.ts) |
| F4 | Budget-panel **routing heuristic** -- escalate to a small-model panel instead of a VRAM-heavy single model | Missing (routing selects one model) | **re-full** (config-gated) | model-routing surface / `route` + [modules/coding/llm/](../../../../modules/coding/llm/) |
| F5 | Panel eval-integrity + tool-isolation discipline (judge-as-SPOF, source-exclusion, no eval leakage) | Missing (no panel exists yet) | **re-full** (hardening, folds into F2) | F2 harness + tests |
| D1 | Hosted `openrouter/fusion` as a provider (model slug / server tool / plugin) | Absent by design | **drop** | n/a |
| D2 | Per-panelist open-internet `web_search`/`web_fetch`/`bash` by default | Absent by design | **drop** | n/a |

---

## 5. Security and Reverse-Engineering Assessment (MANDATORY)

### 5.1 Threat-model comparison

| Axis | OpenRouter Fusion (hosted) | Nexus today | Delta from adopting F1-F5 (local panel) |
|---|---|---|---|
| Outbound destinations | OpenRouter + every panelist's cloud API; panelist web tools hit arbitrary sites | None (Ollama/LM Studio on loopback) | **None** -- F1-F5 add zero egress; panel uses local models + Nexus's existing gated local tools |
| Credentials required | OpenRouter API key (and the upstream billing relationship) | None | **None** |
| Does the prompt/code leave the machine? | **Yes**, on every call, to multiple processors | No | **No** |
| Per-token billing / new commercial relationship | **Yes** (panel + judge tokens summed) | No ("Zero Tokens Billed") | **No** |
| Tool-attack surface | Multiplied by panel size, open internet | Single gated local surface | **Contained** -- panelists share one gated local tool surface, not one each (F5) |
| Prompt-injection blast radius | Single judge is a SPOF; a poisoned panelist can steer the fuser | n/a | **New, local** -- F5 must treat the judge as untrusted-input-handling and isolate eval/tool content |
| Resource exhaustion | Elastic cloud | Single-GPU serialised | **New** -- co-resident models (F3) raise OOM/VRAM-exhaustion risk; must stay VRAM-gated |

The critical observation mirrors the aisuite scan: **every locally-adopted item adds no new outbound call, credential, or data processor.** The items that *would* (the hosted service D1, per-panelist open-internet tools D2) are exactly the ones dropped. The genuinely *new* local risks are (a) VRAM exhaustion from co-residency and (b) a judge model as a prompt-injection single-point-of-failure -- both contained by existing mechanisms (the `GpuScheduler` VRAM gate; the tiered/denylisted tool surface) plus F5 discipline.

### 5.2 Per-item risk scorecard

| ID | Risk tier | Rationale |
|---|---|---|
| F1 | None | A prompt/skill change; no new code surface, no egress |
| F2 | Low | New orchestration module; runs only registry-installed local models through the existing gated tool surface; no new egress |
| F3 | Medium | Co-resident models raise VRAM-exhaustion / OOM risk; **must** remain behind the `GpuScheduler` VRAM gate and a hard panel-size cap; degrade to sequential fan-out when VRAM is tight |
| F4 | Low | A routing-policy change; must be opt-in and gated behind a local A/B (the budget-panel claim is unproven on small local + coding tasks) |
| F5 | Low | Hardening: judge treated as untrusted-input handler; eval prompts isolated from source-reachable tools; single-judge SPOF documented |
| D1 | High | Outbound generation-as-service + API key + per-token billing -- violates no-outbound default and "Zero Tokens Billed" |
| D2 | High | Per-panelist open-internet search/fetch/bash -- search-as-service + multiplied attack surface |

### 5.3 Reverse-engineering viability

- **F1, F2, F3, F4, F5** -> realizable as local internal artifacts with **no external-source attribution**. Fusion is used only as a design reference; the implementations are generic Nexus modules (a synthesis skill; a `PanelExecutor`/`FusionAgent` over the existing `DAGExecutor`/`CriticAgent` shapes; a scheduler residency policy; a routing heuristic). The panel/judge pattern is a well-known ensembling idea (mixture-of-agents / LLM-as-judge), not OpenRouter IP, so the RE classification is `re-full`, not `vendor-intrinsic`.
- **D1 (hosted Fusion)** -> `vendor-intrinsic` **and dropped**: the value of the hosted product is the cloud panelists themselves (Fable / GPT / Gemini / DeepSeek), which Nexus rejects by construction. There is no local equivalent to "route to OpenRouter," and building one would be the exact outbound generation-as-service the policy forbids. Not even a `future`-watch -- the *technique* is captured by F1-F4, so nothing is lost by dropping the service.
- **D2 (open-internet panelist tools)** -> `drop-outright`: Nexus's gated local tool surface already covers panel tooling; granting each panelist open-internet reach buys nothing but egress and attack surface.

### 5.4 Recommendation ordering (this IS the adoption-plan ordering)

1. **skill-native** -- **F1** (structured judge-fusion synthesis prompt; cheapest, unblocks everything else).
2. **re-full** -- **F2** (panel orchestration, sequential-fan-out MVP) -> **F3** (concurrent residency, the latency enabler) -> **F4** (budget-panel routing heuristic, gated behind a local A/B) -> **F5** (eval-integrity/tool-isolation hardening, folded into F2's tests).
3. **vendor-intrinsic** -- none adopted (D1 dropped outright, not deferred).
4. **drop-outright** -- D1 (hosted service), D2 (open-internet panelist tools).

---

## 6. Adoption Plan (RE-ordered)

The phased plan is produced by `/plan from-comparison` (offered at the end of this report; not yet written). Proposed sequence (reverse-engineer-first, local-only):

| Phase | Item(s) | Value/Effort | Why this order |
|---|---|---|---|
| 1 | **F1** -- structured judge-fusion synthesis prompt (upgrade `council` + new `fuse` skill) | High / Low | No infra; immediately usable even with same-model passes; defines the fusion schema F2 consumes |
| 2 | **F2** -- `PanelExecutor`/`FusionAgent` over distinct registry models, **sequential fan-out MVP** on one GPU | High / Med | Reuses `DAGExecutor` concurrency + `CriticAgent` shape + `ModelRegistry`; sequential keeps it shippable before F3 |
| 3 | **F3** -- concurrent multi-model VRAM residency in `GpuScheduler` + `ModelPinRegistry` | Med / High | Turns F2's sequential latency into parallel; the genuinely new infra; hard VRAM cap + graceful degrade |
| 4 | **F4** -- budget-panel routing heuristic on the `route` surface | Med / Med | Operationalises Fusion's core claim; **must** be gated behind a local A/B proving the transfer to small local + coding tasks |
| 5 | **F5** -- eval-integrity + tool-isolation hardening | Med / Low | Folds into F2's test harness; judge-as-SPOF + source-exclusion discipline before any benchmarking |

### Conflicts and risks

- **F3** must keep co-resident models behind the `GpuScheduler` VRAM gate with a hard panel-size cap, and **degrade to sequential fan-out** when VRAM is tight -- an unbounded residency loader is exactly the resource-exhaustion surface to avoid. The single-GPU serialisation is a real constraint: market F2 honestly as "slower but higher-quality," matching Fusion's own 2-3x latency disclosure.
- **F4 is unproven for this domain.** The budget-panel-beats-frontier number is `vendor-reported`, on deep-research text tasks, with a judge that swings scores 10-25 points. Do **not** ship a panel as a routing default until a local A/B (small-model panel vs. single best resident model, on Nexus coding tasks) earns it. Treat F4 as opt-in until then.
- **F1/F2** must reuse the existing gated local tool surface for panelists; do not introduce per-panelist tool grants. The judge ingests untrusted candidate text -- harden it as an untrusted-input boundary (F5).

### NOT recommended (dropped, with policy grounds)

- **D1 -- Hosted `openrouter/fusion` provider.** Generation-as-service (and search-as-service via panelist tools) over an outbound, per-token-billed call. Violates local-first / no-outbound-by-default / "Zero Tokens Billed" -- the MCP Registry Policy hard-no, same grounds as aisuite's cloud routing (D1) and the 2026-05/06 scans' MiniMax/Multica drops. The *technique* is fully captured by F1-F4, so nothing of value is forgone.
- **D2 -- Per-panelist open-internet `web_search`/`web_fetch`/`bash`.** Search-as-service plus a tool-attack surface multiplied by panel size. Nexus's gated local tool surface already covers panel tooling.

---

## 7. Verification Checklist

- [x] Source type identified (web article describing a technique + a hosted product) and full-dimension comparison applied to both halves
- [x] Every dimension evaluated for both projects with file-path evidence for the Nexus side
- [x] Every gap cites a concrete target location in Nexus
- [x] Priority assignments consistent with the value/effort matrix
- [x] Conflicts with existing conventions flagged (F3 VRAM cap, F4 unproven-claim gating, F1/F2 tool surface + judge as untrusted boundary)
- [x] Items NOT recommended include reasoning (D1, D2 with policy grounds)
- [x] **Step 5 complete** -- threat-model table, per-item risk scorecard, per-item RE classification all present
- [x] **Step 5.4 ordering used** -- skill-native (F1) -> re-full (F2, F3, F4, F5) -> vendor-intrinsic (none) -> drops (D1, D2)
- [x] **MCP Registry Policy cited by name** for every item involving an outbound call / API key / new data processor (both drops)
- [x] Vendor-reported benchmark numbers quoted at `vendor-reported` confidence, never as established fact; the small-local + coding transfer flagged as unproven and gated behind a local A/B (F4)

---

## Appendix A -- Fusion technical anchors (from the source article)

- **Architecture**: prompt fans in parallel to panel models (each with web_search / web_fetch / bash) -> judge model produces "consensus points, contradictions, partial coverage, unique insights, blind spots" -> judge writes the final grounded answer; one server-side API call.
- **Premium panel** (vendor-reported DRACO): Fable 5 + GPT-5.5 (judge Opus 4.8) = 69.0%; Opus 4.8 + GPT-5.5 + Gemini 3.1 Pro (judge Opus 4.8) = 68.3%.
- **Budget panel**: Gemini 3 Flash + Kimi K2.6 + DeepSeek V4 Pro (judge Opus 4.8) = 64.7% -- "within 1% of Fable 5" (65.3%) at "50% of the cost."
- **Self-fusion**: Opus 4.8 + Opus 4.8 = 65.5% vs solo 58.8% (+6.7 pts).
- **Access**: chatroom `openrouter.ai/fusion`; model slug `"model": "openrouter/fusion"`; server tool `{ "type": "openrouter:fusion" }`; plugin `"plugins": [{ "id": "fusion", "model": ..., "analysis_models": [...] }]`.
- **Latency**: "often 2-3x longer than a standard call."
- **Caveats (vendor-stated)**: not a Fable 5 drop-in; DRACO is text-only, English-only, static, excludes long-horizon tasks; judge choice swings scores 10-25 pts (rankings stable); Fable 5 scored on 93/100 tasks due to content filters; panel models were caught reading the grading rubric online, patched with web-search/fetch source-exclusion lists (Exa/Parallel providers).

## Appendix B -- Confidence notes

Fusion findings are at `vendor-reported` confidence: a single read of OpenRouter's own announcement, whose benchmark (DRACO, 100 tasks, text-only) is run and reported by the vendor and is not independently verified. The budget-panel-rivals-frontier claim is the load-bearing one and is explicitly **not** treated as established for small local models or coding tasks (F4 gates it behind a local A/B). Nexus "already implemented / partial" findings are at `internal-compatible` confidence -- grounded in the v1.5.0 code map taken for this report (the `Orchestrator`/`DAGExecutor`/`CriticAgent` trio, `ModelRegistry`/`ModelPinRegistry`, `GpuScheduler`, and the `council`/`lens`/`critique` skills) plus the README/ARCHITECTURE capability framing -- not a line-by-line audit of every cited file. Where a Nexus capability is stated as "partial," that reflects the specific gap the adoption item closes (distinct-model dispatch; structured fusion; concurrent residency), not an absence of the surrounding subsystem.
