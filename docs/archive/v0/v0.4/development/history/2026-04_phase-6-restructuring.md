# v0.4.0 Phase 6 -- Restructuring (Architecture)

**Date**: 2026-04-24
**Branch**: main
**Plan**: [docs/archive/versions/v0/v0.4.0/implementation-plan.md](../../implementation-plan.md) lines 1514-1731
**Pre-conditions**: Phase 5 (Testing Pipeline Completeness) merged at commit `511840d`; 1166/1168 tests green.
**Goal**: Land 17 structural recommendations from the v0.3.0 review as behavior-preserving refactors. Cleaner port/adapter layout, injectable singletons, typed boundaries.

> **Companion DEVLOG entry**: [docs/DEVLOG.md](../../../../versions/v0/DEVLOG.md) (2026-04-24 section) holds the per-change narrative. This file is the audit trail; consult the DEVLOG for the rationale and test outcomes.

## Sub-tasks closed (14 of 17 fully; 3 scoped down)

| # | Description | Status |
|---|-------------|--------|
| 6.1 | Record ADR-0001 Python backend disposition | Done |
| 6.2 | GemmaCodePanel split into runtime/chat/panels | Partial — `GemmaRuntime` extracted; `ChatController` + `ChatWebviewHost` deferred to v0.5 |
| 6.3 | Move `safety/` to `guardrails/` (incl. `BLOCKED_PATTERNS`) | Done |
| 6.4 | Introduce `src/llm/` port + adapter | Done |
| 6.5 | Extract `OllamaHttp` shared client | Done |
| 6.6 | Move `GoldenTaskSuite` to `evaluation/` | Done |
| 6.7 | Inline `modes/PlanMode.ts` into `chat/` | Done |
| 6.8 | Inject Tracer; remove singleton | Done |
| 6.9 | Inject settings once at composition root | Partial — Compactor + RegenerateFromSource done; panel + extension activation reads deferred |
| 6.10 | Add `utils/logger.ts`; ESLint `no-console` -> error | Done |
| 6.11 | Add `utils/errors.ts`; replace ad-hoc patterns | Done |
| 6.12 | Adopt Zod at module boundaries | Partial — LLM boundary done; webview/storage/observability deferred to v0.5 |
| 6.13 | Create `docs/adr/` (README + template) | Done |
| 6.14 | Dev-setup scripts + CONTRIBUTING.md + `npm run dev` | Done |
| 6.15 | Consolidate installer-smoke CI | Done (already satisfied via Phase 5 sub-task 5.19) |
| 6.16 | Marked v12 upgrade | Deferred — `NOTE(v0.5)` recorded; renderer API break too costly |
| 6.17 | Testing and stabilization | Done |

## What was built

1. **ADR scaffolding (6.1, 6.13)** — new [docs/adr/README.md](../../../../versions/v0/adr/README.md) declares MADR convention plus an index. New [docs/adr/template.md](../../../../versions/v0/adr/template.md) seeds future ADRs. [docs/archive/versions/v0/v0.3.0/architecture.md](../../../v0.3/architecture.md) header carries a v0.4.0-update banner pointing at ADR-0001 and noting the Python backend retirement.

2. **`src/safety/` -> `src/guardrails/` (6.3)** — all five modules moved (`ActionClassifier`, `BudgetEnforcer`, `GitSafetyNet`, `LoopDetector`, `PermissionTiers`). New [src/guardrails/policy.ts](../../../../versions/src/guardrails/policy.ts) holds `BLOCKED_PATTERNS` extracted from `tools/handlers/terminal.ts`. New [src/guardrails/index.ts](../../../../versions/src/guardrails/index.ts) is the cohesive surface. Three importers updated; tests moved to `tests/unit/guardrails/` and `tests/integration/guardrails/agent-guardrails-pipeline.test.ts`.

