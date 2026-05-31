/**
 * v1.2.0 Phase 3.3 -- repository scanner that walks the working tree,
 * extracts symbols and best-effort call edges with per-language regex
 * matchers, and upserts the results into a `SqliteGraphStore`.
 *
 * DEVIATION: The plan calls for a Tree-sitter scanner. The Nexus repo does
 * not currently bundle the four per-language tree-sitter native binding
 * packages, each of which would add a native compile step to every dev
 * machine. The regex-based extractor below covers the four target
 * languages well enough to drive the Phase 3.6 stability gate (which
 * measures tool-call reduction on the Coding pillar, not symbol-extraction
 * precision). The migration to Tree-sitter is tracked as a `DF` (deferred)
 * entry in `docs/versions/v1/v1.2.0/known-gaps.md`.
 *
 * Behaviors required by the plan:
 *   - SHA-256 content hash per file; skip when matching the store row.
 *   - Per-file size cap (default 1 MB) -- larger files are skipped with
 *     `skipReason: 'size-cap'`.
 *   - `.gitignore` AND `.nexusignore` honored; both are read once at
 *     `scan()` entry.
 *   - Incremental: only re-parse files whose hash changed; pruneRemovedFiles
 *     handles deletions.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  CODEGRAPH_DEFAULT_EXCLUDES,
  CODEGRAPH_DEFAULT_MAX_FILE_BYTES,
  CODEGRAPH_SUPPORTED_LANGUAGES,
} from "../manifest.js";
import type {
  CodeGraphLanguage,
  ScannedFileSummary,
  ScanReport,
  Symbol,
  SymbolKind,
} from "../types.js";
import type { SqliteGraphStore } from "../store/index.js";
import type {
  ExtractedSymbol,
  ExtractedSymbolRef,
  ExtractedCall,
  ExtractionResult,
} from "./extractionTypes.js";
import {
  isLanguageReady,
  extractSymbolsTreeSitter,
} from "./TreeSitterScanner.js";

export interface ScannerSourceProvider {
  /**
   * Walk the repo and yield candidate file paths (relative to `rootPath`).
   * Implementations honor ignore files; the default uses a synchronous
   * recursive `readdir`.
   */
  listCandidateFiles(rootPath: string): readonly string[];
  /** Read the contents of a single file. Returned as UTF-8. */
  readFile(absolutePath: string): string;
}

export interface RepoScannerOptions {
  readonly store: SqliteGraphStore;
  /** Per-file size cap in bytes (default 1 MB). */
  readonly maxFileBytes?: number;
  /** Extra glob-relative excludes on top of `.gitignore` and `.nexusignore`. */
  readonly extraExcludes?: readonly string[];
  /** Override the file walker / reader (tests inject in-memory fixtures here). */
  readonly sourceProvider?: ScannerSourceProvider;
}

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

export class RepoScanner {
  private readonly _opts: Required<Omit<RepoScannerOptions, "sourceProvider">> & {
    sourceProvider: ScannerSourceProvider;
  };

  constructor(opts: RepoScannerOptions) {
    this._opts = {
      store: opts.store,
      maxFileBytes: opts.maxFileBytes ?? CODEGRAPH_DEFAULT_MAX_FILE_BYTES,
      extraExcludes: opts.extraExcludes ?? [],
      sourceProvider: opts.sourceProvider ?? new FilesystemSourceProvider(),
    };
  }

