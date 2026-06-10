# Nexus-Hub Integration Delta (v1.4.0 Phase 9, T032)

**Date**: 2026-06-09
**Author**: v1.4.0 Phase 9 (FINAL -- Nexus-Hub sync + whole-plan acceptance gate)
**Plan reference**: [../plans/adoption-claude-code-harness.md](../plans/adoption-claude-code-harness.md) sub-task 9.1 (T032)
**Companion gaps**: `1.1.P2.A`, `1.1.P3.B` ([../../v1.2.0/known-gaps.md](../../v1.2.0/known-gaps.md)); `T017.P3.E`, `T002.P2.A` ([../../v1.3.0/known-gaps.md](../../v1.3.0/known-gaps.md))
**Wording convention**: follows [evidence-and-support-tiers.md](evidence-and-support-tiers.md) (A7). A verdict of `integrated` cites runtime-consuming code; `not-integrated` means "not proven wired here" (not "impossible"). "not_observed != absent" applies.

---

## 0. Executive summary

Nexus-AI consumes the Nexus-Hub catalog through exactly **one** integration surface today: the `nexus skills sync` pipeline ([core/skills/DevAIHubSyncer.ts](../../../../core/skills/DevAIHubSyncer.ts)) pulls a pinned Hub release and the `SkillLoader` loads its `catalog/skills/` tree into the agent's skill catalog. Every other Nexus-Hub functionality is either **sparse-cloned-but-unused** (commands, agents, language rules, `data/skills.json`, `extensions/`) or **not pulled at all** (hooks, mcp-configs, context, checklists, style-guides, memory, templates, and the `data/*.json` artifacts other than `skills.json`).

This phase makes the one integrated surface actually work: it fixes the upstream repo coordinate (`bendourthe/DevAI-Hub` -> `bendourthe/Nexus-Hub`), which gap `1.1.P3.B` recorded as the concrete blocker for `nexus skills sync`. The Hub-side hygiene the original gaps requested (`make build-catalog`, a release tag containing the imported skills) has since been performed independently by Nexus-Hub's own v3.x release cycle.

**Read this delta as a snapshot.** Nexus-Hub is under active concurrent development: during this phase's inspection its HEAD moved from a `v3.0.0 Phase 2` working tree (dirty, latest release tag `v2.4.0`) to a clean `v3.2.0` HEAD with `v3.0.0` / `v3.1.0` / `v3.1.1` release tags cut. The skill count is correspondingly a moving target (catalog `~251`, index `~249`, `data/skills.json` `~247`). Nexus-AI must therefore treat the Hub as a versioned upstream consumed at a pinned release tag, never at HEAD.

---

## 1. Method and constraints

- **Local-first, zero-outbound**: the Hub was inspected through its local clone at `../Nexus-Hub` (sibling directory). No GitHub call was made. This matches the gap `1.1.P3.B` "faithful local verification" pattern (`buildManifest` over the local `catalog/skills`).
- **Read-only on Nexus-Hub**: the Hub is mid-cycle with active concurrent commits. This phase makes **no** mutation to the Nexus-Hub repository (no commit, no tag, no `make build-catalog`, no allowlist edit). Hub-side actions are recorded against the Hub's own cycle.
- **Snapshot coordinates** (2026-06-09): Hub remote `https://github.com/bendourthe/Nexus-Hub.git`; latest release tag on HEAD's first-parent line `v3.0.0`; newest tags overall `v3.1.1`; HEAD `feat(v3.2.0) adoption-headroom Phase 5`.

---

## 2. The integration contract (what Nexus-AI consumes)

`nexus skills sync` ([bin/nexus.mjs](../../../../bin/nexus.mjs) -> [core/skills/DevAIHubSyncer.ts](../../../../core/skills/DevAIHubSyncer.ts)) resolves the latest Hub **release tag**, sparse-clones a fixed subtree, prompt-injection-scans it, writes a `manifest.json`, and (on `--apply`) rotates the active-tag pointer at `~/.nexus/skills/devai-hub/ACTIVE`.

Sparse-checkout subtree ([DevAIHubSyncer.ts:319-335](../../../../core/skills/DevAIHubSyncer.ts)):

```
catalog/skills      catalog/commands      catalog/agents
rules               data/skills.json      extensions/
```

Of that pulled subtree, only `catalog/skills` is wired into a runtime consumer:

