# Plan -- aisuite harness adoptions + Nexus-AI interactive guide (v1.6.0)

**Project**: Nexus
**Version**: v1.6.0
**Slug**: adoption-aisuite-harness
**Plan Type**: Feature / Enhancement
**Created**: 2026-06-14
**Goal**: Land the four local-only, reverse-engineer-first harness refinements drawn from the aisuite comparison (session-state artifact dehydration, hierarchical sub-run trace nesting, a config-driven local-runtime adapter registry, and a standalone shareable HTML session/trace viewer), and deliver the user-directed headline artifact: an interactive HTML guide for Nexus-AI that adopts the Nexus-Hub interactive-guide color scheme and dynamic constellation background. Every item is local-only, zero-outbound, and zero-new-data-processor, in keeping with the [AGENTS.md](../../../../../AGENTS.md) MCP Registry Policy.

**Source comparison**: [../comparison-aisuite.md](../comparison-aisuite.md)
**Design reference**: [Nexus-Hub interactive guide](file:///C:/Users/bdour/Documents/Projects/Development/Nexus-Hub/guides/interactive-guide/nexus-hub-guide.html)

## Goals (goals-first step)

*No `STRATEGY.md` anchor exists; this goal block is seeded from the [README.md](../../../../../README.md) design principles and the source comparison. Assumptions are stated explicitly for confirmation.*

- **Target problem**: The closest open analogue to Nexus's Coding-pillar harness (aisuite) confirms Nexus already matches or exceeds it on orchestration, permissions, MCP, memory, and observability depth. The comparison surfaced only four small local-only refinements worth adopting, plus a user-directed need: Nexus has no public-facing **interactive product guide** of the kind Nexus-Hub ships, and no way to export a session/trace as a self-contained, shareable artifact.
- **Persona**: the single-user, single-machine power developer Nexus is built for -- local models on one consumer GPU, no cloud, no per-token billing.
- **Definition of done (observable)**: the Nexus-AI interactive guide (H1) renders self-contained with the constellation background and shared design tokens; the standalone session/trace viewer (A4) exports a portable HTML file reusing those tokens and the `InteractiveArtifact` sanitisation; session-state artifact dehydration (A1) shrinks persisted sessions and rehydrates on resume; sub-run trace nesting (A2) renders the swarm topology in the dashboard; the local-runtime adapter registry (A3, backlog) auto-discovers local adapters; testing across unit / static / integration / e2e / CI passes at strong coverage.
- **Non-goals (carried from the comparison's drops, never implemented this cycle)**: cloud multi-provider routing (D1), Postgres state store (D2), MCP HTTP/remote transport (D3), HTTP trace sink + ASR multi-provider (D4). See the Out-of-Scope appendix.

## Overview

This plan is derived from the single-source aisuite comparison ([../comparison-aisuite.md](../comparison-aisuite.md)), whose dominant finding was *validation*: on every agent-harness axis except cloud-provider breadth, Nexus matches or exceeds aisuite, and cloud breadth is the one axis Nexus rejects by construction. The adoption set is therefore small, surgical, and entirely local-only -- nothing here introduces a new outbound call, credential requirement, or third-party processor.

Phase sequencing follows the comparison's Section 5.4 reverse-engineer-first ordering. There is no `skill-native` or `vendor-intrinsic` work this cycle (the cloud surface is dropped), so all five phases are `re-full` local builds. The user-directed **H1** is sequenced first because it is the highest stated priority and because it establishes the shared design-token stylesheet that **A4** (the exportable session viewer) reuses. The `drop-outright` items (D1-D4) are recorded in the Out-of-Scope appendix and never implemented.

**Definition of pass (whole-plan acceptance gate, verified in the final phase):**
1. **[DELIVERED 2026-06-15]** H1 interactive guide is built at [guides/interactive-guide/nexus-ai-guide.html](../../../../../guides/interactive-guide/nexus-ai-guide.html) -- a self-contained, offline **user guide** (7 pages: positioning, install/setup, per-pillar usage for Coding/Image/Video/Chat, and Nexus-Hub harness links) with the constellation canvas and shared `:root` design tokens. Verified self-contained (no remote assets, no network) by the AS003 offline-integrity test ([tests/unit/guides/nexus-ai-guide.offline.test.ts](../../../../../tests/unit/guides/nexus-ai-guide.offline.test.ts)). Phase 1 fully closed 2026-06-15.
2. **[DELIVERED 2026-06-15]** A4 exports a self-contained HTML session/trace viewer reusing H1's tokens and `InteractiveArtifact` sanitisation; opening it offline shows the trace timeline. Built as [modules/coding/observability/TraceHtmlExport.ts](../../../../../modules/coding/observability/TraceHtmlExport.ts) (the serializer) plus the `nexus trace export --trace <id> --out <file> --db <path>` CLI subcommand; verified by [tests/unit/observability/TraceHtmlExport.test.ts](../../../../../tests/unit/observability/TraceHtmlExport.test.ts) (26 cases: inline-JSON round-trip, offline-integrity via the shared `findRemoteAssetRefs` checker, static-timeline render, and XSS / `</script>`-breakout sanitisation). Phase 2 closed 2026-06-15.
3. **[DELIVERED 2026-06-15]** A1 dehydrates large session fields out-of-line and rehydrates them on resume; a one-way migration tolerates pre-migration sessions. Built as [core/memory/ArtifactStore.ts](../../../../../core/memory/ArtifactStore.ts) (content-addressed, redaction-on-write file store under `<nexusHome>/session-artifacts/`), [core/memory/sessionArtifacts.ts](../../../../../core/memory/sessionArtifacts.ts) (threshold-gated `dehydrateMessages`/`hydrateMessages` + `{ artifact_ref, preview, kind }` marker), and [core/memory/migrateSessionsDehydrate.ts](../../../../../core/memory/migrateSessionsDehydrate.ts) (one-way migration, mirrored by the [scripts/migrate-sessions-dehydrate.mjs](../../../../../scripts/migrate-sessions-dehydrate.mjs) CLI wrapper), wired into [desktop/sidecar/src/coding/sessionStore.ts](../../../../../desktop/sidecar/src/coding/sessionStore.ts) at the disk I/O boundary (schema v1->v2; pre-v2 files load unchanged). Verified by [TraceHtmlExport-sibling unit tests](../../../../../tests/unit/core/memory/) (ArtifactStore 7, sessionArtifacts 12, migrateSessionsDehydrate 7), the sidecar round-trip + pre-migration-load + redaction test ([desktop/tests/coding-session-dehydration.test.ts](../../../../../desktop/tests/coding-session-dehydration.test.ts), 4 cases), and the size-delta benchmark ([tests/integration/session-state/dehydration-size.test.ts](../../../../../tests/integration/session-state/dehydration-size.test.ts)). Phase 3 closed 2026-06-15.
4. **[DELIVERED 2026-06-15]** A2 renders planner -> worker -> critic sub-runs as a nested tree in the trace dashboard and in A4's export. Built as additive `group_id`/`parent_run_id` span columns (+ an idempotent `ALTER TABLE` migration tolerant of pre-Phase-4 stores) on [modules/coding/observability/TraceStore.ts](../../../../../modules/coding/observability/TraceStore.ts), a new `critic` `SpanKind`, a shared pure-function nesting helper [modules/coding/observability/spanNesting.ts](../../../../../modules/coding/observability/spanNesting.ts) (`flattenSpanForest`), the swarm orchestrator opening one trace + group per `execute()` ([modules/coding/orchestration/Orchestrator.ts](../../../../../modules/coding/orchestration/Orchestrator.ts) reuses the trace root span as the planner run) threading a `SwarmTraceContext` through [modules/coding/orchestration/DAGExecutor.ts](../../../../../modules/coding/orchestration/DAGExecutor.ts) so each worker stamps its parent planner run + group and each critic review emits a `critic` span nested under its worker run, and both renderers ([src/panels/TraceDashboardPanel.ts](../../../../../src/panels/TraceDashboardPanel.ts) + webview, and the A4 [TraceHtmlExport.ts](../../../../../modules/coding/observability/TraceHtmlExport.ts) via the shared helper + [TraceDbReader.ts](../../../../../modules/coding/observability/TraceDbReader.ts)) indenting by depth, falling back to the flat start-time timeline when the fields are absent. Phase 4 closed 2026-06-15.
5. A3 (if built) auto-discovers at least one local-runtime adapter via manifest, restricted to local runtimes, with manifest validation.
6. Updated testing across unit, static (`nexus-check`), integration, e2e, and CI/CD with strong coverage, all passing.

## Constitution Check

*GATE: Must pass before design.* No constitution file found at docs/versions/v1/v1.6.0/constitution.md - skipping check. The cycle is governed by the [AGENTS.md](../../../../../AGENTS.md) MCP Registry Policy and the [README.md](../../../../../README.md) design principles (local-first, no outbound calls, single-GPU ceiling, originality over wrappers). Every phase's Stability Gate enforces them.

## Complexity Tracking

| Item | Complexity driver | Mitigation |
|---|---|---|
| H1 interactive guide (Phase 1) | Medium: faithful design-system port + Nexus-specific content authoring | Lift the `:root` tokens + constellation script verbatim from the reference; author Nexus content section-by-section; everything inline + offline |
| A4 session viewer (Phase 2) | Medium: trace -> HTML serialization + sanitisation | Reuse H1's stylesheet and `InteractiveArtifact` sanitiser; embed the trace JSON inline; no live fetch |
| A1 artifact dehydration (Phase 3) | Medium: changes persisted session format | One-way migration + a read path tolerant of pre-migration sessions (mirror the dense-index -> pruned migration discipline) |
| A2 trace nesting (Phase 4) | Medium: schema change + dashboard render | Additive schema fields (`parent_run_id`/`group_id`/`span_id`); render falls back to flat for traces lacking them |
| A3 adapter registry (Phase 5) | Medium: plugin-discovery surface | Hard-restrict to local runtimes; validate adapter manifests; no arbitrary remote endpoints (cite MCP Registry Policy in the PR) |

## Phases at a Glance

| Phase | Title | Outcome |
|-------|-------|---------|
| 1 | Nexus-AI interactive HTML guide (H1) -- **complete** | Self-contained, offline **user guide** (install/setup + per-pillar usage + harness links) with constellation background + shared design tokens; AS003 offline-integrity + reduced-motion test closed 2026-06-15 |
| 2 | Standalone shareable session/trace viewer (A4) -- **complete** | Portable HTML export of a session trace, reusing H1's tokens + sanitisation; static-first timeline + inline JSON, offline-integrity + sanitisation tests closed 2026-06-15 |
| 3 | Session-state artifact dehydration/hydration (A1) -- **complete** | Large session fields stored out-of-line in a content-addressed, redaction-on-write artifact store + rehydrated on resume; one-way v1->v2 migration tolerant of pre-migration sessions; round-trip + pre-migration-load + size-delta tests closed 2026-06-15 |
| 4 | Hierarchical sub-run trace nesting (A2) -- **complete** | Swarm planner/worker/critic topology legible in the dashboard + A4 export; additive `group_id`/`parent_run_id` span columns + migration, `critic` span kind, shared `flattenSpanForest` nesting helper, depth-indented render with flat fallback; stamping + nesting + critic-span tests closed 2026-06-15 |
| 5 (backlog) | Local-runtime adapter registry (A3) | Config-driven auto-discovery of local inference adapters |
| 6 | FINAL: Nexus-Hub sync + whole-plan acceptance gate | Integration + definition-of-pass verification |

---

## Phase 1: Nexus-AI interactive HTML guide (H1)

**Goal**: Deliver a self-contained, offline interactive guide for Nexus-AI that adopts the Nexus-Hub interactive-guide design system (color scheme + dynamic constellation background), establishing the shared design-token stylesheet that Phase 2 reuses.
**Prerequisites**: None.
**Stability Gate**: The file opens offline with no network requests (verify in browser devtools: zero outbound); no `<script src>` to a remote origin; no remote `@font-face`/CSS; honors `prefers-reduced-motion` (constellation renders one static frame); passes the `InteractiveArtifact` sanitisation rules (no `on*` handlers beyond the self-contained boot script, no `javascript:` URLs).
**Status**: COMPLETE 2026-06-15 (AS001 + AS002 delivered 2026-06-14; the built guide is a 7-page user guide that supersedes the original overview scope below). AS003 (offline-integrity + reduced-motion test) closed 2026-06-15.

### Sub-tasks

#### 1.1 -- H1: Author the Nexus-AI interactive guide shell + design system

- [x] AS001 Create guides/interactive-guide/nexus-ai-guide.html with the shared design tokens + constellation canvas -- **done**: full `:root` palette + constellation animation ported verbatim; verified self-contained

**Objective**: Port the Nexus-Hub guide's design system into a new Nexus-AI guide shell.

**Prompt**:
> Create `guides/interactive-guide/nexus-ai-guide.html` as a single self-contained file (all CSS + JS inline, fonts via system stack, no remote assets). Lift the design system verbatim from the reference guide at `C:/Users/bdour/Documents/Projects/Development/Nexus-Hub/guides/interactive-guide/nexus-hub-guide.html`:
>
> **`:root` design tokens** (use exactly these):
> - Backgrounds: `--bg-deep:#02090c; --bg-0:#04141a; --bg-1:#072530; --bg-2:#0a3a47;`
> - Ink: `--ink:#eaf6f8; --ink-dim:#a7c1c8; --ink-faint:#6f8990;`
> - Brand: `--cyan:#22d3ee; --cyan-soft:#67e8f9; --teal:#2dd4bf; --teal-soft:#5eead4; --blue:#38bdf8; --node-blue:#2f9ee6; --glow:#d7fbff;`
> - Semantic: `--green:#4ade80; --amber:#fbbf24; --red:#f87171; --violet:#a78bfa;`
> - Surfaces: `--surface:rgba(255,255,255,.035); --surface-2:rgba(255,255,255,.06); --surface-3:rgba(255,255,255,.09); --border:rgba(120,224,238,.14); --border-bright:rgba(94,234,212,.34);`
> - Accent gradient: `--grad:linear-gradient(100deg,#38bdf8 0%,#22d3ee 45%,#2dd4bf 100%);` and `--grad-soft:linear-gradient(100deg,rgba(56,189,248,.16),rgba(45,212,191,.16));`
> - Terminal: `--term-bg:#07171d; --term-ink:#cfe9ee; --term-dim:#5f7d84; --term-prompt:#5eead4;`
> - Type: `--sans:"Segoe UI",-apple-system,BlinkMacSystemFont,"Inter",system-ui,Roboto,Helvetica,Arial,sans-serif;` `--mono:"Cascadia Code","JetBrains Mono","SF Mono","Consolas","Liberation Mono",Menlo,monospace;`
> - Layout: `--maxw:1120px; --radius:16px; --radius-sm:10px;` plus the `--shadow` / `--shadow-glow` values.
> - `body` background: the layered `radial-gradient(...) , radial-gradient(...) , linear-gradient(180deg,var(--bg-0) 0%,var(--bg-deep) 65%,#010608 100%)` with `background-attachment:fixed`.
>
> **Constellation canvas** (port the animation logic verbatim): a fixed full-viewport `<canvas id="constellation" aria-hidden="true">` at `z-index:0; pointer-events:none; opacity:.55`. Node count = `clamp(18, floor(innerWidth/34), 46)`; per-node drift velocity `(rand-0.5)*0.16*dpr`; bounce off edges; draw links between nodes within `150*dpr` px in `#2dd4bf` with alpha `(1-d/maxd)*0.45`; draw nodes as `#5eead4` filled circles `r=1.5*dpr` at alpha `0.85`; `requestAnimationFrame` loop with `start()`/`stop()`; respect `prefers-reduced-motion` by rendering a single static frame; lower opacity to `.16` on non-home sections (mirror the reference's section-driven opacity toggle). Cap `dpr` at 2.
>
> The shell must include: a sticky blurred header/nav, a `.container` with `max-width:var(--maxw)`, and a section scaffold ready for the content authored in 1.2. Acceptance: file opens offline with zero network requests; constellation animates on home and dims elsewhere; reduced-motion renders static. Effort: Medium. Risk: Low.

---

#### 1.2 -- H1: Author the Nexus-AI guide content sections

- [x] AS002 Populate the guide with Nexus-AI content -- **done**: built as a 7-page user guide (Home, Install & Setup, Agentic Coding, Image & Video, Chat & Memory, Harness, Reference); content grounded in README/ARCHITECTURE; broader than the original overview scope below

**Objective**: Fill the shell with Nexus-specific content, mirroring the reference guide's structure (intro -> sections -> terminal/code/artifact blocks) but describing Nexus.

**Prompt**:
> Author the content sections of `guides/interactive-guide/nexus-ai-guide.html` using the reference guide's component vocabulary (step cards, terminal blocks `--term-*`, code/artifact panels, tables, git-graph blocks). Cover, grounded in [README.md](../../../../../README.md) and [ARCHITECTURE.md](../../../../../ARCHITECTURE.md): (1) what Nexus is -- "Your Local AI Studio, Four Pillars, One Desktop, Zero Tokens Billed"; (2) the four pillars (Agentic Coding, Chat Explorer, Image Studio, Video Lab); (3) the agent harness -- three-tier orchestration (ReAct -> Plan-and-Execute -> swarm), tiered permissions, dual MCP (host + client), four-layer memory + hybrid RRF retrieval; (4) local-first principles (no outbound by default, single-GPU ceiling, originality over wrappers); (5) the always-on GPU/VRAM telemetry. Keep all copy ASCII, logical punctuation, no em-dashes. Acceptance: every section renders with the shared tokens; no placeholder lorem; content is accurate to the README/ARCHITECTURE capability tables. Effort: Medium. Risk: Low.

---

#### 1.3 -- Testing and stabilization (Phase 1)

- [x] AS003 Add an offline-integrity check + reduced-motion test for the guide -- **done 2026-06-15**: [tests/unit/guides/nexus-ai-guide.offline.test.ts](../../../../../tests/unit/guides/nexus-ai-guide.offline.test.ts) (18 cases) asserts no remote asset references (DOM-aware via node-html-parser, so anchor hrefs, `data:` URIs, and plain-text URLs are not flagged), the constellation canvas is present, and reduced-motion renders one static frame (the lone `requestAnimationFrame` is unreachable when `REDUCE` is true). Runs in CI through the existing `test-ts` job; positive and negative controls guard the checker itself.

**Prompt**:
> Add a lightweight test (or a `scripts/` check) that asserts `guides/interactive-guide/nexus-ai-guide.html` contains no remote asset references (`http(s)://` in `src`/`href`/`@font-face`/`url()` except in-page anchors), and a Playwright/e2e smoke that loads the file, confirms the constellation canvas is present, and confirms reduced-motion mode renders without an animation loop. Acceptance: checks pass in CI. Effort: Low. Risk: Low.

---

## Phase 2: Standalone shareable session/trace viewer (A4)

**Goal**: Turn a session trace into a portable, self-contained HTML artifact that opens offline -- the local-only analogue of aisuite's served trace viewer.
**Prerequisites**: Phase 1 (reuses the shared design-token stylesheet).
**Stability Gate**: Exported file opens offline with zero network; all trace data embedded inline as JSON; HTML routed through the existing `InteractiveArtifact` sanitiser.
**Status**: COMPLETE 2026-06-15. The serializer ([modules/coding/observability/TraceHtmlExport.ts](../../../../../modules/coding/observability/TraceHtmlExport.ts)) lifts the Phase 1 `:root` tokens verbatim, embeds the full span list inline as JSON-safe data, statically pre-renders the timeline (legible with zero JavaScript), and ships an inert bundled boot script for kind-filter + expand/collapse (no fetch, no eval, no timers, no remote). All untrusted trace content is HTML-escaped (text positions) and JSON-escaped (data block), so an injected `<img onerror>` or `</script>` renders inert. Surfaced via a `nexus trace export` CLI subcommand backed by a vscode-free reader ([modules/coding/observability/TraceDbReader.ts](../../../../../modules/coding/observability/TraceDbReader.ts)) that opens the SQLite trace store read-only (`TraceStore` itself transitively requires `vscode` and cannot load in a plain-Node CLI). The animated constellation canvas is intentionally omitted (a shareable export stays inert; the layered gradient carries the brand statically). Verified: lint 0 errors, check:tampering 0 findings, check-architecture 0 errors, tsc build clean, end-to-end CLI smoke against a real SQLite trace DB green, suite 4130 passed / 5 skipped / 0 failed, coverage TraceHtmlExport 100% lines / 88.23% branches / 100% functions and TraceDbReader 100% / 100% / 100%.

### Sub-tasks

#### 2.1 -- A4: Session/trace -> self-contained HTML export

- [x] AS004 Add a trace-export path that serializes a session trace to a self-contained HTML viewer -- **done 2026-06-15**: [TraceHtmlExport.ts](../../../../../modules/coding/observability/TraceHtmlExport.ts) (serializer) + [TraceDbReader.ts](../../../../../modules/coding/observability/TraceDbReader.ts) (vscode-free read-only store reader) + `nexus trace export` CLI + [TraceHtmlExport.test.ts](../../../../../tests/unit/observability/TraceHtmlExport.test.ts) (26 cases) + [TraceDbReader.test.ts](../../../../../tests/unit/observability/TraceDbReader.test.ts) (5 cases, temp-file round-trip). Offline checker extracted to the shared [tests/helpers/offlineIntegrity.ts](../../../../../tests/helpers/offlineIntegrity.ts).

**Prompt**:
> Implement comparison item A4. Add an export path (CLI subcommand and/or a Trace Dashboard action) that serializes a selected session trace from the local trace store into a single self-contained HTML file under `guides/` (or a user-chosen path), reusing the Phase 1 design tokens and the `desktop/src/components/InteractiveArtifact.tsx` sanitisation rules (strip `<script>` except the bundled inert renderer, strip `on*`/`javascript:`, no remote asset URLs). Embed the trace events inline as JSON; the bundled renderer paints a timeline of `run/model/tool` events and per-step metadata with no live fetch. Local-only; no telemetry. Acceptance: a unit test proves the serializer embeds events inline and emits no remote reference; an e2e smoke opens the export offline and renders the timeline. Effort: Medium. Risk: Low.

---

## Phase 3: Session-state artifact dehydration/hydration (A1)

**Goal**: Store large session fields out-of-line with a ref + preview, rehydrate on resume -- extend the command-output compressor across persisted sessions.
**Prerequisites**: None (independent of Phases 1-2).
**Stability Gate**: One-way migration ships; the read path tolerates pre-migration sessions; no behavior change to a resumed session's rendered content.
**Status**: COMPLETE 2026-06-15. Three new `core/memory/` modules (content-addressed `ArtifactStore`, threshold-gated `dehydrateMessages`/`hydrateMessages`, and the `migrateSessionsDehydrate` one-way migration + `.mjs` wrapper) wired into the sidecar `JsonFileSessionStore` purely at the disk I/O boundary -- the in-memory and public `messages: string[]` surfaces are unchanged, so neither `CodingSessionManager` nor the IPC contract changed and pre-v2 (inline-only) session files load verbatim. Secrets are redacted (via `core/observability/redactSecrets.ts`) on both the artifact write and the inline preview. Verified: tsc build clean, desktop typecheck clean, lint 0 errors, check-architecture 0 errors, check:tampering 0 findings, new-module coverage 97.81% lines / 91.66% branches / 100% functions; root suite 4155 passed / 5 skipped (the only 2 reds are pre-existing wall-clock latency budgets -- `HybridRetriever` p99 and `MemoryConsolidator` 10K-event stress -- that pass in isolation and never touch this path), desktop suite 449 passed / 0 failed.

### Sub-tasks

#### 3.1 -- A1: Out-of-line artifact store for large session fields

- [x] AS005 Dehydrate large session fields to an artifact store with rehydrate-on-resume -- **done 2026-06-15**: [core/memory/ArtifactStore.ts](../../../../../core/memory/ArtifactStore.ts) + [core/memory/sessionArtifacts.ts](../../../../../core/memory/sessionArtifacts.ts) + [core/memory/migrateSessionsDehydrate.ts](../../../../../core/memory/migrateSessionsDehydrate.ts) + [scripts/migrate-sessions-dehydrate.mjs](../../../../../scripts/migrate-sessions-dehydrate.mjs) wired into [desktop/sidecar/src/coding/sessionStore.ts](../../../../../desktop/sidecar/src/coding/sessionStore.ts); tests under [tests/unit/core/memory/](../../../../../tests/unit/core/memory/) (26 cases) + [desktop/tests/coding-session-dehydration.test.ts](../../../../../desktop/tests/coding-session-dehydration.test.ts) (4 cases) + [tests/integration/session-state/dehydration-size.test.ts](../../../../../tests/integration/session-state/dehydration-size.test.ts) (size-delta benchmark).

**Prompt**:
> Implement comparison item A1. In the session/memory persistence layer ([core/memory/](../../../../../core/memory/)), dehydrate large message fields (default the `stdout`/`stderr`/`diff`/`patch`/`content` fields above a configurable byte threshold, e.g. 20KB) to a local artifact store (SQLite blob or content-addressed file under `~/.nexus/`), replacing the inline value with `{ artifact_ref, preview, kind }`. On session load/resume, rehydrate refs back to full content. Reuse `core/observability/redactSecrets.ts` on the path so secrets are never written to the artifact store unredacted. Ship a one-way migration and a read path that tolerates sessions stored before this change. Local-only; no new dependency beyond the existing SQLite binding. Acceptance: unit tests prove round-trip dehydrate/hydrate and that a pre-migration session still loads; a benchmark records the persisted-session size delta. Effort: Medium-Low. Risk: Low (additive, migration-gated).

---

## Phase 4: Hierarchical sub-run trace nesting (A2)

**Goal**: Make the v1.5.0 Phase 4 swarm topology legible -- render planner -> worker -> critic sub-runs as a nested tree.
**Prerequisites**: Phase 2 (A4 export should render the nesting too).
**Stability Gate**: Schema fields are additive; the dashboard falls back to a flat view for traces lacking them.
**Status**: COMPLETE 2026-06-15. Additive `group_id`/`parent_run_id` columns on the `spans` table with an idempotent `PRAGMA`-guarded `ALTER TABLE` migration (pre-Phase-4 stores load with both null = flat fallback), a new `critic` `SpanKind`, and a shared render-agnostic nesting helper (`spanNesting.flattenSpanForest`) used by both the dashboard and the A4 export. The swarm orchestrator opens one trace + `groupId` per `execute()` (gated on the tracer being enabled, so the default/ReAct path is byte-equivalent), reuses the trace root span as the planner run, and threads a `SwarmTraceContext` through the `DAGExecutor` so every worker stamps `parentRunId`=planner + `groupId` and each critic review emits a `critic` span nested under its worker run (`SubAgentManager.run` now takes a `SubAgentTraceContext` and returns its `runId`). Verified: lint 0 errors, check-architecture 0 errors (10 pre-existing warnings), check:tampering 0 findings, `tsc -b` clean, suite 4181 passed / 5 skipped / 0 failed, coverage spanNesting 100% lines / 96.3% branches, TraceStore 97.9% / 84.8%, TraceHtmlExport 100% / 90.9%, DAGExecutor 97.1% / 91.1%, Orchestrator 99.4% / 85.4%.

### Sub-tasks

#### 4.1 -- A2: Add sub-run nesting to the trace schema + dashboard

- [x] AS006 Add parent_run_id/group_id/span nesting to traces and render the tree -- **done 2026-06-15**: additive [TraceStore.ts](../../../../../modules/coding/observability/TraceStore.ts) `group_id`/`parent_run_id` columns + migration + `critic` kind; [spanNesting.ts](../../../../../modules/coding/observability/spanNesting.ts) `flattenSpanForest` (nested tree / flat fallback); [Orchestrator.ts](../../../../../modules/coding/orchestration/Orchestrator.ts) + [DAGExecutor.ts](../../../../../modules/coding/orchestration/DAGExecutor.ts) swarm stamping + critic span; [SubAgentManager.ts](../../../../../modules/coding/agents/SubAgentManager.ts) trace-context + `runId`; [TraceDashboardPanel.ts](../../../../../src/panels/TraceDashboardPanel.ts) + webview and [TraceHtmlExport.ts](../../../../../modules/coding/observability/TraceHtmlExport.ts) + [TraceDbReader.ts](../../../../../modules/coding/observability/TraceDbReader.ts) depth-indented render. Tests: [spanNesting.test.ts](../../../../../tests/unit/observability/spanNesting.test.ts) (9), [TraceStore.nesting.test.ts](../../../../../tests/unit/observability/TraceStore.nesting.test.ts) (5, incl. migration), [TraceHtmlExport.nesting.test.ts](../../../../../tests/unit/observability/TraceHtmlExport.nesting.test.ts) (2), [SubAgentManager.nesting.test.ts](../../../../../tests/unit/agents/SubAgentManager.nesting.test.ts) (3), [Orchestrator.swarmTrace.test.ts](../../../../../tests/unit/orchestration/Orchestrator.swarmTrace.test.ts) (2), [DAGExecutor.swarmTrace.test.ts](../../../../../tests/unit/orchestration/DAGExecutor.swarmTrace.test.ts) (3).

**Prompt**:
> Implement comparison item A2. Extend the local trace event schema with additive `parent_run_id`, `group_id`, and `span_id`/`parent_span_id` fields (default null), emitted by the swarm orchestrator ([modules/coding/orchestration/Orchestrator.ts](../../../../../modules/coding/orchestration/Orchestrator.ts) + `SubAgentManager`) so each worker/critic run records its parent planner run and shared group. Update [src/panels/TraceDashboardPanel.ts](../../../../../src/panels/TraceDashboardPanel.ts) (and the A4 export renderer) to render runs as a nested tree grouped by `group_id`, falling back to the existing flat timeline when the fields are absent. Local-only. Acceptance: unit tests prove the orchestrator stamps parent/group ids on sub-runs; a dashboard test proves nested rendering and flat fallback. Effort: Medium. Risk: Low.

---

## Phase 5 (backlog): Local-runtime adapter registry (A3)

**Goal**: Lower the cost of adding a new *local* inference runtime (llama.cpp server, vLLM, MLX) by making adapter registration config/manifest-driven, mirroring aisuite's convention-based provider auto-discovery -- restricted to local runtimes only.
**Prerequisites**: None. **Demand-gated**: build only if a concrete need for a third local runtime is confirmed.
**Stability Gate**: Discovered adapters are hard-restricted to local runtimes; adapter manifests are validated; no arbitrary remote endpoint can be registered.

### Sub-tasks

#### 5.1 -- A3: Convention-driven local-runtime adapter discovery

- [ ] AS007 Add a manifest-validated, local-only adapter registry to core/registry/

**Prompt**:
> Implement comparison item A3 (backlog/demand-gated). Refactor the `LLMClient` adapter wiring ([modules/coding/llm/](../../../../../modules/coding/llm/) + [core/registry/](../../../../../core/registry/)) so a new local adapter is discovered from a validated manifest (name, local endpoint, capabilities) rather than a hand-edited switch. Hard-restrict endpoints to loopback/local sockets; reject any manifest declaring a non-local endpoint and cite the [AGENTS.md](../../../../../../AGENTS.md) MCP Registry Policy in the rejecting error. No cloud providers; this is strictly a local-runtime extensibility pattern. Acceptance: a unit test proves a valid local manifest is discovered and a non-local manifest is rejected with the policy citation. Effort: Medium. Risk: Low (guarded). Build only on confirmed demand.

---

## Phase 6: FINAL -- Nexus-Hub sync + whole-plan acceptance gate

**Goal**: Verify the definition-of-pass, sync any Nexus-Hub touchpoints, run the full test matrix.
**Stability Gate**: `npm run test`, `npm run lint`, `npm run check-architecture`, `npm run security:check` clean; the whole-plan acceptance gate passes; docs (README/ARCHITECTURE/CHANGELOG/known-gaps) updated.

### Sub-tasks

- [ ] AS008 Run the whole-plan acceptance gate (Definition of pass items 1-6) and record results
- [ ] AS009 Update README/ARCHITECTURE/CHANGELOG and v1.6.0 known-gaps; record any deferred item (A3 if not built) in the known-gaps ledger
- [ ] AS010 If the guide/viewer artifacts warrant a Hub touchpoint (e.g. an `html-output-conventions` cross-link), sync to Nexus-Hub

---

## Out-of-Scope appendix (dropped, never implemented this cycle)

| ID | Item | Grounds (MCP Registry Policy) |
|---|---|---|
| D1 | Cloud multi-provider routing (~21 cloud providers) | Outbound + API keys + per-token billing; conflicts with local-first / "Zero Tokens Billed". `future`-watch only: explicit opt-in BYO-key escape hatch, never a default. |
| D2 | Postgres state store | Network DB server; conflicts with single-machine local-first. SQLite four-layer memory already covers persistence. |
| D3 | MCP HTTP / remote transport | Outbound network surface; in-process + stdio MCP already covers the harness. LAN-scoped opt-in is a distant future-watch. |
| D4 | HTTP trace sink + ASR multi-provider | HTTP sink violates no-telemetry-by-default (local JSONL store exists); ASR out of scope (no transcription pillar). |
