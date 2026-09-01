# v2.4.3 Field Density Last-Phase Evidence

**Date**: 2026-08-31
**Branch**: `feat/v2.4.1-field-reliability`
**HEAD at evidence start**: `70fd31a` (Phase 7). Phase 8 evidence and docs are uncommitted beside that commit.
**Status**: Phase 8 local gates complete. Publication remains blocked until T040 push/PR is explicitly approved. Package version stays **2.4.1** until `/update release`.

## Architecture refactor

Propose-only. `project-refactor` and `docs-layout-refactor` were loaded from the operator skill install (`C:\Users\bdour\.codex\skills`). Repository `catalog/skills/` paths remain absent (QG-2). No file was moved or deleted.

Proving scan (repo root; skip `node_modules`, `dist`, `coverage`, `.git`, `target`, `__pycache__`, `.ruff_cache`, `.venv`, `venv`, `out`, `htmlcov`, `.pytest_cache`):

```
empty_dirs 3
.vscode-test\inspect-user\User
modules\coding\skills\catalog\__nonexistent_user__
modules\coding\skills\catalog\__none__
```

The two `modules\coding\skills\catalog\` directories are skill-catalog test fixtures, not obsolete product trees. `.vscode-test\inspect-user\User` is a local VS Code test harness directory. No empty product source directory and no redundant v2.4.3 file were found.

Layout proposals that require a separate confirmation (not applied; same as v2.4.2):

1. `clean-state-checklist.md` at repo root is not a community file. Candidate move: `docs/guides/` or `docs/v2/v2.4/development/`.
2. `feature_list.json` at repo root is a machine-readable catalog. Candidate move: `data/`.

The v2.4 documentation tree stays in place (`docs/v2/v2.4/`). Historical ADRs stay in `docs/adr/`.

## Known-gaps reconciliation

Glob: 30 `docs/**/known-gaps.md` files (canonical `docs/v*/` plus `docs/archive/v0/`). Canonical `docs/releases/v<MAJOR>/v<MAJOR>.<MINOR>/known-gaps.md` is absent (layout is `docs/v2/v2.4/`).

Active (Status in-progress, open, incomplete, or COMPLETE with remaining open items): `docs/v2/v2.4/known-gaps.md`, `docs/v2/v2.3/known-gaps.md`, `docs/v2/v2.0/known-gaps.md`, `docs/v1/v1.20/known-gaps.md`, `docs/v1/v1.19/known-gaps.md`, `docs/v1/v1.9/known-gaps.md` (COMPLETE with remaining rehearsal items), `docs/v1/v1.8/known-gaps.md`, `docs/v1/v1.5/known-gaps.md`, `docs/v1/v1.3/known-gaps.md`. Finalized and archive ledgers were left unchanged.

This cycle did not close v2.4.2 MT-1 through MT-6. They remain operator observations (`not_observed != absent`). v2.4.3 added MT-1 through MT-7 for packaged observations this plan did not take. v2.4.1 DF-1 and DF-3 through DF-7 carry forward. DF-2 stays Resolved from generation-recovery. QG-2, QG-5, and QG-6 stay open. No historical GPU or visual row in older ledgers was closed.

9A grep of this cycle's desktop, installer, and runtime sources found one pre-existing `# DEVIATION:` in `desktop/src/shared/explorer/codingSessionsAsChatExplorer.ts` (overlay-folder reparent). It is not new in v2.4.3 and is not recorded as a v2.4.3 gap.

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
head=70fd31a5c718
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

`origin/feat/v2.4.1-field-reliability...HEAD` is `0 21` before this Phase 8 commit (seven v2.4.3 product commits plus earlier local v2.4.2 and generation-recovery work). Integration target remains `develop`. Default-branch protection is unavailable through `gh` (HTTP 404), which is an observation, not a mutation.

