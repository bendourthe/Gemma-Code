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
| **PR-target coverage** | **See below** | **FAIL** |

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

Per the plan, QG-5 stays **proposed, not applied**, pending explicit approval. No workflow file was edited in this phase, and no workflow file was edited in phases 1 through 6.

**Proposed change (smallest that closes it)**: add `develop` to the `pull_request.branches` list of `ci.yml`, `shell-build.yml`, `installer-tests.yml`, `coverage-diff.yml`, and `pr-quality.yml`. Cost: one extra run per develop-targeted PR, on workflows that are already path-scoped. Risk: low; no job logic changes. Declining is also defensible, in which case the integration gate for this branch is honestly described as "the branch head was tested, the merge result was not", and that sentence belongs in the release notes rather than being left implied.

**Cross-installer parity**: the repository ships more than one installer (`installer-linux.yml`, `installer-macos.yml`, `installer-build.yml` for Windows, plus `installer-smoke.yml`). A declarative parity gate covering distributed artifacts, supported platforms, named capability counterparts, and external-tool fallbacks was **not** added, and the real installers were **not** executed on their target operating systems in this phase. This cycle changed the media-runtime Diffusers pin, which those installers provision, so that gap is material and is recorded as DF-1 in known-gaps rather than claimed as covered.

**Comparison verdict: not PASS.** Three required fields lack observable evidence (aggregate required check, explicit permissions, develop-targeted PR coverage) and cross-installer parity was not executed. A green run would not change this: none of those three fields is exercised by a run.

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

**Not performed.** This section is deliberately incomplete.

Six local commits exist on `feat/v2.4.1-field-reliability` (`b10c1e32` through `887afe6d`), plus the Phase 7 commit carrying this file. No push, no pull request, and no remote CI run has occurred at any point in this plan.

The plan requires explicit approval before the first branch push, and two decisions are outstanding and were put to the operator together:

1. **The push itself.** Resolved branching model: feature branch to `develop`, `develop` to `main`. Remote `origin` = `https://github.com/bendourthe/Nexus-AI.git`. Branch `feat/v2.4.1-field-reliability`, upstream already set. PR target `develop`. [PR 58](https://github.com/bendourthe/Nexus-AI/pull/58) is already open against `develop`, so an approved push updates it rather than opening a second. v2.4.3 T040 is unpushed on this same branch, so one push carries v2.4.3 and v2.4.4 together unless the operator splits them.
2. **QG-5.** Whether to add `develop` to the `pull_request.branches` of the five substantive workflows before pushing. Without it, the integration pull request runs `commitlint` and nothing else, and the merge result is never tested - which would make the plan's own "wait for every required check" step vacuous.

Required-check results will be quoted here once a push is approved and the checks reach a terminal state.
