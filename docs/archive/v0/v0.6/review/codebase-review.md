# Codebase Review: Gemma Code

**Version**: v0.5.4 (pre-v0.6.0 review pass)
**Review Date**: 2026-04-27
**Analysis Source**: Cached from [analysis.md](analysis.md) (2026-04-27); security findings cross-referenced from [security-audit.md](security-audit.md) and [penetration-test.md](penetration-test.md)
**Inputs folded in**: [docs/archive/versions/v0/v0.5.0/known-gaps.md](known-gaps.md)
**Reviewer**: Claude Code -- review-codebase command
**Review Mode**: Full Codebase
**Files Reviewed**: 110 source TS + 140 test TS + 10 benchmark TS + 8 GitHub Actions workflows + 3 configs + 7 ADRs
**Overall Verdict**: **REQUEST_CHANGES** -- 1 P0 (security review chain), 6 P1 (split-brain path guard, god-class panels, missing release-gate baselines, dead-code predictive cache, doc/code drift on threshold elevation, 12 failing tests masking CI), 9 P2, 11 P3

---

## Section 1: Codebase Overview

Gemma Code is a local-first agentic coding assistant for VS Code, built around the thesis that a private offline LLM (Google's Gemma 4 via Ollama) can match the productivity of cloud-based assistants for solo developers without the privacy, latency, or subscription cost. The product surface is a webview chat panel plus a deep tool catalog (10 tools spanning filesystem, terminal, grep, web fetch, MCP); the engineering surface is a layered TypeScript codebase of 110 source files (24,705 LoC), 140 test files (22,212 LoC -- a 0.9:1 test-to-source ratio), 10 vitest benchmark files, and 24 declarative golden-task YAML evaluations.

Architecturally the codebase is **port-and-adapter with hard module-boundary rules**, codified by `dependency-cruiser` and CI-gated. `src/llm/` is the only module allowed to know that Ollama exists; `src/storage/` owns every SQLite handle; `src/tools/handlers/` owns every side effect; `src/panels/` is forbidden from importing `src/storage/` directly. Four pre-existing baseline exceptions to those rules carry a `BASELINE-2026-04-25; ratchet by v0.6.0` annotation and are tracked as a v0.6.0 hygiene item.

The release sequence shipped over the v0.5.0 cycle is unusually disciplined: 12 phases, each documented in [docs/archive/versions/v0/v0.5.0/development/history/](../../v0.5/development/history), each with an executable plan, an exit checklist, and an ADR for material decisions. Five ADRs cover the live architecture (Python backend disposition, memory subsystem layering, compaction strategy ordering, sub-agent isolation contract, tool permission tiers). The `AGENTS.md` directive replaces vendor-specific files (`CLAUDE.md` is enforced as non-existent by a meta-test). The repository carries a strict `--max-warnings=0` ESLint discipline at commit time, husky pre-commit hooks, semantic-release on push to main, conventional-commit linting, an 80%-line / 75%-branch coverage gate, an `npm audit --production --audit-level=high` gate, and a parallel `pip-audit --strict` gate against the bundled PyQt5 installer venv.

Current state: actively maturing. The shipped surface is stable; the carry-over technical debt items (12 failing token-estimation tests, missing release-gate baselines, dead-code predictive layer, four module-boundary baseline exceptions, an unimplemented documented control) are well-cataloged in [docs/archive/versions/v0/v0.5.0/known-gaps.md](known-gaps.md) and motivate the v0.6.0 cycle. Out-of-scope items recorded for v0.6.0+ include `/memory prune --apply` and `/memory lint --apply` (write-side memory cleanup), `format=json` on `read_file`/`run_terminal`, streaming reads for files > 1 MB, severity-rubric CI gate, and auto-merge for Dependabot PRs.

---

## Section 2: Executive Summary

### Verdict

| Severity | Count |
|----------|-------|
| P0 (Critical) | 1 |
| P1 (High) | 6 |
| P2 (Medium) | 9 |
| P3 (Low) | 11 |
| **Total** | 27 |

**Verdict rationale**: The single P0 is the chained risk surfaced by the [penetration-test.md](penetration-test.md) -- a hostile workspace that combines a symlink in `filesystem.ts` lexical path resolution (F-001 in pen-test) with a `permissionOverrides` tier-2 downgrade (F-003) yields a single-prompt RCE / data-loss path. Either fix breaks the chain, but neither is in v0.5.4 today. The six P1s are a mix of test-pipeline reliability gaps that masked the v0.5.0 release, two god-class hotspots that drag every adjacent change, dead code in the predictive cache, doc/code drift in the embedding threshold elevation, and the missing v0.5.0 release-gate baselines that leave the CHANGELOG's `>=40% token savings` claim unverified. None of these are ship-blocking individually for v0.5.4 (it has shipped); they are the v0.6.0 priority list.

### Critical Issues (P0)

| # | Phase | Location | Issue |
|---|---|---|---|
| 1 | Security (chain) | [src/tools/handlers/filesystem.ts:43-51](../../../../src/tools/handlers/filesystem.ts#L43-L51) + [src/guardrails/PermissionTiers.ts](../../../../src/guardrails/PermissionTiers.ts) | Lexical path resolution + tier-2 downgrade in `permissionOverrides` chains into single-prompt RCE on a hostile workspace. Either F-001 (filesystem path-guard unification) or F-003 (tier-2 floor clamp) breaks the chain. See [penetration-test.md](penetration-test.md) Path A. |

### Areas Requiring Most Attention

1. **`src/panels/`** -- the largest source files in the repo are here: [GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts) at **1,719 lines** and [webview/index.ts](../../../../src/panels/webview/index.ts) at **1,567 lines**. Both are documented "deferred refactors" in the [v0.4.0 starting point](../../../../src/runtime/GemmaRuntime.ts) comment (the `ChatController` / `ChatWebviewHost` extraction has been deferred since v0.4.0). They concentrate ~13% of total source LoC in two files and are the dominant compile/test/review-time tax.
2. **`src/storage/`** -- second-largest area. [ToolOutputCache.ts](../../../../src/storage/ToolOutputCache.ts) (974 lines), [MemoryStore.ts](../../../../src/storage/MemoryStore.ts) (839 lines), [GraphMemory.ts](../../../../src/storage/GraphMemory.ts) (443 lines). The cache/memory split is conceptually clean but the SQL-vs-Js split inside each file would benefit from a per-table `*Sql.ts` companion.
3. **Test pipeline** -- 12 failing assertions, 4 missing baseline files, 3 unbuilt benchmark files, no v0.4.0 golden baseline at all (so the CHANGELOG's `>=40%` claim is unverified). The test-to-source ratio is healthy (0.9:1) but the gates do not catch what they should.
4. **Module-boundary ratchet** -- 4 baseline exceptions tagged for v0.6.0; the cleanest path is to move `secretPaths` and `Compressor` out of `src/tools/handlers/` to dissolve the storage->tools edge.

### Restructuring Priority

Three structural changes deliver the biggest payoff for v0.6.0:

1. **Split `GemmaCodePanel.ts`** into a `ChatController` (orchestration) + `ChatWebviewHost` (postMessage boundary) + dedicated subscription handlers. This was already declared a deferred refactor in `GemmaRuntime.ts`. Effort: high.
2. **Unify path-guarding** behind `pathGuard.resolveInsideWorkspace` so every tool handler uses the same realpath-aware boundary check. Closes the P0 path-traversal chain. Effort: low.
3. **Ratchet the dependency-cruiser baseline** by moving `secretPaths` and `Compressor` to `src/utils/`, routing `EmbeddingClient` through the LLM port, and routing pre-baseline panels through `panels/messages.ts`. Effort: high (touches many files but each move is mechanical).

### Simplification Potential

1. **Delete the predictive cache layer** if not wired in v0.6.0; the module is unit-tested but has no callers. ~600 lines + 1 setting + 1 architecture-doc paragraph.
2. **Delete the legacy `gemma-code.gpuTier` setting fallback** in [src/config/settings.ts:46-58](../../../../src/config/settings.ts#L46-L58); its TODO is overdue.
3. **Replace the inline Python coverage parser** in [.github/workflows/ci.yml:125-137](../../../../.github/workflows/ci.yml#L125-L137) with a one-line `jq` over `coverage-summary.json`.
4. **Drop `tests/golden/snapshots/*/.gitkeep`** entries from `.gitignore` once the directories have content (low value).

### Test Pipeline Gap Summary

Despite a 0.9:1 test-to-source line ratio and a 80%-line / 75%-branch coverage gate, the suite has structural blind spots that masked the v0.5.0 release:

- **12 failing assertions** in three files about tiktoken-replaced behavior shipped green, suggesting the CI fail-on-error wiring needs verification.
- **No v0.4.0 golden baseline** ever existed, so the "*≥40% token savings vs. v0.4.0*" claim in the CHANGELOG cannot be verified.
- **No v0.5.0 benchmark baseline** captured (the Phase 12.6 release gate calls for hooks p99 < 50 ms, `tool-execution` p99 within +5 ms; never measured).
- **Three plan-required test files were never created**: `tests/benchmarks/predictive-cache.bench.ts`, `tests/benchmarks/eviction-strategies.bench.ts`, `tests/integration/heuristic-fallback.test.ts`. Two cover features (W-TinyLFU vs. ARC vs. LRU hit-rate; heuristic-tagged threshold elevation) that the architecture doc treats as shipped but lack regression guards.
- **No symlink regression test** for the filesystem path guard. The P0 finding was reachable via static analysis because no test exercises the symlink scenario.

### Roadmap

**Immediate (P0, fix now)**:
1. Unify `filesystem.ts:resolveWorkspacePath` to delegate to `pathGuard.resolveInsideWorkspace` and add a symlink regression test (closes the security chain).
2. Clamp tier-2 tools so `permissionOverrides[name]` cannot drop below 1 (closes the same chain from the other side).

**Short-term (P1, before v0.6.0 release)**:
3. Verify CI actually fails on `vitest` non-zero exit; rewrite the 12 token-estimation assertions to be tiktoken-shaped or property-based.
4. Either implement or retract the `embedding_provenance` threshold elevation (doc/code drift).
5. Wire `PredictiveCache.observe()` into `ToolOutputCache.lookup()` or delete the predictive layer.
6. Generate the missing v0.4.0 + v0.5.0 baselines or retract the `>=40%` CHANGELOG claim.
7. Bound `fetchWithSsrfGuard` response body size; add streaming-abort regression test.
8. Ratchet `npm audit` gate to `--audit-level=moderate`; absorb the available `hono` patch.

**Medium-term (P2, v0.6.0 cycle)**:
9. Split `GemmaCodePanel.ts` (1,719 lines) into `ChatController` + `ChatWebviewHost`.
10. Move `secretPaths`/`Compressor` to `src/utils/`; ratchet 3 of 4 module-boundary baseline exceptions.
11. Add ESLint rule against `\.innerHTML\s*=\s*[^=]+\+` to harden the webview pattern.
12. Replace SHA-1 in `Compressor.ts:112` with SHA-256.
13. Switch coverage gate from inline Python regex to `coverage-summary.json` parsing.
14. Add MCP peer-attribution to ConfirmationGate prompt text.

**Backlog (P3 + strategic restructuring)**:
15-27. See Section 4 P3 list.

---

## Section 3: Detailed Findings

### 3.1 Code Quality and SOLID

#### File-size hotspots (P1)

**[P1] God class -- `GemmaCodePanel.ts` at 1,719 lines**
- **Location**: [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts)
- **Issue**: Single class hosts the webview lifecycle, the agent-loop wiring, the message router, the tool-confirmation surface, the streaming-token plumbing, and the session-history rendering. The class comment in [GemmaRuntime.ts](../../../../src/runtime/GemmaRuntime.ts) explicitly notes the `ChatController` / `ChatWebviewHost` extraction has been deferred since v0.4.0.
- **Recommendation**: Extract three classes:
  - `ChatController` -- orchestrates the agent loop, owns `Conversation`, holds the streaming pipeline.
  - `ChatWebviewHost` -- owns the `vscode.WebviewPanel`, the postMessage boundary, the CSP/HTML scaffolding.
  - `ChatCommandHandlers` -- the slash-command dispatchers (`/memory`, `/cache`, `/skills`).
  Effort: high. Defer subordinate refactors (per-handler files, per-event listener types) to a later pass; the first split delivers the majority of the legibility benefit.

**[P1] God module -- `panels/webview/index.ts` at 1,567 lines**
- **Location**: [src/panels/webview/index.ts](../../../../src/panels/webview/index.ts)
- **Issue**: Single TypeScript file emits the HTML scaffold, the inline JavaScript that runs in the webview, every render function, every message handler, and the autocomplete logic. Webview scripts live inside template literals which makes the JS un-typed.
- **Recommendation**: Split into:
  - `webview/index.ts` -- HTML scaffold + CSP nonce generation only.
  - `webview/render.ts` -- pure render functions (taking data, returning HTML strings via the `createElement` helper recommended in F-006/pen-test).
  - `webview/messages.ts` -- typed postMessage handlers shared with `panels/messages.ts`.
  Effort: medium. The webview-script-as-template-literal pattern is a known VS Code pain; consider a build step that compiles a separate `webview-bundle.js` from typed TS sources.

**[P2] `src/tools/handlers/filesystem.ts` at 1,245 lines**
- **Location**: [src/tools/handlers/filesystem.ts](../../../../src/tools/handlers/filesystem.ts)
- **Issue**: All seven filesystem tools (read/write/edit/create/delete/list/grep) co-locate. Each tool's logic is reasonable in isolation but the file is hard to navigate.
- **Recommendation**: Split into one file per tool (`readFile.ts`, `writeFile.ts`, ...) under `src/tools/handlers/filesystem/`, with shared helpers (`pathGuard`, `secretPaths`, the diff renderer) imported. Effort: medium.

**[P2] `src/storage/ToolOutputCache.ts` at 974 lines + `MemoryStore.ts` at 839 lines**
- **Location**: [src/storage/ToolOutputCache.ts](../../../../src/storage/ToolOutputCache.ts), [src/storage/MemoryStore.ts](../../../../src/storage/MemoryStore.ts)
- **Issue**: Each file mixes prepared-statement strings, schema migrations, business logic, and per-row-type query helpers. The SQL strings would benefit from a per-table companion.
- **Recommendation**: Per-store, extract `<Name>Sql.ts` containing the prepared-statement strings + migration DDLs. Keep behavior in the main file. Effort: low per file; benefits future migrations.

#### TODO/FIXME/HACK audit (clean)

| Comment | Location | Assessment |
|---|---|---|
| 1 TODO marker | [src/tools/handlers/filesystem.ts](../../../../src/tools/handlers/filesystem.ts) | Untracked debt -- assess and either close or convert to issue |
| 1 TODO marker | [src/tools/ToolCatalog.ts](../../../../src/tools/ToolCatalog.ts) | Untracked debt -- same |
| 1 TODO marker | `src/skills/catalog/analyze-codebase/SKILL.md` | Skill content; not source code |

A grep across `src/` for `TODO|FIXME|HACK|XXX|BASELINE-` returns only **3** matches across **3** files. This is exceptionally clean and reflects the v0.5.0 documentation discipline. The 4 baseline exceptions in `dependency-cruiser.cjs` (Section 6c) are tracked separately in known-gaps.md.

#### Dead code

| Item | Location | Classification | Rationale |
|---|---|---|---|
| `PredictiveCache` module + setting | [src/storage/PredictiveCache.ts](../../../../src/storage/PredictiveCache.ts) | Defer-with-plan | Setting is exposed but no caller; either wire (per F-003 in security-audit.md) or delete in v0.6.0 |
| `gemma-code.gpuTier` legacy fallback | [src/config/settings.ts:46-58](../../../../src/config/settings.ts#L46-L58) | Safe-delete-now | Comment says "remove in v0.5"; v0.5.x has shipped |

### 3.2 Security

The full security finding set is in [security-audit.md](security-audit.md) (14 findings) and [penetration-test.md](penetration-test.md) (15 findings, with attack-chain narratives and STRIDE matrix). This section summarizes for the prioritized roadmap; do not duplicate the analysis.

| Severity | Count | See |
|---|---|---|
| P0 | 1 | Pen-test Attack Path A: F-001 + F-003 chain |
| P1 | 4 | Pen-test F-002 (body cap), F-004 (MCP attribution), F-005 (audit gate), F-006 (innerHTML pattern) |
| P2 | 9 | Pen-test F-007 through F-015 |

The codebase's security posture is **strong** for an offline VS Code extension: tight CSP, SSRF guard, secret-path denylist, parameterized SQL, DOMPurify-sanitized markdown, no eval/exec/pickle/yaml.load surfaces, no hardcoded secrets, comprehensive `.gitignore`. The single P0 is a chained finding -- two MEDIUM issues that compose into a HIGH-impact path-traversal exploit on a hostile workspace.

### 3.3 Performance

#### [P1] No v0.5.0 benchmark baseline captured; release-gate p99 thresholds unverified

- **Location**: [docs/archive/versions/v0/v0.5.0/known-gaps.md](known-gaps.md) section 2.1; [tests/benchmarks/baselines/](../../../../tests/benchmarks/baselines)
- **Pattern**: Missing performance regression artifact
- **Impact**: The Phase 12.6 release gate calls for hooks p99 < 50 ms, `tool-execution` p99 within +5 ms vs. v0.4.0, `context-compaction` and `cache-hit` p99 within +10%. None of these were measured for v0.5.0; the next contributor cannot tell whether v0.5.0 introduced a regression.
- **Recommendation**: Run `npm run bench` on a quiescent workstation, save as `tests/benchmarks/baselines/v0.5.0.json`, run `scripts/check-bench-regressions.mjs` against the v0.4.0 baseline, fold into the v0.6.0 plan as a phase-1 prerequisite.

#### [P2] FIFO-by-`stored_at` eviction is documented as LRU

- **Location**: [src/storage/ToolOutputCache.ts](../../../../src/storage/ToolOutputCache.ts) `prune()` method; [docs/archive/versions/v0/v0.5.0/architecture.md](../../v0.5/architecture.md) Section 4
- **Pattern**: Cache eviction strategy mismatch with documented behavior
- **Impact**: Hot files re-read in long sessions may evict before cold one-shot files, lowering hit rate vs. what the doc implies. Magnitude depends on workload; on the 50-entry in-process LRU front, the SQLite tier's behavior matters most for sessions > 8 hours.
- **Recommendation**: Either add an `accessed_at` column and run `prune()` ordered by `accessed_at` (true LRU), or update the architecture doc to say "FIFO-by-storage-time -- in-process LRU is the access-recency cache". Effort: low.

#### [P2] `OllamaHttp.combineSignal` allocates a new `AbortController` per request

- **Location**: [src/llm/OllamaHttp.ts:27-37](../../../../src/llm/OllamaHttp.ts#L27-L37)
- **Pattern**: Per-request allocation in a streaming hot path
- **Impact**: Modest. Each chat turn creates 1-2 controllers + listeners. Pooling is overkill; the pattern is fine. Flagged only as a P2 informational because the file holds the 5 ms p99 budget.
- **Recommendation**: No change required. Document in the architecture doc that the pattern is intentional.

#### [P3] Webview re-renders entire trace list and waterfall on every update

- **Location**: [src/panels/webview/traceDashboard.ts](../../../../src/panels/webview/traceDashboard.ts)
- **Pattern**: Wholesale `innerHTML` re-assignment instead of diff-based updates
- **Impact**: For sessions with > 100 traces this is observable as a flicker. Most users will not notice.
- **Recommendation**: Defer until F-006 refactor (createElement + diff). Effort: medium.

#### [P3] `MemoryConsolidator` runs SQL upserts inside a row iteration

- **Location**: [src/storage/MemoryConsolidator.ts](../../../../src/storage/MemoryConsolidator.ts)
- **Pattern**: Per-row write inside a read iteration; no batch transaction
- **Impact**: better-sqlite3's WAL absorbs this for the < 10K-entry typical case but a stress-test session at the `gemma-code.memoryMaxEntries = 100000` ceiling would benefit from a single transaction wrapping the consolidation pass.
- **Recommendation**: Wrap the consolidation pass in a `db.transaction(() => {...})`. Effort: low.

### 3.4 Testing Audit

#### Current Test Inventory

| Test type | Count | Location | Quality assessment |
|---|---|---|---|
| Unit | ~120 files | `tests/unit/` (mirrors `src/`) | Good -- AAA pattern, descriptive names, `beforeEach` lifecycle, `:memory:` SQLite, msw for HTTP mocking. Sample: [tests/unit/storage/GraphMemory.test.ts](../../../../tests/unit/storage/GraphMemory.test.ts) is a representative high-quality example. |
| Integration | ~20 files | `tests/integration/` + `tests/integration/e2e/` | Good -- composed-module tests, no live Ollama needed. Notable files: `memory-across-sessions.test.ts`, `sub-agent-verification.test.ts`, `prompt-budget-compliance.test.ts`, `mcp-tool-integration.test.ts`. |
| E2E | 1 file | `tests/e2e/extension-load.test.ts` | Smoke only -- adequate for CI. |
| Benchmarks | 10 files | `tests/benchmarks/` | Good coverage: rendering, tool execution, skill loading, context compaction, memory recall, golden-task perf, model-tier matrix. **Three plan-required benches not created**: `predictive-cache.bench.ts`, `eviction-strategies.bench.ts`. |
| Golden | 24 YAML tasks | `tests/golden/tasks/` + `tests/golden/snapshots/` + `tests/golden/baselines/` | Categories: refactor, bugfix, multi-file, testgen, review, agent-friendly. v0.4.0 baseline missing (CHANGELOG claim unverified). |
| Smoke | Cross-platform | `tests/smoke/` | Installer smoke -- uses pytest against the PyQt5 venv. |

**Vitest config**: `configs/vitest.config.ts` sets line threshold = 80%, branch threshold = 75%. Coverage excludes `src/**/*.d.ts`, `**/extension.ts`, and `src/utils/**`. The `extension.ts` exclusion is reasonable (activation entry); the `src/utils/**` exclusion is **a coverage hole** -- those utilities are imported by every layer.

#### Feature-to-Test Mapping

| Feature / Capability | Unit | Integration | E2E | Coverage assessment |
|---|---|---|---|---|
| Chat streaming pipeline | Yes | Yes (full-pipeline) | Smoke | Adequate |
| Agent loop / tool execution | Yes | Yes | Smoke | Adequate |
| 10-tool catalog | Yes (per-tool) | Yes | -- | Adequate |
| Permission tier gating | Yes (`ConfirmationGate.test.ts`) | -- | -- | **Gap** -- no integration test for tier-2 tool with `permissionOverrides` set; pen-test F-003 surface untested |
| Path guard / workspace boundary | Yes (`pathGuard`-flavored) | -- | -- | **Critical Gap** -- no symlink-escape test; pen-test F-001 surface untested |
| Secret-path denylist | Yes (`secretPaths.test.ts`) | -- | -- | Adequate |
| SSRF guard | Yes (`ssrf.test.ts`) | -- | -- | **Gap** -- no body-size DoS regression test; pen-test F-002 surface untested |
| SQLite memory layers | Yes (per-layer) | Yes (memory-across-sessions) | -- | Adequate |
| Tool-output cache | Yes | Yes | -- | Adequate |
| Eviction strategies (5) | Yes (per-strategy) | -- | -- | **Gap** -- no head-to-head hit-rate comparison; plan-required bench not created |
| Embedding fallback | Yes (`HeuristicEmbedder`) | Partial (`semantic-recall-fallback.test.ts`) | -- | **Gap** -- threshold elevation untested; pen-test F-007 surface untested |
| Predictive cache | Yes (in isolation) | -- | -- | **Critical Gap** -- not wired; setting has no effect |
| Compaction strategies | Yes | Yes (compaction-under-load) | -- | **Gap** -- 12 failing assertions against tiktoken |
| Sub-agents (verification, research, planning) | Yes | Yes (sub-agent-verification) | -- | Adequate |
| MCP server / client | Yes | Yes (mcp-tool-integration) | -- | **Gap** -- no peer-attribution test for confirmation prompts |
| OTLP exporter | Yes | -- | -- | Adequate |
| Webview rendering | Partial (csp + markdown) | -- | -- | **Gap** -- no DOM-side render tests; CSP backstop covers most cases |
| GPU detection / hardware tier | Yes | -- | -- | Adequate |
| Skill loader | Yes | Yes (skill-execution) | -- | Adequate |

#### Use Case and Edge Case Coverage Matrix

| Workflow | Happy path | Invalid input | Auth failure | Boundary conditions | External failure | Concurrent access |
|---|---|---|---|---|---|---|
| Read file | Y | Y (path traversal lexical) | n/a | Y (1 MB window) | Y (file not found) | n/a |
| Write file | Y | Y | n/a | Y | Y | **Gap** -- no concurrent-edit test |
| Delete file | Y | Y | n/a | Y (dry-run; SHA at 1 MB cap) | Y | n/a |
| Run terminal | Y | Y (denylist + allowlist) | n/a | Y (timeout) | Y | n/a |
| Web search | Y | Y | n/a | Y (rate limit) | Y (DDG offline) | n/a |
| Fetch page | Y | Y (SSRF block) | n/a | **Gap** (no body-size DoS) | Y | n/a |
| Compact context | Partial (12 failing assertions) | Y | n/a | Y | n/a | n/a |
| Memory recall | Y | Y | n/a | Y | Y (Ollama down -> heuristic) | Y |
| MCP tool dispatch | Y | Y | **Gap** (no peer-attribution test) | Y | Y | Y |
| Cache lookup | Y | Y | n/a | Y | n/a | Y |
| Cache eviction | Y (per strategy) | n/a | n/a | Y | n/a | **Gap** (no head-to-head bench) |

#### IQ/OQ/PQ Validation Assessment

| Qualification | Status | Gap Description |
|---|---|---|
| **IQ (Installation)** | Partial | `tests/smoke/` exercises the PyQt5 installer cross-platform. The VS Code extension itself has `tests/e2e/extension-load.test.ts` (1 file) for activation. **Missing**: a packaged-VSIX install-and-activate smoke run on Windows/macOS/Linux runners. |
| **OQ (Operational)** | Adequate | The 24-task golden eval covers operational qualification of the agent's behavior across 5 categories. Boundary conditions (1 MB read window, 64 KB tool cap, 50/500 grep cursor) are unit-tested. The auth/auth-z surface is light because the trust model is workspace-scoped. |
| **PQ (Performance)** | Partial | 10 vitest bench files cover the hot paths (rendering, tool execution, compaction, recall, golden-task perf, model-tier matrix). **Missing**: the v0.5.0 baseline JSON + the regression check-in step from Phase 12.6, plus 2 plan-required bench files. |

#### Traceability Matrix

| Requirement / Capability | Source | Test ID(s) | Test Type | Status |
|---|---|---|---|---|
| AGENTS.md is canonical | architecture.md §1 | `tests/unit/docs/AGENTS-md.test.ts` | Unit (meta) | Covered |
| 64 KB universal output cap | architecture.md §3 | `tests/unit/tools/OutputRedirector.test.ts` | Unit | Covered |
| `read_file` pagination | architecture.md §3 | `tests/unit/tools/handlers/read-range.test.ts` | Unit | Covered |
| `grep_codebase` cursor pagination | architecture.md §3 | `tests/unit/tools/handlers/grep-cursor.test.ts` | Unit | Covered |
| Tool permission tiers (0/1/2) | ADR-0005 | `tests/unit/tools/ConfirmationGate.test.ts` | Unit | Covered |
| `permissionOverrides` clamp | -- | -- | -- | **Not covered** (pen-test F-003) |
| Workspace path-guard | architecture.md §9 | `tests/unit/tools/handlers/secretPaths.test.ts` | Unit | Partial (no symlink test) |
| `dry_run` on `run_terminal` | architecture.md §3 | `tests/unit/tools/handlers/terminal.test.ts` | Unit | Covered |
| `dry_run` on `delete_file` (SHA at 1 MB) | architecture.md §3 | `tests/unit/tools/handlers/filesystem.test.ts` | Unit | Covered |
| Brotli compression | architecture.md §4 | `tests/unit/tools/Compressor.test.ts` | Unit | Covered |
| Persistent SQLite cache | architecture.md §4 | `tests/unit/storage/ToolOutputCache.test.ts` + `tests/integration/cache-across-sessions.test.ts` | Unit + Integration | Covered |
| 5 eviction strategies | architecture.md §4 | `tests/unit/storage/eviction/*.test.ts` (6 files) | Unit | Per-strategy covered; no head-to-head |
| Embedding fallback (heuristic provenance) | architecture.md §4 | `tests/unit/storage/HeuristicEmbedder.test.ts` + `tests/integration/semantic-recall-fallback.test.ts` | Unit + Integration | Partial (threshold elevation not tested because not implemented) |
| Memory corroboration N>=2 | ADR-0002 | `tests/unit/storage/MemoryConsolidator.test.ts` + `memory-hygiene-missed-fact-01.yaml` | Unit + Golden | Covered |
| Compaction strategy ordering | ADR-0003 | `tests/unit/chat/CompactionStrategy.test.ts` (12 failing) | Unit | **Test pipeline gap** |
| Sub-agent isolation | ADR-0004 | `tests/integration/sub-agent-verification.test.ts` | Integration | Covered |
| SSRF guard | architecture.md §9 | `tests/unit/utils/ssrf.test.ts` | Unit | Partial (no body-size DoS) |
| Secret-path denylist | architecture.md §9 | `tests/unit/tools/handlers/secretPaths.test.ts` + `tests/unit/hooks/secret-paths-sync.test.ts` | Unit | Covered |
| 80% line / 75% branch coverage | configs/vitest.config.ts | `npm run test -- --coverage` | CI | Covered |

#### Test Quality Findings

**[P1] Verify CI fail-on-error wiring**

- **Location**: [.github/workflows/ci.yml:42-64](../../../../.github/workflows/ci.yml#L42-L64) (`test-ts` job)
- **Issue**: Twelve unit assertions have been failing since Phase 11 (`bfc0056`); the v0.5.0 release shipped green. The CI step runs `npm run test -- --reporter=verbose --coverage`. The coverage-gate job depends on `test-ts` and runs only on success. The discrepancy needs root-cause: the test step may be silently passing because vitest is exiting 0 in some configuration, the matrix may be hiding failures, or the artifact upload may be running on `if: always()` and masking exit code.
- **Recommendation**: Run `npm run test` locally on `bfc0056`+, confirm non-zero exit. Re-run on the latest `main` to confirm. If the wiring is broken, fix it. If it is correct, the 12 assertions are silently being skipped or the test runner is exiting 0 incorrectly.

**[P2] `tests/setup.ts` global state**

- **Location**: [tests/setup.ts](../../../../tests/setup.ts)
- **Issue**: Vitest setup file applies global mocks and process-level patches. If a test depends on the order of these, it may pass in isolation but fail in CI ordering.
- **Recommendation**: Audit for `vi.spyOn`/`vi.mock` calls that survive across files; isolate each per-test where possible.

**[P3] No mutation testing**

- **Location**: -
- **Issue**: 80% line coverage is well-defended but does not assess test sensitivity. A mutation testing pass (Stryker) on the `src/guardrails/` and `src/tools/handlers/` directories would surface tests that pass on weak assertions.
- **Recommendation**: One-shot Stryker run; track outcomes; do not gate CI on it.

#### Recommended Test Pipeline

| Test type | Purpose | Triggers on | Estimated duration |
|---|---|---|---|
| Lint (`eslint src --max-warnings=0`) | Style + warning regression | Every PR | < 30 s |
| Type-check (`tsc --noEmit`) | TS compile sanity | Every PR | < 60 s |
| Unit (vitest) | Logic correctness | Every PR | < 90 s |
| Integration (vitest tests/integration) | Module interaction | Every PR | < 5 min |
| E2E (vitest tests/e2e) | Extension activation smoke | Pre-merge to main | < 30 s |
| Golden eval (24 YAML tasks) | Agent behavior regression | Pre-merge to main | < 15 min (live Ollama) |
| Benchmarks (vitest bench) | Performance regression | Nightly | < 10 min |
| Golden baseline diff | Token-cost regression | Nightly | < 20 min |
| Installer smoke (pytest) | PyQt5 install across Windows/macOS/Linux | Pre-release tag | < 5 min |
| `npm audit --audit-level=moderate` | Dependency CVEs | Every PR | < 30 s |
| `pip-audit --strict` | Installer CVEs | Every PR | < 90 s |
| `dependency-cruiser` | Module-boundary regression | Every PR | < 30 s |
| `npm run catalog:check` | docs/index.md sync | Every PR | < 10 s |
| Coverage gate (>= 80% lines / 75% branches) | Coverage regression | Every PR | < 30 s |
| Mutation pass (Stryker, opt-in) | Test-sensitivity audit | Quarterly manual | < 1 hr |

What needs to be **built** before this pipeline is complete:

1. The v0.4.0 + v0.5.0 golden baselines (closes the `>=40%` claim).
2. The v0.5.0 benchmark baseline (closes the Phase 12.6 release-gate gap).
3. `tests/integration/heuristic-fallback.test.ts` (validates F-007 either fix path).
4. `tests/unit/tools/handlers/filesystem-symlink.test.ts` (closes the P0 chain regression).
5. `tests/integration/permission-overrides-clamp.test.ts` (closes the same chain).
6. `tests/integration/ssrf-body-size.test.ts` (closes the F-002 DoS class).
7. Optionally: `tests/benchmarks/eviction-strategies.bench.ts` and `tests/benchmarks/predictive-cache.bench.ts` if the predictive layer is wired.

### 3.5 Restructuring Opportunities

#### 6a. Architectural pattern alignment

**[P2] Composition root coverage**
- **Current state**: `GemmaRuntime` is the declared composition root (per its own comment in [src/runtime/GemmaRuntime.ts](../../../../src/runtime/GemmaRuntime.ts)) but its actual scope is small -- it owns the `Tracer` and the settings snapshot. Most cross-cutting state lives inside `GemmaCodePanel`.
- **Proposed state**: Promote `GemmaRuntime` to own everything cross-cutting: ToolRegistry, ToolOutputCache, MemoryStore, MetricsCollector, OtlpExporter. Have `GemmaCodePanel` and `SessionListPanel` consume it via constructor injection, not via global functions.
- **Expected benefit**: Single composition root; testable; eliminates a class of "where does this singleton live?" questions; closes the path to extracting `ChatController` and `ChatWebviewHost` from the panel.
- **Estimated effort**: Medium (2-3 days)
- **Risk**: Low if performed incrementally per cross-cutting concern. Validate with the existing integration suite.

#### 6b. Module and boundary analysis

**[P1] Unify path guarding behind `pathGuard.resolveInsideWorkspace`**
- **Current state**: Two helpers do path resolution -- `pathGuard.resolveInsideWorkspace` (uses `fs.realpathSync`, symlink-aware, defended by terminal handler) and `filesystem.ts:resolveWorkspacePath` (lexical only, used by 7 filesystem tools). The two disagree on symlink semantics; the lexical helper is the P0 finding.
- **Proposed state**: One helper, exported from `pathGuard.ts`, consumed everywhere. Add a CI rule via `dependency-cruiser` that fails any new file constructing paths without going through it.
- **Expected benefit**: Closes pen-test F-001 / Attack Path A. Eliminates split-brain semantics; a future contributor cannot reintroduce the gap.
- **Estimated effort**: Low (< 1 day)
- **Risk**: Low. Existing pathGuard is well-tested. Add a symlink regression test.

**[P2] Move `secretPaths` and `Compressor` from `src/tools/handlers/` to `src/utils/`**
- **Current state**: `ToolOutputCache.ts` and `MemoryHealthCheck.ts` import from `src/tools/handlers/secretPaths` and `src/tools/Compressor`. These are pure utilities with no tool-specific logic, but the imports violate the `no-tools-from-storage` boundary rule (currently grandfathered via baseline exception).
- **Proposed state**: Move `secretPaths.ts` -> `src/utils/secretPaths.ts`; move `Compressor.ts` -> `src/utils/Compressor.ts`. Update all importers. Drop the corresponding baseline exception in `dependency-cruiser.cjs`.
- **Expected benefit**: Closes 1 of 4 baseline exceptions. Cleaner long-term contract.
- **Estimated effort**: Low (1-2 hours, mechanical).

#### 6c. Dependency and coupling analysis

**[P2] Two pre-existing circular dependencies**
- **Current state**: `MemoryLayers.types <-> MemoryStore.types` (legitimate type co-recursion) and `SubAgentManager <-> AgentLoop` (sub-agent spawning needs the loop; the loop reports to the manager). Both downgraded to `warn` in `dependency-cruiser.cjs`.
- **Proposed state**:
  - For the type cycle, introduce a third file `src/storage/MemoryShared.types.ts` containing the shared union and have both `MemoryLayers.types` and `MemoryStore.types` depend on it.
  - For the runtime cycle, extract a `SubAgentSpawner` interface that `SubAgentManager` implements; `AgentLoop` consumes the interface and never imports `SubAgentManager`. The manager imports the loop only to dispatch.
- **Expected benefit**: Cleaner module graph; faster incremental compile.
- **Estimated effort**: Medium (1 day per cycle).
- **Risk**: Medium for the runtime cycle -- the existing tests need to confirm the spawn semantics survive the indirection.

#### 6d. Redundancy and consolidation

**[P3] Two forms of path resolution + two forms of escape**
- **Current state**: `escapeHtml` and `escapeAttr` are duplicated across `SessionListPanel.ts`, `webview/index.ts`, and `webview/traceDashboard.ts` (same body, different files). Same with the `formatDate` helper.
- **Proposed state**: Hoist into a shared `webview/util.ts` module; import in each webview script.
- **Expected benefit**: Three fewer copies; one place to add the `createElement` helper recommended in F-006.
- **Estimated effort**: Low.

#### 6e. Third-party platform and tooling review

**[P3] dependency-cruiser config mirror in ARCHITECTURE.md**
- **Current state**: The forbidden-edges list is documented in two places (the `cjs` config and the mermaid diagram in ARCHITECTURE.md). Drift risk.
- **Proposed state**: Generate the diagram from the cjs config at build time. Effort: medium. Skip if drift is observed to be rare.

#### 6f. Workflow and developer experience

**[P3] Coverage gate parses HTML with regex**
- **Current state**: The `coverage-gate` CI job uses inline Python `re.search` over the lcov-report HTML. The pattern is brittle to istanbul/v8 markup changes.
- **Proposed state**: Switch to `coverage-summary.json` parsing.
- **Expected benefit**: Robust to coverage-tool upgrades.
- **Estimated effort**: Low.

### 3.6 Simplification and Optimization Opportunities

#### 7a. Over-engineering and unnecessary abstraction

**[P2] Predictive cache layer is unfinished and unused**
- **Current state**: 600+ LoC across `src/storage/PredictiveCache.ts` + tests + setting + architecture-doc paragraph. No callers.
- **Proposed state**: Either (a) wire it into `ToolOutputCache.lookup()` and add the missing benchmark + integration test, or (b) delete it.
- **Behavior preservation**: deleting preserves observable behavior because nothing currently observes it.
- **Effort**: Low for delete; medium for wire-up + tests.

#### 7b. Code volume reduction

**[P3] Hand-rolled glob-to-regex in `secretPaths.ts:30-57`**
- **Current state**: 28-line custom glob compiler. Used to match a static 11-pattern denylist plus user `secretPathDenyExtra`.
- **Proposed state**: Use `minimatch` (already a transitive dep via vsce) or `picomatch`. Adds 0 to bundle size.
- **Behavior preservation**: would need a snapshot test to confirm equivalent behavior on edge cases (escape sequences, case-insensitive on Windows).
- **Effort**: Low; protect with the existing `secretPaths.test.ts`.

#### 7c. Dependency rationalization

**[P3] `marked` is pinned at ^4.3 with a tracked v0.5 note to bump to v12**
- **Current state**: [src/utils/MarkdownRenderer.ts:1-5](../../../../src/utils/MarkdownRenderer.ts#L1-L5) has a `NOTE(v0.5)` to bump marked from v4 to v12 to pick up its built-in sanitizer. DOMPurify is the primary sanitizer; the upgrade is purely about modernization. Did not happen in v0.5.
- **Proposed state**: Upgrade marked to v12. Audit the renderer's options; the v4 -> v12 path includes async breaking changes.
- **Behavior preservation**: existing `MarkdownRenderer.test.ts` covers the rendering surface; verify with snapshot diff before/after.
- **Effort**: Low if no breaking issues; medium if async changes leak into the streaming pipeline.

#### 7d. Build and bundle optimization

**[P3] PyQt5 venv inside the working tree**
- **Current state**: `scripts/installer/pyqt/.venv/` exists in the working tree. It is `.gitignore`d but inflates `find` / `glob` results and confuses analysis tools. The `audit-py` CI job re-creates it on every run.
- **Proposed state**: No fix required for CI; locally, document that `.venv/` should live outside the working tree (use `uv venv ../venv` if possible). Effort: low.

#### 7e. Configuration simplification

**[P3] Legacy `gemma-code.gpuTier` setting fallback**
- **Current state**: 12-line backwards-compat shim in [src/config/settings.ts:46-58](../../../../src/config/settings.ts#L46-L58); inline note: "remove in v0.5".
- **Proposed state**: Delete. Add a one-line release note; users running with the legacy setting get auto-detection on upgrade.
- **Behavior preservation**: Yes (auto-detect is the documented v0.5 default).
- **Effort**: Low.

---

## Section 4: Findings by Priority

### P0 -- Critical

| # | Phase | Location | Title |
|---|---|---|---|
| 1 | Security (chain) | filesystem.ts + PermissionTiers.ts | Symlink + tier-2 downgrade -> RCE on hostile workspace |

### P1 -- High

| # | Phase | Location | Title |
|---|---|---|---|
| 2 | Quality | src/panels/GemmaCodePanel.ts (1,719 lines) | God class -- extract ChatController + ChatWebviewHost |
| 3 | Quality | src/panels/webview/index.ts (1,567 lines) | God module -- split scaffold/render/messages |
| 4 | Testing | CI test pipeline | 12 failing assertions ship green; verify CI fail-on-error wiring |
| 5 | Performance | tests/benchmarks/baselines/ | No v0.5.0 benchmark baseline; release-gate p99 unverified |
| 6 | Restructuring | filesystem.ts:43-51 | Unify path-guarding behind pathGuard.resolveInsideWorkspace |
| 7 | Simplification | src/storage/PredictiveCache.ts | Wire it or delete it |

### P2 -- Medium

| # | Phase | Location | Title |
|---|---|---|---|
| 8 | Security | src/utils/ssrf.ts | Bound fetchWithSsrfGuard response body size |
| 9 | Security | src/mcp/McpServer.ts | Tag MCP-origin in confirmation prompts; mcpExposedTools allowlist |
| 10 | Security | .github/workflows/ci.yml | npm audit gate at --audit-level=moderate |
| 11 | Security | src/panels/SessionListPanel.ts + webview/* | ESLint rule against innerHTML concatenation |
| 12 | Security | src/tools/Compressor.ts:112 | SHA-1 -> SHA-256 |
| 13 | Performance | src/storage/ToolOutputCache.ts prune() | Fix LRU vs FIFO documentation OR add accessed_at |
| 14 | Restructuring | src/tools/handlers/secretPaths.ts + Compressor.ts | Move to src/utils/; ratchet baseline exception |
| 15 | Restructuring | configs/dependency-cruiser.cjs | Untangle two circular dependencies |
| 16 | Quality | src/tools/handlers/filesystem.ts (1,245 lines) | Split per-tool into a subdir |

### P3 -- Low

| # | Phase | Location | Title |
|---|---|---|---|
| 17 | Security | docs/archive/versions/v0/v0.5.0/plans/routa-harness-adoption.md | Obfuscate Slack webhook example |
| 18 | Security | .github/workflows/ci.yml | Switch coverage gate to coverage-summary.json |
| 19 | Security | .github/workflows/ci.yml | Add non-blocking dev-dep audit job |
| 20 | Simplification | src/config/settings.ts:46-58 | Delete legacy gpuTier fallback |
| 21 | Restructuring | configs/dependency-cruiser.cjs | Ratchet last 2 baseline exceptions |
| 22 | Performance | src/storage/MemoryConsolidator.ts | Wrap consolidation in db.transaction |
| 23 | Restructuring | webview/* | Hoist escapeHtml/escapeAttr/formatDate to webview/util.ts |
| 24 | Simplification | src/utils/MarkdownRenderer.ts | Bump marked v4 -> v12 |
| 25 | Simplification | src/tools/handlers/secretPaths.ts | Replace hand-rolled glob with minimatch |
| 26 | Quality | src/storage/ToolOutputCache.ts (974 lines), MemoryStore.ts (839 lines) | Extract per-table SQL companions |
| 27 | Testing | (none) | One-shot Stryker mutation run on guardrails + tool handlers |

---

## Section 5: Export

*This Markdown report is the canonical output. A Word version is available on request via Next Steps option 7.*

---

## Next Steps

Found 27 issues (P0: 1, P1: 6, P2: 9, P3: 11) plus 6 restructuring recommendations and 6 simplification opportunities.

The v0.6.0 cycle that follows naturally from this review has three priorities:

1. **Close the security chain** -- unify path guarding (#6) and clamp tier-2 floor (security F-003) -- combined effort: < 1 day; closes the only P0.
2. **Fix the test pipeline** -- verify CI fail-on-error wiring (#4), generate the missing v0.4.0/v0.5.0 baselines (#5), update or rewrite the 12 failing assertions, and add the four missing test files identified in 3.4.
3. **Pay down the structural debt** -- split GemmaCodePanel (#2), move secretPaths/Compressor (#14), ratchet the dependency-cruiser baselines, wire-or-delete PredictiveCache (#7).

These three priorities, expressed as concrete phase-by-phase work, are the natural input to `/generate-plan` for the v0.6.0 implementation plan.
