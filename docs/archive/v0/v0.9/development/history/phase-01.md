# v0.9.0 Phase 1 -- Session History

**Date**: 2026-05-16
**Phase**: 1 -- Foundational fixes + operator-action tracking
**Plan**: [docs/archive/versions/v0/v0.9.0/plans/v0.9.0-cycle.md](../../plans/v0.9.0-cycle.md)
**Sub-tasks landed**: 1.1, 1.2, 1.3, 1.4

---

## 1. Chronological steps

### Step 1: Pre-implementation review (~10 min)

Read the plan's Phase 1 section in full, then opened [docs/archive/versions/v0/v0.8.0/known-gaps.md](../../../v0.8/known-gaps.md) Section 10.1 to refresh on the 5 in-cycle gaps Phase 1 is designed to close (10.O.D, E, G, N, R) and the 8 operator-only carryovers (10.O.A / B / C / X / AA / BB / CC / DD). Confirmed vitest current version is `^1.0.0` per `package.json` and looked up the latest 2.x stable on npm: `vitest@2.1.9`.

### Step 2: Sub-task 1.1 -- vitest version bump (~5 min)

Edited `package.json` to bump `vitest` and `@vitest/coverage-v8` to `^2.1.9`. Ran `npm install` (silent). Confirmed `npx vitest --version` reports `vitest/2.1.9`.

Ran the two formerly-broken test files to verify whether the bump alone resolved 10.O.D:

```
npx vitest run tests/unit/cli/gemma-check.test.ts tests/unit/scripts/package-skills.test.ts
```

Result: still fails. Same `SyntaxError: Invalid or unexpected token` symptom. Bump alone is insufficient.

### Step 3: Root-cause hunt (~30 min)

Suspected non-ASCII characters per the v0.8.0 hypothesis. Wrote a small Node script to scan the failing files: both are pure ASCII (zero bytes > 0x7F). Hypothesis ruled out.

Suspected CRLF line endings: gemma-check.test.ts and package-skills.test.ts both have CRLF (Windows autocrlf=true). Backed up the originals, converted to LF, re-ran -- still fails. Hypothesis ruled out. Restored originals.

Tried different vitest pool strategies (`--pool=forks --no-isolate`, `--pool=threads`) -- no change.

Bisected the test file content by truncating to top-N lines: at 25 lines the parser succeeded; at 50 lines it failed. The transition was at the import of `bin/gemma-check.mjs` (line 35).

Bumped to vitest `^3.2.4` to see if the 3.x error reporter would surface a clearer message. Result: yes -- vitest 3.x reports the error at the actual import line ("imports from `bin/gemma-check.mjs`"), making the root cause obvious.

`bin/gemma-check.mjs` and `scripts/package-skills.mjs` both start with `#!/usr/bin/env node`. Vite's transform pipeline does not strip the leading shebang from imported `.mjs` files; the resulting source fails the Node-vm parser on Windows. The non-ASCII / vm-transform / CRLF hypotheses in v0.8.0 known-gaps were all incorrect.

### Step 4: Fix -- shebang plugin (~10 min)

