# 2026-05-20 -- v1.1.0 Phase 8 -- DevAI-Hub closures + skill hot-reload + AgentLoop skill provenance

**Plan**: [docs/versions/v1/v1.1.0/plans/phase-08-devai-hub-closures.md](../../plans/phase-08-devai-hub-closures.md)
**Closes**: v1.0.0 carryforward 10.P1.GGG, 10.P1.HHH, 10.P2.III, 10.P2.JJJ, 10.P2.KKK
**Status**: Complete. 5 sub-tasks landed end-to-end with the quality gate green.

---

## Subtasks completed

### 8.1 -- `SkillsReloader` watches the ACTIVE pointer

- New module: [core/skills/SkillsReloader.ts](../../../../core/skills/SkillsReloader.ts).
- 200 ms debounce collapses the syncer's write-tmp-then-rename rotation into a single `catalog.reload()`.
- Tolerates the three real-world states: pointer file already exists, parent dir exists but pointer does not, neither exists yet.
- `onReload(activeTag)` callback feeds the SkillsSettings UI's "Loaded N new skills" message.
- `onError` callback prevents a misbehaving reload from crashing the watcher.
- `bootstrapCoding()` accepts an optional `skillCatalog` and starts the reloader when one is supplied.
- Sidecar daemon-entry-point wiring deferred under open item 8.1.P2.T (waits on the SkillCatalog-backed adapter from the v1.0.0 known-gaps `MV` cluster).

### 8.2 -- Weekly `IdleScheduler` auto-sync worker

- New module: [core/skills/DevAIHubAutoSync.ts](../../../../core/skills/DevAIHubAutoSync.ts).
- `createDevAIHubSyncTask({runner?, cadenceMs?, idleThresholdMs?})` returns an `IdleScheduler.register`-ready task.
- Default cadence: `DEVAI_HUB_SYNC_CADENCE_MS = 7 days`; default idle threshold: `DEVAI_HUB_SYNC_IDLE_MS = 5 minutes`.
- `defaultSyncRunner()` lazy-loads `DevAIHubSyncer` so production hosts do not pay the import cost until the task actually fires.
- `bootstrapCoding()` reads `nexus.skills.autoSync.devai-hub` and registers / unregisters the worker accordingly.
- New `nexus.skills.autoSync.devai-hub` settings entry in [package.json](../../../../package.json), defaulting to `false`.

### 8.3 -- `nexus skills install/remove` with allowlist + scanner

- New modules: [core/skills/installAllowlist.ts](../../../../core/skills/installAllowlist.ts), [core/skills/SkillInstaller.ts](../../../../core/skills/SkillInstaller.ts).
- Allowlisted hosts: `github.com`, `gitlab.com`, `raw.githubusercontent.com`, `bendourthe.com`.
- `file://` URLs allowed only under `NEXUS_SKILLS_TEST_MODE=1` (used by the unit-test fixture).
- 30-second overall fetch timeout via `AbortController`.
- Every fetched body passes through `PromptInjectionScanner.scanText`; a `block` decision refuses the install (`reason: "scanner-blocked"`).
- Writes are clamped to `<skillsRoot>/user/<name>/SKILL.md` via `isPathInside`.
- `removeSkill(spec)` refuses any namespace other than `user/` -- the DevAI-Hub baseline is read-only here (use `nexus skills sync` to rotate it).
- CLI updates in [bin/nexus.mjs](../../../../bin/nexus.mjs): `runSkillsInstall(args)` and `runSkillsRemove(args)` replace the v1.0.0 stubs and route through the compiled core module.
- Exit codes: 0 = success; 1 = blocked (allowlist / scanner / fetch failure); 2 = malformed invocation.
- Live HTTPS install end-to-end smoke deferred to Phase 15 (open item 8.3.P2.U).

### 8.4 -- `nexus.skills.preferUpstream` in slash-command autocomplete

- New function: `filterSlashCommandsWithSkills(input, skills, {preferUpstream})` in [desktop/src/modules/coding/slashCommands.ts](../../../../desktop/src/modules/coding/slashCommands.ts).
- Built-in catalog always renders first; skill entries follow.
- Same-named user / devai-hub pairs cluster together; the `preferUpstream` flag picks which namespace leads inside the pair.
- New optional `namespace` and `skillId` fields on `SlashCommand` carry the canonical id forward.
- New `nexus.skills.preferUpstream` settings entry in `package.json`, defaulting to `false` (local edits win).
- Daemon-side dispatcher consumption deferred under 8.4.P2.V (waits on `src/chat/` -> `modules/coding/chat/` migration in 1.4.P1.B).

### 8.5 -- `AgentLoop.setCurrentSkill` + `lifecycle.skill.entry`

- New method: `AgentLoop.setCurrentSkill(skill: SkillSpanContext | null)` in [src/tools/AgentLoop.ts](../../../../src/tools/AgentLoop.ts).
- Delegates to the existing `Tracer.setCurrentSkill`, which already folds `skill.{id, namespace, tag, contentHash}` into every `tool_call` / `sub_agent` span via `_mergeSkillContext`.
- Emits `lifecycle.skill.entry` on the HookBus when a non-null skill is supplied (no emit on clear -- the audit trail captures entry, not exit, since the trace already brackets the work).
- ChatController slash-command dispatch path in [src/panels/ChatController.ts](../../../../src/panels/ChatController.ts) wraps the skill body with `setCurrentSkill({id: "user/" + skill.name, namespace: "user"}) ... setCurrentSkill(null)` in `finally`.