3. **`src/ollama/` -> `src/llm/` (6.4, 6.5)** — new vendor-neutral [src/llm/types.ts](../../../../versions/src/llm/types.ts) defines `LLMMessage`, `LLMOptions`, `LLMToolDefinition`, `LLMChatRequest`, `LLMStreamChunk`, `LLMModel`, `LLMClient`, `LLMError`. Transitional `Ollama*` aliases preserved so the 10 consumers only see a path swap. The driver moved to [src/llm/OllamaClient.ts](../../../../versions/src/llm/OllamaClient.ts); new [src/llm/OllamaHttp.ts](../../../../versions/src/llm/OllamaHttp.ts) centralizes fetch-with-timeout, URL normalization, `/api/tags` reachability probe, and JSON list parsing. Both `OllamaClient` and `EmbeddingClient` compose over it. `src/ollama/` deleted.

4. **`src/observability/GoldenTaskSuite` -> `src/evaluation/` (6.6)** — both the suite and `goldenTasksYaml.generated.ts` moved. The cross-import to `MetricsCollector` was rewritten to `../observability/MetricsCollector.js`. [scripts/generate-golden-tasks.mjs](../../../../versions/scripts/generate-golden-tasks.mjs) emits to the new path. Tests moved to `tests/unit/evaluation/`.

5. **`src/modes/PlanMode.ts` -> `src/chat/PlanMode.ts` (6.7)** — directory deleted. Three importers updated; unit test relocated to `tests/unit/chat/PlanMode.test.ts`.

6. **`GemmaRuntime` composition root (6.2 partial)** — new [src/runtime/GemmaRuntime.ts](../../../../versions/src/runtime/GemmaRuntime.ts) owns one `Tracer`, one settings snapshot, and the `onSettingsChange` subscription. [src/extension.ts](../../../../versions/src/extension.ts) constructs it once at activation; `GemmaCodePanel` accepts it via constructor. The host/controller split itself was scoped down.

7. **Tracer constructor injection (6.8)** — `Tracer.getInstance()` and `Tracer.resetInstance()` deleted. Constructor is now public. Four call sites threaded through: `extension.ts` -> `GemmaRuntime`, `tools/AgentLoop.ts` (via `AgentLoopOptions.tracer`), `chat/ContextCompactor.ts` (via constructor), `agents/SubAgentManager.ts` (via constructor). Default is a disabled no-op tracer for tests. [tests/unit/observability/Tracer.test.ts](../../../../versions/tests/unit/observability/Tracer.test.ts) rewritten to use per-test `new Tracer()` instances; suite is parallel-safe.

8. **Settings injection at deepest consumers (6.9 partial)** — [src/chat/ContextCompactor.ts](../../../../versions/src/chat/ContextCompactor.ts) accepts a `CompactionSettingsProvider` callback. [src/chat/RegenerateFromSource.ts](../../../../versions/src/chat/RegenerateFromSource.ts) accepts an explicit `_keepRecent` parameter. [src/llm/OllamaClient.ts](../../../../versions/src/llm/OllamaClient.ts) `createOllamaClient` accepts `{ baseUrl, timeoutMs }` and only reads `getSettings()` as a documented backstop for the legacy zero-arg form.

9. **Logger utility (6.10)** — new [src/utils/logger.ts](../../../../versions/src/utils/logger.ts) wraps `vscode.OutputChannel` with an injectable `Logger` interface (debug/info/warn/error). `StderrLogger` fallback fires when `vscode.window.createOutputChannel` is unavailable so unit tests still see warnings. `setLogger` lets tests inject a captured fake. All 25 `console.*` call sites in `src/` migrated. [eslint.config.mjs](../../../../versions/eslint.config.mjs) `no-console` is now `"error"`.

10. **Errors utility (6.11)** — new [src/utils/errors.ts](../../../../versions/src/utils/errors.ts) provides `formatForUser(err)` (redacts user paths, GitHub PATs, AWS keys, JWTs, sk-* tokens) and `formatForLog(err)` (preserves stack). 21 ad-hoc `err instanceof Error ? err.message : String(err)` sites migrated through these helpers. `StreamingPipeline._humanizeError` keeps its OllamaError-specific branches but its catch-all goes through `formatForUser`.

11. **Zod at LLM boundary (6.12 partial)** — [src/llm/types.ts](../../../../versions/src/llm/types.ts) adds pre-compiled `LLMStreamChunkSchema`, `LLMModelSchema`, `LLMListModelsResponseSchema`. `OllamaClient.streamChat` validates every chunk via a private `parseChunk` helper; `OllamaHttp.listModels` validates the `/api/tags` body. McpManager's existing Zod use is unchanged.

