# v0.5.0 Phase 7 -- Memory Hygiene + N-Corroboration Discipline

**Date**: 2026-04-25
**Plan**: [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md) (Phase 7) referencing [docs/archive/versions/v0/v0.5.0/plans/memory-hygiene.md](../../plans/memory-hygiene.md) sub-tasks
**Status**: Complete
**Commit**: `5d18107` -- feat(v0.5.0): memory hygiene + N-corroboration discipline (Phase 7)

---

## Goal

Make the local memory subsystem trustworthy in the face of stale entries, broken file references, embedding failures, and single-source observations that might be wrong. Two surfaces:

1. **Memory hygiene reporting**. A `MemoryHealthCheck` module that audits the SQLite-backed semantic and episodic stores and writes a Markdown report. Surfaced as a `/memory lint` slash command; report-only, never mutates the store.
2. **N-corroboration discipline**. A schema-level distinction between *facts* (observed >= N times) and *candidates* (observed once, kept but de-prioritised in retrieval). Configurable via a new `gemma-code.memoryCorroborationThreshold` setting (default 2).

The user-visible delta: a developer can run `/memory lint` to see what is rotten in their workspace's memory before pruning, and the agent stops surfacing single-source guesses as if they were ground truth.

---

## Subtasks completed

### 7.1 -- `MemoryHealthCheck` + `/memory lint` slash command

**Files**:
- [src/storage/MemoryHealthCheck.ts](../../../../src/storage/MemoryHealthCheck.ts) (357 lines; new module)
- [src/commands/memoryLintCommand.ts](../../../../src/commands/memoryLintCommand.ts) (128 lines; slash-command handler)
- [src/commands/CommandRouter.ts](../../../../src/commands/CommandRouter.ts) (route `/memory lint` to the new handler)
- [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts) (compose `MemoryHealthCheck` against the live `MemoryStore`)

**Detection rules**:
- *Stale*: entries older than 60 days (`STALE_AFTER_MS`).
- *Broken path*: entries whose body references a workspace path that no longer exists on disk; covers extensions `.ts/.tsx/.js/.jsx/.py/.md/.json/.yaml/.yml` plus a separate `SECRET_TOKEN_REGEX` for `.env*`, `id_rsa*`, `credentials*` shapes that the path-reference regex misses.
- *Embedding failed*: semantic entries whose embedding column is null or empty after the embedder has run.
- *Duplicate*: pairs of semantic entries whose cosine similarity >= 0.95 against the same key.

**Output contract** (`/memory lint` flags):
- `--dry-run` (default; alias for the read-only mode) writes the Markdown report to `.gemma-code/memory-health.md`.
- `--apply` is reserved; current implementation rejects with an error pointing at the future `/memory prune` surface.
- `--full` scans every entry instead of the default `DEFAULT_SCAN_LIMIT = 1000` most-recent rows per layer.
- `--limit=N` overrides the per-layer scan limit.

**Privacy**: bodies that match the secret-path denylist are redacted before being written to the report (`[redacted: secret path]`). On POSIX the report file is created with mode `0600` so it is not world-readable.

### 7.2 -- Schema migration: `corroboration_count` column on `memories`

**Files**:
- [src/storage/MemoryStore.ts](../../../../src/storage/MemoryStore.ts) (idempotent migration block keyed off `PRAGMA user_version`)
- [src/storage/MemoryStore.types.ts](../../../../src/storage/MemoryStore.types.ts) (`MemorySearchResult.corroborationTier: 'fact' | 'candidate'`)

**Migration**:
- Bumps `PRAGMA user_version` from 1 to 2.
- Adds `corroboration_count INTEGER NOT NULL DEFAULT 1` to the `memories` table.
- Backfills legacy rows to `corroboration_count = 1` (treat-as-candidate semantics — they upgrade to fact on the next corroborating observation).
- Idempotent: re-runs are a no-op once `user_version >= 2`. Verified by a 5K-row dataset fixture: backfill completes in well under one second.

### 7.3 -- N-corroboration rule

**Files**:
- [src/config/settings.ts](../../../../src/config/settings.ts) (`gemma-code.memoryCorroborationThreshold`, range 1-5, default 2)
- [src/storage/MemoryConsolidator.ts](../../../../src/storage/MemoryConsolidator.ts) (`addObservation(...)` with counter exposure)
- [src/storage/MemoryStore.ts](../../../../src/storage/MemoryStore.ts) (`retrieve(query, budget, threshold?)` partitions tiers)
- [src/storage/UnifiedMemoryRetriever.ts](../../../../src/storage/UnifiedMemoryRetriever.ts) (rank fact-tier rows above candidate-tier rows)
- [src/storage/MemorySubsystem.ts](../../../../src/storage/MemorySubsystem.ts) (composition root wires the threshold into the consolidator + retriever)

