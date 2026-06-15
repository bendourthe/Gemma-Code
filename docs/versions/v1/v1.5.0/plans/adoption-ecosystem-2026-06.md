# Plan -- Local Agent Maturity: adopt the 2026-06 ecosystem scan + close v1.4.0 deferrals + sync Nexus-Hub (v1.5.0)

**Project**: Nexus
**Version**: v1.5.0
**Slug**: adoption-ecosystem-2026-06
**Plan Type**: Feature / Enhancement
**Created**: 2026-06-09
**Goal**: Land the full reverse-engineer-first adoption set from the 2026-06 ecosystem comparison (Buckets 1-4: three local-only items, two skill-native items, two re-full internal builds, and five desktop / model-layer re-partials), close the v1.4.0 P3 deferrals that the swarm-orchestration work naturally subsumes, and finish in lock-step with the latest Nexus-Hub -- with unit / static / integration / e2e / CI testing passing at strong coverage.

**Source comparison**: [../comparison-ecosystem-2026-06.md](../comparison-ecosystem-2026-06.md)

## Goals (goals-first step)

*No `STRATEGY.md` anchor exists; this goal block is seeded from the [README.md](../../../../../README.md) design principles and the source comparison's "Local Agent Maturity" theme. Assumptions are stated explicitly for confirmation.*

