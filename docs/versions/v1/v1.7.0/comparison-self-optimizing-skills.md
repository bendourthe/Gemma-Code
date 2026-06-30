# Cross-Project Comparison: Nexus (v1.6.0 codebase) vs. "How your agents can write and optimize their own skills" -- text-space skill self-optimization (SkillOpt / GEPA / EvoSkill)

**Version**: v1.7.0 (forward-input single-source comparison for the v1.7.0 cycle; analysis snapshot assumes **all v1.6.0 plans complete** -- the aisuite-harness adoptions A1-A4/H1 and the openrouter-fusion adoptions F1-F5 are treated as shipped baseline, per the user framing for this comparison)
**Generated**: 2026-06-29T00:00:00Z
**Analyzer**: Claude Code -- /compare
**Source Type**: Article (PDF) -- "How your agents can write and optimize their own skills" (industry survey of three text-space skill optimizers: **SkillOpt** (Microsoft Research), **GEPA** (Genetic-Pareto, DSPy-compatible), and **EvoSkill** (GEPA applied to multi-agent coding skills), framed as the "loop engineering" architectural shift)
**Companion report**: [comparison-opencode.md](comparison-opencode.md) (same cycle; the adjacent coding-agent repo scan)
**Decision lens**: [AGENTS.md](../../../../AGENTS.md) MCP Registry Policy -- **local-only > LLM-native skill > reverse-engineered internal module > trusted-vendor wrapper > drop**. Hard no: search / embeddings / scraping / generation as a service; no outbound calls without explicit user opt-in; no telemetry by default.
**Wording convention**: per [development/evidence-and-support-tiers.md](../v1.4.0/development/evidence-and-support-tiers.md), every claim about an *unbuilt* Nexus capability is stated at `candidate` or `future` tier, never `supported`; "not_observed != absent" applies. "Already implemented" classifications are grounded in the v1.6.0 [known-gaps.md](../v1.6.0/known-gaps.md), the two v1.6.0 plans, the [README.md](../../../../README.md)/[ARCHITECTURE.md](../../../../ARCHITECTURE.md) capability tables, and the per-subsystem code map taken for this report at `internal-compatible` confidence.

This is a single-source comparison against an **article**, not a codebase, so the comparison axis is *technique*, not *artifact*: the article describes a class of system (a closed optimization loop that treats a skill `.md` file as trainable external state) and three reference implementations of it. The headline is the inverse of the aisuite comparison: where aisuite **validated** Nexus's harness depth and surfaced only small refinements, this article surfaces a **genuine, headline-grade, entirely-local capability that Nexus does not yet have** -- a verifiable loop that lets the agent measure its own skills against a task suite and rewrite them under regression-safe gates. Critically, every load-bearing substrate the loop needs (a golden task suite with declarative success criteria, a regression/baseline comparator, a reflection engine, a critic, worktree-isolated git-branch workers, a local A/B harness, secret redaction, and runaway-prevention budgets) **already exists in Nexus**; what is missing is the loop that composes them, plus one broken prerequisite (a working TS-native live task runner). The technique is local-only by construction (a local model is the optimizer, a local verifier is the signal, and the edited artifact is a local `.md` file), so it is on-brand with "Zero Tokens Billed / no data leaving your machine" in a way cloud routing never was.

---

## 1. Executive Summary

The article frames a single thesis: the bottleneck for reliable agents is no longer model capability but **skill quality**, and skills (standalone `.md` operating procedures) have until now been optimized by hand -- a slow, non-scalable, regression-prone loop with no gradient to follow. The industry response is to treat the skill document as a **trainable external state** and wrap it in an automated, verifiable optimization loop. The article surveys three implementations:

