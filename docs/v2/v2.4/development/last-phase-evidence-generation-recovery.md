# v2.4.1 Generation Recovery Last-Phase Evidence

**Date**: 2026-08-30
**Branch**: `feat/v2.4.1-field-reliability`
**HEAD at evidence start**: `b11cec7` (Phase 6). Phase 7 product and docs changes are uncommitted beside that commit.
**Installer candidate**: unsigned `dist/NexusSetup.exe`, SHA-256 `E29725ADE5671271962CE9FB6DE66DCAA38BA182DC257802DFA835C78120490D`
**Status**: Phase 7 local gates complete. Packaged PNG/MP4 proof is recorded. Publication remains blocked until one Phase 7 commit exists and T097 push/PR is explicitly approved.

## Architecture refactor

Propose-only. `project-refactor` and `docs-layout-refactor` were loaded from `C:\Users\bdour\.agents\skills` (repository `catalog/skills/` paths are absent; see QG-2). No file was moved or deleted.

> Empty-directory scan (depth <= 5, excluding `node_modules`, `.git`, `dist`, `target`, `coverage`, `__pycache__`, venvs):
> `.vscode-test\inspect-user\User`
> `desktop\.ruff_cache\0.15.11`
> `desktop\src-tauri\.ruff_cache\0.15.11`
> `modules\coding\skills\catalog\__nonexistent_user__`
> `modules\coding\skills\catalog\__none__`
> `out\backend`
> `out\skills`
>
> These are generated caches or test fixtures, not obsolete source trees.

> Root inventory (Stay unless noted): community files `README.md`, `CHANGELOG.md`, `SECURITY.md`, `AGENTS.md`, `ARCHITECTURE.md`, lockfiles, and configs remain at root per the skill Stay rules. `docs/DEVLOG.md` is already in `docs/`.
>
> Layout proposals that require a separate confirmation (not applied):
> 1. `clean-state-checklist.md` at repo root is not a community file. Candidate move: `docs/guides/` or `docs/v2/v2.4/development/`.
> 2. `feature_list.json` at repo root is a machine-readable catalog. Candidate move: `data/`.
> Untracked/gitignored VSIX copies and `.nexus-phase6-test.log` at root are local artifacts, not tracked source.

No obsolete tracked filename and no byte-identical duplicate source candidate were found in this pass. The v2.4 documentation tree stays in place (`docs/v2/v2.4/`). Historical ADRs stay in `docs/adr/`.

## Known-gaps reconciliation

Glob: 31 `docs/**/known-gaps.md` files.

Active (Status in-progress, open, or incomplete): `docs/v2/v2.4/known-gaps.md`, `docs/v2/v2.3/known-gaps.md`, `docs/v2/v2.0/known-gaps.md`, `docs/v1/v1.20/known-gaps.md`, `docs/v1/v1.19/known-gaps.md`, `docs/v1/v1.8/known-gaps.md`, `docs/v1/v1.5/known-gaps.md`, `docs/v1/v1.3/known-gaps.md`. Finalized and archive ledgers were left unchanged.

This cycle closed QG-1 and QG-3 by adding the missing helpers. QG-2 remains because the repository catalog still lacks the indexed skill files. QG-5 records declined-pending CI differences. QG-6 records the absent advisory model-prompting helper. DF-1 through DF-7 stay open. DF-2 (real NVIDIA generation) is a publication blocker for this plan and is not downgraded.

No historical GPU or visual row in older ledgers was closed.

## Living docs architecture

Created the smallest living tree without moving versioned release docs:

- `docs/README.md` (living entry)
- `docs/handbooks/README.md`, `markdown/generation-recovery.md`, `markdown/atlas.md`
- `docs/handbooks/technical/installer-runtime.md`, `media-runtime.md`, `transcript-and-workspaces.md`
- generated `docs/handbooks/html/` companions
- `docs/decisions/README.md` (index only; ADRs remain in `docs/adr/`)
- existing `docs/DEVLOG.md` and `docs/todos.md`

Commands:

```
npm run docs:handbooks:check --silent
generate-handbooks: 5 source(s) match

npm run check:docs-layout --silent
check-docs-layout: canonical layout OK (no docs/versions|docs/archive/versions wrappers)
```

No `docs/testing/` or `docs/validation/` directory was invented.

## Git-tree hygiene

Report only. No branch was deleted.

