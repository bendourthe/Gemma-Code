# Session history: v1.4.0 Phase 7 -- Architectural Carryforward

**Date**: 2026-05-31
**Cycle**: v1.4.0
**Phase**: 7 (Architectural carryforward -- known-gaps closure track)
**Plan reference**: [docs/versions/v1/v1.4.0/plans/adoption-claude-code-harness.md](../../plans/adoption-claude-code-harness.md)
**Acceptance scope**: close the heavy structural deferrals carried from v1.1.0 / v1.2.0 -- `1.4.P1.B` (src -> modules/coding move), `1.1.P1.A` (TypeScript project references), `3.3.P2.G` (Tree-sitter scanner; cascades to `4.1.P2.J` + `6.1.P3.V`), and `4.2.P3.K` (multi-layer HNSW). Stability gate: `tsc -b` builds in dependency order; `npm run check-architecture` clean; full `npm run test` green after the move.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T020 (`1.4.P1.B` -- src -> modules/coding move) | Migrated 12 sub-trees (`config`, `llm`->merge into `modules/coding/llm`, `observability`, `orchestration`, `guardrails`, `mcp`, `commands`, `agents`, `chat`, `evaluation`, `skills`, `runtime`) via `git mv` + a new path-aware codemod [scripts/dev/move-coding-subtrees.mjs](../../../../../scripts/dev/move-coding-subtrees.mjs) (178 importers rewritten). Repointed: [package.json](../../../../../package.json) (`check:prompts`, `lint`->`eslint src modules`, `lint-staged`), [eslint.config.mjs](../../../../../eslint.config.mjs), [configs/dependency-cruiser.cjs](../../../../../configs/dependency-cruiser.cjs) (`no-llm-outside-llm-folder` rule + theme), the generators (`generate-tool-permission-table.mjs`, `generate-golden-tasks.mjs`, `package-skills.mjs`, `dev/inject-deprecation-messages.mjs`), the 5 `lib/checks` prompt/skill rules, and the runtime skill-catalog path in [src/panels/ChatPanelBootstrap.ts](../../../../../src/panels/ChatPanelBootstrap.ts). src/ retains only activation, desktop, panels, storage, tools, extension.ts. Commit `3588dc3`. | Closed |
| T021 (`1.1.P1.A` -- TS project references) | New [tsconfig.base.json](../../../../../tsconfig.base.json) (shared options) + composite [core/tsconfig.json](../../../../../core/tsconfig.json) + root [tsconfig.json](../../../../../tsconfig.json) referencing `./core` with `include` narrowed to `src/**` + `modules/**`. `npm run build` switched to `tsc -b` (watch/dev to `tsc -b -w`). Commit `43fbd24`. | Closed |
| T022 (`3.3.P2.G` -- Tree-sitter scanner) | web-tree-sitter (WASM) extractor in new [core/codegraph/scanner/TreeSitterScanner.ts](../../../../../core/codegraph/scanner/TreeSitterScanner.ts) (async `initTreeSitter`, sync `extractSymbolsTreeSitter`) + shared [extractionTypes.ts](../../../../../core/codegraph/scanner/extractionTypes.ts); [RepoScanner.ts](../../../../../core/codegraph/scanner/RepoScanner.ts) `extractSymbols` now delegates to Tree-sitter with regex fallback (renamed `extractSymbolsRegex`). Warm-up wired at [src/extension.ts](../../../../../src/extension.ts) activate(). Deps web-tree-sitter + tree-sitter-wasms added. Commit `f921bb4`. Cascades: `4.1.P2.J` (AstChunker) + `6.1.P3.V` (WatchedRepoScanner) inherit the upgrade via the shared boundary. | Closed |
| T023 (`4.2.P3.K` -- HNSW) | [core/memory/PrunedDenseIndex.ts](../../../../../core/memory/PrunedDenseIndex.ts) `compact()` builds the kNN graph via hnswlib-node multi-layer HNSW (O(N log N)) above `HNSW_MIN_NODES`, all-pairs fallback below / when the native module is absent; topology-only on-disk format unchanged (VERSION 1). New `lastBuildMethod` getter. Commit `435c38e`. | Closed |
| T024 (tests + stabilization + ledger) | Full gate battery green; 6 carryforward gaps marked resolved in [known-gaps.md](../../known-gaps.md); plan checkboxes ticked. This file. | Closed |

## 2. Decisions confirmed with the user before coding

- **Run scope**: full phase, committing per sub-task.
- **Tree-sitter approach**: web-tree-sitter (WASM) -- no node-gyp / native toolchain; grammars ship prebuilt as `.wasm` in `tree-sitter-wasms`. Cross-platform and local-first.

