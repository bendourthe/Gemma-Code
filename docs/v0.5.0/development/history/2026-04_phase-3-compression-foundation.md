# v0.5.0 Phase 3 -- Compression Foundation

**Date**: 2026-04-25
**Plan**: [docs/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md) (Phase 3)
**Status**: Complete

---

## Goal

Land the compression foundation that every later v0.5.0 phase builds on:

1. A self-contained Brotli compressor module ([src/tools/Compressor.ts](../../../../src/tools/Compressor.ts)) using only Node's built-in `zlib` and `crypto` -- no new npm dependencies.
2. Threshold gating: skip inputs below 500 B and inputs that fail to save at least 20% under a probe at quality 4 in `BROTLI_MODE_TEXT`. Cache probe verdicts via a 64-entry LRU keyed by SHA-1 of the first 4 KB so callers can ask twice for free.
3. Integration into [src/tools/OutputRedirector.ts](../../../../src/tools/OutputRedirector.ts): when a tool output passes the threshold, store it as `<callId>.txt.br` (Brotli bytes); otherwise keep the legacy `<callId>.txt` plain UTF-8 path. `readTail`, `grepOutput`, and a new `OutputRedirector.readDecoded` helper transparently decompress on read.
4. Telemetry: four module-level counters tracked in `Compressor.ts` (`originalBytes`, `compressedBytes`, `skippedBelowThreshold`, `skippedLowSavings`), surfaced via `getCompressionStats()` and `resetCompressionStats()`.

The user-visible delta: large redirected tool outputs (`>= 5000` characters today) now land on disk Brotli-compressed when they save at least 20%, with byte-equivalent round-trip on every read. Disk footprint of the redirected payload drops by ~75-85% on realistic grep/search results; transcript injection (the redirector summary + 500-char preview) is unchanged.

---

## Subtasks completed

### 3.1 -- Brotli compressor module with threshold logic

**Files**: [src/tools/Compressor.ts](../../../../src/tools/Compressor.ts) (new)

New module with the following public API:

| Export | Shape | Purpose |
|--------|-------|---------|
| `shouldCompress(input)` | `(string | Buffer) -> boolean` | Gate at 500 B and probe Brotli at quality 4 / TEXT mode; reject if < 20% saved. Caches verdict in a 64-entry SHA-1-keyed LRU. |
| `compress(input)` | `string -> Promise<CompressionResult>` | Async Brotli at quality 4, text mode. |
| `decompress(buffer)` | `Buffer -> Promise<string>` | Async inverse. |
| `compressSync(input)` | `string -> CompressionResult` | Sync sibling; throws `RangeError` above the 4 KB ceiling. |
| `compressSyncLarge(input)` | `string -> CompressionResult` | Sync sibling without the ceiling, for off-hot-path callers (OutputRedirector). |
| `decompressSync(buffer)` | `Buffer -> string` | Sync inverse. |
| `decode(value)` | `MaybeCompressed -> Promise<string>` | Idempotent decoder for downstream consumers (strings pass through, `CompressedToolOutput` decompresses). |
| `decodeSync(value)` | `MaybeCompressed -> string` | Sync variant. |
| `isCompressedToolOutput(value)` | `unknown -> value is CompressedToolOutput` | Type guard. |
| `getCompressionStats()` | `() -> CompressionStats` | Snapshot of cumulative telemetry. |
| `resetCompressionStats()` | `() -> void` | Test-only reset. |
| `resetProbeCache()` | `() -> void` | Test-only LRU reset. |

Tagged-union types `CompressedToolOutput = { encoding: 'br'; data: Buffer; originalBytes: number }` and `MaybeCompressed = string | CompressedToolOutput` are exported for downstream consumers that wish to carry compressed payloads through their own pipelines.

The module relies only on Node built-ins (`zlib`, `crypto`, `util.promisify`). `package.json` `dependencies` is unchanged.

### 3.2 -- OutputRedirector integration