```
python scripts/check_release_preconditions.py --branches --repo-settings

[branches]
current=feat/v2.4.1-field-reliability
head=b11cec7d9b09
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

`origin/feat/v2.4.1-field-reliability...HEAD` is `0 6`: the six generation-recovery phase commits are local only. Integration target remains `develop`. Default-branch protection is unavailable through `gh` (HTTP 404), which is an observation, not a mutation.

## CI/CD coverage

Provider detected: GitHub Actions (19 workflow files under `.github/workflows/`).

| Contract field | Observable evidence | Difference |
|---|---|---|
| Event separation | `ci.yml` push (ignore dependabot) plus PR; installer/shell path filters; release on tags | Several PR workflows list `branches: ["main"]` only |
| Runner selection | ubuntu-latest for CI; shell-build ubuntu on PR/develop, full OS matrix on main | Inherited cost control; not changed |
| Aggregate required check | No always-resolving aggregate job | Missing (QG-5) |
| Permissions | Present on commitlint, release, pr-quality | `ci.yml` has no top-level `permissions:` block |
| Immutable references | checkout and setup-node pinned by SHA with version comments | Other `uses:` lines may still use mutable tags; not rewritten |
| Caching | `actions/setup-node` `cache: npm` in CI | Present |
| Concurrency | `ci.yml`, shell-build, pr-quality, commitlint, release | Present on the primary workflows |
| Path scoping | installer-tests and shell-build | Present |
| Retention | not uniformly declared | Environment/policy difference |
| Structured reports | coverage gate job in `ci.yml` | Present |
| Deployment boundary | `release.yml` is tag/workflow_dispatch only | Present |
| Failure recovery | concurrency cancel-in-progress on CI | Present |
| Installer tests | `.github/workflows/installer-tests.yml` pytest + headless smoke on path filter | PR event is main-only; feature-branch push still runs |
| Runtime lease tests | installer pytest includes `test_diffusion_venv_provisioner.py` and `test_runtime_provisioner.py` | Covered on installer path changes |
| Catalog parity | installer-tests path includes `core/registry/catalog.json` | Present |
| Packaging contract | installer-tests plus local `smoke-windows-exe.ps1` | Packaged media is local/operator, not CI GPU |
| Repository-native profiles | no `fast` / `full` / `platform` / `report` / `release` npm scripts | Missing (QG-5) |
| One-installer parity | single Windows `NexusSetup.exe` | Silent no-op |

Proposal (not applied; waiting for explicit approval):

1. Add `develop` to `pull_request.branches` on `ci.yml`, `installer-tests.yml`, and `shell-build.yml` so the merge result of the integration PR is tested. Cost: extra PR minutes on develop-targeted PRs. Risk: low. Smallest fix.
2. Optionally add the same branch to `pr-quality.yml` and `coverage-diff.yml`.
3. Do not add an aggregate required-check job or npm profile scripts in this phase unless separately approved.

Workflow files were not modified.

## Goal-vs-codebase review

**Plan Goal restated**: Before v2.4.1 is released, a clean or repair installation on a supported Windows NVIDIA host must recover from interrupted runtime work and produce one valid local image and one valid local video from the packaged application; installer and desktop must then present truthful, compact, consistent authorization, warnings, model ordering, transcript metadata, archived data, training capability, and Agents workspace controls.

| Goal slice | Code/docs artifact | Gap |
|---|---|---|
| Stale repair lease reclaimed | `scripts/installer/src/nexus_installer/engine/diffusion_venv_provisioner.py` owner-start lease; tests in `test_diffusion_venv_provisioner.py`. Live field lock PID `18096` was quarantined as `.diffusion-repair.lock.invalid-*`. | Observed on this host. |
| Runtime schema cannot remain repairing after owner exit | RuntimeProvisioner writes schemaVersion 3. Current `runtime.json` is schema 3 / `diffusion.status=ready` / torch 2.3.0+cu121 / `cuda_available=true`. | Observed. |
| Packaged PNG and video | `scripts/installer/build/smoke-installed-media.ps1` against installer `E29725ADE5671271962CE9FB6DE66DCAA38BA182DC257802DFA835C78120490D`. PNG 512x512 SHA-256 `1db719ce7693e918e958e22f6b7de34fe9bede4b5e9b128bdad4fc96db35fa80`. MP4 H.264 848x480 13 frames SHA-256 `60bb5cb281b7845ec7839467ba4d3ababd3a15cea52dd43e4cdfbb54a9a22422`. | Observed. Reboot persistence Not observed. |
| UI telemetry cannot fake model failures | Phase 1 engine/result isolation (committed `d51b14e`). | Packaged completion screenshot not observed. |
| SANA public INT4 | `core/registry/catalog.json` `sana-1.6b-int4` -> `nunchaku-ai/nunchaku-sana` commit `437e41b979ec875f63c18e67d55373aa5230c308`. | Live gated-account fixture not observed. |
| Settings grouping and recommendation | Phase 4 shared rank contract (`ef04a6b`). | Packaged installer/Settings screenshot not observed. |
| Role-correct tokens | `core/chat/tokenUsage.ts` `RequestTokenUsageV1` vs `MessageTokenUsageV1`; Phase 5 UI (`720df55`). | Packaged `Hi` transcript not observed. |
| Compact transcript | Phase 5 MessageBubble/ChatPage (`720df55`). | Packaged pending-animation geometry not observed. |
| Compact Agents | `desktop/src/modules/coding/CodingPage.tsx` (`b11cec7`). | Packaged compact-header screenshot not observed. |
| Headless repair equals GUI runtime wiring | `_run_headless` always calls `RuntimeProvisioner`; profile `field-media-repair.json`; focused installer tests including required-media failure. | First packaged run reclaimed the lease then failed `SMOKE_TIMEOUT` at 45s and reported headless success. Source now uses a 300s smoke and fails the required runtime step when selected media is not ready. Replacement installer not yet frozen in this continuation. |

Nine screenshot groups and the stale runtime/log from the plan header are traced: lease/runtime (field files plus live reclaim), false model warnings (Phase 1), HF/SANA (Phase 2 catalog pin), Settings order (Phase 4), token chrome (Phase 5), transcript layout (Phase 5), Agents (Phase 6), archives/training (Phase 4), completion warnings (Phase 2). Completing checkboxes is not treated as packaged proof.

Independent-review miss: reboot persistence of PNG/MP4 after a machine restart is Not observed. Clean-install visuals, gated Hugging Face account, Settings/Data/Training walkthrough, and packaged transcript/Agents screenshots remain Not observed (DF-1, DF-3 through DF-7). Required media artifacts are proven.

## Human testing

Host: Windows 11 Pro build 26200, NVIDIA GeForce RTX 3080 Ti Laptop GPU 16,384 MiB, driver previously recorded as 596.08.

Exact installer: SHA-256 `E29725ADE5671271962CE9FB6DE66DCAA38BA182DC257802DFA835C78120490D` (239.2 MB unsigned freeze after sidecar generation timeout, fp16 SDXL load, Wan 16-align, and numpy frame export). Frozen `smoke-windows-exe.ps1` passed.

Packaged repair recovered the stale PID-only lock, installed CUDA torch 2.3.0+cu121, and left `runtime.json` schema 3 / `ready`. Headless now fails when selected media is not ready (300s diffusion smoke).

Installed-media harness (NEXUS_DIFFUSION_ALLOW_STUB=0) passed at 2026-08-30 21:53Z:

- Host: Windows 11 Pro 26200, RTX 3080 Ti Laptop, driver 596.08
- Image `realvisxl-v5`: 512x512 PNG, 330437 bytes, sampled variance 4034.6219, SHA-256 `1db719ce7693e918e958e22f6b7de34fe9bede4b5e9b128bdad4fc96db35fa80`
- Video `wan2.1-t2v-1.3b`: H.264, 848x480 (16-aligned from advertised 854x480), 13 frames, 1.083 s, SHA-256 `60bb5cb281b7845ec7839467ba4d3ababd3a15cea52dd43e4cdfbb54a9a22422`
- Report: `docs/v2/v2.4/development/installed-media-smoke-report.json` (gitignored)

Remaining operator checklist items (clean-install visuals, gated Hugging Face account, reboot persistence, Settings/Data/Training walkthrough, transcript and Agents screenshots) stay Not observed.

## Full-suite testing and stabilization

```
python -m pytest tests/python -q
272 passed in 2.94s

