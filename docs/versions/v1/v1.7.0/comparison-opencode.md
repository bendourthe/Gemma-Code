# Cross-Project Comparison: Nexus (v1.6.0 codebase) vs. opencode (anomalyco/opencode) -- open-source AI coding agent

**Version**: v1.7.0 (forward-input single-source comparison for the v1.7.0 cycle; analysis snapshot assumes **all v1.6.0 plans complete** -- the aisuite-harness adoptions A1-A4/H1 and the openrouter-fusion adoptions F1-F5 are treated as shipped baseline, per the user framing for this comparison)
**Generated**: 2026-06-29T00:00:00Z
**Analyzer**: Claude Code -- /compare
**Source Type**: Git repository -- [anomalyco/opencode](https://github.com/anomalyco/opencode) (shallow clone, default branch `dev`, commit `60b6229c4e7b39447709c7dab40222ea5d06adeb`; the active home of the project formerly at `sst/opencode`; npm `opencode-ai` v1.17.11)
**Companion report**: [comparison-self-optimizing-skills.md](comparison-self-optimizing-skills.md) (same cycle; the skill-optimization article scan -- the cross-source synthesis in Section 1 ties the two together)
**Decision lens**: [AGENTS.md](../../../../AGENTS.md) MCP Registry Policy -- **local-only > LLM-native skill > reverse-engineered internal module > trusted-vendor wrapper > drop**. Hard no: search / embeddings / scraping / generation as a service; no outbound calls without explicit user opt-in; no telemetry by default.
**Wording convention**: per [development/evidence-and-support-tiers.md](../v1.4.0/development/evidence-and-support-tiers.md), every claim about an *unbuilt* Nexus capability is stated at `candidate` or `future` tier, never `supported`; "not_observed != absent" applies. opencode findings are at `supported` confidence (direct read of a fresh clone). Nexus "already implemented" findings are at `internal-compatible` confidence (the v1.6.0 code map, the README/ARCHITECTURE tables, the two v1.6.0 plans, and the known-gaps ledger), not a line-by-line audit.

This is a single-source comparison against the most active open analogue that exists: opencode is an MIT-licensed, pure-TypeScript (Bun + Effect + SolidJS/OpenTUI + Vercel AI SDK v6) coding-agent monorepo with a ReAct loop, plan mode, subagents, a granular permission model, MCP-client support, LSP, SKILL.md skills, a plugin system, and a TUI + Electron desktop + web/console/enterprise + Slack + ACP surface. Reported cumulative downloads grew to ~10.2M by 2026-01. The headline mirrors the aisuite comparison: this **validates Nexus's local harness depth rather than exposing gaps**. On orchestration, memory/retrieval, MCP role, observability defaults, and session-state dehydration, Nexus matches or exceeds opencode; the axes where opencode "leads" are precisely the ones Nexus rejects by construction (cloud provider breadth, a startup catalog fetch, hosted session sharing, an accounts/billing/telemetry-lake cloud stack). The genuinely net-new, on-brand, local-only adoptable work is **small**: one clearly worthwhile item (tree-sitter shell-command introspection for permission gating) and three minor candidates (local/Git-repo read-only context references, ACP editor interop, a guarded local plugin auto-loader).

The most consequential finding is a **cross-source synthesis**: opencode ships SKILL.md skills but has **zero skill/prompt/rule self-optimization** -- no eval harness, no golden-task suite, no verifier, no feedback loop (independently grep-confirmed). This corroborates the companion article's thesis that skill self-optimization is the emerging bottleneck, and it means the v1.7.0 headline track (the local skill-optimization loop from [comparison-self-optimizing-skills.md](comparison-self-optimizing-skills.md)) would put Nexus **ahead of the most active open coding agent on exactly that axis** -- while Nexus already holds the substrate (a golden task suite) opencode lacks entirely.

---

## 1. Executive Summary

opencode is "the open source AI coding agent": a sprawling product-org Bun monorepo (`packages/*`) wrapping a TS agent core in a CLI, a TUI, an Electron desktop app, SolidStart web/console/enterprise apps, a Slack bot, SDKs, and SST cloud infra. The agent core is architecturally strong and largely local-capable; the surrounding product (a models.dev startup catalog fetch, ~20 cloud AI-SDK providers, hosted session sharing, an OAuth accounts/orgs system, a hosted "zen" model gateway, and a Cloudflare/AWS/PlanetScale/Stripe/Honeycomb infra + usage "lake") is cloud- and account-leaning by default.

Mapped against Nexus's Coding-pillar harness, the analysis surfaced **15 distinct capabilities**, of which **8 are already implemented in Nexus at equal-or-greater depth**, **3 are partially implemented**, **4 are small local-only `re-full` candidates**, and the remainder are **dropped on product-shape grounds** (cloud routing, catalog fetch, hosted sharing, accounts/billing/telemetry-lake, remote MCP/skill transports).

The dominant finding is **validation, not gap**:

- **Orchestration.** opencode runs a single ReAct loop with a `plan` agent (read-only, permission-restricted) and a `task` tool that spawns background subagent child sessions with permission inheritance. Nexus's three-tier orchestration (ReAct `AgentLoop` -> Plan-and-Execute `Orchestrator`/`PlannerAgent`/`DAGExecutor`/`ReflexionEngine` -> the v1.5.0 worktree swarm with critic gating, plus the v1.6.0 Fusion `PanelExecutor`/`FusionAgent`) is strictly richer. opencode's *background* subagent execution is the one small sliver Nexus does not foreground.
- **Permission model.** opencode uses an ordered `allow | ask | deny` ruleset (last-match-wins, wildcard, `~`/`$HOME` expansion, `once`/`always` persistence) with **tree-sitter command introspection** (bash + PowerShell + cmd grammars) to extract the file/path/cwd operations a shell command will perform and gate them. Nexus's three-tier `PermissionTier` model + override-clamping + `.nexus/permissions.deny` + per-sub-agent scopes + `ActionClassifier` is a functional superset on policy, but Nexus gates shell commands more coarsely (denylist + byte-cap + `GitSafetyNet`) and does **not** parse the command AST to enumerate the paths it touches. opencode's tree-sitter approach is the **one clearly worthwhile local adoption** (-> **O-A**).
- **MCP.** opencode is an MCP **client** only (stdio + StreamableHTTP + SSE + OAuth). Nexus is **both host and client** (8 in-process code-graph tools + 2 LSP tools + external client). opencode's remote HTTP/SSE transports are intentionally absent from Nexus (outbound surface). **Nexus exceeds.**
- **State / dehydration.** opencode persists sessions in local SQLite (drizzle-orm, XDG dirs) and offloads large tool outputs (>2,000 lines / >50KB) to a `tool-output/` directory with 7-day retention, leaving a path reference. **Nexus already shipped exactly this** in v1.6.0 (A1 `ArtifactStore` + `sessionArtifacts` dehydration, content-addressed, redaction-on-write, with a one-way migration). This is **convergent validation**, not a gap. opencode's hosted **session sharing** (POST to a remote `baseUrl`) is the off-limits piece; Nexus's v1.6.0 A4 self-contained offline HTML trace export is the local-only analogue.
- **Observability.** opencode has an Effect event bus, per-tool spans, and OTLP export that is **opt-in and off by default** (Sentry/Honeycomb live only in the web/enterprise/infra surfaces, not the local CLI). Nexus matches: local trace store + dashboard + `TelemetryBus` + OTLP opt-in/off. **Equivalent.**
- **Code intelligence.** opencode has a strong LSP client that auto-launches (and auto-*installs*) language servers, plus ripgrep/glob search -- but **no embeddings/semantic index**. Nexus has an LSP client (v1.2.0 Phase 6) **plus** the code-graph MCP (SQLite + FTS5 symbol/call-edge graph) **plus** hybrid BM25+dense+graph RRF retrieval. **Nexus exceeds**; opencode's LSP **auto-install** conflicts with Nexus's "no model/tool downloads at runtime -- the installer carries the burden" principle and is **not** adopted.

The one axis where opencode genuinely leads -- **breadth of cloud provider routing + a hosted product layer** -- is the wrong axis for Nexus to chase, for the same reasons cloud routing was dropped in the aisuite comparison (D1) and the hosted Fusion service was dropped in the openrouter-fusion comparison. It is **dropped**.

The genuinely net-new, adoptable work is **four small local-only items**: **(O-A)** **tree-sitter shell-command introspection** to enumerate the paths/cwd a shell command touches and gate them through the existing tier model (a real strengthening of the permission surface); **(O-B)** a **`references`** capability registering local directories (and, opt-in, Git repos) as read-only external context with a cache; **(O-D)** **ACP (Agent Client Protocol)** support so ACP-compatible editors (e.g. Zed) can drive the Nexus agent locally; and **(O-E)** a **guarded local plugin auto-loader** (`tools/*.ts`) -- recorded but low-priority because Nexus's MCP host + skill catalog already cover extensibility and an unguarded code auto-loader is exactly the surface the MCP Registry Policy guards against.

---

## 2. Source Inventory

| Field | opencode (anomalyco/opencode) | Nexus |
|---|---|---|
| Identity | "The open source AI coding agent" -- Bun monorepo (CLI + TUI + Electron + web/console/enterprise + Slack + SDK + SST infra) | Local-first four-pillar desktop AI Studio (Coding / Chat / Image / Video) |
| License | MIT | MIT |
| Languages | Pure TypeScript/TSX (Bun + Effect 4 beta + SolidJS/OpenTUI + Vercel AI SDK v6); **no Go, no Rust** | TypeScript (primary), Rust (Tauri 2.x), Python (installer) |
| Version | npm `opencode-ai` v1.17.11 | v1.6.0 baseline (assumed complete) |
| Provider posture | ~20 AI-SDK cloud providers + ~25 named; **models.dev catalog fetched on startup**; local only via `openai-compatible` `baseURL` | Local-only (Ollama + LM Studio; manifest-driven `LocalAdapterRegistry` from v1.6.0 A3); **no outbound by default**; catalog bundled |
| Agent loop | Single ReAct + `plan` agent + `task` subagents (background, permission-inherited) | Three-tier: ReAct + Plan-and-Execute + worktree swarm + Fusion panel |
| MCP role | Client only (stdio + HTTP + SSE + OAuth) | **Host + client** (in-process code-graph + LSP + external client) |
| State | Local SQLite (drizzle, XDG) + tool-output dehydration; **hosted session sharing** | SQLite four-layer memory + hybrid RRF + decay + provenance + v1.6.0 A1 dehydration; local-only A4 HTML export |
| Permissions | Ordered `allow/ask/deny` ruleset + **tree-sitter command introspection**; no OS sandbox | Three-tier `PermissionTier` + override-clamp + denylist + `ActionClassifier` + `GitSafetyNet` |
| Code intel | LSP (auto-install/launch) + ripgrep/glob; **no semantic index** | LSP + code-graph MCP (FTS5) + hybrid BM25/dense/graph RRF |
| Tracing | Effect event bus + per-tool spans; OTLP opt-in/off | Local trace store + dashboard + `TelemetryBus`; OTLP opt-in/off |
| Skill self-optimization | **None** (static read-only SKILL.md) | None yet -- the v1.7.0 headline gap (companion report) |
| Hosted/cloud layer | accounts/orgs (OAuth), hosted "zen" gateway, Stripe billing, Cloudflare/AWS/PlanetScale, Honeycomb, usage "lake" | **None** -- no accounts, no billing, no telemetry lake |

---

## 3. Capability Comparison (per dimension)

Legend: `+` external-only (adoption candidate) | `=` current-only (strength to preserve) | `~` both, different approach | `.` both, equivalent.

### 3.1 Provider routing -- `~` (different by design)
opencode routes through the Vercel AI SDK across ~20 cloud providers (+ ~25 named, incl. a hosted `opencode` "zen" provider) and fetches the models.dev catalog on startup (5-min cache; offline only via `OPENCODE_DISABLE_MODELS_FETCH`/`OPENCODE_MODELS_PATH`). Local models work only through the generic `@ai-sdk/openai-compatible` `baseURL` path -- there is no first-class Ollama provider. Nexus is local-only by first principle (Ollama + LM Studio, now manifest-driven via the v1.6.0 A3 `LocalAdapterRegistry`), bundles its catalog, and never fetches on startup. The cloud breadth + startup catalog fetch are **dropped** (Section 5); Nexus's local adapter story is already cleaner for its product shape.

### 3.2 Agent loop / orchestration -- `=` (Nexus exceeds)
opencode: one ReAct loop (`session/processor.ts` yields `compact|stop|continue`), a `plan` agent (read-only, permission-restricted, `plan_exit` transitions to `build`), and a `task` tool spawning background subagent child sessions with permission inheritance. No multi-candidate scoring/tree-search. Nexus's three tiers (ReAct -> Plan-and-Execute -> swarm) plus the v1.6.0 Fusion panel are strictly richer. **Preserve; no adoption.** opencode's *background* subagent execution is a small sliver Nexus does not foreground today (recorded, low value -- the swarm already delivers parallelism).

### 3.3 Tool / permission model -- `~` (Nexus superset on policy; opencode leads on command introspection)
opencode: an ordered `{permission, pattern, action}` ruleset with `allow|ask|deny`, last-match-wins wildcards, `~`/`$HOME` expansion, and `once`/`always` persistence; crucially, the **shell tool parses each command with tree-sitter** (bash + PowerShell + cmd grammars) to extract the files/paths/cwd it will operate on, then gates those through the permission system. No OS-level sandbox. Nexus's three-tier `PermissionTier` + override-clamping + `.nexus/permissions.deny` + per-sub-agent scopes + `ActionClassifier` is a **policy superset**, but Nexus gates shell more coarsely (denylist + `OutputRedirector` byte-cap + `GitSafetyNet`) and does **not** parse the command AST to enumerate touched paths. opencode's tree-sitter introspection is the **one clearly worthwhile local adoption** (-> **O-A**): it makes "what will this command actually touch?" a structural answer rather than a regex guess, and it is fully local.

### 3.4 MCP layer -- `=` (Nexus exceeds)
opencode is an MCP **client** only (stdio + StreamableHTTP + SSE + OAuth; MCP prompts surface as slash commands). Nexus is **both host and client**. opencode's remote HTTP/SSE transports are intentionally absent from Nexus (outbound surface). **Preserve; remote transports dropped (Section 5).**

### 3.5 State / session persistence + dehydration -- `.` (convergent; Nexus already shipped this)
opencode persists sessions in local SQLite (drizzle, XDG) and offloads large tool outputs (>2,000 lines / >50KB) to a `tool-output/` dir (7-day retention) leaving an `outputPath` reference. **Nexus shipped the equivalent in v1.6.0 (A1)**: content-addressed, redaction-on-write `ArtifactStore` + threshold-gated `dehydrateMessages`/`hydrateMessages` + a one-way migration. This is **convergent validation** -- two independent harnesses arrived at the same out-of-line-large-field pattern. opencode's **hosted session sharing** (POST to a remote `baseUrl`) is **dropped**; Nexus's v1.6.0 A4 self-contained offline HTML export is the local-only analogue. (opencode's `tool-output/` adds a *retention sweep* that Nexus's `ArtifactStore` lacks -- but that exact gap is already logged as v1.6.0 `AS005.P3.A`, so no new item is needed.)

### 3.6 Toolkits + snapshots/revert -- `.` (equivalent)
opencode: read/write/edit/`apply_patch` (auto-selected by model family), glob, ripgrep grep, shell (node-pty), git + worktree, and **snapshot-based undo/revert** (`snapshot.ts`, `session/revert.ts`). Nexus's tier-gated builtins + `GitSafetyNet` + the v1.5.0 worktree swarm are equivalent; opencode's snapshot/revert overlaps the optimizerDuck `O1` "mutation journal / selective revert" candidate already logged in the v1.6.0 known-gaps (no new item). **No adoption beyond the existing O1.**

### 3.7 Tracing / observability -- `.` (equivalent; both local-only by default)
opencode: Effect event bus + per-tool spans + OTLP exporter that returns an empty layer unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set (off by default); Sentry/Honeycomb only in web/enterprise/infra. Nexus: local trace store + `TraceDashboardPanel` + `TelemetryBus` + OTLP opt-in/off. **Equivalent; no adoption.**

### 3.8 Code intelligence / LSP / indexing -- `=` (Nexus exceeds)
opencode: a strong LSP client that auto-detects roots and **auto-installs + auto-launches** language servers (tsserver/gopls/pyright/rust-analyzer/clangd), feeding diagnostics back to the agent; ripgrep/glob search; **no semantic index**. Nexus: LSP client (v1.2.0 Phase 6) **+** code-graph MCP (FTS5 symbol/call-edge graph) **+** hybrid BM25/dense/graph RRF retrieval. **Nexus exceeds.** opencode's LSP **auto-install** (downloading servers at runtime) conflicts with Nexus's "no runtime downloads -- the installer carries the burden" principle; **not adopted**. Auto-*launch* of already-installed servers with root detection is a minor convenience candidate (recorded, low value).

### 3.9 Rules / instructions / commands / external context -- `~` (parity + one candidate)
opencode reads `AGENTS.md` (global + project, searched upward), `opencode.json(c)` (V1->V2 auto-migration) with `instructions`/`commands`/`agents`/`permissions`/`mcp`/`skills`/`plugins`, custom agents as `.opencode/agent/*.md` with frontmatter, and -- notably -- **`references`: register local directories or Git repos as read-only external context** with a repository cache (`core/src/reference.ts`, `repository-cache.ts`). Nexus has AGENTS.md, the skill catalog, slash commands, and sub-agent specialists. The **`references`** capability (local-dir read-only context, with an opt-in Git-repo clone path) is a genuine local-only candidate (-> **O-B**): the local-dir half is fully on-brand; the Git-repo half is an explicit opt-in outbound clone (like a user-initiated `git clone`), acceptable only as opt-in, never a default.

### 3.10 Skill self-optimization -- `+` (opencode has NONE; this is the cross-source headline)
opencode has SKILL.md skills (frontmatter `name`/`description`/`slash`, discovered from project/home/`.opencode`/remote URL sources, permission-gated `skill` tool, slash commands) but **zero self-optimization** -- grep-confirmed: no `golden`, no `self-improve`, no `optimizePrompt`, no `*eval*` directories, no verifier, no feedback loop. Skills are static, read-only, user-edited. This is opencode's clearest capability gap **and** it corroborates the companion article's thesis. The adoption here is **not** an opencode item -- it is the entire skill-optimization track in [comparison-self-optimizing-skills.md](comparison-self-optimizing-skills.md) (S1-S5). The takeaway for this report: building that track gives Nexus a capability the most active open coding agent lacks, on the substrate (a golden task suite) that opencode also lacks.

### 3.11 Plugins / extensibility -- `~` (candidate, but MCP already covers it)
opencode: `@opencode-ai/plugin` (ordered npm packages registering tools + event hooks + TUI/shell customizations) plus zero-config auto-loading of `{tool,tools}/*.{js,ts}`. Nexus: the MCP host + external client + skill catalog + the v1.6.0 A3 `LocalAdapterRegistry` already cover local extensibility. A guarded local plugin auto-loader (-> **O-E**) is a candidate, but **low priority**: an unguarded code auto-loader is exactly the surface the MCP Registry Policy + A3's loopback-only manifest guard exist to prevent, and MCP already provides the sanctioned extension point.

### 3.12 UI surfaces + ACP -- `~` (broader surface; ACP is a candidate)
opencode ships a TUI (OpenTUI/SolidJS), an Electron desktop app, SolidStart web/console/enterprise apps, a Slack bot, and **ACP (Agent Client Protocol)** support so ACP editors (e.g. Zed) can drive the agent, plus Hono HTTP server + SDKs. Nexus ships a Tauri desktop app + an optional VS Code extension (JSON-RPC sidecar). The web/console/enterprise/Slack surfaces are cloud/product features (dropped). **ACP** is a genuine local-only interop candidate (-> **O-D**): it would let external ACP-compatible editors drive the local Nexus agent over a local protocol; medium-low value given Nexus's surface is its own desktop app + VS Code extension.

### 3.13 Packaging / hosted layer / accounts -- `~` (Nexus narrower by design)
opencode: `curl|bash`, npm, brew/scoop/choco/pacman/AUR/mise/nix, Electron releases; a substantial hosted layer (SST -> Cloudflare/AWS/PlanetScale/Stripe/Honeycomb, console, enterprise, usage "lake", OAuth accounts/orgs, hosted "zen" gateway). The local CLI runs without an account using your own keys. Nexus: cross-OS installer; **no accounts, no billing, no telemetry lake, no hosted gateway**. The entire hosted layer is **dropped** by product shape.

---

## 4. Gap Ledger

| ID | Capability | Status in Nexus | Class | Target location |
|---|---|---|---|---|
| O-A | Tree-sitter shell-command introspection (enumerate touched paths/cwd, gate through the tier model) | Partial (coarse denylist + byte-cap + `GitSafetyNet`; no command-AST path enumeration) | **re-full** | [src/tools/handlers/terminal.ts](../../../../src/tools/handlers/terminal.ts) + permission/guardrails |
| O-B | `references` -- register local dirs (and opt-in Git repos) as read-only external context with a cache | Missing | **re-full** | new `core/coding/` reference module + cache |
| O-D | ACP (Agent Client Protocol) support so ACP editors can drive the local agent | Missing | **re-full** | new `modules/coding/acp/` adapter over the existing sidecar |
| O-E | Guarded local plugin auto-loader (`tools/*.ts`) | Missing (MCP host + skill catalog cover extensibility) | **re-full** (guarded) | MCP/registry surface; low priority |
| O-val | Tool-output dehydration; local SQLite state; OTLP opt-in/off; event-bus spans | **Already implemented** (v1.6.0 A1 + trace store + `TelemetryBus`) | n/a (validation) | n/a |
| O-dup | Snapshot/undo-revert | Overlaps existing optimizerDuck `O1` candidate (v1.6.0 known-gaps) | n/a (already logged) | n/a |
| D1 | Cloud multi-provider routing + models.dev startup catalog fetch | Absent by design | **drop** (future-watch: opt-in BYO-key) | n/a |
| D2 | Hosted session sharing (POST to remote `baseUrl`) | Absent by design | **drop** (A4 local HTML export is the analogue) | n/a |
| D3 | Remote MCP (HTTP/SSE) + remote skill URL sources | Absent by design | **drop** (LAN opt-in distant future) | n/a |
| D4 | Hosted accounts/orgs + Stripe billing + Honeycomb/usage-lake + hosted "zen" gateway | Absent by design | **drop** | n/a |
| D5 | LSP server auto-install at runtime | Absent by design | **drop** (installer carries the burden) | n/a |

---

## 5. Security and Reverse-Engineering Assessment (MANDATORY)

### 5.1 Threat-model comparison

| Axis | opencode | Nexus | Delta introduced by adopting O-A/O-B/O-D/O-E |
|---|---|---|---|
| New runtime deps | ~20 cloud provider SDKs, Effect, hosted infra SDKs | a tree-sitter grammar set (O-A); none for O-B/O-D | **minimal** -- O-A adds local tree-sitter grammars (already used elsewhere for shell parsing); O-D reuses the existing sidecar |
| Outbound destinations | every cloud provider; models.dev; hosted share/account/zen; OTLP if set | none | **none** for O-A/O-D/O-E; **opt-in only** for O-B's Git-repo clone path |
| Credentials required | cloud provider keys; account OAuth | none | **none** |
| Does source / prompt leave the machine? | Yes (cloud calls, hosted sharing, catalog fetch) | No | **No** -- the adopted items are local file/AST/protocol work |
| New third-party commercial relationship | Yes (providers, Stripe, hosted gateway) | No | **No** |
| New autonomous/code-exec surface | plugin auto-load (`tools/*.ts`) | n/a | **O-E only** -- a code auto-loader; must be guarded (opt-in, signed/allowlisted path) or it is exactly what the MCP policy forbids |

The critical observation: **every adopted item is local-only and adds no new outbound call, credential, or data processor**, except O-B's optional Git-repo reference (an explicit opt-in clone, never a default) and O-E's plugin auto-loader (which must be guarded). The items that *would* introduce egress (cloud routing, catalog fetch, hosted sharing, accounts/billing/telemetry-lake, remote MCP/skill transports, LSP auto-install) are exactly the ones dropped.

### 5.2 Per-item risk scorecard

| ID | Risk tier | Rationale |
|---|---|---|
| O-A | Low | Local tree-sitter parse of a command string; strengthens (never loosens) the permission surface. Must fail **closed** (un-parseable command -> fall back to the existing tier/denylist gate, never auto-allow). |
| O-B | Low-Med | Local-dir references are pure local reads. The Git-repo reference is an explicit opt-in outbound clone (like user-initiated `git clone`) -- must be opt-in, never default, and the clone must be read-only + path-guarded + `redactSecrets`-scanned on ingest. |
| O-D | Low | ACP is a local protocol exposing the existing sidecar to local editors; no new egress. Must reuse the existing permission/confirmation gates so an ACP-driving editor cannot bypass guardrails. |
| O-E | Medium | A local code auto-loader is a code-execution surface. Adopt only guarded: opt-in, allowlisted directory, no remote sources, and prefer routing through the sanctioned MCP host instead. |
| D1 | High | Outbound cloud calls + API keys + per-token billing + startup catalog fetch -- violates no-outbound default and Zero Tokens Billed. |
| D2 | Medium | Hosted session sharing ships session content off-machine. A4's local HTML export already covers the local-only need. |
| D3 | Medium | Remote MCP/skill transports are outbound network surfaces; stdio MCP + Hub-scoped skill sync already cover the harness. |
| D4 | High | Accounts/billing/telemetry-lake/hosted gateway -- a full third-party commercial + data-processor relationship. |
| D5 | Medium | Runtime download of language-server binaries -- conflicts with the installer-carries-the-burden + no-runtime-downloads principle. |

### 5.3 Reverse-engineering viability
- **O-A, O-B, O-D, O-E** -> `re-full`. Each is realizable as a local internal module on Nexus's existing spine (the terminal handler + guardrails for O-A; a local reference/cache module for O-B; an ACP adapter over the existing JSON-RPC sidecar for O-D; the MCP/registry surface for O-E). No external source attribution is carried; opencode is a design reference only, and the implementations use generic Nexus naming.
- **D1-D5** -> `drop-outright` (D2/D3/D5) or `vendor-intrinsic-but-dropped` (D1, D4) on product-shape grounds: each requires outbound calls, credentials, a hosted relationship, or a runtime download that Nexus rejects by construction, and a local equivalent already exists for every case worth covering (local catalog; A4 HTML export; stdio MCP + Hub-scoped skills; installer-provisioned LSP).

### 5.4 Recommendation ordering (this IS the adoption-input ordering)
1. **skill-native** -- none net-new from opencode (Nexus's skill catalog + AGENTS.md already cover instructions/commands/agents).
2. **re-full** -- **O-A** (permission-surface strengthening; clearly worthwhile) -> **O-B** (local + opt-in-Git context references) -> **O-D** (ACP editor interop) -> **O-E** (guarded plugin auto-loader; low priority, may be subsumed by MCP).
3. **vendor-intrinsic** -- none adopted (D1, D4 deferred to `future`-watch).
4. **drop-outright** -- D1, D2, D3, D4, D5 move to the NOT-recommended list below.

---

## 6. Adoption Plan (RE-ordered)

opencode contributes a **secondary harness-hardening track** to the consolidated v1.7.0 plan whose primary track is the skill-optimization loop from the companion report. A phased plan is written to [plans/adoption-self-optimizing-skills.md](plans/adoption-self-optimizing-skills.md). opencode's contribution:

| Priority | Item | Value/Effort | Why |
|---|---|---|---|
| Adopt (Phase 5) | **O-A** -- tree-sitter shell-command introspection for permission gating | Med / Med | The one opencode item that materially strengthens a local Nexus surface; turns "what will this command touch?" into a structural answer; fully local |
| Backlog | **O-B** -- local/Git-repo read-only context references | Low-Med / Med | Useful local context surface; Git-repo half is opt-in-outbound, so gated |
| Backlog | **O-D** -- ACP editor interop | Low-Med / Med | Local protocol interop; lower priority than Nexus's own desktop + VS Code surfaces |
| Backlog (guarded) | **O-E** -- guarded local plugin auto-loader | Low / Med | Likely subsumed by the MCP host; only if guarded |

### Conflicts and risks
- **O-A must fail closed**: an un-parseable or grammar-unsupported command must fall back to the existing tier/denylist gate, never auto-allow. The tree-sitter grammars are a local dependency (already used for shell parsing patterns); no new outbound surface.
- **O-B's Git-repo reference is opt-in-outbound** (a clone). It must never be a default, the clone must be read-only + path-guarded, and ingested content must pass `redactSecrets`. The local-directory half is unconditionally safe.
- **O-E is a code-execution surface.** Adopt only guarded (opt-in, allowlisted dir, no remote sources), or defer to the sanctioned MCP host. Cite the MCP Registry Policy in any implementing PR.

### NOT recommended (dropped, with policy grounds)
- **D1 -- Cloud multi-provider routing + models.dev startup catalog fetch.** Outbound + API keys + per-token billing + a startup network dependency -- conflicts with local-first / no-outbound / Zero Tokens Billed (same grounds as the aisuite D1 and the Fusion hosted-service drop). `future`-watch only: an explicit opt-in BYO-key escape hatch, never a default.
- **D2 -- Hosted session sharing.** Ships session content off-machine; the v1.6.0 A4 self-contained offline HTML export already covers the local-only "share a trace" need.
- **D3 -- Remote MCP (HTTP/SSE) + remote skill URL sources.** Outbound network surfaces; in-process + stdio MCP and Hub-scoped `nexus skills sync` already cover the harness. LAN-scoped opt-in is a distant `future`-watch.
- **D4 -- Hosted accounts/orgs + Stripe billing + Honeycomb/usage-lake + hosted "zen" gateway.** A full third-party commercial + data-processor relationship -- categorically rejected by the MCP Registry Policy.
- **D5 -- LSP server auto-install at runtime.** Runtime binary download conflicts with the installer-carries-the-burden + no-runtime-downloads principles. Auto-*launch* of installed servers is a minor convenience only.

---

## 7. Verification Checklist

- [x] Source type identified (Git repo) and full-dimension comparison applied
- [x] Every dimension evaluated for both projects with file-path / package evidence
- [x] Every gap cites a concrete target location in Nexus
- [x] Priority assignments consistent with the value/effort matrix
- [x] Conflicts with existing conventions flagged (O-A fail-closed, O-B opt-in clone, O-E code-exec surface)
- [x] Items NOT recommended include reasoning (D1-D5 with policy grounds)
- [x] **Step 5 complete** -- threat-model table, per-item risk scorecard, per-item RE classification all present
- [x] **Step 5.4 ordering used** -- skill-native (none) -> re-full (O-A, O-B, O-D, O-E) -> vendor-intrinsic (none) -> drops (D1-D5)
- [x] **MCP Registry Policy cited by name** for every item involving an outbound call / API key / new data processor / new runtime dependency (the drop list + O-B's Git path + O-E)
- [x] **Cross-source synthesis recorded** -- opencode's absence of skill self-optimization corroborates the companion article and motivates the v1.7.0 headline track

---

## Appendix A -- opencode evidence anchors

- Provider routing: `packages/opencode/src/provider/provider.ts`, `packages/core/src/models-dev.ts`, `packages/core/src/config/provider.ts`, `packages/opencode/src/provider/auth.ts`
- Agent loop: `packages/opencode/src/session/{processor,llm,prompt,compaction,overflow}.ts`, `packages/opencode/src/agent/agent.ts`, `tool/{task,plan}.ts`, `agent/subagent-permissions.ts`
- Permissions + shell introspection: `permission/{index,evaluate}.ts`, `core/src/policy.ts`, `tool/shell.ts`, `tool/shell/` (tree-sitter bash/PowerShell/cmd)
- MCP: `packages/core/src/config/mcp.ts`, `packages/opencode/src/mcp/{index,catalog,auth,oauth-provider,oauth-callback}.ts`
- State + dehydration + sharing: `core/src/global.ts`, `storage/db.{bun,node}.ts`, `*.sql.ts` tables, `core/src/tool-output-store.ts`, `share/{share-next,session}.ts`
- Tracing: `bus/`, `event-manifest.ts`, `core/src/observability/otlp.ts`
- LSP: `opencode/src/lsp/{index,server}.ts`
- Rules / references: `instruction-context.ts`, `core/src/reference.ts`, `repository-cache.ts`
- Skills (no optimization): `opencode/src/skill/discovery.ts`, `core/src/skill.ts`, `tool/skill.ts`
- Plugins: `packages/plugin/src/`, `opencode/src/plugin/`, `tool/registry.ts` (`fromPlugin`)
- Hosted layer: `sst.config.ts`, `infra/`, `packages/{console,enterprise,app,web,slack}`, `packages/opencode/src/account/`

## Appendix B -- Confidence notes

opencode findings are at `supported` confidence (direct read of a fresh `dev`-branch clone at `60b6229`). Nexus "already implemented" findings are at `internal-compatible` confidence (the v1.6.0 code map, README/ARCHITECTURE tables, the two v1.6.0 plans, and the known-gaps ledger), not a line-by-line audit. The "no skill self-optimization" finding for opencode is at `supported` confidence (grep-confirmed absence of `golden`/`self-improve`/`optimizePrompt`/`*eval*` plus manual inspection of the skill subsystem). Every claim about an unbuilt Nexus capability is stated at `candidate`/`future` tier.
