# Session History - v1.16.0 Phase 2: Per-Model Performance Analytics

**Date**: 2026-08-12
**Version**: v1.16.0
**Plan**: [../../plans/v1.16.0-adoption-local-serving-and-ocr.md](../../plans/v1.16.0-adoption-local-serving-and-ocr.md)
**Phase**: 2 of 6 - Per-Model Performance Analytics (adoption item A2)
**Outcome**: Complete. All four quality gates passed without bypass. Also closed Phase 1's gap LSO.P1.A and fixed a Phase 1 CI-breaking defect.

## Goal

Capture per-request inference metrics at the LLM-client boundary (model id, prompt/completion token counts, time-to-first-token, total wall time, derived tokens/sec, memory footprint) and surface a per-model breakdown in the Traces panel. Local-only: no metric capture makes an outbound call.

## Pre-flight

- `is_final_phase` = **false** (Phase 6 is terminal), so no release workflow.
- Model routing: plan recommends the mid tier at medium effort; the session ran on Opus 5, a stronger tier, so no switch (never downshifting mid-plan).
- Prerequisites: none strictly. Phase 1 had landed (`67257df`), which added the serving gateway as a second metric source.

## Decisions taken at the start

Two ambiguities were resolved before coding, because both materially changed the work:

1. **Which Traces surface.** Sub-task 2.2 says "the desktop Traces panel" but cites `nexus.coding.traceDashboard`, the VS Code view ID - two separate implementations with different data paths (the desktop sidecar has no `TraceStore`; it exists only in the extension). Chose the **desktop React panel as the primary target, plus the cheap VS Code span-attribute addition**, so the extension's dashboard and OTLP export are not stranded for a four-line change.
2. **Close LSO.P1.A now.** Phase 1's gateway reported `usage` as zeros because the port carried no counts. Phase 2.1 captures exactly those counts, so wiring them into the gateway envelopes belongs here.

## The blocking discovery

`LLMStreamChunkSchema` is a plain `z.object`, not `.strict()` and not `.passthrough()` - so zod's default **strip** behavior applied. Every counter Ollama sends on its `done: true` chunk (`total_duration`, `load_duration`, `prompt_eval_count`, `prompt_eval_duration`, `eval_count`, `eval_duration`) was silently discarded inside `parseChunk` before any Nexus code could observe it, and nothing anywhere in `src/`, `core/`, `modules/`, or `desktop/` parsed those fields. Widening that schema with optional numeric fields was the necessary first step; without it the rest of the phase would have had no data to report.

## Sub-tasks implemented

### 2.1 Capture

