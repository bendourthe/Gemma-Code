/**
 * v1.2.0 Phase 4.1 -- AST-aware code chunker.
 *
 * Splits source code into one `Chunk` per top-level symbol (function, class,
 * method, struct, interface, trait, enum) instead of fixed-size windows. The
 * goal is for memory ingest to align chunk boundaries with semantic units so
 * that retrieval surfaces whole logical fragments instead of mid-function
 * slices.
 *
 * DEVIATION: The plan calls for Tree-sitter primitives. Phase 3 already
 * deviated to a regex-based scanner because the four per-language Tree-sitter
 * native bindings would force every dev machine through a native compile.
 * Phase 4.1 reuses `extractSymbols()` from `core/codegraph/scanner/RepoScanner.ts`
 * so the AST-awareness here is the same approximation Phase 3 already ships.
 * The Tree-sitter upgrade is tracked in `docs/v1.2.0/known-gaps.md` (DF).
 *
 * Fallback: any non-supported language (or non-code file) falls back to a
 * size-based chunker that splits at line boundaries with a configurable max
 * char window. Empty input yields an empty array.
 */

import { extractSymbols } from "../../codegraph/scanner/RepoScanner.js";
import type { CodeGraphLanguage, SymbolKind } from "../../codegraph/types.js";

/** Default chunk size for the size-based fallback (characters). */
export const DEFAULT_SIZE_CHUNK_CHARS = 2_000;

/** Min lines a symbol must span before it gets its own chunk. */
export const MIN_SYMBOL_LINES = 1;

/** Origin tag distinguishing AST chunks from size-fallback chunks. */
export type ChunkOrigin = "ast" | "size-fallback";

/** Languages the AST chunker recognizes natively (same set Phase 3 supports). */
const AST_LANGUAGES: ReadonlySet<CodeGraphLanguage> = new Set([
  "typescript",
  "python",
  "rust",
  "go",
]);

const LANGUAGE_BY_EXTENSION: Record<string, CodeGraphLanguage> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".go": "go",
};

export interface Chunk {
  /**
   * Stable identifier within the source file. Format:
   * `<filePath>:<symbolName>@<lineStart>` for AST chunks,
   * `<filePath>:size@<lineStart>` for size-fallback chunks.
   */
  readonly id: string;
  readonly filePath: string;
  /** Detected language; `null` for the size-fallback path. */
  readonly language: CodeGraphLanguage | null;
  /** Symbol name for AST chunks; `null` for size-fallback chunks. */
  readonly symbolName: string | null;
  /** Kind of the underlying symbol; `"block"` for size-fallback chunks. */
  readonly kind: SymbolKind | "block";
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly content: string;
  readonly origin: ChunkOrigin;
}

export interface AstChunkerOptions {
  /** Override the per-file size chunk size (chars). Default 2000. */
  readonly sizeChunkChars?: number;
  /**
   * Force the size-fallback path even when the language is supported.
   * Useful for benchmark comparisons.
   */
  readonly forceFallback?: boolean;
}

export interface ChunkFileInput {
  readonly filePath: string;
  readonly content: string;
  /**
   * Override language detection. When omitted, language is detected from the
   * file extension; non-supported extensions fall through to size-fallback.
   */
  readonly language?: CodeGraphLanguage | null;
}

/**
 * AST-aware chunker. Stateless; safe to share across ingest paths.
 *
 * Usage:
 *   const chunker = new AstChunker();
 *   const chunks = chunker.chunk({filePath: "x.ts", content: src});
 *   for (const c of chunks) memory.ingest(c);
 */
export class AstChunker {
  private readonly _sizeChunkChars: number;
  private readonly _forceFallback: boolean;

  constructor(opts: AstChunkerOptions = {}) {
    this._sizeChunkChars = Math.max(64, opts.sizeChunkChars ?? DEFAULT_SIZE_CHUNK_CHARS);
    this._forceFallback = opts.forceFallback ?? false;
  }

