# Plan: Nexus-Hub Consumption Re-architecture (single-home catalog, phase 1)

**Version:** v1.10.0 (proposed; confirm the bump at kickoff)
**Release branch:** `main`
**Active branch (proposed):** `feat/v1.10.0-nexus-hub-consumption`
**Status:** DRAFT - awaiting approval
**Filed:** 2026-07-09
**Scope class:** refactor + feature (re-architecture of how Nexus-AI consumes the Nexus-Hub catalog)

---

## 0. Goal and Definition of Done

### Goal

Make Nexus-AI consume the **latest** Nexus-Hub catalog from a single, standardized, **isolated** on-disk subtree - `~/.nexus-ai/catalog/` - the same way Claude Code reads `~/.claude/`, instead of the current version-scoped `~/.nexus/skills/devai-hub/<tag>/` path plus a broken bundled-baseline payload. Fetch happens at first launch (fail-soft when offline), refreshes are surfaced in-app via update detection, the `DevAIHubSyncer` becomes `NexusHubSyncer`, the syncer's destructive refresh is structurally scoped to the catalog subtree so it can never touch app data, the redundant bundled-baseline path is removed, `DevAI`/`devai` naming is scrubbed, and the docs tree is canonicalized to Nexus-Hub's layout.

This is **phase 1 of a two-plan consolidation**. It settles the **catalog path** so it never moves again. App-data home consolidation (`~/.nexus/*` -> `~/.nexus-ai/*`) is a **separate, tested follow-up plan** (see Non-goals).

### Target on-disk layout (end state of this plan)

```
~/.nexus-ai/
  catalog/                      <- NexusHubSyncer owns this subtree ONLY
    skills/                     (from Nexus-Hub catalog/skills)
    commands/                   (from Nexus-Hub catalog/commands)
    agents/                     (from Nexus-Hub catalog/agents)
    rules/                      (from Nexus-Hub catalog/rules)
    hooks/                      (from Nexus-Hub catalog/hooks)
    mcp-configs/                (from Nexus-Hub catalog/mcp-configs)
    templates/                  (from Nexus-Hub catalog/templates)
    NEXUS_AI.md                 (instruction file; coordinated with Nexus-Hub)
    nexus-hub-version.json      (version manifest; written by NexusHubSyncer)
~/.nexus/                       <- app data UNCHANGED this plan (settings.json, mcp.json,
                                   models/, session-artifacts/, credentials vault, skills/user, skills/proposed)
```

Subdir names are resolved from the `layout` map in `nexus-hub-version.json`, never hardcoded.

### `nexus-hub-version.json` contract (deterministic; no timestamps, no absolute paths)

```json
{
  "product": "Nexus-Hub",
  "version": "<installed catalog version>",
  "source_repo": "bendourthe/Nexus-Hub",
  "releases_url": "https://github.com/bendourthe/Nexus-Hub/releases",
  "latest_release_api": "https://api.github.com/repos/bendourthe/Nexus-Hub/releases/latest",
  "layout": { "skills": "skills", "commands": "commands", "agents": "agents", "rules": "rules", "hooks": "hooks", "mcp_configs": "mcp-configs", "templates": "templates", "instructions": "NEXUS_AI.md" }
}
```

`version` is taken from the fetched GitHub release tag, falling back to the fetched `.claude-plugin/plugin.json` `version`.

### Definition of Done (observable)

