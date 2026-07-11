# Phase 6 -- Memory lifecycle CLI + Ebbinghaus decay + slash commands

**Goal**: Surface user-facing memory commands and run the decay sweep on idle.
**Prerequisites**: Phase 4 (provenance), Phase 5 (retrieval -- `/recall` uses it).
**Stability Gate**: `nexus memory audit --since 2026-05-01` prints a tabular log; `nexus memory export --out <file>` writes JSONL; `/recall <query>`, `/remember <text>`, `/forget --id <uuid>` all work in the chat UI; the `DecaySweep` worker evicts entries whose `lastAccessedAt` is older than `halfLife * 7` from the working tier (default half-life 24 h).

**Adopts**: agentmemory A3 + A10 + A11 + A12 (see [comparison-agentmemory.md](../comparison-agentmemory.md) Section 11.2 P1).

---

## Sub-tasks

### 6.1 -- `nexus memory audit` CLI

**Objective**: Tabular audit of memory writes (and reads) with provenance.

**Prompt**:
> Add `nexus memory audit [--since <ISO>] [--tier working|episodic|semantic|graph] [--scope <id>] [--format table|json]` to [bin/nexus.mjs](../../../../bin/nexus.mjs). Implementation in `core/memory/MemoryAudit.ts`. Reads from `memory_entries` + `memory_audit_log` (a new lightweight log table written on every read/write/delete; add to the Phase 4 migration). Output columns: timestamp, op (write/read/delete), tier, entryId, sessionId, hookKind, toolName, textPreview. Acceptance: a unit test seeds a synthetic log and asserts the CLI's table output is well-formed; `--format json` produces valid JSONL.

---

### 6.2 -- `nexus memory export` CLI

**Objective**: Export memory rows to portable JSONL.

**Prompt**:
> Add `nexus memory export --out <file> [--scope <id>] [--tier <list>] [--since <ISO>]` to [bin/nexus.mjs](../../../../bin/nexus.mjs). Implementation in `core/memory/MemoryExport.ts`. Output: one JSONL line per row, full row contents (text, vector base64, provenance, tier, timestamps). The output path is clamped to `~/.nexus/exports/` (no path traversal). Acceptance: a unit test exports a small corpus and reimports it via `nexus memory import` (matching subcommand added in the same sub-task, opt-in) and asserts round-trip integrity.

---

### 6.3 -- `/recall <query>` slash command

**Objective**: Surface a chat-side hybrid-search command.

**Prompt**:
> Add `/recall <query>` to the SlashCommandRouter ([modules/coding/chat/SlashCommandRouter.ts](../../../../src/chat) post-Phase-1.4 layout). Implementation calls `HybridRetriever.retrieve(query, {scopeId: currentScope, limit: 10})` and renders the top-10 results in the chat as a fenced JSON block with `text`, `tier`, `score`, `provenance`. The user can click a result to copy its text or to navigate to the source span in the Trace dashboard. Acceptance: an integration test runs `/recall "Python"` in a synthetic session and asserts a `RenderedTurn` carries the expected hits.

---

### 6.4 -- `/remember <text>` slash command

**Objective**: Surface a chat-side memory-write command.

**Prompt**:
> Add `/remember <text>` to the SlashCommandRouter. Writes a working-tier observation with `provenance: {sessionId, hookKind: "slash.remember", toolName: null, parentSpanId: <currentSpan>}`. Acceptance: an integration test runs `/remember "Always use ruff"` and asserts a memory row appears with the expected fields.

---

### 6.5 -- `/forget --id <uuid> | --pattern <regex>` slash command + Memory panel button

**Objective**: Surface a user-driven delete command with confirmation.

**Prompt**:
> Add `/forget` to the SlashCommandRouter; accepts `--id <uuid>` (exact) or `--pattern <regex>` (matches `text` field). Both modes prompt for confirmation via the existing `ConfirmationGate`. On confirm, deletes the rows and writes an audit-log entry. Add a "Forget" button on each row in the Memory panel ([desktop/src/modules/coding/panels/MemoryPanel.tsx](../../../../desktop/src/modules/coding/panels/MemoryPanel.tsx)) that calls `memory.delete(id)` IPC -> sidecar handler -> `MemoryHub.delete(id)`. Acceptance: an integration test creates 3 rows, runs `/forget --pattern "test"`, confirms, asserts only the matching row is deleted and the audit log carries the delete.

---

### 6.6 -- Ebbinghaus `DecaySweep` worker

**Objective**: Periodically evict stale memories using a closed-form Ebbinghaus retention curve.

**Prompt**:
> Add [core/memory/DecaySweep.ts](../../../../core/memory/DecaySweep.ts). Per-tier half-lives (configurable via Settings): working = 24 h, episodic = 7 d, semantic = 30 d, graph = 365 d. On every access (read), update `lastAccessedAt` and increment `accessCount`. The decay function is `retention = exp(-elapsed / halfLife * ln(2))` where `elapsed = now - lastAccessedAt`. If `retention < 0.05` AND `accessCount < 3`, evict the row (move to a `tombstoned` table for 30 d in case of recovery). Register the sweep as an `IdleTimeScheduler` worker with a 24-hour cadence. Add `nexus memory decay --now` to force a sweep for debugging. Acceptance: a unit test with a fast-clock fixture writes 100 rows, advances the clock 7 days, runs the sweep, asserts the expected eviction count (within 5% of the math).

---

### 6.7 -- Phase 6 lint, build, test gate

**Objective**: Verify the CLI + slash commands + decay are CI-green.

**Prompt**:
> Re-run the four-step gate. Acceptance: 0 failures; the new commands + decay tests are green.
