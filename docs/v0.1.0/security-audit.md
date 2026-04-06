# Security Audit — Gemma Code v0.1.0

**Audit date:** 2026-04-05
**Scope:** Full codebase — TypeScript extension, Python backend, installer scripts

---

## 1. Dependency Audit

### TypeScript (npm)

**Command:** `npm audit --audit-level=high`

**Result:** No high or critical findings at the time of audit. All dependencies are pinned in `package-lock.json`.

**SBOM generation:**
```bash
npx @cyclonedx/cyclonedx-npm --output-file sbom.json
```

### Python (pip-audit)

**Command (from `src/backend/`):** `uv run pip-audit`

**Result:** No known CVEs detected in the locked dependency set.

---

## 2. Static Analysis

### 2.1 eval() / exec() Usage

**Check:** `eslint src/ --rule '{"no-eval": "error"}'`

**Result:** No `eval()` usage found anywhere in the TypeScript extension source. The ESLint config enforces `no-eval` globally.

### 2.2 Path Traversal in File System Tools

**File:** [src/tools/handlers/filesystem.ts](../../src/tools/handlers/filesystem.ts)

**Finding (Low — mitigated):** All file paths are resolved through `resolveWorkspacePath()`, which:

1. Resolves the absolute path using `path.resolve(workspaceRoot, relativePath)`.
2. Verifies the resolved path starts with `workspaceRoot + path.sep`, rejecting any path that escapes the workspace root.

**Status:** No action required. The guard is in place.

### 2.3 SSRF in Web Search / Fetch Page Tools

**File:** [src/tools/handlers/webSearch.ts](../../src/tools/handlers/webSearch.ts)

**Finding (High — fixed):** The `FetchPageTool` previously accepted any URL without validation. A malicious model response could trigger requests to `http://localhost`, `http://169.254.169.254` (cloud metadata), or any internal service.

**Remediation:** Added `isSsrfBlocked(url)` before every outbound `fetch` call. The function rejects:

- Non-HTTP(S) schemes (`file://`, `ftp://`, etc.)
- `localhost` and IPv6 loopback (`::1`)
- Loopback range `127.x.x.x`
- Link-local range `169.254.x.x`
- RFC-1918 private ranges (`10.x.x.x`, `172.16–31.x.x`, `192.168.x.x`)
- IPv6 link-local (`fe80::`)

**Status:** Fixed — `isSsrfBlocked` applied in `FetchPageTool.execute()`.

### 2.4 Command Injection in Terminal Tool

**File:** [src/tools/handlers/terminal.ts](../../src/tools/handlers/terminal.ts)

**Finding (Medium — hardened):** The terminal tool uses `spawn(command, [], { shell: true })`. While the user must confirm every command execution (in `ask` mode), the blocklist previously only checked the raw command string. A command such as `echo ok; rm -rf /` would pass the blocklist check because the dangerous substring appears after a shell metacharacter separator.

**Remediation:** Added `shellSegments(command)` that splits the command on `;`, `&&`, `||`, `|`, and newlines. The blocklist is now applied to the full string AND every individual segment. Extended the blocklist with additional destructive patterns (`mkfs`, `dd if=/dev/zero`, `> /dev/sda`).

**Note:** Using `shell: false` with an argv array would be stronger, but many legitimate developer commands (pipelines, redirections) require shell expansion. The mitigation is defence-in-depth; the confirmation gate remains the primary safety control.

**Status:** Hardened — blocklist now checks all shell segments.

---

## 3. Secret Scanning

**Tool:** `git log --all --full-history -- '*.env' '*.pem' '*.key'` + manual review

**Result:** No secrets, API keys, tokens, or credentials found in the git history or current source tree. The `.gitignore` excludes `.env`, `*.pem`, `*.key`, and similar patterns.

---

## 4. Command Injection Review

All `child_process.spawn` call sites were audited:

| File | Usage | Shell | Risk | Notes |
|---|---|---|---|---|
| [src/tools/handlers/terminal.ts:88](../../src/tools/handlers/terminal.ts) | `spawn(command, [], { shell: true })` | Yes | Medium | Mitigated by blocklist + segment splitting + user confirmation gate |
| [src/backend/BackendManager.ts](../../src/backend/BackendManager.ts) | Spawns Python backend process | No (argv array) | Low | Python path comes from VS Code settings, not user input |

**Evaluation of `BackendManager`:** The Python executable path is sourced from the `gemma-code.pythonPath` VS Code setting (not from chat input). Arguments are passed as an array (`["-m", "uvicorn", ...]`), so shell injection is not possible.

---

## 5. Findings Summary

| ID | Severity | Component | Description | Status |
|---|---|---|---|---|
| SEC-01 | High | `webSearch.ts` | SSRF via unvalidated URL in `FetchPageTool` | Fixed |
| SEC-02 | Medium | `terminal.ts` | Blocklist bypass via shell metacharacter chaining | Hardened |
| SEC-03 | Low | `filesystem.ts` | Path traversal via relative `..` segments | Mitigated (existing guard) |

---

## 6. Recommendations for Future Audits

- Consider switching `RunTerminalTool` to `shell: false` with a parsed argv array for commands that don't require shell expansion.
- Add a Content Security Policy (CSP) to the webview HTML to restrict script sources.
- Run `npm audit` and `pip-audit` as part of the CI `ci.yml` workflow (currently in nightly only).
- Periodically re-run the SSRF checks if new network-capable tools are added.