12. **Contributor onboarding (6.14)** — new [scripts/dev-setup.sh](../../../../versions/scripts/dev-setup.sh) and [scripts/dev-setup.ps1](../../../../versions/scripts/dev-setup.ps1) verify Node 18+, optionally check for Ollama, install dependencies, run prebuild, compile TypeScript. Idempotent. New [CONTRIBUTING.md](../../../../versions/CONTRIBUTING.md) documents project tour, one-command setup, daily loop, conventions (no `console.*`, formatForUser/formatForLog, Zod at boundaries, ASCII-only commits), testing workflow. [package.json](../../../../versions/package.json) adds `"dev": "tsc -w"`.

13. **Marked v12 deferred (6.16)** — `NOTE(v0.5)` comment recorded at [src/utils/MarkdownRenderer.ts:1](../../../../versions/src/utils/MarkdownRenderer.ts#L1). DOMPurify already provides the sanitization layer; the upgrade is maintenance, not a security fix.

## Deviations (scoped down or deferred)

- **6.2 panel split** — `GemmaRuntime` composition root extracted, but `ChatController` (agent-loop + orchestration mediator) and `ChatWebviewHost` (webview provider + message translation) are not split out. `GemmaCodePanel.ts` still holds the full panel logic. v0.5 will land the host/controller split using the runtime as the seam.
- **6.9 not strict** — the deepest consumers receive settings via injection. `panels/GemmaCodePanel.ts` still calls `this._getSettings()` (its private cache) at 12 sites; `extension.ts` still calls `getSettings()` directly during activation; `OllamaClient.ts` retains a documented backstop. The plan's strict "exactly one `getSettings()` call" criterion is owned by the v0.5 panel split.
- **6.12 LLM-only** — Zod added at the LLM boundary only. The webview message payloads (`panels/messages.ts`), persisted GraphMemory entity attributes, and TraceStore span attributes still use plain `as` casts. Documented as P3 v0.5 follow-ups.
- **6.16 marked v12 deferred** — v4 -> v12 is a renderer API break (constructor change, `marked.setOptions` removed, synchronous-only methods). DOMPurify already provides sanitization, so the bump is maintenance-only. Recorded with a `NOTE(v0.5)` comment.

## N/A findings (closed via prior work)

- **6.15** — drop nightly `installer-smoke-*` jobs. Already satisfied by Phase 5 sub-task 5.19, which renamed the nightly jobs to `installer-package-check-*` and documented the distinction. No code change.

## Verification of plan acceptance criteria

| Criterion | Result |
|---|---|
| `git grep "from \"../ollama/types"` under `src/` | zero hits (driver moved to `src/llm/OllamaClient.ts`) |
| `git grep "Tracer.getInstance"` under `src/` | zero hits |
| `git grep "from \"../safety/"` under `src/` | zero hits; `src/safety/` directory deleted |
| `git grep "console\\."` under `src/` | zero hits |
| `src/observability/` contents | `Tracer`, `TraceStore`, `MetricsCollector`, `OtlpExporter` only |
| `docs/adr/` | populated with README, template, ADR-0001 |
| `CONTRIBUTING.md` + dev-setup scripts | present (sh + ps1) |

## Test status at exit

- `npm run build`: clean (`tsc` reports no errors).
- `npm run lint`: **0 errors, 5 warnings** (`explicit-function-return-type` on inline callbacks in `config/GpuDetector.ts` and `panels/GemmaCodePanel.ts` -- pre-existing, out of Phase 6 scope).
- `npm run test`: **1165 passed, 2 skipped (live Ollama), 0 failed** across 89 test files.
- Updated tests during stabilization: `tests/unit/observability/Tracer.test.ts` (per-test instances rather than `resetInstance`); `tests/unit/panels/GemmaCodePanel.test.ts` and `GemmaCodePanel.realSettings.test.ts` (pass `GemmaRuntime` to constructor); `tests/unit/commands/CommandRouter.test.ts`, `tests/unit/config/PromptBudget.test.ts`, `tests/unit/storage/EmbeddingClient.test.ts` (warnings now captured via `setLogger`, not `vi.spyOn(console, "warn")`).

## Files touched (summary)

### Created

- `src/runtime/GemmaRuntime.ts`
- `src/guardrails/index.ts`, `src/guardrails/policy.ts`
- `src/llm/types.ts`, `src/llm/OllamaClient.ts`, `src/llm/OllamaHttp.ts`
- `src/utils/logger.ts`, `src/utils/errors.ts`
- `src/chat/PlanMode.ts`
- `src/evaluation/GoldenTaskSuite.ts`, `src/evaluation/goldenTasksYaml.generated.ts`
- `docs/adr/README.md`, `docs/adr/template.md`
- `CONTRIBUTING.md`
- `scripts/dev-setup.sh`, `scripts/dev-setup.ps1`
- `tests/unit/chat/PlanMode.test.ts`
- `tests/unit/evaluation/GoldenTaskSuite.test.ts`
- `tests/unit/llm/OllamaClient.test.ts`
- `tests/unit/guardrails/{ActionClassifier,BudgetEnforcer,GitSafetyNet,LoopDetector,PermissionTiers}.test.ts`
- `tests/integration/guardrails/agent-guardrails-pipeline.test.ts`
- `docs/archive/versions/v0/v0.4.0/development/history/2026-04_phase-6-restructuring.md` (this file)

### Deleted

- `src/safety/{ActionClassifier,BudgetEnforcer,GitSafetyNet,LoopDetector,PermissionTiers}.ts` and parent directory
- `src/ollama/{client,types}.ts` and parent directory
- `src/modes/PlanMode.ts` and parent directory
- `src/observability/{GoldenTaskSuite,goldenTasksYaml.generated}.ts`
- `tests/unit/safety/*` and parent directory
- `tests/integration/safety/agent-safety-pipeline.test.ts` and parent directory
- `tests/unit/modes/PlanMode.test.ts` (parent retained for `EditMode.test.ts`)
- `tests/unit/observability/GoldenTaskSuite.test.ts`
- `tests/unit/ollama/client.test.ts` and parent directory

### Modified

- 32 source files: `src/agents/`, `src/chat/`, `src/commands/`, `src/config/`, `src/extension.ts`, `src/mcp/`, `src/observability/{OtlpExporter,Tracer}.ts`, `src/orchestration/`, `src/panels/{GemmaCodePanel,messages}.ts`, `src/skills/`, `src/storage/{EmbeddingClient,MemoryStore,dbPermissions}.ts`, `src/tools/{AgentLoop,OutputRedirector,ToolRegistry}.ts`, `src/tools/handlers/{terminal,webSearch}.ts`, `src/utils/MarkdownRenderer.ts`.
- 13 test files (import-path refresh; logger-spy migration; runtime constructor parameter).
- `package.json` (`"dev": "tsc -w"` script).
- `eslint.config.mjs` (`no-console: "error"`).
- `scripts/generate-golden-tasks.mjs` (new output path).
- `ARCHITECTURE.md`, `README.md` (refreshed Project Structure tree, Contributing section).
- `docs/archive/versions/v0/v0.3.0/architecture.md` (v0.4.0-update banner).
- `docs/archive/versions/v0/v0.4.0/test-pyramid.md` (golden-task path).
- `docs/DEVLOG.md`, `docs/todos.md`.

## Next steps

Phase 6 closes the restructuring gate for v0.4.0. The remaining v0.4.0 phase is Phase 7 (Simplification and Release). v0.5 inherits four explicit follow-ups from this phase:

1. Complete the `GemmaCodePanel` split: extract `ChatController` + `ChatWebviewHost` using the runtime as the seam.
2. Eliminate the panel's 12 `_getSettings()` reads and the activation-time `getSettings()` in `extension.ts` so the strict 6.9 acceptance criterion is met.
3. Expand Zod beyond the LLM boundary: webview message payloads, GraphMemory persisted attributes, TraceStore span attributes.
4. Upgrade `marked` from v4 to v12 with snapshot-test coverage for the rendered HTML.