- **Loader**: `SkillLoader` (under `modules/coding/skills/`) loads from three roots -- builtin (`src/skills/catalog`), user (`~/.nexus/skills/user/`), and devai-hub (`~/.nexus/skills/devai-hub/<ACTIVE>`).
- **Precedence**: builtin > user > devai-hub (keep-first on name collision; [core/skills/SkillCatalog.ts](../../../../core/skills/SkillCatalog.ts), [core/skills/SkillRenderLine.ts](../../../../core/skills/SkillRenderLine.ts)).
- **Hot-reload**: `SkillsReloader` ([core/skills/SkillsReloader.ts](../../../../core/skills/SkillsReloader.ts)) `fs.watch`es the ACTIVE pointer; the weekly auto-sync worker is `core/skills/DevAIHubAutoSync.ts` (opt-in via `nexus.skills.autoSync.devai-hub`).
- **Provenance + audit**: `SkillCatalog` tags `source: "devai-hub"` / `tag` / `contentHash`; `SkillAuditor` and `nexus doctor` ([core/diagnostics/DoctorReport.ts](../../../../core/diagnostics/DoctorReport.ts)) surface the devai-hub root.

> **Naming note (this phase, T033).** The upstream GitHub coordinate was renamed `DevAI-Hub` -> `Nexus-Hub`; `DEFAULT_UPSTREAM` is updated accordingly. The **local** `devai-hub` namespace (the on-disk root, the `ACTIVE` pointer, the `source: "devai-hub"` provenance label, the `--by-root devai-hub` audit flag, the IPC namespace enum) is an on-disk/identifier contract and is intentionally **left unchanged** -- renaming it would churn the disk layout, a provenance type union, the IPC protocol, and their tests for no functional gain. Renaming the local namespace is recorded as a forward item for v1.5.0 (see Section 6).

---

## 3. Per-artifact integration delta

Verdicts: **INTEGRATED** (a Nexus-AI runtime consumer loads it) / **PULLED, UNUSED** (sparse-cloned by the syncer, no consumer) / **NOT PULLED** (outside the sparse-checkout subtree).

| Hub artifact | Snapshot scale | Verdict | Integration step (cited) |
|---|---|---|---|
| `catalog/skills/` | ~251 SKILL.md, 21 categories | **INTEGRATED** | Loaded by `SkillLoader` from the devai-hub root; provenance via [SkillCatalog.ts](../../../../core/skills/SkillCatalog.ts). No further work. |
| `catalog/commands/` | 14 verb-first + 3 aliases + 40 deprecation shims | **PULLED, UNUSED** | Wire a command router that maps Hub `catalog/commands/*.md` to Nexus-AI slash commands; today commands are bundled per-product, not consumed from the Hub. Deferred to v1.5.0 (`HUB.P3.CMD`). |
| `catalog/agents/` | 23 reviewer/specialist agents | **PULLED, UNUSED** | Wire the Hub agent definitions into `src/agents/SubAgentManager.ts` as selectable specialist personas. Deferred to v1.5.0 (`HUB.P3.AGENT`). |
| `catalog/hooks/` | 30 hooks (diff-review, formatters, guards, session capture) | **NOT PULLED** | Add `catalog/hooks` to the sparse-checkout set and a consumer that installs platform hooks; Nexus-AI currently ships its own `.husky/` + `scripts/hooks/`. Deferred to v1.5.0 (`HUB.P3.HOOK`). |
| `rules/` (Hub `catalog/rules`) | bash/go/python/typescript (2-3 each) | **PULLED, UNUSED** | Feed Hub language rules into the system-prompt / policy layer; today rule content is inline (e.g. [core/skills/PromptInjectionScanner.ts](../../../../core/skills/PromptInjectionScanner.ts)). Deferred to v1.5.0 (`HUB.P3.RULES`). |
| `catalog/mcp-configs/mcp-servers.json` | 11 servers (5 Anthropic + 3 vendor + 3 internal) | **NOT PULLED** | Consume the Hub MCP registry into the Nexus-AI MCP bridge config. Governed by the MCP Registry Policy. Deferred to v1.5.0 (`HUB.P3.MCPCFG`). |
| `catalog/context`, `checklists`, `style-guides`, `memory`, `templates` | small content sets | **NOT PULLED** | Optional content surfaces; no current Nexus-AI consumer. Deferred / out-of-scope (`HUB.P3.CONTENT`). |
| `extensions/` (internal MCP servers) | 6 (see Section 4) | **PULLED, UNUSED** | Nexus-AI ships its own in-process equivalents; Hub Python MCP servers are not registered. Per-extension verdict in Section 4. |
| `data/skills.json` | ~247 entries | **PULLED, UNUSED** | The syncer walks `catalog/skills` directly for its manifest and ignores this JSON. Could be used as the index instead of a filesystem walk. Deferred (`HUB.P3.DATA`). |
| `data/SKILL_INDEX.md`, `marketplace.json`, `bundles.json`, `workflows.json`, `templates.json`, `report_data.json` | discovery / distribution metadata | **NOT PULLED** | Distribution/discovery artifacts for the Hub's own marketplace; no Nexus-AI runtime need today. Out-of-scope. |

