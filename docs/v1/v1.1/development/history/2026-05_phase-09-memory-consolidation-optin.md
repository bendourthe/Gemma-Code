# 2026-05-20 -- v1.1.0 Phase 9 -- Opt-in memory consolidation (contradiction resolver + file compressor)

**Plan**: [docs/versions/v1/v1.1.0/plans/phase-09-memory-consolidation-optin.md](../../plans/phase-09-memory-consolidation-optin.md)
**Adopts**: agentmemory A4 + A9 ([docs/versions/v1/v1.1.0/comparison-agentmemory.md](../../comparison-agentmemory.md) Section 11.3 P2)
**Status**: Complete. 3 sub-tasks landed end-to-end with the quality gate green.

---

## Subtasks completed

### 9.1 -- Opt-in `ContradictionResolver`

- New module: [core/memory/ContradictionResolver.ts](../../../../versions/core/memory/ContradictionResolver.ts).
- Detection heuristic exactly as the plan specified: `denseSimilarity > 0.85 AND bm25Jaccard < 0.4 AND text.length >= 20`.
- `detect(entry)`: scans every live semantic-tier row returned by the injected `SemanticTierProvider.list()` and returns the candidate pairs satisfying the predicate. Pure detection -- no LLM call, no mutation -- so callers can safely invoke it regardless of the consolidation toggle.
- `resolve(group)`: short-circuits when `enabled === false`; otherwise sends a single-line JSON adjudication prompt to the injected `OllamaChatLike.chat(prompt)`, parses the `{"winner":"A"|"B","justification":"..."}` reply via the tolerant `parseAdjudication` helper, and calls `provider.markSuperseded(loserId, winnerId, log)` with a structured `ResolutionLogEntry` carrying the timestamp, model id, justification, and both threshold values.
- `sweep()`: walks every row, pre-computes embeddings once, runs the O(N^2) pairwise predicate, adjudicates each group, and returns `{scanned, groups, resolved, llmCalls}`. Short-circuits with zero LLM calls when consolidation is disabled -- the integration test asserts this directly.
- Helpers `bm25Jaccard(a, b)`, `cosineSimilarity(a, b)`, `buildAdjudicationPrompt(a, b)`, and `parseAdjudication(raw)` are exported so downstream code (and tests) can compose the predicate independently.
- `createContradictionSweepTask(resolver)` returns an `IdleTimeScheduler.register`-compatible task: `id = "memory.contradiction-sweep"`, `cadenceMs = 1 hour`, `idleThresholdMs = 5 minutes`. The sidecar wiring is deferred under open item 9.1.P2.W (clusters with the same `MemoryStore`-backed adapter that holds 5.6.P2.O and 6.6.P2.S).
- The structural `SemanticTierProvider` / `OllamaChatLike` interfaces avoid a circular dep with `src/llm/OllamaClient.ts` and keep `core/memory/` free of `src/agents/` deps.

### 9.2 -- Opt-in `FileCompressor` + `nexus memory compress` CLI + `/memory-compress` slash command

- New module: [core/memory/FileCompressor.ts](../../../../versions/core/memory/FileCompressor.ts).
- `compressFile(sourcePath, provenance)`:
  1. Reads the file via the injectable `readFile` port (defaults to `fs.readFile(path, "utf8")`).
  2. Validates size against `maxFileBytes` (default 10 MiB).
  3. Chunks via `chunkText(text, chunkTokens = 2_000)` -- splits at paragraph / line / whitespace boundaries when possible, falls back to a hard char-count cut.
  4. Caps chunks at `maxChunks` (default 32) to keep cost bounded.
  5. For each chunk: builds the prompt via `buildCompressionPrompt(shard, i, total)`, calls `ollama.chat(prompt)`, parses the `{"summary":"...","key_facts":[...],"code_patterns":[...]}` reply via `parseShardExtraction`.
  6. Aggregates the shards into one `CompressedObservation` (dedupes key facts and code patterns order-preservingly).
  7. Renders the observation as Markdown via `renderObservationContent` (summary, chunk count, model, key-fact bullets, code-pattern bullets).
  8. Embeds the rendered content once via the injected `Embedder` (per-chunk embedding deferred under 9.2.P2.Y).
  9. Writes the row via `writer.upsert({id, content, provenance, metadata, embedding})` with `provenance.toolName = "memory.compress"`, `metadata.sourcePath = <path>`, `metadata.chunkCount`, `metadata.model`.
  10. When a `GraphLinker` is supplied, writes a `memory.compress.source` edge to `file://<sourcePath>`.
- Stable per-path entry id via `compressionEntryId(path)` so re-compressing overwrites the previous observation instead of duplicating.
- Result kinds: `compressed | disabled | empty | too-large | llm-failed` -- every error path is exercised by the unit suite.
- The `enabled` gate (`nexus.memory.compression.enabled`) short-circuits before any LLM call; the integration test asserts `invocationCount === 0` when the toggle is off.

