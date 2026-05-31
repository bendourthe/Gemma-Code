/**
 * v1.4.0 Phase 7 (T022 / gap 3.3.P2.G) -- Tree-sitter symbol/call extractor.
 *
 * Replaces the regex extractor (RepoScanner.extractSymbolsRegex) with a real
 * parse via web-tree-sitter (the WASM build -- no node-gyp / native toolchain,
 * cross-platform, local-first). Grammars ship prebuilt as .wasm in the
 * `tree-sitter-wasms` package. Because web-tree-sitter is ESM-only and core/
 * compiles to CommonJS, the runtime is loaded through a dynamic import() gated
 * behind a try/catch (the same optional-load shape LocalEmbedder uses for
 * @xenova/transformers).
 *
 * Lifecycle:
 *   - initTreeSitter() is async (Parser.init() + per-grammar Language.load() are
 *     async) and idempotent; call it once at startup. It loads each grammar
 *     independently so one bad grammar does not disable the others, and returns
 *     false (never throws) when the runtime/grammars are unavailable.
 *   - isTreeSitterReady() reports whether at least one grammar loaded.
 *   - extractSymbolsTreeSitter() is SYNCHRONOUS (parse() is sync once a grammar
 *     is loaded), preserving the synchronous extractSymbols(source, language)
 *     boundary that RepoScanner.scan / AstChunker / WatchedRepoScanner consume.
 *     It throws when Tree-sitter is not ready so the caller can fall back to the
 *     regex extractor.
 *
 * Why Tree-sitter: the regex extractor (3.3.P2.G) misses multi-line
 * declarations (the `(` on the next line), property-method assignments
 * (`const f = () => {}`), and computed method names (`[Symbol.iterator]() {}`).
 * A real parse handles all three.
 */

import * as path from "node:path";
import type { CodeGraphLanguage, SymbolKind } from "../types.js";
import type {
  ExtractedSymbol,
  ExtractedCall,
  ExtractionResult,
} from "./extractionTypes.js";

// web-tree-sitter is loaded dynamically; we keep its objects untyped (any) to
// avoid a hard ESM type dependency. core/ is not linted, so `any` is allowed.
/* eslint-disable @typescript-eslint/no-explicit-any */

const GRAMMAR_FILES: Record<CodeGraphLanguage, string> = {
  typescript: "tree-sitter-typescript.wasm",
  python: "tree-sitter-python.wasm",
  rust: "tree-sitter-rust.wasm",
  go: "tree-sitter-go.wasm",
};

// Capture-name convention: a declaration node is captured as `@k_<kind>` and
// its name node as `@name`; a call site captures the callee identifier as
// `@callee`. The `k_<kind>` suffix maps 1:1 onto SymbolKind.
const QUERIES: Record<CodeGraphLanguage, string> = {
  typescript: `
    (function_declaration name: (identifier) @name) @k_function
    (generator_function_declaration name: (identifier) @name) @k_function
    (class_declaration name: (type_identifier) @name) @k_class
    (abstract_class_declaration name: (type_identifier) @name) @k_class
    (interface_declaration name: (type_identifier) @name) @k_interface
    (type_alias_declaration name: (type_identifier) @name) @k_type
    (enum_declaration name: (identifier) @name) @k_enum
    (method_definition name: (property_identifier) @name) @k_method
    (method_definition name: (computed_property_name) @name) @k_method
    (lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function))) @k_function
    (lexical_declaration (variable_declarator name: (identifier) @name value: (function_expression))) @k_function
    (call_expression function: (identifier) @callee)
    (new_expression constructor: (identifier) @callee)
  `,
  python: `
    (function_definition name: (identifier) @name) @k_function
    (class_definition name: (identifier) @name) @k_class
    (call function: (identifier) @callee)
  `,
  rust: `
    (function_item name: (identifier) @name) @k_function
    (struct_item name: (type_identifier) @name) @k_struct
    (trait_item name: (type_identifier) @name) @k_trait
    (enum_item name: (type_identifier) @name) @k_enum
    (call_expression function: (identifier) @callee)
  `,
  go: `
    (function_declaration name: (identifier) @name) @k_function
    (method_declaration name: (field_identifier) @name) @k_method
    (type_declaration (type_spec name: (type_identifier) @name type: (struct_type))) @k_struct
    (type_declaration (type_spec name: (type_identifier) @name type: (interface_type))) @k_interface
    (call_expression function: (identifier) @callee)
  `,
};

const VALID_KINDS = new Set<string>([
  "function",
  "method",
  "class",
  "interface",
  "type",
  "struct",
  "enum",
  "trait",
  "module",
]);