1. **Fresh fetch populates the isolated subtree.** A first launch (online) writes `~/.nexus-ai/catalog/{skills,commands,agents,rules,hooks,mcp-configs,templates}/` + `NEXUS_AI.md` + a deterministic `nexus-hub-version.json`. Offline first launch skips fail-soft and the app shows a clear "catalog not yet synced" state.
2. **Readers resolve via the layout map.** The extension and desktop load skills/commands/agents/rules/hooks/mcp-configs from `~/.nexus-ai/catalog/<layout[key]>/`, with subdir names read from `nexus-hub-version.json` `layout` (no hardcoded subdir strings, no `catalog/`-prefix string joins, no ACTIVE-pointer/tag indirection).
3. **Destructive refresh is subtree-scoped.** `NexusHubSyncer`'s wipe/refetch operates only under `~/.nexus-ai/catalog/`. A test proves it cannot write outside that subtree and cannot touch `~/.nexus/` or app data.
4. **One-shot migration is safe.** On first run, if `~/.nexus/skills/devai-hub/` exists, the catalog is freshly fetched into `~/.nexus-ai/catalog/`, then ONLY `~/.nexus/skills/devai-hub/` (and `~/.nexus/skills/` if it becomes empty) is removed; the removal is guarded (never an empty or root path), one-way, and idempotent. Nothing else in `~/.nexus/` is touched.
5. **In-app update detection works.** The app reads the installed `version` from `nexus-hub-version.json`, polls `latest_release_api`, and when the latest release is newer surfaces an "update available" prompt whose action re-runs `NexusHubSyncer` and refreshes the catalog live.
6. **Redundancy removed.** No bundled copy of the Nexus-Hub catalog exists in the repo; the broken baseline payload path (`devai-hub-baseline.json`, `fetch-payload.py` `devai_hub`, `devai_hub_provisioner.py`, the `provisioner_dispatch` `devai-hub` entry, the `versions.lock.json` pin) is deleted along with its tests and workflow references.
7. **Naming scrubbed.** No `DevAI`/`devai` identifiers remain in the repo except (a) the one-shot migration code that must name the old `~/.nexus/skills/devai-hub/` path to find and remove it, and (b) dated historical `renamed from` notes in docs/changelog. `tsc`/lint/tests all green.
8. **Docs canonicalized.** `docs/versions/v1/v1.x.y/` -> `docs/v1/v1.x/` (MINOR-granular, `versions/` wrapper dropped), release-prefixed plan/comparison filenames, per-minor `known-gaps.md`, `docs/adr/` remapped toward `docs/specs/` + `docs/policy/`, and every inbound reference repaired (README, CHANGELOG, AGENTS, ARCHITECTURE, CONTRIBUTING, SECURITY, `.gitignore`, `nexus.security.toml`, `.github/workflows`, `docs/todos.md`, in-tree plans/known-gaps, `tests/**` fixtures), with a `docs-cleanup-report.md` audit trail.

---

## Scope and Non-goals

**In scope (this plan):** the catalog path re-architecture, rename, reader reroute, subtree-scoping safety, first-launch + auto-sync wiring, in-app update detection, installer redundancy removal, `DevAI`/`devai` scrub, docs canonicalization.

**Explicit Non-goals (deferred to a separate, tested follow-up plan):**
- Migrating app data (`~/.nexus/settings.json`, `~/.nexus/mcp.json`, `~/.nexus/models/`, `~/.nexus/session-artifacts/`, credentials vault, `~/.nexus/skills/user|proposed`) into `~/.nexus-ai/`. This touches `core/storage/paths.ts` `nexusHome()`, the model/weights root, the session store, the credentials vault, and installer paths - it is data-loss-sensitive and MUST NOT ride in this refactor. It requires copy -> verify -> remove with a backout path and its own tests.
- Retiring `~/.nexus/` as the app home. Not done here; `~/.nexus/` remains the app-data home after this plan.
- Retiring the 17 first-party built-in extension skills at `modules/coding/skills/catalog/` (kept as the offline fallback, per decision).
- Running Nexus-Hub's own multi-assistant installer (`install.sh`/`install.ps1`) to reconfigure Claude Code/Codex/Cursor - out of scope.

---

## Cross-repo coordination and key risks

