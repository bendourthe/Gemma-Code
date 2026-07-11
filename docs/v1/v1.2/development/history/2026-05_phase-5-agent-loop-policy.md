# v1.2.0 Phase 5 -- Agent Loop Policy Enforcement (2026-05-28)

## Plan reference

[docs/versions/v1/v1.2.0/plans/adoption-ecosystem-2026-05.md](../../plans/adoption-ecosystem-2026-05.md) Phase 5 -- the 5th of seven phases in the 2026-05 ecosystem-adoption cycle. Source comparison: [docs/versions/v1/v1.2.0/comparison-ecosystem-2026-05.md](../../comparison-ecosystem-2026-05.md) Section 5 items 12, 13, 16, 18 (Anthropic "best practices in large codebases" article, S3).

## Goal

Codify and enforce four agent-loop policies without adding any new dependencies: (1) sub-agents dispatched with `intent: 'explore'` are restricted to a read-only tool allowlist; (2) skills carry an optional `pathScope` predicate so the catalog only auto-loads them when the active path matches; (3) a shared `.nexusignore` parser is honored at memory ingest and a `.nexus/permissions.deny` parser ships for per-tool denials; (4) a 13th lifecycle hook fires at session end so a reference reflection hook can mine the transcript for AGENTS.md / skill updates.

## Sub-tasks completed

### 5.1 -- Read-only exploration sub-agent enforcement

- **New module**: `core/coding/SubAgentPolicy.ts`. Pure module, no I/O. Exports `evaluateExploreToolCall(ctx)` returning `{ allow: boolean; reason?: ...; message?: string }`, `lintExploreSpecialist(input)` returning lint findings for specialist definitions, `tokenizeCommandLine(line)` for argv parsing, plus the constants `EXPLORE_READONLY_TOOLS` (read tools + 8 codegraph_* tools + web search), `EXPLORE_READONLY_BASH_COMMANDS` (14 entries), and `EXPLORE_READONLY_GIT_SUBCOMMANDS` (14 entries -- `status`, `log`, `diff`, etc., NOT `push` / `commit`).
- **Wired** into `src/agents/SubAgentManager.run` and `_buildScopedRegistry`. `SubAgentConfig.intent` becomes the trigger; when set to `'explore'`, the tool scope is intersected with the explore allowlist (plus `run_terminal`), and `run_terminal` is wrapped with a policy-gated decorator that calls `evaluateExploreToolCall` on every invocation.
- **Linter surface**: `SubAgentManager.lintSpecialistForExplore(input)` exposes the lint hook so a future `.claude/agents/` validator can flag specialists that mix `intent: 'explore'` with write tools.
- **Tests**: 23 unit tests at [tests/unit/core/coding/SubAgentPolicy.test.ts](../../../../versions/tests/unit/core/coding/SubAgentPolicy.test.ts); 7 integration tests at [tests/integration/sub-agent-enforcement/explore-policy.test.ts](../../../../versions/tests/integration/sub-agent-enforcement/explore-policy.test.ts) covering the plan's "explore sub-agent cannot Edit" regression.

### 5.2 -- Path-scoped skills

- **Extended** `core/skills/SkillCatalog.ts`. New `SkillPathScope { include?, exclude? }` interface; `SkillRecord` and `Skill` carry an optional `pathScope` field. `SkillCatalog` interface gains `listForPath(currentPath)` and `reevaluatePathScope(currentPath)`; `InMemorySkillCatalog` implements both.
- **Glob matcher**: `matchPathScope(scope, candidate)` exported alongside the catalog. Supports `**` (spans separators), `*` (single-segment), trailing-slash directory shortcuts (auto-rewrites `modules/coding/` -> `modules/coding/**`), Windows backslash normalisation, exclude-takes-precedence.
- **Backwards compat**: skills without `pathScope` continue to load globally; no change to existing skill manifests.
- **Tests**: 14 unit tests at [tests/unit/core/skills/PathScope.test.ts](../../../../versions/tests/unit/core/skills/PathScope.test.ts).

### 5.3 -- .nexusignore + permissions.deny

- **New module**: `core/storage/NexusIgnore.ts`. Pure parser exporting `parseIgnoreFile(content)`, `mergeIgnorePatterns(...sets)`, `defaultIgnorePatterns()`, and `matchesIgnore(path, patterns)`. Default set: 18 baseline entries (node_modules, .git, .nexus, .gemma-code, dist, out, build, framework caches, coverage dirs, *.tsbuildinfo, *.coverage).
- **New module**: `core/storage/PermissionsDeny.ts`. Pure parser exporting `parsePermissionsDeny(content)` and `evaluateDeny(toolName, subject, list)`. Format `<ToolName>: <pattern>` with `*` as a tool-name wildcard; pattern matcher is path-aware when the pattern contains `/`, otherwise greedy across whitespace for command patterns like `git push *`.
- **Default `.nexusignore`**: lands at the repo root with the canonical default set plus a project-extension stub.
- **Memory wiring**: `HybridRetriever` gains `ignorePatterns` constructor option, `setIgnorePatterns(p)` runtime swap, and a pre-chunk filter inside `ingestFile(input)` that short-circuits to an empty result for excluded paths.
- **Tests**: 14 unit tests at [tests/unit/core/storage/NexusIgnore.test.ts](../../../../versions/tests/unit/core/storage/NexusIgnore.test.ts), 10 unit tests at [tests/unit/core/storage/PermissionsDeny.test.ts](../../../../versions/tests/unit/core/storage/PermissionsDeny.test.ts).