let _ready = false;
let _initPromise: Promise<boolean> | null = null;
let _parser: any = null;
const _languages = new Map<CodeGraphLanguage, any>();
const _queries = new Map<CodeGraphLanguage, any>();

/** Absolute path to a prebuilt grammar .wasm, resolved via the package root so
 *  an `exports` map cannot block the subpath lookup. */
function resolveGrammar(file: string): string {
  const pkgJson = require.resolve("tree-sitter-wasms/package.json");
  return path.join(path.dirname(pkgJson), "out", file);
}

/**
 * Load the Tree-sitter runtime and grammars once. Idempotent: concurrent or
 * repeat calls share the first promise. Never throws -- returns false when the
 * runtime or every grammar is unavailable, so callers fall back to regex.
 */
export async function initTreeSitter(): Promise<boolean> {
  if (_initPromise) return _initPromise;
  _initPromise = (async (): Promise<boolean> => {
    try {
      const mod: any = await import(/* @vite-ignore */ "web-tree-sitter");
      const ParserCtor = mod.Parser ?? mod.default?.Parser ?? mod.default;
      const LanguageNs = mod.Language ?? mod.default?.Language;
      const QueryCtor = mod.Query ?? mod.default?.Query;
      if (!ParserCtor || !LanguageNs || !QueryCtor) return false;

      await ParserCtor.init();
      const parser = new ParserCtor();

      for (const [lang, file] of Object.entries(GRAMMAR_FILES) as [
        CodeGraphLanguage,
        string,
      ][]) {
        try {
          const language = await LanguageNs.load(resolveGrammar(file));
          const query = new QueryCtor(language, QUERIES[lang]);
          _languages.set(lang, language);
          _queries.set(lang, query);
        } catch {
          // One grammar failing (missing .wasm, query node-type mismatch on a
          // grammar version) must not disable the rest.
        }
      }

      _parser = parser;
      _ready = _queries.size > 0;
      return _ready;
    } catch {
      _ready = false;
      return false;
    }
  })();
  return _initPromise;
}

/** True once at least one grammar has loaded. */
export function isTreeSitterReady(): boolean {
  return _ready;
}

/** True when the specific language's grammar loaded. */
export function isLanguageReady(language: CodeGraphLanguage): boolean {
  return _ready && _queries.has(language);
}

/**
 * Synchronously extract symbols + call edges for one source file via
 * Tree-sitter. Throws when the language grammar is not loaded so the caller
 * (extractSymbols) can fall back to the regex extractor.
 */
export function extractSymbolsTreeSitter(
  source: string,
  language: CodeGraphLanguage,
): ExtractionResult {
  const query = _queries.get(language);
  const grammar = _languages.get(language);
  if (!_ready || !_parser || !query || !grammar) {
    throw new Error(`tree-sitter not ready for language: ${language}`);
  }

  _parser.setLanguage(grammar);
  const tree = _parser.parse(source);
  try {
    const symbols: ExtractedSymbol[] = [];
    const calls: ExtractedCall[] = [];
    const seen = new Set<string>();

    for (const match of query.matches(tree.rootNode) as any[]) {
      const byName = new Map<string, any>();
      for (const cap of match.captures) byName.set(cap.name, cap.node);

      const calleeNode = byName.get("callee");
      if (calleeNode) {
        const calleeName = String(calleeNode.text ?? "");
        if (calleeName) {
          calls.push({ calleeName, line: calleeNode.startPosition.row + 1 });
        }
        continue;
      }

      let kind: string | null = null;
      let defNode: any = null;
      for (const cap of match.captures) {
        if (cap.name.startsWith("k_")) {
          const candidate = cap.name.slice(2);
          if (VALID_KINDS.has(candidate)) {
            kind = candidate;
            defNode = cap.node;
          }
        }
      }
      if (!kind || !defNode) continue;

      const nameNode = byName.get("name") ?? defNode;
      const name = String(nameNode.text ?? "").trim();
      if (!name) continue;

      const lineStart = defNode.startPosition.row + 1;
      const lineEnd = defNode.endPosition.row + 1;
      const dedupeKey = `${name}@${lineStart}#${kind}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const firstLine = String(defNode.text ?? "").split("\n")[0] ?? "";
      symbols.push({
        name,
        kind: kind as SymbolKind,
        lineStart,
        lineEnd,
        signatureText: firstLine.trim().slice(0, 200),
      });
    }

    return { symbols, calls };
  } finally {
    // web-tree-sitter trees hold WASM memory; release when the API exposes it.
    if (typeof tree.delete === "function") tree.delete();
  }
}
