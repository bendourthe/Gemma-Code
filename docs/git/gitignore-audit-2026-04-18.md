# .gitignore Audit - Gemma Code - 2026-04-18

**Repository:** c:/Users/bdour/Documents/Work/Coding/Github/Gemma-Code
**Scope:** Full repo
**Mode:** Report-only (no --fix)
**History scan:** No

---

## Summary

| Severity | Count |
|----------|-------|
| G0 CRITICAL | 0 |
| G1 HIGH | 0 |
| G2 MEDIUM | 6 |
| G3 LOW | 0 |
| **Total** | **6** |

Tracked files to remove from index: 0
.gitignore entries to add: 6
LFS candidates: 0

**Overall posture is strong.** The existing `.gitignore` is comprehensive and covers OS metadata, IDE files, secrets, build artifacts across five languages, SQLite databases, and Claude Code local settings. The only gaps are a handful of new CI/workflow output paths introduced by v0.4.0 Phase 1 (benchmark regression gating and golden-task live-Ollama matrix). No secrets are tracked, no oversized binaries, no missing standard patterns.

---

## Findings

| ID | Severity | Category | Location | Description | Recommended Action |
|----|----------|----------|----------|-------------|-------------------|
| G-001 | G2 | Missing Pattern | `.gitignore` | `bench-results.json` written to repo root by nightly.yml step `Run benchmarks`. If a developer runs `npm run bench -- --reporter=json --outputFile=bench-results.json` locally, the file lands at the repo root. | Add `bench-results.json` to `.gitignore` |
| G-002 | G2 | Missing Pattern | `.gitignore` | `bench-results.txt` is piped via `tee bench-results.txt` in the same nightly step. Same local-run exposure as G-001. | Add `bench-results.txt` to `.gitignore` |
| G-003 | G2 | Missing Pattern | `.gitignore` | `golden-results-e2b.json` / `golden-results-e4b.json` written to repo root by `golden-tasks.yml` via `tests/golden/framework/run_all.py --output ...`. Local runs would leave these at the working dir. | Add `golden-results-*.json` to `.gitignore` |
| G-004 | G2 | Missing Pattern | `.gitignore` | `golden-report-e2b.md` / `golden-report-e4b.md` written to repo root by the same script. | Add `golden-report-*.md` to `.gitignore` |
| G-005 | G2 | Missing Pattern | `.gitignore` | `run_all.py` default outputs are `golden-task-results.json` and `golden-task-report.md` at the caller's CWD if `--output` / `--report` are omitted. Worth ignoring so local ad-hoc runs do not dirty the tree. | Add `golden-task-results.json` and `golden-task-report.md` to `.gitignore` |
| G-006 | G2 | Missing Pattern | `.gitignore` | `docs/git/gitignore-audit-*.md` reports (the output of this command) are not ignored. Existing convention based on 4 prior audit reports is that these are committed as project documentation — so this is informational only. | **No action.** Prior reports in `docs/git/` are tracked; treat as docs, not as ignore candidates. Leaving here for transparency. |

---

## Proposed .gitignore Additions

```gitignore
# ==============================================================================
# CI Workflow Outputs (v0.4.0 Phase 1: benchmark + golden-task gates)
# ==============================================================================
bench-results.json
bench-results.txt
golden-results-*.json
golden-report-*.md
golden-task-results.json
golden-task-report.md
```

That is a single 8-line section appended to the existing `.gitignore`, matching the style of the other `# === Section ===` dividers.

---

## Proposed `git rm --cached` Commands

None. No tracked files require removal.

---

## LFS Recommendations

None. No tracked or untracked files exceed 5 MB, and none match binary LFS candidate patterns (`*.psd`, `*.pkl`, `*.parquet`, etc.).

---

## Manual Steps Required

None. No history purge required (no G0 findings in working tree, and history scan was not requested).

---

## .gitignore Syntax Fixes

None. The existing `.gitignore` parses cleanly. Directory patterns use trailing `/` consistently, negations (`!.vscode/launch.json` etc.) are structured correctly against their parent patterns, and no Windows path separators or malformed globs were found.

---

## Stack Fingerprint

Detected stacks (for context):

- **Node.js / TypeScript** (package.json, tsconfig.json, vitest.config.ts)
- **Python** (tests/golden/framework/\*.py, scripts/installer/pyqt/)
- **Go** (vendor/ pattern present, but no go.mod detected at root — likely future-scoped)
- **Rust** (target/ pattern present, no Cargo.toml detected at root — likely future-scoped)
- **GitHub Actions** (.github/workflows/{ci,nightly,golden-tasks,installer-smoke,release}.yml)

All relevant build/cache directories for the active stacks (Node, Python) are already covered.

---

## Notes on v0.4.0 Phase 1 Deletions

Phase 1 deleted `src/backend/` and its entire subtree (ADR-0001). Those files currently show as `D` (deletion staged) in `git status` but remain in `git ls-files` until committed. No `.gitignore` action required — the deletion itself handles them once committed. Post-commit, the tree under `src/backend/` will no longer exist and the existing Python-related ignore patterns (`__pycache__/`, `.venv/`, `*.pyc`, `uv.lock`, `.uv/`) become scoped only to `tests/golden/` and `scripts/installer/pyqt/`, which is fine.
