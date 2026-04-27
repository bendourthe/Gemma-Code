# Security Audit Report

**Date**: 2026-04-27
**Project**: Gemma Code v0.5.4 (pre-v0.6.0 audit)
**Scope**: Full codebase (excludes `node_modules/`, `out/`, generated test fixtures, the bundled PyQt5 venv at `scripts/installer/pyqt/.venv/`)
**Mode**: report-only (no `--fix`)
**Inputs folded in**: [docs/v0.5.0/known-gaps.md](./known-gaps.md) (carried forward as post-release self-audit context)
**Total findings**: P0: 0 | P1: 4 | P2: 6 | P3: 4 (= 14 total)

---

## Executive Summary

Gemma Code's security posture for an offline VS Code extension is **strong**. The product implements a coherent defense-in-depth stack: an SSRF guard for every outbound HTTP call ([src/utils/ssrf.ts](../../../src/utils/ssrf.ts)), a `realpath`-based workspace path guard ([src/tools/handlers/pathGuard.ts](../../../src/tools/handlers/pathGuard.ts)), an explicit terminal-command allowlist plus destructive-pattern denylist ([src/tools/handlers/terminal.ts](../../../src/tools/handlers/terminal.ts)), DOMPurify-sanitized markdown rendering ([src/utils/MarkdownRenderer.ts](../../../src/utils/MarkdownRenderer.ts)), tightly nonce-locked CSP on every webview, FTS query sanitization for SQLite, secret-path denylist on the persistent cache, and a permission-tier confirmation gate. There are zero hardcoded secrets in the source tree, zero tracked credential files, and no input-validation or injection regressions in product code paths. The remaining findings are all P1 or lower and concentrate in three areas: a documented-but-unimplemented embedding threshold-elevation control (carried over from v0.5.0), a gap in the `npm audit` CI gate threshold (currently `--audit-level=high` -- one moderate hono CVE in transitives goes unflagged), and a small set of doc/configuration hygiene issues (Slack webhook example URL in a plan doc, SHA-1 used as a non-cryptographic content hash, `permissionOverrides` allowing user-driven downgrade of any tool tier without a corroboration prompt). No remediation is required to ship v0.6.0 from a security-blocking standpoint; the four P1 items should be folded into the v0.6.0 plan.

---

## Findings

### F-001 - P1 - npm audit CI gate misses moderate-severity CVEs (transitive `hono` XSS)

