# feature_list.json -- Scope Contract Format

**Version**: v0.8.0
**Status**: stable
**Lives at**: `<repo-root>/feature_list.json`
**Implementation**: [src/evaluation/FeatureList.ts](../../../../src/evaluation/FeatureList.ts), [src/evaluation/GoldenTaskSuite.ts](../../../../src/evaluation/GoldenTaskSuite.ts)

## Why

`feature_list.json` is the machine-readable scope contract for a Gemma Code release cycle. It enumerates every shipped feature with a stable id, a status, an evidence pointer, and a verification command that any operator can re-run. The contract is appended to (never thrown away) so the cycle's scope is auditable and self-stamping.

Two consumers exist:

1. The Python golden-task runner (canonical per [ADR-0017](../../../adr/0017-golden-runner-disposition.md)). On golden-task pass, it calls `stampGoldenTaskPass(taskId, repoRoot)` to flip the matching feature row.
2. The cycle's exit checklist. Every row with `status: "not_started"` is a release blocker; every row at `passing` is evidence for the DoD.

## Schema

```json
{
  "version": "vMAJOR.MINOR.PATCH",
  "features": [
    {
      "id": "fNNN",
      "name": "Human-readable name",
      "description": "One-paragraph description of what the feature does and where it lives.",
      "status": "not_started | active | blocked | passing",
      "evidence": "src/path/to/main.ts  OR  shell command",
      "testedAt": "YYYY-MM-DD or null",
      "verificationCommand": "npm run test -- tests/unit/path/to.test.ts"
    }
  ]
}
```

### Field rules (enforced by `validate()`)

| Field | Rule |
|---|---|
| `version` | Must match `vMAJOR.MINOR.PATCH` (optional pre-release suffix). |
| `id` | Must match `fNNN` (3+ digits). Must be unique across the file. |
| `name` | Non-empty. |
| `description` | Non-empty. |
| `status` | One of `not_started`, `active`, `blocked`, `passing`. |
| `evidence` | Non-empty. Either a path or a shell command. |
| `testedAt` | Null OR ISO-8601 date (`YYYY-MM-DD`). |
| `verificationCommand` | Non-empty shell command. |

## Operator workflow

1. When a phase ships a new feature, append a row with `status: "not_started"`.
2. When the matching golden task or unit suite passes, either:
   - The Python golden runner stamps the row automatically, OR
   - The operator runs `node -e "..."` against `stampGoldenTaskPass`.
3. At phase close, run `node -e "const fl = require('./out/evaluation/FeatureList.js'); console.log(fl.validate(fl.loadFeatureList('feature_list.json')))"` and confirm the issue array is empty.

## Status semantics

- `not_started` -- row added; no verification has succeeded yet.
- `active` -- partial implementation landed; row is in-flight in the current phase.
- `blocked` -- explicit pause; reason should be noted in the cycle's known-gaps log.
- `passing` -- verification ran green at `testedAt`.

## See also

- [docs/archive/versions/v0/v0.8.0/plans/v0.8.0-cycle.md](plans/v0.8.0-cycle.md) Phase 2 sub-task 2.1 -- the plan entry that introduced this format.
- [docs/adr/0017-golden-runner-disposition.md](../../../adr/0017-golden-runner-disposition.md) -- why the Python runner is canonical.
- [src/evaluation/FeatureList.ts](../../../../src/evaluation/FeatureList.ts) -- loader / validator / `markPassing`.
- [src/evaluation/GoldenTaskSuite.ts](../../../../src/evaluation/GoldenTaskSuite.ts) -- `stampGoldenTaskPass` + `getGoldenTaskFeatureId`.