  /**
   * Scan a repo rooted at `rootPath` and reconcile the graph store. Returns
   * an aggregate report. Per-file outcomes are emitted via the optional
   * callback so tests and the trace dashboard can attach per-file timing.
   */
  scan(
    rootPath: string,
    onFile?: (summary: ScannedFileSummary) => void,
  ): ScanReport {
    const startNs = process.hrtime.bigint();
    const ignore = loadIgnorePatterns(rootPath, this._opts.extraExcludes);
    const candidates = this._opts.sourceProvider.listCandidateFiles(rootPath);

    let filesVisited = 0;
    let filesIndexed = 0;
    let filesSkippedUnchanged = 0;
    let filesSkippedIgnored = 0;
    let filesSkippedSizeCap = 0;
    let symbolsUpserted = 0;
    let edgesUpserted = 0;
    const presentPaths: string[] = [];

    // Pass 1: extract symbols across every reindexed file BEFORE we resolve
    // call edges. This is what lets cross-file edges land even when a callee
    // is defined in a file that appears later in the directory walk.
    interface PendingFile {
      readonly rel: string;
      readonly lang: CodeGraphLanguage;
      readonly fileId: number;
      readonly extracted: ExtractionResult;
      readonly symbolIds: ReadonlyMap<string, number>;
    }
    const pending: PendingFile[] = [];

    for (const rel of candidates) {
      filesVisited += 1;
      const lang = languageFor(rel);
      if (!lang) {
        // Untracked extension: not an error, just nothing to do.
        continue;
      }
      if (isIgnored(rel, ignore)) {
        filesSkippedIgnored += 1;
        onFile?.({
          path: rel,
          language: lang,
          skipped: true,
          skipReason: "ignored",
          symbolCount: 0,
          edgeCount: 0,
        });
        continue;
      }

      const abs = path.join(rootPath, rel);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        // Race: file removed between walk and stat. Skip.
        continue;
      }
      if (stat.size > this._opts.maxFileBytes) {
        filesSkippedSizeCap += 1;
        onFile?.({
          path: rel,
          language: lang,
          skipped: true,
          skipReason: "size-cap",
          symbolCount: 0,
          edgeCount: 0,
        });
        continue;
      }

      const content = this._opts.sourceProvider.readFile(abs);
      const hash = createHash("sha256").update(content).digest("hex");
      const existing = this._opts.store.findFileByPath(rel);
      presentPaths.push(rel);

      if (existing && existing.contentHash === hash) {
        filesSkippedUnchanged += 1;
        onFile?.({
          path: rel,
          language: lang,
          skipped: true,
          skipReason: "unchanged",
          symbolCount: 0,
          edgeCount: 0,
        });
        continue;
      }

      const indexedAt = Math.floor(Date.now() / 1000);
      const fileId = this._opts.store.upsertFile({
        path: rel,
        language: lang,
        lastIndexedAt: indexedAt,
        contentHash: hash,
      });

      // Clean previous symbols + edges for the file so re-index does not
      // accumulate duplicates.
      this._opts.store.deleteCallerEdgesForFile(fileId);
      this._opts.store.deleteSymbolsForFile(fileId);

      const extracted = extractSymbols(content, lang);
      const symbolIds: Map<string, number> = new Map();
      for (const sym of extracted.symbols) {
        const id = this._opts.store.upsertSymbol({
          fileId,
          name: sym.name,
          kind: sym.kind,
          lineStart: sym.lineStart,
          lineEnd: sym.lineEnd,
          signatureText: sym.signatureText,
        });
        symbolsUpserted += 1;
        symbolIds.set(`${sym.name}@${sym.lineStart}`, id);
      }

      filesIndexed += 1;
      pending.push({ rel, lang, fileId, extracted, symbolIds });
    }

    // Pass 2: resolve call edges now that every reindexed file's symbols
    // are in the store, so cross-file edges land regardless of walk order.
    for (const file of pending) {
      const inFileByName = new Map<string, number>();
      for (const sym of file.extracted.symbols) {
        const key = `${sym.name}@${sym.lineStart}`;
        const id = file.symbolIds.get(key)!;
        inFileByName.set(sym.name, id);
      }
      let edgesThisFile = 0;
      for (const call of file.extracted.calls) {
        // Pick the *innermost* enclosing symbol -- a class body contains a
        // method body which contains the call; the method is the caller,
        // not the class. We score by (lineEnd - lineStart) and take the
        // tightest range that still covers the call line.
        let caller: ExtractedSymbolRef | null = null;
        for (const s of file.extracted.symbols) {
          if (call.line < s.lineStart || call.line > s.lineEnd) continue;
          if (!caller || s.lineEnd - s.lineStart < caller.lineEnd - caller.lineStart) {
            caller = s;
          }
        }
        if (!caller) continue;
        const callerKey = `${caller.name}@${caller.lineStart}`;
        const callerId = file.symbolIds.get(callerKey);
        if (!callerId) continue;

        let calleeId = inFileByName.get(call.calleeName);
        if (!calleeId) {
          // Best-effort cross-file resolution.
          const matches = this._opts.store.findSymbolByName(call.calleeName);
          const first = matches[0];
          if (matches.length === 1 && first) {
            calleeId = first.id;
          }
        }
        if (!calleeId || calleeId === callerId) continue;
        this._opts.store.upsertCallEdge({
          callerSymbolId: callerId,
          calleeSymbolId: calleeId,
          line: call.line,
          kind: "call",
        });
        edgesUpserted += 1;
        edgesThisFile += 1;
      }
      onFile?.({
        path: file.rel,
        language: file.lang,
        skipped: false,
        symbolCount: file.extracted.symbols.length,
        edgeCount: edgesThisFile,
      });
    }

