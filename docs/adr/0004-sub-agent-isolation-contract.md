# ADR-0004: Sub-Agent Isolation Contract

- **Status**: Accepted (2026-04-26)
- **Deciders**: Benjamin Dourthe (project owner) — codifies the v0.2.0 sub-agent introduction, v0.3.0 verification trigger, and v0.5.0 Phase 8 specialist externalization

## Context

The agent loop in [src/tools/AgentLoop.ts](../../src/tools/AgentLoop.ts) is a single conversation against Gemma 4 with the full built-in tool surface available. Several recurring tasks benefit from a narrower context and a narrower toolset: verification after a series of file edits, deeper research that includes web fetches, and pre-execution planning that should never touch the filesystem. Putting all three modes inside the parent agent loop muddies the system prompt and risks cross-contamination — for example, a planning turn that accidentally calls `run_terminal`, or a verification turn that browses the web. Spawning isolated sub-agents with scoped tool sets and dedicated system prompts solves this without introducing a second runtime process (Gemma Code is a single-process VS Code extension).

## Decision

[src/agents/SubAgentManager.ts](../../src/agents/SubAgentManager.ts) spawns three sub-agent roles, each with a distinct tool scope and an externalised system prompt. Each sub-agent runs in an ephemeral [ConversationManager](../../src/chat/ConversationManager.ts) and [AgentLoop](../../src/tools/AgentLoop.ts); the conversation is discarded after the run completes and only the structured `SubAgentResult` bubbles up to the parent.

**Roles and tool scopes** (authoritative copy in [src/agents/SubAgentManager.ts](../../src/agents/SubAgentManager.ts) `TOOLS_BY_TYPE` and the `toolScope` frontmatter of each specialist file):

| Role | Tool scope | Disallowed |
|------|------------|------------|
| `verification` | `read_file`, `grep_codebase`, `list_directory`, `run_terminal` | `write_file`, `edit_file`, `create_file`, `delete_file`, `web_search`, `fetch_page` (no writes; no network) |
| `research` | `read_file`, `grep_codebase`, `list_directory`, `web_search`, `fetch_page` | All file mutations and `run_terminal` (no writes; no shell) |
| `planning` | `read_file`, `grep_codebase`, `list_directory` | All mutations and `run_terminal` and network (read-only) |

**Specialist externalization** (v0.5.0 Phase 8): system prompts and tool scopes are loaded from Markdown+YAML frontmatter files via [src/agents/SpecialistLoader.ts](../../src/agents/SpecialistLoader.ts). The priority chain is:

1. Workspace override at `<workspace>/.gemma-code/specialists/<role>.md` (validated against a Zod schema; malformed overrides emit a warning and fall through).
2. Bundled at `<extension>/assets/specialists/<role>.md` ([assets/specialists/](../../assets/specialists/)).
3. Hardcoded fallback in [src/agents/SubAgentPrompts.ts](../../src/agents/SubAgentPrompts.ts).

Provenance is recorded in `MetricsCollector` events (`specialist.loaded` with `provenance: 'workspace' | 'bundled' | 'hardcoded'`) so workspace overrides are observable in traces.

**Isolation properties**:

- Each sub-agent gets its own `ConversationManager`; the parent's history is not shared. The parent can pass scoped context via `buildSubAgentContextMessage`.
- Tool registry for the sub-agent is constructed by filtering [src/tools/ToolCatalog.ts](../../src/tools/ToolCatalog.ts) against the role's `toolScope`; unknown tools cannot leak in even if the prompt asks.
- Tool execution still routes through the same [src/tools/ConfirmationGate.ts](../../src/tools/ConfirmationGate.ts), [src/guardrails/PermissionTiers.ts](../../src/guardrails/PermissionTiers.ts), and the optional Claude Code-style PreToolUse hook (`scripts/hooks/check-tool-permission.mjs`). Sub-agents do not bypass the parent's safety layer.
- Iteration cap: `gemma-code.subAgentMaxIterations` (default 10) bounds runaway sub-agents.

## Consequences

**Positive**

- Smaller blast radius per role: a planning agent cannot delete files; a research agent cannot run shell commands; a verification agent cannot exfiltrate via the web.
- User-customisable behaviour without recompilation: drop a workspace override file and the next sub-agent run picks it up.
- Parent context stays clean: sub-agent system prompts do not crowd the parent's prompt budget.
- Characterization tests in [tests/unit/agents/](../../tests/unit/agents/) lock the bundled-default behaviour byte-equivalently against the pre-externalization hardcoded path; this ADR records the contract those tests enforce.

**Negative**

- Three system prompts to keep coherent. Drift between roles is possible if one is updated and another is forgotten; the specialist files are co-located in [assets/specialists/](../../assets/specialists/) to make a `git diff` review easier.
- The role contract is convention, not language-enforced. A future bug could let a `verification` agent receive a `write_file` tool if `TOOLS_BY_TYPE` and the specialist's `toolScope` disagree. The mitigation is the activation-rules check in [src/tools/ToolActivationRules.ts](../../src/tools/ToolActivationRules.ts), which intersects the requested scope with the platform-allowed scope before registration.
- Each sub-agent run pays the cost of a fresh prompt assembly and a fresh tool registry. Acceptable: sub-agents are infrequent (verification triggers only after `verificationThreshold` edits; research and planning are user-initiated).

**Neutral**

- The `orchestration` role exists as a fourth specialist but is consumed by [src/orchestration/PlannerAgent.ts](../../src/orchestration/PlannerAgent.ts), not by `SubAgentManager`. Its tool scope is broader because it composes sub-agents rather than acting directly.

## Alternatives considered

- **One mega-agent with permission-tier gating.** Rejected: the per-call confirmation cost would balloon, and the system prompt would need to encode all three roles' behaviour. The gating layer can prevent damage but does not narrow the model's *intent* the way a scoped sub-agent does.
- **One sub-process per role.** Rejected: VS Code extensions are single-process by convention; spawning child processes for an in-extension agent role is a heavier hammer than this problem needs and complicates packaging.
- **Hardcoded prompts only (no externalization).** Rejected: users who want a planning agent that emphasises typed errors over runtime errors (or vice versa) had no path to customise without forking. The Phase 8 externalization opens that path with the workspace-override mechanism.
- **Granting write tools to verification.** Considered for "auto-fix on verify" workflows; rejected because the user expects a verification report, not unsolicited edits. The fix path remains: verification produces a structured report; the parent agent (or user) decides whether to apply changes.

## Links

- v0.2.0 sub-agent introduction: [docs/archive/versions/v0/v0.2.0/architecture.md](../v0.2.0/architecture.md)
- v0.5.0 Phase 8 (specialist externalization): [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../v0.5.0/plans/implementation-plan.md), routa adoption sub-tasks 2.1-2.3: [docs/archive/versions/v0/v0.5.0/plans/routa-harness-adoption.md](../v0.5.0/plans/routa-harness-adoption.md)
- Specialist files: [assets/specialists/](../../assets/specialists/) (`research.md`, `verification.md`, `planning.md`, `orchestration.md`)
- Manager implementation: [src/agents/SubAgentManager.ts](../../src/agents/SubAgentManager.ts)
- Loader implementation: [src/agents/SpecialistLoader.ts](../../src/agents/SpecialistLoader.ts)
- Permission interaction: [ADR-0005](./0005-tool-permission-tiers.md)
