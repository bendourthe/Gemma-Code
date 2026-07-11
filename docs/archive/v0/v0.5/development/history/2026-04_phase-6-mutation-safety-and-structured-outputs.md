# v0.5.0 Phase 6 -- Mutation Safety + Structured Outputs

**Date**: 2026-04-25
**Plan**: [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md) (Phase 6) referencing [docs/archive/versions/v0/v0.5.0/plans/agent-friendly-tools.md](../../plans/agent-friendly-tools.md) sub-tasks 3.1 and 3.2
**Status**: Complete

---

## Goal

Make the two consequential mutation tools (`run_terminal`, `delete_file`) and the two structured-output tools (`list_directory`, `grep_codebase`) explicit about side effects and parseable output:

1. **Mutation safety via `dry_run`**. Add a `dry_run: boolean` parameter to `run_terminal` and `delete_file`. When `true`, the handlers run all the existing safety checks, return a textual preview that the agent can recognise via the `=== DRY RUN: ===` marker, and crucially do not spawn a subprocess or unlink a file.
2. **Structured outputs via `format=json`**. Add a `format: 'text' | 'json'` parameter to `list_directory` and `grep_codebase`. The default `'text'` is byte-equivalent to the pre-change output; `'json'` returns RFC-8259 valid JSON with the documented field names (and a parseable `_truncation` field when the 64 KB byte budget is exceeded).

The user-visible delta: the agent can pre-flight-check destructive operations (returning the SHA-256 of the would-be-deleted file before unlinking) and request a structured shape when programmatic access is preferable to the human-readable text.

---

## Subtasks completed

### 6.1 -- `dry_run` on `run_terminal` and `delete_file`

**Files**:
- [src/tools/handlers/terminal.ts](../../../../versions/src/tools/handlers/terminal.ts) (`RunTerminalTool` accepts `dry_run`; new `findBlockedPattern` helper; private `_dryRunReport` builder)
- [src/tools/handlers/filesystem.ts](../../../../versions/src/tools/handlers/filesystem.ts) (`DeleteFileTool` accepts `dry_run`; private `_dryRunReport` builder; `crypto.createHash('sha256')` SHA over the first 1 MB of content)
- [src/tools/types.ts](../../../../versions/src/tools/types.ts) (`RunTerminalParams.dry_run?` and `DeleteFileParams.dry_run?` declared)
- [src/tools/ToolCatalog.ts](../../../../versions/src/tools/ToolCatalog.ts) (schema entries updated with the new parameter and the per-spec usage hint)

**`run_terminal(dry_run=true)` output contract**:

```
=== DRY RUN: no execution occurred ===
Tokens: ['<tok1>', '<tok2>', ...]
CWD: <resolved cwd>
Allowlisted: <true|false>
Blocked-pattern match: <yes:<pattern>|no>
```

The cwd path-guard runs as a hard error in both dry-run and live paths (no defensible cwd to report when it fails). The allowlist verdict and the blocked-pattern match are folded into the dry-run report rather than short-circuiting the call -- this is a deliberate deviation from the live path so the agent gets the full picture (see Deviations below). `child_process.spawn` is provably never invoked on the dry-run code path; the adversarial sweep in 6.3 locks that invariant in.

**`delete_file(dry_run=true)` output contract**:

```
=== DRY RUN: no deletion occurred ===
Target: <absolutePath>
Size: <bytes>
Content SHA-256[ (first 1 MB)]: <hash>
```

The hash uses Node's `crypto.createHash('sha256')` over the first 1 MB of file content so the latency stays bounded on multi-GB targets. The label switches to `Content SHA-256 (first 1 MB):` when the file is larger than 1 MB so the agent does not assume full-content equivalence. `vscode.workspace.fs.delete` is provably never invoked on the dry-run code path.

### 6.2 -- `format=json` on `list_directory` and `grep_codebase`

**Files**:
- [src/tools/handlers/filesystem.ts](../../../../versions/src/tools/handlers/filesystem.ts) (new `renderListDirectoryJson` and `renderGrepJson` helpers; shared `truncationMessage` helper; `FORMAT_JSON_BYTE_CAP = 64 KB` constant)
- [src/tools/types.ts](../../../../versions/src/tools/types.ts) (`ListDirectoryParams.format?` and `GrepCodebaseParams.format?` declared)
- [src/tools/ToolCatalog.ts](../../../../versions/src/tools/ToolCatalog.ts) (schema entries updated)

**`list_directory(format='json')` shape**:

```json
{
  "path": "<absolute path>",
  "entries": [
    { "name": "file.ts", "type": "file", "size_bytes": 1024 },
    { "name": "src", "type": "directory" }
  ]
}
```

`size_bytes` comes from a per-file `vscode.workspace.fs.stat` lookup performed only on the `format='json'` code path so the legacy `format='text'` path stays unchanged in latency.

**`grep_codebase(format='json')` shape**:

