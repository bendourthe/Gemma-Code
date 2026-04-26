# Tool Audit — v0.5.0

**Last reviewed**: 2026-04-26
**Source**: this audit operationalises the rubric from [docs/v0.5.0/comparison/comparison-7-principles-for-agent-friendly-clis.md](comparison/comparison-7-principles-for-agent-friendly-clis.md), in turn derived from Trevin Chow's "7 Principles for Agent-Friendly CLIs".

This document classifies every tool Gemma exposes to Gemma 4 (and indirectly to the user) by how *agent-friendly* it is. The labels are vocabulary for reviews and PR descriptions, not a CI gate; CI does not currently fail a build because a tool is labelled `friction`. Use the rubric to keep tool quality discussions grounded in the same definitions.

## Severity Rubric

- **Blocker** — prevents reliable agent use. The tool hangs, requires interactive intervention, returns no structured information on failure, or has unrecoverable output that forces the agent to abandon the task. Resolve first.
- **Friction** — works but inefficiently. Vague errors that force retries, missing pagination on large outputs, brittle parsing, no `dry_run` on a destructive operation, no `format=json` on a list-shaped output. The agent succeeds but consumes more iterations and tokens than necessary.
- **Optimization** — functions well but could be faster, cheaper, or clearer. Latency tightening, additional structured-output modes, sharper error hints, broader pagination. The tool is not blocking quality work; it is the next round of polish.

The rubric is severity, not priority. A `friction` finding on a heavily-used tool is more urgent than a `blocker` on a tool the agent rarely picks. Use this audit alongside trace-based usage data when sequencing work.

## Tool Audit Table

Tools are listed in the order they appear in [src/tools/ToolCatalog.ts](../../src/tools/ToolCatalog.ts). Severity reflects post-v0.5.0-Phase-6 state (universal byte cap, pagination, dry-run, JSON format).

| Tool | Severity | Source | Notes | Action |
|------|----------|--------|-------|--------|
| `read_file` | Optimization | [src/tools/handlers/filesystem.ts](../../src/tools/handlers/filesystem.ts) | Pagination via `range_start` / `range_end` shipped in v0.5.0 Phase 2; persistent diff-based cache plus `full=true` escape hatch in Phase 4; 64 KB byte cap in Phase 2 | Future: streaming for files > 1 MB to avoid the read-then-cap cost. Not urgent. |
| `write_file` | Optimization | [src/tools/handlers/filesystem.ts](../../src/tools/handlers/filesystem.ts) | Routes through `pathGuard.ts` and `secretPaths.ts`; Tier 1 confirmation per [ADR-0005](../adr/0005-tool-permission-tiers.md) | None planned for v0.5.0 |
| `edit_file` | Optimization | [src/tools/handlers/filesystem.ts](../../src/tools/handlers/filesystem.ts) | Single-occurrence semantics on `old_string` keep edits unambiguous; clear error on multi-match | None planned |
| `create_file` | Optimization | [src/tools/handlers/filesystem.ts](../../src/tools/handlers/filesystem.ts) | Refuses overwrite (callers use `write_file` to overwrite) | None planned |
| `delete_file` | Optimization | [src/tools/handlers/filesystem.ts](../../src/tools/handlers/filesystem.ts) | `dry_run=true` returns size + SHA-256 (first 1 MB) without unlink, shipped v0.5.0 Phase 6 | None planned |
| `list_directory` | Optimization | [src/tools/handlers/filesystem.ts](../../src/tools/handlers/filesystem.ts) | `format='json'` mode shipped v0.5.0 Phase 6 with deterministic shape and `_truncation` field on cap-fire | None planned |
| `grep_codebase` | Optimization | [src/tools/handlers/filesystem.ts](../../src/tools/handlers/filesystem.ts) | `max_results` / `next_offset` pagination shipped v0.5.0 Phase 2; `format='json'` shipped v0.5.0 Phase 6; ReDoS guard and 500 ms time budget pre-existing | None planned |
| `run_terminal` | Optimization | [src/tools/handlers/terminal.ts](../../src/tools/handlers/terminal.ts) | Conservative allowlist; `dry_run=true` returns parsed-token preview without subprocess spawn (v0.5.0 Phase 6); Tier 2 DANGEROUS confirmation | Allowlist breadth is intentional. Track allowlist gaps in `docs/issues/` if specific commands recur as denials. |
| `web_search` | Friction | [src/tools/handlers/webSearch.ts](../../src/tools/handlers/webSearch.ts) | DuckDuckGo HTML parser with no result cache; the agent re-issues the same search across retries and consumes tokens re-reading near-identical results | Add a session-scoped cache for `web_search` (planned in token-optimizer-adoption Phase 4.1) |
| `fetch_page` | Friction | [src/tools/handlers/webSearch.ts](../../src/tools/handlers/webSearch.ts) | Same caching gap as `web_search`; outputs are also subject to the 64 KB cap and benefit from pagination, which is not yet exposed | Same cache fix; consider adding `range_start/range_end` similar to `read_file` |
| `tail_output` | Optimization | [src/tools/OutputRedirector.ts](../../src/tools/OutputRedirector.ts) | Reads from the redirected output store; size-bounded by construction | None planned |
| `grep_output` | Optimization | [src/tools/OutputRedirector.ts](../../src/tools/OutputRedirector.ts) | Same source as `tail_output`; ReDoS guard mirrors `grep_codebase` | None planned |
| MCP tools | Variable | [src/mcp/McpManager.ts](../../src/mcp/McpManager.ts) | Tier defaults to DANGEROUS per [ADR-0005](../adr/0005-tool-permission-tiers.md). External servers; severity depends on the upstream tool's quality | Audit individual MCP servers as they are added; document overrides in `gemma-code.permissionOverrides` |