**Phase**: 6 (Dependency / Supply-chain)
**Location**: [.github/workflows/ci.yml:182](../../../.github/workflows/ci.yml#L182), transitive dep `hono < 4.12.14`

**Description**: `npm audit --production --audit-level=high` is the production gate. As of the audit date, the only finding is a **moderate**-severity (CVSS 4.3) advisory `GHSA-458j-xx4x-4375` against `hono < 4.12.14` (CWE-79 -- HTML injection in `hono/jsx` SSR). `hono` is a transitive dependency (likely via the MCP SDK or msw test infrastructure), and `fixAvailable: true` reports a patch is available. Because the gate uses `--audit-level=high`, this finding does not break CI even though it is a known XSS in a path that ships in production node_modules.

**Evidence**:
```json
{
  "name": "hono",
  "severity": "moderate",
  "title": "hono Improperly Handles JSX Attribute Names Allows HTML Injection in hono/jsx SSR",
  "url": "https://github.com/advisories/GHSA-458j-xx4x-4375",
  "range": "<4.12.14",
  "fixAvailable": true
}
```

**Remediation**:
1. Run `npm audit fix` (no `--force`) to pick up the available `hono >= 4.12.14`.
2. Tighten the CI gate threshold from `--audit-level=high` to `--audit-level=moderate`. Direct production deps are small; the false-positive cost is low.
3. Verify the fix lands by re-running `npm audit --production --audit-level=moderate` until the metadata reports zero moderate findings.

---

### F-002 - P1 - Documented threshold-elevation control for heuristic embeddings is not implemented

**Phase**: 4 (Input Validation / Authorization at data layer)
**Location**: [src/storage/ToolOutputCache.ts](../../../src/storage/ToolOutputCache.ts), [docs/v0.5.0/architecture.md](../../v0.5.0/architecture.md) Section 4
**Carried from**: [docs/v0.5.0/known-gaps.md](./known-gaps.md) section 4.2

**Description**: The architecture document promises that semantic-recall queries against rows tagged `embedding_provenance = 'heuristic'` apply a **higher** cosine similarity threshold (0.95+) to compensate for the lower-recall heuristic embedder. In fact, `searchByEmbedding` does not consult the `embedding_provenance` column and applies the same threshold (0.85 default) to every row. Heuristic-embedded rows therefore surface in semantic-recall results with the same false-positive rate as the keyword-only fallback, which can leak cached tool-output excerpts (including filesystem listings, partial file contents) into unrelated agent prompts. This is not an authentication or auth-z bypass in the classical sense -- the data is local to the workspace -- but it represents a stated security/quality control that does not exist in code.

**Evidence**: see known-gaps.md 4.2; architecture.md Section 4 ("Embedding fallback").

**Remediation**:
1. Either (a) implement the threshold elevation in `ToolOutputCache.searchByEmbedding` -- query `embedding_provenance` alongside `embedding`, apply a per-row threshold (0.95 for `heuristic`, configurable for `ollama`), and document the per-row override; or
2. (b) update [docs/v0.5.0/architecture.md](../../v0.5.0/architecture.md) to say "provenance is recorded for `/cache reembed` to consume; threshold elevation is deferred to v0.6.0" and remove the false claim.

---

### F-003 - P1 - PredictiveCache surface enabled by setting but never invoked

**Phase**: 8 (Dangerous code patterns / dead-feature attack surface)
**Location**: [src/storage/PredictiveCache.ts](../../../src/storage/PredictiveCache.ts), `gemma-code.predictiveCacheEnabled` setting
**Carried from**: [docs/v0.5.0/known-gaps.md](./known-gaps.md) section 4.3

**Description**: The `gemma-code.predictiveCacheEnabled` setting is exposed in `package.json` and defaults to `false`. Toggling it to `true` produces no behavior change because no caller invokes `PredictiveCache.observe()` from the cache lookup path and no idle-driver invokes `predict()`. This is a configuration-surface footgun: a user who reads the setting description can reasonably assume that the predictive layer is performing the documented work, but no work is happening. It is also a small attack-surface increase: dead code that the audit had to walk to confirm it cannot exfiltrate paths or trigger unintended I/O.

**Evidence**: `grep -nE '(observe|predict)\(' src/storage/PredictiveCache.ts` shows the methods exist; `grep -rnE 'predictiveCache|PredictiveCache' src/` shows zero call sites outside the unit test.

**Remediation**:
1. Wire `PredictiveCache.observe(path)` from `ToolOutputCache.lookup()` only when the setting is true, and gate the idle-prefetch driver behind the same flag.
2. Add an integration test that toggles the setting on, fires N reads, and asserts the predicted top-K is observable in the next access pattern.
3. If the predictive layer is not the right shape after Phase 12 hindsight, **delete it** rather than leaving dead code.

---

### F-004 - P1 - 12 token-estimation tests fail against tiktoken; CI did not block the v0.5.0 release

**Phase**: 6 + 7 (Test-pipeline reliability / configuration)
**Location**: [tests/unit/chat/CompactionStrategy.test.ts](../../../tests/unit/chat/CompactionStrategy.test.ts), [tests/unit/chat/ContextCompactor.test.ts](../../../tests/unit/chat/ContextCompactor.test.ts), [tests/unit/errors/error-handling.test.ts](../../../tests/unit/errors/error-handling.test.ts)
**Carried from**: [docs/v0.5.0/known-gaps.md](./known-gaps.md) sections 1.1 + 1.2

**Description**: Twelve unit tests assert the v0.4.0 char/4 token-estimation heuristic that was replaced by tiktoken in Phase 5 of v0.5.0. They have been failing since `bfc0056` (Phase 11) but the v0.5.0 release shipped green. Either (a) the CI pipeline is masking unit-test failures, (b) the matrix legs that catch them are not gating, or (c) `vitest` is exiting 0 in a way that the CI step does not detect. From a security standpoint this matters because the test pipeline is the safety net for every other finding in this audit; if it has a structural false-negative path, all downstream guarantees are weaker.

**Remediation**:
1. Verify the actual pipeline wiring: run `npm run test` locally and confirm a non-zero exit on the existing failures.
2. If the CI step is silently passing (e.g., because of a piped output redirection or a missing `set -e`), fix the wiring to fail-fast on the first non-zero exit.
3. Update the 12 assertions to check tiktoken-shaped values, or rewrite them as property tests (monotonicity, length correlation) rather than fixed-value assertions.

---

### F-005 - P2 - SHA-1 used as a content hash inside `Compressor.ts`

**Phase**: 8 (Weak crypto / informational)
**Location**: [src/tools/Compressor.ts:112](../../../src/tools/Compressor.ts#L112)

**Description**: `crypto.createHash("sha1")` is used to derive a content fingerprint over a buffer prefix. There is no security claim attached -- this is a feature hash for cache key derivation -- but a reviewer scanning for weak crypto will flag it, and the cost of switching to SHA-256 is zero.

**Evidence**:
```typescript
return crypto.createHash("sha1").update(head).digest("hex");
```

**Remediation**: Replace `"sha1"` with `"sha256"` and update the column type comment if the truncated hex was being compared to something else. No data-migration required because the hash is recomputed from cache-key derivation each time, not stored long-term.

---

### F-006 - P2 - Slack webhook example URL in `routa-harness-adoption.md`

**Phase**: 1 + 2 (Secret pattern in docs / git-tracked)
**Location**: [docs/v0.5.0/plans/routa-harness-adoption.md](../../v0.5.0/plans/routa-harness-adoption.md)
**Carried from**: [docs/v0.5.0/known-gaps.md](./known-gaps.md) section 6.3

**Description**: After Phase 8's Slack/Anthropic/OpenAI test fixtures were dropped in commit `dd111cc`, a single example webhook URL of the form `https://hooks.slack.com/services/...` remains in a docs file. GitHub's secret scanner has not flagged it on the latest push, but heuristic scanners may; the file shape matches the `hooks\.slack\.com` regex used by gitleaks defaults.

**Evidence**: `grep -rnE 'hooks\.slack\.com|xoxb-|sk-ant-' docs/` returns matches in [docs/v0.5.0/plans/routa-harness-adoption.md](../../v0.5.0/plans/routa-harness-adoption.md), [docs/harness-integration.md](../../harness-integration.md), and the test-fixture file [tests/integration/hooks/preToolUse.test.ts](../../../tests/integration/hooks/preToolUse.test.ts) (intentional test pattern).

**Remediation**: Replace the example URL with an obfuscated form that cannot be misclassified as real, e.g. `https://hooks.slack.example/services/<TEAM>/<CHANNEL>/<TOKEN>`. Apply the same to any `xoxb-` / `sk-ant-` mention in docs.

---

### F-007 - P2 - `gemma-code.permissionOverrides` allows user to downgrade any tool to tier 0 (auto-approve)

**Phase**: 5 (Authorization)
**Location**: [src/guardrails/PermissionTiers.ts](../../../src/guardrails/PermissionTiers.ts), `package.json` settings declaration

**Description**: The `permissionOverrides` setting is a `Record<string, number>` where `0 = auto-approve`. By design this lets a user opt into auto-running tools at their own risk. The risk surface: a malicious or compromised workspace `.vscode/settings.json` (or a `settings.local.json` shared in a screen-share) can downgrade `run_terminal` or `delete_file` to tier 0 silently. The user can be unaware that the next agent message will execute terminal commands without confirmation. This is documented behavior, not a bug, but the setting deserves a defense-in-depth check: the gate should refuse to honor an override that drops a tier-2 tool below tier 1, or at minimum surface a one-time banner the first time an override is loaded.

**Remediation**:
1. Add a clamp in [src/guardrails/PermissionTiers.ts](../../../src/guardrails/PermissionTiers.ts) so tier-2 tools (`run_terminal`, `delete_file`) cannot be downgraded below tier 1 via `permissionOverrides`.
2. Optionally surface a one-shot info banner on activation when any non-trivial override is detected, so the user has visibility.

---

### F-008 - P2 - Webview `innerHTML` assemblage relies on string concatenation rather than DOM-native APIs

**Phase**: 4.4 (XSS / DOM hygiene)
**Location**: [src/panels/SessionListPanel.ts:215](../../../src/panels/SessionListPanel.ts#L215), [src/panels/webview/traceDashboard.ts:307+](../../../src/panels/webview/traceDashboard.ts#L307), [src/panels/webview/index.ts:1096+](../../../src/panels/webview/index.ts#L1096)

**Description**: All three webviews concatenate strings into HTML and assign to `innerHTML`. Audited strings: every dynamic value is wrapped in `escapeHtml(...)` or `escapeAttr(...)` before concatenation, so this is **not** an active XSS vulnerability. However, the pattern is brittle: a future contributor adding a new dynamic field can omit the escape and reintroduce a sink. The CSP (`require-trusted-types-for 'script'`, `script-src 'nonce-${nonce}'`, `default-src 'none'`) is the second line of defense; even with a missed escape, script execution from injected HTML would be blocked. Still, a structural fix is preferable to a per-field escape discipline.

**Evidence**: representative sample at [src/panels/SessionListPanel.ts:215-223](../../../src/panels/SessionListPanel.ts#L215-L223):
```javascript
sessionsEl.innerHTML = sessions.map(s =>
  '<div class="session-item" data-id="' + escapeAttr(s.id) + '">' +
    '<div class="session-title">' + escapeHtml(s.title) + '</div>' +
    ...
).join('');
```

**Remediation**:
1. Refactor to `document.createElement` + `textContent` assignments, which makes the escape implicit. Where templating helps readability, route HTML construction through a small helper that always escapes interpolations. The chat-message renderer at [src/utils/MarkdownRenderer.ts](../../../src/utils/MarkdownRenderer.ts) already routes through DOMPurify; reuse that pattern.
2. Add an ESLint rule (`no-direct-innerhtml-concat`, custom or via `eslint-plugin-security`) to fail on `\.innerHTML\s*=\s*[^=]+\+`.

---

### F-009 - P2 - `coverage-gate` job parses HTML coverage report with regex

**Phase**: 7 + 8 (Configuration / brittle scripting)
**Location**: [.github/workflows/ci.yml:125-137](../../../.github/workflows/ci.yml#L125-L137)

**Description**: The 80% coverage gate is enforced by a Python `re.search` over the lcov-report HTML. If the istanbul/v8 coverage HTML markup changes between versions, the regex returns no match, the variable defaults to 0, and the gate raises `SystemExit(f'TS coverage 0.0% is below the 80% threshold')`. The failure mode is correct but noisy. More importantly, an attacker who can inject markup into the coverage report could potentially fool the regex. In practice this is a minor concern -- the report is generated locally by trusted vitest -- but the structural fix is to parse the json-summary report instead of the HTML.

**Remediation**: Switch the gate to read `coverage/coverage-summary.json` (vitest emits this when configured), then `total.lines.pct >= 80`. Drop the inline Python.

---

### F-010 - P2 - `fetchWithSsrfGuard` does not pin or limit response body size

**Phase**: 4 + 7 (Network input / DoS)
**Location**: [src/utils/ssrf.ts:124](../../../src/utils/ssrf.ts#L124), [src/tools/handlers/webSearch.ts](../../../src/tools/handlers/webSearch.ts)

**Description**: `fetchWithSsrfGuard` enforces an SSRF check, redirect cap, and timeout but does not bound the response body size. A hostile site can stream a multi-GB body and exhaust extension-host memory before the timeout fires, or an `HTTP/1.1 chunked` response can stall under the timeout. `WebSearchTool` truncates *parsed* HTML to `MAX_PAGE_CHARS = 2000`, but only after `fetch().text()` has buffered the entire body. For a remote-controlled URL, this is a memory-exhaustion vector.

**Remediation**:
1. In `fetchWithSsrfGuard`, after the response is returned, reject if `Content-Length` is set and exceeds a configurable limit (e.g. 5 MB).
2. Stream the response body with a counter and abort once the byte limit is reached: `for await (const chunk of response.body) { if (size > limit) abort(); }`.
3. Add a regression test that simulates a 10 MB response and asserts the fetch is aborted before allocation.

---

### F-011 - P3 - `npm audit` runs `--production` only; dev-dep CVEs go unflagged

**Phase**: 6 (Supply-chain hygiene)
**Location**: [.github/workflows/ci.yml:182](../../../.github/workflows/ci.yml#L182)

**Description**: The `audit-ts` job invokes `npm audit --production --audit-level=high`, which excludes the 1079 dev dependencies. Dev-dep CVEs do not ship to end users but can compromise developer machines and CI runners. The PyQt5 installer venv runs `pip-audit --strict` against the *exported* requirements, which captures more of the dev surface. Asymmetric treatment is acceptable but worth documenting.

**Remediation**: Add a non-blocking `audit-ts-dev` job that runs `npm audit --audit-level=high` (without `--production`) and uploads the result as an artifact. Track dev-dep CVEs over time without gating on them.

---

### F-012 - P3 - Legacy `gemma-code.gpuTier` setting fallback overdue for removal

**Phase**: 8 (Dead-code / config sprawl)
**Location**: [src/config/settings.ts:46-58](../../../src/config/settings.ts#L46-L58)

**Description**: A backwards-compatibility shim reads the legacy `gemma-code.gpuTier` string setting and maps it to the canonical numeric `gpuTierOverride`. The inline comment says `NOTE(v0.5): remove gpuTier fallback`. v0.5.x has shipped; the shim should be removed in v0.6.0. From a security standpoint this is a P3 (small attack-surface reduction) -- one fewer external-input read.

**Remediation**: Delete the `readGpuTierOverride` legacy branch in v0.6.0; add a one-line release note.

---

### F-013 - P3 - 4 dependency-cruiser baseline exceptions overdue for ratchet

**Phase**: 7 (Architecture-control compliance)
**Location**: [configs/dependency-cruiser.cjs](../../../configs/dependency-cruiser.cjs)
**Carried from**: [docs/v0.5.0/known-gaps.md](./known-gaps.md) section 6.4

**Description**: Four module-boundary rules carry `BASELINE-2026-04-25; ratchet by v0.6.0` exceptions. The exceptions are explicit and scoped to specific files, but they widen the LLM-import surface (`extension.ts`, `GemmaCodePanel`, `EmbeddingClient` can talk to Ollama directly), the storage->tools edge, and the panels->storage edge. None of these are exploitable; they just dilute the long-term boundary contract.

**Remediation**: Plan the ratchet for v0.6.0 -- move `secretPaths` and `Compressor` to `src/utils/`, route `EmbeddingClient` through the LLM port, and route panels through `panels/messages.ts`. Tracked in the v0.6.0 implementation plan emerging from this review.

---

### F-014 - P3 - `tool_output_cache.embedding_provenance` migration ordering is not regression-tested

**Phase**: 7 (Migration safety)
**Location**: [src/storage/ToolOutputCache.ts](../../../src/storage/ToolOutputCache.ts) `_initSchema`
**Carried from**: [docs/v0.5.0/known-gaps.md](./known-gaps.md) section 9.7

**Description**: The migration that adds `embedding_provenance` runs on first open after upgrade. It is non-destructive (additive column). But there is no test that exercises the migration twice in a row against a single DB file with a mid-state schema -- the kind of state a user can land in if they downgrade and re-upgrade.

**Remediation**: Add an integration test that opens the DB at v0.4.0 schema, opens at v0.5.0 schema (migration runs), opens again (migration must no-op), and asserts column existence + idempotency.

---

## Summary Statistics

| Severity | Count | Fixed | Remaining |
|----------|-------|-------|-----------|
| P0 | 0 | 0 | 0 |
| P1 | 4 | 0 | 4 |
| P2 | 6 | 0 | 6 |
| P3 | 4 | 0 | 4 |

---

## Remediation Checklist

- [ ] **F-001** Tighten `npm audit` gate from `--audit-level=high` to `--audit-level=moderate`; bump transitive `hono >= 4.12.14`.
- [ ] **F-002** Implement (or retract from architecture doc) the `embedding_provenance` threshold elevation in `searchByEmbedding`.
- [ ] **F-003** Wire `PredictiveCache.observe()` into the cache lookup path or delete the predictive layer.
- [ ] **F-004** Confirm CI fails on `vitest` non-zero exit; update or rewrite the 12 token-estimation tests.
- [ ] **F-005** Replace SHA-1 in [src/tools/Compressor.ts:112](../../../src/tools/Compressor.ts#L112) with SHA-256.
- [ ] **F-006** Obfuscate the example Slack webhook URL in `routa-harness-adoption.md` and similar plan files.
- [ ] **F-007** Clamp `permissionOverrides` so tier-2 tools cannot drop below tier 1; surface an activation banner on first-load with an active override.
- [ ] **F-008** Refactor webview `innerHTML` concatenation to `createElement` / `textContent` or a sanitized template helper; add an ESLint rule.
- [ ] **F-009** Switch the coverage gate to `coverage-summary.json` parsing; drop the inline Python regex.
- [ ] **F-010** Bound `fetchWithSsrfGuard` response body size; add a streaming-abort path with a regression test.
- [ ] **F-011** Add a non-blocking dev-dep audit job to track CVE drift.
- [ ] **F-012** Remove the legacy `gemma-code.gpuTier` setting fallback in v0.6.0.
- [ ] **F-013** Ratchet the 4 dependency-cruiser baseline exceptions to zero in v0.6.0.
- [ ] **F-014** Add an idempotency regression test for the `embedding_provenance` migration.

---

## Pending Manual Action

None of the findings require destructive git operations or history rewrites. F-006 docs cleanup is the only finding that touches a docs file with a sensitive-shaped string; the string is an example URL, not an actual secret, so no `git filter-repo` is needed.

---

## Verification

- `git ls-files | grep -iE '\.(env|pem|key|p12|pfx|jks|secret|token)$|^\.env|credentials|secrets\.json|auth\.json'` returns **zero** matches. **PASS**.
- `[.gitignore](../../../.gitignore)` covers `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*_rsa`, `*_ed25519`, `credentials.json`, `secrets.json`, `.npmrc`, `*.sqlite`. **PASS**.
- Source-tree secret scan over the seven canonical secret regex families (AWS keys, RSA/EC private keys, JWT secrets, Slack/Anthropic/OpenAI tokens, Stripe `sk_live_`, generic credential = "...") returns **zero** matches in `src/`. **PASS**.
- The five matches surfaced by the secret-pattern grep are: 1 known-gaps audit doc, 1 routa-harness plan example URL (F-006), 1 harness-integration doc, the `check-prompt-policy.mjs` defense, and a test fixture inside `tests/integration/hooks/preToolUse.test.ts` -- all benign or test-fixture cases. **PASS**.
- No `eval()`, `new Function()`, `child_process.exec()` (with user input), `os.system()`, `pickle.loads()`, `yaml.load()` (without SafeLoader), or `dangerouslySetInnerHTML` in `src/`. **PASS**.
- The two `execSync` callers in `src/chat/RegenerateFromSource.ts` invoke static `git diff --stat HEAD~5` and `git log --oneline -5` strings -- no user input. **PASS**.
- All three webviews ship a strict CSP (`default-src 'none'; script-src 'nonce-${nonce}'; require-trusted-types-for 'script'`). **PASS**.
- `fetchWithSsrfGuard` blocks loopback hostnames, RFC1918 IPv4, fc00::/7 ULA / fe80:: link-local IPv6, the empty / unspecified address, and re-validates each redirect hop. **PASS** (with the body-size reservation in F-010).

---

## Notes for `--fix` follow-up

Recommended sequencing if a follow-up `/run-security-audit --fix` pass is invoked:

1. **F-001** first -- one-line dependency bump + workflow tweak.
2. **F-005** -- one-line crypto change.
3. **F-006** -- text edit in plan docs.
4. **F-009** -- straightforward CI replacement.
5. **F-012** -- delete dead code.
6. **F-007** + **F-008** -- defense-in-depth refactors that touch webviews/guardrails.
7. **F-002** + **F-003** -- semantic fixes that should land together with their integration tests.
8. **F-010** -- new streaming-abort + regression test.
9. **F-013** -- the dep-cruiser ratchet, scheduled across the rest of the v0.6.0 cycle.
