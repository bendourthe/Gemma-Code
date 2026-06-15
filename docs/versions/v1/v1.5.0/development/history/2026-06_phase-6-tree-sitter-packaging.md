# Session history: v1.5.0 Phase 6 -- Tree-sitter `.wasm` Packaging Closure

**Date**: 2026-06-14
**Cycle**: v1.5.0 (Local Agent Maturity)
**Phase**: 6 (Carryforward closure -- bundle the Tree-sitter grammar `.wasm` into the packaged app; closes v1.4.0 `T022.P3.A`)
**Plan reference**: [docs/versions/v1/v1.5.0/plans/adoption-ecosystem-2026-06.md](../../plans/adoption-ecosystem-2026-06.md)
**Branch (Nexus-AI)**: `feat/v1.5.0-phase-3-inbound-security` (continued; v1.5.0 not yet merged to `main`)
**Acceptance scope**: add the grammar `.wasm` (`tree-sitter-wasms/out/*.wasm`) and the `web-tree-sitter` runtime `.wasm` to the VSIX / the esbuild sidecar copy step, and add a sidecar `initTreeSitter()` warm-up at activation. Acceptance (raises `T022.P3.A` candidate -> supported): a packaged-app integration test asserts `isTreeSitterReady()` is true after activation (no regex fallback in the packaged build). Stability gate: `npm run test`, `npm run build:shell`, `npm run build:sidecar` clean.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T021 (scanner) | Bundled-wasm-dir override. [core/codegraph/scanner/TreeSitterScanner.ts](../../../../../core/codegraph/scanner/TreeSitterScanner.ts) gained `setTreeSitterWasmDir(dir)` (seedable via `NEXUS_TREE_SITTER_WASM_DIR`). When set, `resolveGrammar` reads grammar `.wasm` from that dir, and `initTreeSitter` passes `Parser.init({ locateFile })` so the runtime `tree-sitter.wasm` loads from the same dir -- no `require.resolve` against `node_modules`. Unset (dev + VSIX) keeps the existing require.resolve path. Exported from [core/codegraph/scanner/index.ts](../../../../../core/codegraph/scanner/index.ts). | Closed |
| T021 (sidecar) | esbuild bundling + warm-up. `build:sidecar` now runs [desktop/sidecar/esbuild.config.mjs](../../../../../desktop/sidecar/esbuild.config.mjs): bundles `main.ts` (CJS), writes a `{ "type": "commonjs" }` marker into `sidecar/dist` (required because `desktop/package.json` is `type: module`), and copies the 4 grammar `.wasm` + the `web-tree-sitter` runtime `.wasm` into `sidecar/dist/wasm`. New [desktop/sidecar/src/treeSitterWarmup.ts](../../../../../desktop/sidecar/src/treeSitterWarmup.ts) points the loader at `<dist>/wasm`; [desktop/sidecar/src/main.ts](../../../../../desktop/sidecar/src/main.ts) warms it up fire-and-forget at startup (stderr log; stdout is the JSON-RPC channel). | Closed |
| T021 (VSIX) | [.vscodeignore](../../../../../.vscodeignore) trims `tree-sitter-wasms/out` to the 4 used grammars (typescript / python / rust / go) and keeps the `web-tree-sitter` runtime `.wasm`; verified with `npx vsce ls`. The extension already warms up Tree-sitter at activation (v1.4.0) and the VSIX ships `node_modules`, so no extension code change was needed. | Closed |
| T022 | Tests + stabilization. New [tests/integration/codegraph/treeSitterPackaged.test.ts](../../../../../tests/integration/codegraph/treeSitterPackaged.test.ts) (2 tests) stages the bundled layout in a `node_modules`-free temp dir, points the scanner at it, and asserts `isTreeSitterReady()` true + all 4 grammars + a regex-fallback-miss parse. The built `sidecar/dist/main.js` was also spawned and logs `tree-sitter codegraph scanner: ready`. Root suite 4037 passed / 5 skipped / 0 failed; all runnable gates clean. | Closed |

## 2. Design decisions & deviations from the plan text

