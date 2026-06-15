/**
 * v1.5.0 Phase 6 (T021/T022, closes v1.4.0 T022.P3.A) -- packaged-app
 * Tree-sitter readiness.
 *
 * Proves the codegraph scanner loads the Tree-sitter runtime + grammars from an
 * explicit wasm directory with NO node_modules resolution -- the exact
 * condition the bundled desktop sidecar (esbuild -> sidecar/dist/main.js, no
 * node_modules tree) and the packaged VSIX rely on. The build copies the four
 * grammar .wasm plus the web-tree-sitter runtime tree-sitter.wasm beside the
 * bundle; here we stage the same layout in a throwaway dir, point the scanner
 * at it via setTreeSitterWasmDir(), and assert isTreeSitterReady() is true after
 * activation (no regex fallback).
 *
 * This file is isolated (vitest gives each test file a fresh module graph), so
 * the scanner singleton starts cold and the wasm-dir override is the only load
 * path exercised -- require.resolve against node_modules is never used here.
 */

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  extractSymbols,
  initTreeSitter,
  isLanguageReady,
  isTreeSitterReady,
  setTreeSitterWasmDir,
} from "../../../core/codegraph/scanner/index.js";

const require = createRequire(import.meta.url);

// The four grammars the codegraph scanner ships (GRAMMAR_FILES in
// core/codegraph/scanner/TreeSitterScanner.ts and the build copy list).
const GRAMMARS = [
  "tree-sitter-typescript.wasm",
  "tree-sitter-python.wasm",
  "tree-sitter-rust.wasm",
  "tree-sitter-go.wasm",
];

let wasmDir: string;
let ready: boolean;

beforeAll(async () => {
  // Stage the bundled-app wasm layout: copy the runtime + four grammars into a
  // throwaway dir with no node_modules, mirroring sidecar/dist/wasm.
  wasmDir = mkdtempSync(path.join(tmpdir(), "nexus-ts-wasm-"));
  cpSync(
    require.resolve("web-tree-sitter/tree-sitter.wasm"),
    path.join(wasmDir, "tree-sitter.wasm"),
  );
  const out = path.join(
    path.dirname(require.resolve("tree-sitter-wasms/package.json")),
    "out",
  );
  for (const grammar of GRAMMARS) {
    cpSync(path.join(out, grammar), path.join(wasmDir, grammar));
  }

  setTreeSitterWasmDir(wasmDir);
  ready = await initTreeSitter();
});

afterAll(() => {
  setTreeSitterWasmDir(null);
  rmSync(wasmDir, { recursive: true, force: true });
});

describe("Tree-sitter packaged-app readiness (T022.P3.A)", () => {
  it("loads runtime + grammars from the bundled wasm dir (no node_modules)", () => {
    expect(ready).toBe(true);
    expect(isTreeSitterReady()).toBe(true);
    for (const lang of ["typescript", "python", "rust", "go"] as const) {
      expect(isLanguageReady(lang)).toBe(true);
    }
  });

  it("parses via the Tree-sitter path (a regex-fallback miss)", () => {
    // The const-arrow assignment is a documented regex-extractor miss, so
    // finding `handler` proves the parse came from a loaded grammar, not the
    // regex fallback -- i.e. the bundled wasm dir actually drove the parse.
    const names = extractSymbols(
      "const handler = (event: string): void => { return; };",
      "typescript",
    ).symbols.map((s) => s.name);
    expect(names).toContain("handler");
  });
});