### 8.6 -- Lint / build / test gate

- `npm run build`: clean.
- `npm test` (root vitest): 3235 passing / 5 skipped / 0 failing across 278 files.
- `cd desktop && npm test`: 395 passing / 0 failing across 45 files.
- `npm run lint`: clean.
- `npm run check-architecture`: 0 errors (6 pre-existing warnings unrelated to this phase).

---

## Tests added

- [tests/unit/core/skills/SkillsReloader.test.ts](../../../../tests/unit/core/skills/SkillsReloader.test.ts) -- 5 tests (debounce burst collapse, reloadNow immediate fire, stop idempotency, onReload tag, onError propagation).
- [tests/unit/core/skills/DevAIHubAutoSync.test.ts](../../../../tests/unit/core/skills/DevAIHubAutoSync.test.ts) -- 7 tests (constants, factory shape with defaults, factory overrides, fast-clock cadence, idle-threshold gate, defaultSyncRunner factory, scheduler register/unregister cycle).
- [tests/unit/core/skills/installAllowlist.test.ts](../../../../tests/unit/core/skills/installAllowlist.test.ts) -- 8 tests (every allowlist host, off-list reject, file:// gating, invalid URL, unsupported scheme, custom allowlist, case-insensitive).
- [tests/unit/core/skills/SkillInstaller.test.ts](../../../../tests/unit/core/skills/SkillInstaller.test.ts) -- 15 tests (parseSkillSpec edge cases, isPathInside + userSkillDir, namespace rejection, allowlist rejection, file:// install success, scanner block, exists guard + overwrite, fetch-failed propagation, removeSkill happy path + wrong-namespace + not-found).
- [tests/unit/tools/AgentLoop.setCurrentSkill.test.ts](../../../../tests/unit/tools/AgentLoop.setCurrentSkill.test.ts) -- 4 tests (emit on set, no emit on clear, span attribute fold during a real run with the in-memory TraceStore, silent path when HookBus / sessionId are absent).
- Extended [desktop/tests/slashCommands.test.ts](../../../../desktop/tests/slashCommands.test.ts) -- 6 new cases.
- Extended [desktop/tests/codingBootstrap.test.ts](../../../../desktop/tests/codingBootstrap.test.ts) -- 4 new cases.
- Extended [tests/unit/cli/nexus-cli.test.ts](../../../../tests/unit/cli/nexus-cli.test.ts) -- 3 new install/remove parseArgs cases.
- Extended [tests/unit/panels/ChatController.test.ts](../../../../tests/unit/panels/ChatController.test.ts) -- added `setCurrentSkill: vi.fn()` to the agentLoop mock factory.

Total: 45+ new test assertions across 4 new test files and 4 extended ones.

---

## Deviations from plan

1. **Plan referenced `modules/coding/chat/SlashCommandRouter.ts` (post-Phase-1.4 layout).** That file does not yet exist because the `src/chat/` -> `modules/coding/chat/` migration is one of the 12 sub-tree moves still tracked under 1.4.P1.B. Phase 8 ships the autocomplete-ordering surface in the existing `desktop/src/modules/coding/slashCommands.ts` (where the slash-command catalog already lives) and defers the daemon-side dispatcher consumption to 8.4.P2.V.

2. **Plan referenced `agentLoop.setCurrentSkill({id, namespace, provenance})` at the SlashCommandRouter entry.** There is no centralized SlashCommandRouter today; the dispatch happens in `ChatController.submitUserMessage`. The wrap-call lands there instead. When `src/chat/` migrates, the same pattern moves with it.

3. **Plan said the SkillLoader.reload() is invoked directly.** The current `SkillLoader` ([src/skills/SkillLoader.ts](../../../../src/skills/SkillLoader.ts)) does not expose a `reload()` method matching the SkillCatalog interface (it has `watch()` / `stopWatching()` instead). `SkillsReloader` consumes any `ReloadableCatalog { reload(): Promise<void> | void }` so the wiring can target the SkillCatalog-backed adapter once it lands (referenced as `MV` in the v1.0.0 known-gaps). The contract is unchanged from the plan's intent; the indirection avoids cementing today's `SkillLoader` API in place when the v1.0.0 `MV` carryforward has long flagged it for replacement.

---

## Next steps

- **8.1.P2.T**: When the SkillCatalog-backed adapter lands (v1.0.0 known-gaps `MV` cluster), pass `{skillCatalog: adapter}` to `bootstrapCoding()` from the sidecar daemon entry point and add the end-to-end integration test that runs `nexus skills sync --apply` against a fixture upstream.
- **8.3.P2.U**: In Phase 15 (RTM), add the live-HTTPS install integration test gated by an env-var so CI does not require network egress.
- **8.4.P2.V**: After `src/chat/` migrates under 1.4.P1.B, have the slash-command dispatcher consult `nexus.skills.preferUpstream` for collision resolution. Add a regression test pair against a fixture catalog with both namespaces populated.
- Phase 9 (opt-in memory consolidation) is the natural next phase per the cycle plan.
