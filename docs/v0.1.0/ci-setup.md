# CI/CD Setup — Gemma Code v0.1.0

## Workflow Overview

Three GitHub Actions workflows govern the project lifecycle:

| Workflow | File | Trigger | Purpose |
|---|---|---|---|
| CI | `.github/workflows/ci.yml` | Every push and PR | Lint, test, build, coverage gate |
| Release | `.github/workflows/release.yml` | Push of a version tag (`v*.*.*`) | Build VSIX + installer, create GitHub Release |
| Nightly | `.github/workflows/nightly.yml` | 02:00 UTC daily + manual | Integration tests against live Ollama, benchmarks, failure notification |

---

## CI Workflow Jobs

The CI workflow runs the following jobs in parallel where possible:

```
lint-ts ──┐
test-ts ──┤── coverage-gate
build-ts  │
lint-py ──┤
test-py ──┘
```

**Required status checks** (must pass before merging to `main`):

- `lint-ts` — ESLint over `src/`
- `test-ts` — Vitest unit tests with coverage
- `build-ts` — `tsc` zero-error compilation
- `lint-py` — ruff check + format + mypy strict
- `test-py` — pytest unit + integration (mocked Ollama)
- `coverage-gate` — both TypeScript and Python must reach 80% line coverage

---

## Branch Protection Rules

Configure the following rules on the `main` branch via **Settings → Branches → Add branch protection rule**:

| Setting | Value |
|---|---|
| Require a pull request before merging | Enabled |
| Require status checks to pass before merging | Enabled |
| Required status checks | `lint-ts`, `test-ts`, `build-ts`, `lint-py`, `test-py`, `coverage-gate` |
| Require branches to be up to date before merging | Enabled |
| Require conversation resolution before merging | Enabled |
| Include administrators | Enabled |
| Allow force pushes | Disabled |
| Allow deletions | Disabled |

---

## Release Workflow

A release is triggered by pushing a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow:

1. Builds and packages the VSIX on `ubuntu-latest`.
2. Builds the Windows `setup.exe` installer on `windows-latest` using NSIS.
3. Creates a GitHub Release with both artifacts attached.
4. Extracts release notes from `CHANGELOG.md` for the matching version.

For pre-release builds, use a tag like `v0.1.0-rc.1` — the release will be marked as pre-release automatically.

---

## Nightly Workflow

The nightly workflow starts Ollama in the CI environment and pulls `gemma4:e2b` (the smallest Gemma 4 variant, ~7.2 GB) to keep download time reasonable. It runs the full integration test suite and performance benchmarks, uploading results as artifacts retained for 30 days.

**Failure notifications** are sent to Slack if `SLACK_WEBHOOK_URL` is set as a repository secret. Add it via **Settings → Secrets and variables → Actions → New repository secret**.

---

## Secrets Reference

| Secret | Required for | Description |
|---|---|---|
| `SLACK_WEBHOOK_URL` | Nightly failures | Incoming webhook URL for failure notifications |
| `VSCE_PAT` | VS Code Marketplace publish (future) | Personal access token for `vsce publish` |

---

## Local CI Simulation

Run each CI step locally to debug before pushing:

```bash
# TypeScript
npm run lint
npm run test
npm run build

# Python backend
cd src/backend
uv run ruff check .
uv run ruff format --check .
uv run mypy src/
uv run pytest tests/unit tests/integration -q --cov=src/backend
```
