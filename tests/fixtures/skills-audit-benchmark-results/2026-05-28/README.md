# Skills-audit benchmark fixtures (2026-05-28)

Raw fixtures for the v1.3.0 adoption-skill-cleaner Phase 7 skills-audit benchmark ([docs/versions/v1/v1.3.0/benchmarks/skills-audit-2026-05-28.md](../../../../docs/v1/v1.3/benchmarks/skills-audit-2026-05-28.md)).

## Files

| File | Purpose |
|------|---------|
| `run-benchmark.mjs` | The harness. Builds the live skill catalog, times the CLI / similarity pass, probes peak RSS, captures the deterministic report contents, and writes `results.json`. |
| `rss-probe.mjs` | Child probe invoked by the harness. Runs `runSkillsAudit` once (output discarded) and prints `process.resourceUsage().maxRSS` so the audit's peak RSS is measured without the harness's own overhead. |
| `results.json` | Captured results (host + catalog metadata, wall-clock, peak RSS, similarity runtime, deterministic report contents). |

## Replay protocol

```bash
npm run build   # the harness imports the compiled out/ modules
node tests/fixtures/skills-audit-benchmark-results/2026-05-28/run-benchmark.mjs
```

The harness rewrites `results.json` on every run. The report-content fields (`reportContents.*`) are deterministic for a fixed catalog and reproduce exactly. The timing fields (`wallClock.*`, `peakRss.*`, `similarity.*`) are host-dependent and recorded as informational only -- they are not gated in CI.

## Field reference

* `catalog.totalSkills` / `catalog.byRoot` -- the live catalog the run measured. On a host without a synced Nexus-Hub catalog this is the builtin-only root (16 skills); rerun after `nexus skills sync` reaches the full ~213-skill catalog (carryforward 1.1.P3.B) for the headline number.
* `wallClock` -- end-to-end `node bin/nexus.mjs skills audit` child-process time (1 warmup discarded, then `runs` timed samples); `medianMs` / `p95Ms` are the headline figures.
* `peakRss.maxRssKb` -- `process.resourceUsage().maxRSS` from the audit-only probe (kilobytes on win32/linux).
* `similarity` -- the isolated O(N^2) `findSimilarPairs` pass (`comparisons = N*(N-1)/2`), median over `iterations` runs; watch this as the catalog grows (MinHash/LSH follow-up tracked by T013.P3.D).
* `reportContents.budget.pressurePct` -- catalog budget consumption at the default 2% envelope for the active model.
* `reportContents.top5DescriptionCandidates` -- top-5 description-compaction candidates by potential token savings (savings = rendered line tokens above the 50-token threshold); user-authored skills are anonymised to `<user-skill-N>`.