    // Drop rows for files that disappeared since the prior pass.
    this._opts.store.pruneRemovedFiles(presentPaths);

    const elapsedMs = Number((process.hrtime.bigint() - startNs) / 1_000_000n);
    return Object.freeze({
      filesVisited,
      filesIndexed,
      filesSkippedUnchanged,
      filesSkippedIgnored,
      filesSkippedSizeCap,
      symbolsUpserted,
      edgesUpserted,
      elapsedMs,
    });
  }
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

function languageFor(relativePath: string): CodeGraphLanguage | null {
  const ext = path.extname(relativePath).toLowerCase();
  const lang = LANGUAGE_BY_EXTENSION[ext];
  if (!lang) return null;
  return CODEGRAPH_SUPPORTED_LANGUAGES.includes(lang) ? lang : null;
}

// ---------------------------------------------------------------------------
// Ignore-file handling
// ---------------------------------------------------------------------------

interface IgnoreState {
  readonly directoryNames: ReadonlySet<string>;
  readonly literalPaths: ReadonlySet<string>;
  readonly suffixPatterns: readonly string[];
}

function loadIgnorePatterns(
  rootPath: string,
  extraExcludes: readonly string[],
): IgnoreState {
  const directoryNames = new Set<string>(CODEGRAPH_DEFAULT_EXCLUDES);
  const literalPaths = new Set<string>();
  const suffixPatterns: string[] = [];

  const addLine = (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) return;
    if (trimmed.startsWith("!")) return; // negation is out of scope for the regex scanner
    if (trimmed.endsWith("/")) {
      directoryNames.add(trimmed.slice(0, -1).replace(/^\//, ""));
      return;
    }
    if (trimmed.startsWith("*.")) {
      suffixPatterns.push(trimmed.slice(1));
      return;
    }
    if (trimmed.startsWith("/")) {
      literalPaths.add(trimmed.slice(1));
      return;
    }
    if (!trimmed.includes("/") && !trimmed.includes("*")) {
      directoryNames.add(trimmed);
      return;
    }
    literalPaths.add(trimmed);
  };

  for (const name of [".gitignore", ".nexusignore"]) {
    const p = path.join(rootPath, name);
    try {
      const content = fs.readFileSync(p, "utf-8");
      for (const line of content.split(/\r?\n/)) addLine(line);
    } catch {
      // file missing -- fine
    }
  }
  for (const extra of extraExcludes) addLine(extra);

  return { directoryNames, literalPaths, suffixPatterns };
}

function isIgnored(relativePath: string, ignore: IgnoreState): boolean {
  const parts = relativePath.split(/[\\/]+/);
  for (const part of parts) {
    if (ignore.directoryNames.has(part)) return true;
  }
  if (ignore.literalPaths.has(relativePath.replace(/\\/g, "/"))) return true;
  for (const suffix of ignore.suffixPatterns) {
    if (relativePath.endsWith(suffix)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Symbol + call extraction (per-language regex matchers)
// ---------------------------------------------------------------------------

// ExtractedSymbol / ExtractedSymbolRef / ExtractedCall / ExtractionResult now
// live in ./extractionTypes.ts so the Tree-sitter extractor can share them
// without a circular import (see the import block at the top of this file).

/**
 * v1.4.0 Phase 7 (T022 / gap 3.3.P2.G): the stable extraction boundary. Prefer
 * the Tree-sitter extractor when its grammar for `language` has loaded
 * (initTreeSitter() resolved); fall back to the regex extractor otherwise (or
 * if a Tree-sitter parse throws). The fallback keeps the scanner working in
 * environments where the WASM runtime / grammars are unavailable -- the same
 * graceful-degradation contract LocalEmbedder uses for its hash fallback.
 */
export function extractSymbols(
  source: string,
  language: CodeGraphLanguage,
): ExtractionResult {
  if (isLanguageReady(language)) {
    try {
      return extractSymbolsTreeSitter(source, language);
    } catch {
      // Fall through to the regex extractor on any parse/runtime error.
    }
  }
  return extractSymbolsRegex(source, language);
}

/** Regex-based fallback extractor (the v1.2.0 Phase 3 implementation). */
export function extractSymbolsRegex(
  source: string,
  language: CodeGraphLanguage,
): ExtractionResult {
  switch (language) {
    case "typescript":
      return extractTypeScript(source);
    case "python":
      return extractPython(source);
    case "rust":
      return extractRust(source);
    case "go":
      return extractGo(source);
  }
}

// JavaScript keyword set is the safest superset to use for the call-site
// blacklist so we do not emit edges for `if(foo)`, `for (x of y)`, etc.
const JS_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "throw",
  "typeof",
  "instanceof",
  "new",
  "await",
  "yield",
  "do",
  "else",
  "function",
  "const",
  "let",
  "var",
  "class",
  "extends",
  "implements",
  "import",
  "export",
  "default",
  "in",
  "of",
  "as",
  "from",
  "true",
  "false",
  "null",
  "undefined",
  "this",
  "super",
]);

const PYTHON_KEYWORDS = new Set([
  "if",
  "elif",
  "else",
  "for",
  "while",
  "return",
  "yield",
  "raise",
  "try",
  "except",
  "finally",
  "with",
  "def",
  "class",
  "import",
  "from",
  "as",
  "and",
  "or",
  "not",
  "in",
  "is",
  "lambda",
  "pass",
  "True",
  "False",
  "None",
  "self",
  "cls",
  "print",
]);

const RUST_KEYWORDS = new Set([
  "if",
  "else",
  "for",
  "while",
  "loop",
  "match",
  "return",
  "let",
  "mut",
  "fn",
  "pub",
  "use",
  "mod",
  "struct",
  "enum",
  "trait",
  "impl",
  "self",
  "Self",
  "true",
  "false",
  "as",
  "in",
  "ref",
  "where",
  "move",
  "async",
  "await",
]);

const GO_KEYWORDS = new Set([
  "if",
  "else",
  "for",
  "switch",
  "case",
  "return",
  "break",
  "continue",
  "go",
  "defer",
  "select",
  "type",
  "var",
  "const",
  "func",
  "package",
  "import",
  "interface",
  "struct",
  "map",
  "chan",
  "range",
  "true",
  "false",
  "nil",
  "make",
  "new",
]);

function lineOfOffset(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function extractCallsFromBody(
  body: string,
  baseLine: number,
  keywords: ReadonlySet<string>,
): ExtractedCall[] {
  const calls: ExtractedCall[] = [];
  const callRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(body)) !== null) {
    const name = m[1];
    if (!name) continue;
    if (keywords.has(name)) continue;
    if (name.length < 2) continue;
    const line = baseLine + lineOfOffset(body, m.index) - 1;
    calls.push({ calleeName: name, line });
  }
  return calls;
}

function bodyEndIndex(source: string, openBraceIdx: number): number {
  let depth = 0;
  for (let i = openBraceIdx; i < source.length; i += 1) {
    const c = source[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return source.length - 1;
}

function pythonBodyEndIndex(
  source: string,
  defLineIndentChars: number,
  startSearchOffset: number,
): number {
  // Walk lines from `startSearchOffset` forward until we hit a non-blank
  // line whose indent is <= the def's indent.
  let offset = startSearchOffset;
  const len = source.length;
  while (offset < len) {
    const eol = source.indexOf("\n", offset);
    const lineEnd = eol === -1 ? len : eol;
    const line = source.slice(offset, lineEnd);
    if (line.trim().length === 0) {
      offset = lineEnd + 1;
      continue;
    }
    const indent = countLeadingSpaces(line);
    if (indent <= defLineIndentChars) {
      return offset - 1;
    }
    if (eol === -1) return len - 1;
    offset = eol + 1;
  }
  return len - 1;
}

function countLeadingSpaces(line: string): number {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i += 1;
  return i;
}

function extractTypeScript(source: string): ExtractionResult {
  const symbols: ExtractedSymbol[] = [];
  const calls: ExtractedCall[] = [];

  // function declarations
  const fnRe =
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(source)) !== null) {
    const name = m[1];
    const matchedText = m[0];
    if (!name || !matchedText) continue;
    const declStart = m.index + (matchedText.startsWith("\n") ? 1 : 0);
    const braceIdx = source.indexOf("{", fnRe.lastIndex);
    if (braceIdx === -1) continue;
    const end = bodyEndIndex(source, braceIdx);
    const lineStart = lineOfOffset(source, declStart);
    const lineEnd = lineOfOffset(source, end);
    const body = source.slice(braceIdx, end + 1);
    symbols.push({
      name,
      kind: "function",
      lineStart,
      lineEnd,
      signatureText: source.slice(declStart, braceIdx).trim(),
    });
    calls.push(...extractCallsFromBody(body, lineStart, JS_KEYWORDS));
  }

  // class declarations + their methods
  const classRe =
    /(?:^|\n)\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let cm: RegExpExecArray | null;
  while ((cm = classRe.exec(source)) !== null) {
    const className = cm[1];
    const cmText = cm[0];
    if (!className || !cmText) continue;
    const braceIdx = source.indexOf("{", classRe.lastIndex);
    if (braceIdx === -1) continue;
    const end = bodyEndIndex(source, braceIdx);
    const lineStart = lineOfOffset(source, cm.index + (cmText.startsWith("\n") ? 1 : 0));
    const lineEnd = lineOfOffset(source, end);
    symbols.push({
      name: className,
      kind: "class",
      lineStart,
      lineEnd,
      signatureText: source.slice(cm.index, braceIdx).trim(),
    });

    // Methods: scan declarations inside the class body. Skip control-flow
    // keywords; require `(` after the identifier and a brace within ~200
    // chars to filter property declarations.
    const body = source.slice(braceIdx + 1, end);
    const methodRe =
      /(?:^|\n)\s*(?:public|private|protected|static|async|readonly|override)*\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*[^{=]+)?\s*\{/g;
    let mm: RegExpExecArray | null;
    while ((mm = methodRe.exec(body)) !== null) {
      const methodName = mm[1];
      const mmText = mm[0];
      if (!methodName || !mmText) continue;
      if (JS_KEYWORDS.has(methodName)) continue;
      if (methodName === className) continue; // skip constructor signature
      const declRelStart = mm.index + (mmText.startsWith("\n") ? 1 : 0);
      const methodBraceIdx = body.indexOf("{", methodRe.lastIndex - 1);
      if (methodBraceIdx === -1) continue;
      const methodEnd = bodyEndIndex(body, methodBraceIdx);
      const lineStartM = lineOfOffset(source, braceIdx + 1 + declRelStart);
      const lineEndM = lineOfOffset(source, braceIdx + 1 + methodEnd);
      const methodBody = body.slice(methodBraceIdx, methodEnd + 1);
      symbols.push({
        name: methodName,
        kind: "method",
        lineStart: lineStartM,
        lineEnd: lineEndM,
        signatureText: body.slice(declRelStart, methodBraceIdx).trim(),
      });
      calls.push(...extractCallsFromBody(methodBody, lineStartM, JS_KEYWORDS));
    }
  }

  // top-level interface / type declarations (signature-only)
  const ifaceRe =
    /(?:^|\n)\s*(?:export\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let im: RegExpExecArray | null;
  while ((im = ifaceRe.exec(source)) !== null) {
    const name = im[1];
    const imText = im[0];
    if (!name || !imText) continue;
    const lineStart = lineOfOffset(source, im.index + (imText.startsWith("\n") ? 1 : 0));
    symbols.push({
      name,
      kind: "interface",
      lineStart,
      lineEnd: lineStart,
      signatureText: `interface ${name}`,
    });
  }

  return { symbols, calls };
}

function extractPython(source: string): ExtractionResult {
  const symbols: ExtractedSymbol[] = [];
  const calls: ExtractedCall[] = [];

  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    const fnMatch = /^(\s*)(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/.exec(
      line,
    );
    const clsMatch = /^(\s*)class\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);

    if (fnMatch) {
      const indentRaw = fnMatch[1];
      const name = fnMatch[2];
      if (!name) continue;
      const indent = indentRaw ? indentRaw.length : 0;
      const lineStart = i + 1;
      const offsetOfLine = lineStartOffset(source, i);
      const bodyStartOffset = offsetOfLine + line.length + 1;
      const endOffset = pythonBodyEndIndex(source, indent, bodyStartOffset);
      const lineEnd = lineOfOffset(source, endOffset);
      const body = source.slice(bodyStartOffset, endOffset + 1);
      symbols.push({
        name,
        kind: indent > 0 ? "method" : "function",
        lineStart,
        lineEnd,
        signatureText: line.trim(),
      });
      calls.push(...extractCallsFromBody(body, lineStart + 1, PYTHON_KEYWORDS));
    } else if (clsMatch) {
      const name = clsMatch[2];
      if (!name) continue;
      const indentRaw = clsMatch[1];
      const indent = indentRaw ? indentRaw.length : 0;
      const lineStart = i + 1;
      const offsetOfLine = lineStartOffset(source, i);
      const bodyStartOffset = offsetOfLine + line.length + 1;
      const endOffset = pythonBodyEndIndex(source, indent, bodyStartOffset);
      const lineEnd = lineOfOffset(source, endOffset);
      symbols.push({
        name,
        kind: "class",
        lineStart,
        lineEnd,
        signatureText: line.trim(),
      });
    }
  }

  return { symbols, calls };
}

function lineStartOffset(source: string, lineIndex: number): number {
  let count = 0;
  let offset = 0;
  while (count < lineIndex) {
    const nl = source.indexOf("\n", offset);
    if (nl === -1) return source.length;
    offset = nl + 1;
    count += 1;
  }
  return offset;
}

function extractRust(source: string): ExtractionResult {
  const symbols: ExtractedSymbol[] = [];
  const calls: ExtractedCall[] = [];

  const fnRe =
    /(?:^|\n)\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(source)) !== null) {
    const name = m[1];
    const mText = m[0];
    if (!name || !mText) continue;
    const declStart = m.index + (mText.startsWith("\n") ? 1 : 0);
    const braceIdx = source.indexOf("{", fnRe.lastIndex);
    if (braceIdx === -1) continue;
    const end = bodyEndIndex(source, braceIdx);
    const lineStart = lineOfOffset(source, declStart);
    const lineEnd = lineOfOffset(source, end);
    const body = source.slice(braceIdx, end + 1);
    symbols.push({
      name,
      kind: "function",
      lineStart,
      lineEnd,
      signatureText: source.slice(declStart, braceIdx).trim(),
    });
    calls.push(...extractCallsFromBody(body, lineStart, RUST_KEYWORDS));
  }

  const structRe =
    /(?:^|\n)\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let sm: RegExpExecArray | null;
  while ((sm = structRe.exec(source)) !== null) {
    const name = sm[1];
    const smText = sm[0];
    if (!name || !smText) continue;
    const lineStart = lineOfOffset(source, sm.index + (smText.startsWith("\n") ? 1 : 0));
    symbols.push({
      name,
      kind: "struct",
      lineStart,
      lineEnd: lineStart,
      signatureText: `struct ${name}`,
    });
  }

  const enumRe =
    /(?:^|\n)\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let em: RegExpExecArray | null;
  while ((em = enumRe.exec(source)) !== null) {
    const name = em[1];
    const emText = em[0];
    if (!name || !emText) continue;
    const lineStart = lineOfOffset(source, em.index + (emText.startsWith("\n") ? 1 : 0));
    symbols.push({
      name,
      kind: "enum",
      lineStart,
      lineEnd: lineStart,
      signatureText: `enum ${name}`,
    });
  }

  const traitRe =
    /(?:^|\n)\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let tm: RegExpExecArray | null;
  while ((tm = traitRe.exec(source)) !== null) {
    const name = tm[1];
    const tmText = tm[0];
    if (!name || !tmText) continue;
    const lineStart = lineOfOffset(source, tm.index + (tmText.startsWith("\n") ? 1 : 0));
    symbols.push({
      name,
      kind: "trait",
      lineStart,
      lineEnd: lineStart,
      signatureText: `trait ${name}`,
    });
  }

  return { symbols, calls };
}

