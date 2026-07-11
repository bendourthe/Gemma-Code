# v1.2.0 Phase 6 -- Re-Partial Integrations (2026-05-28)

## Plan reference

[docs/versions/v1/v1.2.0/plans/adoption-ecosystem-2026-05.md](../../plans/adoption-ecosystem-2026-05.md) Phase 6 -- the 6th of seven phases in the 2026-05 ecosystem-adoption cycle. Source comparison: [docs/versions/v1/v1.2.0/comparison-ecosystem-2026-05.md](../../comparison-ecosystem-2026-05.md) Section 5 items 8, 17, 40 (CodeGraph file-watcher abstraction, LSP-backed symbol queries, and S7 interactive HTML "copy as JSON" round-trip).

## Goal

Ship the three bounded-scope re-partial items: (1) extract the file-watcher abstraction out of the Phase 3 codegraph scanner so memory ingest and other watchers can share it; (2) introduce a Language Server Protocol client for TS / Python / Rust so the Coding pillar can ask for symbol-precise definitions and references instead of grep text matches; (3) ship the desktop-side interactive HTML artifact host with a "Copy as JSON" round-trip. Stability gate: (a) codegraph re-uses the watcher without behavior change; (b) the LSP-backed references tool returns symbol-precise hits; (c) the Tauri shell renders an interactive HTML artifact whose "Copy as JSON" button serialises form state to the clipboard.

## Sub-tasks completed

### 6.1 -- OS-native file-watcher abstraction

- **New module**: `core/storage/FileWatcher.ts`. Wraps Node's built-in `fs.watch` (deviation logged: the plan named `chokidar` but adding it would be a new third-party dep for a re-partial phase -- the public surface picks the chokidar shape so a swap is mechanical later; tracked as known-gaps `6.1.P3.U`). Public API: `watch(callback)`, `stop()`, `pendingChanges()`, plus a `flushForTest()` test helper. Behavior: 2-second debounce by default, dedup-by-path with delete-supersedes-modify semantics, `.gitignore` + `.nexusignore` filtering via the Phase 5.3 shared parser, ignore patterns refreshed before every debounce fire (mid-session `.nexusignore` edits take effect without restart), Windows backslash paths normalised to forward slashes.
- **Test injection**: the underlying `subscribe` impl is dependency-injected so unit tests drive native events synchronously without touching the real filesystem.
- **New module**: `core/codegraph/scanner/WatchedRepoScanner.ts`. Consumes `FileWatcher` events and re-extracts symbols for the changed delta only. `reindex(changes)` handles `added` / `modified` / `removed` events: re-extracts via `extractSymbols()` from `RepoScanner.ts`, uses SHA-256 content-hash skip detection (no-op on same-hash modifies), removes per-file rows on delete, treats missing-file modifies as deletions, skips files whose extension is not in the codegraph language map.
- **Store surface**: `SqliteGraphStore` gains a public `deleteFile(fileId)` helper (formerly only reachable via the bulk `pruneRemovedFiles` path) so the watcher can purge a single file row without iterating every `files` row.
- **Tests**: 9-test FileWatcher unit suite at [tests/unit/storage/FileWatcher.test.ts](../../../../versions/tests/unit/storage/FileWatcher.test.ts); 5-test WatchedRepoScanner integration suite at [tests/integration/codegraph/watched-rescan.test.ts](../../../../versions/tests/integration/codegraph/watched-rescan.test.ts).

### 6.2 -- LSP client for TS / Python / Rust