- **SkillOpt** (Microsoft Research): a structured text-space optimizer with a five-stage loop -- **Rollout** (run a batch of tasks, record trajectories) -> **Evaluation** (a verifier scores each trajectory pass/fail) -> **Reflection** (a separate optimizer LLM analyzes minibatches of trajectories to find the text driving failures) -> **Bounded edits** (propose add / delete / replace edits under a "textual learning-rate budget" that caps edit volatility) -> **held-out validation gate** (edits are accepted only if they improve a validation split not seen during training; rejected edits go to a **rejected-edit buffer**). An epoch-wise "slow/meta update" reflects on improvements vs. regressions vs. persistent failures to optimize the optimizer itself. Reported result: +23.5 (chat) / +24.8 (codex loop) on GPT-5.5, compact ~920-token median skills, generalizing across models and harnesses.
- **GEPA** (Genetic-Pareto): evolutionary optimization of LLM instructions. An LLM reflects on a reasoning trace, diagnoses failures, and proposes "mutations" of the artifact; **Pareto-based selection** keeps a pool of candidates that each win on *different* tasks, sampling diverse winning strategies that generalize. DSPy-compatible.
- **EvoSkill**: GEPA's idea applied to multi-agent coding skills -- candidates live on **separate git branches**, a **Pareto frontier** selects the highest performers, and a branch that beats baseline on a held-out set replaces the lowest-performing variant.

The article's closing frame is **"loop engineering"**: instead of writing prompts, engineers assemble control systems with precise evaluation metrics, memory storage, and exit conditions, letting an agent repeat a verifiable task until optimal -- and production systems track live trajectories, flag recurring edge-case failures, and launch background optimization routines that update their own files safely.

Mapped against Nexus's Coding-pillar harness, the analysis surfaces **9 distinct capabilities/sub-capabilities**, of which **2 are already implemented** (the verifiable feedback substrate and the reflection primitive), **3 are partially implemented** (the task suite, the regression comparator, and method-level skill-authoring guidance), **4 are missing-but-relevant (all local-only `re-full`)**, and **2 are dropped on policy grounds** (adopting DSPy/EvoSkill/SkillOpt as external frameworks; any hosted optimizer service).

The dominant finding is **opportunity, not validation**. Nexus already ships the substrate that the article says is the hard prerequisite: a golden task suite of 24 declarative tasks with machine-checkable success criteria ([tests/golden/](../../../../tests/golden/), [modules/coding/evaluation/GoldenTaskSuite.ts](../../../../modules/coding/evaluation/GoldenTaskSuite.ts)), a `RegressionReport` comparator with per-model-tier baselines, a `ReflexionEngine` + `CriticAgent` for failure diagnosis, worktree-isolated git-branch workers from the v1.5.0 swarm, a local A/B harness from v1.6.0 Fusion F4, secret redaction, and v0.3.0 runaway-prevention budgets. What Nexus lacks is (1) a **working TS-native live task runner** (the existing one posts to a Python backend deleted by [ADR-0001](../../../../docs/adr/0001-python-backend-disposition.md), so live runs return "backend call failed" -- this is the one real blocker), and (2) the **optimization loop** that composes rollout -> eval -> reflect -> bounded-edit -> held-out-gate over the local skill catalog, with a rejected-edit buffer and optional Pareto-frontier candidate management on git branches.

The genuinely net-new, adoptable work is **four items, all local-only and all `re-full`**: **(S1)** a TS-native **golden-task live runner** (execute the agent loop against a task snapshot, score the trajectory against the declarative criteria, emit a `GoldenTaskResult`) -- the rollout+evaluation prerequisite; **(S2)** a **bounded-edit skill optimizer** (the SkillOpt loop: reflect on failing-trajectory minibatches, propose add/delete/replace skill edits under a textual learning-rate budget, accept only on a held-out validation gain, keep a rejected-edit buffer); **(S3)** **Pareto-frontier candidate management** (GEPA/EvoSkill-style: keep multiple skill candidates on separate git branches via the existing worktree infra, select top performers across diverse tasks, replace the lowest); and **(S4)** the **train/validation/test split discipline + held-out gate + rejected-edit buffer** the loop depends on for regression safety.

Two further items are recorded but **not adopted as a default**: **(S5)** a background, autonomous "loop-engineering" self-optimization routine that watches live trajectories, flags recurring failures, and launches background skill-optimization runs -- the article's most ambitious frame, and the one that most needs strong local guardrails (human-in-the-loop approval before any skill file is written, git-branch isolation, local-compute budget caps, and the optimizer-reads-untrusted-trajectory-text boundary already hardened in Fusion F5); it is sequenced last and **demand-gated**. And the headline honesty caveat: the article's reported gains come from a **frontier optimizer (GPT-5.5)**; whether a *small local optimizer model* can produce SkillOpt-quality bounded edits on Nexus coding tasks is **unproven** and must be measured locally before the loop's edits are trusted -- the same `vendor-reported -> measure-locally` discipline the Fusion A/B applied to the budget panel.

