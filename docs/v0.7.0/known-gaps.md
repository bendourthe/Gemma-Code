# v0.6.0 -- Known Gaps, Deferrals, and Carryovers into v0.7.0

**Status as of**: 2026-05-05 (Phase 8 close; v0.6.0 about to be tagged)
**Audience**: v0.7.0 plan author, code reviewer, security reviewer, ops engineer running the live-Ollama capture
**Sibling reviews**: [docs/v0.6.0/review/known-gaps.md](../v0.6.0/review/known-gaps.md) (the v0.5.0 carryover catalog that drove v0.6.0); [docs/v0.6.0/review/codebase-review.md](../v0.6.0/review/codebase-review.md); [docs/v0.6.0/review/penetration-test.md](../v0.6.0/review/penetration-test.md).
**Context**: This is the post-cycle self-audit for v0.6.0. It catalogs every item in the v0.6.0 plan that was deferred, every Definition-of-Done criterion that landed only partially, every pre-existing bug or warning that v0.6.0 observed but did not fix, every operator-action item that has to land before the cycle is fully closed, and every out-of-scope item explicitly recorded for v0.7.0+. The catalog is intentionally exhaustive so that the v0.7.0 plan author has a complete starting map.

Each entry has a severity tag:

- **P0** -- release-blocker for v0.7.0 (must close)
- **P1** -- should-fix in v0.7.0
- **P2** -- nice-to-have; documented for completeness
- **P3** -- out-of-scope for v0.6.0; explicitly recorded for future planning

---

## 1. Operator-action items that must close v0.6.0

These are not deferrals -- they are the final mechanical steps of the v0.6.0 cycle that the agent is not authorized to run autonomously. They block the formal "v0.6.0 shipped" milestone.

### 1.1 Live-Ollama golden + benchmark baseline capture

**Severity**: P1
**Source**: Plan sub-task 8.1; pre-flight Q1 = B
**Files**: `tests/golden/baselines/v0.4.0.json` (does not exist), `tests/golden/baselines/v0.6.0.json` (does not exist), `tests/benchmarks/baselines/v0.6.0.json` (mid-cycle measurement; needs post-Phase-7 regeneration)

The Phase 8 history doc Section 3.1 documents the full procedure. Three artifacts:

1. `tests/benchmarks/baselines/v0.6.0.json` regenerated against the post-Phase-7 build via `npm run bench -- --update-baseline`.
2. `tests/golden/baselines/v0.6.0.json` captured via `python tests/golden/framework/run_all.py --model gemma4:e4b --output ...` against live Ollama.
3. `tests/golden/baselines/v0.4.0.json` captured via `git worktree add ../Gemma-Code-v0.4.0 v0.4.0`, copying the *current* framework into the worktree (so the comparison is apples-to-apples), `npm ci`, and running the suite there.

Once all three are captured, run `scripts/check-bench-regressions.mjs` against v0.5.0 and v0.4.0 baselines and document the deltas back into the Phase 8 history doc Section 2.6 placeholder. Update the CHANGELOG `### v0.5.0 retrospective note` block with the measured token-savings number against the v0.4.0 long-arc compare.

**Why deferred**: Requires `ollama serve` running with `gemma4:e4b` pulled on a quiescent dev workstation. The agent does not have the model layer to run live inference.

### 1.2 Post-tag exit verification

**Severity**: P1
**Source**: Plan sub-task 8.6 closing
**Procedure**: Phase 8 history Section 3.3

After the v0.6.0 tag exists on origin/main, check it out clean and re-run the full gate:

```powershell
npm ci
npm run lint && npm run build && npm run test && npm run test:integration && npm run bench && npm run deps:check && npm run catalog:check && npm run perm-tier:check && npm audit --production --audit-level=moderate
```

All must pass with zero errors and zero warnings. Verify the GitHub release artifact contains the VSIX. Re-run pen-test Attack Path A simulation against the v0.6.0 source.

---

## 2. v0.6.0 plan items deferred to v0.7.0

### 2.1 `marked` v4 -> v12 migration

**Severity**: P2
**Source**: Plan sub-task 7.5; conditional escape exercised
**Files**: [src/utils/MarkdownRenderer.ts](../../src/utils/MarkdownRenderer.ts), [package.json](../../package.json) (pinned at `^4.3.0`)

v12 reshapes the `Renderer` API to a single token-object argument (`renderer.code({text, lang, escaped})` instead of `renderer.code(text, lang)`). The three custom renderer methods we override (`code`, `heading`, `link`) all need rewrites. The Phase 7 history records that DOMPurify already provides the sanitisation layer that was the original rationale for the bump, so the upgrade is API modernisation with no security gain.

