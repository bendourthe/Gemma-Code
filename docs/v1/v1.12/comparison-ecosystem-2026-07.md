# Cross-Project Comparison: Nexus (v1.11.0 codebase) vs. four external sources -- local model-execution scaling (Colibri / Open Interpreter-Codex / Bonsai 27B) + a re-submission of the self-optimizing-skills article

**Version**: v1.12.0 (multi-source ecosystem scan; forward-input for the v1.12.0 adoption cycle; analysis snapshot taken against the v1.11.0 codebase, mid-flight on the installer overhaul)
**Adoption plan**: [plans/adoption-ecosystem-2026-07.md](plans/adoption-ecosystem-2026-07.md)
**Generated**: 2026-07-16T00:00:00Z
**Analyzer**: Claude Code -- /compare
**Source Type**: MIXED -- three Git repositories (Colibri, Open Interpreter, Bonsai-demo) + one article (PDF, "How your agents can write and optimize their own skills")
**Companion / prior reports**: [comparison-self-optimizing-skills.md](../v1.7/comparison-self-optimizing-skills.md) (v1.7.0 -- the same PDF, already adopted), [comparison-opencode.md](../v1.7/comparison-opencode.md) (v1.7.0 -- adjacent coding-agent scan), [comparison-ecosystem-2026-06.md](../v1.5/comparison-ecosystem-2026-06.md) ("Local Agent Maturity"; Gemma 4 GGUF quant-ladder catalog), [comparison-aisuite.md](../v1.6/comparison-aisuite.md) (future local-runtime adapter registry for llama.cpp/vLLM/MLX)
**Decision lens**: [AGENTS.md](../../../AGENTS.md) MCP Registry Policy -- **local-only > LLM-native skill > reverse-engineered internal module > trusted-vendor wrapper > drop**. Hard no: search / embeddings / scraping / generation as a service; no outbound calls without explicit user opt-in; no telemetry by default.
**Wording convention**: per [development/evidence-and-support-tiers.md](../v1.4/development/evidence-and-support-tiers.md), every claim about an *unbuilt* Nexus capability is stated at `candidate` or `future` tier, never `supported`; "not_observed != absent" applies. "Already implemented" classifications are grounded in the v1.7.0 [comparison-self-optimizing-skills.md](../v1.7/comparison-self-optimizing-skills.md) + its [adoption plan](../v1.7/plans/adoption-self-optimizing-skills.md), the [README.md](../../../README.md)/[ARCHITECTURE.md](../../../ARCHITECTURE.md) capability tables, and a per-subsystem code map taken for this report at `internal-compatible` confidence.

> **Pre-ingest source-security scan (mandatory Step 1.5) -- summary.** All three repositories and the PDF were scanned BEFORE their claims were ingested into the analysis. Verdicts: **Colibri -> PROCEED-WITH-CAUTION**, **Open Interpreter -> CLEAR (idea-level ingest)**, **Bonsai 27B -> PROCEED-WITH-CAUTION**, **PDF -> CLEAR**. No source was BLOCKED; no source content was treated as instructions to the analyzer. Full per-source scan in Section 3. Two of the three repos ship supply-chain trust points (Colibri's ~370 GB third-party int4 weights; Bonsai's `curl | sh` installer + custom MLX source-build) that must be treated as hostile until independently verified -- this is why neither is CLEAR.

---

## 1. Executive Summary

This is a **four-source, mixed-type** comparison. The four split cleanly into two buckets, and the honest headline is that only one bucket contains net-new work:

- **Bucket A -- already-shipped / already-covered (validation, not opportunity).** The PDF ("How your agents can write and optimize their own skills": SkillOpt / GEPA / EvoSkill / loop engineering) is a **re-submission of the exact source already analyzed and fully adopted at v1.7.0**. Its five adoption items S1-S4 + S6 all LANDED in the v1.7.0 cycle ([SkillOptimizer](../../../modules/coding/skilloptimizer/SkillOptimizer.ts), [CandidateFrontier](../../../modules/coding/skilloptimizer/CandidateFrontier.ts), [GoldenTaskRunner](../../../modules/coding/evaluation/GoldenTaskRunner.ts), [validationGate](../../../modules/coding/evaluation/validationGate.ts), [RejectedEditBuffer](../../../core/memory/RejectedEditBuffer.ts)); only **S5** (background self-optimization) was deliberately deferred as demand-gated and never built. Separately, **Open Interpreter's core loop** (an LLM that drives local code execution) is **already covered** by Nexus's mature Agentic AI Coding pillar. So roughly half the submitted material is a strength to preserve, not a gap.
- **Bucket B -- genuine green field: local model-execution scaling.** The three repos, stripped of their marketing, all attack **the same constraint from three directions**: how do you get *larger-capability* models to run under Nexus's hard **single-GPU ceiling**? Colibri answers "**stream the weights from disk**" (disk-tier MoE expert offloading); Bonsai answers "**shrink the weights**" (extreme low-bit / BitNet-class quantization); Open Interpreter (now a Codex fork) answers "**squeeze more agentic performance out of the small model you can already run**" (a per-model harness abstraction). A targeted audit confirms this axis is **entirely un-touched by any prior comparison** (no report covers MoE streaming, weight offloading, AirLLM, BitNet, or the current Open Interpreter). This is the only part of the submission that generates new adoption candidates.

Three source facts materially corrected my priors during the mandatory verification step, and each reshapes the analysis:

