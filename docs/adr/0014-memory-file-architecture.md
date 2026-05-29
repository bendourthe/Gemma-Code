# ADR-0014: Memory file architecture (Instructions / Memory / Context / Archive)

- **Status**: Accepted
- **Date**: 2026-05-07
- **Deciders**: v0.7.0 cycle owners (Phase 2 author + Phase 5 author)

## Context

v0.5.0 / v0.6.0 stored cross-session memory in a single SQLite-backed `MemoryStore`, surfaced through `/memory save | search | clear | status | lint`. Two friction points emerged in production:

1. **No user-visible editor.** Every memory write went through the model or `/memory save`. Reviewing accumulated memory required `/memory search` and could not be edited in-place. The user had to issue `/memory clear` (destructive) and then re-save individual entries to correct an erroneous fact.
2. **No portability or audit trail.** SQL rows could not be copied between machines, exported for review, or version-controlled. A misclassified `pattern` row was effectively permanent until the user pruned the whole table.

S2's "Building a second brain" article (referenced in [comparison-multi-source.md Section 9.3 entry C17](../v0.7.0/comparison-multi-source.md)) proposed a four-file architecture under `~/.<tool>/memory/<workspace-id>/`:

- `Instructions.md` -- "who you are / what you do / rules / what good outputs look like"
- `Memory.md` -- preferences / corrections / patterns / decisions
- `Context.md` -- about-this-project / audience / tools / important background
- `Archive/<YYYY-MM-DD>/` -- weekly snapshots

The architecture is human-editable, diffable, and round-trips through `cp` / `git`. The original single-layer SQL design remains valuable for fast keyword search and embedding-driven semantic recall, so the file architecture is layered alongside SQL rather than replacing it.

## Decision

Adopt the four-file architecture as a co-equal memory layer sitting alongside the SQL `MemoryStore`. Concretely:

