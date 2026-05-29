# v0.5.0 Phase 2 -- Tool Surface Hardening

**Date**: 2026-04-25
**Plan**: [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md) (Phase 2)
**Status**: Complete

---

## Goal

Land every adoption item in Phase 2 of the v0.5.0 implementation plan:

1. Universal 64 KB byte-cap with structured truncation hint applied to every tool output
2. Pagination on `read_file` via `range_start` / `range_end` (1 MB window cap)
3. Pagination on `grep_codebase` via `max_results` / `next_offset` (opaque base64 cursor)
4. Audit and rewrite every error message in the tool handlers so each contains the failing parameter name and a `Usage:` hint
5. Null-safety baseline test that exercises every handler against pathological inputs
6. Stabilization: full lint + build + test pass with no regressions

The user-visible delta: every tool result is now bounded with a structured truncation hint that teaches the agent how to narrow; `read_file` and `grep_codebase` accept pagination parameters; every error string in `src/tools/handlers/*.ts` carries the failing parameter name and a one-line `Usage:` hint; an AST meta-test prevents future regressions.

---

## Subtasks completed

### 2.1 -- Universal 64 KB byte-cap + truncation hint

**Files**: [src/tools/OutputRedirector.ts](../../../../src/tools/OutputRedirector.ts), [src/tools/ToolRegistry.ts](../../../../src/tools/ToolRegistry.ts)

Added new exports to `OutputRedirector.ts`:

- `DEFAULT_MAX_BYTES = 64 * 1024` -- the universal cap applied to every successful tool output
- `MAX_BYTES_CEILING = 1024 * 1024` -- per-call override ceiling
- `TRUNCATION_MARKER = "=== TRUNCATED at"` -- assertion-friendly constant for tests and meta-checks
- `applyByteCap(output, toolName, maxBytes)` -- truncates at the byte boundary, walking back to the nearest UTF-8 sequence start so multi-byte characters never split mid-codepoint, then appends a structured hint footer
- `resolveMaxBytes(override)` -- validates a per-call override and throws an `Error` with the parameter name and a `Usage:` hint when the override is invalid (NaN, zero, negative, or above the ceiling)
- `resetTruncationStats()` and `getTruncationStats()` -- aggregate observability counters: `truncatedCount`, `totalBytesSeen`, `totalBytesTruncated`

The truncation hint emits tool-specific narrowing guidance:
- `read_file` -> "use range_start/range_end to fetch a sub-window"
- `grep_codebase` -> "use max_results/next_offset to paginate, or pass a tighter glob"
- `list_directory` -> "pass a deeper path or set recursive=false"
- otherwise -> "issue a narrower request"

Each ends with `... or pass max_bytes=<larger value> on this tool call (ceiling: 1048576)`.

`ToolRegistry.execute()` was updated to:
1. Validate the per-call `max_bytes` override **before** invoking the handler, so an invalid override yields an actionable error without burning work.
2. Apply the byte-cap to every successful tool output **before** the existing redirector logic.

### 2.2 -- read_file pagination via range_start / range_end

**Files**: [src/tools/handlers/filesystem.ts](../../../../src/tools/handlers/filesystem.ts), [src/tools/types.ts](../../../../src/tools/types.ts), [src/tools/ToolCatalog.ts](../../../../src/tools/ToolCatalog.ts)

`ReadFileTool` now accepts:

- `range_start?: number` -- inclusive byte offset (>= 0)
- `range_end?: number` -- exclusive byte offset (must be > range_start; window <= 1 MB)

When both are provided, the tool reads only the requested byte window (via `Buffer.subarray`) and returns:

```json
{
  "content": "...",
  "range_start": <resolved start>,
  "range_end": <resolved end>,
  "file_size": <total file size>,
  "eof": true|false
}
```

When the requested `range_end` exceeds the file size, the tool appends `\n=== End of file at byte <fileSize> ===` to the content. When neither parameter is provided, the legacy line-truncation path (500 lines) remains the default behaviour.

Validation errors carry the failing parameter name and a `Usage:` hint, e.g.:

```
Invalid range_end=5: must be a number greater than range_start=10. Usage: read_file(path, range_start=0, range_end=4096).
```

The `ReadFileParams` interface in [src/tools/types.ts](../../../../src/tools/types.ts) was extended with the new fields, and the `read_file` schema in [src/tools/ToolCatalog.ts](../../../../src/tools/ToolCatalog.ts) now documents `range_start`, `range_end`, and `max_bytes` with an inline example.

### 2.3 -- grep_codebase pagination via max_results / next_offset

**Files**: [src/tools/handlers/filesystem.ts](../../../../src/tools/handlers/filesystem.ts), [src/tools/types.ts](../../../../src/tools/types.ts), [src/tools/ToolCatalog.ts](../../../../src/tools/ToolCatalog.ts)

`GrepCodebaseTool` now accepts:

- `max_results?: number` -- default 50, ceiling 500. Values above the ceiling are clamped and a `warning` field is emitted in the result body.
- `next_offset?: string` -- opaque base64-encoded JSON cursor returned by a prior call.