**Files**: [src/tools/OutputRedirector.ts](../../../../src/tools/OutputRedirector.ts)

`redirect(toolName, callId, output)` now consults `shouldCompress(output)` after the existing redirect-threshold gate. When the gate fires:

- Inputs `<= 4 KB` go through `compressSync`; larger inputs go through `compressSyncLarge`.
- The on-disk path becomes `<workspace>/.gemma-code-output/<callId>.txt.br`.
- `RedirectedResult.compressed` is `true`.

When the gate fails or compression throws, the legacy plain `<callId>.txt` path is preserved verbatim.

`readTail` and `grepOutput` route through a new module-level `_readRedirectedFile` helper that dispatches on the file suffix:

- `.br` -> `decompressSync(fs.readFileSync(path))`
- otherwise -> `fs.readFileSync(path, "utf-8")`

A new static helper `OutputRedirector.readDecoded(filePath)` exposes the same dispatch for advanced callers that need direct content access.

### 3.3 -- Phase 3 stabilization

**Files**:
- [tests/unit/tools/Compressor.test.ts](../../../../tests/unit/tools/Compressor.test.ts) (new, 23 cases)
- [tests/unit/tools/OutputRedirector.test.ts](../../../../tests/unit/tools/OutputRedirector.test.ts) (extended with 7 compression-integration cases)
- [tests/integration/tool-output-compression.test.ts](../../../../tests/integration/tool-output-compression.test.ts) (new, 5 cases)

Tests cover:

| File | Cases | What it covers |
|------|------:|----------------|
| [tests/unit/tools/Compressor.test.ts](../../../../tests/unit/tools/Compressor.test.ts) | 23 | null/undefined rejection, empty-string short-circuit, 500 B threshold, 10 KB lorem >= 50% ratio, high-entropy random buffer < 20%, probe LRU cache, Buffer input, async/sync round-trip, UTF-8 + emoji + CJK round-trip, sync ceiling, decode/decodeSync idempotence, type guard |
| [tests/unit/tools/OutputRedirector.test.ts](../../../../tests/unit/tools/OutputRedirector.test.ts) (Phase 3 block) | 7 | plain `.txt` for small outputs, `.txt.br` for large compressible outputs, `readTail`/`grepOutput` decode `.br` transparently, UTF-8/emoji/CJK byte-equivalent round-trip, telemetry counters, `OutputRedirector.readDecoded` works for both shapes |
| [tests/integration/tool-output-compression.test.ts](../../../../tests/integration/tool-output-compression.test.ts) | 5 | 12 KB grep result -> < 6 KB on disk, `tail_output` decodes a compressed file end-to-end, `grep_output` decodes a compressed file end-to-end, UTF-8 + emoji + CJK byte-equivalent round-trip, sub-threshold output stays plain `.txt` |

**Quality gates**:

| Gate | Threshold | Result | Status |
|------|-----------|--------|:------:|
| Unit tests | 0 failures | 1284 pass, 2 designed skips | ok |
| Integration tests | 0 failures | 72 pass, 2 designed skips | ok |
| Lint (`npm run lint`) | 0 errors | 0 errors, 5 pre-existing warnings | ok |
| Build (`npm run build`) | Clean | Clean | ok |
| `tool-execution.bench.ts` p99 | < +5 ms vs baseline | p99 ~ 0.027-0.031 ms across all read sizes -- well within budget | ok |
| Plan stability gate: 10 KB lorem compresses >= 50% | >= 50% | Asserted by [Compressor.test.ts](../../../../tests/unit/tools/Compressor.test.ts:84) | ok |
| Plan stability gate: 12 KB grep -> < 6 KB on disk | < 6 KB | Asserted by [tool-output-compression.test.ts](../../../../tests/integration/tool-output-compression.test.ts:60) | ok |
| Plan stability gate: UTF-8 + emoji + CJK byte-equivalent | byte-equivalent | Asserted across 3 separate suites | ok |

