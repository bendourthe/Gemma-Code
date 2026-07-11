# v0.9.0 Phase 6 -- Session History

**Date**: 2026-05-16
**Phase**: 6 -- Curator scheduler subsystem + UX polish + minor wirings
**Plan**: [docs/archive/versions/v0/v0.9.0/plans/v0.9.0-cycle.md](../../plans/v0.9.0-cycle.md)
**Sub-tasks landed**: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9
**Carryovers closed**: v0.8.0 10.O.F / H / I / J / L / O / P / Q

---

## 1. Chronological steps

### Step 1: Pre-implementation review

Read the full Phase 6 section of the cycle plan and the Phase 5 close status from [docs/archive/versions/v0/v0.9.0/known-gaps.md](../../known-gaps.md). Phase 5 was complete with 16 open / 14 resolved in-cycle items; the eight Phase 6 carryovers ingested from v0.8.0/known-gaps.md were 10.O.F (sub-agent gate credit), 10.O.H (hook injection scan), 10.O.I (clean diff polish), 10.O.J (LM Studio live test), 10.O.L (/thinking-mode mid-flight), 10.O.O (oversized SKILL.md trims), 10.O.P (idle-time scheduler), 10.O.Q (lazy-import driver). Verified the following files exist as starting points:

- [src/agents/BackgroundWorkers.ts](../../../../versions/src/agents/BackgroundWorkers.ts) -- curator + reflect dispatch in place.
- [src/tools/AgentLoop.ts](../../../../versions/src/tools/AgentLoop.ts) -- pass-state gate at line 384, `VERIFICATION_TOOLS` set at line 33.
- [src/panels/ChatCommandHandlers.ts](../../../../versions/src/panels/ChatCommandHandlers.ts) -- `_handleThinkingMode` at line 907.
- [src/storage/PlanArchive.ts](../../../../versions/src/storage/PlanArchive.ts) -- `computeDiff` clean-mode branch at lines 176-187.
- [src/chat/ImprovementHook.ts](../../../../versions/src/chat/ImprovementHook.ts) -- `loadHook` at line 46.
- [src/tools/ToolRegistry.ts](../../../../versions/src/tools/ToolRegistry.ts) + [ToolRegistryBuilder.ts](../../../../versions/src/tools/ToolRegistryBuilder.ts) -- eager registrations.
- [src/guardrails/PromptInjectionScanner.ts](../../../../versions/src/guardrails/PromptInjectionScanner.ts) -- v0.8.0 Phase 2.7 scanner already present.
- The four oversized skills: [src/skills/catalog/harden/SKILL.md](../../../../versions/src/skills/catalog/harden/SKILL.md), [distill/SKILL.md](../../../../versions/src/skills/catalog/distill/SKILL.md), [build-second-brain/SKILL.md](../../../../versions/src/skills/catalog/build-second-brain/SKILL.md), [animate/SKILL.md](../../../../versions/src/skills/catalog/animate/SKILL.md).

### Step 2: 6.1 -- `IdleTimeScheduler` subsystem

Wrote [src/agents/IdleTimeScheduler.ts](../../../../versions/src/agents/IdleTimeScheduler.ts) as a pure module with three injectable seams: `now()` clock, `setInterval` / `clearInterval` timers, and an `IdleActivitySource` that subscribes to text-document-change + active-editor-change events. The scheduler tracks `_lastUserActivity` (epoch ms), `_tasks` (Map<id, {task, lastRunAt}>), and a `_running` re-entry flag. `tick()` evaluates every registered task against two gates: `idle >= idleThresholdMs` AND `now - lastRunAt >= cadenceMs`. Tasks that throw do NOT advance the cadence cursor so failures naturally retry.

Wrote [tests/unit/agents/IdleTimeScheduler.test.ts](../../../../versions/tests/unit/agents/IdleTimeScheduler.test.ts) with 10 tests: register idempotency, negative-threshold rejection, idle-gate, fire after idle, cadence blocking, activity reset, throw-no-advance, activity wire-up, start/stop idempotency, multi-task with different thresholds. All deterministic via the injected fake clock.

