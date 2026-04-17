# v0.3.0 Release Checklist

This checklist is the authoritative release gate for v0.3.0. Each item should be checked off in a PR description or GitHub issue before the `v0.3.0` tag is pushed.

## 1. Pre-release verification

- [ ] All CI checks pass on `main` (`ci.yml`)
- [ ] Weekly golden-tasks workflow has succeeded at least once with >= 90% pass rate on E2B
- [ ] Weekly golden-tasks workflow has succeeded at least once with >= 95% pass rate on E4B (if hardware allows)
- [ ] No open regression issues labelled `regression,automated`
- [ ] Installer smoke tests pass on all 3 platforms (weekly `installer-smoke.yml`)
- [ ] E2E integration tests pass (`tests/integration/e2e/*`) on `main`
- [ ] Benchmark results are within thresholds from [performance-benchmarks.md](performance-benchmarks.md)

## 2. Version bump

- [ ] Update `package.json` version to `0.3.0`
- [ ] Update `src/backend/pyproject.toml` version to `0.3.0`
- [ ] Update `scripts/installer/pyqt/pyproject.toml` version to `0.3.0`
- [ ] Update `CHANGELOG.md` release date
- [ ] Update `README.md` "Latest version" references (installer filenames, VSIX)

## 3. Build and test

- [ ] `npm test` passes locally
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] `cd src/backend && uv run pytest` passes
- [ ] `cd scripts/installer/pyqt && uv run pytest` passes
- [ ] `cd tests/golden && python -m pytest framework/` passes
- [ ] `npm run bench` succeeds (or fails only on expected live-only tests when offline)
- [ ] Build the VSIX locally: `npm run package`
- [ ] Build installers for all platforms via `release.yml` (or locally on each OS)
- [ ] Manual smoke test: install from each platform's installer, open VS Code, send a test message

## 4. Release

- [ ] Create annotated git tag: `git tag -a v0.3.0 -m "v0.3.0"`
- [ ] Push tag: `git push origin v0.3.0`
- [ ] Verify `release.yml` produced the GitHub Release with:
  - [ ] VSIX attached
  - [ ] Windows installer attached
  - [ ] macOS installer attached
  - [ ] Linux installer attached
- [ ] Download each artifact and verify SHA256 integrity

## 5. Post-release

- [ ] Mark v0.3.0 complete in `docs/todos.md`
- [ ] Save the golden-task baseline as the v0.3.0 reference (`tests/golden/baselines/v0.3.0-e4b.json`)
- [ ] Archive the weekly benchmark results (link from `docs/v0.3.0/performance-comparison.md`)
- [ ] Update `ARCHITECTURE.md` "latest version" references
- [ ] Post a release summary to the project discussion board
