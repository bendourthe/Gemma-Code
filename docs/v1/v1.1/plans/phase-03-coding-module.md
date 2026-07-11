# Phase 3 -- Coding module move: codemod infrastructure + `src/utils/` leaf migration

**Goal**: Land the cycle's `src/` -> `modules/coding/` move pipeline by (a) shipping the generic import-rewriting codemod that v1.1.0 Phase 1 sub-task 1.4 specified, and (b) executing the first end-to-end sub-tree migration -- `src/utils/` -> `modules/coding/utils/`. `src/utils/` is the smallest true leaf in `src/` (six files: [Compressor.ts](../../../../src/utils/Compressor.ts), [errors.ts](../../../../src/utils/errors.ts), [logger.ts](../../../../src/utils/logger.ts), [MarkdownRenderer.ts](../../../../src/utils/MarkdownRenderer.ts), [secretPaths.ts](../../../../src/utils/secretPaths.ts), [ssrf.ts](../../../../src/utils/ssrf.ts)), it imports only from node builtins and external npm packages (zero intra-`src/` dependencies), and it is consumed by ~63 sibling files spanning both `src/` and `tests/`. Moving it exercises every relative-path depth the codemod will encounter in later sub-tree moves (depth 1 from `src/extension.ts`, depth 2 from `src/<subtree>/X.ts`, depth 3 from `src/<subtree>/handlers/X.ts`, depth 2 from `tests/integration/X.test.ts`, depth 3 from `tests/unit/<subdir>/X.test.ts`, depth 4 from `tests/unit/<a>/<b>/X.test.ts`).

**Prerequisites**: Phase 2 (commit `de219a5`) -- manifest IDs renamed, npm package + publisher flipped, sidecar duplicate model catalogs unified.

**Stability Gate**:

1. `scripts/dev/rewrite-imports.mjs` exists, accepts a `--moves` JSON manifest, and idempotently rewrites every static `import ... from "..."` / `export ... from "..."` / dynamic `import("...")` / `vi.mock("...")` / `vi.doMock("...")` specifier whose resolved path lands inside a moved sub-tree. Re-running the script with no actual diff is a no-op (zero file writes).
2. `src/utils/` is empty; `modules/coding/utils/` contains the six files. The `git mv` history is preserved for each file.
3. `configs/vitest.config.ts` coverage `exclude` array references `modules/coding/utils/**` (not `src/utils/**`).
4. `npm run build` (root `tsc`) is clean.
5. `npm run lint` (root `eslint src`) is clean -- the linter sees a shrunk `src/` tree.
6. `npm test` (root vitest, all 3019+ tests) passes with 0 new failures relative to the Phase 2 baseline.
7. `npm run check-architecture` (depcruise on `src core modules`) is clean -- no new errors; pre-existing orphan warnings unchanged.
8. `desktop` workspace `npm run typecheck` + `npm test` are clean (the desktop tree does not import from `src/utils/` directly, but the run confirms no transitive regression).

**Closes (partial)**: 1.4.P1.B -- `src/` -> `modules/coding/` wholesale move. Phase 3 lands the codemod infrastructure plus the first sub-tree migration; the remaining 12 sub-trees stay open under a renumbered carryforward (3.P1.A) in [docs/versions/v1/v1.1.0/known-gaps.md](../known-gaps.md) for follow-up phases (Phase 4 candidates: `src/config/`, `src/llm/`, `src/observability/`, `src/orchestration/`, `src/guardrails/`, `src/mcp/`; later phases: `src/agents/`, `src/chat/`, `src/commands/`, `src/evaluation/`, `src/runtime/`, `src/skills/`, `src/storage/`, `src/tools/`, `src/panels/`, `src/extension.ts`).

---

## Sub-tasks

### 3.1 -- Import-rewriting codemod

**Objective**: Ship `scripts/dev/rewrite-imports.mjs` -- a zero-dependency Node script that walks `src/`, `core/`, `modules/`, and `tests/`, and rewrites every import / re-export / dynamic-import / `vi.mock` / `vi.doMock` specifier whose resolved absolute path lands inside one of the directories named in the `--moves` manifest.

**Prompt**:
> Add [scripts/dev/rewrite-imports.mjs](../../../../scripts/dev/rewrite-imports.mjs). The script accepts an optional `--moves` flag whose value is a JSON path; if omitted, it reads the inline default manifest `[{ "from": "src/utils", "to": "modules/coding/utils" }]`. For each TypeScript file under `src/`, `core/`, `modules/`, and `tests/` (excluding `node_modules`, `out`, and any `.d.ts`), parse the file with simple regex over the five specifier kinds (`import ... from "X"`, `import "X"`, `import("X")`, `export ... from "X"`, `vi.mock("X", ...)`, `vi.doMock("X", ...)`) -- each kind is matched by an ECMAScript regex with the `g` flag. For every match, take the importer's directory, resolve the specifier relative to it via `path.resolve`, strip a trailing `.js` (the `module: "Node16"` extension) to get the canonical "no-extension" target, and check whether the result starts with the absolute path of any `move.from`. If yes, compute the new absolute target by replacing the `move.from` prefix with `move.to`, then convert that back to a POSIX-style relative path from the importer's directory (using forward slashes regardless of OS) and re-append the `.js` extension. Write the file back only if at least one specifier changed. Acceptance: `node scripts/dev/rewrite-imports.mjs --dry-run` prints the list of files it would write without modifying anything; a re-run without `--dry-run` performs the rewrite. The default manifest matches Phase 3's `src/utils` -> `modules/coding/utils` move so the script is self-contained for the rest of Phase 3.