Adopting DSPy, EvoSkill, or SkillOpt as **external dependencies/frameworks** is **dropped**: per the MCP Registry Policy's reverse-engineer-first rule, their loop logic (the genetic-Pareto selector, the bounded-edit budget, the rejected-edit buffer) is realizable as a lean local module on Nexus's existing orchestration spine, with no external attribution carried.

---

## 2. Source Inventory

| Field | The article's technique (SkillOpt / GEPA / EvoSkill) | Nexus |
|---|---|---|
| Identity | A closed loop that optimizes skill `.md` files as trainable external state | Local-first four-pillar desktop AI Studio (Coding / Chat / Image / Video) |
| Artifact optimized | A standalone skill `.md` (instructions, tool-use guidance, formatting, failure recovery) | Skill catalog `.md` files synced from Nexus-Hub ([core/skills/SkillCatalog.ts](../../../../core/skills/SkillCatalog.ts)) |
| Feedback signal | A verifier scoring trajectories pass/fail on a task suite | Golden task suite with declarative success criteria ([tests/golden/](../../../../tests/golden/)) |
| Optimizer | A separate LLM (frontier-class, e.g. GPT-5.5) reflecting on trajectories | A **local** model (registry-resident); quality ceiling = best resident model |
| Candidate management | SkillOpt: single file + rejected-edit buffer. GEPA/EvoSkill: Pareto frontier on git branches | Worktree-isolated git-branch workers exist (v1.5.0 swarm); no candidate frontier yet |
| Regression safety | Held-out validation split + rejected-edit buffer + textual learning-rate budget | `RegressionReport` + per-tier baselines exist; no held-out skill-edit gate yet |
| Reflection primitive | LLM diagnoses failure-driving text from the trace | `ReflexionEngine` + `CriticAgent` already ship |
| Cost profile | Upfront optimization compute only; zero inference-stack change (output is a plain `.md`) | VRAM + wall-clock (no dollars); a plain `.md` needs no inference-stack change |
| Outbound / processor | None intrinsic to the method (cloud only if the optimizer is a cloud model) | **None** -- local optimizer, local verifier, local files |

---

## 3. Capability Comparison (per dimension)

Legend: `+` external-only (adoption candidate) | `=` current-only (strength to preserve) | `~` both, different approach | `.` both, equivalent.

### 3.1 Verifiable feedback signal (the hard prerequisite) -- `~` (Nexus has the criteria; the live runner is broken)

The article is emphatic that text-space optimizers "cannot function on subjective, completely open-ended tasks. They require a verifiable feedback signal and a clean, representative held-out evaluation dataset." Nexus already ships exactly this signal substrate: [tests/golden/](../../../../tests/golden/) holds 24 YAML tasks across 5 categories (multi-file-edit, bug-fix, refactor, test-gen, code-review), each pairing a self-contained git snapshot with declarative, machine-checkable `success_criteria` (`file_contains`, `test_passes`, `lint_passes`, `diff_matches`, `output_contains`, `no_errors`, `file_exists`/`file_deleted`). The TS-side [modules/coding/evaluation/GoldenTaskSuite.ts](../../../../modules/coding/evaluation/GoldenTaskSuite.ts) already types the result shape the loop needs: a `GoldenTaskResult` (`passed`, `traceId`, `metrics`, `failures`, `durationMs`) and a `RegressionReport`.

The one real gap: the live runner is broken. Per [tests/golden/README.md](../../../../tests/golden/README.md), `framework/task_runner.py::_run_live()` posts to a `GEMMA_BACKEND_URL` FastAPI backend deleted by [ADR-0001](../../../../docs/adr/0001-python-backend-disposition.md); "No TS-side runner replaces it yet, so live runs ... currently return 'backend call failed' for every task." The directory is a **dry-mode harness only**. A skill-optimization loop cannot exist without a live rollout, so reviving this as a TS-native runner is the load-bearing prerequisite (-> **S1**).

### 3.2 Rollout + Evaluation (run the suite, score the trajectories) -- `+` (adoption candidate; depends on S1)