The cursor is encoded with `encodeGrepCursor`/`decodeGrepCursor`. Decoding rejects non-base64 input, non-JSON payloads, and payloads missing the expected fields with actionable error messages:

```
Invalid next_offset cursor: not valid base64. Usage: pass next_offset=<the cursor returned by a prior grep_codebase call>, or omit next_offset to start from the beginning.
```

The implementation fetches `clampedMaxResults + cursorMatchIndex + 1` matches under the existing 500 ms ReDoS time budget, then slices the page from the cursor offset and returns:

```json
{
  "matches": [...],
  "count": <length>,
  "next_offset": "<cursor>",       // present when more matches remain
  "truncation_hint": "...",         // present alongside next_offset
  "warning": "..."                  // present when max_results was clamped
}
```

When the time budget is exhausted mid-search, the tool returns whatever it has collected so the agent can still page forward via `next_offset` rather than receiving nothing.

### 2.4 -- Audit and rewrite tool-handler error messages

**Files**: [src/tools/handlers/filesystem.ts](../../../../src/tools/handlers/filesystem.ts), [src/tools/handlers/terminal.ts](../../../../src/tools/handlers/terminal.ts), [src/tools/handlers/webSearch.ts](../../../../src/tools/handlers/webSearch.ts), [src/tools/OutputRedirector.ts](../../../../src/tools/OutputRedirector.ts), [src/tools/ToolRegistry.ts](../../../../src/tools/ToolRegistry.ts)

Every literal `error: ...` string returned from a tool handler now contains the failing parameter name **and** a `Usage:` hint. Examples:

| Handler | Old error | New error |
|---------|-----------|-----------|
| `read_file` (missing path) | `Missing required parameter: path` | `Missing required parameter: path. Usage: read_file(path=<workspace-relative path>). Example: read_file(path='src/extension.ts').` |
| `read_file` (file not found) | `File not found or unreadable: "x.ts"` | `File not found or unreadable at path "x.ts". Usage: read_file(path=<existing workspace-relative file>). To list directory contents, use list_directory(path=<dir>).` |
| `grep_codebase` (ReDoS-risky) | `Pattern rejected as potentially catastrophic for regex backtracking: "..."` | `Pattern "..." rejected as potentially catastrophic for regex backtracking. Usage: grep_codebase(pattern=<simple regex>) -- avoid nested quantifiers (e.g. "(a+)+b") and keep patterns under 512 chars.` |
| `run_terminal` (missing command) | `Missing required parameter: command` | `Missing required parameter: command. Usage: run_terminal(command=<shell command>, cwd=<optional workspace-relative cwd>). Example: run_terminal(command='git status').` |
| `web_search` (rate limit) | `Rate limit exceeded (10 searches per minute). Retry in Xs.` | `Rate limit exceeded for parameter query: 10 searches per minute. Retry in Xs. Usage: throttle web_search calls or use cached results.` |

The `formatForUser(err)` catch-block paths (which return programmatically computed strings, not literals) do not need a `Usage:` hint and are intentionally not flagged by the AST meta-test.

### 2.5 -- Null-safety baseline

**Files**: [tests/unit/tools/null-safety.test.ts](../../../../tests/unit/tools/null-safety.test.ts), [src/tools/handlers/filesystem.ts](../../../../src/tools/handlers/filesystem.ts) (defensive fix)

A new test sweeps 8 tool handlers against 11 pathological input shapes for 88 total assertions. Each handler must (a) return a `ToolResult` rather than throw, (b) produce a string `output`, and (c) when failing, produce a non-empty string `error`.

The sweep uncovered a real bug: `walkDir` in `ListDirectoryTool` would throw `TypeError: entries is not iterable` when `vscode.workspace.fs.readDirectory` returned a non-array (e.g. an unmocked stub returning `undefined`). Fixed by treating any non-array result as an empty directory.

### Tests added

| File | Cases | What it covers |
|------|------:|----------------|
| [tests/unit/tools/OutputRedirector.bytecap.test.ts](../../../../tests/unit/tools/OutputRedirector.bytecap.test.ts) | 13 | `applyByteCap` UTF-8 boundary safety, tool-specific narrowing hints, override validation, truncation counters |
| [tests/unit/tools/handlers/filesystem.read_file.range.test.ts](../../../../tests/unit/tools/handlers/filesystem.read_file.range.test.ts) | 7 | range pagination happy path, EOF marker, invalid range_start, range_end <= range_start, 1 MB window cap |
| [tests/unit/tools/handlers/filesystem.grep.pagination.test.ts](../../../../tests/unit/tools/handlers/filesystem.grep.pagination.test.ts) | 7 | cursor round-trip, invalid base64 cursor, non-string cursor, max_results clamp warning, max_results <= 0 |
| [tests/unit/tools/errors.test.ts](../../../../tests/unit/tools/errors.test.ts) | 24 + meta | programmatic error scenarios across all handlers + AST meta-test that walks 5 source files and rejects any `error: ...` literal missing `Usage:` |
| [tests/unit/tools/null-safety.test.ts](../../../../tests/unit/tools/null-safety.test.ts) | 88 | 8 handlers x 11 pathological inputs |
| [tests/integration/tool-output-bytecap.test.ts](../../../../tests/integration/tool-output-bytecap.test.ts) | 5 | end-to-end through `ToolRegistry.execute`: cap fires on 200 KB output, `max_bytes` override raises ceiling, invalid override returns actionable error |

