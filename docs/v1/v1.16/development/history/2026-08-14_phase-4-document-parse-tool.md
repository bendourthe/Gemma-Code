# Session History - v1.16.0 Phase 4: Document-Parse Agent Tool + Memory Ingestion

**Date**: 2026-08-14
**Version**: v1.16.0
**Plan**: [../../plans/v1.16.0-adoption-local-serving-and-ocr.md](../../plans/v1.16.0-adoption-local-serving-and-ocr.md)
**Phase**: 4 of 6 - Document-Parse Agent Tool + Memory Ingestion (adoption item A6)
**Outcome**: Complete, at the widest scope offered. All quality gates passed without bypass. Two in-phase bugs caught before commit.

## Goal

Make the Phase 3 OCR capability usable by the coding agent: a governed `parse_document` tool whose output is treated as untrusted external content, plus optional memory ingestion behind a default-off flag.

## Pre-flight

`is_final_phase` = **false** (Phase 6 terminal). Model routing: plan recommends the strong-reasoning tier at medium-high effort, matching the session. Prerequisite (Phase 3 OCR) satisfied at `c6b63a9`.

Five findings shaped the phase:

1. **No agent tool could reach the OCR runtime.** It lived in `desktop/sidecar/src/ocr/`, and `src/activation/proxy.ts:141` defers the extension-to-sidecar IPC client.
2. **Two tool surfaces, not equivalent.** `src/tools/` has tiers, the secret-path denylist, and classifier routing; `modules/coding/runtime/headlessTools.ts` had none of the three.
3. **`MemoryStore.save` throws on injection markers** - routine for untrusted OCR text, so rejection is an expected outcome.
4. **The tier feeds a generated SSOT** - `security:check` fails unless the permission table is regenerated.
5. **A new builtin permanently costs prompt budget** (`MAX_TOOL_COUNT = 15`, builtins never trimmed).

## Decisions taken at the start

1. **Architecture** -> promote the OCR client to `core/documents/` and give the tool a resolver seam (over duplicating a spawner per host, or building the deferred IPC client).
2. **Surface** -> **both**, which meant building the missing headless guards.
3. **Tier** -> **CONFIRM**, matching `write_file` / `fetch_page`.

## Sub-tasks implemented

### 4.0 Core promotion (prerequisite refactor)

`git mv` moved `runtimeClient` / `parseManager` / `runtimeFactory` into `core/documents/` (history preserved). They import only node builtins, so they satisfy `no-core-from-modules`. Three importers repointed; `deps:check` stayed at 0 errors.

### 4.1 The tool, on both surfaces

**VS Code** (`src/tools/handlers/parseDocument.ts`): four guards in order - secret-path denylist (+ `allow_secrets` + confirmation), `pathGuard.resolveInsideWorkspace`, `redactSecrets` over the extracted text (a **new** redaction point; tool output was not redacted anywhere before), and membership in `INBOUND_EXTERNAL_DATA_TOOLS` so `AgentLoop` annotates it. The parser is reached through an injected seam and only ever receives base64 - the tool owns path resolution, so a parser implementation can never be handed an unvalidated path.

**Headless**: the guards did not exist, so they were built.

- `headlessGuards.ts` screens **every** headless tool call (not just the new one), so a later tool cannot forget it.
- `HeadlessAgentSession` gained inbound-classifier routing, warn-then-allow, mirroring `AgentLoop._screenInboundResult`.
- The tier map was **extracted** into a vscode-free `permissionTierMap.ts`, which `PermissionTiers.ts` re-exports. `PermissionTiers.ts` reaches `vscode` transitively via `utils/logger` and `src/tools/handlers/terminal`, so the headless surface could not import it - and a second copy of the map is exactly how two surfaces drift. The SSOT generator was repointed at the new file.

### 4.2 Memory ingestion

Off by default, mirroring `nexus.memory.consolidation.enabled`: the flag is a constructor option and the class short-circuits on its first line, so nothing is written and no work is done when false. Observations carry provenance (source file, engine, tool name) in both the content and the metadata column, are capped at 8000 chars, and are redacted twice on purpose - once by the tool before the model sees the text, once by `MemoryStore.save` before the row hits SQLite. A store rejection is reported as a normal "not stored" outcome with a reason; a memory failure never fails the parse.

## Troubleshooting

**Bug 1 - the guard design was wrong, and the tests said so.** The first version enforced permission tiers unconditionally. Every write/terminal tool on the headless surface is CONFIRM or DANGEROUS and no host supplies a confirm callback, so it refused essentially every agent action: 10 existing tests failed, and in production it would have disabled the headless coding agent outright. Redesigned so the secret-path check stays unconditional (refusing `.env` costs nothing legitimate) while tier enforcement waits for a host callback. **Lesson**: when adding a gate to a surface that never had one, check what the gate's default verdict does to existing traffic before assuming fail-closed is the safe choice.