SkillOpt's first two stages -- batch-execute tasks and record trajectories (Rollout), then score each via a verifier (Evaluation) -- map directly onto "run the golden suite against the current skill set and collect scored `GoldenTaskResult`s." Nexus has the criteria evaluator (declarative `success_criteria`) and the trace/metrics capture (`traceId` + `SessionMetrics` via [modules/coding/observability/MetricsCollector.ts](../../../../modules/coding/observability/MetricsCollector.ts)), but no orchestrated rollout that loops the suite and aggregates a scored batch for the optimizer. This is the body of **S1** once the live runner exists.

### 3.3 Reflection / failure diagnosis -- `=` (Nexus has the primitive)

SkillOpt's Reflection stage and GEPA's "reflect on the reasoning trace, diagnose failures" are exactly the job of Nexus's existing [ReflexionEngine](../../../../modules/coding/orchestration/) and `CriticAgent` (the Plan-and-Execute critic and the v1.5.0 swarm critic). The primitive ships; what is net-new is pointing it at *minibatches of failing trajectories to identify the skill text driving the failures* (rather than at a single run's output). **Preserve and reuse; the reflection target is new, the engine is not.**

### 3.4 Bounded edits + textual learning-rate budget -- `+` (adoption candidate, the core of S2)

SkillOpt proposes specific add / delete / replace modifications to the skill file, bounded by a "textual learning-rate budget" that caps edit volatility, and stores rejected edits in a buffer. Nexus has no equivalent: skill files are author-edited and synced from the Hub; nothing proposes scored, bounded, machine-generated edits with a regression gate. This is the heart of **S2**. The edit-application surface can reuse Nexus's existing safe-mutation discipline (`write/edit` through `pathGuard`, `ConfirmationGate`, `ActionClassifier`, and `redactSecrets`), and the bounded-budget cap mirrors the "no unbounded loop" ethos of v0.3.0 runaway prevention.

### 3.5 Held-out validation gate + rejected-edit buffer -- `~` (Nexus has the comparator, not the gate)

SkillOpt accepts an edit only if it improves a held-out validation split not seen during training, and rejects (buffers) edits that do not. Nexus has the *comparator* -- `RegressionReport` + `framework/regression.py` (pass-rate drop, time, token-efficiency) + per-tier baselines under `tests/golden/baselines/` -- but no **train/validation/test split** of the task suite and no **rejected-edit buffer**. Adding the split discipline and the buffer (-> **S4**) is what makes S2's edits regression-safe; the article is explicit that without a clean held-out set the loop produces volatile, non-generalizing changes.

### 3.6 Pareto-frontier candidate management on git branches -- `+` (GEPA/EvoSkill; adoption candidate)

GEPA keeps a Pareto frontier of candidates that each win on different tasks; EvoSkill puts each candidate on a separate git branch and replaces the lowest-performing variant when a branch beats baseline on held-out data. Nexus already has the **mechanism** EvoSkill needs -- worktree-isolated, write-capable git-branch workers from the v1.5.0 Phase 4 swarm ([modules/coding/orchestration/](../../../../modules/coding/orchestration/) + the worktree infra) and `GitSafetyNet`. What is missing is the **Pareto selector** (keep the non-dominated set across diverse tasks) and the candidate-lifecycle bookkeeping. This reverse-engineers cleanly into a local module (-> **S3**); it is the evolutionary layer that sits on top of S2's single-file bounded-edit loop and is correctly sequenced after it.

### 3.7 Memory of optimization state -- `.` (equivalent substrate)

The "loop engineering" frame requires memory storage for trajectories, rejected edits, and candidate scores. Nexus's four-layer memory ([core/memory/MemoryHub.ts](../../../../core/memory/MemoryHub.ts)) plus the content-addressed, redaction-on-write [ArtifactStore](../../../../core/memory/ArtifactStore.ts) (shipped in v1.6.0 A1) are a natural home for the rejected-edit buffer and trajectory archive. **No new storage primitive needed; reuse.**

### 3.8 Background self-optimization + live-trajectory failure flagging -- `+` (adoption candidate; highest risk; demand-gated)

