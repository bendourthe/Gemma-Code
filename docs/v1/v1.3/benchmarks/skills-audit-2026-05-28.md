# Phase 7.1 -- Skills-Audit Runtime Benchmark (2026-05-28)

**Plan reference**: [adoption-skill-cleaner.md sub-task 7.1 (T020)](../plans/adoption-skill-cleaner.md)
**Status**: published
**Captured at**: 2026-05-28
**Harness**: [tests/fixtures/skills-audit-benchmark-results/2026-05-28/run-benchmark.mjs](../../../../tests/fixtures/skills-audit-benchmark-results/2026-05-28/run-benchmark.mjs)
**Raw fixtures**: [tests/fixtures/skills-audit-benchmark-results/2026-05-28/results.json](../../../../tests/fixtures/skills-audit-benchmark-results/2026-05-28/results.json)

## Workload

The benchmark measures the `nexus skills audit` command (the adoption-skill-cleaner track's headline deliverable, [SkillAuditor.ts](../../../../core/skills/SkillAuditor.ts) + the [bin/nexus.mjs](../../../../bin/nexus.mjs) `skills audit` subcommand) against the live skill catalog on this host. The audit composes the four Phase-2 utilities (`tokenize`, `getActiveContextWindow`, `renderSkillLine`, realpath-deduped `SkillCatalog`), the Phase-4 detectors (`findSimilarPairs`, `scanUsage`), and the Phase-5 render-budget ladder into the five-report shape (Budget / Descriptions / Duplicates / Unused / Roots).

## Catalog under test

The live catalog on this host is the **builtin-only root** (`src/skills/catalog/`, 16 skills). The plan's headline target -- the full ~213-skill Nexus-Hub catalog -- is not present on this host because new Nexus-Hub skills flow into `nexus skills sync` only through an upstream release (carryforward open item [1.1.P3.B](../../v1.2/known-gaps.md), and the same constraint recorded by Phase 3 sub-task T010 and Phase 5 sub-task T016). The benchmark is therefore a **builtin-catalog baseline**: the methodology and harness are catalog-size-independent, so a future cycle reruns the same harness once the 213-skill catalog syncs and compares against this baseline. The dominant cost driver to watch as the catalog grows is the O(N^2) similarity pass (section (c) below), recorded in isolation precisely so that comparison is clean.

## Methodology

Four measurement families are captured in one harness invocation:

* **(a) Wall-clock** -- `node bin/nexus.mjs skills audit` is spawned as a child process; one warmup run is discarded (filesystem cache + module-graph load), then 10 timed runs are recorded. Median and p95 are reported. This is the end-to-end cost a user pays at the shell, including Node startup and the compiled-module import graph.
* **(b) Peak RSS** -- a dedicated child probe ([rss-probe.mjs](../../../../tests/fixtures/skills-audit-benchmark-results/2026-05-28/rss-probe.mjs)) runs `runSkillsAudit` once with output discarded and prints `process.resourceUsage().maxRSS`, so the harness's own child-spawn and timing overhead does not inflate the figure. On win32/linux this value is kilobytes (peak working set on win32).
* **(c) Similarity runtime in isolation** -- `findSimilarPairs(skills, 0.85)` is timed over 25 iterations (one warmup discarded) against the loaded catalog bodies. This is the O(N^2) pass (`N*(N-1)/2` comparisons); it is measured separately so the next cycle can decide whether a MinHash/LSH pre-filter is warranted (carryforward open item [T013.P3.D](../known-gaps.md)).
* **(d) Deterministic report contents** -- `auditSkills` is run in-process with the same options the CLI uses (active model `gemma4:e4b`, default 2% budget envelope, primary skill root passed for the usage scan) to capture the catalog's budget pressure and the top-5 description-compaction candidates by potential token savings.

Timing and RSS fields (a-c) are captured-at-run and recorded as **informational, never gated** -- wall-clock and memory vary with host load. The report-content fields (d) are deterministic and reproduce exactly for a fixed catalog.

## Results

### (a) Wall-clock (`node bin/nexus.mjs skills audit`, 10 timed runs)

| Metric | Value |
|--------|-------|
| Median | 118.6 ms |
| p95 | 159.7 ms |
| Min | 112.6 ms |
| Max | 159.7 ms |

The median is dominated by Node process startup plus the compiled-module import graph; the audit computation itself (sections c-d) is a small fraction of the total. The single high sample (159.7 ms, also the p95 and max) is a startup-jitter outlier typical of a warm-but-contended host.

### (b) Peak RSS (audit-only child)

| Metric | Value |
|--------|-------|
| Peak RSS | 51.54 MB (52,772 KB) |

A single-pass, read-only audit of a 16-skill catalog holds the whole catalog plus the shingle sets for the similarity pass in memory; 51.5 MB is the Node baseline plus that working set. RSS will grow roughly linearly with catalog size for the report data and quadratically only in transient shingle-set allocation during the similarity pass.

### (c) Similarity-detection runtime (isolated, O(N^2))

| Metric | Value |
|--------|-------|
| Skills | 16 |
| Comparisons | 120 (`16*15/2`) |
| Median | 4.393 ms |
| p95 | 4.808 ms |
| Pairs found (>= 0.85 Jaccard) | 0 |

At 16 skills the exact-Jaccard pass is ~4 ms and finds no near-duplicates above the 0.85 threshold. The plan's note holds: for the ~213-skill catalog this is ~22,700 comparisons (roughly 190x the comparison count here), still expected to run in well under a second, so no indexing is warranted yet. If the catalog roughly doubles past that, add a MinHash band pre-filter before the exact pass (tracked by [T013.P3.D](../known-gaps.md)).

### (d) Report contents (default 2% budget envelope, active model `gemma4:e4b`)

| Metric | Value |
|--------|-------|
| Context window | 128,000 tokens |
| Budget envelope (2%) | 2,560 tokens |
| Used (full render) | 891 tokens |
| **Budget pressure** | **34.8%** |
| Render rung | full (0 skills dropped) |
| Description candidates (> 50 tokens) | 12 of 16 |
| Duplicates by name | 0 |
| Duplicates by similarity | 0 |
| Unused candidates | 16 (no session-log evidence on this host) |
| Root summary rows | 1 (builtin) |

**Top-5 description-compaction candidates by potential token savings** (savings = rendered line tokens above the 50-token candidate threshold; all five are builtin skills, so no PII anonymisation was required):

| Skill | Line tokens | Potential savings |
|-------|-------------|-------------------|
| build-second-brain | 66 | 16 |
| critique | 64 | 14 |
| harden | 64 | 14 |
| review-pr | 64 | 14 |
| distill | 61 | 11 |

The catalog sits at 34.8% of its 2% budget envelope (well within budget; render rung `full`), so no truncation or omission would occur at render time on this host. The 12 description candidates are the auditing surface the `skill-description-authoring` Phase-1 rule targets; compacting the top-5 alone would recover ~69 tokens.

## What the benchmark does NOT capture

* It does not measure the full 213-skill Nexus-Hub catalog -- that catalog is not synced on this host (carryforward 1.1.P3.B). This is a builtin-catalog baseline; rerun after the upstream-release sync for the headline number.
* It does not gate CI on timing. Wall-clock, RSS, and similarity runtime are host-dependent and recorded as informational. The deterministic report contents are the stable artifact.
* It does not exercise the `--deep-logs` archive scan or the `--by-root` filter (Phase 6 flags); those are correctness-tested by their own unit/integration tests, not timed here.
* It does not measure the live agent-loop render path -- Phase 5's render ladder is consumed by the auditor as a diagnostic only and does not touch the live render path in v1.3.0 (T015).

## Reproducing

```bash
npm run build
node tests/fixtures/skills-audit-benchmark-results/2026-05-28/run-benchmark.mjs
```

The harness rewrites [results.json](../../../../tests/fixtures/skills-audit-benchmark-results/2026-05-28/results.json) on every invocation. The report-content fields (section d) reproduce exactly for a fixed catalog; the timing fields (a-c) will vary with host load. See the [fixtures README](../../../../tests/fixtures/skills-audit-benchmark-results/2026-05-28/README.md) for the replay protocol and field reference.

## Cross-reference

* Adoption track: [adoption-skill-cleaner.md](../plans/adoption-skill-cleaner.md); source comparison [comparison-skill-cleaner.md](../comparison-skill-cleaner.md)
* Carryforward catalog-sync constraint: [1.1.P3.B](../../v1.2/known-gaps.md) (upstream-release sync blocks the 213-skill live catalog)
* Similarity-scaling follow-up: [T013.P3.D](../known-gaps.md) (MinHash/LSH deferred until the catalog roughly doubles)
* Prior-cycle benchmark siblings: [coding-pillar-token-usage-2026-05-26.md](../../v1.2/benchmarks/coding-pillar-token-usage-2026-05-26.md), [memory-storage-size-2026-05-26.md](../../v1.2/benchmarks/memory-storage-size-2026-05-26.md)
