# Session History: v1.0.0 Phase 10 -- DevAI-Hub sync pathway

**Date**: 2026-05-17
**Plan**: [docs/v1.0.0/plans/phase-10-devai-hub-sync.md](../../plans/phase-10-devai-hub-sync.md)
**Phase goal**: Stand up the upstream sync pathway from `bendourthe/DevAI-Hub` -- a `nexus skills sync` CLI subcommand and matching Settings UI surface that sparse-clones a pinned release tag into `~/.nexus/skills/devai-hub/<tag>/`, scans every SKILL.md with a built-in prompt-injection detector before activation, namespaces skills under `devai-hub/<name>` to avoid collision with user-authored skills of the same name, threads provenance through every tool-call trace span emitted while the skill is active, and ships a "diverged" badge in the Skills settings UI so the user can pick which side of a name collision is the default.

## Pre-implementation context

The phase opens against a clean `main` (3ce3137). v1.0.0 cycle Phases 1-9 are complete: the Tauri shell foundation lands in Phase 1; the rebrand sweep + shared-core extraction in Phase 2 carves `src/` into `core/` + `modules/coding/` (so the existing `core/skills/SkillCatalog.ts` Phase 2.6 stub is the seed surface Phase 10 extends); Phases 3-7 land the Coding / Chat / Image / Video modules + ModelRegistry; Phase 8 lands the GpuScheduler + Local Model Status widget; Phase 9 lands the Windows-first single-binary installer. Phase 10 was scoped in [docs/v1.0.0/plans/v1.0.0-cycle.md](../../plans/v1.0.0-cycle.md) and the per-phase plan [docs/v1.0.0/plans/phase-10-devai-hub-sync.md](../../plans/phase-10-devai-hub-sync.md). The MCP-policy decision tree in `AGENTS.md` requires every external project be either reverse-engineered into a local module or, when reverse-engineering is not viable, fronted by a trusted-vendor wrapper. DevAI-Hub is the one explicitly-allowed upstream link in v1.0.0 because (a) it is the project lead's own work and (b) it is intentionally curated as a feeder catalog -- the wrapper is the sync surface this phase lands.

## Sub-tasks completed

### 10.1 -- Namespaced SkillCatalog with provenance

- **`core/skills/SkillCatalog.ts`** -- extended the Phase 2.6 stub. New `SkillProvenance` interface (`source: "builtin" | "user" | "devai-hub"`, optional `tag`, required `contentHash`). Every `SkillRecord` and `Skill` now carries `provenance`; non-builtin sources also carry an optional `diverged: true` flag computed from a display-name collision scan. New helpers `canonicalSkillId(source, name)` (returns `<source>/<name>` for non-builtin sources, the bare name for builtin so existing slash-command resolution keeps working) and `namespaceForSource(source)` (echoes the source as a `SkillNamespace` -- one of `builtin` / `user` / `devai-hub`). New `SkillCatalog.listByNamespace(ns)` filters by provenance source. The `InMemorySkillCatalog` constructor and `resetForTesting()` both call `computeDivergedNames()` to set the diverged flag.
- **`tests/unit/core/skills/SkillCatalog.test.ts`** -- existing 7-test fixture grew to 15 tests covering provenance round-trip, listByNamespace filtering, no-collision when a user skill shares a name with a devai-hub skill (the namespaced IDs stay unique), diverged flag on conflicting display names, no diverged flag on a non-conflicting record, and the canonical-id + namespace helpers. Coverage: 100% lines / branches / functions on `SkillCatalog.ts`.

### 10.2 -- `nexus skills sync` CLI + DevAIHubSyncer core