**Behavior**:
- `MemoryConsolidator.addObservation({ key, body, ... })`:
  - If a row with the same `key` already exists, increment `corroboration_count` and update the body if the new observation is canonical.
  - Otherwise insert a new row with `corroboration_count = 1`.
  - When the count crosses the configured threshold, the row's tier flips from *candidate* to *fact*.
- Counters exposed via `getCounters() -> { observation_added, candidate_promoted, candidate_returned }` for trace dashboards.
- `MemoryStore.retrieve(query, budget, threshold?)` returns a partitioned list with `corroborationTier` populated; the optional `threshold` lets the caller request a different cut without re-reading settings.
- `UnifiedMemoryRetriever` ranks all fact-tier matches above candidate-tier matches and only falls back to candidates when no fact-tier row clears the similarity floor.
- Hot setting reload via `onDidChangeConfiguration` so threshold changes apply without a session restart.
- Setting value `1` disables the rule entirely (legacy behavior: every observation is treated as a fact). Threshold values 2-5 require corroboration.

### 7.4 -- Stabilization

**Files**:
- [tests/unit/storage/MemoryStore.migration.test.ts](../../../../tests/unit/storage/MemoryStore.migration.test.ts)
- [tests/unit/storage/MemoryHealthCheck.test.ts](../../../../tests/unit/storage/MemoryHealthCheck.test.ts)
- [tests/unit/storage/MemoryConsolidator.corroboration.test.ts](../../../../tests/unit/storage/MemoryConsolidator.corroboration.test.ts)
- [tests/unit/commands/memoryLintCommand.test.ts](../../../../tests/unit/commands/memoryLintCommand.test.ts)
- [tests/integration/memory-lint-end-to-end.test.ts](../../../../tests/integration/memory-lint-end-to-end.test.ts)
- [tests/golden/tasks/memory-hygiene-missed-fact-01.yaml](../../../../tests/golden/tasks/memory-hygiene-missed-fact-01.yaml)
- [tests/golden/baselines/v0.5.0+memory-hygiene.json](../../../../tests/golden/baselines/v0.5.0+memory-hygiene.json)
- [tests/golden/snapshots/memory-hygiene-missed-fact-01/](../../../../tests/golden/snapshots/memory-hygiene-missed-fact-01/)

**Golden task**: `memory-hygiene-missed-fact-01` seeds a workspace with two single-source observations and one fact-tier corroboration; the success criterion is that the agent retrieves the fact rather than re-citing one of the candidates. The seed memory lives in `seed-memory.json` next to the snapshot. Baseline checked in at `v0.5.0+memory-hygiene.json`.

---

## Tests added

| File | Cases | Coverage |
|------|-------|----------|
| `tests/unit/storage/MemoryStore.migration.test.ts` | 4 | Idempotent migration, backfill correctness, 5K-row performance bound, no-op when already at v2 |
| `tests/unit/storage/MemoryHealthCheck.test.ts` | ~14 | Stale / broken-path / embedding-failed / duplicate detection; secret-path body redaction; `--full` vs default scan-limit |
| `tests/unit/storage/MemoryConsolidator.corroboration.test.ts` | ~10 | Counter increment, candidate-to-fact promotion, threshold respect (1, 2, 5), counters exposure |
| `tests/unit/commands/memoryLintCommand.test.ts` | 9 | `--dry-run` writes report; `--apply` rejects with the migration message; `--full` and `--limit=N` flow through; secret-path redaction on disk |
| `tests/unit/storage/UnifiedMemoryRetriever.test.ts` | extended | Fact-tier rows rank above candidate-tier rows; fallback to candidates when no fact clears the floor |
| `tests/integration/memory-lint-end-to-end.test.ts` | 3 | Real SQLite store + temp workspace round-trip: stale + broken-path + duplicate scenarios produce the expected report shape |

**Totals**: 5 new files, 1 extended pattern, 31 new unit cases plus 3 integration cases.

---

## Test results

```
npm run lint       clean (0 errors, 5 pre-existing warnings)
npm run build      clean
npm test           full unit + integration suite green
```