## Help-discovery surface

The agent's `--help` analog is the [src/tools/ToolCatalog.ts](../../src/tools/ToolCatalog.ts) metadata, surfaced into the system prompt by [src/chat/PromptBuilder.ts](../../src/chat/PromptBuilder.ts). Each tool's catalog entry includes:

- `name` — exactly the string the agent passes in `<|tool_call>`.
- `description` — one-line purpose plus a usage example for the non-obvious calls (`read_file(path='src/extension.ts', range_start=0, range_end=4096)`).
- `parameters` — `{ type, description, required }` per parameter; matches the JSON Schema the Ollama tool API expects.

Error messages from handlers reference `get_tool_schema` as the next step when the agent picks an unknown tool name (see [src/tools/ToolRegistry.ts](../../src/tools/ToolRegistry.ts)). The intent is that the agent can re-discover a tool's schema mid-task without a re-prompt. The catalog content itself is the help text; the agent already receives it on every turn through the dynamic tool-registration in `PromptBuilder`.

## Severity is not a CI gate

The labels here are vocabulary, not policy. There is no "max-friction-tools" budget; there is no CI step that fails a PR because a tool is `friction`. The point of the rubric is to keep PR descriptions and review threads using the same words for the same conditions, so a "this is friction, but acceptable for v0.5.0" comment is unambiguous about whether the next reviewer is expected to push back.

When a `blocker` or `friction` finding accumulates evidence over multiple sessions, file an issue under [docs/issues/](../issues/) using the [issue template](../issues/_template.md) so the investigation has a durable home.

## See also

- Source comparison report: [docs/v0.5.0/comparison/comparison-7-principles-for-agent-friendly-clis.md](comparison/comparison-7-principles-for-agent-friendly-clis.md)
- Permission-tier interaction: [docs/adr/0005-tool-permission-tiers.md](../adr/0005-tool-permission-tiers.md)
- Pagination, dry-run, and JSON format adoption plan: [docs/v0.5.0/plans/agent-friendly-tools.md](plans/agent-friendly-tools.md)
- Tool catalogue: [src/tools/ToolCatalog.ts](../../src/tools/ToolCatalog.ts)
- Tool registry: [src/tools/ToolRegistry.ts](../../src/tools/ToolRegistry.ts)