### 5.4 -- Reflection hook position (13th)

- **Extended** `core/lifecycle/HookBus.ts`. `LifecycleEvent` discriminated union and `LifecycleEventByKind` mapping both gain `lifecycle.session.reflection` with payload `{ sessionId, isoTime, transcript, filesWritten, modelId?, transcriptTokens? }`.
- **New module**: `core/lifecycle/SessionReflectionHook.ts`. Reference implementation exporting `attachSessionReflectionHook(bus, opts)` (subscribes + returns a `Disposable`), `buildReflectionArtifact(event, patterns)` (pure transcript miner), `renderReflectionMarkdown(artifact)`, and `DEFAULT_REFLECTION_PATTERNS` covering "user explicitly corrected", "user confirmed", "user said X, I did Y wrong" spans.
- **Output**: writes `<nexusHome>/reflections/<sessionId>.md` with the list of files written + the matched transcript spans. Errors are swallowed -- the hook must never take down session-end.
- **Tests**: 9 unit tests at [tests/unit/core/lifecycle/SessionReflectionHook.test.ts](../../../../versions/tests/unit/core/lifecycle/SessionReflectionHook.test.ts).

### 5.5 -- Testing and stabilization

- All 3601 main tests pass (5 skipped, 0 failed); 411 desktop tests pass.
- 77 Phase 5 tests pass in isolation (23 + 14 + 14 + 10 + 9 + 7).
- `npm run lint` clean; `npm run lint:shell` clean (max-warnings=0).
- `npx tsc --noEmit` 0 errors.
- `npm run deps:check` 0 errors; 13 warnings (12 pre-existing + 1 new orphan on `core/storage/PermissionsDeny.ts`, intentional per known-gaps 5.3.P2.R).

## Deviations from plan

- The plan's reference to "modules/coding/" as the dispatch entry point is forward-looking; the production sub-agent dispatcher still lives in `src/agents/SubAgentManager.ts` during the v1.0.0 -> modules/coding compat window (v1.1.0 carryforward `1.4.P1.B`). The policy module ships under `core/coding/` (its eventual home) and is wired from `src/agents/` today. Tracked as known-gaps `5.1.P2.O`.
- The plan's reference to a `nexus-check` linter rule for `.claude/agents/` definitions is satisfied by exposing `SubAgentManager.lintSpecialistForExplore(input)` and the pure `lintExploreSpecialist` function. A dedicated `nexus-check` rule definition is not added in this phase; the lint surface is in place for it to call.
- The codegraph scanner retains its own inline `.nexusignore` parser instead of being refactored to use the new shared module. Both parsers produce equivalent behavior on the same input; the refactor is deferred to keep the diff scoped (known-gaps `5.3.P3.S`).
- The `PermissionsDeny` parser ships unwired -- no tool currently consults it. The plan specified the parser surface + tests; the per-tool integration is left for the unified pre-tool guard work (known-gaps `5.3.P2.R`).
- The path-scoped-skills live auto-reload (calling `reevaluatePathScope` on every edit-path change) is NOT wired into the agent loop; only the catalog method ships. Static-load path-scoped skills work correctly (known-gaps `5.2.P3.Q`).
- The session-reflection hook's daemon-side auto-attach is NOT included. The reference implementation is callable by any test or operator; integration into the chat session-end path is left to Phase 7 stabilization or the next cycle (known-gaps `5.4.P3.T`).

## Test signals

```
npm run test          3601 passed, 5 skipped, 0 failed   (314 files, 42s)
npm run test:shell    411 passed                           (46 files, 34s)
npm run lint          clean                                (eslint src)
npm run lint:shell    clean                                (eslint src sidecar/src tests --max-warnings=0)
npx tsc --noEmit      0 errors
npm run deps:check    0 errors, 13 warnings                (12 pre-existing + 1 new intentional orphan)
```

Phase 5 suites alone: 77/77 (23 SubAgentPolicy + 14 PathScope + 14 NexusIgnore + 10 PermissionsDeny + 9 SessionReflectionHook + 7 integration).

## Known issues added to v1.2.0 known-gaps.md

Six new entries (no P0 / P1 release-blockers); see [docs/versions/v1/v1.2.0/known-gaps.md](../../known-gaps.md):

- `5.1.P2.O` -- explore-intent wiring at src/agents only; future modules/coding dispatcher must pick up the policy module.
- `5.1.P2.P` -- MCP tools are not auto-classified for the explore allowlist (safer default).
- `5.2.P3.Q` -- live daemon does not auto-call `reevaluatePathScope` on edit-path changes yet.
- `5.3.P2.R` -- `PermissionsDeny` parser ships unwired pending the unified pre-tool guard.
- `5.3.P3.S` -- codegraph scanner retains its own inline `.nexusignore` parser; share-it refactor deferred.
- `5.4.P3.T` -- session-reflection hook is callable but the daemon does not auto-attach it yet.

## Next phase

Phase 6 -- Re-Partial Integrations (file-watcher abstraction lifted out of code-graph; LSP client for TS / Python / Rust; interactive HTML scaffolding for "copy as JSON" round-trip artifacts).
