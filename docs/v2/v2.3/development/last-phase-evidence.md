# Last-Phase Evidence - v2.3.0 Phase 6

**Project**: Nexus AI Studio
**Plan**: [Local Video Enhancement and Security Audit Intake](../plans/v2.3.0-adoption-qwen-video2x-openworker.md)
**Date**: 2026-08-28
**Driver**: `/implement full` final phase (Phase 6 of 6)
**Branch**: `feat/v2.3.0-qwen-video2x-openworker` (merged via PR 52)
**Package**: **2.2.9** during Phase 6; **2.3.0** at `/update release` on 2026-08-29

Each section quotes the proving command or scan per the fail-closed last-phase gate.

## Architecture refactor

`npm run cleanup:scan` (2026-08-28):

```
[cleanup-scanner] scanned C:\Users\bdour\Documents\Projects\Development\Nexus-AI at 2026-08-29T03:16:35.136Z
  note: no MemoryStore database found at .nexus/memory.db; skipping DB checks

  stale-cache-files:         0
  deleted-path-references:   0
  orphan-memory-rows:        0
  orphan-fts-rows:           0
  dangling-embeddings:       0

Total findings: 0
```

`npm run check:docs-layout`:

```
check-docs-layout: canonical layout OK (no docs/versions|docs/archive/versions wrappers)
```

Empty-directory scan (PowerShell, excluding `node_modules`, `out`, `dist`, `.git`, `target`, `__pycache__`, `coverage`, `.venv`):

```
.vscode-test\inspect-user\User
desktop\.ruff_cache\0.15.11
desktop\src-tauri\.ruff_cache\0.15.11
modules\coding\skills\catalog\__nonexistent_user__
modules\coding\skills\catalog\__none__
```

Those are local caches and skill-catalog placeholders. Propose-then-apply: no file moves. The v2.3.1 installer-field docs live on local `develop` (`39c5007`) and are not on this branch.

Phase 6 code change: `desktop/tests/sidecar-handlers.test.ts` now treats `video.enhancement.*` and `video.video2xPath.*` as implemented (the aggregate handler allowlist still expected `NotImplementedError`).

## Known-gaps reconciliation

Glob `docs/**/known-gaps.md` found 29 files (canonical `docs/v*/v*/` plus archive). No `docs/releases/**/known-gaps.md` tree exists.

| File | Status line | Disposition |
| ---- | ----------- | ----------- |
| `docs/v2/v2.3/known-gaps.md` | finalized (2026-08-29) | Reconciled in Phase 6; finalized at the 2.3.0 bump. Open: DF-1, DF-2, DF-3, DF-4, WN-1, MT-1, QG-1, QG-2. |
| `docs/v2/v2.2/known-gaps.md` | finalized | Closed cycle. Open rows stay in that file for later `/plan` ingest. No v2.3.0 edit. |
| `docs/v2/v2.1/known-gaps.md` | finalized | No v2.3.0 action. |
| `docs/v2/v2.0/known-gaps.md` | in-progress | Hardware/audio/avatar DF rows remain that cycle's. Indexed, not closed here. |
| `docs/v1/v1.20/known-gaps.md` | in-progress | DF-5 / DF-6 Docling/OCR. Indexed, not closed here. |
| `docs/v1/v1.19/known-gaps.md` | in-progress | LFM/catalog DF rows. Indexed, not closed here. |
| `docs/v1/v1.5`, `v1.3`, `v1.8`, `v1.9` | historical in-progress / COMPLETE / open wording | Cycle-complete or operator-rehearsal leftovers. Not rewritten. |
| Remaining `docs/v1/*` and `docs/archive/v0/*` | finalized / closed / complete | No v2.3.0 action. |

v2.3.0 open items after this phase: DF-1 hydrate Enhance, DF-2 Hub v4.1.1 unreleased, DF-3 real Video2X/GPU/packaged measurement, DF-4 missing `check_release_preconditions.py`, WN-1 jsdom canvas notices, MT-1 VideoLabPage function coverage on the Phase 4 focused run, QG-1 named CI profiles, QG-2 workflow permissions and aggregate required check.

## Living docs architecture

- `docs/handbooks/` is absent. This repository's living tree is `docs/v*/`, `docs/adr/`, `docs/DEVLOG.md`, `docs/todos.md`, `docs/index.md`, and root `README.md`. Self-gate: `docs/testing/` and `docs/validation/` were not invented.
- `docs/adr/README.md` exists as the MADR index.
- `npm run check:docs-layout` passed (quoted above). Markdown is the source of truth; no generated `html/` handbook atlas exists to disagree with.
- Product copy for optional enhancement lives in `README.md` (Video Lab), `ARCHITECTURE.md` (Video Lab paragraph), and `docs/v2/v2.3/benchmarks/video-enhancement-baseline.md`.

## Git-tree hygiene

`scripts/check_release_preconditions.py` does not exist (DF-4). Report produced from git (report-only, nothing deleted):