- **[COORD-1] Nexus-Hub must write under `catalog/` too.** The Nexus-Hub "nexus-ai" installer integration and its `nexus-hub-version.json` `layout` map must place content under `~/.nexus-ai/catalog/` so both populators (Nexus-Hub's installer and Nexus-AI's `NexusHubSyncer`) agree. Confirm before P2 lands; otherwise the two writers disagree on the root.
- **[COORD-2] Repo `catalog/*` -> local `catalog/*` mapping.** Nexus-Hub's repo already stores `catalog/{skills,commands,agents,hooks,mcp-configs,rules,templates}`. The syncer sparse-checkouts `catalog/*` and lays it into `~/.nexus-ai/catalog/*` one-to-one. `NEXUS_AI.md` and `nexus-hub-version.json` are new: Nexus-AI writes `nexus-hub-version.json`; `NEXUS_AI.md` is coordinated with Nexus-Hub (tolerate its absence with a resolver fallback until Nexus-Hub ships it).
- **[RISK-1] Data loss on cleanup.** Mitigated by the hard subtree-scope invariant (DoD 3) and the guarded one-way removal (DoD 4). This is the single most important safety property; it gets a dedicated adversarial test.
- **[RISK-2] Load-bearing string contracts.** `"devai-hub"` is a runtime identifier in the IPC `z.enum` ([desktop/sidecar/src/protocol.ts](../../../../../desktop/sidecar/src/protocol.ts)), skill provenance, tracer, slash namespaces, and the `nexus.skills.autoSync.devai-hub` setting key. Renaming these is a wire/settings contract change; it needs a read-migration for the setting value and lockstep test updates.
- **[RISK-3] First-launch fetch was never wired.** The weekly auto-sync worker and `bootstrapCoding` are built but never called by the live sidecar (`desktop/sidecar/src/main.ts`), and `skills.sync` IPC throws `NotImplementedError`. This plan is the first live consumer - budget for the wiring, not just a config flip.
- **[RISK-4] Docs canonicalization blast radius.** The migration rewrites many inbound path references including `tests/**` fixtures and CHANGELOG citations. Run it as the isolated final phase with a full green gate.

---

## Constitution / project-rules check

- **`no-llm-outside-llm-folder`:** syncer/reader/installer changes stay in `core/`, `modules/coding/`, `desktop/`, `scripts/installer/`; no LLM calls introduced. PASS.
- **MCP Registry Policy:** the Hub `mcp-configs` reader continues to route through `HubRegistryPolicyFilter` (default-deny, `already-local`/`vendor-intrinsic` only). No new outbound MCP. PASS.
- **Fail-closed security:** the prompt-injection scan on fetched catalog content is preserved as the `--apply` gate; offline is fail-soft (skip), not fail-open. PASS.
- **Byte-faithful catalog:** the syncer keeps `core.autocrlf=false`/`core.eol=lf` and content-hash identity. PASS.
- **Determinism:** `nexus-hub-version.json` carries no timestamps or absolute paths. PASS.
- **Test gates:** each phase lands with the standard root/desktop/installer suites green plus `tsc`/lint/ruff. Enforced per phase.
- **Every changed line traces to this request:** naming scrub is bounded to `DevAI`/`devai`; no unrelated cleanup. PASS.

---

## Complexity tracking

| Dimension | Assessment |
|---|---|
| Files touched | High (rename blast radius: ~40 files with `DevAIHub`, ~100 with `devai-hub`; plus docs migration) |
| Data-loss risk | Contained by design (subtree-scope + guarded removal); the risky home migration is deferred |
| Cross-repo coupling | Medium (COORD-1/COORD-2 with Nexus-Hub) |
| New net-new wiring | Medium (live first-launch/auto-sync + `skills.*` IPC never existed) |
| Reversibility | High for code; docs migration is mechanical + reference-repaired |

Mitigation: strict phase ordering (foundation -> syncer -> readers -> migration -> installer -> live UI -> scrub -> docs), a dedicated subtree-scope adversarial test, and deferral of all app-data-home changes.

---

## Phases at a glance

