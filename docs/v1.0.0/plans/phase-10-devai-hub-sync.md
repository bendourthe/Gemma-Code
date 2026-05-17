# Phase 10 - DevAI-Hub sync pathway

**Goal**: `nexus skills sync` CLI + in-app subcommand; sparse git clone of pinned `bendourthe/DevAI-Hub` tags into `~/.nexus/skills/devai-hub/<tag>/`; `devai-hub/<name>` namespace; prompt-injection scanner on activation; provenance traces; manual-default-with-weekly-opt-in.
**Prerequisites**: Phase 2 (core SkillCatalog), Phase 9 (installer carries baseline).
**Stability Gate**: User runs `nexus skills sync`, the latest DevAI-Hub tag is pulled, a manifest diff is presented, skills land under `devai-hub/<name>`, hot-reload picks them up, the trace dashboard shows provenance, and a synthetic prompt-injection payload is rejected.

---

## Sub-tasks

### 10.1 - Namespaced SkillCatalog with provenance

**Objective**: Extend the Phase 2.6 `SkillCatalog` so every skill record carries a `provenance: {source: "builtin" | "user" | "devai-hub", tag?: string, sha?: string}` and is addressable by `namespace/name`.

**Prompt**:
> Extend `core/skills/SkillCatalog.ts`. Every `SkillRecord` gains a `provenance: SkillProvenance` field where `SkillProvenance = {source: "builtin" | "user" | "devai-hub", tag?: string, contentHash: string}`. `SkillCatalog.list()` returns skills with their provenance. Add `SkillCatalog.listByNamespace(ns)` for `devai-hub`. Skill IDs become `<namespace>/<name>` for non-builtin sources so `devai-hub/code-quality` does not collide with a user's local `code-quality`. The slash-command dropdown in the Coding chat input shows the full namespaced name. The trace dashboard's tool-call card includes a "Skill source: devai-hub@v1.3.2/<name>" line. Acceptance: unit tests cover provenance round-trip; a synthetic catalog with three sources (builtin + user + devai-hub) lists correctly and avoids collisions; trace dashboard renders provenance.

---

### 10.2 - `nexus skills sync` CLI subcommand

**Objective**: Implement the `nexus skills sync` CLI: sparse git clone of a pinned tag, manifest diff, namespace install.

**Prompt**:
> Add a top-level CLI binary `nexus` at `bin/nexus.mjs` (and the sibling `nexus-check.mjs` from Phase 2.4). The CLI subcommand surface: `nexus skills sync [--tag <tag>] [--apply]`, `nexus skills list [--namespace <ns>]`, `nexus skills install <namespace>/<name> [--from <url>]`, `nexus skills remove <namespace>/<name>`, `nexus models install <id>`, `nexus models list`, `nexus models remove <id>`, `nexus models gc`, `nexus image extract-workflow <file>`, `nexus video extract-workflow <file>`. For `nexus skills sync`: (a) resolve the latest pinned tag from `https://api.github.com/repos/bendourthe/DevAI-Hub/releases/latest` (or use `--tag <tag>` override); (b) if `~/.nexus/skills/devai-hub/<tag>/` already exists with a matching content hash, exit "already up to date"; (c) otherwise run `git clone --depth=1 --branch <tag> --filter=blob:none --sparse https://github.com/bendourthe/DevAI-Hub.git ~/.nexus/skills/.tmp-devai-hub-<tag>/` then `git sparse-checkout set catalog/skills catalog/commands catalog/agents rules data/skills.json extensions/`; (d) compute a content hash over the checkout; (e) write a manifest at `~/.nexus/skills/devai-hub/<tag>/manifest.json`; (f) diff against the currently-active tag and present a summary (`+12 new skills, ~3 modified, -1 removed`); (g) if `--apply` is passed, rename the tmp dir to the active dir and update the active-tag pointer; otherwise leave the tmp dir for review. Tarball fallback: if git is unavailable, download `https://github.com/bendourthe/DevAI-Hub/archive/refs/tags/<tag>.tar.gz` and extract. Acceptance: integration test against a local git fixture verifies clone + diff + apply; offline test verifies the tarball fallback.

---

### 10.3 - Prompt-injection scanner on activation

**Objective**: Before a synced skill is activated, scan its SKILL.md (and any bundled scripts) for prompt-injection patterns.

