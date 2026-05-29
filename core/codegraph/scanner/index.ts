/**
 * v1.2.0 Phase 3 -- scanner re-exports.
 *
 * DEVIATION: The plan specifies a Tree-sitter-based scanner. The Nexus repo
 * does not currently ship the four per-language tree-sitter native binding
 * packages (`tree-sitter-typescript`, `tree-sitter-python`, `tree-sitter-rust`,
 * `tree-sitter-go`), each of which would add native build dependencies for
 * every developer machine. Phase 3 ships a robust regex-based scanner with
 * the same surface; an upgrade to Tree-sitter is tracked in
 * `docs/v1.2.0/known-gaps.md` as a `DF` (deferred) entry.
 */

export {
  RepoScanner,
  type RepoScannerOptions,
  type ScannerSourceProvider,
} from "./RepoScanner.js";

// v1.2.0 Phase 6.1 -- watcher-driven incremental re-scan adapter.
export {
  WatchedRepoScanner,
  type WatchedRepoScannerOptions,
  type WatchedReindexSummary,
} from "./WatchedRepoScanner.js";