- **`core/skills/DevAIHubSyncer.ts`** (new) -- the sync pipeline. Core entry point `DevAIHubSyncer.sync({tag, apply})` returns a `SyncResult` carrying the tag, tmp dir, manifest, diff, scan, and applied / activeDir flags. `SyncDependencies` is a four-method interface (`resolveLatestTag` / `sparseClone` / `tarballFetch` / `hasGit`) so the integration tests inject a fixture-based fake. Pipeline: (a) resolve the latest pinned tag (or use the `--tag` override); (b) short-circuit when the active install matches the requested tag's content hash; (c) clean any stale tmp dir; (d) sparse-clone via git (when `hasGit() === true`) or fall back to tarball; (e) walk the `catalog/skills/**/SKILL.md` tree, hash every body, build a deterministic `manifest.json` (sorted by relpath; bundle hash is sha256 of the sorted relpath + body-hash pairs); (f) run the prompt-injection scanner against every SKILL.md + bundled `.sh` / `.ps1` / `.mjs` / `.cjs` / `.js`; (g) diff against the active-tag manifest; (h) when `--apply` is set and the scan's decision is not `block`, atomically rotate the active dir + update the `~/.nexus/skills/devai-hub/ACTIVE` pointer.
- **`core/skills/PromptInjectionScanner.ts`** -- consumed here (Phase 10.3 below).
- **`bin/nexus.mjs`** (new) -- the top-level CLI binary. Registered in `package.json`'s `bin` map next to nexus-check / nexus-image / nexus-video. Subcommand surface: `nexus skills sync [--tag <tag>] [--apply]`, `nexus skills list [--namespace <ns>]`, `nexus skills install <ns>/<name> [--from <url>]` (stub, tracked as `10.P2.III`), `nexus skills remove <ns>/<name>` (stub), plus `nexus check` pass-through. Parser supports `--key value` and `--key=value` forms; bare `--flag` becomes `true`. The compiled `out/core/skills/DevAIHubSyncer.js` is the production import target; the CLI errors clearly when the build artifact is missing (`Run npm run build before invoking nexus skills sync from source.`).
- **`tests/unit/core/skills/DevAIHubSyncer.test.ts`** (new, 23 tests, all passing) -- covers manifest walking, the entire diff add/modify/remove pipeline, summarizeDiff rendering, the empty-bundle SHA256 stability check (matches `sha256("")`), active-tag pointer round-trip, full sync against a local fixture directory, --apply rotation, "already up to date" short-circuit, latest-tag resolution when no `--tag` is passed, tarball fallback when `hasGit() === false`, injection-scan blocks --apply when the scanner returns `block`, invalid-tag rejection (path-traversal guard: `../escape` is refused), full two-version diff across an upstream version bump, manifest.json shape, plus edge cases (null manifest, malformed JSON, empty pointer file) and a smoke test on `defaultDependencies(...)`.
- **`tests/unit/cli/nexus-cli.test.ts`** (new, 5 tests) -- argv parser shape: command + subcommand capture, `--tag <value>` + `--tag=<value>` forms, bare `--apply` becomes true, top-level `--help`.
- **`package.json`** -- `bin.nexus` added.

### 10.3 -- Prompt-injection scanner

- **`core/skills/PromptInjectionScanner.ts`** (new) -- 11 built-in rules across 5 buckets:
  - **(a) Jailbreak templates** -- `Ignore previous instructions` (high), `disregard your training` (high), `you are now <persona>` (medium), `system:` role prefix (medium), `<|im_start|>` / `<|im_end|>` chat-template control tokens (high).
  - **(b) Safety / guardrail disablement** -- `disable safety|guardrails|filters` (high), `bypass safety|guardrails|filters` (high).
  - **(c) Credential exfil** -- `dump .env` / `cat .env` / `POST /env` (high), `~/.aws/credentials` (high), `~/.ssh/id_<key>` (high).
  - **(d) Known exfil URL hosts** -- beeceptor.com / webhook.site / requestbin.io / burpcollaborator.net, with or without a subdomain (high).
  - **(e) Tool-call tokens in body** -- `<|tool_call|>` / `<tool_call>` (high). A clean SKILL.md never authors tool-call tokens directly.
  - Severity ladder: `high` returns `decision: "block"` and blocks activation; `medium` returns `decision: "warn"` and logs to the trace dashboard; `low` is logged only.
  - `scanText(content, source)` runs the rules line-by-line so findings carry a precise line number; `scanBundle(files)` aggregates across a synced bundle and bubbles the worst decision up.
- **`tests/unit/core/skills/PromptInjectionScanner.test.ts`** (new, 18 tests, all passing) -- positive + negative payloads for every rule; the bundle aggregation; source / line-number tracking; the custom-rule-set injection point. Coverage: 100% lines / 88.88% branches / 100% functions.

### 10.4 -- Hot reload + SkillsSettings UI