The plan called for "curator + reflect re-registered via this subsystem" (production wiring). That step is deferred under new gap 10.N.Q because it requires constructing the scheduler in `ChatPanelBootstrap` with the VSCode activity source AND removing the legacy curator-cadence fallback in `AgentLoop`. The legacy edit-trigger gating continues to dispatch curator / reflect as a safety net until the scheduler-driven path has telemetry behind it.

### Step 3: 6.2 -- Sub-agent pass-state gating credit

Added `SUB_AGENT_VERIFICATION_TYPES = new Set(["verification", "audit-worker", "testgaps-worker", "curator-worker"])` to [src/tools/AgentLoop.ts](../../../../versions/src/tools/AgentLoop.ts) at line 35. `reflect-worker` is explicitly excluded because its `dryRun()` does not assert correctness of recent edits. Added a new option `subAgentVerificationCredit?: boolean` (default `true`) and a public method `creditSubAgentVerification(result)` that flips `_verifiedSinceUserMessage` when:

- the option is enabled,
- the sub-agent returned `success: true`,
- the sub-agent type is in the verification set.

Wired credit calls into the four in-loop dispatch sites in `_runOneIteration` (verification / audit / testgaps / curator). Added a new setting `gemma-code.passStateGating.subAgentCredit` (default `true`) to [package.json](../../../../versions/package.json) and [src/config/settings.ts](../../../../versions/src/config/settings.ts); [src/panels/ChatController.ts](../../../../versions/src/panels/ChatController.ts) passes `deps.settings.passStateSubAgentCredit` through to the AgentLoop.

Wrote 4 new tests in [tests/unit/tools/AgentLoop.test.ts](../../../../versions/tests/unit/tools/AgentLoop.test.ts) covering positive credit (verification success suppresses the nudge), opt-out (`subAgentVerificationCredit: false` restores v0.8.0 nudge behaviour), failure (failed verification does NOT credit), and type filter (`reflect-worker` does NOT credit).

### Step 4: 6.3 -- `/thinking-mode` mid-flight affordance

Edited [src/panels/ChatCommandHandlers.ts](../../../../versions/src/panels/ChatCommandHandlers.ts) `_handleThinkingMode`: after the `vscode.workspace.getConfiguration("gemma-code").update(...)` succeeds, emit the canonical `_[Thinking mode: \`<preset>\`] Sampler preset applies to the next streaming request._` line via the existing `_emitMarkdown` -> `messageComplete` webview message. An already-in-flight stream finishes with the prior preset; the next streaming request picks up the new preset via the panel's existing settings-change listener (per v0.8.0 design).

Added a new test in [tests/unit/panels/ChatCommandHandlers.test.ts](../../../../versions/tests/unit/panels/ChatCommandHandlers.test.ts) asserting the dispatch of `thinking-mode think-max` emits the `[Thinking mode: \`think-max\`]` affordance.

### Step 5: 6.4 -- Clean diff trailing-newline polish

Edited [src/storage/PlanArchive.ts](../../../../versions/src/storage/PlanArchive.ts) `computeDiff`: replaced the inline `**${part.value}**` / `~~${part.value}~~` wrapping with a new exported `wrapDiffRun(value, marker)` helper that strips trailing newlines from `value` before applying the marker, then re-appends the newlines AFTER the closing marker. Pure-newline runs are left as-is to avoid producing `**\n**`. Updated the existing test to be more specific and added 2 new regression tests in [tests/unit/storage/PlanArchive.test.ts](../../../../versions/tests/unit/storage/PlanArchive.test.ts) asserting:

- the output never matches `**[^*]*?\n**` (closing marker orphan).
- `wrapDiffRun` handles `"hello\n"` -> `"**hello**\n"`, multi-newline trailing, empty input, pure-newline input, and the strikethrough marker.

### Step 6: 6.5 -- Improvement-hook prompt-injection scan