| Phase | Title | Recommended model (re-confirm at /implement) |
|---|---|---|
| 1 | Shared catalog-path + layout resolver (foundation) | Strong reasoning tier, medium effort (claude-opus-4-8, medium) |
| 2 | Rename DevAIHubSyncer -> NexusHubSyncer + retarget to isolated `~/.nexus-ai/catalog/` | Strong reasoning tier, high effort (claude-opus-4-8, high) |
| 3 | Reroute all runtime readers via the resolver; drop baseline fallback | Strong reasoning tier, high effort (claude-opus-4-8, high) |
| 4 | Rename AutoSync + one-shot migration + guarded cleanup | Strong reasoning tier, max effort (claude-opus-4-8, high) |
| 5 | Installer: remove bundled-baseline redundancy | Mid tier, medium effort (claude-sonnet-5, medium) |
| 6 | Live first-launch fetch + auto-sync wiring + in-app update detection | Strong reasoning tier, high effort (claude-opus-4-8, high) |
| 7 | DevAI/devai naming scrub (repo-wide) | Mid tier, medium effort (claude-sonnet-5, medium) |
| 8 | Docs architecture refactor (full + adr->specs/policy) + known-gaps reconciliation + CI/CD | Mid tier, medium effort (claude-sonnet-5, medium) |

Each phase's testing sub-task also creates/updates and optimizes CI/CD for that phase's changes.

---

## Phase 1 - Shared catalog-path + layout resolver (foundation)

Introduce one pure resolver so the write side (syncer) and every read side agree on the root and subdir names, and so subdir names come from the version manifest rather than hardcoded strings.

- [ ] **T001** In [core/storage/paths.ts](../../../../../core/storage/paths.ts), add `nexusAiHome(homeDirFn?)` -> `~/.nexus-ai` (respecting a `NEXUS_AI_HOME` override, mirroring `nexusHome()`/`NEXUS_HOME`) and `catalogRoot(root?)` -> `<nexusAiHome>/catalog`.
- [ ] **T002** Add a frozen default `HUB_LAYOUT` map (`skills`, `commands`, `agents`, `rules`, `hooks`, `mcp_configs`, `templates`, `instructions: "NEXUS_AI.md"`) and `hubLayoutDir(catalogRoot, key, layoutOverride?)` that joins `catalogRoot + layout[key]`, preferring an on-disk `layout` map when present.
- [ ] **T003** Add deterministic version-manifest helpers: `hubVersionManifestPath(catalogRoot)`, `readHubVersionManifest(catalogRoot)` (returns parsed manifest or null; used to source `layout`), and `writeHubVersionManifest(catalogRoot, {version, source_repo})` that emits the exact contract in Section 0 with stable key order and no timestamps/absolute paths.
- [ ] **T004** Make the resolver tolerant of missing optional subdirs (`templates`, `NEXUS_AI.md`) so a partially-populated or pre-coordination Nexus-Hub bundle still resolves (COORD-2).
- [ ] **T005** [tests] Unit tests for `nexusAiHome`/`catalogRoot`/`hubLayoutDir`/manifest read+write, incl. determinism (byte-identical re-serialization), `layout`-override precedence, and missing-optional-subdir fallback. Add a CI assertion that `paths.ts` stays fs-free/pure. Gate: root suite green, `tsc`/lint clean.

**Phase 1 acceptance:** the resolver exists, is pure, and is the single source of truth for the catalog root + layout; nothing consumes it yet.

---

## Phase 2 - Rename DevAIHubSyncer -> NexusHubSyncer and retarget to the isolated catalog subtree

