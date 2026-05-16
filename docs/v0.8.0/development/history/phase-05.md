# Session history -- v0.8.0 Phase 5 (Skill ecosystem maturation)

**Date**: 2026-05-16
**Plan**: `docs/v0.8.0/plans/v0.8.0-cycle.md` Phase 5
**Outcome**: 12 of 12 sub-tasks shipped. 88 new unit tests pass on top of the existing suite; `npm run lint` and `npm run build` are green. Four new gap entries (10.O.O / .P / .Q / .R) and two carryover resolutions (v0.7.0 10.O.5 / 10.O.6) captured in `docs/v0.8.0/known-gaps.md`.

## Goals

Per the plan:

> Per-skill success metrics, dual-loop curator with dry-run + rollback, AST-scanned tool registry, `.gemma.md` git-root walk discovery, shell-hook stdin-JSON / stdout-decision protocol, pre-tool command compressor, single test runner with sub-modes, and a prompt linter. Also closes v0.7.0 known-gap 10.O.5 (Promote-to-Memory section mapping) and 10.O.6 (Phase 5 documentation cross-link).

## Sub-tasks completed

1. **5.1 -- Per-skill success metrics** (`src/skills/SkillMetrics.ts`, slash command `/skill-metrics`). Rolling 30-day window per skill, persisted to `~/.gemma-code/metrics.json`, emits `skill.<name>.<outcome>` Tracer events. Wired into `ChatController.submitUserMessage` so every skill invocation records `success` / `failure`.
2. **5.2 -- Curator background worker** (`src/skills/CurationLoop.ts`, `runCuratorWorker` in `BackgroundWorkers.ts`, `curator-worker` SubAgentType, slash command `/curate`). Dry-run produces an idempotent manifest of `archive-stale-skill` / `consolidate-duplicate-memory-entries` / `patch-skill-frontmatter` actions; apply writes a rollback manifest; rollback round-trips. The `gemma-code.workers.curator.enabled` setting + 12 h cadence gate guard the automatic trigger.
3. **5.3 -- AST-scanned tool registry** (`src/tools/AstToolScanner.ts` + `auditToolRegistryAst` in `ToolRegistryBuilder.ts`). Globs `src/tools/handlers/**/*.ts`, parses each module via the TypeScript compiler API, and reports two drift classes: handler modules with no real export (skip-eligible) and exported handlers that the registry does not wire (registration miss).
4. **5.4 -- 30 s TTL on `check_fn` probes** (`cachedCheck` / `cachedCheckSync` / `invalidateCheck` in `ToolActivationRules.ts`). Keys by `(name, argSignature)`; default 30 s TTL; manual invalidation by name or globally.
5. **5.5 -- `.gemma.md` git-root walk** (`discoverGemmaContextFiles` / `readGemmaContextFiles` in `MemoryFiles.ts` + a new `gemma-context-walk` section in `PromptBuilder`). Walks from cwd to `.git` (or filesystem root) collecting `.gemma.md` files deepest-first; secret-path denylist applied; injected at priority 18 between memory snapshot and skill index.
6. **5.6 -- Shell-hook stdin-JSON / stdout-decision protocol** (all three hooks under `scripts/hooks/`). When stdin contains `{ event, ... }` JSON, the hook prints `{"decision":"allow"|"block",...}` to stdout and exits 0. Legacy exit-code path preserved. The tool-permission hook also writes session consent entries to `~/.gemma-code/hooks-consent.json`.
7. **5.7 -- Pre-tool command compressor** (`src/tools/handlers/preToolHook.ts`, wired into `RunTerminalTool`). Whitelisted compressors for `npm test` / `vitest` / `jest` / `pytest` / `cargo test` / `git diff` / `npm install`. Stderr always preserved verbatim. Setting `gemma-code.preToolCompression` (default `true`) gates the rewrite.
8. **5.8 -- Single test runner** (`scripts/test.mjs`, `npm run t`). Modes: `unit / integration / golden / bench / mutation / coverage / all`; passthrough args via `--`.
9. **5.9 -- Prompt linter rules** (`lib/checks/prompt-*.mjs` + `lib/checks/skill-duplicate-name.mjs`, `npm run check:prompts`). `appliesTo` scope-gates markdown-only rules; the runner walks `.md` files when at least one prompt rule is selected. Cross-file `flush()` pattern documented for future cross-file rules.
10. **5.10 -- Memory.md promotion mapping** (`src/panels/MemoryPanel.ts` + `docs/v0.8.0/memory-promotion-mapping.md`). `sectionForType` now accepts an override map; `gemma-code.memory.promotionMapping` setting exposes the override.
11. **5.11 -- Phase 3 context-limits cross-link** (`docs/v0.7.0/architecture.md` Phase 5 section). One-paragraph blockquote pointing at v0.7.0 Phase 3 sub-task 3.7.
12. **5.12 -- Testing + stabilization**. 88 new unit tests written, all passing.

## Decisions and trade-offs