Edited [src/chat/ImprovementHook.ts](../../../../versions/src/chat/ImprovementHook.ts) to import `scan` + `summarize` from [src/guardrails/PromptInjectionScanner.ts](../../../../versions/src/guardrails/PromptInjectionScanner.ts). Added a new `LoadHookOptions` interface with `scanInjection?: boolean` (default `true`). `loadHook` (and therefore `renderHookAsSystemMessage`) now invokes the scanner on the trimmed body; matching content is dropped with a logged warning and the function returns `null`. Added a new setting `gemma-code.hooks.scanInjection` (default `true`) in [package.json](../../../../versions/package.json) and [src/config/settings.ts](../../../../versions/src/config/settings.ts). Edited [src/panels/ChatMessageRouter.ts](../../../../versions/src/panels/ChatMessageRouter.ts) `_handlePlanToggle` to forward `deps.getSettings().hooksScanInjection` into `renderHookAsSystemMessage`.

Added 5 new tests in [tests/unit/chat/ImprovementHook.test.ts](../../../../versions/tests/unit/chat/ImprovementHook.test.ts) covering injection-pattern drop ("Ignore previous instructions..."), scan opt-out, benign pass-through, invisible-unicode drop (zero-width space), `<system>` tag drop, and the renderHook forwarding of `scanInjection: false`.

### Step 7: 6.6 -- AST tool-registry -> lazy-import driver

Added a new `registerLazy(name, factory)` API to [src/tools/ToolRegistry.ts](../../../../versions/src/tools/ToolRegistry.ts) that stores a factory in a new `_lazyFactories` Map. `has` / `isEnabled` / `getEnabledNames` now consult the union of `_handlers` and `_lazyFactories`. A new public `resolveLazy(name)` invokes the factory once on first access and caches the result. `execute(call)` now calls `await this.resolveLazy(call.tool)` so the lazy path is the canonical resolution entry. Eager `register(name, handler)` deletes any prior lazy factory so the eager path wins on conflict.

Refactored [src/tools/ToolRegistryBuilder.ts](../../../../versions/src/tools/ToolRegistryBuilder.ts) to wire tier `confirm` / `dangerous` tools (write_file / create_file / edit_file / delete_file / run_terminal / web_search / fetch_page) via `registerLazy` with factories that `await import("./handlers/{terminal,webSearch,filesystem}.js")` and instantiate inside the factory. Tier `auto-approve` tools (read_file / list_directory / grep_codebase) and the optional `compress_*` / `update_todos` tools stay eager because the prompt builder needs their catalog entries on the first turn.

Added new exports `listLazyToolNames` and `listEagerToolNames` so the integration test can assert the wiring without scraping the builder body.

Wrote [tests/integration/tools/lazy-import-builder.test.ts](../../../../versions/tests/integration/tools/lazy-import-builder.test.ts) with 4 tests: at-least-30%-lazy ratio, lazy-tool visibility (`has` / `isEnabled` true before first use), eager-tool visibility, and `getEnabledNames` returning the union. Added 6 new lazy-mechanism tests to [tests/unit/tools/ToolRegistry.test.ts](../../../../versions/tests/unit/tools/ToolRegistry.test.ts).

A real boot-time reduction was NOT achieved this phase because `terminal.ts` and `webSearch.ts` are still imported transitively by `PermissionTiers.ts.isAllowlisted`, `ActionClassifier.ts.isBlocked`, `McpClient.ts.stripHtmlTags`, and `SubAgentManager.ts`. The lazy mechanism is correct and the wiring is in place; the full benefit waits on extracting the cross-cutting utilities into smaller pure modules. Tracked under 10.N.R for v0.10.0.

### Step 8: 6.7 -- LM Studio live integration test

Created [tests/integration/llm/LmStudioClient.live.test.ts](../../../../versions/tests/integration/llm/LmStudioClient.live.test.ts) with one test: `describe.runIf(process.env.LMSTUDIO_LIVE === "1")("LM Studio live (env-gated)", ...)`. The test checks `client.checkHealth()` returns `true`, lists models, picks the first, and streams one completion with `{role: "user", content: "Reply with the single word: ok."}` against `127.0.0.1:1234` (URL override via `LMSTUDIO_BASE_URL`). Safety cap of 200 stream chunks. 60-second timeout.

Documented in [CONTRIBUTING.md](../../../../versions/CONTRIBUTING.md) Testing section: "Set `LMSTUDIO_LIVE=1` to run the env-gated LM Studio live test... Without the env var the test is skipped silently." Verified the skip path via `npx vitest run --config configs/vitest.config.ts tests/integration/llm/LmStudioClient.live.test.ts` -> 1 skipped, 0 failed.