1. **New module** [src/storage/MemoryFiles.ts](../../src/storage/MemoryFiles.ts) owns I/O, mtime-keyed read caching, archive snapshots, append-to-section, regex remove, JSON export, and merge / replace import. Construction takes `(workspaceId, baseDir)`; `deriveWorkspaceId(absolutePath)` derives the stable `<basename>-<10-hex-sha1>` directory name.
2. **PromptBuilder consumes both layers.** [src/chat/PromptBuilder.ts](../../src/chat/PromptBuilder.ts) injects the merged file contents into every prompt in the documented order: bundled system prompt -> Instructions.md -> Context.md -> SQL-backed memories (filtered) -> Memory.md (last, so the user's most-recent edits dominate).
3. **On conflict, the file wins.** When the same key appears in both `Memory.md` and the SQL store, the SQL row is filtered out of the prompt. This preserves user authorship -- the file is what the user edited; the SQL row may have been written autonomously.
4. **Slash-command surface (Phase 2 + Phase 5).** Six new verbs: `init [--force]`, `archive`, `edit [section]`, `forget <pattern> [--include-sql]`, `export <path>`, `import <path> [--mode=merge|replace]`. SQL-backed memories from a foreign export are NEVER silently re-imported.
5. **Archive on schedule.** New setting `gemma-code.memoryAutoArchive: "off" | "weekly" | "monthly"` (default `"off"`) silently snapshots the three files on session start when the most recent archive is older than 7 / 30 days respectively.
6. **Manual MemoryPanel webview (Phase 5).** A new sidebar webview at `gemma-code.memoryPanel` exposes the three files plus the SQL-backed rows plus the archive list, with "Open in editor", "Promote to Memory.md", "Delete", "Archive now", and "Restore" actions wired through typed message protocol.
7. **Path-guard everywhere.** `MemoryFiles.appendToMemory` / `import` reject any line / path that matches the secret-path denylist. `MemoryFiles.removeFromMemory` rejects raw `.*` patterns to prevent accidental file blow-out.

## Consequences

- Positive:
  - The user owns the memory layer they care about. Reviewing, editing, version-controlling, and porting the four files is a normal workflow.
  - The model continues to receive a consistent system prompt because PromptBuilder merges both layers deterministically.
  - The MemoryPanel reduces support friction -- "where did the model learn that?" is answerable by tabbing through the panel.
  - Archive snapshots give a trivial undo path for accidental Memory.md mutations.
- Negative:
  - The model now reads two memory layers and must understand the precedence rule. Mitigated by the deterministic PromptBuilder merge order; the model never sees the layering ambiguity directly.
  - Two writers (file + SQL) for adjacent concepts. Mitigated by `/memory save` continuing to write SQL only; users pick the layer explicitly via the new section flag in `appendToMemory`.
  - More moving parts at session bootstrap (MemoryFiles construction, mtime cache warm-up, optional auto-archive). Bounded by the mtime cache -- after the first read, the cost is O(1) until a file changes.
- Neutral:
  - The SQL store is unchanged in shape; `MemoryStore.deleteById` is the only addition Phase 5 made (used by `/memory forget --include-sql` and the MemoryPanel "Promote / Delete" actions).

### v0.8.0 Phase 2 amendment (item A1) -- frozen memory snapshot

The original v0.7.0 design has `PromptBuilder` calling `MemoryFiles.read()` (mtime-cached) on every prompt build. That kept memory edits *live* across mid-session writes, but every disk write changed the prompt prefix bytes and busted the LLM's prefix cache.

v0.8.0 Phase 2 introduces `MemorySnapshot` (`src/storage/MemorySnapshot.ts`). The host captures an immutable snapshot of the three files at session start and pins it on `PromptBuilder` via the new constructor argument / `setMemorySnapshot()` setter. While the snapshot is attached and in `frozen` mode (the default), `_readFileMemory()` returns the captured contents -- mid-session writes still land on disk via `appendToMemory` / `import` (so the next session sees them) but the rendered prompt remains byte-stable.

A new setting `gemma-code.memorySnapshotMode = "frozen" | "live"` (default `frozen`) exposes the trade-off. `live` preserves the v0.7.0 behaviour for users who want real-time prompt reflection at the cost of cache churn.

Tests: `tests/unit/storage/MemorySnapshot.test.ts` (snapshot capture immutability, frozen vs live mode), and `tests/unit/chat/PromptBuilder.test.ts` (prompt byte-stability across mid-session write in `frozen` mode; prompt reflects new content in `live` mode).

## Alternatives considered

- **Replace SQL with files.** Rejected -- the SQL store backs FTS5 keyword search and Ollama-generated embedding similarity. Replacing it with raw files would have forced an in-memory index rebuild on every prompt build, breaking the v0.5.0 latency budget.
- **Keep file architecture user-only; do not inject into PromptBuilder.** Rejected -- without prompt injection, the file becomes a documentation pretense rather than a memory layer. The whole point of S2's design is to make the model see the file's content.
- **Adopt only `Memory.md` (skip Instructions / Context).** Rejected -- the three sections separate concerns the user reasons about distinctly (identity vs. project background vs. accumulated lessons). Collapsing into one file forces the user to manually section a single document, which they did not do reliably during a 1-week prototype.
- **Per-section JSON files.** Rejected -- JSON is not human-editable. Plain Markdown is the smallest format that respects the editing target audience.

## Links

- Related: [comparison-multi-source.md Section 9.3 entry C17](../v0.7.0/comparison-multi-source.md)
- Implementation: Phase 2 commit `1cd5afc` (file architecture, PromptBuilder wiring, init / archive / edit verbs); Phase 5 commit (forget / export / import verbs + MemoryPanel)
- Architecture sync: [docs/archive/versions/v0/v0.7.0/architecture.md](../v0.7.0/architecture.md) Section 2 ("Memory file architecture")

## Numbering note

The v0.7.0 plan referred to this ADR as "ADR-0007"; the slot was already taken by [ADR-0007: Permission-tier floor](./0007-permission-tier-floor.md). This is the same numbering deviation pattern as Phase 4 ([ADR-0013: Webview render protocol](./0013-webview-render-protocol.md)), where "ADR-0008" had also been previously claimed. The lesson logged in [docs/archive/versions/v0/v0.7.0/known-gaps.md](../v0.7.0/known-gaps.md) is to allocate ADR numbers at plan-time, not at write-time.
