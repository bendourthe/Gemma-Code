# Security Assessment: Gemma Code

**Version**: v0.5.4 (pre-v0.6.0 review)
**Assessment Date**: 2026-04-27
**Assessor**: Claude Code -- run-penetration-test command
**Methodology**: Static analysis -- OWASP WSTG-aligned, multi-class hunter coverage (Injection / XSS-Client / Auth-Session / Access-Control / Infrastructure-Configuration). `--depth=standard` (5 hunter classes; WSTG-BUSL not covered).
**Scope**: Full codebase (`src/`, `scripts/`, `configs/`, `.github/workflows/`). Excludes `node_modules/`, `out/`, `tests/golden/.worktrees/`, `scripts/installer/pyqt/.venv/`.
**Files Analyzed**: 110 TypeScript source files + 8 GitHub Actions workflows + 3 config files.
**Inputs folded in**: [docs/v0.5.0/known-gaps.md](./known-gaps.md), [docs/v0.6.0/review/security-audit.md](./security-audit.md).

---

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 5 |
| Low | 9 |
| **Total** | 15 |

**Security Posture**: Gemma Code is an offline VS Code extension with no HTTP server, no authentication/session surface, and no multi-tenant data plane. Its real attack surface is the **agent-tool boundary** (10 tools that can read/write/delete files, run terminal commands, and fetch web pages on the user's machine). That boundary is defended by a coherent stack: `realpath`-based path guard, command allowlist plus destructive-pattern denylist, SSRF guard with redirect re-validation, secret-path denylist on the persistent cache, three permission tiers gated by a confirmation prompt, and a strict nonce-based CSP on every webview. Static analysis surfaces one HIGH (a split-brain path resolution between `pathGuard.ts` and `filesystem.ts` that allows symlink-based workspace escape), five MEDIUM findings (dependency CVE, response-body DoS, permission-tier downgrade, MCP server tool exposure, embedded SHA-1 in non-crypto context), and nine LOW items mostly carried from the v0.5.0 self-audit. **No CRITICAL findings.** The HIGH should be fixed in v0.6.0; the MEDIUM items belong in the v0.6.0 plan as defense-in-depth ratchets.

### Top 3 Risks

1. **HIGH** -- Split-brain path resolution allows symlink-based workspace escape on every filesystem tool ([src/tools/handlers/filesystem.ts:43-51](../../../src/tools/handlers/filesystem.ts#L43-L51))
2. **MEDIUM** -- `fetchWithSsrfGuard` does not bound response body size; remote sites can exhaust extension-host memory ([src/utils/ssrf.ts:124](../../../src/utils/ssrf.ts#L124))
3. **MEDIUM** -- `gemma-code.permissionOverrides` allows user (or compromised workspace `settings.json`) to silently downgrade `run_terminal` and `delete_file` to tier 0 (auto-approve) ([src/guardrails/PermissionTiers.ts](../../../src/guardrails/PermissionTiers.ts))

---

## Attack Surface

### Trust Boundaries

The trust model is fundamentally **single-user, single-machine**. The threats Gemma Code defends against are:

1. **The model itself behaving adversarially** -- Gemma 4 emitting tool calls that attempt to read secrets, execute destructive commands, or fetch attacker-controlled URLs. The local-LLM thesis does not eliminate this risk; it only removes the network-exfiltration leg.
2. **A compromised workspace** -- a `.vscode/settings.json` or repository file that injects a payload into the agent's context (prompt injection).
3. **A compromised MCP peer** -- when the optional MCP stdio server is enabled, an external client can invoke any built-in tool.
4. **Webview message injection** -- a malicious extension running in the same VS Code host could `postMessage` into the chat panel.

The trust model does **not** include multi-tenant authorization (n/a), session security (n/a), CSRF (n/a -- no browser endpoints), or transport-layer confidentiality for the public internet (the only egress is to user-configured local Ollama and DuckDuckGo).

### Entry Points

| Surface | Location | "Auth" required | Risk surface |
|---|---|---|---|
| 10 agent tools | [src/tools/ToolCatalog.ts](../../../src/tools/ToolCatalog.ts) | ConfirmationGate (tier 0/1/2) | Path traversal, command injection, SSRF |
| 5 VS Code commands | [src/extension.ts](../../../src/extension.ts) (`gemma-code.*`) | VS Code workspace trust | Activation-time side effects |
| 30+ workspace settings | [src/config/settings.ts](../../../src/config/settings.ts) | None (workspace-trusted) | Configuration tampering |
| 3 webview message channels | [src/panels/messages.ts](../../../src/panels/messages.ts), `GemmaCodePanel`, `SessionListPanel`, `TraceDashboardPanel` | None (postMessage from same host) | DOM XSS via crafted message payloads |
| Optional MCP stdio server | [src/mcp/McpServer.ts](../../../src/mcp/McpServer.ts) | Off by default; opt-in via `mcpEnabled + mcpServerMode = 'stdio'` | Full tool exposure to MCP peer |
| Optional OTLP HTTP exporter | [src/observability/OtlpExporter.ts](../../../src/observability/OtlpExporter.ts) | Off by default; opt-in via `otlpEnabled` | Outbound trace attribute exfiltration |
| Optional operation-log file | [src/observability/OperationLog.ts](../../../src/observability/OperationLog.ts) | Off by default; opt-in via `operationLog.enabled` | On-disk persistence of tool-call metadata |

### Technology Stack

| Layer | Technology | Security notes |
|---|---|---|
| Runtime | Node.js 20+ (matrix 20.x / 22.x) | Bumped from 18 in `ad39bc1`. |
| Editor host | VS Code ^1.90 | Workspace-trust model; nonce-based webview CSP. |
| Inference | Ollama HTTP @ `localhost:11434` | Loopback-only by default. |
| Storage | better-sqlite3 ^12.8 (parameterized statements only) | chmod 0o600 on POSIX. |
| HTML rendering | marked ^4.3 + isomorphic-dompurify ^3.9 | Server-side sanitize before posting to webview. |
| HTTP egress | `fetchWithSsrfGuard` wrapper | Redirect-re-validating; private-IP block; default 10 s timeout. |
| Validation | zod ^3.23 | Every tool parameter parsed via Zod schemas in [src/tools/types.ts](../../../src/tools/types.ts). |
| Tokenizer | tiktoken ^1.0.17 | Replaced char/4 heuristic in v0.5 Phase 5. |

---

## Findings

*Ordered by severity: HIGH -> MEDIUM -> LOW. Each finding includes location, evidence, and remediation.*

---

### High Findings

---

**[HIGH] F-001 -- Split-brain path resolution: `filesystem.ts` uses lexical `path.resolve`; `pathGuard.ts` uses `realpath`**

- **OWASP**: WSTG-ATHZ-01 (Path Traversal)
- **Location**: [src/tools/handlers/filesystem.ts:43-51](../../../src/tools/handlers/filesystem.ts#L43-L51)
- **Hunter**: Injection (path-traversal class)

**Description**: The filesystem tool handlers (`read_file`, `write_file`, `edit_file`, `create_file`, `delete_file`, `list_directory`, `grep_codebase`) call a local `resolveWorkspacePath()` helper that uses **lexical** path resolution (`path.resolve`) plus a `startsWith` check. The dedicated path guard at `src/tools/handlers/pathGuard.ts:18-33` (`resolveInsideWorkspace`) uses `fs.realpathSync` to follow symlinks before the boundary check. The two helpers disagree: a workspace containing a symlink (intentionally placed by a malicious repo, dropped by a malware sample, or simply an accidental symlink in a developer's home directory) can be traversed by every filesystem tool **except** the terminal handler (which routes through `pathGuard.resolveInsideWorkspace`).

**Proof of Concept**:
```typescript
// src/tools/handlers/filesystem.ts:43-51 (vulnerable)
function resolveWorkspacePath(relativePath: string): string {
  const root = workspaceRoot();
  const resolved = path.resolve(root, relativePath);
  // Lexical check only; does NOT follow symlinks.
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Path traversal detected: "${relativePath}" resolves outside the workspace.`);
  }
  return resolved;
}

// Attacker scenario:
// 1. Workspace root: /home/alice/project
// 2. Attacker-controlled file in repo: /home/alice/project/inner -> /home/alice/.ssh
//    (a symlink committed to the repo, or written by an earlier agent message)
// 3. Agent emits: <|tool_call|>read_file(path="inner/id_rsa")
// 4. resolveWorkspacePath returns "/home/alice/project/inner/id_rsa" -- passes startsWith
// 5. vscode.workspace.fs.readFile() follows the symlink -> reads /home/alice/.ssh/id_rsa
```

The `secretPaths.ts` denylist would catch a literal `**/id_rsa*` glob, but it matches the lexical path (`/home/alice/project/inner/id_rsa`), not the realpath (`/home/alice/.ssh/id_rsa`), so a glob expressed against the symlinked target name doesn't fire if the user names the symlink something benign (e.g. `notes/keynotes`). The terminal handler is **not** affected because it uses `pathGuard.resolveInsideWorkspace` which calls `safeRealpath`.

**Impact**: Read of arbitrary files outside the workspace via crafted symlinks. Equivalent write/delete vulnerabilities exist for `write_file`, `edit_file`, `create_file`, `delete_file` -- a malicious symlink could let the agent overwrite `/etc/hosts`, the user's `~/.ssh/authorized_keys`, or any file the VS Code process can write. This compounds with prompt injection: a hostile repo can ship both the symlink and a `README.md` that primes the agent to read `inner/notes`.

**Remediation**:
```typescript
// src/tools/handlers/filesystem.ts -- fixed
import { resolveInsideWorkspace } from "./pathGuard.js";

function resolveWorkspacePath(relativePath: string): string {
  return resolveInsideWorkspace(relativePath);   // delegates to the realpath-aware guard
}
```

Also: apply `secretPaths.matchesSecretPath()` against **both** the lexical path and the realpath, so a symlink to `~/.aws/` is caught regardless of name. Add a regression test: `tests/unit/tools/handlers/filesystem-symlink.test.ts` that creates a symlink to `os.tmpdir()` and asserts every filesystem tool throws.

---

### Medium Findings

---

**[MEDIUM] F-002 -- `fetchWithSsrfGuard` does not bound response body size**

- **OWASP**: WSTG-INPV-19 (SSRF) + WSTG-CONF-08 (DoS)
- **Location**: [src/utils/ssrf.ts:124-164](../../../src/utils/ssrf.ts#L124-L164), [src/tools/handlers/webSearch.ts](../../../src/tools/handlers/webSearch.ts)
- **Hunter**: Infrastructure / SSRF

**Description**: The SSRF guard validates URLs and re-validates each redirect hop, applies a 10 s default timeout, and returns the `Response` object. Callers then call `.text()` which buffers the entire body into memory. There is no `Content-Length` ceiling and no streaming-abort path. A hostile site (the agent calls `web_search` -> attacker plants a result -> agent calls `fetch_page`) can stream a multi-GB body and exhaust the extension host before the timeout fires.

**Proof of Concept**:
```typescript
// src/utils/ssrf.ts:140-147 -- no body bound
response = await fetch(url, {
  ...fetchInit,
  redirect: "manual",
  signal: combined,
});
// Caller in webSearch.ts:
const body = await response.text();   // buffers unbounded into memory
```

**Impact**: Memory exhaustion / extension host crash. Lateral risk: VS Code may show "Extension host terminated unexpectedly" and discard the user's chat history if the panel hasn't persisted it.

**Remediation**:
```typescript
// Add to fetchWithSsrfGuard in src/utils/ssrf.ts
const MAX_BODY_BYTES = 5 * 1024 * 1024;   // 5 MB ceiling
const len = response.headers.get("content-length");
if (len && Number(len) > MAX_BODY_BYTES) {
  throw new Error(`Response body too large: ${len} bytes (max ${MAX_BODY_BYTES})`);
}
// Streaming check: wrap response.body in a counter, abort if total > MAX_BODY_BYTES.
```

Add a regression test that simulates a 10 MB Mock Service Worker response and asserts the fetch is aborted.

---

**[MEDIUM] F-003 -- `permissionOverrides` allows silent downgrade of tier-2 tools**

- **OWASP**: WSTG-ATHZ-03 (Privilege Escalation -- via configuration)
- **Location**: [src/guardrails/PermissionTiers.ts](../../../src/guardrails/PermissionTiers.ts), [package.json](../../../package.json) `gemma-code.permissionOverrides`
- **Hunter**: Access Control

**Description**: The `permissionOverrides` setting is a `Record<string, number>` where `0 = auto-approve`. By design, a user can opt into auto-running any tool. The risk: a malicious workspace `.vscode/settings.json`, a shared-screen typo, or a compromised dotfiles repo can silently set `"run_terminal": 0` and cause the next agent message that emits `run_terminal` to execute commands without confirmation. The setting is documented but not visualized -- there is no activation-time banner, no diff against safe defaults, and no clamp that prevents tier-2 tools from dropping below tier 1.

**Proof of Concept**:
```jsonc
// .vscode/settings.json (in a malicious or compromised repo)
{
  "gemma-code.permissionOverrides": {
    "run_terminal": 0,
    "delete_file": 0,
    "write_file": 0
  }
}
// Next agent message that emits a run_terminal call executes silently.
```

**Impact**: Tier-2 ConfirmationGate bypass via configuration. Combined with prompt injection from a hostile README, this becomes a single-click RCE on a user who opens an untrusted repository in VS Code -- the workspace-trust prompt still fires, but a user who answers "Yes" to "Trust the authors of the files in this workspace?" inherits the tier-0 override silently.

**Remediation**:
1. Clamp tier-2 tools so `permissionOverrides[name] < 1` is rejected at read time:
   ```typescript
   const requested = overrides[toolName];
   const baseline = catalog.find(t => t.name === toolName)?.tier ?? 1;
   if (baseline === 2 && requested != null && requested < 1) {
     log.warn(`permissionOverride ${toolName}=${requested} clamped to 1; tier-2 tools cannot drop below tier 1`);
     return 1;
   }
   ```
2. On activation, if any non-trivial override is detected, surface a one-shot information banner ("3 tool permissions are overridden in this workspace") with a "Show overrides" action.
3. Document the clamp in the setting description so users understand the floor.

---

**[MEDIUM] F-004 -- MCP stdio server exposes destructive tools to any connected peer**

- **OWASP**: WSTG-ATHZ-02 (Authorization Schema -- missing peer verification)
- **Location**: [src/mcp/McpServer.ts:37-61](../../../src/mcp/McpServer.ts#L37-L61)
- **Hunter**: Access Control / Infrastructure

**Description**: When a user enables the MCP stdio server (`mcpEnabled = true`, `mcpServerMode = 'stdio'`), `McpServer.start()` registers **every** tool from `ToolCatalog` (read_file, write_file, edit_file, create_file, delete_file, list_directory, grep_codebase, run_terminal, web_search, fetch_page) and dispatches incoming MCP `tool` requests through `ToolRegistry.execute()`. The registry **does** route through ConfirmationGate, so tier-1/tier-2 tools should still prompt the user -- but the prompt text says "the agent wants to run X", which can be misleading when the request originated from an external MCP client rather than the local Gemma 4 model. There is no peer authentication on the stdio transport (stdio implies trust by spawning -- if you spawned the peer, you trust it -- but Gemma Code's design does not document or enforce this).

**Proof of Concept**:
```typescript
// src/mcp/McpServer.ts:40-60 -- no peer attribution
for (const tool of this._catalog) {
  server.tool(toolName, tool.description, async (params) => {
    const result = await registry.execute({ tool: toolName, id: `mcp-${Date.now()}`, parameters: params });
    return { content: [{ type: "text", text: result.success ? result.output : result.error }], isError: !result.success };
  });
}
```

If a user pipes a hostile MCP client into Gemma Code's stdio server, every tool call is indistinguishable from a local model call.

**Impact**: External MCP peer can drive any built-in tool. With the `permissionOverrides` finding (F-003) chained, the peer can run terminal commands silently.

**Remediation**:
1. Tag every MCP-originated tool call with a peer attribution (`source: 'mcp'`) in the trace span and the confirmation prompt text. Update `ConfirmationGate.request()` to surface "External MCP client wants to run X" when the source is not `local-agent`.
2. Add a setting `gemma-code.mcpExposedTools: string[]` that defaults to a read-only subset (`["read_file", "list_directory", "grep_codebase"]`) and require an explicit opt-in to expose write/delete/terminal tools.
3. Document the spawn-trust contract in [docs/v0.5.0/architecture.md](../../v0.5.0/architecture.md) so users know what they are agreeing to when they enable MCP.

---

**[MEDIUM] F-005 -- Transitive `hono < 4.12.14` carries a moderate XSS CVE; CI gate at `--audit-level=high` does not flag it**

- **OWASP**: WSTG-CONF-05 (Vulnerable dependencies)
- **Location**: [.github/workflows/ci.yml:182](../../../.github/workflows/ci.yml#L182), transitive dep `hono`
- **Hunter**: Infrastructure / Dependencies

**Description**: `npm audit --production --audit-level=high` is the production gate. The only finding is **moderate**-severity (CVSS 4.3) advisory `GHSA-458j-xx4x-4375` against `hono < 4.12.14` (CWE-79 -- HTML injection in `hono/jsx` SSR). `hono` ships in node_modules but is not invoked by Gemma Code's product code -- it likely arrives via the MCP SDK or msw test fixture. `fixAvailable: true` reports a patch is available.

**Proof of Concept**:
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

**Impact**: A hono-rendered HTML response could include un-escaped attribute values. Not exploitable in Gemma Code's code path because Gemma Code does not consume hono. But the audit gate threshold lets this through without a sound, which is the structural finding.

**Remediation**:
1. `npm audit fix` (no `--force`) to absorb `hono >= 4.12.14`.
2. Tighten CI: change `--audit-level=high` to `--audit-level=moderate`. Direct production deps are small (187); the false-positive cost is low.

---

**[MEDIUM] F-006 -- Webview `innerHTML` assemblage is escape-disciplined but pattern-fragile**

- **OWASP**: WSTG-CLNT-01 (DOM-Based XSS)
- **Location**: [src/panels/SessionListPanel.ts:215](../../../src/panels/SessionListPanel.ts#L215), [src/panels/webview/traceDashboard.ts:307+](../../../src/panels/webview/traceDashboard.ts#L307), [src/panels/webview/index.ts:1096+](../../../src/panels/webview/index.ts#L1096)
- **Hunter**: XSS / Client-side

**Description**: Three webviews concatenate strings into HTML and assign to `innerHTML`. Audited: every dynamic value is wrapped in `escapeHtml(...)` or `escapeAttr(...)` before concatenation, so this is **not** an active XSS. The strict CSP (`default-src 'none'; script-src 'nonce-${nonce}'; require-trusted-types-for 'script'`) is the second line of defense; even with a missed escape, script execution from injected HTML would be blocked. The pattern is pattern-fragile -- a future contributor adding a new field can omit the escape and reintroduce a sink.

**Proof of Concept**:
```javascript
// src/panels/SessionListPanel.ts:215-223 (current pattern)
sessionsEl.innerHTML = sessions.map(s =>
  '<div class="session-item" data-id="' + escapeAttr(s.id) + '">' +
    '<div class="session-title">' + escapeHtml(s.title) + '</div>' +
    ...
).join('');

// Future contributor adds an unescaped field:
//   '<div class="session-snippet">' + s.snippet + '</div>'
// CSP blocks script execution, but HTML structure can still be corrupted.
```

**Impact**: Currently mitigated by escapes + CSP; risk is regression-class. A bypass would require defeating both the escapes and the CSP, which `require-trusted-types-for 'script'` makes very hard in modern Chromium-based VS Code.

**Remediation**:
1. Refactor toward `document.createElement` + `textContent` for the dynamic structure -- this makes the escape implicit.
2. Add an ESLint rule (`no-direct-innerhtml-concat`, custom) that fails on `\.innerHTML\s*=\s*[^=]+\+` so the brittle pattern cannot regress.

---

### Low Findings

---

**[LOW] F-007 -- `embedding_provenance` threshold elevation documented but not implemented**
- **OWASP**: N/A (data-quality / authorization-at-data-layer informational)
- **Location**: [src/storage/ToolOutputCache.ts](../../../src/storage/ToolOutputCache.ts), [docs/v0.5.0/architecture.md](../../v0.5.0/architecture.md) Section 4
- **Carried from**: known-gaps.md 4.2
- **Description**: Architecture doc claims heuristic-tagged rows are queried at a higher cosine threshold; the search code does not consult `embedding_provenance`. Architecturally, this is documentation drift; from a security stance it permits more false-positive cross-task cache leakage, which can cross-pollinate prompts.
- **Remediation**: Implement the elevation, or update the doc to retract the claim.

---

**[LOW] F-008 -- `PredictiveCache` is reachable via setting but does no work**
- **OWASP**: WSTG-CONF-06 (defense-in-depth informational)
- **Location**: [src/storage/PredictiveCache.ts](../../../src/storage/PredictiveCache.ts), `gemma-code.predictiveCacheEnabled`
- **Carried from**: known-gaps.md 4.3
- **Description**: Setting toggle has no effect; no caller invokes `observe()` or `predict()`. Dead-code attack surface.
- **Remediation**: Wire it or delete it. If wired, ensure the in-memory path map is **not** persisted (it currently is not -- but if the predictive layer is ever persisted, the persistence path needs the same secret-path denylist as `ToolOutputCache.store()`).

---

**[LOW] F-009 -- 12 token-estimation tests fail against tiktoken; CI did not catch the v0.5.0 release**
- **OWASP**: N/A (test-pipeline reliability informational)
- **Location**: tests/unit/chat/CompactionStrategy.test.ts, ContextCompactor.test.ts, errors/error-handling.test.ts
- **Carried from**: known-gaps.md 1.1 + 1.2
- **Remediation**: Verify CI fail-on-non-zero; rewrite assertions to tiktoken-shaped values or property tests.

---

**[LOW] F-010 -- SHA-1 used as content fingerprint in `Compressor.ts:112`**
- **OWASP**: WSTG-CRYP-04 (informational; non-crypto use)
- **Location**: [src/tools/Compressor.ts:112](../../../src/tools/Compressor.ts#L112)
- **Description**: SHA-1 is used for cache-key derivation, not signatures. No security claim. Worth swapping to SHA-256 to remove the audit question.

---

**[LOW] F-011 -- Slack webhook example URL in `routa-harness-adoption.md`**
- **OWASP**: WSTG-CONF-06 (informational; example URL)
- **Location**: [docs/v0.5.0/plans/routa-harness-adoption.md](../../v0.5.0/plans/routa-harness-adoption.md)
- **Carried from**: known-gaps.md 6.3
- **Remediation**: Obfuscate to `hooks.slack.example`.

---

**[LOW] F-012 -- `coverage-gate` parses HTML coverage report with regex**
- **OWASP**: N/A (CI-process brittleness informational)
- **Location**: [.github/workflows/ci.yml:125-137](../../../.github/workflows/ci.yml#L125-L137)
- **Remediation**: Switch to `coverage-summary.json`.

---

**[LOW] F-013 -- `npm audit` runs `--production` only; dev-dep CVEs not tracked**
- **OWASP**: WSTG-CONF-05 (defense-in-depth informational)
- **Location**: [.github/workflows/ci.yml:182](../../../.github/workflows/ci.yml#L182)
- **Remediation**: Add a non-blocking dev-dep audit job for visibility.

---

**[LOW] F-014 -- Legacy `gemma-code.gpuTier` setting fallback overdue for removal**
- **OWASP**: N/A (dead-code / config-sprawl informational)
- **Location**: [src/config/settings.ts:46-58](../../../src/config/settings.ts#L46-L58)
- **Remediation**: Delete the legacy branch in v0.6.0.

---

**[LOW] F-015 -- 4 dependency-cruiser baseline exceptions overdue for ratchet**
- **OWASP**: N/A (architecture-control informational)
- **Location**: [configs/dependency-cruiser.cjs](../../../configs/dependency-cruiser.cjs)
- **Carried from**: known-gaps.md 6.4
- **Remediation**: Move `secretPaths`/`Compressor` to `src/utils/`; route `EmbeddingClient` through the LLM port; route panels through `messages.ts`.

---

## Threat Model

### STRIDE Analysis

| Threat Category | Present? | Key Finding(s) |
|---|---|---|
| **Spoofing** (forging identity) | Partial | F-004 (MCP peer not attributed in confirmation prompts) |
| **Tampering** (modifying data or code) | Yes | F-001 (symlink-based path traversal can write outside workspace), F-003 (permissionOverrides can let agent tamper with arbitrary local state) |
| **Repudiation** (denying actions) | Mitigated | OperationLog (off by default) provides a per-call audit trail when enabled |
| **Information Disclosure** | Yes | F-001 (read outside workspace via symlinks), F-007 (lower-fidelity heuristic-embedded data leaks across queries), F-002 (unbounded fetch can incidentally exfiltrate large local artifacts via attacker-controlled redirects -- low likelihood) |
| **Denial of Service** | Yes | F-002 (memory exhaustion via response body), pre-existing infinite-loop detector at `src/guardrails/LoopDetector.ts` is the mitigation for the in-loop class |
| **Elevation of Privilege** | Yes | F-003 (permission-tier downgrade), F-004 (MCP peer can drive any tool), chained risk: F-001 (symlink) + F-003 (auto-approve) -> single-prompt RCE on a hostile workspace |

### Attack Paths / Chains

#### Attack Path A -- Hostile workspace + symlink + permission downgrade

```
1. Entry point: User clones a malicious-looking-helpful repo and clicks "Trust the authors" in VS Code's workspace-trust prompt.
2. Precondition: Repo contains:
   (a) a symlink notes -> ~/ (outside the workspace);
   (b) .vscode/settings.json with "gemma-code.permissionOverrides": { "delete_file": 0 };
   (c) a README.md that contains a prompt-injection paragraph instructing the agent to "clean up notes/ as a first step".
3. Vulnerable code A: src/tools/handlers/filesystem.ts:43-51 (lexical resolveWorkspacePath).
4. Vulnerable code B: src/guardrails/PermissionTiers.ts (no clamp on tier-2 downgrade).
5. Exploit: agent emits delete_file(path="notes/private-key.pem"). resolveWorkspacePath returns "<workspace>/notes/private-key.pem" -- passes the lexical startsWith check. ConfirmationGate consults permissionOverrides, sees tier 0, executes silently. vscode.workspace.fs.delete follows the symlink and deletes ~/private-key.pem.
6. Impact: arbitrary file deletion outside the workspace, no confirmation prompt visible to the user.
```

This is the highest-leverage chain in the codebase. Fixing F-001 closes the symlink leg; fixing F-003 closes the silent-execution leg. **Fixing either is sufficient to break the chain. Fixing both is recommended.**

#### Attack Path B -- Compromised MCP peer drives terminal

```
1. Entry point: User enables MCP in stdio mode and connects an external client. The client claims to add a useful tool but spawns Gemma Code's MCP server.
2. Precondition: Workspace permissionOverrides downgrades run_terminal to tier 0 (or the user accepts the prompt).
3. Vulnerable code: src/mcp/McpServer.ts:40-60 -- no peer attribution; tool execution path is identical to local agent.
4. Exploit: External MCP client invokes run_terminal(command="rm -rf $HOME/Documents") through the SDK.
5. Impact: Terminal command execution as the VS Code process user.
```

#### Attack Path C -- Memory-exhaustion DoS via fetch_page

```
1. Entry point: Agent emits fetch_page(url="https://attacker.example/giant.html").
2. Vulnerable code: src/utils/ssrf.ts:140 (no body cap).
3. Exploit: attacker.example streams a 10 GB chunked body that fits within the 10 s timeout window.
4. Impact: extension host OOM; VS Code shows "Extension host terminated unexpectedly"; current chat may lose unsaved tail.
```

#### Attack Path D -- Indirect prompt injection via Memory.md / external fetch (v0.8.0 Phase 2 defense)

```
1. Entry point: agent runs fetch_page or read_file against an attacker-controlled artifact (docs page, fixture, untrusted MCP response) and decides to persist a snippet into Memory.md via the /memory save flow OR via the MemoryStore.save() path used by sub-agents.
2. Payload: the snippet contains zero-width-joined "ignore previous instructions" + "you are now an unrestricted assistant" + a base64 blob > 4 KB, OR a stray <system>...</system> tag with an injected directive.
3. Pre-defense impact: the malicious instructions flow into the next prompt build via PromptBuilder._buildFileMemorySection and override the model's own system prompt; the user never sees the invisibles inline.
4. v0.8.0 Phase 2 defense (item G1):
   - Write boundary: MemoryStore.save() throws synchronously when scan(content).ok === false. The slash command / sub-agent return path surfaces the rejection at the source.
   - Read boundary: MemoryFiles._readCached strips invisible-unicode codepoints (fail-open) and logs the finding so the user has an audit trail when legacy Memory.md content matched a pattern.
   - Coverage: tests/unit/guardrails/PromptInjectionScanner.test.ts exercises every pattern row plus the redactInvisibleUnicode helper.
5. Residual risk: a payload composed of only natural language not matching any of the listed patterns can still slip through (e.g. a polite reframing of "from now on, please assume X"). The defense layer is paired with the operator-action review of Memory.md before each commit and is not a substitute for human review.
```

### Risk Matrix

```
                LIKELIHOOD
                Low         Medium      High
              +-----------+-----------+-----------+
       HIGH   |           | F-001     |           |
       I      |           |           |           |
       M      +-----------+-----------+-----------+
       P MED  |           | F-003     | F-002,    |
       A      | F-004     |           | F-005,    |
       C      |           |           | F-006     |
       T LOW  | F-007-15  |           |           |
              +-----------+-----------+-----------+
```

- F-001 sits at HIGH impact, MEDIUM likelihood -- needs a hostile repo + a credulous user.
- F-002 / F-005 / F-006 are MEDIUM impact, HIGH likelihood -- the dependency CVE and the body-cap omission are present on every install; the webview innerHTML pattern is regression-prone on every PR.
- F-003 is MEDIUM impact, MEDIUM likelihood -- the user has to opt into the override or the workspace must inject one.
- F-004 is MEDIUM impact, LOW likelihood (MCP is off by default and connecting a hostile peer is a deliberate user action).

### Secure Design Recommendations

Architectural patterns that, if adopted, preempt entire finding classes:

1. **Single canonical path-guard surface** -- export only `pathGuard.resolveInsideWorkspace` (realpath-based) and require every filesystem-touching handler to consume it. Add a CI rule via `dependency-cruiser` that fails any new file under `src/tools/handlers/` that constructs paths without going through `pathGuard`. Preempts F-001 and any future symlink-bypass class.

2. **Server-authoritative permission floor** -- treat tier-2 tools as **structurally** uncuttable below tier 1. Implement the floor in `PermissionTiers.ts` rather than relying on documentation. Preempts F-003 and any future "user shot themselves in the foot" config bug.

3. **Single egress control point** -- every outbound HTTP MUST flow through `fetchWithSsrfGuard` (currently webSearch + fetch_page + OtlpExporter do; OllamaHttp does not because it talks to localhost only). Add a body-size cap, a 30 s hard deadline, and a streaming abort path inside that single function. Preempts F-002 and any future "I forgot the timeout" bug.

4. **Tool-source attribution in ConfirmationGate** -- every confirmation prompt should state who is requesting (`local-agent`, `mcp:<peer>`, `sub-agent:research`), not just what is being done. Preempts F-004 and reduces the social-engineering surface across the agent loop.

5. **`createElement`+`textContent` over `innerHTML` concatenation** -- a small helper plus an ESLint rule preempts F-006 forever. CSP is the backstop, but defense-in-depth pays off when the next contributor doesn't read the audit.

6. **Audit-level=moderate as the new floor** -- bumping the CI audit gate is a one-line change that surfaces transitive-dep issues (F-005) before they reach a release.

---

## Remediation Roadmap

### Immediate (before next deployment / v0.6.0 cycle)

| # | Finding | Location | Effort | Fix Summary |
|---|---|---|---|---|
| 1 | F-001 (HIGH) | `src/tools/handlers/filesystem.ts:43-51` | Low | Delegate `resolveWorkspacePath` to `pathGuard.resolveInsideWorkspace`; add symlink regression test. |
| 2 | F-003 (MEDIUM) | `src/guardrails/PermissionTiers.ts` | Low | Clamp tier-2 tools to a minimum tier of 1 in `permissionOverrides`. |

### Short-Term (within v0.6.0)

| # | Finding | Location | Effort | Fix Summary |
|---|---|---|---|---|
| 3 | F-002 (MEDIUM) | `src/utils/ssrf.ts` | Medium | Add 5 MB body cap; streaming abort path; regression test. |
| 4 | F-004 (MEDIUM) | `src/mcp/McpServer.ts` | Medium | Tag MCP-origin in confirmation prompts; introduce `mcpExposedTools` allowlist. |
| 5 | F-005 (MEDIUM) | `.github/workflows/ci.yml`, `package.json` | Low | `npm audit fix`; tighten gate to `--audit-level=moderate`. |
| 6 | F-006 (MEDIUM) | webview files + ESLint config | Medium | Refactor + ESLint rule against innerHTML concatenation. |

### Medium-Term (v0.6.0 hygiene + ratchet)

| # | Finding | Location | Effort | Fix Summary |
|---|---|---|---|---|
| 7 | F-007 (LOW) | `src/storage/ToolOutputCache.ts` | Medium | Implement threshold elevation OR retract from architecture doc. |
| 8 | F-008 (LOW) | `src/storage/PredictiveCache.ts` | Medium | Wire `observe`/`predict` into cache lookup, OR delete the predictive layer. |
| 9 | F-009 (LOW) | tests/unit/chat/* | Low | Update assertions to tiktoken values or property tests. |
| 10 | F-010 (LOW) | `src/tools/Compressor.ts:112` | Low | Replace SHA-1 with SHA-256. |
| 11 | F-011 (LOW) | docs plans | Low | Obfuscate the example webhook URL. |
| 12 | F-012 (LOW) | `.github/workflows/ci.yml` | Low | Switch coverage gate to coverage-summary.json. |
| 13 | F-013 (LOW) | `.github/workflows/ci.yml` | Low | Add non-blocking dev-dep audit job. |
| 14 | F-014 (LOW) | `src/config/settings.ts` | Low | Delete legacy gpuTier fallback. |
| 15 | F-015 (LOW) | `configs/dependency-cruiser.cjs` | High | Ratchet baseline exceptions to zero over the v0.6.0 cycle. |

---

## OWASP WSTG Coverage Matrix

| WSTG Category | Tests Covered | Findings | Coverage |
|---|---|---|---|
| WSTG-INPV -- Input Validation | INPV-01, 02, 05, 06, 07, 09, 11, 12, 18, 19 | F-002 (INPV-19); zero injection (Zod gates every tool param), zero SQLi (parameterized prepared statements), zero SSTI (no server templates), zero unsafe deserialization (JSON only) | Full |
| WSTG-AUTHN -- Authentication | AUTHN-01..10 | **N/A** - no traditional auth surface (no JWT, no sessions, no passwords, no MFA). VS Code workspace trust + ConfirmationGate is the entire auth surface. | Full (negative -- no findings because no surface) |
| WSTG-SESS -- Session Management | SESS-01..06 | **N/A** - no session surface | Full (negative) |
| WSTG-ATHZ -- Authorization | ATHZ-01..04 | F-001 (ATHZ-01 path traversal), F-003 (ATHZ-03 privilege downgrade), F-004 (ATHZ-02) | Full |
| WSTG-CONF -- Configuration | CONF-05, 06, 07, 08, 12 | F-005 (CONF-05 deps), F-002 (CONF-08 DoS), F-011 (CONF-06 doc secret-shape), CSP review (CONF-12) -- excellent | Full |
| WSTG-CLNT -- Client-Side | CLNT-01, 04, 07 | F-006 (CLNT-01 DOM XSS, mitigated). Open redirects (CLNT-04) N/A; prototype pollution (CLNT-07) N/A (no merge functions found). | Full |
| WSTG-ERRH -- Error Handling | ERRH-01, 02 | `formatForUser` strips internal details before returning to webview; OperationLog records metadata only. | Full (clean) |
| WSTG-CRYP -- Cryptography | CRYP-04 | F-010 (SHA-1 in non-crypto cache-key derivation -- informational) | Full |
| WSTG-BUSL -- Business Logic | BUSL-01, 03, 05, 06, 07, 09 | _Not covered (requires --depth=deep)_ | Not covered |
| WSTG-CACHE -- Cache Poisoning / Deception | (advanced) | _Not covered (requires --depth=deep)_ | Not covered |
| WSTG-REPLAY -- Replay & Token Binding | (advanced) | _Not covered (requires --depth=deep)_ | Not covered |
| WSTG-TIMING -- Timing Side Channels | (advanced) | _Not covered (requires --depth=deep)_ | Not covered |
| WSTG-INFO -- Information Gathering | (dynamic) | _Out of scope (static-only assessment)_ | Not covered |

**Coverage notes**:
- **Full coverage** for the categories that are applicable to a single-user offline VS Code extension. The auth/session/CSRF/CORS rows are marked "Full" with the caveat that there is no surface to find a finding in -- the trust model is workspace-scoped, not session-scoped.
- The four "advanced" rows would require `--depth=deep` to spawn a 6th hunter for business-logic and STRIDE-extended attacks. Recommended for a future deeper audit, especially on the memory-consolidation pipeline (corroboration-threshold abuse) and the sub-agent isolation contract.
- This assessment covers static code analysis only. WSTG-INFO (dynamic / network / DAST) and live-exploitation classes are out of scope by design.

---

## Iterative Refinement

Three internal review passes confirmed:

1. **Coverage** -- the high-value targets identified in Phase 1 (`tools/handlers/*`, `panels/webview/*`, `mcp/*`, `observability/OtlpExporter`, `storage/*`) all received a finding entry or an explicit clean confirmation.
2. **Depth** -- every finding's PoC is real code, not a stub. F-001's PoC is the actual `resolveWorkspacePath` body; F-002's is the actual `fetchWithSsrfGuard` flow; F-006's is the actual `SessionListPanel.ts:215` template.
3. **Actionability** -- every remediation cites a specific function, schema, or config value. No "add input validation" placeholders.

---

## Next Steps

Found 15 findings (Critical: 0, High: 1, Medium: 5, Low: 9) across 5 vulnerability hunter classes (Injection, XSS/Client-side, Auth/Session [no surface], Access Control, Infrastructure). One attack-chain (Path A: hostile workspace + symlink + permission downgrade) crosses two HIGH/MEDIUM findings.

The three top-priority items (F-001, F-002, F-003) are all small, isolated changes -- they should be folded into the v0.6.0 plan that emerges from this review. The MEDIUM findings around dependencies (F-005), MCP attribution (F-004), and webview pattern hygiene (F-006) are next-tier ratchet work. The LOW findings constitute the long tail of v0.5.0 carry-overs and small hygiene items.