v2.4.3 plan commits: `b384027`, `357ce3e`, `2afc306`, `3f22d87`, `0b4a424`, `062d9b5`, `70fd31a`, plus this Phase 8 docs commit.

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
| Path scoping | installer-tests (`scripts/installer/**` plus catalog) and shell-build (`desktop/**`, `core/**`, `modules/**`) | Present; covers Phases 1-7 product paths |
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

Workflow files were not modified. Existing jobs already cover installer pytest, root vitest catalog tests, desktop vitest, and `tests/python/diffusion`.

## Goal-vs-codebase review

**Plan Goal restated**: A 16 GB NVIDIA install refuses Unsloth when it is incompatible, uses two-column installer summaries, selects and names a new chat on first send, restyles the last puppy instead of reprinting it, keeps the thinking glow inside a fixed-width pill, centers delete confirmation, lists models in installer recommend order with icon actions, and either plays a SANA-Video clip or explains a real missing-file reason.

| Goal slice | Code/docs artifact | Gap |
|---|---|---|
| Unsloth Incompatible cannot be ticked; this 16 GB host is Compatible after GPU detection | `configuration.py` `_unsloth_host_ok` is NVIDIA plus `display_vram_gb(vram_mb) >= 16`. `_apply_unsloth_host_lock` disables and clears the checkbox when not ok, and refreshes on show. | Packaged wizard screenshot is Not observed (v2.4.3 MT-1). |
| Configuration two columns (Components / Features) | `configuration.py` `_split` places Components and Features in two columns. | Packaged layout is Not observed (MT-1). |
| Review two columns, GPU whole GB, Estimated installation time | `review.py` uses `display_vram_gb`. Time label renamed in Phase 1 tests. | Packaged Review is Not observed (MT-1). |
| Hairline under module tabs | `Sidebar.tsx` `data-testid="sidebar-history-hairline"`. | Packaged pixels are Not observed (MT-2). |
| New chat selects empty | `FolderTree` create path calls the same `onSelect` as a row click (Phase 2 tests). | Packaged select is Not observed (MT-2). |
| First Image prompt titles the row | `ImageStudioPage.tsx` `shouldTitleOnFirstSend`. | Packaged title is Not observed (MT-2). |
| Make the puppy black restyles fur | `RESTYLE_IMG2IMG_STRENGTH = 0.7`, identity prompt, fail-closed without last PNG. | Packaged NVIDIA before/after is Not observed (MT-6). |
| Thinking pill fixed width and inset glow | `captionRotator.ts` `PENDING_PILL_INSET_PX = 12` and min-width from `Searching...`. | Packaged glow pixels are Not observed (MT-3). |
| Delete confirmation centered | `FolderTree.tsx` portals confirm to `document.body`. | Packaged center is Not observed (MT-2). |
| Settings one facts line and icon actions | `ModelsSettings.tsx` nowrap facts; `CircleCheck` / `Trash2` / `Download` with rgb colors. | Packaged Settings is Not observed (MT-4). |
| Pickers in installer recommend order; Agents empty is not gpt-oss 20B | `recommendOrderForTask`; `resolveDefaultId` prefers recommended unless `applyFavorite`. 16 GB agentic default `gemma-4-12b-it-gguf`. | Packaged Agents picker is Not observed (MT-5). |
| SANA-Video plays or names a real missing file; never WanPipeline | Catalog complete Diffusers tree; `sana_video_execute` loads `SanaVideoPipeline`; incomplete trees name the missing path. 16 GB default video stays `wan2.1-t2v-1.3b`. | Packaged NVIDIA clip is Not observed (MT-7). |

Independent-review miss: none of the eleven operator items is proven on a packaged window in this session. Those misses are already MT-1 through MT-7. Completing T001-T039 is not treated as packaged proof. No Goal slice is missing from the code.

## Human/manual testing suggestions

Do not invent a walkthrough. Operator items for a packaged Windows NVIDIA host (this host: RTX 3080 Ti Laptop, 16384 MB):

