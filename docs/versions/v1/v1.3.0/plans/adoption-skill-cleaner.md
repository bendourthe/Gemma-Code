# Plan -- Skill-Cleaner Adoption (token-budget audit for Nexus-Hub's skill catalog)

**Project**: Nexus
**Version**: v1.3.0 (opens the v1.3.0 cycle; relocated from v1.2.0 after the v1.2.0 cycle had already closed all seven phases on 2026-05-28; derived from a single-source comparison published 2026-05-28)
**Slug**: adoption-skill-cleaner
**Plan Type**: Feature / Enhancement (adoption of an external skill-audit technique)
**Source comparison**: [../comparison-skill-cleaner.md](../comparison-skill-cleaner.md)
**Scope filter**: all (P0 + P1 + P2 + P3 -- 9 items)
**Reverse-engineer-first**: true
**Created**: 2026-05-28
**Goal**: Adopt the nine items from the skill-cleaner comparison into Nexus -- shipping one skill-native authoring rule first, then a sequence of internal re-engineered modules culminating in a working `nexus skills audit` CLI command that produces the five-report layout (Budget / Descriptions / Duplicates / Unused / Roots) against Nexus-Hub's 213-skill catalog.

## Overview

This plan operationalizes the adoption set surfaced in [comparison-skill-cleaner.md](../comparison-skill-cleaner.md). One external source was scanned: the `skill-cleaner` SKILL.md authored by Peter Steinberger in [steipete/agent-scripts](https://github.com/steipete/agent-scripts/blob/main/skills/skill-cleaner/SKILL.md). Fifteen actionable insights were extracted; eight are missing from Nexus, three are partially implemented, and four are already in force as project norms. Nine adoption items were retained: three P0, four P1, two P2, two P3. **No item classifies as `vendor-intrinsic` or `drop-outright`** -- every retained item reverse-engineers cleanly into Nexus's existing `core/skills/`, `core/registry/`, and `bin/nexus.mjs` surfaces, or ships as a zero-code skill in Nexus-Hub.

Phase sequencing follows the MCP Registry Policy decision tree (reverse-engineer-first). See [Section 6 of the source comparison](../comparison-skill-cleaner.md#6-security-and-risk-assessment-mandatory) for the ordering rationale. **Phase 1 ships the one skill-native item first** to seed the trigger-noun-preservation rule that subsequent description-compaction work will rely on; **Phase 2 lands the four foundational local utilities** in parallel; **Phase 3 wires the `nexus skills audit` CLI command** that consumes them; **Phase 4 adds the similarity and usage-evidence detectors** that complete the five-report shape; **Phase 5 layers the render-budget fallback ladder** on top; **Phase 6 lands the P2 upstream hygiene work in Nexus-Hub and the P3 CLI flags**; **Phase 7 is stabilization plus a benchmark run** against the live 213-skill catalog.

**Carryforward note**: This plan opens the v1.3.0 cycle, forward from the v1.2.0 closure on 2026-05-28 (all seven phases of [adoption-ecosystem-2026-05.md](../../v1.2.0/plans/adoption-ecosystem-2026-05.md) landed in a single day; see [docs/versions/v1/v1.2.0/known-gaps.md](../../v1.2.0/known-gaps.md) Phase 7 ledger). The plan was originally drafted as a second v1.2.0 adoption track, but since the v1.2.0 cycle had already finalized its seven-phase scope, the plan was relocated here to open v1.3.0 cleanly. Prior-version open known-gaps from [docs/versions/v1/v1.2.0/known-gaps.md](../../v1.2.0/known-gaps.md) (entries such as `1.1.P2.A`, `1.1.P3.B`, `1.3.P2.C`, and the `2.4.P2.E` / `2.4.P3.F` cluster) are **not re-ingested into this plan's scope** because they are unrelated to the skill-cleaner adoption set; the v1.3.0 cycle-opening plan (when authored) should ingest them per [generate-plan Step 0.6](../../../../../catalog/skills/workflow/generate-plan/SKILL.md). This plan's Phase 7 known-gaps closure (sub-task 7.3) creates [docs/versions/v1/v1.3.0/known-gaps.md](../known-gaps.md) if absent and appends this plan's own adoption ledger.

**Success looks like**: (1) `node bin/nexus.mjs skills audit` runs cleanly against Nexus-Hub's full 213-skill catalog and emits all five report sections; (2) the Budget report shows the catalog's prompt-budget consumption against the active model's `context_window` (default 2%); (3) Duplicate detection surfaces both same-name (`SkillRecord.diverged`-driven) and content-similarity duplicates above the configurable Jaccard threshold; (4) Unused detection scans `~/.nexus/sessions/**/*.jsonl` over a configurable window and labels candidates as "candidate, not verdict" with explicit human-approval framing; (5) the new `skill-description-authoring` Hub skill loads via `nexus skills list` and is consumable by the Coding pillar; (6) the v1.2.0 Phase 7 token-usage benchmark workflow (referenced from [../../v1.2.0/benchmarks/coding-pillar-token-usage-2026-05-26.md](../../v1.2.0/benchmarks/coding-pillar-token-usage-2026-05-26.md)) gains a sibling benchmark under `docs/versions/v1/v1.3.0/benchmarks/` for skills-audit runtime + catalog size impact.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

No constitution file found at docs/versions/v1/v1.3.0/constitution.md - skipping check. Recommend running /constitution to establish project principles.

## Phases at a Glance

| Phase | Title | Outcome |
|-------|-------|---------|
| 1 | Skill-native authoring rule | `skill-description-authoring` Hub skill ships with the trigger-noun preservation rule (product / tool / action / object) |
| 2 | Foundational local utilities | `TokenCost.ts`, `ModelRegistry.contextWindow`, `SkillRenderLine.ts`, and `SkillCatalog` realpath dedup land in parallel |
| 3 | Skills audit command | `SkillAuditor.ts` + `bin/nexus.mjs skills audit` produces four of five reports against the live catalog |
| 4 | Similarity + usage detection | `SkillSimilarity.ts` (Jaccard over shingles) and `SkillUsageScanner.ts` (session log scan) complete the Duplicates and Unused reports |
| 5 | Render-budget enforcement | Render fallback ladder (full -> equal-truncate -> omit-min) in `SkillRenderLine.ts` activates when budget envelope is exceeded |
| 6 | Upstream hygiene + P3 backlog | Nexus-Hub `validate_skills.py` enforces single-line `name`/`description`; CLI gains `--deep-logs` and `--by-root` flags |
| 7 | Stabilization & benchmarks | Audit-runtime benchmark on 213-skill catalog, documentation refresh, known-gaps closure for the adoption set |

---

## Phase 1: Skill-Native Authoring Rule

**Goal**: Ship the one zero-code skill-native item first so the trigger-noun preservation rule is in force before any description-compaction work (Phase 3 onwards) lands.
**Prerequisites**: None.
**Stability Gate**: `skill-description-authoring` appears in `nexus skills list` after the upstream Nexus-Hub release (or, in the interim, the syncer's `buildManifest` walk over a local Nexus-Hub checkout returns the new skill).

### Sub-tasks

#### 1.1 -- Author the `skill-description-authoring` Nexus-Hub skill

- [x] T001 Create skill at `catalog/skills/developer-experience/skill-description-authoring/SKILL.md` in the Nexus-Hub repo

**Objective**: Codify the trigger-noun preservation rule (product / tool / action / object) plus the supporting authoring guidance (single-line `name`, single-line `description`, no marketing prose) as a portable Nexus-Hub skill so any skill author -- in Nexus-Hub or downstream -- can apply it consistently.

**Prompt**:
> Adopt the description-authoring rule from the skill-cleaner comparison ([../comparison-skill-cleaner.md](../comparison-skill-cleaner.md), insight I-15 and supporting I-03). Source URL: https://github.com/steipete/agent-scripts/blob/main/skills/skill-cleaner/SKILL.md. Create a new skill at `catalog/skills/developer-experience/skill-description-authoring/SKILL.md` in the [Nexus-Hub repo](https://github.com/bendourthe/Nexus-Hub) (sibling of Nexus, located at `../Nexus-Hub/` relative to this repo). The skill must codify three authoring rules: (a) descriptions are single-line, sanitized (no embedded newlines, no trailing whitespace, no curly quotes / em-dashes per the AGENTS.md ASCII-only convention); (b) descriptions preserve the four trigger noun categories that drive matching -- **product** (what the skill is about, e.g. "skills", "memory", "code-graph"), **tool** (the action verb's object, e.g. "skills", "tests", "docs"), **action** (the imperative verb, e.g. "audit", "generate", "compress"), **object** (the artifact produced, e.g. "report", "SKILL.md", "manifest"); (c) `name:` defaults to the parent directory name if omitted. Include three worked examples: a *good* description, an *over-long* description with a compaction diff, and a *no-trigger-nouns* description with a rewrite. Reference [Nexus-Hub's existing `validate_skills.py`](https://github.com/bendourthe/Nexus-Hub) as the eventual enforcement point (Phase 6 of this plan). **Do not** import the skill-cleaner's analyzer script -- only the authoring rule. Add the skill front matter with `name: skill-description-authoring`, `category: developer-experience`, and a single-line description that itself follows the rule. Cite the source comparison report inside the skill's "Source" section. After committing in the Nexus-Hub repo, run `node bin/nexus.mjs skills sync --dry-run` from this repo to verify the skill enumerates (full sync against an upstream release blocks on the open known-gap [1.1.P3.B](../../v1.2.0/known-gaps.md#11p3b-new-nexus-hub-skills-require-an-upstream-release-to-flow-through-nexus-skills-sync-df-p3)).

---

#### 1.2 -- Phase 1 test pass and stabilization

- [x] T002 Validate the new Hub skill against `python scripts/validate_skills.py` in the Nexus-Hub repo

**Objective**: Confirm the new skill parses cleanly under Nexus-Hub's existing validator before downstream phases consume it.

**Prompt**:
> In the Nexus-Hub repo (`../Nexus-Hub/` relative to this repo), run `python scripts/validate_skills.py` and confirm the new `skill-description-authoring` skill passes all existing checks. Then run the Nexus syncer's `buildManifest` walk against the local Nexus-Hub catalog (the test scaffold exists in `tests/skills/devai-hub-syncer.test.ts`) and confirm the new skill appears in the resulting manifest (count should rise to 214). Do not run `make build-catalog` (that triggers the wholesale catalog index rebuild blocked by known-gap [1.1.P2.A](../../v1.2.0/known-gaps.md#11p2a-nexus-hub-catalog-index-dataskillsjson--skill_indexmd-rebuild-deferred-wn-p2); the catalog rebuild remains a Nexus-Hub-side hygiene commit). After both checks pass, run `/generate-session-history` to document Phase 1.

---

### Phase 1 Exit Checklist

- [x] T001 completed (skill committed in Nexus-Hub)
- [x] T002 completed (validator + manifest walk pass)
- [x] Session history generated
- [x] Ready to advance to Phase 2

---

## Phase 2: Foundational Local Utilities

**Goal**: Land the four small, independent modules that Phase 3's audit command will compose. All four can be authored in parallel because they touch separate files and have no inter-dependencies.
**Prerequisites**: Phase 1 complete (the authoring rule informs how the auditor will report on long descriptions).
**Stability Gate**: All four modules ship with unit tests; `npm run build` and `npm run test` pass; no new lints fire under the existing ESLint + Prettier config.

### Sub-tasks

#### 2.1 -- Create `core/observability/TokenCost.ts`

- [x] T003 [P] Create the model-agnostic token-cost helper at core/observability/TokenCost.ts

**Objective**: Provide a single `tokenize(text: string): number` export returning `Math.ceil(utf8ByteLength(text) / 4)` that future consumers (the auditor, the existing `CommandCompressor`, future memory tiers) can reuse without each rolling its own approximation.

**Prompt**:
> Create `core/observability/TokenCost.ts` exporting a single function `tokenize(text: string): number` that returns `Math.ceil(Buffer.byteLength(text, "utf8") / 4)`. This implements insight I-04 from [../comparison-skill-cleaner.md](../comparison-skill-cleaner.md) (the `ceil(utf8_bytes / 4)` formula from skill-cleaner's `Analyzer Notes`). Add a JSDoc note explaining that the formula is a model-agnostic *under-estimator* for CJK-heavy or emoji-heavy text and is correct within ~10% for the BPE tokenizers used by Nexus's primary local models (Gemma 4, Llama 3, Qwen 2.5 Coder). Add a sibling unit test at `tests/observability/TokenCost.test.ts` covering: ASCII-only text, multi-byte UTF-8 (Latin accents), and an emoji + CJK case. The module exports no other functions; if the auditor or `CommandCompressor` ever needs per-tokenizer fidelity, a separate `TokenCostExact.ts` would be the right home. Do not modify `CommandCompressor.ts` in this sub-task -- the consumer wiring happens in Phase 3 (T009).

---

#### 2.2 -- Extend `ModelRegistry` with `contextWindow`

- [x] T004 [P] Add the contextWindow field to core/registry/ModelRegistry.ts

**Objective**: Surface the active model's context-window size so the auditor can compute a configurable budget envelope (default 2%) per insight I-05.

**Prompt**:
> Extend [core/registry/ModelRegistry.ts](../../../../../core/registry/ModelRegistry.ts) to add a `contextWindow: number` field on every `ModelRecord` (or whatever the existing model record type is called -- read the file first). The field default is `272_000` when unknown, matching skill-cleaner's fallback for GPT-5.5; for the local models Nexus supports today the recommended seed values are: Gemma 4 = `128_000`, Llama 3.1 8B = `131_072`, Llama 3.2 1B/3B = `128_000`, Qwen 2.5 Coder = `131_072`. Source the values from each model's published spec; cite the source URL in a JSDoc comment on each seed. Add a getter `getActiveContextWindow(): number` returning the active model's `contextWindow` (or the default when no model is active). Add a sibling unit test at `tests/registry/ModelRegistry.context-window.test.ts` verifying the default fallback, per-model overrides, and the getter behavior. **Do not** add a network fetch of model metadata -- per [README.md](../../../../../README.md) "Privacy by construction", all model facts stay local. This task is independent of T003; do not import `TokenCost` here.

---

#### 2.3 -- Create `core/skills/SkillRenderLine.ts`

- [x] T005 [P] Create the single-source-of-truth render formatter at core/skills/SkillRenderLine.ts

**Objective**: Produce the canonical `- name: description (file: path)` line shape (insight I-02) that both the agent loop and the future `SkillAuditor` will consume, so the auditor's token math stays faithful to what the model actually sees.

**Prompt**:
> Create `core/skills/SkillRenderLine.ts` exporting `renderSkillLine(skill: SkillRecord): string` that returns the exact format `- ${name}: ${description} (file: ${path})` (no trailing whitespace, no embedded newlines -- if a description sneaks in a newline, replace with a single space). This implements insight I-02 from [../comparison-skill-cleaner.md](../comparison-skill-cleaner.md). Read [core/skills/SkillCatalog.ts](../../../../../core/skills/SkillCatalog.ts) to confirm the `SkillRecord` shape (it carries `id`, `displayName`, `path` -- map `id` -> `name` for the rendered shape, and pull `description` from the parsed `frontmatter` field on the `Skill` type, falling back to an empty string when absent). Export a second function `renderSkillBlock(skills: readonly SkillRecord[]): string` that joins lines with `\n`. Add a sibling unit test at `tests/skills/SkillRenderLine.test.ts` covering: a normal skill, a skill with a newline in the description (must be flattened), a skill with no description in frontmatter (must render with an empty description segment), and the `renderSkillBlock` join. This sub-task does *not* implement the fallback ladder (full -> truncate -> omit) -- that is Phase 5 (T015). Keep this file under 80 lines.

---

#### 2.4 -- Realpath dedup in `SkillCatalog.loadFromDisk`

- [x] T006 [P] Add fs.realpathSync dedup before insertion in core/skills/SkillCatalog.ts

**Objective**: Prevent symlinked skill roots (e.g. `~/.nexus/skills/devai-hub/<tag>/` pointing into a working Nexus-Hub checkout) from registering the same skill twice under different paths, per insight I-07.

**Prompt**:
> In [core/skills/SkillCatalog.ts](../../../../../core/skills/SkillCatalog.ts), locate the disk-scan code path that walks the configured skill roots (likely a method named `loadFromDisk`, `scanRoots`, or similar -- read the file first to confirm). Before inserting each discovered skill into the in-memory map, resolve its `path` through `fs.realpathSync(path)` and use the resolved path as the dedup key. When two different *logical* paths resolve to the same *physical* path, keep the entry whose `SkillProvenance.source` ranks highest in this order: `builtin` > `user` > `devai-hub` (matching insight I-09's keep-priority hierarchy). Emit a `TelemetryBus` event of type `skills.dedup` carrying both the kept and dropped logical paths so the future audit's `Root summary` report can list dedups. Add a sibling unit test at `tests/skills/SkillCatalog.realpath-dedup.test.ts` using a temp directory + symlink fixture (skip the test on Windows hosts that lack symlink-create privileges -- gate with `process.platform === "win32" && !isAdmin()` and `it.skip`). Do not break any existing `SkillCatalog` test. This sub-task is independent of T003, T004, and T005.

---

#### 2.5 -- Phase 2 test pass and stabilization

- [x] T007 Run npm run test and npm run build to confirm all four foundational modules integrate cleanly

**Objective**: Confirm the four new modules compile together, all unit tests pass, and no cross-module imports leak in unintended directions before Phase 3 builds on top.

**Prompt**:
> Run `npm run build` followed by `npm run test`. All tests added in T003-T006 must pass; no pre-existing test may regress. Run `npm run lint` (or whatever the project's lint script is named -- check [package.json](../../../../../package.json)) and confirm zero new warnings. Run `npm run check-architecture` (or the dependency-cruiser equivalent referenced in [configs/dependency-cruiser.cjs](../../../../../configs/dependency-cruiser.cjs)) to confirm the new `core/observability/TokenCost.ts` and `core/skills/SkillRenderLine.ts` modules respect the boundary rule (`core/**` must not import from `modules/**`). After the gate passes, run `/generate-session-history` to document Phase 2.

---

### Phase 2 Exit Checklist

- [x] T003 completed (TokenCost.ts + test)
- [x] T004 completed (ModelRegistry.contextWindow + test)
- [x] T005 completed (SkillRenderLine.ts + test)
- [x] T006 completed (realpath dedup + test)
- [x] T007 completed (full build + test gate)
- [x] Session history generated
- [x] Ready to advance to Phase 3

---

## Phase 3: Skills Audit Command

**Goal**: Wire the four foundational utilities into a working `nexus skills audit` CLI command that produces four of the five report sections (Budget, Descriptions, name-Duplicates, Roots). Content-similarity duplicates and unused-candidates land in Phase 4.
**Prerequisites**: Phase 2 complete (T003-T007).
**Stability Gate**: `node bin/nexus.mjs skills audit` runs cleanly against the live Nexus skill catalog and emits a non-empty, well-formatted report.

### Sub-tasks

#### 3.1 -- Create `core/skills/SkillAuditor.ts`

- [x] T008 Create the auditor module at core/skills/SkillAuditor.ts

**Objective**: Compose `TokenCost`, `ModelRegistry`, `SkillRenderLine`, and the existing `SkillCatalog` into a `SkillAuditor` that produces the five-report shape from insight I-01 (with sections D and E placeholders pending Phase 4).

**Prompt**:
> Create `core/skills/SkillAuditor.ts` exporting an `auditSkills(opts?: SkillAuditOptions): Promise<SkillAuditReport>` function. The options shape:
> ```ts
> interface SkillAuditOptions {
>   contextTokens?: number;       // override ModelRegistry.getActiveContextWindow()
>   budgetPercent?: number;       // default 2 (mirroring skill-cleaner's 2% envelope)
>   maxDescriptionTokens?: number; // default 50 -- triggers a Descriptions-candidate row above this
>   months?: number;              // window for the Unused report (Phase 4 wiring; accepted now but no-op)
> }
> interface SkillAuditReport {
>   budget: { contextTokens: number; budgetTokens: number; usedTokens: number; pressurePct: number };
>   descriptions: Array<{ id: string; lineTokens: number; description: string }>;
>   duplicates: { byName: Array<{ name: string; sources: string[] }>; bySimilarity: [] };  // bySimilarity wired in T013
>   unused: [];  // wired in T013
>   roots: Array<{ root: string; source: SkillProvenance["source"]; skillCount: number }>;
> }
> ```
> Read [core/skills/SkillCatalog.ts](../../../../../core/skills/SkillCatalog.ts) for the catalog API; use the existing `SkillRecord.diverged` field plus the catalog's source enumeration to build the `duplicates.byName` and `roots` reports. Use `renderSkillLine` from T005 + `tokenize` from T003 to compute per-line token costs. Read `getActiveContextWindow()` from T004 to derive the default budget envelope. The `pressurePct` is `(usedTokens / budgetTokens) * 100` clamped to a two-decimal float. Sort `descriptions` candidates by `lineTokens` descending; cap the output at the top 20 rows (configurable later). Implements insights I-01, I-05, I-06 (placeholder pending T015), I-09 (precedence already encoded by `SkillProvenance`). Add a sibling unit test at `tests/skills/SkillAuditor.test.ts` using a small in-memory fixture catalog (5-10 skills) covering: budget math, descriptions ranking, name-duplicate detection across two synthetic sources, and the roots roll-up. Do not implement `SkillSimilarity` or `SkillUsageScanner` here -- leave their result arrays empty and add a `// TODO(phase-4)` comment at each gap. Keep the file under 250 lines.

---

#### 3.2 -- Wire `bin/nexus.mjs skills audit` CLI

- [x] T009 Add the audit subcommand to bin/nexus.mjs

**Objective**: Provide the user-facing CLI entry point so `node bin/nexus.mjs skills audit` produces a human-readable report on stdout; JSON output via `--json` for tooling.

**Prompt**:
> Extend [bin/nexus.mjs](../../../../../bin/nexus.mjs) to add a new `skills audit` subcommand. Read the existing file first to mirror the argument-parsing pattern used by `skills sync` and `skills list`. The subcommand accepts these flags (matching insight I-11 minus the P3 flags which land in Phase 6): `--context-tokens <N>`, `--budget-percent <N>`, `--months <N>` (accepted but no-op until Phase 4), `--json` (machine-readable output). The default output is human-readable Markdown with the five section headings in this order: `## Skill Budget`, `## Description candidates`, `## Duplicates`, `## Unused candidates`, `## Root summary`. The Duplicates section has two sub-sections (`### By name`, `### By similarity`) but the second is a placeholder labeled `_(populated by phase 4)_` until T013 lands. The Unused section is similarly labeled `_(populated by phase 4)_`. Call `auditSkills` from T008, format the report, and write to stdout. On error (e.g. no skills loaded), exit non-zero with a clear message. Add a sibling integration test at `tests/integration/skills-audit-cli.test.ts` invoking the CLI as a child process against a fixture skills root and asserting the five section headings appear in the output. **Do not** modify `~/.nexus/` paths or any persisted state; audit is read-only by design (insight I-12).

---

#### 3.3 -- Phase 3 test pass and stabilization

- [x] T010 Confirm npm run build and npm run test pass; smoke-run skills audit against the live catalog

**Objective**: Verify the audit command emits a usable report against the real Nexus skill catalog (not just the in-memory test fixture) before Phase 4 layers similarity and usage detection on top.

**Prompt**:
> Run `npm run build` followed by `npm run test`. Then run `node bin/nexus.mjs skills audit` against the live catalog on this host. Confirm the five section headings appear, the Budget section reports a non-zero `usedTokens`, the Descriptions section lists at least one candidate (Nexus-Hub has ~213 skills -- some long descriptions are inevitable), the Duplicates `By name` sub-section either lists name-collisions or reports "none found", and the Root summary lists each loaded skill root with its `SkillProvenance.source`. The `By similarity` and `Unused candidates` sections should display the `_(populated by phase 4)_` placeholder. Capture the output for the Phase 7 benchmark baseline. After verification, run `/generate-session-history` to document Phase 3.

---

### Phase 3 Exit Checklist

- [x] T008 completed (SkillAuditor.ts + test)
- [x] T009 completed (CLI wiring + integration test)
- [x] T010 completed (live-catalog smoke run + baseline captured)
- [x] Session history generated
- [x] Ready to advance to Phase 4

---

## Phase 4: Similarity + Usage Detection

**Goal**: Complete the five-report shape by adding content-similarity duplicate detection (insight I-08) and heuristic usage-evidence scanning against session logs (insight I-10). Both detectors are independent modules wired into the existing `SkillAuditor`.
**Prerequisites**: Phase 3 complete (T008-T010).
**Stability Gate**: `skills audit` populates the `By similarity` and `Unused candidates` sections with real data; no false-positive deletions are recommended (audit remains "suggest first").

### Sub-tasks

#### 4.1 -- Create `core/skills/SkillSimilarity.ts`

- [x] T011 [P] Create the Jaccard-over-shingles similarity detector at core/skills/SkillSimilarity.ts

**Objective**: Detect near-duplicate skills whose names differ but whose bodies overlap above a configurable Jaccard threshold (default 0.85), per insight I-08.

**Prompt**:
> Create `core/skills/SkillSimilarity.ts` exporting two functions: `shingles(text: string, k = 5): Set<string>` returning the set of `k`-character shingles over the input (lowercased, whitespace-collapsed to single spaces); and `jaccard(a: Set<string>, b: Set<string>): number` returning `|a ∩ b| / |a ∪ b|` (return `0` when both sets are empty). Add a third function `findSimilarPairs(skills: ReadonlyArray<Skill>, threshold = 0.85): Array<{ a: string; b: string; score: number }>` that returns every pair of skill IDs with Jaccard >= `threshold`, computed against the skill body (not the description) after the Markdown body has been normalized (strip code blocks, strip frontmatter, collapse whitespace). Sort the result by descending `score`. Implementation note: for a 213-skill catalog this is O(N^2) = ~22,000 comparisons -- acceptable without indexing; if catalog size doubles, MinHash can be added later. Add a sibling unit test at `tests/skills/SkillSimilarity.test.ts` covering: identical bodies (score 1.0), disjoint bodies (score 0.0), and a near-duplicate pair (score >0.85). This sub-task is independent of T012 -- both can be authored in parallel.

---

#### 4.2 -- Create `core/skills/SkillUsageScanner.ts`

- [x] T012 [P] Create the session-log usage scanner at core/skills/SkillUsageScanner.ts

**Objective**: Determine which skills have not been invoked within a configurable window, per insight I-10, by scanning Nexus's own session-replay logs (richer than skill-cleaner's text-only `~/.codex/sessions/` because Nexus has structured `HookBus` skill-load events).

**Prompt**:
> Create `core/skills/SkillUsageScanner.ts` exporting `scanUsage(opts: { skillsRoot: string; sessionsRoot?: string; months?: number }): Promise<Map<string, { lastSeen: Date | null; matchCount: number }>>`. Default `sessionsRoot` to `~/.nexus/sessions/`; default `months` to 3. Walk every `*.jsonl` file under `sessionsRoot` whose mtime falls inside the window. For each line, look for three signals (in order of fidelity): (a) **HookBus event** `skill.loaded` or `skill.invoked` with a `skillId` field -- highest fidelity; (b) plain-text mention of the skill's `id` (full slug, surrounded by word boundaries) -- medium fidelity; (c) mention of the skill's `SKILL.md` absolute path -- lowest fidelity, included for files copy-pasted into prompts. For each skill ID seen, record the latest event timestamp and the cumulative match count. The result Map contains an entry for *every* skill in the catalog (even those with `matchCount: 0`), so the auditor can list never-invoked skills directly. **Mandatory framing**: the auditor will label these as "candidates, not verdicts" per insight I-12; this scanner returns counts only, it does not propose deletions. Add a sibling integration test at `tests/integration/SkillUsageScanner.test.ts` using a temp `sessions/` fixture with three synthetic JSONL files exercising all three signal types. This sub-task is independent of T011.

---

#### 4.3 -- Integrate similarity + usage results into `SkillAuditor`

- [x] T013 Wire SkillSimilarity and SkillUsageScanner into core/skills/SkillAuditor.ts

**Objective**: Populate the previously-stubbed `duplicates.bySimilarity` and `unused` sections of the `SkillAuditReport` and surface the new `--months` flag end-to-end through `bin/nexus.mjs`.

**Prompt**:
> Extend [core/skills/SkillAuditor.ts](../../../../../core/skills/SkillAuditor.ts) (created in T008). In `auditSkills`: (a) after loading the catalog, call `findSimilarPairs` from T011 with the configured threshold (default 0.85, exposed via `SkillAuditOptions.similarityThreshold`); place results in `report.duplicates.bySimilarity` sorted by descending score; (b) call `scanUsage` from T012 with the configured `months` window; for each skill with `matchCount === 0`, append a row to `report.unused` carrying the skill ID, last-seen timestamp (null), and a `confidence: "low" | "medium" | "high"` label derived from the months-window age (more confidence for longer windows). The `unused` section must include the framing string: `"Heuristic: these skills have no recent invocation evidence. Review before deleting -- false negatives are possible (insight I-12)."` Update [bin/nexus.mjs](../../../../../bin/nexus.mjs) (T009) so the `--months` flag passes through end-to-end. Extend `tests/skills/SkillAuditor.test.ts` (T008) with two new cases: one where two synthetic skills are near-duplicates (bySimilarity populated), and one where a skill has zero usage signals (unused populated with framing string). The "suggest first" framing is testable via string-presence assertion.

---

#### 4.4 -- Phase 4 test pass and stabilization

- [x] T014 Confirm npm run build and npm run test pass; smoke-run skills audit with similarity + usage populated

**Objective**: Verify the full five-report layout works against the live catalog and that no part of the audit output suggests destructive action without human approval.

**Prompt**:
> Run `npm run build` followed by `npm run test`. Then run `node bin/nexus.mjs skills audit --months 3` against the live catalog. Confirm: (a) the `By similarity` sub-section either lists candidate pairs or reports "no near-duplicates above threshold 0.85"; (b) the `Unused candidates` section lists zero-evidence skills with the mandatory framing string visible; (c) no row in any section reads as a command or imperative ("delete X", "remove Y") -- everything is a *candidate* or a *suggestion*. Manually scan the top three `Unused candidates` and verify they are plausibly inactive (not, say, a skill the user invoked yesterday -- which would indicate a scanner bug). After verification, run `/generate-session-history` to document Phase 4.

---

### Phase 4 Exit Checklist

- [x] T011 completed (SkillSimilarity.ts + test)
- [x] T012 completed (SkillUsageScanner.ts + integration test)
- [x] T013 completed (auditor integration + CLI flag pass-through)
- [x] T014 completed (live-catalog smoke run; "suggest first" framing verified)
- [x] Session history generated
- [x] Ready to advance to Phase 5

---

## Phase 5: Render-Budget Enforcement

**Goal**: Add the render fallback ladder (full descriptions -> equal truncation -> omitted-minimum-lines) from insight I-06 to `SkillRenderLine.ts`, so when the loaded skill set exceeds the budget envelope the agent's system prompt degrades gracefully instead of silently truncating.
**Prerequisites**: Phase 4 complete (T011-T014). The fallback ladder depends on having a working budget envelope computation (T004) and a working render formatter (T005).
**Stability Gate**: Unit tests cover all three ladder rungs; the agent loop's render path consumes the new helper without behavior change when below budget.

### Sub-tasks

#### 5.1 -- Add the fallback ladder to `SkillRenderLine.ts`

- [x] T015 Extend core/skills/SkillRenderLine.ts with the budget-driven fallback ladder

**Objective**: Implement the three-rung degradation from full descriptions to equal truncation to omitted-minimum-lines, mirroring `core-skills/src/render.rs`'s logic (the article references this Rust file as the canonical source).

**Prompt**:
> Extend [core/skills/SkillRenderLine.ts](../../../../../core/skills/SkillRenderLine.ts) (created in T005) with `renderSkillBlockWithinBudget(skills: readonly SkillRecord[], budgetTokens: number): { lines: string; omittedCount: number; rung: "full" | "truncated" | "omitted" }`. Algorithm: (1) try the full block from T005 -- if `tokenize(full) <= budgetTokens`, return it with `rung: "full"`; (2) else compute the average tokens-per-description that would fit, truncate every description to that length (preserve the first sentence when possible -- break at the first `. ` after the trigger noun cluster), re-render, and if it fits return with `rung: "truncated"`; (3) else drop the lowest-priority skills (by `SkillProvenance.source` precedence from insight I-09: drop `devai-hub` before `user` before `builtin`) until the remainder fits at *full* description; return with `rung: "omitted"` and `omittedCount` set to the number dropped. **Do not** truncate a skill's `name` or `path` -- these are matching triggers and must stay intact (insight I-15). Add a sibling unit test at `tests/skills/SkillRenderLine.fallback.test.ts` covering all three rungs and the priority-ordered drop. Update `SkillAuditor` (T008) to call this helper and report which rung the catalog would land on if rendered against the current budget; surface as a new line in the `## Skill Budget` section: `Render rung: <full|truncated|omitted> (would drop N skills if rendered now)`. **Do not** change the actual agent-loop render path in this sub-task -- only the auditor consumes the new helper for now; wiring it into the live render path is deferred to a follow-up cycle to avoid behavior change inside v1.3.0.

---

#### 5.2 -- Phase 5 test pass and stabilization

- [x] T016 Confirm npm run build and npm run test pass; verify the auditor's new "Render rung" line is informative

**Objective**: Confirm the fallback ladder behaves correctly across all three rungs on synthetic catalogs and that the auditor surfaces the rung diagnostic without changing live agent-loop behavior.

**Prompt**:
> Run `npm run build` followed by `npm run test`. Run `node bin/nexus.mjs skills audit` and confirm the `## Skill Budget` section now contains a `Render rung:` line. On the live catalog at default 2% budget, the expected rung is `truncated` or `omitted` (213 skills is well above 2% of any reasonable context window). Run the audit with `--budget-percent 100` and confirm the rung flips to `full`. Run with `--budget-percent 0.1` and confirm the rung flips to `omitted` with a non-zero `omittedCount` and that `devai-hub`-sourced skills are dropped before `user` or `builtin`. After verification, run `/generate-session-history` to document Phase 5.

---

### Phase 5 Exit Checklist

- [x] T015 completed (fallback ladder + test)
- [x] T016 completed (live-catalog rung verification)
- [x] Session history generated
- [x] Ready to advance to Phase 6

---

## Phase 6: Upstream Hygiene + P3 Backlog

**Goal**: Land the P2 upstream Nexus-Hub validator extension (insight I-03) and the two P3 CLI backlog flags (`--deep-logs` and `--by-root`). Phase 6 is the lowest-priority bucket; both items can be deferred to a follow-up cycle if v1.3.0 closes early.
**Prerequisites**: Phase 5 complete (T015-T016).
**Stability Gate**: Nexus-Hub validator rejects malformed frontmatter; the P3 flags pass through `bin/nexus.mjs` end-to-end.

### Sub-tasks

#### 6.1 -- Extend Nexus-Hub `validate_skills.py`

- [x] T017 [P] Add single-line name/description rules to scripts/validate_skills.py in the Nexus-Hub repo

**Objective**: Enforce insight I-03's frontmatter discipline at the upstream catalog level so authoring violations are caught at PR time instead of at runtime in the Nexus consumer.

**Prompt**:
> In the Nexus-Hub repo (`../Nexus-Hub/` relative to this repo), open `scripts/validate_skills.py`. Add three new checks: (a) `name:` field must be a single line (no `\n`) and must match `^[a-z0-9-]+$` (kebab-case); (b) `description:` field must be a single line and at most 250 characters; (c) when `name:` is absent, the parent directory name is used as the default and must itself satisfy rule (a). All three checks emit a clear error message naming the offending file. Run the validator against the full catalog (`python scripts/validate_skills.py`) and confirm zero pre-existing failures -- if any current SKILL.md violates the new rules, *do not* mass-edit them in this commit; instead, file an issue in the Nexus-Hub repo listing the offenders and add an `--allow-existing` flag that grandfathers known violations under a sibling `validate_skills.allowlist.json` (the allowlist's purpose is purely transitional). Add a sibling test at `tests/test_validate_skills.py` covering all three rules. **No Nexus repo change** -- this task lives entirely upstream. After the Nexus-Hub PR merges, open a known-gap entry in [docs/versions/v1/v1.3.0/known-gaps.md](../known-gaps.md) (created by T022 below) tracking the planned allowlist drain. This task is independent of T018.

---

#### 6.2 -- Add P3 CLI flags `--deep-logs` and `--by-root`

- [x] T018 Add P3 flags to bin/nexus.mjs and the auditor

**Objective**: Surface the two P3 backlog items from the comparison (insight I-11 sub-set) so power-users can scan archived sessions or filter the audit by skill root.

**Prompt**:
> Extend [bin/nexus.mjs](../../../../../bin/nexus.mjs) and [core/skills/SkillAuditor.ts](../../../../../core/skills/SkillAuditor.ts) with two flags: (a) `--deep-logs` -- when set, `SkillUsageScanner` (T012) extends its scan to `~/.nexus/sessions/archive/**/*.jsonl` and any compressed `.jsonl.gz` files inside the sessions directory (use Node's built-in `zlib.gunzipSync` -- no new dependency); (b) `--by-root <name>` -- when set, the auditor filters every report section to only the named skill root (`builtin`, `user`, or `devai-hub`). Both flags are no-ops by default. Add two test cases: `tests/integration/skills-audit-deep-logs.test.ts` with a fixture archive dir containing a `.jsonl.gz`; and one new case in `tests/skills/SkillAuditor.test.ts` exercising the `--by-root` filter. The `--by-root` flag is mutually exclusive with rendering the `Root summary` section (which would degenerate to a single row); when `--by-root` is active, suppress that section and add a line `Filtered to root: <name>` in the report header.

---

#### 6.3 -- Phase 6 test pass and stabilization

- [x] T019 Confirm npm run build and npm run test pass; verify both P3 flags work end-to-end

**Objective**: Confirm the upstream validator extension and the local P3 flags ship without regression.

**Prompt**:
> Run `npm run build` followed by `npm run test`. Run `node bin/nexus.mjs skills audit --deep-logs --months 12` and confirm the Unused-candidates section reflects the extended scan window (more skills should show recent activity when archives are included). Run `node bin/nexus.mjs skills audit --by-root user` and confirm only user-authored skills appear in every section, and that the `Root summary` is replaced by the `Filtered to root: user` header line. In the Nexus-Hub repo, run `python scripts/validate_skills.py` and confirm the new checks fire (or the allowlist absorbs known violations). After verification, run `/generate-session-history` to document Phase 6.

---

### Phase 6 Exit Checklist

- [x] T017 completed (Nexus-Hub validator extension)
- [x] T018 completed (--deep-logs + --by-root flags)
- [x] T019 completed (smoke runs verified)
- [x] Session history generated
- [x] Ready to advance to Phase 7

---

## Phase 7: Stabilization & Benchmarks

**Goal**: Run a benchmark of the audit command against the live 213-skill catalog, refresh documentation, and close the known-gaps ledger for the adoption set.
**Prerequisites**: Phase 6 complete (T017-T019).
**Stability Gate**: Benchmark report committed under `docs/versions/v1/v1.3.0/benchmarks/`; AGENTS.md / README.md / ARCHITECTURE.md reflect the new audit command; `docs/versions/v1/v1.3.0/known-gaps.md` (created by T022 if absent) has an `## 0.` adoption-skill-cleaner ledger section.

### Sub-tasks

#### 7.1 -- Benchmark `skills audit` against the live catalog

- [x] T020 Publish docs/versions/v1/v1.3.0/benchmarks/skills-audit-2026-05-28.md

**Objective**: Measure the audit command's runtime, memory footprint, and report quality against Nexus-Hub's 213-skill catalog so future cycles can detect regressions.

**Prompt**:
> Create `docs/versions/v1/v1.3.0/benchmarks/skills-audit-2026-05-28.md` modeled on the existing [token-usage benchmark](../../v1.2.0/benchmarks/coding-pillar-token-usage-2026-05-26.md). Measure: (a) wall-clock time for `node bin/nexus.mjs skills audit` against the live catalog (3 runs, report median + p95); (b) peak RSS of the audit process; (c) similarity-detection runtime separately (O(N^2) is the cost driver -- record so the next cycle can decide whether MinHash is needed); (d) the resulting report contents -- specifically the catalog's total budget pressure at default 2% and the top-5 description-compaction candidates by potential token savings. The benchmark file follows the same template as the storage benchmark and the token-usage benchmark. **Do not** include any PII from the live skill catalog -- if a user-authored skill is in the top-5 descriptions list, anonymize to `<user-skill-N>`. Add a sibling JSON results file at `tests/fixtures/skills-audit-benchmark-results/2026-05-28/results.json` matching the existing benchmark JSON conventions.

---

#### 7.2 -- Documentation refresh

- [x] T021 Update AGENTS.md and README.md and ARCHITECTURE.md to reflect the new audit surface

**Objective**: Surface the new `nexus skills audit` command in the project's three top-level docs so a fresh agent session discovers it through the existing AGENTS.md tooling inventory.

**Prompt**:
> Make three small additions: (a) in [AGENTS.md](../../../../../AGENTS.md), under "Non-Obvious Tooling", add a new sub-section `### Skills audit (v1.3.0 adoption-skill-cleaner track)` summarizing the command, the five report sections, and the "suggest first" framing -- two paragraphs maximum; (b) in [README.md](../../../../../README.md), under the v1.3.0 cycle status table (create one if v1.3.0 has no status table yet -- mirror the v1.2.0 table's shape), add a row for the adoption-skill-cleaner track marked "Landed"; (c) in [ARCHITECTURE.md](../../../../../ARCHITECTURE.md), under the `core/skills/` section, add three lines listing `SkillAuditor.ts`, `SkillSimilarity.ts`, `SkillUsageScanner.ts`, and `SkillRenderLine.ts` with one-line summaries. Cite [comparison-skill-cleaner.md](../comparison-skill-cleaner.md) and this plan in the AGENTS.md addition. Keep all three edits scoped to the one user request -- do not refactor adjacent content.

---

#### 7.3 -- Known-gaps closure

- [x] T022 Create (if absent) and append the adoption-skill-cleaner ledger to docs/versions/v1/v1.3.0/known-gaps.md

**Objective**: Record this plan's per-sub-task closure status in the canonical version-level known-gaps file, matching the precedent set by Phase 7.4 of [adoption-ecosystem-2026-05.md](../../v1.2.0/plans/adoption-ecosystem-2026-05.md).

**Prompt**:
> Open [docs/versions/v1/v1.3.0/known-gaps.md](../known-gaps.md). If the file does not yet exist (likely the case if this plan is the first track of the v1.3.0 cycle), create it using the same header / status / severity-tag scheme as [docs/versions/v1/v1.2.0/known-gaps.md](../../v1.2.0/known-gaps.md) (read that file for the template); seed it with `## 0. Adoption Ledger`, `## 1. Open Items`, `## 2. Resolved`, and `## 3. Summary` empty sub-sections. Then append a new sub-section under `## 0. Adoption Ledger` titled `### Skill-cleaner adoption (adoption-skill-cleaner)` containing a sub-task closure table with the same column shape used by the v1.2.0 ledger sub-sections: `| Plan sub-task | Item | Status | Closing reference |`. Populate one row per sub-task in this plan (T001 through T022). For each, set Status to `Resolved` and Closing reference to `adoption-skill-cleaner Phase N (<date>)` (substituting the correct phase index and the date implementation actually landed). For any sub-task that had to leave an open follow-up (for example T017's Nexus-Hub validator allowlist drain), add a new entry under `## 1. Open Items` using the v1.2.0 severity / category tagging scheme and cross-link it from the ledger row. Update the `## 3. Summary` table counts.

---

#### 7.4 -- Final integration test and exit gate

- [x] T023 Run the full Phase 1-7 test suite once more end-to-end

**Objective**: Confirm the adoption-skill-cleaner track lands cleanly on top of the already-landed ecosystem-adoption track without regressing any existing functionality.

**Prompt**:
> Run `npm run build` followed by `npm run test`. Run `npm run lint` and `npm run check-architecture`. Run `node bin/nexus.mjs skills sync --dry-run` to confirm the Hub side still reaches 214 skills (213 pre-existing + `skill-description-authoring`). Run `node bin/nexus.mjs skills audit` and confirm the full five-report layout renders. Confirm the existing [token-usage benchmark](../../v1.2.0/benchmarks/coding-pillar-token-usage-2026-05-26.md) and [storage-size benchmark](../../v1.2.0/benchmarks/memory-storage-size-2026-05-26.md) still reproduce within their tolerances (no regression introduced by Phase 5's render helper since it does not touch the live render path). After every gate passes, run `/generate-session-history` to document Phase 7 and write the final session summary. The cycle's adoption-skill-cleaner track is complete when this checklist is fully green.

---

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none -- no constitution file in force)_ | _(n/a)_ | _(n/a)_ |

---

### Phase 7 Exit Checklist

- [x] T020 completed (benchmark published)
- [x] T021 completed (AGENTS.md / README.md / ARCHITECTURE.md updated)
- [x] T022 completed (known-gaps ledger appended)
- [x] T023 completed (full test suite passes; both prior benchmarks still reproduce)
- [x] Session history generated
- [x] adoption-skill-cleaner track CLOSED