1. **GLM-5.2 (744B MoE, ~40B active) is real** -- a Zhipu AI / Z.ai open-weights model released ~June 2026, after the analyzer's knowledge cutoff. Colibri (~14k stars, Apache-2.0) is a real single-file C engine that runs it on a 25 GB / no-GPU box by streaming experts off SSD. The technique is sound and well-precedented (Apple "LLM in a Flash", DeepSpeed ZeRO-Inference, AirLLM, `llama-cpp-moe-flash`, `llama.moe`). The catch is speed: **0.05-0.1 tok/s cold, ~1-2 tok/s warm on fast NVMe** -- fundamentally non-interactive.
2. **Open Interpreter's "Codex Open Source" label is now correct.** As of today (2026-07-16, release 0.0.26) the repo is an **Apache-2.0 Rust fork of OpenAI's Codex**, "a coding agent optimized for low-cost models". The legacy Python AGPL REPL (with `--os` desktop-vision mode) is superseded. The permissive license removes the AGPL adoption blocker I expected.
3. **Bonsai 27B exists but its headline claims are overstated.** The repo/org and Hugging Face artifacts resolve (Apache-2.0), but the "~90% performance at 1-bit by post-hoc squeezing" claim contradicts real extreme-quantization research (BitNet b1.58 is trained *from scratch*; post-hoc 1-bit PTQ degrades substantially; AQLM is near-lossless only at 2-3 bits). "27B on a phone" is undercut by the project's own KV-cache numbers. The vendor itself is a **drop/watch**; only the underlying *idea* (a BitNet-class ultra-low-bit tier, sourced from independently-benchmarked weights) is on-brand.

Mapped against Nexus, the analysis surfaces **11 distinct capabilities/sub-capabilities**: **2 already implemented** (the entire skill self-optimization loop S1-S4/S6; the core agentic-coding loop), **1 partially implemented** (quantization-to-fit, via 4-bit GGUF), **6 missing-but-relevant and local-only** (a per-model harness selector, a disk-tier MoE offload inference tier, warm-KV persistence, large-open-MoE catalog entries, an extreme-low-bit model tier, and the still-unbuilt S5 background optimizer plus the "surface the shipped optimizer" follow-ups), **1 deferred out-of-cycle** (computer-use / desktop-vision QA), and **5 dropped on policy grounds** (importing any of the three repos as a dependency; the Bonsai model + its installer; the Bonsai mobile runtime / phone tier; and -- restated from v1.7.0 -- DSPy/EvoSkill/SkillOpt frameworks + any cloud optimizer).

The single **highest-value net-new item is H1: a per-model agent-harness selector** -- a lean internal layer that picks the best prompt/tool scaffold for each installed local model. It is the most direct answer to Nexus's core tension (small quantized local models under a single-GPU ceiling must be driven well to be useful), it is local-only and zero-outbound, and it pairs with the existing Nexus-Hub `model-routing` skill. The second-highest-leverage item costs almost no new code: **L1 -- surface the skill optimizer that already shipped in v1.7.0** but was never wired to the desktop sidecar or exposed as a `nexus skills optimize` / `nexus skills frontier` CLI (recorded as unresolved forward-tier follow-ups in the [v1.7.0 known-gaps](../v1.7/known-gaps.md)). The PDF re-submission is the natural prompt to finish that last mile.

Everything adoptable here is local-only by construction and on-brand with "Zero Tokens Billed / no data leaving your machine". Importing any of the three repositories is dropped: Colibri's bespoke C engine, Bonsai's custom-MLX-fork installer, and Open Interpreter's Codex-forked Rust framework are all heavy dependencies for logic (or ideas) Nexus reverse-engineers leanly onto its existing spine.

---

## 2. Source Inventory

