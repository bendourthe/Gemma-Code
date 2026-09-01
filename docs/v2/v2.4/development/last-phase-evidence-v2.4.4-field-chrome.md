# Last-phase evidence - v2.4.4 Field Chrome, Restyle, SANA, and Density

**Date**: 2026-08-31
**Branch**: `feat/v2.4.1-field-reliability`
**Plan**: `docs/v2/v2.4/plans/v2.4.4-field-chrome-restyle-sana-and-density.md`
**Phase**: 7 - Architecture refactor, known-gaps reconciliation, and CI/CD
**Commits under review**: `b10c1e32` (P1), `12ea01be` (P2), `42084c34` (P3), `f6c04a32` (P4), `9ddae6a1` (P5), `887afe6d` (P6)

---

## Architecture refactor

Empty-directory scan over the tracked source and documentation trees:

```
$ find core modules desktop/src runtimes scripts docs -type d -empty | grep -v node_modules
modules/coding/skills/catalog/__nonexistent_user__
modules/coding/skills/catalog/__none__
```

Both are untracked byproducts, not obsolete artifacts. `git ls-files modules/coding/skills/catalog/` does not list either, and both names appear as deliberately-nonexistent paths in the test suite:

```
tests/integration/commands/skill-execution.test.ts:19:  new SkillLoader(CATALOG_DIR, path.join(CATALOG_DIR, "__nonexistent_user__"))
tests/integration/orchestration/PanelFusion.test.ts:64:  path.join(REAL_CATALOG_DIR, "__none__")
```

They are created by running the suite and would reappear on the next run, so removing them would be churn rather than cleanup. This matches the v2.4.3 finding.

**Deprecated / obsolete files**: none found. **Redundant files or directories**: none found. **Overcomplicated structure**: none introduced. No file was moved, so no reference required repair. This cycle added six session histories and one evidence file, all inside the existing `docs/v2/v2.4/development/` tree, and one test file inside each of two existing test directories.

Finding: empty, with the scan quoted above.

---

## Known-gaps reconciliation

`docs/v2/v2.4/known-gaps.md` gained a `## v2.4.4` section: 6 MT rows, 1 DF row, 1 WN row, 0 closed.

Nothing was closed. Every v2.4.4 row states a limit that is unobserved *because this cycle produced no rebuilt installer*, which is exactly the condition under which the plan forbids closing. Specifically, v2.4.3 MT-2, MT-3, MT-4, MT-6, and MT-7 are each superseded by a v2.4.4 row restating the same unobserved limit against the new code - superseded, not resolved. v2.4.3 MT-1 (installer two-column, Unsloth lock) and MT-5 (picker order) are carried forward untouched because this screenshot set does not cover them.

Two rows are new rather than inherited:

- **DF-1** - Wan and SDXL are not re-smoked on the 0.36.0 Diffusers pin. This is the highest-blast-radius unobserved change in the cycle: the pin is shared by every Image and Video model, and no automated test loads a real pipeline.
- **WN-1** - two pre-existing ruff F401 findings in `runtimes/diffusion/vram_lifecycle.py` and `tests/python/diffusion/test_registry.py`. Both are auto-fixable and both are outside this plan, so they were recorded rather than fixed.

Glob over 31 `docs/**/known-gaps.md` files. Each file whose Status is `in-progress` or whose Open Items remain was read against this cycle's observations: `docs/v2/v2.3`, `docs/v2/v2.0`, `docs/v1/v1.20`, `docs/v1/v1.19`, `docs/v1/v1.8`, `docs/v1/v1.5`, `docs/v1/v1.3`. None had a row this cycle observed, so all are unchanged. Finalized and archive ledgers were left in place. No historical GPU or visual row was closed without new observation. The full disposition is written into the file under `### Reconciliation of Earlier Active Files (v2.4.4, 2026-08-31)`.

---

## Living docs architecture

```
docs/handbooks/README.md
docs/handbooks/markdown/{atlas.md, generation-recovery.md}
docs/handbooks/html/{atlas.html, generation-recovery.html, technical/}
docs/handbooks/technical/{installer-runtime.md, media-runtime.md, transcript-and-workspaces.md}
docs/decisions/README.md
docs/README.md   docs/DEVLOG.md   docs/todos.md
```

Required shape is present: a markdown source of truth, a generated `html/` mirror, one atlas walkthrough, and technical companions for the installer runtime, the media runtime, and the transcript/workspaces surface. `docs/decisions/` exists. The three living roots exist.