```
HEAD: feat/v2.3.0-qwen-video2x-openworker
remote: https://github.com/bendourthe/Nexus-AI.git
merge-base with local develop: c63f47f10bd516330ec22d5091997c5d26e5aaca
this branch commits not in develop:
  0e4b41b docs(v2.3.0): lock phase 1 enhancement contracts
  7d94f93 feat(v2.3.0): add guarded video enhancement core
  40174cd feat(v2.3.0): add durable video enhancement jobs
  6989f16 feat(v2.3.0): add Video Lab enhancement experience
  5f48246 feat(v2.3.0): add enhancement bench and packaging
  (plus this phase's final commit)
develop not in this branch:
  3bea05e docs(v2.4.0): add Unsloth Qwen and Gaussian Splatting comparison and plan
  39c5007 docs(v2.3.1): add installer field-repair plan and review
origin/main: fdd155f chore(release): merge v2.2.9 into main
```

Merged historical `origin/feat/v1.*` branches remain on the remote. `branch-cleanup.yml` exists. Report only; no branch was deleted.

## CI/CD coverage

**Detect**: GitHub Actions (`.github/workflows/*.yml`, 19 workflow files). Not none.

Per-field comparison against cicd-architect (existing-pipeline mode). No workflow file was changed. Silence is not approval.

| Field | Observable evidence | Result |
| ----- | ------------------- | ------ |
| Provider | `.github/workflows/ci.yml` and siblings | PASS |
| Profiles | `npm test`, `npm run test:shell`, `npm run lint`, `python -m pytest tests/python`, installer `uv run pytest` exist and are what CI invokes. Named `fast` / `full` / `platform` / `report` / `release` npm scripts are absent. | DIFF recorded as QG-1 |
| Events | `ci.yml` `push` (all branches except dependabot) plus `pull_request` to `main`. Feature-branch PRs into `develop` rely on the push trigger, not a develop pull_request trigger. After PR 52 merged, the develop push reran the complete CI suite (QG-2 finding). | DIFF recorded as QG-2 |
| Runners | Hosted `ubuntu-latest`; Windows `init.ps1` on push only (`github.event_name != 'pull_request'`). No self-hosted untrusted runners. | PASS |
| Aggregate required check | No always-resolving aggregate job in `ci.yml`. | DIFF recorded as QG-2 |
| Permissions | `ci.yml` has no workflow-level `permissions`. Some sibling workflows set explicit permissions. | DIFF recorded as QG-2 |
| Immutable actions | SHA-pinned `actions/checkout@93cb6efe... # v5.0.1` and peers | PASS |
| Caching | `actions/setup-node` `cache: npm`; pip cache on python job | PASS |
| Concurrency | `ci.yml` `cancel-in-progress: true` | PASS |
| Path scoping | `installer-tests.yml` path-filtered including `scripts/installer/**`. `ci.yml` is not path-filtered. | PASS for installer tests; existing CI cost topology left unchanged |
| Artifact retention | `retention-days: 7` (coverage/build), 14, 30 on selected jobs | PASS |
| Structured reports | Coverage lcov uploaded from test-ts. No repository `reports/summary.md` profile directory. | DIFF folded into QG-1 |
| Deployment boundaries | `release.yml` and `semantic-release.yml` are separate from pull-request CI | PASS |
| Failure recovery | `fail-fast: false` on node matrices | PASS |
| Installer parity | One Windows Python provisioning installer. macOS/Linux receive VSIX; raw Tauri bundles remain withheld (v2.2.9 DF-38). Video2X is not an installer-distributed artifact. Cross-installer Video2X parity is a silent no-op (optional user-installed executable). | PASS (no-op) |

Proposed and not applied: named npm profile aliases; `permissions: contents: read` on `ci.yml`; an aggregate required job; add `develop` to `pull_request.branches`.

`npm run check:tampering`: `nexus-check: 0 findings`.

## Goal-vs-codebase review

**Plan Goal restated**: By the end of v2.3.0, Video Lab offers an optional, local, cancellable enhancement workflow that can upscale and/or interpolate a completed generation without replacing the original, records complete provenance, fails honestly on unsupported hardware or missing backends, and has measured quality and resource evidence; Qwen3.8-Flash-Next remains excluded behind explicit catalog-admission gates; and OpenWorker's useful security-workflow refinements have a versioned Nexus-Hub handoff without importing OpenWorker, cloud services, or unsafe auto-approval.

Independent inspection of the tree (not the session notes):