---

### 3.2 -- `src/utils/` -> `modules/coding/utils/`

**Objective**: Move the six `src/utils/` files into `modules/coding/utils/` and rewrite every import / mock specifier across `src/`, `core/`, `modules/`, and `tests/` to reference the new location.

**Prompt**:
> (a) Execute `git mv src/utils modules/coding/utils` from the repo root so the rename history is preserved. (b) Run `node scripts/dev/rewrite-imports.mjs` to rewrite the ~63 importers. Spot-check that the script touched `src/extension.ts` (`./utils/...` -> `../modules/coding/utils/...`), `src/panels/MemoryPanel.ts` (`../utils/...` -> `../../modules/coding/utils/...`), `src/tools/handlers/webCache.ts` (`../../utils/...` -> `../../../modules/coding/utils/...`), `tests/integration/ssrf-body-size.test.ts` (`../../src/utils/...` -> `../../modules/coding/utils/...`), `tests/unit/utils/Compressor.test.ts` (`../../../src/utils/...` -> `../../../modules/coding/utils/...`), and `tests/unit/panels/ChatCommandHandlers.test.ts` (`vi.mock("../../../src/utils/MarkdownRenderer.js", ...)` -> `vi.mock("../../../modules/coding/utils/MarkdownRenderer.js", ...)`). (c) Update [configs/vitest.config.ts](../../../../configs/vitest.config.ts) `test.coverage.exclude` so `"src/utils/**"` becomes `"modules/coding/utils/**"`. (d) Verify that `src/utils/` is empty (the directory may or may not survive depending on git's empty-dir handling); leave a `.gitkeep` if Windows reports a residual empty directory. Acceptance: `grep -rn "src/utils" --include="*.ts" -l` returns only the realistic-shaped fixture strings inside [tests/integration/tool-output-compression.test.ts](../../../../tests/integration/tool-output-compression.test.ts) (those are intentional test data, not imports) and the historical `docs/v0.X.0/...` references; no live import or mock specifier points at the old location.

---

### 3.3 -- Phase 3 lint, build, test gate (closes the codemod + first-leaf half of 1.4.P1.B)

**Objective**: Verify the rename + codemod landed without regressing CI; document the partial closure of 1.4.P1.B; open a follow-up entry naming the still-deferred sub-trees.

**Prompt**:
> Run from the repo root: `npm run build`, `npm run lint`, `npm run check-architecture`, and `npm test`. Then from `desktop/`: `npm run typecheck` and `npm test`. Resolve any regression introduced by the rename. Update [docs/versions/v1/v1.1.0/known-gaps.md](../known-gaps.md): the open item 1.4.P1.B keeps its open status (it covers 13 sub-tree moves, only 1 closed in this phase) but its body is rewritten to reflect that `src/utils/` is closed and the remaining 12 sub-trees stay deferred. Add a new entry 3.P1.A naming the codemod infrastructure as Phase 3's positive contribution, and move 1.4.P1.B's body forward to reference 3.P1.A so future phases pick the codemod up automatically. Recompute the `## 3. Summary` counts. Acceptance: 0 lint warnings, 0 test failures across both workspaces; the known-gaps file shows 1 partial closure (`src/utils` row in the per-sub-tree table) and the summary is recomputed.

---

## Out of scope (carryforward to later v1.1.0 phases)

- The remaining 12 sub-tree moves under `src/`: `agents/`, `chat/`, `commands/`, `config/`, `evaluation/`, `guardrails/`, `llm/`, `mcp/`, `observability/`, `orchestration/`, `panels/`, `runtime/`, `skills/`, `storage/`, `tools/`, and the top-level `src/extension.ts`. Each subsequent phase that touches the rename is expected to consume the same codemod via `node scripts/dev/rewrite-imports.mjs --moves <manifest.json>`; the script is generic and accepts arbitrary `from`/`to` pairs.
- **1.1.P1.A** (TypeScript project-references wiring) -- still deferred. The rationale recorded in Phase 1's known-gaps entry stands: project-references wiring should land alongside the last `src/` -> `modules/coding/` sub-tree move so the build graph flips in a single coherent commit.
- **1.10.P1.F** (`NexusCodingRuntime` wiring into sidecar) -- still deferred; waits on `src/runtime/` migration.
- **1.11.P1.G** (Tailwind v4) -- still folds into cycle Phase 11.
- **1.12.P2.H / 1.12.P2.I** -- unchanged.
