# Nexus-Hub Adoption Comparison + Plan (Hub v3.10.0)

**Date**: 2026-07-01
**Type**: Comparison + adoption plan (report only -- no code changes made)
**Hub snapshot**: `bendourthe/Nexus-Hub` v3.10.0 (released 2026-06-30) -- 259 skills / 16 commands / 23 agents / 25 hooks / 10 MCP servers (4 internal + 6 vendor-intrinsic)
**Nexus-AI snapshot**: v2.0.0, branch `feat/v1.7.0-phase-1-golden-runner`; last Hub integration cycle v1.5.0 Phase 7 (T023), which wired all six non-skill surfaces
**Predecessor**: [../../v1.5.0/development/nexus-hub-integration-delta.md](../../v1.5.0/development/nexus-hub-integration-delta.md)
**Wording convention**: follows the v1.4.0 evidence tiers -- `integrated` cites runtime-consuming code; a verdict of "skip" means "not worth adopting", not "impossible". "not_observed != absent" applies.

---

## 0. Executive summary (the decision-relevant conclusion)

**The Hub *consumption mechanism* is fully wired. The gap is content freshness, not missing plumbing -- and it does not block the desktop release.**

The v1.5.0 Phase 7 cycle integrated all seven Hub consumption surfaces (skills + the six net-new non-skill surfaces): each has a file-path-cited runtime consumer ([Section 2](#2-what-is-already-wired-the-seven-consumption-surfaces)). The live [`DevAIHubSyncer`](../../../../core/skills/DevAIHubSyncer.ts) resolves the **latest GitHub release tag** at sync time (`/repos/{upstream}/releases/latest`), builds a per-skill SHA-256 manifest, prompt-injection-scans the bundle, and diffs it against the active install before `--apply`. The `v1.0.0-baseline` zero-SHA pin in `scripts/installer/devai-hub-baseline.json` is only the **installer bundle template**, not the live sync source.

So "adopting Hub v3.10.0" decomposes into three tiers, and **none of them gate the paused desktop release** (the release ships consumption plumbing that is already wired; the items below are additive and independent):

| Tier | What | Cost | Blocks release? |
|---|---|---|---|
| **0 -- Runtime sync** | `nexus skills sync --apply` pointed at v3.10.0 pulls every new skill/rule/agent/command/hook of unchanged shape through the already-wired consumers | Runtime op + a one-time consumer shape-compatibility check | No |
| **1 -- Small code hardening** | Cross-verify the cloned bundle against the Hub's new published SHA-256 release manifest; adopt the `/skills import` hygiene gate | ~1 small phase, test-covered | No |
| **2 -- Optional product features** | `model-routing` as in-product local-model auto-selection; revisit the `extensions/` MCPs only where not already covered in-process | Evaluate; likely deferred | No |

**Recommendation**: proceed with the desktop release as planned. Schedule Tier 0 immediately after (it is a runtime sync, not a code change) and fold Tier 1 into the next version cycle. Tier 2 stays deferred pending demand.

---

## 1. Method and constraints

- **Local-first, zero-outbound**: the Hub was inspected via its sibling local clone (`../Nexus-Hub`) plus the committed `CHANGELOG.md` / `data/` catalog. No GitHub API call was made for this evaluation.
- **Two-agent cross-read**: one pass inventoried the Hub v3.10.0 surface + the v1.0.0 -> v3.10.0 release timeline; a second pass inventoried Nexus-AI's consumption code. Their claims were then re-grounded directly against [`DevAIHubSyncer.ts`](../../../../core/skills/DevAIHubSyncer.ts), the six wired consumers, and the v1.5.0 delta before any verdict below.
- **Governing policy**: every "adopt / reverse-engineer / skip" verdict is checked against the MCP Registry Policy decision tree in `AGENTS.md` (local-only -> LLM-native skill -> reverse-engineer into internal MCP -> trusted vendor wrapper -> drop) and the reverse-engineering attribution rule.
- **Scope**: this document is a comparison + plan only. It makes **no code changes** and does not touch the release.

---

## 2. What is already wired (the seven consumption surfaces)

From the v1.5.0 Phase 7 delta, each surface has a runtime consumer. Unchanged this evaluation:

| Surface | Consumer (file-path-cited) | Notes |
|---|---|---|
| `catalog/skills` | [`SkillLoader`](../../../../core/skills) via `DevAIHubSyncer` | Filesystem tree is authoritative |
| `data/skills.json` | `DevAIHubSyncer.buildManifestWithIndex` | Enriches manifest with index `category`; reports index/tree divergence |
| `catalog/rules` | [`LanguageRuleBuilder`](../../../../modules/coding/chat/LanguageRuleBuilder.ts) -> `PromptBuilder` | Per detected workspace language |
| `catalog/agents` | [`HubAgentPersonaLoader`](../../../../modules/coding/agents/HubAgentPersonaLoader.ts) -> `SubAgentManager` | Hub tool names mapped to Nexus registry ids; unsafe tools dropped |
| `catalog/commands` | [`HubCommandCatalogLoader`](../../../../modules/coding/commands/HubCommandCatalogLoader.ts) -> `CommandRouter` | Routed after built-ins + skills (no shadowing) |
| `catalog/hooks` | [`HubHookInstaller`](../../../../core/skills/HubHookInstaller.ts) | Explicit install; path-traversal rejected; shell hooks chmod 0o755 |
| `catalog/mcp-configs/mcp-servers.json` | [`HubRegistryPolicyFilter`](../../../../modules/coding/mcp/HubRegistryPolicyFilter.ts) -> `McpManager` | Filter-only, default-deny, never auto-connects |

**Consequence**: any new Hub *content* of unchanged shape flows through these consumers on the next `nexus skills sync --apply`. Adoption of new catalog content is a runtime operation, not a code change -- provided the content shape has not drifted since v3.3.4 (the compatibility check in Tier 0).

Separately, Nexus-AI ships **17 of its own authored coding skills** under [modules/coding/skills/catalog/](../../../../modules/coding/skills/catalog/) (`analyze-codebase`, `commit`, `critique`, `harden`, `review-pr`, `council`, `fuse`, ...). These are distinct from the 259 synced Hub skills and are not part of this adoption delta.

---

## 3. The delta: what the Hub added since Nexus-AI last synced (v3.3.4 -> v3.10.0)

At the v1.5.0 cycle the latest Hub *release* was v3.3.4; the two Phase-2 skills sat unreleased on Hub `develop` (recorded as still-pending in the v1.5.0 delta Section 3). The Hub has since cut v3.4.0 -> v3.10.0. Net-new capabilities:

| Hub cycle | New capability | Content type |
|---|---|---|
| v3.4.0 | `model-routing` skill + `/route` command; `context-pack-builder`, `direct-corpus-interaction`, `agent-presets` skills; session-query history extensions; **5 new platform integrations** (Aider, Windsurf, Kimi, Qwen, OpenClaw) | skills + command + platform adapters |
| v3.5.0 | Spec Kit comparison | Hub-internal doc |
| v3.6.0 | Parity-governance guard; `workflow-phase-notice.sh` hook; **`/skills import` hygiene gate** (HTTPS-only, `install_allowed` flag, hash-on-import); workflow-control vocabulary | hook + import discipline |
| v3.7.0 | One-line bootstrap installer / install UX overhaul | Hub installer |
| v3.8.0 / v3.8.1 | Gemini CLI sunset to enterprise-only | platform lifecycle |
| v3.9.0 / v3.9.1 | Advisory hook ecosystem + pre-release checks | hooks |
| v3.10.0 | **`nexus-hub verify` supply-chain command + release SHA-256 manifest**; `egress-redaction` + `prompt-injection-defense` skills; `competitive-generation` enrichment; `harness_audit.py` grading; `test-gap-notice.sh` + `dependency-staleness-notice.sh` advisory hooks | verify tooling + skills + hooks |

---

## 4. Per-item adoption verdicts

Verdict legend: **SYNC** = flows via runtime `nexus skills sync` through an already-wired consumer, no code. **CODE** = small policy-clean Nexus-AI code change. **EVAL** = larger product feature, evaluate against demand. **COVERED** = Nexus-AI already ships an in-process equivalent. **SKIP** = not applicable to Nexus-AI's role.

### 4.1 New Hub catalog content -> SYNC (Tier 0, no code)

| Item | Verdict | Rationale (policy bucket) |
|---|---|---|
| All new skills v3.4.0 -> v3.10.0 (`model-routing`, `context-pack-builder`, `direct-corpus-interaction`, `agent-presets`, `egress-redaction`, `prompt-injection-defense`, + the released Phase-2 skills that resolve v1.5.0 `1.1.P3.B` / `T023.P3.A`) | **SYNC** | LLM-native skills; consumed by the wired `SkillLoader`. Policy bucket 2 (LLM-native skill) -- ship as skill, already the mechanism. |
| `/route` and other new commands | **SYNC** | Consumed by `HubCommandCatalogLoader` -> `CommandRouter`. |
| New/updated `catalog/rules` | **SYNC** | Consumed by `LanguageRuleBuilder`. |
| Advisory hooks (`workflow-phase-notice.sh`, `test-gap-notice.sh`, `dependency-staleness-notice.sh`) | **SYNC** (explicit install) | Consumed by `HubHookInstaller` (install is always explicit, by design). |

**Precondition (one-time compatibility check)**: confirm the wired parsers still handle v3.10.0 content shapes -- skill frontmatter schema, `catalog/rules/<lang>/` paths, command markdown format, hook list extensions, and the `data/skills.json` index shape. If a shape drifted since v3.3.4, the fix is a small consumer patch (promote that one item to Tier 1). This is the whole risk surface of Tier 0.

### 4.2 Supply-chain verify -> CODE (Tier 1, recommended)

**Verdict: ADOPT (small).** v3.10.0 publishes a **release SHA-256 manifest** consumed by its `nexus-hub verify` command. Nexus-AI's [`DevAIHubSyncer`](../../../../core/skills/DevAIHubSyncer.ts) already computes its *own* per-skill SHA-256 + `bundleHash` and injection-scans, but it does **not** cross-check the cloned bundle against the Hub's authoritatively-published manifest. Adopting that cross-check (verify download integrity vs the published release manifest before `--apply`) closes a genuine supply-chain gap.

- **Policy**: bucket 1 (local-only) -- operates on already-fetched release content; the manifest ships inside the release. Zero new outbound calls, zero new credentials.
- **Shape**: additive gate in the existing `--apply` path; fails closed on mismatch (consistent with the existing injection-scan block). Test-covered alongside `DevAIHubSyncer.test.ts`.
- **Attribution**: reverse-engineer the verification *pattern*; do not name the upstream command in Nexus-AI user-facing artifacts (per the attribution rule).

### 4.3 `/skills import` hygiene gate -> CODE (Tier 1, conditional)

**Verdict: ADOPT if an import path exists (small).** v3.6.0's import hygiene (HTTPS-only sources, `install_allowed` discovery flag, hash-on-import) hardens any path that ingests third-party skills. Nexus-AI screens synced skills with `PromptInjectionScanner`; if it exposes a user-facing skill-import surface, add the HTTPS-only + hash-on-import checks there. If no such surface exists, this is **SKIP** (the sync path is the only ingest and is already screened).

### 4.4 `model-routing` as a product feature -> EVAL (Tier 2, defer)

**Verdict: EVALUATE, likely defer.** The skill itself flows via SYNC (4.1). A deeper adoption -- wiring the 5-signal complexity scorer into the product's *local* model selection (auto-route between `gemma4:e4b`, `qwen2.5-coder:7b`, ...) -- is a medium product feature. Note this session already exercises model-routing at the *harness* layer (the `/implement` per-phase pre-flight); an in-product router is optional polish over a small fixed local model set. Defer pending demand.

### 4.5 `extensions/` internal MCPs (`HUB.P3.EXT.*`) -> COVERED / EVAL

**Verdict: mostly COVERED.** The v1.5.0 delta recorded that Nexus-AI ships in-process equivalents for the Hub `extensions/` servers (codegraph, SSRF-guarded fetch, prompt-injection scanner, context compaction), so `nexus-context-compressor` and peers are "opt-in optionality, not a gap". Re-confirmed. Revisit only if a *specific* new extension capability lands that Nexus-AI lacks in-process (none identified in v3.4.0 -> v3.10.0). Policy: bucket 3 already satisfied (reverse-engineered locally).

### 4.6 Not applicable to Nexus-AI's role -> SKIP

| Item | Verdict | Rationale |
|---|---|---|
| 5 new platform integrations (Aider, Windsurf, Kimi, Qwen, OpenClaw) | **SKIP** | Nexus-AI *is* a consuming platform; it does not consume other platforms' integration adapters. |
| Gemini CLI sunset, Hub install UX (v3.7.0), Spec Kit comparison, parity-governance guard, `harness_audit.py` | **SKIP** | Hub-internal tooling / lifecycle; not Nexus-AI product surfaces. (`harness_audit.py` grading is an interesting QA idea but out of adoption scope.) |
| Vendor-intrinsic MCPs (github / supabase / vercel / cloudflare) | **NO NEW ACTION** | Already handled by the wired `HubRegistryPolicyFilter` (kept if audited vendor-intrinsic, never auto-connected). Policy bucket 4, already enforced. |
| `HUB.P3.NS` local `devai-hub` -> `nexus-hub` namespace rename | **SKIP (housekeeping)** | Cosmetic disk-layout + IPC-enum migration; deferred for churn-vs-gain (unchanged from v1.5.0). |

---

## 5. Phased adoption plan

**Phase 0 -- Runtime sync + compatibility check (no code, do first, does not block release)**
1. Point the syncer at v3.10.0 and run `nexus skills sync` (dry-run) to produce the manifest diff.
2. Run the consumer shape-compatibility check (4.1 precondition) against the v3.10.0 bundle.
3. If clean, `nexus skills sync --apply`. This resolves the v1.5.0 carryforwards `1.1.P3.B` / `T023.P3.A` (the 2 skills are now released) and pulls all v3.4.0 -> v3.10.0 catalog content through the wired consumers.
- **Exit**: a synced v3.10.0 bundle active; any shape drift captured as a Tier 1 consumer patch.

**Phase 1 -- Supply-chain + import hardening (small code) -- DELIVERED 2026-07-02**
1. Cross-verify the cloned bundle against the Hub's published SHA-256 release manifest in `DevAIHubSyncer` before `--apply` (fail closed). (4.2) -- **DONE**: `verifyReleaseManifest` / `parseSha256Manifest`, `MANIFEST.sha256` added to the sparse-checkout, fail-closed apply gate, `manifestVerification` on `SyncResult`, CLI reporting.
2. The user-facing skill-import surface (`nexus skills install --from <url>`) exists, so both hygiene items were added. (4.3) -- **DONE**: 4.3a HTTPS-only in `checkInstallUrl` (reject `http://`); 4.3b hash-on-import (`contentHash` on `installSkill` + CLI). The URL allowlist, injection scan-with-block, path-clamping, overwrite/namespace guards were already present.
- **Exit MET**: sync verifies integrity against the authoritative manifest and fails closed on mismatch; imports are HTTPS-only + content-hashed; all gates green (`tsc -b`, lint, check-architecture 0 errors, root suite 4548 passed / 0 failed, tampering / catalog / security / prod-audit clean). Delivered on branch `feat/hub-v3.10.0-adoption-hardening` off `develop`.
- **Not adopted (SKIP, recorded):** the v3.6.0 `install_allowed` per-skill frontmatter flag -- it is a Hub-authoring convention; Nexus-AI's ingest is HTTPS-only + injection-scanned + content-hashed, so honoring an upstream opt-in flag adds little and is deferred unless demand appears.

**Phase 2 -- Optional product features (evaluate, deferred)**
1. Assess in-product `model-routing` for local model auto-selection. (4.4)
2. Re-confirm `extensions/` coverage; adopt only a specifically-missing capability. (4.5)
- **Exit**: a go/defer decision recorded; no work unless demand justifies it.

**Housekeeping (deferred)**: `HUB.P3.NS` namespace rename in a dedicated cycle if the naming drift becomes confusing.

---

## 6. Open carryforward gaps -- disposition against v3.10.0

| Gap (source) | v1.5.0 status | v3.10.0 disposition |
|---|---|---|
| `1.1.P3.B` / `T023.P3.A` (2 skills on Hub `develop` await a release to flow through sync) | Blocked on Hub release | **RESOLVABLE now** -- v3.10.0 released them; Phase 0 sync surfaces them. |
| `HUB.P3.EXT.*` (adopt the 6 `extensions/` MCPs) | Deferred (in-process equivalents ship) | **Unchanged** -- COVERED; revisit per 4.5. |
| `HUB.P3.NS` (namespace rename) | Deferred (cosmetic) | **Unchanged** -- housekeeping. |
| Hub-owned gaps `1.1.P2.A`, `T017.P3.E`, `T002.P2.A` | Hub-owned | **Unchanged** -- not closeable from Nexus-AI; the sync path screens content independently via `PromptInjectionScanner`. |

---

## 7. Acceptance check

- [x] Every Hub surface has an integrated verdict with a file-path-cited consumer (Section 2).
- [x] The v3.3.4 -> v3.10.0 delta is enumerated by cycle (Section 3).
- [x] Each delta item has a verdict (SYNC / CODE / EVAL / COVERED / SKIP) checked against the MCP Registry Policy decision tree (Section 4).
- [x] A phased plan sequences the work with explicit exits (Section 5).
- [x] The release-blocking question is answered: **the Hub delta does not block the desktop release** (Section 0).
- [x] Report only -- no code changes, no release action taken.