- **New module**: `core/coding/lsp/LspClient.ts`. Speaks JSON-RPC 2.0 over stdio to one of `typescript-language-server`, `pylsp`, or `rust-analyzer`. Minimum LSP subset only: `initialize` -> `initialized` (notification) -> `textDocument/didOpen` (per-file, once) -> `textDocument/definition` / `textDocument/references` -> `shutdown` / `exit` at teardown. Broader LSP coverage is deferred until a downstream feature needs it (known-gaps `6.2.P3.Y`).
- **Lifecycle**: per-language child processes launch lazily on first request and are cached for the session. Missing-binary detection surfaces a structured `ok: false, error: "LSP server for <lang> is not installed ..."` plus a one-shot `onServerMissing` callback. The plan's "installer warns when an LSP binary is missing" requirement is met by the callback (the installer-smoke logs subscribe).
- **Framing**: Content-Length-prefixed JSON-RPC with a streaming buffer that drains complete messages, per-request 10s timeout (configurable), stderr capture bounded to a 16 KB tail.
- **New module**: `core/coding/lsp/LspMcpServer.ts`. Implements the `McpHarnessAdapter` contract from [core/coding/McpBridge.ts](../../../../versions/core/coding/McpBridge.ts) and exposes exactly two tools: `lsp_definition` and `lsp_references`. Empty `fileContents` is a valid argument (empty new file still needs `didOpen`).
- **Coding-pillar wiring**: [src/tools/handlers/lsp.ts](../../../../versions/src/tools/handlers/lsp.ts) provides the two `LspDefinitionTool` / `LspReferencesTool` adapters; [src/tools/ToolRegistryBuilder.ts](../../../../versions/src/tools/ToolRegistryBuilder.ts) registers them lazily so the JSON-RPC framing + child-process plumbing stay out of the boot path until first invocation. New catalog entries in [src/tools/ToolCatalog.ts](../../../../versions/src/tools/ToolCatalog.ts), `BuiltinToolName` extended in [src/tools/types.ts](../../../../versions/src/tools/types.ts), tier `AUTO_APPROVE` in [src/guardrails/PermissionTiers.ts](../../../../versions/src/guardrails/PermissionTiers.ts) (read-only, never network beyond localhost stdio, never working-tree mutation).
- **Tests**: 5-test LspClient unit suite at [tests/unit/coding/lsp/LspClient.test.ts](../../../../versions/tests/unit/coding/lsp/LspClient.test.ts) (fake child-process stdin/stdout with scripted JSON-RPC frames; covers framing, lazy init, single + array result normalisation, missing-binary path, request timeout); 7-test LspMcpServer suite at [tests/unit/coding/lsp/LspMcpServer.test.ts](../../../../versions/tests/unit/coding/lsp/LspMcpServer.test.ts) (dispatch + arg validation in isolation from stdio).

### 6.3 -- Interactive HTML artifact host

- **New component**: `desktop/src/components/InteractiveArtifact.tsx`. Renders any HTML payload containing a `<form data-nexus-artifact="true">` element; automatically attaches a "Copy as JSON" button. On click: collect form-state (numbers via `valueAsNumber`, checkboxes via `checked`, selects honoring `multiple`, radios via the checked option, defaults via `value`), serialise to JSON, copy to the system clipboard via `navigator.clipboard.writeText`, render an `aria-live="polite"` confirmation toast that auto-clears after 3s.
- **Optional shaping**: `transformPayload` prop accepts a `(raw) => unknown` function so consumers can shape the payload before JSON encoding.
- **Fallback copy**: when `navigator.clipboard` is unavailable (sandboxed test runs, restricted webview contexts), a textarea-selection trick + `document.execCommand('copy')` covers the gap; if even that fails, the JSON is logged to `console.info` so the user can still copy manually.
- **Sanitisation**: inline `sanitiseArtifactHtml` (deviation logged: the desktop workspace does not currently include `isomorphic-dompurify`; adding it for one component was deferred -- tracked as known-gaps `6.3.P2.Z`) walks the parsed tree, drops `script` / `iframe` / `object` / `embed` / `link` / `meta` / `base` tags wholesale, removes every `on*` event-handler attribute, strips `javascript:` URLs from `href` / `src` / `action`.
- **Scope-creep guard**: the component carries an inline comment forbidding arbitrary in-app HTML editing, script execution beyond the wrapper's click handler, and postMessage/iframe interaction with the parent shell.
- **Hub reference template**: `interactive-tuning.html` was already shipped in Phase 1.2 (see [docs/versions/v1/v1.2.0/development/history/2026-05_phase-1-skill-native-foundation.md](2026-05_phase-1-skill-native-foundation.md)); recorded in known-gaps as `6.3.NI.Hub` -- already resolved.
- **Tests**: 7-test suite at [desktop/tests/InteractiveArtifact.test.tsx](../../../../versions/desktop/tests/InteractiveArtifact.test.tsx) covers render, sanitisation (script removal, event-handler removal, javascript: URL stripping), form-state -> JSON, copy confirmation, missing-form warning, `transformPayload` invocation.

### 6.4 -- Phase 6 testing and stabilization

Local sweep (main workspace + desktop):

| Check | Result |
|---|---|
| `npx vitest run` (full main suite) | 3631 passed + 1 confirmed flake (`memory-consolidator-large.test.ts`; runs green in isolation in 3.1s) + 5 skipped |
| `npm run test:shell` (desktop) | 418 / 418 passed |
| `npm run lint` | clean (exit 0) |
| `npx tsc --noEmit` | clean (exit 0) |
| `npm run deps:check` | 0 errors, 13 pre-existing orphan warnings (none from Phase 6 source) |

Phase 6 unit + integration suites added 33 new tests across the four new source files. The 80%/75%/80% coverage thresholds hold.

## Files

### Created

