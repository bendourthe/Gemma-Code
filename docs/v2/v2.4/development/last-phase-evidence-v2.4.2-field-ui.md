# v2.4.2 Field UI Last-Phase Evidence

**Date**: 2026-08-31
**Branch**: `feat/v2.4.1-field-reliability`
**HEAD at evidence start**: `bbe0f6d` (Phase 6). Phase 7 evidence and docs are uncommitted beside that commit.
**Status**: Phase 7 local gates complete. Publication remains blocked until one Phase 7 commit exists and T043 push/PR is explicitly approved. Package version stays **2.4.1** until `/update release`.

## Architecture refactor

Propose-only. `project-refactor` and `docs-layout-refactor` were loaded from the operator skill install (`C:\Users\bdour\.agents\skills` / `.codex\skills`). Repository `catalog/skills/` paths remain absent (QG-2). No file was moved or deleted.

Proving scan (repo root; `desktop/`, `core/`, `modules/`, `scripts/installer/`; skip `node_modules`, `dist`, `coverage`, `.git`, `target`, `__pycache__`, `.ruff_cache`, `.venv`, `venv`):

```
Get-ChildItem -Recurse -Directory | empty-child filter

modules\coding\skills\catalog\__none__
modules\coding\skills\catalog\__nonexistent_user__
```

Those two empty directories are skill-catalog test fixtures, not obsolete product trees. No empty source directory and no redundant v2.4.2 file were found. No byte-identical duplicate source candidate was found in this pass.

Layout proposals that require a separate confirmation (not applied; same as generation-recovery Phase 7):

1. `clean-state-checklist.md` at repo root is not a community file. Candidate move: `docs/guides/` or `docs/v2/v2.4/development/`.
2. `feature_list.json` at repo root is a machine-readable catalog. Candidate move: `data/`.

The v2.4 documentation tree stays in place (`docs/v2/v2.4/`). Historical ADRs stay in `docs/adr/`.

## Known-gaps reconciliation

Glob: 31 `docs/**/known-gaps.md` files (canonical `docs/v*/` plus `docs/archive/v0/`).

Active (Status in-progress, open, incomplete, or COMPLETE with remaining open items): `docs/v2/v2.4/known-gaps.md`, `docs/v2/v2.3/known-gaps.md`, `docs/v2/v2.0/known-gaps.md`, `docs/v1/v1.20/known-gaps.md`, `docs/v1/v1.19/known-gaps.md`, `docs/v1/v1.9/known-gaps.md` (COMPLETE with remaining rehearsal items), `docs/v1/v1.8/known-gaps.md`, `docs/v1/v1.5/known-gaps.md`, `docs/v1/v1.3/known-gaps.md`. Finalized and archive ledgers were left unchanged.

This cycle did not close MT-1 through MT-6. They remain operator observations (`not_observed != absent`). v2.4.1 DF-1 through DF-7 carry forward except DF-2, which stays Resolved from generation-recovery. QG-2, QG-5, and QG-6 stay open. No historical GPU or visual row in older ledgers was closed. No Phase 7 Goal miss required a new BG row.

9A grep of this cycle's desktop and installer sources found one pre-existing `# DEVIATION:` in `desktop/src/shared/explorer/codingSessionsAsChatExplorer.ts` (overlay-folder reparent). It is not new in v2.4.2 and is not recorded as a v2.4.2 gap.

## Living docs architecture

Checked, not invented:

- `docs/README.md` (living entry)
- `docs/handbooks/README.md`, `markdown/atlas.md`, `markdown/generation-recovery.md`
- `docs/handbooks/technical/installer-runtime.md`, `media-runtime.md`, `transcript-and-workspaces.md`
- generated `docs/handbooks/html/` companions (5 sources)
- `docs/decisions/README.md` (index only; ADRs remain in `docs/adr/`)
- living `docs/DEVLOG.md` and `docs/todos.md`

