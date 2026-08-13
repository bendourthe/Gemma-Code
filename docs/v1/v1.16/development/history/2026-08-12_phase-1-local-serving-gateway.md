# Session History - v1.16.0 Phase 1: Local Serving Gateway

**Date**: 2026-08-12
**Version**: v1.16.0
**Plan**: [../../plans/v1.16.0-adoption-local-serving-and-ocr.md](../../plans/v1.16.0-adoption-local-serving-and-ocr.md)
**Phase**: 1 of 6 - Local Serving Gateway (adoption item A1, flagship)
**Adoption item**: A1 (from [../../comparisons/v1.16.0-comparison-local-serving-and-ocr.md](../../comparisons/v1.16.0-comparison-local-serving-and-ocr.md))
**Outcome**: Complete. All four quality gates passed without bypass.

## Goal

Expose Nexus's registry-backed installed local models over a loopback OpenAI- and Anthropic-compatible HTTP API, so external agent tools (Claude Code, Codex, Cursor) can reuse models Nexus already downloaded, without any code leaving the machine. The exact inverse of the v1.6.0 `localAdapters` client, and "Zero Tokens Billed" extended to the whole toolchain.

## Pre-flight

- Prerequisite verified: v1.15 Phase 4's real `models.*` registry is present (`desktop/sidecar/src/models/modelsService.ts`, `NexusModelRegistry`, the reconciling `ModelsService`).
- `is_final_phase` = **false** (Phase 6 is terminal; Phases 2-6 unimplemented), so the release-readiness workflow did not run.
- Model routing: the plan recommends the strong-reasoning tier at high effort; the session ran on Opus 5, a same-or-stronger tier, so no switch was needed (no-degradation guarantee satisfied).

## Decisions taken at the start

Two design questions were resolved before any code was written, because both materially changed the work:

1. **Settings transport** - the sidecar's `settings.get` / `settings.set` IPC is still `implemented: false`, so "toggling `nexus.serving.enabled` starts/stops the server" needed a transport. Chose **new `serving.*` IPC methods** persisting to `JsonFileSettingsStore`, over a file-watcher-only approach, because the UI also needs live running/stopped state and the generated token, which a file write cannot return.
2. **Model routing** - chose to route through the adapter layer so the gateway only ever holds the `LLMClient` port, honoring the `no-llm-outside-llm-folder` boundary rule, rather than importing the concrete clients directly. (This decision survived, but its *implementation* had to change - see Troubleshooting.)

## Sub-tasks implemented

### 1.1 Settings and lifecycle

Added four `nexus.serving.*` keys to `contributes.configuration.properties` mirroring the `nexus.mcp.*` style: `enabled` (false), `host` (127.0.0.1), `port` (11500), `token` (""). `resolveServingConfig` resolves settings-over-env-over-default and, when the token is empty, generates 32 CSPRNG bytes (base64url) and **persists** them so a token pasted into another tool survives a restart; a read-only settings file degrades to a per-process token rather than failing. `serving.status` / `serving.setEnabled` were added to `IPC_METHODS`, `METHOD_SCHEMAS`, and the handler table, with the `ServingRuntime` lazily built and injectable via `HandlerContext.serving` (the same seam `models` uses). `main.ts` reconciles the persisted opt-in on startup and stops the listener on close/SIGTERM/SIGINT behind a 2s bound, since the Rust supervisor may hard-kill the sidecar.

### 1.2 Loopback and auth guard

`assertLoopbackHost` refuses to start on any address outside `127.0.0.0/8`, `::1`, or a loopback hostname - thrown **before** `listen`, with a message citing the local-first policy. Bearer auth is constant-time and accepts both the OpenAI (`Authorization: Bearer`) and Anthropic (`x-api-key`) conventions. A 1 MiB body cap is enforced on both the declared `content-length` and the streamed bytes (the socket is destroyed on overflow), and an 8-request `ConcurrencyLimiter` returns a fast 429 rather than stalling an agent tool. The route table contains exactly four entries; nothing reaches the filesystem, a process, or a Nexus tool.

### 1.3 OpenAI-compatible routes

`GET /v1/models` returns installed chat-capable rows only (`installed && source in {registry, external} && type == llm`), so a caller never sees a catalog-only row it cannot run. `POST /v1/chat/completions` serves both the buffered `chat.completion` shape and the streamed `chat.completion.chunk` + `data: [DONE]` sequence, flattens structured `content` parts (including base64 images) into the port's shape, and maps sampling knobs. `ModelRouter` resolves an id or Ollama tag by asking each chat-capable adapter what it has loaded, skipping unreachable runtimes, and distinguishes `model_not_found` from `model_not_loaded` because those are different user problems.

### 1.4 Anthropic-compatible route

`POST /v1/messages` folds the out-of-band `system` prompt into a leading system turn and serves both the buffered envelope and the full streamed sequence (`message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop` - the block-level frames included because the official SDKs treat them as mandatory). Model resolution, message flattening, sampling mapping, and error mapping are the *same code* the OpenAI routes use, per the sub-task's explicit "rather than duplicating it".

### 1.5 Desktop surface

A fifth Settings tab, "Local API server": toggle, live running/stopped state (with a distinct "enabled but not listening" message), base URL, endpoint list, and the token masked by default behind an explicit reveal, copyable without being revealed. Wired through `servingTypes.ts` / `ipcServingClient.ts` / `mockServingClient.ts`, matching the Models and Credentials section pattern, and mounted in `App.tsx`.