- [ ] **T006** Rename [core/skills/DevAIHubSyncer.ts](../../../../../core/skills/DevAIHubSyncer.ts) -> `core/skills/NexusHubSyncer.ts`, class `DevAIHubSyncer` -> `NexusHubSyncer`, and update every importer (`bin/nexus.mjs`, `DevAIHubAutoSync`, `SkillsReloader`, `ChatPanelBootstrap`, tests). Preserve the public method surface (`sync({tag, apply})`) and injectable deps.
- [ ] **T007** Retarget path helpers to the Phase 1 resolver: catalog root = `catalogRoot(nexusAiHome())`; **remove the `<tag>` subfolder and the `ACTIVE`-pointer model** (single root, version tracked by `nexus-hub-version.json`).
- [ ] **T008** Scope the destructive wipe/refetch to `~/.nexus-ai/catalog/` ONLY: stage into a temp dir under `~/.nexus-ai/`, then atomically swap the `catalog/` subtree; add an internal guard that refuses any write whose resolved path is not under `catalogRoot`.
- [ ] **T009** Map repo `catalog/*` -> local `catalog/*`: update `HUB_SPARSE_CHECKOUT_PATHS` to the coordinated set (`catalog/skills`, `catalog/commands`, `catalog/agents`, `catalog/hooks`, `catalog/rules`, `catalog/mcp-configs`, `catalog/templates`, plus repo-root `data` as needed) and drop the local `catalog/`-prefix rewrites in index/manifest joins so the on-disk layout matches Section 0.
- [ ] **T010** After a successful `--apply`, write `~/.nexus-ai/catalog/nexus-hub-version.json` via the Phase 1 writer, sourcing `version` from the resolved release tag, falling back to the fetched `.claude-plugin/plugin.json` `version`.
- [ ] **T011** Preserve the prompt-injection scan as the fail-closed `--apply` gate and the GitHub `releases/latest` poll (`defaultResolveLatestTag`) unchanged in behavior.
- [ ] **T012** Rename the load-bearing provenance/namespace token `"devai-hub"` -> `"nexus-hub"` at its definition sites that the syncer/catalog own (`SkillCatalog` `SkillProvenance.source`/`SkillNamespace`/`SOURCE_PRIORITY`, `SkillAuditor`, `SkillRenderLine`); the wire enum + slash namespaces are handled in P4/P7 to keep this phase compilable.
- [ ] **T013** [tests] Rename+extend `DevAIHubSyncer.test.ts` -> `NexusHubSyncer.test.ts`; add an **adversarial subtree-scope test** proving a wipe/refetch cannot write outside `~/.nexus-ai/catalog/` (RISK-1); assert deterministic `nexus-hub-version.json`; assert version sourced from tag then plugin.json. Add these to CI. Gate: root suite green, `tsc`/lint clean.

**Phase 2 acceptance:** `NexusHubSyncer` fetches the latest catalog into `~/.nexus-ai/catalog/`, writes the version manifest, and is provably subtree-scoped.

---

## Phase 3 - Reroute all runtime readers via the resolver; drop the baseline fallback

- [ ] **T014** [src/panels/ChatPanelBootstrap.ts](../../../../../src/panels/ChatPanelBootstrap.ts): replace the three `tagDir(...) + "catalog" + <subdir>` joins for rules/agents/commands with `hubLayoutDir(catalogRoot(), "rules"|"agents"|"commands", layout)`; remove the `defaultSkillsRoot`/`readActiveTag`/`tagDir` indirection.
- [ ] **T015** [core/skills/SkillsReloader.ts](../../../../../core/skills/SkillsReloader.ts): replace the `ACTIVE`-pointer watch with a watch on the catalog subtree (or a sentinel under `~/.nexus-ai/catalog/`), firing `catalog.reload()` on change; source the root from the resolver.
- [ ] **T016** [modules/coding/skills/SkillLoader.ts](../../../../../modules/coding/skills/SkillLoader.ts): decide + implement whether Hub skills load from `hubLayoutDir(catalogRoot(), "skills")` as an explicit load dir (they currently never reach this loader); keep the bundled first-party `catalogDir` as the offline fallback (unchanged).
- [ ] **T017** [desktop/sidecar/src/runtime/codingBootstrap.ts](../../../../../desktop/sidecar/src/runtime/codingBootstrap.ts): feed the reloader/root from the resolver instead of `<nexusHome>/skills`.
- [ ] **T018** Wire the Hub `mcp-configs` reader: read `hubLayoutDir(catalogRoot(), "mcp_configs")/mcp-servers.json`, `JSON.parse`, and route through `McpManager.policyFilterHubRegistry` (this read site does not exist today). Keep `McpManager`'s own `~/.nexus/mcp.json` untouched (app data, deferred).
- [ ] **T019** Remove the broken placeholder bundled-baseline fallback reads now that the fetch is authoritative.
- [ ] **T020** [tests] Update/added tests for each rerouted reader proving they read from `~/.nexus-ai/catalog/<layout>/` with subdir names resolved from the manifest; add a Hub-mcp reader + policy-filter test. Update CI. Gate: root + desktop suites green, `tsc`/lint clean.