| # | Decision / deviation | Resolution |
|---|---|---|
| D1 | The bundled sidecar has no `node_modules`, so the v1.4.0 `require.resolve("tree-sitter-wasms")` grammar resolution and web-tree-sitter's default runtime-wasm lookup both fail there. | Added an explicit `setTreeSitterWasmDir` override + a `Parser.init({ locateFile })` hook so a packaged host loads all `.wasm` from a known dir, with the dev/VSIX require.resolve path untouched. The override is the single mechanism both the sidecar warm-up and the packaged-app test exercise. |
| D2 | The plan says "add the grammar .wasm to the VSIX `files`", but `package.json` has no `files` array -- VSIX inclusion is governed by `.vscodeignore`, and the grammars already shipped (nothing excluded them). | Made the VSIX bundling deliberate: trimmed `tree-sitter-wasms/out` to the 4 grammars the scanner actually parses (dropping ~34) and documented the intent, keeping the runtime wasm. Verified the negation with `npx vsce ls` (exactly the 4 grammars + runtime listed). |
| D3 | The esbuild CJS bundle would not run: `desktop/package.json` declares `type: module`, so Node treats `sidecar/dist/main.js` as ESM and `require` is undefined (a latent bug the warm-up surfaced). | The build now writes `sidecar/dist/package.json` = `{ "type": "commonjs" }` so Node runs the bundle as the CJS module it is. This is required for the warm-up (and the whole sidecar) to execute, so it is in scope for the acceptance ("ready after activation"). |
| D4 | esbuild leaves `import.meta.url` empty in CJS output (warning `empty-import-meta`), which would break the warm-up's dir resolution. | Injected the canonical CJS shim via esbuild `banner` + `define` (`import.meta.url` -> a `__filename`-derived URL) so the bundle resolves `<dist>/wasm` correctly, while `treeSitterWarmup.ts` source stays valid ESM (native `import.meta.url`) for typecheck + tests. `tree-sitter-wasms` is marked esbuild-external (its JS is never imported); `web-tree-sitter`'s JS is bundled and its wasm located via `locateFile`. |
| D5 | The full Tauri `npm run build:shell` is part of the stability gate but `cargo` is not installed in this environment. | The JS components the change touches (`build:sidecar`, `build:web`) pass, and packaged-sidecar readiness was verified directly by spawning the built `dist/main.js` (logs "ready"). The full `tauri build` + in-app activation is recorded as forward-tier `T021.P3.A` to run on a host with the Rust toolchain. |

## 3. Open items added to known-gaps

One forward-tier follow-up recorded in [docs/versions/v1/v1.5.0/known-gaps.md](../../known-gaps.md) (not a defect):

- `T021.P3.A` (P3/DF) -- bundled-sidecar Tree-sitter readiness `supported` (the node_modules-free load path is integration-tested and the built bundle spawn-verified); the full `tauri build` packaged binary + in-app activation readiness was not run here (`cargo` absent) and is `candidate`. Next step: run `npm run build:shell` on a host with `cargo` + the Tauri CLI and confirm the packaged app logs Tree-sitter ready on launch.

`T022.P3.A` (the v1.4.0 carryforward this phase targets) is moved to `## 2. Resolved` (candidate -> supported).

## 4. Verification evidence

- New suite (root): `npx vitest run tests/integration/codegraph/treeSitterPackaged.test.ts` -> **2 passed**.
- `npm run test` (root) -> **4037 passed / 5 skipped / 0 failed**.
- `npm run build:sidecar` -> bundled + 4 grammars + runtime wasm copied to `dist/wasm`; spawning `node desktop/sidecar/dist/main.js` logs **`[nexus-sidecar] tree-sitter codegraph scanner: ready`** (the packaged, node_modules-free path).
- `npm run build:web` (desktop) -> **exit 0** (built in ~3.8s).
- `npm run build:shell` (Tauri) -> **not run** -- `cargo` is not installed in this environment; the Rust shell compile is orthogonal to this JS-only change (see D5 / `T021.P3.A`).
- `npx tsc -b` (root) + `tsc --noEmit` (desktop) -> **exit 0**.
- `npm run lint` (`eslint src modules`) + `npm run lint:shell` (`eslint src sidecar/src tests --max-warnings=0`) -> **0**.
- `npm run check-architecture` -> **0 errors** (10 pre-existing orphan/circular warnings, none involving the new files).
- `npm run check:tampering` -> **0 findings**. Desktop coverage suite -> **exit 0** (thresholds met).
- `npx vsce ls` -> VSIX packages exactly the 4 grammar `.wasm` + the `web-tree-sitter` runtime `.wasm` (34 unused grammars dropped).
- No outbound call introduced: all `.wasm` is local; the warm-up reads local files only.

## 5. Next phase

Phase 7 (FINAL) -- Nexus-Hub sync + whole-plan acceptance gate: inspect the latest Nexus-Hub, publish the Phase 2 skills (`direct-corpus-interaction`, `agent-presets`) and run `nexus skills sync`, absorb any still-open Hub-dependent v1.4.0 carryforward, and verify the whole-plan Definition of pass; then `/update release` for v1.5.0.