Self-gate: `docs/testing/` and `docs/validation/` do not exist and were not created.

```
$ ls -d docs/testing docs/validation
none (good)
```

Markdown and HTML did not disagree, because this cycle changed neither: every v2.4.4 change is code plus release-scoped evidence. No regeneration was required. Unicode safety on all seven new or edited documents:

```
$ python scripts/validate_unicode_safety.py --strict --path <each>
PASS (x7)   SUMMARY files=1 failures=0 fixed=no
```

---

## Git-tree hygiene

```
$ python scripts/check_release_preconditions.py --branches --repo-settings
[branches]
current=feat/v2.4.1-field-reliability
head=887afe6dcb4b
protected_checkout=no
working_tree=dirty
origin=https://github.com/bendourthe/Nexus-AI.git
upstream=origin/feat/v2.4.1-field-reliability
local_count=22
merged_into_head_count=19

[repo-settings]
status=observed
repository=bendourthe/Nexus-AI
default_branch=main
private=false
archived=false
issues_enabled=true
delete_branch_on_merge=false
default_branch_protection=unavailable
protection_reason=gh: Branch not protected (HTTP 404)
```

Report only. No branch was deleted. `working_tree=dirty` is the untracked evidence file being written plus `tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json`, which carried an uncommitted timing-jitter rewrite from a prior session and was deliberately left unstaged - no line of it traces to this plan. `protected_checkout=no` is correct: work is on the feature branch, not on `main`.

---

## CI/CD coverage

Provider **detected**: GitHub Actions, 19 workflow files.

### Per-field comparison against the canonical contract

| Field | Observed | Verdict |
|---|---|---|
| Repository-native profiles | `ci.yml` (17 jobs), `shell-build.yml`, `installer-tests.yml`, plus per-platform installer workflows | PASS |
| Event separation | push and pull_request separated; `nightly.yml`, `release.yml`, `semantic-release.yml` on their own events | PASS |
| Runner selection | shell-build gates the macOS (10x) and Windows (2x) matrix to push-to-main or dispatch; PRs and develop pushes are ubuntu-only | PASS |
| Always-resolving aggregate required check | **Not found.** `ci.yml` has 17 top-level jobs and no aggregate job that resolves on skip | **FAIL** |
| Permissions | `ci.yml` declares no top-level `permissions:` block, so it inherits the repository default | **FAIL** |
| Immutable action references | Every `uses:` is version-tagged; the SHA-pinning grep returned no unpinned-but-also no SHA-pinned entries | PARTIAL |
| Caching | present in `ci.yml` and installer workflows | PASS |
| Concurrency | `ci.yml` and `shell-build.yml` both declare a group with `cancel-in-progress` | PASS |
| Path scoping | shell-build and installer-tests are path-filtered with the rationale written inline | PASS |
| Artifact retention | installer build workflows publish artifacts | PASS |
| Structured reports | `coverage-diff.yml`, `pr-quality.yml` | PASS |
| Deployment boundaries | `release.yml` and `semantic-release.yml` are separate from CI | PASS |
| Failure recovery | `if: always()` used on report steps | PASS |
| **PR-target coverage** | Was main-only; `develop` added this phase with approval (see below) | **FIXED** |

### The finding that matters for this plan

Every substantive workflow filters its `pull_request` trigger to `main`:

```
branch-cleanup.yml         -
ci.yml                     ["main"]
codeql.yml                 ["main"]
commitlint.yml             pull_request (no branch filter)
coverage-diff.yml          ["main"]
golden-tasks.yml           -
installer-build.yml        -
installer-linux.yml        -
installer-macos.yml        -
installer-smoke.yml        -
installer-tests.yml        ["main"]
nightly.yml                -
pr-quality.yml             ["main"]
release.yml                -
sandbox.yml                -
scorecard.yml              -
semantic-release.yml       -
shell-build.yml            [main]
tuning-live.yml            -
```

This is v2.4.3 QG-5, and it is directly load-bearing for this plan's own sub-task 7.9. PR 58 targets `develop`. On a `develop`-targeted pull request, `commitlint` is the only workflow that runs on the `pull_request` event: CI, CodeQL, coverage-diff, installer-tests, pr-quality, and shell-build all sit out. The push to the feature branch does trigger `ci.yml` (its push trigger is `branches-ignore: ["dependabot/**"]`), so the branch head is tested - but the **merge result** is not, and testing the merge result is the entire purpose of the integration gate the plan describes.