**Total**: 5 new files, 144 new test cases.

---

## Quality gates

| Gate | Threshold | Result | Status |
|------|-----------|--------|:------:|
| Unit tests | 0 failures | 1249 pass, 2 designed skips | ok |
| Integration tests | 0 failures | 67 pass, 2 designed skips | ok |
| Lint (`npm run lint`) | 0 errors | 0 errors, 5 pre-existing warnings | ok |
| Build (`npm run build`) | Clean | Clean | ok |
| AST meta-test | Every error literal carries `Usage:` | Pass | ok |
| Null-safety sweep | No unhandled throws | 88/88 pass | ok |

---

## Deviations from the plan

1. **`MetricsCollector` event vs. process-wide counter**. The plan asked for a `tool_output.truncated` event on `MetricsCollector`. The existing `MetricsCollector` is a query-only layer over `TraceStore` with no emit API. Phase 2 ships a process-wide counter (`getTruncationStats`) in `OutputRedirector.ts` instead; tracer/span integration is left to Phase 9 (Coverage & Observability) where `MetricsCollector` is already being extended.
2. **No Brotli interaction**. The plan references the parallel `token-optimizer-adoption` Phase 1 Brotli compressor as part of the byte-cap stabilization. That work corresponds to v0.5.0 implementation-plan Phase 3, which has not landed yet. Phase 2's cap operates on uncompressed output; the cap will continue to apply before any future compression layer, exactly as the plan requires.
3. **Cap-fire calibration deferred**. The plan's Phase 2.6 stabilization checklist asks for a calibration run against the 24 golden tasks to verify cap-fire rate < 30%. That requires a developer machine with a live Ollama server and is therefore deferred to the next interactive session. The cap default (64 KB) and ceiling (1 MB) match the plan's specification verbatim, and the truncation-recovery 3-task golden micro-eval is itself a Phase 12 deliverable, so cap-tuning iterations will land alongside that work.

---

## Files changed

| File | Status |
|------|--------|
| [src/tools/OutputRedirector.ts](../../../../src/tools/OutputRedirector.ts) | Modified -- added byte-cap module + helper-tool error rewrites |
| [src/tools/ToolRegistry.ts](../../../../src/tools/ToolRegistry.ts) | Modified -- byte-cap integration + error rewrites |
| [src/tools/ToolCatalog.ts](../../../../src/tools/ToolCatalog.ts) | Modified -- new schema parameters for read_file, grep_codebase |
| [src/tools/types.ts](../../../../src/tools/types.ts) | Modified -- range_start, range_end, next_offset on params interfaces |
| [src/tools/handlers/filesystem.ts](../../../../src/tools/handlers/filesystem.ts) | Modified -- pagination + walkDir fix + error rewrites |
| [src/tools/handlers/terminal.ts](../../../../src/tools/handlers/terminal.ts) | Modified -- error rewrites |
| [src/tools/handlers/webSearch.ts](../../../../src/tools/handlers/webSearch.ts) | Modified -- error rewrites |
| [tests/unit/tools/OutputRedirector.bytecap.test.ts](../../../../tests/unit/tools/OutputRedirector.bytecap.test.ts) | Added |
| [tests/unit/tools/handlers/filesystem.read_file.range.test.ts](../../../../tests/unit/tools/handlers/filesystem.read_file.range.test.ts) | Added |
| [tests/unit/tools/handlers/filesystem.grep.pagination.test.ts](../../../../tests/unit/tools/handlers/filesystem.grep.pagination.test.ts) | Added |
| [tests/unit/tools/errors.test.ts](../../../../tests/unit/tools/errors.test.ts) | Added |
| [tests/unit/tools/null-safety.test.ts](../../../../tests/unit/tools/null-safety.test.ts) | Added |
| [tests/integration/tool-output-bytecap.test.ts](../../../../tests/integration/tool-output-bytecap.test.ts) | Added |
| [docs/DEVLOG.md](../../../DEVLOG.md) | Updated -- Phase 2 entry prepended |
| [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md) | Phase 2 exit checklist marked complete |

---

## Next steps

- Phase 3 (Compression Foundation): Brotli compressor module with threshold logic, OutputRedirector integration. The byte-cap from this phase applies before any compression layer, so Phase 3 can plug compression into the redirector without changing cap behaviour.
- Cap-fire calibration: deferred to a developer environment with a live Ollama; will land alongside Phase 12's golden-task baselining.
- Truncation-recovery golden micro-eval (Phase 12 deliverable): the byte-cap and pagination wiring this phase shipped is what those micro-evals exercise.
