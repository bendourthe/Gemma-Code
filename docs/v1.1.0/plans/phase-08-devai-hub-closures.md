# Phase 8 -- DevAI-Hub closures + Skill hot-reload + AgentLoop provenance

**Goal**: Close the remaining v1.0.0 DevAI-Hub items: hot-reload on `ACTIVE` pointer change, weekly auto-sync worker, `install`/`remove` CLI with allowlist + scanner, slash-command autocomplete reads `preferUpstream`, AgentLoop attaches skill context to tool spans.
**Prerequisites**: Phase 1 (shared core for SkillLoader adapter), Phase 4 (HookBus for skill-entry hooks).
**Stability Gate**: A successful `nexus skills sync --apply` triggers an automatic `SkillLoader.reload()` (verified via fs.watch fixture); the weekly auto-sync worker fires on a 7-day cadence (verified via fast-clock fixture); `nexus skills install user/<name> --from https://github.com/<owner>/<repo>` accepts only allowlist hosts, runs `PromptInjectionScanner`, clamps under `~/.nexus/skills/user/`; slash-command autocomplete respects `nexus.skills.preferUpstream`; trace spans for tool calls inside a skill body carry `skill.{id, namespace, provenance}` attributes.

**Closes**: 10.P1.GGG, 10.P1.HHH, 10.P2.III, 10.P2.JJJ, 10.P2.KKK from `docs/v1.0.0/known-gaps.md`.

---

## Sub-tasks

### 8.1 -- `fs.watch` on `ACTIVE` pointer drives `SkillLoader.reload()`

**Objective**: When `nexus skills sync --apply` writes the `ACTIVE` pointer, the sidecar's `SkillLoader` reloads automatically.

**Prompt**:
> In [desktop/sidecar/src/runtime/codingBootstrap.ts](../../../desktop/sidecar/src/runtime/codingBootstrap.ts), add `fs.watch(activeTagPointerPath(nexusHome(), "devai-hub"), {persistent: false}, () => skillLoader.reload())` -- guarded with debounce (200 ms) so a rotation pattern (write tmp, rename to ACTIVE) only fires one reload. The desktop-frontend SkillsSettings UI's "Sync now" button feedback updates from "Restart required" to "Loaded N new skills" once the reload completes. Add a fixture test that simulates the write + rename pattern and asserts `reload()` fires once. Acceptance: from a sidecar logger, a `nexus skills sync --apply` invocation triggers one reload within 500 ms.

---

### 8.2 -- `IdleTimeScheduler` weekly auto-sync worker

**Objective**: Register the `devai-hub-sync` worker with a 7-day cadence.

**Prompt**:
> In `core/skills/DevAIHubSyncer.ts`, expose a `syncWorker` factory that returns an `IdleTimeScheduler.Worker` whose body is `new DevAIHubSyncer().sync({ apply: true })`. Register it in `codingBootstrap.ts` when `SettingsStore.get("nexus.skills.autoSync.devai-hub") === true`. Cadence: 7 days; idle threshold: 5 minutes. A fast-clock fixture test advances the clock 7 days and asserts the worker fires. Acceptance: the SkillsSettings UI's "Auto-sync weekly" toggle drives the registration; toggling it off de-registers; toggling it on re-registers.

---

### 8.3 -- `nexus skills install/remove` with allowlist + scanner

**Objective**: Replace the stub install/remove subcommands with real implementations.

**Prompt**:
> In [bin/nexus.mjs](../../../bin/nexus.mjs) `skills install <ns>/<name> [--from <url>]`: (a) reject any `url` whose host is not in the documented allowlist (`github.com`, `gitlab.com`, `raw.githubusercontent.com`, `bendourthe.com` -- list maintained at `core/skills/installAllowlist.ts`); (b) fetch with timeout 30 s + 10 s connect; (c) run the fetched content through `PromptInjectionScanner` -- on any rule hit, refuse + log to the audit trail; (d) write to `~/.nexus/skills/user/<ns>/<name>/SKILL.md` only (path-clamped). `skills remove <ns>/<name>`: refuses to remove a skill outside `~/.nexus/skills/user/` (the DevAI-Hub baseline is read-only via this CLI). Acceptance: end-to-end test installs a tiny fixture skill from a `file://` URL (allowlisted in test mode), confirms the scanner runs, confirms the file lands in the right place.

---

### 8.4 -- `nexus.skills.preferUpstream` in slash-command autocomplete

**Objective**: The autocomplete proposes the upstream variant when `preferUpstream=true`.

**Prompt**:
> Modify the slash-command autocomplete in [modules/coding/chat/SlashCommandRouter.ts](../../../src/chat/) (post-Phase-1.4 layout) to consult `SettingsStore.get("nexus.skills.preferUpstream")`. When two skills share a name in different namespaces (user / devai-hub), the autocomplete shows the preferred one first. Acceptance: a unit test with two same-named skills asserts the autocomplete order under each setting value.

---

### 8.5 -- `AgentLoop.setCurrentSkill(...)` at slash-command entry

**Objective**: Tracer spans inside a skill body carry skill provenance.

**Prompt**:
> When the SlashCommandRouter dispatches into a skill's body, it calls `agentLoop.setCurrentSkill({id, namespace, provenance})` before yielding control. On exit, it clears. Inside [modules/coding/observability/Tracer.ts](../../../src/observability/), the existing `setCurrentSkill` already folds `skill.*` attributes into every `tool_call` / `sub_agent` span -- nothing changes there. Also emit a `lifecycle.skill.entry` event on the HookBus (Phase 4.2). Acceptance: an integration test runs a slash-command-triggered skill, captures the trace, and asserts every tool_call span has `skill.id`, `skill.namespace`, `skill.provenance`.

---

### 8.6 -- Phase 8 lint, build, test gate

**Objective**: Verify the DevAI-Hub closures are CI-green.

**Prompt**:
> Re-run the four-step gate. Acceptance: 0 failures.