- **`modules/coding/llm/types.ts`**: added `LLMUsageCounters` (the Ollama nanosecond durations and token counts, plus an OpenAI-shaped `usage` block) to both the `LLMStreamChunk` interface and its zod schema, every field optional so existing producers, mocks, and tests stay valid.
- **`core/observability/InferenceMetrics.ts`**: the metrics layer - `InferenceMetricRecord`, `PerModelSummary`, `deriveTokensPerSec` (preferring the backend's own generation duration over wall time, which includes load and queueing and would understate throughput), `median`, `nsToMs`, a bounded `InferenceMetricsRegistry` with per-model rollup, `metricSpanAttributes`, and `createTelemetryMetricPublisher`. Deliberately free of any LLM wire type, because `core/**` must not depend on `modules/**`.
- **`modules/coding/llm/instrumentStream.ts`**: the bridge that knows `LLMStreamChunk` and feeds plain numbers into core. Wrapping at the client rather than at each of the 18 `streamChat` call sites is what made this a ~4-line change per client.
- **`modules/coding/llm/ollamaMemory.ts`**: `/api/ps` resident-size probe - synchronous at read time with a 5s TTL and background refresh, because the metric is read from a streaming generator's `finally` and awaiting an HTTP round trip there would tax every completion.
- **Four clients wired**: `OllamaClient`, `headlessOllamaClient` (both with the memory probe), `LmStudioClient`, `headlessOpenAiClient`. The two OpenAI-compatible clients also learned to hold a late `usage` frame and attach it to the terminal chunk, since usage typically arrives after `finish_reason` and the early `return` would otherwise drop it.
- **`core/telemetry/TelemetryBus.ts`**: added the `model.inference.complete` event kind - the union is the documented extension point.

### 2.2 Surface

- **`metrics.inference` IPC**: new method with strict request/response schemas where every metric is nullable, returning the per-model rollup plus up to 50 recent records.
- **`ModelAnalyticsSection.tsx`**: the per-model table (avg tokens/sec, median TTFT, request count, total tokens, last memory) with an empty state and an "est" badge when a model's counts were estimated rather than reported. Absent values render as an em dash, never `0`.
- **`TraceDashboardPanel.tsx`**: renders the section above the existing per-request event list, behind an optional `modelMetrics` prop so pre-existing call sites and tests keep working. Not rendered in compare mode - a side-by-side session comparison is about two sessions, not aggregate model throughput.
- **`CodingPage.tsx`**: fetches metrics on Trace-tab activation, matching the existing trace/session load pattern.
- **`src/tools/AgentLoop.ts`**: folds `metricSpanAttributes` into the existing `llm_call` `endSpan`. The span already carried `model`, so the VS Code dashboard and OTLP export get per-model grouping for free.

### 2.1e Closing LSO.P1.A

`collectUsage` in `chatCore.ts` accumulates counters from either wire shape; both route families now report real counts, including the streamed OpenAI finish chunk (matching `stream_options.include_usage` behavior) and the Anthropic `message_delta`. `message_start` legitimately keeps zeros because nothing has been generated at that point.

## Design rule applied throughout: missing is not zero

Every metric is nullable, and `tokenSource` (`reported` / `estimated` / `unavailable`) says where a number came from. Null rates are excluded from per-model averages rather than counted as zero; `metricSpanAttributes` omits an absent metric entirely rather than emitting a zero a dashboard would average in; the UI renders an em dash. This follows the `energyStatus` "sensor missing" convention v1.5.0 established, and it is what keeps a runtime that simply does not report counts from looking like a broken one.

## Bug found and fixed: Phase 1 would have failed CI

`desktop/tests/servingRuntime.test.ts`, written in Phase 1, used `Parameters<typeof createServingRuntime>[0]["models"]`. That parameter is optional, so the indexed access does not typecheck, and the desktop `npm run typecheck` script failed on commit `67257df`. `shell-build.yml` runs that script, so Phase 1's CI would have gone red.

Phase 1 reported the typecheck gate as clean. That check had been run *before* the test file was written; afterwards only vitest (which does not typecheck) and eslint were re-run, so the regression was invisible. Fixed with `NonNullable<Parameters<...>[0]>["models"]`. Recorded as LSO.P2.X with the process lesson: re-run `tsc --noEmit` after adding test files, not only after touching source.

## Quality gates (Phase 7 GO/NO-GO)

| Gate | Threshold | Result |
|------|-----------|--------|
| Test failures | 0 | **0** - root 429 files / 4754 passed (6 skipped), desktop 89 files / 764 passed |
| Coverage | >= 80% lines | **root totals 88.46% lines / 84.22% branches / 91.47% functions**; new modules `InferenceMetrics.ts`, `instrumentStream.ts`, `ollamaMemory.ts`, `ModelAnalyticsSection.tsx`, `chatCore.ts` all **100% lines** |
| Lint errors | 0 | **0** - eslint root (`src modules`) + desktop (`--max-warnings=0`) |
| Build | succeeds | **Yes** - `tsc -b`, desktop `tsc --noEmit`, `build:sidecar` |

Also clean: `check:tampering` (0 findings), `deps:check` (0 errors, 10 pre-existing warnings).

**Verdict: GO.** No gate bypassed.

## Tests

91 new tests: 34 for the registry and derivations (including that null rates do not drag averages toward zero), 15 for the instrumentation (transparency, error passthrough, early abandonment, TTFT-to-first-visible-token, reported vs estimated vs unavailable), 20 for the memory probe (TTL, concurrent-refresh coalescing, stale-beats-nothing, never-throws), 11 for the analytics rendering (the plan's two-model breakdown and empty state, plus dash-not-zero), 5 for the metrics IPC (including strict-schema validation), 6 for usage collection, and 7 gateway assertions for the real usage counts.

## Files

**New**: `core/observability/InferenceMetrics.ts`, `modules/coding/llm/{instrumentStream,ollamaMemory}.ts`, `desktop/src/modules/coding/panels/ModelAnalyticsSection.tsx`, `desktop/tests/{ModelAnalyticsSection.test.tsx,metrics-handler.test.ts}`, `tests/unit/core/observability/InferenceMetrics.test.ts`, `tests/unit/llm/{instrumentStream,ollamaMemory}.test.ts`, this file.

**Modified**: `modules/coding/llm/{types,OllamaClient,LmStudioClient,headlessOllamaClient,headlessOpenAiClient}.ts`, `core/telemetry/TelemetryBus.ts`, `src/tools/AgentLoop.ts`, `desktop/sidecar/src/{protocol,handlers}.ts`, `desktop/sidecar/src/serving/{chatCore,openaiRoutes,anthropicRoutes}.ts`, `desktop/src/modules/coding/{CodingPage.tsx,panels/TraceDashboardPanel.tsx}`, `desktop/tests/{serving-chatCore,serving-gateway,servingRuntime,sidecar-handlers}.test.ts`, `docs/v1/v1.16/known-gaps.md`, `docs/DEVLOG.md`.

Unrelated benchmark-fixture timing noise regenerated by the test runs was reverted, not committed.

## Known gaps

5 new deferrals in [../../known-gaps.md](../../known-gaps.md): LSO.P2.A (`traceSubscribe()` still returns placeholder events - the sidecar has no `TraceStore`, making this a design decision), LSO.P2.B (the telemetry-bus push path exists and is tested but has no subscriber), LSO.P2.C (prompt-token estimation not attempted), LSO.P2.D (memory footprint is Ollama-only), LSO.P2.E (the `AgentLoop` span junction untested). LSO.P1.A is now **RESOLVED**.

## Next steps

Phase 3 - Local Document-OCR Capability (A5): a GPU-tier-gated catalog model, a pinned and sandboxed Python OCR runtime, and a parse-document action. The plan recommends the strong reasoning tier at high effort, citing supply-chain discipline (`trust_remote_code` pinned to a revision), cross-platform gating, and a net-new Python runtime. Note that Phase 3 requires a portability decision that the plan explicitly asks to be recorded: ship the CUDA-first model for capable NVIDIA hosts and note a portable fallback as a follow-up gap, versus finding a genuinely cross-platform OCR model.
