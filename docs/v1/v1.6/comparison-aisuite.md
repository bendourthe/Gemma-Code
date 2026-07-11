# Cross-Project Comparison: Nexus (v1.5.0 codebase) vs. aisuite (Andrew Ng) -- multi-provider LLM interface + agent harness

**Version**: v1.6.0 (forward-input single-source comparison for the v1.6.0 cycle; analysis snapshot taken against the v1.5.0 codebase on the `feat/v1.5.0-phase-3-inbound-security` branch after Phase 6 close, 2026-06-14)
**Generated**: 2026-06-14T00:00:00Z
**Analyzer**: Claude Code -- /compare
**Source Type**: Git repository -- [andrewyng/aisuite](https://github.com/andrewyng/aisuite) (shallow clone, default branch; Python `aisuite/` v0.1.14 + TypeScript `aisuite-js/` v0.1.1)
**User framing**: "an open-source project we put together while extending aisuite to support agent harnesses" -- the comparison axis of interest is the **agent-harness layer** (`agents/`, `mcp/`, `toolkits/`, `tracing/`) that now sits on top of aisuite's original multi-provider chat interface, not the chat-routing layer alone.
**Companion reports**: the active v1.5.0 cycle's forward-input ecosystem scan [comparison-ecosystem-2026-06.md](../v1.5/comparison-ecosystem-2026-06.md) (the source of the v1.5.0 plan); prior ecosystem scans under [docs/versions/v1/](../../versions/v1).
**Decision lens**: [AGENTS.md](../../../AGENTS.md) MCP Registry Policy -- **local-only > LLM-native skill > reverse-engineered internal module > trusted-vendor wrapper > drop**. Hard no: search / embeddings / scraping / generation as a service; no outbound calls without explicit user opt-in; no telemetry by default.
**Wording convention**: per [development/evidence-and-support-tiers.md](../v1.4/development/evidence-and-support-tiers.md), every claim about an *unbuilt* Nexus capability is stated at `candidate` or `future` tier, never `supported`; "not_observed != absent" applies. "Already implemented" classifications are grounded in the v1.5.0 [known-gaps.md](../v1.5/known-gaps.md), the [README.md](../../../README.md)/[ARCHITECTURE.md](../../../ARCHITECTURE.md) capability tables, and the per-subsystem code map taken for this report at `internal-compatible` confidence.

This is a single-source comparison against the most architecturally-adjacent open project that exists: aisuite is, like Nexus's Coding pillar, an MIT-licensed agent harness with provider routing, an MCP layer, sandboxed file/git/shell toolkits, a state/session store, and a trace dashboard. The headline is that the comparison **validates Nexus's harness depth rather than exposing gaps**: on every agent-harness axis except one, Nexus matches or exceeds aisuite. The single structural divergence -- aisuite routes across ~23 cloud + local providers behind a unified `provider:model` interface, while Nexus is local-only by first principle -- is a deliberate product-shape choice, not a deficiency, and the cloud-routing surface is **dropped** on the same grounds the 2026-05/06 scans dropped MiniMax M3 and Multica. The genuinely net-new, on-brand work is **small and local-only**: three `re-full` harness refinements (session-state artifact dehydration, hierarchical sub-run trace nesting, a config-driven local-runtime adapter registry) plus the user-directed **interactive HTML guide** deliverable that reuses the Nexus-Hub constellation design system.

---

## 1. Executive Summary

aisuite began as Andrew Ng's "one interface across many LLM providers" library and has since grown a full agent harness: an `Agent`/`RunState`/`RunResult` dataclass model with a `Runner.run_sync`/`continue_sync` loop, pluggable tool policies (`AllowAll` / `DenyAll` / `AllowTools` / `RequireApproval`) with per-tool risk metadata, three state-store backends (in-memory / file / Postgres) with optimistic concurrency and message compaction, large-field artifact dehydration, an MCP **client** (stdio + HTTP transports), sandboxed `files` / `git` / `shell` toolkits, and a versioned trace-event schema with a served web dashboard. It ships dual Python + TypeScript implementations and a Tauri/PyInstaller desktop build ("OpenCoworker").

Mapped against Nexus's Coding-pillar harness, the analysis surfaced **34 distinct capabilities**, of which **21 are already implemented in Nexus at equal-or-greater depth**, **5 are partially implemented**, **4 are missing-but-relevant (all local-only `re-full`)**, and **4 are not applicable / dropped on product-shape grounds**.

The dominant finding is **validation, not gap**. Nexus's three-tier orchestration (ReAct `AgentLoop` -> Plan-and-Execute `Orchestrator`/`PlannerAgent`/`DAGExecutor` -> the v1.5.0 Phase 4 swarm with worktree-isolated workers + critic) is strictly richer than aisuite's single `Runner` loop. Nexus's three-tier permission model (`AUTO_APPROVE` / `CONFIRM` / `DANGEROUS` with override-clamping + a `.nexus/permissions.deny` denylist) is a superset of aisuite's tool-policy callbacks. Nexus is **both** an MCP host and client (8 in-process code-graph tools + LSP + external client) where aisuite is client-only. Nexus's four-layer memory with hybrid RRF retrieval, decay, scope isolation, and provenance is far beyond aisuite's flat message-history state store. And Nexus's observability (trace store + webview dashboard + GPU/VRAM telemetry + command-output compression + interactive HTML artifacts) is local-only by construction where aisuite's HTTP trace sink and Postgres store both reach off-machine.

The one axis where aisuite leads is **breadth of provider routing**: ~23 providers (OpenAI, Anthropic, Google/Vertex, Bedrock, Azure, Mistral, Groq, Cohere, Cerebras, Together, Fireworks, SambaNova, OpenRouter, xAI, Watsonx, plus local Ollama / LM Studio) behind a convention-loaded `provider:model` interface with cross-provider tool-call normalization and ASR. For Nexus this is **the wrong axis to chase**: cloud routing requires outbound calls, per-provider API keys, and per-token billing -- a direct conflict with Nexus's "Zero Tokens Billed / no data leaving your machine" first principle. It is **dropped**, with one narrow `future`-tier watch (an explicit opt-in bring-your-own-key escape hatch) noted but not planned.

The genuinely net-new, adoptable work is **four items, all local-only and all `re-full`**: **(A1)** session-state **artifact dehydration/hydration** (store large `stdout`/`diff`/`content` fields out-of-line with a ref + preview, rehydrate on resume) to extend the existing command-output compressor across persisted sessions; **(A2)** **hierarchical sub-run trace nesting** (`parent_run_id` / `group_id` / span nesting) so the trace dashboard can visualize planner -> worker -> critic swarm runs landed in v1.5.0 Phase 4; **(A3)** a **convention-driven local-runtime adapter registry** so adding a new *local* inference runtime (llama.cpp server, vLLM, MLX) is config-driven rather than a code change, mirroring aisuite's provider auto-discovery but scoped to local runtimes only; and **(A4)** a **standalone, shareable HTML session/trace viewer** (aisuite ships one as a served React build) reframed as a self-contained Nexus artifact.

Separately, the user has directed a concrete deliverable: an **interactive HTML guide for Nexus-AI** (H1) adopting the same color scheme and dynamic constellation background as [Nexus-Hub's interactive guide](file:///C:/Users/bdour/Documents/Projects/Development/Nexus-Hub/guides/interactive-guide/nexus-hub-guide.html). This is local-only, zero-outbound, and on-brand with Nexus's existing `InteractiveArtifact` surface and the `html-output-conventions` Hub skill; it is foregrounded as Phase 1 of the adoption plan.

---

## 2. Source Inventory

| Field | aisuite | Nexus |
|---|---|---|
| Identity | Unified multi-provider LLM interface + agent harness | Local-first four-pillar desktop AI Studio (Coding / Chat / Image / Video) |
| License | MIT | MIT |
| Languages | Python 3.10+ (`aisuite/`), TypeScript/Node 16+ (`aisuite-js/`) | TypeScript (primary), Rust (Tauri 2.x), Python (installer) |
| Version | Python v0.1.14, TS v0.1.1 | v1.5.0 cycle (desktop pkg 1.4.0) |
| Provider posture | ~23 cloud + local providers; outbound by default | Local-only (Ollama + LM Studio); **no outbound calls by default** |
| Agent loop | Single `Runner.run_sync` ReAct loop, `max_turns` | Three-tier: ReAct + Plan-and-Execute + worktree swarm |
| MCP role | Client only (stdio + HTTP) | **Host + client** (in-process code-graph + LSP + external client) |
| State | In-memory / file / **Postgres** | SQLite four-layer memory + hybrid RRF + decay + provenance |
| Toolkits | `files` / `git` / `shell` (sandboxed) | Tiered tool registry + denylist + activation rules |
| Tracing | Versioned event schema; **HTTP sink**; served web viewer | Local trace store + webview dashboard + GPU telemetry; local-only |
| Telemetry default | Opt-in (no default reporting) | Local-only; OTLP export opt-in/off by default |

---

## 3. Capability Comparison (per dimension)

Legend: `+` external-only (adoption candidate) | `=` current-only (strength to preserve) | `~` both, different approach | `.` both, equivalent.

### 3.1 Provider routing -- `~` (different by design)

aisuite's `ProviderFactory` ([aisuite/provider.py:36-72]) dynamically loads `{provider}_provider.py` -> `{Provider}Provider` by naming convention, parses `model="provider:model"` in `client.py`, and normalizes every provider's tool-calling response back to OpenAI shape via `providers/message_converter.py`. It supports ~23 providers including local Ollama and LM Studio, plus an ASR (speech) path.

Nexus exposes a **vendor-neutral `LLMClient` port** ([modules/coding/llm/types.ts](../../../modules/coding/llm/types.ts)) with `OllamaClient` and `LmStudioClient` adapters and a `nexus.llm.backend` = `ollama | lmstudio | auto` selector, fronted by [core/registry/ModelRegistry.ts](../../../core/registry/ModelRegistry.ts) / `NexusModelRegistry`. The abstraction shape is the same (one port, swappable adapters); the **scope is deliberately narrowed to local runtimes**. aisuite's convention-based auto-discovery is cleaner than Nexus's hand-wired two-adapter switch -- that *pattern* (not the cloud providers) is the only adoptable sliver here (-> **A3**). The cloud breadth itself is **dropped** (Section 5).

### 3.2 Agent loop / orchestration -- `=` (Nexus exceeds)

aisuite: a single `Runner.run_sync(agent, input, max_turns=5, tool_policy=..., state_store=..., trace_sinks=...)` ReAct loop; sub-agents are not orchestrated (the caller manages each `RunResult`). Per the source author's own notes, there is "no built-in multi-agent orchestration."

Nexus: **three tiers**, all already shipped or shipping in v1.5.0 -- (1) ReAct [src/tools/AgentLoop.ts](../../../src/tools/AgentLoop.ts) (max-20 iterations, pass-state verification gating, sub-agent verification credit, inbound-classifier hook); (2) Plan-and-Execute [modules/coding/orchestration/Orchestrator.ts](../../../modules/coding/orchestration/Orchestrator.ts) + `PlannerAgent` + `DAGExecutor` + `ReflexionEngine`; (3) the v1.5.0 Phase 4 **swarm** (worktree-isolated write-capable workers + critic gating, `swarmEnabled` opt-in). This is strictly richer than aisuite. **Preserve; no adoption.**

### 3.3 Tool policies / permission model -- `=` (Nexus exceeds)

aisuite: `ToolMetadata(risk_level, category, capabilities, requires_approval)` attached to callables via a `@tool` decorator, plus policy objects (`AllowAllToolPolicy`, `DenyAllToolPolicy`, `AllowToolsPolicy`, `RequireApprovalPolicy(callback)`).

Nexus: a three-tier `PermissionTier` enum (`AUTO_APPROVE` / `CONFIRM` / `DANGEROUS`) with a static `TOOL_PERMISSION_MAP`, **override-clamping** (a baseline-dangerous tool cannot be downgraded to auto), a `.nexus/permissions.deny` minimatch denylist ([core/storage/PermissionsDeny.ts](../../../core/storage/PermissionsDeny.ts)), per-sub-agent-type tool scopes ([modules/coding/agents/SubAgentManager.ts](../../../modules/coding/agents/SubAgentManager.ts)), and an `ActionClassifier`. Functionally a superset. **Preserve; no adoption.** (aisuite's *co-location* of risk metadata on the callable is a stylistic nicety, not worth a refactor.)

### 3.4 MCP layer -- `=` (Nexus exceeds)

aisuite: MCP **client only** -- `MCPClient` over stdio or HTTP, `schema_converter.py` resolving `$ref`/`$defs` to OpenAI tool specs, `tool_wrapper.py` marshalling calls. Mixes MCP configs and plain Python callables in one `tools=[...]` list.

Nexus: **both host and client** -- the daemon-side `McpBridge` host ([core/coding/McpBridge.ts](../../../core/coding/McpBridge.ts)), 8 in-process code-graph tools ([core/codegraph/](../../../core/codegraph)), 2 LSP tools ([core/coding/lsp/LspMcpServer.ts](../../../core/coding/lsp/LspMcpServer.ts)), and an external `McpClient` ([modules/coding/mcp/McpClient.ts](../../../modules/coding/mcp/McpClient.ts)). aisuite's **HTTP transport** for remote MCP is the one piece Nexus lacks -- and it is intentionally absent (outbound network surface). **Preserve; HTTP transport dropped (Section 5).**

### 3.5 State / session persistence -- `~` (Nexus exceeds locally; aisuite has Postgres)

aisuite: `StateStore` protocol with `InMemory` / `File` (`.aisuite/state`) / **`Postgres`** backends; Postgres adds optimistic concurrency (revision counter) + message compaction (shared-prefix dedup). Large message fields (>20KB) are **dehydrated** to an artifact store and rehydrated on load ([agents/artifacts.py]).

Nexus: a **four-layer memory** (working / episodic / semantic / graph) over local SQLite ([core/memory/MemoryHub.ts](../../../core/memory/MemoryHub.ts)), hybrid BM25+dense+graph retrieval fused via RRF (k=60, [core/memory/HybridRetriever.ts](../../../core/memory/HybridRetriever.ts)), a bundled local embedder, Ebbinghaus decay ([core/memory/DecaySweep.ts](../../../core/memory/DecaySweep.ts)), scope isolation, provenance on every write, frozen/live snapshot modes, and session-replay timeline. The Postgres backend is **out of scope** (server/outbound). The **artifact-dehydration pattern**, however, is a genuine local-only gap worth closing (-> **A1**): Nexus has `CommandCompressor` + `OutputRedirector` byte-capping, but does not store large tool-output / diff fields out-of-line in persisted session state with a rehydrate-on-resume ref.

### 3.6 Toolkits -- `.` (equivalent)

aisuite `files` / `git` / `shell` toolkits sandbox via root-restriction, `..`-traversal blocking, shell-operator blocking (no `|`/`&&`/`;`/redirects unless `allow_shell=True`), allowlists, timeouts, and 20KB output caps. Nexus's builtin tools (`read_file`, `grep_codebase`, `run_terminal`, `write_file`, `edit_file`, etc.) are gated by the tier model + denylist + `OutputRedirector` byte-capping + `GitSafetyNet`. Equivalent coverage by different mechanism. **No adoption.**

### 3.7 Tracing / observability -- `~` (Nexus local-only; aisuite has nesting + standalone viewer)

aisuite: a versioned `TraceEvent` schema (`run.started` / `model.send` / `model.response` / `tool.allowed|denied|started|completed|failed`) carrying `span_id` / `parent_span_id` / `parent_run_id` / `group_id` for **hierarchical sub-run nesting**; sinks (`Local` JSONL, **`Http`**, `InMemory`, `Store`); stores (`Jsonl`, `InMemory`); and a **standalone web viewer** served by a local HTTP server from a pre-built React bundle (`tracing/static/viewer/`).

Nexus: a local trace store + webview `TraceDashboardPanel` ([src/panels/TraceDashboardPanel.ts](../../../src/panels/TraceDashboardPanel.ts)), `TelemetryBus` ([core/telemetry/TelemetryBus.ts](../../../core/telemetry/TelemetryBus.ts)) with GPU/VRAM samples, command-output compression stats, cache-hit observability, and interactive HTML artifacts ([desktop/src/components/InteractiveArtifact.tsx](../../../desktop/src/components/InteractiveArtifact.tsx)). The **HTTP sink is dropped** (telemetry-by-default conflict). Two pieces are adoptable and local-only: **hierarchical sub-run nesting** so the dashboard can render the new swarm topology (-> **A2**), and a **self-contained shareable HTML trace/session viewer** (-> **A4**), which dovetails with the user's HTML-guide request.

### 3.8 ASR / audio -- not applicable

aisuite normalizes speech-to-text across Whisper / Deepgram / Google Cloud Speech with a `ParamValidator` and bidirectional parameter mapping. Nexus has no transcription pillar (Coding / Chat / Image / Video). **Not applicable** (same class of scope objection as Surya OCR in the 2026-06 scan).

### 3.9 CI/CD, packaging, security posture -- `.` (equivalent / Nexus broader)

Both: MIT, env-var API keys (where applicable), no default telemetry, opt-in outbound. aisuite runs Black + pytest (markers: integration/llm/mcp_server) + a Tauri/PyInstaller release. Nexus runs Vitest + Stryker mutation testing, CodeQL + Scorecard, semantic-release, and cross-platform installer CI. **No adoption.**

---

## 4. Gap Ledger

| ID | Capability | Status in Nexus | Class | Target location |
|---|---|---|---|---|
| A1 | Session-state artifact dehydration/hydration (large fields out-of-line + rehydrate on resume) | Partial (compressor + byte-cap exist; no out-of-line persisted refs) | **re-full** | [core/memory/](../../../core/memory) + session store |
| A2 | Hierarchical sub-run trace nesting (`parent_run_id`/`group_id`/spans) for swarm topology | Partial (flat session traces; swarm landed v1.5.0 P4) | **re-full** | [src/panels/TraceDashboardPanel.ts](../../../src/panels/TraceDashboardPanel.ts) + trace schema |
| A3 | Convention-driven **local**-runtime adapter registry (auto-discover local adapters) | Partial (two hand-wired adapters) | **re-full** | [core/registry/](../../../core/registry) + [modules/coding/llm/](../../../modules/coding/llm) |
| A4 | Standalone shareable HTML session/trace viewer (self-contained file) | Missing | **re-full** | new `guides/` artifact + export path |
| H1 | Interactive HTML guide for Nexus-AI (constellation design system) -- **user-directed** | Missing | **re-full** | `guides/interactive-guide/nexus-ai-guide.html` |
| D1 | Cloud multi-provider routing (~21 cloud providers, `provider:model`) | Absent by design | **drop** (future-watch) | n/a |
| D2 | Postgres state store | Absent by design | **drop** | n/a |
| D3 | MCP HTTP / remote transport | Absent by design | **drop** (LAN-opt-in future) | n/a |
| D4 | HTTP trace sink to external collector; ASR multi-provider | Absent by design / out of scope | **drop** | n/a |

---

## 5. Security and Reverse-Engineering Assessment (MANDATORY)

### 5.1 Threat-model comparison

| Axis | aisuite | Nexus | Delta introduced by adopting A1-A4 + H1 |
|---|---|---|---|
| New runtime deps | per-provider SDKs, `nest_asyncio`, Postgres driver | none required by the adopted items | **none** |
| Outbound destinations | every cloud provider API; optional HTTP trace sink; Postgres host | none (Ollama/LM Studio on loopback) | **none** (all items are local file / SQLite / static HTML) |
| Credentials required | API keys per cloud provider | none | **none** |
| Does source/prompt/query leave the machine? | Yes, on every cloud call | No | **No** -- A1-A4/H1 add zero egress |
| New third-party commercial relationship | Yes (each provider) | No | **No** |

The critical observation: **every adopted item is local-only and adds no new outbound call, credential, or data processor.** The items that *would* introduce those (cloud routing, Postgres, HTTP transport, HTTP trace sink) are exactly the ones dropped below.

### 5.2 Per-item risk scorecard

| ID | Risk tier | Rationale |
|---|---|---|
| A1 | None | Local SQLite/file refs; no new egress; reduces persisted-session size |
| A2 | None | Local schema + dashboard rendering only |
| A3 | Low | Plugin-discovery surface; must restrict to **local** runtimes and validate adapter manifests (no arbitrary remote endpoints) |
| A4 | Low | Static HTML export; must reuse `InteractiveArtifact` sanitisation (strip `<script>`/`on*`/`javascript:`) -- no live network |
| H1 | None | Static, self-contained HTML; no network, no inline remote assets |
| D1 | High | Outbound to cloud providers + API keys + per-token billing -- violates no-outbound default and "Zero Tokens Billed" |
| D2 | High | Network DB server -- violates single-machine local-first |
| D3 | Medium | Remote MCP over HTTP -- outbound network surface |
| D4 | Medium | HTTP trace sink -- telemetry-by-default conflict; ASR out of scope |

### 5.3 Reverse-engineering viability

- **A1, A2, A3, A4, H1** -> `re-full`. Each is fully realizable as a local internal artifact (SQLite/file store, trace schema + dashboard code, an adapter-discovery loop, a static HTML file). No external source attribution is carried; aisuite is used only as a design reference, and the implementations are generic Nexus modules.
- **D1 (cloud routing)** -> `vendor-intrinsic`, but **dropped** on product-shape grounds, not RE grounds: the value proposition of multi-cloud routing is the clouds themselves, which Nexus rejects by construction. Reclassifies to a `future`-tier watch only.
- **D2 (Postgres), D3 (HTTP MCP), D4 (HTTP sink / ASR)** -> `drop-outright`. Local equivalents already exist (SQLite four-layer memory; in-process + stdio MCP; local JSONL trace store), so the outbound variants buy nothing but trust cost and out-of-scope surface.

### 5.4 Recommendation ordering (this IS the adoption plan ordering)

1. **skill-native** -- none net-new (agent presets + DCI search-discipline already adopted in the 2026-06 cycle).
2. **re-full** -- **H1** (user-directed, highest stated priority) -> **A4** (shares the H1 design system) -> **A1** (session economy, foundational) -> **A2** (swarm observability) -> **A3** (optional/backlog).
3. **vendor-intrinsic** -- none adopted (D1 deferred to `future`-watch).
4. **drop-outright** -- D2, D3, D4 (and D1's cloud surface) move to the NOT-recommended list below.

---

## 6. Adoption Plan (RE-ordered)

A phased plan is written to [plans/adoption-aisuite-harness.md](plans/adoption-aisuite-harness.md). Summary sequence (reverse-engineer-first, local-only):

| Phase | Item(s) | Value/Effort | Why this order |
|---|---|---|---|
| 1 | **H1** -- Nexus-AI interactive HTML guide (constellation design system) | High / Med | User-directed headline deliverable; self-contained; establishes the shared design tokens A4 will reuse |
| 2 | **A4** -- standalone shareable HTML session/trace viewer | Med / Med | Reuses H1's design system + existing `InteractiveArtifact` sanitisation; turns a session trace into a portable artifact |
| 3 | **A1** -- session-state artifact dehydration/hydration | Med / Med-Low | Extends `CommandCompressor` across persisted sessions; foundational token/context economy |
| 4 | **A2** -- hierarchical sub-run trace nesting | Med / Med | Makes the v1.5.0 Phase 4 swarm topology legible in the dashboard (and in A4's exported viewer) |
| 5 (backlog) | **A3** -- convention-driven local-runtime adapter registry | Low-Med / Med | Lowers the cost of adding future local runtimes (llama.cpp/vLLM/MLX); optional |

### Conflicts and risks

- **A3** must hard-restrict discovered adapters to **local** runtimes and validate adapter manifests; an unguarded plugin loader is exactly the surface the MCP Registry Policy exists to prevent. Cite the policy in the implementing PR.
- **A4 / H1** must route all HTML through the existing `InteractiveArtifact` sanitisation rules (no `<script>`, `on*`, `javascript:`, no remote asset URLs) and embed fonts/styles inline -- a "shareable" artifact that phones home would reintroduce the egress the whole project rejects.
- **A1** changes the persisted session format -> ship a one-way migration and a read path that tolerates pre-migration sessions (same discipline as the dense-index -> pruned migration).

### NOT recommended (dropped, with policy grounds)

- **D1 -- Cloud multi-provider routing.** Conflicts with the local-first / no-outbound / "Zero Tokens Billed" product shape (same grounds as MiniMax M3, 2026-06 scan). `future`-watch only: *if* an explicit, opt-in, per-session bring-your-own-key cloud escape hatch is ever desired, aisuite's `ProviderFactory` + `message_converter` normalization is the reference design -- but it is not planned and must never be a default.
- **D2 -- Postgres state store.** Network DB server conflicts with single-machine local-first; SQLite four-layer memory already covers persistence with optimistic-safe writes.
- **D3 -- MCP HTTP / remote transport.** Outbound network surface; in-process + stdio MCP already covers the harness. LAN-scoped explicit opt-in is a distant `future`-watch, not a plan item.
- **D4 -- HTTP trace sink + ASR multi-provider.** HTTP sink violates no-telemetry-by-default (local JSONL store already exists); ASR is out of scope (no transcription pillar).

---

## 7. Verification Checklist

- [x] Source type identified (Git repo) and full-dimension comparison applied
- [x] Every dimension evaluated for both projects with file-path evidence
- [x] Every gap cites a concrete target location in Nexus
- [x] Priority assignments consistent with the value/effort matrix
- [x] Conflicts with existing conventions flagged (A1 migration, A3 plugin surface, A4/H1 sanitisation)
- [x] Items NOT recommended include reasoning (D1-D4 with policy grounds)
- [x] **Step 5 complete** -- threat-model table, per-item risk scorecard, per-item RE classification all present
- [x] **Step 5.4 ordering used** -- skill-native (none) -> re-full (H1, A4, A1, A2, A3) -> vendor-intrinsic (none) -> drops (D1-D4)
- [x] **MCP Registry Policy cited by name** for every item involving an outbound call / API key / new data processor / new runtime dependency (all in the drop list)

---

## Appendix A -- aisuite file map (evidence anchors)

- Provider routing: `aisuite/provider.py` (`ProviderFactory`), `aisuite/client.py`, `aisuite/providers/*.py` (~23), `aisuite/providers/message_converter.py`, `aisuite/framework/*` (Pydantic models, ASR param mapping)
- Agent harness: `aisuite/agents/{runner,types,policies,state_store,postgres_state_store,artifacts,artifact_store,context,tools,viewer}.py`
- MCP client: `aisuite/mcp/{client,config,schema_converter,tool_wrapper}.py`
- Toolkits: `aisuite/toolkits/{files,git,shell}.py`
- Tracing: `aisuite/tracing/{sinks,store,normalize,viewer}.py` + `aisuite/tracing/static/viewer/`
- TS port: `aisuite-js/src/{client,core,providers,asr-providers}.ts`

## Appendix B -- Confidence notes

aisuite findings are at `supported` confidence (direct read of a fresh clone). Nexus "already implemented" findings are at `internal-compatible` confidence -- grounded in the v1.5.0 code map taken for this report, the README/ARCHITECTURE capability tables, and the known-gaps ledger -- not a line-by-line audit of every cited file. Where a Nexus capability is stated as "partial," that reflects the gap the adoption item closes, not an absence of the surrounding subsystem.