---

## 4. Internal MCP servers / extensions (`extensions/`)

All six are **PULLED, UNUSED** on the Nexus-AI side (the `extensions/` tree is sparse-cloned but no Python MCP server from the Hub is registered with the Nexus-AI MCP bridge). Nexus-AI deliberately ships in-process TypeScript equivalents where the capability overlaps.

| Hub extension | Purpose | Nexus-AI status | Integration step |
|---|---|---|---|
| `nexus-skill-server` | MCP skill discovery + tiered loading (BM25 + optional embeddings) | Nexus-AI loads skills in-process via `SkillLoader`; does not run the Hub MCP server | Optional: register as an external MCP server if cross-product skill search is wanted. `HUB.P3.EXT.skillserver` |
| `nexus-code-search` | Local code-search MCP (keyword + Tree-sitter AST graph, 12 languages) | Nexus-AI ships its own in-process codegraph ([core/codegraph/](../../../../core/codegraph/), Tree-sitter scanner landed in Phase 7) | Equivalent capability exists in-process; external wiring optional. `HUB.P3.EXT.codesearch` |
| `nexus-web-fetch` | SSRF-guarded HTTPS fetch MCP | Nexus-AI ships `FetchPageTool` + the SSRF guard ([modules/coding/utils/ssrf.ts](../../../../modules/coding/utils/ssrf.ts), egress denylist landed in Phase 2/A4) | Equivalent in-process; external wiring optional. `HUB.P3.EXT.webfetch` |
| `nexus-skill-scanner` | Static skill-security scanner, 16 detection classes | Nexus-AI ships `PromptInjectionScanner` ([core/skills/PromptInjectionScanner.ts](../../../../core/skills/PromptInjectionScanner.ts)) on the sync path (narrower) | Consider adopting the broader 16-class detector behaviors as Nexus-AI rules. `HUB.P3.EXT.scanner` |
| `nexus-context-compressor` | Local-first reversible context compression (replaces external `rtk`) | Nexus-AI has its own context-compaction stack; the Hub compressor is not wired | Evaluate adopting the compressor patterns into Nexus-AI compaction. `HUB.P3.EXT.compressor` |
| `claude-usage-monitor` | VS Code usage status-bar extension | Out of Nexus-AI's coding-module domain | Out-of-scope for Nexus-AI runtime. `HUB.P3.EXT.usage` (no-action) |

