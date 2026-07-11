# Nexus-Hub Integration Delta (v1.5.0 Phase 7, T023)

**Date**: 2026-06-15
**Author**: v1.5.0 Phase 7 (FINAL -- Nexus-Hub sync + whole-plan acceptance gate)
**Plan reference**: [../plans/adoption-ecosystem-2026-06.md](../plans/adoption-ecosystem-2026-06.md) sub-task 7.1 (T023)
**Predecessor**: [../../v1.4.0/development/nexus-hub-integration-delta.md](../../v1.4/development/nexus-hub-integration-delta.md) (the v1.4.0 Phase 9 delta, which inventoried the Hub surfaces and routed the net-new ones to v1.5.0 as `HUB.P3.*`)
**Wording convention**: follows [../../v1.4.0/development/evidence-and-support-tiers.md](../../v1.4/development/evidence-and-support-tiers.md) (A7). `integrated` cites runtime-consuming code; `not-integrated` means "not proven wired here", not "impossible". "not_observed != absent" applies.

---

## 0. Executive summary

The v1.4.0 delta found Nexus-AI consumed the Hub through exactly one surface (`nexus skills sync` -> `SkillLoader`) and routed every net-new non-skill Hub surface to v1.5.0 as the `HUB.P3.*` items. **This phase integrates all of them.** Nexus-AI now consumes the Hub across six surfaces:

| Surface | v1.4.0 verdict | v1.5.0 verdict | Integration |
|---|---|---|---|
| `catalog/skills` | INTEGRATED | INTEGRATED | `SkillLoader` (unchanged) |
| `data/skills.json` | PULLED, UNUSED (`HUB.P3.DATA`) | **INTEGRATED** | `DevAIHubSyncer.buildManifestWithIndex` enriches the synced manifest with the index `category` + reports index/tree divergence |
| `catalog/rules` | PULLED, UNUSED (`HUB.P3.RULES`) | **INTEGRATED** | `LanguageRuleBuilder` -> `PromptBuilder` language-rules section (per detected workspace language) |
| `catalog/agents` | PULLED, UNUSED (`HUB.P3.AGENT`) | **INTEGRATED** | `HubAgentPersonaLoader` -> `SubAgentManager` (`config.personaName` dispatch) |
| `catalog/commands` | PULLED, UNUSED (`HUB.P3.CMD`) | **INTEGRATED** | `HubCommandCatalogLoader` -> `CommandRouter` (`hub-command` route) -> `ChatController` injection |
| `catalog/hooks` | NOT PULLED (`HUB.P3.HOOK`) | **INTEGRATED** | added to the sparse-checkout + `HubHookInstaller` (list/install) |
| `catalog/mcp-configs/mcp-servers.json` | NOT PULLED (`HUB.P3.MCPCFG`) | **INTEGRATED (filter)** | `HubRegistryPolicyFilter` -> `McpManager.policyFilterHubRegistry` (policy-gated, never auto-connects) |

The two surfaces still left for a future cycle are the `extensions/` MCP servers (`HUB.P3.EXT.*` -- Nexus-AI ships in-process equivalents) and the optional local `devai-hub` namespace rename (`HUB.P3.NS`). Both are recorded in Section 4.

---

## 1. Method and constraints

- **Local-first, zero-outbound**: the Hub was inspected through its local clone at `../Nexus-Hub` (sibling directory). No GitHub API call was made for the inspection.
- **Sparse-checkout widened**: `catalog/hooks` and `catalog/rules` were added to `DevAIHubSyncer`'s sparse-checkout set (the v1.4.0 set fetched only a stale top-level `rules`, which did not exist on the Hub; the rules live under `catalog/rules`).
- **Inert by default**: every new consumer reads from the *active devai-hub bundle* (`~/.nexus/skills/devai-hub/<ACTIVE>/...`). With no bundle synced, each loader is empty and the feature is a no-op -- so the default runtime, CI, and tests are byte-unchanged. This is why the whole-plan acceptance gate stays green.
- **Snapshot coordinates** (2026-06-15): Hub remote `https://github.com/bendourthe/Nexus-Hub.git`; HEAD mid-cycle on `feat/model-routing` (v3.4.0 WIP); latest release tag `v3.3.4`; `develop` now carries the two v1.5.0 Phase 2 skills (see Section 3).

---

## 2. Per-surface integration detail