## 3. Deviations / scope decisions (no new correctness gaps)

| # | Deviation | Resolution |
|---|---|---|
| D1 | T020 plan text says `src/llm` merges into `core/llm`. | `core/llm` does not exist and `modules/coding/llm` already holds `PromptFormat.ts` / `ToolCallFormat.ts`; the `core/** MUST NOT import modules/**` boundary places the LLM client drivers in `modules/coding/llm`. Merged there; `no-llm-outside-llm-folder` repointed. |
| D2 | T020 expected per-sub-tree commits. | Landed as one atomic commit: the codemod re-points external importers only, so per-sub-tree moves would dangle each tree's cross-tree imports until siblings moved (or double-churn). Moving all 12 together preserves sibling offsets and yields a single green state. |
| D3 | T021 step c says reference core from `desktop/tsconfig.json`. | desktop bundles core via esbuild (sidecar) / Vite (UI) and type-checks with its own `tsc --noEmit`; it consumes core as bundled source, not tsc reference output. desktop is intentionally left out of the root `tsc -b` graph; the no-double-emit + dependency-order acceptance holds for every tsc-emitting project. |
| D4 | T022 method/function kind for Python/Rust. | Python `def` / Rust `fn` are tagged `function` uniformly (no ancestry reclassification); the fixtures + integration tests do not depend on the distinction and caller attribution uses line-range containment. TS/Go methods are tagged `method` directly by the grammar. |

## 4. Open items added to known-gaps

One, P3 / DF: `T022.P3.A` -- bundle the grammar `.wasm` + the web-tree-sitter runtime `.wasm` into the packaged VSIX / esbuild sidecar and add a sidecar `initTreeSitter()` warm-up, so the packaged app uses Tree-sitter rather than the regex fallback (it works from source today; degrades gracefully when the `.wasm` is absent). The v1.4.0 [known-gaps.md](../../known-gaps.md) was updated: the adoption ledger splits T020-T024 as Resolved, a Phase 7 Open-Items section records D1-D4 plus `T022.P3.A`, six Resolved rows are added (`1.4.P1.B`, `1.1.P1.A`, `3.3.P2.G`, `4.1.P2.J`, `6.1.P3.V`, `4.2.P3.K`), and the summary advances to 18 resolved this cycle / 30 carryforward remaining.

## 5. Verification evidence

- `npm run build` (`tsc -b`) -> builds `core/tsconfig.json` then `tsconfig.json` in dependency order; incremental rebuild reports both up-to-date; emit layout unchanged (out/core, out/src, out/modules) with no double-emit; `out/src/extension.js` (main) emits.
- `npm run lint` (`eslint src modules`) -> clean, exit 0.
- `npm run check-architecture` (depcruise over `src core modules`) -> 0 errors, 11 pre-existing warnings.
- `npm run check:tampering` -> 0 findings; `npm run check:prompts` -> 1 pre-existing `review-pr/SKILL.md` oversized warning (unrelated); `npm run security:check` -> all safety surfaces in sync.
- Full suite (`vitest run`) -> 340 test files passed, 2 skipped, 0 failed; 3888 tests passed, 5 skipped (was 3876 pre-phase; +12 new: 9 Tree-sitter + 3 HNSW). New code covered by [TreeSitterScanner.test.ts](../../../../../tests/unit/core/codegraph/TreeSitterScanner.test.ts) and [PrunedDenseIndex.hnsw.test.ts](../../../../../tests/unit/core/memory/PrunedDenseIndex.hnsw.test.ts); 6 test files had path-string fixtures updated for the move.
- hnswlib-node is an optional native dependency; the HNSW test branches on its availability (asserts the HNSW path when present, the all-pairs fallback otherwise) so it is CI-robust. web-tree-sitter + tree-sitter-wasms are pure-JS/WASM and install via `npm ci`.

## 6. Next steps

- Advance to Phase 8 (T025-T031): the lone P1 protobufjs CVE chain (`7.x.P1.D`), wiring `permissions.deny` + unifying the codegraph ignore parser, live-wiring the deferred lifecycle hooks (incl. `T016.P3.A` / `T018.P3.A` from prior phases), LSP installer bundling + desktop DOMPurify, remaining hygiene deferrals, and the 100k benchmark (`4.4.P2.L`, now unblocked by the HNSW build).
- `T022.P3.A`: bundle the Tree-sitter grammar `.wasm` into the packaged extension/sidecar and add a sidecar warm-up so the packaged app uses Tree-sitter.