- **Target problem**: The mid-2026 ecosystem now treats three things as table stakes for a serious local agent that Nexus does not yet expose: efficiency *visibility* (energy, not just VRAM), credential / inbound-injection *security* (a positive local vault + screening of fetched content), and orchestration *depth* (a real planner/worker layer over the parallel sub-agents Nexus already isolates). The scan also surfaced one clean model-layer win (the Gemma 4 GGUF quant ladder + its native multimodal input) the catalog has not captured.
- **Persona**: the single-user, single-machine power developer Nexus is built for -- running local models on one consumer GPU, no cloud, no per-token billing.
- **Definition of done (observable)**: every Bucket 1-3 adoption item and the planned Bucket 4 re-partials are implemented and tested; the v1.4.0 swarm-related P3 deferrals (`T018.P3.A`, `T018.P3.B`, `T016.P3.A`) are closed by the orchestration work; the Tree-sitter `.wasm` packaging gap (`T022.P3.A`) is closed; the two new skills are published to Nexus-Hub; the whole-plan acceptance gate (Section "Definition of pass") passes.
- **Non-goals (carried from the comparison's drops, never implemented this cycle)**: the Viktor team / SaaS platform, MiniMax M3 as a runtime model, the Surya OCR pillar, Kimi browser automation + finance feed, LAN remote mode, and voice I/O. See the Out-of-Scope appendix.

## Overview

This is the v1.5.0 cycle plan. It is derived from the 2026-06 ecosystem comparison ([../comparison-ecosystem-2026-06.md](../comparison-ecosystem-2026-06.md)), an 8-source scan whose dominant finding was *validation*: six of eight sources confirmed bets Nexus already shipped across v1.0-v1.4 (local-first, desktop + shared-core, hybrid / DCI retrieval, parallel worktree-isolated sub-agents). The adoption set is therefore small and surgical -- nothing here introduces a new outbound call, credential requirement, or third-party processor; every item is either local-only, a skill, or a reverse-engineered internal module, in keeping with the [AGENTS.md](../../../../../AGENTS.md) MCP Registry Policy.

Phase sequencing follows the policy decision tree (reverse-engineer-first), mirroring Section 6.4 of the source comparison: `local-only` ships first (Phase 1), then `skill-native` (Phase 2), then the `re-full` internal builds (Phases 3-4), then the `re-partial` desktop / model-layer work (Phase 5), then the carryforward closure (Phase 6), then the mandated final Nexus-Hub sync + acceptance gate (Phase 7). The `drop-outright` items (N1-N10 in the comparison) are recorded in the Out-of-Scope appendix and never implemented.

Two phases do double duty. Phase 4 (swarm / DAG orchestration over the worktree-isolated sub-agents) is the comparison's largest item (report item 36) and **directly closes three v1.4.0 deferrals**: it live-wires `WorktreeManager` at bootstrap (`T018.P3.A`), builds the planner/critic/worker layer that was explicitly deferred (`T018.P3.B`), and -- because it touches session/bootstrap construction -- live-wires the PreCompact WIP hook the v1.4.0 Phase 8 left attachable-but-inert (`T016.P3.A`). Phase 6 closes the remaining v1.4.0 P3 packaging deferral (`T022.P3.A`, bundling the Tree-sitter grammar `.wasm` into the packaged app).

**Prerequisite note**: this plan assumes the v1.4.0 cycle closes its own final phase (Phase 9, Nexus-Hub sync + acceptance gate, `T032-T035`). If any of the four v1.4.0 Nexus-Hub-dependent carryforward items (`1.1.P2.A`, `1.1.P3.B`, `T017.P3.E`, `T002.P2.A`) remain open at v1.5.0 start, Phase 7 of this plan absorbs them into its Nexus-Hub sync.

**Definition of pass (whole-plan acceptance gate, verified in Phase 7):**
1. All Bucket 1-3 adoption items implemented: Gemma 4 GGUF quant ladder (item 32), local credential vault (item 2), intelligence-per-watt telemetry (item 18), DCI search-discipline skill (item 11), agent presets (item 21), inbound prompt-injection classifier (item 3), swarm / DAG orchestration (item 36).
2. The planned Bucket 4 re-partials implemented: multimodal input via Gemma 4 (item 33), split preview panel (item 24), provider / credential management UI (item 25), cross-surface session resume (item 26). Local cron (item 38) is demand-gated and only built if a concrete need is confirmed.
3. The v1.4.0 deferrals subsumed by this cycle closed: `T018.P3.A`, `T018.P3.B`, `T016.P3.A`, `T022.P3.A`.
4. Nexus-Hub latest updates accounted for and integrated; the two new skills published.
5. Updated testing across unit, static (`nexus-check`), integration, e2e, and CI/CD with strong coverage, all passing.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

No constitution file found at docs/versions/v1/v1.5.0/constitution.md - skipping check. The cycle is nonetheless governed by the [AGENTS.md](../../../../../AGENTS.md) MCP Registry Policy and the [README.md](../../../../../README.md) design principles (local-first, no outbound calls, single-GPU ceiling, internal-commercial-green licensing, originality over wrappers); every phase's Stability Gate enforces them. Recommend running /constitution to formalize these principles.

## Complexity Tracking

| Item | Complexity driver | Mitigation |
|---|---|---|
| Swarm / DAG orchestration (Phase 4) | High: planner/critic/worker composition over concurrent sub-agents | Build on the shipped `A10` worktree primitive; bound dispatch to the GPU scheduler's capacity (queue, not oversubscribe); ship behind an opt-in flag |
| Inbound injection classifier (Phase 3) | Medium: false-positive risk could drop evidence the agent needs | Warn-then-allow default (never hard-block); a review surface; reuse the local model + skill-install scanner pattern |
| Energy telemetry (Phase 1) | Medium: platform power APIs vary (NVML / powermetrics / RAPL) | Degrade to "energy: unavailable" where unsupported; never block a pillar on a missing sensor |
| Multimodal input (Phase 5) | Medium: touches prompt-assembly + model-call boundary | Gate on a per-model vision-capability flag; bounded to vision-capable local models |
| Credential UI (Phase 5) | Medium: must not become a second credential store | UI is a view over the Phase 1 vault only; no config-file credential writes |

## Phases at a Glance

| Phase | Title | Outcome |
|-------|-------|---------|
| 1 | Local-only foundations (items 32, 2, 18) | Gemma 4 GGUF catalog + OS-keychain credential vault + intelligence-per-watt telemetry |
| 2 | Skill-native adoptions (items 11, 21) | DCI / hybrid search-discipline skill + agent presets in Nexus-Hub |
| 3 | Inbound security (item 3) | Prompt-injection classifier screening fetched content, warn-then-allow |
| 4 | Swarm / DAG orchestration (item 36) | Planner/critic/worker layer over worktree-isolated sub-agents; closes `T018.P3.A/B`, `T016.P3.A` |
| 5 | Model-layer & desktop re-partials (items 33, 24, 25, 26, 38) | Multimodal input + split pane + provider/credential UI + cross-surface session resume |
| 6 | Carryforward closure (`T022.P3.A`) | Tree-sitter grammar `.wasm` bundled into the packaged app |
| 7 | FINAL: Nexus-Hub sync + whole-plan acceptance gate | Nexus-Hub integration + definition-of-pass verification |

---

## Phase 1: Local-only foundations

**Goal**: Ship the three Bucket 1 `local-only` items -- zero outbound, zero new heavy dependency.
**Prerequisites**: None.
**Stability Gate**: `npm run test`, `npm run lint`, `npm run check-architecture`, `npm run security:check` clean; no outbound call introduced; the credential vault and energy estimator degrade gracefully where the OS primitive is unavailable.

### Sub-tasks

#### 1.1 -- Item 32: Gemma 4 12B-IT Unsloth GGUF quant ladder in the model catalog

- [ ] T001 Add the gemma-4-12b-it GGUF quant ladder to the ModelRegistry + installer catalog

**Objective**: Adopt report item 32 (`local-only`): capture the specific Unsloth Dynamic-2.0 GGUF quants with per-quant sizing in the model catalog.

**Prompt**:
> Implement report item 32 from [docs/versions/v1/v1.5.0/comparison-ecosystem-2026-06.md](../comparison-ecosystem-2026-06.md). Source: the Unsloth `gemma-4-12b-it-GGUF` model card. Add `gemma-4-12b-it-GGUF` as a ModelRegistry entry and as installer-catalog rows (`scripts/installer/`) with the quant ladder (IQ2_M ~4.21GB, Q3_K, Q4_K_XL ~7.37GB, Q5_K, Q6_K ~10.7GB, BF16 ~23.8GB), each mapped to a Nexus hardware tier by VRAM/disk, runnable via `ollama run hf.co/unsloth/gemma-4-12b-it-GGUF`. Record context window 256K and the native multimodal capability flag (text/image/audio) for Phase 5 consumption. No outbound call at runtime; the installer pulls via Ollama. Acceptance: the model appears in the hardware-aware picker with correct per-quant sizing; a unit test asserts the tier mapping. Effort: Low. Risk: Low.

---

#### 1.2 -- Item 2: Local OS-keychain credential vault

- [ ] T002 [P] Add a local credential vault over the OS keychain in core/security/CredentialVault.ts

**Objective**: Adopt report item 2 (`local-only`): a positive, keychain-backed store for user-supplied MCP / integration secrets, eliminating the plaintext-config threat Viktor (S1) describes.

**Prompt**:
> Implement report item 2. Source: Viktor article (S1) -- the local-first analogue of its backend credential vault. Create `core/security/CredentialVault.ts` backed by the OS keychain (Windows Credential Manager / macOS Keychain / libsecret on Linux via a keytar-class binding), exposing get/set/delete/list scoped per integration. Wire it as the credential source for the MCP registry and any user-wired integration config, so secrets never land in a plaintext config file. Reuse `core/observability/redactSecrets.ts` patterns so vault values never leak into logs/traces. Local-only: no outbound, no network. Degrade with a clear error where no keychain is available (do not fall back to plaintext). Acceptance: unit tests prove round-trip store/retrieve and that values are absent from any emitted log/trace; an integration test proves the MCP registry reads a credential from the vault, not a config file. Effort: Medium. Risk: Low (reduces the secret-exposure surface).

---

#### 1.3 -- Item 18: Intelligence-per-watt telemetry

- [ ] T003 [P] Add an energy / power-draw estimator to core/telemetry/ feeding the Local Model Status panel

**Objective**: Adopt report item 18 (`local-only`): track energy and tokens-per-watt alongside the existing VRAM / utilization / token-cost telemetry (OpenJarvis "Intelligence Per Watt", S4).

**Prompt**:
> Implement report item 18. Source: OpenJarvis (S4). Add an energy estimator under `core/telemetry/` that samples GPU power draw via the platform primitive (NVML on NVIDIA, `powermetrics` on macOS, RAPL on Linux) and derives watts + tokens-per-watt + Joules-per-request, feeding both the Local Model Status panel and `core/observability/TokenCost.ts`. Where no power sensor is available, report `energy: unavailable` and never block a pillar. Local-only; no telemetry export by default (honor the no-telemetry principle). Acceptance: unit tests prove the estimator computes tokens-per-watt from sampled power + token counts and reports `unavailable` on a stubbed missing sensor; the panel surfaces the metric when present. Effort: Medium. Risk: Low.

---

#### 1.4 -- Testing and Stabilization

- [ ] T004 Run and stabilize Phase 1 tests in tests/unit/core/security/, tests/unit/core/telemetry/, and tests/unit/scripts/

**Objective**: Verify the three local-only deliverables; iterate until stable.

**Prompt**:
> Generate comprehensive unit + integration tests for T001 (catalog tier mapping), T002 (vault round-trip + no-leak + MCP-registry read), and T003 (tokens-per-watt + unavailable fallback). Run `npm run test`, `npm run lint`, `npm run check-architecture`, `npm run security:check`; fix all failures and iterate until clean. Confirm no outbound call was introduced. After all tests pass, run /session to document Phase 1.

---

### Phase 1 Exit Checklist

- [ ] All sub-tasks completed
- [ ] All tests passing
- [ ] No known regressions from prior phases
- [ ] No outbound call introduced; security:check in sync
- [ ] Session history generated for this phase
- [ ] Ready to advance to Phase 2

---

## Phase 2: Skill-native adoptions

**Goal**: Ship the two `skill-native` items as Nexus-Hub skills with no runtime code change.
**Prerequisites**: None.
**Stability Gate**: `nexus-check --rule skill-duplicate-name` passes; `npm run check:prompts` clean for the new skills; no `core/` or `modules/` source changed.

### Sub-tasks

#### 2.1 -- Item 11: DCI / hybrid-retrieval search-discipline skill

- [x] T005 Author a direct-corpus-interaction search-discipline skill for the Nexus-Hub catalog

**Objective**: Adopt report item 11 (`skill-native`): codify the DCI search discipline (hypothesis -> refine -> anchor -> lateral-expand -> verify exact constraints) the GrepSeek article (S2) describes, which Nexus has primitives for but does not express as a strategy.

**Prompt**:
> Implement report item 11. Source: the DCI / GrepSeek article (S2). Author a Nexus-Hub skill (e.g. `developer-experience/direct-corpus-interaction`) that teaches the agent the hybrid-retrieval discipline: use semantic retrieval for a broad anchor, then DCI (grep_codebase / codegraph trace-callers-callees / read_file) to expand laterally and verify exact strings, version constraints, and error codes before answering; recognize dead ends and refine the query; do not pre-filter evidence out of the reasoning loop. Reference Nexus's existing `HybridRetriever` (RRF) and code-graph MCP as the substrate. Pure documentation; no code, no deps. Acceptance: the skill validates against the catalog rules and is discoverable. Effort: Low. Risk: None.

---

#### 2.2 -- Item 21: Agent presets

- [x] T006 [P] Author agent-preset bundles (briefing / research / coding) for the Nexus-Hub catalog

**Objective**: Adopt report item 21 (`skill-native`): ready-made preset templates over existing skills/commands (OpenJarvis presets, S4).

**Prompt**:
> Implement report item 21. Source: OpenJarvis (S4) agent presets. Author a small set of agent-preset bundles (e.g. morning-briefing, research, coding-assistant) as Nexus-Hub skill/command compositions that wire existing skills + slash commands into a one-invocation preset. Local-only; no new tools. Acceptance: each preset validates against the catalog rules and runs end-to-end against existing skills/commands. Effort: Low. Risk: Low.

---

#### 2.3 -- Testing and Stabilization

- [x] T007 Run and stabilize Phase 2 skill checks

**Objective**: Verify the skills are conformant and discoverable.

**Prompt**:
> Validate Phase 2: run `node bin/nexus-check.mjs --rule skill-duplicate-name` and `npm run check:prompts`; if the skills land in the Nexus-Hub catalog, run `python scripts/validate_skills.py` against them. Confirm no `core/` or `modules/` source changed. Fix all failures and iterate until clean. After all checks pass, run /session to document Phase 2.

---

### Phase 2 Exit Checklist

- [x] All sub-tasks completed
- [x] All checks passing
- [x] No `core/` or `modules/` change
- [x] Session history generated for this phase
- [x] Ready to advance to Phase 3

---

## Phase 3: Inbound security

**Goal**: Adopt the inbound prompt-injection classifier (report item 3, `re-full`).
**Prerequisites**: None (the local model is already available).
**Stability Gate**: `npm run test`, `npm run lint`, `npm run check-architecture` clean; the classifier defaults to warn-then-allow and never silently drops fetched content.

### Sub-tasks

#### 3.1 -- Item 3: Inbound prompt-injection classifier

- [x] T008 Add an inbound untrusted-content classifier gate in modules/coding/security/InboundClassifier.ts

**Objective**: Adopt report item 3 (`re-full`): screen fetched web content for indirect prompt injection before the agent reasons over it (the Promptfoo-style attack Viktor, S1, cites).

**Prompt**:
> Implement report item 3. Source: Viktor (S1) -- untrusted-data classifier. Create `modules/coding/security/InboundClassifier.ts` that screens content returned by `fetch_page` (and other inbound external-data tools) for indirect prompt-injection markers before it enters the agent's context, reusing the local model and the existing skill-install prompt-injection scanner pattern. Default behavior is WARN-THEN-ALLOW with a review surface: a flagged document is annotated and surfaced, never hard-blocked or silently dropped (honor S2's "do not pre-filter what the agent sees"). Make the gate toggleable via setting (default on). No outbound call. Acceptance: unit tests prove a known injection payload is flagged-and-annotated while benign content passes unchanged; an integration test proves `fetch_page` output routes through the gate. Effort: Medium. Risk: Medium (false positives) -- mitigated by warn-then-allow.