```
npm run docs:handbooks:check
generate-handbooks: 5 source(s) match

npm run check:docs-layout
check-docs-layout: canonical layout OK (no docs/versions|docs/archive/versions wrappers)
```

No `docs/testing/` or `docs/validation/` directory was invented.

## Git-tree hygiene

Report only. No branch was deleted.

```
python scripts/check_release_preconditions.py --branches --repo-settings

[branches]
current=feat/v2.4.1-field-reliability
head=bbe0f6d0b3b6
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

`origin/feat/v2.4.1-field-reliability...HEAD` is `0 13` before this Phase 7 commit (six v2.4.2 product commits plus earlier local generation-recovery work). Integration target remains `develop`. Default-branch protection is unavailable through `gh` (HTTP 404), which is an observation, not a mutation.

v2.4.2 plan commits: `dcb201f`, `f06cd5e`, `dfbaa80`, `410dc87`, `f9ed98d`, `bbe0f6d`, plus this Phase 7 docs commit.

## CI/CD coverage

Provider detected: GitHub Actions (19 workflow files under `.github/workflows/`). GitLab, Jenkins, CircleCI, Azure Pipelines, Buildkite, Woodpecker, and Drone configs are absent.

| Contract field | Observable evidence | Difference |
|---|---|---|
| Event separation | `ci.yml` push (ignore dependabot) plus PR to `main`; installer/shell path filters; release on tags | Several PR workflows list `branches: ["main"]` only (QG-5) |
| Runner selection | ubuntu-latest for CI; shell-build ubuntu on PR/develop, full OS matrix on main | Inherited cost control; not changed |
| Aggregate required check | No always-resolving aggregate job | Missing (QG-5) |
| Permissions | Present on commitlint, release, pr-quality | `ci.yml` has no top-level `permissions:` block |
| Immutable references | checkout and setup-node pinned by SHA with version comments | Other `uses:` lines may still use mutable tags; not rewritten |
| Caching | `actions/setup-node` `cache: npm` in CI; cargo cache in shell-build | Present |
| Concurrency | `ci.yml`, shell-build, pr-quality, commitlint, release | Present on the primary workflows |
| Path scoping | installer-tests (`scripts/installer/**` plus catalog) and shell-build (`desktop/**`, `core/**`, `modules/**`) | Present; covers Phases 1-6 product paths |
| Retention | not uniformly declared | Environment/policy difference |
| Structured reports | coverage gate job in `ci.yml` | Present |
| Deployment boundary | `release.yml` is tag/workflow_dispatch only | Present |
| Failure recovery | concurrency cancel-in-progress on CI | Present |
| Repository-native profiles | no `fast` / `full` / `platform` / `report` / `release` npm scripts | Missing (QG-5) |
| One-installer parity | shipped artifact is Windows `NexusSetup.exe`; `scripts/installer/build/platform-contracts.json` already exists; macOS/Linux rows are `not-staged` | Silent no-op (zero extra shipped installer this cycle) |

Proposal (not applied; waiting for explicit approval; same as QG-5):

1. Add `develop` to `pull_request.branches` on `ci.yml`, `installer-tests.yml`, and `shell-build.yml` so the merge result of the integration PR is tested. Cost: extra PR minutes on develop-targeted PRs. Risk: low. Smallest fix.
2. Optionally add the same branch to `pr-quality.yml` and `coverage-diff.yml`.
3. Do not add an aggregate required-check job or npm profile scripts in this phase unless separately approved.

Workflow files were not modified. New Phase 7 files are docs only; existing jobs already cover `desktop/tests/videoFailClosed.test.ts`, `desktop/tests/settings-models-density.test.tsx`, and `scripts/installer/tests/test_vram_display.py`.

## Goal-vs-codebase review

**Plan Goal restated**: After one send, the user always sees the latest turn, a concise session title, honest context, and a truthful result or error, while history lives under the four module tabs and installer GPU / Unsloth / VS Code choices match the rest of the product.

| Goal slice | Code/docs artifact | Gap |
|---|---|---|
| History under the four module tabs | `desktop/src/components/SidebarHistoryHost.tsx` portals FolderTree into the left sidebar for `/chatbot`, `/coding`, `/images`, `/videos`. Settings and Approvals register nothing. Compact mode hides titles; it does not open a second column. | Packaged four-tab swap is Not observed (operator item 2). |
| Thinking pill uncropped | `AgentStateOrb` and `MessageBubble` set `overflow: visible`. `rectFullyInside` is tested with mocked boxes. | Pixel containment at 100%/150% zoom is Not observed (MT-1). |
| Stick to latest turn on send | `useStickToBottom` + `stickNow()` on Chat, Agents, Image, Video composer send. | Live overflow-pane jump is Not observed (MT-2). |
| Transparent scrollbar | `desktop/src/styles/tokens.css` `--scrollbar-thumb` on a transparent track. | Packaged OS chrome is Not observed. |
| Image follow-up edits last output | `inferImageIntent` uses `lastOutputRef` when attachments are empty. `FOLLOWUP_IMG2IMG_STRENGTH = 0.45`. "Make that puppy black" is img2img, not SAM2. | Packaged puppy recolor is Not observed (MT-3). |
| SAM2 missing is not a dead-end | `GenerationCanvas` Install `sam2:hiera-tiny` and Paint a mask. Retry after install replays the parked prompt. | Packaged install/paint path is Not observed. |
| Empty video bubble is an error | `videoFailClosed.ts` `EMPTY_VIDEO_CLIP`, `persistableAssistant`, Settings > Models hint. Dispatcher `requireUsableVideoPath`. | Packaged first-turn fail-closed is Not observed (MT-4). |
| Generic delete + multi-select | `deleteConfirmCopy` emits "Delete the selected chat(s)?" (or session/folder/items) with `This action cannot be undone.` on its own line. `rangeSelectKeys` supports multi-select. | Packaged copy is Not observed (operator item 6). |
| Concise model title | `chat.generateTitle` from the first prompt; truncated-prompt fallback only on timeout. | Packaged short title is Not observed (operator item 7). |
| Honest studio context | `sessionContextUsage` / `usageTurnsFromMessages` (session visual budget, not `maxImages: 1` as the bar). | Packaged bar vs warning copy is Not observed. |
| Settings Models density | Header has no `Catalog <hex>`. `MODELS_HEADER_TO_TABS_GAP` is `--space-1`. Card padding is `--space-2`. `catalogHash` remains on the client type only. | Two cards vs a real viewport is Not observed (MT-5). |
| Installer VRAM / Unsloth / VS Code | `display_vram_gb` (16384 and 15360 -> 16). Unsloth Compatible/Incompatible before opt-in. `STEP_NAMES` is 7 steps; VS Code checkbox on Configuration. | Live wizard screenshot is Not observed (MT-6). |

Independent-review miss: none of the nine operator items is proven on a packaged window in this session. Those misses are already MT-1 through MT-6 (plus DF-1 through DF-7 carry-forward). Completing T001-T034 is not treated as packaged proof.

## Human/manual testing suggestions

Do not invent a walkthrough. Operator items for a packaged Windows NVIDIA host:

1. Thinking pill at 100% and 150% zoom: the orb is fully visible with history expanded and collapsed.
2. Switch Chat, Agents, Images, and Videos: the left sidebar history list swaps; the main pane is transcript or workspace only.
3. Image: generate a puppy, then send "Make that puppy black" with no attachment; the same dog is recolored.
4. Image: trigger SAM2-missing and use Install or paint-mask; whole-image restyle must not require SAM2.
5. Video: one prompt that cannot produce a clip must not yield an empty success bubble.
6. Multi-select chats/folders: confirm generic delete copy and the irreversible warning on its own line.
7. First-prompt title is a short model name, not the raw prompt.
8. Settings Models: no catalog hash; tabs sit close under the title; two downloaded cards fit without a tall fingerprint stack.
9. Installer: GPU line shows whole GB; Unsloth Compatible/Incompatible is visible on Configuration with the VS Code checkbox.

All nine remain Not observed here. They map to MT-1 through MT-6.

## Full-suite testing and stabilization

```
npm run lint --silent   (repo root)
exit 0

npm run lint --silent; npx tsc --noEmit   (desktop/)
exit 0

python -m pytest tests/python -q
273 passed in 15.75s

uv run ruff check src tests   (scripts/installer)
All checks passed!

uv run pytest tests -q   (scripts/installer, PYTHONPATH=src)
exit 0 (3 skipped)

npm run test -- --reporter=dot   (repo root, third retry)
Test Files  529 passed | 3 skipped (532)
Tests  5733 passed | 12 skipped (5745)

npm run test:coverage   (desktop/, third retry under default local pool)
Test Files  2 failed | 207 passed (209)
Tests  3 failed | 1918 passed | 1 skipped (1922)
```

The three desktop coverage failures are classified ENV (resource contention under parallel coverage on Windows), not product defects:

- `tests/video2x-adapter.test.ts` hanging hash/filesystem deadline (5s timeout under load)
- `tests/windows-video-process-host.test.ts` `terminationConfirmed` race

Immediate isolation:

```
npx vitest run tests/video2x-adapter.test.ts tests/windows-video-process-host.test.ts --reporter=dot
Test Files  2 passed (2)
Tests  89 passed | 1 skipped (90)
```

Earlier load flakes in this Phase 7 session (also isolation-pass): `memory-consolidator-large`, `golden-runner-end-to-end`, `GenerationDatabase` contentHashFile, `HybridRetriever` latency budget. The same files passed in isolation. This matches the v2.4.1 last-phase record of parallel-load timeouts that do not reproduce isolated.

Last clean desktop coverage on this product tree (Phase 5, no desktop product change in Phases 6-7): 209 files, 1921 passed, 1 skipped; lines 86.79%, branches 81.43%, functions 82.05% (thresholds 80/80/70/80).

`python scripts/check_model_prompting_freshness.py --advisory` is absent (QG-6). Advisory no-op.

A parallel `npm run test` rewrote `tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json` ingest/compact timings. That fixture is restored and is not part of this commit.

## Publication and integration

Phase 7 local commit is created in the same change set as this evidence. Push, merge, tag, and GitHub Release remain unauthorized until T043.

Resolved branching model:

- Remote: `origin` (`https://github.com/bendourthe/Nexus-AI.git`)
- Branch: `feat/v2.4.1-field-reliability` (ahead of its upstream by 13 commits before this one)
- Integration target: `develop` (not `main`)
- Existing open PR: [58](https://github.com/bendourthe/Nexus-AI/pull/58) already points this head at `develop`. An approved push updates that PR; a second integration PR is not opened unless 58 is closed or retargeted.
- Default branch protection: unavailable (`gh` HTTP 404)

Expected checks after an approved push (QG-5):

- Feature-branch **push** runs `ci.yml` (Lint/Test TypeScript, coverage gate, and the rest of root CI) and path-gated `installer-tests.yml` (this branch includes `scripts/installer/**` and `desktop/**`).
- `commitlint.yml` runs on any pull_request.
- `shell-build.yml`, `pr-quality.yml`, and `coverage-diff.yml` do **not** run on a develop-targeted pull_request today (`pull_request.branches` is `main` only). `shell-build.yml` does run on **push** to `develop` after merge.
- There is no always-resolving aggregate required check.

A red remote check reopens this phase: reproduce locally before any re-push. Merge only on green required checks plus user approval. `/update release` waits on a green merged integration. Never tag from this driver.
