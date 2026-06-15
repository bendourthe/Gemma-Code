/**
 * v1.2.0 Phase 3 / v1.4.0 Phase 7 -- scanner re-exports.
 *
 * v1.4.0 Phase 7 (T022 / gap 3.3.P2.G) replaced the regex extractor with a
 * Tree-sitter parse via web-tree-sitter (the WASM build -- no native toolchain,
 * cross-platform; grammars ship prebuilt as .wasm in `tree-sitter-wasms`). The
 * stable `extractSymbols(source, language)` surface is unchanged, so AstChunker
 * (4.1.P2.J) and WatchedRepoScanner (6.1.P3.V) inherit the upgrade for free.
 * Call `initTreeSitter()` once at startup to load the runtime + grammars;
 * `extractSymbols` falls back to the regex extractor (still exported as
 * `extractSymbolsRegex`) when Tree-sitter is unavailable or a parse throws.
 */

export {
  RepoScanner,
  extractSymbols,
  extractSymbolsRegex,
  type RepoScannerOptions,
  type ScannerSourceProvider,
} from "./RepoScanner.js";

export {
  initTreeSitter,
  isTreeSitterReady,
  isLanguageReady,
  extractSymbolsTreeSitter,
  setTreeSitterWasmDir,
} from "./TreeSitterScanner.js";

export type {
  ExtractedSymbol,
  ExtractedCall,
  ExtractionResult,
} from "./extractionTypes.js";

// v1.2.0 Phase 6.1 -- watcher-driven incremental re-scan adapter.
export {
  WatchedRepoScanner,
  type WatchedRepoScannerOptions,
  type WatchedReindexSummary,
} from "./WatchedRepoScanner.js";