| Goal clause | Artifacts | Verdict |
| ---------- | --------- | ------- |
| Optional local cancellable enhancement of a completed generation | `core/video/VideoEnhancement.ts`, `desktop/sidecar/src/video/VideoEnhancementRuntime.ts` (`jobType: "video_enhancement"`), IPC `video.enhancement.capability\|enqueue\|list\|cancel`, `desktop/src/modules/video/VideoEnhancementPanel.tsx`, `VideoLabPage.tsx` Enhance action | LANDED at internal-compatible automated evidence |
| Does not replace the original | Runtime preserves source bytes; UI uses distinct `nexus-video-original-` / `nexus-video-enhanced-` downloads | LANDED |
| Complete provenance | `core/video/WorkflowMetadata.ts` durable/embedded provenance; publication transaction in Phase 3 runtime | LANDED |
| Honest failure on missing backend / unsupported host | Capability reasons, Settings > Video path, installer note (not a toggle), typed bench `--backend real` failures | LANDED for configuration; live Vulkan/macOS field behavior is DF-3 |
| Measured quality and resource evidence | `scripts/bench-video-enhancement.mjs` fake backend 8/8; baseline labels untested rows **not proven here** | PARTIAL: fake contract observed; real GPU/VRAM/Video2X is DF-3, not a silent pass |
| Qwen3.8 excluded | `docs/v2/v2.3/development/model-admission-qwen38.md`; `core/registry/catalog.json` has no Qwen3.8 / qwen3.8 match | LANDED |
| OpenWorker is Hub handoff only | `docs/v2/v2.3/development/nexus-hub-security-audit-handoff.md`; no OpenWorker import; Hub v4.1.1 not released (DF-2) | LANDED as handoff; not claimed as consumed Hub capability |
| Hydrated Enhance | Studio turns persist media path, not output id/hash | GAP recorded as DF-1 |

No unresolved Goal miss without a recorded gap. Live "supported machine" enhancement remains DF-3. Product copy calls that envelope candidate.

## Human/manual testing suggestions

These are suggestions only. They were not executed in this phase. Perceptual and packaged hardware review remains DF-3.

1. On a Windows x64 host with AVX2, a usable Vulkan GPU, and a user-installed Video2X 6.4.0 absolute path in Settings > Video (or `NEXUS_VIDEO2X_PATH`): enhance a completed 480p and 720p clip with animation 2x, general 4x, Smooth 2x, and one combined preset. Confirm the original download still plays and a second enhanced file appears.
2. Compare faces, Latin and non-Latin text, animation edges, repeated texture, fast motion, and occlusion between original and enhanced. Treat invented detail as expected; record artifacts rather than a numeric quality score.
3. Cancel a running enhancement under load. Confirm the child stops, partial output is not presented as success, and the original is unchanged.
4. On macOS or a CPU-only / non-Vulkan host: Enhance stays disabled with the shared capability copy. Settings still accepts a path and does not search PATH.
5. Packaged Windows app: configure the Video2X path after install (the wizard must not install Video2X). Recheck capability. Confirm env override wins over the setting.
6. Remount a saved Video Lab session (DF-1): expect playable original without Enhance until identity persistence exists.
7. Confirm `core/registry/catalog.json` still has no Qwen3.8 row in Settings > Models.

## Full-suite testing and stabilization

Local gate (2026-08-28 / 2026-08-29 local clock), before publication:

- `npm run lint`: pass
- `npm run lint:shell`: pass (`eslint src sidecar/src tests --max-warnings=0`)
- `npx tsc -b`: pass
- `npm run check:docs-layout`: pass
- `npm run cleanup:scan`: 0 findings
- `npm run check:tampering`: 0 findings
- `npm run check:naming`: `check-no-devai-hub: clean`
- `python -m pytest tests/python -q`: **261 passed**
- Installer `uv run pytest tests/ -q -o "addopts="`: **1162 passed, 3 skipped**
- `npm test -- --coverage`: **Test Files 527 passed | 3 skipped (530)** / **Tests 5693 passed | 12 skipped (5705)** / All files **87.66%** statements and lines, **83.65%** branches, **90.45%** functions
- Desktop aggregate: first parallel run failed 4 tests (stale handler allowlist plus 3 adapter 5000ms timeouts under CPU contention with root coverage). Handler allowlist fixed. Isolated `bounds a hanging filesystem` passed in 117ms. Isolated `npm run test:shell:coverage`: **Test Files 199 passed (199)** / **Tests 1820 passed | 1 skipped (1821)** / All files **87.39%** statements and lines, **81.96%** branches, **83.66%** functions. `VideoLabPage.tsx` remains **86.94%** lines and **72.41%** functions (MT-1).

Advisory model-prompting freshness: `scripts/check_model_prompting_freshness.py` does not exist. Recorded as a logged no-op (skill: never blocks, degrades offline / missing helper).

## Publication and integration

Quoted after 9F. Branch `feat/v2.3.0-qwen-video2x-openworker` pushed to origin. Integration PR https://github.com/bendourthe/Nexus-AI/pull/52 against `develop` merged at `52d72d10e8afeba0231fb69043efbfea3b2176ce` on 2026-08-29.

First `Test TypeScript (Node 22.x)` failed 3 Linux desktop tests (Windows-path fixtures). Reopened, fixed with host-absolute tmpdir fixtures (`e7e4368`), second push green: all registered PR checks SUCCESS including Node 22.x tests and the 80% coverage gate. Installer tests passed on the first push. Post-merge develop push reran CI, Installer tests, and Shell Build; all succeeded (QG-2: duplicate full CI suite after feature-branch push).

`/update release` proceeds from this green merge. Tag and GitHub Release remain confirmation-gated.

Resolved branching model: develop+main. Protected release branch is `main`. Integration target is `develop`. Remote is `origin` (`https://github.com/bendourthe/Nexus-AI.git`).