  /** Detect the language for a path; returns `null` for unsupported extensions. */
  static detectLanguage(filePath: string): CodeGraphLanguage | null {
    const lower = filePath.toLowerCase();
    const dot = lower.lastIndexOf(".");
    if (dot < 0) return null;
    const ext = lower.slice(dot);
    return LANGUAGE_BY_EXTENSION[ext] ?? null;
  }

  /**
   * Produce chunks for a single file. AST chunks are emitted in file order
   * for supported languages; fallback chunks are line-aligned slices.
   */
  chunk(input: ChunkFileInput): readonly Chunk[] {
    if (input.content.length === 0) return [];
    const detected =
      input.language === undefined
        ? AstChunker.detectLanguage(input.filePath)
        : input.language;
    if (
      !this._forceFallback &&
      detected !== null &&
      AST_LANGUAGES.has(detected)
    ) {
      const ast = this._chunkAst(input.filePath, input.content, detected);
      if (ast.length > 0) return ast;
      // No symbols extracted (e.g. comment-only file): fall through.
    }
    return this._chunkSize(input.filePath, input.content);
  }

  private _chunkAst(
    filePath: string,
    content: string,
    language: CodeGraphLanguage,
  ): readonly Chunk[] {
    const lines = content.split(/\r?\n/);
    const extracted = extractSymbols(content, language);

    // Keep only top-level symbols whose body has >= MIN_SYMBOL_LINES rows.
    // We define "top-level" as not nested inside another extracted symbol
    // (i.e., another symbol's lineStart..lineEnd does not strictly contain it).
    const accepted = extracted.symbols.filter((sym) => {
      const span = sym.lineEnd - sym.lineStart + 1;
      if (span < MIN_SYMBOL_LINES) return false;
      for (const other of extracted.symbols) {
        if (other === sym) continue;
        if (
          other.lineStart < sym.lineStart &&
          other.lineEnd >= sym.lineEnd &&
          // A class strictly contains a method: exclude the method so we keep
          // the class chunk as the outer unit. Methods would otherwise create
          // redundant chunks covering the same lines.
          other.lineEnd - other.lineStart > sym.lineEnd - sym.lineStart
        ) {
          return false;
        }
      }
      return true;
    });

    const sorted = [...accepted].sort((a, b) => a.lineStart - b.lineStart);
    const chunks: Chunk[] = [];
    for (const sym of sorted) {
      const startIdx = Math.max(0, sym.lineStart - 1);
      const endIdx = Math.min(lines.length - 1, sym.lineEnd - 1);
      const body = lines.slice(startIdx, endIdx + 1).join("\n");
      chunks.push({
        id: `${filePath}:${sym.name}@${sym.lineStart}`,
        filePath,
        language,
        symbolName: sym.name,
        kind: sym.kind,
        lineStart: sym.lineStart,
        lineEnd: sym.lineEnd,
        content: body,
        origin: "ast",
      });
    }
    return chunks;
  }

  private _chunkSize(filePath: string, content: string): readonly Chunk[] {
    const lines = content.split(/\r?\n/);
    const chunks: Chunk[] = [];
    let buf: string[] = [];
    let bufChars = 0;
    let bufStartLine = 1;

    const flush = (endLine: number) => {
      if (buf.length === 0) return;
      const text = buf.join("\n");
      chunks.push({
        id: `${filePath}:size@${bufStartLine}`,
        filePath,
        language: null,
        symbolName: null,
        kind: "block",
        lineStart: bufStartLine,
        lineEnd: endLine,
        content: text,
        origin: "size-fallback",
      });
      buf = [];
      bufChars = 0;
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      const projected = bufChars + line.length + 1;
      if (buf.length === 0) {
        bufStartLine = i + 1;
      }
      if (projected > this._sizeChunkChars && buf.length > 0) {
        flush(i);
        bufStartLine = i + 1;
      }
      buf.push(line);
      bufChars += line.length + 1;
    }
    flush(lines.length);
    return chunks;
  }
}
