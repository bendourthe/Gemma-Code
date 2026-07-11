# Nexus v1.4.0 -- claude-code-harness Adoption + Known-Gaps Closure + Nexus-Hub Sync

**Status**: release-ready (Phase 9 / FINAL closed 2026-06-09)
**Cycle opened**: 2026-05-30 (post-v1.3.0 close)
**Cycle closed**: 2026-06-09
**Desktop product version**: 1.4.0 (bumped from 1.3.0)
**Engine version (package.json)**: managed by semantic-release on the v0.x line (currently 0.43.0)
**Plan**: [docs/versions/v1/v1.4.0/plans/adoption-claude-code-harness.md](plans/adoption-claude-code-harness.md)
**Source comparison**: [docs/versions/v1/v1.3.0/comparison-claude-code-harness.md](../v1.3/comparison-claude-code-harness.md)
**Known gaps**: [docs/versions/v1/v1.4.0/known-gaps.md](known-gaps.md)
**Nexus-Hub integration delta**: [docs/versions/v1/v1.4.0/development/nexus-hub-integration-delta.md](development/nexus-hub-integration-delta.md)

## Highlights

v1.4.0 is the largest hardening-plus-cleanup cycle to date. It (1) adopts all 12 in-scope patterns (A1-A12) from the cross-project comparison against [claude-code-harness](https://github.com/Chachamaru127/claude-code-harness), reverse-engineered into Nexus's TypeScript/Node stack rather than importing its Go engine; (2) closes 34 of the 36 carryforward known gaps inherited from v1.1.0 / v1.2.0 / v1.3.0 (the remaining 2 are Hub-owned and explicitly re-justified); and (3) brings Nexus-AI into lock-step with the parallel Nexus-Hub upgrade. Every adopted pattern reduces trust surface or is pure local workflow tooling; nothing introduces a new outbound call, credential, or third-party processor.

**Definition of pass (verified in Phase 9, fresh evidence):** all 12 adoptions landed; all ingested known gaps resolved (34) or explicitly re-justified (2 Hub-owned); Nexus-Hub latest updates accounted for; full test matrix (unit, static, integration, e2e, CI) green at 87.19% line coverage.

## The 12 adoptions (A1-A12)

### Network & subprocess hardening (Phase 2)

* **A4 -- network-egress denylist** in the SSRF guard ([modules/coding/utils/ssrf.ts](../../../modules/coding/utils/ssrf.ts)): a named exfil-destination denylist (cloud-metadata endpoints, paste/file-drop hosts), enforced pre- and post-redirect across `fetch_page` / `web_search` / OTLP, extensible via `nexus.coding.egressDenyExtra`.
* **A5 -- run_terminal env scrubbing** ([core/observability/scrubEnv.ts](../../../core/observability/scrubEnv.ts) consumed by [src/tools/handlers/terminal.ts](../../../src/tools/handlers/terminal.ts)): strips API keys / tokens / cloud credentials from child-process env, allowlist opt-in, toggle `nexus.coding.terminalEnvScrub` (default on).

### Static-analysis & CI gates (Phase 3)

* **A2 -- test-tampering detection**: five deterministic, LLM-free `nexus-check` rules ([lib/checks/](../../../lib/checks)) -- `no-focused-tests`, `no-skipped-tests-without-reason`, `no-tautological-assertion`, `no-commented-out-assertion`, `no-disabled-ci-check` -- wired into pre-push (`check:tampering`) and CI.
* **A9 -- OpenSSF Scorecard workflow** ([.github/workflows/scorecard.yml](../../../.github/workflows/scorecard.yml)): SHA-pinned `ossf/scorecard-action`, weekly + push + branch-protection triggers, SARIF upload.

### Safety config SSOT (Phase 4)

* **A1 -- `nexus.security.toml` SSOT** + extended generator ([scripts/generate-tool-permission-table.mjs](../../../scripts/generate-tool-permission-table.mjs)) regenerating the egress denylist, secret-path denylist, and the permission-tier mirror into committed runtime artifacts, with the `npm run security:check` CI drift gate.

### Operator tooling & lifecycle (Phase 5)

* **A6 -- `nexus doctor --migration-report`** ([core/diagnostics/DoctorReport.ts](../../../core/diagnostics/DoctorReport.ts)): read-only inventory of stale caches, legacy `~/.gemma-code/` state, duplicate skills, dangling symlinks, memory state -- never mutates disk.
* **A8 -- PreCompact WIP-detection hook** ([core/lifecycle/PreCompactHook.ts](../../../core/lifecycle/PreCompactHook.ts)): detects uncommitted edits + in-flight tasks before compaction, persists a restorable checkpoint, emits a non-blocking warning.

### Parallel agent execution (Phase 6)

* **A10 -- worktree-isolated parallel sub-agents** ([src/agents/WorktreeManager.ts](../../../src/agents/WorktreeManager.ts) + `SubAgentManager`): opt-in (`isolate`, default off) git-worktree isolation so concurrently-dispatched write-capable sub-agents cannot collide; the worktree is removed when unchanged.

### Skill-native conventions (Phase 1)

* **A3** pre-commit/pre-PR self-review checklist, **A7** "not_observed != absent" evidence + support-tier convention, **A12** verified-only evidence-pack discipline, **A11** stakeholder HTML surfaces -- shipped as zero-code convention docs under [development/](development).

## Known-gaps closure (Phases 7-9)

* **Phase 7 (architectural carryforward, 6 gaps):** the wholesale `src/` -> `modules/coding/` move (`1.4.P1.B`), the `tsc -b` project-references build (`1.1.P1.A`), the Tree-sitter (WASM) scanner (`3.3.P2.G`, cascading to `4.1.P2.J` + `6.1.P3.V`), and the multi-layer HNSW PrunedDenseIndex (`4.2.P3.K`).
* **Phase 8 (wiring / deferrals / the P1 CVE, 22 gaps):** the lone P1 protobufjs chain resolved by migrating the embedder to `@huggingface/transformers` (`7.x.P1.D`); `permissions.deny` + codegraph ignore-parser unification; session-reflection + path-scope + explore-MCP wiring; LSP install prompts + desktop DOMPurify; seven hygiene deferrals; the 100k memory benchmark + multi-root usage scan.
* **Phase 9 (Nexus-Hub sync, 2 gaps + 2 re-justified):** see below.

## Nexus-Hub sync (Phase 9)

* **Integration delta** ([development/nexus-hub-integration-delta.md](development/nexus-hub-integration-delta.md)): every Nexus-Hub functionality (skills, commands, agents, hooks, rules, MCP configs, 6 internal extensions, data artifacts) enumerated with an integrated / not-integrated verdict and a file-path-cited integration step. Nexus-AI currently integrates the **skills catalog**; the Hub's v3.x non-skill surfaces are routed to the v1.5.0 ecosystem cycle.
* **Upstream coordinate fix** (`1.1.P3.B`, `1.1.P2.A`): `DEFAULT_UPSTREAM` corrected from the renamed `bendourthe/DevAI-Hub` to `bendourthe/Nexus-Hub` in [core/skills/DevAIHubSyncer.ts](../../../core/skills/DevAIHubSyncer.ts) -- the documented `nexus skills sync` blocker. The local `devai-hub` on-disk namespace is intentionally preserved. Offline `buildManifest` over the local Hub catalog enumerates 251 skills including the two originally-imported targets.
* **Hub-owned items re-justified** (`T017.P3.E`, `T002.P2.A`): the allowlist drain and the 7 secret-scan false positives live in the Nexus-Hub repo and are owned by the Hub's parallel v3.x security/validation cycle; not closeable from Nexus-AI.

## Carryover to v1.5.0

* `T017.P3.E`, `T002.P2.A` -- Hub-owned, tracked against the Nexus-Hub repo.
* `T034.P2.A` -- ~16 dev-only npm advisories (not production-gated); fix as a standalone dev-hygiene commit.
* `HUB.P3.*` -- net-new Nexus-Hub v3.x integration opportunities (commands, agents, hooks, rules, MCP configs, extensions, local namespace rename), routed to the in-flight v1.5.0 ecosystem cycle.
* P3/DF deferrals from earlier phases: `T016.P3.A`, `T018.P3.A`, `T018.P3.B`, `T022.P3.A`.

## Acceptance gate evidence (Phase 9, T034)

| Gate | Result |
|---|---|
| `npm run build` (`tsc -b`) | clean |
| `npm run lint` | clean |
| `npm run check-architecture` | 0 errors / 10 pre-existing warnings |
| `npm run check src/` (gated scope) | 0 findings |
| `npm run check:tampering` | 0 findings |
| `npm run security:check` (SSOT drift) | in sync |
| `npm run check:audit-prod` | 0 blocking (1 allowlisted `brace-expansion`; `hono` advisory fixed in-phase to 4.12.25) |
| Full suite + coverage | 339 files passed, 2 skipped (live-backend), 0 failed; 87.19% lines |
| Adoptions A1-A12 | 12 / 12 landed |
| Ingested known gaps (36) | 34 resolved + 2 Hub-owned re-justified |