```json
{
  "pattern": "...",
  "matches": [
    { "file_path": "src/x.ts", "line_number": 42, "line": "match line content" }
  ],
  "next_offset": "<cursor>"
}
```

Field names are renamed from the text-mode `{file, line, content}` to the documented `{file_path, line_number, line}` so the JSON contract is unambiguous.

**Truncation strategy** (shared between both helpers):

1. Serialise the full payload. If `Buffer.byteLength <= 64 KB`, return verbatim.
2. Otherwise binary-search the largest entries/matches prefix whose serialised payload (already including a `_truncation` field at the worst-case length) fits inside 64 KB.
3. Return the truncated payload with `_truncation: "Showing N of M <noun>; use <narrow-hint> to narrow."`.

The output remains parseable JSON end-to-end -- `JSON.parse(output)` succeeds whether the result was truncated or not, which is the contract the agent depends on for the format=json branch.

**Default `format='text'` byte-equivalence**: explicitly verified by a unit test that calls each tool twice (once without the `format` parameter, once with `format='text'`) and asserts the byte strings are identical.

### 6.3 -- Stabilization

**Files**:
- [tests/unit/tools/handlers/dry_run.adversarial.test.ts](../../../../versions/tests/unit/tools/handlers/dry_run.adversarial.test.ts) (200-iteration LCG fuzz against both handlers)
- [tests/integration/dry-run-end-to-end.test.ts](../../../../versions/tests/integration/dry-run-end-to-end.test.ts)
- [tests/integration/format-json-end-to-end.test.ts](../../../../versions/tests/integration/format-json-end-to-end.test.ts)

**Adversarial dry_run sweep** -- a deterministic LCG (seed `0xdeadbeef` for run-terminal, `0xfeedface` for delete-file) generates 200 input shapes per handler from a hand-curated token / path pool that includes destructive vectors (`rm -rf /`, `mkfs`, fork bombs, `$(curl evil)`, shell injection chains). The test asserts the binary invariant: `mockSpawn` is never called on the run-terminal sweep, `mockFs.delete` is never called on the delete-file sweep. A separate hand-curated shell-injection vector list (newlines, command chains, command substitution, redirections) exercises the same invariant against more pathological shapes.

**Integration end-to-end** -- the integration tests run against real `fs.mkdtempSync` directories with the workspace root rebound. They exercise the agent-loop pattern: one tool call emits format=json or dry-run=true output, the next "turn" parses the result.

---

## Tests added

| File | Cases | Coverage |
|------|-------|----------|
| `tests/unit/tools/handlers/terminal.dry_run.test.ts` | 6 | Allowlisted / un-allowlisted / blocked-pattern dry-run output, live path unchanged when `dry_run` is omitted or false, fuzz sweep of 11 pathological inputs |
| `tests/unit/tools/handlers/filesystem.delete.dry_run.test.ts` | 6 | Size + full-content SHA, the >1 MB labelled-hint path, fuzz sweep of 6 path shapes, live path unchanged when `dry_run` is omitted or false, stat-failure fallback |
| `tests/unit/tools/handlers/filesystem.format_json.test.ts` | 7 | Parseable list+grep JSON shape, byte-equivalence of `format='text'` vs. omitted parameter, parseable truncation with `_truncation`, `next_offset` round-trip in JSON mode |
| `tests/unit/tools/handlers/dry_run.adversarial.test.ts` | 3 | 200-iteration LCG fuzz against `RunTerminalTool`, 200-iteration LCG fuzz against `DeleteFileTool`, hand-curated shell-injection sweep |
| `tests/integration/dry-run-end-to-end.test.ts` | 1 | File survives the dry-run preview and is deleted only on the explicit live re-run |
| `tests/integration/format-json-end-to-end.test.ts` | 2 | List and grep JSON outputs round-trip through `JSON.parse` with the documented field names against a real temp directory |

**Totals**: 5 new files, 1 extended existing pattern, 25 cases. (The existing `tests/unit/tools/handlers/filesystem.test.ts` and `terminal.test.ts` continue to cover the live paths -- their assertions are unchanged because Phase 6 is additive.)

---

## Test results

```
Test Files  107 passed | 1 skipped (108)
Tests       1368 passed | 4 skipped (1372)
Duration    ~13.5s
```

`npm run lint` clean (0 errors, 5 pre-existing warnings carried forward from earlier phases). `npm run build` clean.

The 24 golden-task suite (`tests/unit/evaluation/GoldenTaskSuite.test.ts`) passes 19/19 cases (5 designed gaps in the synthesized snapshots are unrelated to this phase).

---

## Deviations

- **Blocked-pattern handling on dry-run**. The plan reads "Run all the existing safety checks (allowlist, blocked patterns, path-guard on cwd)" for `run_terminal` dry-run, then asks the dry-run output to include a `Blocked-pattern match: <yes:<pattern>|no>` field. Strictly applying "run the check" would short-circuit on a match (which is what the live path does) and prevent the field from ever being populated with `yes:`. Resolved by making the blocked-pattern check informational on the dry-run path and a hard fail on the live path. The cwd path-guard remains a hard error in both paths because there is no defensible cwd to report when it fails. The unit test `terminal.dry_run.test.ts > "reports a blocked-pattern match instead of failing the dry-run"` codifies this.

