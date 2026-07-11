# Docs Cleanup Report -- Nexus-AI -- 2026-07-11

**Active version:** v1.10.0
**Mode:** `--canonicalize-layout` (apply)
**Scope:** `docs/` (whole tree)
**Driver:** v1.10.0 Nexus-Hub consumption re-architecture, Phase 8 (T041-T048); the `docs-layout-refactor` skill's canonicalization path.

## Summary

This pass was a **layout canonicalization**, not a Cat 1/Cat 2 archival sweep: no files were deleted or newly archived. The docs tree was migrated from the legacy three-level scheme to the skill's canonical version-first scheme.

| Action | Count |
|---|---|
| Version dirs canonicalized (moved) | 20 (11 active v1 + 9 archived v0) |
| Files moved (`git mv`, history preserved) | 328 |
| Reference rewrites (repo-root + relative links) | ~7.6k across ~550 files |
| Files deleted | 0 |
| Files newly archived (Cat 2) | 0 |
| Known-gaps files folded | 1 (v1.6: 2 -> 1) |

## Layout change

```
BEFORE                                          AFTER
docs/versions/v1/v1.<m>.0/...            ->     docs/v1/v1.<m>/...
docs/archive/versions/v0/v0.<m>.0/...    ->     docs/archive/v0/v0.<m>/...
```

The `versions/` wrapper is dropped and the redundant patch segment collapsed into the `v<MAJOR>.<MINOR>` minor bucket. Every v0 and v1 minor shipped exactly one patch (`.0`), so no minor dir received more than one source dir (no merge collisions).

## Dispositions by task

| Task | Disposition |
|---|---|
| **T041** version-dir canonicalization | Done. 11 v1 + 9 v0 dir moves via `git mv`; empty `docs/versions/` and `docs/archive/versions/` wrappers removed. |
| **T042** release-prefix filenames + `comparisons/` regroup | **Deferred** (see `NHC.P8.A`). Its sole purpose per the skill is collision-avoidance in *shared* minor dirs; every minor here holds a single patch, so there are no collisions to prevent. Becomes required the first time a minor gains a second patch. Does not affect the acceptance criteria. |
| **T043** fold per-minor known-gaps | Done. v1.6 carried two deliberately-separate plan ledgers (`known-gaps.md` + `known-gaps-openrouter-fusion.md`); folded verbatim into one `known-gaps.md` with a merge note, the companion file removed, 3 referrers repointed. All other minors already had exactly one. |
| **T044** ADR -> specs/policy remap | **Deferred** (see `NHC.P8.B`). The `docs-layout-refactor` skill does not define an ADR->specs/policy split and Nexus-Hub ships no `docs/specs`/`docs/policy` to mirror, so there is no canonical target. `docs/adr/` is kept in place as a cross-cutting, non-versioned subtree (never version-archived, never reclassified by content). |
| **T045** reference repair | Done + verified. Repo-root-absolute `docs/...` refs in non-`.md` files (source comments, CI, `package.json`, `.toml`) string-swapped; every `.md` markdown link recomputed against the move table (resolve-from-old-location -> map -> recompute-from-new-location), correctly handling both moved-file depth changes and the dropped wrapper. **Verification:** relative-link breakage is flat versus the pre-move baseline (HEAD `6860db5`): baseline 3,549 broken links, post-move 3,553 (+4 of ~8k, noise). The residual broken links are pre-existing rot in frozen historical docs (old-scheme remnants, removed code paths), broken at HEAD and out of this phase's scope. |
| **T046** cleanup report + archive README | Done. This report + a refreshed [`../../archive/README.md`](../../archive/README.md). |
| **T047** known-gaps reconcile + v1.10.0 seed | Done. See [`known-gaps.md`](known-gaps.md) section 1h. |
| **T048** CI docs-layout gate | Done. [`scripts/check-docs-layout.mjs`](../../../scripts/check-docs-layout.mjs) (`npm run check:docs-layout`) fails if the retired wrappers reappear or a patch-level dir survives; wired into the `nexus-check` CI job alongside the T039 naming gate. The T013 syncer subtree-scope test (`NexusHubSyncer.test.ts`) and the T025 app-data-preservation test (`codingBootstrap.test.ts`) run in CI's existing root + desktop test jobs. |

## Non-versioned subtrees left in place

`docs/adr/` (architecture decision records) is cross-cutting and non-versioned: kept where it is, never version-archived. The same rule applies to any future `docs/rfc`, `docs/specs`, `docs/policy`, `docs/runbooks`, `docs/guides` subtrees.

## Cat 3 refresh queue

`docs/DEVLOG.md` remains at the docs root (Cat 3, never archived). It is large and append-only; flag as a candidate for a future by-version split, tracked as a docs-hygiene follow-up (not Phase 8 scope).

## Self-classification

This report is Cat 4 (transient/active). A future run promotes it to Cat 2 once v1.10 is no longer the active minor.
