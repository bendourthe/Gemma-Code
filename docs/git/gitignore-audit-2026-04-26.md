# .gitignore Audit -- Gemma Code -- 2026-04-26

**Repository:** `c:\Users\bdour\Documents\Work\Coding\Github\Gemma-Code`
**Scope:** Full repo
**Mode:** Report-only (no changes applied)
**History scan:** No (skipped; opt-in only)

---

## Summary

| Severity | Count |
|----------|------:|
| G0 CRITICAL | 0 |
| G1 HIGH | 0 |
| G2 MEDIUM | 0 |
| G3 LOW | 0 |
| **Total** | **0** |

Tracked files to remove from index: **0**
.gitignore entries to add: **0**
LFS candidates: **0**

**Status: clean.** This is the fifth audit run on this repository (prior reports at `docs/git/gitignore-audit-2026-04-05*.md` and `2026-04-18.md`). The current `.gitignore` is comprehensive, well-organized, and validated against the v0.6.0 working tree. No new findings.

---

## Phase 1 -- Stack Fingerprint

| Signal | Detected stack |
|---|---|
| `package.json`, `tsconfig.json`, `node_modules/` (untracked) | Node.js / TypeScript (VS Code extension) |
| `pyproject.toml` (under `scripts/installer/pyqt/`), `*.py`, `uv.lock` | Python (PyQt installer + golden-task framework) |
| `Cargo.toml` (referenced in `.gitignore` only) | Rust (anticipated; no source under `src/`) |
| `Dockerfile`, `docker-compose.yml` | None |
| `.github/workflows/*.yml` | GitHub Actions (8 workflows) |
| `*.psd`, `*.ai`, `*.sketch`, `*.mp4` etc. | None tracked |

The `.gitignore` already covers Node, TypeScript, Python (3 cache types), Rust, Go, SQLite, VS Code-extension build artifacts (`*.vsix`, `.vscode-test/`), uv, and the project's local-only directories (`.gemma-code/`, `.gemma-code-output/`, `tests/golden/.worktrees/`).

---

## Phase 2 -- `.gitignore` Audit

Root [.gitignore](../../.gitignore) parses cleanly. **No syntax issues**. Patterns are organized into 17 commented sections that match the project's stack fingerprint:

- OS metadata (Windows + macOS)
- IDE / Editor (with VS Code negations for `launch.json`, `tasks.json`, `extensions.json`, `settings.json` -- correct for an extension repo where these are committed exemplars)
- Logs and temp
- Secrets and environment
- Coverage and test output
- Build artifacts (with intentional negation for `scripts/installer/pyqt/build/**`, which are PyInstaller *inputs*, not outputs -- correct)
- Archives, large media
- Claude-Code settings (`.claude/`, `settings.local.json`)
- Node.js / TypeScript
- Python (3 cache types) + uv
- Rust
- SQLite
- Gemma Code output dirs
- Go vendor + compiled binaries
- Installer build artifacts
- Python coverage data
- npm auth (`.npmrc`)
- Golden Task Suite snapshots and worktrees
- CI workflow output JSON / Markdown
- Local dependency-cruiser graph artifact

### Nested `.gitignore` files (32 total)

All nested `.gitignore` files belong to **auto-generated tool caches** (`.ruff_cache/`, `.pytest_cache/`, `.husky/_/`) or **golden-task snapshot directories**. Each is created by its respective tool and is not within scope for the root audit. They are correctly ignored in their parents (or the parent dir itself is ignored).

---

## Phase 3 -- Tracked File Index Scan

`git ls-files` reports **731 tracked files**. Per-category scan:

| Category | Pattern probe | Result |
|---|---|---|
| G0 -- Secret files | `\.(env|pem|key|p12|pfx|cer|crt|jks|keystore)$`, `(credentials|secrets|auth|token).*\.(json|yaml|yml)$`, private-key headers, high-entropy assignments in JSON/YAML | **No matches** |
| G1 -- Build artifacts | `node_modules/`, `dist/`, `build/` (excluding intentional installer build inputs), `target/`, `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`, `.venv/`, `*.tsbuildinfo`, `coverage/`, `*.vsix` | **No matches** |
| G2 -- IDE / OS metadata | `.DS_Store`, `Thumbs.db`, `desktop.ini`, `.idea/`, `.vs/`, `*.swp`, `*.swo` | **No matches** |
| G3 -- Files >= 5 MB | byte size of every tracked file | **No matches** -- largest tracked binary is `assets/icon.png` at well under 5 MB |
| G3 -- Binary media types | `*.{psd,ai,sketch,fig,mp4,mov,avi,mp3,zip,pkl,onnx,pt,h5,parquet,exe,dll,so,dylib,wasm,pdf,docx,xlsx,pptx}` | **No matches** -- only `*.ico`, `*.png`, `*.svg` (icon assets, all small) |

The 5 hits under `scripts/installer/pyqt/build/` (`build-linux.sh`, `build-macos.sh`, `build-windows.ps1`, `gemma-installer.spec`, `hooks/hook-PyQt5.py`) are **PyInstaller inputs**, not build outputs. The `.gitignore` correctly negates them with `!scripts/installer/pyqt/build/**`. No action.

---

## Phase 4 -- Untracked File Scan

`git ls-files --others --exclude-standard` reports **3 untracked files**, all part of the active Phase 1 (v0.6.0) working tree:

| Path | Class | Action |
|---|---|---|
| `docs/v0.6.0/development/history/2026-04_phase-1-security-chain-closure.md` | Phase 1 session-history doc | Stage in the next commit |
| `tests/integration/permission-overrides-clamp.test.ts` | Phase 1.2 regression test | Stage in the next commit |
| `tests/unit/tools/handlers/filesystem-symlink.test.ts` | Phase 1.1 regression test | Stage in the next commit |

None match secret, build-artifact, or IDE-metadata patterns. Nothing requires a new ignore rule.

---

## Phase 5 -- LFS Suitability

Git LFS is available (`git-lfs/3.7.1`). No candidates: zero tracked files exceed 5 MB and zero match the watched binary types (`*.psd`, `*.mp4`, `*.pkl`, etc.). No `git lfs track` commands recommended.

---

## Phase 6 -- History Scan

Skipped (no `--history` flag).

---

## Findings

None.

---

## Proposed `.gitignore` Additions

None.

---

## Proposed `git rm --cached` Commands

None.

---

## LFS Recommendations

None.

---

## Manual Steps Required

None.

---

## Verification

- `git ls-files`: 731 files, all expected.
- `git ls-files --others --exclude-standard`: 3 files, all are active Phase 1 deliverables awaiting their first commit.
- `git status` (working tree): contains the Phase 1 v0.6.0 modifications (expected; covered by the upcoming Phase 1 commit).

---

## Conclusion

The `.gitignore` is in excellent shape for v0.6.0 Phase 1. The repository continues to enforce the discipline established by the 2026-04-05 and 2026-04-18 audits. No tracked secrets, no committed build artifacts, no large binaries, no metadata leaks. The three untracked files are the intentional Phase 1 deliverables and will land with the upcoming `feat(security)` commit.

**Recommendation: no changes required.**