The article's most ambitious frame: production systems track live agent trajectories, flag recurring edge-case failures, and launch background optimization routines that update their own files safely. Nexus has the hooks (the `lifecycle.session.reflection` hook + 13-event [HookBus](../../../../core/lifecycle/HookBus.ts)), the trace store, and a precedent for a local background worker (the weekly skill auto-sync worker). What is missing is the watcher that detects recurring failure patterns and schedules a gated background optimization run (-> **S5**). This is the one item where autonomy meets self-modification, so it carries the strongest guardrails and is **not** adopted as a default this cycle.

### 3.9 Method-level skill-authoring guidance -- `~` (already skill-native, via the Hub)

The "how to write a good skill" knowledge the optimizer's reflection step would consult is **already skill-native** -- Nexus-Hub ships `skill-description-authoring` (adopted into Nexus as the v1.3.0 skills-audit authoring rule), plus `skill-eval-loop`, `continuous-learning`, `loop-engineering`, `skill-create`, and `skill-stocktake`. These are catalog *content* (agent guidance), not a runtime loop. The clean seam: **Nexus-AI builds the runtime loop (S1-S5); the Hub skills supply the authoring method the reflection step references.** A new Hub touchpoint (a "local skill self-optimization" pattern page cross-linking the runtime loop) is a candidate Hub sync, recorded for the FINAL phase.

---

## 4. Gap Ledger

| ID | Capability | Status in Nexus | Class | Target location |
|---|---|---|---|---|
| S1 | TS-native golden-task **live runner** (execute agent loop vs. snapshot, score trajectory, emit `GoldenTaskResult`) | Partial (criteria + result types + dry-mode harness exist; live runner posts to a deleted backend) | **re-full** | [modules/coding/evaluation/](../../../../modules/coding/evaluation/) + [tests/golden/framework/](../../../../tests/golden/) |
| S2 | Bounded-edit **skill optimizer** (reflect on failing minibatches -> add/delete/replace skill edits under a textual learning-rate budget) | Missing | **re-full** | new `modules/coding/skilloptimizer/` (or `core/skills/`) + `ReflexionEngine`/`CriticAgent` reuse |
| S3 | **Pareto-frontier** candidate management on git branches (GEPA/EvoSkill) | Missing (worktree + GitSafetyNet mechanism exists) | **re-full** | new selector under `modules/coding/skilloptimizer/` + worktree swarm infra |
| S4 | Train/validation/test **split + held-out gate + rejected-edit buffer** | Partial (`RegressionReport` + baselines exist; no split, no buffer) | **re-full** | [tests/golden/](../../../../tests/golden/) split metadata + [core/memory/ArtifactStore.ts](../../../../core/memory/ArtifactStore.ts) buffer |
| S5 | Background self-optimization routine + live-trajectory failure flagging (loop engineering) | Missing (hooks + trace store + worker precedent exist) | **re-full** (demand-gated) | [core/lifecycle/](../../../../core/lifecycle/) hook + a gated background worker |
| S6 | Local A/B "can a small optimizer model produce good edits?" measurement | Partial (Fusion F4 A/B harness exists; not pointed at skill edits) | **re-full** (folded into S2) | reuse the v1.6.0 Fusion F4 A/B harness |
| D1 | Adopt **DSPy / GEPA / EvoSkill / SkillOpt as external frameworks/deps** | Absent by design | **drop** (reverse-engineer instead) | n/a |
| D2 | Hosted / cloud optimizer service (frontier optimizer over outbound calls) | Absent by design | **drop** (future-watch: opt-in BYO-key optimizer) | n/a |

---

## 5. Security and Reverse-Engineering Assessment (MANDATORY)

### 5.1 Threat-model comparison

| Axis | The technique (as published) | Nexus's local realization (S1-S6) |
|---|---|---|
| New runtime deps | DSPy (GEPA), framework code (EvoSkill/SkillOpt), often a cloud optimizer SDK | **None** -- reverse-engineered onto the existing orchestration spine; optimizer is a registry-resident local model |
| Outbound destinations | The optimizer LLM's API (if cloud) | **None** -- local model, local verifier, local `.md` files |
| Credentials required | Cloud optimizer API key (if cloud) | **None** |
| Does source / trajectory / skill text leave the machine? | Yes, if the optimizer is a cloud model (trajectories are voluminous token histories) | **No** -- everything stays on the host |
| New autonomous write surface | The loop edits skill files automatically | **Yes, and this is the principal risk** -- mitigated by held-out gate, rejected-edit buffer, git-branch isolation, human approval (S2/S5), local-compute budget, and `redactSecrets` |
| Untrusted input | The optimizer reads trajectory text it must not be steered by | Treat trajectory text as an **untrusted-input boundary** (reuse the v1.6.0 Fusion **F5** judge-isolation discipline) |