**Action for v0.7.0**: rewrite the three custom renderers; verify the streaming pipeline still surfaces partial-render fragments correctly; verify the CSP and DOMPurify chain still strip script/style/event-handler tags; bump `marked` to ^12.

### 2.2 Filesystem tool handler split

**Severity**: P2
**Source**: Plan sub-task 6.5; "lower-priority" deferral exercised
**File**: [src/tools/handlers/filesystem.ts](../../src/tools/handlers/filesystem.ts)

The single filesystem.ts handler module ships v0.6.0 with all seven tool handlers (`read_file`, `write_file`, `edit_file`, `create_file`, `delete_file`, `list_directory`, `grep_codebase`). The plan allowed splitting into per-tool files; deferred so the panel decomposition (Phase 6 sub-tasks 6.1-6.4) could be the dominant restructure in the cycle.

**Action for v0.7.0**: optional split into `read.ts`, `write.ts`, `delete.ts`, `directory.ts`, `grep.ts`. Each file imports `pathGuard.resolveInsideWorkspace` and exports its handler. Re-export from a `filesystem/index.ts` to keep the import surface stable.

### 2.3 `GemmaCodePanel.ts` < 400 lines target (partial deviation)

**Severity**: P1
**Source**: Plan Phase 6 acceptance criterion + ADR-0008 documented partial deviation
**File**: [src/panels/GemmaCodePanel.ts](../../src/panels/GemmaCodePanel.ts) (currently 935 lines)

The plan's panel-decomposition target was < 400 lines. Phase 6 reached 935 lines, a 46% reduction from the v0.5.0 baseline of 1,724. The remaining bulk is constructor wiring + init factories. Hoisting the agent-loop / pipeline / orchestrator construction into `ChatController` (the "full ownership" split per ADR-0008) requires re-architecting the `OllamaClient` injection pattern -- the construction graph shares a single `OllamaClient` across five layers; restructuring it for controller ownership is a larger commit than Phase 6 had budget for.

**Action for v0.7.0**: ADR for the new `OllamaClient` injection pattern, then hoist construction into `ChatController`. Target: panel < 400 lines after the hoist; controller takes wiring responsibility from the panel.

### 2.4 Full panel ownership hoist into `ChatController`

**Severity**: P1
**Source**: ADR-0008 neutral consequence; tracked dependency for 2.3

Same scope as 2.3 from the controller side. The `ChatController` currently owns *flow* (submitUserMessage, cancelInFlight, approveStep, plan detection, memory injection) but not *wiring*. The plan called for full ownership; the Phase 6 weaker variant kept wiring in the panel. v0.7.0 should move wiring inward.

---

## 3. Definition-of-Done partial deviations

These are items that the v0.6.0 plan's "Definition of Done" listed but that landed only partially. Each is a v0.7.0 carryover.

### 3.1 `tests/golden/baselines/v0.4.0.json + v0.5.0.json + v0.6.0.json` exist

**Severity**: P1

Status:

- **v0.4.0.json**: does not exist. Never captured at v0.5.0 ship; cannot be recovered from the v0.4.0 git tag (`git show v0.4.0:tests/golden/baselines/` returns only v0.3.0 files). Operator-action item 1.1 captures it via worktree + live Ollama.
- **v0.5.0.json**: does not exist as a single canonical file. The v0.5.0 cycle shipped two scoped baselines instead -- `v0.5.0+memory-hygiene.json` and `v0.5.0+agent-friendly.json`. Decision needed: consolidate into `v0.5.0.json` or accept the scoped split as canonical.
- **v0.6.0.json**: does not exist. Operator-action item 1.1.

**Action for v0.7.0**: the operator captures v0.4.0.json and v0.6.0.json (1.1). Decide v0.5.0.json policy and either consolidate or document the scoped split.

### 3.2 `tests/benchmarks/baselines/v0.6.0.json` regenerated post-Phase-7

**Severity**: P2

The file exists (created mid-cycle around Phase 1-2), but the plan called for regenerating it post-Phase-7 to capture the final shape of the cycle (the `marked` deferral, Stryker findings, polish-phase code paths). The mid-cycle measurement is shippable but stale.

**Action for v0.7.0**: covered by operator-action item 1.1 step 1.

### 3.3 CHANGELOG `>= 40%` token-savings claim verified

**Severity**: P2

Resolved in v0.6.0 by a retrospective note that acknowledges the claim was a *target*, not a verified shipping number, and points at the operator-action capture. The note is honest but the *measurement* still has not been done. Once 1.1 lands, the operator updates the CHANGELOG retrospective block with the measured number, or, if the measured number is below 40%, with the actual figure plus the gap rationale.

