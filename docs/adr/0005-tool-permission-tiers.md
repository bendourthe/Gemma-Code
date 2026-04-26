# ADR-0005: Tool Permission Tiers

- **Status**: Accepted (2026-04-26)
- **Deciders**: Benjamin Dourthe (project owner) — codifies the v0.4.0 permission-tier introduction and the v0.5.0 Phase 1 PreToolUse hook addition

## Context

Gemma 4 chooses tool calls autonomously inside the agent loop. Without a confirmation discipline, the agent can delete files, run shell commands, or open outbound network requests purely on its own reasoning — sometimes against the user's intent. A flat per-tool confirmation prompt is a reasonable first cut, but it (a) blocks the agent on read-only operations that should be free, and (b) treats `read_file` and `run_terminal` as equally risky, training users to click through the prompts. The trade-off is between agent fluency (do not block on safe work) and user safety (always interrupt on dangerous work).

## Decision

Classify every tool into one of three permission tiers. The tier determines whether [src/tools/ConfirmationGate.ts](../../src/tools/ConfirmationGate.ts) prompts the user before execution. Tiers are defined in [src/guardrails/PermissionTiers.ts](../../src/guardrails/PermissionTiers.ts) (`PermissionTier` enum) with the static map `TOOL_PERMISSION_MAP`.

**Tiers**

- **Tier 0 — `AUTO_APPROVE`**: read-only tools. Never prompts. Tools: `read_file`, `list_directory`, `grep_codebase`, `tail_output`, `grep_output`, plus the help-discovery tool `get_tool_schema` (introduced in v0.5.0 Phase 6 as a metadata read).
- **Tier 1 — `CONFIRM`**: file-mutation tools. Prompts unless `editMode` is `auto`. Tools: `write_file`, `edit_file`, `create_file`, `delete_file`.
- **Tier 2 — `DANGEROUS`**: side-effecting tools. Always prompts (subject to the `toolConfirmationMode` setting). Tools: `run_terminal`, `web_search`, `fetch_page`. All MCP tools default to Tier 2 unless overridden — the MCP server is external and its capabilities cannot be statically classified.

**Interactions**

- `gemma-code.editMode` controls Tier 1: `auto` skips the prompt; `ask` always prompts; `plan` produces a numbered plan and prompts before any Tier 1+ action.
- `gemma-code.toolConfirmationMode` controls Tier 2: `always` prompts every time; `ask` prompts on commands outside the terminal allowlist (see [src/tools/handlers/terminal.ts](../../src/tools/handlers/terminal.ts) `isAllowlisted`); `never` runs without prompts (use with caution; documented in `package.json` description).
- `gemma-code.permissionOverrides` allows per-tool tier overrides. Unknown values fall back to the static map.
- The optional Claude Code-style PreToolUse hook (added in v0.5.0 Phase 1; see `scripts/hooks/check-tool-permission.mjs` and the agent-agnostic harness section of [AGENTS.md](../../AGENTS.md)) is a *belt* over the in-process *suspenders* check. Both fire; either can deny. The hook's purpose is defense in depth: even if the in-process check is later weakened, the hook catches secret-path and out-of-workspace writes.

**Sub-agent interaction** ([ADR-0004](./0004-sub-agent-isolation-contract.md)): sub-agents pass through the same permission-tier check. A `verification` sub-agent that requests `run_terminal` still triggers the Tier 2 confirmation flow.

## Consequences

**Positive**

- Read-only work is fast: the agent paginates through the codebase without dragging the user through prompts.
- Writes and shell commands are visible: the user sees a diff (Tier 1) or a command preview (Tier 2) before anything happens.
- The static map is auditable: a single file lists every tool and its tier; no per-handler reasoning to understand the policy.
- The PreToolUse hook adds a redundant deny-path that costs < 50 ms p99 (asserted in [tests/benchmarks/hooks.bench.ts](../../tests/benchmarks/hooks.bench.ts)) and survives in-process refactors that might temporarily relax the in-process gate.

**Negative**

- Some workflows feel slow without `editMode: auto`. Users who trust the agent (e.g. on a feature branch with the git safety net armed) opt out via the setting; a global "auto" default would be unsafe for new users.
- The MCP-tools-default-to-DANGEROUS rule means a benign read-only MCP tool (e.g. a fact-lookup) prompts on every call until the user adds it to `permissionOverrides`. Acceptable because the alternative is auto-approving network-bound tools whose capabilities the project cannot inspect.
- Two tier checks in two different layers (in-process gate + harness hook) is duplication by design. The cost is two paths to keep coherent; the value is one path to fail before the other can be exploited.

**Neutral**

- The `getDangerousWarning` helper in [PermissionTiers.ts](../../src/guardrails/PermissionTiers.ts) produces the human-readable confirmation message. UX copy lives here, not in the panel.

## Alternatives considered

- **Single confirmation gate with per-tool prompts.** Rejected: trains users to click through; treats reads and writes as equal risk; degrades to "always allow" in practice.
- **Per-tool confirmation with a learned allowlist.** Rejected: requires persisting per-user trust decisions across sessions, which adds a privacy surface and a learnability surface (when does a learned trust expire?). The current static map plus `permissionOverrides` covers the same need with a much smaller footprint.
- **Allowlist only (deny everything else).** Rejected: the agent's value comes from the breadth of its tool surface; an allowlist forces the user to anticipate which tools they will need before the task starts.
- **One tier, four labels.** Rejected: collapsing `CONFIRM` and `DANGEROUS` would lose the ability for `editMode: auto` to skip file edits without also skipping `run_terminal`, which is the primary user request behind the three-tier design.

## Links

- Tier definitions: [src/guardrails/PermissionTiers.ts](../../src/guardrails/PermissionTiers.ts)
- Confirmation gate: [src/tools/ConfirmationGate.ts](../../src/tools/ConfirmationGate.ts)
- Action classifier: [src/guardrails/ActionClassifier.ts](../../src/guardrails/ActionClassifier.ts)
- Terminal allowlist: [src/tools/handlers/terminal.ts](../../src/tools/handlers/terminal.ts) (`isAllowlisted`)
- v0.5.0 Phase 1 hook: routa adoption sub-task 1.1 in [docs/v0.5.0/plans/routa-harness-adoption.md](../v0.5.0/plans/routa-harness-adoption.md)
- Hook benchmark: [tests/benchmarks/hooks.bench.ts](../../tests/benchmarks/hooks.bench.ts)
- Sub-agent interaction: [ADR-0004](./0004-sub-agent-isolation-contract.md)