### Step 9: 6.8 -- Trim 4 oversized SKILL.md files

Ran `node bin/gemma-check.mjs --rule prompt-oversized` on the four files to confirm starting token counts: harden ~805, distill ~812, build-second-brain ~1223, animate ~968. Trimmed each via tightened prose and condensed enumerations:

- [src/skills/catalog/harden/SKILL.md](../../../../versions/src/skills/catalog/harden/SKILL.md) -- compressed introductory sentence, removed parenthetical examples in the checklist, condensed the "Process" / "Hard rules" / "Usage" sections. Recheck: 0 findings.
- [src/skills/catalog/distill/SKILL.md](../../../../versions/src/skills/catalog/distill/SKILL.md) -- same approach. Recheck: 0 findings.
- [src/skills/catalog/animate/SKILL.md](../../../../versions/src/skills/catalog/animate/SKILL.md) -- same approach. Recheck: 0 findings.
- [src/skills/catalog/build-second-brain/SKILL.md](../../../../versions/src/skills/catalog/build-second-brain/SKILL.md) -- the largest at ~1223 tokens. Extracted the verbose interview script + extraction examples into a sibling [build-second-brain/examples.md](../../../../versions/src/skills/catalog/build-second-brain/examples.md) referenced from the SKILL.md. The SKILL.md retains the canonical process steps; the examples.md carries the reproducible fixtures. Recheck: 0 findings.

Regenerated [docs/index.md](../../../../versions/v0/docs/index.md) via `npm run catalog`. The lone outstanding `prompt-oversized` warning (`review-pr/SKILL.md ~811 tokens`, from v0.9.0 Phase 3.1) remains tracked under v0.9.0/known-gaps.md 10.N.F.

### Step 10: 6.9 -- Phase 6 testing and stabilisation

Ran the full suite from Windows: `npm run lint` (clean), `npm run build` (clean), `npm test` (227 files, 2636 passed + 5 skipped, 0 failed in 28.95s), `npm run check src/` (1 pre-existing warning on review-pr/SKILL.md tracked under 10.N.F), `npm run deps:check` (0 errors, 3 pre-existing orphan warnings), `npm run perm-tier:check` (clean), `npm run catalog` (regenerated docs/index.md to reflect the new src/agents/IdleTimeScheduler.ts + updated tool registry LOC + storage / config files). Atomic commits per the plan's guidance would have produced 8 commits; per user instruction the work landed as a single commit + push to main, mirroring the Phase 2 / 3 / 4 / 5 deviation pattern (tracked under 10.N.S).

---

## 2. Troubleshooting events

### 2.1 `check-pr-checklist` did not fail Phase 6 testing

No troubleshooting events of note in Phase 6. The build / lint / test run was green on the first pass after every sub-task. The only adjustment was reordering of `lazyImport` factory parameters in [src/tools/ToolRegistryBuilder.ts](../../../../versions/src/tools/ToolRegistryBuilder.ts) to match `await import("./handlers/{terminal,webSearch,filesystem}.js")` then `new mod.WriteFileTool(gate, editMode)` — the original draft inlined the constructor argument instead of using the resolved module's class export, which would have failed at type-check time.

### 2.2 catalog drift after IdleTimeScheduler addition

`npm run catalog:check` (`generate-catalog.mjs && git diff --exit-code docs/index.md`) reported drift after IdleTimeScheduler.ts landed: src/agents row went from 6 files / 1344 LOC to 7 files / 1529 LOC. Resolved by running `npm run catalog` (regenerates docs/index.md). The check passes once the regenerated docs/index.md is committed alongside the source change.

### 2.3 LM Studio live test could not load without setupFiles

A direct `npx vitest run tests/integration/llm/LmStudioClient.live.test.ts` invocation failed because the default vitest configuration does not include `tests/setup.ts` (the vscode-mock). Switching to `npx vitest run --config configs/vitest.config.ts ...` resolves the issue. The test always runs under `npm test` / `npm run test:integration` which both pin the config, so this is operational guidance rather than a fix.