**Phase 3 acceptance:** every reader resolves the catalog from the isolated subtree via the layout map; no `catalog/`-string joins, no ACTIVE/tag indirection, no baseline fallback.

---

## Phase 4 - Rename AutoSync, one-shot migration, and guarded cleanup

- [ ] **T021** Rename [core/skills/DevAIHubAutoSync.ts](../../../../../core/skills/DevAIHubAutoSync.ts) -> `NexusHubAutoSync.ts`, task id `nexus.skills.devai-hub-sync` -> `nexus.skills.nexus-hub-sync`, `createDevAIHubSyncTask` -> `createNexusHubSyncTask`, and update `codingBootstrap` + tests.
- [ ] **T022** Rename the setting key `nexus.skills.autoSync.devai-hub` -> `nexus.skills.autoSync.nexus-hub` in [package.json](../../../../../package.json) and readers, with a **read-migration** that honors the old key's value once and rewrites to the new key (no user re-opt-in).
- [ ] **T023** Implement the one-shot migration (runs on first launch / first sync): if `~/.nexus/skills/devai-hub/` exists, perform a fresh fetch into `~/.nexus-ai/catalog/` (it is a cache; a fresh fetch is correct), then proceed to cleanup.
- [ ] **T024** Implement the guarded cleanup: remove ONLY `~/.nexus/skills/devai-hub/`, then remove `~/.nexus/skills/` only if it is empty. Guards: refuse to operate on an empty string, `~`, a filesystem root, or any path not equal to the two known targets; one-way; idempotent (a second run is a no-op). Never touch `settings.json`, `mcp.json`, `models/`, `session-artifacts/`, credentials, or `skills/user`|`skills/proposed`.
- [ ] **T025** [tests] Tests for: migration populates the new subtree; cleanup removes exactly the two targets and nothing else (assert other `~/.nexus/` entries survive); path guards reject empty/root/`~`/unexpected paths; idempotency (second run no-op); old->new setting-key migration. Add the "does not touch app data" assertion to CI. Gate: root + desktop suites green.

**Phase 4 acceptance:** existing installs migrate cleanly and the old catalog cache is removed safely; app data is provably untouched.

---

## Phase 5 - Installer: remove the bundled-baseline redundancy

The installer no longer bundles or provisions a Hub baseline; first-launch fetch (Phase 6) is authoritative. Fail-soft when offline is inherited from the runtime.

- [ ] **T026** Delete the broken baseline path: `scripts/installer/devai-hub-baseline.json`, `scripts/installer/src/nexus_installer/engine/devai_hub_provisioner.py`, the `"devai-hub"` entry in [scripts/installer/src/nexus_installer/engine/provisioner_dispatch.py](../../../../../scripts/installer/src/nexus_installer/engine/provisioner_dispatch.py), the `devai_hub` asset in `scripts/installer/build/fetch-payload.py`, the `devai_hub`/`common.devai_hub` pin in `scripts/installer/build/versions.lock.json`, and `scripts/installer/tests/test_devai_hub_provisioner.py`.
- [ ] **T027** Remove the `devai_hub_gb` disk-budget label ("Required for DevAI-Hub baseline") from [scripts/installer/src/nexus_installer/pages/storage.py](../../../../../scripts/installer/src/nexus_installer/pages/storage.py) and any `DEVAI_HUB_BASELINE_GB` constant; re-baseline the disk math.
- [ ] **T028** Repair the workflows that read the baseline JSON: `.github/workflows/installer-build.yml`, `installer-linux.yml`, `installer-macos.yml` (drop the `devai-hub baseline tag` echo/step).
- [ ] **T029** Confirm no Hub payload is bundled in `scripts/installer/build/nexus-installer.spec` (it never was) and add a comment/marker that the catalog is fetched at runtime, not bundled (DoD 6).
- [ ] **T030** [tests] Update installer suite: remove baseline-provisioner cases; assert the dispatch chain no longer contains `devai-hub`; assert packaging carries no Hub catalog. Update installer CI. Gate: `uv run pytest` green, ruff clean.

