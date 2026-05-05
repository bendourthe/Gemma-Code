# ADR-0007: Permission-tier floor for confirmation-class tools

- **Status**: Accepted (2026-05-04)
- **Deciders**: Benjamin Dourthe (project owner) — closes pen-test F-003 + the auto-approve leg of Attack Path A as part of v0.6.0 Phase 1

## Context

ADR-0005 codified three permission tiers (AUTO_APPROVE, CONFIRM, DANGEROUS) with `gemma-code.permissionOverrides` as the per-user escape hatch. The override was intentionally additive: a user who trusts a particular MCP tool can drop it from DANGEROUS to AUTO_APPROVE, and a workspace that wants `run_terminal` to skip the prompt for a constrained allowlist can override it.

The pen-test review surfaced the missing constraint. With no clamp, a workspace-controlled `.vscode/settings.json` containing `{"gemma-code.permissionOverrides": {"run_terminal": 0, "delete_file": 0}}` silently auto-approves the two highest-impact tools in the catalog. Combined with the symlink leg (closed by ADR-0006), this composes into Attack Path A: hostile workspace -> tier downgrade -> RCE through `run_terminal` or out-of-workspace deletion through `delete_file`. Pen-test F-003 tracks this as the *auto-approve leg* of the chain.

The override needed to remain useful (going from DANGEROUS to CONFIRM is legitimate for trusted MCP tools) without becoming an "always-allow workspace" backdoor. The floor had to be enforced where overrides are read, not where they are written, so a workspace that ships a malicious `settings.json` cannot win even if VS Code applies it before the extension activates.

## Decision

`getPermissionTier()` in [src/guardrails/PermissionTiers.ts](../../src/guardrails/PermissionTiers.ts) clamps any override that would drop a confirmation-class tool below tier 1. Specifically: if the baseline tier of a tool is `CONFIRM` (1) or `DANGEROUS` (2), and the user-supplied override is `AUTO_APPROVE` (0), the clamp returns `CONFIRM` (1) and emits a deduped warning via `getLogger().warn()` describing what was clamped and why.

The floor applies to both built-in CONFIRM tools (`write_file`, `edit_file`, `create_file`, `delete_file`) and to all DANGEROUS tools (`run_terminal`, `web_search`, `fetch_page`, plus any MCP tool, since MCP tools default to DANGEROUS per ADR-0005). It does not apply to AUTO_APPROVE tools: a user can still set `read_file` or `list_directory` to any tier, including 0, because the baseline is already 0.

The clamp is read-side. Even if a workspace ships a settings file that tries to set `run_terminal` to 0, every consultation of `permissionOverrides` re-applies the floor; nothing the workspace writes can persist through.

A regression test at [tests/integration/permission-overrides-clamp.test.ts](../../tests/integration/permission-overrides-clamp.test.ts) covers the three branches: (a) tier-2 baseline + override 0 → returns 1; (b) tier-1 baseline + override 0 → returns 1; (c) tier-0 baseline + override 0 → returns 0. The dedupe set is exposed via `_resetPermissionOverrideWarnings()` so the test asserts the warning fires once per unique `(toolName, override)` pair.

## Consequences

**Positive**

- Attack Path A's auto-approve leg is closed. Combined with ADR-0006's path-guard unification, the chained P0 finding from the v0.5.0 review pass is eliminated.
- Trust boundary aligns with operator intent: dropping DANGEROUS to CONFIRM remains a useful per-tool dial; auto-approving a confirmation-class tool is no longer expressible.
- The dedupe set keeps the warning useful (fires on first occurrence) without flooding the output channel when a permanent override is in effect.

**Negative**

- A user who *genuinely* wants to auto-approve `delete_file` for a personal scratch workspace cannot do so. The escape hatch is an `editMode: 'auto'` workspace setting (which skips the CONFIRM prompt), or per-session `toolConfirmationMode: 'never'` (which skips the DANGEROUS prompt) -- both of which are documented in [package.json](../../package.json) as unsafe, but at least surface the safety trade-off at the right layer.
- The clamp is silent except for the log warning. A user staring at a `permissionOverrides` setting with `run_terminal: 0` and watching the agent still prompt may be confused. The deduped warning + the `package.json` description ("CONFIRM and DANGEROUS tiers cannot be lowered to AUTO_APPROVE; lower values are clamped to CONFIRM") are the discovery path.

**Neutral**

- The clamp warning lives in the runtime log channel, not in the panel UX. A future enhancement could surface it as a one-time toast on workspace open. Out of scope for v0.6.0.

## Alternatives considered

- **Reject the workspace setting at write time.** Rejected: the extension cannot prevent VS Code from accepting an arbitrary JSON value into `settings.json`; the only enforcement the extension owns is the read path.
- **Hard-fail (throw) on a sub-floor override.** Rejected: a thrown error would block the agent loop on first tool dispatch; clamp-and-warn keeps the flow alive while preserving the safety property.
- **Allow the override but require a one-time user confirmation.** Rejected: the user-confirmation surface is exactly what the override is *trying to bypass*; using it as the gate is circular.
- **Keep the override unbounded; rely on the harness hook (ADR-0005's "belt").** Rejected: relying on the hook means a user who has not adopted Claude Code or another harness (which is the default state per ADR-0008's harness-agnostic stance) loses the safety property entirely. The in-process clamp is the suspenders.

## Links

- Implementation: [src/guardrails/PermissionTiers.ts:49-75](../../src/guardrails/PermissionTiers.ts#L49-L75) (`getPermissionTier`)
- Regression test: [tests/integration/permission-overrides-clamp.test.ts](../../tests/integration/permission-overrides-clamp.test.ts)
- Pen-test finding: [docs/v0.6.0/review/penetration-test.md](../v0.6.0/review/penetration-test.md) F-003
- Companion ADR (symlink leg of Attack Path A): [ADR-0006](./0006-unified-path-guard.md)
- Tier model: [ADR-0005](./0005-tool-permission-tiers.md)
- v0.6.0 Phase 1 plan entry: [docs/v0.6.0/plans/v0.6.0-cycle.md](../v0.6.0/plans/v0.6.0-cycle.md) sub-task 1.2