---

#### 3.2 -- Testing and Stabilization

- [x] T009 Run and stabilize Phase 3 tests in tests/unit/modules/coding/security/

**Objective**: Verify the classifier and its fetch_page wiring; iterate until stable.

**Prompt**:
> Generate comprehensive unit + integration tests for the inbound classifier (flag-and-annotate on injection payloads, pass-through on benign content, fetch_page routing). Run `npm run test`, `npm run lint`, `npm run check-architecture`; fix all failures and iterate until clean. After all tests pass, run /session to document Phase 3.

---

### Phase 3 Exit Checklist

- [x] All sub-tasks completed
- [x] All tests passing
- [x] Warn-then-allow default verified (no silent drop)
- [x] Session history generated for this phase
- [x] Ready to advance to Phase 4

---

## Phase 4: Swarm / DAG orchestration

**Goal**: Adopt report item 36 (`re-full`): a planner/critic/worker orchestration layer over the worktree-isolated sub-agents, GPU-concurrency bounded -- and close the three v1.4.0 deferrals this work subsumes.
**Prerequisites**: v1.4.0 `A10` worktree isolation (shipped); the session `HookBus` at bootstrap (shipped in v1.4.0 Phase 8).
**Stability Gate**: `npm run test`, `npm run lint`, `npm run check-architecture` clean; a production-path integration test proves real dispatched sub-agents are isolated and do not oversubscribe the GPU scheduler; gaps `T018.P3.A`, `T018.P3.B`, `T016.P3.A` move to Resolved.

