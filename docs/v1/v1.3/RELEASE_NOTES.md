# Nexus v1.3.0 -- Skill-Cleaner Adoption Track (DRAFT)

**Status**: draft -- updated as later v1.3.0 tracks land
**Cycle opened**: 2026-05-28 (post-v1.2.0 close)
**First-track close**: 2026-05-29
**Desktop product version**: 1.3.0 (bumped from 1.2.0)
**Engine version (package.json)**: still managed by semantic-release on the v0.x line
**Plan**: [docs/versions/v1/v1.3.0/plans/adoption-skill-cleaner.md](plans/adoption-skill-cleaner.md)
**Source comparison**: [docs/versions/v1/v1.3.0/comparison-skill-cleaner.md](comparison-skill-cleaner.md)
**Known gaps**: [docs/versions/v1/v1.3.0/known-gaps.md](known-gaps.md)

## Highlights

The first v1.3.0 cycle track adopts nine items from a single-source comparison of the `skill-cleaner` technique (Peter Steinberger's `steipete/agent-scripts`) into Nexus, reverse-engineered into local Nexus surfaces. All seven plan phases landed across 2026-05-28 / 2026-05-29; every retained item reverse-engineered cleanly (zero `vendor-intrinsic` or `drop-outright`).

### Skills audit command (the headline deliverable)

* **`nexus skills audit`** ([bin/nexus.mjs](../../../bin/nexus.mjs) + [core/skills/SkillAuditor.ts](../../../core/skills/SkillAuditor.ts)) -- a read-only, token-budget audit of the loaded skill catalog that emits five report sections: **Skill Budget** (catalog token consumption against the active model's context window, default 2% envelope, plus the render-ladder rung), **Description candidates** (rendered skill lines above the 50-token threshold, ranked by token cost), **Duplicates** (same-name collisions + content-similarity pairs above a 0.85 Jaccard threshold), **Unused candidates** (skills with no recent session-log invocation evidence), and **Root summary** (skills grouped by provenance source). `--json` for machine output; never writes to `~/.nexus/` or mutates state.
* **"Suggest first" framing** (insight I-12) -- the Unused report surfaces candidates, never verdicts; no audit section ever emits a destructive imperative.
* **CLI flags** -- `--context-tokens`, `--budget-percent`, `--months`, `--by-root builtin|user|devai-hub`, `--deep-logs` (scan archived + gzip session logs via `zlib.gunzipSync`, no new dependency), `--skills-root` / `--sessions-root`.

### Foundational utilities

* **Model-agnostic token cost** ([core/observability/TokenCost.ts](../../../core/observability/TokenCost.ts)) -- `tokenize()` returning `ceil(utf8_bytes / 4)`, a reusable under-estimator within ~10% for Nexus's local models.
* **Model context windows** ([core/registry/ModelRegistry.ts](../../../core/registry/ModelRegistry.ts)) -- per-model `contextWindow` (default 272,000; gemma4:e4b 128,000) + `getActiveContextWindow()`, all sourced locally (no network fetch).
* **Canonical render formatter** ([core/skills/SkillRenderLine.ts](../../../core/skills/SkillRenderLine.ts)) -- the single-source `- name: description (file: path)` line shape the auditor's token math is faithful to, plus a budget-driven fallback ladder (full -> equal-truncate -> priority-ordered omit, dropping devai-hub before user before builtin; `name`/`path` never truncated). The ladder is a diagnostic only in v1.3.0 -- the live agent-loop render path is intentionally untouched.
* **Realpath dedup** ([core/skills/SkillCatalog.ts](../../../core/skills/SkillCatalog.ts)) -- symlinked skill roots resolve through `fs.realpathSync` so a skill never registers twice; keep-priority is builtin > user > devai-hub, with a `skills.dedup` TelemetryBus event.

### Detectors

* **Content-similarity detection** ([core/skills/SkillSimilarity.ts](../../../core/skills/SkillSimilarity.ts)) -- Jaccard over 5-character shingles of the normalized skill body (frontmatter + code stripped); `findSimilarPairs` flags near-duplicate pairs above a configurable threshold (default 0.85). O(N^2); a MinHash/LSH pre-filter is deferred until the catalog roughly doubles.
* **Usage-evidence scanner** ([core/skills/SkillUsageScanner.ts](../../../core/skills/SkillUsageScanner.ts)) -- scans `~/.nexus/sessions/**/*.jsonl` over a configurable window with three fidelity tiers (HookBus `skill.loaded`/`invoked` events > slug mention > SKILL.md path), counts only, never proposes deletions.

### Skill-native authoring rule (upstream)

* **`skill-description-authoring`** Nexus-Hub skill -- codifies the trigger-noun preservation rule (product / tool / action / object) plus single-line, ASCII-sanitized description discipline, with worked good / over-long / no-trigger-noun examples.
* **Upstream validator** -- Nexus-Hub `scripts/validate_skills.py` gains single-line kebab-case `name` and <=250-char single-line `description` checks, with a transitional `--allow-existing` allowlist grandfathering 137 pre-existing over-long descriptions.

## Benchmarks

| Benchmark | Result | Report |
|---|---|---|
| Skills-audit runtime (builtin baseline) | wall-clock median 118.6ms / p95 159.7ms; peak RSS 51.5MB; similarity 4.4ms / 120 comparisons; budget pressure 34.8% @ 2% | [benchmarks/skills-audit-2026-05-28.md](benchmarks/skills-audit-2026-05-28.md) |

The benchmark is a builtin-catalog baseline (16 skills); the full ~213-skill Nexus-Hub catalog awaits the upstream-release sync (carryforward `1.1.P3.B`). Timing/RSS fields are informational; the deterministic report-content fields reproduce exactly.

## Items deliberately NOT adopted

None. All nine items from the comparison were retained and reverse-engineered into local Nexus surfaces; the comparison classified zero items as `vendor-intrinsic` or `drop-outright`. The skill-cleaner's analyzer *script* was deliberately not imported -- only its authoring rule and the re-engineered local equivalents.

## Carried forward

4 open items remain in [docs/versions/v1/v1.3.0/known-gaps.md](known-gaps.md): 1 WN (P2) + 3 DF (1 P2 + 2 P3). None are release blockers (zero P0 / P1). The deferrals:

* `T002.P2.A` (WN, P2) -- Nexus-Hub `validate_skills.py` reports 7 pre-existing secret-scan false positives (Nexus-Hub-side).
* `T012.P2.C` (DF, P2) -- the usage scan covers only the primary skill root; widening to multi-root is a Nexus-side enhancement.
* `T013.P3.D` (DF, P3) -- content-similarity is O(N^2); MinHash/LSH deferred until the catalog roughly doubles (runtime now captured by the T020 benchmark).
* `T017.P3.E` (DF, P3) -- drain the 137-entry Nexus-Hub description allowlist (Nexus-Hub-side).

## Cycle status

This is the **first track** of the v1.3.0 cycle. The v1.2.0 cycle closed its seven-phase ecosystem-adoption track on 2026-05-28; v1.3.0 may absorb additional tracks before its final release. The desktop product version was bumped from 1.2.0 to 1.3.0 to reflect the adoption-track close; the engine package.json continues to flow through semantic-release on the v0.x line.

## Tag policy

The git tag scheme is owned by [.github/workflows/semantic-release.yml](../../../.github/workflows/semantic-release.yml) and [.releaserc.json](../../../.releaserc.json), which tag off the engine package.json (`v${version}`, currently the v0.x line). The desktop product version (1.3.0) is **internal** -- no separate `v1.3.0` git tag is created from this commit. The engine-side semantic-release tag (the next v0.x minor, computed from the `feat(v1.3.0):` conventional commits) lands via CI when these commits reach `main`.

---

Generated on 2026-05-29 (Phase 7 cycle-track close). This file is the canonical v1.3.0 release-notes draft; the v1.3.0 final notes (when the full cycle closes with additional tracks) will supersede.
