# .gitignore Audit — Gemma Code — 2026-04-05

**Repository:** c:\Users\bdour\Documents\Work\Coding\Github\Gemma-Code
**Scope:** Full repository
**Mode:** Report-only (no `--fix`)
**History scan:** No
**Phase context:** Post-Phase 8 (Hardening, CI/CD & Release)

---

## Summary

| Severity | Count |
|----------|-------|
| G0 CRITICAL | 0 |
| G1 HIGH | 0 |
| G2 MEDIUM | 2 |
| G3 LOW | 0 |
| **Total** | **2** |

Tracked files to remove from index: 0
.gitignore entries to add: 3 (minor gaps)
LFS candidates: 0

---

## Findings

| ID | Severity | Category | Location | Description | Recommended Action |
|----|----------|----------|----------|-------------|-------------------|
| G-001 | G2 | IDE | `.gitignore` | `*.userosscache` and `*.sln.docstates` are missing from the IDE patterns section. These are Visual Studio solution state files that may appear in Windows development environments. | Add `*.userosscache` and `*.sln.docstates` to the IDE section |
| G-002 | G2 | OS Metadata | `.gitignore` line 6 | Pattern is `Desktop.ini` (capitalised). On case-sensitive filesystems (Linux CI runners), `desktop.ini` (lowercase) would not be matched. | Add `desktop.ini` alongside `Desktop.ini` |

---

## Analysis Notes

### Tracked Files — Clean

`git ls-files` was run against all tracked files. Zero files matched:
- Secret/credential patterns (G0)
- Build artifact or dependency directory patterns (G1)
- Compiled outputs or generated files

The `.gitignore` is comprehensive and well-structured across all detected stacks: Node.js/TypeScript, Python (uv), and the cross-stack installer/CI tooling.

### Untracked Files (Phase 8 additions)

The following Phase 8 files were untracked at the time of this audit (created during the current session). These are intentional new source files and should be staged and committed — they are correctly not covered by any ignore pattern:

- `docs/v0.1.0/architecture.md`
- `docs/v0.1.0/performance-benchmarks.md`
- `docs/v0.1.0/security-audit.md`
- `tests/benchmarks/context-compaction.bench.ts`
- `tests/benchmarks/skill-loading.bench.ts`
- `tests/benchmarks/time-to-first-token.bench.ts`
- `tests/benchmarks/tool-execution.bench.ts`
- `tests/unit/errors/error-handling.test.ts`

### Coverage Directory

`coverage/` is correctly listed in `.gitignore`. No coverage files are currently tracked in the git index.

### LFS Assessment

Git LFS 3.7.1 is available. No `.gitattributes` file exists. No tracked files match LFS binary type patterns, and no tracked file exceeds the 5 MB size threshold. No LFS configuration is needed at this time.

---

## Proposed .gitignore Additions

```gitignore
# === IDE — Visual Studio state files (additions) ===
*.userosscache
*.sln.docstates

# === OS Metadata — case-insensitive supplement ===
desktop.ini
```

---

## No Index Removals Required

Zero tracked files need to be removed from the git index. The index is clean.

---

## No LFS Configuration Required

No binary assets or large files were detected. Git LFS setup is not needed for this project at v0.1.0.