**QG-5 was proposed with its cost and risk, and the operator explicitly approved applying it before the push.** Applied 2026-08-31: `develop` added to the `pull_request.branches` list of `ci.yml`, `shell-build.yml`, `installer-tests.yml`, `coverage-diff.yml`, and `pr-quality.yml`. No job logic changed - only which events start each workflow. Each edit carries an inline comment naming QG-5 and the reason. All 19 workflow files still parse as YAML, and the five now read:

```
ci.yml                   ["main", "develop"]
shell-build.yml          [main, develop]
installer-tests.yml      ["main", "develop"]
coverage-diff.yml        ["main", "develop"]
pr-quality.yml           ["main", "develop"]
```

This is the only pipeline edit in the entire plan. Phases 1 through 6 changed no workflow file, and this phase changed one thing, with approval, because CI/CD reconciliation is this phase's stated deliverable. Cost is one extra run per develop-targeted pull request, on workflows that are already path-scoped. QG-5 can be closed once the integration run confirms these workflows actually start on PR 58.

**Cross-installer parity**: the repository ships more than one installer (`installer-linux.yml`, `installer-macos.yml`, `installer-build.yml` for Windows, plus `installer-smoke.yml`). A declarative parity gate covering distributed artifacts, supported platforms, named capability counterparts, and external-tool fallbacks was **not** added, and the real installers were **not** executed on their target operating systems in this phase. This cycle changed the media-runtime Diffusers pin, which those installers provision, so that gap is material and is recorded as DF-1 in known-gaps rather than claimed as covered.

**Comparison verdict: not PASS.** One of the three failing fields (develop-targeted PR coverage) was closed with approval this phase. Two remain without observable evidence - `ci.yml` has no always-resolving aggregate required check and no top-level `permissions:` block - and cross-installer parity was not executed. A green run would not change that: neither remaining field is exercised by a run. Both are recorded as open rather than softened.

---

## Goal-vs-codebase review

**Plan Goal, restated**: a 16 GB NVIDIA packaged studio keeps Chat/Agents pending chrome aligned with equal transcript gutters and an uncropped glow; centers the sidebar hairline and pulls history titles to the selection rail; offers Delete All and Archive All; restyles the last puppy to black fur instead of reprinting it; runs SANA families on a Diffusers pin that actually exports their pipeline classes; keeps Image/Video pending animation alive until a clip or a written error; and densifies Settings model cards so tabs sit with search, actions share one row, height hugs content, and Details is pills plus a Best for list.

Inspected as an outside reader, against the working tree rather than the checklists:

| Goal slice | Artifact | Verdict |
|---|---|---|
| Equal transcript gutters | `MessageList.tsx:50` exports `TRANSCRIPT_GUTTER_PX`; applied as `paddingInline` at `:146`. No `paddingInline` or `paddingLeft` remains on either pending renderer in `MessageBubble.tsx`; `PENDING_PILL_INSET_PX` no longer exists anywhere in the tree | Landed |
| Uncropped glow | `overflow: visible` on list, row, and pending row; the glow now spreads into the list gutter rather than past the scroll container | Landed in code; unobserved in pixels (MT-1) |
| Centered hairline | `Sidebar.tsx:31` exports `HISTORY_HAIRLINE_GAP`, applied as `marginBlock` at `:228`; `FolderTree` header declares `paddingTop: 0` after its shorthand | Landed in code; unobserved in pixels (MT-2) |
| Titles at the rail | The 12px chevron span is gone for chat rows, and the depth spacer renders only at depth > 0 | Landed |
| Archive All / Delete All | Both `data-testid`s present in `FolderTree.tsx`; targets walk `tree` recursively, not `flat`; one `document.body`-portaled confirm each | Landed |
| Restyle changes pixels | `planRestyleRequest` referenced twice in `ImageStudioPage.tsx` and is the only path a restyle can take; parser accepts trailing punctuation; `image_execute` forwards the seed, respects a strength of 0, and raises `unchanged-output` on a source-identical result | Landed in code; unobserved on GPU (MT-3) |
| SANA pin exports the classes | `runtime-lock.json` and `versions.lock.json` both read `diffusers==0.36.0`; wheel inspection confirmed both classes and the SANA video modules ship in that release | Landed on distribution evidence; live import unobserved (MT-4), and Wan/SDXL not re-smoked (DF-1) |
| Pending stays alive | `serve()` in `main.py` runs job methods off the reader; `health` provably answers mid-job; heartbeats emit and stop; a pending studio orb is provably unpaused | Landed in code; packaged freeze unconfirmed (MT-5) |
| Studio captions | `STUDIO_PENDING_CAPTIONS` present; five tests assert the pool and that "Shaping..." is absent from user-visible pending | Landed |
| Settings density | `tabRowStyle` and `splitModelPill` both present; actions are `flexDirection: "row"` centered; `cardStyle` declares no min-height; Details drops four duplicated paragraphs | Landed in code; unobserved at a real viewport (MT-6) |