### Sub-tasks

#### 4.1 -- Live-wire worktree isolation at bootstrap (closes T018.P3.A)

- [x] T010 Wire setWorktreeManager at session bootstrap and enable isolate for parallel write-capable DAG nodes

**Objective**: Close v1.4.0 `T018.P3.A` [from v1.4.0 known-gaps]: move worktree isolation from attachable-but-unwired to live in the runtime dispatch path.

**Prompt**:
> Close v1.4.0 deferral `T018.P3.A` (see [docs/versions/v1/v1.4.0/known-gaps.md](../../v1.4.0/known-gaps.md)). Call `setWorktreeManager(new WorktreeManager(workspaceRoot))` at session/bootstrap construction, and have the `DAGExecutor` dispatch path set `isolate: true` for concurrently-dispatched write-capable nodes. Add a production-path integration test showing real dispatched sub-agents run in isolated worktrees with no collision and the worktree is removed when unchanged. Acceptance (raises `T018.P3.A` candidate->supported): the production-path test passes. Effort: Medium. Risk: Medium.

---

#### 4.2 -- Planner/critic/worker orchestration layer (closes T018.P3.B)

- [x] T011 Build the bounded planner/critic/worker orchestration layer over src/agents/

**Objective**: Adopt report item 36 and close v1.4.0 `T018.P3.B` [from v1.4.0 known-gaps] team-orchestration half: a real multi-agent composition layer, GPU-bounded.