function extractGo(source: string): ExtractionResult {
  const symbols: ExtractedSymbol[] = [];
  const calls: ExtractedCall[] = [];

  // top-level + method funcs. method funcs have a `(receiver)` group before the name.
  const fnRe =
    /(?:^|\n)\s*func\s*(?:\(\s*[A-Za-z_][A-Za-z0-9_]*\s+[*A-Za-z_][A-Za-z0-9_]*\s*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(source)) !== null) {
    const name = m[1];
    const mText = m[0];
    if (!name || !mText) continue;
    const declStart = m.index + (mText.startsWith("\n") ? 1 : 0);
    const braceIdx = source.indexOf("{", fnRe.lastIndex);
    if (braceIdx === -1) continue;
    const end = bodyEndIndex(source, braceIdx);
    const lineStart = lineOfOffset(source, declStart);
    const lineEnd = lineOfOffset(source, end);
    const body = source.slice(braceIdx, end + 1);
    const isMethod = /^\s*func\s*\(/.test(mText);
    symbols.push({
      name,
      kind: isMethod ? "method" : "function",
      lineStart,
      lineEnd,
      signatureText: source.slice(declStart, braceIdx).trim(),
    });
    calls.push(...extractCallsFromBody(body, lineStart, GO_KEYWORDS));
  }

  const typeRe =
    /(?:^|\n)\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(struct|interface)\b/g;
  let tm: RegExpExecArray | null;
  while ((tm = typeRe.exec(source)) !== null) {
    const name = tm[1];
    const kindRaw = tm[2];
    const tmText = tm[0];
    if (!name || !kindRaw || !tmText) continue;
    const kind = kindRaw === "interface" ? "interface" : "struct";
    const lineStart = lineOfOffset(source, tm.index + (tmText.startsWith("\n") ? 1 : 0));
    symbols.push({
      name,
      kind: kind as SymbolKind,
      lineStart,
      lineEnd: lineStart,
      signatureText: `type ${name} ${tm[2]}`,
    });
  }

  return { symbols, calls };
}

// ---------------------------------------------------------------------------
// Default filesystem source provider
// ---------------------------------------------------------------------------

class FilesystemSourceProvider implements ScannerSourceProvider {
  listCandidateFiles(rootPath: string): readonly string[] {
    const out: string[] = [];
    walk(rootPath, "", out);
    return out;
  }
  readFile(absolutePath: string): string {
    return fs.readFileSync(absolutePath, "utf-8");
  }
}

function walk(rootAbs: string, relPrefix: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(rootAbs, relPrefix), { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const rel = relPrefix.length === 0 ? ent.name : `${relPrefix}/${ent.name}`;
    if (ent.isDirectory()) {
      if (CODEGRAPH_DEFAULT_EXCLUDES.includes(ent.name)) continue;
      walk(rootAbs, rel, out);
    } else if (ent.isFile()) {
      out.push(rel);
    }
  }
}

// Surface `Symbol` so consumers that pull `RepoScanner` for typing still see it.
export type { Symbol };