**Phase 5 acceptance:** the redundant baseline path is gone; the installer ships no Hub catalog.

---

## Phase 6 - Live first-launch fetch + auto-sync wiring + in-app update detection

Wire the never-wired machinery into the live app, implement the `skills.*` IPC, and surface update detection.

- [ ] **T031** Wire a best-effort **first-launch fetch** into the live sidecar startup ([desktop/sidecar/src/main.ts](../../../../../desktop/sidecar/src/main.ts) / `bootstrapCoding`): if `~/.nexus-ai/catalog/` is unpopulated, run `NexusHubSyncer.sync({apply:true})` non-blocking and non-fatal (offline -> "catalog not yet synced" state); register the renamed weekly auto-sync task when the setting is enabled.
- [ ] **T032** Implement the reserved IPC in [desktop/sidecar/src/protocol.ts](../../../../../desktop/sidecar/src/protocol.ts) + [desktop/sidecar/src/handlers.ts](../../../../../desktop/sidecar/src/handlers.ts): `skills.sync` (real, runs the syncer), `skills.status` (installed version from `nexus-hub-version.json` + catalog-present flag), `skills.upstreamLatest` (poll `latest_release_api`). Mark `implemented: true` with real zod schemas.
- [ ] **T033** Add `desktop/src/pages/settings/ipcSkillsClient.ts` mirroring `ipcCredentialsClient.ts`, and pass it into `SettingsPage` from [desktop/src/App.tsx](../../../../../desktop/src/App.tsx) (currently mock-only).
- [ ] **T034** Extend [desktop/src/pages/settings/SkillsSettings.tsx](../../../../../desktop/src/pages/settings/SkillsSettings.tsx): "update available" banner when `upstreamLatest` > installed `version` with a one-click "Update now" (calls `skills.sync`), plus the "catalog not yet synced" empty state. Reuse the existing `role="alert"` status pattern.
- [ ] **T035** Update the `"devai-hub"` wire enum in `protocol.ts` `z.enum` and the desktop slash-namespace maps to `"nexus-hub"`, keeping the sidecar/React contract in lockstep (RISK-2).
- [ ] **T036** [tests] IPC handler tests (`skills.sync|status|upstreamLatest`), `ipcSkillsClient` tests, `SkillsSettings` component tests (update-available + empty state), and a sidecar first-launch-fetch test (populates when absent, no-op when present, non-fatal offline). Update desktop CI. Gate: desktop suite green (coverage >= gate), `tsc`/eslint clean.

**Phase 6 acceptance:** a fresh app fetches on first launch, shows the installed version, detects a newer release, and updates the catalog live from Settings.

---

## Phase 7 - DevAI/devai naming scrub (repo-wide) (landed 2026-07-10)

