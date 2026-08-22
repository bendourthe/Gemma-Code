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
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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

// v2.2.0 Phase 8: the sidecar reuses the coding runtime, which was written for
// the VS Code extension and reaches `vscode` through its logger. There is no
// VS Code process here, so the bundle could not resolve the module at all and
// this build failed outright. Since Phase 1 the installer embeds sidecar/dist
// as a Tauri resource, so a sidecar that cannot be built is a shipped app with
// no backend. The shim provides only the logger's surface and writes to
// stderr, because stdout carries the JSON-RPC stream.
const vscodeShim = path.join(here, "src", "shims", "vscode.ts");

await build({
  entryPoints: [path.join(here, "src", "main.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: path.join(distDir, "main.js"),
  // better-sqlite3 is a NATIVE addon. Bundling its JS wrapper inlines a
  // `require` for a .node binary that is then looked up relative to the bundle
  // and never found, so the sidecar died at startup before answering a single
  // request. Keep it external and ship the real package next to the bundle.
  external: ["tree-sitter-wasms", "better-sqlite3", "bindings"],
  alias: { vscode: vscodeShim },
  // import.meta.url is empty in CJS output; rewrite it to a __filename-derived
  // URL so treeSitterWarmup.bundledWasmDir() resolves <dist>/wasm at runtime.
  // The source stays valid ESM (native import.meta.url) for typecheck + tests.
  banner: { js: "const import_meta_url = require('url').pathToFileURL(__filename).href;" },
  define: { "import.meta.url": "import_meta_url" },
});

// v2.2.0 Phase 3 (3.1): a second, side-effect-free entry the installer invokes
// to provision ~/.nexus-ai/catalog/ during installation. Kept separate from
// main.js because that module starts the scheduler, serving gateway, and studio
// DB at import time -- none of which a one-shot catalog sync should touch.
// Ship the native addon and its resolver next to the bundle so Node's own
// resolution finds them from dist/. Copied, not bundled: a .node binary is
// platform-specific machine code, not something a JS bundler can inline.
const repoNodeModules = path.join(here, "..", "..", "node_modules");
const distNodeModules = path.join(distDir, "node_modules");
for (const pkg of ["better-sqlite3", "bindings", "file-uri-to-path"]) {
  const src = path.join(repoNodeModules, pkg);
  if (!existsSync(src)) {
    throw new Error(
      `[build:sidecar] ${pkg} not found at ${src}. The sidecar cannot open its ` +
        `database without it, and a sidecar that cannot start is a shipped app ` +
        `with no backend.`,
    );
  }
  cpSync(src, path.join(distNodeModules, pkg), { recursive: true });
}
const nativeBinary = path.join(
  distNodeModules,
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node",
);
if (!existsSync(nativeBinary)) {
  throw new Error(
    `[build:sidecar] better_sqlite3.node missing after copy (${nativeBinary}). ` +
      `Run npm rebuild better-sqlite3 before packaging.`,
  );
}

await build({
  entryPoints: [path.join(here, "src", "cli", "hubCatalogEntry.ts")],
  alias: { vscode: vscodeShim },
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: path.join(distDir, "hub-catalog.js"),
  external: ["tree-sitter-wasms"],
  banner: { js: "const import_meta_url = require('url').pathToFileURL(__filename).href;" },
  define: { "import.meta.url": "import_meta_url" },
});

// esbuild emits a CommonJS bundle, but desktop/package.json declares
// "type": "module", which would make Node treat dist/main.js as ESM (require
// undefined -> spawn fails). Drop a CommonJS marker beside the bundle so Node
// runs it as the CJS module it is.
mkdirSync(distDir, { recursive: true });
writeFileSync(path.join(distDir, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);

// v2.2.0 Phase 1 (1.1): ship the model catalog next to the bundle. The core
// loader resolves `catalog.json` via `__dirname`, which is `dist/` in the
// bundled sidecar, so without this copy `loadCatalog()` throws in a packaged
// app and every model list rendered empty.
cpSync(
  path.join(here, "..", "..", "core", "registry", "catalog.json"),
  path.join(distDir, "catalog.json"),
);

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
