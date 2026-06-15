// v1.5.0 Phase 6 (T022.P3.A) -- sidecar bundle + Tree-sitter wasm copy step.
//
// Bundles sidecar/src/main.ts into sidecar/dist/main.js (CJS for the Node
// runtime the Tauri shell spawns) and copies the four grammar .wasm
// (tree-sitter-wasms/out) plus the web-tree-sitter runtime tree-sitter.wasm
// into sidecar/dist/wasm. The packaged sidecar has no node_modules tree, so
// without this copy the codegraph scanner fell back to the regex extractor
// (the v1.4.0 T022.P3.A deferral). treeSitterWarmup points the loader at
// <dist>/wasm at startup.
//
// tree-sitter-wasms is marked external: the scanner never imports its JS (only
// require.resolve's a path, a branch the bundled sidecar never takes because
// the warm-up sets the wasm dir). web-tree-sitter IS bundled (its JS glue) and
// its runtime wasm is located via Parser.init({ locateFile }).

import { build } from "esbuild";
import { createRequire } from "node:module";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, "dist");
const distWasm = path.join(distDir, "wasm");

// The codegraph scanner parses these four languages (GRAMMAR_FILES in
// core/codegraph/scanner/TreeSitterScanner.ts). Ship only those grammars.
const GRAMMARS = [
  "tree-sitter-typescript.wasm",
  "tree-sitter-python.wasm",
  "tree-sitter-rust.wasm",
  "tree-sitter-go.wasm",
];

await build({
  entryPoints: [path.join(here, "src", "main.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: path.join(distDir, "main.js"),
  external: ["tree-sitter-wasms"],
  // import.meta.url is empty in CJS output; rewrite it to a __filename-derived
  // URL so treeSitterWarmup.bundledWasmDir() resolves <dist>/wasm at runtime.
  // The source stays valid ESM (native import.meta.url) for typecheck + tests.
  banner: { js: "const import_meta_url = require('url').pathToFileURL(__filename).href;" },
  define: { "import.meta.url": "import_meta_url" },
});

// esbuild emits a CommonJS bundle, but desktop/package.json declares
// "type": "module", which would make Node treat dist/main.js as ESM (require
// undefined -> spawn fails). Drop a CommonJS marker beside the bundle so Node
// runs it as the CJS module it is.
mkdirSync(distDir, { recursive: true });
writeFileSync(path.join(distDir, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);

mkdirSync(distWasm, { recursive: true });

// web-tree-sitter runtime wasm (loaded via Parser.init locateFile). The package
// exports map exposes "./tree-sitter.wasm", so resolve it directly.
cpSync(
  require.resolve("web-tree-sitter/tree-sitter.wasm"),
  path.join(distWasm, "tree-sitter.wasm"),
);

// Grammar wasm (loaded via Language.load on the resolved path). tree-sitter-wasms
// has no exports map, so resolve via its package root.
const tswOut = path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out");
for (const grammar of GRAMMARS) {
  cpSync(path.join(tswOut, grammar), path.join(distWasm, grammar));
}

process.stdout.write(
  `[build:sidecar] bundled sidecar + ${GRAMMARS.length} grammars + runtime wasm -> ${path.relative(here, distWasm)}\n`,
);