- **Curator scheduler is cadence-gated, not idle-driven (10.O.P)**. The plan called for a 12 h idle-time scheduler. The implementation gates the existing post-N-edits trigger on a 12 h minimum-interval; the `/curate` command and the deterministic worker run on demand. A genuine timer-driven scheduler is deferred to v0.9.0 alongside other timer-driven workers.
- **AST tool registry is a drift detector, not yet a lazy-import driver (10.O.Q)**. Every handler in the current registry is needed at startup, so lazy-loading would not be a net win for v0.8.0. The scanner output is exposed via `auditToolRegistryAst` for CI / dev-only consumption.
- **Prompt linter ships with documented latent findings (10.O.O)**. The new rules surface 42 pre-existing findings in `src/skills/catalog/**` (mostly em-dashes). Per the global rule "every changed line must trace directly to the user's request", we did not sweep the catalog in this phase. Phase 7 polish will run the cleanup.
- **Prompt-rule unit tests live under `tests/unit/lib/`, not `tests/unit/cli/` (10.O.R)**. The pre-existing 10.O.D vitest 1.6.1 vm-transform bug blocks any test file co-located with `gemma-check.test.ts` from collecting on the dev workstation. Relocating the new suite kept it green.
- **`getSkillMetrics()` is optional on the `ChatCommandContext` getter (forward-compat)**. The legacy `ChatController.test.ts` builds the context without the new getter; calling `ctx.getSkillMetrics?.()` in the skill dispatch path keeps the old tests green without forcing a context-shape refactor.

## Tests

- 88 new unit tests in this phase; the only test failures in the full `npm run test` run are the known 10.O.D / 10.O.N pre-existing vitest issues on Windows, neither of which is introduced by Phase 5.
- `npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` clean.

## Files touched

### New source files
- `src/skills/SkillMetrics.ts`
- `src/skills/CurationLoop.ts`
- `src/tools/AstToolScanner.ts`
- `src/tools/handlers/preToolHook.ts`
- `lib/checks/prompt-no-ascii-violation.mjs`
- `lib/checks/prompt-oversized.mjs`
- `lib/checks/prompt-trailing-whitespace.mjs`
- `lib/checks/prompt-bom.mjs`
- `lib/checks/skill-duplicate-name.mjs`
- `scripts/test.mjs`

### Modified source files
- `src/agents/types.ts` (added `curator-worker`)
- `src/agents/SpecialistLoader.ts` (curator-worker tier + tool scope)
- `src/agents/BackgroundWorkers.ts` (added `runCuratorWorker` + `formatCuratorManifest`)
- `src/agents/SubAgentManager.ts` (curator-worker dispatch + `setCurationLoop`)
- `src/tools/AgentLoop.ts` (curator trigger + 12 h cadence gate)
- `src/tools/ToolActivationRules.ts` (cachedCheck cache)
- `src/tools/ToolRegistryBuilder.ts` (auditToolRegistryAst)
- `src/tools/handlers/terminal.ts` (compression hook wiring)
- `src/storage/MemoryFiles.ts` (`discoverGemmaContextFiles` / `readGemmaContextFiles`)
- `src/chat/PromptBuilder.ts` (gemma-context-walk section)
- `src/panels/MemoryPanel.ts` (override-able section mapping)
- `src/panels/ChatPanelBootstrap.ts` (SkillMetrics / CurationLoop wiring)
- `src/panels/ChatController.ts` (skill-metrics recording + curator flag)
- `src/panels/ChatCommandHandlers.ts` (`/skill-metrics`, `/curate`)
- `src/panels/messages.ts` (curator-worker agent type)
- `src/commands/CommandRouter.ts` (new built-in commands)
- `src/config/settings.ts` (`workers.curator.enabled`, `preToolCompression`)
- `scripts/hooks/check-tool-permission.mjs` (stdin-JSON protocol + consent)
- `scripts/hooks/check-git-control-plane.mjs` (stdin-JSON protocol)
- `scripts/hooks/check-prompt-policy.mjs` (stdin-JSON protocol)
- `bin/gemma-check.mjs` (`appliesTo` scope gate, markdown walking, `flush()` drain)
- `lib/checks/index.mjs` (register five new rules)
- `package.json` (new `check:prompts` + `t` scripts)

### New documentation
- `docs/v0.8.0/memory-promotion-mapping.md`
- `docs/v0.8.0/development/history/phase-05.md` (this file)

### Modified documentation
- `docs/v0.7.0/architecture.md` (cross-link)
- `docs/v0.7.0/known-gaps.md` (10.O.5 / 10.O.6 moved to Resolved)
- `docs/v0.8.0/known-gaps.md` (added 10.O.O / .P / .Q / .R; resolved 10.O.5 / 10.O.6)

### New test files
- `tests/unit/skills/SkillMetrics.test.ts`
- `tests/unit/skills/CurationLoop.test.ts`
- `tests/unit/tools/AstToolScanner.test.ts`
- `tests/unit/tools/cachedCheck.test.ts`
- `tests/unit/tools/handlers/preToolHook.test.ts`
- `tests/unit/storage/GemmaContextWalk.test.ts`
- `tests/unit/scripts/testRunner.test.ts`
- `tests/unit/panels/MemoryPanel.sectionForType.test.ts`
- `tests/unit/lib/checks-prompt-rules.test.ts`
- `tests/unit/hooks/check-tool-permission.protocol.test.ts`

### Modified test files
- `tests/unit/agents/SubAgentManager.test.ts` (added curator-worker dispatch case)

## Next steps

- Phase 6: P2 backlog (three-state sync return, intuition cache, reflect job, etc).
- Phase 7 polish should run `npm run check:prompts -- --json` and apply the ASCII-only cleanup across the bundled skill catalog (10.O.O).