| Field | Colibri | Open Interpreter (current repo) | Bonsai 27B | Self-optimizing-skills PDF |
|---|---|---|---|---|
| URL / identity | [github.com/JustVugg/colibri](https://github.com/JustVugg/colibri) | [github.com/openinterpreter/openinterpreter](https://github.com/openinterpreter/openinterpreter) | [github.com/PrismML-Eng/Bonsai-demo](https://github.com/PrismML-Eng/Bonsai-demo) | Article (PDF), industry survey |
| What it actually is | Single-file (~2,400 LoC) pure-C inference engine; disk-streamed MoE expert offload for GLM-5.2 (744B/40B-active); OpenAI-compatible HTTP + CLI + React dashboard | **Apache-2.0 Rust fork of OpenAI's Codex** -- "a coding agent for low-cost models"; native OS sandbox + approvals; swappable `/harness` scaffolds | Demo wrapper around ternary/1-bit GGUF + MLX artifacts of a claimed 27B; custom MLX fork; mobile runtimes | A closed loop that optimizes skill `.md` files as trainable external state (SkillOpt / GEPA / EvoSkill) |
| Core idea vs Nexus | Run frontier-class huge-MoE models on modest / no-GPU hosts by paging experts off SSD | Maximize agentic performance of *weak / cheap* models via a per-model harness abstraction | Fit larger-capability models into far less RAM/VRAM via extreme low-bit quantization | Measure skills against a task suite and rewrite them under regression-safe gates |
| Stars / maturity | ~14k stars; trending; third-party int4 weights on HF | ~65.8k stars; release 0.0.26 dated 2026-07-16; 57 releases | ~1.4k stars; HF `prism-ml` org with GGUF/MLX collection | n/a (article) |
| License | Apache-2.0 (weights permissive) | **Apache-2.0** (legacy Python was AGPL-3.0) | Apache-2.0 | n/a |
| Outbound / processor | None intrinsic (local inference); weights pulled from HF | None intrinsic (local agent); model provider is user's choice | None intrinsic; installer does `curl \| sh` + git clone of a custom MLX fork | None intrinsic (local optimizer, local verifier, local `.md`) |
| Pre-ingest verdict | **PROCEED-WITH-CAUTION** | **CLEAR** (idea-level) | **PROCEED-WITH-CAUTION** | **CLEAR** |
| Net-new for Nexus? | **Yes** (disk-tier offload; green field) | **Partial** (core loop covered; harness idea net-new) | **Partial** (quantization covered; extreme-low-bit tier net-new) | **No** (already adopted at v1.7.0; S5 still deferred) |

---

## 3. Pre-ingest Source-Security Scan (MANDATORY Step 1.5)

This gate runs *before* any source claim is used, and is distinct from the post-ingest Reverse-Engineering assessment in Section 6. All fetched web/repo content was treated as untrusted data; no embedded instruction was acted upon.

| Source | Verdict | License | Injection / agent-directed text | Supply-chain / code risk | Justification |
|---|---|---|---|---|---|
| **Colibri** | PROCEED-WITH-CAUTION | Apache-2.0 | None found (install text is ordinary `./setup.sh`, `coli convert`, `coli chat`; no "ignore previous instructions", no pipe-to-shell) | Native build (`setup.sh` + ~2,400-line `glm.c`) and Python `convert` step (torch/safetensors) not audited line-by-line; **~370 GB int4 weights pulled from third-party HF accounts** = real provenance trust point | Exists, permissive, no malicious code observed; not CLEAR because the native/convert path is unaudited and the weights are third-party. Verify weight hashes/provenance before any use. |
| **Open Interpreter** | CLEAR (idea-level ingest) | Apache-2.0 (verified verbatim from `LICENSE`) | None found across two independent fetches | The *running tool* is an arbitrary-code-execution agent (host code exec), mitigated in-product by native OS sandbox + approvals; heavy Codex-forked Rust/Cargo/Bazel supply chain | We only extract *ideas*; we are not importing the crate or running the agent, so the tool's inherent exec risk does not transfer at analysis time. Record: the running tool itself is CAUTION-by-nature; legacy Python code (if any idea is sourced from it) is AGPL. |
| **Bonsai 27B** | PROCEED-WITH-CAUTION | Apache-2.0 | An `AGENTS.md` explicitly invites you to "point your AI coding agent at" it (a doc-as-agent-instruction vector; content read benign this pass) | `setup.sh` does `curl \| sh` of the astral.sh `uv` installer, clones + source-builds a **custom PrismML fork of MLX** (`git clone -b prism .../mlx.git`), uses `sudo apt-get`; Windows path runs `Set-ExecutionPolicy Bypass; .\setup.ps1` | Exists, permissive, no destructive code found; not CLEAR because of the custom-fork source-build supply chain + agent-targeted doc + unverifiable headline claims. Do NOT run its installer; if ever adopted, pull only the plain `prism-ml/Bonsai-27B-gguf` artifact via Ollama. |
| **PDF (skills)** | CLEAR | n/a | None (static article, already ingested once at v1.7.0) | None | Article text; no executable surface. |

---

## 4. Per-source Capability Comparison

Legend: `+` external-only (adoption candidate) | `=` current-only (strength to preserve) | `~` both, different approach | `.` both, equivalent.

### 4.A Colibri -- disk-streamed MoE expert offloading -- `+` (green-field technique; sub-1-tok/s tradeoff)

Colibri's primitive is a **VRAM -> RAM -> disk memory hierarchy** with a per-layer LRU expert cache plus warm KV persistence, purpose-built to run a 744B/40B-active MoE (GLM-5.2, int4) on a 25 GB / no-GPU host. Nexus today has a GPU scheduler and live VRAM telemetry ([README](../../../README.md) telemetry section) but **no concept of disk as a weight tier** -- its Ollama backend caps usable models at roughly what fits VRAM+RAM (tens of B params), and its **single-GPU ceiling** design principle ([README](../../../README.md) Design Principle 3) makes huge models out of reach.

The honest engineering read (`supported`, from source verification):

- **What is genuinely net-new**: explicit disk-tier expert *streaming beyond RAM*, a managed 3-tier LRU expert cache, warm-KV persistence across restarts (`.coli_kv`, ~182 KB/token -> conversations reopen with zero re-processing), plus model-architecture efficiencies (MLA KV-cache compression 32,768 -> 576 floats/token; native MTP-head speculative decoding).
- **What is already achievable via Nexus's existing layer**: llama.cpp (which Ollama wraps) already does `mmap` weight paging and partial CPU/GPU offload; the llama.cpp *lineage* already ships MoE expert streaming (`llama-cpp-moe-flash`, which benchmarks 744B at 1.6-2.9 t/s CPU-only; `llama.moe`). So the net-new slice is **narrow**, and the right move is to adopt the flash-MoE offload path from the existing llama.cpp lineage rather than port a bespoke C engine.
- **The disqualifying tradeoff for interactivity**: every gain lands at **0.05-0.1 tok/s cold, ~1-2 tok/s warm**. None of Nexus's four pillars (agentic coding, chat, image, video) tolerate that latency. The gap is real but confined to a **"patient / async / batch" use mode** -- e.g. an overnight refactor, a long-horizon plan, a single high-stakes reasoning pass -- not the interactive default.

Fit: an **optional inference tier** (-> **E1**), off by default, below-ceiling, no-GPU-required, with an explicit latency warning. This **extends** the single-GPU-ceiling principle (a deliberately below-ceiling path) rather than violating it (it adds no new hardware demand).

### 4.B Open Interpreter (Codex fork) -- per-model harness abstraction -- `~` / `+` (core loop covered; harness idea net-new)

The current repo is an Apache-2.0 Rust fork of OpenAI's Codex, thesis: *get the best agentic performance out of low-cost models*. Nexus's Coding pillar is already a full agentic harness (tool registry, plan/auto modes, verification gates + git checkpoints, four-layer memory, MCP, skill catalog, sub-agent dispatch, isolated code execution, multi-model over Ollama) -- so the **core loop is already covered** (`=`). The differentiated ideas, honestly triaged:

- **Per-model "harness" abstraction** (`/harness` swaps the prompt/tool scaffold *independently of the model*: `native, claude-code, zcode, qwen-code, deepseek-tui, swe-agent, minimal`) -- **`+`, not clearly covered, highest-value.** Nexus has multi-model support and the Hub `model-routing` skill, but nothing that swaps the *scaffold* per model to squeeze agentic performance from weak/quantized local models. This is the most ceiling-aligned idea in the whole submission (-> **H1**).
- **Low-cost-model optimization techniques** (prompt/tool shaping so weak models complete agentic tasks) -- **`~`, partially covered.** Capture as guidance, not code (-> **H2**, skill-native).
- **OS-native sandbox hardening** (Codex-lineage Seatbelt/Landlock/seccomp + explicit sandbox+approvals tier) -- **`~`, mostly covered.** Nexus already runs code in isolated environments with verification gates; OI's OS-level sandbox may be more robust. A hardening *reference*, conditional on an audit (-> **H3**).
- **Computer-use / QA** (`agent-browser` web driving + `trycua` native-app operation; the legacy `--os` desktop-vision GUI control) -- **`+`, differentiated but out-of-scope for the Coding pillar** (heavy surface; GPU-vision cost on a single GPU). Note as a future / other-pillar candidate (-> **C1**).
- **REPL magic-command UX + profiles**, **language-agnostic execution breadth** -- **`.`/`=`, already covered.** Minor UX inspiration at most; drop.

### 4.C Bonsai 27B -- extreme low-bit quantization tier -- `~` (Nexus quantizes already; the sub-4-bit tier is net-new but unproven)

Nexus **already does quantization-to-fit** (`~`): GGUF via Ollama, typically 4-bit (Q4_K_M-class); the [ecosystem-2026-06 comparison](../v1.5/comparison-ecosystem-2026-06.md) even ships a Gemma 4 GGUF quant ladder (IQ2_M -> BF16) mapped to hardware tiers in the model catalog. "Compress the model so it fits one consumer GPU" is Nexus's *existing mechanism*, not a gap.

De-hyped, the real idea is a tier **below 4-bit**: BitNet-class **ternary / 1-bit** quantization, to fit a larger-capability model into far less VRAM/RAM (a "27B-class capability at ~4-7 GiB weights"). That would add a genuine new rung to the hardware/disk-aware installer picker ([scripts/installer/src/nexus_installer/pages/typed_catalog.py](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py), [engine/model_router.py](../../../scripts/installer/src/nexus_installer/engine/model_router.py)) and [ModelCatalog](../../../core/registry/ModelCatalog.ts) -- an "ultra-low-VRAM / entry" tier (-> **Q1**).

Three honesty caveats (`supported`, from verification):

1. **The retention claims are overstated.** Real ternary parity (BitNet b1.58) is *trained from scratch* with BitLinear + straight-through estimator over trillions of tokens -- "not a quantized version of a full-precision model". Post-hoc 1-bit PTQ (BiLLM, ARB-LLM) shows substantial degradation; AQLM is near-lossless only at 2-3 bits. ~90% at 1.125 bpw on a 27B by "squeezing" is an extraordinary, un-independently-benchmarked vendor number.
2. **The phone tier is out of scope.** Nexus's declared floor is a laptop-class single GPU; it does not target phones. Only the laptop-class ternary variant maps to the ceiling.
3. **The vendor and its runtime are not adoptable.** The Bonsai model + `curl|sh`/custom-MLX-fork installer is a **drop/watch** (-> **D2**); the MLX/Swift/Android runtime is irrelevant to an Ollama/GGUF product (-> **D4**). Only a legitimately-benchmarked BitNet-class GGUF (e.g. Microsoft's real train-from-scratch `BitNet b1.58 2B4T`) belongs in the picker, and only if the bundled llama.cpp exposes the Q1_0/Q2_0 formats.

### 4.D Self-optimizing-skills PDF -- `=` (already adopted at v1.7.0; a strength to preserve, not a gap)

This is the **same article** analyzed at [comparison-self-optimizing-skills.md](../v1.7/comparison-self-optimizing-skills.md). Its adoption plan ([adoption-self-optimizing-skills.md](../v1.7/plans/adoption-self-optimizing-skills.md)) closed 2026-07-02 with all phases DELIVERED. Current-codebase status (`internal-compatible`, file-verified for this report):

| v1.7 item | Status now | Evidence |
|---|---|---|
| S1 -- TS-native golden-task live runner | **LANDED** | [GoldenTaskRunner.ts](../../../modules/coding/evaluation/GoldenTaskRunner.ts), production driver [HeadlessAgentDriver.ts](../../../modules/coding/runtime/HeadlessAgentDriver.ts) (Python `_run_live()` -> ADR-0001 deleted backend superseded) |
| S2 -- bounded-edit skill optimizer (opt-in, default OFF) | **LANDED** | [SkillOptimizer.ts](../../../modules/coding/skilloptimizer/SkillOptimizer.ts) + [ReflexionDiagnoser](../../../modules/coding/skilloptimizer/ReflexionDiagnoser.ts) / [SkillEditProposer](../../../modules/coding/skilloptimizer/SkillEditProposer.ts) / [EditCritic](../../../modules/coding/skilloptimizer/EditCritic.ts) / [skillEdit.ts](../../../modules/coding/skilloptimizer/skillEdit.ts) |
| S3 -- Pareto-frontier candidates on git branches | **LANDED** | [CandidateFrontier.ts](../../../modules/coding/skilloptimizer/CandidateFrontier.ts) + [pareto.ts](../../../modules/coding/skilloptimizer/pareto.ts) + [frontierWorktree.ts](../../../modules/coding/skilloptimizer/frontierWorktree.ts) |
| S4 -- split + held-out gate + rejected-edit buffer | **LANDED** | [goldenSplit.ts](../../../modules/coding/evaluation/goldenSplit.ts) + [validationGate.ts](../../../modules/coding/evaluation/validationGate.ts) + [core/memory/RejectedEditBuffer.ts](../../../core/memory/RejectedEditBuffer.ts) |
| S6 -- optimizer-quality A/B | **LANDED** | [SkillOptimizerAb.ts](../../../modules/coding/skilloptimizer/SkillOptimizerAb.ts) |
| S5 -- background self-optimization + live-trajectory flagging | **MISSING (by design)** | Demand-gated / off-by-default in the v1.7 Out-of-Scope appendix; no background worker in `core/`, `modules/`, or `src/`; not carried into any later cycle |

The re-submission therefore yields **no new loop work** -- the loop shipped. What it *does* usefully surface are two still-open threads recorded in the [v1.7.0 known-gaps](../v1.7/known-gaps.md): the optimizer is not yet wired to the desktop sidecar and has no `nexus skills optimize` / `nexus skills frontier` CLI (RT.P7.A/B/C, SO003.P3.D, SO005.P4.C) -- i.e. a shipped capability that is not yet user-reachable (-> **L1**) -- and the never-built S5 background routine (-> **L2**), whose autonomy/self-modification risk profile is unchanged.

---

## 5. Gap Ledger

Classes: `re-full` (fully reverse-engineerable local module) | `re-partial` (reverse-engineer the concept; much reuses existing infra) | `local-only` (data/config, no new outbound) | `skill-native` (Nexus-Hub content) | `drop` | `watch`.

| ID | Capability | Status in Nexus | Class | Target location |
|---|---|---|---|---|
| **H1** | **Per-model agent-harness selector** (pick the best prompt/tool scaffold per installed local model to maximize weak/quantized models) | Missing (multi-model + `model-routing` skill exist; no scaffold-swap) | **re-partial** | new selector under [modules/coding/orchestration/](../../../modules/coding/orchestration) + Hub `model-routing` |
| **H2** | Low-cost-model optimization techniques (prompt/tool shaping for weak models) | Partial (model selection only) | **skill-native** | Nexus-Hub skill / memory; folds into H1 |
| **H3** | OS-native code-exec sandbox hardening (Seatbelt/Landlock/seccomp-class) | Partial (isolated exec + verification gates ship) | **re-partial** (conditional on audit) | [src/tools/](../../../src/tools) execution sandbox |
| **L1** | **Surface the v1.7 skill optimizer** (desktop-sidecar wiring + `nexus skills optimize` / `nexus skills frontier` CLI) | Partial (engine landed; not user-reachable) | **re-full** | desktop sidecar + [bin/nexus.mjs](../../../bin) + [skilloptimizer/](../../../modules/coding/skilloptimizer) seams |
| **L2** | Background self-optimization + live-trajectory failure flagging (= v1.7 **S5**) | Missing (demand-gated; hooks + trace store + worker precedent exist) | **re-full** (demand-gated) | [core/lifecycle/](../../../core/lifecycle) hook + gated background worker |
| **Q1** | **Extreme low-bit (BitNet-class ternary/1-bit) model tier** in the hardware/disk-aware picker + registry | Partial (4-bit GGUF ships; no sub-4-bit tier) | **local-only** (gated on runtime + benchmark) | [core/registry/ModelCatalog.ts](../../../core/registry/ModelCatalog.ts) + [installer typed_catalog.py](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py) / [model_router.py](../../../scripts/installer/src/nexus_installer/engine/model_router.py) |
| **E1** | **Disk-tier MoE expert-offload inference tier** ("patient / huge-model / low-hardware"; adopt the llama.cpp flash-MoE offload path) | Missing (Ollama + GPU scheduler exist; no disk weight tier) | **re-partial** | new backend adapter near [core/registry/](../../../core/registry) + installer tier; reuse llama.cpp lineage |
| **E2** | Warm KV-cache persistence across restarts (zero re-processing on reopen) | Missing (Ollama re-processes context on reload) | **re-partial** | [core/memory/](../../../core/memory) + coding session store; folds into E1 |
| **E3** | Large-open-MoE catalog entries (GLM-5.2 and peers) | Missing (catalog data only) | **local-only** | [core/registry/ModelCatalog.ts](../../../core/registry/ModelCatalog.ts); only useful with E1 |
| **C1** | Computer-use / desktop-vision QA (browser + native-app driving) | Missing (out of Coding-pillar scope) | **re-full** (defer / other-pillar) | future; not this cycle |
| **D1** | Import Colibri's bespoke C engine as a dependency | Absent by design | **drop** (reverse-engineer via llama.cpp lineage instead) | n/a |
| **D2** | Adopt the Bonsai 27B model + its `curl\|sh` / custom-MLX-fork installer | Absent by design | **drop / watch** | n/a |
| **D3** | Import Open Interpreter (Codex-forked Rust framework) as a dependency | Absent by design | **drop** (Apache-2.0 -- policy drop, not legal) | n/a |
| **D4** | Bonsai MLX/Swift/Android runtime + phone tier | Absent by design | **drop** (below the laptop-single-GPU floor) | n/a |
| **D5** | DSPy / GEPA / EvoSkill / SkillOpt frameworks + any cloud optimizer (restated from v1.7) | Absent by design | **drop** (reverse-engineered locally at v1.7; cloud = egress) | n/a |

---

## 6. Security and Reverse-Engineering Assessment (MANDATORY)

### 6.1 Threat-model comparison

| Axis | The three repos (as published) | Nexus's local realization (H1/H3/L1/L2/Q1/E1-E3) |
|---|---|---|
| New runtime deps | Colibri C engine; OI Codex-forked Rust framework; Bonsai custom-MLX fork | **None** -- ideas/paths reverse-engineered onto the existing spine; reuse the llama.cpp lineage Ollama already wraps |
| Outbound destinations | None intrinsic (all local inference/agents); weights from HF | **None** -- local models, local verifier, local files |
| Credentials required | None (local); HF pulls are anonymous | **None** |
| Does source / trajectory / weights leave the machine? | No (local); large weight *downloads* inbound only | **No** |
| New autonomous write surface | OI agent writes/executes code; Colibri/Bonsai none | **L1/L2 only** (skill-file edits) -- already gated at v1.7 by held-out gate, rejected-edit buffer, git-branch isolation, human approval |
| Untrusted input | Colibri weights (third-party), Bonsai installer scripts, OI/Bonsai agent-directed docs | Treat all fetched weights/scripts/docs as an **untrusted-input boundary**; verify weight hashes; never run vendor installers |
| Supply chain | Colibri ~370 GB third-party int4 weights; Bonsai `curl\|sh` + source-built MLX fork; OI heavy Cargo/Bazel tree | **Avoided** -- we import neither engine, model, nor installer; only algorithms/config + already-trusted GGUF via Ollama |

Two critical observations: **(1)** every adopted item is local-only and adds no new outbound call, credential, or data processor -- the only configuration that *would* introduce egress (a cloud optimizer, D5) stays dropped; and **(2)** the highest-risk surface (autonomous skill-file editing) is **not new** -- it shipped gated at v1.7.0, and L1/L2 inherit those guardrails unchanged.

### 6.2 Per-item risk scorecard

| ID | Risk tier | Rationale |
|---|---|---|
| H1 | Low | A local scaffold-selection layer; no new egress, no new exec surface (reuses the existing tool registry). |
| H2 | Low | Skill/memory content; no runtime surface. |
| H3 | Low-Med | Tightening an existing exec sandbox; risk is mis-scoping a policy (test on all three OSes). Conditional on an audit showing current isolation is weaker than OI's. |
| L1 | Low-Med | Exposes an already-gated engine through the sidecar + CLI. Must carry the v1.7 guardrails to the new surface: human approval before any skill file is overwritten; `pathGuard`/`ConfirmationGate`; `redactSecrets` on captured trajectories. |
| L2 | Med-High | Autonomous background routine that can launch skill edits unattended. Off by default, explicit opt-in, local-compute budget cap (reuse v0.3.0 runaway prevention), proposals queued for review, never silently applied. |
| Q1 | Low-Med | Model-catalog data + picker tier. Risks: adopting the *dubious vendor* (mitigated -- source only independently-benchmarked BitNet-class GGUF, never Bonsai); a runtime that silently ignores the quant type (gate on a llama.cpp Q1_0/Q2_0 support check). |
| E1 | Med | New inference backend path; risk is disk-thrash / OOM and runaway wall-clock. Off by default; enforce per-request timeout, an explicit latency-warning tier, and the existing hardware/disk-aware gating. Adopt the llama.cpp flash-MoE path, not the bespoke C engine. |
| E2 | Low | Persist a local KV cache to disk; risk is secret-bearing context on disk -> route through `redactSecrets` and the existing secret-path denylist. |
| E3 | Low | Catalog entries; the only risk is listing a model the host cannot run -> gate visibility on the hardware/disk picker + E1. |
| C1 | Med (deferred) | Vision + host control is a large surface; out of scope this cycle. |
| D1-D5 | Med-High (avoided) | Each is a heavy dependency / egress / unverifiable-model risk -> dropped. |

### 6.3 Reverse-engineering viability

- **H1, H3, L1, L2, E1, E2 -> `re-partial`/`re-full`.** Each is realizable as a local internal module on Nexus's existing spine (orchestration, tool registry, worktree swarm, `ReflexionEngine`/`CriticAgent`, `HeadlessAgentDriver`, GPU scheduler, `redactSecrets`, v0.3.0 runaway budgets) with **no external source attribution carried** and generic Nexus naming. E1 specifically reverse-engineers via the **llama.cpp lineage Ollama already wraps** (`mmap` paging + the flash-MoE offload path) rather than porting Colibri's C engine.
- **Q1, E3 -> `local-only`.** Model-catalog data + a picker tier; not an MCP concern. Weights are external open artifacts, pulled through the existing Ollama path (Q1 gated on runtime support + independent benchmark; never the Bonsai vendor).
- **D1 (Colibri C engine), D3 (OI Rust framework), D2/D4 (Bonsai model + runtime) -> `drop`.** Reverse-engineer-first: the value is the *technique* (disk offload) / *idea* (harness abstraction, extreme quantization), which Nexus builds leanly; importing the engine/framework/model buys a heavy dependency + supply-chain surface for logic Nexus can own. D3 is a *policy* drop (Apache-2.0 is legally importable) on the no-heavy-frameworks rule.
- **D5 (skills frameworks + cloud optimizer) -> `drop`, restated.** Already reverse-engineered locally at v1.7.0 (the SkillOptimizer/CandidateFrontier are the reverse-engineered SkillOpt/GEPA/EvoSkill); a cloud optimizer is the one configuration that ships trajectories off-machine -> conflicts with local-first / Zero Tokens Billed. `future`-watch only: an explicit, opt-in, per-run BYO-key cloud-optimizer escape hatch, never a default.

### 6.4 Recommendation ordering (this IS the adoption-plan ordering)

1. **skill-native** -- **H2** (low-cost-model optimization techniques as a Hub skill / memory; may fold into H1).
2. **re-full / re-partial (local-only)**, by value/effort -- **H1** (per-model harness selector; highest value, ceiling-aligned) -> **L1** (surface the already-shipped skill optimizer; high leverage on existing code) -> **Q1** (extreme-low-bit tier; gated on runtime + benchmark) -> **E1** (disk-tier MoE offload patient tier) + **E3** (large-MoE catalog entries) + **E2** (warm-KV persistence) -> **H3** (sandbox hardening; conditional on audit) -> **L2** (background self-optimization; demand-gated, off by default).
3. **vendor-intrinsic** -- none adopted.
4. **drop-outright** -- D1-D5 (see NOT-recommended list).

---

## 7. Adoption Plan (RE-ordered, local-only)

Reverse-engineer-first, local-only. Sequenced for the **v1.12.0** cycle; v1.11.0 is mid-flight on the installer overhaul, so this report is forward-input. The phased plan derived from this report is [plans/adoption-ecosystem-2026-07.md](plans/adoption-ecosystem-2026-07.md).

| Phase | Item(s) | Value/Effort | Why this order |
|---|---|---|---|
| 1 | **H1** per-model harness selector (+ **H2** low-cost-model skill) | High / Med | The highest-value net-new item and the most direct answer to the single-GPU ceiling: drive small/quantized local models better. Local-only; pairs with the Hub `model-routing` skill. |
| 2 | **L1** surface the v1.7 skill optimizer (sidecar wiring + `nexus skills optimize` / `nexus skills frontier` CLI) | High / Low-Med | Almost no new logic -- the engine shipped at v1.7.0 but is not user-reachable. The PDF re-submission is the prompt to finish the last mile. Carries the existing human-approval guardrails to the new surface. |
| 3 | **Q1** extreme-low-bit (BitNet-class) model tier | Med / Med | A real new rung on the hardware picker, but GATED on (a) a llama.cpp Q1_0/Q2_0 support check and (b) an independent BitNet-class benchmark. Source legitimate weights (e.g. BitNet b1.58 2B4T), never the Bonsai vendor. |
| 4 | **E1** disk-tier MoE offload "patient" tier + **E3** large-MoE catalog (GLM-5.2 et al.) + **E2** warm-KV persistence | Med / High | Removes the model-size ceiling for a deliberately below-ceiling, off-by-default, no-GPU-required tier with an explicit sub-1-tok/s warning. Adopt the llama.cpp flash-MoE path, not Colibri's C engine. E2 is a nice on-brand win even without huge models. |
| 5 (conditional) | **H3** OS-native sandbox hardening | Med / Med | Only after an audit shows Nexus's current isolated-execution is weaker than the Codex-lineage OS sandbox. |
| Backlog / demand-gated | **L2** (=S5) background self-optimization; **C1** computer-use / desktop-vision QA | Med / High | Highest autonomy risk (L2) and largest out-of-pillar surface (C1). Off by default; explicit decision points, not defaults. |

### Conflicts and risks

- **The single-GPU ceiling is a *principle*, not a bug.** E1/E3 must be framed as an explicit **below-ceiling patient tier**, off by default, with a hard latency warning -- not as raising the hardware floor. E1 conflicts with interactive-latency expectations across all four pillars; scope it to async/batch use only.
- **Unproven vendor claims.** Q1's retention (Bonsai's ~90%@1-bit) is `future`-tier and contradicts published research; block Q1 on an independent benchmark before it ships as a default. GLM-5.2's benchmarks (E3) are `supported` by third-party sources but the ~370 GB weights are a provenance trust point -- verify hashes.
- **Autonomous skill editing (L1/L2)** is the highest-risk surface and it is *already gated*; L1 must carry the held-out gate + rejected-edit buffer + human-approval-before-overwrite to the new sidecar/CLI surface, and L2 stays off by default with a local-compute budget cap.
- **Supply chain.** Do not run Bonsai's installer (`curl|sh` + custom-MLX source-build) or import Colibri's C engine / OI's Rust framework. Pull only trusted GGUF via the existing Ollama path.
- **Small-optimizer-quality ceiling (unchanged from v1.7).** Whether a small resident model produces good harness scaffolds (H1) or skill edits (L1/L2) is capped by the best local model; reuse the S6 A/B harness ([SkillOptimizerAb.ts](../../../modules/coding/skilloptimizer/SkillOptimizerAb.ts)) to measure before trusting defaults.

### NOT recommended (dropped, with policy grounds)

- **D1 -- Import Colibri's C engine.** Reverse-engineer-first: adopt the flash-MoE offload path from the llama.cpp lineage Ollama already wraps; a bespoke 2,400-line C engine is a heavy dependency for a narrow net-new slice.
- **D2 -- Adopt the Bonsai 27B model + its installer.** Unverified retention claims + `curl|sh`/custom-MLX-fork supply chain + agent-targeted `AGENTS.md`. Watch only: revisit if independent benchmarks confirm the retention, and then pull only the plain GGUF via Ollama.
- **D3 -- Import Open Interpreter.** Apache-2.0 (legally importable) but a heavy Codex-forked Rust framework -> policy drop on the no-heavy-frameworks / reverse-engineer-first rule. Adopt the harness idea (H1), not the crate.
- **D4 -- Bonsai mobile runtime / phone tier.** Below Nexus's laptop-single-GPU floor; MLX/Swift/Android is irrelevant to an Ollama/GGUF product.
- **D5 -- DSPy / GEPA / EvoSkill / SkillOpt frameworks + any cloud optimizer.** Already reverse-engineered locally at v1.7.0; a cloud optimizer ships trajectories off-machine (egress + API key + per-token billing) -> conflicts with local-first / Zero Tokens Billed. `future`-watch only (opt-in BYO-key escape hatch, never a default).

---

## 8. Verification Checklist

- [x] Source types identified (3 Git repos + 1 article) and scope auto-inferred; the ambiguous "Codex Open Source" label resolved to the current Apache-2.0 Codex-fork repo
- [x] **Mandatory pre-ingest source-security scan (Step 1.5) run for every source** with a CLEAR / PROCEED-WITH-CAUTION / BLOCK verdict and justification (Section 3)
- [x] Every dimension evaluated for both the source and Nexus with file-path evidence
- [x] Prior-comparison de-duplication done -- the PDF is confirmed already-adopted at v1.7.0 (S1-S4/S6 landed; S5 deferred), so it is reported as validation, not re-derived
- [x] Every gap cites a concrete, verified target location in Nexus
- [x] Priority assignments consistent with the value/effort matrix
- [x] Conflicts flagged (single-GPU ceiling as principle; unproven quant claims; autonomous skill editing; supply chain; small-optimizer ceiling)
- [x] Items NOT recommended include reasoning (D1-D5)
- [x] **Section 6 complete** -- threat-model table, per-item risk scorecard, per-item RE classification all present
- [x] **Section 6.4 ordering used** -- skill-native (H2) -> re-full/re-partial (H1, L1, Q1, E1/E3/E2, H3, L2) -> vendor-intrinsic (none) -> drops (D1-D5)
- [x] **MCP Registry Policy cited by name** for every item involving an outbound call / API key / new data processor / new dependency (the drop list)

---

## Appendix A -- Source reference anchors

- **Colibri**: [github.com/JustVugg/colibri](https://github.com/JustVugg/colibri) (Apache-2.0; single-file C engine; disk-streamed MoE offload; OpenAI-compatible). GLM-5.2 (744B/40B-active, Zhipu AI, ~June 2026) is a real open-weights model (VentureBeat, datanorth.ai, llm-stats.com). Technique prior art: Apple "LLM in a Flash" (arXiv 2312.11514), DeepSpeed ZeRO-Inference, AirLLM, `llama-cpp-moe-flash`, `llama.moe`, HOBBIT (arXiv 2411.01433).
- **Open Interpreter**: [github.com/openinterpreter/openinterpreter](https://github.com/openinterpreter/openinterpreter) (Apache-2.0, verified from `LICENSE`; Rust fork of OpenAI's Codex; release 0.0.26 dated 2026-07-16; `/harness` scaffolds). NOT OpenAI's official Codex product; legacy Python AGPL REPL superseded.
- **Bonsai 27B**: [github.com/PrismML-Eng/Bonsai-demo](https://github.com/PrismML-Eng/Bonsai-demo) (Apache-2.0; HF `prism-ml` GGUF/MLX collection). Extreme-quant reality check: BitNet b1.58 is trained from scratch ("Era of 1-bit LLMs", arXiv 2402.17764); post-hoc 1-bit PTQ (BiLLM, ARB-LLM) degrades; AQLM near-lossless only at 2-3 bits (arXiv 2401.06118).
- **PDF**: "How your agents can write and optimize their own skills" -- SkillOpt (Microsoft Research), GEPA (Genetic-Pareto, DSPy-compatible), EvoSkill; the "loop engineering" frame. Already analyzed at [comparison-self-optimizing-skills.md](../v1.7/comparison-self-optimizing-skills.md).

## Appendix B -- Nexus substrate map (evidence anchors, file-verified for this report)

- Model layer: [core/registry/ModelRegistry.ts](../../../core/registry/ModelRegistry.ts), [core/registry/ModelCatalog.ts](../../../core/registry/ModelCatalog.ts); GPU scheduler + live VRAM telemetry ([README](../../../README.md)).
- Installer picker: [scripts/installer/src/nexus_installer/pages/typed_catalog.py](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py), [engine/model_router.py](../../../scripts/installer/src/nexus_installer/engine/model_router.py), [engine/model_puller.py](../../../scripts/installer/src/nexus_installer/engine/model_puller.py), [widgets/model_checkbox.py](../../../scripts/installer/src/nexus_installer/widgets/model_checkbox.py).
- Coding harness: [modules/coding/orchestration/](../../../modules/coding/orchestration) (tool registry, plan/auto, `ReflexionEngine`/`CriticAgent`, sub-agent dispatch), [src/tools/](../../../src/tools) (execution + shell introspection guardrails).
- Skill self-optimization loop (v1.7.0, LANDED): [modules/coding/skilloptimizer/](../../../modules/coding/skilloptimizer) (SkillOptimizer, CandidateFrontier, pareto, frontierWorktree, ReflexionDiagnoser, SkillEditProposer, EditCritic, SkillOptimizerAb, HeadlessOptimizerRollout, HeadlessCandidateSeams), [modules/coding/evaluation/](../../../modules/coding/evaluation) (GoldenTaskRunner, goldenSplit, validationGate), [modules/coding/runtime/HeadlessAgentDriver.ts](../../../modules/coding/runtime/HeadlessAgentDriver.ts), [core/memory/RejectedEditBuffer.ts](../../../core/memory/RejectedEditBuffer.ts).
- Safety: [core/observability/redactSecrets.ts](../../../core/observability/redactSecrets.ts), `pathGuard`/`ConfirmationGate`/`ActionClassifier`, v0.3.0 runaway-prevention budgets, [core/lifecycle/](../../../core/lifecycle) HookBus.

## Appendix C -- Confidence notes

Source findings are at `supported` confidence (direct fetch/verification of each repo's README + LICENSE + web corroboration on 2026-07-16). The three source facts that corrected pre-cutoff priors (GLM-5.2 is real; Open Interpreter is now a Codex fork; Bonsai exists but its claims are overstated) are each corroborated across multiple independent fetches/searches, stated at `supported`. Nexus "already implemented" findings (the v1.7.0 loop; the Coding-pillar core loop) are file-verified for this report at `internal-compatible` confidence -- grounded in the cited files, the v1.7.0 comparison + plan + known-gaps, and the README/ARCHITECTURE tables -- not a line-by-line audit of every module. Every claim about an unbuilt Nexus capability (H1, H3, L1, L2, Q1, E1-E3, C1) is stated at `candidate` (substrate exists and is composable) or `future` (quality/benchmark unproven -- notably Q1's retention and E1's usable-throughput). "not_observed != absent" applies throughout.