- [x] **T037** Scrub remaining non-load-bearing `DevAI`/`devai` references in code comments, docstrings, demo/mock data (`panelData.ts`, `mockSkillsClient.ts`, `SkillsSettings.tsx` labels), and setting descriptions.
- [x] **T038** Finish any remaining load-bearing token renames not covered in P2/P4/P6 (`SlashAutocomplete`, `Tracer` namespace guard, `AgentLoop` source literal, `DoctorReport`/`ToolActivationContext`/`LanguageRuleBuilder` comments) to `"nexus-hub"`, in lockstep with their tests.
- [x] **T039** Preserve ONLY: (a) the one-shot migration code naming `~/.nexus/skills/devai-hub/`, and (b) dated historical `renamed from` notes in docs/CHANGELOG. Add a repo-grep CI gate that fails on any other `DevAIHub`/`devai-hub`/`DevAI` occurrence.
- [x] **T040** [tests] Update all tests asserting the old literals (`"devai-hub"`, `nexus.skills.devai-hub-sync`, `/skills-root/devai-hub/ACTIVE`) to the new contracts. Gate: root + desktop + installer suites green, `tsc`/lint/ruff clean, naming-grep gate green.

**Phase 7 acceptance:** the codebase reads as "Nexus-Hub" end to end; only the two allowed exceptions remain.

---

## Phase 8 (MANDATORY FINAL) - Docs architecture refactor + known-gaps reconciliation + CI/CD (landed 2026-07-11)

Run the `docs-layout-refactor` skill via `/update refactor --canonicalize-layout` to align to Nexus-Hub's canonical scheme (full + adr->specs/policy).

- [x] **T041** Migrate active tree `docs/versions/v1/v1.<m>.<p>/` -> `docs/v1/v1.<m>/` (MINOR-granular; patches share their minor dir; drop the `versions/` wrapper). Migrate `docs/archive/versions/v0/v0.x.0/` -> `docs/archive/v0/v0.x/<topic>/`.
- [~] **T042** Release-prefix filenames in shared minor dirs: `plans/v1.<m>.<p>-<slug>.md`, `comparisons/v1.<m>.<p>-comparison-<name>.md`; move loose `comparison-*.md` into `comparisons/`.
- [x] **T043** Fold per-patch `known-gaps.md` into one-per-minor with `## v1.<m>.<p>` subsections (v1.9.0 is already multi-plan; carry that shape forward).
- [~] **T044** Remap `docs/adr/` (0001-0019 + README + template) toward `docs/specs/` + `docs/policy/` following Nexus-Hub's structure; repair ADR cross-references.
- [x] **T045** Repair every inbound reference to the old layout: `README.md`, `CHANGELOG.md`, `AGENTS.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.gitignore`, `nexus.security.toml`, `.github/workflows/ci.yml` (and siblings), `docs/todos.md`, in-tree plan/known-gaps files, and `tests/**` fixtures that hardcode `docs/versions/**` or `docs/archive/versions/**`.
- [x] **T046** Write `docs/v1/v1.10/docs-cleanup-report.md` (audit trail) and create/refresh `docs/archive/README.md` with the index + archival-policy template. Leave `docs/DEVLOG.md` in place (Cat 3; flag as split-candidate).
- [x] **T047** Reconcile v1.9.0 known-gaps into the new location and open a v1.10.0 known-gaps section seeded with this plan's deferrals ([RISK]/[COORD] items, the deferred app-data-home consolidation plan, any environmentally-blocked on-device legs).
- [x] **T048** [tests + CI/CD] Add a docs-layout consistency check to CI (assert no `docs/versions/**` paths remain, references resolve); ensure the naming-grep gate (T039), the syncer subtree-scope test (T013), and the "cleanup does not touch app data" test (T025) run in CI. Whole-repo final gate: root + desktop + installer suites green, `tsc`/lint/ruff clean, all new CI gates green.

**Phase 8 acceptance:** the docs tree matches Nexus-Hub's canonical layout, all references resolve, the cleanup report exists, known-gaps are reconciled, and CI enforces the new invariants.

---

## Follow-up (separate plan, not this one)

**`~/.nexus/*` -> `~/.nexus-ai/*` app-data home consolidation.** Migrate settings, `mcp.json`, `models/`, `session-artifacts/`, and the credentials vault with copy -> verify -> remove, a backout path, and tests; then retire `~/.nexus/`. Touches `core/storage/paths.ts` `nexusHome()`, the model/weights root, the session store, the credentials vault, and installer paths. Filed as a v1.10.0 known-gap seed in T047.
