// v1.5.0 Phase 6 (T022.P3.A) -- Tree-sitter warm-up for the packaged sidecar.
//
// The bundled sidecar (esbuild -> sidecar/dist/main.js) runs with no
// node_modules tree, so the codegraph scanner cannot resolve the grammar .wasm
// via require.resolve("tree-sitter-wasms"). The sidecar build copies the four
// grammar .wasm plus the web-tree-sitter runtime tree-sitter.wasm into
// <dist>/wasm; this module points the scanner at that dir and warms it up so
// extractSymbols() uses the Tree-sitter parse path instead of the regex
// fallback once a codegraph scan runs. Graceful: initTreeSitter never throws
// and returns false when the wasm dir is absent (e.g. an un-built dev run),
// in which case the scanner transparently falls back to the regex extractor.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initTreeSitter,
  setTreeSitterWasmDir,
} from "../../../core/codegraph/scanner/TreeSitterScanner.js";

/**
 * Directory holding the bundled .wasm files, beside the sidecar entry bundle.
 * esbuild emits CJS and rewrites import.meta.url to the output file, so at
 * runtime this resolves to <sidecar/dist>/wasm (where the build copies them).
 */
export function bundledWasmDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "wasm");
}

/**
 * Point the codegraph scanner at the given wasm dir (default: the bundled dir
 * beside the sidecar entry) and load the Tree-sitter runtime + grammars.
 * Returns whether at least one grammar loaded; never throws.
 */
export async function warmUpTreeSitter(
  wasmDir: string = bundledWasmDir(),
): Promise<boolean> {
  setTreeSitterWasmDir(wasmDir);
  return initTreeSitter();
}