**Note**: every Hub extension is local-first / zero-outbound by construction (the same posture as Nexus-AI's in-process equivalents), so none of them, if later wired, introduces a new outbound call, credential, or third-party processor. This matches the v1.4.0 plan's local-first invariant.

---

## 5. Version / feature delta (v2.4.0 -> v3.x)

What the Hub's v3.x line added since the last name Nexus-AI's gaps referenced, and whether Nexus-AI needs it:

| Hub feature (version) | Summary | Nexus-AI verdict |
|---|---|---|
| Command consolidation (v3.0.0) | 41 -> 14 verb-first commands + 3 aliases + 40 deprecation shims | NOT integrated (commands are pulled-but-unused; see Section 3 / `HUB.P3.CMD`) |
| Skill-security scanner + 16-class detector (v3.0.0) | `nexus-skill-scanner` extension; CI fails on HIGH/CRITICAL | NOT integrated (Nexus-AI uses the narrower `PromptInjectionScanner` on sync; `HUB.P3.EXT.scanner`) |
| Orchestration adoption (v3.0.0) | `agent-orchestration-primitives` and related skills | INTEGRATED as skills (flow through the skills catalog) |
| Claude-Red offensive methodology (v3.1.0) | `ai-attack-patterns`, `pentest-reporting` skills; catalog 247 -> 250 | INTEGRATED as skills (skills catalog) |
| Dynamic Workflows pilot + fan-out templates (v3.1.0) | workflow scaffolding | NOT integrated (workflows.json not pulled; `HUB.P3.DATA`) |
| `/commands` alias + runtime `/skills list` cheatsheet (v3.1.1) | command UX | NOT integrated (commands unused) |
| `session-teach-back` skill (v3.2.0, unreleased HEAD) | Socratic mastery loop | Will flow as a skill once a release tag containing it is pinned |
| `nexus-context-compressor` (v3.2.0, unreleased HEAD) | reversible compression engine, retires `rtk` | NOT integrated (`HUB.P3.EXT.compressor`) |

**Conclusion**: every Hub v3.x addition that is shipped *as a skill* flows through the one integrated surface automatically once a release tag containing it is synced. The Hub's net-new *non-skill* surfaces (consolidated commands, the agent roster, hooks, the MCP registry, the extension MCP servers, workflows/bundles metadata) are **not** integrated into the Nexus-AI runtime and are scoped to the v1.5.0 ecosystem cycle (`docs/versions/v1/v1.5.0/comparison-ecosystem-2026-06.md` + `plans/`).

---

## 6. The four Hub-dependent gaps -- disposition

| Gap | Origin | Disposition this phase |
|---|---|---|
| `1.1.P2.A` (WN, P2) -- run `make build-catalog` in Nexus-Hub; register the 2 imported skills into `data/skills.json` + `SKILL_INDEX.md` | v1.2.0 Phase 1 | **RESOLVED (Hub cycle).** The action is Hub-side; Nexus-Hub's own v3.x cycle independently rebuilt its catalog (`data/skills.json` and `SKILL_INDEX.md` regenerated at the v3.1.1 release) and the two target skills (`hallmark-design`, `html-output-conventions`) are present in the current Hub catalog. Verified read-only against the local clone. No Nexus-AI change required. |
| `1.1.P3.B` (DF, P3) -- new Hub skills need an upstream release to flow through `nexus skills sync`; live sync failed with "upstream did not return tag_name" | v1.2.0 Phase 1 | **RESOLVED (Nexus-AI side).** The documented blocker was the stale upstream coordinate; `DEFAULT_UPSTREAM` is fixed to `bendourthe/Nexus-Hub` (T033). The precondition (a release tag containing the skills) now exists (v3.0.0+). Local `buildManifest` over `../Nexus-Hub/catalog/skills` -- the gap's own accepted faithful verification -- enumerates the skills. A live `sync --apply` against the published release is now an unblocked operator step (requires network; out of this offline phase's scope). |
| `T017.P3.E` (DF, P3) -- drain the Nexus-Hub `validate_skills.allowlist.json` over-long descriptions | v1.3.0 Phase 6 | **CARRIED FORWARD (Hub-owned).** The gap text itself says "Track as a Nexus-Hub-side issue". The file lives in the Nexus-Hub repo (`scripts/validate_skills.allowlist.json`); draining it requires editing Hub content, which this read-only phase does not do. The Hub's v3.x security/validation overhaul (`nexus-skill-scanner` + producer-catalog allowlist) is the live owner. No Nexus-AI surface is affected. |
| `T002.P2.A` (WN, P2) -- 7 secret-scan false positives in Nexus-Hub `validate_skills.py` | v1.3.0 Phase 1 | **CARRIED FORWARD (Hub-owned).** Same rationale: the script and its findings live in the Nexus-Hub repo; the fix (allowlist extension or regex refinement) is Hub-side. Likely superseded by the Hub's v3.x `nexus-skill-scanner` (fence-aware, with a producer-catalog allowlist for authorized teaching content). No Nexus-AI surface is affected; Nexus-AI's own sync path screens skills with `PromptInjectionScanner` and is unaffected by the Hub's validator FPs. |

---

## 7. Carryforward to v1.5.0 (net-new Hub v3.x integration)

These are **not** part of the v1.4.0 plan's original 36-item carryforward set; they are new integration opportunities created by the Hub's parallel v3.x expansion. They are routed to the already-in-flight v1.5.0 ecosystem cycle ([../../v1.5.0/comparison-ecosystem-2026-06.md](../../v1.5.0/comparison-ecosystem-2026-06.md)):

- `HUB.P3.CMD` -- consume Hub `catalog/commands` into a Nexus-AI command router.
- `HUB.P3.AGENT` -- wire the 23-agent Hub roster into `SubAgentManager`.
- `HUB.P3.HOOK` -- pull + install Hub `catalog/hooks` (add to sparse-checkout).
- `HUB.P3.RULES` -- feed Hub language rules into the prompt/policy layer.
- `HUB.P3.MCPCFG` -- consume `catalog/mcp-configs/mcp-servers.json` into the MCP bridge.
- `HUB.P3.EXT.*` -- evaluate registering / adopting the 6 Hub extensions (most have in-process Nexus-AI equivalents already).
- `HUB.P3.DATA` -- use `data/skills.json` / `workflows.json` as the sync index.
- `HUB.P3.NS` -- optional local `devai-hub` -> `nexus-hub` namespace rename (on-disk contract migration).

---

## 8. T032 acceptance check

- [x] Every Hub functionality is listed with an **integrated / not-integrated** verdict (Sections 3-5).
- [x] Each not-integrated item has a **file-path-cited integration step** (Sections 3-4) or an explicit out-of-scope / forward-routing note (Section 7).
- [x] Diffed against what Nexus-AI consumes via `nexus skills sync` and `DevAIHubSyncer` (Section 2).
- [x] The Hub is treated as the versioned upstream Nexus-AI stays in lock-step with (Section 0, snapshot discipline).
- [x] The four Hub-dependent gaps have an explicit disposition (Section 6).