**Gaps found**: none where the code fails to satisfy the Goal. Every slice has an artifact, and every artifact is pinned by a test that fails against the previous behavior.

**But the Goal is written about a packaged studio, not a source tree.** Six of ten slices are proven only against jsdom, stubs, or distribution metadata. The Goal as literally stated - "a 16 GB NVIDIA packaged studio keeps..." - is not yet demonstrated, and this is the third cycle in which that is true for the restyle slice. That is not a checkbox miss; it is recorded as MT-1 through MT-6 plus DF-1, all open, none closed. Ticking every prior sub-task is not evidence the Goal landed, and it is not claimed as such here.

---

## Human/manual testing suggestions

These require a rebuilt unsigned installer carrying the 0.36.0 pin. Nothing below can be observed from this tree.

1. **Chat/Agents pending chrome.** Send a message in Chat and in Agents. The Searching pill must start on the same left margin as the assistant bubbles above it, and that margin must visually match the right margin of your own messages. Check the glow is not cut off on the left at 100% and again at 150% zoom.
2. **Sidebar history.** Confirm the rule under Videos has equal space above and below it. Select a chat and confirm its title sits immediately after the blue bar with no gap. Use Archive All, confirm, and check every chat in that pillar (including any inside a collapsed folder) is archived and none is deleted. Repeat with Delete All on a scratch list. Cancel on each and confirm nothing changes.
3. **Image restyle.** Generate a puppy. Then send "Make the puppy black." with the period and no re-attachment. The fur must read black in the same composition. It must not be the previous picture again. Try once more without the period. If you get a written error instead of an image, capture the sentence.
4. **SANA and the new pin.** Open a SANA-Video model. You must get either a playable clip or a sentence naming `diffusers-missing` and the installed version - never a raw `ImportError` traceback. Do the same for an Image SANA model. **Then re-smoke Wan 1.3B and one SDXL model**, because the pin change touches every Image and Video model, not only SANA.
5. **Wan liveness.** Start Wan 1.3B. Throughout the run: click around the window and confirm it responds, watch the orb keep moving, and confirm the caption reads Creating / Crafting / Generating and never Shaping. The turn must end in a playable clip or a written error. If the window still stalls while the caption keeps updating, that points at GPU compositor VRAM rather than the runtime, and is worth saying so.
6. **Settings Models.** Confirm the category tabs and the search box share one row. Confirm each card is only as tall as its text, with the star, the download or tick, and the delete control on one centered line. Open Details on Gemma 4: you should see fact pills with the label in grey and the value brighter, then a Best for heading with bullets - and no ID line, no "Also agentic", no repeated License, no backend model line.

---

## Full-suite testing and stabilization

```
$ npm run lint                                    PASS (0 findings)
$ npx tsc -b                                      PASS
$ npm run check                                   0 error, 54 warning; baseline 56 matched, 0 stale; exit 0
$ npx vitest run --config configs/vitest.config.ts
  Test Files  529 passed | 3 skipped (532)
  Tests       5737 passed | 12 skipped (5749)
$ npm run test --workspace @nexus/desktop
  Test Files  210 passed (210)
  Tests       1963 passed | 1 skipped (1964)
$ python -m pytest tests/python -q                292 passed
$ PYTHONPATH=scripts/installer/src python -m pytest scripts/installer/tests -q   PASS
$ python -m ruff check scripts/installer          All checks passed!
$ python -m ruff check <files touched this cycle> All checks passed!
```

No nexus-check finding falls in any file this cycle changed. The two ruff F401 findings that remain are in files this cycle did not touch and are recorded as WN-1.

