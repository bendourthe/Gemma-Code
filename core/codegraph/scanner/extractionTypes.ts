/**
 * v1.4.0 Phase 7 (T022 / gap 3.3.P2.G) -- shared symbol/call extraction types.
 *
 * Extracted into their own module so both the regex extractor (RepoScanner.ts)
 * and the Tree-sitter extractor (TreeSitterScanner.ts) can import them without
 * a circular dependency (RepoScanner.extractSymbols delegates to the
 * Tree-sitter path, so RepoScanner imports TreeSitterScanner, which would
 * otherwise have to import its types back from RepoScanner).
 */

import type { SymbolKind } from "../types.js";

export interface ExtractedSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly signatureText: string;
}

export type ExtractedSymbolRef = ExtractedSymbol;

export interface ExtractedCall {
  readonly calleeName: string;
  readonly line: number;
}

export interface ExtractionResult {
  readonly symbols: readonly ExtractedSymbol[];
  readonly calls: readonly ExtractedCall[];
}