- **`HUB.P3.DATA`** -- [core/skills/DevAIHubSyncer.ts](../../../core/skills/DevAIHubSyncer.ts): `readSkillIndex` parses `data/skills.json`; `buildManifestWithIndex` keeps the filesystem tree authoritative (it is what `SkillLoader` loads) but attaches each row's `category` and computes `SyncResult.indexConsistency` (`onlyInIndex` / `onlyOnDisk`) as a Hub-side integrity signal. Falls back cleanly when the bundle ships no index. Tests: `tests/unit/core/skills/DevAIHubSyncer.test.ts`.
- **`HUB.P3.RULES`** -- [modules/coding/chat/LanguageRuleBuilder.ts](../../../modules/coding/chat/LanguageRuleBuilder.ts) detects the workspace's primary language (go.mod / pyproject.toml / tsconfig.json / shell markers) and renders the matching `catalog/rules/<lang>/{code-style,security,testing}.md` into a bounded section; `PromptBuilder` injects it via the additive `PromptContext.languageRules` (undefined -> no section); `ChatPanelBootstrap` resolves rules from the active bundle, memoized by `(activeTag, workspace)`. Tests: `tests/unit/chat/LanguageRuleBuilder.test.ts`, `tests/unit/chat/PromptBuilder.test.ts`.
- **`HUB.P3.AGENT`** -- [modules/coding/agents/HubAgentPersonaLoader.ts](../../../modules/coding/agents/HubAgentPersonaLoader.ts) reads `catalog/agents/*.md` and translates each into a `Specialist` (Hub human tool names -> Nexus registry ids; unsafe/unknown tools dropped; body -> system prompt). `SubAgentManager.setPersonaLoader` + `config.personaName` let a sub-agent adopt a persona's tool scope + instructions (additive; system prompt unchanged). Tests: `tests/unit/agents/HubAgentPersonaLoader.test.ts`.
- **`HUB.P3.CMD`** -- [modules/coding/commands/HubCommandCatalogLoader.ts](../../../modules/coding/commands/HubCommandCatalogLoader.ts) reads `catalog/commands/*.md`; `CommandRouter` surfaces them in `getAllDescriptors()` and routes a `hub-command` after built-ins + skills (so neither is shadowed); `ChatController` injects the command body like a skill prompt. Tests: `tests/unit/commands/HubCommandCatalogLoader.test.ts`.
- **`HUB.P3.HOOK`** -- `catalog/hooks` added to the sparse-checkout; [core/skills/HubHookInstaller.ts](../../../core/skills/HubHookInstaller.ts) lists hook scripts (`.sh`/`.ps1`/`.py`) and installs a chosen one into a target dir (shell hooks chmod 0o755, path-traversal rejected). Installation is always explicit. Tests: `tests/unit/core/skills/HubHookInstaller.test.ts`.
- **`HUB.P3.MCPCFG`** -- [modules/coding/mcp/HubRegistryPolicyFilter.ts](../../../modules/coding/mcp/HubRegistryPolicyFilter.ts) classifies each `mcp-servers.json` entry and keeps only `already-local` + audited `vendor-intrinsic` servers; everything else (search/scrape/embeddings/generation-as-service, or unclassified) is dropped (default-deny). `McpManager.policyFilterHubRegistry` is a filtering-only surface -- it never connects a server, so connection stays behind the existing per-server enable + workspace-approval gates. Tests: `tests/unit/mcp/HubRegistryPolicyFilter.test.ts`.

---

## 3. T023 -- skill publication

The two Phase 2 skills (`developer-experience/direct-corpus-interaction`, `workflow/agent-presets`) were re-applied onto a branch off Hub `origin/develop`, validated with `python scripts/validate_skills.py` (0 errors; quality pass 0 warnings), and fast-forwarded onto `develop` (commit `fe8eb68`). Per the operator decision this cycle, **no Hub release tag was cut** -- the Hub is mid-cycle on an unfinished v3.4.0, and tagging would publish that incomplete work. The generated `data/skills.json` / `SKILL_INDEX.md` were intentionally left to a clean `make build-catalog` run (a fresh build on the Hub currently diverges from its committed data -- a pre-existing Hub-side drift that is the Hub cycle's to resolve).

Consequence for `nexus skills sync`: the syncer pins the latest *release tag* (`v3.3.4`), which predates the skills, so a live sync does not yet surface them. This matches the v1.4.0 `1.1.P3.B` disposition -- the skills are present on `develop` and will flow through `nexus skills sync` once the Hub cuts a release containing `develop`. Faithful local verification (`git ls-tree origin/develop`) confirms both SKILL.md files are present on `develop`.

---

## 4. The four Hub-dependent v1.4.0 carryforward gaps -- disposition

| Gap | v1.4.0 disposition | v1.5.0 disposition |
|---|---|---|
| `1.1.P2.A` (run `make build-catalog`; register the 2 imported skills) | RESOLVED (Hub cycle) | **Still Hub-owned.** This cycle's publish deliberately left `data/skills.json` regeneration to the Hub's own `build-catalog` (its committed data is drifted vs a fresh build). No Nexus-AI surface affected. |
| `1.1.P3.B` (new Hub skills need a release to flow through sync) | RESOLVED (`DEFAULT_UPSTREAM` fixed) | **Unchanged.** Precondition still holds; the 2 new skills are on `develop` and flow once the Hub releases. |
| `T017.P3.E` (drain `validate_skills.allowlist.json`) | CARRIED FORWARD (Hub-owned) | **Still Hub-owned.** The file lives in the Hub repo; not closeable from Nexus-AI. |
| `T002.P2.A` (7 secret-scan false positives in `validate_skills.py`) | CARRIED FORWARD (Hub-owned) | **Still Hub-owned.** Same rationale; Nexus-AI's own sync path screens skills with `PromptInjectionScanner` and is unaffected. |

## 5. Carryforward to a future cycle (net-new, not integrated this phase)

- `HUB.P3.EXT.*` -- register / adopt the 6 Hub `extensions/` MCP servers. Nexus-AI ships in-process equivalents (codegraph, SSRF-guarded fetch, prompt-injection scanner, context compaction), so this is opt-in optionality, not a gap.
- `HUB.P3.NS` -- optional local `devai-hub` -> `nexus-hub` on-disk namespace rename (a disk-layout + IPC-enum migration; deferred for churn-vs-gain).

## 6. T023 acceptance check

- [x] Every Hub functionality is listed with an integrated / not-integrated verdict (Section 0).
- [x] The four net-new non-skill surfaces selected this cycle (`DATA`, `RULES`, `AGENT`, `CMD`/`HOOK`/`MCPCFG`) are integrated with file-path-cited consumers (Section 2).
- [x] The two new skills are published to Hub `develop` (Section 3); the no-tag operator decision is recorded.
- [x] The four Hub-dependent v1.4.0 gaps have an explicit disposition (Section 4).
- [x] The MCP registry consumption respects the MCP Registry Policy (default-deny; filter-only, never auto-connects).