uv run pytest tests -q   (scripts/installer)
passed after isolating host venv paths; 3 skips retained

uv run ruff check . && uv run ruff format --check .
All checks passed / 174 files already formatted

cargo fmt --all -- --check; cargo clippy --all-targets -- -D warnings; cargo test --quiet
exit 0

npm run lint; npm run build; npm run lint --workspace @nexus/desktop; npm run typecheck --workspace @nexus/desktop
exit 0

npm run deps:check; npm run check:docs-layout; npm run docs:handbooks:check; npm run check; npm run check:naming; npm run check:audit-prod; npm run catalog:check
exit 0

python scripts/validate_unicode_safety.py --strict --root . --path <Phase 7 text paths>
failures=0

npm run test -- --coverage --reporter=dot
Test Files  529 passed | 3 skipped (532)
Tests  5731 passed | 12 skipped (5743)
Coverage 87.74% statements/lines, 83.49% branches, 90.49% functions

npm run test:shell:coverage
Test Files  204 passed (204)
Tests  1881 passed | 1 skipped (1882)
Coverage 86.73% statements/lines, 81.41% branches, 82.03% functions
```

Isolated rerun: `tests/sidecar-handlers.test.ts` and `tests/video2x-adapter.test.ts` passed 93/1 skipped after adding `diffusion.runtime.*` to the implemented-method allowlist. Two Video2X 5s timeouts appeared only under the first parallel desktop coverage run and did not reproduce in isolation.

Frozen packaging: `smoke-windows-exe.ps1` passed for `E29725ADE5671271962CE9FB6DE66DCAA38BA182DC257802DFA835C78120490D`. Installed-media harness passed as quoted under Human testing.

`python scripts/check_model_prompting_freshness.py --advisory` is absent (QG-6). Advisory no-op.

## Publication and integration

Phase 7 local commit is created in the same change set as this evidence. Push, pull request, merge, tag, and GitHub Release remain unauthorized. Integration target is `develop`. `/update release` waits on a green merged integration.