---

## 3. Assumptions

1. **Reflect-worker excluded from pass-state credit.** Reflect's `dryRun()` produces lesson proposals, not a correctness assertion. Including it would let a successful reflect run launder a "done" claim that bypassed verification. Marked explicitly in the `SUB_AGENT_VERIFICATION_TYPES` set comment.
2. **IdleTimeScheduler production wiring deferred.** Construction inside `ChatPanelBootstrap` requires wiring `vscode.workspace.onDidChangeTextDocument` + `vscode.window.onDidChangeActiveTextEditor` via the new `IdleActivitySource` interface, registering the two existing workers, and deleting the legacy curator-cadence fallback in `AgentLoop`. That cross-cut is out of Phase 6's scope; tracked under 10.N.Q.
3. **Lazy import gain limited by transitive imports.** The lazy mechanism is correct, but `terminal.ts` and `webSearch.ts` are imported elsewhere so the modules still load at boot. Tracked under 10.N.R; the long-form fix is to split out the cross-cutting utilities (`isAllowlisted`, `isBlocked`, `stripHtmlTags`) into smaller pure modules.
4. **`/thinking-mode` affordance uses existing protocol.** The plan said "via the existing webview-render protocol". The existing `_emitMarkdown` -> `messageComplete` path renders the affordance as a chat message; no new protocol type was introduced. The user sees a small italic line containing `[Thinking mode: <preset>]`.
5. **Hook injection scan defaults to on.** A workspace-checked-in hook is a hypothetical future scenario, but the cost of scanning every hook read is negligible. The opt-out (`gemma-code.hooks.scanInjection: false`) covers the case where a user authors a hook intentionally containing trigger text.

---

## 4. Testing results

| Gate | Result | Notes |
|---|---|---|
| `npm run lint` | exit 0 | 0 errors, 0 warnings |
| `npm run build` | exit 0 | tsc clean |
| `npm test` | 227 files, 2636 passed, 5 skipped, 0 failed | 28.95 s on Windows |
| `npm run check src/` | 0 errors, 1 warning | warning is pre-existing review-pr/SKILL.md (10.N.F) |
| `npm run deps:check` | 0 errors, 3 warnings | warnings are pre-existing orphans |
| `npm run perm-tier:check` | exit 0 | clean |
| `npm run check:prompts` (4 target skills) | 0 findings | harden / distill / build-second-brain / animate all under 800 tokens |
| `LMSTUDIO_LIVE` unset live test | 1 skipped | runIf gate works |

---

## 5. Next steps

- Phase 7 -- CI hardening from v0.8.0 post-CI audit (10.O.AB-AG). CRITICAL: 7.1 (Node 24 actions upgrade) has a hard deadline of 2026-09-16 (GitHub removes Node 20 from runners). Phase 7 follow-ups: functions coverage gate, check-prompts CI job, CodeQL SAST, fast-bench gate, depcruise SVG artifact.
- Production wiring of `IdleTimeScheduler` (10.N.Q) -- could land in Phase 8 cycle close or move to v0.10.0.
- Transitive-import split (10.N.R) -- v0.10.0 candidate; carve `isAllowlisted` + `isBlocked` + `stripHtmlTags` out of the handler modules so the lazy-import gate genuinely shaves boot-time imports.

---

## 6. Phase 6 Exit Checklist

- [x] 10.O.F closed (sub-agent pass-state gate credit)
- [x] 10.O.H closed (improvement-hook prompt-injection scan)
- [x] 10.O.I closed (clean diff trailing-newline polish)
- [x] 10.O.J closed (LM Studio live integration test, env-gated)
- [x] 10.O.L closed (/thinking-mode mid-flight affordance)
- [x] 10.O.O closed (4 oversized SKILL.md trims; 1 pre-existing review-pr warning carried as 10.N.F)
- [x] 10.O.P closed (IdleTimeScheduler subsystem; production wiring deferred under 10.N.Q)
- [x] 10.O.Q closed (lazy-import driver; transitive-import cleanup deferred under 10.N.R)
- [x] `prompt-oversized` warnings down to 1 (review-pr only; pre-existing)
- [x] Phase 6 session history written (this file)