**Bug 2 - a hand-transcription error in the extracted tier map.** `run_terminal`, `web_search`, and `fetch_page` came out as CONFIRM instead of DANGEROUS. Caught by parsing both maps and diffing them programmatically rather than reading them side by side. A related trap in the same file: my doc comment contained an example entry, which the generator's regex would have parsed as a real tool - removed, and the comment now warns against it.

**`parse_document` had to be made trimmable.** With `MAX_TOOL_COUNT = 15` and builtins never trimmed, a 25th catalog entry pushed the untrimmable core to 16 and broke the prompt-budget cap in two e2e tests. It now trims after MCP tools and before `codegraph_*`, on the reasoning that losing symbol navigation hurts the default coding path more than losing document OCR does.

Three test updates followed from deliberate changes rather than defects: the catalog count (24 -> 25), the SSOT generator test's source path, and nothing else.

## Quality gates (Phase 7 GO/NO-GO)

| Gate | Threshold | Result |
|------|-----------|--------|
| Test failures | 0 | **0** - root 433 files / 4811, desktop 93 / 808, Python 196, installer clean apart from 2 pre-existing `zstandard` failures (missing local dep) |
| Coverage | >= 80% lines | **87.85% lines / 84.22% branches / 91.40% functions**; new modules `permissionTierMap` and `headlessGuards` at 100%, `documentMemoryIngestor` 100%, `parseDocument` 99.16% |
| Lint errors | 0 | **0** - eslint root + desktop (`--max-warnings=0`) |
| Build | succeeds | **Yes** - `tsc -b`, desktop `tsc --noEmit`, `build:sidecar` |

Also clean: `security:check` (permission table regenerated from its new source and verified), `deps:check` 0 errors, `check:tampering` 0 findings, `check:docs-layout`, and the prompt-budget compliance test.

**Verdict: GO.** No gate bypassed.

## Files

**New**: `modules/coding/guardrails/permissionTierMap.ts`, `modules/coding/runtime/headlessGuards.ts`, `src/tools/handlers/{parseDocument,documentMemoryIngestor}.ts`, `tests/unit/tools/handlers/{parseDocument,documentMemoryIngestor}.test.ts`, `tests/unit/runtime/headlessGuards.test.ts`, `tests/integration/coding-pillar/parse-document-wiring.test.ts`, this file.

**Moved** (history preserved): `desktop/sidecar/src/ocr/{runtimeClient,parseManager,runtimeFactory}.ts` -> `core/documents/{OcrRuntimeClient,OcrParseManager,ocrRuntimeFactory}.ts`.

**Modified**: `src/tools/{types,ToolCatalog,ToolRegistryBuilder,ToolActivationRules,AgentLoop}.ts`, `modules/coding/guardrails/PermissionTiers.ts`, `modules/coding/runtime/{headlessTools,HeadlessAgentSession}.ts`, `modules/coding/config/settings.ts`, `desktop/sidecar/src/handlers.ts`, `desktop/tests/{ocr-handlers,ocr-parseManager}.test.ts`, `package.json` (2 settings), `scripts/generate-tool-permission-table.mjs`, `nexus.security.toml` + `docs/archive/v0/v0.5/architecture.md` (both generated), `tests/unit/tools/ToolCatalog.test.ts`, `tests/unit/scripts/security-ssot-generator.test.ts`, `docs/DEVLOG.md`, `docs/v1/v1.16/known-gaps.md`.

Unrelated benchmark-fixture timing noise was reverted, not committed.

## Known gaps

4 new deferrals in [../../known-gaps.md](../../known-gaps.md). The honest headline is **LSO.P4.B: the tool is not wired into any composition root yet**. The tool, its four guards, its tests, and its settings flag all exist and pass, but no host constructs a `DocumentParser`, so `parse_document` is not registered at runtime. Same for memory ingestion (LSO.P4.C), and headless tier enforcement is opt-in with no host currently opting in (LSO.P4.A). Shipping these tested-but-unwired was the deliberate choice over wiring them unexercised; each is a small host-specific adapter with its own failure modes (missing Python, missing model).

## Next steps

Phase 5 - MLX-via-Adapters Docs + Model-Library UX (A3 + A4), mid tier / medium effort: document the existing `nexus.llm.localAdapters` path to an MLX server on Apple Silicon with a recorded macOS smoke check, and polish the Models page with search/filter plus a quick model-switcher. Note that the Phase 1 serving gateway already routes to any registered loopback adapter, so the MLX path is documentation of a working mechanism rather than new code - which is what the plan says.