**Prompt**:
> Implement report item 36 and close the team-orchestration half of `T018.P3.B`. Source: Kimi "Agent Swarm" (S8) + Viktor multi-agent (S1). Build a planner/critic/worker orchestration layer over `src/agents/` (`DAGExecutor` + `WorktreeManager`): a planner decomposes a task into a DAG of worker sub-agents, workers run isolated (T010), and a critic reviews worker output before merge. CRITICAL constraint per the comparison Section 9.1: bound concurrent dispatch to the GPU scheduler's serving capacity -- extra workers QUEUE, they do not oversubscribe token generation; the worker count is a scheduling abstraction, never a literal 300-worker target (comparison N4). Ship behind an opt-in flag, default off. Acceptance: an integration test proves a multi-worker plan runs isolated, the critic gates merge, and dispatch never exceeds the scheduler capacity. Effort: High. Risk: Medium.

---

#### 4.3 -- Read-tool worktree rooting (closes T018.P3.B read-tool half)

- [x] T012 [P] Thread the pathGuard root override through the read tools for write-then-read parity in a worktree

**Objective**: Close the read-tool half of v1.4.0 `T018.P3.B` [from v1.4.0 known-gaps]: let read tools observe in-worktree writes.

**Prompt**:
> Close the read-tool half of `T018.P3.B`. Thread the `pathGuard` `root` override (added in v1.4.0 Phase 6 for `run_terminal`) through the read tools (`read_file` / `list_directory` / `grep_codebase`) so a write-then-read of the same file within one isolated worktree run observes the in-worktree write. Keep the change additive and safety-preserving (do not weaken the module-level path-guard for non-isolated runs). Acceptance: an integration test proves a worker that writes then reads the same file inside its worktree sees its own write. Effort: Medium. Risk: Low.

---

#### 4.4 -- Live-wire the PreCompact WIP hook (closes T016.P3.A)

- [x] T013 [P] Attach attachPreCompactWipHook at session construction and emit the PreCompact event on the production path

**Objective**: Close v1.4.0 `T016.P3.A` [from v1.4.0 known-gaps]: the A8 PreCompact hook ships attachable but inert because no production code emits `lifecycle.context.preCompact` on the bootstrap bus.

**Prompt**:
> Close v1.4.0 deferral `T016.P3.A` (see [docs/versions/v1/v1.4.0/known-gaps.md](../../v1.4.0/known-gaps.md)). Now that this phase touches session/bootstrap construction (T010), attach `attachPreCompactWipHook(hookBus)` alongside the already-wired `attachSessionReflectionHook`, and emit `lifecycle.context.preCompact` on that bus at the real compaction boundary so the hook fires (detect uncommitted edits + in-flight tasks, persist the checkpoint, warn non-blocking). Acceptance (raises `T016.P3.A` candidate->supported): an integration test proves the warning fires and the checkpoint persists on a real compaction without blocking it. Effort: Low-Medium. Risk: Low.