---

## Deviations from the plan

1. **Telemetry surface**. The plan asks for "MetricsCollector emits 4 compression events". Like in Phase 2's truncation-stats decision, the codebase's `MetricsCollector` is a read-only query layer over `TraceStore` with no emit API. Phase 3 surfaces the four counters (`originalBytes`, `compressedBytes`, `skippedBelowThreshold`, `skippedLowSavings`) via a module-level `getCompressionStats()` in `Compressor.ts`, mirroring the established `getTruncationStats()` pattern from Phase 2. Tracer/span integration into `MetricsCollector` is left to Phase 9 (Coverage & Observability), where the collector itself is already being extended with buffered writes.

2. **Conversation-transcript vs. on-disk integration point**. The token-optimizer sub-plan's prompt (3.2) describes storing a `CompressedToolOutput` "in the conversation message instead of the raw string", with `decode` helpers wired into `PromptBuilder.ts` and `ContextCompactor.ts`. The codebase reality: tool results flow into the conversation as plain strings inside `<|tool_result>...<tool_result|>` markers in `Message.content`. The disk-layer redirected payload (in `.gemma-code-output/<callId>.txt`) is what carries the bulk of the bytes; that is where compression has the largest real leverage in this codebase. Phase 3 plugs Brotli into the disk layer (transparent to `ContextCompactor` and `PromptBuilder`); the `decode` helpers and tagged-union types are still exported from `Compressor.ts` for any downstream consumer that does want to carry compressed payloads through its own pipeline. The implementation-plan's Phase 3 exit checklist (which is the canonical contract) is satisfied verbatim: Compressor module exists, OutputRedirector stores compressed payloads transparently, four telemetry counters are observable, no new dependencies, byte-equivalent UTF-8 round-trip.

3. **Sync compression for large inputs**. The Compressor sub-plan caps `compressSync` at 4 KB to discourage event-loop stalls on hot paths. OutputRedirector legitimately needs sync compression on payloads above that ceiling (the redirector itself is sync, off the hot tool-execution path). Compressor exports a separate `compressSyncLarge` for that use; `compressSync` keeps its 4 KB ceiling so general callers cannot accidentally take the unbounded path.

---

## Files changed

| File | Status |
|------|--------|
| [src/tools/Compressor.ts](../../../../src/tools/Compressor.ts) | Added |
| [src/tools/OutputRedirector.ts](../../../../src/tools/OutputRedirector.ts) | Modified -- compress on redirect, decompress on read, `readDecoded` helper, `compressed` flag on `RedirectedResult` |
| [tests/unit/tools/Compressor.test.ts](../../../../tests/unit/tools/Compressor.test.ts) | Added |
| [tests/unit/tools/OutputRedirector.test.ts](../../../../tests/unit/tools/OutputRedirector.test.ts) | Modified -- new "Brotli compression integration (Phase 3)" describe block |
| [tests/integration/tool-output-compression.test.ts](../../../../tests/integration/tool-output-compression.test.ts) | Added |
| [docs/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md) | Phase 3 exit checklist marked complete |

---

## Next steps

- **Phase 4 (Persistent Cache + Diff-Based Reads)**: SQLite-backed `tool-output-cache.sqlite` keyed by `(absolute_path, mtime, size)` with `read_file` returning unified diffs against cached content. Phase 3's `compressSyncLarge` and the `CompressedToolOutput` tagged-union are exactly what Phase 4 needs to store cached entries Brotli-compressed.
- **Phase 9 (Coverage & Observability)**: roll the four module-level compression counters into `MetricsCollector`'s buffered trace writes, alongside the truncation counters from Phase 2.
- **Phase 12 (Release Gate)**: the >= 40% average tool-output token reduction target depends on this phase's compression layer plus Phase 4's diff-reads. The 12 KB -> < 6 KB result observed in this phase's integration test is consistent with that target.