### 1.6 Tests and CI

154 serving tests plus 39 root-side tests for the two new `modules/coding/llm/` files. The 26 gateway tests are true integration tests: they start a real `node:http` listener on an ephemeral port (`port: 0`) and drive it with `fetch` against a fake `LLMClient`, because SSE framing, header ordering, the auth path, and the no-port-when-disabled guarantee only exist at the socket boundary. `shell-build.yml` gained `modules/**` in its path filter.

## Troubleshooting

**One substantive problem, fixed at the root.** The first test run failed with `Failed to resolve import "vscode" from modules/coding/config/settings.ts`. Tracing it: `LocalAdapterRegistry.ts` statically imports the concrete `OllamaClient` / `LmStudioClient`; those import `config/settings` + `utils/logger`; both `import * as vscode`. Because `vscode` is **not** listed as external in `sidecar/esbuild.config.mjs`, importing that module into the sidecar would have broken `npm run build:sidecar` in production - not just the test environment. This is the same constraint that produced `headlessOllamaClient.ts` back in v1.7.0, whose header comment says so explicitly.

Rather than work around it (marking `vscode` external, or duplicating the loopback check), the fix was structural:

1. **Extracted** the loopback predicate into a new vscode-free `modules/coding/llm/loopback.ts`, which `LocalAdapterRegistry.ts` now imports and re-exports. One definition, so the rule guarding *addresses we bind* and the rule guarding *endpoints we call* cannot drift apart - `tests/unit/llm/loopback.test.ts` asserts the re-export is literally the same function object.
2. **Added** `modules/coding/llm/headlessOpenAiClient.ts`, the exact counterpart of the existing `headlessOllamaClient.ts`, so an OpenAI-compatible local runtime is reachable without the vscode-bound logger.
3. **Introduced** the `ServingAdapter` seam (`serving/adapters.ts`), which reads the same `nexus.llm.localAdapters` manifest shape and enforces the same loopback rule. `ModelRouter` depends on this seam, so it still only ever holds the `LLMClient` port - the approved intent was preserved, only its mechanism changed.

The duplicated streaming loop this created is recorded as LSO.P1.B with the concrete de-duplication step. Verified after the fix: `npm run build:sidecar` succeeds, and the 12 pre-existing `LocalAdapterRegistry` tests still pass unchanged.

Two smaller items: an assigned-but-unread `content` accumulator and an unused `writer` parameter surfaced in typecheck and were removed; a fragile string-matching 404 path in `writeError` was replaced with a proper `notFound()` error before it could ship.

## Quality gates (Phase 7 GO/NO-GO)

| Gate | Threshold | Result |
|------|-----------|--------|
| Test failures | 0 | **0** - desktop 87 files / 735 passed; root 424 files / 4646 passed |
| Coverage | >= 80% lines | **98.01% lines / 90.66% branches / 97.70% functions** on `sidecar/src/serving`, every file >= 95% |
| Lint errors | 0 | **0** - eslint root (`src modules`) + desktop (`src sidecar/src tests`, `--max-warnings=0`) |
| Build | succeeds | **Yes** - `tsc -b`, `tsc --noEmit`, `npm run build:sidecar` |

Also clean: `check:tampering` (0 findings), `deps:check` (0 errors, 10 pre-existing warnings, none new).

**Verdict: GO.** No gate was bypassed.

## Files

**New** (14 source, 12 test):
`desktop/sidecar/src/serving/{config,errors,guard,chatCore,modelRouter,openaiRoutes,anthropicRoutes,gateway,adapters,servingRuntime}.ts`; `desktop/src/pages/settings/{ServingSettings.tsx,servingTypes.ts,ipcServingClient.ts,mockServingClient.ts}`; `modules/coding/llm/{loopback,headlessOpenAiClient}.ts`; `desktop/tests/{serving-config,serving-guard,serving-errors,serving-modelRouter,serving-adapters,serving-gateway,serving-chatCore,servingRuntime,ipcServingClient}.test.ts` + `desktop/tests/ServingSettings.test.tsx`; `tests/unit/llm/{loopback,headlessOpenAiClient}.test.ts`; `docs/v1/v1.16/known-gaps.md`; this file.

**Modified**: `package.json` (four config keys), `desktop/sidecar/src/{protocol,handlers,main}.ts`, `desktop/src/App.tsx`, `desktop/src/pages/settings/SettingsPage.tsx`, `desktop/tests/sidecar-handlers.test.ts` (implemented-method allowlist), `modules/coding/llm/LocalAdapterRegistry.ts` (loopback extraction + re-export), `.github/workflows/shell-build.yml`, `docs/DEVLOG.md`.

Unrelated benchmark-fixture timing noise regenerated by the test run was reverted, not committed.

## Known gaps

5 open items recorded in [../../known-gaps.md](../../known-gaps.md): LSO.P1.A (zero `usage` token counts - Phase 2.1 supplies them), LSO.P1.B (duplicated headless streaming loops), LSO.P1.C (live end-to-end tool smoke deferred to on-device QA), LSO.P1.D (host/port editable only via settings file), LSO.P1.E (`main.ts` wiring untested; `main.ts` is coverage-excluded by design).

## Next steps

Phase 2 - Per-Model Performance Analytics (A2). It captures tokens/sec, TTFT, and memory at the LLM-client boundary, which is where LSO.P1.A's missing token counts come from, so Phase 2 should close that gap as part of its work. The plan recommends the mid tier at medium effort for Phase 2.