**One environment repair.** At the start of Phase 1, 33 sidecar tests were failing on this host before any edit, all with `better-sqlite3 ... compiled against NODE_MODULE_VERSION 146. This version of Node.js requires NODE_MODULE_VERSION 137`. `npm rebuild better-sqlite3` cleared all 33. This touched `node_modules` only; no tracked file changed. It is noted because the "green suite" numbers above are not comparable to a run on an unrepaired host.

This gate is local by construction and passed before anything was published.

---

## Publication and integration

**Performed, with explicit approval, after the local gate passed.**

The operator was given a plain-language walkthrough of what a push would do and what QG-5 meant, then approved two things together: applying QG-5 first, and pushing v2.4.3 and v2.4.4 in one push. Resolved branching model: feature branch to `develop`, `develop` to `main`. Remote `origin` = `https://github.com/bendourthe/Nexus-AI.git`. Branch `feat/v2.4.1-field-reliability`, upstream already set. [PR 58](https://github.com/bendourthe/Nexus-AI/pull/58) targets `develop` and was updated rather than superseded.

### What the push exposed

The first push was refused by the husky pre-push hook, which runs `eslint --fix` and then refuses if `git diff` is non-empty. Nothing had been auto-fixed: the only dirty file was the inherited benchmark-fixture timing rewrite, which the hook cannot distinguish from a lint fix. It was stashed before each push and restored immediately after, so the operator's uncommitted change was preserved rather than discarded. All six pre-push gates then passed.

Two rounds of red checks followed. Each was classified, reproduced locally, fixed narrowly, re-verified locally, and pushed again - never re-run without a local reproduction.

**Round 1 - `Submission Checklist gate`, `Test TypeScript` (x4), `diff-cover`.**

- The checklist gate failed because the PR body, written for v2.4.1, had no `## Submission Checklist` section. This gate had never run on this pull request before, because `pr-quality.yml` was main-only - so QG-5 did not cause this failure, it *revealed* an unmet requirement that had been invisible. Reproduced locally with `PR_BODY=... node scripts/check-pr-checklist.mjs`. The PR description was rewritten to cover all three versions with the checklist, and the three extra gates it claims (`deps:check`, `catalog:check`, `perm-tier:check`) were run locally before ticking those boxes rather than after.
- `Test TypeScript` failed on `tests/unit/workflow-discipline.test.ts:73`, which asserted `shell-build.yml` filters `pull_request` to `[main]` - the exact contract QG-5 changed. `diff-cover` failed on the same test. **This was a process miss worth naming**: the QG-5 commit was verified with lint, `tsc`, and pytest, but not with the root vitest suite, which is the suite that owned the contract being changed. CI caught what the local gate was not re-run to catch. Fixed by updating the assertion to the develop-inclusive contract.

**Round 2 - `Test TypeScript (Node 22.x)`, `Shell ubuntu-latest`.**

Both failed on the same assertion in `ImageStudioPage.test.tsx`: `queryByText("Generating...")` expected null. Phase 5.3 had made "Generating..." one of the three studio captions, and the pool is shuffled once per bubble, so the line failed roughly one run in three. It passed on every local run and on the first CI round. The identical assertion in `VideoLabPage.test.tsx` had been caught and rewritten during Phase 5; this one was missed. Fixed the same way - the intent moved to the composer - and verified by running the file six times and the full desktop suite twice, all green. The equivalent assertions in `ChatPage`, `CodingPage`, and `mediaMessageBubble` were checked and left alone: those are chat pending, where the chat pool is used and "Generating..." is correctly never present.

### Final result

Head commit `4b1771da`. Every required check reached a terminal state:

```
$ gh pr checks 58
     42 pass
      1 skipping     (init.ps1 (Windows) -- path-gated, not applicable to this diff)
      0 fail
      0 pending

$ gh pr view 58 --json mergeable,mergeStateStatus
MERGEABLE / CLEAN
```

**QG-5 is confirmed closed by observation, not by assertion.** Before it, this pull request ran one workflow. It now runs 42 checks including the full CI matrix, CodeQL, coverage-diff, the installer suite, the shell build, and the submission-checklist gate - all against the merge result, which is what the integration gate exists to validate.

### Merge

Not performed. The plan requires the merge itself to be a separate explicit approval, and it has not been given. The pull request is green, mergeable, and waiting. Nothing has been tagged and no GitHub Release exists; the package version remains 2.4.1 until `/update release`.
