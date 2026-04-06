# .gitignore Audit — Gemma Code — 2026-04-05 (Phase 6)

**Repository:** `c:/Users/bdour/Documents/Work/Coding/Github/Gemma-Code`
**Scope:** Full repository
**Mode:** Report-only (no `--fix` flag)
**History scan:** No

---

## Summary

| Severity | Count |
|----------|-------|
| G0 CRITICAL | 0 |
| G1 HIGH | 0 |
| G2 MEDIUM | 1 |
| G3 LOW | 0 |
| **Total** | **1** |

Tracked files to remove from index: 0
`.gitignore` entries to add: 3 (uv toolchain patterns)
LFS candidates: 0 (no binary or oversized files found; largest tracked file is `package-lock.json` at 208 KB)

---

## Findings

| ID | Severity | Category | Location | Description | Recommended Action |
|----|----------|----------|----------|-------------|-------------------|
| G-001 | G2 | Missing Pattern | `.gitignore` | `uv` package manager (used by the new Python backend in `src/backend/`) produces `uv.lock`, `.uv/` cache directories, and virtual environments under `.venv/` that are not yet covered by dedicated `uv`-specific patterns. The existing `.venv/` and `venv/` patterns cover the virtual environment itself, but the `uv.lock` lockfile and the `uv` cache directory (`.uv/`) are absent. | Add `uv.lock`, `.uv/`, and `uv.cache` to the Python section of `.gitignore`. |

---

## Phase 2: .gitignore Audit

The existing `.gitignore` is comprehensive and well-structured. Comparison against the full recommended pattern set for the detected stack (TypeScript/Node.js + Python + Rust + Go):

| Category | Status |
|----------|--------|
| OS metadata (`.DS_Store`, `Thumbs.db`, etc.) | ✓ Present |
| IDE files (`.idea/`, `.vscode/`, `.vs/`) | ✓ Present (with correct VS Code extension dev exceptions) |
| Secrets (`.env`, `*.pem`, `*.key`, `credentials.json`) | ✓ Present |
| Node.js (`node_modules/`, `*.tsbuildinfo`, `.eslintcache`) | ✓ Present |
| TypeScript build output (`out/`, `dist/`) | ✓ Present |
| VS Code extension artifacts (`*.vsix`, `.vscode-test/`) | ✓ Present |
| Python (`__pycache__/`, `*.pyc`, `.venv/`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`) | ✓ Present |
| Rust (`target/`, `Cargo.lock`) | ✓ Present |
| Go (`vendor/`) | ✓ Present |
| SQLite (`*.db`, `*.db-wal`, `*.db-shm`) | ✓ Present |
| Coverage (`coverage/`, `htmlcov/`, `.nyc_output/`) | ✓ Present |
| Logs, temp files | ✓ Present |
| `uv` toolchain (`uv.lock`, `.uv/`) | ✗ Missing (G-001) |

No syntax errors, redundant entries, or malformed patterns found.

---

## Phase 3: Tracked File Analysis

`git ls-files` returned 79 tracked files. Zero files match any G0/G1/G2/G3 pattern:

- No environment or credential files tracked
- No build artifacts tracked (`out/`, `dist/`, `__pycache__/` are all untracked)
- No IDE or OS metadata files tracked
- No files exceed 5 MB (largest: `package-lock.json` at ~208 KB)

---

## Phase 4: Untracked File Analysis

`git ls-files --others --exclude-standard` returned 23 files — all are the new Python backend added in Phase 6. These are **not wrongly excluded** by `.gitignore`; they simply have not yet been staged with `git add`. No secrets or artifacts among them.

Files: `src/backend/**` (pyproject.toml, source modules, test suite)

**Action required:** Stage these files with `git add src/backend/` before committing Phase 6.

---

## Phase 5: LFS Analysis

Git LFS 3.7.1 is available. No `.gitattributes` file exists. No tracked or untracked binary files were found that would benefit from LFS. No files exceed 5 MB. No LFS configuration is recommended at this time.

---

## Proposed .gitignore Additions

Append the following to the **Python** section of `.gitignore`:

```gitignore
# uv package manager (src/backend/ uses uv)
uv.lock
.uv/
uv.cache
```

> Note: `uv.lock` is the uv lockfile (analogous to `poetry.lock`). Whether to commit it depends on the deployment strategy: commit it for reproducible installs in CI, omit it if the backend is always installed from `pyproject.toml` directly. For this extension-bundled backend, omitting it is appropriate since the extension installer will handle dependency installation.

---

## Proposed `git rm --cached` Commands

None required — no wrongly tracked files found.

---

## Manual Steps Required

None. No G0 findings. No history purge needed.