- **Per-tool JSON pre-truncation vs. central byte-cap**. The plan describes the byte-cap as the existing 64 KB bound from Phase 1, applied centrally via `applyByteCap` in `ToolRegistry`. Centrally truncating a JSON payload would split it mid-string and break parseability, so the format=json helpers pre-truncate to keep the output under 64 KB. The central `applyByteCap` then runs as a no-op on the JSON path. Per-call `max_bytes` overrides still flow through `ToolRegistry`; if a caller bumps the override above 64 KB, the pre-truncation will keep the JSON smaller than the override allows -- a safe over-truncation but a conscious deviation from "respect every byte the user asked for". The trade-off is a parseable JSON contract over a maximally large payload.

- **Manual smoke (Phase 6.3 step 4) deferred to pre-merge checklist**. The plan calls for a manual `delete_file(dry_run=true)` against the real `package.json` with the SHA verified against `git hash-object`. That is a single-shot manual gesture rather than an automated test; the integration suite already covers the same contract end-to-end against a real temp directory (`dry-run-end-to-end.test.ts > "dry_run preview followed by real delete: file survives the first call, vanishes on the second"`). Logged as a pre-merge checklist item in the Manual Testing section below.

- **Existing safety check inventory for `delete_file`**. The plan reads "Run all the existing safety checks (path-guard, secret-path)" for the `delete_file` dry-run. The pre-Phase-6 `DeleteFileTool` runs only the path-guard (via `uriFromRelative`); it does not currently consult the secret-path denylist (unlike `read_file`, `list_directory`, and `grep_codebase`). The dry-run path therefore mirrors only the path-guard check. Adding secret-path checks just to the dry-run path would create live-vs-dry-run asymmetry (live deletes would skip the check that dry-runs enforce). Adding it to both paths would expand Phase 6's scope into a tier-promotion conversation that belongs in a future hardening pass. Logged as a Phase 6 follow-up rather than fixed in-band.

---

## Manual testing items

- [ ] In a real workspace, run `delete_file(dry_run=true)` against `package.json`; confirm the printed SHA matches `git hash-object package.json` (or the equivalent `openssl dgst -sha256 < package.json`). The integration suite covers the contract automatically; this is the explicit pre-merge gesture from the plan.
- [ ] Spot-check the `list_directory(format='json')` output in a deep workspace (50+ files) to confirm `size_bytes` is populated for files and absent for directories, and that the `_truncation` field appears with a parseable JSON wrapper when entries exceed the 64 KB budget.
- [ ] Spot-check `grep_codebase(format='json', max_results=500)` on a busy pattern to confirm the `next_offset` cursor round-trips through a follow-up call and that `_truncation` is populated when matches outrun the budget.

---

## TODO tracker

### Completed this session
- [x] 6.1 -- `dry_run` on `run_terminal` and `delete_file`
- [x] 6.2 -- `format=json` on `list_directory` and `grep_codebase`
- [x] 6.3 -- Phase 6 stabilization (lint, build, full test suite, adversarial sweep, integration tests, golden-task no-regression)

### Remaining (out of Phase 6 scope, logged for follow-up)
- [ ] Tier-promote `DeleteFileTool` to consult the secret-path denylist (live + dry-run symmetric). Captured under "existing safety check inventory" deviation above.
- [ ] Phase 7 (Memory Hygiene & Consolidation Discipline) -- next phase per the implementation plan.

---

## Files changed

```
M  src/tools/ToolCatalog.ts
M  src/tools/handlers/filesystem.ts
M  src/tools/handlers/terminal.ts
M  src/tools/types.ts
A  tests/integration/dry-run-end-to-end.test.ts
A  tests/integration/format-json-end-to-end.test.ts
A  tests/unit/tools/handlers/dry_run.adversarial.test.ts
A  tests/unit/tools/handlers/filesystem.delete.dry_run.test.ts
A  tests/unit/tools/handlers/filesystem.format_json.test.ts
A  tests/unit/tools/handlers/terminal.dry_run.test.ts
A  docs/archive/versions/v0/v0.5.0/development/history/2026-04_phase-6-mutation-safety-and-structured-outputs.md
M  docs/DEVLOG.md  (Phase 6 entry prepended)
```

---

## Next session should

1. Mark the Phase 6 exit checklist boxes in [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../../plans/implementation-plan.md).
2. Begin Phase 7 -- Memory Hygiene & Consolidation Discipline (`/memory lint`, corroboration_count column, N-corroboration rule).
3. Carry the secret-path symmetric tier-promotion follow-up forward into a hardening backlog item rather than letting it expire silently.