Reverted vitest back to `^2.1.9` (the plan's target). Added a 12-line `stripShebang` Vite plugin to `configs/vitest.config.ts`:

- Runs in the `pre` enforce phase.
- Fires on `.mjs` / `.cjs` / `.js` ids only.
- Drops the first line if it starts with `#!`; returns the rest verbatim with `map: null`.

Re-ran the two failing files: gemma-check.test.ts now passes 62/62 tests. package-skills.test.ts passes 19/20 -- one test fails with "expected 2 to be +0" on a spawn exit code.

### Step 5: Discovered secondary issue -- CRLF in SKILL.md (~10 min)

The failing spawn test ran the real `scripts/package-skills.mjs` against the real `src/skills/catalog/`. The script exited with code 2 and printed: `ERROR: analyze-codebase/SKILL.md: SKILL.md is missing the leading '---' frontmatter fence`.

Investigation: `src/skills/catalog/analyze-codebase/SKILL.md` starts with `---\r\n` (CRLF) in the working tree. The committed file is LF (verified via `git ls-files --eol`); Git's `core.autocrlf=true` converts on checkout. The `parseSkill` function only fence-matches the LF form.

Fixed `scripts/package-skills.mjs.parseSkill` by adding a `raw.replace(/\r\n/g, "\n")` normalisation at the top. Both file contents on disk unchanged; comparison normalised.

### Step 6: Sub-task 1.2 -- consolidator threshold (~5 min)

Ran the consolidator stress test isolated -- 1.4s on vitest 2.x. The v0.8.0 measurement was ~11s. Bumped the assertion from `<5000` to `<15000` ms with an inline comment citing both numbers and ADR-0002 / ADR-0018. Re-ran the test -- 1.4s, passes.

### Step 7: Sub-task 1.3 -- operator-actions.md (~25 min)

Authored `docs/archive/versions/v0/v0.9.0/operator-actions.md`. Seven sections, one per operator-only carryover from v0.8.0 Section 10.1, plus 10.O.BB (v0.8.0 golden + bench baseline) folded into Section 1 since it shares the live-Ollama-capture procedure. Each section opens with a `Status: pending` flag the operator flips after running. ASCII-only; final size 11.6 KB (under the 12 KB cap in the plan spec).

### Step 8: Sub-task 1.4 -- full suite gate (~20 min)

Ran the full Phase 1 stability gate: `npm run lint`, `node bin/gemma-check.mjs src/`, `npm test`, `npm run deps:check`, `npm run catalog:check`, `npm run perm-tier:check`.

First pass: full vitest suite completes with no segfault. 1 unexpected failure: `tests/unit/scripts/check-architecture.test.ts` asserts `head === "#!/usr/bin/env bash"` but the working-tree file has CRLF so head includes a trailing `\r`. Same Windows autocrlf issue. Fixed by splitting on `/\r?\n/` instead of `"\n"`.

Re-ran full suite: 218 files, 2464 tests passed, 0 failed, 4 skipped.

Second pass: `perm-tier:check` fails with "Doc is out of sync with PermissionTiers.ts" but `git diff` shows no content change. Same autocrlf class of issue: the doc reads as CRLF, the script generates LF, equality comparison fails. Verified pre-existing (stashed Phase 1 changes -> still fails). Fixed `scripts/generate-tool-permission-table.mjs` to normalise `doc` to LF before comparison.

Third pass: all gates green. `npm test` exit 0; gemma-check src/ 4 warnings 0 errors (10.O.O pre-existing); deps:check 0 errors 4 pre-existing orphan warnings; catalog:check exit 0; perm-tier:check exit 0.

### Step 9: Update v0.8.0 known-gaps (~10 min)

Added 5 Resolved rows in `docs/archive/versions/v0/v0.8.0/known-gaps.md` Section 10.2 for 10.O.D / E / G / N / R, each pointing at v0.9.0 Phase 1 with a one-paragraph note on the fix. Deleted the 5 corresponding Open Items rows. Recomputed Summary table: 37 -> 32 open; 14 -> 19 resolved. Bumped "Last updated" to the v0.9.0 Phase 1 close date. Added a Status (v0.9.0 Phase 1 close) paragraph at the top of the status block.

### Step 10: Author v0.9.0 known-gaps + DEVLOG entry (~15 min)

Created `docs/archive/versions/v0/v0.9.0/known-gaps.md` mirroring the v0.8.0 structure: 0 open, 5 resolved (the 5 from Phase 1). Added a v0.9.0 Phase 1 entry at the top of `docs/DEVLOG.md` covering goal, decisions per sub-task (with the root-cause re-analysis story), gate results, and files touched.

---

## 2. Troubleshooting summary

| Symptom | Initial hypothesis | Final diagnosis |
|---|---|---|
| `SyntaxError: Invalid or unexpected token` at test file's first import | Non-ASCII chars in docstring (v0.8.0 catalog said this) | Shebang `#!` on imported `.mjs` not stripped by Vite |
| Same as above, persists after CRLF -> LF conversion | CRLF in line endings | Not line endings; shebang in dependency |
| `MemoryStore.migration.test.ts` teardown segfault on Windows | Vitest 1.6.1 vm-transform bug | Likely the same shebang issue causing teardown corruption; vitest 2.x cleanup paths plus the plugin fix it together |
| SKILL.md frontmatter fence missing | Catalog content corrupted | Working-tree CRLF (autocrlf=true) vs LF-only parser |
| `check-architecture.test.ts` shebang equality fails | Test wrote wrong shebang | Working-tree CRLF vs LF-only split |
| `perm-tier:check` "out of sync" with no diff | Real doc drift | LF-generated table vs CRLF-loaded doc; equality fails on line endings alone |

---

## 3. Assumptions

1. **Linux CI will not regress.** The shebang plugin returns the same code (minus first line) on every platform; Linux vm parsers handle shebangs in vm.Script just fine, but stripping them is also fine. The CRLF normalisations are no-ops on already-LF input.
2. **Vitest 2.1.9 is the right floor.** 2.x is the plan's target. 3.x revealed the bug location but introduces breaking changes (assertion behaviour, expect-error semantics) not worth absorbing in Phase 1.
3. **Consolidator 15s threshold is durable.** vitest 2.x measured ~1.4s; v0.8.0 measured ~11s on the same workstation under vitest 1.6.1. 15s is ~36% headroom over the slow baseline and ~10x headroom over the fast one.
4. **The 4 pre-existing `prompt-oversized` warnings under 10.O.O are not Phase 1 scope.** They are tracked separately for Phase 6 sub-task 6.8 per the v0.9.0 ingest map.

---

## 4. Testing results

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `node bin/gemma-check.mjs src/` (CI scope) | 4 warnings, 0 errors, exit 0 |
| `npm test` (full suite) | 218 files, 2464 tests passed, 4 skipped, 0 failed, no segfault |
| `npm run deps:check` | 0 errors, 4 pre-existing orphan warnings, exit 0 |
| `npm run catalog:check` | exit 0 |
| `npm run perm-tier:check` | exit 0 |

The 4 `prompt-oversized` warnings (10.O.O), 4 dependency-cruiser orphan warnings, and 4 skipped tests are all pre-existing carry-overs documented in v0.8.0 known-gaps.

---

## 5. Next steps

Phase 2 -- wire the deferred v0.8.0 pure modules into production code paths. Per the plan, that is 9 wirings (10.O.K / M / S / T / U / V / W / Y / Z), each a `Gemma4Parser` / `HybridRanker` / `ContextCompactor` / `IntuitionCache` / `ReflectJob` / `WorkflowDetector` / `ModelPinRegistry` / tool-call-bytes / `ToolCallStreamParser` call-site addition. Prerequisite is Phase 1 (now landed); the harness is reliable for the integration tests Phase 2 adds.

The eight operator-only carryovers continue to live in `docs/archive/versions/v0/v0.9.0/operator-actions.md` and will not block Phase 2.