---

#### 4.5 -- Testing and Stabilization

- [x] T014 Run and stabilize Phase 4 tests in tests/integration/agents/

**Objective**: Verify orchestration + the three closures; iterate until stable.

**Prompt**:
> Run the full suite plus the new production-path integration tests (T010 isolated dispatch, T011 multi-worker + critic + scheduler bound, T012 write-then-read parity, T013 PreCompact fires). Run `npm run test`, `npm run lint`, `npm run check-architecture`; fix all failures and iterate until clean. Confirm `T018.P3.A`, `T018.P3.B`, `T016.P3.A` are eligible to move to Resolved in the v1.5.0 known-gaps. After all tests pass, run /session to document Phase 4.

---

### Phase 4 Exit Checklist

- [x] All sub-tasks completed
- [x] All tests passing (incl. production-path isolation + scheduler-bound proof)
- [x] `T018.P3.A`, `T018.P3.B`, `T016.P3.A` closed
- [x] Session history generated for this phase
- [x] Ready to advance to Phase 5

---

## Phase 5: Model-layer & desktop re-partials

**Goal**: Ship the Bucket 4 `re-partial` items: multimodal input (item 33), split preview panel (item 24), provider / credential management UI (item 25), cross-surface session resume (item 26). Local cron (item 38) is demand-gated.
**Prerequisites**: Phase 1 (the GGUF catalog gates item 33; the credential vault gates item 25's credential half).
**Stability Gate**: `npm run test`, `npm run test:shell`, `npm run lint`, `npm run lint:shell` clean; the credential UI writes credentials only through the Phase 1 vault.

### Sub-tasks

#### 5.1 -- Item 33: Multimodal input via Gemma 4

- [x] T015 Wire image/audio input through the Chat/Coding prompt-assembly + model call for vision-capable models

**Objective**: Adopt report item 33 (`re-partial`): let the Chat/Coding pillars read an image/screenshot/audio clip using Gemma 4's native multimodality.

**Prompt**:
> Implement report item 33. Source: Gemma 4 12B native multimodality (S7). Wire image/audio input through the Chat/Coding prompt-assembly and model-call path, gated on the per-model vision-capability flag recorded in T001. Bounded to vision-capable local models; text-only models are unaffected. Acceptance: a unit/integration test proves an image input is passed to a vision-capable model and a text-only model rejects/ignores it cleanly. Effort: Medium. Risk: Medium.

---

#### 5.2 -- Item 24: Side-by-side preview panel

- [x] T016 [P] Add a split preview pane in desktop/src/ reusing the interactive-artifact renderer

**Objective**: Adopt report item 24 (`re-partial`): render web/files/tool outputs beside chat (Hermes Desktop, S5).

**Prompt**:
> Implement report item 24. Source: Hermes Desktop (S5) preview panel. Add a side-by-side preview pane under `desktop/src/` that renders web pages / files / tool outputs alongside the chat, reusing the existing `InteractiveArtifact` renderer. UI only; no new outbound deps. Acceptance: a desktop test proves the pane renders a sample artifact beside an active chat. Effort: Low. Risk: Low.

---

#### 5.3 -- Item 25: Provider / model / tool / credential management UI

- [x] T017 Add a provider/model/tool/credential management settings surface in desktop/src/

**Objective**: Adopt report item 25 (`re-partial`): manage models/tools/credentials from the UI instead of editing config (Hermes Desktop, S5). The credential half is a VIEW over the Phase 1 vault.

**Prompt**:
> Implement report item 25. Source: Hermes Desktop (S5) management UI. Add a settings surface under `desktop/src/` to manage local models, tools, and credentials. CRITICAL per comparison Section 9.1: the credential half is a view over the Phase 1 `CredentialVault` (OS keychain) ONLY -- it must never write a credential to a config file or create a second store. Acceptance: a desktop test proves a credential set via the UI lands in the vault (keychain) and not in any config file. Effort: Medium. Risk: Medium. Depends on T002.

---

#### 5.4 -- Item 26: Cross-surface session resume

- [x] T018 [P] Add a CLI<->desktop session-resume handshake in the sidecar

**Objective**: Adopt report item 26 (`re-partial`): resume a session started in one surface from another (Hermes Desktop, S5).

**Prompt**:
> Implement report item 26. Source: Hermes Desktop (S5) session portability. Add a session-state handshake in the Node sidecar shared by the CLI and the VS Code adapter so a session started in the CLI resumes in the desktop and vice versa, building on the existing session-replay state. Correctness-sensitive: define and test the shared session-state contract. Acceptance: an integration test proves a session created via the CLI path resumes with intact history/state via the desktop path. Effort: Medium. Risk: Medium.

---

#### 5.5 -- Item 38: Local cron scheduler (demand-gated)

- [x] T019 [P] (DEMAND-GATED) Add a local-only cron scheduler over the agent loop, or record the deferral -- DEFERRED (no confirmed demand this cycle; recorded as P3 `T019.P3.A` in known-gaps)

**Objective**: Adopt report item 38 (`re-partial`, borderline): a local scheduler for recurring agent tasks (Kimi, S8). Build ONLY if a concrete need is confirmed.

**Prompt**:
> Report item 38 is demand-gated. If a concrete recurring-task need is confirmed for this cycle, add a LOCAL-ONLY cron scheduler over the agent loop: no network triggers, explicit per-job consent, jobs persisted locally -- respecting the "the autonomy unit is the session" stance by treating scheduled runs as explicit, consented sessions. Otherwise, record this as a P3 deferral in the v1.5.0 known-gaps with rationale (no confirmed demand) and do not build it. Acceptance: either the scheduler ships with local-only + per-job-consent tests, or the deferral is recorded. Effort: Medium. Risk: Medium.

---

#### 5.6 -- Testing and Stabilization

- [x] T020 Run and stabilize Phase 5 tests in tests/ and desktop/

**Objective**: Verify the re-partials; iterate until stable.

**Prompt**:
> Generate/run tests for T015-T018 (and T019 if built). Run `npm run test`, `npm run test:shell`, `npm run lint`, `npm run lint:shell`, `npm run check-architecture`; fix all failures and iterate until clean. Verify the credential UI writes only through the vault. After all tests pass, run /session to document Phase 5.

---

### Phase 5 Exit Checklist

- [x] All sub-tasks completed (T019 built or deferral recorded)
- [x] All tests passing (root + shell)
- [x] Credential UI verified vault-only
- [x] Session history generated for this phase
- [x] Ready to advance to Phase 6

---

## Phase 6: Carryforward closure

**Goal**: Close the remaining v1.4.0 P3 packaging deferral not subsumed by Phase 4.
**Prerequisites**: None.
**Stability Gate**: `npm run test`, `npm run build:shell`, `npm run build:sidecar` clean; a packaged-app test proves Tree-sitter is ready post-activation.

### Sub-tasks

#### 6.1 -- Close T022.P3.A: bundle Tree-sitter grammar .wasm into the packaged app

- [ ] T021 Bundle the grammar + runtime .wasm into the VSIX / sidecar and add a warm-up

**Objective**: Close v1.4.0 `T022.P3.A` [from v1.4.0 known-gaps]: a packaged install currently falls back to the regex extractor because the Tree-sitter `.wasm` files are not bundled.

**Prompt**:
> Close v1.4.0 deferral `T022.P3.A` (see [docs/versions/v1/v1.4.0/known-gaps.md](../../v1.4.0/known-gaps.md)). Add the grammar `.wasm` (`tree-sitter-wasms/out/*.wasm`) and the `web-tree-sitter` runtime `.wasm` to the VSIX `files` / the esbuild sidecar copy step, and add a sidecar `initTreeSitter()` warm-up at activation. Acceptance (raises `T022.P3.A` candidate->supported): a packaged-app integration test asserts `isTreeSitterReady()` is true after activation (no regex fallback in the packaged build). Effort: Low-Medium. Risk: Low.

---

#### 6.2 -- Testing and Stabilization

- [ ] T022 Run and stabilize Phase 6 tests + packaged-app check

**Objective**: Verify the packaging closure; iterate until stable.

**Prompt**:
> Run the full suite plus the packaged-app Tree-sitter readiness test. Run `npm run test`, `npm run build:shell`, `npm run build:sidecar`; fix all failures and iterate until clean. Confirm `T022.P3.A` is eligible to move to Resolved. After all tests pass, run /session to document Phase 6.

---

### Phase 6 Exit Checklist

- [ ] All sub-tasks completed
- [ ] All tests passing (incl. packaged-app readiness)
- [ ] `T022.P3.A` closed
- [ ] Session history generated for this phase
- [ ] Ready to advance to Phase 7

---

## Phase 7: FINAL -- Nexus-Hub sync + whole-plan acceptance gate

**Goal**: Bring Nexus-AI in sync with the latest Nexus-Hub, publish the two new skills, absorb any still-open Nexus-Hub-dependent v1.4.0 carryforward, and verify the whole-plan Definition of pass.
**Prerequisites**: Phases 1-6 complete.
**Stability Gate**: the Definition of pass (above) is fully satisfied; full suite + desktop suite green; `check:audit-prod` 0 high/critical; `tsc -b`, `check-architecture`, `lint`, `check:tampering`, `security:check` all clean.

### Sub-tasks

#### 7.1 -- Nexus-Hub sync + publish the new skills

- [ ] T023 Inspect the latest Nexus-Hub and publish the DCI + agent-preset skills; integrate any new Hub functionality

**Objective**: Mandated final-phase Nexus-Hub lock-step: ensure every Nexus-Hub functionality is integrated or accounted for, and the two new skills (T005, T006) are published to the catalog.

**Prompt**:
> Inspect the Nexus-Hub repository at its latest version and features. Publish the Phase 2 skills (direct-corpus-interaction T005, agent presets T006) into the catalog with attribution, validating via `python scripts/validate_skills.py`. Ensure every new Nexus-Hub functionality is integrated into Nexus-AI or explicitly accounted for (Nexus consumes the catalog via `nexus skills sync`). Absorb any still-open Nexus-Hub-dependent v1.4.0 carryforward (`1.1.P2.A`, `1.1.P3.B`, `T017.P3.E`, `T002.P2.A`) if they remain open after the v1.4.0 Phase 9 close. Acceptance: `nexus skills sync` reflects the new skills; no Hub functionality is unaccounted for. Effort: Medium. Risk: Low.

---

#### 7.2 -- Whole-plan acceptance gate

- [ ] T024 Verify the Definition of pass and run the full acceptance gate

**Objective**: Verify every cycle deliverable against the Definition of pass.

**Prompt**:
> Run the whole-plan acceptance gate. Verify: (1) all Bucket 1-3 items (32, 2, 18, 11, 21, 3, 36) implemented; (2) the planned Bucket 4 re-partials (33, 24, 25, 26) implemented and item 38 built-or-deferred; (3) the closed v1.4.0 deferrals (`T018.P3.A`, `T018.P3.B`, `T016.P3.A`, `T022.P3.A`) verified Resolved; (4) Nexus-Hub in sync; (5) full suite + desktop suite green, `check:audit-prod` 0 high/critical, `tsc -b` / `check-architecture` / `lint` / `check:tampering` / `security:check` all clean. Recompute the v1.5.0 known-gaps Summary. Fix any failure and iterate until the gate passes. After the gate passes, run /update release to prepare v1.5.0. 

---

### Phase 7 Exit Checklist

- [ ] All sub-tasks completed
- [ ] Definition of pass fully satisfied
- [ ] Nexus-Hub in sync; new skills published
- [ ] Full + desktop suites green; all gates clean
- [ ] Session history generated for this phase
- [ ] v1.5.0 ready for release

---

## Out-of-Scope (dropped per the comparison; never implemented this cycle)

These map to the comparison's Section 9.4 rejections. They are recorded here so no phase implements them.

| ID | Item | Source | Rejection reason |
|---|---|---|---|
| N1 | Viktor team platform (team workspace, 3,000 SaaS integrations, Slack orchestration, per-user isolation, cloud vault) | S1 | Conflicts with single-user single-machine + no-outbound. `drop-outright`. |
| N2 | MiniMax M3 as a runtime model (1M context, frontier scale, MSA, API) | S3 | Above the single-GPU ceiling; API violates no-outbound; future-watch only if a small permissive open quant ships. Out of scope. |
| N3 | Surya OCR + a document pillar | S6 | No document/OCR pillar; modified RAIL-M weights license conflicts with internal-commercial-green. `drop-outright` + license-incompatible. |
| N4 | Kimi "300 parallel workers" as a literal target | S8 | Single GPU cannot run 300 concurrent LLM workers; the bounded swarm (T011) is the adopted form. Not adopted literally. |
| N5 | Kimi browser automation (WebBridge) | S8 | Large outbound surface beyond guarded `fetch_page`. Out of scope / `drop`. |
| N6 | Kimi finance / market-data feed | S8 | Data-as-service over the network; hard-no per policy. `drop-outright`. |
| N7 | GrepSeek RL-trained corpus-search model | S2 | Nexus runs pretrained local models; the behavior is captured as a skill (T005). Out of scope. |
| N8 | Voice I/O (Hermes) | S5 | Not a current pillar concern; local STT/TTS only if ever added. Defer. |
| N9 | LAN remote mode (Hermes) | S5 | Network surface vs. no-outbound default; LAN-only + authenticated + opt-in only, and no concrete demand. Defer. |
| N10 | Sharded-parallel raw-grep engine (GrepSeek) | S2 | The FTS5 code-graph index already solves it; building it would duplicate capability. Covered / not built. |

---

## Notes

- This plan was generated by `/plan from-comparison` from [../comparison-ecosystem-2026-06.md](../comparison-ecosystem-2026-06.md), RE-first ordered per the [AGENTS.md](../../../../../AGENTS.md) MCP Registry Policy.
- Task lines follow the strict `T### [P]` format; `[P]` marks tasks safe to parallelize within their phase.
- No code was written by the planning step; this file is the plan only.
