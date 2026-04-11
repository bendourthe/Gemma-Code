# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.0   | Yes |
| 0.1.0   | Security fixes only |
| < 0.1.0 | No |

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
- Python FastAPI backend (`src/backend/`)
- Windows NSIS installer (`scripts/installer/`)
- Webview HTML/JS (`src/panels/webview/`)
- MCP client/server implementation (`src/mcp/`)

## Security Architecture

Gemma Code is designed with a privacy-first, local-only architecture:

- **No external API calls**: all inference runs locally via Ollama on `localhost:11434`. No telemetry, no cloud dependencies.
- **SSRF protection**: the `FetchPageTool` rejects localhost, loopback, link-local, and RFC-1918 private IP ranges via `isSsrfBlocked()`.
- **Path traversal guard**: all filesystem tools enforce a workspace-root boundary check.
- **Shell command safety**: the `RunTerminalTool` uses a blocklist with shell-metacharacter segment splitting and a user confirmation gate.
- **MCP disabled by default**: MCP support (`mcpEnabled`) is off by default and requires explicit opt-in. MCP server mode (`mcpServerMode`) defaults to `"off"`.
- **Sub-agent tool scoping**: research sub-agents have no write tools; verification sub-agents have no delete tools. Each sub-agent gets an isolated, ephemeral conversation.

## Past Security Findings

The v0.1.0 security audit (`docs/v0.1.0/security-audit.md`) identified and resolved three findings:

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
| `gemma-code.verificationEnabled` | `true` | Enables auto-verification sub-agent after file edits |