**Action for v0.7.0**: triggered by 1.1 completion.

---

## 4. Mutation-testing gaps (Stryker quarterly run)

Phase 7 sub-task 7.6 ran a one-shot Stryker pass on a focused runner over `tests/unit/guardrails/**`, `tests/unit/tools/handlers/**`, and `tests/unit/utils/secretPaths.test.ts`. Result: **50.64% overall mutation score** (58.92% covered) across 1,878 mutants. Killed 934, survived 663, timeout 17, no-coverage 264.

### 4.1 `policy.ts` 0% mutation score

**Severity**: P2
**File**: [src/guardrails/policy.ts](../../src/guardrails/policy.ts) (15 mutants, 0 killed)

The file is a static lookup table. Mutations either change tier values (caught by behavioural tests against the table that aren't in the focused Stryker runner) or change the table identity entirely (visible in the mutation report but not exploitable through the public API). Phase 7 deemed this acceptable for the polish phase.

**Action for v0.7.0**: either add a line-level lookup test, or expand the Stryker runner to include the behavioural tests that catch the table-value mutations.

### 4.2 `ActionClassifier.ts` 108 surviving mutants

**Severity**: P2
**File**: [src/guardrails/ActionClassifier.ts](../../src/guardrails/ActionClassifier.ts) (164 total, 55 killed)

Largest absolute survivor count. The module is pattern-matching code: many mutations replace one regex/string variant with another that is functionally indistinguishable from the agent's perspective. Closing every survivor would mean pinning every regex literal or rewriting the module.

**Action for v0.7.0**: targeted regression tests for the 5-10 highest-impact survivors (the ones that change classifier output for a real agent input).

### 4.3 `terminal.ts` 128 surviving mutants

**Severity**: P2
**File**: [src/tools/handlers/terminal.ts](../../src/tools/handlers/terminal.ts) (245 total, 102 killed)

Same root cause as 4.2: regex-heavy allowlist + denylist code where many mutations are functionally equivalent.

**Action for v0.7.0**: targeted regression tests for the survivors that change allowlist verdicts or that bypass the denylist segment-check from v0.1.0 Phase 8.

### 4.4 `filesystem.ts` 287 surviving mutants

**Severity**: P2
**File**: [src/tools/handlers/filesystem.ts](../../src/tools/handlers/filesystem.ts) (958 total, 472 killed; 183 no-coverage)

Largest absolute total in the focused runner. 183 mutants have no coverage at all -- these are likely error paths that the test suite does not exercise. Phase 7 left this for the next quarterly Stryker pass.

**Action for v0.7.0**: identify the no-coverage clusters (probably the create_file / delete_file / list_directory error branches) and add targeted error-path tests.

### 4.5 `Orchestrator.test.ts` excluded from Stryker runner

**Severity**: P3
**File**: [tests/unit/orchestration/Orchestrator.test.ts](../../tests/unit/orchestration/Orchestrator.test.ts)

The test asserts `totalTimeMs > 0` and is timing-sensitive; under Stryker's per-test sandbox it flakes. The Phase 7 narrow runner excludes it. Mutation coverage of the orchestration layer is therefore untested.

**Action for v0.7.0**: rewrite the timing assertion as `totalTimeMs >= 0` (it can legitimately be 0 on fast machines) so the test is Stryker-safe, then re-include the orchestration directory in the Stryker config.

---

## 5. Pre-existing bugs and warnings observed but not fixed

### 5.1 Native-cleanup segfault on Node 24 + better-sqlite3

**Severity**: P2
**Files**: process-level; observed when running `npm test` on the v0.6.0 main branch under Node 24

After all suites complete and vitest reports its summary, the process exits with `Segmentation fault` and truncates the trailing `Test Files passed | failed` summary line. The Phase 7 history confirmed and the Phase 8 verification re-confirmed: this is a teardown-only race in the better-sqlite3 native module's process-exit callback when running on Node 24. **It does not affect test results or exit codes.** Phase 7 sub-task 7.7 fixed `npm run bench` to pass `--run` so the bench process exits cleanly; the same fix does not apply to `npm test` because vitest already exits cleanly after reporting -- the segfault happens in a final destructor pass.

**Action for v0.7.0**: track upstream better-sqlite3 issue (likely tied to a tracked v8 destructor change in Node 24); pin Node 22 in the dev `.nvmrc` if the issue isn't resolved upstream by mid-v0.7.0; consider a `process.exit(code)` call from the vitest reporter once tests finish to skip the destructor pass.

### 5.2 CRLF/LF line-ending normalization warnings on Windows

**Severity**: P3
**Files**: every `.md`, `.ts` edit on Windows triggers `git diff: warning: in the working copy of 'X', LF will be replaced by CRLF the next time Git touches it`

Cosmetic only -- git's autocrlf normalization on Windows rewrites the file's line endings on next checkout; the warning indicates the working-tree LF will be converted. The repository is configured for cross-platform development; the warnings do not affect commits.

**Action for v0.7.0**: optional `.gitattributes` tightening if the warnings become noise. Not required.

### 5.3 `docs/v0.7.0/comparison-multi-source.md` and `docs/v0.7.0/plans/` were untracked at Phase 8 start

**Severity**: P3
**Files**: `docs/v0.7.0/comparison-multi-source.md`, `docs/v0.7.0/plans/adoption-multi-source.md`, `docs/v0.7.0/plans/v0.7.0-cycle.md`

These files appeared in the working tree before Phase 8 began (likely from a parallel exploration session). v0.6.0 Phase 8 explicitly did **not** stage or commit them per the project's scope-discipline rule ("Every changed line must trace directly to the user's request"). They are still untracked as of the v0.6.0 tag.

**Action for v0.7.0**: review the files, decide whether they form a valid v0.7.0 cycle plan or should be reset, and stage/commit accordingly. Until then they are pre-existing local state, not part of v0.6.0.

---

## 6. Documented-but-not-implemented items closed in v0.6.0 (audit trail)

For completeness, every documented-but-not-implemented claim that v0.6.0 *did* close. This list confirms the cycle's promise -- nothing in this list is a v0.7.0 carryover.

- **`PredictiveCache` wire-or-delete decision** -- Option B (delete). [ADR-0009](../adr/0009-predictive-cache-decision.md). Closes pen-test F-008, codebase-review #7, known-gaps Section 4.
- **Per-provenance threshold elevation** -- Option A (implement). [ADR-0010](../adr/0010-threshold-elevation-decision.md). Closes pen-test F-007, known-gaps Section 4.2.
- **Filesystem path-guard split-brain** -- unified. [ADR-0006](../adr/0006-unified-path-guard.md). Closes pen-test F-001 + Attack Path A symlink leg.
- **`permissionOverrides` tier-2 downgrade leak** -- clamped. [ADR-0007](../adr/0007-permission-tier-floor.md). Closes pen-test F-003 + Attack Path A auto-approve leg.
- **MCP confirmation peer-attribution** -- threaded. Closes pen-test F-004.
- **Outbound HTTP body cap** -- 5 MB. Closes pen-test F-002.
- **MCP exposed-tools allowlist** -- read-only by default. Closes pen-test F-004's surface leg.
- **Cache-probe fingerprint** -- SHA-256. Closes pen-test F-005.
- **`innerHTML` concatenation ESLint rule** -- enforced. Closes pen-test F-006.
- **Example webhook obfuscation in docs** -- closed. Closes pen-test F-011.
- **Legacy `gemma-code.gpuTier` shim** -- removed.
- **FIFO-vs-LRU mismatch in `ToolOutputCache.prune()`** -- reconciled. `accessed_at` column + true LRU.
- **Three architecture-doc inaccuracies** -- closed. Meta-test path corrected; v0.4.0 ship date corrected; permission-tier table programmatically generated.
- **Four `BASELINE-2026-04-25; ratchet by v0.6.0` exceptions** -- removed.
- **Two circular import cycles** -- broken (`MemoryStore <-> MemoryConsolidator` via `MemoryShared.types.ts`; `SubAgentManager <-> SubAgentTool` via `SubAgentSpawner.types.ts`).
- **12 token-estimation tests** -- rewritten as property-based tests against tiktoken cross-check helper.
- **`createConversationManager` bench import** -- replaced with `new ConversationManager("")`.
- **`GpuDetector.ts` lint warning** -- closed; `npm run lint` is now zero errors / zero warnings.
- **CI failures masked by exit-code-truncating segfault** -- closed (`npm run bench` passes `--run`).
- **`MemoryConsolidator.consolidate` per-event fsync storm** -- wrapped in `db.transaction()`; 10K-event stress < 5 s.
- **Coverage gate lcov-HTML regex scrape** -- replaced with `coverage-summary.json` + `jq`.
- **Hand-rolled `globToRegex` in secretPaths** -- swapped to `minimatch`.

---

## 7. Out-of-scope items (recorded for v0.7.0+ planning)

These items were explicitly off the v0.6.0 cycle's hard-constraint list and are recorded here so v0.7.0 plan authors can decide which to address.

### 7.1 Cross-version carryovers

| Item | Origin | Notes |
|---|---|---|
| LSTM predictive caching | v0.5.0 architecture §12; v0.6.0 ADR-0009 | Hard constraint OUT. ADR-0009 closes the ARIMA prototype; future predictive layer needs a fresh ADR. |
| Multi-provider LLM proxy | v0.5.0 architecture §12 | Out of scope. The current `OllamaClient` is the only provider. |
| Voice transcription | v0.5.0 architecture §12 | Out of scope. |
| Distributed cache | v0.5.0 architecture §12 | Out of scope. |
| `/memory prune --apply`, `/memory lint --apply` | v0.5.0 architecture §12 | Write-side memory cleanup. Read-side commands ship; write-side deferred. |
| `format=json` on `read_file` and `run_terminal` | v0.5.0 architecture §12 | Tool-output structured-format extension. |
| Severity-rubric CI gate that fails builds | v0.5.0 architecture §12 | Currently informational; gating decision deferred. |
| Streaming reads for files > 1 MB | v0.5.0 architecture §12 | Current 1 MB pagination ceiling assumed sufficient. |
| Auto-merge for Dependabot PRs | v0.5.0 architecture §12 | Manual merge today; no automation. |

### 7.2 Forward-looking items from the original tech stack

| Item | Origin | Notes |
|---|---|---|
| Rust performance components | README, v0.1.0 plan | "Future phases" placeholder; not started. |
| Go CLI tooling for project scaffolding | README, v0.1.0 plan | Same. |
| ripgrep-backed `GrepCodebaseTool` | v0.1.0 known limitations | Current implementation uses `vscode.workspace.findFiles`. |
| Extension Marketplace publication | v0.5.0 release notes | VSIX ships; Marketplace listing not yet pursued. |
| Tree-sitter AST parsing | v0.5.0 deferred list | Semantic code understanding for retrieval. |
| SSE transport for MCP server | v0.5.0 known limitations | Current MCP transport is stdio only. |

### 7.3 Cleanups visible in the v0.6.0 codebase

| Item | Severity | Files |
|---|---|---|
| `tsconfig.json` lives at root; `configs/tsconfig*.json` in glob results are nested under `node_modules`, `.stryker-tmp`, and `tests/golden/snapshots` (operating fixtures, not project configs). The project layout is correct; no action needed unless a future hoist relocates the root config to `configs/`. | P3 | -- |
| `docs/index.md` is auto-generated; the catalog-sync CI job catches drift but the `npm run catalog` step requires manual re-run during local development. Consider pre-commit hook integration. | P3 | [scripts/generate-catalog.mjs](../../scripts/generate-catalog.mjs) |
| `scripts/hooks/lib/secret-paths.mjs` and `src/tools/handlers/secretPaths.ts` are intentionally duplicated (per AGENTS.md harness contract: `scripts/**` is excluded from packaged extension). Sync test [tests/unit/hooks/secret-paths-sync.test.ts](../../tests/unit/hooks/secret-paths-sync.test.ts) enforces equality. Future `secretPaths` updates require touching both. | P3 | -- |
| `tests/golden/snapshots/*/tsconfig.json` and `tests/golden/snapshots/*/package.json` are per-task fixture isolation; `npm install` in the snapshot directories happens lazily. The .stryker-tmp/ directory still has six sandbox-* subdirectories from prior Stryker runs (gitignored). | P3 | -- |

---

## 8. v0.7.0 plan starter

A v0.7.0 plan author should:

1. Run the operator-action items in Section 1 first to formally close v0.6.0.
2. Pick from Sections 2-4 for the v0.7.0 scope. Section 2 (deferrals) and Section 3 (DoD partials) are the highest priority because they are *explicit promises* the v0.6.0 cycle deferred.
3. Decide which of Section 7's out-of-scope items, if any, fit the v0.7.0 cycle theme.
4. Record any *new* findings from a fresh codebase review / security audit pass at `docs/v0.7.0/review/`.

A draft v0.7.0 cycle plan exists at [docs/v0.7.0/plans/v0.7.0-cycle.md](./plans/v0.7.0-cycle.md) (untracked at v0.6.0 ship; see Section 5.3).

## 9. Severity roll-up

| Severity | Count | Examples |
|---|---|---|
| P0 | 0 | -- |
| P1 | 5 | 1.1, 1.2, 2.3, 2.4, 3.1 |
| P2 | 12 | 2.1, 2.2, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2 |
| P3 | 6 | 4.5, 5.3, 7.3 (3 entries) |

Zero P0 carryovers means the v0.6.0 Definition-of-Done criterion "Zero P0 findings post-cycle" is satisfied. The five P1 items are the v0.7.0 floor.
