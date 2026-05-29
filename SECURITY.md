# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.6.x   | Yes |
| 0.5.x   | Yes |
| 0.4.x   | Security fixes only |
| < 0.4.0 | No |

## Reporting a Vulnerability

If you discover a security vulnerability in Gemma Code, please report it through one of the following channels:

- **GitHub Security Advisories** (preferred): use the "Report a vulnerability" button on the [Security tab](https://github.com/bendourthe/Gemma-Code/security/advisories) to file a private report.
- **Email**: send details to the maintainer listed in the repository.

### Response Timeline

| Step | Target |
|------|--------|
| Acknowledgment | Within 48 hours |
| Triage and severity assessment | Within 72 hours |
| Fix for Critical/High severity | 7 calendar days |
| Fix for Medium severity | 30 calendar days |
| Fix for Low severity | Next scheduled release |

### Disclosure Policy

Gemma Code follows coordinated disclosure. We will work with you to understand and resolve the issue before any public disclosure. Reporters are credited in the CHANGELOG unless they request otherwise.

### Scope

The following components are in scope for security reports:

- TypeScript extension host code (`src/`)
- PyQt5 cross-platform installer (`scripts/installer/pyqt/`)
- Webview HTML/JS (`src/panels/webview/`)
- MCP client/server implementation (`src/mcp/`)

## Security Architecture

Gemma Code is designed with a privacy-first, local-only architecture:

- **No external API calls**: all inference runs locally via Ollama on `localhost:11434`. No telemetry, no cloud dependencies.
- **DNS-resolving SSRF protection**: `FetchPageTool`, `WebSearchTool`, and the optional OTLP exporter validate every URL through `src/utils/ssrf.ts`, which resolves hostnames via DNS and rejects any address (v4 or v6) in loopback, link-local, or RFC-1918 private ranges. Redirects are re-validated on every hop.
- **Path traversal guard**: all filesystem tools enforce a workspace-root boundary check via `src/tools/handlers/pathGuard.ts`; `run_terminal` reuses the same helper on its `cwd` parameter. v0.6.0 unified every filesystem handler behind `pathGuard.resolveInsideWorkspace`, which is realpath-aware: symlinks in any path segment are followed, and for write/create targets whose leaf does not yet exist, the deepest existing ancestor is realpath'd before the boundary check. This closes the symlink leg of pen-test Attack Path A.
- **Shell command safety**: `RunTerminalTool` prefers an allowlist of developer-common commands (`git`, `npm`, `pnpm`, `yarn`, `node`, `python`, `python3`, `pytest`, `cargo`, `go`, `make`, `ls`, `cat`, `echo`, `pwd`) and keeps a hardened hard-blocklist (`rm -rf /`, `mkfs`, `dd if=/dev/zero`, etc.) as defense in depth. All terminal commands are always DANGEROUS-tier and flow through the confirmation gate regardless of edit mode. Commands not on the allowlist are surfaced with an explicit "OUTSIDE the allowlist" warning in the confirmation prompt.
- **Secret-path denylist**: `ReadFileTool`, `ListDirectoryTool`, and `GrepCodebaseTool` reject paths matching `**/.env*`, `**/id_rsa*`, `**/id_ed25519*`, `**/*.pem`, `**/*.key`, `**/credentials*`, `**/.aws/**`, `**/.ssh/**`, `**/secrets/**`, and `**/.gemma-code/mcp.json` by default. Users may override per-call via `allow_secrets: true`, which triggers an explicit confirmation prompt. Extra patterns can be contributed via `gemma-code.secretPathDenyExtra`.
- **MCP hardening**: MCP is disabled by default (`mcpEnabled: false`). Workspace-local `.gemma-code/mcp.json` files require explicit user approval on first load, remembered per-workspace in `workspaceState`. Configs are parsed through a Zod schema (bounded name length, command string, transport literal `stdio`). Spawned MCP subprocesses inherit **only** `PATH`, `HOME`, `USERPROFILE`, `APPDATA` (plus any explicitly-configured `env` keys matching the `SHOUTING_SNAKE_CASE` pattern). Tool descriptions are HTML-stripped and capped at 500 chars; tool names must match `^[a-zA-Z0-9_]{1,64}$`.
- **MCP server allowlist + peer attribution (v0.6.0)**: when `mcpServerMode = "stdio"` exposes Gemma Code's tools to external MCP clients, only the tools listed in `gemma-code.mcpExposedTools` are registered with the SDK; the default is the read-only subset `read_file`, `list_directory`, `grep_codebase`. Every MCP-driven tool call carries a `source: "mcp"` tag through `ToolRegistry.execute`, and the user-visible confirmation prompt is prefixed with `"External MCP client wants to: ..."` so the request cannot masquerade as a local-agent action. Sub-agent calls are similarly attributed.
- **permissionOverrides floor (v0.6.0)**: `gemma-code.permissionOverrides` cannot drop a tool whose baseline tier requires confirmation to AUTO_APPROVE. Workspace-level `.vscode/settings.json` settings that try to silently auto-approve `delete_file`, `run_terminal`, `web_search`, `fetch_page`, `write_file`, `edit_file`, `create_file`, or any MCP tool are clamped to tier 1 at runtime with a single `getLogger().warn(...)` per (tool, override) pair. Closes the auto-approve leg of pen-test Attack Path A.
- **ReDoS defense**: `GrepCodebaseTool` rejects regex patterns with nested quantifiers or patterns longer than 512 characters before compilation, and aborts the scan loop if it exceeds a 500 ms time budget.
- **Sub-agent tool scoping**: research sub-agents have no write tools; verification sub-agents have no delete tools. Each sub-agent gets an isolated, ephemeral conversation.
- **Webview CSP**: both webview hosts serve a strict Content-Security-Policy (`default-src 'none'; img-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'`). Model/tool/memory-rendered HTML is sanitized through DOMPurify before reaching any `innerHTML` sink. Attribute-context interpolations use a dedicated `escapeAttr` helper.

## File Permissions

- **POSIX (Linux, macOS)**: every SQLite database created by the extension (chat history, memory, traces, graph, episodic) is chmoded to `0o600` immediately after open so other local users cannot read its contents. This is enforced via `src/storage/dbPermissions.ts`.
- **Windows**: filesystem ACLs on `%APPDATA%` protect per-user data by default. The extension does not modify ACLs. If the user stores project databases in a shared or synced directory (OneDrive, Dropbox, network share), they should verify the directory is not world-readable.

## Installer Supply Chain

The cross-platform PyQt5 installer pulls third-party binaries (currently Ollama) over HTTPS and verifies them before execution:

- **Pinned release tag**: the installer downloads a specific Ollama version recorded in `scripts/installer/pyqt/VERSIONS.md`. Upstream tag changes do not flow in automatically.
- **SHA-256 checksum verification**: both the Windows `OllamaSetup.exe` and the Linux `install.sh` are hash-checked against pinned digests before execution. A mismatch aborts the install.
- **Authenticode verification (Windows)**: `Get-AuthenticodeSignature` is used to confirm the Windows installer is signed by a trusted subject (`CN=Ollama Inc.`). Invalid or untrusted signatures abort the install.
- **No `curl | sh`**: the Linux path downloads the install script to a temp file, verifies its hash, runs it via `bash`, then cleans up. This replaces the classic pipe-to-shell pattern that is vulnerable to TCP-hijack supply-chain attacks.
- **Dependency auditing in CI**: every push runs `npm audit --production --audit-level=high` (fails on high/critical CVEs in runtime deps) and `pip-audit --strict` against the installer venv.

## Past Security Findings

The v0.1.0 security audit (`docs/archive/versions/v0/v0.1.0/security-audit.md`) identified and resolved three findings:

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| SEC-01 | High | SSRF via unvalidated URL in FetchPageTool | Fixed (`isSsrfBlocked()`) |
| SEC-02 | Medium | Command injection via shell metacharacter chaining | Hardened (segment splitting) |
| SEC-03 | Low | Path traversal in filesystem tools | Mitigated (workspace-root guard) |

## Security-Related Configuration

| Setting | Default | Purpose |
|---------|---------|---------|
| `gemma-code.toolConfirmationMode` | `"ask"` | Controls when tool execution requires user approval |
| `gemma-code.editMode` | `"auto"` | Controls file edit confirmation behavior |
| `gemma-code.mcpEnabled` | `false` | Enables MCP client/server support |
| `gemma-code.mcpServerMode` | `"off"` | Controls MCP server exposure mode |
| `gemma-code.mcpExposedTools` | `["read_file", "list_directory", "grep_codebase"]` | Allowlist of built-in tools exposed to external MCP clients (v0.6.0) |
| `gemma-code.permissionOverrides` | `{}` | Per-tool tier overrides; values < 1 are clamped to 1 for tools whose baseline requires confirmation (v0.6.0) |
| `gemma-code.verificationEnabled` | `true` | Enables auto-verification sub-agent after file edits |
| `gemma-code.secretPathDenyExtra` | `[]` | Extra glob patterns treated as secret-path denylist entries |
| `gemma-code.otlpEnabled` | `false` | Gate for the optional OTLP trace exporter (off by default to preserve the local-only guarantee) |
