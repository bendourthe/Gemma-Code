# Source Analysis: Nexus vs. "Skill Cleaner" (steipete/agent-scripts)

**Version**: v1.3.0
**Generated**: 2026-05-28 (originally drafted under v1.2.0; relocated to v1.3.0 since the v1.2.0 cycle had already closed)
**Analyzer**: Claude Code -- compare-project command
**External Source**: https://github.com/steipete/agent-scripts/blob/main/skills/skill-cleaner/SKILL.md
**Source Type**: Web Article (single SKILL.md file)

---

## 1. Executive Summary

The `skill-cleaner` skill is a token-budget audit tool authored by Peter Steinberger for Codex / OpenClaw harnesses. It ships a single analyzer script that produces five report sections (Skill Budget, Description candidates, Duplicates, Unused candidates, Root summary) and codifies a "suggest first, edit on ask" cleanup policy. Fourteen actionable insights were extracted; **eight are missing from Nexus**, **two are partially implemented**, and **four are already in force** as project norms. The overall recommendation is **selective adoption**: build a local `nexus skills audit` CLI (re-engineered from the analyzer's logic, not the script itself) that reuses Nexus's existing `SkillCatalog`, `ModelRegistry`, session-replay telemetry, and the v1.2.0 Phase 7 token-usage benchmark scaffolding. Nexus-Hub has grown to 213 skills as of v1.2.0 Phase 1, making the prompt-budget pressure the skill-cleaner addresses a real and recurring problem in this project.

---

## 2. Source Overview

- **Source artifact**: `skills/skill-cleaner/SKILL.md` in `steipete/agent-scripts` (the file is 3,559 bytes; a sibling `scripts/` directory holds the analyzer script).
- **Author**: Peter Steinberger (@steipete). The repository's positioning is "Shared agent instructions, skills, and small portable helpers for Peter's local workspaces."
- **Target harness**: Codex / OpenClaw skill loaders (specifically mirroring `core-skills/src/render.rs` math).
- **Thesis**: The cost of an agent's loaded-skill list is real prompt budget. Long descriptions, duplicates across roots (system, plugin, repo, personal), and never-invoked skills all compete for the same 2% slice of the model's context window. A static analyzer that scores every skill against this budget and against recent session logs is enough to find the cleanup wins -- no LLM call required at audit time.
- **Operating model**: Read-only analyzer; cleanup is human-approved; cleanup commits are grouped by kind (descriptions vs deletes vs config disables).

---

## 3. Key Insights Extracted

| # | Insight | Article section |
|---|---|---|
| I-01 | Five-report audit framework: Skill Budget, Description candidates, Duplicates, Unused candidates, Root summary | Workflow / step 2 |
| I-02 | Render-line shape: `- name: description (file: path)` -- faithful to how the host renders skills in the system prompt | Analyzer Notes (line 1) |
| I-03 | Frontmatter discipline: YAML only, default name from parent dir, single-line sanitized `name` / `description` | Analyzer Notes (line 2) |
| I-04 | Token-cost formula: `ceil(utf8_bytes / 4)` -- cheap, model-agnostic | Analyzer Notes (line 3) |
| I-05 | Context-aware budget envelope: 2% of `context_window`, read from the active model's metadata; fallback 272,000 tokens | Analyzer Notes (lines 3-4) |
| I-06 | Render fallback ladder: full descriptions -> equal description truncation -> omitted-minimum-lines | Analyzer Notes (line 3) |
| I-07 | Realpath dedup across symlinked roots (e.g. plugin cache pointing to repo) | Analyzer Notes (line 6) |
| I-08 | Duplicate detection by name AND by near-identical body / description similarity | Analyzer Notes (line 7) |
| I-09 | Keep-priority hierarchy when collapsing duplicates: direct system > direct Codex > plugin > personal/repo | Analyzer Notes (line 7) |
| I-10 | Heuristic usage evidence from session logs: `$skill`, `Use $skill`, paths like `skills/<name>/SKILL.md` | Analyzer Notes (line 9) |
| I-11 | Configurable scope: `--root`, `--months`, `--max-log-mb`, `--deep-logs`, `--context-tokens`, `--budget-percent`, `--no-logs` | Workflow / step 1 variants |
| I-12 | Output policy: "suggest first; edit only when the user asks" | Output Policy (line 1) |
| I-13 | Grouped-commit cleanup: descriptions, deletes, config disables -- as separate commits | Output Policy (line 2) |
| I-14 | Confirmation gate on ignored / untracked dirs (no silent deletes of disposable-looking skill directories) | Output Policy (line 3) |
| I-15 | Trigger-noun preservation when rewriting descriptions: keep product, tool, action, object | Workflow / step 3 |

---

## 4. Relevance Analysis

| # | Insight | Status | Evidence / Notes |
|---|---|---|---|
| I-01 | Five-report audit framework | **Missing** | No `nexus skills audit` command exists. [bin/nexus.mjs](../../../bin/nexus.mjs) ships `skills sync` and `skills list` only. The Phase 7 token-usage benchmark at [docs/versions/v1/v1.2.0/benchmarks/coding-pillar-token-usage-2026-05-26.md](../v1.2/benchmarks/coding-pillar-token-usage-2026-05-26.md) is a one-off, not a recurring audit. |
| I-02 | Render-line shape | **Partially implemented** | Nexus owns its render path through the Coding-pillar agent loop (the host renders the skill list into the system prompt). The exact format is implementation-internal and is not surfaced as a "skill audit line" anywhere. Adopting this insight means standardising the render line so an audit tool can replay it byte-for-byte. |
| I-03 | Frontmatter discipline | **Partially implemented** | [core/skills/PromptInjectionScanner.ts](../../../core/skills/PromptInjectionScanner.ts) parses SKILL.md but enforces injection rules, not authoring discipline. Nexus-Hub maintains its own [validate_skills.py](https://github.com/bendourthe/Nexus-Hub) script for YAML linting. No single-line / sanitized-string rule is enforced today. |
| I-04 | Token-cost formula | **Missing** | No `tokenize / 4` helper exists in `core/observability/` or `core/skills/`. The Phase 2 [CommandCompressor](../../../core/observability/CommandCompressor.ts) operates on tool-call output, not on the skill catalog. |
| I-05 | Context-aware budget envelope | **Missing** | [core/registry/ModelRegistry.ts](../../../core/registry/ModelRegistry.ts) tracks installed models but no consumer reads the active model's context window to derive a skills-budget envelope. |
| I-06 | Render fallback ladder | **Missing** | No truncation policy is applied to skill descriptions before they enter the prompt. This is the same algorithmic surface Codex codifies in `render.rs`. |
| I-07 | Realpath dedup across symlinked roots | **Missing** | [SkillCatalog.ts](../../../core/skills/SkillCatalog.ts) sees `~/.nexus/skills/devai-hub/<tag>/` and `~/.nexus/skills/user/` as separate sources by `SkillProvenance.source`, but no `fs.realpath` dedup runs against them. Less acute than in Codex (Nexus doesn't symlink plugin caches), but still a defensive win. |
| I-08 | Duplicate detection by body similarity | **Partially implemented** | `SkillRecord.diverged` (line 60-64) marks same-display-name skills across two sources and surfaces a "diverged" badge in the Settings UI. There is **no content-similarity / near-duplicate detection** -- two skills with different names but ~95% identical bodies would both load. |
| I-09 | Keep-priority hierarchy | **Already implemented** | `SkillProvenance.source: "builtin" | "user" | "devai-hub"` (line 22) already encodes a precedence concept; the catalog merge logic in `SkillCatalog` resolves the diverged case. The same hierarchy applies (builtin > user > devai-hub in conflict resolution). The cleaner's "system > codex > plugin > personal" maps directly. |
| I-10 | Heuristic usage evidence | **Missing** | The v1.1.0 Phase 7 session-replay timeline exists (sessions are persisted), but no consumer scans them for skill-invocation evidence. Without this, an "unused skills" report is impossible to produce. |
| I-11 | Configurable scope flags | **Not applicable as designed** | Codex stores logs at `~/.codex/sessions/`. Nexus stores them under `~/.nexus/sessions/` (per `core/storage/`). The flag *concept* (window in months, max log MB, deep-logs opt-in) transfers; the paths do not. |
| I-12 | Suggest-first / edit-on-ask policy | **Already implemented** | This is an established Nexus norm: [refactor-docs](../../versions/catalog/skills/code-cleanup/docs-layout-refactor) and [update-gitignore](https://github.com/bendourthe/Nexus-Hub) skills both follow propose-then-apply. Reinforced by global rule: "Destructive git commands require user confirmation." |
| I-13 | Grouped-commit cleanup | **Already implemented** | Matches the existing [code-commit-workflow](https://github.com/bendourthe/Nexus-Hub) skill discipline (atomic commits per logical change). |
| I-14 | Confirmation gate on ignored / untracked dirs | **Already implemented** | Codified in Critical Rules: "Destructive git commands require user confirmation." The Nexus-Hub `refactor-docs` skill explicitly gates archival operations on user approval. |
| I-15 | Trigger-noun preservation | **Missing** | No authoring guidance exists for "when rewriting a description, keep these specific noun categories." This is a tiny but valuable skill-authoring rule. |

**Summary**: 8 missing, 3 partially implemented, 4 already implemented. The cluster of missing insights (I-01, I-04, I-05, I-06, I-08, I-10, I-15) all line up behind a single deliverable: a `nexus skills audit` CLI command plus a description-authoring skill in Nexus-Hub.

---

## 5. Adoption Plan (preliminary)

Preliminary tiers below. Final ordering is set by Section 6's RE-first re-ordering.

### P0 -- Immediate (high value, low effort)

| # | What | Source (article section) | Target | Effort | Dependencies | Risk |
|---|---|---|---|---|---|---|
| P0-1 | `nexus skills audit` CLI command with five-report layout (Budget / Descriptions / Duplicates / Unused / Roots) | I-01, Workflow | New `bin/nexus.mjs skills audit` subcommand backed by a new `core/skills/SkillAuditor.ts` | Medium | Reads `SkillCatalog` (exists), `ModelRegistry` (exists). | Low. Read-only. |
| P0-2 | Token-cost helper `tokenize(content, model)` returning `ceil(utf8_bytes / 4)` for cross-model approximation | I-04 | New `core/observability/TokenCost.ts` (sibling to `CommandCompressor.ts`) | Low | None. | Low. Reusable across the audit, the CommandCompressor, and future memory tiers. |
| P0-3 | Budget envelope: read active model's `context_window` from `ModelRegistry`, apply configurable budget percent (default 2%) | I-05 | Extend `ModelRegistry` to expose `contextWindow`; consume from `SkillAuditor` | Low | Depends on P0-2. | Low. |

### P1 -- Short-term (high value, medium effort)

| # | What | Source | Target | Effort | Dependencies | Risk |
|---|---|---|---|---|---|---|
| P1-1 | Body-similarity duplicate detection via shingling / Jaccard (configurable threshold, default 0.85) | I-08 | New `core/skills/SkillSimilarity.ts`; called by `SkillAuditor` | Medium | Independent. | Low. |
| P1-2 | Unused-skills heuristic against `~/.nexus/sessions/**/*.jsonl` over a configurable window (default 3 months) | I-10 | Extend `SkillAuditor` with a `--months` flag; reuse the session-replay reader from v1.1.0 Phase 7 | Medium | Depends on `core/sessions/` reader being importable. | **Medium**. False negatives (deleting a still-needed skill) need clear "this is heuristic, review before deleting" framing in the report. |
| P1-3 | Description-authoring skill: codify trigger-noun preservation rule (product / tool / action / object) | I-15 | New Nexus-Hub skill `skill-description-authoring` under `catalog/skills/developer-experience/` | Low | None. | Low. Pure content. |
| P1-4 | Realpath dedup across roots before audit | I-07 | One-liner in `SkillCatalog.loadFromDisk()` -- `fs.realpathSync` each root before insertion | Low | None. | Low. Defensive. |

### P2 -- Medium-term (medium value, low-to-medium effort)

| # | What | Source | Target | Effort | Dependencies | Risk |
|---|---|---|---|---|---|---|
| P2-1 | Render-line standardisation: faithful `- name: description (file: path)` format produced by both the agent loop and the auditor | I-02 | Single shared formatter in `core/skills/SkillRenderLine.ts`; both `SkillCatalog.renderForPrompt()` and `SkillAuditor` consume it | Low | None. | Low. |
| P2-2 | Render fallback ladder: full -> equal-truncate -> omitted-minimum, mirroring `core-skills/src/render.rs` | I-06 | New helper in `SkillRenderLine.ts`; only activates when budget envelope exceeded | Medium | Depends on P0-3, P2-1. | Low. |
| P2-3 | Frontmatter authoring rules surfaced as a `validate_skills` check (single-line `name` / `description`, default name from parent dir) | I-03 | Extend Nexus-Hub's existing `validate_skills.py`; this lives upstream and does not require Nexus code | Low | None (lives in Nexus-Hub). | Low. |

### P3 -- Backlog (low value or low fit)

| # | What | Source | Target | Effort | Dependencies | Risk |
|---|---|---|---|---|---|---|
| P3-1 | Root summary subcommand: "where did each skill come from, and is its root disabled" | I-01 (Root summary report) | Already 80% covered by `nexus skills list` after P0-1; if needed, add a `--by-root` flag | Low | None. | Low. Maybe redundant with P0-1. |
| P3-2 | `--deep-logs` flag scanning archived sessions | I-11 | Extension of P1-2; only worth doing if archive volumes are large | Low | Depends on P1-2. | Low. Defer until P1-2 ships. |

---

## 6. Security and Risk Assessment (MANDATORY)

Per the MCP Registry Policy decision tree in [AGENTS.md](../../../AGENTS.md), every adoption candidate that implies a new runtime dependency, outbound call, API key, or third-party data processor must be classified before it can appear in Section 7's implementation sequence.

| # | Insight | RE Classification | Internal deliverable | Risk tier | Rationale |
|---|---|---|---|---|---|
| I-01 | Five-report audit framework | `re-full` | `core/skills/SkillAuditor.ts` + `bin/nexus.mjs skills audit` | Low | 100% local file walk + computation. No outbound calls. Matches the AGENTS.md "Local-first" design principle. |
| I-02 | Render-line shape | `re-full` | `core/skills/SkillRenderLine.ts` | None | Pure string formatter, no I/O. |
| I-03 | Frontmatter discipline | `re-full` | Extension of upstream Nexus-Hub `validate_skills.py` | None | Validator already exists; this adds rules. |
| I-04 | `ceil(utf8_bytes / 4)` token cost | `re-full` | `core/observability/TokenCost.ts` | None | Trivial pure function; model-agnostic by design. |
| I-05 | Context-aware budget envelope | `re-full` | Extend `ModelRegistry` with `contextWindow` field | Low | All inputs are local (`~/.nexus/models/`). No remote model-metadata fetch. |
| I-06 | Render fallback ladder | `re-full` | Same file as I-02 | None | Pure logic. |
| I-07 | Realpath dedup | `re-full` | One-liner in `SkillCatalog.loadFromDisk()` | None | Standard `fs.realpathSync`. |
| I-08 | Body-similarity duplicate detection | `re-full` | `core/skills/SkillSimilarity.ts` (shingling + Jaccard) | Low | Local-only. No ML dependency; integer set math. |
| I-09 | Keep-priority hierarchy | `re-full` (already largely in place via `SkillProvenance.source`) | Document the precedence in `SkillCatalog` comments + audit report | None | Already implemented in spirit; this codifies. |
| I-10 | Usage-evidence log scan | `re-full` | New `core/skills/SkillUsageScanner.ts` over `~/.nexus/sessions/**/*.jsonl` | **Medium** | Local-only file scan, but the *output* (a "this skill looks unused" list) can drive irreversible deletions. Mitigation: P1-2 ships with `--suggest-only` mode and never deletes; cleanup goes through I-12's suggest-first policy. |
| I-11 | Configurable scope flags | `re-full` | CLI flag parsing in `bin/nexus.mjs` | None | Implementation detail. |
| I-12 | Suggest-first policy | `skill-native` | No new code; codify as a description-authoring norm in P1-3's skill | None | This is an LLM-instructed behaviour pattern. Nexus already practices it. |
| I-13 | Grouped-commit cleanup | `skill-native` | Already covered by existing `code-commit-workflow` skill | None | Project norm. |
| I-14 | Confirmation gate on untracked dirs | `skill-native` | Already enforced by global Critical Rules and `git-guardrails` hook | None | Already in place. |
| I-15 | Trigger-noun preservation rule | `skill-native` | New Nexus-Hub skill `skill-description-authoring` | None | LLM-instructable rule. Zero code. |

**Section 9.4-equivalent re-ordering**: every adoption candidate classifies as either `re-full` (local rebuild) or `skill-native` (zero-code skill). **No item is `vendor-intrinsic`, no item is `drop-outright`.** The cleaner's scripts themselves are not adopted -- only the algorithmic insights are. This matches the AGENTS.md MCP Registry Policy preference: "Reverse-engineer into a local internal MCP" / "LLM-native skill" wins over importing external code.

**Recommendation ordering** (drives Section 7):
1. `skill-native` items first (I-12, I-13, I-14 are already done; I-15 ships as a Hub skill with no code change).
2. `re-full` items next, sequenced by dependency (TokenCost -> ModelRegistry extension -> SkillAuditor -> body-similarity -> usage scanner).
3. No `vendor-intrinsic` candidates exist for this source.
4. No `drop-outright` candidates exist for this source. Section 8's N-list is therefore empty.

---

## 7. Implementation Sequence

Sequence follows Section 6's RE-first ordering, with P0 / P1 / P2 acting as intra-bucket priority. Each step lists its dependencies on prior steps.

### Phase A -- Skill-native wins (P1, zero code)

1. **I-15 -> P1-3**: Author `skill-description-authoring` Nexus-Hub skill encoding the trigger-noun preservation rule. Lives in `catalog/skills/developer-experience/skill-description-authoring/SKILL.md`. Ships through the standard Nexus-Hub release flow (note open gap [1.1.P3.B](../v1.2/known-gaps.md#11p3b)). **No Nexus repo change.**

### Phase B -- Foundational local utilities (P0, sequenced by dependency)

2. **P0-2 -> I-04**: Create [core/observability/TokenCost.ts](../../../core/observability/TokenCost.ts) exporting `tokenize(text: string): number`. Pure, model-agnostic.
3. **P0-3 -> I-05**: Extend [core/registry/ModelRegistry.ts](../../../core/registry/ModelRegistry.ts) with `contextWindow` field per model. Default to 272,000 when unknown (matches the cleaner's fallback).
4. **P2-1 -> I-02**: Create [core/skills/SkillRenderLine.ts](../../../core/skills/SkillRenderLine.ts) producing `- name: description (file: path)`. Wire as the single source of truth for both the audit and the agent-loop renderer (refactor `SkillCatalog.renderForPrompt()` if it exists; add it if not).
5. **P1-4 -> I-07**: Add `fs.realpathSync` dedup inside `SkillCatalog.loadFromDisk()`. One-line defensive change.

### Phase C -- The audit command (P0)

6. **P0-1 -> I-01 + I-09**: Create [core/skills/SkillAuditor.ts](../../../core/skills/SkillAuditor.ts) producing the five-report shape:
   - Skill Budget (uses Phase B steps 2, 3).
   - Description candidates (length thresholds).
   - Duplicates by name (uses existing `SkillRecord.diverged`).
   - Unused candidates (initially empty; populated by Phase D).
   - Root summary (already 80% covered by `SkillProvenance`).
7. Wire `bin/nexus.mjs skills audit` as a thin CLI shell over `SkillAuditor`.

### Phase D -- Similarity + usage detection (P1)

8. **P1-1 -> I-08**: Create [core/skills/SkillSimilarity.ts](../../../core/skills/SkillSimilarity.ts) implementing Jaccard over 5-grams of the SKILL.md body (configurable shingle size). Threshold default 0.85. Feed into the Duplicates section of the audit.
9. **P1-2 -> I-10**: Create [core/skills/SkillUsageScanner.ts](../../../core/skills/SkillUsageScanner.ts) over `~/.nexus/sessions/**/*.jsonl`. Heuristic patterns: skill `id` mentions, `SKILL.md` path mentions, hook-bus skill-load events (Nexus has a HookBus -- a richer signal than Codex's text-only logs). Add `--months <N>` flag.

### Phase E -- Render-budget enforcement (P2)

10. **P2-2 -> I-06**: Add fallback ladder to `SkillRenderLine.ts`. Only activates when budget envelope is exceeded; emits a warning to the trace dashboard.

### Phase F -- Upstream hygiene (P2)

11. **P2-3 -> I-03**: In Nexus-Hub, extend `validate_skills.py` to enforce single-line `name` / `description` and default-name-from-parent-dir. Lives outside this repo.

**Dependency graph** (Phase A is independent of Phases B-F):

```
A1 (P1-3 skill)               [independent]

B2 (TokenCost) -> B3 (ModelRegistry.contextWindow) -> B4 (SkillRenderLine) -> C6 (SkillAuditor) -> E10 (fallback ladder)
                                                        |                          |
                                                        B5 (realpath dedup)        D8 (SkillSimilarity)
                                                                                    D9 (SkillUsageScanner)

F11 (Hub validate_skills)     [independent, upstream]
```

Minimum viable shipping increment: Phase A + Phase B + Phase C (steps 1-7). That gives a working `nexus skills audit` against the Budget, Descriptions, name-duplicate, and Roots reports -- four of the five report sections. Phase D unlocks the fifth (Unused) and the deeper duplicate detection. Phases E and F are quality refinements.

---

## 8. Risks and Considerations

### Adoption-wide risks

- **Heuristic-driven deletions (I-10)**: The "unused candidates" report is a heuristic. False negatives -- skills that genuinely matter but happen not to have triggered in the scan window -- can lead a user to delete still-needed content. Mitigation is built into the cleaner's own design (I-12: "suggest first; edit only when the user asks") and reinforced by the existing global Critical Rule on destructive git operations. The audit report must label each unused candidate as "candidate, not verdict."
- **Render-line drift (I-02, I-06)**: If the agent loop and the auditor compute the render shape independently, the audit's token math drifts from reality. **Mitigation**: Phase B step 4 is explicitly a single-source-of-truth refactor. Do not skip it.
- **Symlink semantics on Windows (I-07)**: `fs.realpathSync` is well-behaved on Windows for NTFS junctions and symlinks, but the Nexus user base also includes Windows hosts. Add a unit test that covers `junction`-flavoured symlinks; do not assume POSIX-only realpath behaviour.
- **Token-cost approximation (I-04)**: `ceil(utf8_bytes / 4)` is a known under-estimator for tokenisers that handle CJK or emoji aggressively (GPT-style BPE can produce 2-3 tokens per CJK character). For Nexus's primary tokenizers (Gemma 4, Llama 3, Qwen 2.5 Coder), the approximation is reasonable. The audit report should label its budget numbers as approximate.

### Compatibility with existing Nexus norms

- **No conflict with v1.2.0 Phase 7 token-usage benchmark**: The benchmark measured tool-call traffic on the Coding pillar. The skills audit measures the *skill catalog's* contribution to prompt budget. The two are complementary; the audit output can be cross-referenced against the benchmark.
- **No conflict with `nexus skills sync` / `nexus skills list`**: `audit` is additive; it reads the same `SkillCatalog` and produces a report. It does not mutate `~/.nexus/skills/`.
- **Aligns with the Hooks-over-Prompts policy** (v1.2.0 Phase 1, comparison item 21): If `nexus skills audit` becomes recurring, it can be wired through a lifecycle hook (`lifecycle.session.reflection` at end-of-session, added in Phase 5) rather than a prompt instruction.

### Items explicitly NOT recommended for adoption (security / policy reasons)

**None.** Every insight from Section 3 classifies as `re-full` or `skill-native` per Section 6. There is no `drop-outright` candidate from this source -- the cleaner's design is local-only, suggest-first, and confirmation-gated, which already matches the AGENTS.md MCP Registry Policy and the Critical Rules. The N-item list for this comparison is empty.

### What is explicitly NOT being adopted (different reason)

- **The cleaner's script itself** (`skills/skill-cleaner/scripts/skill-cleaner.ts`). The script is Codex-specific (reads `~/.codex/models_cache.json`, `~/.codex/history.jsonl`, `~/.codex/sessions/`). Reverse-engineering its **algorithms** (token math, render ladder, similarity check, log-scan heuristics) into Nexus-native modules is the recommended path; copying the script verbatim would force Nexus to ape Codex's storage layout. This is consistent with the MCP Registry Policy's "Reverse-engineer into a local internal" bucket.
- **The 2% budget percent default**: Adopt the *formula* (configurable percent of context window), not the *constant*. Nexus's `ModelRegistry` will surface its own per-model default and the audit's `--budget-percent` flag will override.

---

## Quality Checks

- [x] Source acquired (verbatim SKILL.md via raw GitHub URL).
- [x] Current project fully analyzed before comparison (`SkillCatalog`, `DevAIHubSyncer`, `PromptInjectionScanner`, `bin/nexus.mjs`, `docs/versions/v1/v1.2.0/known-gaps.md`).
- [x] Every relevance claim cites a file path or article section.
- [x] Adoption items name concrete target file paths.
- [x] Effort estimates anchored to the existing `core/skills/` and `bin/nexus.mjs` surfaces.
- [x] Section 6 Security and Risk Assessment present; every Section 3 insight has an RE classification and a risk tier.
- [x] MCP Registry Policy cited; no item introduces a new outbound call, API key, third-party processor, or new runtime dependency.
- [x] Section 8 N-item block addressed (empty -- no `drop-outright` candidates).