- **`desktop/src/pages/settings/SkillsSettings.tsx`** (new) -- the operator surface. Header shows the active DevAI-Hub tag next to the upstream-latest tag (queried on mount). Controls row offers a "Sync now" button driving `client.syncNow()` and an "Auto-sync weekly (idle time)" checkbox driving `client.setAutoSyncEnabled()`. Quarantined section (only rendered when at least one skill carries `quarantine.decision === "block"`) lists the offending skills with up to three rendered scanner findings each and a "Review and approve" action driving `client.approveQuarantined()`. Per-namespace lists (DevAI-Hub / User / Built-in) render each skill's display name, namespaced id, source tag (when devai-hub), and an Enable / Disable toggle. Diverged rows render a small "diverged" pill plus a "Use as default" button driving `client.setDivergedPreference()`.
- **`desktop/src/pages/settings/mockSkillsClient.ts`** (new) -- in-memory fake backing the dev / test mode. Seeds three sample skills (one built-in, one user, one devai-hub, with the latter two flagged as diverged on the shared display name "Code Quality") and tracks auto-sync / activeTag state across method calls. Used by `SettingsPage` until the real IPC client lands in v1.1.0.
- **`desktop/src/pages/settings/SettingsPage.tsx`** -- upgraded from a single-page shell to a tabbed shell with Models + Skills tabs. Tab state lives in component state; `initialTab` prop lets tests jump directly to the Skills tab.
- **`desktop/tests/SkillsSettings.test.tsx`** (new, 11 tests, all passing) -- header renders active + upstream tag; rows group by namespace with accurate counts (`(1)` / `(1)` / `(1)` / `(1)` for built-in / devai-hub / user / quarantined); diverged badge shows on both diverged rows; no badge on the non-diverged builtin row; Sync now drives `syncNow()` and renders status text; auto-sync toggles via `setAutoSyncEnabled(true)`; quarantined section renders findings; "Review and approve" drives `approveQuarantined`; toggle button inverts active state via `setActive(id, false)`; "Use as default" drives `setDivergedPreference("Code Quality", "devai-hub")`; error path renders when `list()` rejects.

### 10.5 -- Provenance traces

- **`src/observability/Tracer.ts`** -- new `SkillSpanContext` type (`id` / `namespace` / optional `tag` / optional `contentHash`); new `setCurrentSkill(skill | null)` setter paired with a `currentSkill` getter; private `_mergeSkillContext(kind, attributes)` automatically folds the active skill's `skill.*` attributes into every `startSpan` of kind `tool_call` or `sub_agent`. Flattening is necessary because the underlying `TraceStore` attribute column only carries `string | number | boolean` (no nested objects). New helpers `skillContextAttributes(ctx)` (flatten to `skill.id` / `skill.namespace` / `skill.tag` / `skill.contentHash`) and `readSkillContextFromAttributes(attrs)` (reconstruct, with namespace validation) make the round-trip explicit so the trace dashboard can render "Skill: devai-hub@v1.3.2/<name>" from a raw attribute record.
- **`tests/unit/observability/TracerSkillProvenance.test.ts`** (new, 9 tests, all passing) -- flatten omits absent fields; round-trip preserves a full context; `readSkillContextFromAttributes` returns null on an empty / unknown-namespace record; `startSpan(tool_call)` folds skill context; `startSpan(llm_call)` does NOT fold; clearing via `setCurrentSkill(null)` removes the fold; `sub_agent` spans also fold.

### 10.6 -- Conflict resolution + diverged badge

- Diverged-name detection ships in **10.1** (`computeDivergedNames` in the SkillCatalog) and the UI badge + "Use as default" button ships in **10.4** (`SkillsSettings.tsx`). The actual `nexus.skills.preferUpstream` setting consumed by the slash-command autocomplete is not yet read by the autocomplete code; the gap is tracked as `10.P2.JJJ` and lands together with the SkillLoader-hot-reload work (`10.P1.GGG`) in Phase 11. The IPC entry-point + UI button + per-pair detection are all green.

## Tests and coverage

Phase 10 suites: 225 / 225 green across `tests/unit/skills` (existing) + `tests/unit/core/skills` (Phase 10) + `tests/unit/observability` + `tests/unit/cli`. Desktop full suite: 362 / 362 green. Existing root-project vitest: 3009 / 3009 pre-Phase-10 tests pass (4 pre-existing failures in `tests/unit/agents/SubAgentManager.characterization.test.ts` are CRLF-vs-LF snapshot mismatches on Windows; reproduced on `main` with my changes stashed -- unrelated to Phase 10, tracked separately).