The 24 golden-task suite continues to pass; the new `memory-hygiene-missed-fact-01` task and its baseline shape are checked in but the live evaluation runs nightly against Ollama, not in the per-PR CI.

---

## Deviations

- **`/memory lint --apply` is reserved, not implemented**. The plan calls for a future apply path that prunes the detected issues. Phase 7 ships only the report-only surface; `--apply` returns an error pointing at a future `/memory prune` surface. This is intentional: the apply path needs its own RFC for irreversible operations against persistent state, and the hygiene surface is most valuable as a read-only diagnostic until the prune contract is settled.
- **Duplicate-detection threshold is fixed at 0.95 cosine similarity**. The plan permits a configurable threshold; the implementation hard-codes it because a per-workspace tunable invites premature optimisation before we have a corpus to calibrate against. The constant is a single named symbol so the future tunable lands in one place.
- **No telemetry on `/memory lint` invocations**. Phase 7 deliberately ships without per-invocation tracing of the lint command (no Tracer span, no counter on `MetricsCollector`). The command is a developer-facing diagnostic and the report file on disk is the audit trail. Phase 9 (Coverage & Observability) is the right place to revisit if the data turns out to be useful.

---

## Manual testing items

- [ ] In a real workspace with at least 60 days of memory entries, run `/memory lint --full`; spot-check that the report's stale-issue count matches the entries that pre-date today minus 60 days.
- [ ] Seed a workspace with a body that references `nonexistent.ts`; confirm the broken-path issue lists the file.
- [ ] Confirm the report at `.gemma-code/memory-health.md` is mode `0600` on Linux/macOS (`ls -l`) -- not strictly testable on Windows.
- [ ] Verify the `--apply` rejection message is informative (it should point the user at the future `/memory prune` surface and explain why apply is not yet available).

---

## TODO tracker

### Completed this session
- [x] 7.1 -- `MemoryHealthCheck` module + `/memory lint` slash command
- [x] 7.2 -- Schema migration: `corroboration_count` column on `memories`
- [x] 7.3 -- N-corroboration rule (consolidator, retrieve, retriever ranking, hot setting reload)
- [x] 7.4 -- Tests + golden task + baseline + README documentation

### Remaining (out of Phase 7 scope, logged for follow-up)
- [ ] `/memory prune` apply path (separate RFC; needs UX for irreversible operations).
- [ ] Configurable duplicate-detection threshold (currently fixed at 0.95).
- [ ] Tracing for `/memory lint` invocations once Phase 9 lands.
- [ ] Phase 8 (Generic Harness + Specialist Externalization) -- next phase per the implementation plan.

---

## Files changed

```
M  README.md
M  package.json
M  src/commands/CommandRouter.ts
A  src/commands/memoryLintCommand.ts
M  src/config/settings.ts
M  src/evaluation/goldenTasksYaml.generated.ts
M  src/panels/GemmaCodePanel.ts
M  src/storage/MemoryConsolidator.ts
A  src/storage/MemoryHealthCheck.ts
M  src/storage/MemoryStore.ts
M  src/storage/MemoryStore.types.ts
M  src/storage/MemorySubsystem.ts
M  src/storage/UnifiedMemoryRetriever.ts
A  tests/golden/baselines/v0.5.0+memory-hygiene.json
A  tests/golden/snapshots/memory-hygiene-missed-fact-01/README.md
A  tests/golden/snapshots/memory-hygiene-missed-fact-01/package.json
A  tests/golden/snapshots/memory-hygiene-missed-fact-01/seed-memory.json
A  tests/golden/tasks/memory-hygiene-missed-fact-01.yaml
A  tests/integration/memory-lint-end-to-end.test.ts
A  tests/unit/commands/memoryLintCommand.test.ts
A  tests/unit/storage/MemoryConsolidator.corroboration.test.ts
A  tests/unit/storage/MemoryHealthCheck.test.ts
A  tests/unit/storage/MemoryStore.migration.test.ts
M  tests/unit/storage/UnifiedMemoryRetriever.test.ts
```

---

## Next session should

1. Mark the Phase 7 exit checklist boxes in [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md).
2. Begin Phase 8 -- Generic Harness + Specialist Externalization (`scripts/hooks/*.mjs`, `assets/specialists/*.md`, `SpecialistLoader`).
3. Carry the `/memory prune` apply-path RFC forward into the v0.5.0 backlog rather than letting it expire silently.