The critical observations: **(1)** every adopted item is local-only and adds no new outbound call, credential, or data processor -- the only item that *would* introduce egress (a cloud frontier optimizer) is exactly D2, dropped; and **(2)** the loop introduces a genuinely new risk class -- *autonomous self-modification of skill files* -- that must be gated harder than any prior Nexus feature.

### 5.2 Per-item risk scorecard

| ID | Risk tier | Rationale |
|---|---|---|
| S1 | Low | Reviving a local task runner; executes the agent loop in worktree-isolated snapshots (same sandbox as the swarm); no new egress. Must enforce per-task timeout + the existing tool-permission tiers inside the runner. |
| S2 | Medium | Generates and applies edits to local skill `.md` files. Mitigation: bounded edit budget, held-out gate, rejected-edit buffer, route edits through `pathGuard`/`ConfirmationGate`/`ActionClassifier`, `redactSecrets` on captured trajectories, and **human approval before any skill file is overwritten** (the loop proposes; the user accepts). |
| S3 | Medium | Spawns candidate git branches via the worktree swarm. Mitigation: `GitSafetyNet`, hard cap on concurrent candidates (mirror the swarm's worker cap + VRAM gate), auto-clean ephemeral worktrees, never auto-merge a winning branch without approval. |
| S4 | Low | Dataset split metadata + a content-addressed rejected-edit buffer (reuses `ArtifactStore`, already redaction-on-write). The only risk is a leaky split (test contamination); enforce a locked test split never shown to the optimizer. |
| S5 | Medium-High | Autonomous background routine that can launch skill edits unattended. Mitigation: **off by default**, explicit opt-in, local-compute budget cap (reuse v0.3.0 runaway prevention), human approval still required before a file is written, all proposals queued for review (never silently applied). |
| S6 | Low | Measurement only (A/B of optimizer-model quality); no new surface, reuses Fusion F4. |
| D1 | Medium | Pulling DSPy / a framework adds a heavy dependency + supply-chain surface for logic we can build leanly; reject per reverse-engineer-first. |
| D2 | High | A cloud frontier optimizer ships trajectories (voluminous, possibly secret-bearing token histories) off-machine + needs an API key + per-token billing -- violates local-first / no-outbound / Zero Tokens Billed. |

### 5.3 Reverse-engineering viability

- **S1, S2, S3, S4, S5, S6** -> `re-full`. Each is fully realizable as a local internal module. The SkillOpt loop (rollout/eval/reflect/bounded-edit/gate), GEPA's genetic-Pareto selector, and EvoSkill's git-branch candidate frontier are **algorithms**, not services; they reverse-engineer onto Nexus's existing `ReflexionEngine`/`CriticAgent`/`DAGExecutor`/worktree-swarm/golden-suite/`RegressionReport`/`ArtifactStore` spine with **no external source attribution carried** and generic Nexus naming (`SkillOptimizer`, `CandidateFrontier`, `RejectedEditBuffer`, etc.).
- **D1 (DSPy / EvoSkill / SkillOpt as deps)** -> `drop-outright` on reverse-engineer-first grounds: the value is the loop logic, which we build locally; importing the framework buys a heavy dependency and external coupling for no on-brand gain.
- **D2 (cloud optimizer service)** -> `vendor-intrinsic` but **dropped** on product-shape grounds (it is the one configuration that requires egress). Reclassifies to a narrow `future`-tier watch only: an explicit, opt-in, per-run bring-your-own-key cloud *optimizer* escape hatch (never a default), parallel to the aisuite D1 watch.

### 5.4 Recommendation ordering (this IS the adoption plan ordering)

1. **skill-native** -- none net-new at runtime; the skill-authoring *method* the reflection step consults is already skill-native (Hub `skill-description-authoring` / `skill-eval-loop` / `loop-engineering`).
2. **re-full** -- **S1** (live runner; unblocks everything) -> **S4** (split + held-out gate + rejected-edit buffer; the regression-safety scaffolding S2 needs) -> **S2** (the SkillOpt bounded-edit loop, with **S6**'s optimizer-quality A/B folded in) -> **S3** (GEPA/EvoSkill Pareto-frontier candidates on git branches) -> **S5** (background loop-engineering routine; demand-gated, off by default).
3. **vendor-intrinsic** -- none adopted (D2 deferred to `future`-watch).
4. **drop-outright** -- D1 (frameworks as deps) and D2's cloud surface move to the NOT-recommended list below.

---

## 6. Adoption Plan (RE-ordered)

A phased plan is written to [plans/adoption-self-optimizing-skills.md](plans/adoption-self-optimizing-skills.md) (consolidated with the opencode comparison's adoptable slivers). Summary sequence (reverse-engineer-first, local-only):

| Phase | Item(s) | Value/Effort | Why this order |
|---|---|---|---|
| 1 | **S1** -- TS-native golden-task live runner | High / Med-High | The article's hard prerequisite; revives a broken-but-scaffolded harness; unblocks every later item; valuable on its own (restores live golden runs) |
| 2 | **S4** -- train/validation/test split + held-out gate + rejected-edit buffer | High / Med | Regression-safety scaffolding the loop cannot be trusted without; small, reuses `RegressionReport` + `ArtifactStore` |
| 3 | **S2 (+ S6)** -- bounded-edit skill optimizer + optimizer-quality A/B | High / High | The headline capability; gated by S1+S4; folds in the "can a small local optimizer write good edits?" measurement before trusting edits |
| 4 | **S3** -- Pareto-frontier candidate management on git branches | Med / High | The evolutionary layer on top of S2's single-file loop; reuses worktree swarm + GitSafetyNet |
| 5 (backlog/demand-gated) | **S5** -- background self-optimization + live-trajectory flagging | Med / High | The loop-engineering frame; highest autonomy risk; off by default, human-approval-gated |

### Conflicts and risks

- **S2 / S5** introduce autonomous editing of skill files -- the single highest-risk surface. Every edit MUST pass the held-out gate, land in the rejected-edit buffer on failure, route through `pathGuard`/`ConfirmationGate`/`ActionClassifier`, and require **human approval before any skill file is overwritten**. The loop proposes; it never silently rewrites the catalog.
- **Optimizer quality is capped by the best local model.** The article's +23.5/+24.8 gains used a frontier optimizer (GPT-5.5). Whether a small resident model produces SkillOpt-quality bounded edits on Nexus coding tasks is **unproven** (`candidate` tier) -- S6's A/B must measure it locally before S2's edits are enabled by default, mirroring the Fusion F4 budget-panel discipline.
- **Test contamination.** S4 must lock a test split the optimizer never sees, or the held-out gate is meaningless (the article's core warning about a "clean, representative held-out evaluation dataset").
- **Untrusted trajectory text.** The optimizer reads voluminous trajectory token histories; treat them as an untrusted-input boundary and reuse the Fusion **F5** judge-isolation + secret-redaction discipline so a malicious tool output cannot steer the optimizer.
- **Runaway compute.** The loop reads large token histories repeatedly; cap it with the v0.3.0 runaway-prevention budget (local cost is VRAM + wall-clock, but it is still finite).

### NOT recommended (dropped, with policy grounds)

- **D1 -- Adopt DSPy / GEPA / EvoSkill / SkillOpt as external frameworks or dependencies.** Reverse-engineer-first: the genetic-Pareto selector, bounded-edit budget, and rejected-edit buffer are algorithms we build leanly onto the existing spine. Importing a framework adds a heavy dependency + supply-chain surface for logic Nexus can own. (S3 IS the reverse-engineered GEPA/EvoSkill; no framework is pulled.)
- **D2 -- Hosted / cloud frontier optimizer.** Ships voluminous trajectories (possibly secret-bearing) off-machine + needs an API key + per-token billing -- a direct conflict with local-first / no-outbound / Zero Tokens Billed. `future`-watch only: an explicit, opt-in, per-run BYO-key cloud-optimizer escape hatch, never a default, parallel to the aisuite D1 watch.

---

## 7. Verification Checklist

- [x] Source type identified (Article / PDF) and full-dimension comparison applied (technique-level)
- [x] Every dimension evaluated for both the technique and Nexus with file-path evidence
- [x] Every gap cites a concrete target location in Nexus
- [x] Priority assignments consistent with the value/effort matrix
- [x] Conflicts with existing conventions flagged (autonomous skill-file edits, optimizer-quality ceiling, test contamination, untrusted trajectory text, runaway compute)
- [x] Items NOT recommended include reasoning (D1 frameworks, D2 cloud optimizer)
- [x] **Step 5 complete** -- threat-model table, per-item risk scorecard, per-item RE classification all present
- [x] **Step 5.4 ordering used** -- skill-native (none net-new) -> re-full (S1, S4, S2+S6, S3, S5) -> vendor-intrinsic (none) -> drops (D1, D2)
- [x] **MCP Registry Policy cited by name** for every item involving an outbound call / API key / new data processor / new dependency (the drop list)

---

## Appendix A -- Technique reference anchors (from the source article)

- **SkillOpt** (Microsoft Research): five-stage loop (Rollout / Evaluation / Reflection / Bounded edits / held-out validation gate), textual learning-rate budget, rejected-edit buffer, epoch-wise slow/meta update; +23.5 (chat) / +24.8 (codex) on GPT-5.5; ~920-token median skills; cross-model/harness generalization.
- **GEPA** (Genetic-Pareto): evolutionary mutation of LLM instructions, Pareto-based candidate selection, DSPy-compatible.
- **EvoSkill**: GEPA for multi-agent coding skills; candidates on separate git branches; Pareto frontier; held-out replacement of the lowest variant.
- **Loop engineering**: control systems with evaluation metrics + memory + exit conditions; background optimization of an agent's own files; live-trajectory failure flagging.

## Appendix B -- Nexus substrate map (evidence anchors)

- Feedback signal: [tests/golden/](../../../../tests/golden/) (24 YAML tasks + declarative `success_criteria` + per-tier baselines + `framework/regression.py`), [modules/coding/evaluation/GoldenTaskSuite.ts](../../../../modules/coding/evaluation/GoldenTaskSuite.ts) (`GoldenTaskResult`, `RegressionReport`), [tests/golden/README.md](../../../../tests/golden/README.md) (the broken-live-runner note).
- Reflection / critic: `ReflexionEngine`, `CriticAgent` under [modules/coding/orchestration/](../../../../modules/coding/orchestration/).
- Candidate isolation: v1.5.0 swarm worktree-isolated git-branch workers + `GitSafetyNet`.
- Regression-safety substrate: per-tier baselines under `tests/golden/baselines/`, the v1.6.0 Fusion **F4** local A/B harness.
- Storage: [core/memory/MemoryHub.ts](../../../../core/memory/MemoryHub.ts), content-addressed redaction-on-write [core/memory/ArtifactStore.ts](../../../../core/memory/ArtifactStore.ts) (v1.6.0 A1).
- Safety: [core/observability/redactSecrets.ts](../../../../core/observability/redactSecrets.ts), `pathGuard`/`ConfirmationGate`/`ActionClassifier`, v0.3.0 runaway-prevention budgets, the Fusion **F5** untrusted-judge-input boundary.
- Skills: [core/skills/SkillCatalog.ts](../../../../core/skills/SkillCatalog.ts), `SkillAuditor`/`SkillSimilarity`/`SkillUsageScanner`/`SkillRenderLine` (v1.3.0), `nexus skills audit`.

## Appendix C -- Confidence notes

Technique findings are at `supported` confidence (direct read of the source article). Nexus "already implemented" findings are at `internal-compatible` confidence -- grounded in the v1.6.0 code map taken for this report, the README/ARCHITECTURE capability tables, the two v1.6.0 plans, and the known-gaps ledger -- not a line-by-line audit of every cited file. The one capability stated at `supported` for *absence* is the broken golden-suite live runner, which [tests/golden/README.md](../../../../tests/golden/README.md) documents directly. Every claim about an unbuilt Nexus optimization loop is stated at `candidate` (the substrate exists and is composable) or `future` (autonomy/quality not yet measured).