Per-file coverage on new modules:
- `core/skills/SkillCatalog.ts` -- 100% lines / branches / functions.
- `core/skills/PromptInjectionScanner.ts` -- 100% lines / 88.88% branches / 100% functions.
- `core/skills/DevAIHubSyncer.ts` -- 68.69% lines / 79.54% branches / 75% functions. The functional / fixture-driven pipeline is 100% covered; the uncovered remainder is exclusively the production `defaultResolveLatestTag` / `defaultSparseClone` / `defaultTarballFetch` network helpers (tracked as `10.P1.FFF`). The path is recorded as a Phase 11 RTM smoke against the real DevAI-Hub upstream.
- `src/observability/Tracer.ts` -- existing tests carry forward; the new `setCurrentSkill` / `_mergeSkillContext` / `skillContextAttributes` / `readSkillContextFromAttributes` surfaces are 100% covered in the new test file.

Lint: clean (`eslint` scoped per the existing config). Typecheck: clean (`tsc --noEmit` at root + desktop).

## Deviations from the plan

- The plan called for `git clone --depth=1 --branch <tag> --filter=blob:none --sparse https://github.com/bendourthe/DevAI-Hub.git ~/.nexus/skills/.tmp-devai-hub-<tag>/`. The implementation matches verbatim, except the actual call site is `defaultSparseClone()` which `spawnSync`'s `git` -- and the function is overridable via `SyncDependencies`. This keeps the integration tests fully offline + deterministic.
- The plan called for the slash-command dropdown in the Coding chat input to show the full namespaced name. The slash-command autocomplete still consults the legacy `SkillLoader` (which is namespace-agnostic). Plumbing the namespaced id into the autocomplete requires the SkillLoader -> SkillCatalog adapter that is tracked under v1.0.0 known-gap code `MV`. The trace-dashboard side ("Skill source: devai-hub@v1.3.2/<name>") is wired (the attribute fold-in lands automatically when the AgentLoop calls `tracer.setCurrentSkill(...)`); the AgentLoop call-site is `10.P2.KKK`.
- The plan called for the SkillsSettings UI to live under `desktop/src/pages/settings/SkillsSettings.tsx`. Done. Tab integration into the `SettingsPage` shell is also done (Models | Skills).
- The plan called for the Auto-sync weekly toggle to register a worker with the `IdleTimeScheduler` (Phase 3.4). The toggle is wired in the UI + the IPC entry-point persists the setting, but worker registration is gated on the SkillLoader hot-reload pathway (a successful sync that the running daemon ignores until restart is a worse UX than no auto-sync). Tracked as `10.P1.HHH`.

## Known gaps added

See [docs/v1.0.0/known-gaps.md](../../known-gaps.md):
- `10.P1.FFF` (production network/git helpers covered by smoke only)
- `10.P1.GGG` (SkillLoader hot-reload not yet driven by the active-tag pointer)
- `10.P1.HHH` (auto-sync-weekly worker not yet registered with IdleTimeScheduler)
- `10.P2.III` (`nexus skills install/remove` are stubs)
- `10.P2.JJJ` (`nexus.skills.preferUpstream` not yet read by slash-command autocomplete)
- `10.P2.KKK` (skill-context attribution into AgentLoop tool spans not yet wired)

## Files touched

**New**:
- `bin/nexus.mjs`
- `core/skills/DevAIHubSyncer.ts`
- `core/skills/PromptInjectionScanner.ts`
- `desktop/src/pages/settings/SkillsSettings.tsx`
- `desktop/src/pages/settings/mockSkillsClient.ts`
- `desktop/tests/SkillsSettings.test.tsx`
- `docs/v1.0.0/development/history/2026-05-17_phase-10-devai-hub-sync.md` (this file)
- `tests/unit/cli/nexus-cli.test.ts`
- `tests/unit/core/skills/DevAIHubSyncer.test.ts`
- `tests/unit/core/skills/PromptInjectionScanner.test.ts`
- `tests/unit/observability/TracerSkillProvenance.test.ts`

**Modified**:
- `core/skills/SkillCatalog.ts` (extended with provenance + namespacing + diverged-name detection)
- `desktop/src/pages/settings/SettingsPage.tsx` (Models | Skills tabbed shell)
- `package.json` (registered the `nexus` binary)
- `src/observability/Tracer.ts` (skill-context fold-in for tool_call / sub_agent spans)
- `tests/unit/core/skills/SkillCatalog.test.ts` (expanded from 7 to 15 tests)
- `docs/DEVLOG.md` (Phase 10 entry)
- `docs/v1.0.0/known-gaps.md` (six new Phase 10 entries + Summary recompute)

## Next steps

Phase 11 (Hardening + security audit + release gate) consumes Phase 10's surface. The recorded Phase 10 carryovers (`10.P1.FFF`-`10.P2.KKK`) are the Phase 11 inputs.