- **CLI** ([bin/nexus.mjs](../../../../versions/bin/nexus.mjs)):
  - `nexus memory compress --file <path> [--session <id>] [--model <name>] [--dry-run]` lands as a new `runMemoryCompress` handler routed through `runMemoryCommand`.
  - Loads compiled `out/core/memory/FileCompressor.js` + `out/core/memory/LocalEmbedder.js`.
  - Wires a recording stub `OllamaChatLike` so the operator can inspect what the production sidecar would have sent without spinning up the daemon.
  - Renders one summary line plus a content preview on success; surfaces every non-`compressed` kind on stderr with the appropriate exit code.

- **Slash command** ([core/memory/MemorySlashCommands.ts](../../../../versions/core/memory/MemorySlashCommands.ts), [desktop/src/modules/coding/slashCommands.ts](../../../../versions/desktop/src/modules/coding/slashCommands.ts)):
  - New `memory-compress` entry in the autocomplete catalog.
  - New `handleMemoryCompress(input, ctx)` handler in `MemorySlashCommands.ts`.
  - Validates path argument, validates the compressor is wired and enabled, delegates to `compressor.compressFile(...)`, writes a `write` row to the audit log tagged with `hookKind: "slash.memory.compress"` + `toolName: "memory.compress"`, renders the success payload as a fenced JSON block.
  - Daemon-side dispatcher wiring deferred under open item 9.2.P2.X (waits on `src/chat/` -> `modules/coding/chat/` migration in 1.4.P1.B).

### 9.3 -- Lint, build, test gate

- `npm run build`: clean (`tsc` 0 errors).
- `npm test` (root vitest): 3281 passing / 5 skipped / 0 failing across 281 files (62 new Phase 9 tests).
- `npm run lint` (eslint `src/`): clean.
- `npm run check-architecture`: 6 pre-existing warnings; 0 errors; no new graph violations from Phase 9.
- Coverage on the three new core files: `ContradictionResolver.ts` 92.78%, `FileCompressor.ts` 93.77%, `MemorySlashCommands.ts` 93.95% -- all comfortably above the 80% gate.

---

## Settings schema

Two new VS Code settings entries declared in [package.json](../../../../versions/package.json):

| Key | Default | Effect when `true` |
|---|---|---|
| `nexus.memory.consolidation.enabled` | `false` | The `memory.contradiction-sweep` worker runs on the 1-hour cadence and adjudicates contradicting semantic-tier pairs via the local Ollama model. |
| `nexus.memory.compression.enabled` | `false` | `nexus memory compress --file <path>` and the `/memory-compress <path>` slash command are allowed to call the local Ollama model and write a semantic-tier observation. |

Both descriptions explicitly note the "off by default; no LLM call when off" invariant so the user understands the trade-off before flipping the toggle.

---

## Files touched

- **New core files**: `core/memory/ContradictionResolver.ts`, `core/memory/FileCompressor.ts`.
- **New test files**: `tests/unit/core/memory/ContradictionResolver.test.ts`, `tests/unit/core/memory/FileCompressor.test.ts`, `tests/integration/memory-consolidation-optin.test.ts`.
- **Updated source**: `core/memory/MemorySlashCommands.ts` (new `handleMemoryCompress` handler + `MemoryCompressContext`), `bin/nexus.mjs` (new `runMemoryCompress` + dispatch entry), `desktop/src/modules/coding/slashCommands.ts` (new autocomplete entry), `package.json` (two new settings entries).
- **Updated tests**: `tests/unit/core/memory/MemorySlashCommands.test.ts` (4 new `handleMemoryCompress` cases).
- **Documents**: `docs/versions/v1/v1.1.0/known-gaps.md` (Phase 9 closures + three new P2 deferrals + summary refresh), `docs/DEVLOG.md` (this phase entry), this session history.

---

## Open items added

- **9.1.P2.W (DF, P2)**: `memory.contradiction-sweep` IdleTimeScheduler binding deferred to the sidecar adapter cluster that holds 5.6.P2.O / 6.6.P2.S.
- **9.2.P2.X (DF, P2)**: `/memory-compress` sidecar dispatcher wiring deferred to the 1.4.P1.B `src/chat/` migration; the handler is fully unit-tested.
- **9.2.P2.Y (NI, P2)**: File compressor embeds the aggregated observation, not each chunk. Per-chunk embedding lands when the SQLite schema gains a `memory_compress_shards` child table.

---

## Next steps

- **Phase 10** (VS Code extension thin-adapter rewrite + Marketplace re-publish): reduces `src/extension.ts` from 445 lines to ~200 and flips the manifest IDs to `nexus.coding.*` on the marketplace listing. See [docs/versions/v1/v1.1.0/plans/phase-10-vscode-thin-adapter-and-republish.md](../../plans/phase-10-vscode-thin-adapter-and-republish.md).
- **Sidecar adapter cluster**: the four-worker family (`memory.warm-rebuild` / `memory.decay-sweep` / `memory.contradiction-sweep` plus the `MemoryStore` export adapter) is now blocked on the same single piece of plumbing -- a thin `MemoryStore`-backed `SemanticTierProvider` / `WarmRebuildSource` / `DecayProvider` adapter. Tracked as a clustered follow-up across 5.6.P2.O, 6.1.P2.P, 6.2.P2.Q, 6.5.P2.R, 6.6.P2.S, and 9.1.P2.W.