1. Configuration two columns and Unsloth Compatible on this 16 GB NVIDIA host. Incompatible checkbox disabled on a simulated 8 GB host if available.
2. Review two columns, 16 GB GPU line, Estimated installation time.
3. Hairline under the four module tabs.
4. New chat selects the empty session immediately.
5. Image first prompt "Generate image of a puppy" titles the row.
6. Make the puppy black restyles fur, same composition.
7. Thinking pill glow at 100% and 150% zoom.
8. Delete confirmation centered in the window.
9. Settings one facts line and green / red / blue icon colors.
10. Agents empty session defaults to Gemma 4 12B on this install.
11. Opt-in SANA-Video either plays a clip or names a real missing Diffusers file.

All eleven remain Not observed here. They map to v2.4.3 MT-1 through MT-7.

## Full-suite testing and stabilization

```
npm run lint --silent   (repo root)
exit 0

npm run lint --silent; npx tsc --noEmit   (desktop/)
exit 0

npx tsc -b --pretty false   (repo root)
exit 0

python -m pytest tests/python -q
278 passed in 3.92s

uv run ruff check src tests   (scripts/installer)
All checks passed!

uv run pytest tests -q   (scripts/installer)
exit 0 (3 skipped; collect-only 1317)

npm run test -- --reporter=dot   (repo root, after npm rebuild better-sqlite3)
Test Files  529 passed | 3 skipped (532)
Tests  5735 passed | 12 skipped (5747)

npm run test -- --reporter=dot   (desktop/)
Test Files  2 failed | 207 passed (209)
Tests  2 failed | 1930 passed | 1 skipped (1933)
```

The first root vitest run failed with NODE_MODULE_VERSION 146 vs required 137 (`better-sqlite3`). Classified ENV. `npm rebuild better-sqlite3` on Node v24.13.0, then the suite passed.

The two desktop failures are classified ENV (resource contention under parallel load on Windows), not product defects:

- `tests/video2x-adapter.test.ts` hanging filesystem deadline (5s timeout under load)
- `tests/windows-video-process-host.test.ts` `terminationConfirmed` race

Immediate isolation:

```
npx vitest run tests/video2x-adapter.test.ts tests/windows-video-process-host.test.ts --reporter=dot
Test Files  2 passed (2)
Tests  89 passed | 1 skipped (90)
```

A parallel `npm run test` rewrote `tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json` ingest/compact timings. That fixture is not part of this commit.

`python scripts/check_model_prompting_freshness.py --advisory` is absent (QG-6). Advisory no-op.

## Publication and integration

Phase 8 local commit is created in the same change set as this evidence. Push, merge, tag, and GitHub Release remain unauthorized until T040.

Resolved branching model:

- Remote: `origin` (`https://github.com/bendourthe/Nexus-AI.git`)
- Branch: `feat/v2.4.1-field-reliability` (ahead of its upstream by 21 commits before this one)
- Integration target: `develop` (not `main`)
- Existing open PR: [58](https://github.com/bendourthe/Nexus-AI/pull/58) already points this head at `develop`. An approved push updates that PR; a second integration PR is not opened unless 58 is closed or retargeted.
- Default branch protection: unavailable (`gh` HTTP 404)

Expected checks after an approved push (QG-5):

- Feature-branch **push** runs `ci.yml` (Lint/Test TypeScript, coverage gate, and the rest of root CI) and path-gated `installer-tests.yml` (this branch includes `scripts/installer/**` and `desktop/**`).
- `commitlint.yml` runs on any pull_request.
- `shell-build.yml` push includes `develop`; its **pull_request.branches** is still `main` only. `pr-quality.yml` and `coverage-diff.yml` do **not** run on a develop-targeted pull_request today.
- There is no always-resolving aggregate required check.

A red remote check reopens this phase: reproduce locally before any re-push. Merge only on green required checks plus user approval. `/update release` waits on a green merged integration. Never tag from this driver.