**Prompt**:
> In `core/skills/PromptInjectionScanner.ts` implement a pattern-based scanner. Patterns: (a) common jailbreak templates (`ignore previous instructions`, `disregard your training`, `you are now`, `system:`, `<|im_start|>`); (b) instructions to disable safety mechanisms (`disable safety`, `bypass guardrails`); (c) credential-exfil patterns (`POST /env`, `dump .env`, references to `.aws/`, `.ssh/`, etc.); (d) URL exfil targets matching `http(s)://.*\.(beeceptor|webhook\.site|requestbin\.io|burpcollaborator)`; (e) `<|tool_call>` tags in unexpected positions (skill should not be authoring tool calls directly in the SKILL.md body). Scan every SKILL.md, hook body, and bundled script inside the synced bundle before activation. Findings are categorized `high` / `medium` / `low`. `high` findings block activation (skill is quarantined with a UI prompt to review); `medium` and `low` log warnings + ship to the trace dashboard. The scanner runs on every sync, on every manual install, and on every reload. Acceptance: unit tests cover each pattern; a synthetic SKILL.md with a `Ignore previous instructions` line is rejected; a clean SKILL.md passes.

---

### 10.4 - Hot reload + UI surface

**Objective**: After `--apply`, the running app hot-reloads the new bundle; surface a "Skills" page in Settings showing the active tag, sync status, and a sync button.

**Prompt**:
> After `nexus skills sync --apply` writes the new active tag, the daemon's `SkillLoader.reload()` picks up the new content (existing hot-reload mechanism from v0.8.0). Settings page at `desktop/src/pages/settings/SkillsSettings.tsx` shows: the active DevAI-Hub tag (e.g. `v1.3.2`), the upstream-latest tag (queried in background on app launch via GitHub API), a "Sync now" button that triggers `nexus skills sync --apply` via IPC, an "Auto-sync weekly" toggle (default OFF) that schedules an idle-time sync via `IdleTimeScheduler` (registered as a `Worker` in Phase 3.4), and a per-skill list grouped by namespace with enable / disable toggles. Quarantined skills (per the injection scanner) appear in a separate "Quarantined" section with a "Review and approve" action that re-runs the scanner with the user's manual override. Acceptance: UI test runs a sync against a fixture upstream, asserts the active-tag display updates; toggling auto-sync registers the worker; quarantined skills appear correctly.

---

### 10.5 - Provenance traces

**Objective**: Every tool call originating from a DevAI-Hub-sourced skill emits a trace event tagged with the skill's provenance.

**Prompt**:
> Extend the existing `core/observability/Tracer.ts` so when a tool call originates from a skill, the trace record includes `skill: {id, namespace, provenance: {source, tag, contentHash}}`. The trace dashboard's tool-call detail view renders "Skill: devai-hub@v1.3.2/<name>". The `/trace dump` JSON output includes provenance so a bug-report shared by a user names exactly which DevAI-Hub tag produced the trace. Acceptance: integration test invokes a skill from a DevAI-Hub fixture, asserts the trace event carries provenance; `/trace dump` JSON contains the provenance.

---

### 10.6 - Conflict resolution + diverged badge

**Objective**: When the same skill name exists both in the user's local catalog and in DevAI-Hub, render a "diverged" badge and let the user choose.

**Prompt**:
> A user can author a local skill at `~/.nexus/skills/user/<name>/SKILL.md`. If a DevAI-Hub sync introduces a skill with the same `<name>` (note: namespaces avoid collision in the catalog, but the *displayed name* can match), the SkillCatalog flags the pair as "diverged". The skill browser renders a small "diverged" badge next to the upstream version with a tooltip explaining the conflict. A setting `nexus.skills.preferUpstream` (default `false`) decides which one is suggested as the default in slash-command autocomplete. The user can switch either way via a dropdown in the Settings UI. Acceptance: unit test seeds a catalog with two same-named skills from different sources, asserts diverged detection; UI test renders the badge.

---

### 10.7 - Testing and Stabilization

**Objective**: Generate and run all tests for Phase 10. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 10. Include: unit tests for namespaced SkillCatalog + provenance; integration tests for `nexus skills sync` against a local git fixture (cover clone / sparse-checkout / diff / apply / tarball fallback); unit tests for PromptInjectionScanner (every pattern + clean baseline); integration test for end-to-end sync -> reload -> skill becomes available; unit tests for conflict + diverged detection; UI tests for SkillsSettings; verify provenance flows into traces; coverage gate at lines >= 80, functions >= 80. Run the test suite, fix all failures, iterate. After all tests pass, run `/generate-session-history` to document Phase 10.

---

### Phase 10 Exit Checklist

- [ ] All sub-tasks completed
- [ ] `nexus skills sync` works end-to-end (clone, diff, apply, tarball-fallback)
- [ ] PromptInjectionScanner blocks `high`-severity payloads
- [ ] Hot reload picks up new bundle after sync
- [ ] Settings UI shows active tag + sync button + auto-sync toggle
- [ ] Provenance traces appear in trace dashboard
- [ ] Diverged-skill resolution works
- [ ] Coverage gate green
- [ ] Session history generated for Phase 10
- [ ] Ready to advance to Phase 11