| Path | Purpose |
|---|---|
| `core/storage/FileWatcher.ts` | OS-native file-watcher abstraction (2s debounce, .nexusignore, dedup) |
| `core/codegraph/scanner/WatchedRepoScanner.ts` | Incremental codegraph re-scan driven by `FileWatcher` |
| `core/coding/lsp/LspClient.ts` | Minimal LSP client over JSON-RPC stdio |
| `core/coding/lsp/LspMcpServer.ts` | MCP adapter exposing `lsp_definition` / `lsp_references` |
| `core/coding/lsp/index.ts` | LSP module barrel |
| `src/tools/handlers/lsp.ts` | Coding-pillar adapters for the two LSP tools |
| `desktop/src/components/InteractiveArtifact.tsx` | React host for `<form data-nexus-artifact="true">` HTML payloads |
| `tests/unit/storage/FileWatcher.test.ts` | 9 unit tests |
| `tests/integration/codegraph/watched-rescan.test.ts` | 5 integration tests |
| `tests/unit/coding/lsp/LspClient.test.ts` | 5 unit tests (with scripted JSON-RPC fakes) |
| `tests/unit/coding/lsp/LspMcpServer.test.ts` | 7 unit tests |
| `desktop/tests/InteractiveArtifact.test.tsx` | 7 component tests |

### Extended

| Path | Change |
|---|---|
| `core/codegraph/scanner/index.ts` | re-exports `WatchedRepoScanner` + types |
| `core/codegraph/store/SqliteGraphStore.ts` | public `deleteFile(id)` helper |
| `src/tools/types.ts` | `lsp_definition` / `lsp_references` added to `BuiltinToolName` + `BUILTIN_TOOL_NAMES` |
| `src/tools/ToolCatalog.ts` | 2 new catalog entries |
| `src/tools/ToolRegistryBuilder.ts` | optional `lsp` deps, lazy registration of the 2 tools |
| `src/guardrails/PermissionTiers.ts` | `lsp_definition` / `lsp_references` at `AUTO_APPROVE` |
| `tests/unit/tools/ToolCatalog.test.ts` | length assertion bumped 22 -> 24 |
| `docs/versions/v1/v1.2.0/known-gaps.md` | 7 new entries (`6.1.P3.U`, `6.1.P3.V`, `6.1.P3.W`, `6.2.P2.X`, `6.2.P3.Y`, `6.3.P2.Z`, `6.3.NI.Hub`); Summary table refreshed |
| `docs/DEVLOG.md` | Phase 6 entry prepended |
| `AGENTS.md` | Project Layout block extended with FileWatcher + WatchedRepoScanner + LSP entries |
| `ARCHITECTURE.md` | new "Re-partial integrations (v1.2.0 Phase 6)" subsection |

## Deviations

- **`chokidar` -> `fs.watch`** (6.1). The plan named `chokidar`; the repo does not currently ship it. The wrapper picks the chokidar shape so a swap is mechanical later. Tracked as known-gaps `6.1.P3.U`.
- **`TreeSitterScanner` -> reuse of regex `RepoScanner.extractSymbols`** (6.1). Phase 3.3 already deferred Tree-sitter (known-gaps `3.3.P2.G`); `WatchedRepoScanner` consumes the same `extractSymbols` so the Tree-sitter upgrade lifts both at once. Tracked as known-gaps `6.1.P3.V`.
- **`isomorphic-dompurify` -> inline sanitiser** (6.3). The desktop workspace does not currently include `isomorphic-dompurify`; adding it for one component was deferred. The inline sanitiser covers the relevant XSS vectors for content the local agent emitted (script / iframe tags, on* attributes, javascript: URLs). Tracked as known-gaps `6.3.P2.Z`.

## Known gaps added

- `6.1.P3.U` -- FileWatcher wraps `fs.watch` instead of `chokidar`
- `6.1.P3.V` -- WatchedRepoScanner reuses regex `extractSymbols`
- `6.1.P3.W` -- RepoScanner still uses its inline ignore parser (continuation of 5.3.P3.S)
- `6.2.P2.X` -- LSP servers require manual installation; no installer bundling
- `6.2.P3.Y` -- LSP client implements a minimal subset of LSP
- `6.3.P2.Z` -- Interactive HTML artifact uses an inline sanitiser, not DOMPurify

## Known gaps closed

- `6.3.NI.Hub` -- Hub reference template `interactive-tuning.html` was already shipped in Phase 1.2 (recorded for traceability; no work required).

## Next phase

Phase 7 -- Stabilization, Benchmarks, and Documentation Refresh. The Phase 7 plan lands the token-usage and storage-size benchmarks, refreshes README / AGENTS / ARCHITECTURE, and closes out the known-gaps adoption ledger for the full 18-item set.
